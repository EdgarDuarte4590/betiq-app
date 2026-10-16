'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { type BetGradeOutcome } from '@/app/actions/syncScores';

function calculateSettlementAccounting(
  outcome: BetGradeOutcome,
  stake: number,
  odds: number
): { profit: number; bankrollCredit: number } {
  const netWin = (stake * odds) - stake;
  switch (outcome) {
    case 'won':
      return { profit: Number(netWin.toFixed(2)), bankrollCredit: Number((stake + netWin).toFixed(2)) };
    case 'half_won': {
      const halfProfit = netWin / 2;
      return { profit: Number(halfProfit.toFixed(2)), bankrollCredit: Number((stake + halfProfit).toFixed(2)) };
    }
    case 'push':
    case 'void':
      return { profit: 0, bankrollCredit: Number(stake.toFixed(2)) };
    case 'half_lost': {
      const halfLoss = stake / 2;
      return { profit: Number((-halfLoss).toFixed(2)), bankrollCredit: Number(halfLoss.toFixed(2)) };
    }
    case 'lost':
    default:
      return { profit: Number((-stake).toFixed(2)), bankrollCredit: 0 };
  }
}

/**
 * Marca una apuesta como Ganada, Perdida o Push/Void de manera idempotente (Ledger Pattern).
 * Verifica atómicamente que la apuesta esté en estado `pending` antes de acreditar al bankroll,
 * impidiendo dobles pagos ante ejecuciones concurrentes.
 */
export async function markBetResult(
  betId: string,
  result: BetGradeOutcome,
  stake: number,
  odds: number
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const adminSupabase = createAdminClient();
  const { profit, bankrollCredit } = calculateSettlementAccounting(result, stake, odds);

  // 1. Transición atómica idempotente: solo liquidar si actualmente es 'pending'
  const { data: updatedRows, error: betError } = await adminSupabase
    .from('bets')
    .update({ status: result, profit })
    .eq('id', betId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id');

  if (betError) return { error: betError.message };
  if (!updatedRows || updatedRows.length === 0) {
    return { error: 'La apuesta ya había sido liquidada previamente.' };
  }

  // 2. Actualizar el bankroll de forma segura
  const { data: profile, error: profileError } = await adminSupabase
    .from('profiles')
    .select('bankroll_actual')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return { error: 'No se pudo obtener el perfil' };

  const currentBankroll = parseFloat(profile.bankroll_actual);
  const newBankroll = Number((currentBankroll + bankrollCredit).toFixed(2));

  if (bankrollCredit > 0) {
    await adminSupabase
      .from('profiles')
      .update({ bankroll_actual: newBankroll })
      .eq('id', user.id);
  }

  revalidatePath('/picks');
  revalidatePath('/dashboard');
  revalidatePath('/bankroll');
  revalidatePath('/trends');

  return { success: true, profit, newBankroll };
}

/**
 * Obtiene la exposición total actual comprometida en apuestas `PENDING` para el cálculo de Kelly Simultáneo.
 */
export async function getUserPendingExposure(): Promise<{
  pendingStakeTotal: number;
  pendingCount: number;
}> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { pendingStakeTotal: 0, pendingCount: 0 };

    const { data: pendingBets } = await supabase
      .from('bets')
      .select('stake')
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (!pendingBets) return { pendingStakeTotal: 0, pendingCount: 0 };

    const pendingStakeTotal = pendingBets.reduce((s, b) => s + parseFloat(String(b.stake || '0')), 0);
    return {
      pendingStakeTotal: Number(pendingStakeTotal.toFixed(2)),
      pendingCount: pendingBets.length,
    };
  } catch {
    return { pendingStakeTotal: 0, pendingCount: 0 };
  }
}

/**
 * Actualiza el bankroll inicial y actual desde la UI de Ajustes.
 */
export async function updateBankrollSettings(
  bankrollInicial: number,
  bankrollActual: number
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  let error;

  if (!existing) {
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        bankroll_inicial: bankrollInicial,
        bankroll_actual: bankrollActual,
      });
    error = insertError;
  } else {
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        bankroll_inicial: bankrollInicial,
        bankroll_actual: bankrollActual,
      })
      .eq('id', user.id);
    error = updateError;
  }

  if (error) return { error: error.message };

  revalidatePath('/bankroll');
  revalidatePath('/dashboard');

  return { success: true };
}

/**
 * Elimina una apuesta (solo pendientes) de forma idempotente y devuelve el stake al bankroll.
 */
export async function deleteBet(betId: string, stake: number) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const adminSupabase = createAdminClient();

  // Borrado atómico condicionado a status = 'pending'
  const { data: deletedRows, error: deleteError } = await adminSupabase
    .from('bets')
    .delete()
    .eq('id', betId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id, stake');

  if (deleteError) return { error: deleteError.message };
  if (!deletedRows || deletedRows.length === 0) {
    return { error: 'Solo se pueden borrar apuestas pendientes o ya fue eliminada' };
  }

  const refundStake = parseFloat(String(deletedRows[0].stake ?? stake));

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('bankroll_actual')
    .eq('id', user.id)
    .single();

  if (profile) {
    await adminSupabase
      .from('profiles')
      .update({ bankroll_actual: Number((parseFloat(profile.bankroll_actual) + refundStake).toFixed(2)) })
      .eq('id', user.id);
  }

  revalidatePath('/picks');
  revalidatePath('/dashboard');
  revalidatePath('/bankroll');

  return { success: true };
}

/**
 * Edita los campos de una apuesta pendiente.
 */
export async function editBet(
  betId: string,
  updates: { event?: string; pick?: string; odds?: number; stake?: number; market?: string; notes?: string }
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  const { data: existing } = await supabase
    .from('bets')
    .select('status, stake')
    .eq('id', betId)
    .eq('user_id', user.id)
    .single();

  if (!existing) return { error: 'Apuesta no encontrada' };
  if (existing.status !== 'pending' && Object.keys(updates).some(k => k !== 'notes')) {
    return { error: 'Solo se pueden editar apuestas pendientes' };
  }

  if (existing.status === 'pending' && updates.stake !== undefined && updates.stake !== parseFloat(existing.stake)) {
    const diff = parseFloat(existing.stake) - updates.stake;
    const { data: profile } = await supabase
      .from('profiles')
      .select('bankroll_actual')
      .eq('id', user.id)
      .single();
    if (profile) {
      await supabase
        .from('profiles')
        .update({ bankroll_actual: Number((parseFloat(profile.bankroll_actual) + diff).toFixed(2)) })
        .eq('id', user.id);
    }
  }

  const { error } = await supabase
    .from('bets')
    .update(updates)
    .eq('id', betId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/picks');
  revalidatePath('/dashboard');
  revalidatePath('/bankroll');

  return { success: true };
}
