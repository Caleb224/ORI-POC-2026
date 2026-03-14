import { api, APIError } from "encore.dev/api"
import { CronJob } from "encore.dev/cron"
import type { Effect } from "effect"
import {
  activatePolicy,
  approvePolicy,
  declinePolicy,
  expirePolicies,
  deactivatePolicy,
  getPolicy,
  listPolicies,
  quotePolicy,
  runPolicyEffect,
  type PolicyLogicError,
  PolicyWorkflowError,
  PolicyValidationError
} from "../logic/policy_logic.ts"
import { PolicyRepositoryError } from "../repositories/policy_repository.ts"
import { DatabaseError } from "../services/database.ts"
import type { Policy } from "../models/policy.ts"

/** Response payload for policy list requests. */
type ListPoliciesResponse = {
  policies: Policy[]
}

/** Maps domain errors to Encore API errors. */
const toApiError = (err: unknown) => {
  if (err instanceof PolicyWorkflowError) {
    return APIError.failedPrecondition(err.message, err)
  }
  if (err instanceof PolicyValidationError) {
    return APIError.invalidArgument(err.message, err)
  }
  if (err instanceof PolicyRepositoryError) {
    return APIError.invalidArgument(err.message, err)
  }
  if (err instanceof DatabaseError) {
    return APIError.internal(err.message, new Error(err.message))
  }
  return APIError.internal("Unexpected error", err as Error)
}

/** Runs a policy Effect and converts errors into API errors. */
const runApi = async <A, R>(
  effect: Effect.Effect<A, PolicyLogicError, R>
) => {
  try {
    return await runPolicyEffect(effect)
  } catch (err) {
    throw toApiError(err)
  }
}

/** Creates a new quoted policy. */
export const quote = api(
  { method: "POST", path: "/policies/quote", expose: true },
  async (params: {
    policyNumber: string
    holderName: string
    premiumCents: number
    effectiveDate: string
    endDate: string
  }) => {
    return await runApi(quotePolicy(params))
  }
)

/** Approves a policy after validation. */
export const approve = api(
  { method: "POST", path: "/policies/:id/approve", expose: true },
  async (params: { id: string; effectiveDate: string }) => {
    return await runApi(approvePolicy(params))
  }
)

/** Issues an approved policy as active or inactive. */
export const activate = api(
  { method: "POST", path: "/policies/:id/activate", expose: true },
  async (params: { id: string }) => {
    return await runApi(activatePolicy(params))
  }
)

/** Marks a policy inactive once coverage ends. */
export const deactivate = api(
  { method: "POST", path: "/policies/:id/deactivate", expose: true },
  async (params: { id: string }) => {
    return await runApi(deactivatePolicy(params))
  }
)

/** Declines a quoted policy. */
export const decline = api(
  { method: "POST", path: "/policies/:id/decline", expose: true },
  async (params: { id: string }) => {
    return await runApi(declinePolicy(params))
  }
)

/** Returns a policy by id. */
export const getById = api(
  { method: "GET", path: "/policies/:id", expose: true },
  async (params: { id: string }) => {
    return await runApi(getPolicy(params))
  }
)

/** Lists all policies for the dashboard. */
export const list = api<void, ListPoliciesResponse>(
  { method: "GET", path: "/policies", expose: true },
  async () => {
    const policies = await runApi(listPolicies())
    const list = Array.from(policies)
    console.log(`list policies: ${list.length}`)
    return { policies: list }
  }
)

/** Expires eligible policies via a private endpoint. */
export const expire = api(
  { method: "POST", path: "/policies/expire", expose: false },
  async () => {
    return await runApi(expirePolicies())
  }
)

/** Daily job that marks expired policies inactive at 00:00 UTC. */
new CronJob("policy-expire", {
  title: "Expire policies",
  schedule: "0 0 * * *",
  endpoint: expire
})
