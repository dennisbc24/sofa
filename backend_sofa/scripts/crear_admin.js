// ---------------------------------------------------------------------------
// CREAR ADMIN — primera cuenta admin (la tuya) de la aplicación.
//
// Uso (PowerShell):
//   $env:AUTH_ADMIN_PASSWORD = "TuContraseñaLarga"; node scripts/crear_admin.js
//   $env:AUTH_ADMIN_PASSWORD = "…"; node scripts/crear_admin.js mi@email.com
//
// Crea la tabla usuarios si no existe y da de alta al admin con estado
// activo. Si el usuario ya existe, NO lo pisa (usa "cambiar contraseña" desde
// la web o borra la fila a mano).
// ---------------------------------------------------------------------------
const { asegurarTabla, porUsuario, crear } = require("../services/auth/usuarios");
const { hashPassword } = require("../services/auth/auth");

(async () => {
  const usuario = process.env.AUTH_ADMIN_USER || process.argv[2] || "admin";
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    console.error("Define AUTH_ADMIN_PASSWORD (mínimo 8 caracteres) antes de ejecutar:");
    console.error('  PowerShell: $env:AUTH_ADMIN_PASSWORD = "TuContraseña"; node scripts/crear_admin.js');
    process.exit(1);
  }
  await asegurarTabla();
  const existe = await porUsuario(usuario);
  if (existe) {
    console.error(`El usuario "${usuario}" ya existe (estado: ${existe.estado}, rol: ${existe.rol}). No se modifica.`);
    process.exit(1);
  }
  const { salt, hash } = hashPassword(password);
  const u = await crear({ usuario, passwordHash: hash, salt, rol: "admin", estado: "activo" });
  console.log(`Admin creado: ${u.usuario} (id ${u.id}, rol ${u.rol}, estado ${u.estado}).`);
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
