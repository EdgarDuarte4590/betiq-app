/**
 * BetIQ Institutional Telegram Notifier v4.0
 *
 * Envía picks diarios, alertas pre-partido y alertas de salud del sistema vía Telegram Bot API.
 * - Utiliza `parse_mode: "HTML"` con sanitización estricta de entidades (`&`, `<`, `>`) para evitar
 *   el rechazo silencioso HTTP 400 de MarkdownV2 con signos `+`, `-`, `.`, `(`, `)`.
 * - Verifica explícitamente `res.ok` y `data.ok`, con fallback automático en texto plano.
 * - Incluye información institucional: Cuota Actual vs Fair Odds (sin vig), Casa de Apuestas,
 *   EV%, Stake Kelly en Unidades, insignia Steam Move y botón Inline Deep-Link (`?QuickBet=<match_id>`).
 */

import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';

// ── Constantes ──────────────────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

function getAppBaseUrl(): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  return envUrl ? envUrl.replace(/\/$/, '') : 'https://betiq-app.vercel.app';
}

// ── Sanitización HTML estricta ───────────────────────────────────────────────

export function escapeHtml(input: string | number | undefined | null): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function isTotalsMarket(market: string): boolean {
  return market === 'Over/Under';
}

function formatPickLinePlain(bestPick: string, bestMarket: string): string {
  if (isTotalsMarket(bestMarket)) {
    return bestPick;
  }
  return `${bestPick} (${bestMarket})`;
}

// ── Construcción de mensajes HTML y Texto Plano ──────────────────────────────

/**
 * Construye el mensaje de picks diarios en formato HTML seguro.
 */
