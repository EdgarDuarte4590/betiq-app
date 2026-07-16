import { NextResponse } from 'next/server';
import { sendTestTelegram } from '@/lib/notifications/telegram';
import { getAllKeyStatuses, initializeKeys } from '@/lib/apis/key-manager';

/**
 * Ruta de diagnóstico — verifica el estado de todo el sistema v3.0
 * GET /api/admin/status
 *
 * ⚠️ Solo para uso en desarrollo/admin. Proteger en producción.
 */
export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    version:   'BetIQ v3.0',
  };

  // 1. Estado del pool de API keys
  try {
    await initializeKeys(); // Asegura que todas las keys estén registradas
    const keyStatuses = await getAllKeyStatuses();
    results.apiKeys = {
      total:      keyStatuses.length,
      available:  keyStatuses.filter(k => !k.isExhausted && k.requestsUsed < 490).length,
      exhausted:  keyStatuses.filter(k => k.isExhausted).length,
      detail:     keyStatuses.map(k => ({
        key:          k.keyHash,
        used:         k.requestsUsed,
        left:         k.requestsLeft,
        exhausted:    k.isExhausted,
        lastUsed:     k.lastUsedAt,
        resetsAt:     k.resetAt,
      })),
    };
  } catch (err: any) {
    results.apiKeys = { error: err.message };
  }

  // 2. Test de Telegram
  const hasToken  = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasChatId = !!process.env.TELEGRAM_CHAT_ID;
  results.telegram = {
    configured: hasToken && hasChatId,
    tokenSet:   hasToken,
    chatIdSet:  hasChatId,
  };

  // 3. Variables de entorno críticas
  results.env = {
    THE_ODDS_API_KEYS:         !!process.env.THE_ODDS_API_KEYS,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN:        hasToken,
    TELEGRAM_CHAT_ID:          hasChatId,
  };

  return NextResponse.json(results, { status: 200 });
}

/**
 * POST /api/admin/status
 * Envía un mensaje de prueba a Telegram para verificar la conexión.
 */
export async function POST() {
  const result = await sendTestTelegram();
  return NextResponse.json(result);
}
