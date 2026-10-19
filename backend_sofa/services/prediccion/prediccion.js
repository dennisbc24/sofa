const { resolverEquipo, getPerfilEquipo, getH2H } = require("./features");
const { cargarModelo } = require("./modelo");
const { predecir, probsDesdeLambdas, aPorcentajes } = require("./modelo_poisson");
const { modeloActivo } = require("./modelo_config");
const { registrarPrediccion } = require("./registro");
const { calcularPrevisibilidad } = require("./previsibilidad");
const { estimarRematesXI } = require("./alineacion");

// ---------------------------------------------------------------------------
// Orquestador del análisis pre-partido (FASE 1).
// Combina: variables históricas con fecha de corte + modelo Poisson entrenado.
// ---------------------------------------------------------------------------

class ModeloNoEntrenadoError extends Error {
  constructor() {
    super("Modelo no entrenado. Ejecuta: npm run entrenar-prediccion (en backend_sofa)");
    this.name = "ModeloNoEntrenadoError";
    this.statusCode = 503;
  }
}

class EquipoNoEncontradoError extends Error {
  constructor(nombre) {
    super(`Equipo no encontrado: ${nombre}`);
    this.name = "EquipoNoEncontradoError";
    this.statusCode = 404;
  }
}

// Columnas de la tabla comparativa (Métrica | Local | Visitante).
const METRICAS = [
  { key: "gf", etiqueta: "Goles a favor (prom.)", dec: 2 },
  { key: "gc", etiqueta: "Goles en contra (prom.)", dec: 2, menorEsMejor: true },
  { key: "xg", etiqueta: "xG (promedio)", dec: 2 },
  { key: "xg_rival", etiqueta: "xGA — xG del rival", dec: 2, menorEsMejor: true },
  { key: "remates", etiqueta: "Remates", dec: 1 },
  { key: "rematesRecibidos", etiqueta: "Remates recibidos", dec: 1, menorEsMejor: true },
  { key: "al_arco", etiqueta: "Remates al arco", dec: 1 },
  { key: "al_arcoRecibidos", etiqueta: "Remates al arco recibidos", dec: 1, menorEsMejor: true },
  { key: "corners", etiqueta: "Corners a favor", dec: 1 },
  { key: "cornersConcedidos", etiqueta: "Corners concedidos", dec: 1, menorEsMejor: true },
  { key: "gf_t1", etiqueta: "Goles a favor 1T", dec: 2 },
  { key: "gf_t2", etiqueta: "Goles a favor 2T", dec: 2 },
  { key: "gc_t1", etiqueta: "Goles en contra 1T", dec: 2, menorEsMejor: true },
  { key: "gc_t2", etiqueta: "Goles en contra 2T", dec: 2, menorEsMejor: true },
  { key: "posesion", etiqueta: "Posesión (%)", dec: 1 },
  { key: "faltas", etiqueta: "Faltas cometidas", dec: 1 },
  { key: "amarillas", etiqueta: "Tarjetas amarillas", dec: 1 },
];

const redondear = (v, dec) => (v === null || v === undefined ? null : Math.round(v * 10 ** dec) / 10 ** dec);

// ---------------------------------------------------------------------------
// MERCADOS DE LA PREDICCIÓN PRE (goles, corners, remates, tarjetas): valores
// esperados por equipo al momento de predecir. Goles = lambdas del Poisson;
// el resto = promedio histórico del equipo en la condición del partido.
// ---------------------------------------------------------------------------
function calcularMercados(perfilLocal, perfilVisita, lambdas, statsOverride) {
  const sL = statsOverride ? statsOverride.local : statsParaPerfil(perfilLocal, "local").stats;
  const sV = statsOverride ? statsOverride.visitante : statsParaPerfil(perfilVisita, "visita").stats;
  const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
  return {
    goles: { local: lambdas.home, visitante: lambdas.away },
    corners: { local: r2(sL.corners), visitante: r2(sV.corners) },
    remates: { local: r2(sL.remates), visitante: r2(sV.remates) },
    tarjetas: { local: r2(sL.amarillas), visitante: r2(sV.amarillas) },
  };
}

