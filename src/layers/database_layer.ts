import { Pool } from "pg"
import { Cause, Duration, Effect, Exit, Layer, Option, Data } from "effect"
import { Database, DatabaseError } from "../services/database.ts"

/** Internal error wrapper for database query failures. */
class QueryExecutionError extends Data.TaggedError("QueryExecutionError")<{
  readonly message: string
}> { }

/** Live Database layer backed by a Postgres connection pool. */
export const DatabaseLive = Layer.scoped(
  Database,
  Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      // Create the pool using the connection string from environment variables
      Effect.sync(() => new Pool({
        connectionString: process.env.DATABASE_URL
      })),
      // Release the resource by ending the pool
      (pool) => Effect.promise(() => pool.end())
    );

    return {
      query: <A>(sql: string, params?: ReadonlyArray<unknown>) =>
        Effect.exit(
          Effect.tryPromise({
            try: async () => {
              const result = await pool.query(sql, params as any[])
              return result.rows as unknown as ReadonlyArray<A>;
            },
            catch: (e: unknown) =>
              new QueryExecutionError({
                message: e instanceof Error ? e.message : "Unknown Database Error"
              })
          })
        ).pipe(
          Effect.timed,
          Effect.flatMap(([duration, exit]) =>
            Exit.matchEffect(exit, {
              onSuccess: (rows) => Effect.succeed(rows as ReadonlyArray<A>),
              onFailure: (cause) => {
                const failure = Cause.failureOption(cause).pipe(
                  Option.getOrElse(() => new Error("Unknown Database Error"))
                )
                const message =
                  failure instanceof QueryExecutionError ? failure.message : "Unknown Database Error"
                return Effect.fail(
                  new DatabaseError(message, Duration.toMillis(duration))
                )
              }
            })
          ),
          Effect.tapError((err) =>
            Effect.logError(
              `Database query failed: ${err.message} (durationMs=${err.durationMs}, sql=${sql}, params=${params?.length ?? 0})`
            )
          )
        )
    };
  })
);
