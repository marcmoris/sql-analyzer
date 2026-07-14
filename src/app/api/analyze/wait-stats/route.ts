import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Wait types that are benign (background noise) — excluded from analysis
const BENIGN_WAITS = new Set([
  'SLEEP_TASK','SLEEP_SYSTEMTASK','SLEEP_DBSTARTUP','SLEEP_DBTASK','SLEEP_TEMPDBSTARTUP',
  'SNI_HTTP_ACCEPT','REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE','SERVER_IDLE_CHECK',
  'SQL_TRACE_QUEUE_INSERT','SQLTRACE_BUFFER_FLUSH','SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
  'WAITFOR','LAZYWRITER_SLEEP','CHECKPOINT_QUEUE','DISPATCHER_QUEUE_SEMAPHORE',
  'BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_AUTO_EVENT','CLR_MANUAL_EVENT',
  'DBMIRROR_EVENTS_QUEUE','SQLTRACE_WAIT_ENTRIES','FT_IFTS_SCHEDULER_IDLE_WAIT',
  'XE_DISPATCHER_WAIT','XE_TIMER_EVENT','BROKER_EVENTHANDLER','ONDEMAND_TASK_QUEUE',
  'BAD_PAGE_PROCESS','DBMIRROR_WORKER_QUEUE','HADR_WORK_QUEUE','HADR_FILESTREAM_IOMGR_IOCOMPLETION',
  'SP_SERVER_DIAGNOSTICS_SLEEP','SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED',
  'SLEEP_MASTERDBREADY','SLEEP_TEMPDBSTARTUP',
]);

function categorize(waitType: string): string {
  if (waitType.startsWith('LCK_')) return 'Lock';
  if (waitType.startsWith('PAGEIOLATCH_') || waitType.startsWith('IO_') || waitType === 'ASYNC_IO_COMPLETION') return 'I/O';
  if (waitType.startsWith('SOS_SCHEDULER') || waitType === 'CXPACKET' || waitType === 'CXCONSUMER' || waitType === 'THREADPOOL') return 'CPU';
  if (waitType.startsWith('RESOURCE_SEMAPHORE') || waitType.startsWith('MEMORY')) return 'Memory';
  if (waitType.startsWith('NETWORK_IO') || waitType === 'ASYNC_NETWORK_IO') return 'Network';
  if (waitType.startsWith('HADR_') || waitType.startsWith('DBM')) return 'HA/DR';
  return 'Other';
}

export async function GET() {
  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      wait_type: string; wait_s: number; resource_s: number; signal_s: number; pct: number;
    }>(`
      WITH waits AS (
        SELECT
          wait_type,
          wait_time_ms / 1000.0                         AS wait_s,
          (wait_time_ms - signal_wait_time_ms) / 1000.0 AS resource_s,
          signal_wait_time_ms / 1000.0                  AS signal_s,
          waiting_tasks_count
        FROM sys.dm_os_wait_stats
        WHERE wait_type NOT LIKE 'SLEEP_%'
          AND wait_type NOT LIKE 'SQLTRACE_%'
          AND wait_type NOT LIKE 'XE_%'
          AND wait_type NOT LIKE 'BROKER_%'
          AND wait_type NOT LIKE 'HADR_%'
          AND wait_type NOT IN (
            'DISPATCHER_QUEUE_SEMAPHORE','REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE',
            'SERVER_IDLE_CHECK','LAZYWRITER_SLEEP','CHECKPOINT_QUEUE','WAITFOR',
            'ONDEMAND_TASK_QUEUE','FT_IFTS_SCHEDULER_IDLE_WAIT','BAD_PAGE_PROCESS',
            'CLR_AUTO_EVENT','CLR_MANUAL_EVENT'
          )
          AND wait_time_ms > 0
      ),
      total AS (SELECT SUM(wait_s) AS tot FROM waits)
      SELECT TOP 20
        w.wait_type,
        ROUND(w.wait_s, 2)      AS wait_s,
        ROUND(w.resource_s, 2)  AS resource_s,
        ROUND(w.signal_s, 2)    AS signal_s,
        ROUND(w.wait_s * 100.0 / NULLIF(t.tot, 0), 1) AS pct
      FROM waits w, total t
      ORDER BY w.wait_s DESC
    `);

    const rows = res.recordset.filter(r => !BENIGN_WAITS.has(r.wait_type));

    const data = rows.map(r => ({ ...r, category: categorize(r.wait_type) }));

    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