// Recalcula los mercados para predicciones antiguas guardadas sin ellos
// (los perfiles sólo dependen de la fecha de corte, que está en la fila).
async function mercadosDePrediccion({ local, visitante, fechaCorte, lambdas }) {
  const [perfilLocal, perfilVisita] = await Promise.all([
    getPerfilEquipo(local, fechaCorte),
    getPerfilEquipo(visitante, fechaCorte),
  ]);
  return calcularMercados(perfilLocal, perfilVisita, lambdas);
}

// ---------------------------------------------------------------------------
// MERCADOS ADICIONALES: ambos marcan, goles por tiempo (1T/2T), quién gana
// cada tiempo y corners por tiempo. Derivados de las lambdas del Poisson,
// repartidas por tiempo con el promedio histórico de cada equipo (share 1T
// de goles y de corners; fallback 45% / 50% cuando no hay datos).
// ---------------------------------------------------------------------------
const pmfPoisson = (k, lambda) => {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
};
const pNoMasDe = (max, lambda) => {
  let s = 0;
  for (let i = 0; i <= max; i++) s += pmfPoisson(i, lambda);
  return s;
};
const pct1 = (x) => Math.round(x * 1000) / 10;
const x1x2Poisson = (lh, la) => {
  let h = 0, d = 0, a = 0;
  for (let i = 0; i <= 15; i++) {
    const pi = pmfPoisson(i, lh);
    if (pi < 1e-12) continue;
    for (let j = 0; j <= 15; j++) {
      const pj = pmfPoisson(j, la);
      if (pj < 1e-12) continue;
      const pr = pi * pj;
      if (i > j) h += pr;
      else if (i === j) d += pr;
      else a += pr;
    }
  }
  const t = h + d + a || 1;
  return { home: pct1(h / t), draw: pct1(d / t), away: pct1(a / t) };
};
const share1T = (t1, total, fallback) => {
  const a = Number(t1), b = Number(total);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return fallback;
  return Math.min(0.85, Math.max(0.15, a / b));
};
const overLines = (l) => ({
  o05: pct1(1 - pNoMasDe(0, l)),
  o15: pct1(1 - pNoMasDe(1, l)),
  o25: pct1(1 - pNoMasDe(2, l)),
  o35: pct1(1 - pNoMasDe(3, l)),
});
// Más/menos del total redondeado predicho: con N = round(λ), P(más) = P(X>N),
// P(menos) = P(X<N) y P(exacto) = P(X=N) (suman 100). Ej: si se predicen 3
// goles en un partido del Barcelona, el Poisson da más peso al over que al
// under porque su λ real empuja hacia arriba.
const masMenos = (l) => {
  const n = Math.round(l);
  return {
    n,
    mas: pct1(1 - pNoMasDe(n, l)),
    menos: pct1(n > 0 ? pNoMasDe(n - 1, l) : 0),
    exacto: pct1(pmfPoisson(n, l)),
  };
};
const overFijas = (l, lineas) =>
  lineas.map((x) => ({ l: x.toFixed(1), p: pct1(1 - pNoMasDe(Math.floor(x), l)) }));
const overDinamicas = (l) => {
  const m = Math.round(l);
  return overFijas(l, [m - 1.5, m - 0.5, m + 0.5].filter((x) => x >= 0.5));
};

