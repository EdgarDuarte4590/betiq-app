import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Zap, Filter, TrendingUp, AlertCircle } from 'lucide-react';
import { getUpcomingMatches, categorizeEventsByTime, getSportMeta } from '@/lib/apis/odds-api';
import { extractValueBets } from '@/lib/algorithms/value-bet-calculator';

export default async function ValueBetsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Obtener partidos y procesar value bets reales
  const allEvents = await getUpcomingMatches('upcoming');
  const { upcoming } = categorizeEventsByTime(allEvents);
  const valueBets = extractValueBets(upcoming, 2.0); // Umbral: >2% de valor

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Zap size={28} color="var(--accent-green)" />
            Value Bets Scanner
          </h1>
          <p style={{ color: 'var(--foreground-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Motor multi-bookmaker detectando ineficiencias del mercado en tiempo real.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>Partidos analizados</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-gold)' }}>{upcoming.length}</div>
        </div>
      </header>

      {/* Methodology Note */}
      <div style={{
        padding: '0.875rem 1rem',
        borderRadius: 10,
        background: 'rgba(59,130,246,0.08)',
        border: '1px solid rgba(59,130,246,0.2)',
        fontSize: '0.8rem',
        color: '#93c5fd',
        marginBottom: '1.5rem',
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start'
      }}>
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>Motor real:</strong> La probabilidad de mercado se calcula como el promedio de las cuotas de{' '}
          {allEvents[0]?.bookmakers?.length ?? 'múltiples'} bookmakers. Un Value Bet existe cuando un bookmaker paga{' '}
          por <em>encima</em> de esa probabilidad media. Umbral mínimo: +2.0% de valor esperado.
        </span>
      </div>

      {valueBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Zap size={48} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Sin oportunidades detectadas</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem', maxWidth: 400, margin: '0 auto' }}>
            El mercado está bien calibrado ahora mismo o no hay partidos próximos con suficientes bookmakers.
            El caché se actualiza cada hora automáticamente.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.5rem', background: 'var(--background-secondary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)' }}>
              <strong style={{ color: 'var(--accent-green)' }}>{valueBets.length}</strong> oportunidades encontradas
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>Ordenadas por mayor valor →</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)' }}>
                {['LIGA', 'PARTIDO / PICK', 'BOOKMAKER', 'CUOTA', 'PROB. MERCADO', 'VALUE', 'KELLY %'].map(h => (
                  <th key={h} style={{ padding: '0.875rem 1rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {valueBets.map((vb, i) => {
                const { icon } = getSportMeta(vb.sport);
                const valueColor = vb.valuePercentage >= 10 ? 'var(--accent-green)' : vb.valuePercentage >= 5 ? 'var(--accent-gold)' : '#94a3b8';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                    className="data-table-row">
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{icon} {vb.league}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--foreground-subtle)', marginTop: 2 }}>
                        {new Date(vb.commenceTime).toLocaleDateString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{vb.event}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: 2 }}>{vb.pick}</div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.85rem', color: 'var(--foreground-muted)' }}>
                      {vb.bookmaker}
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent-gold)' }}>
                        {vb.odds.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.85rem' }}>
                      {(vb.marketProbability * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: `${valueColor}18`,
                        color: valueColor,
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        display: 'inline-block'
                      }}>
                        +{vb.valuePercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontSize: '0.85rem', fontWeight: 600 }}>
                      {vb.kellyStake.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
