/** Policy record stored in the database and returned by the API. */
export interface Policy {
  readonly id: string
  readonly policyNumber: string
  readonly holderName: string
  readonly status: "quoted" | "approved" | "active" | "inactive" | "declined"
  readonly premiumCents: number
  readonly effectiveDate: string
  readonly endDate: string
  readonly issuedAt: string | null
  readonly createdAt: string
}

/** Payload used to create a policy before id/createdAt exist. */
export type NewPolicy = Omit<Policy, "id" | "createdAt">
