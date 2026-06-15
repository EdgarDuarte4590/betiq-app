import { getUpcomingMatches } from '@/lib/apis/odds-api';
import { detectArbitrage } from '@/lib/algorithms/arbitrage-scanner';
import LocalTime from '@/components/LocalTime';
import { Percent, Info } from 'lucide-react';

export default async function ArbitragePage() {
  // No auth required — arbitrage data is public
  const events = await getUpcomingMatches('upcoming');
  const arbs = detectArbitrage(events, 0.5);

  return (
    <div className="animate-fade-in" style={{ padding: '0 0.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Percent size={28} style={{ color: 'var(--accent-red)' }} />
          Arbitrage Scanner
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Encuentra oportunidades de ganancia garantizada combinando casas de apuestas.
        </p>
      </header>
      
      <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Info color="var(--accent-red)" size={20} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
          <strong>¿Qué es el Arbitraje?</strong> Consiste en aprovechar las diferencias de cuotas entre dos o más casas de apuestas para cubrir todos los resultados posibles y obtener una ganancia garantizada, sin importar quién gane. Importante: Las cuotas cambian rápidamente.
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
          {arbs.map((arb, idx) => (
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
                  <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>Profit Asegurado</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-red)' }}>
                    +{arb.profitPct.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--background-secondary)', borderRadius: 8, marginTop: '1rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-gold)', marginBottom: 10 }}>
                  Cómo apostar (Ejemplo $100 totales)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {arb.legs.map((leg, legIdx) => (
                    <div key={legIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: legIdx < arb.legs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{leg.outcome}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{leg.bookmaker}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{leg.odds.toFixed(2)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                          Apostar: <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>${leg.stakeRatio.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--foreground-muted)', marginRight: 8 }}>Retorno total garantizado:</span>
                  <strong style={{ color: 'var(--accent-green)' }}>
                    ${((arb.totalStake * arb.profitPct) / 100 + arb.totalStake).toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
