(function (global) {
    "use strict";

    var STORAGE_KEY = "chromiumPortViewMode";
    var ROOT_ID = "chromium-port-settings";
    var BUTTON_ID = "chromium-port-settings-button";
    var PANEL_ID = "chromium-port-settings-panel";
    var FRAME_RATE_STORAGE_KEY = "chromiumPortFrameRate";
    var LANGUAGE_STORAGE_KEY = "chromiumPortLanguage";
    var MUSIC_VOLUME_STORAGE_KEY = "chromiumPortMusicVolume";
    var SFX_VOLUME_STORAGE_KEY = "chromiumPortSfxVolume";
    var PORT_VERSION = global.__chromiumPortPortVersion || "0.9.4";
    var currentMode = "gp";
    var panelOpen = false;
    var lastLayoutSignature = "";

    var UI_TEXT = {
        en: {
            settings: "Settings",
            gamepadOnly: "GamePad only",
            twoScreens: "Two screens",
            fullscreen: "Fullscreen",
            exitFullscreen: "Exit fullscreen",
            fps: "FPS",
            language: "Language",
            musicVolume: "Music",
            sfxVolume: "Sounds",
            lowPerformance: "Low performance",
            system: "System",
            portVersion: "Port version",
            unlockAll: "Unlock everything",
            unlockAllDone: "Everything unlocked",
            resetProgress: "Reset progress",
            unlockAllWait: "Wait for save data",
            unlockAllSaved: "Saved. Reloading...",
            exportSave: "Export save",
            importSave: "Import save",
            exportQrSave: "Show transfer QR",
            importQrSave: "Read transfer QR",
            saveFileTitle: "File backup",
            saveFileHint: "Export or restore a JSON save file.",
            saveQrTitle: "Direct QR transfer",
            saveQrHint: "Move a save between nearby devices.",
            saveData: "Save data",
            display: "Display",
            audio: "Audio",
            gameplay: "Gameplay",
            advanced: "Advanced",
            importDone: "Imported. Reloading...",
            exportFailed: "Export failed",
            importFailed: "Import failed",
            reloading: "Reloading..."
        },
        es: {
            settings: "Ajustes",
            gamepadOnly: "Solo GamePad",
            twoScreens: "Dos pantallas",
            fullscreen: "Pantalla completa",
            exitFullscreen: "Salir de pantalla completa",
            fps: "FPS",
            language: "Idioma",
            musicVolume: "Música",
            sfxVolume: "Sonidos",
            lowPerformance: "Modo bajo rendimiento",
            system: "Sistema",
            portVersion: "Versión del port",
            unlockAll: "Desbloquear todo",
            unlockAllDone: "Todo desbloqueado",
            resetProgress: "Restablecer progreso",
            unlockAllWait: "Espera al guardado",
            unlockAllSaved: "Guardado. Recargando...",
            exportSave: "Exportar guardado",
            importSave: "Importar guardado",
            exportQrSave: "Mostrar QR de guardado",
            importQrSave: "Leer QR de guardado",
            saveFileTitle: "Copia por archivo",
            saveFileHint: "Exporta o restaura un archivo JSON de guardado.",
            saveQrTitle: "Transferencia QR directa",
            saveQrHint: "Mueve una partida entre dispositivos cercanos.",
            saveData: "Datos de guardado",
            display: "Pantalla",
            audio: "Audio",
            gameplay: "Juego",
            advanced: "Avanzado",
            importDone: "Importado. Recargando...",
            exportFailed: "Error al exportar",
            importFailed: "Error al importar",
            reloading: "Recargando..."
        },
        fr: {
            settings: "Options",
            gamepadOnly: "GamePad seul",
            twoScreens: "Deux ecrans",
            fullscreen: "Plein ecran",
            exitFullscreen: "Quitter le plein ecran",
            fps: "FPS",
            language: "Langue",
            musicVolume: "Musique",
            sfxVolume: "Sons",
            lowPerformance: "Mode performance",
            system: "Systeme",
            portVersion: "Version du port",
            unlockAll: "Tout debloquer",
            unlockAllDone: "Tout est debloque",
            resetProgress: "Reinitialiser",
            unlockAllWait: "Sauvegarde requise",
            unlockAllSaved: "Enregistre. Rechargement...",
            exportSave: "Exporter",
            importSave: "Importer",
            exportQrSave: "Afficher QR",
            importQrSave: "Lire QR",
            saveFileTitle: "Fichier local",
            saveFileHint: "Exporter ou restaurer un fichier JSON.",
            saveQrTitle: "Transfert QR",
            saveQrHint: "Transferer une sauvegarde entre appareils.",
            saveData: "Sauvegarde",
            display: "Affichage",
            audio: "Audio",
            gameplay: "Jeu",
            advanced: "Avance",
            importDone: "Importe. Rechargement...",
            exportFailed: "Echec export",
            importFailed: "Echec import",
            reloading: "Rechargement..."
        },
        de: {
            settings: "Optionen",
            gamepadOnly: "Nur GamePad",
            twoScreens: "Zwei Bildschirme",
            fullscreen: "Vollbild",
            exitFullscreen: "Vollbild beenden",
            fps: "FPS",
            language: "Sprache",
            musicVolume: "Musik",
            sfxVolume: "Sound",
            lowPerformance: "Leistungsmodus",
            system: "System",
            portVersion: "Port-Version",
            unlockAll: "Alles freischalten",
            unlockAllDone: "Alles freigeschaltet",
            resetProgress: "Fortschritt resetten",
            unlockAllWait: "Auf Speicherdaten warten",
            unlockAllSaved: "Gespeichert. Neustart...",
            exportSave: "Spielstand exportieren",
            importSave: "Spielstand importieren",
            exportQrSave: "Transfer-QR anzeigen",
            importQrSave: "Transfer-QR lesen",
            saveFileTitle: "Datei-Sicherung",
            saveFileHint: "JSON-Spielstand exportieren oder importieren.",
            saveQrTitle: "QR-Transfer",
            saveQrHint: "Spielstand zwischen Geraten ubertragen.",
            saveData: "Speicher",
            display: "Anzeige",
            audio: "Audio",
            gameplay: "Spiel",
            advanced: "Erweitert",
            importDone: "Importiert. Neustart...",
            exportFailed: "Export fehlgeschlagen",
            importFailed: "Import fehlgeschlagen",
            reloading: "Wird neu geladen..."
        },
        it: {
            settings: "Opzioni",
            gamepadOnly: "Solo GamePad",
            twoScreens: "Due schermi",
            fullscreen: "Schermo intero",
            exitFullscreen: "Esci da schermo intero",
            fps: "FPS",
            language: "Lingua",
            musicVolume: "Musica",
            sfxVolume: "Suoni",
            lowPerformance: "Basse prestazioni",
            system: "Sistema",
            portVersion: "Versione port",
            unlockAll: "Sblocca tutto",
            unlockAllDone: "Tutto sbloccato",
            resetProgress: "Ripristina progressi",
            unlockAllWait: "Attendi i salvataggi",
            unlockAllSaved: "Salvato. Ricarico...",
            exportSave: "Esporta salvataggio",
            importSave: "Importa salvataggio",
            exportQrSave: "Mostra QR",
            importQrSave: "Leggi QR",
            saveFileTitle: "File locale",
            saveFileHint: "Esporta o ripristina un salvataggio JSON.",
            saveQrTitle: "Trasferimento QR",
            saveQrHint: "Sposta il salvataggio tra dispositivi vicini.",
            saveData: "Salvataggio",
            display: "Schermo",
            audio: "Audio",
            gameplay: "Gioco",
            advanced: "Avanzate",
            importDone: "Importato. Ricarico...",
            exportFailed: "Errore export",
            importFailed: "Errore import",
            reloading: "Ricaricamento..."
        },
        ja: {
            settings: "設定",
            gamepadOnly: "GamePadのみ",
            twoScreens: "2画面",
            fullscreen: "全画面",
            exitFullscreen: "全画面を終了",
            fps: "FPS",
            language: "言語",
            musicVolume: "音楽",
            sfxVolume: "効果音",
            system: "システム",
            reloading: "再読み込み..."
        }
    };

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

    function readLanguageOverride() {
        if (global.ChromiumPort && ChromiumPort.getLanguageOverride) {
            return normalizeLanguage(ChromiumPort.getLanguageOverride());
        }
        try {
            return normalizeLanguage((global.localStorage && global.localStorage.getItem(LANGUAGE_STORAGE_KEY)) || "system");
        } catch (err) {
            return "system";
        }
    }

    function effectiveLanguage() {
        if (global.ChromiumPort && ChromiumPort.getEffectiveLanguage) {
            return normalizeLanguage(ChromiumPort.getEffectiveLanguage());
        }
        var override = readLanguageOverride();
        return override === "system" ? deviceLanguage() : override;
    }

    function text(key) {
        var lang = effectiveLanguage();
        return (UI_TEXT[lang] && UI_TEXT[lang][key]) || UI_TEXT.en[key] || key;
    }

    function setLanguageOverride(lang) {
        lang = normalizeLanguage(lang);
        if (global.ChromiumPort && ChromiumPort.setLanguageOverride) {
            ChromiumPort.setLanguageOverride(lang);
        } else {
            try {
                if (global.localStorage) {
                    if (lang === "system") {
                        global.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
                    } else {
                        global.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
                    }
                }
            } catch (err) {}
        }
    }

    function readMode() {
        try {
            var saved = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
            return saved === "both" ? "both" : "gp";
        } catch (err) {
            return "gp";
        }
    }

    function saveMode(mode) {
        try {
            if (global.localStorage) {
                global.localStorage.setItem(STORAGE_KEY, mode);
            }
        } catch (err) {}
    }

    function gamepadElement() {
        return document.getElementById("gp-container") || document.querySelector('canvas[name="gamepad"]');
    }

    function tvElement() {
        return document.getElementById("tv-container") || document.querySelector('canvas[name="tv"]');
    }

    function resetScreenStyle(el) {
        if (!el) return;
        el.style.position = "absolute";
        el.style.transformOrigin = "0 0";
        el.style.margin = "0";
        el.style.maxWidth = "none";
        el.style.maxHeight = "none";
    }

    function setScreenRect(el, left, top, scale) {
        if (!el) return;
        resetScreenStyle(el);
        el.style.display = "block";
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.transform = "scale(" + scale + ")";
    }

    function setOverlayRect(rect) {
        var root = document.getElementById(ROOT_ID);
        if (!root || !rect) return;
        root.style.left = rect.left + "px";
        root.style.top = rect.top + "px";
        root.style.width = rect.width + "px";
        root.style.height = rect.height + "px";
    }

    function publishGamepadRect(el) {
        if (!el || !el.getBoundingClientRect) return;
        var rect = el.getBoundingClientRect();
        global.__chromiumPortGamepadRect = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        };
        setOverlayRect(global.__chromiumPortGamepadRect);
    }

    function applyLayout() {
        var gp = gamepadElement();
        var tv = tvElement();
        var winW = Math.max(1, global.innerWidth || 854);
        var winH = Math.max(1, global.innerHeight || 480);
        var scale;
        var left;
        var top;

        if (!gp) return;

        if (currentMode === "both") {
            scale = Math.min(winW / 1280, winH / 1200);
            left = Math.max(0, Math.floor((winW - 1280 * scale) / 2));
            top = Math.max(0, Math.floor((winH - 1200 * scale) / 2));
            setScreenRect(gp, left, top, scale);
            setScreenRect(tv, left, top + Math.round(480 * scale), scale);
        } else {
            scale = Math.min(winW / 854, winH / 480);
            left = Math.max(0, Math.floor((winW - 854 * scale) / 2));
            top = Math.max(0, Math.floor((winH - 480 * scale) / 2));
            setScreenRect(gp, left, top, scale);
            if (tv) {
                tv.style.display = "none";
            }
        }

        publishGamepadRect(gp);
        updateSelectedOption();
    }

    function layoutSignature() {
        var gp = gamepadElement();
        var tv = tvElement();
        return [
            currentMode,
            global.innerWidth || 0,
            global.innerHeight || 0,
            gp ? (gp.tagName + ":" + (gp.getAttribute("name") || gp.id || "")) : "nogp",
            tv ? (tv.tagName + ":" + (tv.getAttribute("name") || tv.id || "")) : "notv"
        ].join("|");
    }

    function applyLayoutIfNeeded() {
        var signature = layoutSignature();
        if (signature !== lastLayoutSignature) {
            lastLayoutSignature = signature;
            applyLayout();
        }
    }

    function setMode(mode) {
        var previousMode = currentMode;
        var shouldHaveTvAssets;
        currentMode = mode === "both" ? "both" : "gp";
        saveMode(currentMode);
        shouldHaveTvAssets = currentMode === "both";
        if (previousMode !== currentMode && !!global.__chromiumPortLoadTvAssets !== shouldHaveTvAssets) {
            global.__chromiumPortLoadTvAssets = shouldHaveTvAssets;
            togglePanel(false);
            global.setTimeout(function () {
                global.location.reload();
            }, 120);
            return;
        }
        lastLayoutSignature = "";
        applyLayout();
    }

    function updateSelectedOption() {
        var panel = document.getElementById(PANEL_ID);
        var buttons;
        var lowPerformanceButton;
        var i;
        if (!panel) return;
        buttons = panel.querySelectorAll("[data-view-mode]");
        for (i = 0; i < buttons.length; ++i) {
            buttons[i].className = buttons[i].getAttribute("data-view-mode") === currentMode ? "selected" : "";
        }
        buttons = panel.querySelectorAll("[data-fps]");
        for (i = 0; i < buttons.length; ++i) {
            buttons[i].className = normalizeFrameRate(buttons[i].getAttribute("data-fps")) === readFrameRate() ? "selected" : "";
        }
        lowPerformanceButton = document.getElementById("chromium-port-low-performance-button");
        if (lowPerformanceButton) {
            lowPerformanceButton.className = isLowPerformanceEnabled() ? "selected" : "";
        }
        updateUiText();
    }

    function currentViewName() {
        try {
            return global.vsm && vsm.getViewName ? vsm.getViewName() : "";
        } catch (err) {
            return "";
        }
    }

    function refreshVisibility() {
        var root = document.getElementById(ROOT_ID);
        var visible = currentViewName() === "title";
        if (!root) return;
        root.style.display = visible ? "block" : "none";
        if (!visible && panelOpen) {
            togglePanel(false);
        }
    }

    function togglePanel(open) {
        var panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panelOpen = !!open;
        panel.hidden = !panelOpen;
    }

    function stopInput(evt) {
        evt.preventDefault();
        evt.stopPropagation();
    }

    function normalizeFrameRate(fps) {
        fps = Number(fps) || 60;
        return fps === 30 || fps === 120 ? fps : 60;
    }

    function readFrameRate() {
        if (global.ChromiumPort && ChromiumPort.getFrameRate) {
            return normalizeFrameRate(ChromiumPort.getFrameRate());
        }
        try {
            return normalizeFrameRate(global.localStorage && global.localStorage.getItem(FRAME_RATE_STORAGE_KEY));
        } catch (err) {
            return 60;
        }
    }

    function setFrameRate(fps) {
        fps = normalizeFrameRate(fps);
        if (global.ChromiumPort && ChromiumPort.setFrameRate) {
            ChromiumPort.setFrameRate(fps);
        } else {
            try {
                if (global.localStorage) {
                    global.localStorage.setItem(FRAME_RATE_STORAGE_KEY, String(fps));
                }
            } catch (err) {}
            global.__chromiumPortFrameRate = fps;
        }
        updateSelectedOption();
    }

    function performanceApi() {
        return global.ChromiumPortPerformanceMode || null;
    }

    function isLowPerformanceEnabled() {
        var api = performanceApi();
        return !!(api && api.isEnabled && api.isEnabled());
    }

    function setLowPerformanceEnabled(enabled) {
        var api = performanceApi();
        if (api && api.setEnabled) {
            api.setEnabled(!!enabled);
        } else {
            try {
                if (global.localStorage) {
                    if (enabled) {
                        global.localStorage.setItem("chromiumPortLowPerformanceMode", "1");
                    } else {
                        global.localStorage.removeItem("chromiumPortLowPerformanceMode");
                    }
                }
            } catch (err) {}
            global.__chromiumPortLowPerformanceMode = !!enabled;
        }
        updateSelectedOption();
    }

    function clampVolume(value) {
        value = Number(value);
        if (!isFinite(value)) value = 100;
        return Math.max(0, Math.min(100, Math.round(value)));
    }

    function readVolume(key) {
        try {
            var stored = global.localStorage && global.localStorage.getItem(key);
            if (stored === null || stored === undefined || stored === "") {
                return 100;
            }
            return clampVolume(stored);
        } catch (err) {
            return 100;
        }
    }

    function saveVolume(key, value) {
        value = clampVolume(value);
        try {
            if (global.localStorage) {
                global.localStorage.setItem(key, String(value));
            }
        } catch (err) {}
        return value;
    }

    function musicVolume() {
        return readVolume(MUSIC_VOLUME_STORAGE_KEY);
    }

    function sfxVolume() {
        return readVolume(SFX_VOLUME_STORAGE_KEY);
    }

    function applyAudioVolumes() {
        var player = global.lib && lib.sound && lib.sound.SoundPlayer && lib.sound.SoundPlayer.instance;
        var music = musicVolume() / 100;
        var sfx = sfxVolume() / 100;
        if (!player) return;
        if (player.setGpMusicVolumeMultiplier) player.setGpMusicVolumeMultiplier(music);
        if (player.setTvMusicVolumeMultiplier) player.setTvMusicVolumeMultiplier(music);
        if (player.setGpSfxVolumeMultiplier) player.setGpSfxVolumeMultiplier(sfx);
        if (player.setTvSfxVolumeMultiplier) player.setTvSfxVolumeMultiplier(sfx);
    }

    function updateVolumeUi() {
        var musicSlider = document.getElementById("chromium-port-music-volume");
        var sfxSlider = document.getElementById("chromium-port-sfx-volume");
        var musicValue = document.getElementById("chromium-port-music-volume-value");
        var sfxValue = document.getElementById("chromium-port-sfx-volume-value");
        if (musicSlider) musicSlider.value = String(musicVolume());
        if (sfxSlider) sfxSlider.value = String(sfxVolume());
        if (musicValue) musicValue.textContent = musicVolume() + "%";
        if (sfxValue) sfxValue.textContent = sfxVolume() + "%";
    }

    function setVolume(kind, value) {
        if (kind === "music") {
            saveVolume(MUSIC_VOLUME_STORAGE_KEY, value);
        } else {
            saveVolume(SFX_VOLUME_STORAGE_KEY, value);
        }
        updateVolumeUi();
        applyAudioVolumes();
    }

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
    }

    function requestFullscreen() {
        var target = document.documentElement;
        var fn = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
        if (fn) {
            return fn.call(target);
        }
        return null;
    }

    function exitFullscreen() {
        var fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (fn) {
            return fn.call(document);
        }
        return null;
    }

    function updateFullscreenButton() {
        var button = document.getElementById("chromium-port-fullscreen-button");
        if (!button) return;
        button.textContent = fullscreenElement() ? text("exitFullscreen") : text("fullscreen");
    }

    function saveFsApi() {
        return global.ChromiumPortSaveFS || null;
    }

    function setStatusMessage(message) {
        var status = document.getElementById("chromium-port-save-status");
        if (status) {
            status.textContent = message || "";
        }
    }

    function exportSaveData() {
        var fs = saveFsApi();
        if (!fs || !fs.exportProfile) {
            setStatusMessage(text("exportFailed"));
            return;
        }
        fs.exportProfile().then(function (payload) {
            var json = JSON.stringify(payload);
            var blob = new Blob([json], { type: "application/json" });
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            var stamp = new Date().toISOString().replace(/[:.]/g, "-");
            link.href = url;
            link.download = "mvdk-ts-save-" + stamp + ".json";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            global.setTimeout(function () {
                URL.revokeObjectURL(url);
            }, 1000);
            setStatusMessage("");
        }).catch(function () {
            setStatusMessage(text("exportFailed"));
        });
    }

    function importSaveFile(file) {
        var fs = saveFsApi();
        if (!fs || !fs.importProfile || !file) {
            setStatusMessage(text("importFailed"));
            return;
        }
        file.text().then(function (content) {
            return fs.importProfile(JSON.parse(content));
        }).then(function () {
            setStatusMessage(text("importDone"));
            global.setTimeout(function () {
                global.location.reload();
            }, 500);
        }).catch(function () {
            setStatusMessage(text("importFailed"));
        });
    }

    function openImportPicker(input) {
        if (!input) return;
        try {
            if (input.showPicker) {
                input.showPicker();
                return;
            }
        } catch (err) {
        }
        input.click();
    }

    function unlockApi() {
        return global.ChromiumPortDebugUnlock || null;
    }

    function updateUnlockButton() {
        var button = document.getElementById("chromium-port-unlock-all-settings");
        var api = unlockApi();
        var ready = api && api.storageReady && api.storageReady();
        var fullyUnlocked = !!(api && api.isFullyUnlocked && api.isFullyUnlocked());
        if (!button) return;
        button.disabled = !ready;
        button.className = "debug-action" + (fullyUnlocked ? " selected" : "");
        button.textContent = fullyUnlocked ? text("resetProgress") : text("unlockAll");
    }

    function runUnlockAll() {
        var button = document.getElementById("chromium-port-unlock-all-settings");
        var api = unlockApi();
        if (!api || !api.storageReady || !api.storageReady()) {
            if (button) {
                button.textContent = text("unlockAllWait");
                global.setTimeout(updateUnlockButton, 900);
            }
            return;
        }
        if (api.isFullyUnlocked && api.isFullyUnlocked()) {
            button.disabled = true;
            button.textContent = text("reloading");
            api.resetProgress().then(function () {
                global.location.reload();
            });
            return;
        }
        api.setEnabled(true);
        if (api.installBonusLockGuard) api.installBonusLockGuard();
        if (api.unlockProgress && api.unlockProgress()) {
            if (button) {
                button.textContent = text("unlockAllSaved");
                button.disabled = true;
            }
            global.setTimeout(function () {
                global.location.reload();
            }, 450);
        }
    }

    function updateUiText() {
        var els;
        var i;
        var langSelect = document.getElementById("chromium-port-language-select");
        var languageTitle = document.getElementById("chromium-port-language-title");
        var fpsTitle = document.getElementById("chromium-port-fps-title");
        var musicTitle = document.getElementById("chromium-port-music-volume-title");
        var sfxTitle = document.getElementById("chromium-port-sfx-volume-title");
        var title = document.getElementById("chromium-port-settings-title");
        var button = document.getElementById(BUTTON_ID);
        var version = document.getElementById("chromium-port-version-indicator");

        if (button) button.textContent = text("settings");
        if (title) title.textContent = text("settings");
        if (fpsTitle) fpsTitle.textContent = text("fps");
        if (languageTitle) languageTitle.textContent = text("language");
        if (musicTitle) musicTitle.textContent = text("musicVolume");
        if (sfxTitle) sfxTitle.textContent = text("sfxVolume");
        if (version) version.textContent = text("portVersion") + " " + PORT_VERSION;

        els = document.querySelectorAll("[data-i18n]");
        for (i = 0; i < els.length; ++i) {
            els[i].textContent = text(els[i].getAttribute("data-i18n"));
        }
        if (langSelect) {
            langSelect.value = readLanguageOverride();
            if (langSelect.options[0]) {
                langSelect.options[0].textContent = text("system") + " (" + languageLabel(deviceLanguage()) + ")";
            }
        }
        updateFullscreenButton();
        updateVolumeUi();
        updateUnlockButton();
    }

    function languageLabel(lang) {
        switch (normalizeLanguage(lang)) {
            case "es": return "Español";
            case "fr": return "Français";
            case "de": return "Deutsch";
            case "it": return "Italiano";
            case "ja": return "日本語";
            case "en":
            default: return "English";
        }
    }

    function toggleFullscreen() {
        var result;
        if (fullscreenElement()) {
            result = exitFullscreen();
        } else {
            result = requestFullscreen();
        }
        if (result && result.then) {
            result.then(function () {
                updateFullscreenButton();
                applyLayout();
            }).catch(function () {
                updateFullscreenButton();
            });
        } else {
            global.setTimeout(function () {
                updateFullscreenButton();
                applyLayout();
            }, 60);
        }
    }

    function installStyles() {
        var style = document.createElement("style");
        style.id = "chromium-port-settings-style";
        style.textContent = [
            "#" + ROOT_ID + "{position:fixed;z-index:1000001;display:none;pointer-events:none;font-family:Arial,sans-serif}",
            "#" + BUTTON_ID + "{position:absolute;right:12px;top:12px;min-width:104px;height:42px;padding:0 12px;border:3px solid #003b69;border-radius:7px;background:linear-gradient(#ffe96f,#f8b633);box-shadow:0 3px 0 #001b31,0 5px 10px rgba(0,0,0,.35);color:#14376f;font-weight:900;font-size:17px;text-shadow:0 1px 0 rgba(255,255,255,.7);cursor:pointer;pointer-events:auto}",
            "#" + BUTTON_ID + ":active{transform:translateY(2px);box-shadow:0 1px 0 #001b31,0 3px 6px rgba(0,0,0,.35)}",
            "#" + ROOT_ID + " *{touch-action:auto}",
            "#" + PANEL_ID + "{position:absolute;right:12px;top:62px;width:min(390px,calc(100vw - 24px));max-width:calc(100% - 24px);max-height:min(86vh,calc(100% - 74px));overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:14px;border:4px solid #031c31;border-radius:8px;background:linear-gradient(#08a9ef,#006bc2);box-shadow:0 0 0 3px #49d6ff inset,0 6px 14px rgba(0,0,0,.45);pointer-events:auto;scrollbar-color:#ffe96f #006bc2}",
            "#" + PANEL_ID + "::-webkit-scrollbar{width:12px}",
            "#" + PANEL_ID + "::-webkit-scrollbar-track{background:#006bc2;border-radius:8px}",
            "#" + PANEL_ID + "::-webkit-scrollbar-thumb{background:#ffe96f;border:2px solid #006bc2;border-radius:8px}",
            "#" + PANEL_ID + " .title{margin:2px 0 10px;color:#fff;font-weight:900;font-size:24px;text-shadow:2px 2px 0 #053a7a}",
            "#" + PANEL_ID + " .section{margin:10px 0;padding:10px;border:3px solid #064274;border-radius:8px;background:rgba(4,45,105,.28);box-shadow:0 0 0 2px rgba(132,224,255,.34) inset}",
            "#" + PANEL_ID + " .section-title{display:flex;align-items:center;gap:7px;margin:0 0 7px;color:#fff;font-weight:900;font-size:17px;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " .section-icon{width:24px;height:24px;flex:0 0 24px;filter:drop-shadow(1px 1px 0 #053a7a)}",
            "#" + PANEL_ID + " .section-icon *{vector-effect:non-scaling-stroke}",
            "#" + PANEL_ID + " .two-col{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
            "#" + PANEL_ID + " .sub{margin:12px 0 5px;color:#fff;font-weight:900;font-size:16px;text-align:left;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " .slider-head{display:flex;align-items:center;justify-content:space-between;margin:12px 0 4px;color:#fff;font-weight:900;font-size:16px;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " .slider-head span:last-child{font-size:14px}",
            "#" + PANEL_ID + " .fps-row{display:flex;gap:7px}",
            "#" + PANEL_ID + " .save-method{margin:8px 0;padding:9px;border:2px solid rgba(255,255,255,.45);border-radius:7px;background:rgba(232,247,255,.16)}",
            "#" + PANEL_ID + " .save-method-title{color:#fff;font-weight:900;font-size:15px;text-align:left;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " .save-method-hint{margin:3px 0 7px;color:#dff6ff;font-weight:900;font-size:12px;line-height:1.25;text-align:left;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " .save-method .two-col button{margin:4px 0;min-height:44px;font-size:15px}",
            "#" + PANEL_ID + " button{display:block;width:100%;min-height:48px;margin:8px 0;padding:0 9px;border:3px solid #09284a;border-radius:7px;background:linear-gradient(#e8f7ff,#8fd3ff);color:#173b7a;font-weight:900;font-size:17px;text-shadow:0 1px 0 #fff;cursor:pointer}",
            "#" + PANEL_ID + " .fps-row button{height:42px;margin:4px 0;font-size:16px}",
            "#" + PANEL_ID + " select{display:block;width:100%;height:46px;margin:6px 0 2px;padding:0 10px;border:3px solid #09284a;border-radius:7px;background:#e8f7ff;color:#173b7a;font-weight:900;font-size:17px;cursor:pointer}",
            "#" + PANEL_ID + " input[type=range]{display:block;width:100%;height:30px;margin:0 0 4px;accent-color:#ffc02d;cursor:pointer}",
            "#" + PANEL_ID + " button.selected{background:linear-gradient(#fff071,#ffc02d);color:#102d60}",
            "#" + PANEL_ID + " button.debug-action{background:linear-gradient(#e8f7ff,#8fd3ff);color:#173b7a}",
            "#" + PANEL_ID + " button.debug-action.selected{background:linear-gradient(#ffe96f,#f8b633);color:#14376f}",
            "#" + PANEL_ID + " .danger{background:linear-gradient(#ff9e9e,#ff5f5f);color:#611515}",
            "#" + PANEL_ID + " .file-input{position:absolute;left:-10000px;top:auto;width:1px;height:1px;opacity:0;pointer-events:none}",
            "#" + PANEL_ID + " .save-status{min-height:18px;margin:6px 2px 0;color:#fff7a8;font-weight:900;font-size:13px;text-align:center;text-shadow:1px 1px 0 #053a7a}",
            "#" + PANEL_ID + " button:disabled{filter:grayscale(.55);opacity:.78;cursor:default}",
            "#" + PANEL_ID + " .port-version{margin:12px 2px 0;padding-top:8px;border-top:2px solid rgba(255,255,255,.35);color:#dff6ff;font-weight:900;font-size:13px;text-align:center;text-shadow:1px 1px 0 #053a7a;opacity:.95}"
        ].join("\n");
        document.head.appendChild(style);
    }

    function makeIcon(name) {
        var ns = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(ns, "svg");
        var shape;
        var paths = {
            display: ["M4 6h16v10H4z", "M9 20h6", "M12 16v4"],
            gameplay: ["M7 10h10c2.2 0 4 1.8 4 4v2.2c0 1-.8 1.8-1.8 1.8-.6 0-1.1-.3-1.5-.7L16.4 16H7.6l-1.3 1.3c-.4.4-.9.7-1.5.7-1 0-1.8-.8-1.8-1.8V14c0-2.2 1.8-4 4-4z", "M8 13v3", "M6.5 14.5h3", "M15.5 13.5h.1", "M18 15.5h.1"],
            audio: ["M4 10h4l5-4v12l-5-4H4z", "M16 9c1.4 1.7 1.4 4.3 0 6", "M18.5 6.5c3 3.2 3 7.8 0 11"],
            language: ["M4 5h16", "M8 5c1.4 5 4.6 8.4 10 10", "M16 5c-1.4 5-4.6 8.4-10 10", "M12 3v3", "M5 20l3-6 3 6", "M6.2 18h3.6"],
            save: ["M5 4h11l3 3v13H5z", "M8 4v6h8V4", "M8 15h8v5"],
            advanced: ["M12 3l2.1 2.3 3-.6.9 2.9 2.9 1-.7 3 2.2 2.2-2.2 2.2.7 3-2.9 1-.9 2.9-3-.6L12 21l-2.1-2.3-3 .6-.9-2.9-2.9-1 .7-3-2.2-2.2 2.2-2.2-.7-3 2.9-1 .9-2.9 3 .6z", "M12 9v6", "M9 12h6"]
        };
        svg.setAttribute("class", "section-icon");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        paths[name].forEach(function (d) {
            shape = document.createElementNS(ns, "path");
            shape.setAttribute("d", d);
            shape.setAttribute("fill", "none");
            shape.setAttribute("stroke", "#fff7a8");
            shape.setAttribute("stroke-width", "2.3");
            shape.setAttribute("stroke-linecap", "round");
            shape.setAttribute("stroke-linejoin", "round");
            svg.appendChild(shape);
        });
        return svg;
    }

    function makeSection(icon, labelKey) {
        var section = document.createElement("div");
        var title = document.createElement("div");
        var label = document.createElement("span");
        section.className = "section";
        title.className = "section-title";
        label.setAttribute("data-i18n", labelKey);
        label.textContent = text(labelKey);
        title.appendChild(makeIcon(icon));
        title.appendChild(label);
        section.appendChild(title);
        return section;
    }

    function createUi() {
        var root;
        var button;
        var panel;
        var title;
        var displaySection;
        var displayRow;
        var perfSection;
        var audioSection;
        var languageSection;
        var saveSection;
        var debugSection;
        var gpOnly;
        var both;
        var fullscreen;
        var fpsTitle;
        var fpsRow;
        var fps30;
        var fps60;
        var fps120;
        var lowPerformance;
        var unlockAll;
        var exportSave;
        var importSave;
        var exportQrSave;
        var importQrSave;
        var importFile;
        var saveStatus;
        var fileSaveMethod;
        var fileSaveTitle;
        var fileSaveHint;
        var fileSaveButtons;
        var qrSaveMethod;
        var qrSaveTitle;
        var qrSaveHint;
        var qrSaveButtons;
        var languageTitle;
        var languageSelect;
        var musicVolumeHead;
        var musicVolumeTitle;
        var musicVolumeValue;
        var musicVolumeSlider;
        var sfxVolumeHead;
        var sfxVolumeTitle;
        var sfxVolumeValue;
        var sfxVolumeSlider;
        var versionIndicator;
        var optionData;
        var option;
        var i;

        if (!global.document || document.getElementById(ROOT_ID)) return;
        installStyles();

        root = document.createElement("div");
        root.id = ROOT_ID;

        button = document.createElement("button");
        button.id = BUTTON_ID;
        button.type = "button";
        button.textContent = "Ajustes";

        panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.hidden = true;

        title = document.createElement("div");
        title.id = "chromium-port-settings-title";
        title.className = "title";
        title.textContent = text("settings");

        displaySection = makeSection("display", "display");
        displayRow = document.createElement("div");
        displayRow.className = "two-col";

        perfSection = makeSection("gameplay", "gameplay");
        audioSection = makeSection("audio", "audio");
        languageSection = makeSection("language", "language");
        saveSection = makeSection("save", "saveData");
        debugSection = makeSection("advanced", "advanced");

        gpOnly = document.createElement("button");
        gpOnly.type = "button";
        gpOnly.setAttribute("data-view-mode", "gp");
        gpOnly.setAttribute("data-i18n", "gamepadOnly");
        gpOnly.textContent = text("gamepadOnly");

        both = document.createElement("button");
        both.type = "button";
        both.setAttribute("data-view-mode", "both");
        both.setAttribute("data-i18n", "twoScreens");
        both.textContent = text("twoScreens");

        fullscreen = document.createElement("button");
        fullscreen.id = "chromium-port-fullscreen-button";
        fullscreen.type = "button";
        fullscreen.textContent = text("fullscreen");

        fpsTitle = document.createElement("div");
        fpsTitle.id = "chromium-port-fps-title";
        fpsTitle.className = "sub";
        fpsTitle.textContent = text("fps");

        fpsRow = document.createElement("div");
        fpsRow.className = "fps-row";

        fps30 = document.createElement("button");
        fps30.type = "button";
        fps30.setAttribute("data-fps", "30");
        fps30.textContent = "30";

        fps60 = document.createElement("button");
        fps60.type = "button";
        fps60.setAttribute("data-fps", "60");
        fps60.textContent = "60";

        fps120 = document.createElement("button");
        fps120.type = "button";
        fps120.setAttribute("data-fps", "120");
        fps120.textContent = "120";

        fpsRow.appendChild(fps30);
        fpsRow.appendChild(fps60);
        fpsRow.appendChild(fps120);

        lowPerformance = document.createElement("button");
        lowPerformance.id = "chromium-port-low-performance-button";
        lowPerformance.type = "button";
        lowPerformance.setAttribute("data-low-performance", "toggle");
        lowPerformance.setAttribute("data-i18n", "lowPerformance");
        lowPerformance.textContent = text("lowPerformance");

        unlockAll = document.createElement("button");
        unlockAll.id = "chromium-port-unlock-all-settings";
        unlockAll.type = "button";
        unlockAll.className = "debug-action";
        unlockAll.textContent = text("unlockAll");

        exportSave = document.createElement("button");
        exportSave.id = "chromium-port-export-save";
        exportSave.type = "button";
        exportSave.setAttribute("data-save-action", "export");
        exportSave.setAttribute("data-i18n", "exportSave");
        exportSave.textContent = text("exportSave");

        importSave = document.createElement("button");
        importSave.id = "chromium-port-import-save";
        importSave.type = "button";
        importSave.setAttribute("data-save-action", "import");
        importSave.setAttribute("data-i18n", "importSave");
        importSave.textContent = text("importSave");

        exportQrSave = document.createElement("button");
        exportQrSave.id = "chromium-port-export-save-qr";
        exportQrSave.type = "button";
        exportQrSave.setAttribute("data-save-action", "export-qr");
        exportQrSave.setAttribute("data-i18n", "exportQrSave");
        exportQrSave.textContent = text("exportQrSave");

        importQrSave = document.createElement("button");
        importQrSave.id = "chromium-port-import-save-qr";
        importQrSave.type = "button";
        importQrSave.setAttribute("data-save-action", "import-qr");
        importQrSave.setAttribute("data-i18n", "importQrSave");
        importQrSave.textContent = text("importQrSave");

        importFile = document.createElement("input");
        importFile.id = "chromium-port-import-file";
        importFile.type = "file";
        importFile.accept = "application/json,.json";
        importFile.className = "file-input";

        saveStatus = document.createElement("div");
        saveStatus.id = "chromium-port-save-status";
        saveStatus.className = "save-status";

        fileSaveMethod = document.createElement("div");
        fileSaveMethod.className = "save-method";
        fileSaveTitle = document.createElement("div");
        fileSaveTitle.className = "save-method-title";
        fileSaveTitle.setAttribute("data-i18n", "saveFileTitle");
        fileSaveTitle.textContent = text("saveFileTitle");
        fileSaveHint = document.createElement("div");
        fileSaveHint.className = "save-method-hint";
        fileSaveHint.setAttribute("data-i18n", "saveFileHint");
        fileSaveHint.textContent = text("saveFileHint");
        fileSaveButtons = document.createElement("div");
        fileSaveButtons.className = "two-col";

        qrSaveMethod = document.createElement("div");
        qrSaveMethod.className = "save-method";
        qrSaveTitle = document.createElement("div");
        qrSaveTitle.className = "save-method-title";
        qrSaveTitle.setAttribute("data-i18n", "saveQrTitle");
        qrSaveTitle.textContent = text("saveQrTitle");
        qrSaveHint = document.createElement("div");
        qrSaveHint.className = "save-method-hint";
        qrSaveHint.setAttribute("data-i18n", "saveQrHint");
        qrSaveHint.textContent = text("saveQrHint");
        qrSaveButtons = document.createElement("div");
        qrSaveButtons.className = "two-col";

        languageTitle = document.createElement("div");
        languageTitle.id = "chromium-port-language-title";
        languageTitle.className = "sub";
        languageTitle.textContent = text("language");

        languageSelect = document.createElement("select");
        languageSelect.id = "chromium-port-language-select";
        optionData = [
            ["system", text("system") + " (" + languageLabel(deviceLanguage()) + ")"],
            ["en", "English"],
            ["es", "Español"],
            ["fr", "Français"],
            ["de", "Deutsch"],
            ["it", "Italiano"],
            ["ja", "日本語"]
        ];
        for (i = 0; i < optionData.length; ++i) {
            option = document.createElement("option");
            option.value = optionData[i][0];
            option.textContent = optionData[i][1];
            languageSelect.appendChild(option);
        }
        languageSelect.value = readLanguageOverride();

        musicVolumeHead = document.createElement("div");
        musicVolumeHead.className = "slider-head";
        musicVolumeTitle = document.createElement("span");
        musicVolumeTitle.id = "chromium-port-music-volume-title";
        musicVolumeTitle.textContent = text("musicVolume");
        musicVolumeValue = document.createElement("span");
        musicVolumeValue.id = "chromium-port-music-volume-value";
        musicVolumeHead.appendChild(musicVolumeTitle);
        musicVolumeHead.appendChild(musicVolumeValue);

        musicVolumeSlider = document.createElement("input");
        musicVolumeSlider.id = "chromium-port-music-volume";
        musicVolumeSlider.type = "range";
        musicVolumeSlider.min = "0";
        musicVolumeSlider.max = "100";
        musicVolumeSlider.step = "1";
        musicVolumeSlider.setAttribute("data-volume", "music");

        sfxVolumeHead = document.createElement("div");
        sfxVolumeHead.className = "slider-head";
        sfxVolumeTitle = document.createElement("span");
        sfxVolumeTitle.id = "chromium-port-sfx-volume-title";
        sfxVolumeTitle.textContent = text("sfxVolume");
        sfxVolumeValue = document.createElement("span");
        sfxVolumeValue.id = "chromium-port-sfx-volume-value";
        sfxVolumeHead.appendChild(sfxVolumeTitle);
        sfxVolumeHead.appendChild(sfxVolumeValue);

        sfxVolumeSlider = document.createElement("input");
        sfxVolumeSlider.id = "chromium-port-sfx-volume";
        sfxVolumeSlider.type = "range";
        sfxVolumeSlider.min = "0";
        sfxVolumeSlider.max = "100";
        sfxVolumeSlider.step = "1";
        sfxVolumeSlider.setAttribute("data-volume", "sfx");

        versionIndicator = document.createElement("div");
        versionIndicator.id = "chromium-port-version-indicator";
        versionIndicator.className = "port-version";
        versionIndicator.textContent = text("portVersion") + " " + PORT_VERSION;

        displayRow.appendChild(gpOnly);
        displayRow.appendChild(both);
        displaySection.appendChild(displayRow);
        displaySection.appendChild(fullscreen);

        perfSection.appendChild(fpsTitle);
        perfSection.appendChild(fpsRow);
        perfSection.appendChild(lowPerformance);

        audioSection.appendChild(musicVolumeHead);
        audioSection.appendChild(musicVolumeSlider);
        audioSection.appendChild(sfxVolumeHead);
        audioSection.appendChild(sfxVolumeSlider);

        languageSection.appendChild(languageTitle);
        languageSection.appendChild(languageSelect);

        fileSaveButtons.appendChild(exportSave);
        fileSaveButtons.appendChild(importSave);
        fileSaveMethod.appendChild(fileSaveTitle);
        fileSaveMethod.appendChild(fileSaveHint);
        fileSaveMethod.appendChild(fileSaveButtons);

        qrSaveButtons.appendChild(exportQrSave);
        qrSaveButtons.appendChild(importQrSave);
        qrSaveMethod.appendChild(qrSaveTitle);
        qrSaveMethod.appendChild(qrSaveHint);
        qrSaveMethod.appendChild(qrSaveButtons);

        saveSection.appendChild(fileSaveMethod);
        saveSection.appendChild(qrSaveMethod);
        saveSection.appendChild(importFile);
        saveSection.appendChild(saveStatus);

        debugSection.appendChild(unlockAll);

        panel.appendChild(title);
        panel.appendChild(displaySection);
        panel.appendChild(perfSection);
        panel.appendChild(audioSection);
        panel.appendChild(languageSection);
        panel.appendChild(saveSection);
        panel.appendChild(debugSection);
        panel.appendChild(versionIndicator);
        root.appendChild(button);
        root.appendChild(panel);
        document.body.appendChild(root);

        button.addEventListener("pointerdown", stopInput, true);
        button.addEventListener("click", function (evt) {
            stopInput(evt);
            togglePanel(!panelOpen);
        }, true);
        panel.addEventListener("pointerdown", function (evt) {
            if (evt.target && (evt.target.id === "chromium-port-language-select" || evt.target.getAttribute("data-volume"))) {
                evt.stopPropagation();
                return;
            }
            evt.stopPropagation();
        }, true);
        panel.addEventListener("wheel", function (evt) {
            evt.stopPropagation();
        }, true);
        panel.addEventListener("touchstart", function (evt) {
            evt.stopPropagation();
        }, true);
        panel.addEventListener("touchmove", function (evt) {
            evt.stopPropagation();
        }, true);
        panel.addEventListener("click", function (evt) {
            var mode = evt.target && evt.target.getAttribute("data-view-mode");
            var fps = evt.target && evt.target.getAttribute("data-fps");
            var lowPerformanceToggle = evt.target && evt.target.getAttribute("data-low-performance");
            var saveAction = evt.target && evt.target.getAttribute("data-save-action");
            var isFullscreen = evt.target && evt.target.id === "chromium-port-fullscreen-button";
            var isUnlockAll = evt.target && evt.target.id === "chromium-port-unlock-all-settings";
            if (evt.target && (evt.target.id === "chromium-port-language-select" || evt.target.getAttribute("data-volume"))) {
                return;
            }
            if (saveAction === "import") {
                return;
            }
            stopInput(evt);
            if (mode) {
                setMode(mode);
                togglePanel(false);
            } else if (fps) {
                setFrameRate(fps);
            } else if (lowPerformanceToggle) {
                setLowPerformanceEnabled(!isLowPerformanceEnabled());
            } else if (saveAction === "export") {
                exportSaveData();
            } else if (saveAction === "export-qr") {
                if (global.ChromiumPortSaveQRTransfer && ChromiumPortSaveQRTransfer.showExport) {
                    ChromiumPortSaveQRTransfer.showExport();
                    togglePanel(false);
                } else {
                    setStatusMessage(text("exportFailed"));
                }
            } else if (saveAction === "import-qr") {
                if (global.ChromiumPortSaveQRTransfer && ChromiumPortSaveQRTransfer.showImport) {
                    ChromiumPortSaveQRTransfer.showImport();
                    togglePanel(false);
                } else {
                    setStatusMessage(text("importFailed"));
                }
            } else if (isFullscreen) {
                toggleFullscreen();
                togglePanel(false);
            } else if (isUnlockAll) {
                runUnlockAll();
            }
        }, true);
        fullscreen.addEventListener("click", function (evt) {
            stopInput(evt);
            toggleFullscreen();
            togglePanel(false);
        }, true);
        languageSelect.addEventListener("pointerdown", function (evt) {
            evt.stopPropagation();
        }, true);
        languageSelect.addEventListener("change", function (evt) {
            stopInput(evt);
            setLanguageOverride(languageSelect.value);
            updateUiText();
            title.textContent = text("reloading");
            global.setTimeout(function () {
                global.location.reload();
            }, 250);
        }, true);
        musicVolumeSlider.addEventListener("input", function (evt) {
            evt.stopPropagation();
            setVolume("music", musicVolumeSlider.value);
        }, true);
        sfxVolumeSlider.addEventListener("input", function (evt) {
            evt.stopPropagation();
            setVolume("sfx", sfxVolumeSlider.value);
        }, true);
        musicVolumeSlider.addEventListener("change", function (evt) {
            evt.stopPropagation();
            setVolume("music", musicVolumeSlider.value);
        }, true);
        sfxVolumeSlider.addEventListener("change", function (evt) {
            evt.stopPropagation();
            setVolume("sfx", sfxVolumeSlider.value);
        }, true);
        unlockAll.addEventListener("click", function (evt) {
            stopInput(evt);
            runUnlockAll();
        }, true);
        importSave.addEventListener("click", function (evt) {
            evt.stopPropagation();
            openImportPicker(importFile);
        }, false);
        importFile.addEventListener("change", function (evt) {
            evt.stopPropagation();
            importSaveFile(importFile.files && importFile.files[0]);
            importFile.value = "";
        }, true);

        currentMode = readMode();
        applyLayout();
        refreshVisibility();
        updateFullscreenButton();
        updateUiText();
        applyAudioVolumes();
    }

    currentMode = readMode();
    global.__chromiumPortApplyViewLayout = applyLayout;
    global.__chromiumPortSetViewMode = setMode;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createUi);
    } else {
        createUi();
    }

    global.addEventListener("resize", applyLayout, false);
    global.addEventListener("orientationchange", function () {
        global.setTimeout(applyLayout, 60);
    }, false);
    document.addEventListener("fullscreenchange", function () {
        updateFullscreenButton();
        applyLayout();
    }, false);
    document.addEventListener("webkitfullscreenchange", function () {
        updateFullscreenButton();
        applyLayout();
    }, false);
    global.setInterval(function () {
        applyLayoutIfNeeded();
        applyAudioVolumes();
        updateUnlockButton();
        refreshVisibility();
    }, 250);
})(window);
