import { NextResponse } from 'next/server';
import { sendTestTelegram, verifyBotToken } from '@/lib/notifications/telegram';
import { getAllKeyStatuses, initializeKeys } from '@/lib/apis/key-manager';
import { getLatestEventsFromSnapshot } from '@/app/actions/snapshots';

/**
 * Ruta de diagnóstico institucional — verifica el estado de todo el sistema v4.0
 * GET /api/admin/status
 */
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    version:   'BetIQ v4.0 (Quantitative Institutional Engine)',
  };

  // 1. Estado del pool de API keys (api_keys_status / api_key_usage)
  try {
    await initializeKeys();
    const keyStatuses = await getAllKeyStatuses();
    results.apiKeys = {
      total:      keyStatuses.length,
      available:  keyStatuses.filter(k => !k.isExhausted && k.requestsUsed < 490).length,
      exhausted:  keyStatuses.filter(k => k.isExhausted).length,
      detail:     keyStatuses.map(k => ({
        key:                k.keyHash,
        used:               k.requestsUsed,
        left:               k.requestsLeft,
        requests_remaining: k.requestsRemaining,
        exhausted:          k.isExhausted,
        exhausted_until:    k.exhaustedUntil,
        error_count:        k.errorCount,
        lastUsed:           k.lastUsedAt,
        last_used_at:       k.lastUsedAt,
        resetsAt:           k.resetAt,
      })),
    };
  } catch (err: any) {
    results.apiKeys = { error: err.message };
  }

  // 2. Estado de Snapshots en Supabase
  try {
    const snap = await getLatestEventsFromSnapshot(7);
    results.snapshots = {
      fresh:             snap.fresh,
      snapshotAgeMins:   snap.snapshotAge,
      totalEvents:       snap.events.length,
      futureEventsCount: snap.futureEventsCount,
    };
  } catch (err: any) {
    results.snapshots = { error: err.message };
  }

  // 3. Verificación del bot de Telegram
  const hasToken  = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasChatId = !!process.env.TELEGRAM_CHAT_ID;

  if (hasToken) {
    const botVerification = await verifyBotToken();
    results.telegram = {
      configured:  hasToken && hasChatId,
      tokenSet:    hasToken,
      chatIdSet:   hasChatId,
      tokenValid:  botVerification.ok,
      botName:     botVerification.botName ?? null,
      botUsername: botVerification.botUsername ?? null,
      tokenError:  botVerification.error ?? null,
    };
  } else {
    results.telegram = {
      configured:  false,
      tokenSet:    false,
      chatIdSet:   hasChatId,
      tokenValid:  false,
      tokenError:  'TELEGRAM_BOT_TOKEN no configurado',
    };
  }

  // 4. Variables de entorno críticas
  results.env = {
    THE_ODDS_API_KEYS:         !!process.env.THE_ODDS_API_KEYS,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN:        hasToken,
    TELEGRAM_CHAT_ID:          hasChatId,
  };

  return NextResponse.json(results, { status: 200 });
}

export async function POST() {
  const result = await sendTestTelegram();
  return NextResponse.json(result);
}
