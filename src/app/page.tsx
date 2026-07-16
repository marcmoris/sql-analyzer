'use client';
import React, { useState, useEffect, useCallback } from 'react';
import ChartsTab from './ChartsTab';


// ── Types ──────────────────────────────────────────────────────────────────────
interface ConnInfo { server: string; database: string; version: string; }

interface WaitRow   { wait_type: string; wait_s: number; resource_s: number; signal_s: number; pct: number; category: string; }
interface MissingIdx { database_name: string; table_name: string; equality_columns: string; inequality_columns: string; included_columns: string; avg_user_impact: number; user_seeks: number; score: number; script: string; }
interface QueryRow  { query_text: string; execution_count: number; total_cpu_ms: number; avg_cpu_ms: number; total_reads: number; avg_reads: number; total_duration_ms: number; avg_duration_ms: number; }
interface IndexRow  { database_name: string; table_name: string; index_name: string; schema_name: string; user_seeks: number; user_scans: number; user_lookups: number; user_updates: number; total_reads: number; last_user_seek: string | null; last_user_scan: string | null; last_user_lookup: string | null; last_user_update: string | null; recommendation: string; drop_script: string | null; }
interface FragRow   { database_name: string; table_name: string; index_name: string; avg_fragmentation_pct: number; page_count: number; recommendation: string; action_script: string; }
interface BlockRow  { session_id: number; blocking_session_id: number; wait_type: string; wait_time_ms: number; status: string; command: string; database_name: string; login_name: string; host_name: string; query_text: string; }
interface Health    { version: string; edition: string; cpuCount: number; memTotal: number; memInUse: number; memPct: number; activeConnections: number; uptimeHours: number; databases: { name: string; sizeGb: number }[]; }

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt  = (n: number, d = 0) => n?.toLocaleString('fr-CA', { maximumFractionDigits: d }) ?? '—';
const fmtMs = (ms: number) => ms > 60000 ? `${(ms / 60000).toFixed(1)} min` : ms > 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;

function copy(text: string) { navigator.clipboard.writeText(text).catch(() => {}); }

function ScoreCircle({ score, color }: { score: number; color: string }) {
  const r = 36, circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="score-circle">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8"/>
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }}/>
      </svg>
      <div className="score-circle-text" style={{ color }}>
        {score}<div className="score-circle-label">/100</div>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress-bar" style={{ flex: 1 }}>
      <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }}/>
    </div>
  );
}

const WAIT_COLORS: Record<string, string> = {
  'CPU': '#6366f1', 'I/O': '#f59e0b', 'Memory': '#ec4899',
  'Lock': '#ef4444', 'Network': '#10b981', 'HA/DR': '#8b5cf6', 'Other': '#6b7280',
};

