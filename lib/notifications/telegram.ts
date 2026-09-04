/**
 * BetIQ Telegram Notifier
 *
 * Envía picks diarios y alertas de alta confianza vía Telegram Bot API.
 * Sin dependencias externas — usa fetch nativo.
 *
 * Setup (una vez):
 *   1. Crea un bot en Telegram con @BotFather → obtienes TELEGRAM_BOT_TOKEN
 *   2. Escríbele un mensaje a tu bot
 *   3. Visita: https://api.telegram.org/bot<TOKEN>/getUpdates
 *      → En "chat.id" encontrarás tu TELEGRAM_CHAT_ID
 *   4. Agrega ambas variables a .env.local y a Vercel Environment Variables
 */

import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';

// ── Constantes ──────────────────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

// ── Utilidades de formato ────────────────────────────────────────────────────

function getSportIcon(sport: string): string {
  if (sport.includes('soccer') || sport.includes('fifa')) return '⚽';
  if (sport.includes('basketball'))                         return '🏀';
  if (sport.includes('baseball'))                           return '⚾';
  if (sport.includes('football'))                           return '🏈';
  if (sport.includes('hockey'))                             return '🏒';
  if (sport.includes('tennis'))                             return '🎾';
  return '🏟️';
}

function getConfidenceEmoji(confidence: SmartPick['confidence']): string {
  switch (confidence) {
    case 'alta':  return '🟢';
    case 'media': return '🟡';
    case 'baja':  return '🔴';
  }
}

function formatMatchTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
    return date.toLocaleTimeString('es-MX', {
      hour:   '2-digit',
      minute: '2-digit',
      timeZone: 'America/Mexico_City',
    }) + ' CST';
  } catch {
    return isoTime;
  }
}

function formatDate(): string {
  return new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    day:     'numeric',
    month:   'short',
    timeZone: 'America/Mexico_City',
  });
}

// ── Construcción del mensaje ─────────────────────────────────────────────────

/**
 * Construye el mensaje de picks diarios en formato Telegram (Markdown v2 escapado).
 */
