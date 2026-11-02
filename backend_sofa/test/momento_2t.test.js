const test = require("node:test");
const assert = require("node:assert/strict");

const { detectarMomento } = require("../services/prediccion/momento_2t");
const { tramosDe } = require("../services/prediccion/tramos_2t");

test("detecta el 2T y calcula los minutos restantes con el estado y los jugadores", () => {
  const m = detectarMomento({
    json: { info: { estado: "2nd half" }, jugadores: [{ minutesPlayed: 64 }] },
    filas: [{ periodo: "1ST" }, { periodo: "2ND" }, { periodo: "ALL" }],
    estadoTexto: "2nd half",
  });
  assert.equal(m.fase, "2T");
  assert.equal(m.minuto, 64);
  assert.equal(m.jugados2T, 19);
  assert.equal(m.restantes2T, 26);
  assert.equal(m.esFraccion2T, true);
  assert.match(m.nota, /64/);
  assert.match(m.nota, /26/);
});

test("el descanso vale 45' aunque los jugadores tengan 47 minutos", () => {
  const m = detectarMomento({
    json: { info: { estado: "Halftime" }, jugadores: [{ minutesPlayed: 47 }] },
    filas: [{ periodo: "1ST" }, { periodo: "ALL" }],
    estadoTexto: "Halftime",
  });
  assert.equal(m.fase, "descanso");
  assert.equal(m.minuto, 45);
  assert.equal(m.jugados2T, 0);
  assert.equal(m.restantes2T, 45);
  assert.equal(m.esFraccion2T, false);
});

test("info.minuto tiene prioridad sobre los minutos de los jugadores", () => {
  const m = detectarMomento({
    json: {
      info: { estado: "2nd half", minuto: 72 },
      jugadores: [{ minutesPlayed: 68 }],
    },
    filas: [{ periodo: "2ND" }],
    estadoTexto: "2nd half",
  });
  assert.equal(m.minuto, 72);
  assert.equal(m.restantes2T, 18);
  assert.equal(m.fuenteMinuto, "info");
});

test("el 1T no se trata como fracción de 2T", () => {
  const m = detectarMomento({
    json: { info: { estado: "1st half" }, jugadores: [{ minutesPlayed: 30 }] },
    filas: [{ periodo: "1ST" }],
    estadoTexto: "1st half",
  });
  assert.equal(m.fase, "1T");
  assert.equal(m.minuto, 30);
  assert.equal(m.restantes2T, 45);
  assert.equal(m.esFraccion2T, false);
});

test("un partido finalizado no deja minutos restantes de 2T", () => {
  const m = detectarMomento({
    json: { info: { estado: "Finished" }, jugadores: [{ minutesPlayed: 90 }] },
    filas: [{ periodo: "1ST" }, { periodo: "2ND" }, { periodo: "ALL" }],
    estadoTexto: "Finished",
  });
  assert.equal(m.fase, "finalizado");
  assert.equal(m.restantes2T, 0);
  assert.equal(m.esFraccion2T, false);
});

test("tramosDe reparte sólo los tramos que quedan cuando el partido está en 2T", () => {
  const r = tramosDe("Goles", 1.2, 0.6, 64);
  assert.ok(r);
  assert.equal(r.desdeMinuto, 64);
  assert.deepEqual(r.tramos.map((t) => t.id), ["61-75", "76-90+"]);
  const local = r.tramos.reduce((s, t) => s + t.local.lambda, 0);
  const visita = r.tramos.reduce((s, t) => s + t.visita.lambda, 0);
  assert.ok(Math.abs(local - 1.2) < 1e-3);
  assert.ok(Math.abs(visita - 0.6) < 1e-3);
});

test("tramosDe mantiene los 3 tramos completos al descanso y no devuelve tramos al 90'", () => {
  const descanso = tramosDe("Goles", 1.2, 0.6, 45);
  assert.ok(descanso);
  assert.equal(descanso.desdeMinuto, null);
  assert.equal(descanso.tramos.length, 3);
  assert.equal(tramosDe("Goles", 1.2, 0.6, 90), null);
});
