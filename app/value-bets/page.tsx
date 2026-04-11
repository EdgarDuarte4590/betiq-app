import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Zap, AlertCircle } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime, getSportMeta } from '@/lib/apis/odds-api';
import { extractAllValueBets } from '@/lib/algorithms/value-bet-calculator';

export default async function ValueBetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming } = categorizeEventsByTime(allEvents);
  // Todas las oportunidades consolidadas (un pick por selección, no por bookmaker)
  const valueBets = extractAllValueBets(upcoming, 2.0, true);

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Zap size={26} color="var(--accent-green)" />
            Value Bets Scanner
          </h1>
          <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
            Una selección por partido · Cuotas como rango del mercado · Solo fútbol, basket y béisbol
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>Partidos analizados</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-gold)' }}>{upcoming.length}</div>
        </div>
      </header>

      {/* Nota metodológica */}
      <div style={{
        padding: '0.75rem 1rem', borderRadius: 10,
        background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
        fontSize: '0.78rem', color: '#93c5fd', marginBottom: '1.25rem',
        display: 'flex', gap: '0.6rem', alignItems: 'flex-start'
      }}>
        <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>Motor real:</strong> La probabilidad se calcula promediando cuotas de múltiples bookmakers.
          Un value bet existe cuando la mejor cuota paga por encima de esa probabilidad media.
          Rango: 1.50–5.00. Mercados: H2H, Empate, Over/Under. Una selección por partido, no repetidas por casa.
        </span>
      </div>

      {valueBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <Zap size={44} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>Sin oportunidades ahora</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem', maxWidth: 400, margin: '0 auto' }}>
            El mercado está bien calibrado o no hay partidos con suficientes bookmakers. Se actualiza cada hora.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.25rem', background: 'var(--background-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--foreground-muted)' }}>
              <strong style={{ color: 'var(--accent-green)' }}>{valueBets.length}</strong> oportunidades
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)' }}>Prioridad: 1.50–2.00 → mayor valor</span>
          </div>

          {/* Responsive: cards en móvil, tabla en desktop */}
          <div className="value-bets-list">
            {valueBets.map((vb, i) => {
              const { icon } = getSportMeta(vb.sport);
              const valueColor = vb.valuePercentage >= 10 ? 'var(--accent-green)' : vb.valuePercentage >= 5 ? 'var(--accent-gold)' : '#94a3b8';
              return (
                <div key={i} className="value-bet-row" style={{
                  padding: '0.875rem 1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  {/* Liga + Fecha */}
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{icon} {vb.league}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                      {new Date(vb.commenceTime).toLocaleDateString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                    {vb.kellyStake.toFixed(1)}%
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