function calcularMercadosExtras(sL, sV, lambdas) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const shH = share1T(sL.gf_t1, (sL.gf_t1 || 0) + (sL.gf_t2 || 0), 0.45);
  const shA = share1T(sV.gf_t1, (sV.gf_t1 || 0) + (sV.gf_t2 || 0), 0.45);
  const lh1 = lambdas.home * shH, lh2 = lambdas.home - lh1;
  const la1 = lambdas.away * shA, la2 = lambdas.away - la1;
  const shCH = share1T(sL.corners_t1, sL.corners, 0.5);
  const shCV = share1T(sV.corners_t1, sV.corners, 0.5);
  const cH1 = (sL.corners || 0) * shCH, cH2 = (sL.corners || 0) - cH1;
  const cV1 = (sV.corners || 0) * shCV, cV2 = (sV.corners || 0) - cV1;
  const shRH = share1T(sL.remates_t1, sL.remates, 0.5);
  const shRV = share1T(sV.remates_t1, sV.remates, 0.5);
  const rH1 = (sL.remates || 0) * shRH, rH2 = (sL.remates || 0) - rH1;
  const rV1 = (sV.remates || 0) * shRV, rV2 = (sV.remates || 0) - rV1;
  const p0h = pmfPoisson(0, lambdas.home), p0a = pmfPoisson(0, lambdas.away);
  const si = (1 - p0h) * (1 - p0a);
  const lt1 = lh1 + la1, lt2 = lh2 + la2, lt = lambdas.home + lambdas.away;
  const ct1 = cH1 + cV1, ct2 = cH2 + cV2, ct = ct1 + ct2;
  const rt1 = rH1 + rV1, rt2 = rH2 + rV2, rt = rt1 + rt2;
  return {
    ambosMarcan: { si: pct1(si), no: pct1(1 - si) },
    goles1T: { local: r2(lh1), visita: r2(la1), esperados: r2(lt1), ...overLines(lt1), mm: masMenos(lt1) },
    goles2T: { local: r2(lh2), visita: r2(la2), esperados: r2(lt2), ...overLines(lt2), mm: masMenos(lt2) },
    golesPartido: {
      local: r2(lambdas.home), visita: r2(lambdas.away),
      esperados: r2(lt), ...overLines(lt), mm: masMenos(lt),
    },
    quienGana1T: x1x2Poisson(lh1, la1),
    quienGana2T: x1x2Poisson(lh2, la2),
    corners1T: { local: r2(cH1), visita: r2(cV1), esperados: r2(ct1), over: overFijas(ct1, [3.5, 4.5, 5.5]), mm: masMenos(ct1) },
    corners2T: { local: r2(cH2), visita: r2(cV2), esperados: r2(ct2), over: overFijas(ct2, [3.5, 4.5, 5.5]), mm: masMenos(ct2) },
    cornersPartido: {
      local: r2(sL.corners || 0), visita: r2(sV.corners || 0),
      esperados: r2(ct), over: overFijas(ct, [8.5, 9.5, 10.5, 11.5]), mm: masMenos(ct),
    },
    remates1T: { local: r2(rH1), visita: r2(rV1), esperados: r2(rt1), over: overDinamicas(rt1), mm: masMenos(rt1) },
    remates2T: { local: r2(rH2), visita: r2(rV2), esperados: r2(rt2), over: overDinamicas(rt2), mm: masMenos(rt2) },
    rematesPartido: {
      local: r2(sL.remates || 0), visita: r2(sV.remates || 0),
      esperados: r2(rt), over: overDinamicas(rt), mm: masMenos(rt),
    },
  };
}

// Probabilidad de PERDER por equipo (en vez del 1X2 exacto): que el local
// pierda = P(gana visita) y viceversa. "No pierde" = gana o empata, así los
// empates no castigan el acierto. Va en % con 1 decimal como probabilities.
function calcularNoPierde(probs) {
  const r1 = (v) => Math.round(v * 10) / 10;
  const pierdeLocal = probs.away ?? 0;
  const pierdeVisita = probs.home ?? 0;
  return {
    local: { pierde: r1(pierdeLocal), noPierde: r1(100 - pierdeLocal) },
    visita: { pierde: r1(pierdeVisita), noPierde: r1(100 - pierdeVisita) },
  };
}

// Predicción principal = mayor probabilidad (mismo criterio de desempate que
// el backtest: empates a favor del orden home > draw > away).
const ETIQUETAS = { home: "Local", draw: "Empate", away: "Visita" };
const prediccionPrincipal = (probs) =>
  probs.home >= probs.draw && probs.home >= probs.away
    ? "home"
    : probs.draw >= probs.away
      ? "draw"
      : "away";

// Redondea las stats que se envían al frontend para que lo que se muestra
// sea EXACTAMENTE lo que devuelve el JSON (sin redondeos extra del cliente).
const redondearStats = (stats) =>
  Object.fromEntries(
    Object.entries(stats).map(([k, v]) => [
      k,
      typeof v === "number" && !Number.isInteger(v) ? redondear(v, 2) : v,
    ])
  );

