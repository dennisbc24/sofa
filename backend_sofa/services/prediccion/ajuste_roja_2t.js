// ---------------------------------------------------------------------------
// AJUSTE POR TARJETA ROJA EN EL 1T (Proyección 2T).
//
// Artefacto: modelos/ajuste_roja_2t.json (generado por
// scripts/entrenar_ajuste_roja_2t.js a partir del informe
// experimentos_fase2t/informes/fase2t_3_roja_1t.json).
//
// Opción "completa" elegida con el usuario:
//   Goles          -> C4 (estado al descanso + fuerza del equipo con roja)
//   Total shots    -> C2 (ridge de 13 features: 11 + rojas propias/rival)
//   Corner kicks   -> C2 (idem)
//   Yellow cards   -> C1 (multiplicador pooled kOwn/kOpp)
//
// La roja se detecta por minuto (1..45) desde:
//   1) estadisticas "Red cards" 1ST (misma fuente que el experimento),
//   2) incidentes normalizados del dump (incidentes.tarjetas),
//   3) feed crudo de Sofascore (incidents[] con incidentType="card").
// Se toma el máximo por lado entre la stat y las incidencias para no perder
// rojas si una de las dos fuentes falla; nunca se suman (evita duplicar la
// misma tarjeta).
// ---------------------------------------------------------------------------
const path = require("path");
const { ridgePredecir } = require("../../experimentos_fase2t/comun2t");

const clamp0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v) < 0 ? 0 : Number(v));

let cache = null;
function cargarAjusteRoja2T() {
  if (!cache) {
    try {
      cache = require("../../modelos/ajuste_roja_2t.json");
    } catch {
      return null;
    }
  }
  return cache;
}

function rutaAjusteRoja2T() {
  return path.join(__dirname, "..", "..", "modelos", "ajuste_roja_2t.json");
}

const esAnulada = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
const esRoja = (tarjeta) => ["red", "second_yellow", "yellowred", "secondyellow"].includes(String(tarjeta || "").toLowerCase());

// Minuto del 1T: 1..45. Un 45+2 entra (minuto=45); un 46 no.
function minutoDe(t) {
  const directo = Number(t && t.minuto);
  if (Number.isFinite(directo)) return directo;
  const texto = String((t && t.minuto_texto) || "");
  const n = Number(texto.split("+")[0]);
  return Number.isFinite(n) ? n : null;
}

function tarjetasNormalizadas(tarjetas) {
  let h = 0, a = 0, n = 0;
  for (const t of tarjetas || []) {
    if (!t || esAnulada(t.anulada) || !esRoja(t.tarjeta)) continue;
    const min = minutoDe(t);
    if (!Number.isFinite(min) || min < 1 || min > 45) continue;
    const eq = t.equipo === "away" ? "away" : t.equipo === "home" ? "home" : null;
    if (!eq) continue;
    if (eq === "home") h++; else a++;
    n++;
  }
  return { h, a, n };
}

function tarjetasCrudas(incidents) {
  let h = 0, a = 0, n = 0;
  for (const x of incidents || []) {
    if (!x || x.incidentType !== "card" || !esRoja(x.incidentClass)) continue;
    const min = Number(x.time);
    if (!Number.isFinite(min) || min < 1 || min > 45) continue;
    if (x.isHome === true) h++;
    else if (x.isHome === false) a++;
    else continue;
    n++;
  }
  return { h, a, n };
}

// Fila "Red cards" de las estadísticas transformadas (1ST o ALL).
function leerRedCards(filas, periodo) {
  const f = (filas || []).find((x) => x && x.nombre === "Red cards" && x.periodo === periodo);
  if (!f) return null;
  const h = Number(f.valor_local_num);
  const a = Number(f.valor_visitante_num);
  if (!Number.isFinite(h) && !Number.isFinite(a)) return null;
  const hh = Number.isFinite(h) ? Math.max(0, h) : 0;
  const aa = Number.isFinite(a) ? Math.max(0, a) : 0;
  return { h: hh, a: aa, n: hh + aa };
}

// Rojas 1T del partido: { home, away, fuente }.
function rojas1TDe(json, filas) {
  const stats1 = leerRedCards(filas, "1ST");
  const statsAll = leerRedCards(filas, "ALL");
  const hay2T = (filas || []).some((f) => f && f.periodo === "2ND");

  const incNorm = tarjetasNormalizadas(json && json.incidentes && json.incidentes.tarjetas);
  const incRaw = tarjetasCrudas(json && json.incidents);
  const inc = incNorm.n > 0 ? incNorm : incRaw.n > 0 ? incRaw : null;

  let base = null;
  let fuenteBase = "ninguna";
  if (stats1) {
    base = stats1;
    fuenteBase = "stats";
  } else if (!hay2T && statsAll) {
    // Sólo se acepta ALL si el dump es de descanso (sin filas del 2T): así no
    // se cuela una roja del 2T en un partido ya finalizado.
    base = statsAll;
    fuenteBase = "stats_ALL";
  }

  let home = base ? base.h : 0;
  let away = base ? base.a : 0;
  let fuente = fuenteBase;
  if (inc && inc.n > 0) {
    home = Math.max(home, inc.h);
    away = Math.max(away, inc.a);
    fuente = fuenteBase === "ninguna" ? "incidentes" : `${fuenteBase}+incidentes`;
  }
  return { home, away, fuente };
}

