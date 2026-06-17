"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PNG } = require("pngjs");
const compat = require("./editor-compat");

const PACKAGE_NAME = "psd-prefab";
const DEFAULT_2D_MATERIAL_UUID = "eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432";
const ASSET_CONTEXT_MENU_LABEL = "PSD to Prefab";
const DEBUG_ASSET_MENU = false;
const DEBUG_CONVERT = false;

compat.install(PACKAGE_NAME);

let restoreAssetContextMenuPatch = null;
let assetContextMenuPatchTimer = null;
let assetContextRendererTimer = null;

exports.methods = {
    async convertSelectedPsd() {
        debugConvert("method convertSelectedPsd called");
        const selected = Editor.Selection.getSelected("asset");
        debugConvert("selected assets", selected);
        if (!selected || selected.length === 0) {
            return fail("Please select a PSD asset first.");
        }

        await convertByAssetId(selected[0]);
    },

    async convertPsdAsset(assetLike) {
        debugConvert("method convertPsdAsset called", assetLike);
        const assetId = pickAssetId(assetLike) || Editor.Selection.getSelected("asset")[0];
        debugConvert("resolved asset id", assetId);
        if (!assetId) {
            return fail("Please select a PSD asset first.");
        }

        await convertByAssetId(assetId);
    },
};

exports.load = function load() {
    compat.install(PACKAGE_NAME);
    debugConvert("package loaded");
};

exports.unload = function unload() {
    uninstallAssetContextMenuPatch();
};

exports.messages = {
    "convert-selected-psd"() {
        compat.install(PACKAGE_NAME);
        debugConvert("message convert-selected-psd received");
        return exports.methods.convertSelectedPsd();
    },

    "convert-psd-asset"(event, assetLike) {
        compat.install(PACKAGE_NAME);
        const candidate = assetLike || (isEditorEvent(event) ? null : event);
        debugConvert("message convert-psd-asset received", {
            hasAssetLike: !!assetLike,
            candidate,
        });
        return exports.methods.convertPsdAsset(candidate);
    },
};

function isEditorEvent(value) {
    return !!value && typeof value === "object" && (
        typeof value.reply === "function" ||
        typeof value.sender === "string" ||
        typeof value.sender === "number"
    );
}

function installAssetContextMenuPatch() {
    if (restoreAssetContextMenuPatch) {
        debugAssetMenu("asset context menu patch already installed");
        return;
    }

    let attempts = 0;
    const tryPatch = () => {
        attempts += 1;
        if (attempts <= 5 || attempts % 10 === 0) {
            debugAssetMenu(`try patch asset context menu, attempt=${attempts}`, {
                hasMenu: !!Editor.Menu,
                menuKeys: Editor.Menu ? Object.keys(Editor.Menu).filter((key) => /popup|menu/i.test(key)).slice(0, 20) : [],
                hasPopup: !!(Editor.Menu && typeof Editor.Menu.popup === "function"),
                hasPopupTemplate: !!(Editor.Menu && typeof Editor.Menu.popupTemplate === "function"),
                hasPopupFromTemplate: !!(Editor.Menu && typeof Editor.Menu.popupFromTemplate === "function"),
            });
        }

        if (patchEditorMenuPopup()) {
            debugAssetMenu("asset context menu patch installed");
            assetContextMenuPatchTimer = null;
            return;
        }

        if (attempts < 60 && typeof setTimeout === "function") {
            assetContextMenuPatchTimer = setTimeout(tryPatch, 500);
        } else {
            debugAssetMenu("asset context menu patch gave up", {
                attempts,
                hasMenu: !!Editor.Menu,
                menuKeys: Editor.Menu ? Object.keys(Editor.Menu).slice(0, 50) : [],
            });
            assetContextMenuPatchTimer = null;
        }
    };

    tryPatch();
    installRendererAssetMenuInjection();
}

function uninstallAssetContextMenuPatch() {
    if (assetContextMenuPatchTimer && typeof clearTimeout === "function") {
        clearTimeout(assetContextMenuPatchTimer);
        assetContextMenuPatchTimer = null;
    }

    if (assetContextRendererTimer && typeof clearTimeout === "function") {
        clearTimeout(assetContextRendererTimer);
        assetContextRendererTimer = null;
    }

    if (restoreAssetContextMenuPatch) {
        restoreAssetContextMenuPatch();
        restoreAssetContextMenuPatch = null;
        debugAssetMenu("asset context menu patch restored");
    }
}

function installRendererAssetMenuInjection() {
    let attempts = 0;
    const tryInject = () => {
        attempts += 1;
        const result = injectRendererAssetMenu();

        if (attempts <= 5 || attempts % 10 === 0 || result.injected > 0) {
            debugAssetMenu("try inject renderer asset menu", {
                attempt: attempts,
                windows: result.windows,
                webContents: result.webContents,
                injected: result.injected,
                targets: result.targets.slice(0, 10),
                errors: result.errors.slice(0, 3),
            });
        }

        if (attempts < 120 && typeof setTimeout === "function") {
            assetContextRendererTimer = setTimeout(tryInject, 1000);
        } else {
            assetContextRendererTimer = null;
            debugAssetMenu("renderer asset menu injection stopped", {
                attempts,
                windows: result.windows,
                webContents: result.webContents,
                injected: result.injected,
                targets: result.targets.slice(0, 10),
                errors: result.errors.slice(0, 3),
            });
        }
    };

    tryInject();
}

function injectRendererAssetMenu() {
    const result = { windows: 0, webContents: 0, injected: 0, targets: [], errors: [] };
    let electron = null;

    try {
        electron = require("electron");
    } catch (error) {
        result.errors.push(`require electron failed: ${error.message}`);
        return result;
    }

    const targets = collectRendererWebContents(electron, result);
    const script = makeRendererAssetMenuScript();

    for (const webContents of targets) {
        try {
            if (!webContents || webContents.isDestroyed && webContents.isDestroyed()) {
                continue;
            }

            const targetInfo = getWebContentsInfo(webContents);
            result.targets.push(targetInfo);
            const value = webContents.executeJavaScript(script, true);
            if (value && typeof value.then === "function") {
                value.then((response) => {
                    debugAssetMenu("renderer injection result", {
                        id: targetInfo.id,
                        url: targetInfo.url,
                        type: targetInfo.type,
                        response,
                    });
                }).catch((error) => {
                    debugAssetMenu("renderer injection promise failed", {
                        id: targetInfo.id,
                        url: targetInfo.url,
                        type: targetInfo.type,
                        error: error && error.message || String(error),
                    });
                });
            }
            result.injected += 1;
        } catch (error) {
            result.errors.push(error && error.message || String(error));
        }
    }

    return result;
}

function collectRendererWebContents(electron, result) {
    const seen = new Set();
    const targets = [];
    const BrowserWindow = electron && electron.BrowserWindow;

    if (BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
        const windows = BrowserWindow.getAllWindows();
        result.windows = windows.length;
        for (const win of windows) {
            if (!win || win.isDestroyed && win.isDestroyed()) {
                continue;
            }
            addWebContentsTarget(targets, seen, win.webContents);
        }
    } else {
        result.errors.push("BrowserWindow.getAllWindows unavailable");
    }

    if (electron.webContents && typeof electron.webContents.getAllWebContents === "function") {
        const allWebContents = electron.webContents.getAllWebContents();
        result.webContents = allWebContents.length;
        for (const webContents of allWebContents) {
            addWebContentsTarget(targets, seen, webContents);
        }
    } else {
        result.errors.push("webContents.getAllWebContents unavailable");
    }

    return targets;
}

