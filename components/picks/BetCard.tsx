'use client';

import { useState, useTransition } from 'react';
import { markBetResult, deleteBet, editBet } from '@/app/actions/bets';
import { CheckCircle2, XCircle, Clock, Loader2, Trash2, Edit3, Save, X } from 'lucide-react';

interface Bet {
  id: string;
  event: string;
  sport: string;
  league: string;
  pick: string;
  odds: number;
  stake: number;
  status: string;
  market: string;
  profit: number | null;
  created_at: string;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  const cfg = {
    won:     { bg: 'rgba(0,214,143,0.15)',  color: 'var(--accent-green)', label: 'Ganada',   icon: CheckCircle2 },
    lost:    { bg: 'rgba(239,68,68,0.15)',   color: 'var(--accent-red)',   label: 'Perdida',  icon: XCircle },
    pending: { bg: 'rgba(255,215,0,0.15)',  color: 'var(--accent-gold)',   label: 'Pendiente', icon: Clock },
  }[status] ?? { bg: 'rgba(255,215,0,0.15)', color: 'var(--accent-gold)', label: status, icon: Clock };
  const Icon = cfg.icon;
  return (
    <span style={{ padding: '2px 10px', borderRadius: 99, background: cfg.bg, color: cfg.color, fontSize: '0.72rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

export default function BetCard({ bet }: { bet: Bet }) {
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(bet.status);
  const [localProfit, setLocalProfit] = useState(bet.profit);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [deleted, setDeleted] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editOdds, setEditOdds] = useState(String(bet.odds));
  const [editStake, setEditStake] = useState(String(bet.stake));
  const [editEvent, setEditEvent] = useState(bet.event);
  const [editMarket, setEditMarket] = useState(bet.market || 'H2H');

  if (deleted) return null;

  const potentialWin = (bet.stake * bet.odds).toFixed(2);
  const borderColor = localStatus === 'won' ? 'var(--accent-green)' : localStatus === 'lost' ? 'var(--accent-red)' : 'var(--accent-gold)';

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleMark = (result: 'won' | 'lost') => {
    startTransition(async () => {
      const res = await markBetResult(bet.id, result, parseFloat(String(bet.stake)), parseFloat(String(bet.odds)));
      if (res.success) {
        setLocalStatus(result);
        setLocalProfit(res.profit ?? null);
        showFeedback('success', result === 'won' ? `✅ Ganaste $${Math.abs(res.profit ?? 0).toFixed(2)} neto` : '❌ Registrada como perdida');
      } else {
        showFeedback('error', res.error ?? 'Error desconocido');
      }
    });
  };

  const handleDelete = () => {
    if (!confirm('¿Eliminar esta apuesta? Se devolverá el monto al bankroll.')) return;
    startTransition(async () => {
      const res = await deleteBet(bet.id, parseFloat(String(bet.stake)));
      if (res.success) {
        setDeleted(true);
      } else {
        showFeedback('error', res.error ?? 'No se pudo eliminar');
      }
    });
  };

  const handleSaveEdit = () => {
    startTransition(async () => {
      const res = await editBet(bet.id, {
        event: editEvent,
        odds: parseFloat(editOdds),
        stake: parseFloat(editStake),
        market: editMarket,
      });
      if (res.success) {
        setEditing(false);
        showFeedback('success', '✅ Apuesta actualizada.');
      } else {
        showFeedback('error', res.error ?? 'Error al editar');
      }
    });
  };

  return (
    <div style={{
      padding: '1.1rem 1.25rem',
      background: 'var(--background-secondary)',
      borderRadius: 10,
      borderLeft: `4px solid ${borderColor}`,
      transition: 'all 0.2s',
      opacity: localStatus !== 'pending' ? 0.82 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--foreground-muted)', marginBottom: 3 }}>
            {bet.sport} · {bet.league}
            {bet.market && bet.market !== 'H2H' && <> · <span style={{ color: 'var(--accent-gold)' }}>{bet.market}</span></>}
          </div>
          {editing ? (
            <input
              value={editEvent}
              onChange={e => setEditEvent(e.target.value)}
              style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--background-card)', color: 'var(--foreground)', fontWeight: 700, fontSize: '0.9rem' }}
            />
          ) : (
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editEvent}
            </div>
          )}
        </div>
        <StatusBadge status={localStatus} />
      </div>

      {/* Fields */}
      {editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)', marginBottom: 2 }}>Cuota</div>
            <input type="number" step="0.01" min="1.5" max="5" value={editOdds} onChange={e => setEditOdds(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--background-card)', color: 'var(--accent-gold)', fontWeight: 700 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--foreground-subtle)', marginBottom: 2 }}>Stake ($)</div>
            <input type="number" min="1" value={editStake} onChange={e => setEditStake(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', borderRadius: 6, border: '1px solid var(--accent-green)', background: 'rgba(0,214,143,0.05)', color: 'var(--accent-green)', fontWeight: 700 }} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--foreground-subtle)', textTransform: 'uppercase', marginBottom: 2 }}>Pick</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-green)' }}>{bet.pick}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--foreground-subtle)', textTransform: 'uppercase', marginBottom: 2 }}>Cuota</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-gold)' }}>{parseFloat(String(bet.odds)).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.62rem', color: 'var(--foreground-subtle)', textTransform: 'uppercase', marginBottom: 2 }}>Apostado</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>${parseFloat(String(bet.stake)).toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Bottom Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: localStatus === 'pending' ? 10 : 0 }}>
        {localStatus === 'pending' && !editing ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--foreground-muted)' }}>
            Posible: <strong style={{ color: 'var(--accent-green)' }}>${potentialWin}</strong>
          </div>
        ) : localStatus !== 'pending' ? (
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: (localProfit ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            Profit: {(localProfit ?? 0) >= 0 ? '+' : ''}{(localProfit ?? 0).toFixed(2)}
          </div>
        ) : null}
        <div style={{ fontSize: '0.68rem', color: 'var(--foreground-subtle)' }}>
          {formatDate(bet.created_at)}
        </div>
      </div>

      {/* Action Buttons */}
      {localStatus === 'pending' && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} disabled={isPending}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0.45rem', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer', fontSize: '0.78rem' }}>
                <X size={13} /> Cancelar
              </button>
              <button onClick={handleSaveEdit} disabled={isPending}
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0.45rem', borderRadius: 7, border: 'none', background: 'rgba(0,214,143,0.15)', color: 'var(--accent-green)', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
                {isPending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Guardar
              </button>
            </>
          ) : (
            <>
              <button onClick={() => handleMark('won')} disabled={isPending}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0.45rem', borderRadius: 7, border: 'none', background: 'rgba(0,214,143,0.1)', color: 'var(--accent-green)', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
                {isPending ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />} Ganada
              </button>
              <button onClick={() => handleMark('lost')} disabled={isPending}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0.45rem', borderRadius: 7, border: 'none', background: 'rgba(239,68,68,0.1)', color: 'var(--accent-red)', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
                {isPending ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={13} />} Perdida
              </button>
              <button onClick={() => setEditing(true)} disabled={isPending}
                style={{ padding: '0.45rem 0.6rem', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground-muted)', cursor: 'pointer' }}>
                <Edit3 size={13} />
              </button>
              <button onClick={handleDelete} disabled={isPending}
                style={{ padding: '0.45rem 0.6rem', borderRadius: 7, border: 'none', background: 'rgba(239,68,68,0.08)', color: 'var(--accent-red)', cursor: 'pointer' }}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      )}

      {feedback && (
        <div style={{ marginTop: 8, fontSize: '0.78rem', color: feedback.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)', textAlign: 'center' }}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
}
