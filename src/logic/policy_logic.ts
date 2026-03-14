import { Effect, Layer, Either } from "effect"
import { transition } from "xstate"
import { quoteMachine } from "../machines/policy_quote_machine.ts"
import { policyLifecycleMachine } from "../machines/policy_lifecycle_machine.ts"
import {
  PolicyRepositoryTag,
  PolicyRepositoryError,
  type PolicyRepositoryService,
  type PolicyUpdate
} from "../repositories/policy_repository.ts"
import { DatabaseError } from "../services/database.ts"
import { DatabaseLive } from "../layers/database_layer.ts"
import { PolicyRepositoryLayer } from "../layers/policy_repository_layer.ts"
import type { NewPolicy, Policy } from "../models/policy.ts"

/** Signals invalid workflow transitions or missing data. */
export class PolicyWorkflowError extends Error {
  readonly _tag = "PolicyWorkflowError"
  constructor(readonly message: string) {
    super(message)
  }
}

/** Signals invalid user inputs or identifiers. */
export class PolicyValidationError extends Error {
  readonly _tag = "PolicyValidationError"
  constructor(readonly message: string) {
    super(message)
  }
}

/** All errors returned by policy workflows. */
export type PolicyLogicError =
  | DatabaseError
  | PolicyRepositoryError
  | PolicyValidationError
  | PolicyWorkflowError

/** Live wiring for policy logic dependencies. */
const AppLayer = PolicyRepositoryLayer.pipe(Layer.provide(DatabaseLive))

/** UUID format check for policy identifiers. */
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )

/** Validates a policy id and returns it in an Effect. */
const requireValidId = (id: string) =>
  isUuid(id)
    ? Effect.succeed(id)
    : Effect.fail(new PolicyValidationError("Invalid policy id"))

/** Converts various date inputs to YYYY-MM-DD. */
const toDateOnly = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toISOString().slice(0, 10)
}

/** True when a date string is already YYYY-MM-DD. */
const isValidDateString = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Returns true when coverage has ended by today's UTC date. */
const coverageEnded = (endDate: string) => {
  if (!endDate.trim()) return false
  const today = new Date().toISOString().slice(0, 10)
  return toDateOnly(endDate) <= today
}

/** Builds a workflow error Effect when a condition fails. */
const ensureWorkflow = (condition: boolean, message: string) =>
  condition
    ? Effect.succeed(undefined)
    : Effect.fail(new PolicyWorkflowError(message))

/** Loads a policy or fails with a workflow error. */
const requirePolicy = (
  repo: PolicyRepositoryService,
  id: string
) =>
  repo.findById(id).pipe(
    Effect.flatMap((policy) =>
      policy
        ? Effect.succeed(policy)
        : Effect.fail(new PolicyWorkflowError("Policy not found"))
    )
  )

/** Validates quote input and returns a NewPolicy. */
const buildQuotePolicy = (input: {
  policyNumber: string
  holderName: string
  premiumCents: number
  effectiveDate: string
  endDate: string
}) =>
  Effect.gen(function* () {
    yield* ensureWorkflow(
      input.policyNumber.trim().length > 0,
      "Policy number is required"
    )
    yield* ensureWorkflow(
      input.holderName.trim().length > 0,
      "Policy holder is required"
    )
    yield* ensureWorkflow(
      Number.isFinite(input.premiumCents) && input.premiumCents > 0,
      "Premium must be greater than 0"
    )
    yield* ensureWorkflow(
      input.effectiveDate.trim().length > 0,
      "Effective date is required"
    )
    yield* ensureWorkflow(
      input.endDate.trim().length > 0,
      "End date is required"
    )
    yield* ensureWorkflow(
      isValidDateString(input.effectiveDate),
      "Effective date must be YYYY-MM-DD"
    )
    yield* ensureWorkflow(
      isValidDateString(input.endDate),
      "End date must be YYYY-MM-DD"
    )
    yield* ensureWorkflow(
      input.endDate >= input.effectiveDate,
      "End date must be on or after effective date"
    )

    return {
      policyNumber: input.policyNumber,
      holderName: input.holderName,
      premiumCents: input.premiumCents,
      effectiveDate: input.effectiveDate,
      endDate: input.endDate,
      issuedAt: null,
      status: "quoted"
    } satisfies NewPolicy
  })

/** Enforces quote-machine transitions and surfaces workflow failures. */
const transitionQuoteOrFail = (
  policy: Policy,
  event: { type: "APPROVED"; effectiveDate: string } | { type: "DECLINED" }
) => {
  const snapshot = quoteMachine.resolveState({
    value: policy.status as "quoted" | "approved" | "declined",
    context: {
      status: policy.status as "quoted" | "approved" | "declined",
      policyNumber: policy.policyNumber,
      holderName: policy.holderName,
      premiumCents: policy.premiumCents,
      effectiveDate: policy.effectiveDate,
      endDate: policy.endDate
    }
  })
  const [next] = transition(quoteMachine, snapshot, event)
  if (String(next.value) === String(policy.status)) {
    return Effect.fail(
      new PolicyWorkflowError(
        `Transition blocked from ${policy.status} with ${event.type} due to missing data`
      )
    )
  }
  return Effect.succeed(next)
}

