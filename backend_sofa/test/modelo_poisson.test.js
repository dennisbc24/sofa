const test = require("node:test");
const assert = require("node:assert/strict");
const {
  probsDesdeLambdas,
  aPorcentajes,
  predecir,
  entrenar,
} = require("../services/prediccion/modelo_poisson");

const modeloDemo = () => ({
  muHomeGlobal: 1.5,
  muAwayGlobal: 1.1,
  ligas: { "Liga X 2025": { n: 40, muHome: 2, muAway: 1.2 } },
  att: { A: 0.3, B: -0.2 },
  def: { A: -0.1, B: 0.2 },
});

const suma = (p) => p.home + p.draw + p.away;

test("probsDesdeLambdas suma 1 y respeta la ventaja local", () => {
  const p = probsDesdeLambdas(1.8, 1);
  assert.ok(Math.abs(suma(p) - 1) < 1e-9);
  assert.ok(p.home > p.away);
  assert.ok(p.draw > 0);
  assert.ok(p.away > 0);
});

test("aPorcentajes reparte exactamente 100 con 1 decimal", () => {
  const casos = [
    [0.5, 0.3, 0.2],
    [0.3333, 0.3333, 0.3334],
    [0.9, 0.05, 0.05],
    [1 / 3, 1 / 3, 1 / 3],
    [0.05, 0.05, 0.9],
  ];
  for (const c of casos) {
    const r = aPorcentajes(c[0], c[1], c[2], 1);
    assert.equal(r.home + r.draw + r.away, 100, `no suma 100: ${JSON.stringify(r)}`);
    assert.ok(r.home >= 0 && r.draw >= 0 && r.away >= 0);
  }
});

test("predecir usa la cuota exacta de liga cuando existe", () => {
  const r = predecir(modeloDemo(), { home: "A", away: "B", liga: "Liga X 2025" });
  assert.equal(r.internos.origenMu, "exacta");
  assert.equal(r.internos.usaLigaEspecifica, true);
  assert.equal(r.internos.muHome, 2);
  assert.equal(suma(r.probabilities), 100);
});

test("predecir cae a la familia de liga al cambiar de temporada", () => {
  const r = predecir(modeloDemo(), { home: "A", away: "B", liga: "Liga X 2026" });
  assert.equal(r.internos.origenMu, "familia");
  assert.equal(r.internos.muHome, 2);
  assert.equal(r.internos.muAway, 1.2);
});

test("predecir cae a la media global con liga desconocida o sin liga", () => {
  for (const liga of [null, "Otra Liga"]) {
    const r = predecir(modeloDemo(), { home: "A", away: "B", liga });
    assert.equal(r.internos.origenMu, "global");
    assert.equal(r.internos.muHome, 1.5);
  }
});

test("predecir aplica el guardrail lambda<=8 y lo señala", () => {
  const modelo = modeloDemo();
  modelo.att.A = 10;
  const r = predecir(modelo, { home: "A", away: "B" });
  assert.equal(r.internos.lambdaCapped, true);
  assert.equal(r.internos.lambdaHome, 8);
  assert.equal(suma(r.probabilities), 100);
});

test("predecir marca equipos sin historial y usa parámetros neutros", () => {
  const r = predecir(modeloDemo(), { home: "Nuevo", away: "B" });
  assert.equal(r.internos.equipoLocalSinHistorial, true);
  assert.equal(r.internos.equipoVisitanteSinHistorial, false);
  assert.equal(r.internos.attHome, 0);
});

test("entrenar es reproducible y devuelve parámetros finitos", () => {
  const partidos = [
    { home: "A", away: "B", goalsH: 2, goalsA: 0, liga: "L" },
    { home: "B", away: "A", goalsH: 1, goalsA: 1, liga: "L" },
    { home: "A", away: "B", goalsH: 3, goalsA: 1, liga: "L" },
    { home: "B", away: "A", goalsH: 0, goalsA: 2, liga: "L" },
  ];
  const uno = entrenar(partidos, { epochs: 25, minPartidosLiga: 1 });
  const dos = entrenar(partidos, { epochs: 25, minPartidosLiga: 1 });
  assert.deepEqual(uno, dos);
  assert.equal(uno.tipo, "poisson");
  assert.equal(uno.entrenamiento.partidos, 4);
  assert.ok(Number.isFinite(uno.muHomeGlobal));
  for (const v of Object.values(uno.att)) assert.ok(Number.isFinite(v));
  for (const v of Object.values(uno.def)) assert.ok(Number.isFinite(v));
});
