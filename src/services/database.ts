import { Context, Effect } from "effect"

/** Minimal database interface exposed through Effect. */
export interface DatabaseService {
  readonly query: <A>(
    sql: string,
    params?: ReadonlyArray<unknown>
  ) => Effect.Effect<ReadonlyArray<A>, DatabaseError>
}

/** Effect context tag for the live database implementation. */
export class Database extends Context.Tag("Database")<
  Database,
  DatabaseService
>() { }

/** Error shape returned for database failures. */
export class DatabaseError {
  readonly _tag = "DatabaseError"
  constructor(
    readonly message: string,
    readonly durationMs: number
  ) { }
}

/** Convenience helper to run a query through the Database tag. */
export const query = <A>(
  sql: string,
  params?: ReadonlyArray<unknown>
) =>
  Effect.flatMap(Database, (db) => db.query<A>(sql, params))
