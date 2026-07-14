'use client';
import React, { useState, useEffect, useRef } from 'react';

// ─── Types (miroirs de page.tsx) ───────────────────────────────────────────────
interface WaitRow   { wait_type: string; wait_s: number; resource_s: number; signal_s: number; pct: number; category: string; }
interface QueryRow  { query_text: string; execution_count: number; total_cpu_ms: number; avg_cpu_ms: number; total_reads: number; avg_reads: number; total_duration_ms: number; avg_duration_ms: number; }
interface FragRow   { database_name: string; table_name: string; index_name: string; avg_fragmentation_pct: number; page_count: number; recommendation: string; action_script: string; }
interface IndexRow  { user_seeks: number; user_scans: number; user_lookups: number; user_updates: number; recommendation: string; }
interface MissingIdx { avg_user_impact: number; score: number; }
interface BlockRow  { session_id: number; blocking_session_id: number; }
interface Health    { cpuCount: number; memTotal: number; memInUse: number; memPct: number; activeConnections: number; uptimeHours: number; databases: { name: string; sizeGb: number }[]; }

interface Props {
  waitStats:  WaitRow[];
  queries:    QueryRow[];
  fragData:   FragRow[];
  health:     Health | null;
  missingIdx: MissingIdx[];
  blocking:   BlockRow[];
  idxUsage:   IndexRow[];
  score:      number;
  scoreColor: string;
  onLoadQueries: () => void;
  onLoadWaits:   () => void;
}

// ─── Couleurs par catégorie de wait ───────────────────────────────────────────
const WAIT_COLORS: Record<string, string> = {
  'CPU':     '#6366f1',
  'I/O':     '#f59e0b',
  'Memory':  '#ec4899',
  'Lock':    '#ef4444',
  'Network': '#10b981',
  'HA/DR':   '#8b5cf6',
  'Other':   '#6b7280',
};

const CHART_PALETTE = ['#6366f1','#f59e0b','#10b981','#ef4444','#ec4899','#8b5cf6','#3b82f6','#6b7280'];

