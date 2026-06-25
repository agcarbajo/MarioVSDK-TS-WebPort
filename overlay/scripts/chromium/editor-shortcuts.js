(function (global) {
    "use strict";

    function isTextInput(target) {
        var tag;
        if (!target) return false;
        tag = (target.tagName || "").toLowerCase();
        return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    }

    function isEditorRunning() {
        var state = global.pt && pt.EditorState && pt.EditorState.instance;
        return !!(state && state.undoRedoMgr && state.selector && state.map && state.uiHandler && state.uiHandler.hud);
    }

    function getHudButton(name) {
        var state = global.pt && pt.EditorState && pt.EditorState.instance;
        var hud = state && state.uiHandler && state.uiHandler.hud;
        if (!hud) return null;
        if (hud.getButton) return hud.getButton(name);
        return null;
    }

    function refreshHudStatus() {
        var state = global.pt && pt.EditorState && pt.EditorState.instance;
        var handler = state && state.uiHandler;
        var hud = handler && handler.hud;
        if (handler && handler.updateStatus) {
            handler.updateStatus();
        } else if (hud && hud.updateStatus) {
            hud.updateStatus();
        }
    }

    function refreshHudStatusAfterButtonRelease() {
        refreshHudStatus();
        global.setTimeout(refreshHudStatus, 0);
        if (global.requestAnimationFrame) {
            global.requestAnimationFrame(refreshHudStatus);
        }
    }

    function pressHudButton(name) {
        var button = getHudButton(name);
        if (!button || !button.onDown || !button.onUp) return false;
        button.onDown();
        button.onUp();
        refreshHudStatusAfterButtonRelease();
        return true;
    }

    global.addEventListener("keydown", function (evt) {
        var key;
        var isUndo;
        var isRedo;

        if (!isEditorRunning() || isTextInput(evt.target)) return;
        if (!(evt.ctrlKey || evt.metaKey) || evt.altKey) return;

        key = String(evt.key || "").toLowerCase();
        isUndo = key === "z" && !evt.shiftKey;
        isRedo = key === "y" || (key === "z" && evt.shiftKey);
        if (!isUndo && !isRedo) return;

        if (isUndo) {
            evt.preventDefault();
            evt.stopPropagation();
            pressHudButton("tool_undo");
        } else if (isRedo) {
            evt.preventDefault();
            evt.stopPropagation();
            pressHudButton("tool_redo");
        }
    }, true);
})(window);
