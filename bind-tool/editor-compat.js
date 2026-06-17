"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MESSAGE_COMPAT_VERSION = 2;
const DEBUG_SCENE_IPC = false;

function install(packageName) {
    const editor = ensureEditor();
    ensureProject(editor);
    ensureTask(editor, packageName);
    ensureProfile(editor);
    ensureSelection(editor);
    ensureMessage(editor);
}

function ensureEditor() {
    if (!global.Editor) {
        global.Editor = {};
    }
    return global.Editor;
}

function ensureProject(editor) {
    editor.Project = editor.Project || {};
    const detectedProjectPath = findProjectPath();
    if (!isProjectPath(editor.Project.path) && isProjectPath(detectedProjectPath)) {
        editor.Project.path = detectedProjectPath;
    } else if (!editor.Project.path) {
        editor.Project.path = detectedProjectPath;
    }
    if (!editor.Project.tmpDir || path.resolve(editor.Project.tmpDir).indexOf(path.resolve(editor.Project.path)) !== 0) {
        editor.Project.tmpDir = path.join(editor.Project.path, "temp");
    }
}

function ensureTask(editor, packageName) {
    if (editor.Task && typeof editor.Task.addNotice === "function") {
        return;
    }

    editor.Task = {
        addNotice(notice) {
            const title = notice && notice.title ? notice.title : packageName;
            const message = notice && notice.message ? `\n${notice.message}` : "";
            const text = `[${notice && notice.source || packageName}] ${title}${message}`;
            if (notice && notice.type === "error" && typeof editor.error === "function") {
                editor.error(text);
            } else if (notice && notice.type === "success" && typeof editor.success === "function") {
                editor.success(text);
            } else if (typeof editor.log === "function") {
                editor.log(text);
            } else {
                console.log(text);
            }
        },
    };
}

function ensureProfile(editor) {
    if (editor.Profile && typeof editor.Profile.getProject === "function" && typeof editor.Profile.setProject === "function") {
        return;
    }

    const originalProfile = editor.Profile || {};
    editor.Profile = originalProfile;

    if (typeof editor.Profile.getProject !== "function") {
        editor.Profile.getProject = async function getProject(packageName) {
            return readJson(profilePath(packageName), {});
        };
    }

    if (typeof editor.Profile.setProject !== "function") {
        editor.Profile.setProject = async function setProject(packageName, key, value) {
            const file = profilePath(packageName);
            const data = readJson(file, {});
            data[key] = value;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        };
    }
}

function ensureSelection(editor) {
    if (!editor.Selection) {
        return;
    }

    if (!editor.Selection.getSelected && typeof editor.Selection.curSelection === "function") {
        editor.Selection.getSelected = function getSelected(type) {
            return editor.Selection.curSelection(type) || [];
        };
    }

    if (!editor.Selection.getLastSelected) {
        editor.Selection.getLastSelected = function getLastSelected(type) {
            const selected = editor.Selection.getSelected ? editor.Selection.getSelected(type) : [];
            return selected && selected[selected.length - 1] || "";
        };
    }
}

function ensureMessage(editor) {
    if (editor.Message && editor.Message.__bindToolCompatVersion === MESSAGE_COMPAT_VERSION) {
        return;
    }

    const currentMessage = editor.Message || {};
    const originalMessage = currentMessage.__bindToolOriginalMessage || currentMessage;
    editor.Message = {
        ...currentMessage,

        request(channel, message, ...args) {
            if (channel === "scene") {
                return requestScene(editor, originalMessage, message, args);
            }

            if (originalMessage.request) {
                return originalMessage.request(channel, message, ...args);
            }

            if (channel === "asset-db") {
                return requestAssetDb(editor, message, args);
            }

            return requestByIpc(editor, channel, message, args);
        },

        send(channel, message, ...args) {
            if (originalMessage.send) {
                return originalMessage.send(channel, message, ...args);
            }

            if (editor.Ipc && typeof editor.Ipc.sendToMain === "function") {
                editor.Ipc.sendToMain(`${channel}:${message}`, ...args);
                return;
            }

            if (editor.Ipc && typeof editor.Ipc.sendToPanel === "function") {
                editor.Ipc.sendToPanel(channel, `${channel}:${message}`, ...args);
            }
        },
    };
    editor.Message.__bindToolCompatWrapped = true;
    editor.Message.__bindToolCompatVersion = MESSAGE_COMPAT_VERSION;
    editor.Message.__bindToolOriginalMessage = originalMessage;
}

