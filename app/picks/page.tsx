import { createClient } from '@/lib/supabase/server';
import { Ticket } from 'lucide-react';
import BetCard from '@/components/picks/BetCard';
import SyncButton from '@/components/picks/SyncButton';
import { calculateBettingStats } from '@/lib/algorithms/value-bet-calculator';
import { computeClvForBets } from '@/app/actions/snapshots';

export default async function PicksPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // if (!user) redirect('/login'); // Temporalmente deshabilitado

  const { data: bets = [] } = user ? await supabase
    .from('bets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }) : { data: [] };

  const rawBets = (bets as any[]) ?? [];
  const clvRecord = await computeClvForBets(
    rawBets.map(b => ({
      id: b.id,
      event: b.event ?? '',
      pick: b.pick ?? '',
      market: b.market ?? 'H2H',
      odds: parseFloat(b.odds ?? '0'),
      match_time: b.match_time ?? b.created_at,
    }))
  );

  const allBets = rawBets.map(b => {
    const clvInfo = clvRecord[b.id];
    return {
      ...b,
      clvPct: clvInfo?.clvPct ?? null,
      closingNoVigOdds: clvInfo?.closingNoVigOdds ?? null,
    };
  });

  const stats = calculateBettingStats(allBets.map(b => ({
    status: b.status,
    stake: parseFloat(b.stake),
    odds: parseFloat(b.odds),
    profit: parseFloat(b.profit ?? '0'),
    clvPct: b.clvPct,
  })));

  const pendingBets = allBets.filter(b => b.status === 'pending');
  const wonBets = allBets.filter(b => b.status === 'won' || b.status === 'half_won' || b.status === 'push' || b.status === 'void');
  const lostBets = allBets.filter(b => b.status === 'lost' || b.status === 'half_lost');

  return (
    <div>
      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Ticket size={22} color="var(--accent-gold)" />
              Mis Picks
            </h1>
            <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
              Historial completo · Cierra tus tiquetes o sincroniza con resultados reales y Closing Line Value (CLV).
            </p>
          </div>
          {pendingBets.length > 0 && <SyncButton />}
        </div>
      </header>

      {/* Stats Row */}
      {allBets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="stat-card">
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>ROI Total</div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: stats.roi >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
            </div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>CLV Promedio</div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: stats.avgClv >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {stats.avgClv >= 0 ? '+' : ''}{stats.avgClv.toFixed(2)}%
            </div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>Win Rate</div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800 }}>
              {stats.winRate.toFixed(0)}%
            </div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>Profit Neto</div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: stats.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="stat-card">
            <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: 8 }}>Significancia (p)</div>
            <div style={{ fontSize: '1.65rem', fontWeight: 800, color: stats.isStatisticallySignificant ? 'var(--accent-green)' : 'var(--accent-gold)' }}>
              {stats.pValue.toFixed(3)}
            </div>
          </div>
        </div>
      )}

      {allBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Ticket size={48} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>Sin apuestas todavía</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem' }}>
            Haz clic en cualquier partido del Dashboard para registrar tu primera apuesta.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>

          {/* Pendientes */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-gold)', animation: 'pulse 2s infinite' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Pendientes</h2>
              <span style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(255,215,0,0.15)', color: 'var(--accent-gold)', fontSize: '0.75rem', fontWeight: 700 }}>
                {pendingBets.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pendingBets.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-subtle)', padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  No hay apuestas pendientes.
                </p>
              ) : pendingBets.map(bet => (
                <BetCard key={bet.id} bet={bet} />
              ))}
            </div>
          </div>

          {/* Ganadas */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-green)' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Ganadas</h2>
              <span style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(0,214,143,0.15)', color: 'var(--accent-green)', fontSize: '0.75rem', fontWeight: 700 }}>
                {wonBets.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {wonBets.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-subtle)', padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  Aún no hay victorias.
                </p>
              ) : wonBets.map(bet => (
                <BetCard key={bet.id} bet={bet} />
              ))}
            </div>
          </div>

          {/* Perdidas */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-red)' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Perdidas</h2>
              <span style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', fontSize: '0.75rem', fontWeight: 700 }}>
                {lostBets.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {lostBets.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-subtle)', padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>
                  ¡Sin pérdidas! Sigue así.
                </p>
              ) : lostBets.map(bet => (
                <BetCard key={bet.id} bet={bet} />
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