export function buildDailyPicksMessage(picks: SmartPick[]): string {
  const highConfidence = picks.filter(p => p.confidence === 'alta');
  const medConfidence  = picks.filter(p => p.confidence === 'media');
  const dateStr        = escapeHtml(formatDate());

  const lines: string[] = [
    `🎯 <b>BetIQ — Picks Cuantitativos del Día</b>`,
    `📅 ${dateStr}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    '',
  ];

  picks.forEach((pick, i) => {
    const icon      = getSportIcon(pick.sport);
    const confEmoji = getConfidenceEmoji(pick.confidence);
    const time      = escapeHtml(formatMatchTime(pick.commenceTime));
    const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
    const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}%)` : '—';
    const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
    const bookmaker = escapeHtml(pick.bestBookmaker || 'Consenso');
    const pinnacle  = pick.pinnacleAligns ? ' · 📌 <b>Sharp</b>' : '';
    const steam     = pick.isSteamMove ? ' · 🌊 <b>STEAM MOVE</b>' : '';

    lines.push(`<b>${i + 1}. ${icon} ${escapeHtml(pick.event)}</b>`);
    lines.push(`📌 <b>${escapeHtml(formatPickLinePlain(pick.bestPick, pick.bestMarket))}</b> en <i>${bookmaker}</i>`);
    lines.push(`💰 Cuota: <b>${pick.bestOdds.toFixed(2)}</b> vs Justa (Sin Vig): <code>${fairOdds}</code> (${escapeHtml(pick.oddsRange)})`);
    lines.push(`📊 EV: <b>${valueStr}</b> | Stake Kelly: <b>${unitsStr}</b>${pinnacle}${steam}`);
    lines.push(`${confEmoji} Confianza: <b>${escapeHtml(pick.confidence.toUpperCase())}</b>`);
    lines.push(`⏰ ${time} | ${escapeHtml(pick.league)}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📈 Total picks: <b>${picks.length}</b> | 🟢 Alta: <b>${highConfidence.length}</b> | 🟡 Media: <b>${medConfidence.length}</b>`);
  lines.push('');
  lines.push('<i>Motor Cuantitativo BetIQ v4.0 (Power Devigging &amp; Quarter Kelly)</i>');

  return lines.join('\n');
}

/**
 * Versión del mensaje diario en texto plano (fallback infalible).
 */
export function buildDailyPicksMessagePlain(picks: SmartPick[]): string {
  const highConfidence = picks.filter(p => p.confidence === 'alta');
  const medConfidence  = picks.filter(p => p.confidence === 'media');
  const dateStr        = formatDate();

  const lines: string[] = [
    `🎯 BetIQ — Picks Cuantitativos del Día`,
    `📅 ${dateStr}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    '',
  ];

  picks.forEach((pick, i) => {
    const icon      = getSportIcon(pick.sport);
    const confEmoji = getConfidenceEmoji(pick.confidence);
    const time      = formatMatchTime(pick.commenceTime);
    const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
    const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}%)` : '—';
    const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
    const bookmaker = pick.bestBookmaker || 'Consenso';
    const pinnacle  = pick.pinnacleAligns ? ' · 📌 Sharp' : '';
    const steam     = pick.isSteamMove ? ' · 🌊 STEAM MOVE' : '';

    lines.push(`${i + 1}. ${icon} ${pick.event}`);
    lines.push(`📌 ${formatPickLinePlain(pick.bestPick, pick.bestMarket)} en ${bookmaker}`);
    lines.push(`💰 Cuota: ${pick.bestOdds.toFixed(2)} vs Justa: ${fairOdds} (${pick.oddsRange})`);
    lines.push(`📊 EV: ${valueStr} | Stake Kelly: ${unitsStr}${pinnacle}${steam}`);
    lines.push(`${confEmoji} Confianza: ${pick.confidence.toUpperCase()}`);
    lines.push(`⏰ ${time} | ${pick.league}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`📈 Total: ${picks.length} | 🟢 Alta: ${highConfidence.length} | 🟡 Media: ${medConfidence.length}`);
  lines.push('');
  lines.push('Motor Cuantitativo BetIQ v4.0 — Apostar responsablemente.');

  return lines.join('\n');
}

/**
 * Construye un mensaje de alerta de pick de alta confianza (HTML).
 */
export function buildAlertMessage(pick: SmartPick): string {
  const icon      = getSportIcon(pick.sport);
  const time      = escapeHtml(formatMatchTime(pick.commenceTime));
  const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}% bankroll)` : '—';
  const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
  const bookmaker = escapeHtml(pick.bestBookmaker || 'Consenso');
  const pinnacle  = pick.pinnacleAligns ? '\n✅ <b>Respaldado por Consenso Sharp (Pinnacle/Exchange)</b>' : '';
  const steam     = pick.isSteamMove ? `\n🌊 <b>STEAM MOVE DETECTADO${pick.steamMoveDelta ? ` (+${pick.steamMoveDelta.toFixed(1)}% prob sharp)` : ''}</b>` : '';

  return [
    `🚨 <b>BetIQ — Pick Institucional de Alta Confianza</b>`,
    '',
    `${icon} <b>${escapeHtml(pick.event)}</b>`,
    `🏆 Liga: ${escapeHtml(pick.league)} · ⏰ ${time}`,
    `📌 Selección: <b>${escapeHtml(formatPickLinePlain(pick.bestPick, pick.bestMarket))}</b>`,
    `🏦 Casa de Apuestas: <b>${bookmaker}</b>`,
    `💰 Cuota Actual: <b>${pick.bestOdds.toFixed(2)}</b> vs. Cuota Justa (Fair Odds): <code>${fairOdds}</code>`,
    `📊 EV%: <b>${valueStr}</b> | Stake Kelly: <b>${unitsStr}</b>`,
    `🟢 Confianza: <b>ALTA</b>${pinnacle}${steam}`,
    '',
    `<i>BetIQ v4.0 — Power Devigging &amp; Quarter Kelly</i>`,
  ].join('\n');
}

export function buildAlertMessagePlain(pick: SmartPick): string {
  const icon      = getSportIcon(pick.sport);
  const time      = formatMatchTime(pick.commenceTime);
  const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}% bankroll)` : '—';
  const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
  const bookmaker = pick.bestBookmaker || 'Consenso';
  const pinnacle  = pick.pinnacleAligns ? '\n✅ Respaldado por Consenso Sharp (Pinnacle/Exchange)' : '';
  const steam     = pick.isSteamMove ? `\n🌊 STEAM MOVE DETECTADO` : '';

  return [
    `🚨 BetIQ — Pick Institucional de Alta Confianza`,
    '',
    `${icon} ${pick.event}`,
    `🏆 Liga: ${pick.league} · ⏰ ${time}`,
    `📌 Selección: ${formatPickLinePlain(pick.bestPick, pick.bestMarket)}`,
    `🏦 Casa de Apuestas: ${bookmaker}`,
    `💰 Cuota Actual: ${pick.bestOdds.toFixed(2)} vs. Cuota Justa: ${fairOdds}`,
    `📊 EV%: ${valueStr} | Stake Kelly: ${unitsStr}`,
    `🟢 Confianza: ALTA${pinnacle}${steam}`,
    '',
    `BetIQ v4.0 — Apostar responsablemente.`,
  ].join('\n');
}

/**
 * Construye mensaje de alerta pre-partido (intra-día) en HTML con alta densidad de información.
 */
export function buildPreGameAlertMessage(pick: SmartPick): string {
  const icon      = getSportIcon(pick.sport);
  const time      = escapeHtml(formatMatchTime(pick.commenceTime));
  const confEmoji = getConfidenceEmoji(pick.confidence);
  const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}% bankroll)` : '—';
  const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
  const bookmaker = escapeHtml(pick.bestBookmaker || 'Consenso');
  const pinnacle  = pick.pinnacleAligns ? ' · ✅ <b>Sharp</b>' : '';
  const steam     = pick.isSteamMove ? `\n🌊 <b>STEAM MOVE</b>: Entrada fuerte en casas sharp${pick.steamMoveDelta ? ` (+${pick.steamMoveDelta.toFixed(1)}%)` : ''}` : '';

  const diffMs   = new Date(pick.commenceTime).getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60_000);
  let timeLeft   = '';
  if (diffMins > 0) {
    const hours = Math.floor(diffMins / 60);
    const mins  = diffMins % 60;
    timeLeft = hours > 0 ? `~${hours}h ${mins}min` : `~${mins}min`;
  }

  const lines: string[] = [
    `🚨 <b>BetIQ — Oportunidad Pre-Partido Detectada</b>`,
    '',
    `${icon} <b>${escapeHtml(pick.event)}</b>`,
    `🏆 ${escapeHtml(pick.league)} · ⏰ ${time}${timeLeft ? ` (⏳ en ${timeLeft})` : ''}`,
    `📌 Mercado/Selección: <b>${escapeHtml(formatPickLinePlain(pick.bestPick, pick.bestMarket))}</b>`,
    `🏦 Casa de Apuestas: <b>${bookmaker}</b> (rango ${escapeHtml(pick.oddsRange)})`,
    `💰 Cuota Actual: <b>${pick.bestOdds.toFixed(2)}</b> vs. Fair Odds (Sin Vig): <code>${fairOdds}</code>`,
    `📊 Valor Esperado (EV): <b>${valueStr}</b>`,
    `📐 Stake Kelly Recomendado: <b>${unitsStr}</b>`,
    `${confEmoji} Confianza: <b>${escapeHtml(pick.confidence.toUpperCase())}</b>${pinnacle}${steam}`,
    '',
    `<i>BetIQ Quantitative Engine v4.0</i>`,
  ];

  return lines.join('\n');
}

