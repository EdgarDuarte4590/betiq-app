import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { TrendingUp, BarChart2, Trophy, Target, DollarSign, Activity, Compass } from 'lucide-react';
import { calculateBettingStats } from '@/lib/algorithms/value-bet-calculator';
import LineChart from '@/components/ui/LineChart';

export default async function TrendsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: bets = [] } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const allBets = bets ?? [];
  const closedBets = allBets.filter(b => b.status === 'won' || b.status === 'lost');

  // Stats globales
  const globalStats = calculateBettingStats(allBets.map(b => ({
    status: b.status, stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
  })));

  // Stats por deporte
  const sportMap = new Map<string, typeof allBets>();
  for (const bet of allBets) {
    const sport = bet.sport || 'Otros';
    if (!sportMap.has(sport)) sportMap.set(sport, []);
    sportMap.get(sport)!.push(bet);
  }

  const sportStats = Array.from(sportMap.entries()).map(([sport, bets]) => {
    const stats = calculateBettingStats(bets.map(b => ({
      status: b.status, stake: parseFloat(b.stake ?? '0'),
      odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
    })));
    return { sport, ...stats };
  }).sort((a, b) => b.total - a.total);

  // Stats por mercado
  const marketMap = new Map<string, typeof allBets>();
  for (const bet of allBets) {
    const market = bet.market || 'H2H';
    if (!marketMap.has(market)) marketMap.set(market, []);
    marketMap.get(market)!.push(bet);
  }

  const marketStats = Array.from(marketMap.entries()).map(([market, bets]) => {
    const stats = calculateBettingStats(bets.map(b => ({
      status: b.status, stake: parseFloat(b.stake ?? '0'),
      odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
    })));
    return { market, ...stats };
  }).sort((a, b) => b.total - a.total);

  // Evolución del profit (acumulado)
  let cumulativeProfit = 0;
  const profitHistory = closedBets.map(bet => {
    cumulativeProfit += parseFloat(bet.profit ?? '0');
    return {
      date: new Date(bet.created_at).toLocaleDateString('es', { month: 'short', day: 'numeric' }),
      profit: cumulativeProfit,
      result: bet.status,
    };
  });

  const chartPoints = profitHistory.map((p, i) => ({
    label: `#${i + 1}`,
    value: Math.max(0, p.profit), // Just for scaling if needed, better to map raw profit if LineChart supports it. LineChart handles negatives.
    isNegative: p.profit < 0,
  }));
  // LineChart uses value directly. Note: Reusing the same chart with cumulative profit.
  const chartData = profitHistory.map((p, i) => ({
    label: p.date,
    value: p.profit,
    isNegative: p.profit < 0
  }));

  // Calibración del sistema
  const confMap = new Map<string, typeof closedBets>();
  for (const bet of closedBets) {
    const conf = bet.confidence;
    if (conf) {
      if (!confMap.has(conf)) confMap.set(conf, []);
      confMap.get(conf)!.push(bet);
    }
  }

  const calibrationStats = Array.from(confMap.entries()).map(([confidence, bets]) => {
    const stats = calculateBettingStats(bets.map(b => ({
      status: b.status, stake: parseFloat(b.stake ?? '0'),
      odds: parseFloat(b.odds ?? '0'), profit: parseFloat(b.profit ?? '0'),
    })));
    return { confidence, ...stats };
  }).sort((a, b) => {
    const order: Record<string, number> = { 'alta': 3, 'media': 2, 'baja': 1 };
    return (order[b.confidence] || 0) - (order[a.confidence] || 0);
  });

  // Racha actual
  let currentStreak = 0;
  let streakType: 'won' | 'lost' | 'none' = 'none';
  for (let i = closedBets.length - 1; i >= 0; i--) {
    if (streakType === 'none') {
      streakType = closedBets[i].status;
      currentStreak = 1;
    } else if (closedBets[i].status === streakType) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Cuota promedio
  const avgOdds = closedBets.length > 0
    ? closedBets.reduce((sum, b) => sum + parseFloat(b.odds ?? '0'), 0) / closedBets.length
    : 0;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <TrendingUp size={26} color="var(--accent-gold)" />
          Tendencias y Análisis
        </h1>
        <p style={{ color: 'var(--foreground-muted)', marginTop: '0.4rem', fontSize: '0.85rem' }}>
          Rendimiento real basado en tu historial de apuestas en Supabase.
        </p>
      </header>

      {allBets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <BarChart2 size={48} color="var(--foreground-subtle)" style={{ marginBottom: '1rem', display: 'inline-block' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>Sin datos todavía</h3>
          <p style={{ color: 'var(--foreground-muted)', fontSize: '0.85rem' }}>
            Registra apuestas y márcalas como Ganadas o Perdidas para ver tus tendencias aquí.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* KPIs rápidos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
            {[
              { label: 'Profit Total', value: `${globalStats.totalProfit >= 0 ? '+' : ''}$${globalStats.totalProfit.toFixed(2)}`, color: globalStats.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', icon: DollarSign },
              { label: 'Win Rate', value: `${globalStats.winRate.toFixed(0)}%`, color: globalStats.winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)', icon: Target },
              { label: 'ROI / Yield', value: `${globalStats.roi >= 0 ? '+' : ''}${globalStats.roi.toFixed(1)}%`, color: globalStats.roi >= 0 ? 'var(--accent-gold)' : 'var(--accent-red)', icon: TrendingUp },
              { label: 'Cuota Promedio', value: avgOdds > 0 ? avgOdds.toFixed(2) : '-', color: 'var(--foreground)', icon: Activity },
              { label: 'Racha Actual', value: currentStreak > 0 ? `${currentStreak} ${streakType === 'won' ? '✅' : '❌'}` : '-', color: streakType === 'won' ? 'var(--accent-green)' : 'var(--accent-red)', icon: Trophy },
              { label: 'Total Apostado', value: `$${globalStats.totalStaked.toFixed(0)}`, color: 'var(--foreground)', icon: BarChart2 },
            ].map(({ label, value, color, icon: Icon }, i) => (
              <div key={i} className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)' }}>{label}</span>
                  <Icon size={14} color={color} />
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Gráfico de profit acumulado */}
          {profitHistory.length > 0 && (
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>📈 Evolución del Profit</h3>
              <LineChart data={chartData} height={180} />
            </div>
          )}

          {/* Calibración del sistema */}
          {calibrationStats.length > 0 && (
            <div className="card">
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Compass size={16} color="var(--accent-gold)" /> 
                Calibración del Sistema
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {calibrationStats.map(({ confidence, total, won, lost, winRate }, i) => {
                  const colors = {
                    alta: 'var(--accent-green)',
                    media: 'var(--accent-gold)',
                    baja: 'var(--foreground-muted)'
                  };
                  const color = colors[confidence as keyof typeof colors] || 'var(--foreground)';
                  
                  return (
                    <div key={i} style={{ padding: '1rem', background: 'var(--background-secondary)', borderRadius: 10, border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${color}` }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8, textTransform: 'capitalize', color }}>
                        Confianza {confidence}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Bets</div>
                          <div style={{ fontWeight: 700 }}>{total}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Win Rate</div>
                          <div style={{ fontWeight: 700, color: winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{winRate.toFixed(0)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Por deporte */}
          <div className="card">
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>🏆 Rendimiento por Deporte</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {sportStats.map(({ sport, total, won, lost, winRate, totalProfit, roi }, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr repeat(5, auto)',
                  gap: '1rem', alignItems: 'center', padding: '0.75rem 0.5rem',
                  borderBottom: i < sportStats.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{sport}</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>BETS</div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{total}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>V/D</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{won}</span>
                      /
                      <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{lost}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>WIN%</div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{winRate.toFixed(0)}%</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>PROFIT</div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)', marginBottom: 2 }}>ROI</div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: roi >= 0 ? 'var(--accent-gold)' : 'var(--accent-red)' }}>
                      {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Por mercado */}
          <div className="card">
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>📊 Rendimiento por Mercado</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              {marketStats.map(({ market, total, won, lost, winRate, totalProfit, roi }, i) => (
                <div key={i} style={{ padding: '1rem', background: 'var(--background-secondary)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8, color: 'var(--accent-gold)' }}>{market}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Bets</div>
                      <div style={{ fontWeight: 700 }}>{total}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Win Rate</div>
                      <div style={{ fontWeight: 700, color: winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{winRate.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>Profit</div>
                      <div style={{ fontWeight: 700, color: totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--foreground-muted)' }}>ROI</div>
                      <div style={{ fontWeight: 700, color: roi >= 0 ? 'var(--accent-gold)' : 'var(--accent-red)' }}>
                        {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
