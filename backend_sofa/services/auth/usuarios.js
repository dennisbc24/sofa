// ---------------------------------------------------------------------------
// USUARIOS — tabla usuarios (creación idempotente) y consultas.
// Estados: pendiente (registrado, sin acceso) → activo (aprobado por admin)
//          | rechazado (no puede entrar). roles: admin | usuario.
// ---------------------------------------------------------------------------
const pool = require("../../db");

let tablaCreada = false;

async function asegurarTabla() {
  if (tablaCreada) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            serial PRIMARY KEY,
      usuario       varchar(60) UNIQUE NOT NULL,
      password_hash varchar(200) NOT NULL,
      salt          varchar(64) NOT NULL,
      rol           varchar(20) NOT NULL DEFAULT 'usuario',
      estado        varchar(20) NOT NULL DEFAULT 'pendiente',
      creado_en     timestamptz NOT NULL DEFAULT now(),
      ultimo_acceso timestamptz
    )`);
  tablaCreada = true;
}

async function crear({ usuario, passwordHash, salt, rol = "usuario", estado = "pendiente" }) {
  await asegurarTabla();
  const r = await pool.query(
    `INSERT INTO usuarios (usuario, password_hash, salt, rol, estado)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, usuario, rol, estado, creado_en`,
    [usuario, passwordHash, salt, rol, estado]
  );
  return r.rows[0];
}

async function porUsuario(usuario) {
  await asegurarTabla();
  const r = await pool.query(`SELECT * FROM usuarios WHERE LOWER(usuario) = LOWER($1)`, [usuario]);
  return r.rows[0] || null;
}

async function porId(id) {
  await asegurarTabla();
  const r = await pool.query(`SELECT * FROM usuarios WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function listar() {
  await asegurarTabla();
  const r = await pool.query(
    `SELECT id, usuario, rol, estado, creado_en, ultimo_acceso
       FROM usuarios ORDER BY creado_en ASC`
  );
  return r.rows;
}

async function actualizarEstado(id, estado) {
  const r = await pool.query(
    `UPDATE usuarios SET estado = $2 WHERE id = $1 RETURNING id, usuario, rol, estado`,
    [id, estado]
  );
  return r.rows[0] || null;
}

async function marcarAcceso(id) {
  await pool.query(`UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1`, [id]);
}

async function actualizarPassword(id, passwordHash, salt) {
  await pool.query(`UPDATE usuarios SET password_hash = $2, salt = $3 WHERE id = $1`, [
    id, passwordHash, salt,
  ]);
}

module.exports = {
  asegurarTabla, crear, porUsuario, porId, listar,
  actualizarEstado, marcarAcceso, actualizarPassword,
};
