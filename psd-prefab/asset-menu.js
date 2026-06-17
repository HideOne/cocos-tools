"use strict";

const PACKAGE_NAME = "psd-prefab";
require("./editor-compat").install(PACKAGE_NAME);

function assetMenu(assetLike) {
    const assets = normalizeAssets(assetLike);
    const psdAssets = assets.filter(isPsdAsset);

    if (psdAssets.length === 0) {
        return [];
    }

    return [
        {
            label: getMenuLabel(),
            enabled: psdAssets.length === 1,
            click() {
                Editor.Message.send(PACKAGE_NAME, "convert-psd-asset", pickAssetId(psdAssets[0]));
            },
        },
    ];
}

exports.assetMenu = assetMenu;
exports.createAssetMenu = assetMenu;
exports.menu = assetMenu;
exports.default = assetMenu;

function normalizeAssets(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.flatMap(normalizeAssets);
    }

    if (Array.isArray(value.assetList)) {
        return normalizeAssets(value.assetList);
    }

    if (Array.isArray(value.assets)) {
        return normalizeAssets(value.assets);
    }

    if (value.asset) {
        return normalizeAssets(value.asset);
    }

    if (value.assetInfo) {
        return normalizeAssets(value.assetInfo);
    }

    return [value];
}

function isPsdAsset(asset) {
    const file = String(asset.file || asset.path || asset.url || asset.source || asset.name || "");
    return /\.psd$/i.test(file);
}

function pickAssetId(asset) {
    return asset.uuid || asset.url || asset.source || asset.file || "";
}

function getMenuLabel() {
    if (Editor.I18n && typeof Editor.I18n.t === "function") {
        return Editor.I18n.t("psd-prefab.convert_to_prefab");
    }

    return "Convert to Prefab";
}
