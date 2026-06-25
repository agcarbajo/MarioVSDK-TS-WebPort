(function (global) {
    "use strict";

    var STORAGE_KEY = "chromiumPortLowPerformanceMode";
    var patchesInstalled = false;
    var enabledCache = false;

    function readEnabled() {
        try {
            return global.localStorage && global.localStorage.getItem(STORAGE_KEY) === "1";
        } catch (err) {
            return false;
        }
    }

    function isEnabled() {
        return !!enabledCache;
    }

    function setEnabled(enabled) {
        try {
            if (!global.localStorage) return;
            if (enabled) {
                global.localStorage.setItem(STORAGE_KEY, "1");
            } else {
                global.localStorage.removeItem(STORAGE_KEY);
            }
        } catch (err) {}
        applyBrowserHints();
    }

    function applyBrowserHints() {
        enabledCache = readEnabled();
        global.__chromiumPortLowPerformanceMode = enabledCache;
        if (global.document && document.documentElement) {
            document.documentElement.classList.toggle("chromium-port-low-performance", enabledCache);
        }
    }

    function patchCanvasContext() {
        if (!global.HTMLCanvasElement || HTMLCanvasElement.prototype.__chromiumPortLowPerfContextPatch) return;
        var originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function () {
            var ctx = originalGetContext.apply(this, arguments);
            if (ctx && arguments[0] === "2d") {
                try {
                    ctx.imageSmoothingEnabled = false;
                    ctx.webkitImageSmoothingEnabled = false;
                    ctx.mozImageSmoothingEnabled = false;
                    if (isEnabled()) {
                        ctx.shadowBlur = 0;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        ctx.filter = "none";
                    }
                } catch (err) {}
            }
            return ctx;
        };
        HTMLCanvasElement.prototype.__chromiumPortLowPerfContextPatch = true;
    }

    function patchGameEffects() {
        var EffectManager = global.pt && pt.asset && pt.asset.EffectManager;
        var GroundEffectManager = global.pt && pt.map && pt.map.GroundEffectManager;
        var screenEffect = global.pt && pt.game && pt.game.screenEffect;
        var BaseEmitter = global.lib && lib.effect && lib.effect.BaseEmitter;
        var Background = global.lib && lib.Graphic && lib.Graphic.Background;
        var TextPane = global.lib && lib.layout && lib.layout.TextPane;

        if (EffectManager && EffectManager.prototype && !EffectManager.prototype.__chromiumPortLowPerfPatch) {
            var originalDraw = EffectManager.prototype.draw;
            EffectManager.prototype.draw = function (ctx) {
                if (isEnabled()) return;
                return originalDraw.call(this, ctx);
            };
            EffectManager.prototype.__chromiumPortLowPerfPatch = true;
        }
        if (GroundEffectManager && GroundEffectManager.prototype && !GroundEffectManager.prototype.__chromiumPortLowPerfPatch) {
            var originalUpdate = GroundEffectManager.prototype.update;
            GroundEffectManager.prototype.update = function () {
                if (isEnabled()) return;
                return originalUpdate.apply(this, arguments);
            };
            GroundEffectManager.prototype.__chromiumPortLowPerfPatch = true;
        }

        if (screenEffect && !screenEffect.__chromiumPortLowPerfPatch) {
            var originalScreenUpdate = screenEffect.update;
            screenEffect.update = function () {
                if (isEnabled()) {
                    if (screenEffect.reset) screenEffect.reset();
                    return;
                }
                return originalScreenUpdate.apply(this, arguments);
            };
            screenEffect.__chromiumPortLowPerfPatch = true;
        }

        if (BaseEmitter && BaseEmitter.prototype && !BaseEmitter.prototype.__chromiumPortLowPerfPatch) {
            var originalEmitterRender = BaseEmitter.prototype.render;
            BaseEmitter.prototype.render = function () {
                if (isEnabled()) return;
                return originalEmitterRender.apply(this, arguments);
            };
            BaseEmitter.prototype.__chromiumPortLowPerfPatch = true;
        }

        if (Background && Background.prototype && !Background.prototype.__chromiumPortLowPerfPatch) {
            var originalBackgroundUpdate = Background.prototype.update;
            var originalBackgroundRender = Background.prototype.render;
            Background.prototype.update = function () {
                if (isEnabled()) return;
                return originalBackgroundUpdate.apply(this, arguments);
            };
            Background.prototype.render = function (ctx) {
                var oldSimpleBackgrounds;
                var renderedFallback;
                if (isEnabled() && this._renderFallback) {
                    oldSimpleBackgrounds = global.__chromiumPortSimpleBackgrounds;
                    global.__chromiumPortSimpleBackgrounds = true;
                    ctx.save();
                    try {
                        renderedFallback = this._renderFallback(ctx);
                    } finally {
                        ctx.restore();
                        global.__chromiumPortSimpleBackgrounds = oldSimpleBackgrounds;
                    }
                    if (renderedFallback) return;
                }
                return originalBackgroundRender.apply(this, arguments);
            };
            Background.prototype.__chromiumPortLowPerfPatch = true;
        }

        if (TextPane && TextPane.prototype && !TextPane.prototype.__chromiumPortLowPerfPatch) {
            var originalTextPreRender = TextPane.prototype.preRender;
            TextPane.prototype.preRender = function () {
                var shadow = this.shadow;
                if (isEnabled()) this.shadow = null;
                try {
                    return originalTextPreRender.apply(this, arguments);
                } finally {
                    this.shadow = shadow;
                }
            };
            TextPane.prototype.__chromiumPortLowPerfPatch = true;
        }

        patchesInstalled = !!(EffectManager && GroundEffectManager && BaseEmitter && Background && TextPane);
    }

    function installPatches() {
        patchCanvasContext();
        patchGameEffects();
    }

    applyBrowserHints();
    installPatches();

    global.ChromiumPortPerformanceMode = {
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        toggle: function () {
            setEnabled(!isEnabled());
            return isEnabled();
        },
        apply: applyBrowserHints,
        installPatches: installPatches
    };

    if (global.document) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", applyBrowserHints);
        } else {
            applyBrowserHints();
        }
    }

    global.setInterval(function () {
        applyBrowserHints();
        if (!patchesInstalled) installPatches();
    }, 500);
})(window);
