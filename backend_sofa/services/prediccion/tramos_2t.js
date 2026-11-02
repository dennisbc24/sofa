// ---------------------------------------------------------------------------
// TRAMOS DEL 2T — reparto de la proyección entre 46-60, 61-75 y 76-90+.
//
// Artefacto: modelos/tramos_2t.json (experimento
// experimentos_fase2t/fase2t_4_tramos.js). Para cada stat (Goles,
// Total shots, Yellow cards) guarda los pesos por rol y tramo, calibrados
// sobre partidos con feed completo de eventos por minuto.
//
//   lambda_tramo = lambda_2T_equipo * peso_rol_tramo
//   P(>=1)       = 1 - exp(-lambda_tramo)
//
// El total combina ambos equipos como suma de Poisson (lambda_total =
// lambda_local + lambda_visita).
// ---------------------------------------------------------------------------
const path = require("path");

let cache2T = null;
let cache1T = null;

function cargarTramos2T() {
  if (cache2T === undefined) return null;
  if (cache2T) return cache2T;
  try {
    cache2T = require("../../modelos/tramos_2t.json");
  } catch {
    cache2T = undefined;
    return null;
  }
  return cache2T;
}

function cargarTramos1T() {
  if (cache1T === undefined) return null;
  if (cache1T) return cache1T;
  try {
    cache1T = require("../../modelos/tramos_1t.json");
  } catch {
    cache1T = undefined;
    return null;
  }
  return cache1T;
}

function rutaTramos2T() {
  return path.join(__dirname, "..", "..", "modelos", "tramos_2t.json");
}

function rutaTramos1T() {
  return path.join(__dirname, "..", "..", "modelos", "tramos_1t.json");
}

const clamp0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
const r4 = (v) => Math.round(v * 10000) / 10000;
const p1 = (lambda) => 1 - Math.exp(-clamp0(lambda));

function pesoDe(pesos, lado, tramo) {
  const propios = (pesos && pesos[lado]) || null;
  const globales = (pesos && pesos.global) || null;
  const tabla = propios || globales || null;
  const v = tabla ? Number(tabla[tramo]) : NaN;
  return Number.isFinite(v) ? v : null;
}

function duracionTramo(t) {
  if (!t) return 15;
  const desde = Number(t.desde);
  const hasta = t.hasta == null ? 90 : Number(t.hasta);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return 15;
  return Math.max(1, hasta - desde + 1);
}

function minutosRestantesTramo(t, minuto) {
  if (!t) return 0;
  const desde = Number(t.desde);
  const hasta = t.hasta == null ? 90 : Number(t.hasta);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return 0;
  return Math.max(0, hasta - Math.max(minuto, desde - 1));
}

function pesosRestantes(tabla, tramos, minuto) {
  if (!tabla || !Array.isArray(tramos) || !Number.isFinite(minuto)) return null;
  const pares = [];
  let suma = 0;
  for (const t of tramos) {
    const peso = Number(tabla[t.id]);
    if (!Number.isFinite(peso)) continue;
    const restantes = minutosRestantesTramo(t, minuto);
    if (!restantes) continue;
    const bruto = (peso / duracionTramo(t)) * restantes;
    if (!(bruto > 0)) continue;
    pares.push({ id: t.id, bruto });
    suma += bruto;
  }
  if (!pares.length || suma <= 0) return null;
  const out = {};
  for (const p of pares) out[p.id] = p.bruto / suma;
  return out;
}

// Devuelve el desglose de un stat para un partido, o null si el stat no tiene
// artefacto. `local` y `visita` son las lambdas del periodo (no FT). Si se pasa
// `minuto` y ya se jugó parte del 2T, reparte sólo los minutos restantes.
function tramosCon(artefacto, stat, local, visita, opciones = {}) {
  if (!artefacto || !artefacto.stats) return null;
  const cfg = artefacto.stats[stat];
  if (!cfg) return null;

  const minuto = opciones.minuto === null || opciones.minuto === undefined
    ? null
    : Number.isFinite(Number(opciones.minuto))
      ? Number(opciones.minuto)
      : null;
  const usarRestante = minuto !== null && minuto > 45;
  const pesosHome = usarRestante
    ? pesosRestantes((cfg.pesos && cfg.pesos.home) || (cfg.pesos && cfg.pesos.global), artefacto.tramos, minuto)
    : null;
  const pesosAway = usarRestante
    ? pesosRestantes((cfg.pesos && cfg.pesos.away) || (cfg.pesos && cfg.pesos.global), artefacto.tramos, minuto)
    : null;
  if (usarRestante && (!pesosHome || !pesosAway)) return null;

  const lambdas = { local: clamp0(local), visita: clamp0(visita) };
  const tramos = [];
  for (const t of artefacto.tramos || []) {
    const wl = usarRestante ? pesosHome[t.id] : pesoDe(cfg.pesos, "home", t.id);
    const wv = usarRestante ? pesosAway[t.id] : pesoDe(cfg.pesos, "away", t.id);
    if (wl === null || wv === null || wl === undefined || wv === undefined) continue;
    const ll = lambdas.local * wl;
    const lv = lambdas.visita * wv;
    const lt = ll + lv;
    tramos.push({
      id: t.id,
      etiqueta: t.etiqueta || t.id,
      local: { lambda: r4(ll), p1: r4(p1(ll)) },
      visita: { lambda: r4(lv), p1: r4(p1(lv)) },
      total: { lambda: r4(lt), p1: r4(p1(lt)) },
    });
  }
  if (!tramos.length) return null;
  return {
    tramos,
    esquema: cfg.esquema || null,
    desdeMinuto: usarRestante ? minuto : null,
    modelo: {
      id: artefacto.modelo,
      version: artefacto.version,
      entrenadoEn: artefacto.entrenadoEn,
    },
  };
}

function tramosDe(stat, local, visita, minuto = null) {
  return tramosCon(cargarTramos2T(), stat, local, visita, { minuto });
}

function tramos1TDe(stat, local, visita) {
  return tramosCon(cargarTramos1T(), stat, local, visita);
}

module.exports = {
  cargarTramos2T,
  cargarTramos1T,
  rutaTramos2T,
  rutaTramos1T,
  tramosDe,
  tramos1TDe,
  poissonP1: p1,
};
