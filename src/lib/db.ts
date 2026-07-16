import sql from 'mssql';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.conn.json');

export interface ConnConfig {
  server:      string;
  database:    string;
  user:        string;
  password:    string;
  port:        number;
  encrypt:     boolean;
  trustServerCertificate: boolean;
  windowsAuth?: boolean;
  domain?:      string;
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

  const poolConfig: sql.config = {
    server:   cfg.server,
    database: cfg.database,
    port:     cfg.port || 1433,
    options: {
      encrypt:                cfg.encrypt ?? false,
      trustServerCertificate: cfg.trustServerCertificate ?? true,
      enableArithAbort:       true,
      connectTimeout:         15000,
      requestTimeout:         120000,
    },
  };

  if (cfg.windowsAuth) {
    // Windows Authentication via NTLM
    poolConfig.authentication = {
      type: 'ntlm',
      options: {
        domain:   cfg.domain   || '',
        userName: cfg.user     || '',
        password: cfg.password || '',
      },
    };
  } else {
    poolConfig.user     = cfg.user;
    poolConfig.password = cfg.password;
  }

  _pool = new sql.ConnectionPool(poolConfig);
  try {
    await _pool.connect();
  } catch (err) {
    // Ensure a failed pool doesn't get cached
    try { await _pool.close(); } catch { /* ignore */ }
    _pool = null;
    throw err;
  }
  return _pool;
}

export async function query<T = Record<string, unknown>>(sql_: string): Promise<T[]> {
  const pool = await getPool();
  const res = await pool.request().query<T>(sql_);
  return res.recordset;
}
