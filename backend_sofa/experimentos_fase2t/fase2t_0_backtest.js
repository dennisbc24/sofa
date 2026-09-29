// ---------------------------------------------------------------------------
// FASE 2T-0 — BACKTEST: modelo de proyección 2T vs Proyección 2T actual.
//
// Objetivo (encargo del usuario): crear el modelo de análisis 2T para la
// sección Predicción usando TODAS las stats disponibles en la DB, con
// input = JSON de partido al descanso (estilo Sofascore, estructura de la
// carpeta HT), y que MEJORE los resultados de "Proyección 2T" actual.
//
// REGLAS PRE-REGISTRADAS (fijadas antes de ver resultados):
//  R1  Splits temporales por fecha: TRAIN 70% / VAL 15% / TEST 15%.
//      Ningún dato posterior a la fecha del partido se usa en features
//      (cutoff estricto fecha < fecha_partido) — consistente con inferencia
//      en vivo al descanso.
//  R2  Baseline "H" = port fiel de AnalisisProyeccion.jsx (filtro por goles
//      1T doble + auto-selección remates/corners por ratio/Manhattan/suma),
//      con cadena de fallback generosa (fil -> res -> todo -> global) para
//      no regalarle derrotas. Sólo existe para Goles/Remates/Corners.
//  R3  Modelos candidatos por stat: T (media de equipo con shrinkage),
//      R (ridge con features de 1T + historial), TR (blend T+R, peso en
//      VAL), B (blend simplex en VAL de los componentes disponibles:
//      L0 + T + R [+ H en Goles/Remates/Corners]).
//  R4  Selección por stat: el de menor MAE en VAL entre {T,R,TR} (+B si
//      aplica). MAE en TEST es SÓLO lectura final.
//  R5  ÉXITO: en TEST, el elegido M debe ganarle a H en Goles, Remates y
//      Corners (MAE), y en Amarillas + resto debe ganarle al mínimo entre
//      T y L0 (media de liga) — se reporta conteo de victorias y ratios.
//  R6  Métrica principal MAE; se reportan además RMSE y bias.
//  NOTA (protocolo v2): tras el primer v1 se añadió L0 al simplex de B
//      (la media de liga resultó fuerte en tarjetas/xG); se conserva el
//      histórico en `historial_protocolo` con los resultados de v1.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const {
  TODOS, PRINCIPALES, etiqueta, baseLiga,
  media, encoger, cargarDataset, partirSplits,
  ridgeFit, ridgePredecir,
  registro, registroVisita, predecirH, construirFilas,
} = require("./comun2t");

const K_GEN = 15, K_COND = 10, SHRINK_C = 6, LIGA_MIN = 10;
const ALPHAS = [1, 5, 20, 100];

// ---------------------------------------------------------------------------
// Heurística H: port de AnalisisProyeccion.jsx (enviar -> promedios)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
function metricas(preds, y) {
  let mae = 0, se = 0, bias = 0;
  const n = y.length;
  for (let i = 0; i < n; i++) {
    const e = preds[i] - y[i];
    mae += Math.abs(e); se += e * e; bias += e;
  }
  return n ? { n, mae: mae / n, rmse: Math.sqrt(se / n), bias: bias / n } : { n: 0 };
}

