(function (global) {
    "use strict";

    var QR_PREFIX = "MVDKTS";
    var QR_VERSION = "3";
    var CHUNK_SIZE = 320;
    var FRAME_MS = 1250;
    var COMPACT_MAGIC = "MVDKQR3";
    var overlay = null;
    var activeStream = null;
    var exportTimer = null;
    var scanTimer = null;

    var TEXT = {
        en: {
            titleExport: "Transfer save",
            titleImport: "Receive save",
            close: "Close",
            exportPreparing: "Preparing save...",
            exportHint: "Scan these QR codes from the other device.",
            exportChunk: "QR {index}/{total}",
            importPreparing: "Opening camera...",
            importHint: "Point the camera at the QR codes on the other device.",
            importProgress: "Read {done}/{total}",
            importDone: "Using imported save data...",
            importFailed: "Invalid QR save data.",
            cameraUnsupported: "Chrome blocks live camera on HTTP LAN IPs. Use HTTPS, localhost, or import the JSON file.",
            detectorUnsupported: "QR reading is not available in this browser.",
            compressionUnsupported: "Save QR transfer needs CompressionStream support."
        },
        es: {
            titleExport: "Transferir guardado",
            titleImport: "Recibir guardado",
            close: "Cerrar",
            exportPreparing: "Preparando guardado...",
            exportHint: "Escanea estos códigos QR desde el otro dispositivo.",
            exportChunk: "QR {index}/{total}",
            importPreparing: "Abriendo cámara...",
            importHint: "Apunta la cámara a los QR del otro dispositivo.",
            importProgress: "Leídos {done}/{total}",
            importDone: "Usando datos importados...",
            importFailed: "Datos QR de guardado no válidos.",
            cameraUnsupported: "Chrome bloquea la cámara en IPs LAN por HTTP. Usa HTTPS, localhost o importa el archivo JSON.",
            detectorUnsupported: "La lectura de QR no esta disponible en este navegador.",
            compressionUnsupported: "La transferencia QR necesita soporte CompressionStream."
        }
    };

    function lang() {
        var l = "en";
        try {
            if (global.ChromiumPort && ChromiumPort.getEffectiveLanguage) {
                l = ChromiumPort.getEffectiveLanguage();
            } else if (navigator.language) {
                l = navigator.language;
            }
        } catch (err) {}
        l = String(l || "en").toLowerCase();
        return l.indexOf("es") === 0 ? "es" : "en";
    }

    function t(key, vars) {
        var str = (TEXT[lang()] && TEXT[lang()][key]) || TEXT.en[key] || key;
        vars = vars || {};
        Object.keys(vars).forEach(function (name) {
            str = str.replace("{" + name + "}", vars[name]);
        });
        return str;
    }

    function fsApi() {
        return global.ChromiumPortSaveFS || null;
    }

    function ensureStyles() {
        if (document.getElementById("chromium-port-qr-transfer-style")) return;
        var style = document.createElement("style");
        style.id = "chromium-port-qr-transfer-style";
        style.textContent = [
            "#chromium-port-qr-transfer{position:fixed;z-index:1000005;inset:0;background:rgba(0,12,28,.82);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;pointer-events:auto;touch-action:none}",
            "#chromium-port-qr-transfer .qr-panel{width:min(96vw,920px);max-height:96vh;overflow:auto;border:4px solid #031c31;border-radius:9px;background:linear-gradient(#08a9ef,#006bc2);box-shadow:0 0 0 3px #49d6ff inset,0 10px 28px rgba(0,0,0,.55);padding:18px;text-align:center;color:#fff}",
            "#chromium-port-qr-transfer .qr-title{font-weight:900;font-size:clamp(24px,4vw,36px);text-shadow:2px 2px 0 #053a7a;margin:0 0 8px}",
            "#chromium-port-qr-transfer .qr-status{font-weight:900;font-size:clamp(16px,2.7vw,24px);line-height:1.25;text-shadow:1px 1px 0 #053a7a;margin:8px 0 12px;color:#fff7a8}",
            "#chromium-port-qr-transfer .qr-box{display:inline-flex;align-items:center;justify-content:center;min-width:min(86vw,560px);min-height:min(86vw,560px);padding:14px;border:4px solid #09284a;border-radius:8px;background:#fff;box-shadow:0 4px 0 #001b31}",
            "#chromium-port-qr-transfer .qr-box svg{display:block;width:min(82vw,640px);height:min(82vw,640px)}",
            "#chromium-port-qr-transfer video{width:min(92vw,760px);max-height:66vh;border:4px solid #09284a;border-radius:8px;background:#000;box-shadow:0 4px 0 #001b31}",
            "#chromium-port-qr-transfer button{display:block;width:min(320px,80vw);min-height:48px;margin:14px auto 0;padding:0 14px;border:3px solid #09284a;border-radius:7px;background:linear-gradient(#ffe96f,#f8b633);color:#14376f;font-weight:900;font-size:18px;text-shadow:0 1px 0 rgba(255,255,255,.75);cursor:pointer}"
        ].join("\n");
        document.head.appendChild(style);
    }

    function stopAll() {
        if (exportTimer) {
            clearInterval(exportTimer);
            exportTimer = null;
        }
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (activeStream) {
            activeStream.getTracks().forEach(function (track) { track.stop(); });
            activeStream = null;
        }
    }

    function closeOverlay() {
        stopAll();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
    }

    function makeOverlay(title) {
        closeOverlay();
        ensureStyles();
        overlay = document.createElement("div");
        overlay.id = "chromium-port-qr-transfer";
        overlay.innerHTML = '<div class="qr-panel">' +
            '<div class="qr-title"></div>' +
            '<div class="qr-status"></div>' +
            '<div class="qr-content"></div>' +
            '<button type="button" class="qr-close"></button>' +
            '</div>';
        overlay.querySelector(".qr-title").textContent = title;
        overlay.querySelector(".qr-close").textContent = t("close");
        function closeFromEvent(evt) {
            evt.preventDefault();
            evt.stopPropagation();
            closeOverlay();
        }
        overlay.querySelector(".qr-close").addEventListener("pointerdown", closeFromEvent, true);
        overlay.querySelector(".qr-close").addEventListener("touchstart", closeFromEvent, true);
        overlay.querySelector(".qr-close").addEventListener("click", closeFromEvent, true);
        overlay.addEventListener("pointerdown", function (evt) {
            if (evt.target && evt.target.closest && evt.target.closest(".qr-close")) return;
            evt.stopPropagation();
        }, true);
        overlay.addEventListener("touchstart", function (evt) {
            if (evt.target && evt.target.closest && evt.target.closest(".qr-close")) return;
            evt.stopPropagation();
        }, true);
        overlay.addEventListener("click", function (evt) {
            if (evt.target && evt.target.closest && evt.target.closest(".qr-close")) return;
            evt.stopPropagation();
        }, true);
        document.body.appendChild(overlay);
        return overlay;
    }

    function setStatus(message) {
        if (overlay) overlay.querySelector(".qr-status").textContent = message || "";
    }

    function contentEl() {
        return overlay && overlay.querySelector(".qr-content");
    }

    function bytesToBase64Url(bytes) {
        var out = "";
        var i;
        for (i = 0; i < bytes.length; ++i) out += String.fromCharCode(bytes[i]);
        return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function base64UrlToBytes(str) {
        str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
        while (str.length % 4) str += "=";
        var bin = atob(str);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function streamToBytes(stream) {
        return new Response(stream).arrayBuffer().then(function (buffer) {
            return new Uint8Array(buffer);
        });
    }

    function concatBytes(parts) {
        var length = 0;
        var offset = 0;
        parts.forEach(function (part) { length += part.length; });
        var out = new Uint8Array(length);
        parts.forEach(function (part) {
            out.set(part, offset);
            offset += part.length;
        });
        return out;
    }

    function gzipBytes(bytes) {
        if (!global.CompressionStream) return Promise.reject(new Error("CompressionStream unavailable"));
        var stream = new Blob([bytes], { type: "application/octet-stream" }).stream().pipeThrough(new CompressionStream("gzip"));
        return streamToBytes(stream);
    }

    function gunzipBytes(bytes) {
        if (!global.DecompressionStream) return Promise.reject(new Error("DecompressionStream unavailable"));
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return streamToBytes(stream);
    }

    function sha256(text) {
        var str = String(text || "");
        var h1 = 2166136261;
        var h2 = 16777619;
        for (var i = 0; i < str.length; ++i) {
            h1 ^= str.charCodeAt(i);
            h1 = Math.imul(h1, 16777619);
            h2 ^= str.charCodeAt(str.length - 1 - i);
            h2 = Math.imul(h2, 2166136261);
        }
        return Promise.resolve((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"));
    }

    function chunkChecksum(text) {
        var hash = 2166136261;
        var str = String(text || "");
        for (var i = 0; i < str.length; ++i) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function blobToBytes(blob) {
        return blob.arrayBuffer().then(function (buffer) {
            return new Uint8Array(buffer);
        });
    }

    function writeUint16(value) {
        var bytes = new Uint8Array(2);
        new DataView(bytes.buffer).setUint16(0, value, false);
        return bytes;
    }

    function writeUint32(value) {
        var bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value, false);
        return bytes;
    }

    function makeCompactSaveBytes(fs) {
        var encoder = new TextEncoder();
        var paths = fs.listAllFiles ? fs.listAllFiles().filter(function (path) {
            return String(path || "").indexOf("save/") === 0;
        }).sort() : [];
        var records = [];
        return Promise.all(paths.map(function (path) {
            return fs.readFile(path).then(function (blob) {
                if (!blob) return;
                return blobToBytes(blob).then(function (data) {
                    records.push({
                        path: path,
                        type: blob.type || "application/octet-stream",
                        data: data
                    });
                });
            });
        })).then(function () {
            // Also carry the port's own settings (frame rate, language,
            // performance mode, and the community server + profile), which live in
            // localStorage rather than the game save, so they move with the save.
            try {
                var snap = {};
                for (var si = 0; si < localStorage.length; ++si) {
                    var k = localStorage.key(si);
                    if (k == null) continue;
                    var val = localStorage.getItem(k);
                    // Drop the community profile photo: it's a large data URL that
                    // would explode the QR count. The rest of the profile (server,
                    // name, id, token) is kept, and the photo can be re-set or
                    // re-fetched from the server.
                    if (k === "mvdk_community_profile" && val) {
                        try { var pj = JSON.parse(val); delete pj.avatar; val = JSON.stringify(pj); } catch (e) {}
                    }
                    snap[k] = val;
                }
                records.push({
                    path: "settings/localStorage.json",
                    type: "application/json",
                    data: encoder.encode(JSON.stringify(snap))
                });
            } catch (e) {}
            var parts = [encoder.encode(COMPACT_MAGIC), writeUint16(records.length)];
            records.sort(function (a, b) {
                return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
            });
            records.forEach(function (record) {
                var pathBytes = encoder.encode(record.path);
                var typeBytes = encoder.encode(record.type);
                if (pathBytes.length > 65535 || typeBytes.length > 65535) {
                    throw new Error("Save metadata is too large");
                }
                parts.push(writeUint16(pathBytes.length));
                parts.push(writeUint16(typeBytes.length));
                parts.push(writeUint32(record.data.length));
                parts.push(pathBytes);
                parts.push(typeBytes);
                parts.push(record.data);
            });
            return concatBytes(parts);
        });
    }

    function readCompactSaveBytes(bytes) {
        var decoder = new TextDecoder();
        var offset = 0;
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        function take(length) {
            if (offset + length > bytes.length) throw new Error("Truncated compact save");
            var part = bytes.subarray(offset, offset + length);
            offset += length;
            return part;
        }
        function u16() {
            if (offset + 2 > bytes.length) throw new Error("Truncated compact save");
            var value = view.getUint16(offset, false);
            offset += 2;
            return value;
        }
        function u32() {
            if (offset + 4 > bytes.length) throw new Error("Truncated compact save");
            var value = view.getUint32(offset, false);
            offset += 4;
            return value;
        }

        if (decoder.decode(take(COMPACT_MAGIC.length)) !== COMPACT_MAGIC) {
            throw new Error("Invalid compact save");
        }
        var count = u16();
        var files = [];
        for (var i = 0; i < count; ++i) {
            var pathLength = u16();
            var typeLength = u16();
            var dataLength = u32();
            var path = decoder.decode(take(pathLength));
            var type = decoder.decode(take(typeLength));
            var data = take(dataLength);
            if (!path || path.indexOf("../") !== -1 ||
                    (path.indexOf("save/") !== 0 && path.indexOf("settings/") !== 0)) {
                throw new Error("Invalid save path");
            }
            files.push({ path: path, type: type || "application/octet-stream", data: data });
        }
        if (offset !== bytes.length) throw new Error("Unexpected compact save data");
        return files;
    }

    function importCompactSaveBytes(fs, bytes) {
        var files = readCompactSaveBytes(bytes);
        // The settings record isn't a game-save file: restore it into localStorage
        // instead of the virtual filesystem.
        var saveFiles = files.filter(function (f) { return f.path.indexOf("settings/") !== 0; });
        var settingsFiles = files.filter(function (f) { return f.path.indexOf("settings/") === 0; });
        settingsFiles.forEach(function (f) {
            try {
                var snap = JSON.parse(new TextDecoder().decode(f.data));
                Object.keys(snap).forEach(function (k) {
                    try { localStorage.setItem(k, snap[k]); } catch (e) {}
                });
            } catch (e) {}
        });
        return fs.clearProfile().then(function () {
            var chain = Promise.resolve();
            saveFiles.forEach(function (file) {
                chain = chain.then(function () {
                    return fs.writeFile(file.path, new Blob([file.data], { type: file.type }));
                });
            });
            return chain;
        });
    }

    function makePacket(index, total, session, hash, chunk) {
        return [QR_PREFIX, QR_VERSION, session, index, total, hash, chunkChecksum(chunk), chunk].join("|");
    }

    function parsePacket(raw) {
        var parts = String(raw || "").split("|");
        if (parts.length === 8 && parts[0] === QR_PREFIX && parts[1] === QR_VERSION) {
            if (chunkChecksum(parts[7]) !== parts[6]) return null;
            return {
                session: parts[2],
                index: parseInt(parts[3], 10),
                total: parseInt(parts[4], 10),
                hash: parts[5],
                chunk: parts[7]
            };
        }
        return null;
    }

    function makeQrSvg(payload) {
        if (!global.qrcode) throw new Error("qrcode generator missing");
        var qr = qrcode(0, "Q");
        qr.addData(payload, "Byte");
        qr.make();
        return qr.createSvgTag({ cellSize: 5, margin: 12, scalable: true });
    }

    function hasQrReader() {
        return !!global.BarcodeDetector || typeof global.jsQR === "function";
    }

    function showExport() {
        var fs = fsApi();
        var box;
        var packets;
        var current = 0;
        var session = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

        makeOverlay(t("titleExport"));
        setStatus(t("exportPreparing"));
        contentEl().innerHTML = '<div class="qr-box"></div>';
        box = contentEl().querySelector(".qr-box");

        if (!fs || !fs.listAllFiles || !fs.readFile) {
            setStatus(t("importFailed"));
            return;
        }
        makeCompactSaveBytes(fs).then(function (payloadBytes) {
            return gzipBytes(payloadBytes);
        }).then(function (bytes) {
            var data = bytesToBase64Url(bytes);
            return sha256(data).then(function (hash) {
                var total = Math.ceil(data.length / CHUNK_SIZE) || 1;
                packets = [];
                for (var i = 0; i < total; ++i) {
                    packets.push(makePacket(i, total, session, hash, data.substr(i * CHUNK_SIZE, CHUNK_SIZE)));
                }
            });
        }).then(function () {
            function draw() {
                if (!packets || !packets.length) return;
                box.innerHTML = makeQrSvg(packets[current]);
                setStatus(t("exportHint") + " " + t("exportChunk", { index: current + 1, total: packets.length }));
                current = (current + 1) % packets.length;
            }
            draw();
            exportTimer = setInterval(draw, FRAME_MS);
        }).catch(function (err) {
            console.error("[save-qr] export failed", err);
            setStatus(t("compressionUnsupported"));
        });
    }

    function showImport() {
        makeOverlay(t("titleImport"));
        setStatus(t("importPreparing"));
        contentEl().innerHTML = '<video autoplay playsinline muted></video>';

        if (!hasQrReader()) {
            setStatus(t("detectorUnsupported"));
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus(t("cameraUnsupported"));
            return;
        }

        var detector = global.BarcodeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
        var video = contentEl().querySelector("video");
        var scanCanvas = document.createElement("canvas");
        var scanCtx = scanCanvas.getContext("2d");
        var chunks = {};
        var session = null;
        var hash = null;
        var total = 0;
        var busy = false;

        // Robust camera open: preferred constraints -> simplest {video:true} ->
        // try each camera device individually. The last step matters on machines
        // with several cameras (incl. virtual ones like OBS) where the default
        // pick may be busy or unable to start ("NotReadableError").
        var SOURCE_ERRORS = { NotReadableError: 1, OverconstrainedError: 1, AbortError: 1, NotFoundError: 1 };
        function getUM(c) { return navigator.mediaDevices.getUserMedia(c); }
        function tryEachCamera() {
            return navigator.mediaDevices.enumerateDevices().then(function (devs) {
                var cams = devs.filter(function (d) { return d.kind === "videoinput"; });
                var i = 0;
                function next() {
                    if (i >= cams.length) return Promise.reject(new Error("no camera could start"));
                    var id = cams[i++].deviceId;
                    return getUM({ video: id ? { deviceId: { exact: id } } : true, audio: false })
                        .catch(function () { return next(); });
                }
                return next();
            });
        }
        function openCamera() {
            return getUM({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            }).catch(function (err) {
                if (err && SOURCE_ERRORS[err.name]) {
                    console.warn("[save-qr] camera retry, basic constraints (" + err.name + ")");
                    return getUM({ video: true, audio: false }).catch(function (err2) {
                        if (err2 && SOURCE_ERRORS[err2.name]) {
                            console.warn("[save-qr] camera retry, per-device (" + err2.name + ")");
                            return tryEachCamera();
                        }
                        throw err2;
                    });
                }
                throw err;
            });
        }

        openCamera().then(function (stream) {
            activeStream = stream;
            video.srcObject = stream;
            setStatus(t("importHint"));
            scanLoop();
        }).catch(function (err) {
            console.error("[save-qr] camera failed", err);
            setStatus(t("cameraUnsupported") + (err && err.name ? " [" + err.name + "]" : ""));
        });

        function readQrWithJsQr(source) {
            var width = source.videoWidth || source.naturalWidth || source.width || 0;
            var height = source.videoHeight || source.naturalHeight || source.height || 0;
            var result;
            if (!width || !height || !scanCtx || typeof global.jsQR !== "function") return "";
            scanCanvas.width = width;
            scanCanvas.height = height;
            scanCtx.drawImage(source, 0, 0, width, height);
            result = global.jsQR(scanCtx.getImageData(0, 0, width, height).data, width, height, {
                inversionAttempts: "dontInvert"
            });
            return result && result.data ? result.data : "";
        }

        function readQrFromSource(source) {
            if (detector) {
                return detector.detect(source).then(function (codes) {
                    if (codes && codes.length && codes[0].rawValue) return codes[0].rawValue;
                    return readQrWithJsQr(source);
                }).catch(function () {
                    return readQrWithJsQr(source);
                });
            }
            return Promise.resolve(readQrWithJsQr(source));
        }

        function handleRawValue(raw) {
            var packet = parsePacket(raw);
            if (packet && isFinite(packet.index) && isFinite(packet.total) && packet.index >= 0 && packet.index < packet.total) {
                if (!session || session !== packet.session) {
                    chunks = {};
                    session = packet.session;
                    hash = packet.hash;
                    total = packet.total;
                }
                if (packet.session === session && packet.hash === hash && packet.total === total) {
                    chunks[packet.index] = packet.chunk;
                    setStatus(t("importProgress", { done: Object.keys(chunks).length, total: total }));
                    if (Object.keys(chunks).length >= total) {
                        busy = true;
                        finishImport();
                        return true;
                    }
                    return true;
                }
            }
            return false;
        }

        function scanLoop() {
            if (!overlay || busy) return;
            if (!video.videoWidth || !video.videoHeight) {
                scanTimer = setTimeout(scanLoop, 140);
                return;
            }
            readQrFromSource(video).then(function (raw) {
                if (raw) {
                    handleRawValue(raw);
                    if (busy) return;
                }
                scanTimer = setTimeout(scanLoop, 140);
            }).catch(function (err) {
                console.error("[save-qr] detect failed", err);
                scanTimer = setTimeout(scanLoop, 350);
            });
        }

        function finishImport() {
            var joined = "";
            for (var i = 0; i < total; ++i) {
                if (!chunks[i]) {
                    setStatus(t("importFailed"));
                    busy = false;
                    scanLoop();
                    return;
                }
                joined += chunks[i];
            }
            sha256(joined).then(function (actualHash) {
                if (actualHash !== hash) throw new Error("QR hash mismatch");
                return gunzipBytes(base64UrlToBytes(joined));
            }).then(function (payloadBytes) {
                var fs = fsApi();
                if (!fs || !fs.clearProfile || !fs.writeFile) throw new Error("SaveFS unavailable");
                setStatus(t("importDone"));
                contentEl().innerHTML = "";
                return importCompactSaveBytes(fs, payloadBytes);
            }).then(function () {
                try {
                    global.sessionStorage && sessionStorage.setItem("chromiumPortImportedSaveNotice", "1");
                } catch (err) {}
                stopAll();
                global.setTimeout(function () {
                    global.location.reload();
                }, 650);
            }).catch(function (err) {
                console.error("[save-qr] import failed", err);
                setStatus(t("importFailed") + " " + t("importHint"));
                busy = false;
                chunks = {};
                session = null;
                hash = null;
                total = 0;
                scanLoop();
            });
        }
    }

    function showImportedNoticeIfNeeded() {
        try {
            if (!global.sessionStorage || sessionStorage.getItem("chromiumPortImportedSaveNotice") !== "1") return;
            sessionStorage.removeItem("chromiumPortImportedSaveNotice");
        } catch (err) {
            return;
        }
        ensureStyles();
        var notice = document.createElement("div");
        notice.id = "chromium-port-qr-transfer";
        notice.innerHTML = '<div class="qr-panel"><div class="qr-title">' + t("importDone") + '</div><div class="qr-status">' + t("importDone") + '</div></div>';
        document.body.appendChild(notice);
        setTimeout(function () {
            if (notice.parentNode) notice.parentNode.removeChild(notice);
        }, 1600);
    }

    global.ChromiumPortSaveQRTransfer = {
        showExport: showExport,
        showImport: showImport,
        close: closeOverlay
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showImportedNoticeIfNeeded);
    } else {
        showImportedNoticeIfNeeded();
    }
})(window);
