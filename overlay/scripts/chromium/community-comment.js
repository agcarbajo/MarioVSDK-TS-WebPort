/*
 * Custom Miiverse-style comment composer for the community (FishBowl).
 *
 * The original game opened the Wii U Miiverse memo/keyboard module to write a
 * comment - a system module that doesn't exist in this port. This rebuilds that
 * experience natively-looking with two ways to comment:
 *   - Texto: a plain text comment.
 *   - Dibujo: a hand-drawn memo on a comment-sized canvas (320x120) where you
 *     draw freehand AND place any of your unlocked stamps (sellos) wherever and
 *     however many times you like - exported as a single memo image.
 *
 * Stamps come from the game's real stamp atlas via StampData. The composed memo
 * is sent to the community backend as a PNG and rendered back into the native
 * comment list by community-net.js.
 */
(function (global) {
    "use strict";
    if (global.ChromiumPortCommentUI) return;

    var OVERLAY_ID = "cwc-overlay";
    var STYLE_ID = "cwc-style";
    var MEMO_W = 320, MEMO_H = 120;     // native comment memo size

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
    var urlCache = {}, imgCache = {};
    function getImageUrl(id) {
        if (!id) return "";
        if (urlCache[id]) return urlCache[id];
        var sd = getStampData(); if (!sd) return "";
        var img = null;
        if (id.charAt(0) === "d" && sd.getDefaultImages) { var defs = sd.getDefaultImages(); img = defs && defs[parseInt(id.slice(1), 10)]; }
        else if (id.charAt(0) === "u" && sd.getUnlockImage) { img = sd.getUnlockImage(parseInt(id.slice(1), 10)); }
        var url = imgToUrl(img); if (url) urlCache[id] = url; return url;
    }
    function getStampImage(id) { var sd = getStampData(); if (!sd) return null;
        if (id.charAt(0) === "d" && sd.getDefaultImages) { var defs = sd.getDefaultImages(); return defs && defs[parseInt(id.slice(1), 10)]; }
        if (id.charAt(0) === "u" && sd.getUnlockImage) { return sd.getUnlockImage(parseInt(id.slice(1), 10)); }
        return null;
    }
    function getUnlockedStamps() {
        var sd = getStampData(); var out = [];
        if (!sd) return out;
        var defs = sd.getDefaultImages ? sd.getDefaultImages() : [];
        for (var i = 0; i < (defs ? defs.length : 0); ++i) { var u = imgToUrl(defs[i]); if (u) { urlCache["d" + i] = u; out.push({ id: "d" + i, url: u }); } }
        var status = []; try { status = pt.storage.getStampUnlockedStatus() || []; } catch (e) {}
        for (var j = 0; j < status.length; ++j) { if (status[j] && sd.getUnlockImage) { var iu = imgToUrl(sd.getUnlockImage(j)); if (iu) { urlCache["u" + j] = iu; out.push({ id: "u" + j, url: iu }); } } }
        return out;
    }
    global.ChromiumPortStamps = { getImageUrl: getImageUrl, getUnlockedStamps: getUnlockedStamps };

    // -------------------------------------------------------------- styles ---
    function injectStyles() {
        if (global.document.getElementById(STYLE_ID)) return;
        var s = global.document.createElement("style");
        s.id = STYLE_ID;
        s.textContent =
            "#" + OVERLAY_ID + "{position:fixed;inset:0;z-index:2000050;display:flex;align-items:center;justify-content:center;background:rgba(4,28,60,.55);font-family:Arial,Helvetica,sans-serif;}" +
            "#" + OVERLAY_ID + " .cwc-box{width:min(600px,95vw);max-height:94vh;overflow:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;border-radius:18px;background:linear-gradient(180deg,#5eb6ff 0%,#90dcff 45%,#65b7ec 100%);box-shadow:0 12px 40px rgba(0,0,0,.5);border:3px solid #fff;}" +
            "#" + OVERLAY_ID + " .cwc-head{display:flex;align-items:center;justify-content:center;position:relative;padding:14px;color:#fff;font-weight:900;font-size:20px;text-shadow:0 2px 0 rgba(0,40,90,.5);}" +
            "#" + OVERLAY_ID + " .cwc-x{position:absolute;right:12px;top:10px;width:34px;height:34px;border-radius:50%;border:2px solid rgba(255,255,255,.8);background:rgba(0,47,108,.5);color:#fff;font-weight:900;cursor:pointer;}" +
            "#" + OVERLAY_ID + " .cwc-body{padding:4px 18px 18px;}" +
            "#" + OVERLAY_ID + " .cwc-card{background:rgba(255,255,255,.95);border-radius:14px;padding:14px;margin-bottom:12px;}" +
            "#" + OVERLAY_ID + " .cwc-row{display:flex;gap:10px;align-items:center;}" +
            "#" + OVERLAY_ID + " .cwc-ava{width:48px;height:48px;border-radius:10px;object-fit:cover;background:#dfe8f5;border:2px solid #b9c8de;flex:0 0 auto;}" +
            "#" + OVERLAY_ID + " .cwc-name{font-weight:800;color:#123;}" +
            "#" + OVERLAY_ID + " textarea.cwc-text{width:100%;box-sizing:border-box;min-height:64px;resize:none;margin-top:10px;border:2px solid #b9c8de;border-radius:10px;padding:10px;font-size:16px;font-family:inherit;}" +
            "#" + OVERLAY_ID + " .cwc-tabs{display:flex;gap:8px;margin:4px 0 10px;}" +
            "#" + OVERLAY_ID + " .cwc-tab{flex:1;text-align:center;padding:8px;border-radius:10px;font-weight:800;cursor:pointer;background:#e8eef7;color:#234;}" +
            "#" + OVERLAY_ID + " .cwc-tab.on{background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);color:#1a1300;}" +
            "#" + OVERLAY_ID + " .cwc-canvas-wrap{position:relative;width:100%;aspect-ratio:" + MEMO_W + "/" + MEMO_H + ";background:#fff;border:2px solid #b9c8de;border-radius:10px;overflow:hidden;}" +
            "#" + OVERLAY_ID + " canvas.cwc-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair;}" +
            "#" + OVERLAY_ID + " .cwc-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0;}" +
            "#" + OVERLAY_ID + " .cwc-tool{padding:6px 12px;border-radius:8px;font-weight:800;cursor:pointer;background:#e8eef7;color:#234;border:2px solid transparent;font-size:13px;}" +
            "#" + OVERLAY_ID + " .cwc-tool.on{border-color:#ff8b21;background:#fff3d6;}" +
            "#" + OVERLAY_ID + " .cwc-swatch{width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid #fff;box-shadow:0 0 0 1px #b9c8de;}" +
            "#" + OVERLAY_ID + " .cwc-swatch.on{box-shadow:0 0 0 2px #ff8b21;}" +
            "#" + OVERLAY_ID + " .cwc-stamps{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;max-height:120px;overflow:auto;padding:4px;margin-top:8px;background:#eef3fb;border-radius:8px;touch-action:pan-y;-webkit-overflow-scrolling:touch;}" +
            "#" + OVERLAY_ID + " .cwc-stamp{aspect-ratio:1;border-radius:8px;background:#fff;border:2px solid transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:3px;}" +
            "#" + OVERLAY_ID + " .cwc-stamp img{max-width:100%;max-height:100%;}" +
            "#" + OVERLAY_ID + " .cwc-stamp.sel{border-color:#ff8b21;background:#fff3d6;}" +
            "#" + OVERLAY_ID + " .cwc-hint{color:#456;font-size:12px;margin-top:6px;}" +
            "#" + OVERLAY_ID + " .cwc-none{color:#456;text-align:center;padding:14px;font-size:13px;}" +
            "#" + OVERLAY_ID + " .cwc-foot{display:flex;justify-content:flex-end;gap:10px;}" +
            "#" + OVERLAY_ID + " .cwc-btn{border:0;border-radius:999px;padding:10px 20px;font-weight:800;font-size:15px;cursor:pointer;color:#1a1300;background:linear-gradient(180deg,#fff56f,#ffc629 60%,#ff8b21);box-shadow:0 3px 0 rgba(160,90,0,.6);}" +
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

    function open(postID, onPosted, opts) {
        opts = opts || {};
        if (!opts.compose && !postID) return;
        injectStyles();
        close();

        var profile = {};
        try { profile = global.ChromiumPortCommunity.getProfile() || {}; } catch (e) {}
        var avaUrl = profile.avatar || "";
        var stamps = getUnlockedStamps();

        var COLORS = ["#222222", "#e53935", "#1e88e5", "#43a047", "#fdd835", "#fb8c00", "#ffffff"];

        var overlay = global.document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.innerHTML =
            '<div class="cwc-box" role="dialog" aria-modal="true">' +
              '<div class="cwc-head">' + esc(opts.title || "Comentar") + '<button class="cwc-x" title="Cerrar">&times;</button></div>' +
              '<div class="cwc-body">' +
                '<div class="cwc-card">' +
                  '<div class="cwc-row">' +
                    (avaUrl ? '<img class="cwc-ava" src="' + esc(avaUrl) + '">' : '<div class="cwc-ava"></div>') +
                    '<div class="cwc-name">' + esc(profile.name || "Tú") + '</div>' +
                  '</div>' +
                  '<div class="cwc-tabs">' +
                    '<div class="cwc-tab on" data-tab="text">Texto</div>' +
                    '<div class="cwc-tab" data-tab="draw">Dibujo</div>' +
                  '</div>' +
                  '<div class="cwc-pane" data-pane="text">' +
                    '<textarea class="cwc-text" maxlength="280" placeholder="Escribe un comentario..."></textarea>' +
                  '</div>' +
                  '<div class="cwc-pane" data-pane="draw" style="display:none">' +
                    '<div class="cwc-canvas-wrap"><canvas class="cwc-canvas" width="' + MEMO_W + '" height="' + MEMO_H + '"></canvas></div>' +
                    '<div class="cwc-tools">' +
                      '<span class="cwc-tool on" data-tool="pen">✏️ Lápiz</span>' +
                      '<span class="cwc-tool" data-tool="erase">🩹 Borrador</span>' +
                      COLORS.map(function (c, i) { return '<span class="cwc-swatch' + (i === 0 ? " on" : "") + '" data-color="' + c + '" style="background:' + c + '"></span>'; }).join("") +
                      '<span class="cwc-tool" data-act="clear" style="margin-left:auto">🗑 Limpiar</span>' +
                    '</div>' +
                    (stamps.length
                      ? '<div class="cwc-hint">Toca un sello y luego el lienzo para colocarlo. Vuelve a Lápiz para dibujar.</div>' +
                        '<div class="cwc-stamps">' + stamps.map(function (s) { return '<div class="cwc-stamp" data-id="' + esc(s.id) + '"><img src="' + esc(s.url) + '"></div>'; }).join("") + '</div>'
                      : '<div class="cwc-none">Aún no tienes sellos desbloqueados. Puedes dibujar a mano.</div>') +
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

        ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "click", "dblclick",
         "touchstart", "touchend", "touchmove", "wheel", "keydown", "keyup", "keypress", "contextmenu"]
            .forEach(function (t) { overlay.addEventListener(t, function (e) { e.stopPropagation(); }, false); });
        overlay.__keyGuard = function (e) { if (!overlay.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
        global.document.addEventListener("keydown", overlay.__keyGuard, true);
        try { global.blockInput = true; } catch (e) {}

        var q = function (sel) { return overlay.querySelector(sel); };
        var status = q(".cwc-status");
        var textArea = q("textarea.cwc-text");
        var canvas = q("canvas.cwc-canvas");
        var ctx = canvas.getContext("2d");
        var activeTab = "text";
        var tool = "pen", color = COLORS[0], selectedStamp = "", drawn = false;

        function setStatus(msg, err) { status.textContent = msg || ""; status.className = "cwc-status" + (err ? " err" : ""); }

        // tabs
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tab"), function (tab) {
            tab.onclick = function () {
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tab"), function (t) { t.classList.remove("on"); });
                tab.classList.add("on");
                activeTab = tab.getAttribute("data-tab");
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-pane"), function (p) {
                    p.style.display = (p.getAttribute("data-pane") === activeTab) ? "" : "none";
                });
            };
        });

        // tool buttons
        function selectTool(t) {
            tool = t; selectedStamp = "";
            Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tool[data-tool]"), function (b) { b.classList.toggle("on", b.getAttribute("data-tool") === t); });
            Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-stamp"), function (c) { c.classList.remove("sel"); });
        }
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tool[data-tool]"), function (b) { b.onclick = function () { selectTool(b.getAttribute("data-tool")); }; });
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-swatch"), function (sw) {
            sw.onclick = function () {
                color = sw.getAttribute("data-color"); selectTool("pen");
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-swatch"), function (s) { s.classList.remove("on"); });
                sw.classList.add("on");
            };
        });
        q('[data-act="clear"]').onclick = function () { ctx.clearRect(0, 0, MEMO_W, MEMO_H); drawn = false; };

        // stamp selection (placement mode)
        Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-stamp"), function (cell) {
            cell.onclick = function () {
                selectedStamp = cell.getAttribute("data-id"); tool = "stamp";
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-stamp"), function (c) { c.classList.remove("sel"); });
                Array.prototype.forEach.call(overlay.querySelectorAll(".cwc-tool[data-tool]"), function (b) { b.classList.remove("on"); });
                cell.classList.add("sel");
            };
        });

        // canvas drawing / stamping
        function pos(e) {
            var r = canvas.getBoundingClientRect();
            var px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
            var py = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
            return { x: px * (MEMO_W / r.width), y: py * (MEMO_H / r.height) };
        }
        var drawing = false, last = null;
        function placeStamp(p) {
            var img = getStampImage(selectedStamp); if (!img) return;
            var size = 56;
            try { ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size); drawn = true; } catch (e) {}
        }
        function down(e) {
            e.preventDefault();
            var p = pos(e);
            if (tool === "stamp" && selectedStamp) { placeStamp(p); return; }
            drawing = true; last = p;
            ctx.lineCap = "round"; ctx.lineJoin = "round";
        }
        function move(e) {
            if (!drawing) return; e.preventDefault();
            var p = pos(e);
            ctx.beginPath();
            ctx.globalCompositeOperation = (tool === "erase") ? "destination-out" : "source-over";
            ctx.strokeStyle = color; ctx.lineWidth = (tool === "erase") ? 16 : 4;
            ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            ctx.globalCompositeOperation = "source-over";
            last = p; drawn = true;
        }
        function up() { drawing = false; last = null; }
        canvas.addEventListener("mousedown", down); canvas.addEventListener("mousemove", move);
        // The overlay stops mouseup from bubbling to document, so release must be
        // caught on the overlay itself (and on leaving the canvas) - otherwise the
        // pen keeps "drawing" on hover after the button is released.
        overlay.addEventListener("mouseup", up);
        overlay.addEventListener("mouseleave", up);
        canvas.addEventListener("mouseleave", up);
        canvas.addEventListener("touchstart", down); canvas.addEventListener("touchmove", move);
        canvas.addEventListener("touchend", up); canvas.addEventListener("touchcancel", up);

        var doCancel = function () { close(); if (opts.compose && typeof opts.onCancel === "function") opts.onCancel(); };
        q('[data-act="cancel"]').onclick = doCancel;
        overlay.querySelector(".cwc-x").onclick = doCancel;

        q('[data-act="post"]').onclick = function () {
            var text = (textArea.value || "").trim();
            var memo = "";
            if (activeTab === "draw" && drawn) {
                // flatten onto white so the memo isn't transparent
                var out = global.document.createElement("canvas"); out.width = MEMO_W; out.height = MEMO_H;
                var octx = out.getContext("2d"); octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, MEMO_W, MEMO_H);
                octx.drawImage(canvas, 0, 0);
                memo = out.toDataURL("image/png");
            }
            if (!text && !memo) { setStatus("Escribe un comentario o haz un dibujo.", true); return; }
            // Compose mode: hand the composed comment back instead of posting it
            // (used for a level's initial comment, captured before publishing).
            if (opts.compose) {
                close();
                if (typeof opts.onSubmit === "function") opts.onSubmit({ text: text, memo: memo });
                return;
            }
            var btn = this; btn.disabled = true; setStatus("Publicando…", false);
            var rest; try { rest = global.ChromiumPortCommunity.rest; } catch (e) {}
            if (!rest) { setStatus("No conectado al servidor.", true); btn.disabled = false; return; }
            rest.addComment(postID, text, "", memo).then(function () {
                setStatus("¡Comentario publicado!", false);
                global.setTimeout(function () { close(); if (typeof onPosted === "function") onPosted(); }, 450);
            }).catch(function (e) { btn.disabled = false; setStatus("Error: " + e.message, true); });
        };
    }

    // Compose-only: show the composer to capture an initial comment for a level
    // being published. Calls onSubmit({text, memo}) on Publish, onCancel on close.
    function openCompose(onSubmit, onCancel, title) {
        open(null, null, { compose: true, onSubmit: onSubmit, onCancel: onCancel, title: title || "Comentario del nivel" });
    }

    global.ChromiumPortCommentUI = { open: open, openCompose: openCompose, close: close };
}(window));
