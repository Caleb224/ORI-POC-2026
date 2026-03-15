import { randomUUID } from "node:crypto"
import { Effect, Layer } from "effect"
import { Database, type DatabaseService } from "../../src/services/database.ts"

export type MockPolicyRow = {
  id: string
  policy_number: string
  holder_name: string
  status: string
  premium_cents: number
  effective_date: string
  end_date: string
  issued_at: string | null
  created_at: string
}

const normalizeSql = (sql: string) =>
  sql.replace(/\s+/g, " ").trim().toLowerCase()

const parseColumns = (sql: string) => {
  const match = sql.match(/insert into policies\s*\(([^)]+)\)/i)
  const columns = match?.[1]
  if (!columns) return []
  return columns.split(",").map((col) => col.trim())
}

const parseSetColumns = (sql: string) => {
  const match = sql.match(/set\s+([\s\S]+?)\s+where/i)
  const columns = match?.[1]
  if (!columns) return []
  return columns
    .split(",")
    .map((clause) => (clause.split("=")[0] ?? "").trim())
}

export const createMockDatabase = (seed: MockPolicyRow[] = []) => {
  const rows = seed.map((row) => ({ ...row }))

  const query = <A>(sql: string, params: ReadonlyArray<unknown> = []) =>
    Effect.sync(() => {
      const normalized = normalizeSql(sql)

      if (normalized.startsWith("insert into policies")) {
        const columns = parseColumns(sql)
        const row: MockPolicyRow = {
          id: randomUUID(),
          policy_number: "",
          holder_name: "",
          status: "",
          premium_cents: 0,
          effective_date: "",
          end_date: "",
          issued_at: null,
          created_at: new Date().toISOString()
        }
        columns.forEach((column, index) => {
          ; (row as Record<string, unknown>)[column] = params[index]
        })
        rows.push(row)
        return [row] as unknown as ReadonlyArray<A>
      }

      if (normalized.startsWith("update policies")) {
        const setColumns = parseSetColumns(sql)
        const id = String(params[setColumns.length])
        const row = rows.find((item) => item.id === id)
        if (!row) return [] as unknown as ReadonlyArray<A>
        setColumns.forEach((column, index) => {
          ; (row as Record<string, unknown>)[column] = params[index]
        })
        return [row] as unknown as ReadonlyArray<A>
      }

      if (
        normalized.startsWith("select * from policies where id")
      ) {
        const id = String(params[0])
        const row = rows.find((item) => item.id === id)
        return row
          ? ([row] as unknown as ReadonlyArray<A>)
          : ([] as unknown as ReadonlyArray<A>)
      }

      if (
        normalized.startsWith("select * from policies where policy_number")
      ) {
        const policyNumber = String(params[0])
        const row = rows.find((item) => item.policy_number === policyNumber)
        return row
          ? ([row] as unknown as ReadonlyArray<A>)
          : ([] as unknown as ReadonlyArray<A>)
      }

      if (
        normalized.includes(
          "where status = 'active' and end_date <= $1"
        )
      ) {
        const endDate = String(params[0])
        const filtered = rows
          .filter(
            (row) =>
              row.status === "active" && row.end_date <= endDate
          )
          .sort((a, b) => a.end_date.localeCompare(b.end_date))
        return filtered as unknown as ReadonlyArray<A>
      }

      if (
        normalized.startsWith("select * from policies order by created_at")
      ) {
        const sorted = [...rows].sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        )
        return sorted as unknown as ReadonlyArray<A>
      }

      if (normalized.startsWith("delete from policies")) {
        const id = String(params[0])
        const index = rows.findIndex((item) => item.id === id)
        if (index === -1) return [] as unknown as ReadonlyArray<A>
        const deleted = rows.splice(index, 1)[0]
        if (!deleted) return [] as unknown as ReadonlyArray<A>
        return [deleted] as unknown as ReadonlyArray<A>
      }

      throw new Error(`Unhandled SQL: ${sql}`)
    })

  const db: DatabaseService = { query }

  return { db, rows }
}

export const createMockDatabaseLayer = (
  seed: MockPolicyRow[] = []
) => {
  const { db, rows } = createMockDatabase(seed)
  return {
    rows,
    layer: Layer.succeed(Database, db)
  }
}
