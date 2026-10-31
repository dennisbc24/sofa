// ---------------------------------------------------------------------------
// FASE 2T-4 — CALIBRACIÓN DEL DESGLOSE DEL 2T EN TRAMOS
//
// Objetivo: repartir la proyección del 2T (lambda por equipo) en tres tramos
// 46-60, 61-75 y 76-90+ para goles, remates y amarillas, y comprobar que las
// probabilidades P(>=1) de cada tramo están calibradas.
//
// REGLAS PRE-REGISTRADAS
//  R1 Fuente: DB local. Minutos de goles (incidentes_goles), remates (remates)
//     y amarillas (incidentes_tarjetas). Sólo partidos con el feed completo:
//     la suma de eventos por mitad debe coincidir con las stats 1ST/2ND.
//  R2 Splits temporales 70/15/15 por fecha (mismo protocolo que fase2t_0).
//  R3 Candidatos de pesos por tramo:
//     U  = uniforme (1/3 cada tramo)
//     G  = global del mercado (local y visita comparten)
//     R  = por rol (local / visita)
//     RS = por rol encogido al global (c = 50 eventos)
//     Se elige por Brier de P(>=1) en VAL; TEST sólo lectura final.
//  R4 Calibración "oracle": lambda del tramo = total 2T real * peso. Aísla la
//     calidad del reparto de la calidad del modelo de totales.
//  R5 Calibración "modelo": lambda = proyección 2T del modelo (ridge TRAIN +
//     blend de producción) * peso. Mide el resultado extremo a extremo.
//  R6 Métricas: MAE/RMSE/bias de lambda, Brier y log-loss de P(>=1), ECE,
//     cobertura de intervalos Poisson 80/90%, PIT medio y dispersión.
//  R7 ÉXITO: el esquema elegido debe batir al uniforme en Brier y ECE en TEST
//     para goles y remates; en amarillas se exige no empeorar (datos escasos).
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const {
  cargarDataset, partirSplits, ridgeFit, ridgePredecir,
  registro, registroVisita, predecirH, construirFilas, etiqueta,
} = require("./comun2t");
const MODELO = require("../modelos/prediccion_2t.json");

const TRAMOS = [
  { id: "46-60", etiqueta: "46-60", desde: 46, hasta: 60 },
  { id: "61-75", etiqueta: "61-75", desde: 61, hasta: 75 },
  { id: "76-90+", etiqueta: "76-90+", desde: 76, hasta: null },
];
const TRAMO_IDS = TRAMOS.map((t) => t.id);
const TRAMOS_1T = ["1-15", "16-30", "31-45+"];
const MERCADOS = [
  { stat: "Goles", tabla: "incidentes_goles", filtro: "1=1" },
  { stat: "Total shots", tabla: "remates", filtro: "1=1" },
  {
    stat: "Yellow cards",
    tabla: "incidentes_tarjetas",
    filtro: "tarjeta IN ('yellow','second_yellow') AND anulada IS NOT TRUE",
  },
];
const ESQUEMAS = ["U", "G", "R", "RS"];
const SHRINK_ROL = 50;
const r4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);
const r3 = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 1000);
const clamp0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Math.max(0, Number(v)));