export function buildPreGameAlertMessagePlain(pick: SmartPick): string {
  const icon      = getSportIcon(pick.sport);
  const time      = formatMatchTime(pick.commenceTime);
  const confEmoji = getConfidenceEmoji(pick.confidence);
  const valueStr  = pick.valuePercentage > 0 ? `+${pick.valuePercentage.toFixed(1)}%` : 'N/A';
  const unitsStr  = pick.kellyStake > 0 ? `${pick.kellyStake.toFixed(2)} U (${pick.kellyStake.toFixed(1)}% bankroll)` : '—';
  const fairOdds  = pick.fairOdds ? pick.fairOdds.toFixed(2) : (pick.marketProbability > 0 ? (1 / pick.marketProbability).toFixed(2) : 'N/A');
  const bookmaker = pick.bestBookmaker || 'Consenso';
  const pinnacle  = pick.pinnacleAligns ? ' · ✅ Sharp' : '';
  const steam     = pick.isSteamMove ? `\n🌊 STEAM MOVE DETECTADO` : '';

  const diffMs   = new Date(pick.commenceTime).getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60_000);
  let timeLeft   = '';
  if (diffMins > 0) {
    const hours = Math.floor(diffMins / 60);
    const mins  = diffMins % 60;
    timeLeft = hours > 0 ? `~${hours}h ${mins}min` : `~${mins}min`;
  }

  return [
    `🚨 BetIQ — Oportunidad Pre-Partido Detectada`,
    '',
    `${icon} ${pick.event}`,
    `🏆 ${pick.league} · ⏰ ${time}${timeLeft ? ` (⏳ en ${timeLeft})` : ''}`,
    `📌 Mercado/Selección: ${formatPickLinePlain(pick.bestPick, pick.bestMarket)}`,
    `🏦 Casa de Apuestas: ${bookmaker} (rango ${pick.oddsRange})`,
    `💰 Cuota Actual: ${pick.bestOdds.toFixed(2)} vs. Fair Odds: ${fairOdds}`,
    `📊 Valor Esperado (EV): ${valueStr}`,
    `📐 Stake Kelly Recomendado: ${unitsStr}`,
    `${confEmoji} Confianza: ${pick.confidence.toUpperCase()}${pinnacle}${steam}`,
    '',
    `BetIQ Quantitative Engine v4.0`,
  ].join('\n');
}

