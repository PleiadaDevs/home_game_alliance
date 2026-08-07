/* ══════════════════════════════════════════════════════════════════════════
   ga-auth.js — sesión, cliente de la Lambda y login por modal.
   Compartido por /dashboard y /profile. Cargar con:

       <link rel="stylesheet" href="/ga-auth.css?v=1">
       <script src="/ga-auth.js?v=1"></script>

   (el ?v= es para bustear la caché de GitHub Pages al deployar)

   La página tiene que:
     1. tener un <span id="ga-auth"></span> en el header
     2. llamar a GA.init({ reset, load, render }) antes de su propio init

   Todo corre dentro de un IIFE a propósito: las páginas declaran sus propios
   `const esc`, `const state`, etc. en el scope global, y dos `const` con el
   mismo nombre en el mismo scope es un SyntaxError que rompe la página entera.
   Acá afuera solo salen `window.gaAuth`, `window.auth` y `window.GA`.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

var API = "https://hdk2i43wuiw3272mtnjgwwsaby0bkood.lambda-url.sa-east-1.on.aws/";
var CK_TOKEN = "ga_session", CK_EMAIL = "ga_email", CK_NAME = "ga_name";

var esc = function (s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
};

// ── Cookies ─────────────────────────────────────────────────────────────────
function ckDomain() {
  return location.hostname.endsWith("gameplayalliance.gg") ? "; domain=.gameplayalliance.gg" : "";
}
function ckSet(n, v, days) {
  var e = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = n + "=" + encodeURIComponent(v) + "; expires=" + e +
    "; path=/" + ckDomain() + "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
}
function ckGet(n) {
  return document.cookie.split("; ").reduce(function (a, c) {
    var i = c.indexOf("=");
    return c.slice(0, i) === n ? decodeURIComponent(c.slice(i + 1)) : a;
  }, "");
}
// Se borra en las DOS variantes: con `domain=.gameplayalliance.gg` y host-only.
// Si alguna vez quedó una cookie escrita sin el domain (versiones viejas del
// site), borrar solo una deja la otra viva y ckGet —que se queda con la ÚLTIMA
// coincidencia— sigue leyendo la sesión anterior. Es barato cubrir las dos.
function ckDel(n) {
  var base = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  document.cookie = base;
  if (ckDomain()) document.cookie = base + ckDomain();
}

// ── Hooks de la página ──────────────────────────────────────────────────────
// `reset` es obligatorio y es lo que evita que queden datos del usuario
// anterior: se llama SIEMPRE que cambia la sesión, antes de recargar nada.
var hooks = { reset: null, load: null, render: null };

async function sessionChanged(recargar) {
  if (hooks.reset) hooks.reset();
  if (recargar && hooks.load) await hooks.load();
  if (hooks.render) hooks.render();
}

// ── API ─────────────────────────────────────────────────────────────────────
async function api(action, payload) {
  var res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });
  } catch (e) {
    return { ok: false, status: 0, data: { error: "No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo." } };
  }
  var data = {};
  try { data = await res.json(); } catch (e) {}
  // Sesión vencida (dura 30 días): se limpia y se vuelve a pedir login en el
  // acto, en vez de dejar la pantalla a medio cargar sin explicación.
  if (res.status === 401 && action !== "verify_otp") {
    await auth.logout(false);
    gaAuth.open();
  }
  return { ok: res.ok, status: res.status, data: data };
}

// ── Sesión ──────────────────────────────────────────────────────────────────
var auth = {
  token: function () { return ckGet(CK_TOKEN); },
  email: function () { return ckGet(CK_EMAIL); },
  name:  function () { return ckGet(CK_NAME); },
  setName: function (n) { ckSet(CK_NAME, n || "", 30); },
  async logout(render) {
    ckDel(CK_TOKEN); ckDel(CK_EMAIL); ckDel(CK_NAME);
    gaAuth._email = "";
    // Sin recargar: no hay sesión, no hay nada que pedir.
    await sessionChanged(false);
    if (render !== false && hooks.render) hooks.render();
  }
};

// ── Login por modal ─────────────────────────────────────────────────────────
// Un solo modal para todo el site: mail → código → adentro, sin recargar.
var gaAuth = {
  _after: null,
  _email: "",
  open: function (after) {
    this._after = after || null;
    document.getElementById("lg-step-email").style.display = "";
    document.getElementById("lg-step-code").style.display = "none";
    this._err(1, ""); this._err(2, "");
    document.getElementById("login-modal-bg").classList.add("open");
    setTimeout(function () { document.getElementById("lg-email").focus(); }, 60);
  },
  close: function () { document.getElementById("login-modal-bg").classList.remove("open"); },
  back: function () {
    document.getElementById("lg-step-email").style.display = "";
    document.getElementById("lg-step-code").style.display = "none";
    document.getElementById("lg-email").focus();
  },
  _err: function (step, msg) { document.getElementById("lg-err-" + step).textContent = msg || ""; },
  _busy: function (id, on, label) {
    var b = document.getElementById(id); b.disabled = on; if (label) b.textContent = label;
  },

  async requestOtp() {
    var email = (document.getElementById("lg-email").value || "").trim().toLowerCase();
    this._err(1, "");
    if (!email.includes("@") || !email.includes(".")) { this._err(1, "Ingresá un email válido."); return; }
    this._busy("lg-btn-send", true, "Enviando…");
    var r = await api("request_otp", { email: email });
    this._busy("lg-btn-send", false, "Enviar código");
    if (!r.ok) { this._err(1, r.data.message || r.data.error || "No pudimos enviar el código. Probá de nuevo."); return; }
    this._email = email;
    document.getElementById("lg-mail-echo").textContent = email;
    document.getElementById("lg-step-email").style.display = "none";
    document.getElementById("lg-step-code").style.display = "";
    document.getElementById("lg-code").value = "";
    document.getElementById("lg-code").focus();
  },

  async resend() {
    this._busy("lg-btn-resend", true, "Reenviando…");
    var r = await api("request_otp", { email: this._email });
    this._busy("lg-btn-resend", false, "Reenviar código");
    this._err(2, r.ok ? "" : (r.data.message || r.data.error || "No pudimos reenviar el código."));
  },

  async verifyOtp() {
    var code = (document.getElementById("lg-code").value || "").trim();
    this._err(2, "");
    if (code.length < 6) { this._err(2, "El código tiene 6 dígitos."); return; }
    this._busy("lg-btn-verify", true, "Verificando…");
    var r = await api("verify_otp", { email: this._email, code: code });
    this._busy("lg-btn-verify", false, "Ingresar");
    if (!(r.ok && r.data.token)) { this._err(2, r.data.message || r.data.error || "Código incorrecto."); return; }
    // Se limpian ANTES de escribir las nuevas: si el usuario que entra es otro,
    // no puede quedar ni una cookie del anterior.
    ckDel(CK_TOKEN); ckDel(CK_EMAIL); ckDel(CK_NAME);
    ckSet(CK_TOKEN, r.data.token, 30);
    ckSet(CK_EMAIL, r.data.email, 30);
    ckSet(CK_NAME, r.data.nombre || "", 30);
    this.close();
    await sessionChanged(true);
    var cb = this._after; this._after = null; if (cb) cb();
  }
};

// ── Header: uno u otro, nunca los dos ───────────────────────────────────────
// Deslogueado → botón "Ingresar a mi perfil" (abre el modal).
// Logueado    → solo el chip (username + luz verde), y el chip ES el link al
//               perfil. La ✕ cierra sesión sin disparar la navegación.
function renderHeaderAuth() {
  var el = document.getElementById("ga-auth"); if (!el) return;
  var email = auth.email() || "";
  if (auth.token() && email) {
    var uname = (auth.name() || "").trim() || email.split("@")[0];
    var short = uname.length > 16 ? uname.slice(0, 15) + "…" : uname;
    el.innerHTML = '<a class="ga-userchip" href="/profile" title="Ir a mi perfil — ' + esc(email) + '">' +
      '<span class="ga-dot"></span><span class="ga-uname">' + esc(short) + '</span>' +
      '<button class="ga-logout" onclick="event.preventDefault();event.stopPropagation();auth.logout()" aria-label="Cerrar sesión" title="Cerrar sesión">✕</button>' +
      '</a>';
  } else {
    el.innerHTML = '<button class="ga-acceder" onclick="gaAuth.open()">Ingresar a mi perfil</button>';
  }
}

// ── Markup del modal ────────────────────────────────────────────────────────
// Lo inyecta el script para que las dos páginas no tengan que mantener una
// copia del HTML cada una. Usa las primitivas .modal-bg/.modal/.btn/.input,
// que ya existen en ambas.
var MODAL_HTML =
'<div class="modal-bg" id="login-modal-bg">' +
  '<div class="modal card corners">' +
    '<div class="c-bl"></div><div class="c-br"></div>' +
    '<button class="modal-x" onclick="gaAuth.close()" aria-label="Cerrar">✕</button>' +
    '<div id="lg-step-email">' +
      '<div class="eyebrow">Acceso</div>' +
      '<h3>Ingresar al perfil</h3>' +
      '<p class="sub" style="font-size:13.5px;">Ingresá el email con el que te registraste en el programa. Te mandamos un código de acceso.</p>' +
      '<input class="input" type="email" id="lg-email" placeholder="tu@email.com" autocomplete="email" style="margin-top:6px;">' +
      '<div class="modal-err" id="lg-err-1"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn primary" id="lg-btn-send" onclick="gaAuth.requestOtp()">Enviar código</button>' +
      '</div>' +
    '</div>' +
    '<div id="lg-step-code" style="display:none;">' +
      '<div class="eyebrow">Acceso</div>' +
      '<h3>Tu código de acceso</h3>' +
      '<p class="sub" style="font-size:13.5px;">Te mandamos un código de 6 dígitos a <strong style="color:var(--ink)" id="lg-mail-echo"></strong>. Vence en 10 minutos. Revisá también la carpeta de Spam.</p>' +
      '<input class="input lg-code-input" type="text" id="lg-code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" style="margin-top:6px;">' +
      '<div class="modal-err" id="lg-err-2"></div>' +
      '<div class="modal-actions" style="justify-content:space-between;">' +
        '<button class="btn ghost" id="lg-btn-resend" onclick="gaAuth.resend()">Reenviar código</button>' +
        '<div style="display:flex; gap:10px;">' +
          '<button class="btn ghost" onclick="gaAuth.back()">Cambiar email</button>' +
          '<button class="btn primary" id="lg-btn-verify" onclick="gaAuth.verifyOtp()">Ingresar</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>' +
'</div>';

function montar() {
  if (document.getElementById("login-modal-bg")) return;   // idempotente
  var host = document.createElement("div");
  host.innerHTML = MODAL_HTML;
  document.body.appendChild(host.firstChild);

  document.getElementById("login-modal-bg").addEventListener("click", function (e) {
    if (e.target.id === "login-modal-bg") gaAuth.close();
  });
  document.getElementById("lg-email").addEventListener("keydown", function (e) {
    if (e.key === "Enter") gaAuth.requestOtp();
  });
  document.getElementById("lg-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") gaAuth.verifyOtp();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") gaAuth.close();
  });
}

// ── API pública ─────────────────────────────────────────────────────────────
window.auth = auth;
window.gaAuth = gaAuth;
window.GA = {
  API: API,
  api: api,
  auth: auth,
  gaAuth: gaAuth,
  renderHeaderAuth: renderHeaderAuth,
  esc: esc,
  /**
   * reset()  — obligatorio. Limpia TODO el estado del usuario en la página
   *            (datos cargados, formularios en edición, paginados). Se llama
   *            en cada cambio de sesión, login y logout.
   * load()   — async. Trae los datos del usuario que acaba de entrar.
   * render() — repinta.
   */
  init: function (h) {
    hooks.reset = h.reset || null;
    hooks.load = h.load || null;
    hooks.render = h.render || null;
    // Se monta YA si el body existe. Las dos páginas llaman a esto desde un
    // script al final del <body>, donde readyState todavía es "loading": si
    // esperáramos a DOMContentLoaded, un gaAuth.open() inmediato —el de entrar
    // a /profile sin sesión— reventaría contra un modal que no está en el DOM.
    if (document.body) {
      montar();
    } else {
      document.addEventListener("DOMContentLoaded", montar);
    }
  }
};
})();
