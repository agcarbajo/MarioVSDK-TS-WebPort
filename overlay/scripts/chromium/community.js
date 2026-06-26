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
        addComment: function (id, text, stamp, memo) { return apiFetch("/api/levels/" + id + "/comments", { method: "POST", body: { text: text, stamp: stamp, memo: memo || undefined } }); },
        nativeTip: function (id, amount) { return apiFetch("/api/native/levels/" + id + "/tip", { method: "POST", body: { amount: amount } }); },
        nativeDeletePost: function (id) { return apiFetch("/api/native/levels/" + id, { method: "DELETE" }); },
        // Native FishBowl bridge (opaque binary blobs).
        nativeCreatePost: function (payload) { return apiFetch("/api/native/levels", { method: "POST", body: payload }); },
        nativePutDatastore: function (dataID, metaBinaryB64, params) { return apiFetch("/api/native/datastore/" + encodeURIComponent(dataID), { method: "PUT", body: { metaBinary: metaBinaryB64, params: params || undefined } }); },
        nativeListPosts: function (communityType) { return apiFetch("/api/native/levels?community=" + encodeURIComponent(communityType)); },
        nativeGetDatastore: function (dataID) { return apiFetch("/api/native/datastore/" + encodeURIComponent(dataID)); },
        nativeGetLevel: function (id) { return apiFetch("/api/native/levels/" + encodeURIComponent(id)); }
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
            "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:2000000;display:flex;align-items:center;justify-content:center;" +
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
            "#" + OVERLAY_ID + " .cw-hint{color:#37475f;font-size:12px;margin:2px 0 10px;}" +
            "#" + OVERLAY_ID + " .cw-box.cw-wide{width:min(720px,94vw);}" +
            "#" + OVERLAY_ID + " .cw-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;}" +
            "#" + OVERLAY_ID + " .cw-toolbar .cw-grow{flex:1;}" +
            "#" + OVERLAY_ID + " .cw-list{display:grid;gap:10px;}" +
            "#" + OVERLAY_ID + " .cw-lvl{display:flex;gap:12px;align-items:center;background:#fff;border-radius:12px;padding:10px 12px;cursor:pointer;border:2px solid transparent;}" +
            "#" + OVERLAY_ID + " .cw-lvl:hover{border-color:#ffc629;}" +
            "#" + OVERLAY_ID + " .cw-lvl img{width:56px;height:56px;border-radius:8px;object-fit:cover;background:#dfe8f5;flex:0 0 auto;}" +
            "#" + OVERLAY_ID + " .cw-lvl .cw-li{flex:1;min-width:0;}" +
            "#" + OVERLAY_ID + " .cw-lvl b{display:block;color:#0a3d72;font-size:15px;}" +
            "#" + OVERLAY_ID + " .cw-lvl small{color:#5a6c86;}" +
            "#" + OVERLAY_ID + " .cw-empty{color:#37475f;text-align:center;padding:24px;}" +
            "#" + OVERLAY_ID + " .cw-cmt{background:#fff;border-radius:10px;padding:8px 10px;margin-bottom:6px;}" +
            "#" + OVERLAY_ID + " .cw-cmt b{color:#0a4c93;font-size:13px;} #" + OVERLAY_ID + " .cw-cmt span{display:block;color:#33455e;font-size:13px;}";
        document.head.appendChild(css);
    }

    var pendingAvatar = "";

    function close() {
        var el = document.getElementById(OVERLAY_ID);
        if (el) {
            if (el.__keyGuard) document.removeEventListener("keydown", el.__keyGuard, true);
            el.parentNode.removeChild(el);
        }
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

        // Keep all interaction inside the overlay: the game listens for pointer
        // and keyboard events on document, so without this clicks "tap through"
        // to the game behind and text fields cannot be focused. We stop these
        // events at the overlay (without preventDefault, so inputs still work).
        ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup",
         "click", "dblclick", "touchstart", "touchend", "touchmove", "wheel",
         "keydown", "keyup", "keypress", "contextmenu"].forEach(function (t) {
            overlay.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });
        // Also swallow keyboard while the window is open even if focus is outside
        // an input, so arrow keys / space don't drive the game underneath.
        overlay.__keyGuard = function (e) {
            var inOverlay = overlay.contains(e.target);
            if (!inOverlay) { e.stopPropagation(); e.preventDefault(); }
        };
        document.addEventListener("keydown", overlay.__keyGuard, true);

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

    // ------------------------------------------------ community browser ----
    function makeShell(wide) {
        injectStyles();
        close();
        var overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = '<div class="cw-box ' + (wide ? "cw-wide" : "") + '">' +
            '<div class="cw-head">Comunidad<button class="cw-x" title="Cerrar">&times;</button></div>' +
            '<div class="cw-body"></div></div>';
        document.body.appendChild(overlay);
        ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup",
         "click", "dblclick", "touchstart", "touchend", "touchmove", "wheel",
         "keydown", "keyup", "keypress", "contextmenu"].forEach(function (t) {
            overlay.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });
        overlay.__keyGuard = function (e) {
            if (!overlay.contains(e.target)) { e.stopPropagation(); e.preventDefault(); }
        };
        document.addEventListener("keydown", overlay.__keyGuard, true);
        overlay.querySelector(".cw-x").onclick = close;
        return { overlay: overlay, body: overlay.querySelector(".cw-body") };
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function openBrowser() {
        if (!isReady()) { open(function () { openBrowser(); }); return; }
        var shell = makeShell(true);
        showLevelList(shell.body);
    }

    function showLevelList(body) {
        body.innerHTML =
            '<div class="cw-toolbar">' +
              '<div class="cw-grow cw-hint" id="cw-count">Cargando niveles…</div>' +
              '<button class="cw-btn cw-sec" id="cw-refresh">↻</button>' +
              '<button class="cw-btn" id="cw-upload">Subir nivel</button>' +
            '</div><div class="cw-list" id="cw-list"></div>';
        document.getElementById("cw-refresh").onclick = function () { showLevelList(body); };
        document.getElementById("cw-upload").onclick = function () { uploadCurrentLevel(body); };
        rest.listLevels("sort=new&limit=100").then(function (r) {
            var list = document.getElementById("cw-list");
            document.getElementById("cw-count").textContent = r.total + " nivel(es) en la comunidad";
            if (!r.levels.length) { list.innerHTML = '<div class="cw-empty">Todavía no hay niveles. ¡Sé el primero en subir uno!</div>'; return; }
            list.innerHTML = "";
            r.levels.forEach(function (l) {
                var row = document.createElement("div");
                row.className = "cw-lvl";
                row.innerHTML = (l.thumbnail ? '<img src="' + base() + l.thumbnail + '">' : '<img>') +
                    '<div class="cw-li"><b>' + esc(l.title) + '</b>' +
                    '<small>por ' + esc(l.authorName) + ' · ⭐ ' + l.stars + ' · ⬇ ' + l.downloads + ' · 💬 ' + l.comments + '</small></div>';
                row.onclick = function () { showLevelDetail(body, l.id); };
                list.appendChild(row);
            });
        }).catch(function (e) {
            document.getElementById("cw-count").textContent = "Error al cargar: " + e.message;
        });
    }

    function showLevelDetail(body, levelId) {
        body.innerHTML = '<div class="cw-hint">Cargando…</div>';
        rest.getLevel(levelId).then(function (l) {
            body.innerHTML =
                '<div class="cw-toolbar"><button class="cw-btn cw-sec" id="cw-back">← Volver</button><div class="cw-grow"></div></div>' +
                '<div class="cw-card"><div class="cw-row">' +
                  (l.thumbnail ? '<img class="cw-ava" src="' + base() + l.thumbnail + '">' : '') +
                  '<div style="flex:1"><h3 style="margin:0">' + esc(l.title) + '</h3>' +
                  '<div class="cw-hint">por ' + esc(l.authorName) + ' · ⭐ <span id="cw-stars">' + l.stars + '</span> · ⬇ ' + l.downloads + '</div></div>' +
                '</div>' +
                '<div class="cw-foot" style="justify-content:flex-start;margin-top:10px">' +
                  '<button class="cw-btn" id="cw-play">Jugar</button>' +
                  '<button class="cw-btn cw-sec" id="cw-star">⭐ Dar estrella</button></div>' +
                '<div class="cw-status" id="cw-detail-status"></div></div>' +
                '<div class="cw-card"><h3>COMENTARIOS</h3><div id="cw-comments"></div>' +
                  '<div class="cw-row" style="margin-top:8px"><input type="text" id="cw-comment" maxlength="280" placeholder="Escribe un comentario…" style="flex:1"/>' +
                  '<button class="cw-btn cw-sec" id="cw-send">Enviar</button></div></div>';
            document.getElementById("cw-back").onclick = function () { showLevelList(body); };
            document.getElementById("cw-play").onclick = function () { playLevel(l); };
            document.getElementById("cw-star").onclick = function () {
                rest.starLevel(l.id).then(function (s) { document.getElementById("cw-stars").textContent = s.stars; });
            };
            document.getElementById("cw-send").onclick = function () {
                var inp = document.getElementById("cw-comment");
                var txt = inp.value.trim(); if (!txt) return;
                rest.addComment(l.id, txt).then(function () { inp.value = ""; loadComments(l.id); });
            };
            loadComments(l.id);
        }).catch(function (e) { body.innerHTML = '<div class="cw-empty">Error: ' + esc(e.message) + '</div>'; });
    }

    function loadComments(levelId) {
        rest.getComments(levelId).then(function (r) {
            var c = document.getElementById("cw-comments");
            if (!c) return;
            if (!r.comments.length) { c.innerHTML = '<div class="cw-hint">Sin comentarios todavía.</div>'; return; }
            c.innerHTML = r.comments.map(function (m) {
                return '<div class="cw-cmt"><b>' + esc(m.userName) + '</b><span>' + esc(m.text) + '</span></div>';
            }).join("");
        });
    }

    function playLevel(level) {
        try {
            if (level && level.data && global.pt && global.window && window.signals && window.signals.loadLevel) {
                var mode = (global.pt.GAME_MODE_DOWNLOADED) || "downloaded";
                close();
                window.signals.loadLevel.dispatch(level.data, mode, 0, 0);
            }
        } catch (e) {}
    }

    // Upload the level currently loaded/edited (pt.currMapDef). Requires a
    // connected account (the browser is only reachable when ready).
    function uploadCurrentLevel(body) {
        var mapDef = global.pt && global.pt.currMapDef;
        var status = document.getElementById("cw-count");
        if (!mapDef) {
            if (status) status.textContent = "No hay nivel para subir. Crea o juega un nivel en el Taller primero.";
            return;
        }
        var title = (global.prompt ? global.prompt("Título del nivel:", "Mi nivel") : "Mi nivel");
        if (title === null) return;
        if (status) status.textContent = "Subiendo…";
        rest.uploadLevel((title || "Mi nivel").slice(0, 64), mapDef).then(function () {
            showLevelList(body);
        }).catch(function (e) {
            if (status) status.textContent = "Error al subir: " + e.message;
        });
    }

    // ------------------------------------------ Settings integration ----
    // Inject a "Cuenta / Servidor" button into the port's Settings panel
    // whenever it appears, so the profile/server can be managed from Ajustes too.
    var delegationInstalled = false;
    function installSettingsDelegation() {
        if (delegationInstalled) return;
        delegationInstalled = true;
        // The settings panel intercepts clicks on its own buttons, so a normal
        // listener on our injected button never fires. Catch it during the
        // capture phase on document instead (fires before anything else).
        document.addEventListener("click", function (e) {
            var t = e.target;
            while (t && t !== document) {
                if (t.classList && t.classList.contains("cw-settings-btn")) {
                    e.stopPropagation();
                    open();
                    return;
                }
                t = t.parentNode;
            }
        }, true);
    }

    function injectSettingsButton(panel) {
        if (!panel || panel.querySelector(".cw-settings-entry")) return;
        installSettingsDelegation();
        // Build a section that matches the port's own settings styling
        // (.section / .section-title / .debug-action button).
        var section = document.createElement("div");
        section.className = "section cw-settings-entry";
        var title = document.createElement("div");
        title.className = "section-title";
        title.textContent = "Comunidad";
        var btn = document.createElement("button");
        btn.className = "debug-action cw-settings-btn";
        btn.textContent = "Cuenta / Servidor";
        section.appendChild(title);
        section.appendChild(btn);
        // place it just before the version indicator if present, else append
        var version = panel.querySelector(".version, [id*='version']");
        if (version) panel.insertBefore(section, version); else panel.appendChild(section);
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
        openBrowser: openBrowser,
        getProfile: function () { return { id: state.id, name: state.name, avatar: state.avatar, server: state.server, serverName: state.serverName }; },
        pingServer: pingServer,
        rest: rest
    };
}(window));
