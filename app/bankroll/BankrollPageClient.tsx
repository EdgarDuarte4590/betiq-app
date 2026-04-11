'use client';

import { useState, useTransition } from 'react';
import { DollarSign, Edit3, Check, X, LineChart } from 'lucide-react';
import { updateBankrollSettings } from '@/app/actions/bets';
import BankrollWidget from '@/components/bankroll/BankrollWidget';

interface Props {
  bankrollActual: number;
  bankrollInicial: number;
  roi: number;
  winRate: number;
  totalProfit: number;
  totalBets: number;
}

export default function BankrollPageClient({
  bankrollActual,
  bankrollInicial,
  roi,
  winRate,
  totalProfit,
  totalBets,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [newBankroll, setNewBankroll] = useState(String(bankrollActual));
  const [newInicial, setNewInicial] = useState(String(bankrollInicial));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateBankrollSettings(
        parseFloat(newInicial) || bankrollInicial,
        parseFloat(newBankroll) || bankrollActual
      );
      if (res.success) {
        setFeedback('✅ Bankroll actualizado correctamente.');
        setEditing(false);
      } else {
        setFeedback(`❌ Error: ${res.error}`);
      }
    });
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <DollarSign size={28} color="var(--accent-green)" />
          Gestor de Bankroll
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.5rem' }}>
          Control matemático de tu capital. Registra apuestas y sigue tu evolución.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '2rem', alignItems: 'start' }}>

        {/* Left: Widget + Edición */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <BankrollWidget />

          {/* Editar Bankroll */}
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
                  <span style={{ fontWeight: 600 }}>${bankrollInicial.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>Capital actual</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${bankrollActual.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
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

        {/* Right: Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            {[
              { label: 'Profit Total', value: `${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' },
              { label: 'ROI / Yield', value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? 'var(--accent-gold)' : 'var(--accent-red)' },
              { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, color: winRate >= 55 ? 'var(--accent-green)' : winRate >= 40 ? 'var(--accent-gold)' : 'var(--accent-red)' },
              { label: 'Total Apuestas', value: String(totalBets), color: 'var(--foreground)' },
            ].map(({ label, value, color }, i) => (
              <div key={i} className="stat-card">
                <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Graph Placeholder */}
          <div className="card" style={{ height: 280, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border)' }}>
            <LineChart size={48} color="var(--border)" style={{ marginBottom: '1rem' }} />
            <h3 style={{ color: 'var(--foreground)', fontSize: '1rem', fontWeight: 600 }}>Gráfico de Evolución</h3>
            <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: 8, maxWidth: 320 }}>
              El gráfico de crecimiento del bankroll se habilitará cuando tengas más de 5 apuestas cerradas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
