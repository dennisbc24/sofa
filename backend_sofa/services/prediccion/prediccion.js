const { resolverEquipo, getPerfilEquipo, getH2H } = require("./features");
const { cargarModelo } = require("./modelo");
const { predecir } = require("./modelo_poisson");
const { modeloActivo } = require("./modelo_config");
const { registrarPrediccion } = require("./registro");

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
      `(tasa base ${i.muHome} y ${i.muAway} goles, de la liga ${i.usaLigaEspecifica ? "seleccionada" : "general"}).`
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

async function analizarPartido({ localTeam, awayTeam, date, league }) {
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

  const comparison = construirComparacion(fuenteLocal.stats, fuenteVisita.stats);
  const principal = prediccionPrincipal(pred.probabilities);

  // Registro en BD (beta): solo acumula datos para futura evaluación.
  // No entrena, no recalibra y nunca interrumpe la respuesta.
  await registrarPrediccion({
    fechaPartido: fechaCorte,
    local: nombreLocal,
    visitante: nombreVisita,
    liga: league || null,
    probabilities: pred.probabilities,
    principal,
    model: activo.id,
    modelVersion: activo.version,
  });

  return {
    match: {
      homeTeam: nombreLocal,
      awayTeam: nombreVisita,
      date: fechaCorte,
      league: league || null,
    },
    probabilities: pred.probabilities,
    prediction: {
      main: principal,
      mainLabel: ETIQUETAS[principal],
      mainTeam: principal === "home" ? nombreLocal : principal === "away" ? nombreVisita : null,
      probability: pred.probabilities[principal],
    },
    lambdas: { home: pred.internos.lambdaHome, away: pred.internos.lambdaAway },
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

module.exports = { analizarPartido, ModeloNoEntrenadoError, EquipoNoEncontradoError };
