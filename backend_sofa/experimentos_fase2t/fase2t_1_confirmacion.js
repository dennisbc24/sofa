// ---------------------------------------------------------------------------
// FASE 2T-1 — CONFIRMACIÓN FORWARD del modelo de proyección 2T.
// PRE-REGISTRADO el 2026-09-29 CON 0 PARTIDOS FUTUROS disponibles
// (corte de entrenamiento/refit: 2026-09-28; la cohorte futura empieza el
//  2026-09-29). El TEST del backtest (fase2t_0) ya se observó: este bloque
//  es el holdout nuevo, análogo a fase6_confirmacion.js del 1X2.
//
// REGLAS PRE-REGISTRADAS (fijadas antes de existir un solo partido futuro):
//  C1  Sólo se ejecuta cuando haya ≥150 partidos elegibles con fecha
//      ESTRICTAMENTE posterior a 2026-09-28 (si no, aborta con exit 2 sin
//      evaluar y sin tocar nada). Elegible = el mismo filtro de
//      cargarDataset (goles 1T+FT y Total shots en 1ST y 2ND).
//  C2  Evaluación ÚNICA por cohorte: si ya existe el informe
//      informes/fase2t_1_confirmacion.json, aborta (exit 3). Para re-evaluar
//      hay que borrar el informe a mano (acción humana explícita).
//  C3  Artefacto CONGELADO: modelos/prediccion_2t.json tal cual (sin refit,
//      sin reentrenar, sin reselección de elegido/pesos). Features, priors
//      de liga e H con cutoff fecha < fecha_partido (mismo pipeline que
//      fase2t_0 y el servicio en vivo).
//  C4  Métrica: MAE por lado (2 filas por partido), mismo clamp >= 0.
//      Baselines: H (port de AnalisisProyeccion), T (equipo+shrink),
//      L0 (media de liga/familia/global).
//  C5  CRITERIOS DE CONFIRMACIÓN (todos deben cumplirse):
//        s1: M ≤ H en MAE en Goles, Remates y Corners (3/3; empate cuenta).
//        s2: M ≤ min(T,L0) + 1e-9 en ≥30 de las 38 stats restantes.
//        s3: 0 stats restantes con MAE(M) > 1.05 × min(T,L0) (sin derrota
//            clara >5%; sólo se evalúan stats con min(T,L0) > 0).
//      CONFIRMA = s1 && s2 && s3. Si confirma → SÓLO plantear promoción
//      al usuario (producción intacta; requiere aprobación explícita).
//  C6  Este script sólo LEE la DB y ESCRIBE el informe de esta fase.
//      Producción (V1_BETA, prediccion_poisson.json, prediccion_2t.json)
//      intacta.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const {
  TODOS, etiqueta, cargarDataset, ridgePredecir,
  registro, registroVisita, predecirH, construirFilas,
} = require("./comun2t");

const CORTE = "2026-09-28"; // último partido del refit del artefacto
const MIN_FUTUROS = 150;
const RUTA_MODELO = path.join(__dirname, "..", "modelos", "prediccion_2t.json");
const RUTA_INFORME = path.join(__dirname, "informes", "fase2t_1_confirmacion.json");
const STATS_H = ["Goles", "Total shots", "Corner kicks"];
const KEY_H = { Goles: "goles", "Total shots": "remates", "Corner kicks": "corners" };

function clamp0(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v;
}

function metricas(preds, y) {
  let mae = 0, se = 0, bias = 0;
  const n = y.length;
  for (let i = 0; i < n; i++) {
    const e = preds[i] - y[i];
    mae += Math.abs(e); se += e * e; bias += e;
  }
  return n ? { n, mae: mae / n, rmse: Math.sqrt(se / n), bias: bias / n } : { n: 0 };
}

