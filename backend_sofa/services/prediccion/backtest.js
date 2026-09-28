// ---------------------------------------------------------------------------
// Backtesting con división TEMPORAL estricta (sin data leakage):
//
//   ENTRENAMIENTO (más viejo) → VALIDACIÓN → TEST (más reciente)
//
// El modelo solo se entrena con el bloque de entrenamiento (y después con
// entrenamiento+validación para el modelo final), por lo que en ningún
// momento ve partidos posteriores a los que evalúa.
// ---------------------------------------------------------------------------

const { predecir } = require("./modelo_poisson");

// partidos deben venir ORDENADOS por fecha ascendente.
// El corte se ajusta para que NUNCA un mismo día quede repartido entre dos
// bloques: la regla es max(fecha del bloque anterior) < min(fecha del
// siguiente). Así el modelo jamás ve partidos del mismo día que evalúa.
function dividirTemporal(partidos, { trainPct = 0.6, valPct = 0.2 } = {}) {
  const n = partidos.length;
  const dia = (i) => new Date(partidos[i].fecha).toISOString().slice(0, 10);

  // Avanza el corte hasta que el día completo quede en un solo bloque.
  const cortarEnDiaEntero = (i) => {
    while (i < n && dia(i - 1) === dia(i)) i += 1;
    return i;
  };

  let iTrain = cortarEnDiaEntero(Math.max(1, Math.floor(n * trainPct)));
  let iVal = cortarEnDiaEntero(Math.max(iTrain + 1, Math.floor(n * (trainPct + valPct))));
  // Salvaguardas para muestras pequeñas: al menos 1 partido por bloque.
  if (iVal >= n) iVal = n - 1;
  if (iTrain >= iVal) iTrain = Math.max(1, iVal - 1);
  if (iTrain >= iVal) throw new Error("No se pudo dividir la muestra en 3 bloques");

  return {
    train: partidos.slice(0, iTrain),
    val: partidos.slice(iTrain, iVal),
    test: partidos.slice(iVal),
  };
}

const resultadoReal = (p) =>
  p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away";

const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

// métricas: n, accuracy, logLoss, brier, calibration (bins)
function calcularMetricas(predicciones) {
  const n = predicciones.length;
  if (!n) return { n: 0 };

  let aciertos = 0;
  let logLossSum = 0;
  let brierSum = 0;
  let probRealSum = 0;

  const bins = Array.from({ length: 5 }, () => ({ predSum: 0, obsSum: 0, n: 0 }));

  for (const p of predicciones) {
    const probs = {
      home: p.probs.home / 100,
      draw: p.probs.draw / 100,
      away: p.probs.away / 100,
    };
    const real = p.real;

    const elegido = ["home", "draw", "away"].reduce((a, b) => (probs[a] >= probs[b] ? a : b));
    if (elegido === real) aciertos += 1;

    // log loss multiclase
    const pReal = clamp(probs[real], 1e-15, 1);
    logLossSum += -Math.log(pReal);
    probRealSum += pReal;

    // Brier multiclase: suma (p - o)^2 sobre las 3 clases
    let b = 0;
    for (const k of ["home", "draw", "away"]) {
      const o = k === real ? 1 : 0;
      b += (probs[k] - o) ** 2;
    }
    brierSum += b;

    // calibration: se agrupan las 3 salidas por probabilidad predicha
    for (const k of ["home", "draw", "away"]) {
      const bin = Math.min(4, Math.floor(probs[k] * 5));
      bins[bin].predSum += probs[k];
      bins[bin].obsSum += k === real ? 1 : 0;
      bins[bin].n += 1;
    }
  }

  const calibration = bins
    .map((b, i) => ({
      rango: `${i * 20}-${i * 20 + 20}%`,
      n: b.n,
      probPredicha: b.n ? Math.round((b.predSum / b.n) * 10000) / 10000 : null,
      frecuenciaReal: b.n ? Math.round((b.obsSum / b.n) * 10000) / 10000 : null,
    }))
    .filter((b) => b.n > 0);

  // ECE: error absoluto medio de calibración ponderado por el tamaño de cada bin
  const ece =
    calibration.length > 0
      ? Math.round(
          (calibration.reduce(
            (a, b) => a + (b.n / n) * Math.abs(b.frecuenciaReal - b.probPredicha),
            0
          )) * 10000
        ) / 10000
      : null;

  return {
    n,
    accuracy: Math.round((aciertos / n) * 10000) / 10000,
    logLoss: Math.round((logLossSum / n) * 10000) / 10000,
    brier: Math.round((brierSum / n) * 10000) / 10000,
    // probabilidad media asignada al resultado que realmente ocurrió (mayor = mejor)
    probRealMedia: Math.round((probRealSum / n) * 10000) / 10000,
    ece,
    calibration,
  };
}

// Evalúa un modelo YA entrenado sobre una lista de partidos.
// Cada partido se predice con los parámetros del modelo (entrenado solo con
// datos anteriores), nunca con sus propios datos.
function evaluar(modelo, partidos) {
  const predicciones = partidos.map((p) => {
    const { probabilities } = predecir(modelo, { home: p.home, away: p.away, liga: p.liga });
    return {
      fecha: p.fecha,
      home: p.home,
      away: p.away,
      liga: p.liga,
      probs: probabilities,
      real: resultadoReal(p),
      marcador: `${p.goalsH}-${p.goalsA}`,
    };
  });
  return { predicciones, metricas: calcularMetricas(predicciones) };
}

module.exports = { dividirTemporal, calcularMetricas, evaluar, resultadoReal };
