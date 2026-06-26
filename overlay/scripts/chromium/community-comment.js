/*
 * Custom Miiverse-style comment composer for the community (FishBowl).
 *
 * The original game opened the Wii U Miiverse memo/keyboard module to write a
 * comment - a system module that doesn't exist in this port. This rebuilds that
 * experience natively-looking: write text and/or pick one of the stamps (sellos)
 * you have unlocked, then post. Stamps are the game's real stamp images, pulled
 * from the loaded StampData (default stamps + whatever the player has unlocked).
 *
 * The composed comment is sent through the community backend; the stamp travels
 * as a short id ("d<i>" default / "u<i>" unlocked) which community-net.js renders
 * back into the native comment list as the comment's memo image.
 */
(function (global) {
    "use strict";
    if (global.ChromiumPortCommentUI) return;

    var OVERLAY_ID = "cwc-overlay";
    var STYLE_ID = "cwc-style";

    // ------------------------------------------------------------- stamps ----
    function getStampData() {
        try { return pt.asset.stampDataCache.getData("stamps"); } catch (e) { return null; }
    }
    function imgToUrl(img) {
        if (!img) return "";
        try {
            if (typeof img.toDataURL === "function") return img.toDataURL("image/png");
            if (img.src) return img.src;
            var w = img.width || 64, h = img.height || 64;
            var c = global.document.createElement("canvas"); c.width = w; c.height = h;
            c.getContext("2d").drawImage(img, 0, 0); return c.toDataURL("image/png");
        } catch (e) { return ""; }
    }
    var urlCache = {};
    function getImageUrl(id) {
        if (!id) return "";
        if (urlCache[id]) return urlCache[id];
        var sd = getStampData(); if (!sd) return "";
        var img = null;
        if (id.charAt(0) === "d" && sd.getDefaultImages) { var defs = sd.getDefaultImages(); img = defs && defs[parseInt(id.slice(1), 10)]; }
        else if (id.charAt(0) === "u" && sd.getUnlockImage) { img = sd.getUnlockImage(parseInt(id.slice(1), 10)); }
        var url = imgToUrl(img); if (url) urlCache[id] = url; return url;
    }
    function getUnlockedStamps() {
        var sd = getStampData(); var out = [];
        if (!sd) return out;
        var defs = sd.getDefaultImages ? sd.getDefaultImages() : [];
        for (var i = 0; i < (defs ? defs.length : 0); ++i) {
            var u = imgToUrl(defs[i]); if (u) { urlCache["d" + i] = u; out.push({ id: "d" + i, url: u }); }
        }
        var status = []; try { status = pt.storage.getStampUnlockedStatus() || []; } catch (e) {}
        for (var j = 0; j < status.length; ++j) {
            if (status[j] && sd.getUnlockImage) {
                var iu = imgToUrl(sd.getUnlockImage(j)); if (iu) { urlCache["u" + j] = iu; out.push({ id: "u" + j, url: iu }); }
            }
        }
        return out;
    }
    global.ChromiumPortStamps = { getImageUrl: getImageUrl, getUnlockedStamps: getUnlockedStamps };

    // -------------------------------------------------------------- styles ---
    function injectStyles() {
        if (global.document.getElementById(STYLE_ID)) return;
        var s = global.document.createElement("style");
        s.id = STYLE_ID;
        s.textContent =
            "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:2000050;display:flex;align-items:center;justify-content:center;" +
            "background:rgba(4,28,60,.55);font-family:Arial,Helvetica,sans-serif;}" +
            "#" + OVERLAY_ID + " .cwc-box{width:min(560px,94vw);max-height:92vh;overflow:auto;border-radius:18px;" +
            "background:linear-gradient(180deg,#5eb6ff 0%,#90dcff 45%,#65b7ec 100%);box-shadow:0 12px 40px rgba(0,0,0,.5);" +
            "border:3px solid #fff;}" +
            "#" + OVERLAY_ID + " .cwc-head{display:flex;align-items:center;justify-content:center;position:relative;" +
            "padding:14px;color:#fff;font-weight:900;font-size:20px;text-shadow:0 2px 0 rgba(0,40,90,.5);}" +
            "#" + OVERLAY_ID + " .cwc-x{position:absolute;right:12px;top:10px;width:34px;height:34px;border-radius:50%;" +
            "border:2px solid rgba(255,255,255,.8);background:rgba(0,47,108,.5);color:#fff;font-weight:900;cursor:pointer;}" +
            "#" + OVERLAY_ID + " .cwc-body{padding:4px 20px 20px;}" +
            "#" + OVERLAY_ID + " .cwc-card{background:rgba(255,255,255,.95);border-radius:14px;padding:14px;margin-bottom:12px;}" +
            "#" + OVERLAY_ID + " .cwc-row{display:flex;gap:10px;align-items:center;}" +
            "#" + OVERLAY_ID + " .cwc-ava{width:48px;height:48px;border-radius:10px;object-fit:cover;background:#dfe8f5;border:2px solid #b9c8de;flex:0 0 auto;}" +
            "#" + OVERLAY_ID + " .cwc-name{font-weight:800;color:#123;}" +
            "#" + OVERLAY_ID + " textarea.cwc-text{width:100%;box-sizing:border-box;min-height:64px;resize:none;margin-top:10px;" +
            "border:2px solid #b9c8de;border-radius:10px;padding:10px;font-size:16px;font-family:inherit;}" +
            "#" + OVERLAY_ID + " .cwc-tabs{display:flex;gap:8px;margin:4px 0 10px;}" +
            "#" + OVERLAY_ID + " .cwc-tab{flex:1;text-align:center;padding:8px;border-radius:10px;font-weight:800;cursor:pointer;" +
            "background:#e8eef7;color:#234;}" +
            "#" + OVERLAY_ID + " .cwc-tab.on{background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);color:#1a1300;}" +
            "#" + OVERLAY_ID + " .cwc-stamps{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;max-height:220px;overflow:auto;padding:4px;}" +
            "#" + OVERLAY_ID + " .cwc-stamp{aspect-ratio:1;border-radius:10px;background:#eef3fb;border:2px solid transparent;cursor:pointer;" +
            "display:flex;align-items:center;justify-content:center;padding:4px;}" +
            "#" + OVERLAY_ID + " .cwc-stamp img{max-width:100%;max-height:100%;}" +
            "#" + OVERLAY_ID + " .cwc-stamp.sel{border-color:#ff8b21;background:#fff3d6;}" +
            "#" + OVERLAY_ID + " .cwc-none{color:#456;text-align:center;padding:18px;font-size:14px;}" +
            "#" + OVERLAY_ID + " .cwc-foot{display:flex;justify-content:flex-end;gap:10px;}" +
            "#" + OVERLAY_ID + " .cwc-pick{display:flex;gap:10px;align-items:center;margin-top:8px;min-height:40px;}" +
            "#" + OVERLAY_ID + " .cwc-pick img{width:40px;height:40px;object-fit:contain;}" +
            "#" + OVERLAY_ID + " .cwc-btn{border:0;border-radius:999px;padding:10px 20px;font-weight:800;font-size:15px;cursor:pointer;color:#1a1300;" +
            "background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);box-shadow:0 3px 0 rgba(160,90,0,.6);}" +
            "#" + OVERLAY_ID + " .cwc-btn:disabled{filter:grayscale(.6);opacity:.6;cursor:default;}" +
            "#" + OVERLAY_ID + " .cwc-btn.sec{background:#e8eef7;color:#234;box-shadow:0 3px 0 rgba(120,140,170,.5);}" +
            "#" + OVERLAY_ID + " .cwc-status{font-size:13px;color:#0a3;margin-top:8px;min-height:16px;text-align:center;}" +
            "#" + OVERLAY_ID + " .cwc-status.err{color:#c00;}";
        global.document.head.appendChild(s);
    }

    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

    function close() {
        var el = global.document.getElementById(OVERLAY_ID);
        if (el) {
            if (el.__keyGuard) global.document.removeEventListener("keydown", el.__keyGuard, true);
            el.parentNode.removeChild(el);
        }
        try { global.blockInput = false; } catch (e) {}
    }

    function open(postID, onPosted) {
        if (!postID) return;
        injectStyles();
        close();

        var profile = {};
        try { profile = global.ChromiumPortCommunity.getProfile() || {}; } catch (e) {}
        var avaUrl = profile.avatar || "";
        var stamps = getUnlockedStamps();
        var selectedStamp = "";

        var overlay = global.document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.innerHTML =
            '<div class="cwc-box" role="dialog" aria-modal="true">' +
              '<div class="cwc-head">Comentar<button class="cwc-x" title="Cerrar">&times;</button></div>' +
              '<div class="cwc-body">' +
                '<div class="cwc-card">' +
                  '<div class="cwc-row">' +
                    (avaUrl ? '<img class="cwc-ava" src="' + esc(avaUrl) + '">' : '<div class="cwc-ava"></div>') +
                    '<div class="cwc-name">' + esc(profile.name || "Tú") + '</div>' +
                  '</div>' +
                  '<div class="cwc-tabs">' +
                    '<div class="cwc-tab on" data-tab="text">Texto</div>' +
                    '<div class="cwc-tab" data-tab="stamp">Sellos</div>' +
                  '</div>' +
                  '<div class="cwc-pane" data-pane="text">' +
                    '<textarea class="cwc-text" maxlength="280" placeholder="Escribe un comentario..."></textarea>' +
                  '</div>' +
                  '<div class="cwc-pane" data-pane="stamp" style="display:none">' +
                    (stamps.length
                      ? '<div class="cwc-stamps">' + stamps.map(function (s) {
                            return '<div class="cwc-stamp" data-id="' + esc(s.id) + '"><img src="' + esc(s.url) + '"></div>';
                        }).join("") + '</div>'
                      : '<div class="cwc-none">Aún no tienes sellos desbloqueados.<br>Consigue sellos regalando estrellas a otros niveles.</div>') +
                    '<div class="cwc-pick"></div>' +
                  '</div>' +
                  '<div class="cwc-status"></div>' +
                '</div>' +
                '<div class="cwc-foot">' +
                  '<button class="cwc-btn sec" data-act="cancel">Cancelar</button>' +
                  '<button class="cwc-btn" data-act="post">Publicar</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        global.document.body.appendChild(overlay);

        // Keep all input inside the overlay (the game listens on document).
        ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup",
         "click", "dblclick", "touchstart", "touchend", "touchmove", "wheel",
         "keydown", "keyup", "keypress", "contextmenu"].forEach(function (t) {
            overlay.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });
        overlay.__keyGuard = function (e) { if (!overlay.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
        global.document.addEventListener("keydown", overlay.__keyGuard, true);
        try { global.blockInput = true; } catch (e) {}

        var q = function (sel) { return overlay.querySelector(sel); };
        var status = q(".cwc-status");
        var textArea = q("textarea.cwc-text");
        var pick = q(".cwc-pick");

        function setStatus(msg, err) { status.textContent = msg || ""; status.className = "cwc-status" + (err ? " err" : ""); }

        // tab switching
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tab"), function (tab) {
            tab.onclick = function () {
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tab"), function (t) { t.classList.remove("on"); });
                tab.classList.add("on");
                var which = tab.getAttribute("data-tab");
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-pane"), function (p) {
                    p.style.display = (p.getAttribute("data-pane") === which) ? "" : "none";
                });
            };
        });

        // stamp selection
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-stamp"), function (cell) {
            cell.onclick = function () {
                var id = cell.getAttribute("data-id");
                if (selectedStamp === id) {
                    selectedStamp = ""; cell.classList.remove("sel"); pick.innerHTML = "";
                } else {
                    selectedStamp = id;
                    Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-stamp"), function (c) { c.classList.remove("sel"); });
                    cell.classList.add("sel");
                    pick.innerHTML = '<img src="' + esc(getImageUrl(id)) + '"><span style="color:#456;font-size:13px">Sello seleccionado</span>';
                }
            };
        });

        q('[data-act="cancel"]').onclick = function () { close(); };
        overlay.querySelector(".cwc-x").onclick = function () { close(); };

        q('[data-act="post"]').onclick = function () {
            var text = (textArea.value || "").trim();
            if (!text && !selectedStamp) { setStatus("Escribe un comentario o elige un sello.", true); return; }
            var btn = this; btn.disabled = true; setStatus("Publicando…", false);
            var rest;
            try { rest = global.ChromiumPortCommunity.rest; } catch (e) {}
            if (!rest) { setStatus("No conectado al servidor.", true); btn.disabled = false; return; }
            rest.addComment(postID, text, selectedStamp).then(function () {
                setStatus("¡Comentario publicado!", false);
                global.setTimeout(function () {
                    close();
                    if (typeof onPosted === "function") onPosted();
                }, 450);
            }).catch(function (e) {
                btn.disabled = false; setStatus("Error: " + e.message, true);
            });
        };
    }

    global.ChromiumPortCommentUI = { open: open, close: close };
}(window));