(async () => {
  console.log("=========== FASE 2T-1 — CONFIRMACIÓN FORWARD (post-refit) ===========");
  console.log(`Pre-registrado 2026-09-29 con 0 partidos futuros | corte: ${CORTE} | ≥${MIN_FUTUROS} requeridos`);

  if (fs.existsSync(RUTA_INFORME)) {
    console.log("El informe ya existe (evaluación única por cohorte). Abortar. (C2)");
    process.exit(3);
  }
  const modelo = JSON.parse(fs.readFileSync(RUTA_MODELO, "utf8"));
  console.log(`Artefacto congelado: v${modelo.version} (${modelo.entrenadoEn})`);

  const partidos = await cargarDataset();
  const futuros = partidos.filter((p) => p.fecha > CORTE);
  console.log(`Dataset: ${partidos.length} partidos | futuros (> ${CORTE}): ${futuros.length}`);
  if (futuros.length < MIN_FUTUROS) {
    console.log(`Sólo ${futuros.length} futuros; se requieren ≥${MIN_FUTUROS}. Abortar sin evaluar (holdout intacto). (C1)`);
    process.exit(2);
  }

  // Historial H acumulativo en orden cronológico (cutoff estricto por ms).
  const hist = new Map();
  const globalGolesAcum = { n: 0, s: 0 };
  const hPred = new Map();
  for (const m of partidos) {
    const h = hist.get(m.local) || [], a = hist.get(m.visitante) || [];
    const glob2T = globalGolesAcum.n ? globalGolesAcum.s / globalGolesAcum.n : 0;
    if (m.fecha > CORTE) {
      hPred.set(m.id, predecirH(m, h, a, { v: glob2T, n: globalGolesAcum.n }));
    }
    h.push(registro(m));
    a.push(registroVisita(m));
    hist.set(m.local, h);
    hist.set(m.visitante, a);
    globalGolesAcum.n += 2;
    globalGolesAcum.s += (m.g.fl - m.g.hl) + (m.g.fa - m.g.ha);
  }

  const informe = {
    fase: "2T-1 confirmación forward del modelo de proyección 2T",
    preRegistrado: "2026-09-29 (con 0 partidos futuros)",
    generadoEn: new Date().toISOString(),
    artefacto: { ruta: "modelos/prediccion_2t.json", version: modelo.version, entrenadoEn: modelo.entrenadoEn },
    reglas_pre_registradas: {
      C1: `≥${MIN_FUTUROS} partidos elegibles con fecha > ${CORTE}; si no, exit 2 sin evaluar`,
      C2: "Evaluación única por cohorte (aborta si ya existe este informe)",
      C3: "Artefacto congelado; features/H con cutoff fecha < fecha_partido (mismo pipeline que fase2t_0)",
      C4: "MAE por lado; baselines H (port), T (equipo+shrink), L0 (liga)",
      C5: "s1: M ≤ H en Goles/Remates/Corners (3/3); s2: M ≤ min(T,L0) en ≥30/38; s3: 0 stats con deterioro >5% vs min(T,L0). CONFIRMA = s1 && s2 && s3",
      C6: "Sólo lectura de DB + escritura del informe; producción intacta",
    },
    cohort: {
      corte_exclusivo: CORTE,
      n_futuros: futuros.length,
      desde: futuros[0].fecha,
      hasta: futuros[futuros.length - 1].fecha,
    },
    porStat: {},
    resumen: {},
  };

  for (const stat of TODOS) {
    const info = modelo.stats[stat];
    if (!info) { informe.porStat[stat] = { error: "stat sin artefacto" }; continue; }
    const filas = construirFilas(partidos, stat);

    for (const f of filas) {
      f.pred = { T: f.T, L0: f.L0 };
      if (info.ridge) f.pred.R = clamp0(ridgePredecir(info.ridge, f.feats));
      if (info.pesosTR !== null && info.pesosTR !== undefined && f.pred.R !== undefined) {
        f.pred.TR = clamp0(info.pesosTR * f.pred.R + (1 - info.pesosTR) * f.pred.T);
      }
      if (STATS_H.includes(stat)) {
        const hp = hPred.get(f.m.id)[f.lado][KEY_H[stat]];
        f.H = hp.v;
        f.pred.H = hp.v;
      }
      if (info.pesosB) {
        const val = (c) => (c === "H" ? (f.H || 0) : c === "R" ? (f.pred.R ?? f.pred.T) : f.pred[c]);
        let b = 0, ok = true;
        for (const [c, w] of Object.entries(info.pesosB)) {
          if (val(c) === undefined || val(c) === null) { ok = false; break; }
          b += Math.max(w, 0) * val(c);
        }
        if (ok) f.pred.B = clamp0(b);
      }
      f.pred.M = f.pred[info.elegido];
    }

    const fut = filas.filter((f) => f.m.fecha > CORTE && f.pred.M !== undefined);
    const bloque = {};
    for (const c of ["M", "H", "T", "R", "TR", "B", "L0"]) {
      const xs = fut.filter((f) => f.pred[c] !== undefined && f.pred[c] !== null);
      if (!xs.length) continue;
      const m = metricas(xs.map((f) => f.pred[c]), xs.map((f) => f.label));
      bloque[c] = { n: m.n, mae: +m.mae.toFixed(4), rmse: +m.rmse.toFixed(4), bias: +m.bias.toFixed(4) };
    }
    informe.porStat[stat] = { etiqueta: etiqueta(stat), elegido: info.elegido, FUT: bloque };
    console.log(stat, "->", info.elegido, "n_fut=", bloque.M ? bloque.M.n : 0);
  }

  // ------------------------------------------------------------------
  // Criterios (C5)
  // ------------------------------------------------------------------
  const conH = TODOS.filter((s) => STATS_H.includes(s));
  const resto = TODOS.filter((s) => !STATS_H.includes(s));
  const mae = (s, c) => (informe.porStat[s].FUT[c] ? informe.porStat[s].FUT[c].mae : null);

  const s1Detalle = conH.map((s) => {
    const m = mae(s, "M"), h = mae(s, "H");
    return { stat: etiqueta(s), M: m, H: h, ok: m !== null && h !== null && m <= h + 1e-9,
      mejoraPct: m !== null && h ? +(((h - m) / h) * 100).toFixed(2) : null };
  });
  const s1 = s1Detalle.every((x) => x.ok);

  const s2Detalle = resto.map((s) => {
    const m = mae(s, "M"), t = mae(s, "T"), l = mae(s, "L0");
    if (m === null || t === null || l === null) return { stat: etiqueta(s), ok: false, sinDato: true };
    const base = Math.min(t, l);
    return { stat: etiqueta(s), M: m, mejorBaseline: base, ok: m <= base + 1e-9,
      mejoraPct: base ? +(((base - m) / base) * 100).toFixed(2) : null };
  });
  const s2cuenta = s2Detalle.filter((x) => x.ok).length;
  const s2 = s2cuenta >= 30;

  const s3Detalle = resto.map((s) => {
    const m = mae(s, "M"), t = mae(s, "T"), l = mae(s, "L0");
    if (m === null || t === null || l === null) return null;
    const base = Math.min(t, l);
    if (base <= 0) return null;
    return { stat: etiqueta(s), ratio: +(m / base).toFixed(3), ok: m <= 1.05 * base };
  }).filter(Boolean);
  const s3Malas = s3Detalle.filter((x) => !x.ok);
  const s3 = s3Malas.length === 0;

  const confirma = s1 && s2 && s3;
  informe.resumen = {
    s1_ganan_vs_H: `${s1Detalle.filter((x) => x.ok).length}/3`,
    s1_detalle: s1Detalle,
    s2_no_peor_vs_mejorBaseline: `${s2cuenta}/${resto.length} (requiere ≥30)`,
    s2_peores: s2Detalle.filter((x) => !x.ok).sort((a, b) => (a.mejoraPct ?? -99) - (b.mejoraPct ?? -99)).slice(0, 5),
    s3_sin_derrota_claras: `${s3Detalle.length - s3Malas.length}/${s3Detalle.length} (0 con >5% peor; requiere 0 malas)`,
    s3_malas: s3Malas,
    criterios: { s1, s2, s3 },
    CONFIRMA: confirma,
    siguiente_paso: confirma
      ? "CONFIRMA → plantear promoción al usuario (requiere aprobación explícita + backup de archivos protegidos)."
      : "NO CONFIRMA → el modelo 2T sigue como está; producción intacta.",
  };

  const outDir = path.dirname(RUTA_INFORME);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(RUTA_INFORME, JSON.stringify(informe, null, 2));
  console.log("\nInforme:", RUTA_INFORME);
  console.log("s1 (vs H):", informe.resumen.s1_ganan_vs_H, "| s2 (vs min(T,L0)):", informe.resumen.s2_no_peor_vs_mejorBaseline, "| s3:", informe.resumen.s3_sin_derrota_claras);
  console.log("VEREDICTO:", confirma ? "CONFIRMA ✅" : "NO CONFIRMA ❌");
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