function addWebContentsTarget(targets, seen, webContents) {
    if (!webContents || webContents.isDestroyed && webContents.isDestroyed()) {
        return;
    }

    const id = typeof webContents.id === "number" ? webContents.id : targets.length;
    if (seen.has(id)) {
        return;
    }

    seen.add(id);
    targets.push(webContents);
}

function getWebContentsInfo(webContents) {
    let url = "";
    let title = "";
    let type = "";
    try {
        url = typeof webContents.getURL === "function" ? webContents.getURL() : "";
    } catch (error) {}
    try {
        title = typeof webContents.getTitle === "function" ? webContents.getTitle() : "";
    } catch (error) {}
    try {
        type = typeof webContents.getType === "function" ? webContents.getType() : "";
    } catch (error) {}

    return {
        id: typeof webContents.id === "number" ? webContents.id : -1,
        url,
        title,
        type,
    };
}

function makeRendererAssetMenuScript() {
    return `
(function () {
    var PACKAGE_NAME = ${JSON.stringify(PACKAGE_NAME)};
    var LABEL = ${JSON.stringify(ASSET_CONTEXT_MENU_LABEL)};
    var LOG_PREFIX = "[" + PACKAGE_NAME + ":asset-menu-renderer]";

    if (window.__psdPrefabAssetMenuRendererInstalled) {
        return "already-installed";
    }
    window.__psdPrefabAssetMenuRendererInstalled = true;

    function log(message, data) {
        var text = data === undefined ? LOG_PREFIX + " " + message : LOG_PREFIX + " " + message + " " + safeStringify(data);
        try {
            if (window.Editor && typeof window.Editor.log === "function") {
                window.Editor.log(text);
                return;
            }
        } catch (error) {}
        try {
            console.log(text);
        } catch (error) {}
    }

    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function getRequire() {
        try {
            if (typeof window.require === "function") {
                return window.require;
            }
        } catch (error) {}
        try {
            if (typeof require === "function") {
                return require;
            }
        } catch (error) {}
        return null;
    }

    var nodeRequire = getRequire();
    var fs = null;
    var path = null;
    try {
        fs = nodeRequire && nodeRequire("fs");
        path = nodeRequire && nodeRequire("path");
    } catch (error) {
        log("node fs/path unavailable", error && error.message || String(error));
    }

    function getProjectPath() {
        try {
            if (window.Editor && window.Editor.Project && window.Editor.Project.path) {
                return window.Editor.Project.path;
            }
        } catch (error) {}
        return "";
    }

    function getSelectedAssetIds() {
        try {
            if (window.Editor && window.Editor.Selection && typeof window.Editor.Selection.getSelected === "function") {
                return window.Editor.Selection.getSelected("asset") || [];
            }
        } catch (error) {}

        try {
            if (window.Editor && window.Editor.Selection && typeof window.Editor.Selection.curSelection === "function") {
                return window.Editor.Selection.curSelection("asset") || [];
            }
        } catch (error) {}

        return [];
    }

    function normalizeSlash(value) {
        return String(value || "").replace(/\\\\/g, "/");
    }

    function isUuidLike(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[\\w-]+)?$/i.test(String(value || ""));
    }

    function dbUrlToFile(url) {
        var projectPath = getProjectPath();
        if (!projectPath || !path) {
            return "";
        }
        return path.join(projectPath, String(url || "").replace(/^db:\\/\\//, "").replace(/\\//g, path.sep));
    }

    function candidateToFile(value) {
        if (!value || !path) {
            return "";
        }

        var text = normalizeSlash(value);
        if (isUuidLike(text)) {
            return findAssetByUuid(text);
        }
        if (/\\.psd$/i.test(text) && text.indexOf("db://") === 0) {
            return dbUrlToFile(text);
        }
        if (/\\.psd$/i.test(text) && path.isAbsolute(String(value))) {
            return String(value);
        }
        if (/\\.psd$/i.test(text) && text.indexOf("assets/") === 0) {
            return path.join(getProjectPath(), text.replace(/\\//g, path.sep));
        }
        return "";
    }

    function findAssetByUuid(uuid) {
        var projectPath = getProjectPath();
        if (!fs || !path || !projectPath || !isUuidLike(uuid)) {
            return "";
        }
        var metaFile = findMetaByUuid(path.join(projectPath, "assets"), uuid);
        return metaFile ? metaFile.slice(0, -5) : "";
    }

    function findMetaByUuid(dir, uuid) {
        try {
            if (!fs.existsSync(dir)) {
                return "";
            }
            var entries = fs.readdirSync(dir, { withFileTypes: true });
            for (var i = 0; i < entries.length; i += 1) {
                var entry = entries[i];
                var file = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    var found = findMetaByUuid(file, uuid);
                    if (found) {
                        return found;
                    }
                    continue;
                }
                if (!/\\.meta$/i.test(entry.name)) {
                    continue;
                }
                var meta = readJson(file, {});
                if (meta.uuid === uuid || hasSubMetaUuid(meta, uuid)) {
                    return file;
                }
            }
        } catch (error) {
            return "";
        }
        return "";
    }

    function readJson(file, fallback) {
        try {
            return JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
            return fallback;
        }
    }

    function hasSubMetaUuid(meta, uuid) {
        var subMetas = meta && meta.subMetas || {};
        for (var key in subMetas) {
            if (subMetas[key] && subMetas[key].uuid === uuid) {
                return true;
            }
        }
        return false;
    }

    function getSelectedPsdFile() {
        var selected = getSelectedAssetIds();
        if (!selected || selected.length !== 1) {
            log("not single asset selection", { selected: selected });
            return "";
        }
        var file = candidateToFile(selected[0]);
        var isPsd = /\\.psd$/i.test(file);
        log("selected asset resolved", { assetId: selected[0], file: file, isPsd: isPsd });
        return isPsd ? file : "";
    }

    function shouldInject() {
        return !!getSelectedPsdFile();
    }

    function markItem(item) {
        try {
            item.__psdPrefabConvert = true;
        } catch (error) {}
        return item;
    }

    function addTemplateItem(template) {
        if (!Array.isArray(template)) {
            return false;
        }
        for (var i = 0; i < template.length; i += 1) {
            if (template[i] && template[i].__psdPrefabConvert) {
                return false;
            }
        }
        if (!shouldInject()) {
            return false;
        }
        if (template.length && template[template.length - 1] && template[template.length - 1].type !== "separator") {
            template.push(markItem({ type: "separator" }));
        }
        template.push(markItem({
            label: LABEL,
            enabled: true,
            click: sendConvertSelectedPsd
        }));
        log("template item injected", {
            length: template.length,
            labels: template.map(function (item) { return item && (item.label || item.type || item.role || item.name); }).filter(Boolean).slice(0, 30)
        });
        return true;
    }

    function sendConvertSelectedPsd() {
        log("send convert selected PSD");
        try {
            if (window.Editor && window.Editor.Message && typeof window.Editor.Message.send === "function") {
                window.Editor.Message.send(PACKAGE_NAME, "convert-selected-psd");
                return;
            }
        } catch (error) {}
        try {
            if (window.Editor && window.Editor.Ipc && typeof window.Editor.Ipc.sendToMain === "function") {
                window.Editor.Ipc.sendToMain(PACKAGE_NAME + ":convert-selected-psd");
                return;
            }
        } catch (error) {}
        log("cannot send convert message");
    }

    function patchEditorMenu() {
        if (!window.Editor || !window.Editor.Menu) {
            log("renderer Editor.Menu unavailable");
            return 0;
        }
        var count = 0;
        ["popup", "popupTemplate", "popupFromTemplate"].forEach(function (methodName) {
            var original = window.Editor.Menu[methodName];
            if (typeof original !== "function" || original.__psdPrefabPatched) {
                return;
            }
            window.Editor.Menu[methodName] = function () {
                var args = Array.prototype.slice.call(arguments);
                log("renderer Editor.Menu." + methodName + " called", summarizeArgs(args));
                for (var i = 0; i < args.length; i += 1) {
                    if (Array.isArray(args[i])) {
                        addTemplateItem(args[i]);
                    } else if (args[i] && Array.isArray(args[i].items)) {
                        addTemplateItem(args[i].items);
                    } else if (args[i] && Array.isArray(args[i].template)) {
                        addTemplateItem(args[i].template);
                    }
                }
                return original.apply(this, arguments);
            };
            window.Editor.Menu[methodName].__psdPrefabPatched = true;
            count += 1;
            log("renderer Editor.Menu." + methodName + " patched");
        });
        return count;
    }

    function patchElectronMenu() {
        if (!nodeRequire) {
            log("renderer require unavailable");
            return 0;
        }

        var electron = null;
        try {
            electron = nodeRequire("electron");
        } catch (error) {
            log("renderer electron require failed", error && error.message || String(error));
            return 0;
        }

        var remote = electron && electron.remote;
        if (!remote) {
            try {
                remote = nodeRequire("@electron/remote");
            } catch (error) {}
        }

        var Menu = remote && remote.Menu;
        var MenuItem = remote && remote.MenuItem;
        var count = 0;

        if (Menu && typeof Menu.buildFromTemplate === "function" && !Menu.buildFromTemplate.__psdPrefabPatched) {
            var originalBuildFromTemplate = Menu.buildFromTemplate;
            Menu.buildFromTemplate = function (template) {
                log("remote.Menu.buildFromTemplate called", summarizeTemplate(template));
                addTemplateItem(template);
                return originalBuildFromTemplate.apply(this, arguments);
            };
            Menu.buildFromTemplate.__psdPrefabPatched = true;
            count += 1;
            log("remote.Menu.buildFromTemplate patched");
        }

        if (Menu && Menu.prototype && typeof Menu.prototype.popup === "function" && !Menu.prototype.popup.__psdPrefabPatched) {
            var originalPopup = Menu.prototype.popup;
            Menu.prototype.popup = function () {
                log("remote.Menu.prototype.popup called");
                try {
                    if (MenuItem && shouldInject() && !this.__psdPrefabConvert) {
                        this.append(new MenuItem({ type: "separator" }));
                        this.append(new MenuItem({ label: LABEL, enabled: true, click: sendConvertSelectedPsd }));
                        this.__psdPrefabConvert = true;
                        log("remote menu item appended");
                    }
                } catch (error) {
                    log("remote menu append failed", error && error.message || String(error));
                }
                return originalPopup.apply(this, arguments);
            };
            Menu.prototype.popup.__psdPrefabPatched = true;
            count += 1;
            log("remote.Menu.prototype.popup patched");
        }

        if (!Menu) {
            log("remote.Menu unavailable", { hasRemote: !!remote });
        }

        return count;
    }

    function summarizeArgs(args) {
        return args.map(function (arg, index) {
            if (Array.isArray(arg)) {
                return { index: index, type: "array", length: arg.length };
            }
            if (arg && typeof arg === "object") {
                return { index: index, type: "object", keys: Object.keys(arg).slice(0, 20) };
            }
            return { index: index, type: typeof arg };
        });
    }

    function summarizeTemplate(template) {
        return {
            isArray: Array.isArray(template),
            length: Array.isArray(template) ? template.length : 0,
            labels: Array.isArray(template) ? template.map(function (item) { return item && (item.label || item.type || item.role || item.name); }).filter(Boolean).slice(0, 30) : []
        };
    }

    function collectFrameInfo() {
        var frames = [];
        try {
            for (var i = 0; i < window.frames.length; i += 1) {
                try {
                    frames.push({
                        index: i,
                        href: String(window.frames[i].location && window.frames[i].location.href || ""),
                        title: String(window.frames[i].document && window.frames[i].document.title || ""),
                        hasEditor: !!window.frames[i].Editor,
                        hasSelection: !!(window.frames[i].Editor && window.frames[i].Editor.Selection),
                        hasRequire: typeof window.frames[i].require === "function"
                    });
                } catch (frameError) {
                    frames.push({ index: i, error: frameError && frameError.message || String(frameError) });
                }
            }
        } catch (error) {}
        return frames;
    }

    var editorMenuPatches = patchEditorMenu();
    var electronMenuPatches = patchElectronMenu();
    var frames = collectFrameInfo();
    log("renderer asset menu injection installed", {
        href: String(window.location && window.location.href || ""),
        title: String(document && document.title || ""),
        editorMenuPatches: editorMenuPatches,
        electronMenuPatches: electronMenuPatches,
        hasEditor: !!window.Editor,
        hasSelection: !!(window.Editor && window.Editor.Selection),
        frameCount: frames.length,
        frames: frames.slice(0, 20)
    });

    return {
        status: "installed",
        href: String(window.location && window.location.href || ""),
        title: String(document && document.title || ""),
        editorMenuPatches: editorMenuPatches,
        electronMenuPatches: electronMenuPatches,
        hasEditor: !!window.Editor,
        hasSelection: !!(window.Editor && window.Editor.Selection),
        frameCount: frames.length,
        frames: frames.slice(0, 20)
    };
})();
`;
}