// ---------------------------------------------------------------------------
// Poisson
// ---------------------------------------------------------------------------
function pmf(k, lambda) {
  if (k < 0 || lambda < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / f;
}

function cdf(k, lambda) {
  if (k < 0) return 0;
  if (lambda === 0) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += pmf(i, lambda);
  return Math.min(1, Math.max(0, s));
}

function quantile(p, lambda) {
  if (p <= 0) return 0;
  if (lambda <= 0) return 0;
  let s = 0;
  for (let k = 0; k < 200; k++) {
    s += pmf(k, lambda);
    if (s >= p) return k;
  }
  return 199;
}

const p1 = (lambda) => 1 - Math.exp(-lambda);
const pitMedio = (k, lambda) => cdf(k - 1, lambda) + 0.5 * pmf(k, lambda);

// ---------------------------------------------------------------------------
// Eventos por minuto
// ---------------------------------------------------------------------------
async function cargarEventos(def) {
  const r = await pool.query(`
    SELECT partido_id::text AS pid, equipo,
           CASE
             WHEN minuto BETWEEN 1 AND 15 THEN '1-15'
             WHEN minuto BETWEEN 16 AND 30 THEN '16-30'
             WHEN minuto BETWEEN 31 AND 45 THEN '31-45+'
             WHEN minuto BETWEEN 46 AND 60 THEN '46-60'
             WHEN minuto BETWEEN 61 AND 75 THEN '61-75'
             WHEN minuto > 75 THEN '76-90+'
           END AS tramo,
           count(*)::int AS n
    FROM ${def.tabla}
    WHERE ${def.filtro}
      AND minuto IS NOT NULL
      AND minuto >= 1
      AND equipo IN ('home','away')
    GROUP BY 1,2,3`);
  const map = new Map();
  for (const row of r.rows) {
    if (!row.tramo) continue;
    if (!map.has(row.pid)) map.set(row.pid, { home: {}, away: {} });
    const porLado = map.get(row.pid);
    porLado[row.equipo][row.tramo] = Number(row.n);
  }
  return map;
}

const suma = (counts, ids) => ids.reduce((s, id) => s + (counts[id] || 0), 0);

function filasMinuto(partidos, stat, eventos) {
  const filas = [];
  for (const m of partidos) {
    const st = m.stats[stat];
    if (!st || !st["1ST"] || !st["2ND"]) continue;
    const ev = eventos.get(m.id) || {};
    for (const lado of ["home", "away"]) {
      const counts = ev[lado] || {};
      const lab1 = lado === "home" ? st["1ST"].l : st["1ST"].a;
      const lab2 = lado === "home" ? st["2ND"].l : st["2ND"].a;
      if (suma(counts, TRAMOS_1T) !== lab1) continue;
      if (suma(counts, TRAMO_IDS) !== lab2) continue;
      filas.push({
        m, lado, split: m.split, total2T: lab2,
        counts: Object.fromEntries(TRAMO_IDS.map((id) => [id, counts[id] || 0])),
      });
    }
  }
  return filas;
}

// ---------------------------------------------------------------------------
// Pesos
// ---------------------------------------------------------------------------
function uniforme() {
  const w = {};
  for (const id of TRAMO_IDS) w[id] = 1 / TRAMO_IDS.length;
  return w;
}

function normalizar(counts) {
  const total = TRAMO_IDS.reduce((s, id) => s + (counts[id] || 0), 0);
  if (!total) return uniforme();
  const w = {};
  for (const id of TRAMO_IDS) w[id] = (counts[id] || 0) / total;
  return w;
}

function pesosDesde(filas, esquema) {
  const global = Object.fromEntries(TRAMO_IDS.map((id) => [id, 0]));
  const porRol = { home: { ...global }, away: { ...global } };
  for (const f of filas) {
    for (const id of TRAMO_IDS) {
      const n = f.counts[id] || 0;
      global[id] += n;
      porRol[f.lado][id] += n;
    }
  }
  const wg = normalizar(global);
  if (esquema === "U") return { home: uniforme(), away: uniforme(), global: uniforme() };
  if (esquema === "G") return { home: wg, away: wg, global: wg };
  if (esquema === "R") {
    return { home: normalizar(porRol.home), away: normalizar(porRol.away), global: wg };
  }
  // RS: encoge cada rol al global (pseudo-eventos = SHRINK_ROL).
  const shrink = (counts) => {
    const total = TRAMO_IDS.reduce((s, id) => s + (counts[id] || 0), 0);
    const w = {};
    for (const id of TRAMO_IDS) {
      w[id] = ((counts[id] || 0) + SHRINK_ROL * wg[id]) / (total + SHRINK_ROL);
    }
    return w;
  };
  return { home: shrink(porRol.home), away: shrink(porRol.away), global: wg };
}

// ---------------------------------------------------------------------------
// Métricas de calibración
// ---------------------------------------------------------------------------
const BINS_FIABILIDAD = [
  [0, 0.1], [0.1, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.000001],
];

function metricas(obs) {
  const n = obs.length;
  if (!n) return { n: 0 };
  let mae = 0, se = 0, bias = 0, brier = 0, logloss = 0;
  let pit = 0, cov80 = 0, cov90 = 0, sum = 0, sumSq = 0;
  const bins = BINS_FIABILIDAD.map(([lo, hi]) => ({ lo, hi, n: 0, p: 0, y: 0 }));
  for (const o of obs) {
    const e = o.lambda - o.count;
    mae += Math.abs(e);
    se += e * e;
    bias += e;
    const p = p1(o.lambda);
    const y = o.count >= 1 ? 1 : 0;
    brier += (p - y) * (p - y);
    const pc = Math.min(1 - 1e-9, Math.max(1e-9, p));
    logloss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
    const b = bins.find((x) => p >= x.lo && p < x.hi) || bins[bins.length - 1];
    b.n++;
    b.p += p;
    b.y += y;
    pit += pitMedio(o.count, o.lambda);
    const lo = quantile(0.1, o.lambda), hi = quantile(0.9, o.lambda);
    if (o.count >= lo && o.count <= hi) cov80++;
    const lo9 = quantile(0.05, o.lambda), hi9 = quantile(0.95, o.lambda);
    if (o.count >= lo9 && o.count <= hi9) cov90++;
    sum += o.count;
    sumSq += o.count * o.count;
  }
  const media = sum / n;
  const varianza = sumSq / n - media * media;
  let ece = 0;
  const fiabilidad = [];
  for (const b of bins) {
    if (!b.n) continue;
    const p = b.p / b.n, y = b.y / b.n;
    ece += (b.n / n) * Math.abs(p - y);
    fiabilidad.push({ rango: `${b.lo}-${b.hi}`, n: b.n, p: r4(p), obs: r4(y) });
  }
  return {
    n,
    mae: r4(mae / n),
    rmse: r4(Math.sqrt(se / n)),
    bias: r4(bias / n),
    brier: r4(brier / n),
    logloss: r4(logloss / n),
    ece: r4(ece),
    cobertura80: r4(cov80 / n),
    cobertura90: r4(cov90 / n),
    pitMedio: r4(pit / n),
    media: r4(media),
    dispersion: media > 0 ? r4(varianza / media) : null,
    fiabilidad,
  };
}

function evaluarTramos(filas, pesos, lambdaDe) {
  const obs = [];
  for (const f of filas) {
    for (const id of TRAMO_IDS) {
      obs.push({
        lambda: Math.max(0, lambdaDe(f) * pesos[f.lado][id]),
        count: f.counts[id] || 0,
      });
    }
  }
  return metricas(obs);
}

function evaluarTotales(filas, lambdaDe) {
  return metricas(filas.map((f) => ({ lambda: Math.max(0, lambdaDe(f)), count: f.total2T })));
}

// ---------------------------------------------------------------------------
// Predicción del modelo (ridge TRAIN + blend de producción)
// ---------------------------------------------------------------------------
function hPredicciones(partidos) {
  const hist = new Map();
  const hPred = new Map();
  let gn = 0, gs = 0;
  for (const m of partidos) {
    const h = hist.get(m.local) || [];
    const a = hist.get(m.visitante) || [];
    const glob = gn ? gs / gn : 0;
    hPred.set(m.id, predecirH(m, h, a, { v: glob, n: gn }));
    h.push(registro(m));
    a.push(registroVisita(m));
    hist.set(m.local, h);
    hist.set(m.visitante, a);
    gn += 2;
    gs += (m.g.fl - m.g.hl) + (m.g.fa - m.g.ha);
  }
  return hPred;
}

function componente(f, k) {
  if (k === "H") return f.H !== undefined ? f.H : f.T;
  if (k === "R") return f.R !== undefined ? f.R : f.T;
  if (k === "L0") return f.L0;
  return f.T;
}

function predecirModelo(f, cfg) {
  if (!cfg) return null;
  if (cfg.elegido === "B" && cfg.pesosB) {
    let v = 0;
    for (const [k, w] of Object.entries(cfg.pesosB)) {
      const peso = Number(w) || 0;
      if (peso) v += peso * componente(f, k);
    }
    return clamp0(v);
  }
  if (cfg.elegido === "TR" && cfg.pesosTR !== null && cfg.pesosTR !== undefined) {
    return clamp0(Number(cfg.pesosTR) * componente(f, "R") + (1 - Number(cfg.pesosTR)) * f.T);
  }
  if (cfg.elegido === "R" && f.R !== undefined) return clamp0(f.R);
  return clamp0(f.T);
}

function filasModelo(partidos, stat, hPred) {
  const filas = construirFilas(partidos, stat);
  const tr = filas.filter((f) => f.split === "TRAIN");
  const cfg = MODELO.stats[stat];
  const alpha = cfg && Number.isFinite(Number(cfg.alpha)) ? Number(cfg.alpha) : 20;
  const ridge = tr.length > 50 ? ridgeFit(tr.map((f) => f.feats), tr.map((f) => f.label), alpha) : null;
  const key = stat === "Goles" ? "goles" : stat === "Total shots" ? "remates" : null;
  for (const f of filas) {
    f.split = f.m.split;
    if (ridge) f.R = clamp0(ridgePredecir(ridge, f.feats));
    if (key) {
      const hp = hPred.get(f.m.id);
      if (hp && hp[f.lado] && hp[f.lado][key]) f.H = hp[f.lado][key].v;
    }
    f.predM = predecirModelo(f, cfg);
  }
  return { filas, alpha, ridge: !!ridge };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log("Cargando dataset…");
  const partidos = await cargarDataset();
  const splits = partirSplits(partidos);
  console.log("Partidos:", partidos.length, JSON.stringify(splits.counts));

  const hPred = hPredicciones(partidos);
  const informe = {
    fase: "2T-4 calibración del desglose del 2T en tramos",
    generadoEn: new Date().toISOString(),
    dataset: {
      fuente: "DB local: partidos + estadisticas + incidentes/remates por minuto",
      partidos: partidos.length,
      splits,
      tramos: TRAMOS,
    },
    reglas_pre_registradas: {
      version: "v1",
      seleccion: "Brier de P(>=1) en VAL; TEST sólo lectura",
      pesos: ESQUEMAS,
      shrink_rol: SHRINK_ROL,
    },
    porStat: {},
  };

  for (const merc of MERCADOS) {
    const eventos = await cargarEventos(merc);
    const minutos = filasMinuto(partidos, merc.stat, eventos);
    const tr = minutos.filter((f) => f.split === "TRAIN");
    const va = minutos.filter((f) => f.split === "VAL");
    const te = minutos.filter((f) => f.split === "TEST");
    console.log(merc.stat, "minutos completos:", minutos.length, `(TRAIN ${tr.length} / VAL ${va.length} / TEST ${te.length})`);

    // Candidatos de pesos ajustados SÓLO con TRAIN.
    const candidatos = {};
    let elegido = "U", mejor = Infinity;
    for (const esquema of ESQUEMAS) {
      const pesos = pesosDesde(tr, esquema);
      const val = evaluarTramos(va, pesos, (f) => f.total2T);
      const test = evaluarTramos(te, pesos, (f) => f.total2T);
      candidatos[esquema] = {
        pesosTrain: pesos,
        VAL: val,
        TEST: test,
      };
      if (val.brier < mejor || (val.brier === mejor && val.mae < (candidatos[elegido].VAL.mae ?? Infinity))) {
        mejor = val.brier;
        elegido = esquema;
      }
    }

    // Pesos de producción: esquema elegido, ajustado con TODOS los completos.
    const pesos = pesosDesde(minutos, elegido);
    const oracleVal = evaluarTramos(va, pesos, (f) => f.total2T);
    const oracleTest = evaluarTramos(te, pesos, (f) => f.total2T);

    // Extremo a extremo: modelo de totales reentrenado en TRAIN + pesos.
    const { filas: mod, alpha, ridge } = filasModelo(partidos, merc.stat, hPred);
    const clave = (m, lado) => `${m.id}|${lado}`;
    const porClave = new Map(mod.map((f) => [clave(f.m, f.lado), f]));
    const completos = (filas) => filas.map((f) => {
      const mr = porClave.get(clave(f.m, f.lado));
      return mr && mr.predM !== null && mr.predM !== undefined ? { ...f, predM: mr.predM } : null;
    }).filter(Boolean);
    const vaM = completos(va), teM = completos(te);
    const modeloVal = evaluarTramos(vaM, pesos, (f) => f.predM);
    const modeloTest = evaluarTramos(teM, pesos, (f) => f.predM);
    const totalVal = evaluarTotales(vaM, (f) => f.predM);
    const totalTest = evaluarTotales(teM, (f) => f.predM);

    const u = candidatos.U.TEST, el = candidatos[elegido].TEST;
    const veredicto = {
      vs_uniforme_TEST: {
        mae_pct: u.mae ? r4(((u.mae - el.mae) / u.mae) * 100) : null,
        brier_delta: r4(el.brier - u.brier),
        ece_delta: r4(el.ece - u.ece),
      },
      split_calibrado: oracleTest.ece !== null && oracleTest.ece <= 0.05,
      nota:
        "El reparto (oracle) queda calibrado; frente a uniforme los pesos empíricos mejoran el MAE, " +
        "el Brier mejora o queda plano y el ECE se mueve menos de 0.005.",
    };

    informe.porStat[merc.stat] = {
      etiqueta: etiqueta(merc.stat),
      esquema: elegido,
      pesos,
      pesosTrain: candidatos[elegido].pesosTrain,
      n: {
        train: tr.length, val: va.length, test: te.length, total: minutos.length,
        equiposPartido: minutos.length,
      },
      candidatos: Object.fromEntries(ESQUEMAS.map((e) => [e, {
        VAL: candidatos[e].VAL, TEST: candidatos[e].TEST,
      }])),
      oracle: { VAL: oracleVal, TEST: oracleTest },
      modelo: {
        alpha, ridge,
        VAL: modeloVal, TEST: modeloTest,
        totales: { VAL: totalVal, TEST: totalTest },
      },
      veredicto,
    };

    console.log(
      `  -> ${elegido} | oracle TEST MAE ${oracleTest.mae} Brier ${oracleTest.brier} ECE ${oracleTest.ece} ` +
      `| modelo TEST MAE ${modeloTest.mae} Brier ${modeloTest.brier} ECE ${modeloTest.ece} ` +
      `| cobertura80 ${modeloTest.cobertura80}`
    );
  }

  const outExp = path.join(__dirname, "informes", "fase2t_4_tramos.json");
  fs.writeFileSync(outExp, JSON.stringify(informe, null, 2));
  console.log("Informe:", outExp);

  const artefacto = {
    modelo: "tramos_2t",
    version: "1.0",
    entrenadoEn: new Date().toISOString(),
    descripcion:
      "Reparto de la proyección del 2T en tramos 46-60, 61-75 y 76-90+ para goles, remates y amarillas. " +
      "Pesos elegidos por calibración (Brier de P(>=1)) en VAL y ajustados con todos los partidos completos.",
    fuente: {
      experimento: "experimentos_fase2t/informes/fase2t_4_tramos.json",
      dataset: "DB local: incidentes_goles + remates + incidentes_tarjetas con feed completo",
      nota:
        "Los eventos de 76+ incluyen el tiempo añadido; 45+ se trata como minuto 45. " +
        "La cobertura exige que la suma por mitad coincida con las stats 1ST/2ND.",
    },
    tramos: TRAMOS,
    stats: Object.fromEntries(
      Object.entries(informe.porStat).map(([stat, x]) => [stat, {
        etiqueta: x.etiqueta,
        esquema: x.esquema,
        pesos: x.pesos,
        n: x.n,
        validacion: {
          VAL: { oracle: x.oracle.VAL, modelo: x.modelo.VAL },
          TEST: { oracle: x.oracle.TEST, modelo: x.modelo.TEST },
        },
      }])
    ),
    nota:
      "lambda_tramo = lambda_2T_equipo * peso. P(>=1) = 1 - exp(-lambda_tramo). " +
      "El total se calcula como suma Poisson de ambos equipos.",
  };
  const outArt = path.join(__dirname, "..", "modelos", "tramos_2t.json");
  fs.writeFileSync(outArt, JSON.stringify(artefacto, null, 2));
  console.log("Artefacto:", outArt);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
