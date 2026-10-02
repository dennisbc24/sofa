// ---------------------------------------------------------------------------
// CONTROLLERS DE AUTH — registro abierto (queda PENDIENTE), login sólo para
// activos con rate-limit, sesión por cookie, aprobación/rechazo por admin y
// cambio de contraseña.
// ---------------------------------------------------------------------------
const { hashPassword, verificarPassword, crearToken, cookieSesion, cookieVacia, cookieSegura } = require("../services/auth/auth");
const usuarios = require("../services/auth/usuarios");

// --- rate-limit de login (en memoria): 5 intentos cada 15 min por usuario+ip
const INTENTOS_MAX = 5;
const VENTANA_MS = 15 * 60 * 1000;
const intentos = new Map();
function controlIntentos(clave) {
  const ahora = Date.now();
  const reg = intentos.get(clave);
  if (!reg || ahora - reg.inicio > VENTANA_MS) {
    intentos.set(clave, { n: 1, inicio: ahora });
    return { ok: true, restantes: INTENTOS_MAX - 1 };
  }
  reg.n += 1;
  if (reg.n > INTENTOS_MAX) return { ok: false, restantes: 0 };
  return { ok: true, restantes: INTENTOS_MAX - reg.n };
}
function limpiarIntentos(clave) {
  intentos.delete(clave);
}

const RE_USUARIO = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$|^[a-zA-Z0-9_.-]{3,60}$/;

function validarCredenciales(usuario, password) {
  if (typeof usuario !== "string" || !RE_USUARIO.test(usuario)) {
    return "Usuario inválido: usa 3-60 caracteres (letras, números, . _ -) o un email.";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return "La contraseña debe tener entre 8 y 200 caracteres.";
  }
  return null;
}

function publico(u) {
  return { id: u.id, usuario: u.usuario, rol: u.rol };
}

// POST /api/auth/registro — crea la cuenta en estado pendiente.
const registro = async (req, res, next) => {
  try {
    const { usuario, password } = req.body || {};
    const error = validarCredenciales(usuario, password);
    if (error) return res.status(400).json({ message: error });
    const existe = await usuarios.porUsuario(usuario);
    if (existe) return res.status(409).json({ message: "Ese usuario ya existe." });
    const { salt, hash } = hashPassword(password);
    const u = await usuarios.crear({ usuario, passwordHash: hash, salt });
    res.status(201).json({
      message: "Cuenta creada. Está pendiente de aprobación: no podrás entrar hasta que un admin la apruebe.",
      usuario: publico(u),
    });
  } catch (e) {
    next(e);
  }
};

// POST /api/auth/login — sólo usuarios activos.
const login = async (req, res, next) => {
  try {
    const { usuario, password } = req.body || {};
    if (typeof usuario !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Faltan usuario o contraseña." });
    }
    const clave = `${String(usuario).toLowerCase()}|${req.ip}`;
    const ctl = controlIntentos(clave);
    if (!ctl.ok) {
      return res.status(429).json({ message: "Demasiados intentos. Espera 15 minutos." });
    }
    const u = await usuarios.porUsuario(usuario);
    const ok = u && verificarPassword(password, u.salt, u.password_hash);
    if (!ok) {
      return res.status(401).json({ message: `Usuario o contraseña incorrectos (${ctl.restantes} intentos restantes).` });
    }
    if (u.estado === "pendiente") {
      return res.status(403).json({ message: "Tu cuenta está pendiente de aprobación por un admin." });
    }
    if (u.estado !== "activo") {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos." });
    }
    limpiarIntentos(clave);
    await usuarios.marcarAcceso(u.id);
    res.setHeader("Set-Cookie", cookieSesion(crearToken(u.id, u.rol, u.session_version), cookieSegura(req)));
    res.json({ usuario: publico(u) });
  } catch (e) {
    next(e);
  }
};