function patchEditorMenuPopup() {
    if (!Editor.Menu) {
        debugAssetMenu("Editor.Menu is unavailable");
        return false;
    }

    const methodNames = ["popup", "popupTemplate", "popupFromTemplate"];
    const restoreCallbacks = [];

    for (const methodName of methodNames) {
        const originalPopup = Editor.Menu[methodName];
        if (typeof originalPopup !== "function") {
            debugAssetMenu(`Editor.Menu.${methodName} is unavailable`);
            continue;
        }

        if (originalPopup.__psdPrefabPatched) {
            debugAssetMenu(`Editor.Menu.${methodName} already patched`);
            continue;
        }

        Editor.Menu[methodName] = function patchedPopup(...args) {
            debugAssetMenu(`Editor.Menu.${methodName} called`, summarizePopupArgs(args));
            try {
                injectPsdConvertMenu(args);
            } catch (error) {
                console.warn(`[${PACKAGE_NAME}] Failed to inject asset context menu.`, error);
            }

            return originalPopup.apply(this, args);
        };
        Editor.Menu[methodName].__psdPrefabPatched = true;
        Editor.Menu[methodName].__psdPrefabOriginal = originalPopup;
        debugAssetMenu(`Editor.Menu.${methodName} patched`);

        restoreCallbacks.push(() => {
            if (Editor.Menu && Editor.Menu[methodName] && Editor.Menu[methodName].__psdPrefabOriginal === originalPopup) {
                Editor.Menu[methodName] = originalPopup;
            }
        });
    }

    if (restoreCallbacks.length === 0) {
        debugAssetMenu("no Editor.Menu popup methods were patched");
        return false;
    }

    restoreAssetContextMenuPatch = () => restoreCallbacks.forEach((restore) => restore());
    return true;
}

function injectPsdConvertMenu(args) {
    const items = findPopupMenuItems(args);
    if (!items) {
        debugAssetMenu("popup called but no menu items array found", summarizePopupArgs(args));
        return;
    }

    const selectedPsdAsset = isSelectedPsdAsset();
    debugAssetMenu("popup menu items found", {
        itemCount: items.length,
        labels: items.map((item) => item && (item.label || item.type || item.role || item.name)).filter(Boolean).slice(0, 30),
        selectedPsdAsset,
    });

    if (!selectedPsdAsset) {
        return;
    }

    if (items.some((item) => item && item.__psdPrefabConvert)) {
        debugAssetMenu("PSD convert menu already exists");
        return;
    }

    if (items.length > 0 && items[items.length - 1] && items[items.length - 1].type !== "separator") {
        items.push({ type: "separator", __psdPrefabConvert: true });
    }

    items.push({
        label: ASSET_CONTEXT_MENU_LABEL,
        enabled: true,
        __psdPrefabConvert: true,
        click() {
            sendConvertSelectedPsd();
        },
    });
    debugAssetMenu("PSD convert menu injected");
}

