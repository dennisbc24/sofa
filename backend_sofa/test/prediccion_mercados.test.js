const test = require("node:test");
const assert = require("node:assert/strict");
const { calcularMercados } = require("../services/prediccion/prediccion");

const perfil = (n, stats) => ({
  comoLocal: { n, ...stats },
  comoVisitante: { n, ...stats },
  ataqueDefensa: { n: 10, corners: 4.4, remates: 9.9, amarillas: 1.1 },
});

const lambdas = { home: 1.75, away: 0.9 };

test("calcularMercados usa las stats de la condición cuando n >= 3", () => {
  const local = perfil(5, { corners: 6.123, remates: 13.444, amarillas: 2.15 });
  const visita = perfil(4, { corners: 3.333, remates: 8.888, amarillas: 1.99 });
  const m = calcularMercados(local, visita, lambdas);
  assert.deepEqual(m.goles, { local: 1.75, visitante: 0.9 });
  assert.deepEqual(m.corners, { local: 6.12, visitante: 3.33 });
  assert.deepEqual(m.remates, { local: 13.44, visitante: 8.89 });
  assert.deepEqual(m.tarjetas, { local: 2.15, visitante: 1.99 });
});

test("calcularMercados cae al historial general con n < 3", () => {
  const local = perfil(2, { corners: 99, remates: 99, amarillas: 99 });
  const visita = perfil(0, { corners: 99, remates: 99, amarillas: 99 });
  const m = calcularMercados(local, visita, lambdas);
  assert.deepEqual(m.corners, { local: 4.4, visitante: 4.4 });
  assert.deepEqual(m.remates, { local: 9.9, visitante: 9.9 });
  assert.deepEqual(m.tarjetas, { local: 1.1, visitante: 1.1 });
});

test("calcularMercados respeta statsOverride (ajuste por XI)", () => {
  const local = perfil(5, { corners: 6, remates: 13, amarillas: 2 });
  const visita = perfil(5, { corners: 3, remates: 8, amarillas: 1 });
  const m = calcularMercados(local, visita, lambdas, {
    local: { corners: 6, remates: 11.11, amarillas: 2 },
    visitante: { corners: 3, remates: 7.77, amarillas: 1 },
  });
  assert.equal(m.remates.local, 11.11);
  assert.equal(m.remates.visitante, 7.77);
});

test("calcularMercados tolera stats ausentes sin romper", () => {
  const vacio = { comoLocal: { n: 0 }, comoVisitante: { n: 0 }, ataqueDefensa: { n: 0 } };
  const m = calcularMercados(vacio, vacio, lambdas);
  assert.equal(m.corners.local, null);
  assert.equal(m.remates.local, null);
  assert.equal(m.tarjetas.local, null);
  assert.deepEqual(m.goles, { local: 1.75, visitante: 0.9 });
});
