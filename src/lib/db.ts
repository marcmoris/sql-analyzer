import sql from 'mssql';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.conn.json');

export interface ConnConfig {
  server:   string;
  database: string;
  user:     string;
  password: string;
  port:     number;
  encrypt:  boolean;
  trustServerCertificate: boolean;
}

let _pool: sql.ConnectionPool | null = null;
let _config: ConnConfig | null = null;

export function saveConfig(cfg: ConnConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  _config = cfg;
  _pool = null; // force reconnect
}

export function loadConfig(): ConnConfig | null {
  if (_config) return _config;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return _config;
    }
  } catch { /* ignore */ }
  return null;
}

export function clearConfig() {
  _config = null;
  _pool = null;
  try { if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH); } catch { /* ignore */ }
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool?.connected) return _pool;
  const cfg = loadConfig();
  if (!cfg) throw new Error('Aucune connexion configurée.');

  _pool = new sql.ConnectionPool({
    server:   cfg.server,
    database: cfg.database,
    user:     cfg.user,
    password: cfg.password,
    port:     cfg.port || 1433,
    options: {
      encrypt:                cfg.encrypt ?? false,
      trustServerCertificate: cfg.trustServerCertificate ?? true,
      enableArithAbort:       true,
      connectTimeout:         15000,
      requestTimeout:         120000,
    },
  });
  await _pool.connect();
  return _pool;
}

export async function query<T = Record<string, unknown>>(sql_: string): Promise<T[]> {
  const pool = await getPool();
  const res = await pool.request().query<T>(sql_);
  return res.recordset;
}