function findPopupMenuItems(args) {
    for (const arg of args) {
        if (Array.isArray(arg)) {
            return arg;
        }

        if (arg && Array.isArray(arg.items)) {
            return arg.items;
        }

        if (arg && Array.isArray(arg.template)) {
            return arg.template;
        }
    }

    return null;
}

function isSelectedPsdAsset() {
    const selected = Editor.Selection && typeof Editor.Selection.getSelected === "function"
        ? Editor.Selection.getSelected("asset")
        : [];

    if (!selected || selected.length !== 1) {
        debugAssetMenu("selected asset is not single selection", { selected });
        return false;
    }

    const assetId = selected[0];
    const file = candidateToFile(assetId) || findAssetByUuid(assetId);
    const isPsd = /\.psd$/i.test(file);
    debugAssetMenu("selected asset resolved", { assetId, file, isPsd });
    return isPsd;
}

function sendConvertSelectedPsd() {
    compat.install(PACKAGE_NAME);
    debugAssetMenu("send convert selected PSD");

    if (Editor.Message && typeof Editor.Message.send === "function") {
        Editor.Message.send(PACKAGE_NAME, "convert-selected-psd");
        return;
    }

    if (Editor.Ipc && typeof Editor.Ipc.sendToMain === "function") {
        Editor.Ipc.sendToMain(`${PACKAGE_NAME}:convert-selected-psd`);
        return;
    }

    exports.methods.convertSelectedPsd();
}

function summarizePopupArgs(args) {
    return args.map((arg, index) => {
        if (Array.isArray(arg)) {
            return {
                index,
                type: "array",
                length: arg.length,
                labels: arg.map((item) => item && (item.label || item.type || item.role || item.name)).filter(Boolean).slice(0, 20),
            };
        }

        if (arg && typeof arg === "object") {
            return {
                index,
                type: "object",
                keys: Object.keys(arg).slice(0, 20),
                itemsLength: Array.isArray(arg.items) ? arg.items.length : undefined,
                templateLength: Array.isArray(arg.template) ? arg.template.length : undefined,
            };
        }

        return { index, type: typeof arg, value: String(arg).slice(0, 120) };
    });
}

function debugAssetMenu(message, data) {
    if (!DEBUG_ASSET_MENU) {
        return;
    }

    const text = data === undefined
        ? `[${PACKAGE_NAME}:asset-menu] ${message}`
        : `[${PACKAGE_NAME}:asset-menu] ${message} ${safeStringify(data)}`;

    if (Editor && typeof Editor.log === "function") {
        Editor.log(text);
    } else {
        console.log(text);
    }
}

function safeStringify(value) {
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}

function debugConvert(message, data) {
    if (!DEBUG_CONVERT) {
        return;
    }

    const text = data === undefined
        ? `[${PACKAGE_NAME}:convert] ${message}`
        : `[${PACKAGE_NAME}:convert] ${message} ${safeStringify(data)}`;

    if (Editor && typeof Editor.log === "function") {
        Editor.log(text);
    } else {
        console.log(text);
    }
}

async function convertByAssetId(assetId) {
    debugConvert("convertByAssetId start", assetId);
    try {
        const assetInfo = await queryPsdAssetInfo(assetId);
        debugConvert("asset info resolved", summarizeAssetInfo(assetInfo));
        if (!assetInfo || !assetInfo.file || !/\.psd$/i.test(assetInfo.file)) {
            throw new Error(`Selected asset is not a PSD file.${describeAsset(assetId, assetInfo)}`);
        }

        const result = await convertPsd(assetInfo);
        debugConvert("convertByAssetId success", result);
        Editor.Task.addNotice({
            title: "PSD converted",
            message: [
                `Prefab: ${result.prefabUrl}`,
                `Images: ${result.imageCount}`,
            ].join("\n"),
            type: "success",
            source: PACKAGE_NAME,
            timeout: 6000,
        });
    } catch (error) {
        debugConvert("convertByAssetId failed", error && error.stack || error && error.message || String(error));
        fail(error instanceof Error ? error.message : String(error), error);
    }
}

async function queryPsdAssetInfo(assetId) {
    debugConvert("queryPsdAssetInfo start", assetId);
    let assetInfo = null;
    try {
        assetInfo = await Editor.Message.request("asset-db", "query-asset-info", assetId);
        debugConvert("asset-db query-asset-info result", summarizeAssetInfo(assetInfo));
    } catch (error) {
        debugConvert("asset-db query-asset-info failed", error && error.message || String(error));
        console.warn(`[${PACKAGE_NAME}] Failed to query asset info for ${assetId}.`, error);
    }

    const normalizedInfo = normalizeAssetInfo(assetInfo, assetId);
    debugConvert("normalized by asset id", summarizeAssetInfo(normalizedInfo));
    if (isPsdAssetInfo(normalizedInfo)) {
        return normalizedInfo;
    }

    const localFile = findAssetByUuid(assetId);
    debugConvert("local meta lookup result", localFile);
    const localInfo = normalizeAssetInfo(assetInfo, localFile || assetId);
    debugConvert("normalized by local meta", summarizeAssetInfo(localInfo));
    if (isPsdAssetInfo(localInfo)) {
        return localInfo;
    }

    const url = await queryAssetUrl(assetId);
    debugConvert("asset-db query-url result", url);
    const urlInfo = normalizeAssetInfo(assetInfo, url || assetId);
    debugConvert("normalized by url", summarizeAssetInfo(urlInfo));
    if (isPsdAssetInfo(urlInfo)) {
        return urlInfo;
    }

    return normalizedInfo || urlInfo || localInfo || assetInfo;
}

async function queryAssetUrl(assetId) {
    if (!assetId || !isUuidLike(assetId)) {
        return "";
    }

    try {
        return await withTimeout(
            Editor.Message.request("asset-db", "query-url", assetId),
            1500,
            `asset-db query-url timeout: ${assetId}`
        );
    } catch (error) {
        debugConvert("asset-db query-url failed", error && error.message || String(error));
        return "";
    }
}

function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function summarizeAssetInfo(assetInfo) {
    if (!assetInfo || typeof assetInfo !== "object") {
        return assetInfo;
    }

    return {
        uuid: assetInfo.uuid,
        url: assetInfo.url,
        source: assetInfo.source,
        file: assetInfo.file,
        path: assetInfo.path,
        nativePath: assetInfo.nativePath,
        name: assetInfo.name,
        importer: assetInfo.importer,
        type: assetInfo.type,
        subAssetKeys: assetInfo.subAssets ? Object.keys(assetInfo.subAssets).slice(0, 20) : undefined,
    };
}

function normalizeAssetInfo(assetInfo, fallbackPath) {
    const source = assetInfo && typeof assetInfo === "object" ? assetInfo : {};
    const candidate = firstText(source.file, source.path, source.nativePath, source.url, source.source, fallbackPath);
    const file = candidateToFile(candidate);
    if (!file) {
        return assetInfo || null;
    }

    const url = firstText(source.url, source.source, fileToDbUrl(file));
    return {
        ...source,
        file,
        path: file,
        url,
        source: url,
        name: source.name || path.basename(file),
    };
}

function isPsdAssetInfo(assetInfo) {
    return !!assetInfo && typeof assetInfo.file === "string" && /\.psd$/i.test(assetInfo.file);
}

function firstText(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value;
        }
    }

    return "";
}

