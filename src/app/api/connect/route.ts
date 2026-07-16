import { NextRequest, NextResponse } from 'next/server';
import { saveConfig, getPool, clearConfig, loadConfig, ConnConfig } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<ConnConfig>;
  const isWinAuth = Boolean(body.windowsAuth);
  const cfg: ConnConfig = {
    server:   body.server   || '',
    database: body.database || 'master',
    user:     body.user     || '',
    password: body.password || '',
    port:     Number(body.port) || 1433,
    encrypt:  Boolean(body.encrypt),
    trustServerCertificate: body.trustServerCertificate ?? true,
    windowsAuth: isWinAuth,
    domain:      body.domain || '',
  };
  if (!cfg.server) {
    return NextResponse.json({ success: false, message: 'Serveur requis.' }, { status: 400 });
  }
  if (!isWinAuth && !cfg.user) {
    return NextResponse.json({ success: false, message: 'Utilisateur requis (authentification SQL Server).' }, { status: 400 });
  }
  try {
    saveConfig(cfg);
    const pool = await getPool();
    const res = await pool.request().query<{ version: string }>('SELECT @@VERSION AS version');
    const version = res.recordset[0]?.version?.split('\n')[0] ?? 'Unknown';
    return NextResponse.json({ success: true, version });
  } catch (e: unknown) {
    clearConfig();
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE() {
  clearConfig();
  return NextResponse.json({ success: true });
}

export async function GET() {
  const cfg = loadConfig();
  if (!cfg) return NextResponse.json({ connected: false });
  try {
    const pool = await getPool();
    const res = await pool.request().query<{ version: string }>('SELECT @@VERSION AS version');
    return NextResponse.json({ connected: true, server: cfg.server, database: cfg.database, version: res.recordset[0]?.version?.split('\n')[0] });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
