const express = require("express");
const router = express.Router();
const ctl = require("../../controllers/auth.controllers");
const { requiereAdmin } = require("../../services/auth/middleware");

// Públicas (sin cookie): registro/login/sesión/logout
router.post("/registro", ctl.registro);
router.post("/login", ctl.login);
router.get("/sesion", ctl.sesion);
router.post("/logout", ctl.logout);

// Autenticadas (la cookie las valida el middleware global /api)
router.post("/cambiar-password", ctl.cambiarPassword);

// Sólo admin
router.get("/usuarios", requiereAdmin, ctl.listarUsuarios);
router.post("/usuarios/:id/aprobar", requiereAdmin, ctl.aprobar);
router.post("/usuarios/:id/rechazar", requiereAdmin, ctl.rechazar);
router.post("/usuarios/:id/password", requiereAdmin, ctl.resetPassword);

module.exports = router;
