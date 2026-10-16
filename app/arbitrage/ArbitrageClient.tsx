'use client';

import { useState } from 'react';
import LocalTime from '@/components/LocalTime';
import type { ArbOpportunity, StakeRoundingStep } from '@/lib/algorithms/arbitrage-scanner';
import { Percent, Info, ShieldCheck } from 'lucide-react';

export default function ArbitrageClient({ arbs }: { arbs: ArbOpportunity[] }) {
  const [roundingMode, setRoundingMode] = useState<'exact' | StakeRoundingStep>(5);

  return (
    <div className="animate-fade-in" style={{ padding: '0 0.5rem' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Percent size={28} style={{ color: 'var(--accent-red)' }} />
            Arbitrage Scanner (Anti-Gubbing)
          </h1>
          <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
            Ganancia garantizada con redondeo inteligente de stakes para evitar limitaciones de cuenta.
          </p>
        </div>

        {/* Anti-Gubbing Stake Rounding Controls */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0.4rem', borderRadius: 10,
          background: 'var(--background-secondary)',
          border: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', padding: '0 6px', fontWeight: 600 }}>
            🛡️ Anti-Gubbing:
          </span>
          {(['exact', 1, 5, 10] as const).map(mode => {
            const active = roundingMode === mode;
            const label = mode === 'exact' ? 'Centavos' : `Múltiplo $${mode}`;
            return (
              <button
                key={String(mode)}
                onClick={() => setRoundingMode(mode)}
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: 7,
                  border: active ? '1px solid var(--accent-green)' : '1px solid transparent',
                  background: active ? 'rgba(0,214,143,0.15)' : 'transparent',
                  color: active ? 'var(--accent-green)' : 'var(--foreground-muted)',
                  fontSize: '0.75rem',
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </header>

      <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Info color="var(--accent-red)" size={20} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
          <strong>Protección Anti-Gubbing:</strong> Apostar centavos exactos (ej. $47.83) alerta a los departamentos de riesgo de las casas recreativas. Usa el redondeo a múltiplos enteros ($1, $5 o $10) para proteger tus cuentas y verifica el ROI neto recalculado.
        </p>
      </div>

      {arbs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔍</div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Sin oportunidades actuales</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)' }}>
            No encontramos márgenes de arbitraje válidos en los partidos próximos. ¡Vuelve pronto!
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {arbs.map((arb, idx) => {
            const roundedInfo = roundingMode === 'exact' ? null : arb.roundingByStep[roundingMode];
            const displayRoi = roundedInfo ? roundedInfo.roiPct : arb.profitPct;
            const totalStaked = roundedInfo ? roundedInfo.totalStake : 100;
            const minReturn = roundedInfo ? roundedInfo.minReturn : 100 + arb.profitPct;

            return (
              <div key={idx} className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent-red)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 4 }}>
                      {arb.sport} · {arb.league}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>{arb.event}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--foreground-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <LocalTime isoString={arb.commenceTime} format="datetime" />
                      <span>·</span>
                      <span style={{ color: 'var(--foreground-muted)' }}>{arb.market}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>
                      {roundingMode === 'exact' ? 'ROI Matemático' : `ROI Neto (Redondeo $${roundingMode})`}
                    </div>
                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: 800,
                      color: displayRoi > 0 ? 'var(--accent-green)' : 'var(--accent-gold)',
                    }}>
                      {displayRoi >= 0 ? '+' : ''}{displayRoi.toFixed(2)}%
                    </div>
                    {roundingMode !== 'exact' && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)' }}>
                        Exacto: +{arb.profitPct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--background-secondary)', borderRadius: 8, marginTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-gold)' }}>
                      Distribución de Stakes (Capital Total: ${totalStaked.toFixed(2)})
                    </span>
                    {roundingMode !== 'exact' && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ShieldCheck size={12} /> Redondeado a múltiplos de ${roundingMode}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {arb.legs.map((leg, legIdx) => {
                      const stakeToShow =
                        roundingMode === 'exact'
                          ? leg.stakeRatio
                          : roundingMode === 1
                            ? leg.roundedStake1
                            : roundingMode === 5
                              ? leg.roundedStake5
                              : leg.roundedStake10;

                      return (
                        <div key={legIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: legIdx < arb.legs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{leg.outcome}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{leg.bookmaker}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{leg.odds.toFixed(2)}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                              Apostar: <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                                ${roundingMode === 'exact' ? stakeToShow.toFixed(2) : stakeToShow.toFixed(0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.82rem', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ color: 'var(--foreground-muted)' }}>
                      Inversión total: <strong>${totalStaked.toFixed(2)}</strong>
                    </span>
                    <div>
                      <span style={{ color: 'var(--foreground-muted)', marginRight: 8 }}>Retorno mínimo garantizado:</span>
                      <strong style={{ color: minReturn >= totalStaked ? 'var(--accent-green)' : 'var(--accent-gold)' }}>
                        ${minReturn.toFixed(2)} ({minReturn - totalStaked >= 0 ? '+' : ''}${(minReturn - totalStaked).toFixed(2)})
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
