/* =========================================================
   PrestaTec – Lógica de interfaz
   Para conectar el backend real: pon USE_MOCK = false y
   ajusta API_URL. Cada función de `api` indica su endpoint.
   ========================================================= */


const API_URL = 'http://172.16.8.209:8000/api'; // Cambiar por la IP actual del equipo que ejecuta la API
const USE_MOCK = false; // <-- Cambiar a false
/* ---------- Datos simulados (mock) ---------- */
const db = {
  equipos: [
    { id: 1, nombre: 'Laptop Dell Latitude 5420', categoria: 'Laptop', estado: 'Disponible', responsable: 'Almacén – Lab. Cómputo', stock: 3 },
    { id: 2, nombre: 'Laptop HP ProBook 450', categoria: 'Laptop', estado: 'Disponible', responsable: 'Almacén – Lab. Cómputo', stock: 1 },
    { id: 3, nombre: 'Proyector Epson X49', categoria: 'Proyector', estado: 'Disponible', responsable: 'Audiovisual', stock: 2 },
    { id: 4, nombre: 'Multímetro Fluke 117', categoria: 'Herramienta', estado: 'Disponible', responsable: 'Taller de Electrónica', stock: 5 },
    { id: 5, nombre: 'Kit de desarmadores', categoria: 'Herramienta', estado: 'Baja', responsable: 'Almacén', stock: 0 },
  ],
  prestamos: [
    { id: 1, equipoId: 2, idUsuario: 1, equipo: 'Laptop HP ProBook 450', solicitante: 'alumno', rolSolicitante: 'Alumno', fecha: '2026-09-24T10:00', motivo: 'Proyecto de programación', estado: 'Aprobado' },
    { id: 2, equipoId: 3, idUsuario: 2, equipo: 'Proyector Epson X49', solicitante: 'docente', rolSolicitante: 'Docente', fecha: '2026-09-25T08:00', motivo: 'Clase de Redes', estado: 'Pendiente' },
    { id: 3, equipoId: 4, idUsuario: 1, equipo: 'Multímetro Fluke 117', solicitante: 'alumno', rolSolicitante: 'Alumno', fecha: '2026-09-22T12:00', motivo: 'Práctica de circuitos', estado: 'Rechazado' },
  ],
  usuarios: [],
};
let nextId = 100;

/* ---------- Capa de red ----------
   Con USE_MOCK = true ejecuta `mockFn` (datos locales).
   Con USE_MOCK = false hace el fetch() real al backend. */
async function request(path, method, body, mockFn) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 200));
    return mockFn();
  }
  const token = sessionStorage.getItem('token');
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || error.mensaje || 'Error del servidor');
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

