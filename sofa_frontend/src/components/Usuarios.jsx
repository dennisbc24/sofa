import { useCallback, useEffect, useState } from "react"
import axios from "axios"

const ESTADOS = {
  activo: "resultado-v",
  pendiente: "resultado-e",
  rechazado: "resultado-d",
}

// Usuarios y acceso: cola de pendientes (admin), lista general y cambio de
// contraseña del propio usuario.
export const Usuarios = ({ sesion }) => {
  const [lista, setLista] = useState(null)
  const [noAdmin, setNoAdmin] = useState(false)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [pass, setPass] = useState({ actual: "", nueva: "" })
  const [reset, setReset] = useState({ id: null, valor: "" })

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const r = await axios.get("/api/auth/usuarios")
      setLista(r.data.usuarios)
      setNoAdmin(false)
    } catch (err) {
      if (err.response?.status === 403) {
        setNoAdmin(true)
      } else {
        setError(err.response?.data?.message || "Error al cargar usuarios.")
      }
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const decidir = async (id, accion) => {
    setError(null)
    try {
      await axios.post(`/api/auth/usuarios/${id}/${accion}`)
      await cargar()
    } catch (err) {
      setError(err.response?.data?.message || "Error al actualizar el usuario.")
    }
  }

  // Admin: pone contraseña nueva a una cuenta → invalida sus sesiones abiertas.
  const guardarReset = async (u) => {
    setError(null)
    setAviso(null)
    try {
      await axios.post(`/api/auth/usuarios/${u.id}/password`, { password: reset.valor })
      setAviso(
        u.id === sesion?.id
          ? "Tu contraseña se ha cambiado: sigues dentro con la nueva."
          : `Contraseña puesta a ${u.usuario}. Comunícasela y pídele que la cambie al entrar.`
      )
      setReset({ id: null, valor: "" })
    } catch (err) {
      setError(err.response?.data?.message || "Error al poner la contraseña.")
    }
  }

  const cambiarPassword = async (e) => {
    e.preventDefault()
    setError(null)
    setAviso(null)
    try {
      const r = await axios.post("/api/auth/cambiar-password", pass)
      setAviso(r.data.message || "Contraseña actualizada.")
      setPass({ actual: "", nueva: "" })
    } catch (err) {
      setError(err.response?.data?.message || "Error al cambiar la contraseña.")
    }
  }

  const pendientes = (lista || []).filter((u) => u.estado === "pendiente")
  const resto = (lista || []).filter((u) => u.estado !== "pendiente")

  return (
    <section className="usuarios-vista">
      <h2 className="view-title">Usuarios y acceso</h2>

      {error && <p className="tabla-status tabla-status-error">{error}</p>}
      {aviso && <p className="tabla-status">{aviso}</p>}

      {!noAdmin && (
        <section className="card">
          <div className="card-header">
            Pendientes de aprobación ({pendientes.length})
          </div>
          {pendientes.length === 0 ? (
            <p className="tabla-status">No hay cuentas esperando aprobación.</p>
          ) : (
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Registrado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((u) => (
                    <tr key={u.id}>
                      <td>{u.usuario}</td>
                      <td>{u.rol}</td>
                      <td className="tabla-num">
                        {new Date(u.creado_en).toLocaleString("es-ES")}
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          onClick={() => decidir(u.id, "aprobar")}
                        >
                          Aprobar
                        </button>{" "}
                        <button
                          className="btn btn-secondary"
                          onClick={() => decidir(u.id, "rechazar")}
                        >
                          Rechazar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {noAdmin ? (
        <section className="card">
          <div className="card-header">Lista de usuarios</div>
          <p className="tabla-status">Sólo el admin puede ver y aprobar usuarios.</p>
        </section>
      ) : (
        lista && (
          <section className="card">
            <div className="card-header">Todos los usuarios ({lista.length})</div>
            <div className="tabla-scroll">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Creado</th>
                    <th>Último acceso</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resto.map((u) => (
                    <tr key={u.id}>
                      <td>{u.usuario}</td>
                      <td>{u.rol}</td>
                      <td>
                        <span className={`resultado-chip ${ESTADOS[u.estado] || "resultado-e"}`}>
                          {u.estado}
                        </span>
                      </td>
                      <td className="tabla-num">
                        {new Date(u.creado_en).toLocaleDateString("es-ES")}
                      </td>
                      <td className="tabla-num">
                        {u.ultimo_acceso
                          ? new Date(u.ultimo_acceso).toLocaleString("es-ES")
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setReset({ id: u.id, valor: "" })}
                        >
                          Poner contraseña
                        </button>
                        {reset.id === u.id && (
                          <span className="reset-inline">
                            <input
                              className="field-input"
                              type="password"
                              autoComplete="new-password"
                              placeholder="nueva (mín. 8)"
                              autoFocus
                              value={reset.valor}
                              onChange={(e) => setReset({ ...reset, valor: e.target.value })}
                            />
                            <button
                              className="btn btn-primary"
                              disabled={reset.valor.length < 8}
                              onClick={() => guardarReset(u)}
                            >
                              Guardar
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => setReset({ id: null, valor: "" })}
                            >
                              Cancelar
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      <section className="card">
        <div className="card-header">Mi contraseña ({sesion?.usuario})</div>
        <form onSubmit={cambiarPassword}>
          <label className="field">
            <span className="field-label">Contraseña actual</span>
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              value={pass.actual}
              onChange={(e) => setPass({ ...pass, actual: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Nueva contraseña (mínimo 8)</span>
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={pass.nueva}
              onChange={(e) => setPass({ ...pass, nueva: e.target.value })}
            />
          </label>
          <div className="actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!pass.actual || pass.nueva.length < 8}
            >
              Cambiar contraseña
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}
