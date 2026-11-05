from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import secrets
import pyodbc

app = FastAPI(title="PrestaTec API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVER = 'DESKTOP-47GDGOF\\SQLEXPRESS'
DATABASE = 'PrestaTecBD'
sesiones = {}
sesiones_usuarios = {}

def get_db_connection():
    try:
        conn = pyodbc.connect(
            f'DRIVER={{SQL Server}};SERVER={SERVER};DATABASE={DATABASE};Trusted_Connection=yes;'
        )
        return conn
    except Exception as e:
        print(f"Error de conexión: {e}")
        return None

# --- MODELOS PYDANTIC ---
class LoginRequest(BaseModel):
    correo: str
    password: str

class UsuarioCreateSchema(BaseModel):
    nombreCompleto: str
    correo: str
    password: str
    rol: str
    telefono: str

class UsuarioUpdateSchema(BaseModel):
    nombreCompleto: str
    correo: str
    password: Optional[str] = None
    rol: str
    telefono: str

class EquipoSchema(BaseModel):
    nombre: str
    categoria: str
    estado: str
    responsable: str
    stock: int = Field(default=1, ge=0)

class PrestamoSchema(BaseModel):
    equipoId: int
    idUsuario: int
    equipo: str
    solicitante: str
    rolSolicitante: str
    fecha: str
    motivo: str

class PrestamoUpdateSchema(BaseModel):
    equipoId: int
    solicitante: str
    fecha: str
    motivo: str

class EstadoSchema(BaseModel):
    estado: str


# --- ENDPOINTS ---

@app.get("/")
def home():
    return {"mensaje": "Bienvenido a la API de PrestaTec"}

# 1. POST /api/login
@app.post("/api/login")
def login(data: LoginRequest):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión a la base de datos")
    
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT u.ID_Usuario, u.Correo, u.NombreCompleto, u.Rol, u.Telefono
            FROM Usuarios u
            WHERE u.Correo = ? AND u.Password = ?
            """,
            (data.correo, data.password)
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")

    token = secrets.token_urlsafe(32)
    sesiones[token] = row[3]
    sesiones_usuarios[token] = row[0]

    return {
        "token": token,
        "usuario": {
            "idUsuario": row[0],
            "correo": row[1],
            "nombreCompleto": row[2],
            "rol": row[3],
            "telefono": row[4]
        }
    }

# 2. GET /api/usuarios
@app.get("/api/usuarios")
def obtener_usuarios(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")
    rol_sesion = (sesiones[token] or "").strip().casefold()
    if rol_sesion not in {"admin", "administrador"}:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión a la base de datos")

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ID_Usuario, NombreCompleto, Correo, Rol, Telefono
            FROM Usuarios
            ORDER BY NombreCompleto
            """
        )
        rows = cursor.fetchall()
        return [
            {
                "idUsuario": row[0],
                "nombreCompleto": row[1],
                "correo": row[2],
                "rol": row[3],
                "telefono": row[4]
            }
            for row in rows
        ]
    finally:
        conn.close()