function evaluar(filas, campo, split) {
  const xs = filas.filter((f) => f.split === split && f.pred[campo] !== undefined && f.pred[campo] !== null);
  return metricas(xs.map((f) => f.pred[campo]), xs.map((f) => f.label));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log("Cargando dataset…");
  const partidos = await cargarDataset();
  const splits = partirSplits(partidos);
  console.log("Partidos:", partidos.length, JSON.stringify(splits.counts));

  // Registro histórico para H (con cutoff por fecha).
  const hist = new Map();
  const globalGolesAcum = { n: 0, s: 0 };
  const hPred = new Map(); // partido.id -> H predictions
  for (const m of partidos) {
    const h = hist.get(m.local) || [], a = hist.get(m.visitante) || [];
    const glob2T = globalGolesAcum.n ? globalGolesAcum.s / globalGolesAcum.n : 0;
    hPred.set(m.id, predecirH(m, h, a, { v: glob2T, n: globalGolesAcum.n }));
    h.push(registro(m));
    a.push(registroVisita(m));
    hist.set(m.local, h);
    hist.set(m.visitante, a);
    globalGolesAcum.n += 2;
    globalGolesAcum.s += (m.g.fl - m.g.hl) + (m.g.fa - m.g.ha);
  }

  const informe = {
    fase: "2T-0 backtest modelo proyección 2T",
    generadoEn: new Date().toISOString(),
    dataset: {
      fuente: "DB local (partidos + estadisticas 1ST/2ND); cero datos externos",
      partidos: partidos.length,
      splits,
      stats: TODOS.length,
    },
    reglas_pre_registradas: {
      version_protocolo: "v2",
      historial_protocolo:
        "v1 (B = simplex H+T+R sin L0): TEST principales Goles +10.12%, Corners +22.09%, Remates +28.83% vs H; resto 34/38 (perdía Amarillas -0.95% y xG -2.68% vs sus baselines). v2 añade L0 al simplex/candidatos. TEST ya observado en v1: los deltas de v2 se leen con cautela.",
      R1: "Splits temporales 70/15/15 por fecha; features con cutoff fecha < fecha_partido",
      R2: "Baseline H = port fiel de AnalisisProyeccion.jsx con fallback fil->res->all->global",
      R3: "Candidatos: T (media equipo+shrink), R (ridge), TR (blend T+R en VAL), B (simplex L0+T+R[+H] en VAL)",
      R4: "Selección por stat por menor MAE en VAL entre {T,R,TR,B}; TEST sólo lectura final",
      R5: "ÉXITO: TEST M gana a H en Goles/Remates/Corners; en resto gana a min(T,L0) — conteo + ratios (<= cuenta como empate)",
      R6: "Métrica principal MAE; también RMSE y bias",
    },
    features: [
      "own1t", "opp1t", "state (dif goles 1T)", "team2T_cond", "team2T_gen",
      "team1T_gen", "opp2T_gen", "conceded2T", "league2T", "home", "pace",
    ],
    porStat: {},
    resumen: {},
  };

  const elegidos = {}; // stat -> {modelo, valMAE}

  for (const stat of TODOS) {
    const filas = construirFilas(partidos, stat);
    for (const f of filas) f.split = f.m.split;

    // Modelos sin ajuste
    for (const f of filas) f.pred = { T: f.T, L0: f.L0 };

    // H para stats con heurística
    if (stat === "Goles" || stat === "Total shots" || stat === "Corner kicks") {
      const key = stat === "Goles" ? "goles" : stat === "Total shots" ? "remates" : "corners";
      for (const f of filas) {
        const hp = hPred.get(f.m.id)[f.lado][key];
        f.H = hp.v;
        f.Hnivel = hp.nivel;
        f.pred.H = hp.v;
      }
    }

    // R: alphas fit en TRAIN, selección de alpha por MAE en VAL
    const tr = filas.filter((f) => f.split === "TRAIN");
    const va = filas.filter((f) => f.split === "VAL");
    const te = filas.filter((f) => f.split === "TEST");
    let mejorAlpha = null, mejorVal = Infinity, mejorRidge = null;
    if (tr.length > 100 && va.length > 10) {
      for (const alpha of ALPHAS) {
        const modelo = ridgeFit(tr.map((f) => f.feats), tr.map((f) => f.label), alpha);
        if (!modelo) continue;
        const m = metricas(va.map((f) => clamp0(ridgePredecir(modelo, f.feats))), va.map((f) => f.label));
        if (m.mae < mejorVal) { mejorVal = m.mae; mejorAlpha = alpha; mejorRidge = modelo; }
      }
    }
    if (mejorRidge) for (const f of filas) f.pred.R = clamp0(ridgePredecir(mejorRidge, f.feats));

    // TR: peso w sobre R (1-w sobre T), grid en VAL
    let wTR = null;
    if (mejorRidge) {
      let bw = 0, bv = Infinity;
      for (let w = 0; w <= 1.0001; w += 0.05) {
        const m = metricas(va.map((f) => clamp0(w * f.pred.R + (1 - w) * f.pred.T)), va.map((f) => f.label));
        if (m.mae < bv) { bv = m.mae; bw = w; }
      }
      for (const f of filas) f.pred.TR = clamp0(bw * f.pred.R + (1 - bw) * f.pred.T);
      wTR = bw;
    }

    // B: simplex (L0,T,R [+H]) en VAL
    let wB = null;
    {
      const comps = ["L0", "T"];
      if (mejorRidge) comps.push("R");
      const conH = filas.some((f) => f.H !== undefined);
      if (conH) comps.push("H");
      const val = (f, c) => (c === "H" ? (f.H || 0) : c === "R" ? (f.pred.R ?? f.pred.T) : f.pred[c]);
      let best = null, bv = Infinity;
      const w = new Array(comps.length).fill(0);
      const iterar = (i, resto) => {
        if (i === comps.length - 1) {
          w[i] = resto;
          if (w[i] < -0.0001) return;
          const m = metricas(va.map((f) => clamp0(comps.reduce((s, c, k) => s + Math.max(w[k], 0) * val(f, c), 0))), va.map((f) => f.label));
          if (m.mae < bv) { bv = m.mae; best = [...w]; }
          return;
        }
        for (let x = 0; x <= resto + 0.0001; x += 0.05) {
          w[i] = x;
          iterar(i + 1, resto - x);
        }
      };
      iterar(0, 1);
      if (best) {
        wB = Object.fromEntries(comps.map((c, i) => [c, Math.max(best[i], 0)]));
        for (const f of filas) f.pred.B = clamp0(comps.reduce((s, c) => s + wB[c] * val(f, c), 0));
      }
    }

    // Selección en VAL (R4)
    const candidatos = ["T", "R", "TR"].filter((c) => filas.some((f) => f.pred[c] !== undefined));
    if (wB) candidatos.push("B");
    let elegido = "T", valMejor = Infinity;
    for (const c of candidatos) {
      const m = evaluar(filas, c, "VAL");
      if (m.n && m.mae < valMejor) { valMejor = m.mae; elegido = c; }
    }
    for (const f of filas) f.pred.M = f.pred[elegido];
    elegidos[stat] = { modelo: elegido, valMAE: valMejor };

    const bloque = (split) => {
      const out = {};
      for (const c of ["M", "T", "R", "TR", "B", "H", "L0"]) {
        const m = evaluar(filas, c, split);
        if (m.n) out[c] = { n: m.n, mae: +m.mae.toFixed(4), rmse: +m.rmse.toFixed(4), bias: +m.bias.toFixed(4) };
      }
      return out;
    };

    const cobH = {};
    for (const f of filas) if (f.Hnivel) cobH[f.Hnivel] = (cobH[f.Hnivel] || 0) + 1;

    informe.porStat[stat] = {
      etiqueta: etiqueta(stat),
      elegido,
      alpha: mejorAlpha ?? null,
      pesosTR: wTR !== null ? +wTR.toFixed(2) : null,
      pesosB: wB ? Object.fromEntries(Object.entries(wB).map(([k, v]) => [k, +v.toFixed(2)])) : null,
      coberturaH: Object.keys(cobH).length ? cobH : undefined,
      n: { train: tr.length, val: va.length, test: te.length },
      VAL: bloque("VAL"),
      TEST: bloque("TEST"),
    };
    console.log(stat, "->", elegido, "n=", tr.length, va.length, te.length);
  }

  // ------------------------------------------------------------------
  // Resumen / veredicto (R5)
  // ------------------------------------------------------------------
  const conH = TODOS.filter((s) => informe.porStat[s].TEST.H);
  const ganaH = conH.filter((s) => informe.porStat[s].TEST.M.mae <= informe.porStat[s].TEST.H.mae);
  const resto = TODOS.filter((s) => !informe.porStat[s].TEST.H);
  const ganaResto = resto.filter((s) => {
    const t = informe.porStat[s].TEST.M, a = informe.porStat[s].TEST.T, b = informe.porStat[s].TEST.L0;
    return t.mae <= Math.min(a.mae, b.mae) + 1e-9;
  });
  const ratioVsH = conH.map((s) => ({
    stat: etiqueta(s),
    M: informe.porStat[s].TEST.M.mae,
    H: informe.porStat[s].TEST.H.mae,
    mejoraPct: +(((informe.porStat[s].TEST.H.mae - informe.porStat[s].TEST.M.mae) / informe.porStat[s].TEST.H.mae) * 100).toFixed(2),
  }));
  const ratiosResto = resto.map((s) => {
    const p = informe.porStat[s].TEST;
    return {
      stat: etiqueta(s),
      M: p.M.mae,
      mejorBaseline: Math.min(p.T.mae, p.L0.mae),
      base: p.T.mae <= p.L0.mae ? "T" : "L0",
      mejoraPct: +(((Math.min(p.T.mae, p.L0.mae) - p.M.mae) / Math.min(p.T.mae, p.L0.mae)) * 100).toFixed(2),
    };
  });

  informe.resumen = {
    principales: ratioVsH,
    victorias_vs_H: `${ganaH.length}/${conH.length}`,
    victorias_vs_mejorBaseline_resto: `${ganaResto.length}/${resto.length}`,
    resto: ratiosResto.sort((a, b) => b.mejoraPct - a.mejoraPct),
    exito_R5: {
      goles_remates_corners_ganan: conH.filter((s) => ganaH.includes(s)).length === conH.length,
      conteo_gana_resto: `${ganaResto.length}/${resto.length}`,
    },
    conteo_elegidos: Object.values(elegidos).reduce((acc, e) => {
      acc[e.modelo] = (acc[e.modelo] || 0) + 1;
      return acc;
    }, {}),
  };

  const outDir = path.join(__dirname, "informes");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "fase2t_0_backtest.json");
  fs.writeFileSync(outFile, JSON.stringify(informe, null, 2));
  console.log("\nInforme:", outFile);
  console.log("PRINCIPALES (TEST):");
  for (const r of ratioVsH) console.log(`  ${r.stat}: M=${r.M} vs H=${r.H} (${r.mejoraPct > 0 ? "+" : ""}${r.mejoraPct}%)`);
  console.log("Victorias vs H:", informe.resumen.victorias_vs_H, "| vs mejor baseline (resto):", informe.resumen.victorias_vs_mejorBaseline_resto);
  console.log("Elegidos:", JSON.stringify(informe.resumen.conteo_elegidos));
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });

function clamp0(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v;
}
