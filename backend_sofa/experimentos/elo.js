// ---------------------------------------------------------------------------
// Elo cronológico para el experimento FASE 2 (V2/V3).
//
// REGLAS (anti data-leakage):
//   - Los partidos se procesan en orden cronológico.
//   - Para cada partido se guarda el rating EXACTAMENTE ANTES de jugarlo
//     (`antes[i]`). Nunca se usa el rating actualizado tras el partido.
//   - El rating solo se actualiza con partidos anteriores al que se predice.
//
// Parámetros (documentados, ajustables solo con TRAIN/VALIDACIÓN):
//   inicial = 1500 para todos los equipos
//   K       = variante (16/32/64, se selecciona en VALIDACIÓN)
//   homeAdv = 100 puntos en la EXPECTACIÓN de actualización (estándar de la
//             Elo futbolística; mide ventaja de local AL ACTUALIZAR).
//             El COVARIABLE del modelo NO suma homeAdv: la ventaja de local
//             ya está en μ_local/μ_visita de V1 (evita doble conteo).
//   resultado: victoria=1, empate=0.5, derrota=0 (sin margen de goles).
//   Expectación: E = 1 / (1 + 10^(-(eloH + homeAdv - eloA)/400))
//   Actualización: eloH += K·(S - E); eloA -= K·S - E)  (suma cero)
//
// Los partidos internacionales/amistosos del dataset puentean ligas: un
// equipo de liga menor que enfrenta a uno fuerte ve su rating ajustarse
// contra esa referencia — la jerarquía se APRENDE de los resultados, no se
// impone a mano.
// ---------------------------------------------------------------------------

function calcularElo(partidos, { k = 32, homeAdv = 100, inicial = 1500 } = {}) {
  const elo = new Map();
  const antes = []; // paralelo a `partidos`: { home, away } ANTES del partido
  for (const p of partidos) {
    const rh = elo.has(p.home) ? elo.get(p.home) : inicial;
    const ra = elo.has(p.away) ? elo.get(p.away) : inicial;
    antes.push({ home: rh, away: ra });
    const eh = 1 / (1 + Math.pow(10, -(rh + homeAdv - ra) / 400));
    const s = p.goalsH > p.goalsA ? 1 : p.goalsH === p.goalsA ? 0.5 : 0;
    const delta = k * (s - eh);
    elo.set(p.home, rh + delta);
    elo.set(p.away, ra - delta);
  }
  return { antes, final: elo };
}

module.exports = { calcularElo };