# 3. POST /api/usuarios
@app.post("/api/usuarios", status_code=201)
def crear_usuario(usuario: UsuarioCreateSchema):
    if usuario.rol not in {"Alumno", "Docente"}:
        raise HTTPException(status_code=400, detail="El rol debe ser Alumno o Docente.")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión a la base de datos")

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM Usuarios WHERE Correo = ?", (usuario.correo,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo.")

        cursor.execute(
            """
            INSERT INTO Usuarios (NombreCompleto, Correo, Password, Rol, Telefono)
            OUTPUT INSERTED.ID_Usuario
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                usuario.nombreCompleto,
                usuario.correo,
                usuario.password,
                usuario.rol,
                usuario.telefono
            )
        )
        id_usuario = cursor.fetchone()[0]
        conn.commit()
        return {
            "idUsuario": id_usuario,
            "nombreCompleto": usuario.nombreCompleto,
            "correo": usuario.correo,
            "rol": usuario.rol,
            "telefono": usuario.telefono
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al crear usuario: {e}")
        raise HTTPException(status_code=500, detail="Error al crear el usuario")
    finally:
        conn.close()

# 4. PUT /api/usuarios/{id}
@app.put("/api/usuarios/{id}")
def actualizar_usuario(
    id: int,
    usuario: UsuarioUpdateSchema,
    authorization: Optional[str] = Header(None)
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")
    rol_sesion = (sesiones[token] or "").strip().casefold()
    if rol_sesion not in {"admin", "administrador"}:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")

    if usuario.rol not in {"Admin", "Alumno", "Docente"}:
        raise HTTPException(status_code=400, detail="El rol no es válido.")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión a la base de datos")

    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM Usuarios WHERE Correo = ? AND ID_Usuario <> ?",
            (usuario.correo, id)
        )
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="Ya existe un usuario con ese correo.")

        if usuario.password is None:
            cursor.execute(
                """
                UPDATE Usuarios
                SET NombreCompleto = ?, Correo = ?, Rol = ?, Telefono = ?
                WHERE ID_Usuario = ?
                """,
                (usuario.nombreCompleto, usuario.correo, usuario.rol, usuario.telefono, id)
            )
        else:
            cursor.execute(
                """
                UPDATE Usuarios
                SET NombreCompleto = ?, Correo = ?, Password = ?, Rol = ?, Telefono = ?
                WHERE ID_Usuario = ?
                """,
                (
                    usuario.nombreCompleto,
                    usuario.correo,
                    usuario.password,
                    usuario.rol,
                    usuario.telefono,
                    id
                )
            )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="El usuario no existe.")
        conn.commit()
        return {
            "idUsuario": id,
            "nombreCompleto": usuario.nombreCompleto,
            "correo": usuario.correo,
            "rol": usuario.rol,
            "telefono": usuario.telefono
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al actualizar usuario: {e}")
        raise HTTPException(status_code=500, detail="Error al actualizar el usuario")
    finally:
        conn.close()

@app.delete("/api/usuarios/{id}")
def eliminar_usuario(id: int, authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")
    rol_sesion = (sesiones[token] or "").strip().casefold()
    if rol_sesion not in {"admin", "administrador"}:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión a la base de datos")

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM Usuarios WHERE ID_Usuario = ?", (id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="El usuario no existe.")

        cursor.execute("SELECT COUNT(*) FROM Prestamos WHERE ID_Usuario = ?", (id,))
        if cursor.fetchone()[0] > 0:
            raise HTTPException(
                status_code=409,
                detail="No se puede eliminar este usuario porque tiene préstamos registrados."
            )

        cursor.execute("DELETE FROM Usuarios WHERE ID_Usuario = ?", (id,))
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al eliminar usuario: {e}")
        raise HTTPException(status_code=500, detail="Error al eliminar el usuario")
    finally:
        conn.close()

# 5. GET /api/equipos
@app.get("/api/equipos")
def obtener_equipos():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    cursor = conn.cursor()
    cursor.execute("SELECT ID_Equipo, Nombre, Categoria, Estado, Responsable, Stock FROM Equipos")
    rows = cursor.fetchall()
    conn.close()

    equipos = []
    for r in rows:
        equipos.append({
            "id": r[0],
            "nombre": r[1],
            "categoria": r[2],
            "estado": r[3],
            "responsable": r[4],
            "stock": r[5]
        })
    return equipos

# 6. POST /api/equipos
@app.post("/api/equipos")
def crear_equipo(eq: EquipoSchema):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO Equipos (Nombre, Categoria, Estado, Responsable, Stock)
        OUTPUT INSERTED.ID_Equipo
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            eq.nombre,
            eq.categoria,
            'Agotado' if eq.stock <= 0 else ('Disponible' if eq.estado == 'Agotado' else eq.estado),
            eq.responsable,
            eq.stock
        )
    )
    nuevo_id = cursor.fetchone()[0]
    conn.commit()
    conn.close()

    return {
        "id": nuevo_id,
        "nombre": eq.nombre,
        "categoria": eq.categoria,
        "estado": 'Agotado' if eq.stock <= 0 else ('Disponible' if eq.estado == 'Agotado' else eq.estado),
        "responsable": eq.responsable,
        "stock": eq.stock
    }

# 7. PUT /api/equipos/{id}
@app.put("/api/equipos/{id}")
def actualizar_equipo(id: int, eq: dict):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    cursor = conn.cursor()
    campos = []
    valores = []
    for clave, valor in eq.items():
        if clave in ['nombre', 'categoria', 'estado', 'responsable', 'stock']:
            columna = 'Stock' if clave == 'stock' else clave.capitalize()
            campos.append(f"{columna} = ?")
            if clave == 'estado' and 'stock' in eq:
                valor = 'Agotado' if eq['stock'] <= 0 else ('Disponible' if valor == 'Agotado' else valor)
            valores.append(valor)

    if 'stock' in eq and 'estado' not in eq:
        campos.append("Estado = CASE WHEN ? <= 0 THEN 'Agotado' WHEN Estado = 'Agotado' THEN 'Disponible' ELSE Estado END")
        valores.append(eq['stock'])

    if campos:
        valores.append(id)
        sql = f"UPDATE Equipos SET {', '.join(campos)} WHERE ID_Equipo = ?"
        cursor.execute(sql, tuple(valores))
        conn.commit()
    
    conn.close()
    return {"ok": True}

# 8. GET /api/prestamos
@app.get("/api/prestamos")
def obtener_prestamos():
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT ID_Prestamo, ID_Equipo, ID_Usuario, EquipoNombre,
               SolicitanteNombre, RolSolicitante, Fecha, Motivo, Estado,
               Fecha_Finalizacion
        FROM Prestamos
        """
    )
    rows = cursor.fetchall()
    conn.close()

    prestamos = []
    for r in rows:
        prestamos.append({
            "id": r[0],
            "equipoId": r[1],
            "idUsuario": r[2],
            "equipo": r[3],
            "solicitante": r[4],
            "rolSolicitante": r[5] if r[5] else "Alumno",
            "fecha": r[6].strftime("%Y-%m-%d %H:%M") if r[6] else "",
            "motivo": r[7],
            "estado": r[8],
            "fechaFinalizacion": r[9].strftime("%Y-%m-%d %H:%M") if r[9] else None
        })
    return prestamos

