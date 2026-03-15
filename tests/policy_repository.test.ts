import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { Effect, Layer, Either } from "effect"
import { PolicyRepositoryLayer } from "../src/layers/policy_repository_layer.ts"
import {
  PolicyRepositoryError,
  PolicyRepositoryTag
} from "../src/repositories/policy_repository.ts"
import {
  createMockDatabaseLayer,
  type MockPolicyRow
} from "./helpers/mock_db.ts"
import type { NewPolicy } from "../src/models/policy.ts"

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
    Effect.runPromise(Effect.provide(Effect.either(effect), testLayer))
}

describe("policy repository", () => {
  it("creates policies and maps fields", async () => {
    const run = runWithSeed([])
    const input: NewPolicy = {
      policyNumber: "POL-CREATE-001",
      holderName: "Create Holder",
      status: "quoted",
      premiumCents: 99900,
      effectiveDate: "2026-05-01",
      endDate: "2027-05-01",
      issuedAt: null
    }
    const result = await run(
      Effect.flatMap(PolicyRepositoryTag, (repo) => repo.create(input))
    )
    expect(result.id).toBeTruthy()
    expect(result.createdAt).toBeTruthy()
    expect(result.issuedAt).toBeNull()
  })

  it("rejects empty updates", async () => {
    const row = makeRow()
    const runEither = runEitherWithSeed([row])
    const result = await runEither(
      Effect.flatMap(PolicyRepositoryTag, (repo) => repo.update(row.id, {}))
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PolicyRepositoryError)
    }
  })

  it("filters active policies by end date", async () => {
    const rowA = makeRow({
      status: "active",
      end_date: "2026-01-01",
      policy_number: "POL-ACTIVE-1"
    })
    const rowB = makeRow({
      status: "active",
      end_date: "2028-01-01",
      policy_number: "POL-ACTIVE-2"
    })
    const run = runWithSeed([rowA, rowB])
    const result = await run(
      Effect.flatMap(PolicyRepositoryTag, (repo) =>
        repo.listActiveEndingOnOrBefore("2026-12-31")
      )
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.policyNumber).toBe("POL-ACTIVE-1")
  })
})
