'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap, Search, Filter, ShieldCheck, TrendingUp } from 'lucide-react';
import { calculateSimultaneousKelly, type ValueBetOpportunity } from '@/lib/algorithms/value-bet-calculator';
import { getSportMeta } from '@/lib/apis/odds-api';
import { useBankrollStore } from '@/lib/store/bankrollStore';

interface Props {
  initialBets: ValueBetOpportunity[];
}

export default function ValueBetsClient({ initialBets }: Props) {
  const { openModal, bankroll, pendingExposure } = useBankrollStore();

  const [minOdds, setMinOdds] = useState('1.45');
  const [maxOdds, setMaxOdds] = useState('5.5');
  const [minValue, setMinValue] = useState('1.5');
  const [sportFilter, setSportFilter] = useState('Todos');
  const [onlySharp, setOnlySharp] = useState(false);

  const handleRowClick = useCallback((vb: ValueBetOpportunity) => {
    const { icon } = getSportMeta(vb.sport);
    const realBankroll = bankroll > 0 ? bankroll : 1000;
    const simKelly = calculateSimultaneousKelly(vb.kellyStake, realBankroll, pendingExposure);
    const suggestedStake = simKelly.recommendedStakeCurrency > 0
      ? simKelly.recommendedStakeCurrency.toFixed(2)
      : Math.max(5, realBankroll * 0.01).toFixed(2);

    openModal({
      match: vb.event,
      odds: vb.oddsBest.toFixed(2),
      stake: suggestedStake,
      sport: icon,
      league: vb.league,
      pick: vb.pick,
      market: vb.market,
      matchTime: vb.commenceTime,
      sportKey: vb.sport,
      kellyPct: simKelly.adjustedKellyPct,
      fairOdds: vb.fairOdds,
      units: simKelly.recommendedUnits,
      isSteamMove: vb.isSteamMove,
    });
  }, [bankroll, pendingExposure, openModal]);

  // Deep Link desde botón inline de Telegram: /value-bets?QuickBet=<eventId>
  useEffect(() => {
    if (typeof window === 'undefined' || initialBets.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const quickBetId = params.get('QuickBet');
    if (quickBetId) {
      const target = initialBets.find(b => b.eventId === quickBetId);
      if (target) {
        handleRowClick(target);
      }
    }
  }, [initialBets, handleRowClick]);

  // Filter logic
  const filteredBets = initialBets.filter((vb) => {
    if (sportFilter !== 'Todos' && !vb.sport.includes(sportFilter)) return false;
    const minO = parseFloat(minOdds) || 1.1;
    const maxO = parseFloat(maxOdds) || 100;
    if (vb.oddsBest < minO || vb.oddsBest > maxO) return false;
    const minV = parseFloat(minValue) || 0;
    if (vb.valuePercentage < minV) return false;
    if (onlySharp && !vb.pinnacleAligns) return false;
    return true;
  });

  // Summary stats
  const avgValue = filteredBets.length > 0
    ? filteredBets.reduce((s, b) => s + b.valuePercentage, 0) / filteredBets.length
    : 0;
  const sharpCount = filteredBets.filter(b => b.pinnacleAligns).length;

  return (
    <div>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Zap size={24} color="var(--accent-green)" />
          Value Bets Scanner (Power Devigging)
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Discrepancias cuantitativas frente al Consenso Sharp Ponderado (Pinnacle 50% · Betfair/Matchbook 30% · Bookmaker 20%).
        </p>
      </header>

      {/* Summary KPIs */}
      {initialBets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {[
            { label: 'Total oportunidades', value: String(initialBets.length), color: 'var(--accent-green)', icon: Zap },
            { label: 'EV% promedio', value: `+${avgValue.toFixed(1)}%`, color: 'var(--accent-gold)', icon: TrendingUp },
            { label: 'Respaldadas por Sharp', value: `${sharpCount} de ${filteredBets.length}`, color: 'var(--accent-blue)', icon: ShieldCheck },
          ].map(({ label, value, color, icon: Icon }, i) => (
            <div key={i} className="stat-card" style={{ padding: '0.875rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--foreground-muted)', fontWeight: 500 }}>{label}</span>
                <Icon size={13} color={color} />
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.875rem', fontWeight: 700, fontSize: '0.85rem' }}>
          <Filter size={15} color="var(--accent-gold)" /> Filtros
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.875rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Deporte</label>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)', fontSize: '0.85rem' }}
            >
              <option value="Todos">Todos los deportes</option>
              <option value="soccer">⚽ Fútbol</option>
              <option value="basketball">🏀 Básquetbol</option>
              <option value="baseball">⚾ Béisbol</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Cuota Mínima</label>
            <input
              type="number" step="0.1"
              value={minOdds} onChange={(e) => setMinOdds(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)', fontSize: '0.85rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>Cuota Máxima</label>
            <input
              type="number" step="0.1"
              value={maxOdds} onChange={(e) => setMaxOdds(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)', fontSize: '0.85rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--accent-green)', marginBottom: 4, fontWeight: 600 }}>EV Mínimo (%)</label>
            <input
              type="number" step="0.5" min="0.5" max="50"
              value={minValue} onChange={(e) => setMinValue(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid var(--accent-green)', background: 'rgba(0,214,143,0.05)', color: 'var(--accent-green)', fontWeight: 700, fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '0.55rem 0.75rem', borderRadius: 8, border: `1px solid ${onlySharp ? 'rgba(59,130,246,0.4)' : 'var(--border)'}`, background: onlySharp ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
              <input
                type="checkbox"
                checked={onlySharp}
                onChange={(e) => setOnlySharp(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--accent-blue)' }}
              />
              <span style={{ fontSize: '0.78rem', color: onlySharp ? 'var(--accent-blue)' : 'var(--foreground-muted)', fontWeight: onlySharp ? 600 : 400 }}>
                📌 Solo Consenso Sharp
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Results */}
      {filteredBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <Search size={44} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Ninguna apuesta pasa el filtro</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', maxWidth: 380, margin: '0 auto' }}>
            Prueba bajar el porcentaje de valor mínimo o desactivar el filtro de Pinnacle.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '0.75rem 1.25rem',
            background: 'var(--background-secondary)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)' }}>
              Mostrando <strong style={{ color: 'var(--accent-green)' }}>{filteredBets.length}</strong> oportunidades
            </span>
            <span style={{ fontSize: '0.68rem', color: 'var(--foreground-subtle)' }}>
              Clic en cualquier fila para registrar con Stake Kelly Simultáneo
            </span>
          </div>

          <div style={{
            padding: '0.5rem 1.25rem',
            display: 'grid',
            gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr',
            gap: '0.5rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            {['Liga / Hora', 'Partido & Pick', 'Cuota vs Fair', 'EV%', 'Kelly (U)', 'Libros'].map((h, i) => (
              <div key={i} style={{ fontSize: '0.6rem', color: 'var(--foreground-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 1 ? 'center' : 'left' }}>
                {h}
              </div>
            ))}
          </div>

          <div>
            {filteredBets.map((vb, i) => {
              const { icon } = getSportMeta(vb.sport);
              const valueColor = vb.valuePercentage >= 10 ? 'var(--accent-green)' : vb.valuePercentage >= 5 ? 'var(--accent-gold)' : '#94a3b8';
              return (
                <div
                  key={i}
                  className="value-bet-row"
                  onClick={() => handleRowClick(vb)}
                  style={{
                    padding: '0.8rem 1.25rem',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr 1fr',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'background 0.12s',
                  }}
                >
                  {/* Liga + Fecha */}
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {icon}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vb.league}</span>
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                      {new Date(vb.commenceTime).toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  {/* Partido + Pick */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vb.event}</div>
                    <div style={{ fontSize: '0.75rem', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{vb.pick}</span>
                      <span style={{ color: 'var(--foreground-subtle)', fontSize: '0.65rem' }}>· {vb.market}</span>
                      {vb.pinnacleAligns && (
                        <span title="Consenso Sharp respalda este pick" style={{ fontSize: '0.58rem', padding: '0 4px', borderRadius: 3, background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', fontWeight: 700 }}>📌 SHARP</span>
                      )}
                      {vb.isSteamMove && (
                        <span title="Steam Move detectado (>4% prob implícita en sharp books)" style={{ fontSize: '0.58rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(56,189,248,0.16)', color: '#38bdf8', fontWeight: 800 }}>
                          🌊 STEAM MOVE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Cuota vs Fair Odds */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent-gold)' }}>
                      {vb.oddsBest.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.58rem', color: 'var(--foreground-subtle)', marginTop: 1 }}>
                      Fair: {vb.fairOdds ? vb.fairOdds.toFixed(2) : (1 / vb.marketProbability).toFixed(2)} · {vb.bestBookmaker}
                    </div>
                  </div>

                  {/* Value */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 9px', borderRadius: 6,
                      background: `${valueColor}15`, color: valueColor,
                      fontWeight: 700, fontSize: '0.8rem', display: 'inline-block',
                    }}>
                      +{vb.valuePercentage.toFixed(1)}%
                    </span>
                  </div>

                  {/* Kelly */}
                  <div style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                    {vb.kellyStake.toFixed(2)} U
                    <div style={{ fontSize: '0.58rem', color: 'var(--foreground-subtle)', fontWeight: 400 }}>
                      ({vb.kellyStake.toFixed(1)}%)
                    </div>
                  </div>

                  {/* Bookmakers */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{vb.bookmakerCount}</div>
                    <div style={{ fontSize: '0.58rem', color: 'var(--foreground-subtle)', marginTop: 1 }}>
                      {Math.round(vb.consensusStrength * 100)}% consenso
                    </div>
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
