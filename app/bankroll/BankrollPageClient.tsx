'use client';

import { useState, useTransition } from 'react';
import { DollarSign, Edit3, Check, X, TrendingUp, TrendingDown } from 'lucide-react';
import { updateBankrollSettings } from '@/app/actions/bets';
import BankrollWidget from '@/components/bankroll/BankrollWidget';
import { useBankrollStore } from '@/lib/store/bankrollStore';

interface Props {
  bankrollActual: number;
  bankrollInicial: number;
  roi: number;
  winRate: number;
  totalProfit: number;
  totalBets: number;
  bets: { status: string; stake: number; profit: number; created_at: string }[];
}

export default function BankrollPageClient({
  bankrollActual,
  bankrollInicial,
  roi,
  winRate,
  totalProfit,
  totalBets,
  bets,
}: Props) {
  const [actualState, setActualState] = useState(bankrollActual);
  const [inicialState, setInicialState] = useState(bankrollInicial);
  const [editing, setEditing] = useState(false);
  const [newBankroll, setNewBankroll] = useState(String(bankrollActual));
  const [newInicial, setNewInicial] = useState(String(bankrollInicial));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { setBankroll } = useBankrollStore();

  const handleSave = () => {
    startTransition(async () => {
      const parsedInicial = parseFloat(newInicial);
      const updatedInicial = isNaN(parsedInicial) ? inicialState : parsedInicial;

      const parsedActual = parseFloat(newBankroll);
      const updatedActual = isNaN(parsedActual) ? actualState : parsedActual;

      const res = await updateBankrollSettings(updatedInicial, updatedActual);
      if (res.success) {
        setBankroll(updatedActual);
        setActualState(updatedActual);
        setInicialState(updatedInicial);
        setFeedback('✅ Bankroll actualizado correctamente.');
        setEditing(false);
      } else {
        setFeedback(`❌ Error: ${res.error}`);
      }
    });
  };

  // ── Build bankroll evolution chart from closed bets ──
  const closedBets = bets
    .filter(b => b.status === 'won' || b.status === 'lost')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Calculate running bankroll from the initial
  const chartPoints: { label: string; value: number }[] = [];
  let running = bankrollInicial;
  closedBets.forEach((bet, i) => {
    running += bet.profit;
    chartPoints.push({
      label: `#${i + 1}`,
      value: Math.max(0, running),
    });
  });

  const maxVal = chartPoints.length > 0 ? Math.max(...chartPoints.map(p => p.value), bankrollInicial) : bankrollInicial;
  const minVal = chartPoints.length > 0 ? Math.min(...chartPoints.map(p => p.value), bankrollInicial) : 0;
  const range = maxVal - minVal || 1;

  return (
    <div>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <DollarSign size={22} color="var(--accent-green)" />
          Gestor de Bankroll
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Control matemático de tu capital. Registra apuestas y sigue tu evolución.
        </p>
      </header>

      {/* Responsive two-column grid — stacks on mobile */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))',
        gap: '1rem',
        alignItems: 'start',
        marginBottom: '1.5rem',
      }}>
        {/* Left: Widget + Edit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <BankrollWidget />

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>⚙️ Ajustes de Capital</span>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: 'var(--background-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--foreground-muted)' }}
                >
                  <Edit3 size={12} /> Editar
                </button>
              )}
            </div>

            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Bankroll Inicial (referencia)</label>
                  <input
                    type="number"
                    value={newInicial}
                    onChange={e => setNewInicial(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Bankroll Actual Real ($)</label>
                  <input
                    type="number"
                    value={newBankroll}
                    onChange={e => setNewBankroll(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: 7, border: '1px solid var(--accent-green)', background: 'rgba(0,214,143,0.05)', color: 'var(--accent-green)', fontWeight: 700 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => { setEditing(false); setFeedback(null); }}
                    style={{ flex: 1, padding: '0.6rem', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    <X size={14} style={{ display: 'inline', marginRight: 4 }} />Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="btn-primary"
                    style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem' }}
                  >
                    <Check size={14} /> {isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>Capital inicial</span>
                  <span style={{ fontWeight: 600 }}>${inicialState.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>Capital actual</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${actualState.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            )}

            {feedback && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--foreground-muted)' }}>
                {feedback}
              </div>
            )}
          </div>
        </div>

        {/* Right: KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {[
            { label: 'Profit Total', value: `${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', Icon: totalProfit >= 0 ? TrendingUp : TrendingDown },
            { label: 'ROI / Yield', value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? 'var(--accent-gold)' : 'var(--accent-red)', Icon: TrendingUp },
            { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, color: winRate >= 55 ? 'var(--accent-green)' : winRate >= 40 ? 'var(--accent-gold)' : 'var(--accent-red)', Icon: TrendingUp },
            { label: 'Total Apuestas', value: String(totalBets), color: 'var(--foreground)', Icon: TrendingUp },
          ].map(({ label, value, color, Icon }, i) => (
            <div key={i} className="stat-card">
              <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {label}
                <Icon size={12} color={color} />
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bankroll Evolution Chart ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} color="var(--accent-green)" />
            Evolución del Bankroll
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>
            Basado en {closedBets.length} apuestas cerradas
          </div>
        </div>

        {chartPoints.length < 2 ? (
          <div style={{ height: 200, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <TrendingUp size={36} color="var(--border)" style={{ marginBottom: 12 }} />
            <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
              El gráfico aparecerá cuando tengas al menos 2 apuestas cerradas (ganadas o perdidas).
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <svg
              viewBox={`0 0 ${Math.max(chartPoints.length * 40 + 40, 300)} 180`}
              style={{ width: '100%', minWidth: 300, height: 180, display: 'block' }}
            >
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                const y = 20 + (1 - ratio) * 140;
                const val = minVal + ratio * range;
                return (
                  <g key={i}>
                    <line x1="40" y1={y} x2={chartPoints.length * 40 + 10} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    <text x="35" y={y + 4} fontSize="9" fill="var(--foreground-muted)" textAnchor="end">${Math.round(val)}</text>
                  </g>
                );
              })}

              {/* Area fill */}
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-green)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--accent-green)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#areaGrad)"
                stroke="none"
                points={[
                  `40,${20 + (1 - (bankrollInicial - minVal) / range) * 140}`,
                  ...chartPoints.map((p, i) => `${(i + 1) * 40 + 10},${20 + (1 - (p.value - minVal) / range) * 140}`),
                  `${chartPoints.length * 40 + 10},160`,
                  `40,160`,
                ].join(' ')}
              />

              {/* Line */}
              <polyline
                fill="none"
                stroke="var(--accent-green)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={[
                  `40,${20 + (1 - (bankrollInicial - minVal) / range) * 140}`,
                  ...chartPoints.map((p, i) => `${(i + 1) * 40 + 10},${20 + (1 - (p.value - minVal) / range) * 140}`),
                ].join(' ')}
              />

              {/* Dots */}
              {chartPoints.map((p, i) => {
                const cx = (i + 1) * 40 + 10;
                const cy = 20 + (1 - (p.value - minVal) / range) * 140;
                const isWin = bets.filter(b => b.status === 'won' || b.status === 'lost')[i]?.profit >= 0;
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r="4"
                    fill={isWin ? 'var(--accent-green)' : 'var(--accent-red)'}
                    stroke="var(--background-card)"
                    strokeWidth="2"
                  />
                );
              })}

              {/* Labels */}
              {chartPoints.map((p, i) => (
                <text key={i} x={(i + 1) * 40 + 10} y="175" fontSize="9" fill="var(--foreground-muted)" textAnchor="middle">
                  {p.label}
                </text>
              ))}
            </svg>

            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)', display: 'inline-block' }} />
                Apuesta ganada
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-red)', display: 'inline-block' }} />
                Apuesta perdida
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
