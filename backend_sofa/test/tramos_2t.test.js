const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cargarTramos2T,
  rutaTramos2T,
  tramosDe,
  poissonP1,
} = require("../services/prediccion/tramos_2t");

test("el artefacto de tramos existe y cubre goles, remates y amarillas", () => {
  const a = cargarTramos2T();
  assert.ok(a, `falta ${rutaTramos2T()}`);
  assert.equal(a.modelo, "tramos_2t");
  assert.equal(a.tramos.length, 3);
  for (const stat of ["Goles", "Total shots", "Yellow cards"]) {
    assert.ok(a.stats[stat], `falta ${stat}`);
    assert.equal(a.stats[stat].tramos, undefined);
  }
});

test("los pesos por rol suman 1 en cada stat", () => {
  const a = cargarTramos2T();
  for (const [stat, cfg] of Object.entries(a.stats)) {
    for (const lado of ["home", "away"]) {
      const w = cfg.pesos[lado];
      const suma = a.tramos.reduce((s, t) => s + Number(w[t.id] || 0), 0);
      assert.ok(Math.abs(suma - 1) < 1e-9, `${stat}/${lado} suma ${suma}`);
    }
  }
});

test("tramosDe reparte las lambdas del 2T y calcula P(>=1)", () => {
  const r = tramosDe("Goles", 1.2, 0.6);
  assert.ok(r);
  assert.equal(r.tramos.length, 3);
  let local = 0, visita = 0;
  for (const t of r.tramos) {
    assert.ok(t.local.lambda >= 0);
    assert.ok(t.visita.lambda >= 0);
    assert.ok(Math.abs(t.total.lambda - (t.local.lambda + t.visita.lambda)) < 1e-3);
    assert.ok(Math.abs(t.local.p1 - poissonP1(t.local.lambda)) < 1e-3);
    local += t.local.lambda;
    visita += t.visita.lambda;
  }
  assert.ok(Math.abs(local - 1.2) < 1e-3);
  assert.ok(Math.abs(visita - 0.6) < 1e-3);
});

test("tramosDe usa los pesos por rol (home/away) del artefacto", () => {
  const a = cargarTramos2T();
  const cfg = a.stats.Goles;
  const r = tramosDe("Goles", 1, 1);
  for (const t of r.tramos) {
    assert.ok(Math.abs(t.local.lambda - cfg.pesos.home[t.id]) < 1e-3);
    assert.ok(Math.abs(t.visita.lambda - cfg.pesos.away[t.id]) < 1e-3);
  }
});

test("tramosDe devuelve null para stats sin artefacto", () => {
  assert.equal(tramosDe("Corner kicks", 2, 1), null);
  assert.equal(tramosDe("No existe", 2, 1), null);
});

test("poissonP1 es 0 con lambda 0 y crece con lambda", () => {
  assert.equal(poissonP1(0), 0);
  assert.ok(poissonP1(0.5) > 0);
  assert.ok(poissonP1(2) > poissonP1(1));
  assert.ok(Math.abs(poissonP1(0.75) - 0.5276) < 0.001);
});