const api = {
  // POST /api/login → { token, usuario: { idUsuario, correo, nombreCompleto, rol, telefono } }
  login: (correo, password) => request('/login', 'POST', { correo, password }, () => {
    if (password !== '1234') throw new Error('Credenciales incorrectas (demo: contraseña 1234).');
    return {
      token: 'mock-token',
      usuario: {
        idUsuario: 1,
        correo,
        nombreCompleto: correo,
        rol: roleFrom('', correo),
        telefono: ''
      }
    };
  }),

  // POST /api/usuarios
  crearUsuario: usuario => request('/usuarios', 'POST', usuario, () => ({
    ...usuario,
    idUsuario: nextId++
  })),

  // GET /api/usuarios (solo administrador)
  getUsuarios: () => request('/usuarios', 'GET', null, () => structuredClone(db.usuarios)),

  // PUT /api/usuarios/{id}
  actualizarUsuario: (id, usuario) => request(`/usuarios/${id}`, 'PUT', usuario, () => {
    const user = db.usuarios.find(item => Number(item.idUsuario) === id);
    if (!user) throw new Error('El usuario no existe.');
    Object.assign(user, usuario);
    return { ...user };
  }),

  // DELETE /api/usuarios/{id}
  eliminarUsuario: id => request(`/usuarios/${id}`, 'DELETE', null, () => {
    const index = db.usuarios.findIndex(item => Number(item.idUsuario) === id);
    if (index === -1) throw new Error('El usuario no existe.');
    db.usuarios.splice(index, 1);
    return { ok: true };
  }),

  // GET /api/equipos
  getEquipos: () => request('/equipos', 'GET', null, () => structuredClone(db.equipos)),

  // POST /api/equipos
  crearEquipo: eq => request('/equipos', 'POST', eq, () => {
    const n = { ...eq, estado: eq.stock > 0 ? eq.estado : 'Agotado', id: nextId++ };
    db.equipos.push(n); return n;
  }),

  // PUT /api/equipos/{id}  (también sirve para dar de baja: estado = 'Baja')
  actualizarEquipo: (id, eq) => request(`/equipos/${id}`, 'PUT', eq, () => {
    Object.assign(db.equipos.find(e => e.id === id), eq); return { ok: true };
  }),

  // GET /api/prestamos
  getPrestamos: () => request('/prestamos', 'GET', null, () => structuredClone(db.prestamos)),

  // POST /api/prestamos  { equipoId, idUsuario, fecha, motivo }
  crearPrestamo: p => request('/prestamos', 'POST', p, () => {
    const equipo = db.equipos.find(e => e.id === p.equipoId);
    if (!equipo || equipo.stock <= 0) throw new Error('No hay unidades disponibles de este equipo.');
    const n = { ...p, id: nextId++, estado: 'Pendiente' }; db.prestamos.push(n); return n;
  }),

  // PUT /api/prestamos/{id}
  actualizarPrestamo: (id, prestamo) => request(`/prestamos/${id}`, 'PUT', prestamo, () => {
    const existing = db.prestamos.find(item => item.id === id);
    const equipo = db.equipos.find(item => item.id === prestamo.equipoId);
    if (!existing || existing.estado !== 'Pendiente') throw new Error('Solo se pueden editar solicitudes pendientes.');
    if (!equipo || (Number(existing.equipoId) !== Number(prestamo.equipoId) && (equipo.stock <= 0 || equipo.estado === 'Baja'))) {
      throw new Error('El equipo seleccionado ya no está disponible.');
    }
    Object.assign(existing, prestamo, { equipo: equipo.nombre });
    return { ok: true };
  }),

  // DELETE /api/prestamos/{id}
  eliminarPrestamo: id => request(`/prestamos/${id}`, 'DELETE', null, () => {
    const index = db.prestamos.findIndex(item => item.id === id);
    if (index === -1 || db.prestamos[index].estado !== 'Pendiente') {
      throw new Error('Solo se pueden eliminar solicitudes pendientes.');
    }
    db.prestamos.splice(index, 1);
    return { ok: true };
  }),

  // PUT /api/prestamos/{id}/estado  { estado: 'Aprobado' | 'Rechazado' }
  cambiarEstado: (id, estado) => request(`/prestamos/${id}/estado`, 'PUT', { estado }, () => {
    const p = db.prestamos.find(x => x.id === id);
    p.estado = estado;
    if (['Rechazado', 'Entregado', 'Devuelto'].includes(estado)) {
      p.fechaFinalizacion = new Date().toISOString();
    }
    const equipo = db.equipos.find(e => e.id === p.equipoId);
    if (estado === 'Entregado') {
      equipo.stock -= 1;
      equipo.estado = equipo.stock <= 0 ? 'Agotado' : 'Disponible';
    } else if (estado === 'Devuelto') {
      equipo.stock += 1;
      equipo.estado = 'Disponible';
    }
    return { ok: true };
  }),

  // DELETE /api/prestamos/finalizados
  eliminarFinalizados: () => request('/prestamos/finalizados', 'DELETE', null, () => {
    const total = db.prestamos.length;
    db.prestamos = db.prestamos.filter(p => p.estado !== 'Devuelto');
    return { eliminadas: total - db.prestamos.length };
  }),
};

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = e => `<span class="badge b-${e.toLowerCase()}">${esc(e)}</span>`;
const availabilityBadge = stock => Number(stock) > 0
  ? `<span class="badge b-disponible">Disponible (${Number(stock)})</span>`
  : '<span class="badge b-agotado">Agotado (0)</span>';
const fmt = f => new Date(f).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const getUser = () => JSON.parse(sessionStorage.getItem('user') || 'null');
function roleFrom(role, username) {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const roleText = normalize(role);
  const userText = normalize(username);
  if (roleText.includes('admin') || roleText.includes('administrador')) return 'admin';
  if (roleText.includes('docente') || roleText.includes('maestro')) return 'docente';
  if (roleText.includes('alumno') || roleText.includes('estudiante')) return 'alumno';
  if (!roleText && userText.startsWith('admin')) return 'admin';
  if ((!roleText || roleText === 'solicitante') && userText.startsWith('docente')) return 'docente';
  return 'alumno';
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ---------- Login ---------- */
function initLogin() {
  if (getUser()) return (location.href = 'dashboard.html');
  const f = $('#loginForm'), err = $('#loginError');
  const registerForm = $('#registerForm');
  const toggleAuth = $('#toggleAuth');
  const authHint = $('#authHint');

  toggleAuth.addEventListener('click', () => {
    const registering = registerForm.hidden;
    registerForm.hidden = !registering;
    f.hidden = registering;
    toggleAuth.textContent = registering ? 'Ya tengo una cuenta' : 'Iniciar sesión';
    authHint.textContent = registering
      ? 'Regístrate para solicitar préstamos de equipo.'
      : 'Inicia sesión con tu correo institucional y contraseña.';
  });

  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const correo = f.correo.value.trim(), password = f.password.value;
    if (correo.length < 3 || password.length < 4) return (err.textContent = 'Ingresa un correo institucional y una contraseña de mínimo 4 caracteres.');
    try {
      const r = await api.login(correo, password);
      sessionStorage.setItem('token', r.token);
      sessionStorage.setItem('user', JSON.stringify({
        correo: r.usuario.correo,
        idUsuario: r.usuario.idUsuario,
        nombreCompleto: r.usuario.nombreCompleto,
        rol: r.usuario.rol,
        telefono: r.usuario.telefono
      }));
      location.href = 'dashboard.html';
    } catch (x) { err.textContent = x.message; }
  });

  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const registerError = $('#registerError');
    registerError.textContent = '';
    const usuario = {
      nombreCompleto: registerForm.nombreCompleto.value.trim(),
      correo: registerForm.correo.value.trim(),
      password: registerForm.password.value,
      rol: registerForm.rol.value,
      telefono: registerForm.telefono.value.trim()
    };
    try {
      await api.crearUsuario(usuario);
      registerForm.reset();
      registerForm.hidden = true;
      f.hidden = false;
      toggleAuth.textContent = 'Crear una cuenta';
      authHint.textContent = 'Inicia sesión con tu correo institucional y contraseña.';
      f.correo.value = usuario.correo;
      authHint.textContent = 'Registro completado. Ya puedes iniciar sesión.';
    } catch (error) {
      registerError.textContent = error.message;
    }
  });
}

