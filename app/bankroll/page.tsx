import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { calculateBettingStats } from '@/lib/algorithms/value-bet-calculator';
import BankrollPageClient from './BankrollPageClient';

export default async function BankrollPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // if (!user) redirect('/login'); // Temporalmente deshabilitado

  const [profileResult, betsResult] = user ? await Promise.all([
    supabase.from('profiles').select('bankroll_actual, bankroll_inicial').eq('id', user.id).single(),
    supabase.from('bets').select('status, stake, odds, profit, created_at').eq('user_id', user.id).order('created_at', { ascending: true }),
  ]) : [{ data: null }, { data: [] }];

  const profile = profileResult.data;
  const allBets = (betsResult.data as any[]) ?? [];

  const stats = calculateBettingStats(allBets.map(b => ({
    status: b.status,
    stake: parseFloat(b.stake ?? '0'),
    odds: parseFloat(b.odds ?? '0'),
    profit: parseFloat(b.profit ?? '0'),
  })));

  return (
    <BankrollPageClient
      bankrollActual={parseFloat((profile as any)?.bankroll_actual ?? '1000')}
      bankrollInicial={parseFloat((profile as any)?.bankroll_inicial ?? '1000')}
      roi={stats.roi}
      winRate={stats.winRate}
      totalProfit={stats.totalProfit}
      totalBets={stats.total}
      bets={allBets.map((b: any) => ({
        status: b.status,
        stake: parseFloat(b.stake ?? '0'),
        profit: parseFloat(b.profit ?? '0'),
        created_at: b.created_at,
      }))}
    />
  );
}
