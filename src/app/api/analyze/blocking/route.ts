import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const db = new URL(req.url).searchParams.get('database') || null;
  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      session_id: number; blocking_session_id: number; wait_type: string | null;
      wait_time_ms: number; status: string; command: string;
      database_name: string; login_name: string; host_name: string; program_name: string;
      query_text: string | null; open_transaction_count: number;
    }>(`
      SELECT
        r.session_id,
        r.blocking_session_id,
        r.wait_type,
        r.wait_time                                    AS wait_time_ms,
        r.status,
        r.command,
        DB_NAME(r.database_id)                         AS database_name,
        s.login_name,
        s.host_name,
        s.program_name,
        SUBSTRING(st.text, (r.statement_start_offset/2)+1,
          (CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
           ELSE r.statement_end_offset END - r.statement_start_offset)/2+1) AS query_text,
        s.open_transaction_count
      FROM sys.dm_exec_requests r
      JOIN sys.dm_exec_sessions  s ON s.session_id = r.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
      WHERE r.session_id > 50
        AND r.session_id <> @@SPID
        ${db ? `AND DB_NAME(r.database_id) = '${db.replace(/'/g, "''")}'` : ''}
      ORDER BY r.blocking_session_id DESC, r.wait_time DESC
    `);

    const blocked = res.recordset.filter(r => r.blocking_session_id > 0);
    const active  = res.recordset.length;

    return NextResponse.json({ success: true, data: res.recordset, blocked: blocked.length, active });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
