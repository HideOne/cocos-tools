"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PACKAGE_NAME = "psd-prefab";

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

async function convertPsd(assetInfo) {
    const psdPath = assetInfo.file;
    const psdUrl = normalizeDbUrl(assetInfo.url || assetInfo.source);
    const psdDirUrl = dirnameUrl(psdUrl);
    const psdName = basenameNoExt(psdPath);
    const imageFolderUrl = `${psdDirUrl}/${psdName}`;
    const prefabUrl = `${psdDirUrl}/${psdName}.prefab`;

    ensureAssetFolder(imageFolderUrl);
    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);

    const psd = loadPsd(psdPath);
    const documentSize = getDocumentSize(psd);
    const layers = await extractLayers(psd, psdName);
    if (layers.length === 0) {
        throw new Error("No visible layers found in PSD.");
    }

    for (const layer of layers) {
        const imageUrl = `${imageFolderUrl}/${layer.safeName}.png`;
        await Editor.Message.request("asset-db", "create-asset", imageUrl, layer.png, { overwrite: true });
        layer.imageUrl = imageUrl;
    }

    await Editor.Message.request("asset-db", "refresh-asset", imageFolderUrl);
    await wait(600);

    for (const layer of layers) {
        layer.spriteFrameUuid = await querySpriteFrameUuid(layer.imageUrl);
    }

    const prefabJson = buildPrefab(psdName, documentSize, layers);
    await Editor.Message.request("asset-db", "create-asset", prefabUrl, `${JSON.stringify(prefabJson, null, 2)}\n`, { overwrite: true });
    await Editor.Message.request("asset-db", "refresh-asset", psdDirUrl);

    return {
        prefabUrl,
        imageCount: layers.length,
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
    const imageInfo = await Editor.Message.request("asset-db", "query-asset-info", imageUrl, ["uuid", "subAssets"]);
    const subAssets = imageInfo && imageInfo.subAssets ? Object.values(imageInfo.subAssets) : [];
    const spriteFrame = subAssets.find((asset) => asset && (asset.type === "cc.SpriteFrame" || asset.importer === "sprite-frame"));

    if (spriteFrame && spriteFrame.uuid) {
        return spriteFrame.uuid;
    }

    if (imageInfo && imageInfo.uuid) {
        return `${imageInfo.uuid}@f9941`;
    }

    throw new Error(`Cannot query SpriteFrame for ${imageUrl}`);
}

function buildPrefab(prefabName, documentSize, layers) {
    const renderLayers = [...layers].reverse();
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

    const rootNode = createNode(prefabName, null);
    data.push(rootNode);
    const rootUiId = data.length;
    rootNode._components.push({ "__id__": rootUiId });
    data.push(createUiTransform(1, documentSize.width, documentSize.height, rootUiId + 1));
    data.push(createCompPrefabInfo());
    rootNode._prefab = { "__id__": data.length };
    data.push(createPrefabInfo(1));

    for (const layer of renderLayers) {
        const nodeId = data.length;
        const uiId = nodeId + 1;
        const spriteId = nodeId + 3;
        const prefabInfoId = nodeId + 5;
        const node = createNode(layer.name, 1);
        node._components.push({ "__id__": uiId }, { "__id__": spriteId });
        node._prefab = { "__id__": prefabInfoId };
        node._lpos.x = layer.left + layer.width / 2 - documentSize.width / 2;
        node._lpos.y = documentSize.height / 2 - layer.top - layer.height / 2;
        rootNode._children.push({ "__id__": nodeId });

        data.push(node);
        data.push(createUiTransform(nodeId, layer.width, layer.height, uiId + 1));
        data.push(createCompPrefabInfo());
        data.push(createSprite(nodeId, layer.spriteFrameUuid, spriteId + 1));
        data.push(createCompPrefabInfo());
        data.push(createPrefabInfo(1));
    }

    return data;
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
    let next = base;
    let index = 2;
    while (used.has(next)) {
        next = `${base}_${index}`;
        index += 1;
    }
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