const fmtMs = (ms: number) => ms > 60000 ? `${(ms/60000).toFixed(1)} min` : ms > 1000 ? `${(ms/1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
const fmt   = (n: number, d = 0) => n?.toLocaleString('fr-CA', { maximumFractionDigits: d }) ?? '—';

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <foreignObject x={x + 10} y={y - 14} width={240} height={70} style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <div style={{
        background: 'rgba(8,9,14,0.96)',
        border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 11,
        color: '#e8eaf2',
        whiteSpace: 'pre-line',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(12px)',
        width: 'max-content',
        maxWidth: 240,
      }}>
        {text}
      </div>
    </foreignObject>
  );
}

// ─── 1. Donut — Waits par catégorie ───────────────────────────────────────────

function WaitDonut({ data }: { data: WaitRow[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => { setTimeout(() => setAnimated(true), 100); }, [data]);

  if (!data.length) return <EmptyState msg="Lancez l'analyse Wait Stats d'abord" />;

  // Agréger par catégorie
  const byCategory: Record<string, number> = {};
  for (const r of data) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.wait_s;
  }
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const CX = 120, CY = 120, R = 90, RI = 54;
  let angle = -Math.PI / 2;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={240} height={240} style={{ flexShrink: 0, overflow: 'visible' }}>
        {entries.map(([cat, val], i) => {
          const color = WAIT_COLORS[cat] ?? CHART_PALETTE[i % CHART_PALETTE.length];
          const slice  = (val / total) * 2 * Math.PI;
          const a0 = angle; angle += slice; const a1 = angle;
          const x1 = CX + R * Math.cos(a0), y1 = CY + R * Math.sin(a0);
          const x2 = CX + R * Math.cos(a1), y2 = CY + R * Math.sin(a1);
          const xi1 = CX + RI * Math.cos(a0), yi1 = CY + RI * Math.sin(a0);
          const xi2 = CX + RI * Math.cos(a1), yi2 = CY + RI * Math.sin(a1);
          const lg = slice > Math.PI ? 1 : 0;
          const d = `M${x1} ${y1} A${R} ${R} 0 ${lg} 1 ${x2} ${y2} L${xi2} ${yi2} A${RI} ${RI} 0 ${lg} 0 ${xi1} ${yi1}Z`;
          const pct = ((val / total) * 100).toFixed(1);
          const mid = a0 + slice / 2;
          return (
            <path key={cat} d={d} fill={color}
              opacity={animated ? 0.9 : 0}
              style={{ transition: `opacity 0.5s ease ${i * 80}ms`, cursor: 'crosshair', stroke: '#08090e', strokeWidth: 2 }}
              onMouseMove={e => { const r2 = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect(); setTip({ x: e.clientX - r2.left, y: e.clientY - r2.top, text: `${cat}\n${val.toFixed(1)} s (${pct}%)` }); }}
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
        <text x={CX} y={CY - 8} textAnchor="middle" fill="#e8eaf2" fontSize={18} fontWeight={700}>{entries.length}</text>
        <text x={CX} y={CY + 12} textAnchor="middle" fill="#6b7280" fontSize={10}>catégories</text>
        {tip && <Tooltip x={tip.x} y={tip.y} text={tip.text} />}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {entries.map(([cat, val], i) => {
          const color = WAIT_COLORS[cat] ?? CHART_PALETTE[i % CHART_PALETTE.length];
          const pct   = ((val / total) * 100).toFixed(1);
          return (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{cat}</span>
                  <span style={{ color: '#6b7280' }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
                  <div style={{ height: '100%', width: animated ? `${pct}%` : '0%', background: color, borderRadius: 2, transition: `width 0.7s ease ${i * 80}ms` }} />
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{val.toFixed(1)} s</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 2. Barres horizontales — Top 10 requêtes CPU ─────────────────────────────

function QueryCpuBars({ data }: { data: QueryRow[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => { setTimeout(() => setAnimated(true), 150); }, [data]);

  if (!data.length) return <EmptyState msg="Lancez l'analyse Top Requêtes d'abord" />;

  const top10 = data.slice(0, 10);
  const maxCpu = Math.max(...top10.map(q => q.total_cpu_ms), 1);
  const ROW_H = 36, PAD_L = 0, BAR_H = 16, W = 560;

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${top10.length * ROW_H + 8}`} style={{ width: '100%', minWidth: 320, overflow: 'visible' }}>
        {top10.map((q, i) => {
          const barW  = animated ? (q.total_cpu_ms / maxCpu) * (W - PAD_L - 70) : 0;
          const y     = 4 + i * ROW_H;
          const label = (q.query_text ?? '').trim().replace(/\s+/g, ' ').slice(0, 45);
          return (
            <g key={i}
              onMouseMove={e => { const r2 = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect(); setTip({ x: e.clientX - r2.left, y: e.clientY - r2.top, text: `${label}\nCPU total : ${fmtMs(q.total_cpu_ms)}\nExéc : ${fmt(q.execution_count)}\nCPU moy : ${fmtMs(q.avg_cpu_ms)}` }); }}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: 'crosshair' }}
            >
              {/* Fond de ligne alterné */}
              <rect x={0} y={y - 2} width={W} height={ROW_H - 2} fill={i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'} rx={4} />
              {/* Barre CPU */}
              <rect x={PAD_L} y={y + (ROW_H - BAR_H) / 2 - 10} width={barW} height={BAR_H}
                fill={`url(#cpuGrad)`} rx={4} opacity={0.85}
                style={{ transition: `width 0.75s cubic-bezier(0.34,1.56,0.64,1) ${i * 40}ms` }}
              />
              {/* Label */}
              <text x={PAD_L + 6} y={y + (ROW_H - BAR_H) / 2 + BAR_H - 14} fontSize={9} fill="rgba(255,255,255,0.55)">
                {label || '(requête sans texte)'}
              </text>
              {/* Valeur CPU */}
              <text x={W - 4} y={y + ROW_H / 2 - 5} fontSize={10} fill="#a5b4fc" textAnchor="end" fontWeight={600}>
                {fmtMs(q.total_cpu_ms)}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="cpuGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        {tip && <Tooltip x={tip.x} y={tip.y} text={tip.text} />}
      </svg>
    </div>
  );
}

// ─── 3. Scatter Fragmentation — % vs pages ────────────────────────────────────

function FragScatter({ data }: { data: FragRow[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => { setTimeout(() => setAnimated(true), 150); }, [data]);

  if (!data.length) return <EmptyState msg="Lancez l'analyse Fragmentation d'abord" />;

  const W = 500, H = 220, PL = 50, PB = 36, PT = 12, PR = 12;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const maxPages = Math.max(...data.map(d => d.page_count), 1);

  const FRAG_COLOR = (pct: number) => pct > 30 ? '#ef4444' : pct > 10 ? '#f59e0b' : '#10b981';

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', overflow: 'visible' }}>
        {/* Grid */}
        {yTicks.map(v => {
          const y = PT + chartH - (v / 100) * chartH;
          return (
            <g key={v}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <text x={PL - 6} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize={9}>{v}%</text>
            </g>
          );
        })}
        {/* Zone rouge > 30% */}
        <rect x={PL} y={PT} width={chartW} height={(1 - 30/100) * chartH} fill="rgba(239,68,68,0.04)" />
        {/* Zone orange 10-30% */}
        <rect x={PL} y={PT + (1 - 30/100) * chartH} width={chartW} height={(20/100) * chartH} fill="rgba(245,158,11,0.04)" />
        {/* Ligne 30% */}
        <line x1={PL} y1={PT + (1 - 30/100) * chartH} x2={W - PR} y2={PT + (1 - 30/100) * chartH}
          stroke="rgba(239,68,68,0.25)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={W - PR - 2} y={PT + (1 - 30/100) * chartH - 3} fontSize={8} fill="rgba(239,68,68,0.5)" textAnchor="end">REBUILD</text>
        {/* Points */}
        {data.map((d, i) => {
          const cx = PL + (d.page_count / maxPages) * chartW;
          const cy = PT + chartH - (d.avg_fragmentation_pct / 100) * chartH;
          const r  = Math.max(3, Math.min(10, d.page_count / maxPages * 14));
          const col = FRAG_COLOR(d.avg_fragmentation_pct);
          const tbl = (d.table_name ?? '').split('.').pop()?.replace(/\[|\]/g, '') ?? '';
          return (
            <circle key={i} cx={animated ? cx : PL} cy={animated ? cy : PT + chartH}
              r={r} fill={col} opacity={0.75} style={{ cursor: 'crosshair', stroke: col, strokeWidth: 1, strokeOpacity: 0.4, transition: `cx 0.6s ease ${i * 15}ms, cy 0.6s ease ${i * 15}ms` }}
              onMouseMove={e => { const r2 = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect(); setTip({ x: e.clientX - r2.left, y: e.clientY - r2.top, text: `${d.database_name} › ${tbl}\n${d.index_name}\nFragm : ${d.avg_fragmentation_pct}%\nPages : ${fmt(d.page_count)}` }); }}
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
        {/* Axes */}
        <line x1={PL} y1={PT} x2={PL} y2={PT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        <text x={W/2} y={H - 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}>Nombre de pages →</text>
        {tip && <Tooltip x={tip.x} y={tip.y} text={tip.text} />}
        {/* Légende */}
        <g transform={`translate(${PL + 4}, ${PT + 6})`}>
          {[['#10b981','< 10%'],['#f59e0b','10–30%'],['#ef4444','> 30%']].map(([c, l], i) => (
            <g key={i} transform={`translate(${i * 70}, 0)`}>
              <circle cx={5} cy={5} r={5} fill={c} opacity={0.8} />
              <text x={13} y={9} fill="rgba(255,255,255,0.5)" fontSize={9}>{l}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ─── 4. Jauge santé globale + mini KPIs ────────────────────────────────────────

function HealthGauge({ health, score, scoreColor, missingIdx, fragData, blocking, idxUsage }: {
  health: Health | null; score: number; scoreColor: string;
  missingIdx: MissingIdx[]; fragData: FragRow[]; blocking: BlockRow[]; idxUsage: IndexRow[];
}) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => { setTimeout(() => setAnimated(true), 100); }, [score]);

  // ─ Score arc ─
  const R = 80, CX = 110, CY = 110;
  const startAngle = Math.PI;
  const sweep = Math.PI; // demi-cercle
  const circ  = Math.PI * R;
  const progress = animated ? (score / 100) : 0;

  // ─ Métriques ─
  const metrics = [
    { label: 'Index manquants',    val: missingIdx.length, warn: 5,   danger: 20, fmt: (v: number) => String(v) },
    { label: 'Fragm. critique',    val: fragData.filter(f => f.avg_fragmentation_pct > 30).length, warn: 3, danger: 10, fmt: (v: number) => String(v) },
    { label: 'Blocages actifs',    val: blocking.filter(b => b.blocking_session_id > 0).length, warn: 1, danger: 5, fmt: (v: number) => String(v) },
    { label: 'Index à évaluer',    val: idxUsage.filter(i => i.recommendation !== 'OK').length, warn: 5, danger: 20, fmt: (v: number) => String(v) },
    { label: 'Utilisation mémoire', val: health?.memPct ?? 0, warn: 75, danger: 90, fmt: (v: number) => `${v}%` },
    { label: 'Connexions',         val: health?.activeConnections ?? 0, warn: 50, danger: 200, fmt: (v: number) => String(v) },
  ];

  return (
    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Jauge demi-cercle */}
      <div style={{ textAlign: 'center', minWidth: 220 }}>
        <svg width={220} height={130} viewBox="0 0 220 130" style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#ef4444" />
              <stop offset="45%"  stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          {/* Fond */}
          <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={14} strokeLinecap="round" />
          {/* Arc coloré */}
          <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none" stroke="url(#gaugeGrad)" strokeWidth={14} strokeLinecap="round"
            strokeDasharray={`${circ * progress} ${circ}`}
            style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)' }}
          />
          {/* Aiguille */}
          {(() => {
            const a = startAngle + sweep * progress;
            const px = CX + (R) * Math.cos(a), py = CY + (R) * Math.sin(a);
            const nx = CX + 6 * Math.cos(a + Math.PI / 2), ny = CY + 6 * Math.sin(a + Math.PI / 2);
            return animated && (
              <g style={{ transition: 'all 1.2s cubic-bezier(0.34,1.56,0.64,1)' }}>
                <line x1={CX} y1={CY} x2={px} y2={py} stroke={scoreColor} strokeWidth={3} strokeLinecap="round" />
                <circle cx={CX} cy={CY} r={7} fill={scoreColor} opacity={0.9} />
              </g>
            );
          })()}
          {/* Labels */}
          <text x={CX - R - 4} y={CY + 18} fill="#ef4444" fontSize={9} textAnchor="middle">0</text>
          <text x={CX}         y={CY - R - 8} fill="#f59e0b" fontSize={9} textAnchor="middle">50</text>
          <text x={CX + R + 4} y={CY + 18} fill="#10b981" fontSize={9} textAnchor="middle">100</text>
          {/* Score */}
          <text x={CX} y={CY + 6} textAnchor="middle" fill={scoreColor} fontSize={28} fontWeight={800}>
            {score}
          </text>
          <text x={CX} y={CY + 22} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={10}>/100</text>
        </svg>
        <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor, marginTop: 4 }}>
          {score >= 80 ? '✅ Bonne santé' : score >= 60 ? '⚠️ Attention requise' : '🚨 Action urgente'}
        </div>
      </div>

      {/* Métriques */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1, minWidth: 260 }}>
        {metrics.map(m => {
          const color = m.val >= m.danger ? '#ef4444' : m.val >= m.warn ? '#f59e0b' : '#10b981';
          return (
            <div key={m.label} style={{
              background: 'var(--surface-2, #1a1b27)',
              border: `1px solid ${color}28`,
              borderRadius: 10, padding: '12px 16px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color }}>{m.fmt(m.val)}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
              {/* Mini barre */}
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: animated ? `${Math.min((m.val / m.danger) * 100, 100)}%` : '0%',
                  background: color, borderRadius: 2,
                  transition: 'width 0.8s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 5. Index usage — lecture vs écriture (bubble chart) ─────────────────────

function IndexReadWriteChart({ data }: { data: IndexRow[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => { setTimeout(() => setAnimated(true), 150); }, [data]);

  const top = data.slice(0, 30);
  if (!top.length) return <EmptyState msg="Lancez l'analyse Index Usage d'abord" />;

  const W = 500, H = 200, PL = 50, PB = 36, PT = 12, PR = 12;
  const chartW = W - PL - PR, chartH = H - PT - PB;
  const maxR = Math.max(...top.map(d => d.user_seeks + d.user_scans + d.user_lookups), 1);
  const maxW = Math.max(...top.map(d => d.user_updates), 1);

  const xTicks = [0, 25, 50, 75, 100];
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', overflow: 'visible' }}>
        {/* Grid */}
        {yTicks.map((v, i) => {
          const y = PT + chartH - (v / 100) * chartH;
          return <line key={i} x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />;
        })}
        {xTicks.map((v, i) => {
          const x = PL + (v / 100) * chartW;
          return <line key={i} x1={x} y1={PT} x2={x} y2={PT + chartH} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />;
        })}

        {/* Diagonale : équilibre lecture/écriture */}
        <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="4 4" />

        {/* Points */}
        {top.map((d, i) => {
          const reads   = d.user_seeks + d.user_scans + d.user_lookups;
          const cx = PL + (reads / maxR) * chartW;
          const cy = PT + chartH - (d.user_updates / maxW) * chartH;
          const rec = d.recommendation;
          const color = rec === 'UNUSED_HIGH_MAINT' ? '#ef4444' : rec === 'UNUSED' ? '#f59e0b' : rec === 'HIGH_WRITE_LOW_READ' ? '#ec4899' : '#10b981';
          return (
            <circle key={i} cx={animated ? cx : PL} cy={animated ? cy : PT + chartH}
              r={5} fill={color} opacity={0.7}
              style={{ cursor: 'crosshair', stroke: color, strokeWidth: 1, strokeOpacity: 0.3, transition: `cx 0.6s ease ${i * 10}ms, cy 0.6s ease ${i * 10}ms` }}
              onMouseMove={e => { const r2 = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect(); setTip({ x: e.clientX - r2.left, y: e.clientY - r2.top, text: `Lectures : ${fmt(reads)}\nÉcritures : ${fmt(d.user_updates)}\n${rec}` }); }}
              onMouseLeave={() => setTip(null)}
            />
          );
        })}

        <line x1={PL} y1={PT} x2={PL} y2={PT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        <line x1={PL} y1={PT + chartH} x2={W - PR} y2={PT + chartH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        <text x={W / 2} y={H - 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}>Lectures →</text>
        <text x={PL - 10} y={PT + chartH / 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}
          transform={`rotate(-90, ${PL - 30}, ${PT + chartH / 2})`}>Écritures ↑</text>

        {/* Légende */}
        <g transform={`translate(${PL + 4}, ${PT + 4})`}>
          {[['#10b981','OK'],['#f59e0b','Inutilisé'],['#ef4444','Coûteux'],['#ec4899','Trop d\'écrit.']].map(([c, l], i) => (
            <g key={i} transform={`translate(${i * 80}, 0)`}>
              <circle cx={5} cy={5} r={4} fill={c} opacity={0.8} />
              <text x={13} y={9} fill="rgba(255,255,255,0.4)" fontSize={8}>{l}</text>
            </g>
          ))}
        </g>

        {tip && <Tooltip x={tip.x} y={tip.y} text={tip.text} />}
      </svg>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: '#4b5563' }}>
      <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ marginBottom: 8, opacity: 0.4 }}>
        <rect x={3} y={3} width={18} height={18} rx={2} /><path d="M3 9h18M9 21V9" />
      </svg>
      <div style={{ fontSize: 13 }}>{msg}</div>
    </div>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function ChartCard({ title, icon, color, action, children }: {
  title: string; icon: string; color: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--surface, #13141c)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14, padding: '20px 22px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Glow */}
      <div style={{ position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%', background: color, opacity: 0.06, filter: 'blur(40px)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
          <span style={{ fontSize: 16 }}>{icon}</span> {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Composant principal ChartsTab ────────────────────────────────────────────

export default function ChartsTab({ waitStats, queries, fragData, health, missingIdx, blocking, idxUsage, score, scoreColor, onLoadQueries, onLoadWaits }: Props) {

  const btnStyle: React.CSSProperties = {
    fontSize: 11, padding: '4px 10px', borderRadius: 6,
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
  };

  return (
    <div>
      {/* En-tête */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📈</span> Tableau de bord — Graphiques
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          Visualisation des métriques de performance SQL Server en temps réel
        </p>
      </div>

      {/* Grille : 2 colonnes sur grand écran */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16 }}>

        {/* 1. Jauge globale — pleine largeur */}
        <div style={{ gridColumn: '1 / -1' }}>
          <ChartCard title="Score de santé global" icon="🏥" color="#6366f1">
            <HealthGauge
              health={health}
              score={score}
              scoreColor={scoreColor}
              missingIdx={missingIdx}
              fragData={fragData}
              blocking={blocking}
              idxUsage={idxUsage}
            />
          </ChartCard>
        </div>

        {/* 2. Donut Wait Stats */}
        <ChartCard title="Waits par catégorie" icon="⏳" color="#f59e0b"
          action={
            waitStats.length === 0
              ? <button style={btnStyle} onClick={onLoadWaits}>↻ Charger</button>
              : <span style={{ fontSize: 11, color: '#6b7280' }}>{waitStats.length} types</span>
          }
        >
          <WaitDonut data={waitStats} />
        </ChartCard>

        {/* 3. Top Requêtes CPU */}
        <ChartCard title="Top 10 requêtes — CPU total" icon="🔥" color="#6366f1"
          action={
            queries.length === 0
              ? <button style={btnStyle} onClick={onLoadQueries}>↻ Charger</button>
              : <span style={{ fontSize: 11, color: '#6b7280' }}>{queries.length} requêtes</span>
          }
        >
          <QueryCpuBars data={queries} />
        </ChartCard>

        {/* 4. Fragmentation scatter */}
        <ChartCard title="Fragmentation — % vs pages" icon="🧩" color="#ec4899">
          <FragScatter data={fragData} />
        </ChartCard>

        {/* 5. Index lecture vs écriture */}
        <ChartCard title="Index — Lectures vs Écritures" icon="📊" color="#10b981">
          <IndexReadWriteChart data={idxUsage} />
        </ChartCard>

      </div>
    </div>
  );
}
