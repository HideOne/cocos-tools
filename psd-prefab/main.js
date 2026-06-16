"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PACKAGE_NAME = "psd-prefab";
const WHITE_SPRITE_FRAME_UUID = "7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941";

exports.methods = {
    async convertSelectedPsd() {
        const selected = Editor.Selection.getSelected("asset");
        if (!selected || selected.length === 0) {
            return fail("Please select a PSD asset first.");
        }

        await convertByAssetId(selected[0]);
    },

    async convertPsdAsset(assetLike) {
        const assetId = pickAssetId(assetLike) || Editor.Selection.getSelected("asset")[0];
        if (!assetId) {
            return fail("Please select a PSD asset first.");
        }

        await convertByAssetId(assetId);
    },
};

exports.load = function load() {};
exports.unload = function unload() {};

async function convertByAssetId(assetId) {
    try {
        const assetInfo = await Editor.Message.request("asset-db", "query-asset-info", assetId);
        if (!assetInfo || !assetInfo.file || !/\.psd$/i.test(assetInfo.file)) {
            throw new Error("Selected asset is not a PSD file.");
        }

        const result = await convertPsd(assetInfo);
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
        fail(error instanceof Error ? error.message : String(error), error);
    }
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
        console.log(`[${PACKAGE_NAME}] ${percent}%`);
    };
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
    const noop = () => {};
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

    progress(0);
    ensureAssetFolder(imageFolderUrl);
    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    progress(10);

    const psd = withQuietConsole(() => loadPsd(psdPath));
    progress(20);
    const documentSize = getDocumentSize(psd);
    const layers = await withQuietConsoleAsync(() => extractLayers(psd, psdName));
    if (layers.length === 0) {
        throw new Error("No visible layers found in PSD.");
    }
    progress(30);

    const images = assignDedupedImages(layers, imageFolderUrl);
    progress(40);
    for (const image of images) {
        await Editor.Message.request("asset-db", "create-asset", image.imageUrl, image.png, { overwrite: true });
    }
    progress(50);

    await removeDedupedLayerImages(layers, imageFolderUrl);

    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    await wait(600);
    progress(60);
    progress(70);

    for (const image of images) {
        image.spriteFrameUuid = await querySpriteFrameUuid(image.imageUrl);
        for (const layer of image.layers) {
            layer.spriteFrameUuid = image.spriteFrameUuid;
        }
    }
    progress(80);

    const imageCount = images.length;
    const prefabJson = buildPrefab(psdName, documentSize, layers);
    progress(90);
    await Editor.Message.request("asset-db", "create-asset", prefabUrl, `${JSON.stringify(prefabJson, null, 2)}\n`, { overwrite: true });
    await removeLegacyMd5MapFile(imageFolderUrl);
    clearDedupState(layers, images);
    await Editor.Message.request("asset-db", "refresh-asset", psdDirUrl);
    progress(100);

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

    if (typeof image.saveAsPng === "function") {
        await image.saveAsPng(tmpFile);
        if (fs.existsSync(tmpFile)) {
            const buffer = fs.readFileSync(tmpFile);
            fs.unlinkSync(tmpFile);
            return buffer;
        }
    }

    const png = typeof image.toPng === "function" ? image.toPng() : null;
    if (!png) {
        return null;
    }

    if (Buffer.isBuffer(png)) {
        return png;
    }

    if (typeof png.toBuffer === "function") {
        return png.toBuffer();
    }

    if (typeof png.pack === "function") {
        return streamToBuffer(png.pack());
    }

    return null;
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
}

async function querySpriteFrameUuid(imageUrl) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const imageInfo = await Editor.Message.request("asset-db", "query-asset-info", imageUrl, ["uuid", "subAssets"]);
        const subAssets = imageInfo && imageInfo.subAssets ? Object.values(imageInfo.subAssets) : [];
        const spriteFrame = subAssets.find((asset) => asset && (asset.type === "cc.SpriteFrame" || asset.importer === "sprite-frame"));

        if (spriteFrame && spriteFrame.uuid) {
            return spriteFrame.uuid;
        }

        await wait(300);
    }

    throw new Error(`Cannot query SpriteFrame for ${imageUrl}`);
}

