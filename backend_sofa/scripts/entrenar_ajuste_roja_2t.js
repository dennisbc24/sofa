// ---------------------------------------------------------------------------
// ENTRENAMIENTO DEL AJUSTE POR ROJA 1T — genera modelos/ajuste_roja_2t.json
//
// Uso: node scripts/entrenar_ajuste_roja_2t.js
//
// - Lee los parámetros elegidos en el experimento
//   experimentos_fase2t/informes/fase2t_3_roja_1t.json (C1/C2/C4).
// - Reentrena el ridge C2 (13 features: 11 de comun2t + rojas propias/rival)
//   con TODOS los partidos actuales, igual que el refit de prediccion_2t.json;
//   las métricas del informe siguen siendo las de TRAIN-only.
// - Los componentes T/L0/H se calculan en vivo en modelo_2t.js.
// - Sólo escribe modelos/ajuste_roja_2t.json.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { cargarDataset, construirFilas, ridgeFit } = require("../experimentos_fase2t/comun2t");

const INFORME = path.join(__dirname, "..", "experimentos_fase2t", "informes", "fase2t_3_roja_1t.json");
const SALIDA = path.join(__dirname, "..", "modelos", "ajuste_roja_2t.json");
const MERCADOS_C2 = ["Total shots", "Corner kicks"];

function redsDeFilas(rojas, m) {
  const r = rojas.get(String(m.id)) || {};
  return { h1: Number(r.h1 || 0), a1: Number(r.a1 || 0) };
}

(async () => {
  if (!fs.existsSync(INFORME)) {
    console.error("Falta el informe del experimento:", INFORME);
    process.exit(1);
  }
  const informe = JSON.parse(fs.readFileSync(INFORME, "utf8"));

  console.log("Cargando dataset…");
  const partidos = await cargarDataset();

  const rojasRows = await pool.query(
    `SELECT partido_id::text AS id,
            max(valor_local_num) FILTER (WHERE periodo='1ST')::int AS h1,
            max(valor_visitante_num) FILTER (WHERE periodo='1ST')::int AS a1
       FROM estadisticas WHERE nombre='Red cards' GROUP BY 1`
  );
  const rojas = new Map(rojasRows.rows.map((r) => [r.id, r]));
  for (const m of partidos) m.red = redsDeFilas(rojas, m);
  const conRoja = partidos.filter((m) => m.red.h1 + m.red.a1 > 0).length;

  const artefacto = {
    modelo: "ajuste_roja_2t",
    version: "1.0",
    entrenadoEn: new Date().toISOString(),
    descripcion:
      "Ajuste de la proyección 2T para partidos con tarjeta roja en el 1T. " +
      "Opción completa: Goles C4 (efectos de estado al descanso y fuerza), " +
      "remates y corners C2 (ridge de 13 features con rojas propias/rival) y " +
      "amarillas C1 (multiplicador pooled).",
    fuente: {
      experimento: "experimentos_fase2t/informes/fase2t_3_roja_1t.json",
      dataset: "DB local partidos + estadisticas 1ST/2ND + Red cards 1ST",
      partidos: partidos.length,
      conRoja1T: conRoja,
      nota_refit:
        "El ridge C2 se reentrena con todos los partidos actuales (refit de producción); " +
        "las métricas de validación son las del informe (ridge TRAIN-only).",
      nota_estado:
        "C4 usa el estado al descanso (el experimento validó 28/31 coincidencias con el " +
        "estado al minuto exacto de la roja).",
    },
    stats: {},
  };

  for (const stat of MERCADOS_C2) {
    const info = informe.mercados[stat];
    const cfg = info && info.candidatoRidge;
    if (!cfg || cfg.alpha === null || cfg.alpha === undefined) {
      console.error("Sin candidatoRidge/alpha para", stat);
      process.exit(1);
    }
    const filas = construirFilas(partidos, stat);
    for (const f of filas) {
      const r = f.m.red || { h1: 0, a1: 0 };
      const own = f.lado === "home" ? r.h1 : r.a1;
      const opp = f.lado === "home" ? r.a1 : r.h1;
      f.featsRed = [...f.feats, own, opp];
    }
    const ridge = ridgeFit(filas.map((f) => f.featsRed), filas.map((f) => f.label), cfg.alpha);
    if (!ridge) {
      console.error("ridgeFit falló para", stat);
      process.exit(1);
    }
    artefacto.stats[stat] = {
      tipo: "C2",
      etiqueta: info.etiqueta,
      elegido: cfg.elegido,
      alpha: cfg.alpha,
      pesosTR: cfg.pesosTR,
      pesosB: cfg.pesosB,
      ridge,
      n: { total: filas.length, ...info.n },
      validacion: { VAL: info.C2.VAL, TEST: info.C2.TEST, pool: info.C2.pool },
      veredicto: info.veredicto,
    };
    process.stdout.write(".");
  }

  const g = informe.mercados.Goles;
  artefacto.stats.Goles = {
    tipo: "C4",
    etiqueta: g.etiqueta,
    factores: g.C1.factores,
    efectos: g.C4.efectos,
    validacion: { VAL: g.C4.VAL, TEST: g.C4.TEST, pool: g.C4.pool },
    ventanas: g.ventanas,
    veredicto: g.veredicto,
  };

  const y = informe.mercados["Yellow cards"];
  artefacto.stats["Yellow cards"] = {
    tipo: "C1",
    etiqueta: y.etiqueta,
    factores: y.C1.factores,
    validacion: { VAL: y.C1.VAL, TEST: y.C1.TEST, pool: y.C1.pool },
    veredicto: y.veredicto,
  };

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify(artefacto, null, 2));
  console.log("\nArtefacto:", SALIDA);
  console.log("Partidos:", partidos.length, "| con roja 1T:", conRoja);
  await pool.end();
})().catch(async (e) => {
  console.error("ERROR:", e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