function statsParaPerfil(perfil, condicion) {
  // Estadísticas específicas de la condición (como local / como visitante).
  // Con < 3 partidos hay demasiado ruido → se usa el historial general y se
  // marca la fuente para que el análisis sea explicable.
  const especificas = condicion === "local" ? perfil.comoLocal : perfil.comoVisitante;
  if (especificas.n >= 3) return { stats: especificas, fuente: condicion, n: especificas.n };
  return { stats: perfil.ataqueDefensa, fuente: "general", n: perfil.ataqueDefensa.n };
}

function construirComparacion(homeStats, awayStats) {
  return METRICAS.map((m) => {
    const a = homeStats[m.key];
    const b = awayStats[m.key];
    let ventaja = "sin datos";
    if (a !== null && b !== null && a !== undefined && b !== undefined) {
      const dif = a - b;
      const eps = 1 / 10 ** m.dec;
      if (Math.abs(dif) < eps) ventaja = "equilibrado";
      else {
        const ganaLocal = m.menorEsMejor ? dif < 0 : dif > 0;
        ventaja = ganaLocal ? "local" : "visita";
      }
    }
    return {
      metrica: m.etiqueta,
      local: redondear(a, m.dec),
      visitante: redondear(b, m.dec),
      ventaja,
      menorEsMejor: Boolean(m.menorEsMejor),
    };
  });
}

function construirExplicacion({ home, away, modelo, pred, homeFuente, awayFuente, h2h, advertencias }) {
  const frases = [];
  const i = pred.internos;

  frases.push(
    `El modelo Poisson estima una media de ${i.lambdaHome} goles para ${home} y ${i.lambdaAway} goles para ${away} ` +
      `(tasa base ${i.muHome} y ${i.muAway} goles, de la liga ${
        i.origenMu === "exacta" ? "seleccionada"
        : i.origenMu === "familia" ? "seleccionada por familia (el nombre de temporada aún no existe en el modelo)"
        : "general"
      }).`
  );
  frases.push(
    `Esas medias salen de la tasa base del modelo ajustada por el ataque/defensa estimado de cada equipo: ` +
      `${home} att ${i.attHome} / def ${i.defHome}; ${away} att ${i.attAway} / def ${i.defAway} ` +
      `(valores 0 = promedio de la muestra).`
  );
  frases.push(
    `Las estadísticas de comparación se tomaron ${
      homeFuente === "local" && awayFuente === "visita"
        ? "de los partidos de cada equipo EN LA CONDICIÓN DEL PARTIDO (local contra local, visita contra visita)"
        : "del historial general (alguno de los equipos tiene menos de 3 partidos en su condición)"
    }.`
  );
  if (h2h.resumen.n > 0) {
    const c = h2h.resumen;
    frases.push(
      `H2H (desde la perspectiva de ${home}): ${c.n} enfrentamiento(s) previo(s) — ${c.victorias} v / ` +
        `${c.empates} e / ${c.derrotas} d; jugando de local ${c.comoLocal.victorias}-${c.comoLocal.empates}-${c.comoLocal.derrotas} ` +
        `y de visita ${c.comoVisitante.victorias}-${c.comoVisitante.empates}-${c.comoVisitante.derrotas}, ` +
        `promedio ${c.promedioGoles} goles. Es un factor secundario y no domina la estimación.`
    );
  } else {
    frases.push("H2H: sin enfrentamientos directos previos en la base; no aporta a la estimación.");
  }
  frases.push(
    "Todas las variables usaron solo partidos anteriores a la fecha indicada (corte anti-leakage); " +
      "el partido analizado no está incluido en sus propias estadísticas."
  );
  for (const a of advertencias) frases.push(`Advertencia: ${a}`);
  frases.push("Estimación estadística con fines analíticos: el modelo estima probabilidades, no garantiza resultados.");
  return frases;
}