function assignDedupedImages(layers, imageFolderUrl) {
    const imagesByMd5 = new Map();
    const usedNames = new Set();

    for (const layer of layers) {
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
        "_name": prefabName,
        "_objFlags": 0,
        "__editorExtras__": {},
        "_native": "",
        "data": { "__id__": 1 },
        "optimizationPolicy": 0,
        "persistent": false,
    }];

    function appendNode(name, parentId, options = {}) {
        const nodeId = data.length;
        const node = createNode(name, parentId);
        data.push(node);

        if (parentId !== null) {
            data[parentId]._children.push({ "__id__": nodeId });
        }

        if (options.position) {
            node._lpos.x = options.position.x;
            node._lpos.y = options.position.y;
        }

        if (options.uiTransform) {
            const uiId = data.length;
            node._components.push({ "__id__": uiId });
            data.push(createUiTransform(nodeId, options.uiTransform.width, options.uiTransform.height, uiId + 1));
            data.push(createCompPrefabInfo());
        }

        if (options.spriteFrameUuid) {
            const spriteId = data.length;
            node._components.push({ "__id__": spriteId });
            data.push(createSprite(nodeId, options.spriteFrameUuid, spriteId + 1));
            data.push(createCompPrefabInfo());
        }

        if (options.widget) {
            const widgetId = data.length;
            node._components.push({ "__id__": widgetId });
            data.push(createWidget(nodeId, widgetId + 1));
            data.push(createCompPrefabInfo());
        }

        node._prefab = { "__id__": data.length };
        data.push(createPrefabInfo(1));
        return nodeId;
    }

    appendNode(prefabName, null, {
        uiTransform: { width: documentSize.width, height: documentSize.height },
    });

    appendNode("mask", 1, {
        uiTransform: { width: documentSize.width, height: documentSize.height },
        spriteFrameUuid: WHITE_SPRITE_FRAME_UUID,
        widget: true,
    });

    const contentNodeId = appendNode("content", 1, {
        uiTransform: { width: documentSize.width, height: documentSize.height },
    });

    function appendLayerItem(item, parentNodeId, parentPosition) {
        const layer = item.layer;
        const position = getLayerContentPosition(layer, documentSize);
        const nodeId = appendNode(layer.name, parentNodeId, {
            position: {
                x: position.x - parentPosition.x,
                y: position.y - parentPosition.y,
            },
            uiTransform: { width: layer.width, height: layer.height },
            spriteFrameUuid: layer.spriteFrameUuid,
        });

        for (const child of item.children) {
            appendLayerItem(child, nodeId, position);
        }
    }

    for (const item of hierarchy) {
        appendLayerItem(item, contentNodeId, { x: 0, y: 0 });
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

function createNode(name, parentId) {
    return {
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": parentId === null ? null : { "__id__": parentId },
        "_children": [],
        "_active": true,
        "_components": [],
        "_prefab": null,
        "_lpos": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
        "_lrot": { "__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1 },
        "_lscale": { "__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1 },
        "_mobility": 0,
        "_layer": 1073741824,
        "_euler": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
        "_id": "",
    };
}

function createUiTransform(nodeId, width, height, prefabInfoId) {
    return {
        "__type__": "cc.UITransform",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": { "__id__": nodeId },
        "_enabled": true,
        "__prefab": { "__id__": prefabInfoId },
        "_contentSize": { "__type__": "cc.Size", "width": width, "height": height },
        "_anchorPoint": { "__type__": "cc.Vec2", "x": 0.5, "y": 0.5 },
        "_id": "",
    };
}

function createSprite(nodeId, spriteFrameUuid, prefabInfoId) {
    return {
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": { "__id__": nodeId },
        "_enabled": true,
        "__prefab": { "__id__": prefabInfoId },
        "_customMaterial": null,
        "_srcBlendFactor": 2,
        "_dstBlendFactor": 4,
        "_color": { "__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255 },
        "_spriteFrame": { "__uuid__": spriteFrameUuid, "__expectedType__": "cc.SpriteFrame" },
        "_type": 0,
        "_fillType": 0,
        "_sizeMode": 0,
        "_fillCenter": { "__type__": "cc.Vec2", "x": 0, "y": 0 },
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": true,
        "_useGrayscale": false,
        "_atlas": null,
        "_id": "",
    };
}

function createWidget(nodeId, prefabInfoId) {
    return {
        "__type__": "cc.Widget",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": { "__id__": nodeId },
        "_enabled": true,
        "__prefab": { "__id__": prefabInfoId },
        "_alignFlags": 45,
        "_target": null,
        "_left": 0,
        "_right": 0,
        "_top": 0,
        "_bottom": 0,
        "_horizontalCenter": 0,
        "_verticalCenter": 0,
        "_isAbsLeft": true,
        "_isAbsRight": true,
        "_isAbsTop": true,
        "_isAbsBottom": true,
        "_isAbsHorizontalCenter": true,
        "_isAbsVerticalCenter": true,
        "_originalWidth": 0,
        "_originalHeight": 0,
        "_alignMode": 2,
        "_lockFlags": 0,
        "_id": "",
    };
}

function createCompPrefabInfo() {
    return {
        "__type__": "cc.CompPrefabInfo",
        "fileId": randomFileId(),
    };
}

function createPrefabInfo(rootId) {
    return {
        "__type__": "cc.PrefabInfo",
        "root": { "__id__": rootId },
        "asset": { "__id__": 0 },
        "fileId": randomFileId(),
        "instance": null,
        "targetOverrides": null,
        "nestedPrefabInstanceRoots": null,
    };
}

function ensureAssetFolder(folderUrl) {
    const folderPath = dbUrlToFile(folderUrl);
    fs.mkdirSync(folderPath, { recursive: true });
}

function dbUrlToFile(url) {
    return path.join(Editor.Project.path, url.replace(/^db:\/\//, "").replace(/\//g, path.sep));
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