// C1: multiplicador pooled. Devuelve el factor por lado.
function factorC1(ajuste, red) {
  const f = (ajuste && ajuste.factores) || {};
  const kOwn = Number.isFinite(Number(f.kOwn)) ? Number(f.kOwn) : 1;
  const kOpp = Number.isFinite(Number(f.kOpp)) ? Number(f.kOpp) : 1;
  const h = Number((red && red.home) || 0);
  const a = Number((red && red.away) || 0);
  return {
    home: (h > 0 ? kOwn : 1) * (a > 0 ? kOpp : 1),
    away: (a > 0 ? kOwn : 1) * (h > 0 ? kOpp : 1),
  };
}

function efecto(tabla, estado, fuerza) {
  if (!tabla) return 1;
  const a = tabla.a && Number.isFinite(Number(tabla.a[estado])) ? Number(tabla.a[estado]) : 1;
  const b = tabla.b && Number.isFinite(Number(tabla.b[fuerza])) ? Number(tabla.b[fuerza]) : 1;
  return a * b;
}

// C4: efectos principales de estado (al descanso) y fuerza, desde la
// perspectiva del equipo que recibió la roja. `state` es el diferencial de
// goles del LOCAL (gH-gA) y `fuerza` es team2T - opp2T de las features de
// Goles del lado de la fila (misma definición que el informe).
function factorC4Lado({ ajuste, lado, red, state, fuerza }) {
  const h = Number((red && red.home) || 0);
  const a = Number((red && red.away) || 0);
  const redOwn = lado === "home" ? h : a;
  const redOpp = lado === "home" ? a : h;
  if (redOwn <= 0 && redOpp <= 0) return 1;

  const f = (ajuste && ajuste.factores) || {};
  const kOwn = Number.isFinite(Number(f.kOwn)) ? Number(f.kOwn) : 1;
  const kOpp = Number.isFinite(Number(f.kOpp)) ? Number(f.kOpp) : 1;
  const efectos = (ajuste && ajuste.efectos) || {};
  const diff = lado === "home" ? Number(state) : -Number(state);
  const estado = diff > 0 ? "ganando" : diff < 0 ? "perdiendo" : "empatando";
  const fuerte = Number(fuerza) >= 0;

  let factor = 1;
  if (redOwn > 0) {
    factor *= kOwn * efecto(efectos.own, estado, fuerte ? "fuerte" : "debil");
  }
  if (redOpp > 0) {
    // La roja es del rival: el estado/fuerza se miran desde el equipo con
    // roja (estado espejado y fuerza invertida).
    const estadoRival = estado === "ganando" ? "perdiendo" : estado === "perdiendo" ? "ganando" : "empatando";
    const fuerzaRival = fuerte ? "debil" : "fuerte";
    factor *= kOpp * efecto(efectos.opp, estadoRival, fuerzaRival);
  }
  return factor;
}

// C2: ridge de 13 features (11 + rojas propias/rival) con el blend elegido
// en VAL. Devuelve null si no hay modelo para el stat.
function predecirC2({ ajuste, f, red, lado, H, hkey }) {
  if (!ajuste || !ajuste.ridge || !f) return null;
  const redOwn = lado === "home" ? Number((red && red.home) || 0) : Number((red && red.away) || 0);
  const redOpp = lado === "home" ? Number((red && red.away) || 0) : Number((red && red.home) || 0);
  const R = clamp0(ridgePredecir(ajuste.ridge, [...f.feats, redOwn, redOpp]));
  const T = Number(f.T) || 0;
  let v;

  if (ajuste.elegido === "B" && ajuste.pesosB) {
    v = 0;
    for (const [k, w] of Object.entries(ajuste.pesosB)) {
      const peso = Number(w) || 0;
      if (!peso) continue;
      if (k === "R") v += peso * R;
      else if (k === "H") {
        const hv = hkey && H && H[lado] && H[lado][hkey] ? Number(H[lado][hkey].v) : null;
        v += peso * (Number.isFinite(hv) ? hv : T);
      } else v += peso * (Number.isFinite(Number(f[k])) ? Number(f[k]) : T);
    }
  } else if (ajuste.elegido === "TR" && ajuste.pesosTR !== null && ajuste.pesosTR !== undefined) {
    const w = Number(ajuste.pesosTR);
    v = w * R + (1 - w) * T;
  } else if (ajuste.elegido === "R") {
    v = R;
  } else {
    v = T;
  }
  return { v: clamp0(v), R };
}

module.exports = {
  cargarAjusteRoja2T,
  rutaAjusteRoja2T,
  rojas1TDe,
  factorC1,
  factorC4Lado,
  predecirC2,
  // Exportadas para tests de la conversión de incidentes.
  tarjetasNormalizadas,
  tarjetasCrudas,
};
