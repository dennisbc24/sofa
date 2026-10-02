// ---------------------------------------------------------------------------
// MIDDLEWARE DE AUTH — protege TODA la API salvo las rutas públicas de sesión.
// req.usuario = { uid, rol } si la cookie es válida; si no → 401.
// (El frontend sin sesión ve 401 en cada llamada y muestra el login; los
//  estáticos quedan públicos para que la propia página de login cargue.)
// ---------------------------------------------------------------------------
const { verificarToken, leerCookie } = require("./auth");

const PUBLICAS = [
  "/auth/login",
  "/auth/registro",
  "/auth/sesion",
  "/auth/logout",
];

function protegerApi(req, res, next) {
  if (PUBLICAS.includes(req.path)) return next();
  const token = leerCookie(req);
  const datos = verificarToken(token);
  if (!datos) return res.status(401).json({ message: "No autenticado" });
  req.usuario = datos;
  next();
}

function requiereAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== "admin") {
    return res.status(403).json({ message: "Requiere rol admin" });
  }
  next();
}

module.exports = { protegerApi, requiereAdmin };