function candidateToFile(value) {
    if (!value) {
        return "";
    }

    const text = String(value).replace(/\\/g, "/");
    if (isUuidLike(text)) {
        return "";
    }

    if (text.startsWith("db://")) {
        return dbUrlToFile(text);
    }

    if (path.isAbsolute(value)) {
        return value;
    }

    if (text.startsWith("assets/")) {
        return path.join(Editor.Project.path, text.replace(/\//g, path.sep));
    }

    return path.join(Editor.Project.path, text.replace(/\//g, path.sep));
}

function findAssetByUuid(uuid) {
    if (!isUuidLike(uuid)) {
        return "";
    }

    const assetsDir = path.join(Editor.Project.path, "assets");
    const metaFile = findMetaByUuid(assetsDir, uuid);
    return metaFile ? metaFile.slice(0, -5) : "";
}

function findMetaByUuid(dir, uuid) {
    if (!dir || !fs.existsSync(dir)) {
        return "";
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findMetaByUuid(file, uuid);
            if (found) {
                return found;
            }
            continue;
        }

        if (!entry.name.endsWith(".meta")) {
            continue;
        }

        const meta = readJson(file, {});
        if (meta.uuid === uuid || Object.values(meta.subMetas || {}).some((subMeta) => subMeta && subMeta.uuid === uuid)) {
            return file;
        }
    }

    return "";
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[\w-]+)?$/i.test(String(value || ""));
}

function describeAsset(assetId, assetInfo) {
    const parts = [];
    if (assetId) {
        parts.push(`id=${assetId}`);
    }
    if (assetInfo && assetInfo.file) {
        parts.push(`file=${assetInfo.file}`);
    }
    if (assetInfo && assetInfo.url) {
        parts.push(`url=${assetInfo.url}`);
    }
    return parts.length ? ` (${parts.join(", ")})` : "";
}

function pickAssetId(value) {
    if (!value) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value)) {
        return pickAssetId(value[0]);
    }

    return value.uuid || value.url || value.source || value.file || "";
}

function createProgressReporter() {
    let lastPercent = -10;
    return (value) => {
        const percent = Math.max(0, Math.min(100, Math.floor(value / 10) * 10));
        if (percent === lastPercent) {
            return;
        }

        lastPercent = percent;
        logInfo(`[${PACKAGE_NAME}] ${percent}%`);
    };
}

function logInfo(message) {
    if (Editor && typeof Editor.log === "function") {
        Editor.log(message);
    } else {
        console.log(message);
    }
}

function withQuietConsole(callback) {
    const restore = silenceConsole();
    try {
        return callback();
    } finally {
        restore();
    }
}

async function withQuietConsoleAsync(callback) {
    const restore = silenceConsole();
    try {
        return await callback();
    } finally {
        restore();
    }
}

function silenceConsole() {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        debug: console.debug,
    };
    const noop = () => { };
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.debug = noop;

    return () => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.debug = original.debug;
    };
}

async function convertPsd(assetInfo) {
    const progress = createProgressReporter();
    const psdPath = assetInfo.file;
    const psdUrl = normalizeDbUrl(assetInfo.url || assetInfo.source);
    const psdDirUrl = dirnameUrl(psdUrl);
    const psdName = basenameNoExt(psdPath);
    const imageFolderUrl = `${psdDirUrl}/${psdName}`;
    const prefabUrl = `${psdDirUrl}/${psdName}.prefab`;

    debugConvert("convertPsd start", { psdPath, psdUrl, imageFolderUrl, prefabUrl });
    progress(0);
    debugConvert("ensure image folder", imageFolderUrl);
    ensureAssetFolder(imageFolderUrl);
    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    progress(10);

    debugConvert("load PSD start", psdPath);
    const psd = withQuietConsole(() => loadPsd(psdPath));
    debugConvert("load PSD done");
    progress(20);
    const documentSize = getDocumentSize(psd);
    debugConvert("document size", documentSize);
    debugConvert("extract layers start");
    const layers = await withQuietConsoleAsync(() => extractLayers(psd, psdName));
    debugConvert("extract layers done", {
        layerCount: layers.length,
        names: layers.map((layer) => layer.name).slice(0, 30),
    });
    if (layers.length === 0) {
        throw new Error("No visible layers found in PSD.");
    }
    progress(30);

    const images = assignDedupedImages(layers, imageFolderUrl);
    debugConvert("dedupe images done", { imageCount: images.length });
    progress(40);
    debugConvert("write PNG assets start");
    for (const image of images) {
        writePngAssetDirect(image.imageUrl, image.png);
    }
    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    debugConvert("write PNG assets done");
    progress(50);

    debugConvert("remove old deduped images start");
    await removeDedupedLayerImages(layers, imageFolderUrl);
    debugConvert("remove old deduped images done");

    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    await wait(600);
    progress(60);
    progress(70);

    debugConvert("query sprite frames start");
    for (const image of images) {
        image.spriteFrameUuid = await querySpriteFrameUuid(image.imageUrl);
        for (const layer of image.layers) {
            layer.spriteFrameUuid = image.spriteFrameUuid;
        }
    }
    debugConvert("query sprite frames done");
    progress(80);

    const imageCount = images.length;
    const prefabJson = buildPrefab(psdName, documentSize, layers);
    progress(90);
    debugConvert("write prefab start", prefabUrl);
    writeTextAssetDirect(prefabUrl, `${JSON.stringify(prefabJson, null, 2)}\n`);
    await removeLegacyMd5MapFile(imageFolderUrl);
    clearDedupState(layers, images);
    await Editor.Message.request("asset-db", "refresh-asset", psdDirUrl);
    progress(100);
    debugConvert("convertPsd done", { prefabUrl, imageCount });

    return {
        prefabUrl,
        imageCount,
    };
}

function loadPsd(psdPath) {
    const PSD = requirePsd();
    if (PSD.fromFile) {
        const psd = PSD.fromFile(psdPath);
        psd.parse();
        return psd;
    }

    const psd = new PSD(fs.readFileSync(psdPath));
    psd.parse();
    return psd;
}

function requirePsd() {
    try {
        const loaded = require("psd.js");
        return loaded.default || loaded;
    } catch (error) {
        throw new Error("缺少 psd.js 依赖。请在 D:\\tmep\\bindTool\\extensions\\psd-prefab 目录执行 npm install 后，重载扩展或重启 Creator。");
    }
}

function getDocumentSize(psd) {
    const header = psd.header || {};
    return {
        width: Number(header.width || psd.width || 0) || 1,
        height: Number(header.height || psd.height || 0) || 1,
    };
}

async function extractLayers(psd, rootName) {
    const nodes = getLayerNodes(psd);
    const layers = [];
    let index = 0;

    for (const node of nodes) {
        if (!isExportableNode(node)) {
            continue;
        }

        const info = getLayerInfo(node, `layer_${index + 1}`);
        const png = await exportNodePng(node);
        if (!png || png.length === 0) {
            continue;
        }

        layers.push({
            ...info,
            safeName: makeUniqueSafeName(info.name, layers),
            png,
            labelInfo: await createLabelInfo(info, png),
            order: index,
        });
        index += 1;
    }

    if (layers.length > 0) {
        return layers;
    }

    const png = await exportCompositePng(psd);
    if (!png) {
        return [];
    }

    const size = getDocumentSize(psd);
    return [{
        name: rootName,
        safeName: sanitizeFileName(rootName),
        left: 0,
        top: 0,
        width: size.width,
        height: size.height,
        png,
        labelInfo: null,
        order: 0,
    }];
}

function getLayerNodes(psd) {
    if (!psd.tree) {
        return [];
    }

    const tree = psd.tree();
    if (tree && typeof tree.descendants === "function") {
        return tree.descendants();
    }

    if (tree && typeof tree.children === "function") {
        return flattenTree(tree.children());
    }

    return [];
}

