import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { rawQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Only the user whose name is "cshen" may access this endpoint. */
async function authorize(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null
  const user = await getUserById(userId)
  if (!user || user.name !== "cshen") return null
  return user
}

export async function GET(req: Request) {
  try {
    const user = await authorize(req)
    if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const action = searchParams.get("action") ?? "list_tables"

    if (action === "list_tables") {
      const rows = await rawQuery(`
        SELECT
          t.table_name,
          t.table_type,
          COALESCE(s.n_live_tup, 0)::text AS row_estimate
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name
      `)
      return NextResponse.json({ ok: true, tables: rows.rows })
    }

    if (action === "describe_table") {
      const table = searchParams.get("table") ?? ""
      if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        return NextResponse.json({ error: "无效的表名" }, { status: 400 })
      }
      const cols = await rawQuery(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table])
      const indexes = await rawQuery(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname
      `, [table])
      return NextResponse.json({ ok: true, columns: cols.rows, indexes: indexes.rows })
    }

    if (action === "preview") {
      const table = searchParams.get("table") ?? ""
      const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 1000)
      const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0)
      if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        return NextResponse.json({ error: "无效的表名" }, { status: 400 })
      }
      const countRes = await rawQuery(`SELECT COUNT(*) AS count FROM "${table}"`)
      const total = parseInt(countRes.rows[0]?.count ?? "0", 10)
      const rows = await rawQuery(`SELECT * FROM "${table}" LIMIT $1 OFFSET $2`, [limit, offset])
      return NextResponse.json({ ok: true, rows: rows.rows, columns: rows.fields.map(f => f.name), total })
    }

    if (action === "export_table") {
      const table = searchParams.get("table") ?? ""
      if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        return NextResponse.json({ error: "无效的表名" }, { status: 400 })
      }
      const result = await rawQuery(`SELECT * FROM "${table}"`)
      const cols = result.fields.map((f: { name: string }) => f.name)
      const escapeCsv = (v: unknown) => {
        const s = v == null ? "" : String(v)
        if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return `"${s.replace(/"/g, '""')}"`
        }
        return s
      }
      const lines: string[] = [
        cols.map(escapeCsv).join(","),
        ...result.rows.map((r: Record<string, unknown>) => cols.map((c: string) => escapeCsv(r[c])).join(",")),
      ]
      // UTF-8 BOM (\uFEFF) ensures Excel on Windows opens Chinese correctly
      const csv = "\uFEFF" + lines.join("\r\n")
      const filename = encodeURIComponent(`${table}_full.csv`)
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        },
      })
    }

    return NextResponse.json({ error: "未知 action" }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await authorize(req)
    if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const sql: string = String(body?.sql ?? "").trim()
    if (!sql) return NextResponse.json({ error: "SQL 不能为空" }, { status: 400 })

    const start = Date.now()
    const result = await rawQuery(sql)
    const elapsed = Date.now() - start

    return NextResponse.json({
      ok: true,
      rows: result.rows,
      columns: result.fields?.map((f: { name: string }) => f.name) ?? [],
      rowCount: result.rowCount ?? result.rows.length,
      elapsed,
      command: result.command,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "查询错误" }, { status: 200 })
  }
}