/* ---------- Dashboard ---------- */
const VIEWS = {
  alumno: [['catalogo', 'Catálogo'], ['mis', 'Mis préstamos']],
  docente: [['catalogo', 'Catálogo'], ['mis', 'Mis préstamos']],
  admin: [['solicitudes', 'Solicitudes'], ['inventario', 'Inventario'], ['usuarios', 'Usuarios']],
};
const state = { user: null, rol: 'alumno', view: 'catalogo', equipos: [], prestamos: [], usuarios: [] };
const PAGE_SIZE = 10;
const adminTables = {
  usersSearch: '',
  usersRole: 'todos',
  usersPage: 1,
  pendingSearch: '',
  pendingPage: 1,
  completedSearch: '',
  completedPage: 1,
  completedStatus: 'active',
  myLoansStatus: 'active'
};

async function initDashboard() {
  state.user = getUser();
  if (!state.user) return (location.href = 'index.html');
  if (state.user.idUsuario == null) {
    sessionStorage.clear();
    return (location.href = 'index.html');
  }
  state.rol = roleFrom(state.user.rol, state.user.correo);
  const roleLabel = state.rol === 'admin' ? 'Administrador general' : state.rol === 'docente' ? 'Docente' : 'Alumno';
  $('#userName').textContent = `${state.user.nombreCompleto || state.user.correo} · ${roleLabel}`;
  $('#myLoansTitle').textContent = state.rol === 'docente' ? 'Préstamos de docentes' : 'Préstamos de alumnos';
  setDashboardTheme(localStorage.getItem('prestatec-theme') === 'dark');

  $('#logoutBtn').addEventListener('click', () => { sessionStorage.clear(); location.href = 'index.html'; });
  $('#buscar').addEventListener('input', renderCatalog);
  $('#usersSearch').addEventListener('input', e => {
    adminTables.usersSearch = e.target.value;
    adminTables.usersPage = 1;
    renderUsers();
  });
  $('#pendingLoansSearch').addEventListener('input', e => {
    adminTables.pendingSearch = e.target.value;
    adminTables.pendingPage = 1;
    renderPending();
  });
  $('#completedLoansSearch').addEventListener('input', e => {
    adminTables.completedSearch = e.target.value;
    adminTables.completedPage = 1;
    renderCompleted();
  });
  $('#newEquipo').addEventListener('click', () => openEquipo());
  document.addEventListener('click', onClick);
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#loanForm').addEventListener('submit', submitLoan);
  $('#editLoanForm').addEventListener('submit', submitEditLoan);
  $('#equipoForm').addEventListener('submit', submitEquipo);
  $('#userForm').addEventListener('submit', submitUser);

  await refresh();
  if (state.rol === 'admin') {
    try {
      await loadUsers();
    } catch (error) {
      toast(error.message);
    }
  }
  setRole(state.rol);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh().catch(() => {});
  }, 5000);
}

async function refresh() {
  const [equipos, prestamos] = await Promise.all([api.getEquipos(), api.getPrestamos()]);
  state.equipos = equipos;
  state.prestamos = prestamos;
  renderAll();
}

function setRole(rol) {
  state.rol = rol;
  const icons = {
    catalogo: 'fa-box-open',
    mis: 'fa-clipboard-list',
    solicitudes: 'fa-rectangle-list',
    inventario: 'fa-boxes-stacked',
    usuarios: 'fa-users'
  };
  $('#tabs').innerHTML = VIEWS[rol].map(([id, title]) => `
    <button class="tab" data-view="${id}">
      <i class="fa-solid ${icons[id]}" aria-hidden="true"></i>
      <span>${title}</span>
    </button>`).join('');
  showView(VIEWS[rol][0][0]);
}

