const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Carga del modelo entrenado (JSON generado por scripts/entrenar_prediccion.js).
// El endpoint NUNCA entrena: solo lee el archivo ya entrenado (con caché por
// mtime para no releerlo en cada request).
// ---------------------------------------------------------------------------

const MODELO_PATH = path.join(__dirname, "..", "..", "modelos", "prediccion_poisson.json");

let cache = { mtimeMs: 0, modelo: null };

function rutaModelo() {
  return MODELO_PATH;
}

function modeloDisponible() {
  return fs.existsSync(MODELO_PATH);
}

// Devuelve el modelo entrenado o null si nunca se entrenó.
function cargarModelo() {
  if (!fs.existsSync(MODELO_PATH)) return null;
  const stat = fs.statSync(MODELO_PATH);
  if (cache.modelo && cache.mtimeMs === stat.mtimeMs) return cache.modelo;
  const crudo = JSON.parse(fs.readFileSync(MODELO_PATH, "utf8"));
  cache = { mtimeMs: stat.mtimeMs, modelo: crudo };
  return crudo;
}

function guardarModelo(objeto) {
  fs.mkdirSync(path.dirname(MODELO_PATH), { recursive: true });
  fs.writeFileSync(MODELO_PATH, JSON.stringify(objeto, null, 2), "utf8");
  cache = { mtimeMs: 0, modelo: null }; // invalida caché
}

module.exports = { cargarModelo, guardarModelo, modeloDisponible, rutaModelo };
