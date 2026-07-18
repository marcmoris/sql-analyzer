import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET() {
  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      group_name:       string;
      counter_name:     string;
      cntr_value:       number;
      cntr_type:        number;
    }>(`
      SELECT
        LTRIM(RTRIM(instance_name)) AS group_name,
        LTRIM(RTRIM(counter_name))  AS counter_name,
        cntr_value,
        cntr_type
      FROM sys.dm_os_performance_counters
      WHERE object_name LIKE '%Workload Group Stats%'
      ORDER BY instance_name, counter_name
    `);

    const rows = res.recordset;

    // Pivot: group by group_name, then map counter_name -> value
    const grouped: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!grouped[row.group_name]) grouped[row.group_name] = {};
      grouped[row.group_name][row.counter_name] = row.cntr_value;
    }

    // Return as an array sorted by group_name
    const data = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group_name, counters]) => ({ group_name, ...counters }));

    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
