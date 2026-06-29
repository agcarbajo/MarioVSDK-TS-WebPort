(function (global) {
    "use strict";

    var startTime = (global.performance && performance.now) ? performance.now() : Date.now();
    var STORAGE_PREFIX = "mvsdk-ts:";
    var saveFS = global.ChromiumPortSaveFS || null;
    var listeners = [];
    var FRAME_RATE_STORAGE_KEY = "chromiumPortFrameRate";
    var LANGUAGE_STORAGE_KEY = "chromiumPortLanguage";
    var BASE_SIMULATION_FPS = 60;

    function normalizeFrameRate(fps) {
        fps = Number(fps) || BASE_SIMULATION_FPS;
        return fps === 30 || fps === 120 ? fps : BASE_SIMULATION_FPS;
    }

    function readFrameRate() {
        try {
            return normalizeFrameRate(global.localStorage && global.localStorage.getItem(FRAME_RATE_STORAGE_KEY));
        } catch (err) {
            return BASE_SIMULATION_FPS;
        }
    }

    function writeFrameRate(fps) {
        fps = normalizeFrameRate(fps);
        try {
            if (global.localStorage) {
                global.localStorage.setItem(FRAME_RATE_STORAGE_KEY, String(fps));
            }
        } catch (err) {}
        global.__chromiumPortFrameRate = fps;
        return fps;
    }

    function getCallbackFrameMs() {
        var fps = normalizeFrameRate(global.__chromiumPortFrameRate || readFrameRate());
        return 1000 / Math.max(1, fps);
    }

    function getAnimationFrameStep() {
        return BASE_SIMULATION_FPS / normalizeFrameRate(global.__chromiumPortFrameRate || readFrameRate());
    }

    global.ChromiumPort = global.ChromiumPort || {};
    global.__chromiumPortFrameRate = readFrameRate();
    global.ChromiumPort.getFrameRate = function () {
        return normalizeFrameRate(global.__chromiumPortFrameRate || readFrameRate());
    };
    global.ChromiumPort.setFrameRate = writeFrameRate;
    global.ChromiumPort.getAnimationFrameStep = getAnimationFrameStep;
    function readLanguageOverride() {
        try {
            return (global.localStorage && global.localStorage.getItem(LANGUAGE_STORAGE_KEY)) || "system";
        } catch (err) {
            return "system";
        }
    }
    function normalizeLanguage(lang) {
        lang = String(lang || "system").toLowerCase().replace("_", "-");
        if (lang === "system" || lang === "auto") return "system";
        if (lang.indexOf("ja") === 0) return "ja";
        if (lang.indexOf("es") === 0) return "es";
        if (lang.indexOf("fr") === 0) return "fr";
        if (lang.indexOf("de") === 0) return "de";
        if (lang.indexOf("it") === 0) return "it";
        return "en";
    }
    function deviceLanguage() {
        return normalizeLanguage((global.navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) || "en");
    }
    function effectiveLanguage() {
        var override = normalizeLanguage(readLanguageOverride());
        return override === "system" ? deviceLanguage() : override;
    }
    function localeConfig() {
        switch (effectiveLanguage()) {
            case "ja": return { regionCode: 0, languageCode: 0, countryCode: "JP" };
            case "es": return { regionCode: 2, languageCode: 2, countryCode: "ES" };
            case "fr": return { regionCode: 2, languageCode: 3, countryCode: "FR" };
            case "de": return { regionCode: 2, languageCode: 4, countryCode: "DE" };
            case "it": return { regionCode: 2, languageCode: 5, countryCode: "IT" };
            case "en":
            default: return { regionCode: 2, languageCode: 1, countryCode: "GB" };
        }
    }
    global.ChromiumPort.getLanguageOverride = function () {
        return normalizeLanguage(readLanguageOverride());
    };
    global.ChromiumPort.getEffectiveLanguage = effectiveLanguage;
    global.ChromiumPort.setLanguageOverride = function (lang) {
        lang = normalizeLanguage(lang);
        try {
            if (global.localStorage) {
                if (lang === "system") {
                    global.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
                } else {
                    global.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
                }
            }
        } catch (err) {}
        return lang;
    };
    global.ChromiumPort.getTwoColorImage = global.ChromiumPort.getTwoColorImage || function (image, colors) {
        if (!image || !colors) return image;
        var key = [
            Math.round((colors[0] || 0) * 255), Math.round((colors[1] || 0) * 255), Math.round((colors[2] || 0) * 255), Math.round((colors[3] == null ? 1 : colors[3]) * 255),
            Math.round((colors[4] == null ? 1 : colors[4]) * 255), Math.round((colors[5] == null ? 1 : colors[5]) * 255), Math.round((colors[6] == null ? 1 : colors[6]) * 255), Math.round((colors[7] == null ? 1 : colors[7]) * 255)
        ].join(",");
        image.__chromiumPortTwoColorCache = image.__chromiumPortTwoColorCache || {};
        if (image.__chromiumPortTwoColorCache[key]) return image.__chromiumPortTwoColorCache[key];

        var canvas = document.createElement("canvas");
        canvas.width = image.width || 1;
        canvas.height = image.height || 1;
        var ctx = canvas.getContext("2d");
        try {
            ctx.drawImage(image, 0, 0);
            var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var pixels = data.data;
            var r0 = colors[0] || 0, g0 = colors[1] || 0, b0 = colors[2] || 0;
            var r1 = colors[4] == null ? 1 : colors[4], g1 = colors[5] == null ? 1 : colors[5], b1 = colors[6] == null ? 1 : colors[6];
            for (var i = 0; i < pixels.length; i += 4) {
                var t = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
                pixels[i] = Math.round((r0 + (r1 - r0) * t) * 255);
                pixels[i + 1] = Math.round((g0 + (g1 - g0) * t) * 255);
                pixels[i + 2] = Math.round((b0 + (b1 - b0) * t) * 255);
            }
            ctx.putImageData(data, 0, 0);
            image.__chromiumPortTwoColorCache[key] = canvas;
            return canvas;
        } catch (err) {
            return image;
        }
    };

    function now() {
        return ((global.performance && performance.now) ? performance.now() : Date.now()) - startTime;
    }

    function installFrameLimiter() {
        if (global.__chromiumPortFrameLimiterInstalled) return;
        global.__chromiumPortFrameLimiterInstalled = true;

        var lastFrameTime = 0;
        var nextHandle = 1;
        var handles = {};

        function limitedRequestAnimationFrame(callback) {
            var handle = nextHandle++;
            var currentTime = (global.performance && performance.now) ? performance.now() : Date.now();
            var wait = Math.max(0, getCallbackFrameMs() - (currentTime - lastFrameTime));
            var timeoutID = global.setTimeout(function () {
                if (!handles[handle]) return;
                delete handles[handle];
                lastFrameTime = (global.performance && performance.now) ? performance.now() : Date.now();
                callback(lastFrameTime);
            }, wait);
            handles[handle] = { timeoutID: timeoutID };
            return handle;
        }

        function limitedCancelAnimationFrame(handle) {
            var entry = handles[handle];
            if (!entry) return;
            global.clearTimeout(entry.timeoutID);
            delete handles[handle];
        }

        global.requestAnimationFrame = limitedRequestAnimationFrame;
        global.webkitRequestAnimationFrame = limitedRequestAnimationFrame;
        global.cancelAnimationFrame = limitedCancelAnimationFrame;
        global.webkitCancelAnimationFrame = limitedCancelAnimationFrame;
    }
    installFrameLimiter();

    function EventTargetShim() {
        this._listeners = {};
    }
    EventTargetShim.prototype.addEventListener = function (type, callback, scope) {
        if (!callback) return;
        (this._listeners[type] || (this._listeners[type] = [])).push({ callback: callback, scope: scope || this });
    };
    EventTargetShim.prototype.removeEventListener = function (type, callback, scope) {
        var list = this._listeners[type];
        if (!list) return;
        for (var i = list.length - 1; i >= 0; --i) {
            if (list[i].callback === callback && (!scope || list[i].scope === scope)) {
                list.splice(i, 1);
            }
        }
    };
    EventTargetShim.prototype.removeAllEventListeners = function () {
        this._listeners = {};
    };
    EventTargetShim.prototype.dispatchEvent = function (type, event) {
        var list = (this._listeners[type] || []).slice();
        event = event || {};
        event.type = event.type || type;
        event.target = event.target || this;
        for (var i = 0; i < list.length; ++i) {
            list[i].callback.call(list[i].scope || this, event);
        }
    };

    var buttons = {
        GAMEPAD_A: 1 << 0,
        GAMEPAD_B: 1 << 1,
        GAMEPAD_X: 1 << 2,
        GAMEPAD_Y: 1 << 3,
        GAMEPAD_L: 1 << 4,
        GAMEPAD_R: 1 << 5,
        GAMEPAD_ZL: 1 << 6,
        GAMEPAD_ZR: 1 << 7,
        GAMEPAD_LEFT: 1 << 8,
        GAMEPAD_RIGHT: 1 << 9,
        GAMEPAD_UP: 1 << 10,
        GAMEPAD_DOWN: 1 << 11,
        GAMEPAD_PLUS: 1 << 12,
        GAMEPAD_MINUS: 1 << 13,
        GAMEPAD_L_STICK: 1 << 14,
        GAMEPAD_R_STICK: 1 << 15,
        WII_REMOTE_1: 1 << 16,
        WII_REMOTE_2: 1 << 17,
        WII_REMOTE_A: 1 << 18,
        WII_REMOTE_B: 1 << 19,
        WII_REMOTE_DOWN: 1 << 20,
        WII_REMOTE_LEFT: 1 << 21,
        WII_REMOTE_MINUS: 1 << 22,
        WII_REMOTE_PLUS: 1 << 23,
        WII_REMOTE_RIGHT: 1 << 24,
        WII_REMOTE_UP: 1 << 25
    };

    var keyToButton = {
        Enter: buttons.GAMEPAD_A,
        " ": buttons.GAMEPAD_A,
        Escape: buttons.GAMEPAD_PLUS,
        Backspace: buttons.GAMEPAD_B,
        ArrowLeft: buttons.GAMEPAD_LEFT,
        ArrowRight: buttons.GAMEPAD_RIGHT,
        ArrowUp: buttons.GAMEPAD_UP,
        ArrowDown: buttons.GAMEPAD_DOWN,
        a: buttons.GAMEPAD_LEFT,
        A: buttons.GAMEPAD_LEFT,
        d: buttons.GAMEPAD_RIGHT,
        D: buttons.GAMEPAD_RIGHT,
        w: buttons.GAMEPAD_UP,
        W: buttons.GAMEPAD_UP,
        s: buttons.GAMEPAD_DOWN,
        S: buttons.GAMEPAD_DOWN,
        "+": buttons.GAMEPAD_PLUS,
        "-": buttons.GAMEPAD_MINUS
    };

    var inputState = {
        buttonValue: 0,
        touch: 0,
        screenX: -1,
        screenY: -1,
        movementX: 0,
        movementY: 0,
        physicalTouch: 0,
        touchLatchReads: 0
    };
    var activePointerId = null;
    var inputSuppressUntil = 0;

    function isInputSuppressed() {
        return Date.now() < inputSuppressUntil;
    }

    function clearTouchState() {
        inputState.touch = 0;
        inputState.screenX = -1;
        inputState.screenY = -1;
        inputState.movementX = 0;
        inputState.movementY = 0;
        inputState.physicalTouch = 0;
        inputState.touchLatchReads = 0;
        activePointerId = null;
    }

    global.__chromiumPortSuppressInput = function (durationMs) {
        inputSuppressUntil = Math.max(inputSuppressUntil, Date.now() + (durationMs || 450));
        clearTouchState();
    };

    function isChromiumPortUiEvent(evt) {
        var node = evt && evt.target;
        while (node && node !== global && node !== global.document) {
            if (node.id === "chromium-port-settings" || node.id === "chromium-port-settings-panel" || node.id === "chromium-port-settings-button" || node.id === "chromium-port-mobile-controls" || node.id === "chromium-port-mobile-pause") {
                return true;
            }
            node = node.parentNode;
        }
        return false;
    }

    function updateTouchFromEvent(evt, active, keepClamped) {
        var rect;
        var gp = global.document && global.document.getElementById("gp-container");
        if (global.__chromiumPortGamepadRect) {
            rect = global.__chromiumPortGamepadRect;
        } else if (gp && gp.getBoundingClientRect) {
            rect = gp.getBoundingClientRect();
        } else if (global.document && global.document.querySelector) {
            gp = global.document.querySelector('canvas[name="gamepad"]');
            rect = gp && gp.getBoundingClientRect ? gp.getBoundingClientRect() : null;
        } else {
            rect = null;
        }
        rect = rect || { left: 0, top: 0, width: 854, height: 480 };
        var x = (evt.clientX - rect.left) * (854 / Math.max(1, rect.width || 854));
        var y = (evt.clientY - rect.top) * (480 / Math.max(1, rect.height || 480));
        var inBounds = active && (keepClamped || (x >= 0 && x < 854 && y >= 0 && y < 480));
        inputState.touch = inBounds ? 1 : 0;
        inputState.physicalTouch = inBounds ? 1 : 0;
        if (inBounds) {
            inputState.touchLatchReads = 2;
        }
        inputState.screenX = inBounds ? Math.max(0, Math.min(853, x)) : -1;
        inputState.screenY = inBounds ? Math.max(0, Math.min(479, y)) : -1;
    }

    function releaseTouch() {
        inputState.physicalTouch = 0;
        if (!inputState.touchLatchReads) {
            inputState.touch = 0;
            inputState.screenX = -1;
            inputState.screenY = -1;
        }
    }

    function getTouchValue() {
        if (inputState.physicalTouch) {
            return inputState.touch;
        }
        if (inputState.touch && inputState.touchLatchReads > 0) {
            inputState.touchLatchReads--;
            return 1;
        }
        inputState.touch = 0;
        inputState.screenX = -1;
        inputState.screenY = -1;
        return 0;
    }

    function bindInput() {
        if (bindInput._done) return;
        bindInput._done = true;
        global.addEventListener("keydown", function (evt) {
            var bit = keyToButton[evt.key];
            if (bit) {
                inputState.buttonValue |= bit;
                evt.preventDefault();
            }
        }, false);
        global.addEventListener("keyup", function (evt) {
            var bit = keyToButton[evt.key];
            if (bit) {
                inputState.buttonValue &= ~bit;
                evt.preventDefault();
            }
        }, false);
        global.addEventListener("pointerdown", function (evt) {
            if (isChromiumPortUiEvent(evt)) {
                return;
            }
            if (isInputSuppressed()) {
                clearTouchState();
                evt.preventDefault();
                return;
            }
            if (activePointerId !== null) {
                return;
            }
            updateTouchFromEvent(evt, true, false);
            if (inputState.touch) {
                activePointerId = evt.pointerId;
                if (evt.target && evt.target.setPointerCapture) {
                    try { evt.target.setPointerCapture(evt.pointerId); } catch (err) {}
                }
                evt.preventDefault();
            }
        }, false);
        // pointermove is high-frequency. Registering it non-passive and calling
        // preventDefault forces Android Chrome onto the slow input path, where it
        // must dispatch every move to the main thread and wait before compositing
        // the next frame -- which starves the game's render loop and makes it
        // stutter while touching (worse the faster you tap). The container already
        // has touch-action:none, so the browser won't scroll/zoom anyway and the
        // preventDefault is redundant. Make this listener passive instead.
        global.addEventListener("pointermove", function (evt) {
            if (isChromiumPortUiEvent(evt)) {
                return;
            }
            if (isInputSuppressed()) {
                clearTouchState();
                return;
            }
            if (activePointerId === evt.pointerId) {
                updateTouchFromEvent(evt, true, true);
            }
        }, { passive: true });
        global.addEventListener("pointerup", function (evt) {
            if (isChromiumPortUiEvent(evt)) {
                return;
            }
            if (isInputSuppressed()) {
                clearTouchState();
                evt.preventDefault();
                return;
            }
            if (activePointerId === evt.pointerId) {
                releaseTouch();
                if (evt.target && evt.target.releasePointerCapture) {
                    try { evt.target.releasePointerCapture(evt.pointerId); } catch (err) {}
                }
                activePointerId = null;
                evt.preventDefault();
            }
        }, false);
        global.addEventListener("pointercancel", function (evt) {
            if (isChromiumPortUiEvent(evt)) {
                return;
            }
            if (activePointerId === evt.pointerId) {
                releaseTouch();
                activePointerId = null;
                evt.preventDefault();
            }
        }, false);
    }

    function makeController() {
        var c = {
            connected: true,
            batteryLevel: 5,
            buttons: {},
            controlPad: {},
            touchPanel: {
                setScreenResolution: function () {}
            },
            leftStick: {},
            rightStick: {}
        };
        EventTargetShim.call(c);
        c._listeners = {};
        c.addEventListener = EventTargetShim.prototype.addEventListener;
        c.removeEventListener = EventTargetShim.prototype.removeEventListener;
        c.removeAllEventListeners = EventTargetShim.prototype.removeAllEventListeners;
        c.dispatchEvent = EventTargetShim.prototype.dispatchEvent;
        return c;
    }

    var controller = makeController();
    Object.defineProperty(controller.buttons, "buttonValue", { get: function () { return inputState.buttonValue; } });
    Object.defineProperty(controller.controlPad, "directionX", { get: function () {
        if (inputState.buttonValue & buttons.GAMEPAD_LEFT) return -1;
        if (inputState.buttonValue & buttons.GAMEPAD_RIGHT) return 1;
        return 0;
    } });
    Object.defineProperty(controller.controlPad, "directionY", { get: function () {
        if (inputState.buttonValue & buttons.GAMEPAD_UP) return -1;
        if (inputState.buttonValue & buttons.GAMEPAD_DOWN) return 1;
        return 0;
    } });
    Object.defineProperty(controller.leftStick, "movementX", { get: function () { return controller.controlPad.directionX; } });
    Object.defineProperty(controller.leftStick, "movementY", { get: function () { return controller.controlPad.directionY; } });
    Object.defineProperty(controller.rightStick, "movementX", { get: function () { return controller.controlPad.directionX; } });
    Object.defineProperty(controller.rightStick, "movementY", { get: function () { return controller.controlPad.directionY; } });
    Object.defineProperty(controller.touchPanel, "touch", { get: getTouchValue });
    Object.defineProperty(controller.touchPanel, "screenX", { get: function () { return inputState.screenX; } });
    Object.defineProperty(controller.touchPanel, "screenY", { get: function () { return inputState.screenY; } });

    global.ChromiumPortInput = {
        buttons: buttons,
        setButton: function (button, pressed) {
            if (!button) {
                return;
            }
            if (pressed) {
                inputState.buttonValue |= button;
            } else {
                inputState.buttonValue &= ~button;
            }
        },
        pressButton: function (button, durationMs) {
            this.setButton(button, true);
            global.setTimeout(function () {
                global.ChromiumPortInput.setButton(button, false);
            }, Math.max(34, durationMs || 90));
        }
    };

    function Directory(path) {
        this.systemPath = normalizePath(path || "");
        this.directoryName = this.systemPath.replace(/\/$/, "").split("/").pop() || this.systemPath;
    }
    Directory.prototype.create = function (name) {
        return new Directory(this.systemPath + normalizePath(name) + "/");
    };
    Directory.prototype.remove = function (name) {
        return File.removeFile(this.systemPath + normalizePath(name));
    };
    Directory.prototype.listSubDirectories = function () {
        if (!this.systemPath) {
            return [new Directory("templates/")];
        }
        return [];
    };
    Directory.prototype.listFiles = function () {
        var files = [];
        if (this.systemPath === "templates/") {
            return ["map0.json", "map1.json", "map2.json"].map(function (name) {
                return new File(name, new Directory("templates/"));
            });
        }
        if (saveFS && saveFS.listFiles) {
            var names = saveFS.listFiles(this.systemPath);
            for (var i = 0; i < names.length; ++i) {
                files.push(new File(names[i], this));
            }
        }
        return files;
    };
    Directory.appAccountSaveDirectory = new Directory("save/");
    Directory.appRootDirectory = new Directory("");

    function normalizePath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    }

    function setFileNameParts(file) {
        var leaf = file.systemPath.split("/").pop() || "";
        var dot = leaf.lastIndexOf(".");
        if (dot > 0) {
            file.fileName = leaf.substr(0, dot);
            file.fileExtension = leaf.substr(dot + 1);
        } else {
            file.fileName = leaf;
            file.fileExtension = "";
        }
    }

    function File(name, directory) {
        EventTargetShim.call(this);
        if (directory && directory.systemPath) {
            this.systemPath = normalizePath(directory.systemPath + "/" + name);
        } else {
            this.systemPath = normalizePath(name);
        }
        setFileNameParts(this);
        this.exists = !!(saveFS && saveFS.exists && saveFS.exists(this.systemPath));
        this.size = this.exists && saveFS && saveFS.size ? saveFS.size(this.systemPath) : 0;
        if (!this.exists && this.systemPath.indexOf("templates/") === 0) {
            this.exists = true;
            this.size = 1;
        }
    }
    File.prototype = Object.create(EventTargetShim.prototype);
    File.prototype.constructor = File;
    File.prototype.save = function (blob) {
        var self = this;
        function finish(data) {
            if (!saveFS || !saveFS.writeFile) {
                self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
                return;
            }
            saveFS.writeFile(self.systemPath, data).then(function () {
                self.exists = true;
                self.size = data instanceof Blob ? data.size : String(data || "").length;
                self.dispatchEvent(nwf.events.IOEvent.SAVE_COMPLETE, { errorID: 0 });
            }).catch(function () {
                self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
            });
        }
        if (blob instanceof Blob) {
            finish(blob);
        } else {
            finish(String(blob || ""));
        }
        return 0;
    };
    File.prototype.read = function () {
        var self = this;
        setTimeout(function () {
            if (self.systemPath.indexOf("templates/") === 0 && global.fetch) {
                global.fetch(self.systemPath).then(function (response) {
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    return response.blob();
                }).then(function (blob) {
                    self.dispatchEvent(nwf.events.IOEvent.READ_COMPLETE, { errorID: 0, data: blob });
                }).catch(function () {
                    self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
                });
                return;
            }
            if (!saveFS || !saveFS.readFile) {
                self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
                return;
            }
            saveFS.readFile(self.systemPath).then(function (blob) {
                if (blob === null || blob === undefined) {
                    self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
                    return;
                }
                self.dispatchEvent(nwf.events.IOEvent.READ_COMPLETE, { errorID: 0, data: blob });
            }).catch(function () {
                self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
            });
        }, 0);
        return 0;
    };
    File.prototype.readAsTextureBundle = function () {
        var self = this;
        if (!global.ChromiumPort || !global.ChromiumPort.loadGtxBundle) {
            setTimeout(function () { self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 }); }, 0);
            return 1;
        }
        global.ChromiumPort.loadGtxBundle(self.systemPath).then(function (bundle) {
            self.dispatchEvent(nwf.events.IOEvent.READ_COMPLETE, { errorID: 0, data: bundle });
        }).catch(function (err) {
            console.error(err);
            self.dispatchEvent(nwf.events.IOEvent.ERROR, { errorID: 1 });
        });
        return 0;
    };
    File.removeFile = function (path) {
        if (saveFS && saveFS.removeFile) {
            saveFS.removeFile(normalizePath(path)).catch(function () {});
        }
        return 0;
    };
    var systemLocale = localeConfig();
    var systemInstance = {
        version: "Chromium shim",
        regionCode: systemLocale.regionCode,
        languageCode: systemLocale.languageCode,
        countryCode: systemLocale.countryCode,
        reloadCount: 0,
        homeButtonEnabled: false,
        returnToMenu: function () {},
        relaunchTitle: function () { global.location.reload(); },
        getLaunchParams: function () { return { caller: 0 }; },
        flushStorageAsync: function () {
            var self = this;
            setTimeout(function () { self.dispatchEvent("flushStorageComplete", { errorID: 0 }); }, 0);
            return 0;
        }
    };
    EventTargetShim.call(systemInstance);
    systemInstance.addEventListener = EventTargetShim.prototype.addEventListener;
    systemInstance.removeEventListener = EventTargetShim.prototype.removeEventListener;
    systemInstance.removeAllEventListeners = EventTargetShim.prototype.removeAllEventListeners;
    systemInstance.dispatchEvent = EventTargetShim.prototype.dispatchEvent;

    var nextOfflineDataID = 100000;

    // Draws a generic "unregistered user" avatar (Miiverse-style grey silhouette)
    // into a canvas. Shared default when no profile photo is available.
    function drawDefaultAvatar(ctx, w, h) {
        ctx.save();
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#aac4e0"); g.addColorStop(1, "#8aa6c6");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#eef3fa";
        ctx.beginPath(); ctx.arc(w / 2, h * 0.40, w * 0.19, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w / 2, h * 1.02, w * 0.36, Math.PI, 0); ctx.fill();
        ctx.restore();
    }
    global.__chromiumDrawDefaultAvatar = drawDefaultAvatar;

    function makeOfflineMii(name) {
        return {
            name: name || "Chromium",
            serialize: function () {
                var bytes = new Uint8Array(96);
                var text = this.name || "Chromium";
                for (var i = 0; i < text.length && i < bytes.length; ++i) {
                    bytes[i] = text.charCodeAt(i) & 0xff;
                }
                return bytes.buffer;
            },
            // The game renders Mii icons into a canvas; with no real Mii service
            // here, paint the default user avatar so the icon slot is never empty
            // and never throws (LocalDataProvider, profiles, etc.).
            renderIcon: function (canvas, cb) {
                try {
                    var ctx = canvas && canvas.getContext && canvas.getContext("2d");
                    if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawDefaultAvatar(ctx, canvas.width, canvas.height); }
                } catch (e) {}
                if (cb) try { cb(); } catch (e) {}
            },
            setExpression: function () {},
            getImage: function () { return null; }
        };
    }

    function makeAsyncService(successEvent, failureEvent) {
        var service = new EventTargetShim();
        function fire(type, extra) {
            setTimeout(function () {
                service.dispatchEvent(type, Object.assign({ errorCode: 0, result: [], data: [] }, extra || {}));
            }, 0);
        }
        service.initialize = function () { fire(successEvent || "success"); return 0; };
        service.launchPortal = function () {};
        service.getCommunityList = function () { fire("downloadCommunitySuccess", { communities: [] }); };
        service.downloadUserData = function () { fire("downloadUserDataListSuccess", { users: [] }); };
        service.getPostList = function () { fire("downloadPostSuccess", { posts: [] }); };
        service.getCommentList = function () { fire("downloadCommentSuccess", { comments: [] }); };
        service.sendPost = function () { fire("uploadPostSuccess", { postID: "offline-post-" + Date.now(), uploadResult: {} }); };
        service.uploadPost = service.sendPost;
        service.deletePost = function () { fire("deletePostSuccess"); };
        service.sendComment = function () { fire("uploadCommentSuccess", { uploadResult: {} }); };
        service.uploadComment = service.sendComment;
        service.addEmpathy = function () { fire("addEmpathySuccess"); };
        service.removeEmpathy = function () { fire("removeEmpathySuccess"); };
        service.followUser = function () { fire("followUserSuccess"); };
        service.unfollowUser = function () { fire("unfollowUserSuccess"); };
        service.isLoggedIn = false;
        service.isBound = false;
        service.login = function () { service.isLoggedIn = true; fire(successEvent || "success"); return 0; };
        service.logout = function () { service.isLoggedIn = false; return 0; };
        service.bind = function () { service.isBound = true; return true; };
        service.search = function () { fire(failureEvent || "failed", { errorCode: 1 }); };
        service.upload = function () { fire(failureEvent || "failed", { errorCode: 1 }); };
        service.download = function () { fire(failureEvent || "failed", { errorCode: 1 }); };
        service.delete = function () { fire(failureEvent || "failed", { errorCode: 1 }); };
        service.uploadData = function (object) {
            var dataID = "offline-data-" + (nextOfflineDataID++);
            fire("uploadDataSuccess", { dataID: dataID, data: object || null });
        };
        service.updateData = function () { fire("updateDataSuccess"); };
        service.deleteData = function () { fire("deleteDataSuccess"); };
        service.downloadData = function () { fire("downloadDataFailed", { errorCode: 1096005 }); };
        service.downloadPersistentData = function () { fire("downloadDataFailed", { errorCode: 1096005 }); };
        service.downloadBatchData = function () { fire("downloadBatchDataSuccess", { batchResults: [] }); };
        service.dataSearch = function () { fire("searchSuccess", { results: [] }); };
        service.rateData = function () { fire("rateDataSuccess"); };
        service.completeSuspendedData = function () { fire("completeSuspendedObjectSuccess"); };
        return service;
    }

    function createDisplay() {
        var animations = {};
        var nextAnimationHandle = 1;
        function drawAnimation(ctx, entry) {
            var anim = entry.animation;
            var img = anim && anim.image;
            var cellWidth;
            var cellHeight;
            var columns;
            var frameCount;
            var loopStart;
            var loopEnd;
            var frameIndex;
            var sx;
            var sy;
            var oldAlpha;
            var fadeAlpha = 1;
            var removeAlpha = 1;
            var frameStep = getAnimationFrameStep();

            if (!ctx || !img) {
                return;
            }

            cellWidth = anim.cellWidth || img.width || 0;
            cellHeight = anim.cellHeight || img.height || 0;
            if (!cellWidth || !cellHeight) {
                return;
            }

            columns = Math.max(1, ~~(img.width / cellWidth));
            frameCount = Math.max(1, columns * Math.max(1, ~~(img.height / cellHeight)));
            loopStart = Math.max(0, Math.min(frameCount - 1, anim.loopStart || 0));
            loopEnd = anim.loopEnd ? Math.max(loopStart + 1, Math.min(frameCount, anim.loopEnd)) : frameCount;

            if (anim.loop && loopEnd > loopStart) {
                if (entry.frame < loopEnd) {
                    frameIndex = Math.min(frameCount - 1, ~~entry.frame);
                } else {
                    frameIndex = loopStart + (~~(entry.frame - loopEnd) % (loopEnd - loopStart));
                }
            } else {
                frameIndex = Math.min(frameCount - 1, ~~entry.frame);
            }

            sx = (frameIndex % columns) * cellWidth;
            sy = ~~(frameIndex / columns) * cellHeight;

            if (entry.fade > 0) {
                fadeAlpha = Math.min(1, entry.age / entry.fade);
            }
            if (entry.removeFade > 0) {
                removeAlpha = Math.max(0, 1 - (entry.removeAge / entry.removeFade));
            }

            ctx.save();
            if (ctx.identity) {
                ctx.identity();
            } else if (ctx.setTransform) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            oldAlpha = ctx.globalAlpha;
            ctx.globalAlpha = oldAlpha * fadeAlpha * removeAlpha;
            ctx.drawImage(img, sx, sy, cellWidth, cellHeight, entry.x, entry.y, cellWidth, cellHeight);
            ctx.globalAlpha = oldAlpha;
            ctx.restore();

            entry.age += frameStep;
            if (entry.removeFade > 0) {
                entry.removeAge += frameStep;
            }
            entry.frame += Math.max(0.01, anim.playrate || 1) * frameStep;
            if (!anim.loop && entry.frame >= frameCount) {
                entry.frame = frameCount - 1;
            }
            return !(entry.removeFade > 0 && entry.removeAge >= entry.removeFade);
        }
        return {
            setViewportFilter: function () {},
            setViewport: function () {},
            addAnimation: function (animation, x, y, fade) {
                var handle = nextAnimationHandle++;
                animations[handle] = { animation: animation, x: x || 0, y: y || 0, fade: Math.max(0, fade || 0), frame: 0, age: 0, removeFade: 0, removeAge: 0 };
                return handle;
            },
            translateAnimation: function (handle, x, y) {
                if (animations[handle]) {
                    animations[handle].x = x || 0;
                    animations[handle].y = y || 0;
                }
            },
            removeAnimation: function (handle, fade) {
                if (animations[handle] && fade > 0) {
                    animations[handle].removeFade = fade;
                    animations[handle].removeAge = 0;
                } else {
                    delete animations[handle];
                }
            },
            removeAllAnimations: function (fade) {
                var keys;
                var i;
                if (fade > 0) {
                    keys = Object.keys(animations);
                    for (i = 0; i < keys.length; ++i) {
                        animations[keys[i]].removeFade = fade;
                        animations[keys[i]].removeAge = 0;
                    }
                } else {
                    animations = {};
                }
            },
            drawAnimations: function (ctx) {
                var keys = Object.keys(animations);
                var i;
                for (i = 0; i < keys.length; ++i) {
                    if (!drawAnimation(ctx, animations[keys[i]])) {
                        delete animations[keys[i]];
                    }
                }
            }
        };
    }

    var miiverseService = makeAsyncService("initializationSuccess", "initializationFailed");
    var dataStoreService = makeAsyncService("loginSuccess", "loginFailed");
    var gameServerService = makeAsyncService("loginSuccess", "loginFailed");
    var tvDisplay = createDisplay();
    var gamePadDisplay = createDisplay();

    global.nwf = {
        system: {
            isWiiU: function () { return true; },
            WiiUSystem: { getInstance: function () { return systemInstance; } },
            WiiURegionCode: { JPN: 0, USA: 1, EUR: 2 },
            WiiULanguageCode: {
                JAPANESE: 0, ENGLISH: 1, SPANISH: 2, FRENCH: 3, GERMAN: 4,
                ITALIAN: 5, DUTCH: 6, PORTUGUESE: 7, RUSSIAN: 8
            },
            SystemCallerType: { CALLER_TYPE_NONE: 0, CALLER_TYPE_MIIVERSE: 1 },
            SystemErrorCode: {
                WEBKIT_ASSET_LOAD_FAIL: 1,
                WEBKIT_MEM_ALLOC_FAIL: 2,
                OLV_OPERATION_CANCELED: 1159999,
                OLV_HTTP_NOT_FOUND: 1154040,
                NEX_DATA_STORE_ID_NOT_FOUND: 1096005,
                NEX_DATA_STORE_VALUE_DOES_NOT_MATCH: 1096084
            },
            Memory: {
                setObjectCacheCapacities: function () {},
                requestGC: function () {},
                forceGC: function () {}
            },
            Stats: {
                getMemoryAllocSizes: function () {
                    return {
                        wkDefaultMaxAllocSize: 64 * 1024 * 1024,
                        jscDefaultMaxAllocSize: 64 * 1024 * 1024
                    };
                },
                getMemoryStats: function () {
                    return {
                        wkDefaultFreeMemory: 256 * 1024 * 1024,
                        jscDefaultFreeMemory: 256 * 1024 * 1024
                    };
                }
            },
            Performance: {}
        },
        display: {
            DisplayManager: {
                getInstance: function () {
                    return {
                        getTVDisplay: function () { return tvDisplay; },
                        getGamePadDisplay: function () { return gamePadDisplay; }
                    };
                }
            }
        },
        input: {
            ControllerButton: buttons,
            BatteryLevel: { LOW: 1 },
            WiiUGamePad: { getController: function () { bindInput(); return controller; } },
            WiiRemote: { REMOTE_1: 0, REMOTE_2: 1, REMOTE_3: 2, REMOTE_4: 3, getController: function () { return controller; } },
            control: { TouchControl: { TOUCH_INVALID_XY: -1, TOUCH_VALID: 1 } },
            SoftwareKeyboardInvalidChars: { INVALID_CHAR_LINEFEED: 1, INVALID_CHAR_ATMARK: 2 },
            SoftwareKeyboardFlags: { FLAG_ALL: 0xffff, FLAG_HAND: 1 },
            SoftwareKeyboard: {
                INPUT_FORM_TYPE_MONOSPACE: 1,
                USER_OK: 1,
                USER_CANCEL: 0,
                invoke: function (callback, settings) {
                    var text = global.prompt(settings && settings.body || "Name", settings && settings.text || "");
                    setTimeout(function () {
                        callback({ user_select: text === null ? 0 : 1, text: text || "" });
                    }, 0);
                    return 0;
                }
            }
        },
        events: {
            IOEvent: { READ_COMPLETE: "readComplete", SAVE_COMPLETE: "saveComplete", ERROR: "error" },
            SystemEvent: { FLUSH_STORAGE_COMPLETE: "flushStorageComplete" },
            SystemErrorEvent: { ERROR: "systemError", CRASH: "systemCrash" },
            ControllerEvent: { CONTROLLER_CONNECTED: "controllerConnected", CONTROLLER_DISCONNECTED: "controllerDisconnected" },
            MiiverseEvent: {
                INITIALIZATION_SUCCESS: "initializationSuccess",
                INITIALIZATION_FAILED: "initializationFailed",
                DOWNLOAD_COMMUNITY_SUCCESS: "downloadCommunitySuccess",
                DOWNLOAD_COMMUNITY_FAILED: "downloadCommunityFailed",
                DOWNLOAD_USER_DATA_LIST_SUCCESS: "downloadUserDataListSuccess",
                DOWNLOAD_USER_DATA_LIST_FAILED: "downloadUserDataListFailed",
                UPLOAD_POST_SUCCESS: "uploadPostSuccess",
                UPLOAD_POST_FAILED: "uploadPostFailed",
                DELETE_POST_SUCCESS: "deletePostSuccess",
                DELETE_POST_FAILED: "deletePostFailed",
                DOWNLOAD_POST_SUCCESS: "downloadPostSuccess",
                DOWNLOAD_POST_FAILED: "downloadPostFailed",
                UPLOAD_COMMENT_SUCCESS: "uploadCommentSuccess",
                UPLOAD_COMMENT_FAILED: "uploadCommentFailed",
                DOWNLOAD_COMMENT_SUCCESS: "downloadCommentSuccess",
                DOWNLOAD_COMMENT_FAILED: "downloadCommentFailed",
                ADD_EMPATHY_SUCCESS: "addEmpathySuccess",
                ADD_EMPATHY_FAILED: "addEmpathyFailed",
                REMOVE_EMPATHY_SUCCESS: "removeEmpathySuccess",
                REMOVE_EMPATHY_FAILED: "removeEmpathyFailed",
                FOLLOW_USER_SUCCESS: "followUserSuccess",
                FOLLOW_USER_FAILED: "followUserFailed",
                UNFOLLOW_USER_SUCCESS: "unfollowUserSuccess",
                UNFOLLOW_USER_FAILED: "unfollowUserFailed"
            },
            NexEvent: {
                LOGIN_SUCCESS: "loginSuccess",
                LOGIN_FAILED: "loginFailed",
                SEARCH_SUCCESS: "searchSuccess",
                SEARCH_FAILED: "searchFailed",
                UPLOAD_SUCCESS: "uploadSuccess",
                UPLOAD_FAILED: "uploadFailed",
                DOWNLOAD_SUCCESS: "downloadSuccess",
                DOWNLOAD_FAILED: "downloadFailed",
                DELETE_SUCCESS: "deleteSuccess",
                DELETE_FAILED: "deleteFailed"
            },
            GameServerEvent: {
                DISCONNECTED: "disconnected",
                LOGIN_SUCCESS: "loginSuccess",
                LOGIN_FAILED: "loginFailed"
            },
            DataStoreEvent: {
                UPLOAD_DATA_SUCCESS: "uploadDataSuccess",
                UPLOAD_DATA_FAILED: "uploadDataFailed",
                UPDATE_DATA_SUCCESS: "updateDataSuccess",
                UPDATE_DATA_FAILED: "updateDataFailed",
                DELETE_DATA_SUCCESS: "deleteDataSuccess",
                DELETE_DATA_FAILED: "deleteDataFailed",
                DOWNLOAD_DATA_SUCCESS: "downloadDataSuccess",
                DOWNLOAD_DATA_FAILED: "downloadDataFailed",
                DOWNLOAD_BATCH_DATA_SUCCESS: "downloadBatchDataSuccess",
                DOWNLOAD_BATCH_DATA_FAILED: "downloadBatchDataFailed",
                SEARCH_DATA_SUCCESS: "searchDataSuccess",
                SEARCH_DATA_FAILED: "searchDataFailed",
                SEARCH_SUCCESS: "searchSuccess",
                SEARCH_FAILED: "searchFailed",
                RATE_DATA_SUCCESS: "rateDataSuccess",
                RATE_DATA_FAILED: "rateDataFailed",
                COMPLETE_SUSPENDED_OBJECT_SUCCESS: "completeSuspendedObjectSuccess",
                COMPLETE_SUSPENDED_OBJECT_FAILED: "completeSuspendedObjectFailed"
            }
        },
        io: {
            Directory: Directory,
            File: File,
            IOError: { ERROR_NONE: 0 }
        },
        act: {
            NintendoAccount: { RESTRICTION_NONE: 0, RESTRICTION_FULL: 2 },
            NintendoAccountManager: {
                getInstance: function () {
                    return {
                        getActiveAccount: function () {
                            return {
                                accountID: "ChromiumPlayer",
                                principalID: 1,
                                miiName: "Chromium",
                                miiverseRestrictionLevel: 0,
                                networkCommunicationAllowed: true
                            };
                        }
                    };
                }
            }
        },
        net: {
            Network: {
                isConnected: function () { return true; },
                reconnect: function () {
                    return true;
                },
                disconnect: function () {
                    return true;
                }
            }
        },
        mv: {
            Miiverse: { getInstance: function () { return miiverseService; } },
            MiiverseCommunitySearchParam: function () {},
            MiiverseUserDataSearchParam: function () {},
            MiiverseSearchParam: function () {},
            MiiversePostSearchParam: function () {},
            MiiverseCommentSearchParam: function () {},
            MiiversePostData: function () {},
            MiiverseCommentData: function () {},
            MiiverseUploadPost: function () {},
            MiiverseUploadComment: function () {},
            MiiversePortalStartParam: function () {}
        },
        nex: {
            GameServer: { getInstance: function () { return gameServerService; } },
            DataStore: { getInstance: function () { return dataStoreService; } },
            DataStoreSearchParam: function () {},
            DataStoreUploadObject: function () {},
            DataStoreUploadParam: function () {},
            DataStoreDownloadParam: function () {},
            DataStoreDeleteParam: function () {},
            DataStoreUpdateParam: function () {},
            DataStoreMetaInfo: function () {},
            DataStoreRatingInitParam: function () {},
            DataStorePermission: { PUBLIC: 0, FRIENDS: 1, PRIVATE: 2 },
            DataStoreSearchSortColumn: { CREATED_TIME: 0, UPDATED_TIME: 1, RATING0: 10 },
            DataStoreResultOption: { NONE: 0, GET_METABINARY: 1, GET_DATA: 2 },
            DataStoreSearchType: { SEARCH_TYPE_PUBLIC: 0, SEARCH_TYPE_SEND_FRIEND: 1, SEARCH_TYPE_SEND_SPECIFIED: 2 }
        },
        ui: {
            Animation: function (image, cellWidth, cellHeight, loop, loopStart, loopEnd) {
                this.image = image || null;
                this.cellWidth = cellWidth || (image && image.width) || 0;
                this.cellHeight = cellHeight || (image && image.height) || 0;
                this.loop = !!loop;
                this.loopStart = loopStart || 0;
                this.loopEnd = loopEnd || 0;
                this.playrate = 1;
            },
            Dialog: {
                DISPLAY_ALL: 0,
                DISPLAY_GAMEPAD: 1,
                DISPLAY_TV: 2,
                displayAlert: function (callback) { if (callback) setTimeout(callback, 0); return 0; },
                displayError: function (callback) { if (callback) setTimeout(callback, 0); return 0; },
                close: function () {}
            }
        },
        mii: {
            Mii: {
                getMyMii: function () { return makeOfflineMii("Chromium"); },
                getDefaultMiiList: function () { return [makeOfflineMii("Chromium")]; },
                deserialize: function () { return makeOfflineMii("Chromium"); }
            },
            MiiExpression: {
                NORMAL: 0,
                SMILE_OPEN_MOUTH: 1,
                LIKE_WINK_LEFT: 2,
                SURPRISE_OPEN_MOUTH: 3,
                FRUSTRATED: 4,
                SORROW: 5
            }
        },
        boss: {
            PlayReportSendMode: {
                IMMEDIATE: 0,
                IMMEDIATE_BACKGROUND: 1,
                BACKGROUND: 2
            },
            PlayReport: {
                isReady: false,
                getInstance: function () {
                    return {
                        initialize: function () { nwf.boss.PlayReport.isReady = true; },
                        set: function () {},
                        add: function () {},
                        send: function () {}
                    };
                }
            }
        },
        utils: {
            log: function (msg) { console.log(String(msg).replace(/\n$/, "")); }
        }
    };

    Object.defineProperty(global.nwf.system.Performance, "elapsedTime", { get: function () { return now(); } });
    Object.assign(global.nwf.mv.MiiverseSearchParam, {
        FILTER_WITH_MII_DATA: 1 << 0,
        FILTER_WITH_EMPATHY: 1 << 1,
        FILTER_WITH_SPOILER: 1 << 2,
        FILTER_FROM_FRIEND: 1 << 3,
        FILTER_FROM_FOLLOW: 1 << 4
    });
    global.nwf.mv.MiiversePostSearchParam = global.nwf.mv.MiiverseSearchParam;
    Object.assign(global.nwf.mv.MiiverseCommentSearchParam, {
        FILTER_WITH_MII_DATA: 1 << 0,
        FILTER_WITH_SPOILER: 1 << 2
    });

    global.webkitAudioContext = global.webkitAudioContext || global.AudioContext;
    if (global.AudioContext || global.webkitAudioContext) {
        var AudioCtx = global.AudioContext || global.webkitAudioContext;
        var audioProto = AudioCtx.prototype;
        audioProto.createGainNode = audioProto.createGainNode || audioProto.createGain;
        audioProto.createOutputDeviceNode = audioProto.createOutputDeviceNode || function () {
            var node = this.createGain();
            node.gain.value = 1;
            return node;
        };
        if (global.AudioBufferSourceNode) {
            var sourceProto = global.AudioBufferSourceNode.prototype;
            if (!sourceProto._chromiumPortPlaybackState) {
                sourceProto._chromiumPortPlaybackState = true;
                sourceProto._chromiumPortStart = sourceProto.start;
                sourceProto._chromiumPortStop = sourceProto.stop;
                sourceProto.noteOn = function () {
                    var self = this;
                    self.playing = true;
                    self.addEventListener("ended", function () {
                        self.playing = false;
                    }, { once: true });
                    return sourceProto._chromiumPortStart.apply(self, arguments);
                };
                sourceProto.noteOff = function () {
                    try {
                        return sourceProto._chromiumPortStop.apply(this, arguments);
                    } catch (err) {
                        this.playing = false;
                    }
                };
                sourceProto.resetAll = function () {
                    if (this.playing) {
                        return false;
                    }
                    try { this.disconnect(); } catch (err) {}
                    return true;
                };
            }
        }
        if (global.AudioListener) {
            var listenerProto = global.AudioListener.prototype;
            listenerProto.setPosition = listenerProto.setPosition || function (x, y, z) {
                if (this.positionX) {
                    this.positionX.value = x;
                    this.positionY.value = y;
                    this.positionZ.value = z;
                }
            };
            listenerProto.setOrientation = listenerProto.setOrientation || function (x, y, z, ux, uy, uz) {
                if (this.forwardX) {
                    this.forwardX.value = x;
                    this.forwardY.value = y;
                    this.forwardZ.value = z;
                    this.upX.value = ux;
                    this.upY.value = uy;
                    this.upZ.value = uz;
                }
            };
        }
        if (global.PannerNode) {
            var pannerProto = global.PannerNode.prototype;
            pannerProto.setPosition = pannerProto.setPosition || function (x, y, z) {
                if (this.positionX) {
                    this.positionX.value = x;
                    this.positionY.value = y;
                    this.positionZ.value = z;
                }
            };
            pannerProto.setOrientation = pannerProto.setOrientation || function (x, y, z) {
                if (this.orientationX) {
                    this.orientationX.value = x;
                    this.orientationY.value = y;
                    this.orientationZ.value = z;
                }
            };
        }
    }

    if (global.CanvasRenderingContext2D) {
        var proto = global.CanvasRenderingContext2D.prototype;
        proto.loadShader = proto.loadShader || function (path) {
            var key = String(path || "default");
            var registry = global.__chromiumPortShaderRegistry || (global.__chromiumPortShaderRegistry = {
                nextId: 1,
                byPath: Object.create(null),
                byId: Object.create(null)
            });
            if (!registry.byPath[key]) {
                registry.byPath[key] = registry.nextId++;
                registry.byId[registry.byPath[key]] = key;
            }
            return registry.byPath[key];
        };
        proto.setVertexUniformFloat = proto.setVertexUniformFloat || function (slot) {
            this.__nwfVertexUniforms = this.__nwfVertexUniforms || {};
            this.__nwfVertexUniforms[slot | 0] = Array.prototype.slice.call(arguments, 1);
        };
        proto.setPixelUniformFloat = proto.setPixelUniformFloat || function (slot) {
            this.__nwfPixelUniforms = this.__nwfPixelUniforms || {};
            this.__nwfPixelUniforms[slot | 0] = Array.prototype.slice.call(arguments, 1);
        };
        proto.setFillColor = proto.setFillColor || function (r, g, b, a) {
            this.fillStyle = "rgba(" + Math.round((r || 0) * 255) + "," + Math.round((g || 0) * 255) + "," + Math.round((b || 0) * 255) + "," + (a == null ? 1 : a) + ")";
        };
        proto.setStrokeColor = proto.setStrokeColor || function (r, g, b, a) {
            this.strokeStyle = "rgba(" + Math.round((r || 0) * 255) + "," + Math.round((g || 0) * 255) + "," + Math.round((b || 0) * 255) + "," + (a == null ? 1 : a) + ")";
        };
        proto.setImageColor = proto.setImageColor || function (r, g, b) {
            this._nwfImageColor = [r, g, b];
        };
        proto.drawImageInstanced = proto.drawImageInstanced || function (count, img, srcRects, dstRects, mat2Ds, colors) {
            count = count | 0;
            if (!img || !srcRects || !dstRects || count <= 0) return;

            var baseAlpha = this.globalAlpha;
            var baseColor = this._nwfImageColor || [1, 1, 1, 1];
            var sm = global.lib && global.lib.display && global.lib.display.ShaderManager;
            var parentShader = sm && Number.isFinite(sm.parentedTransform_textureShader_gtx) ? sm.parentedTransform_textureShader_gtx : null;
            var useParent = parentShader !== null && ((this.textureShader | 0) === (parentShader | 0));
            var u17 = this.__nwfVertexUniforms && this.__nwfVertexUniforms[17];
            var u18 = this.__nwfVertexUniforms && this.__nwfVertexUniforms[18];

            function f(value, fallback) {
                return Number.isFinite(value) ? value : fallback;
            }

            var pPosX = useParent ? f(u17 && u17[0], 0) : 0;
            var pPosY = useParent ? f(u17 && u17[1], 0) : 0;
            var pPivotX = useParent ? f(u17 && u17[2], 0) : 0;
            var pPivotY = useParent ? f(u17 && u17[3], 0) : 0;
            var pScaleX = useParent ? f(u18 && u18[0], 1) : 1;
            var pScaleY = useParent ? f(u18 && u18[1], 1) : 1;
            var pRot = useParent ? f(u18 && u18[2], 0) : 0;
            if (Math.abs(pScaleX) < 0.0001 || Math.abs(pScaleY) < 0.0001) return;

            for (var i = 0; i < count; ++i) {
                var s4 = i * 4;
                var s6 = i * 6;
                var sx = f(srcRects[s4], 0);
                var sy = f(srcRects[s4 + 1], 0);
                var sw = f(srcRects[s4 + 2], img.width);
                var sh = f(srcRects[s4 + 3], img.height);
                var dx = f(dstRects[s4], 0);
                var dy = f(dstRects[s4 + 1], 0);
                var dw = f(dstRects[s4 + 2], sw);
                var dh = f(dstRects[s4 + 3], sh);
                var pivotX = 0;
                var pivotY = 0;
                var scaleX = 1;
                var scaleY = 1;
                var rot = 0;
                var p5 = 1;
                if (mat2Ds && mat2Ds.length >= s6 + 6) {
                    pivotX = f(mat2Ds[s6], 0);
                    pivotY = f(mat2Ds[s6 + 1], 0);
                    scaleX = f(mat2Ds[s6 + 2], 1);
                    scaleY = f(mat2Ds[s6 + 3], 1);
                    rot = f(mat2Ds[s6 + 4], 0);
                    p5 = f(mat2Ds[s6 + 5], 1);
                }
                if (Math.abs(scaleX) < 0.0001 || Math.abs(scaleY) < 0.0001) continue;

                if (useParent) {
                    var flipX = p5 === 0 ? 1 : p5;
                    if (flipX !== 1) {
                        rot *= flipX;
                        scaleX *= flipX;
                    }
                }

                var alpha = 1;
                if (colors && colors.length >= s4 + 4 && Number.isFinite(colors[s4 + 3])) {
                    alpha = colors[s4 + 3];
                }

                this.save();
                this.globalAlpha = baseAlpha * alpha * f(baseColor[3], 1);

                if (useParent) {
                    this.translate(pPosX, pPosY);
                    if (pRot) this.rotate(pRot);
                    if (pScaleX !== 1 || pScaleY !== 1) this.scale(pScaleX, pScaleY);
                    if (pPivotX || pPivotY) this.translate(-pPivotX, -pPivotY);
                }

                this.translate(dx, dy);
                if (rot) this.rotate(rot);
                if (scaleX !== 1 || scaleY !== 1) this.scale(scaleX, scaleY);
                if (pivotX || pivotY) this.translate(-pivotX, -pivotY);

                try {
                    this.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
                } catch (err) {}
                this.restore();
            }
            this.globalAlpha = baseAlpha;
        };
    }

    function report(type, message, file, line) {
        listeners.push({ type: type, message: String(message), file: file || "", line: line || 0 });
        global.__chromiumPortErrors = listeners;
        var doc = global.document;
        if (!doc || !doc.body) return;
        var box = doc.getElementById("chromium-port-errors");
        if (!box) {
            box = doc.createElement("pre");
            box.id = "chromium-port-errors";
            box.style.cssText = "position:fixed;left:0;bottom:0;max-width:100%;max-height:45%;overflow:auto;z-index:999999;background:rgba(0,0,0,.86);color:#ffb4b4;font:12px monospace;text-align:left;padding:8px;white-space:pre-wrap;";
            doc.body.appendChild(box);
        }
        box.textContent = listeners.slice(-8).map(function (item) {
            return item.type + ": " + item.message + (item.file ? " @ " + item.file + ":" + item.line : "");
        }).join("\n");
    }

    var originalError = global.console && global.console.error;
    if (global.console) {
        global.console.error = function () {
            report("console.error", Array.prototype.join.call(arguments, " "));
            if (originalError) originalError.apply(global.console, arguments);
        };
    }

    global.addEventListener("error", function (evt) {
        report("error", evt.message, evt.filename, evt.lineno);
    });
    global.addEventListener("unhandledrejection", function (evt) {
        report("unhandledrejection", evt.reason && (evt.reason.stack || evt.reason.message) || evt.reason);
    });
})(window);