# 9. POST /api/prestamos
@app.post("/api/prestamos")
def crear_prestamo(p: PrestamoSchema):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    try:
        fecha_sql = p.fecha.replace('T', ' ')
        cursor = conn.cursor()
        cursor.execute(
            "SELECT Nombre, Stock FROM Equipos WITH (UPDLOCK, HOLDLOCK) WHERE ID_Equipo = ?",
            (p.equipoId,)
        )
        equipo = cursor.fetchone()
        if not equipo:
            raise HTTPException(status_code=404, detail="El equipo no existe.")
        if equipo[1] <= 0:
            raise HTTPException(status_code=409, detail="No hay unidades disponibles de este equipo.")

        cursor.execute(
            """
            INSERT INTO Prestamos
                (ID_Equipo, ID_Usuario, EquipoNombre, SolicitanteNombre, RolSolicitante, Fecha, Motivo, Estado)
            OUTPUT INSERTED.ID_Prestamo 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')
            """,
            (p.equipoId, p.idUsuario, equipo[0], p.solicitante, p.rolSolicitante, fecha_sql, p.motivo)
        )
        nuevo_id = cursor.fetchone()[0]
        conn.commit()

        return {
            "id": nuevo_id, 
            "equipoId": p.equipoId, 
            "idUsuario": p.idUsuario,
            "equipo": equipo[0], 
            "solicitante": p.solicitante,
            "rolSolicitante": p.rolSolicitante,
            "fecha": p.fecha, 
            "motivo": p.motivo, 
            "estado": "Pendiente"
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        print(f"Error al insertar préstamo: {e}")
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

# 10. PUT /api/prestamos/{id}
@app.put("/api/prestamos/{id}")
def actualizar_prestamo(
    id: int,
    prestamo: PrestamoUpdateSchema,
    authorization: Optional[str] = Header(None)
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")
    id_usuario = sesiones_usuarios.get(token)
    if id_usuario is None:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    es_admin = (sesiones[token] or "").strip().casefold() in {"admin", "administrador"}

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ID_Usuario, ID_Equipo, Estado
            FROM Prestamos WITH (UPDLOCK, HOLDLOCK)
            WHERE ID_Prestamo = ?
            """,
            (id,)
        )
        actual = cursor.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="La solicitud no existe.")
        if actual[0] != id_usuario and not es_admin:
            raise HTTPException(status_code=403, detail="No puedes modificar esta solicitud.")
        if actual[2] != "Pendiente":
            raise HTTPException(status_code=409, detail="Solo se pueden editar solicitudes pendientes.")

        cursor.execute(
            "SELECT Nombre, Stock, Estado FROM Equipos WITH (UPDLOCK, HOLDLOCK) WHERE ID_Equipo = ?",
            (prestamo.equipoId,)
        )
        equipo = cursor.fetchone()
        if not equipo:
            raise HTTPException(status_code=404, detail="El equipo no existe.")
        if prestamo.equipoId != actual[1] and (equipo[1] <= 0 or equipo[2] == "Baja"):
            raise HTTPException(status_code=409, detail="El equipo seleccionado ya no está disponible.")

        cursor.execute(
            """
            UPDATE Prestamos
            SET ID_Equipo = ?, EquipoNombre = ?, SolicitanteNombre = ?, Fecha = ?, Motivo = ?
            WHERE ID_Prestamo = ?
            """,
            (
                prestamo.equipoId,
                equipo[0],
                prestamo.solicitante,
                prestamo.fecha.replace("T", " "),
                prestamo.motivo,
                id
            )
        )
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al actualizar la solicitud: {e}")
        raise HTTPException(status_code=500, detail="Error al actualizar la solicitud")
    finally:
        conn.close()

# 11. DELETE /api/prestamos/{id}
@app.delete("/api/prestamos/{id}")
def eliminar_prestamo(id: int, authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")
    id_usuario = sesiones_usuarios.get(token)
    if id_usuario is None:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    es_admin = (sesiones[token] or "").strip().casefold() in {"admin", "administrador"}

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ID_Usuario, Estado
            FROM Prestamos WITH (UPDLOCK, HOLDLOCK)
            WHERE ID_Prestamo = ?
            """,
            (id,)
        )
        actual = cursor.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="La solicitud no existe.")
        if actual[0] != id_usuario and not es_admin:
            raise HTTPException(status_code=403, detail="No puedes eliminar esta solicitud.")
        if actual[1] != "Pendiente":
            raise HTTPException(status_code=409, detail="Solo se pueden eliminar solicitudes pendientes.")

        cursor.execute("DELETE FROM Prestamos WHERE ID_Prestamo = ?", (id,))
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al eliminar la solicitud: {e}")
        raise HTTPException(status_code=500, detail="Error al eliminar la solicitud")
    finally:
        conn.close()