// `registrar: false` omite el registro en predicciones_beta (útil al
// recomputar una predicción guardada para el historial: no ensuciar el log).
async function analizarPartido({ localTeam, awayTeam, date, league, registrar = true, alineacion = null }) {
  if (!localTeam || !awayTeam) {
    const e = new Error("Se requieren los parámetros localTeam y awayTeam (date y league son opcionales)");
    e.statusCode = 400;
    throw e;
  }

  const fechaCorte = date || new Date().toISOString().slice(0, 10);

  const modeloArchivo = cargarModelo();
  if (!modeloArchivo) throw new ModeloNoEntrenadoError();
  const activo = modeloActivo();

  const nombreLocal = await resolverEquipo(localTeam);
  if (!nombreLocal) throw new EquipoNoEncontradoError(localTeam);
  const nombreVisita = await resolverEquipo(awayTeam);
  if (!nombreVisita) throw new EquipoNoEncontradoError(awayTeam);

  const advertencias = [];

  const [perfilLocal, perfilVisita, h2h] = await Promise.all([
    getPerfilEquipo(nombreLocal, fechaCorte),
    getPerfilEquipo(nombreVisita, fechaCorte),
    getH2H(nombreLocal, nombreVisita, fechaCorte),
  ]);

  if (!perfilLocal.partidosConsiderados)
    advertencias.push(`${nombreLocal} no tiene partidos anteriores a ${fechaCorte}; su ataque/defensa se toma como neutro.`);
  if (!perfilVisita.partidosConsiderados)
    advertencias.push(`${nombreVisita} no tiene partidos anteriores a ${fechaCorte}; su ataque/defensa se toma como neutro.`);
  if (perfilLocal.ataqueDefensa.xg === null || perfilVisita.ataqueDefensa.xg === null)
    advertencias.push("xG no disponible en parte del historial; se muestra solo donde hay datos.");

  const fuenteLocal = statsParaPerfil(perfilLocal, "local");
  const fuenteVisita = statsParaPerfil(perfilVisita, "visita");

  const pred = predecir(modeloArchivo.parametros, {
    home: nombreLocal,
    away: nombreVisita,
    liga: league || null,
  });

  if (pred.internos.equipoLocalSinHistorial)
    advertencias.push(`${nombreLocal} no está en la muestra de entrenamiento del modelo (parámetros neutros).`);
  if (pred.internos.equipoVisitanteSinHistorial)
    advertencias.push(`${nombreVisita} no está en la muestra de entrenamiento del modelo (parámetros neutros).`);
  if (pred.internos.lambdaCapped)
    advertencias.push("Media de goles limitada a 8 por el guardrail antidegenerado (ataque/defensa con poca historia).");

  // Alineacion declarada (XI): la XI solo refina el mercado de REMATES
  // (unico mercado donde el backtest muestra mejora: MAE 5.01 vs 5.59). El
  // 1X2/goles se queda con el modelo v1: la XI no aporta informacion residual
  // (correlacion con el residuo 0.05/0.01) y ajustarlo solo anade ruido.
  const lambdas = { home: pred.internos.lambdaHome, away: pred.internos.lambdaAway };
  const probs = pred.probabilities;
  let ajusteAlineacion = null;
  let statsLocal = fuenteLocal.stats;
  let statsVisita = fuenteVisita.stats;

  if (alineacion) {
    const [xh, xv] = await Promise.all([
      estimarRematesXI(alineacion.local.titulares || []),
      estimarRematesXI(alineacion.visitante.titulares || []),
    ]);
    if (xh && xv) {
      // Mezcla: 70% XI + 30% promedio del equipo (el XI es mejor, pero no
      // se descarta el historial del equipo).
      const remLocal = Math.round((0.7 * xh + 0.3 * (statsLocal.remates || 0)) * 100) / 100;
      const remVisita = Math.round((0.7 * xv + 0.3 * (statsVisita.remates || 0)) * 100) / 100;
      statsLocal = { ...statsLocal, remates: remLocal };
      statsVisita = { ...statsVisita, remates: remVisita };
      ajusteAlineacion = {
        rematesXI: { local: xh, visitante: xv },
        rematesUsados: { local: remLocal, visitante: remVisita },
        nota: "El XI refina sólo el mercado de remates; el 1X2 sigue el modelo v1.",
      };
      advertencias.push(`Remates ajustados por la alineación (XI): local ${xh} · visita ${xv}.`);
    } else {
      advertencias.push("Alineación sin historial de XI suficiente; los remates se estiman con el promedio del equipo.");
    }
  }

  const comparison = construirComparacion(fuenteLocal.stats, fuenteVisita.stats);
  const principal = prediccionPrincipal(probs);
  const mercados = calcularMercados(perfilLocal, perfilVisita, lambdas, { local: statsLocal, visitante: statsVisita });
  const mercadosExtras = calcularMercadosExtras(statsLocal, statsVisita, lambdas);
  const noPierde = calcularNoPierde(probs);
  const previsibilidad = await calcularPrevisibilidad(nombreLocal, nombreVisita, fechaCorte);

  // Registro en BD (beta): solo acumula datos para futura evaluación.
  // No entrena, no recalibra y nunca interrumpe la respuesta.
  if (registrar) {
    await registrarPrediccion({
      fechaPartido: fechaCorte,
      local: nombreLocal,
      visitante: nombreVisita,
      liga: league || null,
      probabilities: probs,
      principal,
      model: activo.id,
      modelVersion: activo.version,
      alineacion: alineacion ? {
        local: { titulares: alineacion.local.titulares, suplentes: alineacion.local.suplentes, suspendidos: alineacion.local.suspendidos },
        visitante: { titulares: alineacion.visitante.titulares, suplentes: alineacion.visitante.suplentes, suspendidos: alineacion.visitante.suspendidos },
        ajuste: ajusteAlineacion,
      } : null,
    });
  }

  return {
    match: {
      homeTeam: nombreLocal,
      awayTeam: nombreVisita,
      date: fechaCorte,
      league: league || null,
    },
    probabilities: probs,
    prediction: {
      main: principal,
      mainLabel: ETIQUETAS[principal],
      mainTeam: principal === "home" ? nombreLocal : principal === "away" ? nombreVisita : null,
      probability: probs[principal],
    },
    lambdas,
    mercados,
    mercadosExtras,
    noPierde,
    previsibilidad,
    homeFeatures: {
      ...perfilLocal,
      statsComparadas: redondearStats(fuenteLocal.stats),
      fuenteStats: fuenteLocal.fuente,
    },
    awayFeatures: {
      ...perfilVisita,
      statsComparadas: redondearStats(fuenteVisita.stats),
      fuenteStats: fuenteVisita.fuente,
    },
    comparison,
    alineacion: alineacion ? {
      local: alineacion.local,
      visitante: alineacion.visitante,
      ajuste: ajusteAlineacion,
    } : null,
    recentForm: {
      home: perfilLocal.recientes,
      away: perfilVisita.recientes,
    },
    headToHead: h2h,
    explanation: construirExplicacion({
      home: nombreLocal,
      away: nombreVisita,
      modelo: modeloArchivo,
      pred,
      homeFuente: fuenteLocal.fuente,
      awayFuente: fuenteVisita.fuente,
      h2h,
      advertencias,
    }),
    datosUtilizados: {
      fechaCorte,
      local: {
        partidos: perfilLocal.partidosConsiderados,
        desde: perfilLocal.primerPartido,
        hasta: perfilLocal.ultimoPartido,
        condicion: fuenteLocal.fuente,
        nCondicion: fuenteLocal.n,
      },
      visitante: {
        partidos: perfilVisita.partidosConsiderados,
        desde: perfilVisita.primerPartido,
        hasta: perfilVisita.ultimoPartido,
        condicion: fuenteVisita.fuente,
        nCondicion: fuenteVisita.n,
      },
      h2hPartidos: h2h.resumen.n,
    },
    model: activo.id,
    modelVersion: activo.version,
    modelInfo: {
      name: modeloArchivo.nombre,
      version: modeloArchivo.version,
      descripcion: activo.descripcion,
      archivo: activo.archivo,
      entrenadoEn: modeloArchivo.entrenado_en,
      muestra: modeloArchivo.muestra,
      backtest: modeloArchivo.backtest || null,
    },
    advertencias,
  };
}

module.exports = {
  analizarPartido, calcularMercados, mercadosDePrediccion,
  ModeloNoEntrenadoError, EquipoNoEncontradoError,
};
