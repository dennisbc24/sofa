const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cargarAjusteRoja2T,
  rojas1TDe,
  factorC1,
  factorC4Lado,
} = require("../services/prediccion/ajuste_roja_2t");

const fila = (nombre, periodo, h, a) => ({
  nombre,
  periodo,
  valor_local_num: h,
  valor_visitante_num: a,
});

test("el artefacto de ajuste existe y tiene la forma esperada", () => {
  const a = cargarAjusteRoja2T();
  assert.ok(a, "falta modelos/ajuste_roja_2t.json");
  assert.equal(a.stats.Goles.tipo, "C4");
  assert.equal(a.stats["Yellow cards"].tipo, "C1");
  assert.equal(a.stats["Total shots"].tipo, "C2");
  assert.equal(a.stats["Corner kicks"].tipo, "C2");
  assert.equal(a.stats["Total shots"].ridge.mu.length, 13);
  assert.equal(a.stats["Corner kicks"].ridge.mu.length, 13);
  assert.ok(a.stats.Goles.efectos.own.a.ganando > 0);
  assert.ok(a.stats["Yellow cards"].factores.kOwn > 0);
});

test("rojas 1T desde incidentes normalizados: filtra minuto, tipo y anuladas", () => {
  const json = {
    incidentes: {
      tarjetas: [
        { tarjeta: "red", minuto: 30, equipo: "home", anulada: false },
        { tarjeta: "second_yellow", minuto: 60, equipo: "away" },
        { tarjeta: "red", minuto: 45, minuto_extra: 2, equipo: "home" },
        { tarjeta: "red", minuto: 10, equipo: "away", anulada: true },
        { tarjeta: "yellow", minuto: 20, equipo: "home" },
      ],
    },
  };
  const r = rojas1TDe(json, []);
  assert.deepEqual({ h: r.home, a: r.away }, { h: 2, a: 0 });
  assert.equal(r.fuente, "incidentes");
});

test("rojas 1T desde el feed crudo de Sofascore (incidents[])", () => {
  const json = {
    incidents: [
      { incidentType: "card", incidentClass: "red", isHome: true, time: 44, addedTime: 1 },
      { incidentType: "card", incidentClass: "yellowRed", isHome: false, time: 46 },
      { incidentType: "card", incidentClass: "secondYellow", isHome: false, time: 10 },
      { incidentType: "goal", incidentClass: "regular", isHome: true, time: 20 },
    ],
  };
  const r = rojas1TDe(json, []);
  assert.deepEqual({ h: r.home, a: r.away }, { h: 1, a: 1 });
});

test("la stat Red cards 1ST manda y se combina con incidencias sin duplicar", () => {
  const filas = [fila("Red cards", "1ST", 1, 0), fila("Red cards", "ALL", 1, 0)];
  const r = rojas1TDe({}, filas);
  assert.deepEqual({ h: r.home, a: r.away }, { h: 1, a: 0 });
  assert.equal(r.fuente, "stats");

  const conInc = {
    incidents: [
      { incidentType: "card", incidentClass: "red", isHome: false, time: 20 },
    ],
  };
  const r2 = rojas1TDe(conInc, filas);
  assert.deepEqual({ h: r2.home, a: r2.away }, { h: 1, a: 1 });
  assert.equal(r2.fuente, "stats+incidentes");
});

test("ALL sólo se usa en un dump de descanso (sin filas 2ND)", () => {
  const soloAll = [fila("Red cards", "ALL", 1, 0)];
  const r = rojas1TDe({}, soloAll);
  assert.deepEqual({ h: r.home, a: r.away }, { h: 1, a: 0 });
  assert.equal(r.fuente, "stats_ALL");

  const con2T = [...soloAll, fila("Total shots", "2ND", 10, 8)];
  const r2 = rojas1TDe({}, con2T);
  assert.deepEqual({ h: r2.home, a: r2.away }, { h: 0, a: 0 });
});

test("una roja en incidencias se detecta aunque la stat 1ST diga 0", () => {
  const filas = [fila("Red cards", "1ST", 0, 0)];
  const json = {
    incidents: [{ incidentType: "card", incidentClass: "red", isHome: false, time: 33 }],
  };
  const r = rojas1TDe(json, filas);
  assert.deepEqual({ h: r.home, a: r.away }, { h: 0, a: 1 });
});

test("C1: kOwn para el equipo con roja y kOpp para el rival", () => {
  const aj = { factores: { kOwn: 0.7, kOpp: 0.75 } };
  assert.deepEqual(factorC1(aj, { home: 1, away: 0 }), { home: 0.7, away: 0.75 });
  assert.deepEqual(factorC1(aj, { home: 0, away: 2 }), { home: 0.75, away: 0.7 });
  assert.deepEqual(factorC1(aj, { home: 0, away: 0 }), { home: 1, away: 1 });
});

test("C4: aplica estado/fuerza del equipo con roja y espeja cuando la roja es del rival", () => {
  const aj = {
    factores: { kOwn: 0.3, kOpp: 1.25 },
    efectos: {
      own: {
        a: { ganando: 0.8, empatando: 0.7, perdiendo: 0.6 },
        b: { fuerte: 0.5, debil: 0.4 },
      },
      opp: {
        a: { ganando: 1.2, empatando: 1.1, perdiendo: 1.0 },
        b: { fuerte: 1.3, debil: 1.2 },
      },
    },
  };
  // Local con roja, local ganando y fuerte.
  const own = factorC4Lado({
    ajuste: aj, lado: "home", red: { home: 1, away: 0 }, state: 1, fuerza: 0.5,
  });
  assert.ok(Math.abs(own - 0.3 * 0.8 * 0.5) < 1e-9);

  // Roja del local vista desde la fila visitante: el marcador es 1-0 para el
  // local (state=1, diferencial del local) y la fila visitante es débil
  // (fuerza<0). El equipo con roja (local) va ganando y es fuerte.
  const opp = factorC4Lado({
    ajuste: aj, lado: "away", red: { home: 1, away: 0 }, state: 1, fuerza: -0.5,
  });
  assert.ok(Math.abs(opp - 1.25 * 1.2 * 1.3) < 1e-9);
});