function flattenTree(nodes) {
    const result = [];
    for (const node of nodes || []) {
        result.push(node);
        if (typeof node.children === "function") {
            result.push(...flattenTree(node.children()));
        }
    }
    return result;
}

function isExportableNode(node) {
    if (!node) {
        return false;
    }

    if (typeof node.isGroup === "function" && node.isGroup()) {
        return false;
    }

    const layer = node.layer || {};
    if (node.visible === false || layer.visible === false) {
        return false;
    }

    return true;
}

function getLayerInfo(node, fallbackName) {
    const exported = typeof node.export === "function" ? node.export() : {};
    const layer = node.layer || {};
    const name = String(node.name || exported.name || layer.name || fallbackName);
    const left = numberOr(exported.left, layer.left, 0);
    const top = numberOr(exported.top, layer.top, 0);
    const width = numberOr(exported.width, layer.width, layer.right - layer.left, 1);
    const height = numberOr(exported.height, layer.height, layer.bottom - layer.top, 1);

    return {
        name,
        left,
        top,
        width: Math.max(1, width),
        height: Math.max(1, height),
    };
}

function numberOr(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) {
            return number;
        }
    }

    return 0;
}

async function exportNodePng(node) {
    const layer = node.layer || {};
    const image = layer.image || node.image;
    if (!image) {
        return null;
    }

    return exportImageLike(image);
}

async function exportCompositePng(psd) {
    if (psd.image) {
        return exportImageLike(psd.image);
    }

    return null;
}

