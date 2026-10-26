process.env.AUTH_SECRET = "secreto-de-prueba-con-mas-de-32-caracteres";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const auth = require("../services/auth/auth");

test("hashPassword + verificarPassword aceptan la contraseña correcta", () => {
  const { salt, hash } = auth.hashPassword("ClaveSegura123");
  assert.equal(auth.verificarPassword("ClaveSegura123", salt, hash), true);
});

test("verificarPassword rechaza contraseña incorrecta y hash corrupto", () => {
  const { salt, hash } = auth.hashPassword("ClaveSegura123");
  assert.equal(auth.verificarPassword("otra-cosa", salt, hash), false);
  assert.equal(auth.verificarPassword("ClaveSegura123", salt, "no-es-hex"), false);
  assert.equal(auth.verificarPassword("ClaveSegura123", salt, hash.slice(0, -2)), false);
});

test("dos hashes de la misma contraseña usan salt distinto", () => {
  const uno = auth.hashPassword("ClaveSegura123");
  const dos = auth.hashPassword("ClaveSegura123");
  assert.notEqual(uno.salt, dos.salt);
  assert.notEqual(uno.hash, dos.hash);
});

test("crearToken + verificarToken conservan uid, rol y session_version", () => {
  const token = auth.crearToken(7, "admin", 3);
  const datos = auth.verificarToken(token);
  assert.equal(datos.uid, 7);
  assert.equal(datos.rol, "admin");
  assert.equal(datos.sv, 3);
});

test("verificarToken rechaza tokens manipulados o con formato inválido", () => {
  const token = auth.crearToken(7, "admin", 3);
  const [payload, firma] = token.split(".");
  assert.equal(auth.verificarToken(`${payload}.${firma.slice(0, -1)}x`), null);
  assert.equal(auth.verificarToken(`${payload}x.${firma}`), null);
  assert.equal(auth.verificarToken("sin-punto"), null);
  assert.equal(auth.verificarToken(""), null);
  assert.equal(auth.verificarToken(null), null);
});

test("verificarToken rechaza un token caducado", () => {
  const payload = Buffer.from(
    JSON.stringify({ uid: 1, rol: "usuario", sv: 0, exp: Date.now() - 1000 })
  ).toString("base64url");
  const firma = crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  assert.equal(auth.verificarToken(`${payload}.${firma}`), null);
});

test("cookieSesion añade HttpOnly, SameSite y Secure según corresponda", () => {
  const normal = auth.cookieSesion("token", false);
  assert.match(normal, /HttpOnly/);
  assert.match(normal, /SameSite=Lax/);
  assert.doesNotMatch(normal, /Secure/);
  assert.match(auth.cookieSesion("token", true), /Secure/);
});

test("leerCookie extrae el valor de la cookie de sesión", () => {
  const req = { headers: { cookie: `otra=1; ${auth.COOKIE}=abc.def; x=2` } };
  assert.equal(auth.leerCookie(req), "abc.def");
  assert.equal(auth.leerCookie({ headers: {} }), null);
});