async function requestScene(editor, originalMessage, message, args) {
    const failures = [];

    if (originalMessage.request) {
        try {
            const result = await withTimeout(
                originalMessage.request("scene", message, ...args),
                1500,
                `scene:${message} original request timeout`
            );
            const failure = getIpcFailureMessage(result);
            if (failure) {
                throw new Error(failure);
            }
            if (!isValidSceneResult(message, result)) {
                throw new Error(`scene:${message} returned invalid result: ${describeResult(result)}`);
            }
            debugSceneIpc(editor, `original ${message} success`);
            return result;
        } catch (error) {
            debugSceneIpc(editor, `original ${message} failed`, error && error.message || String(error));
            failures.push(error);
        }
    }

    for (const candidate of getSceneMessageCandidates(message)) {
        try {
            const result = await withTimeout(
                requestByIpcPanel(editor, "scene", candidate, args),
                1500,
                `scene:${candidate} panel request timeout`
            );
            const failure = getIpcFailureMessage(result);
            if (failure) {
                throw new Error(failure);
            }
            if (!isValidSceneResult(candidate, result)) {
                throw new Error(`scene:${candidate} returned invalid result: ${describeResult(result)}`);
            }
            debugSceneIpc(editor, `panel ${candidate} success`);
            return result;
        } catch (error) {
            debugSceneIpc(editor, `panel ${candidate} failed`, error && error.message || String(error));
            failures.push(error);
        }
    }

    const last = failures[failures.length - 1];
    throw last || new Error(`Editor scene request failed: ${message}`);
}

function getSceneMessageCandidates(message) {
    switch (message) {
        case "query-node-tree":
            return ["query-node-tree", "query-node"];
        case "query-node":
            return ["query-node", "query-node-tree"];
        case "query-component":
            return ["query-component", "query-component-dump"];
        default:
            return [message];
    }
}

async function requestAssetDb(editor, message, args) {
    if (editor.assetdb) {
        const fromAssetDb = await requestOldAssetDb(editor.assetdb, message, args);
        if (fromAssetDb !== undefined) {
            return fromAssetDb;
        }
    }

    switch (message) {
        case "query-asset-info":
            return queryAssetInfo(args[0]);
        case "query-uuid":
            return queryAssetInfo(args[0]).then((info) => info && info.uuid);
        case "query-url":
            return queryUrlByUuid(args[0]);
        case "create-asset":
        case "save-asset":
        case "write-asset":
            return writeAsset(args[0], args[1]);
        case "refresh-asset":
        case "reimport-asset":
            return true;
        case "delete-asset":
            return deleteAsset(args[0]);
        default:
            throw new Error(`Unsupported asset-db request: ${message}`);
    }
}

