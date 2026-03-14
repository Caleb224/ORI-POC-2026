import { Layer } from "effect"
import { PolicyRepositoryTag, PolicyRepositoryLive } from "../repositories/policy_repository.ts"

/** Live repository layer for policy persistence. */
export const PolicyRepositoryLayer = Layer.effect(
  PolicyRepositoryTag,
  PolicyRepositoryLive
)
