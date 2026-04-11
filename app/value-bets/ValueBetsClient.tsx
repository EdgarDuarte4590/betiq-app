'use client';

import { useState } from 'react';
import { Zap, AlertCircle, Search, Filter } from 'lucide-react';
import type { ValueBetOpportunity } from '@/lib/algorithms/value-bet-calculator';
import { getSportMeta } from '@/lib/apis/odds-api';
import { useBankrollStore } from '@/lib/store/bankrollStore';

interface Props {
  initialBets: ValueBetOpportunity[];
}

export default function ValueBetsClient({ initialBets }: Props) {
  const { openModal, bankroll } = useBankrollStore();

  const [minOdds, setMinOdds] = useState('1.5');
  const [maxOdds, setMaxOdds] = useState('5.0');
  const [minValue, setMinValue] = useState('2.0');
  const [sportFilter, setSportFilter] = useState('Todos');

  // Filter logic
  const filteredBets = initialBets.filter((vb) => {
    // Sport
    if (sportFilter !== 'Todos' && !vb.sport.includes(sportFilter)) return false;
    
    // Odds
    const minO = parseFloat(minOdds) || 1.1;
    const maxO = parseFloat(maxOdds) || 100;
    if (vb.oddsBest < minO || vb.oddsBest > maxO) return false;

    // Value
    const minV = parseFloat(minValue) || 0;
    if (vb.valuePercentage < minV) return false;

    return true;
  });

  const handleRowClick = (vb: ValueBetOpportunity) => {
    const { icon } = getSportMeta(vb.sport);
    const realBankroll = bankroll > 0 ? bankroll : 1000;
    const suggestedStake = vb.kellyStake > 0 
      ? ((realBankroll * vb.kellyStake) / 100).toFixed(2) 
      : '50';

    openModal({
      match: vb.event,
      odds: vb.oddsBest.toFixed(2),
      stake: suggestedStake,
      sport: icon,
      league: vb.league,
      pick: vb.pick,
    });
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Zap size={26} color="var(--accent-green)" />
          Value Bets Scanner
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Filtra, analiza y caza discrepancias matemáticas extremas antes de que bajen las cuotas.
        </p>
      </header>

      {/* ── Filters Section ── */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', fontWeight: 700, fontSize: '0.9rem' }}>
          <Filter size={16} color="var(--accent-gold)" /> Filtros Rápidos
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Deporte</label>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)' }}
            >
              <option value="Todos">Todos</option>
              <option value="soccer">Fútbol</option>
              <option value="basketball">Básquetbol</option>
              <option value="baseball">Béisbol</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Cuota Mínima</label>
            <input
              type="number" step="0.1"
              value={minOdds} onChange={(e) => setMinOdds(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Cuota Máxima</label>
            <input
              type="number" step="0.1"
              value={maxOdds} onChange={(e) => setMaxOdds(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Valor Mínimo (+ %)</label>
            <input
              type="number" step="1" min="1" max="50"
              value={minValue} onChange={(e) => setMinValue(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid var(--accent-green)', background: 'rgba(0,214,143,0.05)', color: 'var(--accent-green)', fontWeight: 700 }}
            />
          </div>
        </div>
      </div>

      {/* ── Results List ── */}
      {filteredBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <Search size={44} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>Ninguna apuesta pasa el filtro</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', maxWidth: 400, margin: '0 auto' }}>
            Prueba bajar el porcentaje de valor esperado o ampliar el rango de cuotas.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.25rem', background: 'var(--background-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--foreground-muted)' }}>
              Mostrando <strong style={{ color: 'var(--accent-green)' }}>{filteredBets.length}</strong> discrepancias
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>Clickea cualquier fila para usarla</span>
          </div>

          <div className="value-bets-list">
            {filteredBets.map((vb, i) => {
              const { icon } = getSportMeta(vb.sport);
              const valueColor = vb.valuePercentage >= 10 ? 'var(--accent-green)' : vb.valuePercentage >= 5 ? 'var(--accent-gold)' : '#94a3b8';
              return (
                <div 
                  key={i} 
                  className="value-bet-row" 
                  onClick={() => handleRowClick(vb)}
                  style={{
                    padding: '0.875rem 1.25rem',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  {/* Liga + Fecha */}
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{icon} {vb.league}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                      {new Date(vb.commenceTime).toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {/* Partido + Pick */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{vb.event}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-green)', marginTop: 2 }}>
                      {vb.pick}
                      <span style={{ color: 'var(--foreground-subtle)', marginLeft: 6, fontSize: '0.68rem' }}>
                        {vb.market} · {vb.bookmakerCount} casas
                      </span>
                    </div>
                  </div>
                  {/* Cuota rango */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent-gold)' }}>
                      {vb.oddsMin === vb.oddsMax ? vb.oddsBest.toFixed(2) : `${vb.oddsMin.toFixed(2)}–${vb.oddsMax.toFixed(2)}`}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--foreground-subtle)', marginTop: 1 }}>rango</div>
                  </div>
                  {/* Value */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 9px', borderRadius: 6,
                      background: `${valueColor}18`, color: valueColor,
                      fontWeight: 700, fontSize: '0.82rem', display: 'inline-block'
                    }}>
                      +{vb.valuePercentage.toFixed(1)}%
                    </span>
                  </div>
                  {/* Kelly */}
                  <div style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 600 }}>
                    {vb.kellyStake.toFixed(1)}% stake
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
