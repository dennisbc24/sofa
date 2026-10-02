// ---------------------------------------------------------------------------
// AUTH — contraseñas (scrypt) y tokens de sesión (HMAC-SHA256), con el crypto
// nativo de Node: cero dependencias nuevas.
//
//  - Contraseña: scrypt (N=16384, r=8, p=1, 64 bytes) + salt aleatorio de 16
//    bytes; verificación con timingSafeEqual.
//  - Token: payload {uid, rol, exp, nonce} en base64url firmado con
//    HMAC-SHA256 usando AUTH_SECRET (.env, gitignore). Se entrega en cookie
//    HttpOnly + SameSite=Lax; expira en TOKEN_DIAS.
//  - Si AUTH_SECRET no está definido, el login falla con error claro (no se
//    generan secretos débiles ni "fantasma").
// ---------------------------------------------------------------------------
const crypto = require("crypto");
require("../../config/config");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const TOKEN_DIAS = 30;
const COOKIE = "sofa_sesion";

function secreto() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET ausente o demasiado corto en .env (mínimo 32 caracteres)");
  }
  return s;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return { salt, hash };
}

function verificarPassword(password, salt, hash) {
  let intento;
  try {
    intento = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  } catch {
    return false;
  }
  const esperado = Buffer.from(hash, "hex");
  if (intento.length !== esperado.length) return false;
  return crypto.timingSafeEqual(intento, esperado);
}

const firmar = (payload) =>
  crypto.createHmac("sha256", secreto()).update(payload).digest("base64url");

function crearToken(uid, rol) {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      rol,
      exp: Date.now() + TOKEN_DIAS * 24 * 60 * 60 * 1000,
      nonce: crypto.randomBytes(8).toString("hex"),
    })
  ).toString("base64url");
  return `${payload}.${firmar(payload)}`;
}

function verificarToken(token) {
  if (!token || typeof token !== "string") return null;
  const punto = token.lastIndexOf(".");
  if (punto < 1) return null;
  const payload = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  const esperada = firmar(payload);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!datos.uid || typeof datos.exp !== "number" || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

function cookieSesion(token, seguro) {
  return (
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_DIAS * 24 * 60 * 60}` +
    (seguro ? "; Secure" : "")
  );
}

function cookieVacia(seguro) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (seguro ? "; Secure" : "");
}

function leerCookie(req) {
  const cabecera = req.headers.cookie || "";
  for (const parte of cabecera.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

// Secure cuando la petición llega por HTTPS (directo o vía proxy nginx con
// X-Forwarded-Proto). AUTH_COOKIE_SECURE=1 lo fuerza, =0 lo desactiva.
function cookieSegura(req) {
  if (process.env.AUTH_COOKIE_SECURE === "1") return true;
  if (process.env.AUTH_COOKIE_SECURE === "0") return false;
  return Boolean(req.secure) || req.get("x-forwarded-proto") === "https";
}

module.exports = {
  COOKIE, TOKEN_DIAS,
  hashPassword, verificarPassword,
  crearToken, verificarToken,
  cookieSesion, cookieVacia, leerCookie, cookieSegura,
};
