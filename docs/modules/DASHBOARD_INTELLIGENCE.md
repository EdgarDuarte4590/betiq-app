# Módulo: `dashboard-intelligence` — IA + UI Redesign

## Objetivo
Transformar el Dashboard en la experiencia definitiva del apostador inteligente:
picks explicados en español por IA (Gemini Flash), nuevo diseño visual que impresiona,
y datos presentados de forma clara y accionable.

## Contexto requerido
Leer `docs/BETIQ_V3_CONTEXT.md` completo. Este módulo depende de M0 (auth activa)
y M1 (dashboard leyendo desde Supabase, no de la API directa).

## Tareas

### T2.1 — Integración Gemini Flash
- **Instalar:** `npm install @google/generative-ai`
- **Archivo nuevo:** `lib/ai/gemini.ts`

```typescript
// lib/ai/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function generatePickReasoning(pick: SmartPick): Promise<string>
// Returns: 2-3 frases en español explicando POR QUÉ es un buen pick
// Ejemplo: "Arsenal juega en casa y su forma reciente es sólida (4V en los últimos 5).
//           Pinnacle y Betfair respaldan una probabilidad real del 64%, pero la cuota
//           ofrecida implica solo el 58%. Ese gap del +7.3% es el edge real."
```

- **Prompt optimizado para Gemini:**
  ```
  Eres un analista experto en apuestas deportivas. En máximo 3 frases en español,
  explica de forma clara y directa por qué este pick tiene valor estadístico.
  Menciona la probabilidad real vs la implícita en las cuotas, y el respaldo de
  los sharp books si aplica. Evita tecnicismos excesivos. Sé directo y útil.

  Pick: {event} | {bestPick} | Cuota: {bestOdds} | Value: +{valuePercentage}%
  Probabilidad real: {marketProbability}% | Pinnacle alinea: {pinnacleAligns}
  Confianza: {confidence} | Bookmakers: {bookmakerCount}
  ```

### T2.2 — Caché de reasoning en Supabase
- **Tabla nueva:**
  ```sql
  CREATE TABLE pick_reasoning (
    event_id    text,
    date        date,  -- fecha del partido (para invalidar automáticamente)
    reasoning   text,
    model       text DEFAULT 'gemini-2.0-flash',
    created_at  timestamptz DEFAULT now(),
    PRIMARY KEY (event_id, date)
  );
  ```
- **Lógica:** Si ya existe reasoning para `(event_id, today)` → usar el cacheado.
  Si no → llamar a Gemini y guardar.
- **Nunca** llamar a Gemini en cada render del dashboard.

### T2.3 — Rediseño de PickCard
- **Archivo:** `components/value-bets/PickCard.tsx`
- Nuevo diseño visual con:
  - **Header del partido:** Teams vs Teams + deporte + liga + hora
  - **Badge de confianza:** barra de progreso de color (verde=alta, amarillo=media, rojo=baja)
  - **Value badge:** `+7.3% edge` con color prominente
  - **Cuota destacada:** El número de cuota grande y llamativo
  - **Pills de bookmakers:** Los top 3 bookmakers con sus cuotas
  - **Reasoning de IA:** Sección expandible "¿Por qué este pick?" con el texto de Gemini
  - **Botón apostar:** CTA que abre el GlobalBetModal
  - **Indicador Pinnacle:** Badge "✅ Sharp" si pinnacleAligns=true
- Usar TailwindCSS v4 con las variables CSS del proyecto
- Animación de entrada con `animate-fade-in`

### T2.4 — Rediseño de Dashboard Layout
- **Archivo:** `app/dashboard/page.tsx`
- Extraer subcomponentes:
  - `components/dashboard/DashboardHeader.tsx` — header con fecha, live badge, bienvenida
  - `components/dashboard/StatGrid.tsx` — las 4 stat cards con animaciones
  - `components/dashboard/PicksSection.tsx` — secciones de picks (en juego, próximas, mañana)
- Nuevas stat cards: glassmorphism + micro-animaciones al hover
- Skeleton loading mejorado durante carga de picks

### T2.5 — Enriquecimiento con Gemini en el pipeline
- **Archivo:** `lib/algorithms/value-bet-calculator.ts`
- Nueva función: `enrichPicksWithGemini(picks: SmartPick[]): Promise<SmartPick[]>`
- Solo generar reasoning para los top 5 picks (los más importantes)
- Agregar campo `reasoning?: string` a la interfaz `SmartPick`
- Llamar desde `app/dashboard/page.tsx` después de `enrichPicksWithStats()`

## Estimación de llamadas a Gemini
- Solo los top 5 picks por día (si no están cacheados)
- Con caché diaria: máximo 5 llamadas nuevas/día
- Google AI Pro plan: más que suficiente para esto

## Verificación
```bash
npm run build
npm run lint
```
- [ ] El PickCard rediseñado se ve premium en mobile y desktop
- [ ] El reasoning aparece en español y es coherente con el pick
- [ ] El reasoning NO se regenera en recargas (caché funcionando)
- [ ] Las stat cards tienen animaciones suaves
- [ ] El dashboard carga en < 2 segundos (datos desde Supabase, no API externa)
