'use client';

import { useState, useTransition } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { syncScores } from '@/app/actions/syncScores';
import { useRouter } from 'next/navigation';

export default function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    type: 'success' | 'info' | 'error';
    msg: string;
  } | null>(null);
  const router = useRouter();

  const handleSync = () => {
    startTransition(async () => {
      setResult(null);
      const res = await syncScores();

      if (!res.success) {
        setResult({ type: 'error', msg: res.error ?? 'Error desconocido' });
        return;
      }

      if (res.graded === 0) {
        setResult({
          type: 'info',
          msg: res.skipped > 0
            ? `No se pudo calificar automáticamente. ${res.skipped} apuesta(s) no coincidieron con partidos finalizados.`
            : 'No hay apuestas pendientes para calificar.',
        });
      } else {
        setResult({
          type: 'success',
          msg: `✅ ${res.graded} apuesta(s) calificadas: ${res.won} ganada(s), ${res.lost} perdida(s).${res.skipped > 0 ? ` (${res.skipped} sin resultado aún)` : ''}`,
        });
        router.refresh();
      }

      // Auto-dismiss after 8 seconds
      setTimeout(() => setResult(null), 8000);
    });
  };

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={isPending}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '0.6rem 1.2rem',
          borderRadius: 8,
          border: '1px solid rgba(0,214,143,0.3)',
          background: 'rgba(0,214,143,0.08)',
          color: 'var(--accent-green)',
          fontWeight: 700,
          fontSize: '0.82rem',
          cursor: isPending ? 'wait' : 'pointer',
          opacity: isPending ? 0.7 : 1,
          transition: 'all 0.2s',
        }}
      >
        {isPending ? (
          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <RefreshCw size={15} />
        )}
        {isPending ? 'Sincronizando...' : '⚡ Sincronizar Resultados'}
      </button>

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: '0.65rem 1rem',
            borderRadius: 8,
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background:
              result.type === 'success'
                ? 'rgba(0,214,143,0.1)'
                : result.type === 'error'
                ? 'rgba(239,68,68,0.1)'
                : 'rgba(59,130,246,0.1)',
            color:
              result.type === 'success'
                ? 'var(--accent-green)'
                : result.type === 'error'
                ? 'var(--accent-red)'
                : '#93c5fd',
            border: `1px solid ${
              result.type === 'success'
                ? 'rgba(0,214,143,0.3)'
                : result.type === 'error'
                ? 'rgba(239,68,68,0.3)'
                : 'rgba(59,130,246,0.3)'
            }`,
            animation: 'fadeIn 0.3s ease',
          }}
        >
          {result.type === 'success' ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          {result.msg}
        </div>
      )}
    </div>
  );
}
