/*
 * Mario vs Donkey Kong: Tipping Stars - Chromium port community client.
 *
 * Adds an online community layer on top of the offline port:
 *  - a profile (a stand-in for the old Miiverse profile: name + photo),
 *  - connecting to a community backend server (see the mvdk-community-server repo),
 *  - a REST client for level sharing / stars / comments (used by the in-game
 *    community screens as they get wired up).
 *
 * The profile/server setup is presented through a game-styled overlay window so
 * it feels native. It is shown:
 *  - automatically when entering Community mode for the first time, and
 *  - on demand from Settings (Ajustes) > "Cuenta / Servidor".
 *
 * Only the profile + server connection are required for now; the REST helpers
 * below are ready for the level browser/upload UI.
 */
(function (global) {
    "use strict";

    if (global.ChromiumPortCommunity) return;

    var STORAGE_KEY = "mvdk_community_profile";
    var OVERLAY_ID = "chromium-port-community-overlay";

    // ---------------------------------------------------------- state ----
    var state = load();

    function load() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { server: "", name: "", avatar: "", id: "", token: "", serverName: "" };
    }
    function save() {
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function hasProfile() { return !!(state.id && state.token); }
    function hasServer() { return !!state.server; }
    function isReady() { return hasProfile() && hasServer(); }

    // ----------------------------------------------------- rest client ----
    function base() { return (state.server || "").replace(/\/+$/, ""); }

    function apiFetch(path, opts) {
        opts = opts || {};
        var headers = opts.headers || {};
        if (state.token) headers["Authorization"] = "Bearer " + state.token;
        if (opts.body && typeof opts.body === "object") {
            headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(opts.body);
        }
        opts.headers = headers;
        return fetch(base() + path, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
                return j;
            });
        });
    }

    // Connectivity check against an arbitrary server URL.
    function pingServer(url) {
        var b = (url || "").replace(/\/+$/, "");
        return fetch(b + "/api/info").then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
    }

    function createOrUpdateProfile(name, avatarDataUrl) {
        if (hasProfile()) {
            return apiFetch("/api/users/me", { method: "PUT", body: { name: name, avatar: avatarDataUrl || undefined } })
                .then(function (u) { state.name = u.name; if (avatarDataUrl) state.avatar = avatarDataUrl; save(); return u; });
        }
        return apiFetch("/api/users", { method: "POST", body: { name: name, avatar: avatarDataUrl || undefined } })
            .then(function (u) {
                state.id = u.id; state.token = u.token; state.name = u.name;
                if (avatarDataUrl) state.avatar = avatarDataUrl;
                save(); return u;
            });
    }

    // Public REST helpers for the community screens (ready for later wiring).
    var rest = {
        listLevels: function (q) { return apiFetch("/api/levels" + (q ? "?" + q : "")); },
        getLevel: function (id) { return apiFetch("/api/levels/" + id); },
        uploadLevel: function (title, data, thumbnail) { return apiFetch("/api/levels", { method: "POST", body: { title: title, data: data, thumbnail: thumbnail } }); },
        starLevel: function (id) { return apiFetch("/api/levels/" + id + "/star", { method: "POST" }); },
        getComments: function (id) { return apiFetch("/api/levels/" + id + "/comments"); },
        addComment: function (id, text) { return apiFetch("/api/levels/" + id + "/comments", { method: "POST", body: { text: text } }); }
    };

    // ------------------------------------------------ image downscaling ----
    function fileToAvatar(file, cb) {
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var size = 128;
                var c = document.createElement("canvas");
                c.width = c.height = size;
                var ctx = c.getContext("2d");
                // cover-crop to a square
                var s = Math.min(img.width, img.height);
                ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
                cb(c.toDataURL("image/png"));
            };
            img.onerror = function () { cb(""); };
            img.src = reader.result;
        };
        reader.onerror = function () { cb(""); };
        reader.readAsDataURL(file);
    }

    // -------------------------------------------------------- overlay ----
    function injectStyles() {
        if (document.getElementById("chromium-port-community-style")) return;
        var css = document.createElement("style");
        css.id = "chromium-port-community-style";
        css.textContent =
            "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
            "background:rgba(4,28,60,.55);font-family:Arial,Helvetica,sans-serif;}" +
            "#" + OVERLAY_ID + " .cw-box{width:min(520px,92vw);max-height:92vh;overflow:auto;border-radius:18px;" +
            "background:linear-gradient(180deg,#5eb6ff 0%,#90dcff 45%,#65b7ec 100%);" +
            "box-shadow:0 18px 60px rgba(0,0,0,.5);border:4px solid rgba(255,255,255,.7);padding:0;}" +
            "#" + OVERLAY_ID + " .cw-head{display:flex;align-items:center;justify-content:center;position:relative;" +
            "padding:14px 16px;color:#fff;font-weight:900;font-size:24px;text-shadow:0 2px 0 rgba(3,58,120,.9);}" +
            "#" + OVERLAY_ID + " .cw-x{position:absolute;right:12px;top:10px;width:34px;height:34px;border-radius:50%;" +
            "border:2px solid rgba(255,255,255,.8);background:rgba(0,47,108,.5);color:#fff;font-weight:900;cursor:pointer;}" +
            "#" + OVERLAY_ID + " .cw-body{padding:6px 22px 22px;}" +
            "#" + OVERLAY_ID + " .cw-card{background:rgba(255,255,255,.92);border-radius:14px;padding:16px;margin-bottom:14px;}" +
            "#" + OVERLAY_ID + " .cw-card h3{margin:0 0 10px;font-size:15px;color:#0a4c93;letter-spacing:.3px;}" +
            "#" + OVERLAY_ID + " label{display:block;font-size:12px;font-weight:700;color:#37475f;margin:8px 0 4px;}" +
            "#" + OVERLAY_ID + " input[type=text]{width:100%;padding:10px 12px;border:2px solid #b9c8de;border-radius:10px;font-size:15px;}" +
            "#" + OVERLAY_ID + " .cw-row{display:flex;gap:14px;align-items:center;}" +
            "#" + OVERLAY_ID + " .cw-ava{width:84px;height:84px;border-radius:14px;object-fit:cover;background:#dfe8f5;border:2px solid #b9c8de;flex:0 0 auto;}" +
            "#" + OVERLAY_ID + " .cw-btn{display:inline-block;border:0;border-radius:999px;padding:10px 18px;font-weight:800;font-size:15px;cursor:pointer;color:#1a1300;" +
            "background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);box-shadow:0 3px 0 rgba(160,90,0,.6);}" +
            "#" + OVERLAY_ID + " .cw-btn:disabled{filter:grayscale(.6);opacity:.6;cursor:default;}" +
            "#" + OVERLAY_ID + " .cw-btn.cw-sec{background:#e8eef7;color:#234;box-shadow:0 3px 0 rgba(120,140,170,.5);}" +
            "#" + OVERLAY_ID + " .cw-status{font-size:13px;font-weight:700;margin-top:8px;min-height:18px;}" +
            "#" + OVERLAY_ID + " .cw-ok{color:#1d7a33;} #" + OVERLAY_ID + " .cw-err{color:#c0263a;}" +
            "#" + OVERLAY_ID + " .cw-foot{display:flex;justify-content:flex-end;gap:10px;}" +
            "#" + OVERLAY_ID + " .cw-hint{color:#37475f;font-size:12px;margin:2px 0 10px;}";
        document.head.appendChild(css);
    }

    var pendingAvatar = "";

    function close() {
        var el = document.getElementById(OVERLAY_ID);
        if (el) el.parentNode.removeChild(el);
    }

    function open(onReady) {
        injectStyles();
        close();
        pendingAvatar = state.avatar || "";

        var editing = hasProfile();
        var overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.innerHTML =
            '<div class="cw-box" role="dialog" aria-modal="true">' +
              '<div class="cw-head">Comunidad<button class="cw-x" title="Cerrar">&times;</button></div>' +
              '<div class="cw-body">' +
                '<div class="cw-card">' +
                  '<h3>SERVIDOR</h3>' +
                  '<div class="cw-hint">Conéctate al servidor de la comunidad para compartir y descargar niveles.</div>' +
                  '<label>Dirección del servidor</label>' +
                  '<input type="text" id="cw-server" placeholder="http://127.0.0.1:8080" />' +
                  '<div class="cw-foot" style="margin-top:10px;justify-content:flex-start">' +
                    '<button class="cw-btn cw-sec" id="cw-connect">Conectar</button></div>' +
                  '<div class="cw-status" id="cw-server-status"></div>' +
                '</div>' +
                '<div class="cw-card">' +
                  '<h3>PERFIL</h3>' +
                  '<div class="cw-row">' +
                    '<img class="cw-ava" id="cw-ava" alt="" />' +
                    '<div style="flex:1">' +
                      '<label>Nombre</label>' +
                      '<input type="text" id="cw-name" maxlength="32" placeholder="Tu nombre" />' +
                      '<div style="margin-top:10px"><button class="cw-btn cw-sec" id="cw-photo">Elegir foto</button>' +
                      '<input type="file" id="cw-file" accept="image/*" style="display:none" /></div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cw-status" id="cw-profile-status"></div>' +
                '</div>' +
                '<div class="cw-foot">' +
                  '<button class="cw-btn cw-sec" id="cw-cancel">Cancelar</button>' +
                  '<button class="cw-btn" id="cw-save">' + (editing ? "Guardar" : "Crear perfil") + '</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var $ = function (id) { return document.getElementById(id); };
        $("cw-server").value = state.server || "";
        $("cw-name").value = state.name || "";
        updateAva();

        function updateAva() {
            var a = $("cw-ava");
            if (pendingAvatar) { a.src = pendingAvatar; a.style.visibility = "visible"; }
            else { a.removeAttribute("src"); }
        }
        function setStatus(id, msg, ok) {
            var s = $(id); s.textContent = msg || ""; s.className = "cw-status " + (msg ? (ok ? "cw-ok" : "cw-err") : "");
        }

        var serverOk = hasServer();
        if (serverOk) setStatus("cw-server-status", "Conectado: " + (state.serverName || state.server), true);

        $("cw-connect").onclick = function () {
            var url = $("cw-server").value.trim();
            if (!url) { setStatus("cw-server-status", "Introduce una dirección.", false); return; }
            if (!/^https?:\/\//i.test(url)) url = "http://" + url;
            setStatus("cw-server-status", "Conectando…", true);
            pingServer(url).then(function (info) {
                state.server = url; state.serverName = info.name || url; save();
                serverOk = true;
                setStatus("cw-server-status", "Conectado a “" + state.serverName + "”.", true);
            }).catch(function (e) {
                serverOk = false;
                setStatus("cw-server-status", "No se pudo conectar: " + e.message, false);
            });
        };

        $("cw-photo").onclick = function () { $("cw-file").click(); };
        $("cw-file").onchange = function () {
            var f = this.files && this.files[0];
            if (!f) return;
            fileToAvatar(f, function (dataUrl) { pendingAvatar = dataUrl; updateAva(); });
        };

        $("cw-save").onclick = function () {
            var name = $("cw-name").value.trim();
            if (!serverOk) { setStatus("cw-server-status", "Conéctate a un servidor primero.", false); return; }
            if (!name) { setStatus("cw-profile-status", "Escribe un nombre.", false); return; }
            $("cw-save").disabled = true;
            setStatus("cw-profile-status", "Guardando…", true);
            createOrUpdateProfile(name, pendingAvatar).then(function () {
                setStatus("cw-profile-status", "¡Perfil guardado!", true);
                global.setTimeout(function () {
                    close();
                    if (typeof onReady === "function" && isReady()) onReady();
                }, 500);
            }).catch(function (e) {
                $("cw-save").disabled = false;
                setStatus("cw-profile-status", "Error: " + e.message, false);
            });
        };

        var doClose = function () { close(); };
        overlay.querySelector(".cw-x").onclick = doClose;
        $("cw-cancel").onclick = doClose;
    }

    function requireSetup(onReady) { open(onReady); }

    // ------------------------------------------ Settings integration ----
    // Inject a "Cuenta / Servidor" button into the port's Settings panel
    // whenever it appears, so the profile/server can be managed from Ajustes too.
    function injectSettingsButton(panel) {
        if (!panel || panel.querySelector(".cw-settings-entry")) return;
        var wrap = document.createElement("div");
        wrap.className = "cw-settings-entry";
        wrap.style.cssText = "margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.25);text-align:center;";
        var btn = document.createElement("button");
        btn.textContent = "Cuenta / Servidor";
        btn.style.cssText = "border:0;border-radius:999px;padding:9px 16px;font-weight:800;cursor:pointer;color:#1a1300;" +
            "background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);box-shadow:0 3px 0 rgba(160,90,0,.6);";
        btn.onclick = function () { open(); };
        wrap.appendChild(btn);
        panel.appendChild(wrap);
    }

    function watchSettings() {
        var PANEL_ID = "chromium-port-settings-panel";
        try {
            var obs = new MutationObserver(function () {
                var p = document.getElementById(PANEL_ID);
                if (p) injectSettingsButton(p);
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
        // also try immediately / periodically as a fallback
        global.setInterval(function () {
            var p = document.getElementById(PANEL_ID);
            if (p) injectSettingsButton(p);
        }, 1000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", watchSettings);
    } else {
        watchSettings();
    }

    // ------------------------------------------------------- exports ----
    global.ChromiumPortCommunity = {
        isReady: isReady,
        hasProfile: hasProfile,
        hasServer: hasServer,
        requireSetup: requireSetup,
        open: open,
        getProfile: function () { return { id: state.id, name: state.name, avatar: state.avatar, server: state.server, serverName: state.serverName }; },
        pingServer: pingServer,
        rest: rest
    };
}(window));