export function buildDailyPicksMessage(picks: SmartPick[]): string {
  const highConfidence = picks.filter(p => p.confidence === 'alta');
  const medConfidence  = picks.filter(p => p.confidence === 'media');
  const dateStr        = formatDate();

  const lines: string[] = [
    `🎯 *BetIQ — Picks del Día*`,
    `📅 ${dateStr}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    '',
  ];

  picks.forEach((pick, i) => {
    const icon        = getSportIcon(pick.sport);
    const confEmoji   = getConfidenceEmoji(pick.confidence);
    const time        = formatMatchTime(pick.commenceTime);
    const valueStr    = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
    const kellyStr    = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(1)}% bankroll` : '—';
    const pinnacle    = pick.pinnacleAligns ? ' ✅ Sharp' : '';

    lines.push(`*${i + 1}\\. ${icon} ${pick.event}*`);
    lines.push(`📌 ${pick.bestPick} \\(${pick.bestMarket}\\)`);
    lines.push(`💰 Cuota: *${pick.bestOdds.toFixed(2)}* \\(${pick.oddsRange}\\)`);
    lines.push(`📊 Value: *${valueStr}* \\| Kelly: ${kellyStr}${pinnacle}`);
    lines.push(`${confEmoji} Confianza: *${pick.confidence.toUpperCase()}*`);
    lines.push(`⏰ ${time} \\| ${pick.league}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📈 Total picks: *${picks.length}* \\| 🟢 Alta confianza: *${highConfidence.length}* \\| 🟡 Media: *${medConfidence.length}*`);
  lines.push('');
  lines.push('_Análisis generado automáticamente por BetIQ v3\\.0_');
  lines.push('_Apostar responsablemente\\. Esto no es consejo financiero\\._');

  return lines.join('\n');
}

/**
 * Versión del mensaje diario en texto plano (sin Markdown).
 * Úsala como fallback si MarkdownV2 falla.
 */
export function buildDailyPicksMessagePlain(picks: SmartPick[]): string {
  const highConfidence = picks.filter(p => p.confidence === 'alta');
  const medConfidence  = picks.filter(p => p.confidence === 'media');
  const dateStr        = formatDate();

  const lines: string[] = [
    `🎯 BetIQ — Picks del Día`,
    `📅 ${dateStr}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    '',
  ];

  picks.forEach((pick, i) => {
    const icon      = getSportIcon(pick.sport);
    const confEmoji = getConfidenceEmoji(pick.confidence);
    const time      = formatMatchTime(pick.commenceTime);
    const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
    const kellyStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(1)}% bankroll` : '—';
    const pinnacle  = pick.pinnacleAligns ? ' ✅ Sharp' : '';

    lines.push(`${i + 1}. ${icon} ${pick.event}`);
    lines.push(`📌 ${pick.bestPick} (${pick.bestMarket})`);
    lines.push(`💰 Cuota: ${pick.bestOdds.toFixed(2)} (${pick.oddsRange})`);
    lines.push(`📊 Value: ${valueStr} | Kelly: ${kellyStr}${pinnacle}`);
    lines.push(`${confEmoji} Confianza: ${pick.confidence.toUpperCase()}`);
    lines.push(`⏰ ${time} | ${pick.league}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📈 Total: ${picks.length} | 🟢 Alta: ${highConfidence.length} | 🟡 Media: ${medConfidence.length}`);
  lines.push('');
  lines.push('Análisis generado automáticamente por BetIQ v3.0');
  lines.push('Apostar responsablemente. Esto no es consejo financiero.');

  return lines.join('\n');
}

/**
 * Construye un mensaje de alerta de pick de alta confianza (notificación inmediata).
 */
export function buildAlertMessage(pick: SmartPick): string {
  const icon     = getSportIcon(pick.sport);
  const time     = formatMatchTime(pick.commenceTime);
  const valueStr = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const kellyStr = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(1)}% bankroll` : '—';
  const pinnacle = pick.pinnacleAligns ? '\n✅ *Respaldado por Pinnacle/Sharp books*' : '';

  return [
    `🚨 *BetIQ — Pick de Alta Confianza*`,
    '',
    `${icon} *${pick.event}*`,
    `📌 ${pick.bestPick} \\(${pick.bestMarket}\\)`,
    `💰 Cuota: *${pick.bestOdds.toFixed(2)}* en ${pick.oddsRange}`,
    `📊 Value: *${valueStr}* \\| Kelly: ${kellyStr}`,
    `🟢 Confianza: *ALTA*${pinnacle}`,
    `⏰ ${time} \\| ${pick.league}`,
    '',
    '_BetIQ v3\\.0 — Apostar responsablemente_',
  ].join('\n');
}

/**
 * Construye mensaje de alerta pre-partido (oportunidad detectada intra-día).
 * Incluye el tiempo estimado hasta que empiece el partido.
 */
export function buildPreGameAlertMessage(pick: SmartPick): string {
  const icon      = getSportIcon(pick.sport);
  const time      = formatMatchTime(pick.commenceTime);
  const confEmoji = getConfidenceEmoji(pick.confidence);
  const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const kellyStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(1)}% bankroll` : '—';
  const pinnacle  = pick.pinnacleAligns ? ' ✅ Sharp' : '';

  // Calcular tiempo restante hasta el partido
  const diffMs   = new Date(pick.commenceTime).getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60_000);
  let timeLeft   = '';
  if (diffMins > 0) {
    const hours = Math.floor(diffMins / 60);
    const mins  = diffMins % 60;
    timeLeft = hours > 0 ? `~${hours}h ${mins}min` : `~${mins}min`;
  }

  const lines: string[] = [
    `🚨 BetIQ — Oportunidad Detectada`,
    '',
    `${icon} ${pick.event}`,
    `📌 ${pick.bestPick} (${pick.bestMarket})`,
    `💰 Cuota: ${pick.bestOdds.toFixed(2)} (${pick.oddsRange})`,
    `📊 Value: ${valueStr} | Kelly: ${kellyStr}${pinnacle}`,
    `${confEmoji} Confianza: ${pick.confidence.toUpperCase()}`,
    `⏰ ${time} | ${pick.league}`,
  ];

  if (timeLeft) {
    lines.push(`⏳ Empieza en ${timeLeft}`);
  }

  lines.push('');
  lines.push('💡 Esta oportunidad no estaba en el digest de esta mañana.');
  lines.push('');
  lines.push('BetIQ v3.1 — Apostar responsablemente.');

  return lines.join('\n');
}

