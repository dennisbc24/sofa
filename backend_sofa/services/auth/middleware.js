// ---------------------------------------------------------------------------
// MIDDLEWARE DE AUTH — protege TODA la API salvo las rutas públicas de sesión.
// req.usuario = { uid, rol } si la cookie es válida; si no → 401.
// Cada request comprueba en BD: usuario activo y session_version coincidente
// (al cambiar la contraseña se sube la versión → cookies antiguas → 401).
// (El frontend sin sesión ve 401 en cada llamada y muestra el login; los
//  estáticos quedan públicos para que la propia página de login cargue.)
// ---------------------------------------------------------------------------
const { verificarToken, leerCookie } = require("./auth");
const usuarios = require("./usuarios");

const PUBLICAS = [
  "/auth/login",
  "/auth/registro",
  "/auth/sesion",
  "/auth/logout",
];

async function protegerApi(req, res, next) {
  if (PUBLICAS.includes(req.path)) return next();
  try {
    const datos = verificarToken(leerCookie(req));
    if (!datos) return res.status(401).json({ message: "No autenticado" });
    const u = await usuarios.porId(datos.uid);
    // sv ausente en tokens antiguos = versión 0 (compatibilidad).
    if (!u || u.estado !== "activo" || (datos.sv ?? 0) !== u.session_version) {
      return res.status(401).json({ message: "No autenticado" });
    }
    req.usuario = { uid: u.id, rol: u.rol };
    next();
  } catch (e) {
    next(e);
  }
}

function requiereAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== "admin") {
    return res.status(403).json({ message: "Requiere rol admin" });
  }
  next();
}

module.exports = { protegerApi, requiereAdmin };
