const normalizar = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const RE_FINAL = /(finished|ended|aftertime|penalties|full time|\bft\b|finalizado|terminado)/;
const RE_DESCANSO = /(halftime|half time|half-time|\bht\b|descanso|entretiempo|medio tiempo)/;
const RE_SEGUNDA = /(2nd half|second half|2do tiempo|segundo tiempo|\b2t\b)/;
const RE_PRIMERA = /(1st half|first half|primer tiempo|\b1t\b)/;

function minutoDeInfo(info) {
  if (!info) return null;
  for (const k of ["minuto", "minuto_actual", "minutoActual", "minute", "currentMinute", "elapsed"]) {
    const n = num(info[k]);
    if (n !== null) return n;
  }
  return null;
}

function minutoDeEstado(estado) {
  const s = String(estado ?? "");
  const m = s.match(/(\d{1,3})\s*['’]/) || s.match(/(\d{1,3})\s*min/i);
  return m ? num(m[1]) : null;
}

function minutoDeJugadores(jugadores) {
  let max = null;
  for (const j of jugadores || []) {
    if (!j || j.jugo === false) continue;
    const m = num(j.minutesPlayed ?? j.minutos);
    if (m !== null && (max === null || m > max)) max = m;
  }
  return max;
}

function detectarMomento({ json, filas, estadoTexto } = {}) {
  const info = (json && json.info) || {};
  const texto = normalizar(
    estadoTexto ??
      info.estado ??
      (info.event && info.event.status && (info.event.status.description || info.event.status.type)) ??
      ""
  );
  const periodos = new Set((filas || []).map((f) => f && f.periodo).filter(Boolean));
  const hay2ND = periodos.has("2ND");
  const deInfo = minutoDeInfo(info);
  const deEstado = minutoDeEstado(texto);
  const deJugadores = minutoDeJugadores(json && json.jugadores);

  let fase;
  if (RE_FINAL.test(texto)) fase = "finalizado";
  else if (RE_DESCANSO.test(texto)) fase = "descanso";
  else if (RE_SEGUNDA.test(texto) || (hay2ND && !RE_PRIMERA.test(texto))) fase = "2T";
  else if (RE_PRIMERA.test(texto)) fase = "1T";
  else fase = hay2ND ? "2T" : "descanso";

  let minuto = deInfo ?? deEstado ?? deJugadores;
  let fuenteMinuto =
    deInfo !== null ? "info" : deEstado !== null ? "estado" : deJugadores !== null ? "jugadores" : "defecto";

  if (fase === "descanso") {
    minuto = 45;
    fuenteMinuto = "descanso";
  } else if (fase === "finalizado") {
    minuto = minuto ?? 90;
  } else if (fase === "2T") {
    if (minuto === null) minuto = 46;
    minuto = Math.min(120, Math.max(46, minuto));
  } else if (fase === "1T") {
    if (minuto === null) minuto = 45;
    minuto = Math.min(45, Math.max(1, minuto));
  }

  const jugados2T = fase === "2T" ? Math.max(0, minuto - 45) : 0;
  let restantes2T = 45;
  if (fase === "finalizado") restantes2T = 0;
  else if (fase === "2T") restantes2T = Math.max(0, 90 - minuto);

  const fraccionRestante = Math.min(1, Math.max(0, restantes2T / 45));
  const esFraccion2T = fase === "2T" && jugados2T > 0;

  const minutoTexto =
    fase === "descanso"
      ? "45' (descanso)"
      : fase === "2T"
        ? `${minuto}'`
        : fase === "1T"
          ? `${minuto}' (1T)`
          : fase === "finalizado"
            ? `${minuto}' (finalizado)`
            : "—";

  const nota =
    fase === "2T"
      ? `Analizado hasta el minuto ${minuto}' (quedan ${restantes2T}' de 2T).`
      : fase === "descanso"
        ? "Analizado al descanso (45'); quedan 45' de 2T."
        : fase === "1T"
          ? `Analizado hasta el minuto ${minuto}' (1T); proyección 2T preliminar.`
          : fase === "finalizado"
            ? `Partido finalizado (${minuto}'): no quedan minutos por proyectar.`
            : "No se pudo determinar el minuto; se asume el descanso.";

  return {
    fase,
    minuto,
    minutoTexto,
    nota,
    jugados2T,
    restantes2T,
    fraccionRestante,
    esFraccion2T,
    hay2ND,
    fuenteMinuto,
  };
}

module.exports = { detectarMomento };
