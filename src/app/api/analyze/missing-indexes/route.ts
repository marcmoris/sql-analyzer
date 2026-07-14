import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const db = new URL(req.url).searchParams.get('database') || null;
  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      database_name: string; table_name: string;
      equality_columns: string | null; inequality_columns: string | null; included_columns: string | null;
      unique_compiles: number; user_seeks: number; user_scans: number;
      avg_total_user_cost: number; avg_user_impact: number; score: number;
    }>(`
      SELECT TOP 30
        DB_NAME(d.database_id)         AS database_name,
        d.statement                    AS table_name,
        d.equality_columns,
        d.inequality_columns,
        d.included_columns,
        s.unique_compiles,
        s.user_seeks,
        s.user_scans,
        ROUND(s.avg_total_user_cost, 2)  AS avg_total_user_cost,
        ROUND(s.avg_user_impact, 1)      AS avg_user_impact,
        ROUND(s.avg_total_user_cost * s.avg_user_impact * (s.user_seeks + s.user_scans), 0) AS score
      FROM sys.dm_db_missing_index_group_stats  s
      JOIN sys.dm_db_missing_index_groups       g ON s.group_handle = g.index_group_handle
      JOIN sys.dm_db_missing_index_details      d ON g.index_handle  = d.index_handle
      ${db ? `WHERE DB_NAME(d.database_id) = '${db.replace(/'/g, "''")}'` : ''}
      ORDER BY score DESC
    `);

    const data = res.recordset.map(r => {
      const cols: string[] = [];
      if (r.equality_columns)   cols.push(...r.equality_columns.split(',').map(c => c.trim()));
      if (r.inequality_columns) cols.push(...r.inequality_columns.split(',').map(c => c.trim()));

      const table = r.table_name?.replace(/\[|\]/g, '').split('.').pop() ?? 'Unknown';
      const colList = cols.map(c => `[${c.replace(/\[|\]/g, '')}]`).join(', ');
      const include = r.included_columns
        ? `\nINCLUDE (${r.included_columns.split(',').map(c => `[${c.trim().replace(/\[|\]/g, '')}]`).join(', ')})`
        : '';

      const script = `CREATE NONCLUSTERED INDEX [IX_${table}_Missing_${Date.now()}]
ON ${r.table_name} (${colList})${include};`;

      return { ...r, script };
    });

    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