// ── Envío ────────────────────────────────────────────────────────────────────

export interface TelegramResult {
  ok:    boolean;
  error?: string;
}

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

    if (!res.ok || !data.ok) {
      const errorMsg = data.description ?? 'Token inválido o revocado';
      console.error(`[Telegram] ❌ Token inválido: ${errorMsg} (código: ${data.error_code})`);
      return { ok: false, error: `${errorMsg} (error_code: ${data.error_code})` };
    }

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
 * Envía un mensaje a Telegram usando `parse_mode: 'HTML'` por defecto.
 * Verifica explícitamente `res.ok` y `data.ok`.
 * Si falla el formato HTML o el `reply_markup`, reintenta automáticamente en texto plano como fallback.
 */
async function sendTelegramMessage(
  text: string,
  parseMode: 'HTML' | null = 'HTML',
  plainFallback?: string,
  replyMarkup?: Record<string, unknown>
): Promise<TelegramResult> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID');
    return { ok: false, error: 'Missing Telegram credentials' };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id:                  chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const rawText = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { ok: false, description: rawText };
    }

    if (!res.ok || !data.ok) {
      const errMsg = data.description ?? `HTTP ${res.status}: ${rawText}`;
      console.error(`[Telegram] ❌ API error: ${errMsg} (status: ${res.status}, código: ${data.error_code})`);

      // Fallback automático en texto plano si falla HTML o reply_markup
      if (parseMode !== null || replyMarkup) {
        const fallbackText = plainFallback ?? text.replace(/<[^>]+>/g, '');
        console.warn('[Telegram] ⚠️ Reintentando envío en texto plano (fallback)...');
        return sendTelegramMessage(fallbackText, null, undefined, undefined);
      }

      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (err: any) {
    console.error('[Telegram] Error de red:', err.message);
    return { ok: false, error: err.message };
  }
}

