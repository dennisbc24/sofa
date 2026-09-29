// ---------------------------------------------------------------------------
// ENTRENAMIENTO DEL MODELO 2T — genera modelos/prediccion_2t.json
//
// Uso: node scripts/entrenar_modelo_2t.js
//
// - Reutiliza alpha/elegido/pesos seleccionados en VAL por
//   experimentos_fase2t/fase2t_0_backtest.js (protocolo v2, informe
//   experimentos_fase2t/informes/fase2t_0_backtest.json).
// - El ridge se REENTRENA con todos los partidos (TRAIN+VAL+TEST), igual que
//   el modelo 1X2 (refit tras evaluación); las métricas del backtest en el
//   informe corresponden al ridge de TRAIN-only.
// - Los componentes T (media de equipo), L0 (media de liga) y H (Proyección
//   2T) se calculan en vivo por el servicio (consultan la DB con cutoff).
// - Sólo escribe modelos/prediccion_2t.json; NUNCA toca
//   modelos/prediccion_poisson.json ni otras tablas.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const {
  TODOS, etiqueta, cargarDataset, ridgeFit, construirFilas,
} = require("../experimentos_fase2t/comun2t");

const INFORME = path.join(__dirname, "..", "experimentos_fase2t", "informes", "fase2t_0_backtest.json");
const SALIDA = path.join(__dirname, "..", "modelos", "prediccion_2t.json");

(async () => {
  if (!fs.existsSync(INFORME)) {
    console.error("Falta el informe del backtest:", INFORME);
    process.exit(1);
  }
  const informe = JSON.parse(fs.readFileSync(INFORME, "utf8"));

  console.log("Cargando dataset…");
  const partidos = await cargarDataset();

  const artefacto = {
    modelo: "2T",
    version: "1.0",
    entrenadoEn: new Date().toISOString(),
    descripcion:
      "Proyección del 2T a partir del 1T (goles, remates, corners, tarjetas y ~37 stats más) " +
      "para la sección Predicción. Blend selección en VAL de {T,R,TR,B} con componentes " +
      "T=media de equipo (shrinkage), L0=media de liga, R=ridge de 11 features de 1T+historial, " +
      "H=Proyección 2T tradicional (sólo goles/remates/corners).",
    fuente: {
      dataset: "DB local partidos + estadisticas 1ST/2ND (cero datos externos)",
      partidos: partidos.length,
      backtest: "experimentos_fase2t/informes/fase2t_0_backtest.json",
      protocolo: informe.reglas_pre_registradas,
      splits_backtest: informe.dataset.splits,
      nota_refit:
        "ridge reentrenado con TRAIN+VAL+TEST tras la evaluación (convención refit del proyecto); " +
        "las métricas del informe son del ridge de TRAIN-only.",
    },
    config: {
      features: informe.features,
      K_GEN: 15, K_COND: 10, SHRINK_C: 6, LIGA_MIN: 10,
      cutoff_historial: "fecha_partido < fecha del partido analizado (estricto)",
      clamp: "predicciones >= 0",
    },
    stats: {},
  };

  for (const stat of TODOS) {
    const info = informe.porStat[stat];
    if (!info) { console.error("Sin información en el informe para", stat); process.exit(1); }

    const filas = construirFilas(partidos, stat);
    let ridge = null;
    if (info.alpha !== null && info.alpha !== undefined) {
      ridge = ridgeFit(filas.map((f) => f.feats), filas.map((f) => f.label), info.alpha);
      if (!ridge) console.warn("ridgeFit falló para", stat);
    }

    artefacto.stats[stat] = {
      etiqueta: etiqueta(stat),
      elegido: info.elegido,
      alpha: info.alpha,
      pesosTR: info.pesosTR,
      pesosB: info.pesosB,
      ridge,
      n: { total: filas.length, ...info.n },
      backtest: { VAL: info.VAL, TEST: info.TEST },
    };
    process.stdout.write(".");
  }

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify(artefacto, null, 2));
  console.log("\nArtefacto:", SALIDA);
  const sinRidge = Object.entries(artefacto.stats).filter(([, s]) => !s.ridge).map(([k]) => k);
  console.log("Stats sin ridge:", sinRidge.length ? sinRidge.join(", ") : "ninguna");
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
