import { Effect } from "effect"
import type { DatabaseError, DatabaseService } from "../services/database.ts"

/** Mapping from entity fields to database column names. */
export type ColumnMap<T> = {
  readonly [K in keyof T]: string
}

/** Error constructors required by the base repository. */
export type BaseRepositoryErrors<E> = {
  readonly insertNoRows: () => E
  readonly notFound: () => E
  readonly updateNoFields: () => E
}

/** Builds a parameterized insert query from input and column mapping. */
export const buildInsertQuery = <T extends Record<string, unknown>>(
  table: string,
  input: T,
  columns: ColumnMap<T>
) => {
  const keys = Object.keys(columns) as ReadonlyArray<keyof T>
  const colNames = keys.map((key) => columns[key])
  const values = keys.map((key) => input[key])
  const placeholders = keys.map((_, index) => `$${index + 1}`)

  const text = `
    insert into ${table} (${colNames.join(", ")})
    values (${placeholders.join(", ")})
    returning *
  `

  return { text, values }
}

/** Builds a parameterized update query from a patch object. */
export const buildUpdateQuery = <T extends Record<string, unknown>>(
  table: string,
  idColumn: string,
  id: string,
  patch: Partial<T>,
  columns: ColumnMap<T>
) => {
  const keys = (Object.keys(patch) as ReadonlyArray<keyof T>).filter(
    (key) => patch[key] !== undefined
  )
  if (keys.length === 0) {
    return null
  }

  const setClauses: string[] = []
  const values: unknown[] = []

  keys.forEach((key, index) => {
    setClauses.push(`${columns[key]} = $${index + 1}`)
    values.push(patch[key])
  })

  values.push(id)

  const text = `
    update ${table}
    set ${setClauses.join(", ")}
    where ${idColumn} = $${values.length}
    returning *
  `

  return { text, values }
}

/** Generic repository with create, update, read, and delete helpers. */
export class BaseRepository<
  Id,
  Entity,
  Create extends Record<string, unknown>,
  Update extends Record<string, unknown>,
  E extends Error
> {
  constructor(
    protected readonly db: DatabaseService,
    protected readonly table: string,
    protected readonly idColumn: string,
    protected readonly toEntity: (row: any) => Entity,
    protected readonly createColumns: ColumnMap<Create>,
    protected readonly updateColumns: ColumnMap<Update>,
    protected readonly errors: BaseRepositoryErrors<E>
  ) {}

  /** Inserts a record and returns the mapped entity. */
  create(input: Create): Effect.Effect<Entity, DatabaseError | E> {
    const query = buildInsertQuery(this.table, input, this.createColumns)
    return this.db.query<Entity>(query.text, query.values).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(this.toEntity(rows[0]))
          : Effect.fail(this.errors.insertNoRows())
      )
    )
  }

  /** Updates a record by id and returns the mapped entity. */
  update(
    id: Id,
    patch: Partial<Update>
  ): Effect.Effect<Entity, DatabaseError | E> {
    const query = buildUpdateQuery(
      this.table,
      this.idColumn,
      String(id),
      patch,
      this.updateColumns
    )
    if (!query) {
      return Effect.fail(this.errors.updateNoFields())
    }
    return this.db.query<Entity>(query.text, query.values).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(this.toEntity(rows[0]))
          : Effect.fail(this.errors.notFound())
      )
    )
  }

  /** Loads a record by id or returns null. */
  findById(id: Id): Effect.Effect<Entity | null, DatabaseError> {
    return this.db
      .query<Entity>(
        `
        select * from ${this.table} where ${this.idColumn} = $1 limit 1
        `,
        [id]
      )
      .pipe(Effect.map((rows) => (rows[0] ? this.toEntity(rows[0]) : null)))
  }

  /** Deletes a record by id, failing if not found. */
  delete(id: Id): Effect.Effect<void, DatabaseError | E> {
    return this.db
      .query<Entity>(
        `
        delete from ${this.table} where ${this.idColumn} = $1 returning *
        `,
        [id]
      )
      .pipe(
        Effect.flatMap((rows) =>
          rows[0]
            ? Effect.succeed(undefined)
            : Effect.fail(this.errors.notFound())
        )
      )
  }
}
