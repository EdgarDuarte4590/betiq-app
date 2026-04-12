'use client';

import { useState, useEffect, useTransition } from 'react';
import { useBankrollStore } from '@/lib/store/bankrollStore';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, X, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

/**
 * Global Bet Modal — mounted once in layout.tsx so the modal
 * is available from ANY page (dashboard, value-bets, picks, etc.)
 */
export default function GlobalBetModal() {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/register';

  const {
    bankroll, isModalOpen, closeModal, draftBet,
    user, syncWithSupabase, updateBankrollInDB,
  } = useBankrollStore();

  const supabase = createClient();

  const [stake, setStake] = useState('50');
  const [odds, setOdds] = useState('2.00');
  const [match, setMatch] = useState('');
  const [market, setMarket] = useState('H2H');
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pre-fill form with draft
  useEffect(() => {
    if (draftBet) {
      setMatch(draftBet.match);
      setOdds(draftBet.odds);
      setStake(draftBet.stake);
      setMarket('H2H');
    } else {
      setMatch('');
      setOdds('2.00');
      setStake('50');
      setMarket('H2H');
    }
  }, [draftBet, isModalOpen]);

  // Sync bankroll on mount
  useEffect(() => {
    if (!isAuthPage) {
      syncWithSupabase();
    }
  }, [isAuthPage]); // eslint-disable-line

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSaveBet = () => {
    if (!user) {
      showToast('error', 'Debes iniciar sesión para registrar una apuesta.');
      return;
    }
    const stakeNum = parseFloat(stake);
    const oddsNum = parseFloat(odds);

    if (isNaN(stakeNum) || stakeNum <= 0) {
      showToast('error', 'El monto de apuesta debe ser mayor a $0.');
      return;
    }
    if (isNaN(oddsNum) || oddsNum <= 1.0) {
      showToast('error', 'La cuota debe ser válida y mayor a 1.0.');
      return;
    }
    if (stakeNum > bankroll) {
      showToast('error', `No tienes suficiente bankroll. Disponible: $${bankroll.toFixed(2)}`);
      return;
    }
    if (!match.trim()) {
      showToast('error', 'Ingresa el nombre del partido o evento.');
      return;
    }

    startTransition(async () => {
      const { error: betError } = await supabase.from('bets').insert({
        user_id: user.id,
        event: match,
        sport: draftBet?.sportKey || draftBet?.sport || 'Otros',
        league: draftBet?.league || 'N/A',
        confidence: draftBet?.confidence || null,
        market,
        pick: draftBet?.pick || match,
        odds: oddsNum,
        stake: stakeNum,
        status: 'pending',
        profit: 0,
        match_time: draftBet?.matchTime || null,
      });

      if (betError) {
        showToast('error', `Error al guardar: ${betError.message}`);
        return;
      }

      await updateBankrollInDB(bankroll - stakeNum);
      closeModal();
      showToast('success', `✅ Apuesta registrada: $${stakeNum.toFixed(2)} en ${match}`);
    });
  };

  if (isAuthPage || !mounted) return null;

  const stakeNum = parseFloat(stake) || 0;
  const oddsNum = parseFloat(odds) || 0;
  const potentialWin = stakeNum > 0 && oddsNum > 0 ? (stakeNum * oddsNum).toFixed(2) : '0.00';
  const bankrollPct = bankroll > 0 ? ((stakeNum / bankroll) * 100).toFixed(1) : '0';

  return (
    <>
      {/* Toast */}
      {toast && createPortal(
        <div style={{
          position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999,
          padding: '0.875rem 1.25rem',
          borderRadius: 10,
          background: toast.type === 'success' ? 'rgba(0,214,143,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(0,214,143,0.4)' : 'rgba(239,68,68,0.4)'}`,
          color: toast.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          fontWeight: 600, fontSize: '0.875rem',
          maxWidth: 360, lineHeight: 1.4,
          animation: 'fadeIn 0.3s ease',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>,
        document.body
      )}

      {/* Modal */}
      {isModalOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div className="card" style={{
            width: '100%', maxWidth: 440,
            background: 'var(--background-card)',
            border: '1px solid var(--border)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            maxHeight: '95vh',
            overflowY: 'auto'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Registrar Apuesta</h3>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-muted)', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Draft pick tag */}
            {draftBet?.pick && (
              <div style={{ marginBottom: '1.25rem', padding: '0.6rem 0.875rem', background: 'rgba(255,215,0,0.08)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--accent-gold)', border: '1px solid rgba(255,215,0,0.2)' }}>
                ⭐ Pick sugerido: <strong>{draftBet.pick}</strong>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Partido */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--foreground-muted)', marginBottom: 5 }}>Partido / Evento</label>
                <input
                  type="text"
                  value={match}
                  onChange={e => setMatch(e.target.value)}
                  placeholder="Ej: Arsenal vs Chelsea"
                  style={{ width: '100%', padding: '0.7rem 0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)', fontSize: '0.9rem' }}
                />
              </div>

              {/* Mercado */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--foreground-muted)', marginBottom: 5 }}>Mercado</label>
                <select
                  value={market}
                  onChange={e => setMarket(e.target.value)}
                  style={{ width: '100%', padding: '0.7rem 0.875rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background-secondary)', color: 'var(--foreground)', fontSize: '0.9rem', cursor: 'pointer' }}
                >
                  <optgroup label="Resultado">
                    <option value="H2H">Ganador (1X2 / H2H)</option>
                    <option value="Empate">Empate</option>
                  </optgroup>
                  <optgroup label="Fútbol">
                    <option value="Goles +1.5">Over/Under Goles (1.5)</option>
                    <option value="Goles +2.5">Over/Under Goles (2.5)</option>
                    <option value="Ambos Anotan">Ambos Equipos Anotan (BTTS)</option>
                    <option value="Tarjetas">Total Tarjetas</option>
                    <option value="Corners">Tiros de Esquina</option>
                  </optgroup>
                  <optgroup label="Básquetbol">
                    <option value="Puntos +">Over/Under Puntos</option>
                    <option value="Puntos Jugador">Puntos de Jugador</option>
                    <option value="Asistencias">Asistencias Jugador</option>
                  </optgroup>
                  <optgroup label="Béisbol">
                    <option value="Carreras +">Over/Under Carreras</option>
                    <option value="Hits +">Over/Under Hits</option>
                    <option value="Innings">Resultado por Inning</option>
                  </optgroup>
                  <optgroup label="Otro">
                    <option value="Otro">Otro mercado</option>
                  </optgroup>
                </select>
              </div>

              {/* Cuota y Monto */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--foreground-muted)', marginBottom: 5 }}>
                    Cuota <span style={{ color: 'var(--foreground-subtle)', fontSize: '0.7rem' }}>(1.50–5.00)</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    value={odds}
                    onChange={e => setOdds(e.target.value)}
                    style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: `1px solid ${oddsNum < 1.5 || oddsNum > 5.0 ? 'var(--accent-gold)' : 'var(--border)'}`, background: 'var(--background-secondary)', color: 'var(--foreground)' }}
                  />
                  {(oddsNum < 1.5 || oddsNum > 5.0) && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--accent-gold)', marginTop: 4 }}>
                      ⚠ Fuera del rango recomendado (1.50–5.00)
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--foreground-muted)', marginBottom: 5 }}>
                    Monto ($) <span style={{ color: 'var(--foreground-subtle)', fontSize: '0.7rem' }}>{bankrollPct}% bankroll</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={stake}
                    onChange={e => setStake(e.target.value)}
                    style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid var(--accent-green)', background: 'rgba(0,214,143,0.05)', color: 'var(--accent-green)', fontWeight: 700 }}
                  />
                </div>
              </div>

              {/* Resumen */}
              {stakeNum > 0 && oddsNum > 0 && (
                <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--foreground-muted)' }}>Ganancia posible:</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-green)' }}>${potentialWin}</span>
                </div>
              )}

              {/* Acciones */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: 4 }}>
                <button
                  onClick={closeModal}
                  style={{ flex: 1, padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveBet}
                  disabled={isPending}
                  className="btn-primary"
                  style={{ flex: 1, justifyContent: 'center', opacity: isPending ? 0.75 : 1 }}
                >
                  {isPending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                  {isPending ? 'Guardando...' : 'Guardar Apuesta'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
