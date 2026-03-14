import { Context, Effect } from "effect"
import { Database, DatabaseError, type DatabaseService } from "../services/database.ts"
import type { NewPolicy, Policy } from "../models/policy.ts"
import {
  BaseRepository,
  type BaseRepositoryErrors,
  type ColumnMap
} from "./base_repository.ts"

/** Repository-specific errors for policy persistence. */
export class PolicyRepositoryError extends Error {
  readonly _tag = "PolicyRepositoryError"
  constructor(readonly message: string) {
    super(message)
  }
}

/** Effect-based interface for policy persistence operations. */
export interface PolicyRepositoryService {
  readonly create: (
    input: NewPolicy
  ) => Effect.Effect<Policy, DatabaseError | PolicyRepositoryError>
  readonly update: (
    id: string,
    patch: PolicyUpdate
  ) => Effect.Effect<Policy, DatabaseError | PolicyRepositoryError>
  readonly findById: (
    id: string
  ) => Effect.Effect<Policy | null, DatabaseError>
  readonly delete: (
    id: string
  ) => Effect.Effect<void, DatabaseError | PolicyRepositoryError>
  readonly findByPolicyNumber: (
    policyNumber: string
  ) => Effect.Effect<Policy | null, DatabaseError>
  readonly list: () => Effect.Effect<ReadonlyArray<Policy>, DatabaseError>
  readonly listActiveEndingOnOrBefore: (
    date: string
  ) => Effect.Effect<ReadonlyArray<Policy>, DatabaseError>
}

export class PolicyRepositoryTag extends Context.Tag("PolicyRepository")<
  PolicyRepositoryTag,
  PolicyRepositoryService
>() {}

/** Patch shape for policy updates. */
export type PolicyUpdate = Partial<
  Pick<
    NewPolicy,
    | "policyNumber"
    | "holderName"
    | "status"
    | "premiumCents"
    | "effectiveDate"
    | "endDate"
    | "issuedAt"
  >
>

const policyCreateColumns = {
  policyNumber: "policy_number",
  holderName: "holder_name",
  status: "status",
  premiumCents: "premium_cents",
  effectiveDate: "effective_date",
  endDate: "end_date",
  issuedAt: "issued_at"
} satisfies ColumnMap<NewPolicy>

const policyUpdateColumns = {
  policyNumber: "policy_number",
  holderName: "holder_name",
  status: "status",
  premiumCents: "premium_cents",
  effectiveDate: "effective_date",
  endDate: "end_date",
  issuedAt: "issued_at"
} satisfies ColumnMap<PolicyUpdate>

const policyErrors: BaseRepositoryErrors<PolicyRepositoryError> = {
  insertNoRows: () =>
    new PolicyRepositoryError("Policy insert returned no rows"),
  notFound: () => new PolicyRepositoryError("Policy not found"),
  updateNoFields: () =>
    new PolicyRepositoryError("Update requires at least one field")
}

/** Repository backed by the policies table. */
class PolicyRepository extends BaseRepository<
  string,
  Policy,
  NewPolicy,
  PolicyUpdate,
  PolicyRepositoryError
> implements PolicyRepositoryService {
  /** Normalizes date-like values to YYYY-MM-DD. */
  private readonly toDateOnly = (value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10)
    }
    if (typeof value === "string") {
      return value
    }
    return String(value)
  }

  /** Normalizes timestamps to ISO strings. */
  private readonly toDateTime = (value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (typeof value === "string") {
      return value
    }
    return String(value)
  }

  /** Normalizes timestamps that can be nullable. */
  private readonly toNullableDateTime = (value: unknown) => {
    if (value === null || value === undefined) {
      return null
    }
    return this.toDateTime(value)
  }

  constructor(db: DatabaseService) {
    super(
      db,
      "policies",
      "id",
      (row: any): Policy => ({
        id: String(row.id),
        policyNumber: String(row.policy_number),
        holderName: String(row.holder_name),
        status: row.status as Policy["status"],
        premiumCents: Number(row.premium_cents),
        effectiveDate: this.toDateOnly(row.effective_date),
        endDate: this.toDateOnly(row.end_date),
        issuedAt: this.toNullableDateTime(row.issued_at),
        createdAt: this.toDateTime(row.created_at)
      }),
      policyCreateColumns,
      policyUpdateColumns,
      policyErrors
    )
  }

  /** Finds a policy by its policy number. */
  findByPolicyNumber(
    policyNumber: string
  ): Effect.Effect<Policy | null, DatabaseError> {
    return this.db
      .query<Policy>(
        `
        select * from policies where policy_number = $1 limit 1
        `,
        [policyNumber]
      )
      .pipe(Effect.map((rows) => (rows[0] ? this.toEntity(rows[0]) : null)))
  }

  /** Lists all policies ordered by creation time. */
  list(): Effect.Effect<ReadonlyArray<Policy>, DatabaseError> {
    return this.db
      .query<Policy>(
        `
        select * from policies order by created_at desc
        `
      )
      .pipe(Effect.map((rows) => rows.map(this.toEntity)))
  }

  /** Lists active policies with end dates on or before the given date. */
  listActiveEndingOnOrBefore(
    date: string
  ): Effect.Effect<ReadonlyArray<Policy>, DatabaseError> {
    return this.db
      .query<Policy>(
        `
        select * from policies
        where status = 'active' and end_date <= $1
        order by end_date asc
        `,
        [date]
      )
      .pipe(Effect.map((rows) => rows.map(this.toEntity)))
  }
}

/** Live repository implementation wired to the Database service. */
export const PolicyRepositoryLive = Effect.gen(function* () {
  const db = yield* Database
  return new PolicyRepository(db)
})
