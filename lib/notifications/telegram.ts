/**
 * BetIQ Telegram Notifier v3.0
 *
 * Envía picks diarios y alertas de alta confianza vía Telegram Bot API.
 * Sin dependencias externas — usa fetch nativo.
 *
 * IMPORTANTE: Usa HTML parse mode (no MarkdownV2) para evitar errores de
 * escape con caracteres especiales en nombres de equipos y ligas.
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

/** Escapa caracteres especiales de HTML para evitar que rompan el parseado */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Construcción del mensaje ─────────────────────────────────────────────────

/**
 * Construye el mensaje de picks diarios en formato HTML para Telegram.
 * HTML es más robusto que MarkdownV2 — no requiere escapar caracteres especiales.
 */
export function buildDailyPicksMessage(picks: SmartPick[]): string {
  const highConfidence = picks.filter(p => p.confidence === 'alta');
  const medConfidence  = picks.filter(p => p.confidence === 'media');
  const dateStr        = formatDate();

  const lines: string[] = [
    `🎯 <b>BetIQ — Picks del Día</b>`,
    `📅 ${escapeHtml(dateStr)}`,
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

    lines.push(`<b>${i + 1}. ${icon} ${escapeHtml(pick.event)}</b>`);
    lines.push(`📌 ${escapeHtml(pick.bestPick)} (${escapeHtml(pick.bestMarket)})`);
    lines.push(`💰 Cuota: <b>${pick.bestOdds.toFixed(2)}</b> (${escapeHtml(pick.oddsRange)})`);
    lines.push(`📊 Value: <b>${valueStr}</b> | Kelly: ${kellyStr}${pinnacle}`);
    lines.push(`${confEmoji} Confianza: <b>${pick.confidence.toUpperCase()}</b>`);
    lines.push(`⏰ ${time} | ${escapeHtml(pick.league)}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📈 Total picks: <b>${picks.length}</b> | 🟢 Alta confianza: <b>${highConfidence.length}</b> | 🟡 Media: <b>${medConfidence.length}</b>`);
  lines.push('');
  lines.push('<i>Análisis generado automáticamente por BetIQ v3.0</i>');
  lines.push('<i>Apostar responsablemente. Esto no es consejo financiero.</i>');

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
  const pinnacle = pick.pinnacleAligns ? '\n✅ <b>Respaldado por Pinnacle/Sharp books</b>' : '';

  return [
    `🚨 <b>BetIQ — Pick de Alta Confianza</b>`,
    '',
    `${icon} <b>${escapeHtml(pick.event)}</b>`,
    `📌 ${escapeHtml(pick.bestPick)} (${escapeHtml(pick.bestMarket)})`,
    `💰 Cuota: <b>${pick.bestOdds.toFixed(2)}</b> en ${escapeHtml(pick.oddsRange)}`,
    `📊 Value: <b>${valueStr}</b> | Kelly: ${kellyStr}`,
    `🟢 Confianza: <b>ALTA</b>${pinnacle}`,
    `⏰ ${time} | ${escapeHtml(pick.league)}`,
    '',
    '<i>BetIQ v3.0 — Apostar responsablemente</i>',
  ].join('\n');
}

// ── Envío ────────────────────────────────────────────────────────────────────

interface TelegramResult {
  ok:    boolean;
  error?: string;
}

/**
 * Envía un mensaje de texto a un chat de Telegram usando HTML parse mode.
 * HTML es más robusto que MarkdownV2 — no requiere escapar caracteres especiales.
 */
async function sendTelegramMessage(
  text: string,
): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en las env vars');
    return { ok: false, error: 'Missing Telegram credentials' };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  chatId,
        text,
        parse_mode:               'HTML',
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
 * Llamar a GET /api/admin/test-telegram para usarla.
 */
export async function sendTestTelegram(): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' };
  }

  return sendTelegramMessage(
    '✅ <b>BetIQ v3.0 — Bot conectado correctamente!</b>\n\nLas notificaciones de picks están activas.',
  );
}
