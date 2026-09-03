# Módulo: `telegram-fix` — Reparar el Bot de Telegram

## Objetivo
El bot de Telegram está roto. Identificar la causa y repararlo.
Las notificaciones de picks son una feature valiosa una vez reparada.

## Contexto requerido
Leer `docs/BETIQ_V3_CONTEXT.md` completo.

## Diagnóstico probable

### Causas posibles (en orden de probabilidad)

1. **TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no están configuradas en Vercel**
   - El código las lee de `process.env` — si no están en Vercel → el bot silenciosamente
     retorna `{ ok: false, error: 'Missing Telegram credentials' }` sin lanzar error

2. **MarkdownV2 mal escapado** (causa más común de mensajes rotos)
   - Nombres de equipos contienen `.`, `-`, `(`, `)`, etc. que deben escaparse en MarkdownV2
   - Si un carácter no está escapado → Telegram rechaza el mensaje silenciosamente
   - Ejemplo problemático: "Real Madrid vs. Atlético (H2H)" sin escapar los `.`, `(`, `)`

3. **TELEGRAM_CHAT_ID incorrecto** (número negativo para grupos, positivo para chats privados)

## Tareas

### T3.1 — Crear endpoint de test de Telegram
- **Archivo nuevo:** `app/api/admin/test-telegram/route.ts`
- GET endpoint (protegido con CRON_SECRET)
- Llama a `sendTestTelegram()` y retorna el resultado detallado
- También verifica y retorna si las env vars están presentes (sin revelar los valores)

```typescript
// Response esperada:
{
  "hasToken": true,
  "hasChatId": true,
  "telegramResult": { "ok": true } | { "ok": false, "error": "..." }
}
```

### T3.2 — Cambiar de MarkdownV2 a HTML en mensajes de Telegram
- **Archivo:** `lib/notifications/telegram.ts`
- Cambiar `parseMode` de `'MarkdownV2'` a `'HTML'`
- Reescribir `buildDailyPicksMessage()` y `buildAlertMessage()` usando tags HTML:
  - `<b>texto</b>` en lugar de `*texto*`
  - `<i>texto</i>` en lugar de `_texto_`
  - `<code>texto</code>` en lugar de `` `texto` ``
- HTML es mucho más robusto — no requiere escapar caracteres especiales del contenido

### T3.3 — Verificar y documentar env vars en Vercel
- Crear `docs/env-setup.md` con la lista completa de variables de entorno
- Indicar cuáles son obligatorias, cuáles son opcionales, y cómo obtenerlas
- Incluir instrucciones específicas para TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID

### T3.4 — Probar en producción
- Llamar manualmente a `GET /api/admin/test-telegram` con el header correcto
- Verificar que llega el mensaje de test al chat de Telegram
- Si funciona, llamar a `GET /api/cron/send-picks` para probar el resumen diario

## Verificación
- [ ] `GET /api/admin/test-telegram` retorna `{ ok: true }`
- [ ] Mensaje de test aparece en el chat de Telegram
- [ ] `GET /api/cron/send-picks` envía el resumen diario correctamente
- [ ] Los nombres de equipos con caracteres especiales no rompen el mensaje
