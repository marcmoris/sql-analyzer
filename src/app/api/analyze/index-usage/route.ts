import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET(req: NextRequest) {
  const db = new URL(req.url).searchParams.get('database') || null;

  try {
    const pool = await getPool();
    const res = await pool.request().query<{
      database_name: string; schema_name: string; table_name: string; index_name: string;
      user_seeks: number; user_scans: number; user_lookups: number; user_updates: number;
      total_reads: number; read_to_write_ratio: number;
      last_user_seek: Date | null; last_user_scan: Date | null;
      last_user_lookup: Date | null; last_user_update: Date | null;
      recommendation: string;
    }>(`
      SELECT
        DB_NAME(i.database_id)                              AS database_name,
        OBJECT_SCHEMA_NAME(i.object_id, i.database_id)     AS schema_name,
        OBJECT_NAME(i.object_id, i.database_id)            AS table_name,
        ix.name                                             AS index_name,
        ISNULL(i.user_seeks,   0)                           AS user_seeks,
        ISNULL(i.user_scans,   0)                           AS user_scans,
        ISNULL(i.user_lookups, 0)                           AS user_lookups,
        ISNULL(i.user_updates, 0)                           AS user_updates,
        ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) AS total_reads,
        CASE
          WHEN ISNULL(i.user_updates, 0) = 0 THEN 9999
          ELSE ROUND(
            CAST(ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) AS float)
            / NULLIF(i.user_updates, 0), 1)
        END AS read_to_write_ratio,
        i.last_user_seek,
        i.last_user_scan,
        i.last_user_lookup,
        i.last_user_update,
        CASE
          WHEN ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) = 0
            AND ISNULL(i.user_updates, 0) > 1000 THEN 'UNUSED_HIGH_MAINT'
          WHEN ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) = 0 THEN 'UNUSED'
          WHEN ISNULL(i.user_updates, 0) > (ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) * 10)
            THEN 'HIGH_WRITE_LOW_READ'
          ELSE 'OK'
        END AS recommendation
      FROM sys.dm_db_index_usage_stats i
      JOIN sys.indexes ix
        ON ix.object_id = i.object_id AND ix.index_id = i.index_id
      WHERE ix.name IS NOT NULL
        AND ix.index_id > 0
        AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
        ${db ? `AND DB_NAME(i.database_id) = '${db.replace(/'/g, "''")}'` : ''}
      ORDER BY
        CASE WHEN ISNULL(i.user_seeks + i.user_scans + i.user_lookups, 0) = 0 THEN 0 ELSE 1 END,
        ISNULL(i.user_updates, 0) DESC
    `);

    // Generate DROP INDEX script for unused indexes
    const data = res.recordset.map(r => {
      const isUnused = r.recommendation === 'UNUSED' || r.recommendation === 'UNUSED_HIGH_MAINT';
      const lastModified = r.last_user_update
        ? new Date(r.last_user_update).toLocaleDateString('fr-CA')
        : 'Jamais';

      const drop_script = isUnused
        ? `-- ⚠️  Validez que cet index n'est pas requis avant de supprimer!\n` +
          `-- Stats depuis le dernier démarrage du serveur :\n` +
          `--   Seeks   : ${r.user_seeks}\n` +
          `--   Scans   : ${r.user_scans}\n` +
          `--   Lookups : ${r.user_lookups}\n` +
          `--   Updates : ${r.user_updates}\n` +
          `--   Dernière modification : ${lastModified}\n\n` +
          `USE [${r.database_name}];\n` +
          `DROP INDEX [${r.index_name}] ON [${r.schema_name}].[${r.table_name}];`
        : null;

      return { ...r, drop_script };
    });

    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
