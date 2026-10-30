const test = require("node:test");
const assert = require("node:assert/strict");
const { ajustesRival, shrinkRival } = require("../services/prediccion/prediccion");

// Perfil mínimo con la forma que consumen ajustarStats/ajustarGoals.
const BASE = {
  remates: 12,
  remates_t1: 5.8,
  remates_t2: 6.2,
  rematesRecibidos: 12,
  remates_t1_r: 5.8,
  remates_t2_r: 6.2,
  corners: 4.6,
  corners_t1: 2.1,
  corners_t2: 2.5,
  cornersConcedidos: 4.6,
  corners_t1_r: 2.1,
  corners_t2_r: 2.5,
  gf: 1.35,
  gc: 1.35,
  gf_t1: 0.6,
  gc_t1: 0.6,
  gf_t2: 0.75,
  gc_t2: 0.75,
};

const perfil = (extra = {}) => {
  const s = { ...BASE, ...extra };
  return {
    ataqueDefensa: { ...s, n: 40 },
    ultimos10Promedios: { ...s, n: 10 },
    comoLocal: { ...s, n: 20 },
    comoVisitante: { ...s, n: 20 },
  };
};

const refs = {
  shots: { total: 12, first: 5.8, second: 6.2 },
  corners: { total: 4.6, first: 2.1, second: 2.5 },
  goals: { total: 1.35, first: 0.6, second: 0.75 },
};

const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("shrinkRival devuelve la media previa con muestra ausente o vacía", () => {
  assert.equal(shrinkRival(null, 10, 12), 12);
  assert.equal(shrinkRival(undefined, 10, 12), 12);
  assert.equal(shrinkRival(10, 0, 12), 12);
});

test("shrinkRival mezcla media y prior con SHRINK_RIVAL=6", () => {
  // (6*10 + 6*12) / 12 = 11
  cerca(shrinkRival(10, 6, 12), 11);
});

test("ajustesRival con perfiles simétricos reproduce las referencias", () => {
  const a = ajustesRival(perfil(), perfil(), refs);
  cerca(a.statsLocal.remates, 12);
  cerca(a.statsLocal.remates_t1, 5.8);
  cerca(a.statsLocal.remates_t2, 6.2);
  cerca(a.statsLocal.corners, 4.6);
  cerca(a.statsLocal.corners_t1, 2.1);
  cerca(a.statsLocal.corners_t2, 2.5);
  cerca(a.statsVisita.remates, 12);
  cerca(a.statsVisita.corners, 4.6);
  cerca(a.goalsLocal.total, 1.35);
  cerca(a.goalsLocal.first, 0.6);
  cerca(a.goalsLocal.second, 0.75);
});

test("remates usa W10 general: ataque propio alto sube la estimación", () => {
  const a = ajustesRival(perfil({ remates: 20, remates_t2: 10 }), perfil(), refs);
  // ataque local: (10*20 + 6*12) / 16 = 17
  cerca(a.statsLocal.remates, 17);
  // 2T local: (10*10 + 6*6.2) / 16 = 8.575
  cerca(a.statsLocal.remates_t2, 8.575);
  // el rival no cambia porque su ataque y la defensa local son 12
  cerca(a.statsVisita.remates, 12);
});

test("corners usa W10 general (ignora el detalle por condición)", () => {
  const local = perfil({ corners: 9, cornersConcedidos: 3 });
  local.comoLocal.detalle = [
    { corners: 1, corners_t1: 0.5, corners_t2: 0.5 },
  ];
  const a = ajustesRival(local, perfil(), refs);
  // ataque general (9, n=10): (10*9 + 6*4.6) / 16 = 7.35
  cerca(a.statsLocal.corners, (10 * 9 + 6 * 4.6) / 16);
  // si usara condición/detalle daría un valor mucho menor
  assert.ok(a.statsLocal.corners > 7);
});

test("goles usa W40 general (ataqueDefensa), no los últimos 10", () => {
  const local = perfil();
  local.ataqueDefensa.gf = 2;
  local.ultimos10Promedios.gf = 1;
  const a = ajustesRival(local, perfil(), refs);
  // (40*2 + 6*1.35) / 46 = 1.915217...
  cerca(a.goalsLocal.total, (40 * 2 + 6 * 1.35) / 46);
  assert.ok(a.goalsLocal.total > 1.8);
});