function requestOldAssetDb(assetdb, message, args) {
    return new Promise((resolve) => {
        const done = (err, result) => resolve(err ? undefined : result);
        try {
            if (message === "query-asset-info") {
                const id = args[0];
                if (typeof assetdb.queryInfoByUuid === "function" && isUuidLike(id)) {
                    assetdb.queryInfoByUuid(id, done);
                    return;
                }
                if (typeof assetdb.queryInfoByUrl === "function") {
                    assetdb.queryInfoByUrl(normalizeDbUrl(id), done);
                    return;
                }
            }

            if (message === "query-uuid" && typeof assetdb.urlToUuid === "function") {
                assetdb.urlToUuid(normalizeDbUrl(args[0]), done);
                return;
            }

            if (message === "query-url" && typeof assetdb.uuidToUrl === "function") {
                assetdb.uuidToUrl(args[0], done);
                return;
            }

            if (message === "create-asset" && typeof assetdb.create === "function") {
                assetdb.create(normalizeDbUrl(args[0]), args[1], done);
                return;
            }

            if ((message === "save-asset" || message === "write-asset") && typeof assetdb.saveExists === "function") {
                assetdb.saveExists(normalizeDbUrl(args[0]), args[1], done);
                return;
            }

            if ((message === "refresh-asset" || message === "reimport-asset") && typeof assetdb.refresh === "function") {
                assetdb.refresh(normalizeDbUrl(args[0]), done);
                return;
            }

            if (message === "delete-asset" && typeof assetdb.delete === "function") {
                assetdb.delete(normalizeDbUrl(args[0]), done);
                return;
            }
        } catch (error) {
            resolve(undefined);
            return;
        }

        resolve(undefined);
    });
}

function requestByIpc(editor, channel, message, args) {
    if (editor.Ipc && typeof editor.Ipc.sendToMain === "function") {
        return new Promise((resolve, reject) => {
            const callback = (...callbackArgs) => {
                const err = findIpcCallbackError(callbackArgs);
                if (err) {
                    reject(err);
                    return;
                }

                resolve(callbackArgs[callbackArgs.length - 1]);
            };

            try {
                editor.Ipc.sendToMain(`${channel}:${message}`, ...args, callback);
            } catch (error) {
                reject(error);
            }
        });
    }

    return requestByIpcPanel(editor, channel, message, args);
}

function requestByIpcPanel(editor, channel, message, args) {
    if (!editor.Ipc || typeof editor.Ipc.sendToPanel !== "function") {
        throw new Error(`Editor.Message.request is unavailable for ${channel}:${message}.`);
    }

    return new Promise((resolve, reject) => {
        const callback = (...callbackArgs) => {
            const err = findIpcCallbackError(callbackArgs);
            if (err) {
                reject(err);
                return;
            }

            resolve(callbackArgs[callbackArgs.length - 1]);
        };

        try {
            editor.Ipc.sendToPanel(channel, `${channel}:${message}`, ...args, callback);
        } catch (error) {
            reject(error);
        }
    });
}

function findIpcCallbackError(callbackArgs) {
    const error = callbackArgs.find((item) => item instanceof Error);
    if (error) {
        return error;
    }

    for (const item of callbackArgs) {
        const message = getIpcFailureMessage(item);
        if (message) {
            return new Error(message);
        }
    }

    return null;
}

function isIpcFailureResult(value) {
    return Boolean(getIpcFailureMessage(value));
}

function getIpcFailureMessage(value) {
    let text = "";
    if (value instanceof Error) {
        text = value.message;
    } else if (typeof value === "string" || value instanceof String) {
        text = String(value);
    } else if (value && typeof value === "object" && typeof value.message === "string") {
        text = value.message;
    }

    if (!text) {
        return "";
    }

    return (
        /message not found/i.test(text) ||
        /no response received/i.test(text) ||
        /failed to send ipc/i.test(text) ||
        /ipc failed/i.test(text)
    ) ? text : "";
}

function isValidSceneResult(message, result) {
    if (!/^query-node/.test(message)) {
        return true;
    }

    return Boolean(
        result &&
        typeof result === "object" &&
        !(result instanceof String) &&
        !Array.isArray(result)
    );
}

function describeResult(result) {
    if (result === null) {
        return "null";
    }
    if (result === undefined) {
        return "undefined";
    }
    if (typeof result === "string" || result instanceof String) {
        return JSON.stringify(String(result).slice(0, 120));
    }
    if (typeof result !== "object") {
        return String(result);
    }
    try {
        return JSON.stringify(Object.keys(result).slice(0, 20));
    } catch (error) {
        return Object.prototype.toString.call(result);
    }
}

