// ---------------------------------------------------------------------------
// FASE 2T-5 — CALIBRACIÓN DEL DESGLOSE DEL 1T EN TRAMOS
//
// Reparte la proyección del 1T (lambda por equipo) en 1-15, 16-30 y 31-45+
// para goles y remates. El split de amarillas queda para una fase aparte.
//
// Metodología: misma que fase2t_4 (splits 70/15/15, candidatos U/G/R/RS,
// selección por Brier de P(>=1) en VAL, TEST sólo lectura). La lambda del
// tramo se evalúa con el total 1T REAL * peso para aislar la calidad del
// reparto; en producción se usa lambda_1T_equipo * peso.
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { cargarDataset, partirSplits, etiqueta } = require("./comun2t");

const TRAMOS = [
  { id: "1-15", etiqueta: "1-15" },
  { id: "16-30", etiqueta: "16-30" },
  { id: "31-45+", etiqueta: "31-45+" },
];
const TRAMO_IDS = TRAMOS.map((t) => t.id);
const MERCADOS = [
  { stat: "Goles", tabla: "incidentes_goles", filtro: "1=1" },
  { stat: "Total shots", tabla: "remates", filtro: "1=1" },
];
const ESQUEMAS = ["U", "G", "R", "RS"];
const SHRINK_ROL = 50;
const r4 = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);

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
  if (p <= 0 || lambda <= 0) return 0;
  let s = 0;
  for (let k = 0; k < 200; k++) {
    s += pmf(k, lambda);
    if (s >= p) return k;
  }
  return 199;
}
const p1 = (lambda) => 1 - Math.exp(-lambda);
const pitMedio = (k, lambda) => cdf(k - 1, lambda) + 0.5 * pmf(k, lambda);

async function cargarEventos(def) {
  const r = await pool.query(`
    SELECT partido_id::text AS pid, equipo,
           CASE
             WHEN minuto BETWEEN 1 AND 15 THEN '1-15'
             WHEN minuto BETWEEN 16 AND 30 THEN '16-30'
             WHEN minuto BETWEEN 31 AND 45 THEN '31-45+'
           END AS tramo,
           count(*)::int AS n
    FROM ${def.tabla}
    WHERE ${def.filtro}
      AND minuto IS NOT NULL
      AND minuto >= 1
      AND minuto <= 45
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
    if (!st || !st["1ST"]) continue;
    const ev = eventos.get(m.id) || {};
    for (const lado of ["home", "away"]) {
      const counts = ev[lado] || {};
      const lab1 = lado === "home" ? st["1ST"].l : st["1ST"].a;
      if (suma(counts, TRAMO_IDS) !== lab1) continue;
      filas.push({
        m, lado, split: m.split, total1T: lab1,
        counts: Object.fromEntries(TRAMO_IDS.map((id) => [id, counts[id] || 0])),
      });
    }
  }
  return filas;
}

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
    if (o.count >= quantile(0.1, o.lambda) && o.count <= quantile(0.9, o.lambda)) cov80++;
    if (o.count >= quantile(0.05, o.lambda) && o.count <= quantile(0.95, o.lambda)) cov90++;
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

function evaluarTramos(filas, pesos) {
  const obs = [];
  for (const f of filas) {
    for (const id of TRAMO_IDS) {
      obs.push({
        lambda: Math.max(0, f.total1T * pesos[f.lado][id]),
        count: f.counts[id] || 0,
      });
    }
  }
  return metricas(obs);
}

(async () => {
  console.log("Cargando dataset…");
  const partidos = await cargarDataset();
  const splits = partirSplits(partidos);
  console.log("Partidos:", partidos.length, JSON.stringify(splits.counts));

  const informe = {
    fase: "2T-5 calibración del desglose del 1T en tramos",
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
      nota: "Sólo goles y remates; el split de amarillas se calibra aparte.",
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

    const candidatos = {};
    let elegido = "U", mejor = Infinity;
    for (const esquema of ESQUEMAS) {
      const pesos = pesosDesde(tr, esquema);
      const val = evaluarTramos(va, pesos);
      const test = evaluarTramos(te, pesos);
      candidatos[esquema] = { pesosTrain: pesos, VAL: val, TEST: test };
      if (val.brier < mejor || (val.brier === mejor && val.mae < (candidatos[elegido].VAL.mae ?? Infinity))) {
        mejor = val.brier;
        elegido = esquema;
      }
    }

    const pesos = pesosDesde(minutos, elegido);
    const oracleVal = evaluarTramos(va, pesos);
    const oracleTest = evaluarTramos(te, pesos);

    const u = candidatos.U.TEST, el = candidatos[elegido].TEST;
    informe.porStat[merc.stat] = {
      etiqueta: etiqueta(merc.stat),
      esquema: elegido,
      pesos,
      pesosTrain: candidatos[elegido].pesosTrain,
      n: { train: tr.length, val: va.length, test: te.length, total: minutos.length },
      candidatos: Object.fromEntries(ESQUEMAS.map((e) => [e, {
        VAL: candidatos[e].VAL, TEST: candidatos[e].TEST,
      }])),
      oracle: { VAL: oracleVal, TEST: oracleTest },
      veredicto: {
        vs_uniforme_TEST: {
          mae_pct: u.mae ? r4(((u.mae - el.mae) / u.mae) * 100) : null,
          brier_delta: r4(el.brier - u.brier),
          ece_delta: r4(el.ece - u.ece),
        },
        split_calibrado: oracleTest.ece !== null && oracleTest.ece <= 0.05,
      },
    };

    console.log(
      `  -> ${elegido} | oracle TEST MAE ${oracleTest.mae} Brier ${oracleTest.brier} ECE ${oracleTest.ece} ` +
      `| cobertura80 ${oracleTest.cobertura80}`
    );
  }

  const outExp = path.join(__dirname, "informes", "fase2t_5_tramos_1t.json");
  fs.writeFileSync(outExp, JSON.stringify(informe, null, 2));
  console.log("Informe:", outExp);

  const artefacto = {
    modelo: "tramos_1t",
    version: "1.0",
    entrenadoEn: new Date().toISOString(),
    descripcion:
      "Reparto de la proyección del 1T en tramos 1-15, 16-30 y 31-45+ para goles y remates. " +
      "Pesos elegidos por calibración (Brier de P(>=1)) en VAL y ajustados con todos los partidos completos.",
    fuente: {
      experimento: "experimentos_fase2t/informes/fase2t_5_tramos_1t.json",
      dataset: "DB local: incidentes_goles + remates con feed completo del 1T",
      nota:
        "Los eventos de 31+ incluyen el tiempo añadido del 1T (45+ se trata como minuto 45). " +
        "La cobertura exige que la suma de los tres tramos coincida con la stat 1ST.",
    },
    tramos: TRAMOS,
    stats: Object.fromEntries(
      Object.entries(informe.porStat).map(([stat, x]) => [stat, {
        etiqueta: x.etiqueta,
        esquema: x.esquema,
        pesos: x.pesos,
        n: x.n,
        validacion: {
          VAL: { oracle: x.oracle.VAL },
          TEST: { oracle: x.oracle.TEST },
        },
      }])
    ),
    nota:
      "lambda_tramo = lambda_1T_equipo * peso. P(>=1) = 1 - exp(-lambda_tramo). " +
      "El total se calcula como suma Poisson de ambos equipos.",
  };
  const outArt = path.join(__dirname, "..", "modelos", "tramos_1t.json");
  fs.writeFileSync(outArt, JSON.stringify(artefacto, null, 2));
  console.log("Artefacto:", outArt);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