const FRAG_COLOR = (pct: number) => pct > 30 ? '#ef4444' : pct > 10 ? '#f59e0b' : '#10b981';

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  // ── Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [connInfo,    setConnInfo]    = useState<ConnInfo | null>(null);
  const [connForm,    setConnForm]    = useState({ server: '', database: 'master', user: 'sa', password: '', port: '1433', encrypt: false, trustServerCertificate: true, windowsAuth: false, domain: '' });
  const [connecting,  setConnecting]  = useState(false);
  const [connError,   setConnError]   = useState('');

  // ── Analysis data
  const [health,    setHealth]    = useState<Health | null>(null);
  const [waitStats, setWaitStats] = useState<WaitRow[]>([]);
  const [missingIdx, setMissingIdx] = useState<MissingIdx[]>([]);
  const [queries,   setQueries]   = useState<QueryRow[]>([]);
  const [idxUsage,  setIdxUsage]  = useState<IndexRow[]>([]);
  const [fragData,  setFragData]  = useState<FragRow[]>([]);
  const [blocking,  setBlocking]  = useState<BlockRow[]>([]);

  // ── UI state
  const [activeTab,     setActiveTab]    = useState<'health'|'waits'|'missing'|'queries'|'indexes'|'frag'|'blocking'|'charts'>('health');
  const [loading,       setLoading]      = useState<Record<string, boolean>>({});
  const [errors,        setErrors]       = useState<Record<string, string>>({});
  const [querySortBy,   setQuerySortBy]  = useState<'cpu'|'reads'|'duration'|'exec'>('cpu');
  const [expandedQuery, setExpandedQuery] = useState<number | null>(null);
  const [expandedIdx,   setExpandedIdx]  = useState<number | null>(null);
  const [expandedFrag,  setExpandedFrag] = useState<number | null>(null);
  const [copiedIdx,     setCopiedIdx]    = useState<number | null>(null);
  const [selectedDb,    setSelectedDb]   = useState<string>('');
  const [databases,     setDatabases]    = useState<{ name: string; sizeGb: number }[]>([]);
  const [expandedDropIdx, setExpandedDropIdx] = useState<number | null>(null);
  const [copiedDrop,    setCopiedDrop]   = useState<number | null>(null);

  // ── Check existing connection on mount
  useEffect(() => {
    fetch('/api/connect').then(r => r.json()).then(d => {
      if (d.connected) { setIsConnected(true); setConnInfo({ server: d.server, database: d.database, version: d.version }); }
    });
  }, []);

  // ── Load data when connected
  useEffect(() => {
    if (isConnected) {
      loadHealth();
      loadWaitStats();
    }
  }, [isConnected]);

  // ── When health loads, populate DB list
  useEffect(() => {
    if (health?.databases) setDatabases(health.databases);
  }, [health]);

  const load = useCallback(async (key: string, url: string, setter: (d: unknown) => void) => {
    setLoading(p => ({ ...p, [key]: true }));
    setErrors(p => ({ ...p, [key]: '' }));
    try {
      const r = await fetch(url); const d = await r.json();
      if (d.success) setter(d.data ?? d);
      else setErrors(p => ({ ...p, [key]: d.message ?? 'Erreur' }));
    } catch (e: unknown) {
      setErrors(p => ({ ...p, [key]: e instanceof Error ? e.message : 'Erreur réseau' }));
    } finally { setLoading(p => ({ ...p, [key]: false })); }
  }, []);

  const dbParam = (base: string) => selectedDb ? `${base}?database=${encodeURIComponent(selectedDb)}` : base;
  const dbParamQ = (sort: string) => {
    const p = new URLSearchParams({ sort });
    if (selectedDb) p.set('database', selectedDb);
    return `/api/analyze/top-queries?${p.toString()}`;
  };

  const loadHealth    = () => load('health',   '/api/analyze/server-health', d => { const h = d as Health; setHealth(h); });
  const loadWaitStats = () => load('waits',    '/api/analyze/wait-stats',    d => setWaitStats(d as WaitRow[]));
  const loadMissing   = useCallback(() => load('missing',  dbParam('/api/analyze/missing-indexes'), d => setMissingIdx(d as MissingIdx[])), [selectedDb]);
  const loadQueries   = useCallback((sort = querySortBy) => load('queries', dbParamQ(sort), d => setQueries(d as QueryRow[])), [load, querySortBy, selectedDb]);
  const loadIdxUsage  = useCallback(() => load('indexes',  dbParam('/api/analyze/index-usage'),   d => setIdxUsage(d as IndexRow[])), [selectedDb]);
  const loadFrag      = useCallback(() => load('frag',     dbParam('/api/analyze/fragmentation'),  d => setFragData(d as FragRow[])), [selectedDb]);
  const loadBlocking  = useCallback(() => load('blocking', dbParam('/api/analyze/blocking'),       d => setBlocking(d as BlockRow[])), [selectedDb]);

  // ── Re-load on tab change
  useEffect(() => {
    if (activeTab === 'missing'  && missingIdx.length === 0) loadMissing();
    if (activeTab === 'queries'  && queries.length    === 0) loadQueries();
    if (activeTab === 'indexes'  && idxUsage.length   === 0) loadIdxUsage();
    if (activeTab === 'frag'     && fragData.length    === 0) loadFrag();
    if (activeTab === 'blocking')                            loadBlocking();
  }, [activeTab]);

  // ── Re-load all data when selected DB changes
  useEffect(() => {
    if (!isConnected) return;
    setMissingIdx([]); setQueries([]); setIdxUsage([]); setFragData([]); setBlocking([]);
    if (activeTab === 'missing')  loadMissing();
    if (activeTab === 'queries')  loadQueries();
    if (activeTab === 'indexes')  loadIdxUsage();
    if (activeTab === 'frag')     loadFrag();
    if (activeTab === 'blocking') loadBlocking();
  }, [selectedDb]);

  // ── Score computation
  const score = (() => {
    if (!health) return 0;
    let s = 100;
    if (health.memPct > 90) s -= 20; else if (health.memPct > 75) s -= 10;
    if (missingIdx.length > 20) s -= 15; else if (missingIdx.length > 5) s -= 8;
    const highFrag = fragData.filter(f => f.avg_fragmentation_pct > 30).length;
    if (highFrag > 10) s -= 15; else if (highFrag > 3) s -= 8;
    if (blocking.length > 0) s -= 12;
    const unusedIdx = idxUsage.filter(i => i.recommendation !== 'OK').length;
    if (unusedIdx > 20) s -= 10; else if (unusedIdx > 5) s -= 5;
    return Math.max(0, s);
  })();

  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const scoreLabel = score >= 80 ? 'Bonne santé' : score >= 60 ? 'Attention requise' : 'Action urgente';

  // ── Connection screen
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault(); setConnecting(true); setConnError('');
    try {
      const r = await fetch('/api/connect', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ...connForm, port: Number(connForm.port) }) });
      const d = await r.json();
      if (d.success) { setIsConnected(true); setConnInfo({ server: connForm.server, database: connForm.database, version: d.version }); }
      else setConnError(d.message);
    } catch (e: unknown) { setConnError(e instanceof Error ? e.message : 'Erreur réseau'); }
    finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    await fetch('/api/connect', { method: 'DELETE' });
    setIsConnected(false); setConnInfo(null); setHealth(null);
    setWaitStats([]); setMissingIdx([]); setQueries([]); setIdxUsage([]); setFragData([]); setBlocking([]);
  };

  if (!isConnected) return (
    <>
      <div className="bg-mesh" style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none' }}/>
      <div className="connect-screen" style={{ position:'relative', zIndex:1 }}>
        <div className="connect-card">
          {/* Solstice Plus branding on login screen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, justifyContent: 'center' }}>
            <svg width="44" height="44" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 15 Q20 3 34 15" stroke="#9ca3af" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
              <text x="5" y="34" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#e5e7eb">S</text>
              <text x="23" y="30" fontFamily="Arial, sans-serif" fontSize="14" fontWeight="700" fill="#818cf8">+</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'left' }}>
              <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>Solstice Plus</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>SQL Analyzer</span>
            </div>
          </div>
          <div className="connect-subtitle">Connectez-vous à votre instance SQL Server pour commencer l'analyse.</div>
          <form onSubmit={handleConnect}>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Serveur</label>
                <input className="field-input" placeholder="serveur\instance" value={connForm.server} onChange={e => setConnForm(p => ({...p, server: e.target.value}))} required/>
              </div>
              <div className="field">
                <label className="field-label">Port</label>
                <input className="field-input" type="number" value={connForm.port} onChange={e => setConnForm(p => ({...p, port: e.target.value}))}/>
              </div>
            </div>
            <div className="field">
              <label className="field-label">Base de données</label>
              <input className="field-input" placeholder="master" value={connForm.database} onChange={e => setConnForm(p => ({...p, database: e.target.value}))}/>
            </div>
            {/* Auth mode toggle */}
            <div className="field" style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 14px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>Mode&nbsp;:</span>
                <label style={{ display:'flex', gap:6, alignItems:'center', cursor:'pointer', padding:'4px 10px', borderRadius:6, background: !connForm.windowsAuth ? 'rgba(99,102,241,0.18)' : 'transparent', color: !connForm.windowsAuth ? '#a5b4fc' : 'var(--text-muted)', fontSize:12, fontWeight:600, transition:'all .2s' }}>
                  <input type="radio" name="authMode" style={{ display:'none' }} checked={!connForm.windowsAuth} onChange={() => setConnForm(p => ({ ...p, windowsAuth: false }))}/>
                  🔑 SQL Server
                </label>
                <label style={{ display:'flex', gap:6, alignItems:'center', cursor:'pointer', padding:'4px 10px', borderRadius:6, background: connForm.windowsAuth ? 'rgba(99,102,241,0.18)' : 'transparent', color: connForm.windowsAuth ? '#a5b4fc' : 'var(--text-muted)', fontSize:12, fontWeight:600, transition:'all .2s' }}>
                  <input type="radio" name="authMode" style={{ display:'none' }} checked={connForm.windowsAuth} onChange={() => setConnForm(p => ({ ...p, windowsAuth: true }))}/>
                  🪟 Windows
                </label>
              </div>
            </div>

            {/* SQL Server auth fields */}
            {!connForm.windowsAuth && (
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Utilisateur</label>
                  <input className="field-input" value={connForm.user} onChange={e => setConnForm(p => ({...p, user: e.target.value}))} required/>
                </div>
                <div className="field">
                  <label className="field-label">Mot de passe</label>
                  <input className="field-input" type="password" value={connForm.password} onChange={e => setConnForm(p => ({...p, password: e.target.value}))}/>
                </div>
              </div>
            )}

            {/* Windows Auth — optional domain */}
            {connForm.windowsAuth && (
              <div className="field">
                <label className="field-label">Domaine <span style={{ color:'var(--text-muted)', fontWeight:400, fontSize:11 }}>(optionnel — ex: CORP)</span></label>
                <input className="field-input" placeholder="CORP" value={connForm.domain} onChange={e => setConnForm(p => ({...p, domain: e.target.value}))}/>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, padding: '6px 10px', background: 'rgba(99,102,241,0.07)', borderRadius: 6 }}>
                  🪟 La session Windows de l'utilisateur courant sera utilisée pour s'authentifier.
                </div>
              </div>
            )}

            <div className="field" style={{ display: 'flex', gap: 20 }}>
              <label className="field-checkbox">
                <input type="checkbox" checked={connForm.encrypt} onChange={e => setConnForm(p => ({...p, encrypt: e.target.checked}))}/> Chiffrement SSL
              </label>
              <label className="field-checkbox">
                <input type="checkbox" checked={connForm.trustServerCertificate} onChange={e => setConnForm(p => ({...p, trustServerCertificate: e.target.checked}))}/> Faire confiance au certificat
              </label>
            </div>
            {connError && <div className="error-box" style={{ marginBottom: 16 }}>{connError}</div>}
            <button className="btn btn-primary btn-full" type="submit" disabled={connecting}>
              {connecting ? <><div className="spinner" style={{ width:16, height:16 }}/> Connexion…</> : '🔗 Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </>
  );


  // ── Main Dashboard
  const tabs = [
    { id: 'health',   icon: '🏥', label: 'Serveur'     },
    { id: 'waits',    icon: '⏳', label: 'Wait Stats'  },
    { id: 'missing',  icon: '🔍', label: 'Index manquants' },
    { id: 'queries',  icon: '🔥', label: 'Top Requêtes' },
    { id: 'indexes',  icon: '📊', label: 'Index usage'  },
    { id: 'frag',     icon: '🧩', label: 'Fragmentation' },
    { id: 'blocking', icon: '🚧', label: 'Blocages'     },
    { id: 'charts',   icon: '📈', label: 'Graphiques'   },
  ] as const;

  return (
    <div className="app-layout">
      <div className="bg-mesh"/>
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-logo" style={{ gap: 10 }}>
          {/* Solstice Plus logo mark */}
          <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Arc above S */}
            <path d="M8 14 Q20 4 32 14" stroke="#9ca3af" strokeWidth="2" fill="none" strokeLinecap="round"/>
            {/* S letter */}
            <text x="7" y="32" fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill="#e5e7eb">S</text>
            {/* + sign */}
            <text x="23" y="28" fontFamily="Arial, sans-serif" fontSize="13" fontWeight="700" fill="#6366f1">+</text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
              Solstice Plus
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              SQL Analyzer
            </span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--success)', marginRight: 6 }}>●</span>
          {connInfo?.server} / <strong style={{ color: 'var(--text)' }}>{connInfo?.database}</strong>
        </div>
        <div className="topbar-spacer"/>

        {/* ── Database selector ── */}
        {databases.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:16 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>🗄 Analyser :</span>
            <select
              className="field-input"
              style={{ padding:'5px 10px', fontSize:12, minWidth:160, cursor:'pointer' }}
              value={selectedDb}
              onChange={e => setSelectedDb(e.target.value)}
            >
              <option value="">Toutes les bases</option>
              {databases.map(d => (
                <option key={d.name} value={d.name}>{d.name} ({d.sizeGb} GB)</option>
              ))}
            </select>
            {selectedDb && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDb('')} title="Effacer le filtre">✕</button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 16, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connInfo?.version}</div>
        <button className="btn btn-ghost btn-sm" onClick={handleDisconnect}>🔌 Déconnecter</button>
      </header>

      <main className="main-content">
        {/* Score banner */}
        <div className="score-banner">
          <ScoreCircle score={score} color={scoreColor}/>
          <div className="score-info">
            <div className="score-title">{scoreLabel}</div>
            <div className="score-desc">Score global basé sur les index, la fragmentation, les blocages et la mémoire.</div>
          </div>
          <div className="score-stats">
            <div className="score-stat">
              <div className="score-stat-val" style={{ color: missingIdx.length > 5 ? '#f59e0b' : 'var(--text)' }}>{missingIdx.length || '—'}</div>
              <div className="score-stat-lbl">Index manquants</div>
            </div>
            <div className="score-stat">
              <div className="score-stat-val" style={{ color: fragData.filter(f => f.avg_fragmentation_pct > 30).length > 0 ? '#ef4444' : 'var(--text)' }}>
                {fragData.filter(f => f.avg_fragmentation_pct > 30).length || '—'}
              </div>
              <div className="score-stat-lbl">Fragm. critique</div>
            </div>
            <div className="score-stat">
              <div className="score-stat-val" style={{ color: blocking.length > 0 ? '#ef4444' : '#10b981' }}>{blocking.length}</div>
              <div className="score-stat-lbl">Blocages actifs</div>
            </div>
            <div className="score-stat">
              <div className="score-stat-val">{health?.activeConnections ?? '—'}</div>
              <div className="score-stat-lbl">Connexions</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id as typeof activeTab)}>
              {t.icon} {t.label}
              {t.id === 'blocking' && blocking.length > 0 && <span style={{ marginLeft:6, background:'#ef4444', color:'#fff', borderRadius:'10px', padding:'0 5px', fontSize:'10px' }}>{blocking.length}</span>}
            </button>
          ))}
        </div>

        {/* ── Tab: Server Health ── */}
        {activeTab === 'health' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>🏥 Santé du serveur</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadHealth} disabled={loading.health}>
                {loading.health ? <div className="spinner"/> : '↻ Actualiser'}
              </button>
            </div>
            {loading.health ? <div className="loading-state"><div className="spinner"/> Chargement…</div> :
             errors.health  ? <div className="error-box">{errors.health}</div> :
             health ? <>
              <div className="stat-tiles">
                <div className="stat-tile">
                  <div className="stat-tile-val" style={{ color:'#6366f1' }}>{health.cpuCount}</div>
                  <div className="stat-tile-label">CPUs logiques</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-val" style={{ color: health.memPct > 85 ? '#ef4444' : '#10b981' }}>{health.memPct}%</div>
                  <div className="stat-tile-label">Mémoire utilisée</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-val">{fmt(health.memTotal)} MB</div>
                  <div className="stat-tile-label">Mémoire totale</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-val">{health.activeConnections}</div>
                  <div className="stat-tile-label">Connexions actives</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-val">{health.uptimeHours}h</div>
                  <div className="stat-tile-label">Uptime</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-val">{health.databases?.length ?? 0}</div>
                  <div className="stat-tile-label">Bases de données</div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header"><span className="card-title">Mémoire</span><span style={{ fontSize:12, color:'var(--text-muted)' }}>{fmt(health.memInUse)} / {fmt(health.memTotal)} MB</span></div>
                <ProgressBar pct={health.memPct} color={health.memPct > 85 ? '#ef4444' : '#10b981'}/>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title">📁 Bases de données</span></div>
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Nom</th><th className="text-right">Taille (GB)</th></tr></thead>
                    <tbody>
                      {health.databases?.map((d, i) => (
                        <tr key={i}><td>{d.name}</td><td className="text-right text-mono">{d.sizeGb}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </> : <div className="empty-state">Aucune donnée</div>}
          </div>
        )}

        {/* ── Tab: Wait Stats ── */}
        {activeTab === 'waits' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>⏳ Wait Statistics</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadWaitStats} disabled={loading.waits}>
                {loading.waits ? <div className="spinner"/> : '↻ Actualiser'}
              </button>
            </div>
            {loading.waits ? <div className="loading-state"><div className="spinner"/> Analyse…</div> :
             errors.waits  ? <div className="error-box">{errors.waits}</div> : (
              <div className="card">
                <div className="wait-bars">
                  {waitStats.map((w, i) => (
                    <div key={i} className="wait-bar-row">
                      <span className="wait-bar-label" title={w.wait_type}>{w.wait_type}</span>
                      <span className="badge badge-neutral" style={{ background: (WAIT_COLORS[w.category]||'#6b7280')+'22', color: WAIT_COLORS[w.category]||'#6b7280', border:'none', fontSize:'10px' }}>{w.category}</span>
                      <div className="wait-bar-track">
                        <div className="wait-bar-fill" style={{ width:`${Math.min(w.pct, 100)}%`, background: WAIT_COLORS[w.category] || '#6b7280' }}>
                          {w.pct > 8 && `${w.pct}%`}
                        </div>
                      </div>
                      <span className="wait-bar-val">{fmtMs(w.wait_s * 1000)}</span>
                    </div>
                  ))}
                  {waitStats.length === 0 && <div className="empty-state">Aucun wait significatif — excellent!</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Missing Indexes ── */}
        {activeTab === 'missing' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>🔍 Index manquants</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadMissing} disabled={loading.missing}>
                {loading.missing ? <div className="spinner"/> : '↻ Actualiser'}
              </button>
              <span className="badge badge-warning">{missingIdx.length} suggestion(s)</span>
              <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>⚠️ Ces index sont des suggestions — évaluez avant d'appliquer.</span>
            </div>
            {loading.missing ? <div className="loading-state"><div className="spinner"/> Analyse…</div> :
             errors.missing  ? <div className="error-box">{errors.missing}</div> : (
              <div className="card">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Base</th><th>Table</th><th>Impact</th><th>Seeks</th><th>Score</th><th></th></tr></thead>
                    <tbody>
                      {missingIdx.map((idx, i) => (
                        <React.Fragment key={i}>
                          <tr style={{ cursor:'pointer' }} onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
                            <td><span className="badge badge-neutral">{idx.database_name}</span></td>
                            <td className="text-mono text-sm">{idx.table_name?.split('.').pop()?.replace(/\[|\]/g,'')}</td>
                            <td><span style={{ color: idx.avg_user_impact > 80 ? '#ef4444' : idx.avg_user_impact > 50 ? '#f59e0b' : '#10b981', fontWeight:700 }}>{idx.avg_user_impact}%</span></td>
                            <td className="text-mono">{fmt(idx.user_seeks)}</td>
                            <td className="text-mono">{fmt(idx.score)}</td>
                            <td><span style={{ fontSize:10, color:'var(--text-muted)' }}>{expandedIdx === i ? '▲' : '▼'} script</span></td>
                          </tr>
                          {expandedIdx === i && (
                            <tr><td colSpan={6} style={{ padding:'0 14px 14px' }}>
                              <pre className="sql-block">{idx.script}</pre>
                              <button className="copy-btn" style={{ marginTop:6 }} onClick={() => { copy(idx.script); setCopiedIdx(i); setTimeout(()=>setCopiedIdx(null),2000); }}>
                                {copiedIdx === i ? '✓ Copié!' : '📋 Copier'}
                              </button>
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Top Queries ── */}
        {activeTab === 'queries' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap' }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>🔥 Top Requêtes</h2>
              <div style={{ display:'flex', gap:6, marginLeft:'auto' }}>
                {(['cpu','reads','duration','exec'] as const).map(s => (
                  <button key={s} className={`tab-btn btn-sm ${querySortBy===s?'active':''}`}
                    onClick={() => { setQuerySortBy(s); setQueries([]); setTimeout(()=>loadQueries(s),0); }}>
                    {s==='cpu'?'🔥 CPU':s==='reads'?'📖 Lectures':s==='duration'?'⏱ Durée':'🔢 Exécutions'}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => loadQueries(querySortBy)} disabled={loading.queries}>
                  {loading.queries ? <div className="spinner"/> : '↻'}
                </button>
              </div>
            </div>
            {loading.queries ? <div className="loading-state"><div className="spinner"/> Analyse du cache…</div> :
             errors.queries  ? <div className="error-box">{errors.queries}</div> : (
              <div className="card">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Requête</th><th className="text-right">Exec.</th><th className="text-right">CPU total</th><th className="text-right">CPU moy.</th><th className="text-right">Lectures</th><th className="text-right">Durée moy.</th></tr></thead>
                    <tbody>
                      {queries.map((q, i) => (
                        <React.Fragment key={i}>
                          <tr style={{ cursor:'pointer' }} onClick={() => setExpandedQuery(expandedQuery===i?null:i)}>
                            <td style={{ maxWidth:400 }}>
                              <code style={{ fontSize:11, color:'#a5b4fc', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {q.query_text?.trim().replace(/\s+/g,' ').slice(0,120)}
                              </code>
                            </td>
                            <td className="text-right text-mono">{fmt(q.execution_count)}</td>
                            <td className="text-right text-mono">{fmtMs(q.total_cpu_ms)}</td>
                            <td className="text-right text-mono">{fmtMs(q.avg_cpu_ms)}</td>
                            <td className="text-right text-mono">{fmt(q.total_reads)}</td>
                            <td className="text-right text-mono">{fmtMs(q.avg_duration_ms)}</td>
                          </tr>
                          {expandedQuery === i && (
                            <tr><td colSpan={6} style={{ padding:'0 14px 14px' }}>
                              <pre className="sql-block">{q.query_text}</pre>
                              <button className="copy-btn" style={{ marginTop:6 }} onClick={() => copy(q.query_text)}>📋 Copier</button>
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Index Usage ── */}
        {activeTab === 'indexes' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>📊 Utilisation des index</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadIdxUsage} disabled={loading.indexes}>{loading.indexes ? <div className="spinner"/> : '↻ Actualiser'}</button>
              <span className="badge badge-warning">{idxUsage.filter(i=>i.recommendation!=='OK').length} à évaluer</span>
            </div>
            {loading.indexes ? <div className="loading-state"><div className="spinner"/> Analyse…</div> :
             errors.indexes  ? <div className="error-box">{errors.indexes}</div> : (
              <div className="card">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Table</th><th>Index</th><th className="text-right">Seeks</th><th className="text-right">Scans</th><th className="text-right">Lookups</th><th className="text-right">Updates</th><th>Dernière utilisation</th><th>Recommandation</th><th></th></tr></thead>
                    <tbody>
                      {idxUsage.map((idx, i) => {
                        const lastRead = [idx.last_user_seek, idx.last_user_scan, idx.last_user_lookup]
                          .filter(Boolean).map(d => new Date(d!)).sort((a,b)=>b.getTime()-a.getTime())[0];
                        const lastUsed = lastRead ? lastRead.toLocaleDateString('fr-CA') : '—';
                        const daysSince = lastRead ? Math.floor((Date.now() - lastRead.getTime()) / 86400000) : null;
                        const canDrop = !!idx.drop_script;
                        const isExpanded = expandedDropIdx === i;
                        return (
                          <React.Fragment key={i}>
                            <tr style={{ cursor: canDrop ? 'pointer' : 'default', background: isExpanded ? 'rgba(239,68,68,0.04)' : undefined }}
                                onClick={() => canDrop && setExpandedDropIdx(isExpanded ? null : i)}>
                              <td className="text-mono text-sm">{idx.table_name}</td>
                              <td className="text-sm" style={{ color:'var(--text-muted)' }}>{idx.index_name}</td>
                              <td className="text-right text-mono">{fmt(idx.user_seeks)}</td>
                              <td className="text-right text-mono">{fmt(idx.user_scans)}</td>
                              <td className="text-right text-mono">{fmt(idx.user_lookups)}</td>
                              <td className="text-right text-mono">{fmt(idx.user_updates)}</td>
                              <td className="text-sm" title={lastUsed}>
                                {daysSince !== null
                                  ? <span style={{ color: daysSince > 30 ? '#ef4444' : daysSince > 7 ? '#f59e0b' : '#10b981' }}>{lastUsed} ({daysSince}j)</span>
                                  : <span style={{ color:'var(--text-muted)' }}>Jamais</span>}
                              </td>
                              <td>
                                {idx.recommendation === 'UNUSED_HIGH_MAINT' && <span className="badge badge-critical">Supprimer (inutilisé + coûteux)</span>}
                                {idx.recommendation === 'UNUSED' && <span className="badge badge-warning">Inutilisé</span>}
                                {idx.recommendation === 'HIGH_WRITE_LOW_READ' && <span className="badge badge-warning">Trop d'écritures</span>}
                                {idx.recommendation === 'OK' && <span className="badge badge-success">✓ OK</span>}
                              </td>
                              <td>{canDrop && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'} DROP</span>}</td>
                            </tr>
                            {isExpanded && idx.drop_script && (
                              <tr>
                                <td colSpan={9} style={{ padding:'0 14px 14px' }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, marginTop:4 }}>
                                    <span style={{ fontSize:11, background:'rgba(239,68,68,0.15)', color:'#ef4444', padding:'3px 8px', borderRadius:4, fontWeight:600 }}>⚠️ Script de suppression — irréversible!</span>
                                  </div>
                                  <pre className="sql-block">{idx.drop_script}</pre>
                                  <button className="copy-btn" style={{ marginTop:6, background:'rgba(239,68,68,0.15)', borderColor:'rgba(239,68,68,0.3)', color:'#ef4444' }}
                                    onClick={e => { e.stopPropagation(); copy(idx.drop_script!); setCopiedDrop(i); setTimeout(()=>setCopiedDrop(null),2000); }}>
                                    {copiedDrop === i ? '✓ Copié!' : '📋 Copier le DROP INDEX'}
                                  </button>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Fragmentation ── */}
        {activeTab === 'frag' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>🧩 Fragmentation des index</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadFrag} disabled={loading.frag}>{loading.frag ? <div className="spinner"/> : '↻ Actualiser'}</button>
              <span className="text-muted text-sm" style={{ marginLeft:'auto' }}>Mode : DETAILED • Seuil : &gt;5% &amp; &gt;100 pages</span>
            </div>
            {loading.frag ? <div className="loading-state"><div className="spinner"/> Analyse DETAILED en cours (peut prendre quelques minutes)…</div> :
             errors.frag   ? <div className="error-box">{errors.frag}</div> : (
              <div className="card">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Base</th><th>Table</th><th>Index</th><th className="text-right">Fragm.</th><th className="text-right">Pages</th><th>Action</th><th></th></tr></thead>
                    <tbody>
                      {fragData.map((f, i) => (
                        <React.Fragment key={i}>
                          <tr style={{ cursor: f.action_script ? 'pointer' : 'default' }} onClick={() => f.action_script && setExpandedFrag(expandedFrag===i?null:i)}>
                            <td><span className="badge badge-neutral">{f.database_name}</span></td>
                            <td className="text-mono text-sm">{f.table_name}</td>
                            <td className="text-sm" style={{ color:'var(--text-muted)' }}>{f.index_name}</td>
                            <td className="text-right text-mono" style={{ color: FRAG_COLOR(f.avg_fragmentation_pct), fontWeight:700 }}>{f.avg_fragmentation_pct}%</td>
                            <td className="text-right text-mono">{fmt(f.page_count)}</td>
                            <td>
                              {f.recommendation === 'REBUILD'    && <span className="badge badge-critical">REBUILD</span>}
                              {f.recommendation === 'REORGANIZE' && <span className="badge badge-warning">REORGANIZE</span>}
                              {f.recommendation === 'MONITOR'    && <span className="badge badge-neutral">MONITOR</span>}
                            </td>
                            <td>{f.action_script && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{expandedFrag===i?'▲':'▼'}</span>}</td>
                          </tr>
                          {expandedFrag === i && f.action_script && (
                            <tr><td colSpan={7} style={{ padding:'0 14px 14px' }}>
                              <pre className="sql-block">{f.action_script}</pre>
                              <button className="copy-btn" style={{ marginTop:6 }} onClick={() => copy(f.action_script)}>📋 Copier</button>
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Charts ── */}
        {activeTab === 'charts' && (
          <ChartsTab
            waitStats={waitStats}
            queries={queries}
            fragData={fragData}
            health={health}
            missingIdx={missingIdx}
            blocking={blocking}
            idxUsage={idxUsage}
            score={score}
            scoreColor={scoreColor}
            onLoadQueries={() => loadQueries(querySortBy)}
            onLoadWaits={loadWaitStats}
          />
        )}

        {/* ── Tab: Blocking ── */}
        {activeTab === 'blocking' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <h2 style={{ fontSize:16, fontWeight:700 }}>🚧 Blocages actifs</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadBlocking} disabled={loading.blocking}>{loading.blocking ? <div className="spinner"/> : '↻ Actualiser'}</button>
              {blocking.length === 0
                ? <span className="badge badge-success">✓ Aucun blocage</span>
                : <span className="badge badge-critical">{blocking.filter(b=>b.blocking_session_id>0).length} session(s) bloquée(s)</span>}
            </div>
            {loading.blocking ? <div className="loading-state"><div className="spinner"/> Vérification…</div> :
             errors.blocking  ? <div className="error-box">{errors.blocking}</div> :
             blocking.length === 0 ? <div className="card"><div className="empty-state">✅ Aucun blocage actif — tout va bien!</div></div> : (
              <div className="card">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead><tr><th>SPID</th><th>Bloqué par</th><th>Base</th><th>Login</th><th>Hôte</th><th>Commande</th><th className="text-right">Attente</th><th>Requête</th></tr></thead>
                    <tbody>
                      {blocking.map((b, i) => (
                        <tr key={i} style={{ background: b.blocking_session_id > 0 ? 'rgba(239,68,68,0.04)' : undefined }}>
                          <td className="text-mono" style={{ fontWeight:700 }}>{b.session_id}</td>
                          <td className="text-mono">{b.blocking_session_id > 0 ? <span style={{ color:'#ef4444', fontWeight:700 }}>→ {b.blocking_session_id}</span> : <span style={{ color:'#10b981' }}>BLOQUANT</span>}</td>
                          <td><span className="badge badge-neutral">{b.database_name}</span></td>
                          <td className="text-sm">{b.login_name}</td>
                          <td className="text-sm">{b.host_name}</td>
                          <td><span className="badge badge-neutral">{b.command}</span></td>
                          <td className="text-right text-mono" style={{ color: b.wait_time_ms > 30000 ? '#ef4444' : 'var(--text)' }}>{fmtMs(b.wait_time_ms)}</td>
                          <td style={{ maxWidth:200 }}><code style={{ fontSize:10, color:'#a5b4fc', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.query_text?.trim().slice(0,80)}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
