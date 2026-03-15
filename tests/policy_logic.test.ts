import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { Effect, Layer, Either } from "effect"
import { PolicyRepositoryLayer } from "../src/layers/policy_repository_layer.ts"
import type { PolicyRepositoryTag } from "../src/repositories/policy_repository.ts"
import {
  approvePolicy,
  activatePolicy,
  deactivatePolicy,
  declinePolicy,
  expirePolicies,
  quotePolicy,
  PolicyWorkflowError,
  PolicyValidationError
} from "../src/logic/policy_logic.ts"
import {
  createMockDatabaseLayer,
  type MockPolicyRow
} from "./helpers/mock_db.ts"

const makeRow = (
  overrides: Partial<MockPolicyRow> = {}
): MockPolicyRow => {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    policy_number: "POL-TEST-001",
    holder_name: "Test Holder",
    status: "quoted",
    premium_cents: 125000,
    effective_date: "2026-01-01",
    end_date: "2027-01-01",
    issued_at: null,
    created_at: now,
    ...overrides
  }
}

const runWithSeed = (seed: MockPolicyRow[]) => {
  const { layer } = createMockDatabaseLayer(seed)
  const testLayer = PolicyRepositoryLayer.pipe(Layer.provide(layer))
  return <A, E>(effect: Effect.Effect<A, E, PolicyRepositoryTag>) =>
    Effect.runPromise(Effect.provide(effect, testLayer))
}

const runEitherWithSeed = (seed: MockPolicyRow[]) => {
  const { layer } = createMockDatabaseLayer(seed)
  const testLayer = PolicyRepositoryLayer.pipe(Layer.provide(layer))
  return <A, E>(effect: Effect.Effect<A, E, PolicyRepositoryTag>) =>
    Effect.runPromise(
      Effect.provide(Effect.either(effect), testLayer)
    )
}

describe("policy workflow logic", () => {
  it("approves a quoted policy", async () => {
    const row = makeRow({ status: "quoted" })
    const run = runWithSeed([row])
    const result = await run(
      approvePolicy({ id: row.id, effectiveDate: row.effective_date })
    )
    expect(result.status).toBe("approved")
  })

  it("declines a quoted policy", async () => {
    const row = makeRow({ status: "quoted" })
    const run = runWithSeed([row])
    const result = await run(declinePolicy({ id: row.id }))
    expect(result.status).toBe("declined")
  })

  it("issues active when coverage is in force", async () => {
    const row = makeRow({ status: "approved", end_date: "2027-01-01" })
    const run = runWithSeed([row])
    const result = await run(activatePolicy({ id: row.id }))
    expect(result.status).toBe("active")
    expect(result.issuedAt).toBeTruthy()
  })

  it("issues inactive when coverage already ended", async () => {
    const row = makeRow({ status: "approved", end_date: "2000-01-01" })
    const run = runWithSeed([row])
    const result = await run(activatePolicy({ id: row.id }))
    expect(result.status).toBe("inactive")
    expect(result.issuedAt).toBeTruthy()
  })

  it("deactivates an active policy after end date", async () => {
    const row = makeRow({ status: "active", end_date: "2000-01-01" })
    const run = runWithSeed([row])
    const result = await run(deactivatePolicy({ id: row.id }))
    expect(result.status).toBe("inactive")
  })

  it("fails to deactivate before end date", async () => {
    const row = makeRow({ status: "active", end_date: "2099-01-01" })
    const runEither = runEitherWithSeed([row])
    const result = await runEither(deactivatePolicy({ id: row.id }))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PolicyWorkflowError)
    }
  })

  it("expires policies in the daily sweep", async () => {
    const row = makeRow({
      status: "active",
      end_date: "2000-01-01",
      policy_number: "POL-EXPIRE-001"
    })
    const run = runWithSeed([row])
    const result = await run(expirePolicies({ today: "2001-01-01" }))
    expect(result.expired).toBe(1)
    expect(result.failed).toBe(0)
  })
})

describe("policy validation logic", () => {
  it("rejects invalid policy ids", async () => {
    const runEither = runEitherWithSeed([])
    const result = await runEither(
      approvePolicy({ id: "bad-id", effectiveDate: "2026-01-01" })
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PolicyValidationError)
    }
  })

  it("rejects end dates before effective dates", async () => {
    const runEither = runEitherWithSeed([])
    const result = await runEither(
      quotePolicy({
        policyNumber: "POL-INVALID",
        holderName: "Test Holder",
        premiumCents: 100,
        effectiveDate: "2026-02-01",
        endDate: "2026-01-01"
      })
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PolicyWorkflowError)
    }
  })
})