// ── Envío ────────────────────────────────────────────────────────────────────

interface TelegramResult {
  ok:    boolean;
  error?: string;
}

/**
 * Verifica si el bot token es válido llamando a /getMe.
 * No envía ningún mensaje — solo comprueba la autenticación.
 */
export async function verifyBotToken(): Promise<{
  ok: boolean;
  botName?: string;
  botUsername?: string;
  error?: string;
}> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN no está configurado en .env.local' };
  }

  try {
    const res  = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    const data = await res.json();

    if (!data.ok) {
      const errorMsg = data.description ?? 'Token inválido o revocado';
      console.error(`[Telegram] ❌ Token inválido: ${errorMsg} (código: ${data.error_code})`);
      return { ok: false, error: `${errorMsg} (error_code: ${data.error_code})` };
    }

    console.log(`[Telegram] ✅ Bot activo: @${data.result.username} (${data.result.first_name})`);
    return {
      ok:          true,
      botName:     data.result.first_name,
      botUsername: data.result.username,
    };
  } catch (err: any) {
    console.error('[Telegram] Error de red al verificar token:', err.message);
    return { ok: false, error: `Error de red: ${err.message}` };
  }
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 * Si MarkdownV2 falla por un error de parseo, reintenta en texto plano.
 */
async function sendTelegramMessage(
  text: string,
  parseMode: 'MarkdownV2' | 'HTML' | null = 'MarkdownV2',
  plainFallback?: string,
): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env.local');
    return { ok: false, error: 'Missing Telegram credentials' };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id:                  chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) body.parse_mode = parseMode;

    const res  = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await res.json();

    if (!data.ok) {
      const errMsg = data.description ?? 'Error desconocido';
      console.error(`[Telegram] ❌ API error: ${errMsg} (código: ${data.error_code})`);

      // Si el error es de parseo de Markdown y tenemos fallback, reintentamos en texto plano
      if (
        parseMode === 'MarkdownV2' &&
        plainFallback &&
        (data.error_code === 400 || errMsg.toLowerCase().includes('parse'))
      ) {
        console.warn('[Telegram] ⚠️ Fallo de MarkdownV2, reintentando en texto plano...');
        return sendTelegramMessage(plainFallback, null);
      }

      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (err: any) {
    console.error('[Telegram] Error de red:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Envía el resumen diario de picks a Telegram.
 */
export async function sendDailyPicksTelegram(picks: SmartPick[]): Promise<TelegramResult> {
  if (picks.length === 0) {
    console.log('[Telegram] Sin picks para enviar hoy');
    return { ok: true };
  }

  console.log(`[Telegram] 📤 Enviando ${picks.length} picks diarios...`);
  const message      = buildDailyPicksMessage(picks);
  const plainMessage = buildDailyPicksMessagePlain(picks);
  return sendTelegramMessage(message, 'MarkdownV2', plainMessage);
}

/**
 * Envía una alerta inmediata de un pick de alta confianza.
 */
export async function sendPickAlertTelegram(pick: SmartPick): Promise<TelegramResult> {
  console.log(`[Telegram] 🚨 Enviando alerta de pick: ${pick.event}`);
  const message = buildAlertMessage(pick);
  return sendTelegramMessage(message, 'MarkdownV2');
}

/**
 * Envía una alerta pre-partido por Telegram (texto plano para simplicidad).
 */
export async function sendPreGameAlertTelegram(pick: SmartPick): Promise<TelegramResult> {
  console.log(`[Telegram] 🚨 Enviando alerta pre-partido: ${pick.event}`);
  const message = buildPreGameAlertMessage(pick);
  return sendTelegramMessage(message, null); // texto plano para evitar problemas de parseo
}

/**
 * Prueba de conectividad: envía un mensaje simple para verificar que el bot funciona.
 */
export async function sendTestTelegram(): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env.local' };
  }

  return sendTelegramMessage(
    '✅ BetIQ v3.0 — Bot conectado correctamente!\n\nLas notificaciones de picks están activas.',
    null, // texto plano para el mensaje de prueba
  );
}

