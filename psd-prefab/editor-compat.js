"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function install(packageName) {
    const editor = global.Editor || (global.Editor = {});
    ensureProject(editor);
    ensureTask(editor, packageName);
    ensureMessage(editor);
}

function ensureProject(editor) {
    editor.Project = editor.Project || {};
    editor.Project.path = editor.Project.path || findProjectPath();
    editor.Project.tmpDir = editor.Project.tmpDir || path.join(editor.Project.path, "temp");
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

function ensureMessage(editor) {
    if (editor.Message && typeof editor.Message.request === "function" && typeof editor.Message.send === "function") {
        return;
    }

    const originalMessage = editor.Message || {};
    editor.Message = {
        ...originalMessage,

        request(channel, message, ...args) {
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
            }
        },
    };
}

async function requestAssetDb(editor, message, args) {
    if (editor.assetdb) {
        const result = await requestOldAssetDb(editor.assetdb, message, args);
        if (result !== undefined) {
            return result;
        }
    }

    switch (message) {
        case "query-asset-info":
            return queryAssetInfo(args[0]);
        case "query-uuid": {
            const info = await queryAssetInfo(args[0]);
            return info && info.uuid;
        }
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
    if (!editor.Ipc || typeof editor.Ipc.sendToMain !== "function") {
        throw new Error(`Editor.Message.request is unavailable for ${channel}:${message}.`);
    }

    return new Promise((resolve, reject) => {
        const callback = (...callbackArgs) => {
            const error = callbackArgs.find((item) => item instanceof Error);
            if (error) {
                reject(error);
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
        if (ext === ".png") {
            updatePngMetaSize(file, metaFile);
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

function updatePngMetaSize(file, metaFile) {
    const meta = readJson(metaFile, null);
    const size = readPngSize(file);
    if (!meta || !size || (meta.width && meta.height)) {
        return;
    }
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
    return { file, url: fileToDbUrl(file) };
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
                return { file: assetFile, url: fileToDbUrl(assetFile) };
            }
        }
    }
    return null;
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        return fallback;
    }
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

function findProjectPath() {
    let current = process.cwd();
    while (current && current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, "project.json"))) {
            return current;
        }
        current = path.dirname(current);
    }
    return process.cwd();
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

module.exports = { install };
