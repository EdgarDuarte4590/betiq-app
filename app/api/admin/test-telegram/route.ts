import { NextResponse } from 'next/server';
import { sendTestTelegram } from '@/lib/notifications/telegram';

/**
 * Endpoint de diagnóstico para verificar la conectividad del bot de Telegram.
 *
 * Uso:
 *   GET /api/admin/test-telegram
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Retorna el estado de las env vars y el resultado del mensaje de prueba.
 * Nunca revela los valores de las env vars — solo si están presentes o no.
 */
export async function GET(request: Request) {
  // Proteger con el mismo CRON_SECRET
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasToken  = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasChatId = Boolean(process.env.TELEGRAM_CHAT_ID);

  if (!hasToken || !hasChatId) {
    return NextResponse.json({
      ok:       false,
      hasToken,
      hasChatId,
      error:    'Faltan variables de entorno. Configurar TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en Vercel.',
    }, { status: 400 });
  }

  const result = await sendTestTelegram();

  return NextResponse.json({
    ok:              result.ok,
    hasToken,
    hasChatId,
    telegramResult:  result,
    timestamp:       new Date().toISOString(),
  });
}
