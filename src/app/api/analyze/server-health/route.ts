import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET() {
  try {
    const pool = await getPool();

    const [verRes, memRes, cpuRes, connRes, dbRes, uptimeRes] = await Promise.all([
      pool.request().query<{ version: string; edition: string; level: string }>(`
        SELECT
          SERVERPROPERTY('ProductVersion')  AS version,
          SERVERPROPERTY('Edition')         AS edition,
          SERVERPROPERTY('ProductLevel')    AS level
      `),
      pool.request().query<{ totalMb: number; availMb: number; inUseMb: number }>(`
        SELECT
          total_physical_memory_kb / 1024           AS totalMb,
          available_physical_memory_kb / 1024       AS availMb,
          (total_physical_memory_kb - available_physical_memory_kb) / 1024 AS inUseMb
        FROM sys.dm_os_sys_memory
      `),
      pool.request().query<{ cpuCount: number; schedulerCount: number }>(`
        SELECT
          cpu_count                                       AS cpuCount,
          scheduler_count                                 AS schedulerCount
        FROM sys.dm_os_sys_info
      `),
      pool.request().query<{ activeConnections: number }>(`
        SELECT COUNT(*) AS activeConnections
        FROM sys.dm_exec_sessions
        WHERE is_user_process = 1
      `),
      pool.request().query<{ name: string; state: string; sizeGb: number }>(`
        SELECT
          d.name,
          d.state_desc  AS state,
          ROUND(SUM(mf.size * 8.0 / 1024 / 1024), 2) AS sizeGb
        FROM sys.databases d
        JOIN sys.master_files mf ON mf.database_id = d.database_id
        GROUP BY d.name, d.state_desc
        ORDER BY sizeGb DESC
      `),
      pool.request().query<{ uptimeHours: number }>(`
        SELECT DATEDIFF(HOUR, sqlserver_start_time, GETDATE()) AS uptimeHours
        FROM sys.dm_os_sys_info
      `),
    ]);

    const mem = memRes.recordset[0];
    const memPct = mem ? Math.round((mem.inUseMb / mem.totalMb) * 100) : 0;

    return NextResponse.json({
      success: true,
      version:     verRes.recordset[0]?.version,
      edition:     verRes.recordset[0]?.edition,
      level:       verRes.recordset[0]?.level,
      cpuCount:    cpuRes.recordset[0]?.cpuCount,
      schedulers:  cpuRes.recordset[0]?.schedulerCount,
      memTotal:    mem?.totalMb,
      memAvail:    mem?.availMb,
      memInUse:    mem?.inUseMb,
      memPct,
      activeConnections: connRes.recordset[0]?.activeConnections,
      uptimeHours: uptimeRes.recordset[0]?.uptimeHours,
      databases:   dbRes.recordset,
    });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