async function exportImageLike(image) {
    const tmpFile = path.join(Editor.Project.tmpDir || Editor.Project.path, `.psd-prefab-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });

    const png = typeof image.toPng === "function" ? image.toPng() : null;
    if (png) {
        if (Buffer.isBuffer(png)) {
            return png;
        }

        if (typeof png.toBuffer === "function") {
            return png.toBuffer();
        }

        if (typeof png.pack === "function") {
            return streamToBuffer(png.pack());
        }
    }

    if (typeof image.saveAsPng === "function") {
        await image.saveAsPng(tmpFile);
        if (fs.existsSync(tmpFile)) {
            const buffer = fs.readFileSync(tmpFile);
            await safeUnlink(tmpFile);
            return buffer;
        }
    }

    return null;
}

async function safeUnlink(file) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            await fs.promises.unlink(file);
            return;
        } catch (error) {
            // Windows can briefly keep the PSD export temp file locked.
            await wait(50);
        }
    }
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
}

function writePngAssetDirect(imageUrl, pngBuffer) {
    const file = dbUrlToFile(imageUrl);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pngBuffer);
    const spriteFrameUuid = ensurePngMetaForFile(file);
    debugConvert("PNG asset written", { imageUrl, file, spriteFrameUuid });
}

function writeTextAssetDirect(url, content) {
    const file = dbUrlToFile(url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    ensureTextAssetMetaForFile(file);
    debugConvert("text asset written", { url, file });
}

function ensurePngMetaForFile(file) {
    const metaFile = `${file}.meta`;
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    const size = readPngSize(file) || { width: 0, height: 0 };
    const existing = readJson(metaFile, {});
    const textureUuid = existing.uuid || makeUuid();
    const existingSubMeta = existing.subMetas && (existing.subMetas[name] || Object.values(existing.subMetas)[0]) || {};
    const spriteFrameUuid = existingSubMeta.uuid || makeUuid();

    const meta = {
        ver: existing.ver || "2.3.7",
        uuid: textureUuid,
        importer: "texture",
        type: "sprite",
        wrapMode: existing.wrapMode || "clamp",
        filterMode: existing.filterMode || "bilinear",
        premultiplyAlpha: !!existing.premultiplyAlpha,
        genMipmaps: !!existing.genMipmaps,
        packable: existing.packable !== false,
        width: size.width,
        height: size.height,
        platformSettings: existing.platformSettings || {},
        subMetas: {
            [name]: {
                ver: existingSubMeta.ver || "1.0.6",
                uuid: spriteFrameUuid,
                importer: "sprite-frame",
                rawTextureUuid: textureUuid,
                trimType: existingSubMeta.trimType || "auto",
                trimThreshold: typeof existingSubMeta.trimThreshold === "number" ? existingSubMeta.trimThreshold : 1,
                rotated: false,
                offsetX: 0,
                offsetY: 0,
                trimX: 0,
                trimY: 0,
                width: size.width,
                height: size.height,
                rawWidth: size.width,
                rawHeight: size.height,
                borderTop: existingSubMeta.borderTop || 0,
                borderBottom: existingSubMeta.borderBottom || 0,
                borderLeft: existingSubMeta.borderLeft || 0,
                borderRight: existingSubMeta.borderRight || 0,
                subMetas: {},
            },
        },
    };

    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return spriteFrameUuid;
}

function ensureTextAssetMetaForFile(file) {
    const metaFile = `${file}.meta`;
    if (fs.existsSync(metaFile)) {
        return;
    }

    const ext = path.extname(file).toLowerCase();
    const meta = ext === ".prefab"
        ? {
            ver: "1.3.2",
            uuid: makeUuid(),
            importer: "prefab",
            optimizationPolicy: "AUTO",
            asyncLoadAssets: false,
            readonly: false,
            subMetas: {},
        }
        : {
            ver: "1.0.0",
            uuid: makeUuid(),
            importer: "asset",
            subMetas: {},
        };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function readPngSize(file) {
    try {
        const buffer = fs.readFileSync(file);
        if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
            return null;
        }
        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20),
        };
    } catch (error) {
        return null;
    }
}

function makeUuid() {
    const value = crypto.randomBytes(16);
    value[6] = value[6] & 0x0f | 0x40;
    value[8] = value[8] & 0x3f | 0x80;
    const hex = value.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function querySpriteFrameUuid(imageUrl) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        debugConvert("query sprite frame attempt", { imageUrl, attempt: attempt + 1 });
        const metaFile = `${dbUrlToFile(imageUrl)}.meta`;
        const metaInfo = readJson(metaFile, null);
        const metaSpriteFrame = findSpriteFrameInfo(metaInfo);
        if (metaSpriteFrame && metaSpriteFrame.uuid) {
            debugConvert("query sprite frame from meta", {
                imageUrl,
                metaFile,
                spriteFrameUuid: metaSpriteFrame.uuid,
            });
            return metaSpriteFrame.uuid;
        }

        let imageInfo = null;
        try {
            imageInfo = await withTimeout(
                Editor.Message.request("asset-db", "query-asset-info", imageUrl, ["uuid", "subAssets"]),
                1000,
                `asset-db query sprite frame timeout: ${imageUrl}`
            );
        } catch (error) {
            debugConvert("query sprite frame asset-db failed", error && error.message || String(error));
        }
        const spriteFrame = findSpriteFrameInfo(imageInfo);

        debugConvert("query sprite frame result", {
            imageUrl,
            imageInfo: summarizeAssetInfo(imageInfo),
            metaFile,
            hasMeta: !!metaInfo,
            spriteFrameUuid: spriteFrame && spriteFrame.uuid,
        });

        if (spriteFrame && spriteFrame.uuid) {
            return spriteFrame.uuid;
        }

        await wait(300);
    }

    throw new Error(`Cannot query SpriteFrame for ${imageUrl}`);
}

function findSpriteFrameInfo(info) {
    if (!info) {
        return null;
    }

    const subAssets = info.subAssets || info.subMetas || {};
    return Object.values(subAssets).find((asset) => asset && (asset.type === "cc.SpriteFrame" || asset.importer === "sprite-frame")) || null;
}

function assignDedupedImages(layers, imageFolderUrl) {
    const imagesByMd5 = new Map();
    const usedNames = new Set();

    for (const layer of layers) {
        if (layer.labelInfo) {
            continue;
        }

        const md5 = md5Buffer(layer.png);
        let image = imagesByMd5.get(md5);

        if (!image) {
            const safeName = makeUniqueName(layer.safeName, usedNames);
            image = {
                md5,
                safeName,
                imageUrl: `${imageFolderUrl}/${safeName}.png`,
                png: layer.png,
                layers: [],
            };
            imagesByMd5.set(md5, image);
        }

        layer.imageMd5 = md5;
        layer.imageUrl = image.imageUrl;
        image.layers.push(layer);
    }

    return Array.from(imagesByMd5.values());
}

function md5Buffer(buffer) {
    return crypto.createHash("md5").update(buffer).digest("hex");
}

async function createLabelInfo(layerInfo, pngBuffer) {
    if (!isTextLayerName(layerInfo.name)) {
        return null;
    }

    const imageInfo = analyzeTextPng(pngBuffer, layerInfo);
    const text = await recognizeText(pngBuffer) || placeholderTextFromLayerName(layerInfo.name);
    return {
        text,
        color: imageInfo.color,
        fontSize: imageInfo.fontSize,
        lineHeight: Math.max(imageInfo.fontSize, Math.round(layerInfo.height)),
    };
}

function isTextLayerName(name) {
    return /^text_/i.test(String(name || ""));
}

function analyzeTextPng(buffer, layerInfo) {
    try {
        const png = PNG.sync.read(buffer);
        const bounds = findOpaqueBounds(png);
        const color = getDominantColor(png, bounds);
        const textHeight = bounds ? bounds.maxY - bounds.minY + 1 : layerInfo.height;
        return {
            color,
            fontSize: Math.max(1, Math.round(Math.min(layerInfo.height * 1.35, textHeight * 1.45))),
        };
    } catch (error) {
        return {
            color: { r: 255, g: 255, b: 255, a: 255 },
            fontSize: Math.max(1, Math.round(layerInfo.height)),
        };
    }
}

function findOpaqueBounds(png) {
    let minX = png.width;
    let minY = png.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            const offset = (png.width * y + x) << 2;
            const alpha = png.data[offset + 3];
            if (alpha < 24) {
                continue;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (maxX < minX || maxY < minY) {
        return null;
    }

    return { minX, minY, maxX, maxY };
}

function getDominantColor(png, bounds) {
    if (!bounds) {
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    const buckets = new Map();
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            const offset = (png.width * y + x) << 2;
            const alpha = png.data[offset + 3];
            if (alpha < 128) {
                continue;
            }

            const r = png.data[offset];
            const g = png.data[offset + 1];
            const b = png.data[offset + 2];
            const key = `${r >> 4},${g >> 4},${b >> 4}`;
            const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, a: 0 };
            bucket.count += 1;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
            bucket.a += alpha;
            buckets.set(key, bucket);
        }
    }

    let best = null;
    for (const bucket of buckets.values()) {
        if (!best || bucket.count > best.count) {
            best = bucket;
        }
    }

    if (!best) {
        return { r: 255, g: 255, b: 255, a: 255 };
    }

    return {
        r: Math.round(best.r / best.count),
        g: Math.round(best.g / best.count),
        b: Math.round(best.b / best.count),
        a: 255,
    };
}

async function recognizeText(buffer) {
    try {
        const tesseract = require("tesseract.js");
        if (!tesseract || typeof tesseract.recognize !== "function") {
            return "";
        }

        const preprocessed = preprocessOcrImage(buffer);
        const first = preprocessed ? await recognizeTextBuffer(tesseract, preprocessed) : "";
        if (first) {
            return first;
        }

        return await recognizeTextBuffer(tesseract, buffer);
    } catch (error) {
        return "";
    }
}

async function recognizeTextBuffer(tesseract, buffer) {
    const result = await withQuietConsoleAsync(() => tesseract.recognize(buffer, "eng", {
        logger: () => { },
    }));
    return normalizeOcrText(String(result && result.data && result.data.text || ""));
}

function preprocessOcrImage(buffer) {
    try {
        const source = PNG.sync.read(buffer);
        const bounds = findOpaqueBounds(source);
        if (!bounds) {
            return null;
        }

        const scale = 4;
        const padding = 8;
        const sourceWidth = bounds.maxX - bounds.minX + 1;
        const sourceHeight = bounds.maxY - bounds.minY + 1;
        const output = new PNG({
            width: sourceWidth * scale + padding * 2,
            height: sourceHeight * scale + padding * 2,
        });

        output.data.fill(255);
        for (let y = 0; y < sourceHeight; y += 1) {
            for (let x = 0; x < sourceWidth; x += 1) {
                const sourceOffset = (source.width * (bounds.minY + y) + bounds.minX + x) << 2;
                const alpha = source.data[sourceOffset + 3];
                const isTextPixel = alpha >= 48;

                for (let sy = 0; sy < scale; sy += 1) {
                    for (let sx = 0; sx < scale; sx += 1) {
                        const outputX = padding + x * scale + sx;
                        const outputY = padding + y * scale + sy;
                        const outputOffset = (output.width * outputY + outputX) << 2;
                        const value = isTextPixel ? 0 : 255;
                        output.data[outputOffset] = value;
                        output.data[outputOffset + 1] = value;
                        output.data[outputOffset + 2] = value;
                        output.data[outputOffset + 3] = 255;
                    }
                }
            }
        }

        return PNG.sync.write(output);
    } catch (error) {
        return null;
    }
}

function normalizeOcrText(text) {
    return text
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

function placeholderTextFromLayerName(name) {
    const text = String(name || "")
        .replace(/^text_+/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
    return text || "TEXT";
}

async function removeDedupedLayerImages(layers, imageFolderUrl) {
    const keptUrls = new Set(layers.map((layer) => layer.imageUrl));
    const staleUrls = new Set();

    for (const layer of layers) {
        const originalUrl = `${imageFolderUrl}/${layer.safeName}.png`;
        if (originalUrl !== layer.imageUrl && !keptUrls.has(originalUrl)) {
            staleUrls.add(originalUrl);
        }
    }

    for (const url of staleUrls) {
        if (!fs.existsSync(dbUrlToFile(url))) {
            continue;
        }

        try {
            await Editor.Message.request("asset-db", "delete-asset", url);
        } catch (error) {
            // Ignore stale cleanup failures; conversion output is still valid.
        }
    }
}

async function removeLegacyMd5MapFile(imageFolderUrl) {
    const url = `${imageFolderUrl}/md5-map.json`;
    if (!fs.existsSync(dbUrlToFile(url))) {
        return;
    }

    try {
        await Editor.Message.request("asset-db", "delete-asset", url);
    } catch (error) {
        // Ignore legacy cleanup failures; conversion output is still valid.
    }
}

function clearDedupState(layers, images) {
    for (const layer of layers) {
        delete layer.png;
        delete layer.imageMd5;
    }

    for (const image of images) {
        delete image.png;
        delete image.md5;
        image.layers = [];
    }
}

function buildPrefab(prefabName, documentSize, layers) {
    const renderLayers = [...layers].reverse();
    const hierarchy = buildLayerHierarchy(renderLayers);
    const data = [{
        "__type__": "cc.Prefab",
        "_name": "",
        "_objFlags": 0,
        "_native": "",
        "data": { "__id__": 1 },
        "optimizationPolicy": 0,
        "asyncLoadAssets": false,
        "readonly": false,
    }];

    function appendNode(name, parentId, options = {}) {
        const nodeId = data.length;
        const node = createNode(name, parentId, {
            width: options.size && options.size.width || 0,
            height: options.size && options.size.height || 0,
            color: options.color,
        });
        data.push(node);

        if (parentId !== null) {
            data[parentId]._children.push({ "__id__": nodeId });
        }

        if (options.position) {
            node._trs.array[0] = options.position.x;
            node._trs.array[1] = options.position.y;
        }

        if (options.spriteFrameUuid) {
            const spriteId = data.length;
            node._components.push({ "__id__": spriteId });
            data.push(createSprite(nodeId, options.spriteFrameUuid));
        }

        if (options.labelInfo) {
            const labelId = data.length;
            node._components.push({ "__id__": labelId });
            data.push(createLabel(nodeId, options.labelInfo));
        }

        node._prefab = { "__id__": data.length };
        data.push(createPrefabInfo(1));
        return nodeId;
    }

    appendNode(prefabName, null, {
        size: { width: documentSize.width, height: documentSize.height },
    });

    function appendLayerItem(item, parentNodeId, parentPosition) {
        const layer = item.layer;
        const position = getLayerContentPosition(layer, documentSize);
        const nodeId = appendNode(layer.name, parentNodeId, {
            position: {
                x: position.x - parentPosition.x,
                y: position.y - parentPosition.y,
            },
            size: { width: layer.width, height: layer.height },
            color: layer.labelInfo ? layer.labelInfo.color : undefined,
            spriteFrameUuid: layer.labelInfo ? "" : layer.spriteFrameUuid,
            labelInfo: layer.labelInfo,
        });

        for (const child of item.children) {
            appendLayerItem(child, nodeId, position);
        }
    }

    for (const item of hierarchy) {
        appendLayerItem(item, 1, { x: 0, y: 0 });
    }

    return data;
}

function buildLayerHierarchy(renderLayers) {
    const items = renderLayers.map((layer, renderIndex) => ({
        layer,
        renderIndex,
        parent: null,
        children: [],
    }));

    for (const item of items) {
        let parent = null;
        for (const candidate of items) {
            if (candidate.renderIndex >= item.renderIndex) {
                continue;
            }

            if (!containsLayer(candidate.layer, item.layer)) {
                continue;
            }

            if (!parent || layerArea(candidate.layer) < layerArea(parent.layer)) {
                parent = candidate;
            }
        }

        item.parent = parent;
        if (parent) {
            parent.children.push(item);
        }
    }

    return items.filter((item) => !item.parent);
}

function containsLayer(parent, child) {
    const epsilon = 0.5;
    return parent.left <= child.left + epsilon
        && parent.top <= child.top + epsilon
        && parent.left + parent.width >= child.left + child.width - epsilon
        && parent.top + parent.height >= child.top + child.height - epsilon;
}

function layerArea(layer) {
    return layer.width * layer.height;
}

function getLayerContentPosition(layer, documentSize) {
    return {
        x: layer.left + layer.width / 2 - documentSize.width / 2,
        y: documentSize.height / 2 - layer.top - layer.height / 2,
    };
}

function createNode(name, parentId, options = {}) {
    const color = options.color || { r: 255, g: 255, b: 255, a: 255 };
    return {
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "_parent": parentId === null ? null : { "__id__": parentId },
        "_children": [],
        "_active": true,
        "_components": [],
        "_prefab": null,
        "_opacity": 255,
        "_color": {
            "__type__": "cc.Color",
            "r": color.r,
            "g": color.g,
            "b": color.b,
            "a": color.a,
        },
        "_contentSize": {
            "__type__": "cc.Size",
            "width": options.width || 0,
            "height": options.height || 0,
        },
        "_anchorPoint": { "__type__": "cc.Vec2", "x": 0.5, "y": 0.5 },
        "_trs": {
            "__type__": "TypedArray",
            "ctor": "Float64Array",
            "array": [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
        },
        "_eulerAngles": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
        "_skewX": 0,
        "_skewY": 0,
        "_is3DNode": false,
        "_groupIndex": 0,
        "groupIndex": 0,
        "_id": "",
    };
}

function createSprite(nodeId, spriteFrameUuid) {
    return {
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "node": { "__id__": nodeId },
        "_enabled": true,
        "_materials": [{ "__uuid__": DEFAULT_2D_MATERIAL_UUID }],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_spriteFrame": { "__uuid__": spriteFrameUuid },
        "_type": 0,
        "_sizeMode": 0,
        "_fillType": 0,
        "_fillCenter": { "__type__": "cc.Vec2", "x": 0, "y": 0 },
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": true,
        "_atlas": null,
        "_id": "",
    };
}

function createLabel(nodeId, labelInfo) {
    return {
        "__type__": "cc.Label",
        "_name": "",
        "_objFlags": 0,
        "node": { "__id__": nodeId },
        "_enabled": true,
        "_materials": [{ "__uuid__": DEFAULT_2D_MATERIAL_UUID }],
        "_srcBlendFactor": 770,
        "_dstBlendFactor": 771,
        "_string": labelInfo.text,
        "_N$string": labelInfo.text,
        "_fontSize": labelInfo.fontSize,
        "_lineHeight": labelInfo.lineHeight,
        "_enableWrapText": false,
        "_N$file": null,
        "_isSystemFontUsed": true,
        "_spacingX": 0,
        "_batchAsBitmap": false,
        "_styleFlags": 0,
        "_underlineHeight": 0,
        "_N$horizontalAlign": 1,
        "_N$verticalAlign": 1,
        "_N$fontFamily": "Arial",
        "_N$overflow": 0,
        "_N$cacheMode": 1,
        "_id": "",
    };
}

function createPrefabInfo(rootId) {
    return {
        "__type__": "cc.PrefabInfo",
        "root": { "__id__": rootId },
        "asset": { "__id__": 0 },
        "fileId": randomFileId(),
        "sync": false,
    };
}

function ensureAssetFolder(folderUrl) {
    const folderPath = dbUrlToFile(folderUrl);
    fs.mkdirSync(folderPath, { recursive: true });
}

function dbUrlToFile(url) {
    return path.join(Editor.Project.path, url.replace(/^db:\/\//, "").replace(/\//g, path.sep));
}

function fileToDbUrl(file) {
    const relative = path.relative(Editor.Project.path, file).replace(/\\/g, "/");
    return relative.startsWith("assets/") ? `db://${relative}` : relative;
}

function normalizeDbUrl(url) {
    if (!url) {
        return "";
    }

    return url.startsWith("db://") ? url : `db://${url.replace(/\\/g, "/")}`;
}

function dirnameUrl(url) {
    const slash = url.lastIndexOf("/");
    return slash >= 0 ? url.slice(0, slash) : "db://assets";
}

function basenameNoExt(file) {
    return path.basename(file, path.extname(file));
}

function sanitizeFileName(value) {
    return String(value || "layer")
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/^_+|_+$/g, "") || "layer";
}

function makeUniqueSafeName(name, layers) {
    const base = sanitizeFileName(name);
    const used = new Set(layers.map((layer) => layer.safeName));
    return makeUniqueName(base, used);
}

function makeUniqueName(baseName, used) {
    const base = sanitizeFileName(baseName);
    let next = base;
    let index = 2;
    while (used.has(next)) {
        next = `${base}_${index}`;
        index += 1;
    }
    used.add(next);
    return next;
}

function randomFileId() {
    return crypto.randomBytes(16).toString("base64").replace(/[+/=]/g, "").slice(0, 22);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        return fallback;
    }
}

function fail(message, error) {
    if (error) {
        console.error(`[${PACKAGE_NAME}] ${message}`, error);
    } else {
        console.error(`[${PACKAGE_NAME}] ${message}`);
    }

    Editor.Task.addNotice({
        title: "PSD convert failed",
        message,
        type: "error",
        source: PACKAGE_NAME,
        timeout: 8000,
    });
}
