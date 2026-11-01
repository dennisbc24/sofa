const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cargarTramos1T,
  rutaTramos1T,
  tramos1TDe,
  poissonP1,
} = require("../services/prediccion/tramos_2t");

test("el artefacto de tramos del 1T existe y cubre goles y remates", () => {
  const a = cargarTramos1T();
  assert.ok(a, `falta ${rutaTramos1T()}`);
  assert.equal(a.modelo, "tramos_1t");
  assert.equal(a.tramos.length, 3);
  for (const stat of ["Goles", "Total shots"]) {
    assert.ok(a.stats[stat], `falta ${stat}`);
  }
  assert.equal(a.stats["Yellow cards"], undefined);
});

test("los pesos del 1T suman 1 en cada stat", () => {
  const a = cargarTramos1T();
  for (const [stat, cfg] of Object.entries(a.stats)) {
    for (const lado of ["home", "away"]) {
      const w = cfg.pesos[lado];
      const suma = a.tramos.reduce((s, t) => s + Number(w[t.id] || 0), 0);
      assert.ok(Math.abs(suma - 1) < 1e-9, `${stat}/${lado} suma ${suma}`);
    }
  }
});

test("tramos1TDe reparte las lambdas del 1T y calcula P(>=1)", () => {
  const r = tramos1TDe("Goles", 0.9, 0.5);
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
  assert.ok(Math.abs(local - 0.9) < 1e-3);
  assert.ok(Math.abs(visita - 0.5) < 1e-3);
});

test("tramos1TDe usa los pesos por rol (home/away) del artefacto", () => {
  const a = cargarTramos1T();
  const cfg = a.stats["Total shots"];
  const r = tramos1TDe("Total shots", 1, 1);
  for (const t of r.tramos) {
    assert.ok(Math.abs(t.local.lambda - cfg.pesos.home[t.id]) < 1e-3);
    assert.ok(Math.abs(t.visita.lambda - cfg.pesos.away[t.id]) < 1e-3);
  }
});

test("tramos1TDe devuelve null para stats sin artefacto", () => {
  assert.equal(tramos1TDe("Yellow cards", 1, 1), null);
  assert.equal(tramos1TDe("Corner kicks", 1, 1), null);
});