function buildQuickBetInlineKeyboard(eventId: string): Record<string, unknown> | undefined {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl.startsWith('https://')) return undefined;
  const deepLink = `${baseUrl}/value-bets?QuickBet=${encodeURIComponent(eventId)}`;
  return {
    inline_keyboard: [
      [
        {
          text: '⚡ Registrar Pick en 1-Clic (BetIQ)',
          url: deepLink,
        },
      ],
    ],
  };
}

/**
 * Envía un mensaje avisando que no hay picks con suficiente valor hoy.
 */
export async function sendNoPicksTelegram(eventsCount: number): Promise<TelegramResult> {
  const dateStr = formatDate();
  const htmlText =
    `🤖 <b>BetIQ Diario</b> — ${escapeHtml(dateStr)}\n\n` +
    `Hoy analizamos <b>${eventsCount}</b> partidos, pero ninguno supera los filtros institucionales de valor esperado (EV+). 📉\n\n` +
    `<i>Preservar el capital también es ganar.</i> 💰`;

  const plainText =
    `🤖 BetIQ Diario — ${dateStr}\n\n` +
    `Hoy analizamos ${eventsCount} partidos, pero ninguno supera los filtros institucionales de valor esperado (EV+). 📉\n\n` +
    `Preservar el capital también es ganar. 💰`;

  console.log(`[Telegram] 📤 Enviando aviso de sin picks (analizados ${eventsCount})...`);
  return sendTelegramMessage(htmlText, 'HTML', plainText);
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
  const replyMarkup  = picks[0]?.eventId ? buildQuickBetInlineKeyboard(picks[0].eventId) : undefined;
  return sendTelegramMessage(message, 'HTML', plainMessage, replyMarkup);
}

/**
 * Envía una alerta inmediata de un pick de alta confianza con botón Deep-Link.
 */
export async function sendPickAlertTelegram(pick: SmartPick): Promise<TelegramResult> {
  console.log(`[Telegram] 🚨 Enviando alerta de pick: ${pick.event}`);
  const message      = buildAlertMessage(pick);
  const plainMessage = buildAlertMessagePlain(pick);
  const replyMarkup  = buildQuickBetInlineKeyboard(pick.eventId);
  return sendTelegramMessage(message, 'HTML', plainMessage, replyMarkup);
}

/**
 * Envía una alerta pre-partido por Telegram con formato HTML + fallback texto plano + botón Deep-Link.
 */
export async function sendPreGameAlertTelegram(pick: SmartPick): Promise<TelegramResult> {
  console.log(`[Telegram] 🚨 Enviando alerta pre-partido: ${pick.event}`);
  const message      = buildPreGameAlertMessage(pick);
  const plainMessage = buildPreGameAlertMessagePlain(pick);
  const replyMarkup  = buildQuickBetInlineKeyboard(pick.eventId);
  return sendTelegramMessage(message, 'HTML', plainMessage, replyMarkup);
}

/**
 * Envía una Alerta de Salud del Sistema al administrador por Telegram cuando
 * hay 0 partidos futuros en snapshots o las API keys están agotadas.
 */
export async function sendSystemHealthAlertTelegram(detail: string): Promise<TelegramResult> {
  const htmlText =
    `⚠️ <b>BetIQ System Health Alert</b>\n\n` +
    `0 partidos futuros en snapshots o API Keys agotadas.\n` +
    `Detalle: <code>${escapeHtml(detail)}</code>`;
  const plainText =
    `⚠️ BetIQ Alert: 0 partidos futuros en snapshots o API Keys agotadas.\nDetalle: ${detail}`;

  return sendTelegramMessage(htmlText, 'HTML', plainText);
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
    '✅ <b>BetIQ v4.0</b> — Bot conectado correctamente!\n\nLas notificaciones cuantitativas están activas.',
    'HTML',
    '✅ BetIQ v4.0 — Bot conectado correctamente!\n\nLas notificaciones cuantitativas están activas.'
  );
}
