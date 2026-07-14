import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const sort   = params.get('sort')     || 'cpu';
  const db     = params.get('database') || null;

  const orderBy = sort === 'reads'    ? 'qs.total_logical_reads DESC'
                : sort === 'duration' ? 'qs.total_elapsed_time DESC'
                : sort === 'exec'     ? 'qs.execution_count DESC'
                : 'qs.total_worker_time DESC';

  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      query_text: string; execution_count: number;
      total_cpu_ms: number; avg_cpu_ms: number;
      total_reads: number; avg_reads: number;
      total_duration_ms: number; avg_duration_ms: number;
      total_writes: number;
      created_at: Date; last_execution: Date;
      plan_count: number;
    }>(`
      SELECT TOP 25
        SUBSTRING(
          st.text,
          (qs.statement_start_offset / 2) + 1,
          (CASE qs.statement_end_offset
             WHEN -1 THEN DATALENGTH(st.text)
             ELSE qs.statement_end_offset
           END - qs.statement_start_offset) / 2 + 1
        )                                                    AS query_text,
        qs.execution_count,
        ROUND(qs.total_worker_time   / 1000.0, 1)           AS total_cpu_ms,
        ROUND(qs.total_worker_time   / 1000.0 / NULLIF(qs.execution_count, 0), 1) AS avg_cpu_ms,
        qs.total_logical_reads                               AS total_reads,
        qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS avg_reads,
        ROUND(qs.total_elapsed_time  / 1000.0, 1)           AS total_duration_ms,
        ROUND(qs.total_elapsed_time  / 1000.0 / NULLIF(qs.execution_count, 0), 1) AS avg_duration_ms,
        qs.total_logical_writes                              AS total_writes,
        qs.creation_time                                     AS created_at,
        qs.last_execution_time                               AS last_execution,
        COUNT(*) OVER (PARTITION BY st.text)                AS plan_count
      FROM sys.dm_exec_query_stats qs
      CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
      WHERE st.text NOT LIKE '%sys.dm_%'
        AND st.text NOT LIKE '%INFORMATION_SCHEMA%'
        AND qs.execution_count > 0
        ${db ? `AND DB_NAME(st.dbid) = '${db.replace(/'/g, "''")}'` : ''}
      ORDER BY ${orderBy}
    `);

    return NextResponse.json({ success: true, data: res.recordset, sort });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
