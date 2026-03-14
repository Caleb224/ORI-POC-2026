import { Effect, Console, Layer } from "effect"
import { PolicyRepositoryTag } from "./repositories/policy_repository.ts"
import { DatabaseLive } from "./layers/database_layer.ts"
import { PolicyRepositoryLayer } from "./layers/policy_repository_layer.ts"

/** Simple CLI program to verify wiring and list policy count. */
const program = Effect.gen(function* () {
  const repo = yield* PolicyRepositoryTag
  const policies = yield* repo.list()
  yield* Console.log(`Policies: ${policies.length}`)
})

/** Application layer wiring for the CLI entrypoint. */
const AppLayer = PolicyRepositoryLayer.pipe(Layer.provide(DatabaseLive))

Effect.runSync(Effect.provide(program, AppLayer))