function debugSceneIpc(editor, message, data) {
    if (!DEBUG_SCENE_IPC) {
        return;
    }

    const text = data === undefined
        ? `[bind-tool:compat] ${message}`
        : `[bind-tool:compat] ${message} ${JSON.stringify(String(data).slice(0, 200))}`;

    if (editor && typeof editor.log === "function") {
        editor.log(text);
    } else {
        console.log(text);
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

function queryAssetInfo(assetLike) {
    const resolved = resolveAsset(assetLike);
    if (!resolved) {
        return Promise.resolve(null);
    }

    const meta = readJson(`${resolved.file}.meta`, {});
    return Promise.resolve({
        uuid: meta.uuid || "",
        url: resolved.url,
        source: resolved.url,
        file: resolved.file,
        path: resolved.file,
        name: path.basename(resolved.file),
        importer: meta.importer,
        type: meta.type,
        subAssets: makeSubAssets(meta),
    });
}

function queryUrlByUuid(uuid) {
    const found = findMetaByUuid(uuid);
    return Promise.resolve(found && found.url || "");
}

function writeAsset(url, content) {
    const file = dbUrlToFile(url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    ensureMetaForAsset(file);
    return Promise.resolve(queryAssetInfo(url));
}

function deleteAsset(url) {
    const file = dbUrlToFile(url);
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
    }
    if (fs.existsSync(`${file}.meta`)) {
        fs.unlinkSync(`${file}.meta`);
    }
    return Promise.resolve(true);
}

function makeSubAssets(meta) {
    const result = {};
    for (const [name, subMeta] of Object.entries(meta.subMetas || {})) {
        result[name] = {
            uuid: subMeta.uuid,
            type: subMeta.importer === "sprite-frame" ? "cc.SpriteFrame" : subMeta.type,
            importer: subMeta.importer,
        };
    }
    return result;
}

function ensureMetaForAsset(file) {
    const metaFile = `${file}.meta`;
    const ext = path.extname(file).toLowerCase();
    if (fs.existsSync(metaFile)) {
        if (ext === ".ts") {
            const meta = readJson(metaFile, null);
            if (meta && meta.importer !== "typescript") {
                meta.ver = meta.ver || "1.1.0";
                meta.importer = "typescript";
                meta.isPlugin = false;
                meta.loadPluginInWeb = true;
                meta.loadPluginInNative = true;
                meta.loadPluginInEditor = false;
                meta.subMetas = meta.subMetas || {};
                fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
            }
        }
        if (ext === ".png") {
            const meta = readJson(metaFile, null);
            const size = readPngSize(file);
            if (meta && size && (!meta.width || !meta.height)) {
                meta.width = size.width;
                meta.height = size.height;
                for (const subMeta of Object.values(meta.subMetas || {})) {
                    subMeta.width = subMeta.width || size.width;
                    subMeta.height = subMeta.height || size.height;
                    subMeta.rawWidth = subMeta.rawWidth || size.width;
                    subMeta.rawHeight = subMeta.rawHeight || size.height;
                }
                fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
            }
        }
        return;
    }

    let meta;
    if (ext === ".prefab") {
        meta = {
            ver: "1.3.2",
            uuid: makeUuid(),
            importer: "prefab",
            optimizationPolicy: "AUTO",
            asyncLoadAssets: false,
            readonly: false,
            subMetas: {},
        };
    } else if (ext === ".ts") {
        meta = {
            ver: "1.1.0",
            uuid: makeUuid(),
            importer: "typescript",
            isPlugin: false,
            loadPluginInWeb: true,
            loadPluginInNative: true,
            loadPluginInEditor: false,
            subMetas: {},
        };
    } else if (ext === ".png") {
        const name = path.basename(file, ext);
        const textureUuid = makeUuid();
        const size = readPngSize(file) || { width: 0, height: 0 };
        meta = {
            ver: "2.3.7",
            uuid: textureUuid,
            importer: "texture",
            type: "sprite",
            wrapMode: "clamp",
            filterMode: "bilinear",
            premultiplyAlpha: false,
            genMipmaps: false,
            packable: true,
            width: size.width,
            height: size.height,
            platformSettings: {},
            subMetas: {
                [name]: {
                    ver: "1.0.6",
                    uuid: makeUuid(),
                    importer: "sprite-frame",
                    rawTextureUuid: textureUuid,
                    trimType: "auto",
                    trimThreshold: 1,
                    rotated: false,
                    offsetX: 0,
                    offsetY: 0,
                    trimX: 0,
                    trimY: 0,
                    width: size.width,
                    height: size.height,
                    rawWidth: size.width,
                    rawHeight: size.height,
                    borderTop: 0,
                    borderBottom: 0,
                    borderLeft: 0,
                    borderRight: 0,
                    subMetas: {},
                },
            },
        };
    } else {
        meta = { ver: "1.0.0", uuid: makeUuid(), importer: "asset", subMetas: {} };
    }

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

function resolveAsset(assetLike) {
    if (!assetLike) {
        return null;
    }

    if (typeof assetLike === "object") {
        return resolveAsset(assetLike.uuid || assetLike.url || assetLike.source || assetLike.file || assetLike.path);
    }

    const value = String(assetLike);
    if (isUuidLike(value)) {
        return findMetaByUuid(value);
    }

    const file = path.isAbsolute(value) ? value : dbUrlToFile(value);
    return {
        file,
        url: fileToDbUrl(file),
    };
}

function findMetaByUuid(uuid) {
    const assets = path.join(findProjectPath(), "assets");
    const stack = [assets];
    while (stack.length) {
        const dir = stack.pop();
        if (!dir || !fs.existsSync(dir)) {
            continue;
        }

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(file);
                continue;
            }

            if (!entry.name.endsWith(".meta")) {
                continue;
            }

            const meta = readJson(file, {});
            if (meta.uuid === uuid || Object.values(meta.subMetas || {}).some((subMeta) => subMeta && subMeta.uuid === uuid)) {
                const assetFile = file.slice(0, -5);
                return {
                    file: assetFile,
                    url: fileToDbUrl(assetFile),
                };
            }
        }
    }

    return null;
}

function profilePath(packageName) {
    return path.join(findProjectPath(), "settings", `${packageName}.json`);
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        return fallback;
    }
}