# 12. PUT /api/prestamos/{id}/estado
@app.put("/api/prestamos/{id}/estado")
def cambiar_estado_prestamo(id: int, body: EstadoSchema):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")
    
    try:
        if body.estado not in {'Aprobado', 'Rechazado', 'Entregado', 'Devuelto'}:
            raise HTTPException(status_code=400, detail="Estado de préstamo no válido.")

        cursor = conn.cursor()
        cursor.execute(
            "SELECT ID_Equipo, Estado FROM Prestamos WITH (UPDLOCK, HOLDLOCK) WHERE ID_Prestamo = ?",
            (id,)
        )
        prestamo = cursor.fetchone()
        if not prestamo:
            raise HTTPException(status_code=404, detail="El préstamo no existe.")

        equipo_id, estado_actual = prestamo[0], prestamo[1]
        transiciones = {
            'Aprobado': {'Pendiente'},
            'Rechazado': {'Pendiente'},
            'Entregado': {'Aprobado'},
            'Devuelto': {'Entregado'}
        }
        if estado_actual not in transiciones[body.estado]:
            raise HTTPException(
                status_code=409,
                detail=f"No se puede cambiar un préstamo de {estado_actual} a {body.estado}."
            )

        if body.estado == 'Entregado':
            cursor.execute(
                """
                UPDATE Equipos
                SET Stock = Stock - 1,
                    Estado = CASE WHEN Stock - 1 <= 0 THEN 'Agotado' ELSE 'Disponible' END
                WHERE ID_Equipo = ? AND Stock > 0
                """,
                (equipo_id,)
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=409, detail="No hay unidades disponibles de este equipo.")
        elif body.estado == 'Devuelto':
            cursor.execute(
                """
                UPDATE Equipos
                SET Stock = Stock + 1, Estado = 'Disponible'
                WHERE ID_Equipo = ?
                """,
                (equipo_id,)
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="El equipo del préstamo no existe.")

        if body.estado in {'Rechazado', 'Entregado', 'Devuelto'}:
            cursor.execute(
                """
                UPDATE Prestamos
                SET Estado = ?, Fecha_Finalizacion = GETDATE()
                WHERE ID_Prestamo = ?
                """,
                (body.estado, id)
            )
        else:
            cursor.execute("UPDATE Prestamos SET Estado = ? WHERE ID_Prestamo = ?", (body.estado, id))
        conn.commit()
        return {"ok": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Error al cambiar estado del préstamo: {e}")
        raise HTTPException(status_code=500, detail="Error al actualizar el préstamo")
    finally:
        conn.close()

# 13. DELETE /api/prestamos/finalizados
@app.delete("/api/prestamos/finalizados")
def eliminar_prestamos_finalizados(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Autenticación requerida")

    esquema, _, token = authorization.partition(" ")
    if esquema.lower() != "bearer" or not token or token not in sesiones:
        raise HTTPException(status_code=401, detail="Token inválido")

    rol = (sesiones[token] or "").strip().casefold()
    if rol not in {"admin", "administrador"}:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Error de conexión")

    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM Prestamos WHERE Estado = ?", ("Devuelto",))
        eliminados = max(cursor.rowcount, 0)
        conn.commit()
        return {"ok": True, "eliminados": eliminados}
    except Exception as e:
        conn.rollback()
        print(f"Error al eliminar préstamos finalizados: {e}")
        raise HTTPException(status_code=500, detail="Error al eliminar préstamos finalizados")
    finally:
        conn.close()