/** Enforces policy lifecycle transitions and surfaces workflow failures. */
const transitionLifecycleOrFail = (
  policy: Policy,
  event: { type: "EXPIRE" }
) => {
  const snapshot = policyLifecycleMachine.resolveState({
    value: policy.status === "active" ? "active" : "inactive",
    context: {
      status: policy.status === "active" ? "active" : "inactive",
      endDate: policy.endDate
    }
  })
  const [next] = transition(policyLifecycleMachine, snapshot, event)
  if (String(next.value) === String(snapshot.value)) {
    return Effect.fail(
      new PolicyWorkflowError(
        `Transition blocked from ${policy.status} with ${event.type} due to missing data`
      )
    )
  }
  return Effect.succeed(next)
}

/** Determines issued status using the policy lifecycle machine. */
const determineIssuedStatus = (policy: Policy) => {
  const snapshot = policyLifecycleMachine.resolveState({
    value: "issuing",
    context: {
      status: "issuing",
      endDate: policy.endDate
    }
  })
  const [next] = transition(policyLifecycleMachine, snapshot, { type: "ISSUE" })
  if (next.value === "issuing") {
    return Effect.fail(
      new PolicyWorkflowError(
        "Unable to determine issued policy status"
      )
    )
  }
  return Effect.succeed(next.value as "active" | "inactive")
}

/** Creates a quoted policy after validating input. */
export const quotePolicy = (input: {
  policyNumber: string
  holderName: string
  premiumCents: number
  effectiveDate: string
  endDate: string
}) =>
  Effect.gen(function* () {
    const repo = yield* PolicyRepositoryTag
    const policy = yield* buildQuotePolicy(input)
    return yield* repo.create(policy)
  })

/** Approves a policy and updates the effective date. */
export const approvePolicy = (input: { id: string; effectiveDate: string }) =>
  Effect.gen(function* () {
    yield* requireValidId(input.id)
    const repo = yield* PolicyRepositoryTag
    yield* ensureWorkflow(
      input.effectiveDate.trim().length > 0,
      "Effective date is required"
    )
    yield* ensureWorkflow(
      isValidDateString(input.effectiveDate),
      "Effective date must be YYYY-MM-DD"
    )
    const existing = yield* requirePolicy(repo, input.id)
    yield* ensureWorkflow(
      existing.status === "quoted",
      "Only quoted policies can be approved"
    )

    yield* transitionQuoteOrFail(existing, {
      type: "APPROVED",
      effectiveDate: input.effectiveDate
    })

    const patch: PolicyUpdate = {
      status: "approved",
      effectiveDate: input.effectiveDate
    }
    return yield* repo.update(input.id, patch)
  })

/** Issues a policy once underwriting is complete. */
export const activatePolicy = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* requireValidId(input.id)
    const repo = yield* PolicyRepositoryTag
    const existing = yield* requirePolicy(repo, input.id)
    yield* ensureWorkflow(
      existing.status === "approved",
      "Policy must be approved before issuing"
    )

    const issuedStatus = yield* determineIssuedStatus(existing)

    const patch: PolicyUpdate = {
      status: issuedStatus,
      issuedAt: new Date().toISOString()
    }
    return yield* repo.update(input.id, patch)
  })

/** Marks a policy inactive once coverage ends. */
export const deactivatePolicy = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* requireValidId(input.id)
    const repo = yield* PolicyRepositoryTag
    const existing = yield* requirePolicy(repo, input.id)
    yield* ensureWorkflow(
      existing.status === "active",
      "Only active policies can be deactivated"
    )
    yield* ensureWorkflow(
      coverageEnded(existing.endDate),
      "Coverage has not ended"
    )

    yield* transitionLifecycleOrFail(existing, { type: "EXPIRE" })

    const patch: PolicyUpdate = {
      status: "inactive"
    }
    return yield* repo.update(input.id, patch)
  })

/** Declines a policy that cannot be approved. */
export const declinePolicy = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* requireValidId(input.id)
    const repo = yield* PolicyRepositoryTag
    const existing = yield* requirePolicy(repo, input.id)
    yield* ensureWorkflow(
      existing.status === "quoted",
      "Only quoted policies can be declined"
    )

    yield* transitionQuoteOrFail(existing, { type: "DECLINED" })

    const patch: PolicyUpdate = {
      status: "declined"
    }
    return yield* repo.update(input.id, patch)
  })

/** Returns a policy by id, or fails if not found. */
export const getPolicy = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* requireValidId(input.id)
    const repo = yield* PolicyRepositoryTag
    return yield* requirePolicy(repo, input.id)
  })

/** Lists all policies ordered by creation date. */
export const listPolicies = () =>
  Effect.gen(function* () {
    const repo = yield* PolicyRepositoryTag
    return yield* repo.list()
  })

/** Expires active policies whose end date has passed (UTC). */
export const expirePolicies = (input?: { today?: string }) =>
  Effect.gen(function* () {
    const repo = yield* PolicyRepositoryTag
    const today = input?.today ?? new Date().toISOString().slice(0, 10)
    const expiring = yield* repo.listActiveEndingOnOrBefore(today)
    const results = yield* Effect.forEach(
      expiring,
      (policy) =>
        transitionLifecycleOrFail(policy, { type: "EXPIRE" }).pipe(
          Effect.flatMap(() =>
            repo.update(policy.id, { status: "inactive" })
          ),
          Effect.either
        ),
      { concurrency: 10 }
    )
    const expired = results.filter(Either.isRight).length
    const failed = results.length - expired
    yield* Effect.logInfo(
      `Expired ${expired} policies (failed ${failed})`
    )
    return { expired, failed }
  })

/** Runs policy Effects with the live repository and database. */
export const runPolicyEffect = <A>(
  effect: Effect.Effect<A, PolicyLogicError, PolicyRepositoryTag>
) => Effect.runPromise(Effect.provide(effect, AppLayer))
