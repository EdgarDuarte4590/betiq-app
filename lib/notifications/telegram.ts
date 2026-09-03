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

// ── Envío ────────────────────────────────────────────────────────────────────

interface TelegramResult {
  ok:    boolean;
  error?: string;
}

/**
 * Envía un mensaje de texto a un chat de Telegram.
 */
async function sendTelegramMessage(
  text: string,
  parseMode: 'MarkdownV2' | 'HTML' = 'MarkdownV2'
): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env.local');
    return { ok: false, error: 'Missing Telegram credentials' };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json();

    if (!data.ok) {
      console.error('[Telegram] Error API:', data.description);
      return { ok: false, error: data.description };
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
  const message = buildDailyPicksMessage(picks);
  return sendTelegramMessage(message);
}

/**
 * Envía una alerta inmediata de un pick de alta confianza.
 */
export async function sendPickAlertTelegram(pick: SmartPick): Promise<TelegramResult> {
  console.log(`[Telegram] 🚨 Enviando alerta de pick: ${pick.event}`);
  const message = buildAlertMessage(pick);
  return sendTelegramMessage(message);
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
    '✅ *BetIQ v3\\.0 — Bot conectado correctamente\\!*\n\nLas notificaciones de picks están activas\\.',
  );
}
