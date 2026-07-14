import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const dbFilter = new URL(req.url).searchParams.get('database') || null;

  try {
    const pool = await getPool();

    // Get list of online user databases to analyze
    const dbRes = await pool.request().query<{ name: string }>(`
      SELECT name FROM sys.databases
      WHERE state_desc = 'ONLINE'
        AND name NOT IN ('master','model','msdb','tempdb')
        ${dbFilter ? `AND name = '${dbFilter.replace(/'/g, "''")}'` : ''}
      ORDER BY name
    `);

    const results: {
      database_name: string; schema_name: string; table_name: string; index_name: string;
      avg_fragmentation_pct: number; page_count: number; index_type: string;
      recommendation: string; action_script: string;
    }[] = [];

    for (const db of dbRes.recordset) {
      try {
        const res = await pool.request().query<{
          schema_name: string; table_name: string; index_name: string;
          avg_fragmentation_pct: number; page_count: number; index_type: string;
        }>(`
          SELECT
            OBJECT_SCHEMA_NAME(ips.object_id, DB_ID('${db.name}')) AS schema_name,
            OBJECT_NAME(ips.object_id, DB_ID('${db.name}'))         AS table_name,
            ix.name                                                   AS index_name,
            ROUND(ips.avg_fragmentation_in_percent, 1)               AS avg_fragmentation_pct,
            ips.page_count,
            ips.index_type_desc                                       AS index_type
          FROM sys.dm_db_index_physical_stats(
            DB_ID('${db.name}'), NULL, NULL, NULL, 'DETAILED'
          ) ips
          JOIN [${db.name}].sys.indexes ix
            ON ix.object_id = ips.object_id AND ix.index_id = ips.index_id
          WHERE ips.index_id > 0
            AND ips.page_count > 100
            AND ips.avg_fragmentation_in_percent > 5
          ORDER BY ips.avg_fragmentation_in_percent DESC
        `);

        for (const r of res.recordset) {
          const frag = r.avg_fragmentation_pct;
          let recommendation = 'MONITOR';
          let action_script  = '';
          if (frag > 30) {
            recommendation = 'REBUILD';
            action_script  = `USE [${db.name}];\nALTER INDEX [${r.index_name}] ON [${r.schema_name}].[${r.table_name}] REBUILD WITH (ONLINE = ON);`;
          } else if (frag > 10) {
            recommendation = 'REORGANIZE';
            action_script  = `USE [${db.name}];\nALTER INDEX [${r.index_name}] ON [${r.schema_name}].[${r.table_name}] REORGANIZE;`;
          }
          results.push({ database_name: db.name, ...r, recommendation, action_script });
        }
      } catch { /* skip inaccessible DB */ }
    }

    results.sort((a, b) => b.avg_fragmentation_pct - a.avg_fragmentation_pct);

    return NextResponse.json({ success: true, data: results, databases: dbRes.recordset.map(d => d.name) });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