function showView(id) {
  state.view = id;
  document.querySelectorAll('.view').forEach(v => (v.hidden = v.id !== `view-${id}`));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === id));
  $('#adminMetrics').hidden = state.rol !== 'admin';
}

function setDashboardTheme(dark) {
  const button = $('#themeToggle');
  document.body.dataset.theme = dark ? 'dark' : 'light';
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', `Activar modo ${dark ? 'claro' : 'oscuro'}`);
  button.title = `Activar modo ${dark ? 'claro' : 'oscuro'}`;
  button.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i>`;
}

function renderNotifications() {
  const count = state.rol === 'admin'
    ? state.prestamos.filter(p => p.estado === 'Pendiente').length
    : state.prestamos.filter(p => Number(p.idUsuario) === Number(state.user.idUsuario) && p.estado === 'Pendiente').length;
  const badge = $('#notificationCount');
  const button = $('#notificationsBtn');
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  button.setAttribute('aria-label', count ? `Ver ${count} ${count === 1 ? 'solicitud' : 'solicitudes'} pendiente${count === 1 ? '' : 's'}` : 'No hay solicitudes pendientes');
}

function renderAll() {
  renderCatalog();
  renderMine();
  renderPending();
  renderCompleted();
  renderInventory();
  renderUsers();
  renderAdminMetrics();
  renderNotifications();
}

const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function renderPagination(elementId, target, total, currentPage) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, currentPage), pageCount);
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);
  $(`#${elementId}`).innerHTML = `
    <span>Mostrando ${first}-${last} de ${total} registros</span>
    <div class="pagination-controls">
      <button type="button" class="btn btn-ghost" data-page-target="${target}" data-page-direction="-1" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
      <button type="button" class="btn btn-ghost" data-page-target="${target}" data-page-direction="1" ${page >= pageCount ? 'disabled' : ''}>Siguiente</button>
    </div>`;
  return page;
}

function pageSlice(records, page) {
  return records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

function loanSearchText(loan) {
  return [loan.solicitante, loan.rolSolicitante, loan.equipo, loan.fecha, loan.motivo, loan.estado, loan.id].join(' ');
}

function renderAdminMetrics() {
  if (state.rol !== 'admin') return;
  const overdue = state.prestamos.filter(loan => {
    const dueDate = loan.fechaDevolucionPrevista;
    return loan.estado === 'Entregado' && dueDate && new Date(dueDate).getTime() < Date.now();
  }).length;
  $('#kpiPending').textContent = state.prestamos.filter(loan => loan.estado === 'Pendiente').length;
  $('#kpiBorrowed').textContent = state.prestamos.filter(loan => loan.estado === 'Entregado').length;
  $('#kpiOverdue').textContent = overdue;
  $('#kpiUsers').textContent = state.usuarios.length;
}

function renderCatalog() {
  const q = $('#buscar').value.toLowerCase();
  const items = state.equipos.filter(e => e.stock > 0 && e.estado !== 'Baja' && (e.nombre + e.categoria).toLowerCase().includes(q));
  $('#catalogGrid').innerHTML = items.length ? items.map(e => `
    <article class="card">
      <span class="card-cat">${esc(e.categoria)}</span>
      <h3>${esc(e.nombre)}</h3>
      <span class="muted">${esc(e.responsable)}</span>
      ${availabilityBadge(e.stock)}
      <button class="btn btn-primary" data-loan="${e.id}">Solicitar</button>
    </article>`).join('') : '<p class="empty">No hay equipos disponibles con esa búsqueda.</p>';
}

function renderMine() {
  const statusMatch = {
    active: loan => ['Pendiente', 'Aprobado', 'Entregado'].includes(loan.estado),
    returned: loan => loan.estado === 'Devuelto',
    rejected: loan => loan.estado === 'Rechazado'
  }[adminTables.myLoansStatus];
  const mine = state.prestamos.filter(loan =>
    Number(loan.idUsuario) === Number(state.user.idUsuario) && statusMatch(loan)
  );
  $('#myLoans').innerHTML = mine.length ? mine.map(p => `
    <tr>
      <td>${esc(p.equipo)}</td><td>${fmt(p.fecha)}</td><td>${esc(p.motivo)}</td><td>${badge(p.estado)}</td>
      <td class="actions">${p.estado === 'Pendiente' ? `<button class="icon-btn" type="button" data-loan-edit="${p.id}" aria-label="Editar solicitud" title="Editar"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>` : '—'}</td>
    </tr>`).join('')
    : emptyRow(5, {
      active: 'No tienes solicitudes activas o pendientes.',
      returned: 'No tienes solicitudes finalizadas.',
      rejected: 'No tienes solicitudes rechazadas.'
    }[adminTables.myLoansStatus]);
}

function renderPending() {
  const query = normalizeSearch(adminTables.pendingSearch);
  const filtered = state.prestamos.filter(loan => loan.estado === 'Pendiente' && normalizeSearch(loanSearchText(loan)).includes(query));
  adminTables.pendingPage = renderPagination('pendingPager', 'pending', filtered.length, adminTables.pendingPage);
  const list = pageSlice(filtered, adminTables.pendingPage);
  $('#pendingLoans').innerHTML = list.length ? list.map(loan => `
    <tr>
      <td>${esc(loan.solicitante)}</td>
      <td>${esc(({ alumno: 'Alumno', docente: 'Docente', admin: 'Administrador' })[String(loan.rolSolicitante ?? '').toLowerCase()] || loan.rolSolicitante || 'No especificado')}</td>
      <td>${esc(loan.equipo)}</td>
      <td>${fmt(loan.fecha)}</td>
      <td>${esc(loan.motivo)}</td>
      <td>${badge(loan.estado)}</td>
      <td class="actions">
        <button class="icon-btn success" type="button" data-estado="Aprobado" data-id="${loan.id}" aria-label="Aprobar solicitud" title="Aprobar"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
        <button class="icon-btn danger" type="button" data-estado="Rechazado" data-id="${loan.id}" aria-label="Rechazar solicitud" title="Rechazar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        <button class="icon-btn" type="button" data-loan-detail="${loan.id}" aria-label="Ver detalle de solicitud" title="Ver detalle"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
      </td>
    </tr>`).join('') : emptyRow(7, query ? 'No se encontraron solicitudes.' : 'No hay solicitudes pendientes.');
}

function renderCompleted() {
  const query = normalizeSearch(adminTables.completedSearch);
  const statusMatch = {
    active: loan => ['Aprobado', 'Entregado'].includes(loan.estado),
    returned: loan => loan.estado === 'Devuelto',
    rejected: loan => loan.estado === 'Rechazado'
  }[adminTables.completedStatus];
  const filtered = state.prestamos.filter(loan => statusMatch(loan) && normalizeSearch(loanSearchText(loan)).includes(query));
  adminTables.completedPage = renderPagination('completedPager', 'completed', filtered.length, adminTables.completedPage);
  const list = pageSlice(filtered, adminTables.completedPage);
  $('#completedLoans').innerHTML = list.length ? list.map(loan => `
    <tr>
      <td>${esc(loan.solicitante)}</td>
      <td>${esc(({ alumno: 'Alumno', docente: 'Docente', admin: 'Administrador' })[String(loan.rolSolicitante ?? '').toLowerCase()] || loan.rolSolicitante || 'No especificado')}</td>
      <td>${esc(loan.equipo)}</td>
      <td>${fmt(loan.fecha)}</td>
      <td>${esc(loan.motivo)}</td>
      <td>${badge(loan.estado)}</td>
      <td class="actions">
        ${loan.estado === 'Aprobado' ? `<button class="icon-btn success" type="button" data-estado="Entregado" data-id="${loan.id}" aria-label="Marcar como entregado" title="Marcar entregado"><i class="fa-solid fa-box-open" aria-hidden="true"></i></button>` : ''}
        ${loan.estado === 'Entregado' ? `<button class="icon-btn success" type="button" data-estado="Devuelto" data-id="${loan.id}" aria-label="Registrar devolución" title="Registrar devolución"><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i></button>` : ''}
        <button class="icon-btn" type="button" data-loan-detail="${loan.id}" aria-label="Ver detalle de solicitud" title="Ver detalle"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
      </td>
    </tr>`).join('') : emptyRow(7, query ? 'No se encontraron solicitudes.' : 'No hay solicitudes en seguimiento.');
}

function renderInventory() {
  $('#inventory').innerHTML = state.equipos.map(e => `
    <tr><td>${esc(e.nombre)}</td><td>${esc(e.categoria)}</td><td>${availabilityBadge(e.stock)}</td><td>${badge(e.estado)}</td><td>${esc(e.responsable)}</td>
    <td class="actions">
      <button class="icon-btn" type="button" data-edit="${e.id}" aria-label="Editar equipo" title="Editar"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>
      ${e.estado !== 'Disponible' || e.stock <= 0 ? `<button class="btn btn-primary btn-sm" data-disponible="${e.id}">Poner disponible</button>` : ''}
    </td></tr>`).join('');
}

async function loadUsers() {
  if (state.rol !== 'admin') return;
  state.usuarios = await api.getUsuarios();
  renderUsers();
  renderAdminMetrics();
}

function renderUsers() {
  const query = normalizeSearch(adminTables.usersSearch);
  const filtered = state.usuarios.filter(user => {
    const role = roleFrom(user.rol, '');
    const matchesRole = adminTables.usersRole === 'todos' || role === adminTables.usersRole;
    const matchesQuery = normalizeSearch([user.nombreCompleto, user.correo, user.rol, user.telefono, user.idUsuario].join(' ')).includes(query);
    return matchesRole && matchesQuery;
  });
  adminTables.usersPage = renderPagination('usersPager', 'users', filtered.length, adminTables.usersPage);
  const list = pageSlice(filtered, adminTables.usersPage);
  $('#users').innerHTML = list.length ? list.map(user => `
    <tr>
      <td>${esc(user.nombreCompleto)}</td>
      <td>${esc(user.correo)}</td>
      <td>${badge(user.rol)}</td>
      <td>${esc(user.telefono)}</td>
      <td class="actions">
        <button class="icon-btn" type="button" data-user-edit="${user.idUsuario}" aria-label="Editar usuario" title="Editar"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></button>
        <button class="icon-btn" type="button" data-user-detail="${user.idUsuario}" aria-label="Ver detalle de usuario" title="Ver detalle"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
        <button class="icon-btn danger" type="button" data-user-delete="${user.idUsuario}" aria-label="Eliminar usuario" title="Eliminar"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </td>
    </tr>`).join('') : emptyRow(5, 'No hay usuarios registrados.');
}

function showUserDetails(user) {
  $('#detailTitle').textContent = 'Detalle del usuario';
  $('#detailContent').innerHTML = `
    <dl class="detail-field"><dt>Nombre completo</dt><dd>${esc(user.nombreCompleto || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Correo</dt><dd>${esc(user.correo || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Rol</dt><dd>${badge(user.rol || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Teléfono</dt><dd>${esc(user.telefono || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>ID de usuario</dt><dd>${esc(user.idUsuario)}</dd></dl>`;
  $('#detailDialog').showModal();
}

function showLoanDetails(loan) {
  $('#detailTitle').textContent = 'Detalle de la solicitud';
  const finalizationLabel = loan.estado === 'Rechazado'
    ? 'Fecha de rechazo'
    : loan.estado === 'Entregado'
      ? 'Fecha de entrega'
      : 'Fecha de finalización';
  const finalizationDate = loan.fechaFinalizacion ? fmt(loan.fechaFinalizacion) : 'No registrada';
  $('#detailContent').innerHTML = `
    <dl class="detail-field"><dt>Solicitante</dt><dd>${esc(loan.solicitante || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Rol</dt><dd>${esc(loan.rolSolicitante || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Equipo</dt><dd>${esc(loan.equipo || 'Sin especificar')}</dd></dl>
    <dl class="detail-field"><dt>Fecha y hora</dt><dd>${esc(fmt(loan.fecha))}</dd></dl>
    <dl class="detail-field"><dt>Estado</dt><dd>${badge(loan.estado)}</dd></dl>
    <dl class="detail-field"><dt>ID de solicitud</dt><dd>${esc(loan.id)}</dd></dl>
    ${['Entregado', 'Devuelto', 'Rechazado'].includes(loan.estado) ? `<dl class="detail-field wide"><dt>${finalizationLabel}</dt><dd>${esc(finalizationDate)}</dd></dl>` : ''}
    <dl class="detail-field wide"><dt>Motivo</dt><dd>${esc(loan.motivo || 'Sin especificar')}</dd></dl>`;
  $('#detailDialog').showModal();
}

async function deleteLoan(id, closeEditDialog = false) {
  const loan = state.prestamos.find(item => Number(item.id) === id);
  const canManage = state.rol === 'admin' || Number(loan?.idUsuario) === Number(state.user.idUsuario);
  if (!loan || !canManage || loan.estado !== 'Pendiente') {
    return toast('Solo se pueden eliminar solicitudes pendientes.');
  }
  if (!confirm('¿Eliminar esta solicitud pendiente? Esta acción no se puede deshacer.')) return;
  try {
    await api.eliminarPrestamo(id);
    if (closeEditDialog) $('#editLoanDialog').close();
    toast('Solicitud eliminada');
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- Acciones ---------- */
async function onClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.hasAttribute('data-theme-toggle')) {
    const dark = document.body.dataset.theme !== 'dark';
    localStorage.setItem('prestatec-theme', dark ? 'dark' : 'light');
    setDashboardTheme(dark);
    return;
  }
  if (t.hasAttribute('data-notifications')) {
    showView(state.rol === 'admin' ? 'solicitudes' : 'mis');
    return;
  }
  if (t.dataset.userRole) {
    adminTables.usersRole = t.dataset.userRole;
    adminTables.usersPage = 1;
    document.querySelectorAll('[data-user-role]').forEach(button => {
      const active = button.dataset.userRole === adminTables.usersRole;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderUsers();
    return;
  }
  if (t.dataset.loanStatus) {
    adminTables.completedStatus = t.dataset.loanStatus;
    adminTables.completedPage = 1;
    document.querySelectorAll('[data-loan-status]').forEach(button => {
      const active = button.dataset.loanStatus === adminTables.completedStatus;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderCompleted();
    return;
  }
  if (t.dataset.myLoanStatus) {
    adminTables.myLoansStatus = t.dataset.myLoanStatus;
    document.querySelectorAll('[data-my-loan-status]').forEach(button => {
      const active = button.dataset.myLoanStatus === adminTables.myLoansStatus;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderMine();
    return;
  }
  if (t.dataset.pageTarget) {
    const pageKeys = { pending: 'pendingPage', completed: 'completedPage', users: 'usersPage' };
    const pageKey = pageKeys[t.dataset.pageTarget];
    if (!pageKey) return;
    adminTables[pageKey] += Number(t.dataset.pageDirection);
    ({ pending: renderPending, completed: renderCompleted, users: renderUsers })[t.dataset.pageTarget]();
    return;
  }
  if (t.dataset.view) {
    showView(t.dataset.view);
    if (t.dataset.view === 'usuarios') {
      try {
        await loadUsers();
      } catch (error) {
        $('#users').innerHTML = emptyRow(5, 'No se pudieron cargar los usuarios.');
        toast(error.message);
      }
    }
    return;
  }
  if (t.dataset.loan !== undefined) return openLoan(t.dataset.loan);
  if (t.dataset.loanEdit) {
    const loan = state.prestamos.find(item => Number(item.id) === Number(t.dataset.loanEdit));
    const canManage = state.rol === 'admin' || Number(loan?.idUsuario) === Number(state.user.idUsuario);
    if (loan && canManage && loan.estado === 'Pendiente') {
      openEditLoan(loan);
    }
    return;
  }
  if (t.dataset.loanDetail) {
    const loan = state.prestamos.find(item => Number(item.id) === Number(t.dataset.loanDetail));
    if (loan) showLoanDetails(loan);
    return;
  }
  if (t.dataset.loanDeleteId) return deleteLoan(Number(t.dataset.loanDeleteId));
  if (t.hasAttribute('data-loan-delete')) {
    const id = Number($('#editLoanId').value);
    return deleteLoan(id, true);
  }
  if (t.hasAttribute('data-clear-finalized')) {
    const total = state.prestamos.filter(p => p.estado === 'Devuelto').length;
    if (!total) return toast('No hay préstamos finalizados para limpiar.');
    if (!confirm(`¿Eliminar permanentemente los ${total} préstamos finalizados? Esta acción no se puede deshacer.`)) return;
    try {
      await api.eliminarFinalizados();
      toast('Préstamos finalizados eliminados');
      await refresh();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (t.dataset.estado) {
    try {
      await api.cambiarEstado(+t.dataset.id, t.dataset.estado);
      toast(`Solicitud ${t.dataset.estado.toLowerCase()}`);
      return await refresh();
    } catch (error) {
      return toast(error.message);
    }
  }
  if (t.dataset.disponible) {
    const equipo = state.equipos.find(item => item.id === +t.dataset.disponible);
    await api.actualizarEquipo(+t.dataset.disponible, { estado: 'Disponible', stock: Math.max(1, equipo.stock) });
    toast('Equipo disponible'); return refresh();
  }
  if (t.dataset.userEdit) {
    const user = state.usuarios.find(item => Number(item.idUsuario) === Number(t.dataset.userEdit));
    if (user) openUser(user);
    return;
  }
  if (t.dataset.userDetail) {
    const user = state.usuarios.find(item => Number(item.idUsuario) === Number(t.dataset.userDetail));
    if (user) showUserDetails(user);
    return;
  }
  if (t.dataset.userDelete) {
    const id = Number(t.dataset.userDelete);
    const user = state.usuarios.find(item => Number(item.idUsuario) === id);
    if (!user || !confirm(`¿Eliminar permanentemente a ${user.nombreCompleto}? Esta acción no se puede deshacer.`)) return;
    try {
      await api.eliminarUsuario(id);
      $('#userDialog').close();
      toast('Usuario eliminado');
      await loadUsers();
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (t.dataset.edit) return openEquipo(state.equipos.find(x => x.id === +t.dataset.edit));
  if (t.hasAttribute('data-baja')) {
    const id = +$('#eqId').value;
    if (!id || !confirm('¿Dar de baja este equipo?')) return;
    try {
      await api.actualizarEquipo(id, { estado: 'Baja' });
      $('#equipoDialog').close();
      toast('Equipo dado de baja');
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }
}

function openLoan(equipoId) {
  const select = $('#loanEquipo');
  select.innerHTML = state.equipos
    .filter(e => e.estado !== 'Baja')
    .map(e => `<option value="${e.id}" ${e.stock <= 0 ? 'disabled' : ''}>${esc(e.nombre)}${e.stock <= 0 ? ' (Agotado)' : ` (${e.stock} disponibles)`}</option>`)
    .join('');
  $('#loanSolicitante').value = state.user.nombreCompleto || state.user.correo;
  if (equipoId && state.equipos.find(e => e.id === +equipoId && e.stock > 0)) select.value = equipoId;
  select.disabled = !state.equipos.some(e => e.estado !== 'Baja' && e.stock > 0);
  $('#loanDialog').showModal();
}

function openEditLoan(loan) {
  const select = $('#editLoanEquipo');
  select.innerHTML = state.equipos
    .filter(item => Number(item.id) === Number(loan.equipoId) || (item.estado !== 'Baja' && item.stock > 0))
    .map(item => `<option value="${item.id}">${esc(item.nombre)}${item.estado === 'Baja' ? ' (Baja)' : item.stock <= 0 ? ' (Sin disponibilidad actual)' : ''}</option>`)
    .join('');
  $('#editLoanId').value = loan.id;
  select.value = loan.equipoId;
  $('#editLoanSolicitante').value = loan.solicitante || '';
  $('#editLoanFecha').value = String(loan.fecha || '').replace(' ', 'T').slice(0, 16);
  $('#editLoanMotivo').value = loan.motivo || '';
  $('#editLoanDialog').showModal();
}

async function submitEditLoan(e) {
  e.preventDefault();
  const id = Number($('#editLoanId').value);
  const equipoId = Number($('#editLoanEquipo').value);
  const equipo = state.equipos.find(item => Number(item.id) === equipoId);
  if (!equipo) return toast('Selecciona un equipo válido.');
  if (equipo.stock <= 0 && equipoId !== Number(state.prestamos.find(item => Number(item.id) === id)?.equipoId)) {
    return toast('El equipo seleccionado ya no está disponible.');
  }

  try {
    await api.actualizarPrestamo(id, {
      equipoId,
      solicitante: $('#editLoanSolicitante').value.trim(),
      fecha: $('#editLoanFecha').value,
      motivo: $('#editLoanMotivo').value.trim()
    });
    $('#editLoanDialog').close();
    toast('Solicitud actualizada');
    await refresh();
  } catch (error) {
    toast(error.message);
  }
}

async function submitLoan(e) {
  e.preventDefault();
  const id = +$('#loanEquipo').value;
  if (!id) return;
  const equipo = state.equipos.find(item => item.id === id);
  if (!equipo || equipo.stock <= 0 || equipo.estado === 'Baja') return toast('El equipo seleccionado ya no está disponible.');
  try {
    await api.crearPrestamo({
      equipoId: id,
      idUsuario: state.user.idUsuario,
      equipo: equipo.nombre,
      solicitante: $('#loanSolicitante').value.trim(),
      rolSolicitante: ({ admin: 'Admin', alumno: 'Alumno', docente: 'Docente' })[state.rol],
      fecha: $('#loanFecha').value,
      motivo: $('#loanMotivo').value.trim()
    });
    $('#loanForm').reset();
    $('#loanDialog').close();
    toast('Solicitud enviada');
    await refresh();
    showView('mis');
  } catch (error) {
    toast(error.message);
  }
}

function openEquipo(eq) {
  $('#equipoTitle').textContent = eq ? 'Editar equipo' : 'Dar de alta equipo';
  $('#eqId').value = eq?.id ?? '';
  $('#eqNombre').value = eq?.nombre ?? '';
  $('#eqCategoria').value = eq?.categoria ?? 'Laptop';
  $('#eqEstado').value = eq?.estado ?? 'Disponible';
  $('#eqResp').value = eq?.responsable ?? '';
  $('#eqStock').value = eq?.stock ?? 1;
  $('#retireEquipo').hidden = !eq || eq.estado === 'Baja';
  $('#equipoDialog').showModal();
}

function openUser(user) {
  $('#userId').value = user.idUsuario;
  $('#deleteUser').dataset.userDelete = user.idUsuario;
  $('#userNombre').value = user.nombreCompleto || '';
  $('#userCorreo').value = user.correo || '';
  const role = String(user.rol || '').toLowerCase();
  $('#userRol').value = role.includes('admin') ? 'Admin' : role.includes('docente') ? 'Docente' : 'Alumno';
  $('#userTelefono').value = user.telefono || '';
  $('#userPassword').value = '';
  $('#userDialog').showModal();
}

async function submitUser(e) {
  e.preventDefault();
  const id = Number($('#userId').value);
  const usuario = {
    nombreCompleto: $('#userNombre').value.trim(),
    correo: $('#userCorreo').value.trim(),
    password: $('#userPassword').value || null,
    rol: $('#userRol').value,
    telefono: $('#userTelefono').value.trim()
  };

  try {
    await api.actualizarUsuario(id, usuario);
    $('#userDialog').close();
    toast('Usuario actualizado');
    await loadUsers();
  } catch (error) {
    toast(error.message);
  }
}

async function submitEquipo() {
  const data = { nombre: $('#eqNombre').value.trim(), categoria: $('#eqCategoria').value, estado: $('#eqEstado').value, responsable: $('#eqResp').value.trim(), stock: Number($('#eqStock').value) };
  const id = $('#eqId').value;
  id ? await api.actualizarEquipo(+id, data) : await api.crearEquipo(data);
  toast('Equipo guardado'); refresh();
}

/* ---------- Arranque ---------- */
document.addEventListener('DOMContentLoaded', () => ($('#loginForm') ? initLogin() : initDashboard()));
