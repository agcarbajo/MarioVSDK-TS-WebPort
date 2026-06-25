(function (global) {
    "use strict";

    var ROOT_ID = "chromium-port-mobile-controls";
    var BUTTON_ID = "chromium-port-mobile-pause";
    var lastPress = 0;

    function isMobileLike() {
        try {
            return !!(global.matchMedia && (matchMedia("(pointer: coarse)").matches || matchMedia("(hover: none)").matches));
        } catch (err) {
            return false;
        }
    }

    function currentViewName() {
        try {
            return global.vsm && vsm.getViewName ? vsm.getViewName() : "";
        } catch (err) {
            return "";
        }
    }

    function shouldShow() {
        var gameUI = global.pt && pt.asset && pt.asset.gameSharedAssets && pt.asset.gameSharedAssets.gameUI;
        if (!isMobileLike() || currentViewName() !== "game" || global.__chromiumPortPauseMenuOpen) {
            return false;
        }
        if (gameUI) {
            if (gameUI.currentState !== 3) {
                return false;
            }
            if ((gameUI.pauseMenu && gameUI.pauseMenu.on) || (gameUI.resultMenu && gameUI.resultMenu.active) || (gameUI.gameoverMenu && gameUI.gameoverMenu.active)) {
                return false;
            }
        }
        return true;
    }

    function gamepadRect() {
        var gp;
        if (global.__chromiumPortGamepadRect) {
            return global.__chromiumPortGamepadRect;
        }
        gp = document.getElementById("gp-container") || document.querySelector('canvas[name="gamepad"]');
        return gp && gp.getBoundingClientRect ? gp.getBoundingClientRect() : null;
    }

    function pressPause(evt) {
        var now = Date.now();
        if (evt) {
            evt.preventDefault();
            evt.stopPropagation();
        }
        if (now - lastPress < 180) {
            return;
        }
        lastPress = now;
        if (global.ChromiumPortInput && ChromiumPortInput.buttons) {
            ChromiumPortInput.pressButton(ChromiumPortInput.buttons.GAMEPAD_PLUS, 120);
        }
    }

    function update() {
        var root = document.getElementById(ROOT_ID);
        var rect = gamepadRect();
        var size;

        if (!root || !rect || !shouldShow()) {
            if (root) {
                root.style.display = "none";
            }
            return;
        }

        size = Math.max(38, Math.min(56, rect.width * 0.075));
        root.style.display = "block";
        root.style.left = rect.left + "px";
        root.style.top = rect.top + "px";
        root.style.width = rect.width + "px";
        root.style.height = rect.height + "px";
        root.style.setProperty("--pause-size", size + "px");
    }

    function create() {
        var style;
        var root;
        var button;

        if (document.getElementById(ROOT_ID)) {
            return;
        }

        style = document.createElement("style");
        style.id = "chromium-port-mobile-controls-style";
        style.textContent = [
            "#" + ROOT_ID + "{position:fixed;z-index:1000000;display:none;pointer-events:none;font-family:Arial,sans-serif}",
            "#" + BUTTON_ID + "{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));width:var(--pause-size,46px);height:var(--pause-size,46px);border:3px solid #003b69;border-radius:50%;background:linear-gradient(#e8f7ff,#64c7f4);box-shadow:0 3px 0 #001b31,0 0 0 2px #62d8ff inset,0 5px 12px rgba(0,0,0,.35);color:#14376f;font-weight:900;font-size:calc(var(--pause-size,46px) * .52);line-height:1;cursor:pointer;pointer-events:auto;text-shadow:0 1px 0 rgba(255,255,255,.85);opacity:.9;touch-action:manipulation}",
            "#" + BUTTON_ID + ":active{transform:translateY(2px);box-shadow:0 1px 0 #001b31,0 0 0 2px #62d8ff inset,0 3px 8px rgba(0,0,0,.35)}"
        ].join("");

        root = document.createElement("div");
        root.id = ROOT_ID;
        button = document.createElement("button");
        button.id = BUTTON_ID;
        button.type = "button";
        button.setAttribute("aria-label", "Pause");
        button.textContent = "+";
        root.appendChild(button);

        button.addEventListener("pointerdown", pressPause, true);
        button.addEventListener("click", pressPause, true);

        document.head.appendChild(style);
        document.body.appendChild(root);

        global.addEventListener("resize", update, false);
        global.addEventListener("orientationchange", update, false);
        global.setInterval(update, 150);
        update();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", create, false);
    } else {
        create();
    }
})(window);
