// Entrena el modelo Poisson y ejecuta el backtest con división temporal.
//
// Uso:
//   npm run entrenar-prediccion            → entrena, evalúa y guarda el modelo
//   npm run backtest-prediccion            → igual, con detalle de calibration
//
// Flujo temporal (sin data leakage):
//   1. partidos Ended ordenados por fecha (antiguos → recientes)
//   2. split 60% ENTRENAMIENTO / 20% VALIDACIÓN / 20% TEST
//   3. modelo A  = entrenado con TRAIN  → métricas sobre VALIDACIÓN
//   4. modelo final = entrenado con TRAIN+VALIDACIÓN → métricas sobre TEST
//   5. se guarda el modelo final + todas las métricas en
//      modelos/prediccion_poisson.json (lo consume el endpoint)

const pool = require("../db");
const { entrenar } = require("../services/prediccion/modelo_poisson");
const { dividirTemporal, evaluar } = require("../services/prediccion/backtest");
const { guardarModelo, rutaModelo } = require("../services/prediccion/modelo");

const DETALLE = process.argv.includes("--backtest");

async function cargarPartidos() {
  const query = `
    SELECT id, fecha_partido, liga, equipo_local, equipo_visitante, goles_local, goles_visitante
    FROM partidos
    WHERE estado = 'Ended'
      AND fecha_partido IS NOT NULL
      AND goles_local IS NOT NULL
      AND goles_visitante IS NOT NULL
    ORDER BY fecha_partido ASC, id ASC;`;
  const { rows } = await pool.query(query);
  return rows.map((r) => ({
    fecha: r.fecha_partido,
    liga: r.liga,
    home: r.equipo_local,
    away: r.equipo_visitante,
    goalsH: r.goles_local,
    goalsA: r.goles_visitante,
  }));
}

function rango(partidos) {
  if (!partidos.length) return { n: 0 };
  return {
    n: partidos.length,
    desde: partidos[0].fecha,
    hasta: partidos[partidos.length - 1].fecha,
  };
}

function imprimirMetricas(nombre, metricas, rangoMuestra) {
  console.log(`\n  ${nombre} (n=${metricas.n}${rangoMuestra.desde ? `, ${String(rangoMuestra.desde).slice(0, 10)} → ${String(rangoMuestra.hasta).slice(0, 10)}` : ""})`);
  if (!metricas.n) return;
  console.log(`    accuracy : ${(metricas.accuracy * 100).toFixed(2)}%`);
  console.log(`    log loss : ${metricas.logLoss}`);
  console.log(`    brier    : ${metricas.brier}`);
  if (metricas.probRealMedia !== undefined)
    console.log(`    prob. media del resultado real : ${metricas.probRealMedia}`);
  if (metricas.ece !== undefined && metricas.ece !== null)
    console.log(`    ECE (calibración)             : ${metricas.ece}`);
  if (DETALLE && metricas.calibration) {
    console.log("    calibration (prob. predicha vs. frecuencia real):");
    for (const b of metricas.calibration) {
      console.log(
        `      ${b.rango.padEnd(7)} n=${String(b.n).padStart(5)}  pred=${b.probPredicha}  real=${b.frecuenciaReal}`
      );
    }
  }
}

(async () => {
  try {
    console.log("== Entrenamiento del modelo predictivo (Poisson) ==");
    const partidos = await cargarPartidos();
    if (partidos.length < 50) throw new Error(`Solo ${partidos.length} partidos Ended con fecha; no hay volumen suficiente.`);

    const bloques = dividirTemporal(partidos, { trainPct: 0.6, valPct: 0.2 });
    console.log(`\nMuestra total: ${partidos.length} partidos`);
    console.log(`  TRAIN : ${bloques.train.length} (${bloques.train[0]?.fecha?.slice?.(0, 10) ?? bloques.train[0].fecha} → ${bloques.train[bloques.train.length - 1].fecha})`);
    console.log(`  VAL   : ${bloques.val.length} (${bloques.val[0]?.fecha} → ${bloques.val[bloques.val.length - 1]?.fecha})`);
    console.log(`  TEST  : ${bloques.test.length} (${bloques.test[0]?.fecha} → ${bloques.test[bloques.test.length - 1]?.fecha})`);

    // 1) Modelo A: solo TRAIN → se evalúa en VALIDACIÓN (posterior)
    console.log("\n[1] Entrenando modelo A (solo TRAIN)...");
    const modeloA = entrenar(bloques.train);
    const evalVal = evaluar(modeloA, bloques.val);

    // 2) Modelo final: TRAIN + VALIDACIÓN → se evalúa en TEST (posterior)
    console.log("[2] Entrenando modelo final (TRAIN + VAL)...");
    const modeloFinal = entrenar([...bloques.train, ...bloques.val]);
    const evalTest = evaluar(modeloFinal, bloques.test);
    const evalTrain = evaluar(modeloFinal, bloques.train); // diagnóstico (sobre su propia muestra)

    imprimirMetricas("VALIDACIÓN (modelo A, entrenado solo con TRAIN)", evalVal.metricas, rango(bloques.val));
    imprimirMetricas("TEST (modelo final, entrenado con TRAIN+VAL)", evalTest.metricas, rango(bloques.test));
    if (DETALLE) imprimirMetricas("TRAIN (diagnóstico — sobre su propia muestra)", evalTrain.metricas, rango(bloques.train));

    // Baseline ingenua (siempre predice el signo de las tasas globales) para contexto
    const baseline = (() => {
      const muestraTrain = [...bloques.train, ...bloques.val];
      const gH = muestraTrain.reduce((a, x) => a + x.goalsH, 0);
      const gA = muestraTrain.reduce((a, x) => a + x.goalsA, 0);
      const pred = gH > gA ? "home" : gH === gA ? "draw" : "away";
      let aciertos = 0;
      for (const p of bloques.test) {
        const real = p.goalsH > p.goalsA ? "home" : p.goalsH === p.goalsA ? "draw" : "away";
        if (pred === real) aciertos += 1;
      }
      return Math.round((aciertos / bloques.test.length) * 10000) / 10000;
    })();
    console.log(`\n  baseline (siempre la tasa global) en TEST: ${(baseline * 100).toFixed(2)}%`);

    const archivo = {
      nombre: "poisson",
      version: "1.0",
      entrenado_en: new Date().toISOString(),
      muestra: {
        partidos: partidos.length,
        desde: partidos[0].fecha,
        hasta: partidos[partidos.length - 1].fecha,
        equipos: Object.keys(modeloFinal.att).length,
      },
      parametros: modeloFinal,
      backtest: {
        split: { train: rango(bloques.train), val: rango(bloques.val), test: rango(bloques.test) },
        val: evalVal.metricas,
        test: evalTest.metricas,
        baselineTest: baseline,
        nota: "División temporal estricta: TRAIN (viejo) → VAL → TEST (reciente). Cada bloque solo se evalúa con modelos entrenados con datos anteriores.",
      },
    };

    guardarModelo(archivo);
    console.log(`\nModelo guardado en: ${rutaModelo()}`);
    console.log("El endpoint /api/predictions/match ya usa este modelo (sin re-entrenar).");
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
})();