function findProjectPath() {
    const candidates = [
        __dirname,
        process.cwd(),
        global.Editor && global.Editor.Project && global.Editor.Project.path,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const found = findProjectPathFrom(candidate);
        if (found) {
            return found;
        }
    }

    return process.cwd();
}

function findProjectPathFrom(start) {
    let current = path.resolve(String(start));
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
        current = path.dirname(current);
    }

    while (current && current !== path.dirname(current)) {
        if (isProjectPath(current)) {
            return current;
        }
        current = path.dirname(current);
    }

    return "";
}

function isProjectPath(value) {
    return Boolean(value && fs.existsSync(path.join(String(value), "project.json")));
}

function normalizeDbUrl(value) {
    const text = String(value || "").replace(/\\/g, "/");
    if (text.startsWith("db://")) {
        return text;
    }
    if (text.startsWith("assets/")) {
        return `db://${text}`;
    }
    if (text.startsWith("/assets/")) {
        return `db://${text.slice(1)}`;
    }
    return text;
}

function dbUrlToFile(url) {
    const normalized = normalizeDbUrl(url);
    if (path.isAbsolute(normalized)) {
        return normalized;
    }
    return path.join(findProjectPath(), normalized.replace(/^db:\/\//, "").replace(/\//g, path.sep));
}

function fileToDbUrl(file) {
    const relative = path.relative(findProjectPath(), file).replace(/\\/g, "/");
    return relative.startsWith("assets/") ? `db://${relative}` : relative;
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[\w-]+)?$/i.test(String(value || ""));
}

function makeUuid() {
    const value = crypto.randomBytes(16);
    value[6] = value[6] & 0x0f | 0x40;
    value[8] = value[8] & 0x3f | 0x80;
    const hex = value.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = {
    install,
};
