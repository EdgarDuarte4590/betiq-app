import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@/lib/supabase/server';
import type { SmartPick } from '@/lib/algorithms/value-bet-calculator';

// Inicializar el SDK de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Genera o recupera (desde caché) el razonamiento de un pick usando IA.
 */
export async function getPickReasoning(pick: SmartPick): Promise<string> {
  const eventId = pick.eventId;
  
  // Extraer solo la fecha local (YYYY-MM-DD) para invalidación diaria automática
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const supabase = await createClient();

    // 1. Intentar buscar en caché
    const { data: cached } = await supabase
      .from('pick_reasoning')
      .select('reasoning')
      .eq('event_id', eventId)
      .eq('date', todayStr)
      .single();

    if (cached?.reasoning) {
      console.log(`[Gemini] Hit caché para ${eventId}`);
      return cached.reasoning;
    }

    // 2. Si no hay caché, llamar a Gemini
    console.log(`[Gemini] Generando razonamiento para ${eventId}...`);
    
    const prompt = `
Eres un analista experto en apuestas deportivas y pronósticos basados en datos matemáticos. 
En MÁXIMO 3 ORACIONES (3 frases) en español, explica de forma directa por qué el siguiente pronóstico (pick) tiene valor estadístico. 
Menciona la rentabilidad (edge o value), la confianza del sistema y si las casas de apuestas asiáticas (sharp) respaldan la línea.
Sé muy conciso, usa un tono analítico pero accesible. Evita saludos, ve directo al grano.

DATOS DEL PICK:
- Evento: ${pick.event} (${pick.sport})
- Pick recomendado: ${pick.bestPick} (Mercado: ${pick.bestMarket})
- Cuota más alta: ${pick.bestOdds.toFixed(2)} (en ${pick.oddsRange})
- Ventaja Matemática (Value Edge): +${pick.valuePercentage.toFixed(1)}%
- Nivel de Confianza: ${pick.confidence.toUpperCase()}
- Respaldo Pinnacle/Sharp: ${pick.pinnacleAligns ? 'Sí, cuota validada contra líneas sharp' : 'N/A'}
    `.trim();

    const result = await model.generateContent(prompt);
    const reasoningText = result.response.text().trim();

    // 3. Guardar en caché (de forma asíncrona, no bloqueamos el retorno)
    // Usamos el cliente de Supabase sin 'await' para el insert si falla no rompe la UI
    supabase.from('pick_reasoning').insert({
      event_id: eventId,
      date: todayStr,
      reasoning: reasoningText,
      model: 'gemini-2.5-flash'
    }).then(({ error }) => {
      if (error) console.error('[Gemini] Error guardando caché:', error.message);
    });

    return reasoningText;
  } catch (err) {
    console.error('[Gemini] Error:', err);
    return 'Análisis automatizado no disponible temporalmente.';
  }
}
