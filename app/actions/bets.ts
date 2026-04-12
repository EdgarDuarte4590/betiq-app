'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Marca una apuesta como Ganada o Perdida y actualiza el bankroll automáticamente.
 */
export async function markBetResult(
  betId: string,
  result: 'won' | 'lost',
  stake: number,
  odds: number
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Calcular profit (positivo si ganó, negativo si perdió)
  const profit = result === 'won'
    ? parseFloat(((stake * odds) - stake).toFixed(2))  // Ganancia neta
    : -stake;  // Pérdida total

  // 1. Actualizar la apuesta
  const { error: betError } = await supabase
    .from('bets')
    .update({ status: result, profit })
    .eq('id', betId)
    .eq('user_id', user.id); // Seguridad: solo el dueño puede actualizar

  if (betError) return { error: betError.message };

  // 2. Actualizar el bankroll
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('bankroll_actual')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) return { error: 'No se pudo obtener el perfil' };

  let newBankroll: number;
  if (result === 'won') {
    // Devolver stake + ganancia
    newBankroll = parseFloat(profile.bankroll_actual) + stake + Math.abs(profit);
  } else {
    // Ya descontamos el stake al apostar; solo marcamos la pérdida
    newBankroll = parseFloat(profile.bankroll_actual);
  }

  await supabase
    .from('profiles')
    .update({ bankroll_actual: newBankroll })
    .eq('id', user.id);

  // Revalidar la caché de las páginas que muestran estos datos
  revalidatePath('/picks');
  revalidatePath('/dashboard');
  revalidatePath('/bankroll');

  return { success: true, profit, newBankroll };
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

  // Check if the profile row exists first
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  let error;

  if (!existing) {
    // Profile was deleted manually — recreate it (INSERT is allowed on first create by RLS)
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        bankroll_inicial: bankrollInicial,
        bankroll_actual: bankrollActual,
      });
    error = insertError;
  } else {
    // Normal case — just UPDATE
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
 * Elimina una apuesta (solo pendientes) y devuelve el stake al bankroll.
 */
export async function deleteBet(betId: string, stake: number) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Solo se pueden borrar apuestas pendientes
  const { data: bet } = await supabase
    .from('bets')
    .select('status')
    .eq('id', betId)
    .eq('user_id', user.id)
    .single();

  if (!bet) return { error: 'Apuesta no encontrada' };
  if (bet.status !== 'pending') return { error: 'Solo se pueden borrar apuestas pendientes' };

  // 1. Borrar la apuesta
  const { error: deleteError } = await supabase
    .from('bets')
    .delete()
    .eq('id', betId)
    .eq('user_id', user.id);

  if (deleteError) return { error: deleteError.message };

  // 2. Devolver el stake al bankroll
  const { data: profile } = await supabase
    .from('profiles')
    .select('bankroll_actual')
    .eq('id', user.id)
    .single();

  if (profile) {
    await supabase
      .from('profiles')
      .update({ bankroll_actual: parseFloat(profile.bankroll_actual) + stake })
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
  updates: { event?: string; pick?: string; odds?: number; stake?: number; market?: string }
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado' };

  // Solo se pueden editar apuestas pendientes
  const { data: existing } = await supabase
    .from('bets')
    .select('status, stake')
    .eq('id', betId)
    .eq('user_id', user.id)
    .single();

  if (!existing) return { error: 'Apuesta no encontrada' };
  if (existing.status !== 'pending') return { error: 'Solo se pueden editar apuestas pendientes' };

  // Si cambió el stake, ajustamos el bankroll
  if (updates.stake !== undefined && updates.stake !== parseFloat(existing.stake)) {
    const diff = parseFloat(existing.stake) - updates.stake; // positivo = devolver dinero
    const { data: profile } = await supabase
      .from('profiles')
      .select('bankroll_actual')
      .eq('id', user.id)
      .single();
    if (profile) {
      await supabase
        .from('profiles')
        .update({ bankroll_actual: parseFloat(profile.bankroll_actual) + diff })
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