// GET /api/auth/sesion — estado de la sesión (siempre 200; el cliente decide).
const sesion = async (req, res) => {
  const { verificarToken, leerCookie } = require("../services/auth/auth");
  const datos = verificarToken(leerCookie(req));
  if (!datos) return res.json({ autenticado: false });
  const u = await usuarios.porId(datos.uid);
  if (!u || u.estado !== "activo" || (datos.sv ?? 0) !== u.session_version) {
    return res.json({ autenticado: false });
  }
  res.json({ autenticado: true, usuario: publico(u) });
};

// POST /api/auth/logout — limpia la cookie.
const logout = async (req, res) => {
  res.setHeader("Set-Cookie", cookieVacia(cookieSegura(req)));
  res.json({ ok: true });
};

// POST /api/auth/cambiar-password — cualquier usuario autenticado.
const cambiarPassword = async (req, res, next) => {
  try {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== "string" || typeof nueva !== "string") {
      return res.status(400).json({ message: "Faltan contraseñas." });
    }
    if (nueva.length < 8 || nueva.length > 200) {
      return res.status(400).json({ message: "La nueva contraseña debe tener entre 8 y 200 caracteres." });
    }
    const u = await usuarios.porId(req.usuario.uid);
    if (!u || !verificarPassword(actual, u.salt, u.password_hash)) {
      return res.status(401).json({ message: "Contraseña actual incorrecta." });
    }
    const { salt, hash } = hashPassword(nueva);
    const n = await usuarios.actualizarPassword(u.id, hash, salt);
    // La versión de sesión subió: reemitimos la cookie con el sv nuevo para
    // que quien hizo el cambio siga dentro (las demás cookies quedan inválidas).
    res.setHeader("Set-Cookie", cookieSesion(crearToken(n.id, n.rol, n.session_version), cookieSegura(req)));
    res.json({ ok: true, message: "Contraseña actualizada." });
  } catch (e) {
    next(e);
  }
};

// GET /api/auth/usuarios — lista (admin).
const listarUsuarios = async (req, res, next) => {
  try {
    res.json({ usuarios: await usuarios.listar() });
  } catch (e) {
    next(e);
  }
};

// POST /api/auth/usuarios/:id/aprobar — activa la cuenta (admin).
const aprobar = async (req, res, next) => {
  try {
    const u = await usuarios.actualizarEstado(Number(req.params.id), "activo");
    if (!u) return res.status(404).json({ message: "Usuario no encontrado." });
    res.json({ ok: true, usuario: u });
  } catch (e) {
    next(e);
  }
};

// POST /api/auth/usuarios/:id/rechazar — marca rechazado (admin).
const rechazar = async (req, res, next) => {
  try {
    const u = await usuarios.porId(Number(req.params.id));
    if (!u) return res.status(404).json({ message: "Usuario no encontrado." });
    if (u.rol === "admin") return res.status(400).json({ message: "No se puede rechazar a un admin." });
    const act = await usuarios.actualizarEstado(u.id, "rechazado");
    res.json({ ok: true, usuario: act });
  } catch (e) {
    next(e);
  }
};

// POST /api/auth/usuarios/:id/password — pone contraseña nueva a cualquier
// cuenta (admin). Sube session_version: todas las sesiones abiertas de esa
// cuenta quedan inválidas (si el id es el del admin, se reemite su cookie).
const resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      return res.status(400).json({ message: "La contraseña debe tener entre 8 y 200 caracteres." });
    }
    const id = Number(req.params.id);
    const u = await usuarios.porId(id);
    if (!u) return res.status(404).json({ message: "Usuario no encontrado." });
    const { salt, hash } = hashPassword(password);
    const n = await usuarios.actualizarPassword(id, hash, salt);
    if (id === req.usuario.uid) {
      res.setHeader("Set-Cookie", cookieSesion(crearToken(n.id, n.rol, n.session_version), cookieSegura(req)));
    }
    res.json({ ok: true, message: `Contraseña nueva puesta para ${u.usuario}.` });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  registro, login, sesion, logout, cambiarPassword,
  listarUsuarios, aprobar, rechazar, resetPassword,
};
