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

let cache = null;

function cargarTramos2T() {
  if (cache === undefined) return null;
  if (cache) return cache;
  try {
    cache = require("../../modelos/tramos_2t.json");
  } catch {
    cache = undefined;
    return null;
  }
  return cache;
}

function rutaTramos2T() {
  return path.join(__dirname, "..", "..", "modelos", "tramos_2t.json");
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

// Devuelve el desglose de un stat para un partido, o null si el stat no tiene
// artefacto. `local` y `visita` son las lambdas del 2T (no FT).
function tramosDe(stat, local, visita) {
  const artefacto = cargarTramos2T();
  if (!artefacto || !artefacto.stats) return null;
  const cfg = artefacto.stats[stat];
  if (!cfg) return null;

  const lambdas = { local: clamp0(local), visita: clamp0(visita) };
  const tramos = [];
  for (const t of artefacto.tramos || []) {
    const wl = pesoDe(cfg.pesos, "home", t.id);
    const wv = pesoDe(cfg.pesos, "away", t.id);
    if (wl === null || wv === null) continue;
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
    modelo: {
      id: artefacto.modelo,
      version: artefacto.version,
      entrenadoEn: artefacto.entrenadoEn,
    },
  };
}

module.exports = {
  cargarTramos2T,
  rutaTramos2T,
  tramosDe,
  poissonP1: p1,
};
