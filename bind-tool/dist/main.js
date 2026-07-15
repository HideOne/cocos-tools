"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
const PACKAGE_NAME = 'bind-tool';
const AUTO_BIND_START = '/***************stsrt*************/';
const AUTO_BIND_END = '/************************end***************/';
const LEGACY_AUTO_BIND_START = '// AUTO_BIND_START';
const LEGACY_AUTO_BIND_END = '// AUTO_BIND_END';
const AUTO_BUTTON_EVENT_START = '// AUTO_BUTTON_EVENT_START';
const AUTO_BUTTON_EVENT_END = '// AUTO_BUTTON_EVENT_END';
const AUTO_BUTTON_HANDLER_START = '// AUTO_BUTTON_HANDLER_START';
const AUTO_BUTTON_HANDLER_END = '// AUTO_BUTTON_HANDLER_END';
const defaultConfig = {
    scriptRoot: '.',
    scriptNamePrefix: '',
    autoAddButtonComponent: true,
    overwriteMode: 'marker',
    stopPrefix: 'stop',
    rules: [
        {
            prefix: 'node',
            componentName: 'Node',
            propertyType: 'Node',
            decoratorType: 'Node',
            bindTarget: 'node',
            componentType: '',
            stopChildren: false,
            generateClickEvent: false,
            enabled: true,
        },
        {
            prefix: 'node_stop',
            componentName: 'Node',
            propertyType: 'Node',
            decoratorType: 'Node',
            bindTarget: 'node',
            componentType: '',
            stopChildren: true,
            generateClickEvent: false,
            enabled: true,
        },
        {
            prefix: 'spine',
            componentName: 'sp.Skeleton',
            propertyType: 'sp.Skeleton',
            decoratorType: 'sp.Skeleton',
            bindTarget: 'component',
            componentType: 'sp.Skeleton',
            stopChildren: false,
            generateClickEvent: false,
            enabled: true,
        },
        {
            prefix: 'button',
            componentName: 'Button',
            propertyType: 'Button',
            decoratorType: 'Button',
            bindTarget: 'component',
            componentType: 'cc.Button',
            stopChildren: false,
            generateClickEvent: true,
            enabled: true,
        },
        {
            prefix: 'label',
            componentName: 'Label',
            propertyType: 'Label',
            decoratorType: 'Label',
            bindTarget: 'component',
            componentType: 'cc.Label',
            stopChildren: false,
            generateClickEvent: false,
            enabled: true,
        },
    ],
};
exports.methods = {
    async openRulesPanel() {
        await Editor.Panel.open(`${PACKAGE_NAME}.rules`);
    },
    async queryConfig() {
        return readConfig();
    },
    async saveConfig(config) {
        const nextConfig = Object.assign(Object.assign(Object.assign({}, defaultConfig), config), { rules: normalizeRules(config.rules) });
        await Editor.Profile.setProject(PACKAGE_NAME, 'scriptRoot', nextConfig.scriptRoot);
        await Editor.Profile.setProject(PACKAGE_NAME, 'scriptNamePrefix', nextConfig.scriptNamePrefix);
        await Editor.Profile.setProject(PACKAGE_NAME, 'autoAddButtonComponent', nextConfig.autoAddButtonComponent);
        await Editor.Profile.setProject(PACKAGE_NAME, 'overwriteMode', nextConfig.overwriteMode);
        await Editor.Profile.setProject(PACKAGE_NAME, 'stopPrefix', nextConfig.stopPrefix);
        await Editor.Profile.setProject(PACKAGE_NAME, 'rules', nextConfig.rules);
        return nextConfig;
    },
    async resetConfig() {
        await Editor.Profile.setProject(PACKAGE_NAME, 'scriptRoot', defaultConfig.scriptRoot);
        await Editor.Profile.setProject(PACKAGE_NAME, 'scriptNamePrefix', defaultConfig.scriptNamePrefix);
        await Editor.Profile.setProject(PACKAGE_NAME, 'autoAddButtonComponent', defaultConfig.autoAddButtonComponent);
        await Editor.Profile.setProject(PACKAGE_NAME, 'overwriteMode', defaultConfig.overwriteMode);
        await Editor.Profile.setProject(PACKAGE_NAME, 'stopPrefix', defaultConfig.stopPrefix);
        await Editor.Profile.setProject(PACKAGE_NAME, 'rules', defaultConfig.rules);
        return defaultConfig;
    },
    async bindSelectedNode() {
        await runBindSelectedNode('generate-and-bind');
    },
    async generateSelectedNodeScript() {
        await runBindSelectedNode('generate');
    },
    async bindSelectedNodeReferences() {
        await runBindSelectedNode('bind');
    },
    async bindUiOnSelectedNode() {
        await runBindUiOnSelectedNode();
    },
};
const BIND_MARKER_HINT = `在需要绑定节点的脚本添加 ${AUTO_BIND_START} ${AUTO_BIND_END}`;
async function runBindSelectedNode(mode) {
    const modeTitle = getModeTitle(mode);
    try {
        const result = await bindSelectedNode(mode);
        const detail = [
            `Opened: ${result.openedAssetUrl}`,
            `Script base: ${result.scriptBaseDir}`,
            `Script: ${result.scriptUrl}`,
            `Properties: ${result.bindings.length}`,
            `Button events: ${result.buttons.length}`,
            mode === 'generate' ? 'Component: skipped' : (result.componentAttached ? 'Component: attach attempted successfully' : 'Component: not attached'),
            mode === 'generate' ? 'Bound references: skipped' : `Bound references: ${result.propertiesBound}`,
        ].join('\n');
        Editor.Task.addNotice({
            title: `${modeTitle} complete`,
            message: detail,
            type: 'success',
            source: PACKAGE_NAME,
            timeout: 6000,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${PACKAGE_NAME}] ${message}`, error);
        Editor.Task.addNotice({
            title: `${modeTitle} failed`,
            message,
            type: 'error',
            source: PACKAGE_NAME,
            timeout: 8000,
        });
    }
}
function getModeTitle(mode) {
    if (mode === 'generate') {
        return 'Generate script';
    }
    if (mode === 'bind') {
        return 'Bind references';
    }
    return 'Generate and bind';
}
async function runBindUiOnSelectedNode() {
    try {
        const result = await bindUiOnSelectedNode();
        Editor.Task.addNotice({
            title: '绑定UI complete',
            message: [
                `Script: ${result.scriptUrl}`,
                `Properties: ${result.bindings.length}`,
                `Button events: ${result.buttons.length}`,
                `Bound references: ${result.propertiesBound}`,
            ].join('\n'),
            type: 'success',
            source: PACKAGE_NAME,
            timeout: 6000,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${PACKAGE_NAME}] ${message}`, error);
        Editor.Task.addNotice({
            title: '绑定UI failed',
            message,
            type: 'error',
            source: PACKAGE_NAME,
            timeout: 8000,
        });
    }
}
function load() { }
function unload() { }
async function bindUiOnSelectedNode() {
    const selectedUuid = Editor.Selection.getLastSelected('node') || Editor.Selection.getSelected('node')[0];
    if (!selectedUuid) {
        throw new Error('Please select a node first.');
    }
    console.log(`[${PACKAGE_NAME}] Bind UI selectedUuid: ${selectedUuid}`);
    const selectedTree = await querySelectedNodeTree(selectedUuid);
    if (!selectedTree) {
        throw new Error('Cannot read the selected node. Make sure a scene or prefab is open.');
    }
    console.log(`[${PACKAGE_NAME}] Selected tree root: ${getNodeName(selectedTree)}, children: ${getChildren(selectedTree).map(getNodeName).join(', ')}`);
    const scripts = await listScriptsOnNode(selectedUuid);
    console.log(`[${PACKAGE_NAME}] Scripts on node (${scripts.length}): ${scripts.map((item) => `${item.className}@${item.scriptUrl}`).join(' | ') || '(none)'}`);
    if (scripts.length === 0) {
        const tip = `选中节点上没有脚本组件。${BIND_MARKER_HINT}`;
        console.warn(`[${PACKAGE_NAME}] ${tip}`);
        throw new Error(tip);
    }
    const targetScript = pickBindUiTargetScript(scripts, getNodeName(selectedTree));
    if (!targetScript) {
        console.warn(`[${PACKAGE_NAME}] ${BIND_MARKER_HINT}`);
        for (const script of scripts) {
            console.warn(`[${PACKAGE_NAME}] Checked script without bind markers: ${script.scriptUrl}`);
        }
        throw new Error(BIND_MARKER_HINT);
    }
    const config = await readConfig();
    const className = targetScript.className
        || extractClassNameFromSource(targetScript.source)
        || applyScriptNamePrefix(toClassName(getNodeName(selectedTree)), config.scriptNamePrefix);
    const openedAssetUrl = await queryOpenedAssetUrl(selectedTree);
    if (!openedAssetUrl) {
        throw new Error('Cannot locate the opened prefab or scene asset. Please save the prefab/scene and run bind again.');
    }
    const scriptUrl = targetScript.scriptUrl;
    const scriptBaseDir = getScriptBaseDir(openedAssetUrl);
    console.log(`[${PACKAGE_NAME}] Bind UI target script: ${scriptUrl}`);
    console.log(`[${PACKAGE_NAME}] Bind UI className: ${className}, componentUuid: ${targetScript.componentUuid}, cid: ${targetScript.cid}`);
    console.log(`[${PACKAGE_NAME}] Opened asset: ${openedAssetUrl}`);
    console.log(`[${PACKAGE_NAME}] Enabled rules: ${getSortedEnabledRules(config).map((rule) => rule.prefix).join(', ')}`);
    const scan = scanBindings(selectedTree, config);
    console.log(`[${PACKAGE_NAME}] Scan bindings (${scan.length}): ${scan.map((item) => `${item.propertyName}:${item.propertyType}@${item.nodeName}`).join(' | ') || '(none)'}`);
    const buttons = scan.filter((item) => item.generateClickEvent);
    const generated = renderScript(className, scan, buttons);
    const finalSource = updateUiMarkedSource(targetScript.source, generated);
    const sourceChanged = finalSource !== targetScript.source;
    if (sourceChanged) {
        await writeAsset(scriptUrl, finalSource, false);
        await Editor.Message.request('asset-db', 'refresh-asset', scriptUrl);
        // Script reimport remounts the component; previous component UUID becomes invalid.
        targetScript.componentUuid = '';
        await delay(300);
        console.log(`[${PACKAGE_NAME}] Script updated and refreshed: ${scriptUrl}`);
    }
    else {
        console.log(`[${PACKAGE_NAME}] Script content unchanged, skip refresh: ${scriptUrl}`);
    }
    await ensureButtonComponents(buttons, config);
    const liveComponentUuid = await waitForBindableComponent(selectedUuid, className, scriptUrl, scan.map((item) => item.propertyName), targetScript);
    targetScript.componentUuid = liveComponentUuid || '';
    console.log(`[${PACKAGE_NAME}] Live componentUuid for binding: ${targetScript.componentUuid || '(missing)'}`);
    const propertiesBound = await applyBindings(selectedUuid, className, scriptUrl, openedAssetUrl, selectedTree, scan, targetScript);
    const componentAttached = Boolean(targetScript.componentUuid);
    return {
        className,
        scriptUrl,
        openedAssetUrl,
        scriptBaseDir,
        bindings: scan,
        buttons,
        created: false,
        componentAttached,
        propertiesBound,
    };
}
function pickBindUiTargetScript(scripts, nodeName) {
    const withMarkers = scripts.filter((script) => hasBindMarkers(script.source));
    if (withMarkers.length === 0) {
        return undefined;
    }
    const lowerNodeName = nodeName.toLowerCase();
    const byClassName = withMarkers.find((script) => script.className.toLowerCase() === lowerNodeName);
    if (byClassName) {
        return byClassName;
    }
    const byFileName = withMarkers.find((script) => {
        const fileName = (0, path_1.basename)(script.scriptUrl).replace(/\.tsx?$/i, '').toLowerCase();
        return fileName === lowerNodeName || lowerNodeName.startsWith(fileName);
    });
    if (byFileName) {
        return byFileName;
    }
    return withMarkers[0];
}
async function querySelectedNodeTree(selectedUuid) {
    const direct = await Editor.Message.request('scene', 'query-node-tree', selectedUuid);
    if (direct && (getChildren(direct).length > 0 || getUuid(direct) === selectedUuid)) {
        if (getChildren(direct).length === 0) {
            try {
                const root = await Editor.Message.request('scene', 'query-node-tree');
                const found = findNodeInTree(root, selectedUuid);
                if (found && getChildren(found).length > 0) {
                    console.log(`[${PACKAGE_NAME}] Selected tree recovered from full scene tree.`);
                    return found;
                }
            }
            catch (error) {
                console.warn(`[${PACKAGE_NAME}] Failed to recover selected tree from full scene tree.`, error);
            }
        }
        return direct;
    }
    try {
        const root = await Editor.Message.request('scene', 'query-node-tree');
        return findNodeInTree(root, selectedUuid) || direct;
    }
    catch (_a) {
        return direct;
    }
}
function findNodeInTree(node, uuid) {
    if (!node) {
        return null;
    }
    if (getUuid(node) === uuid) {
        return node;
    }
    for (const child of getChildren(node)) {
        const found = findNodeInTree(child, uuid);
        if (found) {
            return found;
        }
    }
    return null;
}
async function listScriptsOnNode(nodeUuid) {
    var _a;
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node === null || node === void 0 ? void 0 : node.__comps__) ? node.__comps__ : [];
    console.log(`[${PACKAGE_NAME}] query-node comps count: ${components.length}`);
    if (components.length === 0) {
        return [];
    }
    let registered = [];
    try {
        const list = await Editor.Message.request('scene', 'query-components');
        registered = Array.isArray(list) ? list : [];
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to query registered components.`, error);
    }
    const results = [];
    const seenUrls = new Set();
    for (const component of components) {
        const componentAny = component;
        const type = String(readDumpValue(componentAny === null || componentAny === void 0 ? void 0 : componentAny.type) || '');
        const cid = String(readDumpValue(componentAny === null || componentAny === void 0 ? void 0 : componentAny.cid) || type || '');
        const componentUuid = String(readDumpValue((_a = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _a === void 0 ? void 0 : _a.uuid)
            || readDumpValue(componentAny === null || componentAny === void 0 ? void 0 : componentAny.uuid)
            || '');
        const typeCandidates = [type, cid]
            .map(readDumpValue)
            .filter(Boolean)
            .map(String);
        console.log(`[${PACKAGE_NAME}] Comp dump type=${type}, cid=${cid}, uuid=${componentUuid}`);
        if (typeCandidates.length === 0 || typeCandidates.every((candidate) => isBuiltinComponentType(candidate))) {
            continue;
        }
        const matched = findRegisteredScriptComponent(registered, typeCandidates);
        console.log(`[${PACKAGE_NAME}] Registered match: ${matched ? `${matched.name}|${matched.cid}|${matched.path}|${matched.assetUuid}` : '(none)'}`);
        const assetKeys = [
            matched === null || matched === void 0 ? void 0 : matched.assetUuid,
            matched === null || matched === void 0 ? void 0 : matched.path,
            ...typeCandidates,
        ].filter(Boolean).map(String);
        let resolved = null;
        for (const key of assetKeys) {
            resolved = await resolveScriptAssetByKey(key, typeCandidates, componentUuid, cid || type);
            if (resolved) {
                break;
            }
        }
        if (!resolved) {
            console.warn(`[${PACKAGE_NAME}] Failed to resolve script asset for component type=${type}`);
            continue;
        }
        if (seenUrls.has(resolved.scriptUrl)) {
            continue;
        }
        seenUrls.add(resolved.scriptUrl);
        results.push(resolved);
    }
    return results;
}
function findRegisteredScriptComponent(registered, typeCandidates) {
    return registered.find((item) => {
        const regCandidates = [item === null || item === void 0 ? void 0 : item.name, item === null || item === void 0 ? void 0 : item.cid, item === null || item === void 0 ? void 0 : item.assetUuid]
            .filter(Boolean)
            .map(String);
        return typeCandidates.some((candidate) => regCandidates.some((reg) => isExactComponentIdentity(reg, candidate)));
    });
}
function isExactComponentIdentity(left, right) {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    if (!a || !b) {
        return false;
    }
    return a === b
        || shortTypeName(a).toLowerCase() === shortTypeName(b).toLowerCase();
}
async function resolveScriptAssetByKey(key, classNameCandidates, componentUuid, cid) {
    try {
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', key);
        if (!(asset === null || asset === void 0 ? void 0 : asset.file) || !/\.tsx?$/i.test(String(asset.file))) {
            return null;
        }
        const scriptUrl = String(asset.url || asset.source || '');
        if (!scriptUrl) {
            return null;
        }
        const source = (0, fs_1.readFileSync)(String(asset.file), 'utf8');
        const className = extractClassNameFromSource(source)
            || classNameCandidates.find((name) => !isBuiltinComponentType(name) && !looksLikeUuid(name) && !looksLikeCid(name))
            || (0, path_1.basename)(String(asset.file), (0, path_1.extname)(String(asset.file)));
        return {
            className,
            scriptUrl,
            source,
            componentUuid,
            cid,
        };
    }
    catch (_a) {
        return null;
    }
}
function isBuiltinComponentType(typeName) {
    const value = String(typeName || '').trim();
    if (!value) {
        return true;
    }
    if (value.startsWith('cc.') || value.startsWith('sp.')) {
        return true;
    }
    const builtins = [
        'Node',
        'UITransform',
        'Sprite',
        'Label',
        'Button',
        'Widget',
        'Canvas',
        'Camera',
        'RichText',
        'EditBox',
        'ScrollView',
        'Layout',
        'Mask',
        'Graphics',
        'ProgressBar',
        'Toggle',
        'Slider',
        'BlockInputEvents',
    ];
    const short = shortTypeName(value);
    return builtins.some((name) => name.toLowerCase() === short.toLowerCase() || name.toLowerCase() === value.toLowerCase());
}
function looksLikeCid(value) {
    return /[+/]/.test(value) || (value.length >= 20 && /[A-Za-z]/.test(value) && /\d/.test(value));
}
function looksLikeUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        || /^[0-9a-f]{20,}$/i.test(value);
}
function extractClassNameFromSource(source) {
    const ccclassMatch = source.match(/@ccclass\(\s*['"]([^'"]+)['"]\s*\)/);
    if (ccclassMatch === null || ccclassMatch === void 0 ? void 0 : ccclassMatch[1]) {
        return ccclassMatch[1];
    }
    const classMatch = source.match(/export\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+/);
    return (classMatch === null || classMatch === void 0 ? void 0 : classMatch[1]) || null;
}
function hasBindMarkers(source) {
    return hasBlock(source, AUTO_BIND_START, AUTO_BIND_END)
        || hasBlock(source, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END);
}
function updateUiMarkedSource(existing, generated) {
    if (!hasBindMarkers(existing)) {
        return existing;
    }
    const bindBlock = pickBlock(generated, AUTO_BIND_START, AUTO_BIND_END);
    const bindMarkers = getExistingBlockMarkers(existing, AUTO_BIND_START, AUTO_BIND_END)
        || getExistingBlockMarkers(existing, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END)
        || [AUTO_BIND_START, AUTO_BIND_END];
    let updated = replaceBlock(existing, bindMarkers[0], bindMarkers[1], bindBlock);
    updated = updated.replace(bindMarkers[0], AUTO_BIND_START).replace(bindMarkers[1], AUTO_BIND_END);
    if (hasBlock(updated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END)) {
        updated = replaceBlock(updated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END, pickBlock(generated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END));
    }
    if (hasBlock(updated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END)) {
        updated = replaceBlock(updated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END, mergeButtonHandlerBlock(pickBlock(updated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END), pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END)));
    }
    return mergeCcImports(updated, generated);
}
async function bindSelectedNode(mode) {
    const selectedUuid = Editor.Selection.getLastSelected('node') || Editor.Selection.getSelected('node')[0];
    if (!selectedUuid) {
        throw new Error('Please select a node first.');
    }
    const selectedTree = await Editor.Message.request('scene', 'query-node-tree', selectedUuid);
    if (!selectedTree) {
        throw new Error('Cannot read the selected node. Make sure a scene or prefab is open.');
    }
    const nodeName = getNodeName(selectedTree);
    const config = await readConfig();
    const className = applyScriptNamePrefix(toClassName(nodeName), config.scriptNamePrefix);
    const openedAssetUrl = await queryOpenedAssetUrl(selectedTree);
    if (!openedAssetUrl) {
        throw new Error('Cannot locate the opened prefab or scene asset. Please save the prefab/scene and run bind again.');
    }
    const scriptBaseDir = getScriptBaseDir(openedAssetUrl);
    const scriptUrl = makeScriptUrl(openedAssetUrl, className, config.scriptRoot);
    console.log(`[${PACKAGE_NAME}] Opened asset: ${openedAssetUrl}`);
    console.log(`[${PACKAGE_NAME}] Script base: ${scriptBaseDir}, scriptRoot: ${config.scriptRoot}, script: ${scriptUrl}`);
    const scan = scanBindings(selectedTree, config);
    const buttons = scan.filter((item) => item.generateClickEvent);
    let created = false;
    let componentAttached = false;
    let propertiesBound = 0;
    if (mode !== 'bind') {
        const source = renderScript(className, scan, buttons);
        const existing = await readAssetText(scriptUrl);
        const canUpdateExisting = existing ? hasAllAutoBlocks(existing) : true;
        const finalSource = existing ? updateMarkedSource(existing, source) : source;
        if (existing && !canUpdateExisting) {
            throw new Error(`Script exists but auto-generated markers are missing. Stop to avoid overwriting user code: ${scriptUrl}`);
        }
        created = !existing;
        await writeAsset(scriptUrl, finalSource, created);
        await Editor.Message.request('asset-db', 'refresh-asset', scriptUrl);
    }
    else if (!await readAssetText(scriptUrl)) {
        throw new Error(`Script does not exist. Generate it first: ${scriptUrl}`);
    }
    if (mode !== 'generate') {
        await ensureButtonComponents(buttons, config);
        componentAttached = await tryAttachComponent(selectedUuid, className, scriptUrl);
        propertiesBound = await applyBindings(selectedUuid, className, scriptUrl, openedAssetUrl, selectedTree, scan, null);
    }
    return {
        className,
        scriptUrl,
        openedAssetUrl,
        scriptBaseDir,
        bindings: scan,
        buttons,
        created,
        componentAttached,
        propertiesBound,
    };
}
async function readConfig() {
    var _a;
    try {
        const projectConfig = await Editor.Profile.getProject(PACKAGE_NAME);
        return Object.assign(Object.assign(Object.assign({}, defaultConfig), (projectConfig || {})), { scriptNamePrefix: String((_a = projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.scriptNamePrefix) !== null && _a !== void 0 ? _a : defaultConfig.scriptNamePrefix), rules: normalizeRules(projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.rules) });
    }
    catch (_b) {
        return defaultConfig;
    }
}
function normalizeRules(rules) {
    if (!Array.isArray(rules)) {
        return defaultConfig.rules;
    }
    const normalized = rules
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule) => normalizeRule(rule))
        .filter((rule) => Boolean(rule));
    return normalized.length > 0 ? normalized : defaultConfig.rules;
}
function normalizeRule(rule) {
    const prefix = String(rule.prefix || '').trim();
    if (!prefix) {
        return null;
    }
    const componentName = String(rule.componentName || rule.propertyType || 'Node').trim();
    const propertyType = normalizeComponentName(componentName);
    const bindTarget = propertyType === 'Node' ? 'node' : 'component';
    return {
        prefix,
        componentName: propertyType,
        propertyType,
        decoratorType: propertyType,
        bindTarget,
        componentType: bindTarget === 'component' ? toComponentType(propertyType) : '',
        stopChildren: Boolean(rule.stopChildren) || prefix === 'node_stop',
        generateClickEvent: isButtonType(propertyType),
        enabled: rule.enabled !== false,
    };
}
function normalizeComponentName(componentName) {
    const value = componentName.trim();
    if (value.startsWith('cc.')) {
        return shortTypeName(value);
    }
    return value || 'Node';
}
function toComponentType(propertyType) {
    if (isBuiltinCcComponent(propertyType)) {
        return `cc.${propertyType}`;
    }
    return propertyType;
}
function isBuiltinCcComponent(propertyType) {
    return [
        'Button',
        'EditBox',
        'Label',
        'Layout',
        'Mask',
        'PageView',
        'ProgressBar',
        'RichText',
        'ScrollView',
        'Slider',
        'Sprite',
        'Toggle',
        'Widget',
    ].includes(propertyType);
}
function isButtonType(propertyType) {
    return propertyType === 'Button' || propertyType === 'cc.Button';
}
async function queryOpenedAssetUrl(selectedTree) {
    const fromSave = await queryUrlFromSaveScene();
    if (fromSave) {
        return fromSave;
    }
    const fromPrefabDump = await queryUrlFromPrefabDump(selectedTree);
    if (fromPrefabDump) {
        return fromPrefabDump;
    }
    const fromSelectedAsset = await queryUrlFromSelectedAsset();
    if (fromSelectedAsset) {
        return fromSelectedAsset;
    }
    return findAssetUrlByNodeTreeWithRetry(selectedTree);
}
async function queryUrlFromSaveScene() {
    try {
        const savedId = await Editor.Message.request('scene', 'save-scene');
        if (!savedId) {
            return null;
        }
        return resolveAssetUrl(String(savedId));
    }
    catch (_a) {
        return null;
    }
}
async function queryUrlFromPrefabDump(selectedTree) {
    try {
        const rootTree = await Editor.Message.request('scene', 'query-node-tree');
        const candidates = [rootTree, selectedTree];
        for (const tree of candidates) {
            const assetUuid = extractPrefabAssetUuid(tree);
            if (!assetUuid) {
                continue;
            }
            const url = await resolveAssetUrl(assetUuid);
            if (url) {
                return url;
            }
        }
    }
    catch (_a) {
        // ignore and fall through
    }
    return null;
}
async function queryUrlFromSelectedAsset() {
    try {
        const selectedAsset = Editor.Selection.getLastSelected('asset') || Editor.Selection.getSelected('asset')[0];
        if (!selectedAsset) {
            return null;
        }
        const url = await resolveAssetUrl(String(selectedAsset));
        if (url && /\.(prefab|scene)$/i.test(url)) {
            return url;
        }
    }
    catch (_a) {
        // ignore and fall through
    }
    return null;
}
async function resolveAssetUrl(idOrUrl) {
    try {
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', idOrUrl);
        if (asset === null || asset === void 0 ? void 0 : asset.url) {
            return String(asset.url);
        }
        if (asset === null || asset === void 0 ? void 0 : asset.source) {
            return String(asset.source);
        }
    }
    catch (_a) {
        // continue
    }
    try {
        const url = await Editor.Message.request('asset-db', 'query-url', idOrUrl);
        return url ? String(url) : null;
    }
    catch (_b) {
        return null;
    }
}
function extractPrefabAssetUuid(tree) {
    if (!tree || typeof tree !== 'object') {
        return null;
    }
    const dumps = [
        tree.__prefab__,
        tree._prefab,
        tree._prefabInstance,
        readDumpValue(tree.__prefab__),
        readDumpValue(tree._prefab),
    ];
    for (const dump of dumps) {
        if (!dump || typeof dump !== 'object') {
            continue;
        }
        const uuid = dump.assetUuid
            || dump.uuid
            || dump.asset
            || readDumpValue(dump.assetUuid)
            || readDumpValue(dump.uuid)
            || readDumpValue(dump.asset);
        if (typeof uuid === 'string' && uuid) {
            return uuid;
        }
        if (uuid && typeof uuid === 'object') {
            const nested = readDumpValue(uuid.uuid) || uuid.uuid || uuid.__uuid__;
            if (typeof nested === 'string' && nested) {
                return nested;
            }
        }
    }
    return null;
}
async function findAssetUrlByNodeTreeWithRetry(selectedTree) {
    for (let index = 0; index < 5; index += 1) {
        const url = findAssetUrlByNodeTree(selectedTree);
        if (url) {
            return url;
        }
        await delay(120);
    }
    return null;
}
function findAssetUrlByNodeTree(selectedTree) {
    const assetsDir = (0, path_1.join)(Editor.Project.path, 'assets');
    if (!(0, fs_1.existsSync)(assetsDir)) {
        return null;
    }
    const rootName = getNodeName(selectedTree);
    const treeNodeNames = collectNodeNames(selectedTree);
    const candidates = listAssetFiles(assetsDir, ['.prefab', '.scene']);
    let bestUrl = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const file of candidates) {
        try {
            const data = readJsonFileSync(file);
            if (!Array.isArray(data)) {
                continue;
            }
            const score = scoreAssetMatch(file, data, rootName, treeNodeNames);
            if (score <= bestScore) {
                continue;
            }
            bestScore = score;
            bestUrl = `db://${(0, path_1.relative)(Editor.Project.path, file).replace(/\\/g, '/')}`;
        }
        catch (error) {
            if (!isIncompleteJsonError(error)) {
                console.warn(`[${PACKAGE_NAME}] Failed to inspect asset ${file}.`, error);
            }
        }
    }
    return bestScore > 0 ? bestUrl : null;
}
function collectNodeNames(node, result = []) {
    result.push(getNodeName(node));
    for (const child of getChildren(node)) {
        collectNodeNames(child, result);
    }
    return result;
}
function scoreAssetMatch(file, data, rootName, treeNodeNames) {
    const nodes = data.filter((item) => (item === null || item === void 0 ? void 0 : item.__type__) === 'cc.Node');
    const hasRoot = nodes.some((node) => (node === null || node === void 0 ? void 0 : node._name) === rootName);
    if (!hasRoot) {
        return Number.NEGATIVE_INFINITY;
    }
    const assetNames = nodes.map((node) => String((node === null || node === void 0 ? void 0 : node._name) || '')).filter(Boolean);
    const assetNameSet = new Set(assetNames);
    const matchedCount = treeNodeNames.filter((name) => assetNameSet.has(name)).length;
    if (matchedCount <= 0 && (0, path_1.basename)(file, (0, path_1.extname)(file)) !== rootName) {
        return Number.NEGATIVE_INFINITY;
    }
    let score = matchedCount * 10;
    score -= Math.abs(assetNames.length - treeNodeNames.length) * 3;
    if ((0, path_1.basename)(file, (0, path_1.extname)(file)) === rootName) {
        score += 5;
    }
    // Prefer unique structural matches when duplicate prefabs exist under different folders.
    score += Math.min(matchedCount, assetNames.length);
    return score;
}
function readJsonFileSync(file) {
    try {
        return JSON.parse((0, fs_1.readFileSync)(file, 'utf8'));
    }
    catch (error) {
        if (isIncompleteJsonError(error)) {
            return null;
        }
        throw error;
    }
}
async function readJsonFileWithRetry(file, attempts = 5) {
    for (let index = 0; index < attempts; index += 1) {
        try {
            return JSON.parse((0, fs_1.readFileSync)(file, 'utf8'));
        }
        catch (error) {
            if (!isIncompleteJsonError(error) || index === attempts - 1) {
                throw error;
            }
            await delay(120);
        }
    }
    return null;
}
function isIncompleteJsonError(error) {
    return error instanceof SyntaxError && /Unexpected end of JSON input/.test(error.message);
}
function listAssetFiles(dir, extensions) {
    const result = [];
    for (const entry of (0, fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const fullPath = (0, path_1.join)(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...listAssetFiles(fullPath, extensions));
        }
        else if (extensions.includes((0, path_1.extname)(entry.name).toLowerCase())) {
            result.push(fullPath);
        }
    }
    return result;
}
function makeScriptUrl(openedAssetUrl, className, scriptRoot) {
    const relativeRoot = normalizeRelativeScriptRoot(scriptRoot);
    const baseDir = getScriptBaseDir(openedAssetUrl);
    const resolvedDir = resolveRelativeAssetPath(baseDir, relativeRoot);
    return `db://${resolvedDir}/${className}.ts`;
}
function getScriptBaseDir(openedAssetUrl) {
    if (openedAssetUrl) {
        const bundleRoot = findBundleRoot(openedAssetUrl);
        if (bundleRoot) {
            return bundleRoot;
        }
    }
    // Prefab/scene is not inside an Asset Bundle: resolve relative to project assets root.
    return 'assets';
}
function findBundleRoot(openedAssetUrl) {
    let current = getOpenedAssetDirectory(openedAssetUrl);
    while (current) {
        if (isBundleDirectory(current)) {
            return current;
        }
        if (current === 'assets' || !current.includes('/')) {
            break;
        }
        current = current.slice(0, current.lastIndexOf('/'));
    }
    return null;
}
function isBundleDirectory(assetRelativeDir) {
    var _a;
    const metaPath = (0, path_1.join)(Editor.Project.path, `${assetRelativeDir}.meta`);
    if (!(0, fs_1.existsSync)(metaPath)) {
        return false;
    }
    try {
        const meta = JSON.parse((0, fs_1.readFileSync)(metaPath, 'utf8'));
        return ((_a = meta === null || meta === void 0 ? void 0 : meta.userData) === null || _a === void 0 ? void 0 : _a.isBundle) === true;
    }
    catch (_b) {
        return false;
    }
}
function getOpenedAssetDirectory(openedAssetUrl) {
    const assetPath = openedAssetUrl
        .replace(/^db:\/\//, '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    const lastSlash = assetPath.lastIndexOf('/');
    if (lastSlash < 0) {
        return 'assets';
    }
    return assetPath.slice(0, lastSlash) || 'assets';
}
function normalizeRelativeScriptRoot(scriptRoot) {
    const value = String(scriptRoot || defaultConfig.scriptRoot).trim().replace(/\\/g, '/') || '.';
    return value.replace(/\/+$/, '') || '.';
}
function resolveRelativeAssetPath(baseDir, relativePath) {
    const baseParts = baseDir.replace(/\\/g, '/').split('/').filter(Boolean);
    const relativeParts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    const parts = [...baseParts];
    for (const part of relativeParts) {
        if (part === '.') {
            continue;
        }
        if (part === '..') {
            if (parts.length > 0) {
                parts.pop();
            }
            continue;
        }
        parts.push(part);
    }
    const resolved = parts.join('/') || 'assets';
    return resolved.startsWith('assets') ? resolved : `assets/${resolved}`;
}
function scanBindings(root, config) {
    const usedNames = new Map();
    const bindings = [];
    const rules = getSortedEnabledRules(config);
    const visit = (node) => {
        const nodeName = getNodeName(node);
        const lowerName = nodeName.toLowerCase();
        if (lowerName.startsWith(config.stopPrefix.toLowerCase())) {
            return;
        }
        const binding = createBinding(node, rules, usedNames);
        if (binding) {
            bindings.push(binding);
        }
        if (binding === null || binding === void 0 ? void 0 : binding.stopChildren) {
            return;
        }
        for (const child of getChildren(node)) {
            visit(child);
        }
    };
    visit(root);
    return bindings;
}
function getSortedEnabledRules(config) {
    return config.rules
        .filter((rule) => rule.enabled && rule.prefix)
        .sort((left, right) => right.prefix.length - left.prefix.length);
}
function createBinding(node, rules, usedNames) {
    const nodeName = getNodeName(node);
    const lowerName = nodeName.toLowerCase();
    const rule = rules.find((item) => lowerName.startsWith(item.prefix.toLowerCase()));
    if (!rule) {
        return null;
    }
    return {
        nodeUuid: getUuid(node),
        nodeName,
        propertyName: makeUniqueName(toPropertyName(nodeName), usedNames),
        propertyType: rule.propertyType,
        decoratorType: rule.decoratorType,
        bindTarget: rule.bindTarget,
        componentType: rule.componentType,
        stopChildren: rule.stopChildren,
        generateClickEvent: rule.generateClickEvent,
    };
}
function getNodeName(node) {
    return String(readDumpValue(node === null || node === void 0 ? void 0 : node.name) || 'Node');
}
function getUuid(node) {
    return String(readDumpValue(node === null || node === void 0 ? void 0 : node.uuid) || (node === null || node === void 0 ? void 0 : node.uuid) || '');
}
function getChildren(node) {
    var _a;
    if (Array.isArray(node === null || node === void 0 ? void 0 : node.children)) {
        return node.children;
    }
    const dumpChildren = readDumpValue(node === null || node === void 0 ? void 0 : node.children);
    if (Array.isArray(dumpChildren)) {
        return dumpChildren;
    }
    if (Array.isArray((_a = node === null || node === void 0 ? void 0 : node.value) === null || _a === void 0 ? void 0 : _a.children)) {
        return node.value.children;
    }
    return [];
}
function readDumpValue(value) {
    if (value && typeof value === 'object' && 'value' in value) {
        return value.value;
    }
    return value;
}
function toClassName(value) {
    const name = toPropertyName(value);
    return upperFirst(name.replace(/^_+/, '') || 'AutoBindComponent');
}
function applyScriptNamePrefix(className, prefix) {
    const safePrefix = String(prefix || '')
        .trim()
        .replace(/[^\p{ID_Start}\p{ID_Continue}$_\u200C\u200D]+/gu, '');
    if (!safePrefix || !isIdentifierStart(safePrefix[0])) {
        return className;
    }
    if (className.toLowerCase().startsWith(safePrefix.toLowerCase())) {
        return className;
    }
    return `${safePrefix}${className}`;
}
function toPropertyName(value) {
    const normalized = value
        .trim()
        .replace(/[^\p{ID_Start}\p{ID_Continue}$_\u200C\u200D]+/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    const cleaned = normalized
        .split('')
        .filter((char, index) => index === 0 ? isIdentifierStart(char) : isIdentifierContinue(char))
        .join('');
    if (!cleaned) {
        return 'node';
    }
    return isIdentifierStart(cleaned[0]) ? cleaned : `_${cleaned}`;
}
function isIdentifierStart(char) {
    return /[$_\p{ID_Start}]/u.test(char);
}
function isIdentifierContinue(char) {
    return /[$_\u200C\u200D\p{ID_Continue}]/u.test(char);
}
function makeUniqueName(baseName, usedNames) {
    const count = usedNames.get(baseName) || 0;
    usedNames.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}${count + 1}`;
}
function upperFirst(value) {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
}
function renderScript(className, bindings, buttons) {
    return `import { ${renderCcImports(bindings)} } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('${className}')
export class ${className} extends Component {

    ${AUTO_BIND_START}
${renderProperties(bindings)}
    ${AUTO_BIND_END}

    protected onLoad(): void {
        this.bindButtonEvents();
    }

    private bindButtonEvents(): void {
        ${AUTO_BUTTON_EVENT_START}
${renderButtonEvents(buttons)}
        ${AUTO_BUTTON_EVENT_END}
    }

    ${AUTO_BUTTON_HANDLER_START}
${renderButtonHandlers(buttons)}
    ${AUTO_BUTTON_HANDLER_END}
}
`;
}
function renderCcImports(bindings) {
    const imports = new Set(['_decorator', 'Component']);
    for (const binding of bindings) {
        collectImportFromType(imports, binding.propertyType);
        collectImportFromType(imports, binding.decoratorType);
    }
    if (bindings.some((binding) => binding.generateClickEvent)) {
        imports.add('Button');
    }
    return sortCcImports(imports).join(', ');
}
function sortCcImports(imports) {
    return [...new Set(imports)]
        .filter((item) => item && item !== 'cc')
        .sort((left, right) => {
        const order = ['_decorator', 'Component', 'Node', 'Button', 'Label', 'Sprite', 'Widget', 'sp'];
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
        }
        return left.localeCompare(right);
    });
}
function collectImportFromType(imports, typeName) {
    const value = typeName.trim();
    const importName = value.startsWith('cc.') ? shortTypeName(value) : value.split('.')[0];
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(importName)) {
        imports.add(importName);
    }
}
function renderProperties(bindings) {
    return bindings.map((binding) => `    @property(${toScriptTypeName(binding.decoratorType)})
    public ${binding.propertyName}: ${toScriptTypeName(binding.propertyType)} | null = null;`).join('\n\n');
}
function toScriptTypeName(typeName) {
    const value = typeName.trim();
    return value.startsWith('cc.') ? shortTypeName(value) : value;
}
function renderButtonEvents(buttons) {
    return buttons.map((button) => `        if (this.${button.propertyName}) {
            this.${button.propertyName}.node.on(Button.EventType.CLICK, this.${getClickHandlerName(button.propertyName)}, this);
        }`).join('\n\n');
}
function renderButtonHandlers(buttons) {
    return buttons.map((button) => `    private ${getClickHandlerName(button.propertyName)}(): void {

    }`).join('\n\n');
}
function getClickHandlerName(propertyName) {
    return `onClick${upperFirst(propertyName.replace(/^button_?/, 'Button_'))}`;
}
function updateMarkedSource(existing, generated) {
    const bindBlock = pickBlock(generated, AUTO_BIND_START, AUTO_BIND_END);
    const eventBlock = pickBlock(generated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END);
    const handlerBlock = mergeButtonHandlerBlock(pickBlock(existing, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END), pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END));
    if (!hasAllAutoBlocks(existing)) {
        return existing;
    }
    const bindMarkers = getExistingBlockMarkers(existing, AUTO_BIND_START, AUTO_BIND_END)
        || getExistingBlockMarkers(existing, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END)
        || [AUTO_BIND_START, AUTO_BIND_END];
    let updated = replaceBlock(existing, bindMarkers[0], bindMarkers[1], bindBlock);
    updated = updated.replace(bindMarkers[0], AUTO_BIND_START).replace(bindMarkers[1], AUTO_BIND_END);
    const updatedBlocks = replaceBlock(replaceBlock(updated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END, eventBlock), AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END, handlerBlock);
    return mergeCcImports(updatedBlocks, generated);
}
function hasAllAutoBlocks(source) {
    return (hasBlock(source, AUTO_BIND_START, AUTO_BIND_END) || hasBlock(source, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END))
        && hasBlock(source, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END)
        && hasBlock(source, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END);
}
function getExistingBlockMarkers(source, start, end) {
    return hasBlock(source, start, end) ? [start, end] : null;
}
function hasBlock(source, start, end) {
    return source.includes(start) && source.includes(end) && source.indexOf(start) < source.indexOf(end);
}
function pickBlock(source, start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    return source.slice(startIndex + start.length, endIndex);
}
function replaceBlock(source, start, end, content) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    return `${source.slice(0, startIndex + start.length)}${content}${source.slice(endIndex)}`;
}
function mergeButtonHandlerBlock(existingBlock, generatedBlock) {
    const existingHandlers = new Map(parseButtonHandlers(existingBlock).map((handler) => [handler.name, handler.source]));
    const generatedHandlers = parseButtonHandlers(generatedBlock);
    if (generatedHandlers.length === 0) {
        return generatedBlock;
    }
    const mergedHandlers = generatedHandlers
        .map((handler) => normalizeButtonHandlerSource(existingHandlers.get(handler.name) || handler.source))
        .join('\n\n');
    return `\n${mergedHandlers}\n    `;
}
function normalizeButtonHandlerSource(source) {
    const lines = source.trim().split(/\r?\n/);
    return lines.map((line, index) => {
        if (index === 0) {
            return `    ${line.trimStart()}`;
        }
        return line.trimEnd();
    }).join('\n');
}
function parseButtonHandlers(block) {
    const result = [];
    const methodPattern = /(?:private|protected|public)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*:\s*void\s*\{/g;
    let match;
    while ((match = methodPattern.exec(block))) {
        const name = match[1];
        const methodStart = match.index;
        const bodyOpenIndex = methodPattern.lastIndex - 1;
        const methodEnd = findMatchingBrace(block, bodyOpenIndex);
        if (methodEnd === -1) {
            continue;
        }
        result.push({
            name,
            source: block.slice(methodStart, methodEnd + 1).trimEnd(),
        });
        methodPattern.lastIndex = methodEnd + 1;
    }
    return result;
}
function findMatchingBrace(source, openIndex) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            }
            else if (char === '\\') {
                escaped = true;
            }
            else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') {
            depth += 1;
        }
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}
function mergeCcImports(existing, generated) {
    const importPattern = /^import\s+\{\s*([^}]+?)\s*\}\s+from\s+['"]cc['"];\s*$/m;
    const existingMatch = existing.match(importPattern);
    const generatedMatch = generated.match(importPattern);
    if (!generatedMatch) {
        return existing;
    }
    if (!existingMatch) {
        return `${generatedMatch[0]}\n${existing}`;
    }
    const merged = sortCcImports([
        ...parseCcImportNames(existingMatch[1]),
        ...parseCcImportNames(generatedMatch[1]),
        ...detectUsedCcSymbols(existing),
    ]);
    return existing.replace(importPattern, `import { ${merged.join(', ')} } from 'cc';`);
}
function parseCcImportNames(imports) {
    return imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
function detectUsedCcSymbols(source) {
    const candidates = [
        'Node',
        'Button',
        'Label',
        'Sprite',
        'Widget',
        'UITransform',
        'ProgressBar',
        'ScrollView',
        'Toggle',
        'Slider',
        'EditBox',
        'RichText',
    ];
    return candidates.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
}
async function readAssetText(url) {
    const asset = await Editor.Message.request('asset-db', 'query-asset-info', url);
    if (!(asset === null || asset === void 0 ? void 0 : asset.file)) {
        return null;
    }
    return (0, fs_1.readFileSync)(asset.file, 'utf8');
}
async function writeAsset(url, source, created) {
    if (created) {
        await Editor.Message.request('asset-db', 'create-asset', url, source);
        return;
    }
    await Editor.Message.request('asset-db', 'save-asset', url, source);
}
async function tryAttachComponent(nodeUuid, className, scriptUrl) {
    if (await findComponentUuid(nodeUuid, className)) {
        return true;
    }
    const registeredCandidates = await waitForScriptComponentCandidates(className, scriptUrl);
    if (registeredCandidates.length === 0) {
        console.warn(`[${PACKAGE_NAME}] Script component ${className} was not registered yet. Trying to attach anyway.`);
    }
    const componentCandidates = [...new Set([
            className,
            normalizeClassName(className),
            ...registeredCandidates,
        ].filter(Boolean))];
    for (const componentName of componentCandidates) {
        if (await createComponentAndVerify(nodeUuid, componentName, componentCandidates)) {
            return true;
        }
    }
    return false;
}
async function waitForScriptComponentCandidates(className, scriptUrl) {
    const deadline = Date.now() + 12000;
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const cachedCid = readScriptCidFromProgramCache(scriptAsset, className);
    let logged = false;
    while (Date.now() < deadline) {
        const candidates = await queryRegisteredScriptComponentCandidates(className, scriptAsset);
        if (candidates.length > 0) {
            return [...new Set([...candidates, ...cachedCid])];
        }
        if (!logged) {
            console.log(`[${PACKAGE_NAME}] Waiting for script import: ${className}`);
            logged = true;
        }
        await delay(500);
    }
    return cachedCid;
}
async function queryAssetInfoSafe(url) {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', url);
    }
    catch (_a) {
        return null;
    }
}
async function queryRegisteredScriptComponentCandidates(className, scriptAsset) {
    try {
        const components = await Editor.Message.request('scene', 'query-components');
        if (!Array.isArray(components)) {
            return [];
        }
        const scriptUuid = (scriptAsset === null || scriptAsset === void 0 ? void 0 : scriptAsset.uuid) ? String(scriptAsset.uuid) : '';
        const scriptUrl = (scriptAsset === null || scriptAsset === void 0 ? void 0 : scriptAsset.url) ? String(scriptAsset.url) : '';
        const scriptFile = (scriptAsset === null || scriptAsset === void 0 ? void 0 : scriptAsset.file) ? String(scriptAsset.file).replace(/\\/g, '/') : '';
        const result = [];
        for (const component of components) {
            const candidates = [
                component === null || component === void 0 ? void 0 : component.name,
                component === null || component === void 0 ? void 0 : component.cid,
                component === null || component === void 0 ? void 0 : component.path,
                component === null || component === void 0 ? void 0 : component.assetUuid,
            ].map(readDumpValue).filter(Boolean).map(String);
            const matched = candidates.some((candidate) => matchesComponentName(candidate, className))
                || Boolean(scriptUuid && candidates.includes(scriptUuid))
                || Boolean(scriptUrl && candidates.includes(scriptUrl))
                || Boolean(scriptFile && candidates.some((candidate) => candidate.replace(/\\/g, '/') === scriptFile));
            if (matched) {
                result.push(...candidates);
            }
        }
        return [...new Set(result.filter((candidate) => isComponentAttachCandidate(candidate)))];
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to query registered components.`, error);
        return [];
    }
}
function isComponentAttachCandidate(candidate) {
    return /^[A-Za-z0-9_$./:@-]+$/.test(candidate);
}
function readScriptCidFromProgramCache(scriptAsset, className) {
    var _a;
    if (!(scriptAsset === null || scriptAsset === void 0 ? void 0 : scriptAsset.file)) {
        return [];
    }
    const sourceUrl = `file:///${String(scriptAsset.file).replace(/\\/g, '/')}`;
    const result = [];
    const targets = [
        (0, path_1.join)(Editor.Project.path, 'temp', 'programming', 'packer-driver', 'targets', 'editor'),
        (0, path_1.join)(Editor.Project.path, 'temp', 'programming', 'packer-driver', 'targets', 'preview'),
    ];
    for (const targetDir of targets) {
        try {
            const importMapPath = (0, path_1.join)(targetDir, 'import-map.json');
            if (!(0, fs_1.existsSync)(importMapPath)) {
                continue;
            }
            const importMap = JSON.parse((0, fs_1.readFileSync)(importMapPath, 'utf8'));
            const chunkRelative = ((_a = importMap === null || importMap === void 0 ? void 0 : importMap.imports) === null || _a === void 0 ? void 0 : _a[sourceUrl]) || (importMap === null || importMap === void 0 ? void 0 : importMap[sourceUrl]);
            if (!chunkRelative) {
                continue;
            }
            const chunkFile = (0, path_1.join)(targetDir, String(chunkRelative).replace(/^\.\//, ''));
            if (!(0, fs_1.existsSync)(chunkFile)) {
                continue;
            }
            const chunkSource = (0, fs_1.readFileSync)(chunkFile, 'utf8');
            const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = chunkSource.match(new RegExp(`_RF\\.push\\(\\{\\},\\s*["']([^"']+)["'],\\s*["']${escapedClassName}["']`));
            if (match === null || match === void 0 ? void 0 : match[1]) {
                result.push(match[1]);
            }
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to read script cid from program cache.`, error);
        }
    }
    return [...new Set(result)];
}
async function createComponentAndVerify(nodeUuid, componentName, matchNames) {
    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: componentName,
        });
        await delay(100);
        if (await findComponentUuid(nodeUuid, matchNames)) {
            return true;
        }
        console.warn(`[${PACKAGE_NAME}] create-component returned but ${componentName} was not found on the node.`);
        return false;
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to attach component ${componentName}.`, error);
        return false;
    }
}
function normalizeClassName(className) {
    return className.replace(/[^A-Za-z0-9_$\p{ID_Start}\p{ID_Continue}\u200C\u200D]/gu, '_');
}
async function applyBindings(selectedUuid, className, scriptUrl, openedAssetUrl, selectedTree, bindings, targetScript) {
    if (bindings.length === 0) {
        console.warn(`[${PACKAGE_NAME}] applyBindings skipped because scan result is empty.`);
        return 0;
    }
    let propertiesBound = await bindComponentProperties(selectedUuid, className, scriptUrl, bindings, targetScript);
    console.log(`[${PACKAGE_NAME}] Scene API bound ${propertiesBound}/${bindings.length} properties.`);
    if (propertiesBound >= bindings.length) {
        try {
            await Editor.Message.request('scene', 'save-scene');
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to save scene after property binding.`, error);
        }
        return propertiesBound;
    }
    // Do NOT save-scene before serialized fallback: that would persist empty live refs and fight the file write.
    try {
        const serializedBound = await bindSerializedAssetReferences(openedAssetUrl, scriptUrl, selectedUuid, className, selectedTree, bindings);
        console.log(`[${PACKAGE_NAME}] Serialized asset bound ${serializedBound}/${bindings.length} properties.`);
        if (serializedBound > propertiesBound) {
            propertiesBound = serializedBound;
        }
        if (openedAssetUrl && serializedBound > 0) {
            await Editor.Message.request('asset-db', 'refresh-asset', openedAssetUrl);
            try {
                await Editor.Message.request('scene', 'soft-reload');
            }
            catch (_a) {
                // ignore
            }
            // Prefab stage may keep stale memory; reopen forces inspector to load disk bindings.
            try {
                await Editor.Message.request('scene', 'open-scene', openedAssetUrl);
                console.log(`[${PACKAGE_NAME}] Reopened asset after serialized bind: ${openedAssetUrl}`);
            }
            catch (error) {
                console.warn(`[${PACKAGE_NAME}] Failed to reopen asset after serialized bind.`, error);
            }
        }
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to bind serialized prefab/scene references.`, error);
    }
    return propertiesBound;
}
async function waitForBindableComponent(nodeUuid, className, scriptUrl, propertyNames, targetScript) {
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const typeNames = [...new Set([
            ...((targetScript === null || targetScript === void 0 ? void 0 : targetScript.cid) ? [targetScript.cid] : []),
            ...((targetScript === null || targetScript === void 0 ? void 0 : targetScript.className) ? [targetScript.className] : []),
            className,
            ...getSerializedScriptTypeNames(scriptAsset, className),
        ].filter(Boolean))];
    const deadline = Date.now() + 12000;
    let logged = false;
    while (Date.now() < deadline) {
        // Always re-query from node. Cached UUID is invalid after script reimport.
        const componentUuid = await findComponentUuid(nodeUuid, typeNames);
        if (componentUuid) {
            if (propertyNames.length === 0) {
                return componentUuid;
            }
            try {
                const componentDump = await Editor.Message.request('scene', 'query-component', componentUuid);
                const readyNames = propertyNames.filter((name) => Boolean(getPropertyDump(componentDump, name)));
                if (readyNames.length === propertyNames.length) {
                    console.log(`[${PACKAGE_NAME}] Bindable component ready: ${componentUuid}`);
                    return componentUuid;
                }
                if (!logged) {
                    console.log(`[${PACKAGE_NAME}] Waiting properties ready ${readyNames.length}/${propertyNames.length} on ${componentUuid}`);
                }
            }
            catch (_a) {
                // keep waiting for script reimport
            }
        }
        if (!logged) {
            console.log(`[${PACKAGE_NAME}] Waiting for bindable properties on ${className}, types=${typeNames.join(',')}`);
            logged = true;
        }
        await delay(300);
    }
    return findComponentUuid(nodeUuid, typeNames);
}
async function bindComponentProperties(nodeUuid, className, scriptUrl, bindings, targetScript) {
    const typeNames = [
        ...((targetScript === null || targetScript === void 0 ? void 0 : targetScript.cid) ? [targetScript.cid] : []),
        ...((targetScript === null || targetScript === void 0 ? void 0 : targetScript.className) ? [targetScript.className] : []),
        className,
    ].filter(Boolean);
    const componentUuid = await waitForBindableComponent(nodeUuid, className, scriptUrl, bindings.map((item) => item.propertyName), targetScript);
    if (!componentUuid) {
        console.warn(`[${PACKAGE_NAME}] Cannot find component ${className} for property binding. cid=${(targetScript === null || targetScript === void 0 ? void 0 : targetScript.cid) || ''}`);
        return 0;
    }
    const componentIndex = await findComponentIndexOnNode(nodeUuid, typeNames.length > 0 ? typeNames : [componentUuid]);
    console.log(`[${PACKAGE_NAME}] Binding through componentUuid=${componentUuid}, compsIndex=${componentIndex}`);
    let boundCount = 0;
    for (const binding of bindings) {
        let propertyDump = null;
        try {
            const componentDump = await Editor.Message.request('scene', 'query-component', componentUuid);
            propertyDump = getPropertyDump(componentDump, binding.propertyName);
            if (!propertyDump) {
                console.warn(`[${PACKAGE_NAME}] Property dump missing for ${binding.propertyName}. dump keys=${Object.keys((componentDump === null || componentDump === void 0 ? void 0 : componentDump.value) || componentDump || {}).join(',')}`);
            }
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to query component dump for ${binding.propertyName}.`, error);
        }
        if (!propertyDump) {
            continue;
        }
        const targetUuid = binding.bindTarget === 'node'
            ? binding.nodeUuid
            : await findComponentUuid(binding.nodeUuid, [
                binding.componentType,
                binding.propertyType,
                shortTypeName(binding.componentType || ''),
                shortTypeName(binding.propertyType || ''),
            ].filter(Boolean));
        if (!targetUuid) {
            console.warn(`[${PACKAGE_NAME}] Cannot find target for ${binding.propertyName} on node ${binding.nodeName} (${binding.nodeUuid}).`);
            continue;
        }
        console.log(`[${PACKAGE_NAME}] set-property ${binding.propertyName} -> ${targetUuid} (${binding.bindTarget}/${binding.propertyType})`);
        if (await setReferenceProperty(nodeUuid, componentUuid, componentIndex, binding.propertyName, propertyDump, targetUuid)) {
            boundCount += 1;
        }
        else {
            console.warn(`[${PACKAGE_NAME}] set-property failed for ${binding.propertyName}.`);
        }
    }
    return boundCount;
}
async function findComponentIndexOnNode(nodeUuid, matchNames) {
    var _a, _b, _c, _d, _e;
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node === null || node === void 0 ? void 0 : node.__comps__) ? node.__comps__ : [];
    for (let index = 0; index < components.length; index += 1) {
        const componentAny = components[index];
        const uuid = String(readDumpValue((_a = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _a === void 0 ? void 0 : _a.uuid) || readDumpValue(componentAny === null || componentAny === void 0 ? void 0 : componentAny.uuid) || '');
        const candidates = [
            uuid,
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.type,
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.name,
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.cid,
            (_b = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _b === void 0 ? void 0 : _b.name,
            (_c = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _c === void 0 ? void 0 : _c.__type__,
            (_d = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _d === void 0 ? void 0 : _d.cid,
            (_e = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _e === void 0 ? void 0 : _e.type,
        ].map(readDumpValue).filter(Boolean).map(String);
        if (candidates.some((candidate) => matchNames.some((name) => isExactComponentIdentity(String(name), candidate) || matchesComponentName(candidate, String(name))))) {
            return index;
        }
    }
    return -1;
}
async function findComponentUuid(nodeUuid, componentName) {
    var _a, _b, _c, _d, _e;
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node === null || node === void 0 ? void 0 : node.__comps__) ? node.__comps__ : [];
    const componentNames = Array.isArray(componentName) ? componentName : [componentName];
    for (const component of components) {
        const componentAny = component;
        const uuid = String(readDumpValue((_a = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _a === void 0 ? void 0 : _a.uuid) || readDumpValue(componentAny === null || componentAny === void 0 ? void 0 : componentAny.uuid) || '');
        const candidates = [
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.type,
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.name,
            componentAny === null || componentAny === void 0 ? void 0 : componentAny.cid,
            (_b = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _b === void 0 ? void 0 : _b.name,
            (_c = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _c === void 0 ? void 0 : _c.__type__,
            (_d = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _d === void 0 ? void 0 : _d.cid,
            (_e = componentAny === null || componentAny === void 0 ? void 0 : componentAny.value) === null || _e === void 0 ? void 0 : _e.type,
        ].map(readDumpValue).filter(Boolean).map(String);
        if (candidates.some((candidate) => componentNames.some((name) => matchesComponentName(candidate, name)))) {
            return uuid || null;
        }
    }
    return null;
}
function getPropertyDump(componentDump, propertyName) {
    var _a;
    const dump = ((_a = componentDump === null || componentDump === void 0 ? void 0 : componentDump.value) === null || _a === void 0 ? void 0 : _a[propertyName]) || (componentDump === null || componentDump === void 0 ? void 0 : componentDump[propertyName]);
    return dump && typeof dump === 'object' ? dump : null;
}
async function setReferenceProperty(nodeUuid, componentUuid, componentIndex, propertyName, propertyDump, targetUuid) {
    const candidates = makeReferenceDumpCandidates(propertyDump, targetUuid);
    const attempts = [];
    // Prefab editing mode often rejects component UUID for set-property; prefer node path first.
    if (componentIndex >= 0) {
        attempts.push({ uuid: nodeUuid, path: `__comps__.${componentIndex}.${propertyName}` });
        attempts.push({ uuid: nodeUuid, path: `components.${componentIndex}.${propertyName}` });
    }
    attempts.push({ uuid: componentUuid, path: propertyName });
    for (const attempt of attempts) {
        for (let index = 0; index < candidates.length; index += 1) {
            const dump = candidates[index];
            try {
                const ok = await Editor.Message.request('scene', 'set-property', {
                    uuid: attempt.uuid,
                    path: attempt.path,
                    dump,
                    record: true,
                });
                if (ok) {
                    console.log(`[${PACKAGE_NAME}] set-property ok via uuid=${attempt.uuid}, path=${attempt.path}, candidate=${index + 1}`);
                    return true;
                }
            }
            catch (error) {
                // try next candidate shape
            }
        }
        console.warn(`[${PACKAGE_NAME}] set-property failed for ${propertyName} via uuid=${attempt.uuid}, path=${attempt.path}`);
    }
    return false;
}
function makeReferenceDumpCandidates(propertyDump, targetUuid) {
    const base = JSON.parse(JSON.stringify(propertyDump));
    const type = base.type || base.ctype || undefined;
    const candidates = [];
    const valueShapes = [
        { uuid: targetUuid },
        targetUuid,
        { __uuid__: targetUuid },
        { value: { uuid: targetUuid } },
        { uuid: targetUuid, type },
    ];
    if (base.value && typeof base.value === 'object') {
        valueShapes.unshift(Object.assign(Object.assign({}, base.value), { uuid: targetUuid }));
    }
    for (const value of valueShapes) {
        candidates.push(Object.assign(Object.assign({}, base), { value }));
        if (type) {
            candidates.push(Object.assign(Object.assign({}, base), { type,
                value }));
        }
    }
    return candidates;
}
async function bindSerializedAssetReferences(openedAssetUrl, scriptUrl, selectedUuid, className, selectedTree, bindings) {
    var _a, _b;
    if (!openedAssetUrl) {
        return 0;
    }
    const asset = await Editor.Message.request('asset-db', 'query-asset-info', openedAssetUrl);
    if (!(asset === null || asset === void 0 ? void 0 : asset.file) || !/\.(prefab|scene)$/i.test(asset.file)) {
        return 0;
    }
    const data = await readJsonFileWithRetry(asset.file);
    if (!Array.isArray(data)) {
        return 0;
    }
    const rootName = getNodeName(selectedTree);
    const selectedChildNames = new Set(collectNodeNames(selectedTree).slice(1));
    const nodeIdByUuid = new Map();
    const nodeIdsByName = new Map();
    const componentIdsByNodeIdAndType = new Map();
    data.forEach((item, index) => {
        if ((item === null || item === void 0 ? void 0 : item.__type__) === 'cc.Node') {
            const nodeUuid = (item === null || item === void 0 ? void 0 : item._id) || (item === null || item === void 0 ? void 0 : item._uuid) || '';
            if (nodeUuid) {
                nodeIdByUuid.set(nodeUuid, index);
            }
            if (typeof (item === null || item === void 0 ? void 0 : item._name) === 'string') {
                const list = nodeIdsByName.get(item._name) || [];
                list.push(index);
                nodeIdsByName.set(item._name, list);
            }
        }
    });
    data.forEach((item, index) => {
        var _a;
        const nodeId = (_a = item === null || item === void 0 ? void 0 : item.node) === null || _a === void 0 ? void 0 : _a.__id__;
        if (!Number.isInteger(nodeId) || typeof (item === null || item === void 0 ? void 0 : item.__type__) !== 'string') {
            return;
        }
        componentIdsByNodeIdAndType.set(`${nodeId}:${item.__type__}`, index);
        componentIdsByNodeIdAndType.set(`${nodeId}:${shortTypeName(item.__type__)}`, index);
    });
    const selectedNodeId = (_a = nodeIdByUuid.get(selectedUuid)) !== null && _a !== void 0 ? _a : findSerializedNodeIdByTree(data, rootName, selectedChildNames, nodeIdsByName);
    if (selectedNodeId === undefined) {
        console.warn(`[${PACKAGE_NAME}] Cannot locate selected node ${rootName} in ${openedAssetUrl}.`);
        return 0;
    }
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const scriptTypeNames = getSerializedScriptTypeNames(scriptAsset, className);
    let targetComponent = data.find((item) => {
        var _a;
        if (typeof (item === null || item === void 0 ? void 0 : item.__type__) !== 'string' || ((_a = item === null || item === void 0 ? void 0 : item.node) === null || _a === void 0 ? void 0 : _a.__id__) !== selectedNodeId) {
            return false;
        }
        const typeMatched = scriptTypeNames.includes(item.__type__)
            || item.__type__ === className
            || shortTypeName(item.__type__) === className;
        const hasGeneratedProperty = bindings.some((binding) => Object.prototype.hasOwnProperty.call(item, binding.propertyName));
        return typeMatched || hasGeneratedProperty;
    });
    if (!targetComponent) {
        targetComponent = appendSerializedScriptComponent(data, selectedNodeId, scriptTypeNames[0] || className, bindings);
    }
    const subtreeNodeIds = collectSerializedSubtreeNodeIds(data, selectedNodeId);
    let boundCount = 0;
    for (const binding of bindings) {
        const targetNodeId = resolveSerializedBindingNodeId(data, binding, selectedNodeId, subtreeNodeIds, nodeIdByUuid, nodeIdsByName);
        if (targetNodeId === undefined) {
            console.warn(`[${PACKAGE_NAME}] Serialized bind missed node for ${binding.propertyName} (${binding.nodeName}).`);
            continue;
        }
        if (binding.bindTarget === 'node') {
            targetComponent[binding.propertyName] = { __id__: targetNodeId };
            boundCount += 1;
            continue;
        }
        const typeName = binding.componentType || binding.propertyType;
        const componentId = (_b = componentIdsByNodeIdAndType.get(`${targetNodeId}:${typeName}`)) !== null && _b !== void 0 ? _b : componentIdsByNodeIdAndType.get(`${targetNodeId}:${shortTypeName(typeName)}`);
        if (componentId !== undefined) {
            targetComponent[binding.propertyName] = { __id__: componentId };
            boundCount += 1;
        }
        else {
            console.warn(`[${PACKAGE_NAME}] Serialized bind missed component ${typeName} on ${binding.nodeName}.`);
        }
    }
    (0, fs_1.writeFileSync)(asset.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return boundCount;
}
function findSerializedNodeIdByTree(data, rootName, selectedChildNames, nodeIdsByName) {
    const candidates = nodeIdsByName.get(rootName) || [];
    if (candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0];
    }
    let bestId;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const nodeId of candidates) {
        const childNames = getSerializedDirectChildNames(data, nodeId);
        const matched = childNames.filter((name) => selectedChildNames.has(name)).length;
        const score = matched * 10 - Math.abs(childNames.length - selectedChildNames.size);
        if (score > bestScore) {
            bestScore = score;
            bestId = nodeId;
        }
    }
    return bestId;
}
function getSerializedDirectChildNames(data, nodeId) {
    const node = data[nodeId];
    const children = Array.isArray(node === null || node === void 0 ? void 0 : node._children) ? node._children : [];
    return children
        .map((child) => {
        var _a;
        const childId = child === null || child === void 0 ? void 0 : child.__id__;
        return Number.isInteger(childId) ? String(((_a = data[childId]) === null || _a === void 0 ? void 0 : _a._name) || '') : '';
    })
        .filter(Boolean);
}
function collectSerializedSubtreeNodeIds(data, rootNodeId) {
    const result = new Set();
    const stack = [rootNodeId];
    while (stack.length > 0) {
        const nodeId = stack.pop();
        if (nodeId === undefined || result.has(nodeId)) {
            continue;
        }
        result.add(nodeId);
        const node = data[nodeId];
        const children = Array.isArray(node === null || node === void 0 ? void 0 : node._children) ? node._children : [];
        for (const child of children) {
            if (Number.isInteger(child === null || child === void 0 ? void 0 : child.__id__)) {
                stack.push(child.__id__);
            }
        }
    }
    return result;
}
function resolveSerializedBindingNodeId(data, binding, selectedNodeId, subtreeNodeIds, nodeIdByUuid, nodeIdsByName) {
    var _a;
    const byUuid = nodeIdByUuid.get(binding.nodeUuid);
    if (byUuid !== undefined && subtreeNodeIds.has(byUuid)) {
        return byUuid;
    }
    const byName = (nodeIdsByName.get(binding.nodeName) || []).filter((id) => subtreeNodeIds.has(id));
    if (byName.length === 1) {
        return byName[0];
    }
    if (byName.length > 1) {
        return byName[0];
    }
    if (binding.nodeName === ((_a = data[selectedNodeId]) === null || _a === void 0 ? void 0 : _a._name)) {
        return selectedNodeId;
    }
    return undefined;
}
function getSerializedScriptTypeNames(scriptAsset, className) {
    return [...new Set([
            ...readScriptCidFromProgramCache(scriptAsset, className),
            className,
        ].filter(Boolean))];
}
function appendSerializedScriptComponent(data, nodeId, scriptType, bindings) {
    const node = data[nodeId];
    const componentId = data.length;
    const prefabInfoId = componentId + 1;
    const component = {
        __type__: scriptType,
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: {
            __id__: nodeId,
        },
        _enabled: true,
        __prefab: {
            __id__: prefabInfoId,
        },
        _id: '',
    };
    for (const binding of bindings) {
        component[binding.propertyName] = null;
    }
    const prefabInfo = {
        __type__: 'cc.CompPrefabInfo',
        fileId: makePrefabFileId(),
    };
    if (!Array.isArray(node._components)) {
        node._components = [];
    }
    node._components.push({ __id__: componentId });
    data.push(component, prefabInfo);
    return component;
}
function makePrefabFileId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = (0, crypto_1.randomBytes)(22);
    let result = '';
    for (const byte of bytes) {
        result += chars[byte % chars.length];
    }
    return result;
}
function shortTypeName(type) {
    return type.split('.').pop() || type;
}
async function ensureButtonComponents(buttons, config) {
    if (!config.autoAddButtonComponent) {
        return;
    }
    for (const button of buttons) {
        try {
            const node = await Editor.Message.request('scene', 'query-node', button.nodeUuid);
            if (hasComponent(node, 'Button')) {
                continue;
            }
            const componentType = button.componentType || 'cc.Button';
            await createComponentWithFallback(button.nodeUuid, [componentType, shortTypeName(componentType)]);
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to ensure Button component on ${button.nodeName}.`, error);
        }
    }
}
function hasComponent(node, componentName) {
    const components = Array.isArray(node === null || node === void 0 ? void 0 : node.__comps__) ? node.__comps__ : [];
    return components.some((component) => {
        var _a, _b, _c;
        const candidates = [
            component === null || component === void 0 ? void 0 : component.type,
            component === null || component === void 0 ? void 0 : component.name,
            component === null || component === void 0 ? void 0 : component.cid,
            (_a = component === null || component === void 0 ? void 0 : component.value) === null || _a === void 0 ? void 0 : _a.name,
            (_b = component === null || component === void 0 ? void 0 : component.value) === null || _b === void 0 ? void 0 : _b.__type__,
            (_c = component === null || component === void 0 ? void 0 : component.value) === null || _c === void 0 ? void 0 : _c.cid,
        ].map(readDumpValue).filter(Boolean).map(String);
        return candidates.some((candidate) => matchesComponentName(candidate, componentName));
    });
}
function matchesComponentName(candidate, componentName) {
    const left = String(candidate || '').trim().toLowerCase();
    const right = String(componentName || '').trim().toLowerCase();
    if (!left || !right) {
        return false;
    }
    const leftShort = shortTypeName(candidate).toLowerCase();
    const rightShort = shortTypeName(componentName).toLowerCase();
    return left === right
        || leftShort === rightShort
        || left.endsWith(`.${rightShort}`)
        || right.endsWith(`.${leftShort}`);
}
async function createComponentWithFallback(nodeUuid, componentNames) {
    let lastError;
    for (const component of componentNames) {
        try {
            await Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component,
            });
            return;
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWdRQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBbFEzQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBQ3pELG1DQUFxQztBQUVyQyxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFFakMsTUFBTSxlQUFlLEdBQUcscUNBQXFDLENBQUM7QUFDOUQsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUM7QUFDckUsTUFBTSxzQkFBc0IsR0FBRyxvQkFBb0IsQ0FBQztBQUNwRCxNQUFNLG9CQUFvQixHQUFHLGtCQUFrQixDQUFDO0FBQ2hELE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFDN0QsTUFBTSxxQkFBcUIsR0FBRywwQkFBMEIsQ0FBQztBQUN6RCxNQUFNLHlCQUF5QixHQUFHLDhCQUE4QixDQUFDO0FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFrRDdELE1BQU0sYUFBYSxHQUFtQjtJQUNsQyxVQUFVLEVBQUUsR0FBRztJQUNmLGdCQUFnQixFQUFFLEVBQUU7SUFDcEIsc0JBQXNCLEVBQUUsSUFBSTtJQUM1QixhQUFhLEVBQUUsUUFBUTtJQUN2QixVQUFVLEVBQUUsTUFBTTtJQUNsQixLQUFLLEVBQUU7UUFDSDtZQUNJLE1BQU0sRUFBRSxNQUFNO1lBQ2QsYUFBYSxFQUFFLE1BQU07WUFDckIsWUFBWSxFQUFFLE1BQU07WUFDcEIsYUFBYSxFQUFFLE1BQU07WUFDckIsVUFBVSxFQUFFLE1BQU07WUFDbEIsYUFBYSxFQUFFLEVBQUU7WUFDakIsWUFBWSxFQUFFLEtBQUs7WUFDbkIsa0JBQWtCLEVBQUUsS0FBSztZQUN6QixPQUFPLEVBQUUsSUFBSTtTQUNoQjtRQUNEO1lBQ0ksTUFBTSxFQUFFLFdBQVc7WUFDbkIsYUFBYSxFQUFFLE1BQU07WUFDckIsWUFBWSxFQUFFLE1BQU07WUFDcEIsYUFB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IGV4aXN0c1N5bmMsIHJlYWRGaWxlU3luYywgcmVhZGRpclN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XHJcbmltcG9ydCB7IGJhc2VuYW1lLCBleHRuYW1lLCBqb2luLCByZWxhdGl2ZSB9IGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XHJcblxyXG5jb25zdCBQQUNLQUdFX05BTUUgPSAnYmluZC10b29sJztcclxuXHJcbmNvbnN0IEFVVE9fQklORF9TVEFSVCA9ICcvKioqKioqKioqKioqKioqc3RzcnQqKioqKioqKioqKioqLyc7XHJcbmNvbnN0IEFVVE9fQklORF9FTkQgPSAnLyoqKioqKioqKioqKioqKioqKioqKioqKmVuZCoqKioqKioqKioqKioqKi8nO1xyXG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJUID0gJy8vIEFVVE9fQklORF9TVEFSVCc7XHJcbmNvbnN0IExFR0FDWV9BVVRPX0JJTkRfRU5EID0gJy8vIEFVVE9fQklORF9FTkQnO1xyXG5jb25zdCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCA9ICcvLyBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCc7XHJcbmNvbnN0IEFVVE9fQlVUVE9OX0VWRU5UX0VORCA9ICcvLyBBVVRPX0JVVFRPTl9FVkVOVF9FTkQnO1xyXG5jb25zdCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUID0gJy8vIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQnO1xyXG5jb25zdCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCA9ICcvLyBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCc7XHJcblxyXG50eXBlIEJpbmRUYXJnZXQgPSAnbm9kZScgfCAnY29tcG9uZW50JztcclxudHlwZSBCaW5kTW9kZSA9ICdnZW5lcmF0ZS1hbmQtYmluZCcgfCAnZ2VuZXJhdGUnIHwgJ2JpbmQnO1xyXG5cclxuaW50ZXJmYWNlIEJpbmRUb29sQ29uZmlnIHtcclxuICAgIHNjcmlwdFJvb3Q6IHN0cmluZztcclxuICAgIHNjcmlwdE5hbWVQcmVmaXg6IHN0cmluZztcclxuICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6IGJvb2xlYW47XHJcbiAgICBvdmVyd3JpdGVNb2RlOiAnbWFya2VyJztcclxuICAgIHN0b3BQcmVmaXg6IHN0cmluZztcclxuICAgIHJ1bGVzOiBCaW5kUnVsZVtdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQmluZFJ1bGUge1xyXG4gICAgcHJlZml4OiBzdHJpbmc7XHJcbiAgICBjb21wb25lbnROYW1lPzogc3RyaW5nO1xyXG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XHJcbiAgICBkZWNvcmF0b3JUeXBlOiBzdHJpbmc7XHJcbiAgICBiaW5kVGFyZ2V0OiBCaW5kVGFyZ2V0O1xyXG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xyXG4gICAgc3RvcENoaWxkcmVuOiBib29sZWFuO1xyXG4gICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBib29sZWFuO1xyXG4gICAgZW5hYmxlZDogYm9vbGVhbjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFNjYW5uZWRCaW5kaW5nIHtcclxuICAgIG5vZGVVdWlkOiBzdHJpbmc7XHJcbiAgICBub2RlTmFtZTogc3RyaW5nO1xyXG4gICAgcHJvcGVydHlOYW1lOiBzdHJpbmc7XHJcbiAgICBwcm9wZXJ0eVR5cGU6IHN0cmluZztcclxuICAgIGRlY29yYXRvclR5cGU6IHN0cmluZztcclxuICAgIGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQ7XHJcbiAgICBjb21wb25lbnRUeXBlOiBzdHJpbmc7XHJcbiAgICBzdG9wQ2hpbGRyZW46IGJvb2xlYW47XHJcbiAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBCaW5kUmVzdWx0IHtcclxuICAgIGNsYXNzTmFtZTogc3RyaW5nO1xyXG4gICAgc2NyaXB0VXJsOiBzdHJpbmc7XHJcbiAgICBvcGVuZWRBc3NldFVybDogc3RyaW5nO1xyXG4gICAgc2NyaXB0QmFzZURpcjogc3RyaW5nO1xyXG4gICAgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW107XHJcbiAgICBidXR0b25zOiBTY2FubmVkQmluZGluZ1tdO1xyXG4gICAgY3JlYXRlZDogYm9vbGVhbjtcclxuICAgIGNvbXBvbmVudEF0dGFjaGVkOiBib29sZWFuO1xyXG4gICAgcHJvcGVydGllc0JvdW5kOiBudW1iZXI7XHJcbn1cclxuXHJcbmNvbnN0IGRlZmF1bHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xyXG4gICAgc2NyaXB0Um9vdDogJy4nLFxyXG4gICAgc2NyaXB0TmFtZVByZWZpeDogJycsXHJcbiAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiB0cnVlLFxyXG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcicsXHJcbiAgICBzdG9wUHJlZml4OiAnc3RvcCcsXHJcbiAgICBydWxlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgcHJlZml4OiAnbm9kZScsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTm9kZScsXHJcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdOb2RlJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxyXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcclxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgcHJlZml4OiAnbm9kZV9zdG9wJyxcclxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ05vZGUnLFxyXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdOb2RlJyxcclxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ05vZGUnLFxyXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnbm9kZScsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICcnLFxyXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IHRydWUsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ3NwaW5lJyxcclxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnc3AuU2tlbGV0b24nLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnc3AuU2tlbGV0b24nLFxyXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcclxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgcHJlZml4OiAnYnV0dG9uJyxcclxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0J1dHRvbicsXHJcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ0J1dHRvbicsXHJcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdCdXR0b24nLFxyXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJ2NjLkJ1dHRvbicsXHJcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogdHJ1ZSxcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgICAgcHJlZml4OiAnbGFiZWwnLFxyXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnTGFiZWwnLFxyXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdMYWJlbCcsXHJcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdMYWJlbCcsXHJcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdjb21wb25lbnQnLFxyXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnY2MuTGFiZWwnLFxyXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxyXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGZhbHNlLFxyXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICBdLFxyXG59O1xyXG5cclxuZXhwb3J0IGNvbnN0IG1ldGhvZHM6IHsgW2tleTogc3RyaW5nXTogKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnkgfSA9IHtcclxuICAgIGFzeW5jIG9wZW5SdWxlc1BhbmVsKCkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5QYW5lbC5vcGVuKGAke1BBQ0tBR0VfTkFNRX0ucnVsZXNgKTtcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgcXVlcnlDb25maWcoKSB7XHJcbiAgICAgICAgcmV0dXJuIHJlYWRDb25maWcoKTtcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgc2F2ZUNvbmZpZyhjb25maWc6IFBhcnRpYWw8QmluZFRvb2xDb25maWc+KSB7XHJcbiAgICAgICAgY29uc3QgbmV4dENvbmZpZzogQmluZFRvb2xDb25maWcgPSB7XHJcbiAgICAgICAgICAgIC4uLmRlZmF1bHRDb25maWcsXHJcbiAgICAgICAgICAgIC4uLmNvbmZpZyxcclxuICAgICAgICAgICAgcnVsZXM6IG5vcm1hbGl6ZVJ1bGVzKGNvbmZpZy5ydWxlcyksXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHRSb290JywgbmV4dENvbmZpZy5zY3JpcHRSb290KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3NjcmlwdE5hbWVQcmVmaXgnLCBuZXh0Q29uZmlnLnNjcmlwdE5hbWVQcmVmaXgpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcsIG5leHRDb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgbmV4dENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3N0b3BQcmVmaXgnLCBuZXh0Q29uZmlnLnN0b3BQcmVmaXgpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAncnVsZXMnLCBuZXh0Q29uZmlnLnJ1bGVzKTtcclxuICAgICAgICByZXR1cm4gbmV4dENvbmZpZztcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgcmVzZXRDb25maWcoKSB7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHRSb290JywgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3NjcmlwdE5hbWVQcmVmaXgnLCBkZWZhdWx0Q29uZmlnLnNjcmlwdE5hbWVQcmVmaXgpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcsIGRlZmF1bHRDb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgZGVmYXVsdENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3N0b3BQcmVmaXgnLCBkZWZhdWx0Q29uZmlnLnN0b3BQcmVmaXgpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAncnVsZXMnLCBkZWZhdWx0Q29uZmlnLnJ1bGVzKTtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgYmluZFNlbGVjdGVkTm9kZSgpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdnZW5lcmF0ZS1hbmQtYmluZCcpO1xyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyBnZW5lcmF0ZVNlbGVjdGVkTm9kZVNjcmlwdCgpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdnZW5lcmF0ZScpO1xyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyBiaW5kU2VsZWN0ZWROb2RlUmVmZXJlbmNlcygpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdiaW5kJyk7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIGJpbmRVaU9uU2VsZWN0ZWROb2RlKCkge1xyXG4gICAgICAgIGF3YWl0IHJ1bkJpbmRVaU9uU2VsZWN0ZWROb2RlKCk7XHJcbiAgICB9LFxyXG59O1xyXG5cclxuY29uc3QgQklORF9NQVJLRVJfSElOVCA9IGDlnKjpnIDopoHnu5HlrproioLngrnnmoTohJrmnKzmt7vliqAgJHtBVVRPX0JJTkRfU1RBUlR9ICR7QVVUT19CSU5EX0VORH1gO1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gcnVuQmluZFNlbGVjdGVkTm9kZShtb2RlOiBCaW5kTW9kZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbW9kZVRpdGxlID0gZ2V0TW9kZVRpdGxlKG1vZGUpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBiaW5kU2VsZWN0ZWROb2RlKG1vZGUpO1xyXG4gICAgICAgIGNvbnN0IGRldGFpbCA9IFtcclxuICAgICAgICAgICAgYE9wZW5lZDogJHtyZXN1bHQub3BlbmVkQXNzZXRVcmx9YCxcclxuICAgICAgICAgICAgYFNjcmlwdCBiYXNlOiAke3Jlc3VsdC5zY3JpcHRCYXNlRGlyfWAsXHJcbiAgICAgICAgICAgIGBTY3JpcHQ6ICR7cmVzdWx0LnNjcmlwdFVybH1gLFxyXG4gICAgICAgICAgICBgUHJvcGVydGllczogJHtyZXN1bHQuYmluZGluZ3MubGVuZ3RofWAsXHJcbiAgICAgICAgICAgIGBCdXR0b24gZXZlbnRzOiAke3Jlc3VsdC5idXR0b25zLmxlbmd0aH1gLFxyXG4gICAgICAgICAgICBtb2RlID09PSAnZ2VuZXJhdGUnID8gJ0NvbXBvbmVudDogc2tpcHBlZCcgOiAocmVzdWx0LmNvbXBvbmVudEF0dGFjaGVkID8gJ0NvbXBvbmVudDogYXR0YWNoIGF0dGVtcHRlZCBzdWNjZXNzZnVsbHknIDogJ0NvbXBvbmVudDogbm90IGF0dGFjaGVkJyksXHJcbiAgICAgICAgICAgIG1vZGUgPT09ICdnZW5lcmF0ZScgPyAnQm91bmQgcmVmZXJlbmNlczogc2tpcHBlZCcgOiBgQm91bmQgcmVmZXJlbmNlczogJHtyZXN1bHQucHJvcGVydGllc0JvdW5kfWAsXHJcbiAgICAgICAgXS5qb2luKCdcXG4nKTtcclxuXHJcbiAgICAgICAgRWRpdG9yLlRhc2suYWRkTm90aWNlKHtcclxuICAgICAgICAgICAgdGl0bGU6IGAke21vZGVUaXRsZX0gY29tcGxldGVgLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBkZXRhaWwsXHJcbiAgICAgICAgICAgIHR5cGU6ICdzdWNjZXNzJyxcclxuICAgICAgICAgICAgc291cmNlOiBQQUNLQUdFX05BTUUsXHJcbiAgICAgICAgICAgIHRpbWVvdXQ6IDYwMDAsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgWyR7UEFDS0FHRV9OQU1FfV0gJHttZXNzYWdlfWAsIGVycm9yKTtcclxuICAgICAgICBFZGl0b3IuVGFzay5hZGROb3RpY2Uoe1xyXG4gICAgICAgICAgICB0aXRsZTogYCR7bW9kZVRpdGxlfSBmYWlsZWRgLFxyXG4gICAgICAgICAgICBtZXNzYWdlLFxyXG4gICAgICAgICAgICB0eXBlOiAnZXJyb3InLFxyXG4gICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcclxuICAgICAgICAgICAgdGltZW91dDogODAwMCxcclxuICAgICAgICB9KTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0TW9kZVRpdGxlKG1vZGU6IEJpbmRNb2RlKTogc3RyaW5nIHtcclxuICAgIGlmIChtb2RlID09PSAnZ2VuZXJhdGUnKSB7XHJcbiAgICAgICAgcmV0dXJuICdHZW5lcmF0ZSBzY3JpcHQnO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtb2RlID09PSAnYmluZCcpIHtcclxuICAgICAgICByZXR1cm4gJ0JpbmQgcmVmZXJlbmNlcyc7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuICdHZW5lcmF0ZSBhbmQgYmluZCc7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJ1bkJpbmRVaU9uU2VsZWN0ZWROb2RlKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBiaW5kVWlPblNlbGVjdGVkTm9kZSgpO1xyXG4gICAgICAgIEVkaXRvci5UYXNrLmFkZE5vdGljZSh7XHJcbiAgICAgICAgICAgIHRpdGxlOiAn57uR5a6aVUkgY29tcGxldGUnLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBbXHJcbiAgICAgICAgICAgICAgICBgU2NyaXB0OiAke3Jlc3VsdC5zY3JpcHRVcmx9YCxcclxuICAgICAgICAgICAgICAgIGBQcm9wZXJ0aWVzOiAke3Jlc3VsdC5iaW5kaW5ncy5sZW5ndGh9YCxcclxuICAgICAgICAgICAgICAgIGBCdXR0b24gZXZlbnRzOiAke3Jlc3VsdC5idXR0b25zLmxlbmd0aH1gLFxyXG4gICAgICAgICAgICAgICAgYEJvdW5kIHJlZmVyZW5jZXM6ICR7cmVzdWx0LnByb3BlcnRpZXNCb3VuZH1gLFxyXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpLFxyXG4gICAgICAgICAgICB0eXBlOiAnc3VjY2VzcycsXHJcbiAgICAgICAgICAgIHNvdXJjZTogUEFDS0FHRV9OQU1FLFxyXG4gICAgICAgICAgICB0aW1lb3V0OiA2MDAwLFxyXG4gICAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFske1BBQ0tBR0VfTkFNRX1dICR7bWVzc2FnZX1gLCBlcnJvcik7XHJcbiAgICAgICAgRWRpdG9yLlRhc2suYWRkTm90aWNlKHtcclxuICAgICAgICAgICAgdGl0bGU6ICfnu5HlrppVSSBmYWlsZWQnLFxyXG4gICAgICAgICAgICBtZXNzYWdlLFxyXG4gICAgICAgICAgICB0eXBlOiAnZXJyb3InLFxyXG4gICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcclxuICAgICAgICAgICAgdGltZW91dDogODAwMCxcclxuICAgICAgICB9KTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxvYWQoKSB7fVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpIHt9XHJcblxyXG5hc3luYyBmdW5jdGlvbiBiaW5kVWlPblNlbGVjdGVkTm9kZSgpOiBQcm9taXNlPEJpbmRSZXN1bHQ+IHtcclxuICAgIGNvbnN0IHNlbGVjdGVkVXVpZCA9IEVkaXRvci5TZWxlY3Rpb24uZ2V0TGFzdFNlbGVjdGVkKCdub2RlJykgfHwgRWRpdG9yLlNlbGVjdGlvbi5nZXRTZWxlY3RlZCgnbm9kZScpWzBdO1xyXG4gICAgaWYgKCFzZWxlY3RlZFV1aWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzZWxlY3QgYSBub2RlIGZpcnN0LicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBCaW5kIFVJIHNlbGVjdGVkVXVpZDogJHtzZWxlY3RlZFV1aWR9YCk7XHJcbiAgICBjb25zdCBzZWxlY3RlZFRyZWUgPSBhd2FpdCBxdWVyeVNlbGVjdGVkTm9kZVRyZWUoc2VsZWN0ZWRVdWlkKTtcclxuICAgIGlmICghc2VsZWN0ZWRUcmVlKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgcmVhZCB0aGUgc2VsZWN0ZWQgbm9kZS4gTWFrZSBzdXJlIGEgc2NlbmUgb3IgcHJlZmFiIGlzIG9wZW4uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFNlbGVjdGVkIHRyZWUgcm9vdDogJHtnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpfSwgY2hpbGRyZW46ICR7Z2V0Q2hpbGRyZW4oc2VsZWN0ZWRUcmVlKS5tYXAoZ2V0Tm9kZU5hbWUpLmpvaW4oJywgJyl9YCk7XHJcblxyXG4gICAgY29uc3Qgc2NyaXB0cyA9IGF3YWl0IGxpc3RTY3JpcHRzT25Ob2RlKHNlbGVjdGVkVXVpZCk7XHJcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gU2NyaXB0cyBvbiBub2RlICgke3NjcmlwdHMubGVuZ3RofSk6ICR7c2NyaXB0cy5tYXAoKGl0ZW0pID0+IGAke2l0ZW0uY2xhc3NOYW1lfUAke2l0ZW0uc2NyaXB0VXJsfWApLmpvaW4oJyB8ICcpIHx8ICcobm9uZSknfWApO1xyXG4gICAgaWYgKHNjcmlwdHMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgY29uc3QgdGlwID0gYOmAieS4reiKgueCueS4iuayoeacieiEmuacrOe7hOS7tuOAgiR7QklORF9NQVJLRVJfSElOVH1gO1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gJHt0aXB9YCk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHRpcCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdGFyZ2V0U2NyaXB0ID0gcGlja0JpbmRVaVRhcmdldFNjcmlwdChzY3JpcHRzLCBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpKTtcclxuICAgIGlmICghdGFyZ2V0U2NyaXB0KSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSAke0JJTkRfTUFSS0VSX0hJTlR9YCk7XHJcbiAgICAgICAgZm9yIChjb25zdCBzY3JpcHQgb2Ygc2NyaXB0cykge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENoZWNrZWQgc2NyaXB0IHdpdGhvdXQgYmluZCBtYXJrZXJzOiAke3NjcmlwdC5zY3JpcHRVcmx9YCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihCSU5EX01BUktFUl9ISU5UKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKCk7XHJcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXRTY3JpcHQuY2xhc3NOYW1lXHJcbiAgICAgICAgfHwgZXh0cmFjdENsYXNzTmFtZUZyb21Tb3VyY2UodGFyZ2V0U2NyaXB0LnNvdXJjZSlcclxuICAgICAgICB8fCBhcHBseVNjcmlwdE5hbWVQcmVmaXgodG9DbGFzc05hbWUoZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKSksIGNvbmZpZy5zY3JpcHROYW1lUHJlZml4KTtcclxuICAgIGNvbnN0IG9wZW5lZEFzc2V0VXJsID0gYXdhaXQgcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWUpO1xyXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGxvY2F0ZSB0aGUgb3BlbmVkIHByZWZhYiBvciBzY2VuZSBhc3NldC4gUGxlYXNlIHNhdmUgdGhlIHByZWZhYi9zY2VuZSBhbmQgcnVuIGJpbmQgYWdhaW4uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2NyaXB0VXJsID0gdGFyZ2V0U2NyaXB0LnNjcmlwdFVybDtcclxuICAgIGNvbnN0IHNjcmlwdEJhc2VEaXIgPSBnZXRTY3JpcHRCYXNlRGlyKG9wZW5lZEFzc2V0VXJsKTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBCaW5kIFVJIHRhcmdldCBzY3JpcHQ6ICR7c2NyaXB0VXJsfWApO1xyXG4gICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIEJpbmQgVUkgY2xhc3NOYW1lOiAke2NsYXNzTmFtZX0sIGNvbXBvbmVudFV1aWQ6ICR7dGFyZ2V0U2NyaXB0LmNvbXBvbmVudFV1aWR9LCBjaWQ6ICR7dGFyZ2V0U2NyaXB0LmNpZH1gKTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBPcGVuZWQgYXNzZXQ6ICR7b3BlbmVkQXNzZXRVcmx9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gRW5hYmxlZCBydWxlczogJHtnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKS5tYXAoKHJ1bGUpID0+IHJ1bGUucHJlZml4KS5qb2luKCcsICcpfWApO1xyXG5cclxuICAgIGNvbnN0IHNjYW4gPSBzY2FuQmluZGluZ3Moc2VsZWN0ZWRUcmVlLCBjb25maWcpO1xyXG4gICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFNjYW4gYmluZGluZ3MgKCR7c2Nhbi5sZW5ndGh9KTogJHtzY2FuLm1hcCgoaXRlbSkgPT4gYCR7aXRlbS5wcm9wZXJ0eU5hbWV9OiR7aXRlbS5wcm9wZXJ0eVR5cGV9QCR7aXRlbS5ub2RlTmFtZX1gKS5qb2luKCcgfCAnKSB8fCAnKG5vbmUpJ31gKTtcclxuICAgIGNvbnN0IGJ1dHRvbnMgPSBzY2FuLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5nZW5lcmF0ZUNsaWNrRXZlbnQpO1xyXG4gICAgY29uc3QgZ2VuZXJhdGVkID0gcmVuZGVyU2NyaXB0KGNsYXNzTmFtZSwgc2NhbiwgYnV0dG9ucyk7XHJcbiAgICBjb25zdCBmaW5hbFNvdXJjZSA9IHVwZGF0ZVVpTWFya2VkU291cmNlKHRhcmdldFNjcmlwdC5zb3VyY2UsIGdlbmVyYXRlZCk7XHJcblxyXG4gICAgY29uc3Qgc291cmNlQ2hhbmdlZCA9IGZpbmFsU291cmNlICE9PSB0YXJnZXRTY3JpcHQuc291cmNlO1xyXG4gICAgaWYgKHNvdXJjZUNoYW5nZWQpIHtcclxuICAgICAgICBhd2FpdCB3cml0ZUFzc2V0KHNjcmlwdFVybCwgZmluYWxTb3VyY2UsIGZhbHNlKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgc2NyaXB0VXJsKTtcclxuICAgICAgICAvLyBTY3JpcHQgcmVpbXBvcnQgcmVtb3VudHMgdGhlIGNvbXBvbmVudDsgcHJldmlvdXMgY29tcG9uZW50IFVVSUQgYmVjb21lcyBpbnZhbGlkLlxyXG4gICAgICAgIHRhcmdldFNjcmlwdC5jb21wb25lbnRVdWlkID0gJyc7XHJcbiAgICAgICAgYXdhaXQgZGVsYXkoMzAwKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gU2NyaXB0IHVwZGF0ZWQgYW5kIHJlZnJlc2hlZDogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBTY3JpcHQgY29udGVudCB1bmNoYW5nZWQsIHNraXAgcmVmcmVzaDogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zLCBjb25maWcpO1xyXG4gICAgY29uc3QgbGl2ZUNvbXBvbmVudFV1aWQgPSBhd2FpdCB3YWl0Rm9yQmluZGFibGVDb21wb25lbnQoXHJcbiAgICAgICAgc2VsZWN0ZWRVdWlkLFxyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBzY3JpcHRVcmwsXHJcbiAgICAgICAgc2Nhbi5tYXAoKGl0ZW0pID0+IGl0ZW0ucHJvcGVydHlOYW1lKSxcclxuICAgICAgICB0YXJnZXRTY3JpcHQsXHJcbiAgICApO1xyXG4gICAgdGFyZ2V0U2NyaXB0LmNvbXBvbmVudFV1aWQgPSBsaXZlQ29tcG9uZW50VXVpZCB8fCAnJztcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBMaXZlIGNvbXBvbmVudFV1aWQgZm9yIGJpbmRpbmc6ICR7dGFyZ2V0U2NyaXB0LmNvbXBvbmVudFV1aWQgfHwgJyhtaXNzaW5nKSd9YCk7XHJcblxyXG4gICAgY29uc3QgcHJvcGVydGllc0JvdW5kID0gYXdhaXQgYXBwbHlCaW5kaW5ncyhcclxuICAgICAgICBzZWxlY3RlZFV1aWQsXHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICBvcGVuZWRBc3NldFVybCxcclxuICAgICAgICBzZWxlY3RlZFRyZWUsXHJcbiAgICAgICAgc2NhbixcclxuICAgICAgICB0YXJnZXRTY3JpcHQsXHJcbiAgICApO1xyXG4gICAgY29uc3QgY29tcG9uZW50QXR0YWNoZWQgPSBCb29sZWFuKHRhcmdldFNjcmlwdC5jb21wb25lbnRVdWlkKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBzY3JpcHRVcmwsXHJcbiAgICAgICAgb3BlbmVkQXNzZXRVcmwsXHJcbiAgICAgICAgc2NyaXB0QmFzZURpcixcclxuICAgICAgICBiaW5kaW5nczogc2NhbixcclxuICAgICAgICBidXR0b25zLFxyXG4gICAgICAgIGNyZWF0ZWQ6IGZhbHNlLFxyXG4gICAgICAgIGNvbXBvbmVudEF0dGFjaGVkLFxyXG4gICAgICAgIHByb3BlcnRpZXNCb3VuZCxcclxuICAgIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBOb2RlU2NyaXB0SW5mbyB7XHJcbiAgICBjbGFzc05hbWU6IHN0cmluZztcclxuICAgIHNjcmlwdFVybDogc3RyaW5nO1xyXG4gICAgc291cmNlOiBzdHJpbmc7XHJcbiAgICBjb21wb25lbnRVdWlkOiBzdHJpbmc7XHJcbiAgICBjaWQ6IHN0cmluZztcclxufVxyXG5cclxuZnVuY3Rpb24gcGlja0JpbmRVaVRhcmdldFNjcmlwdChzY3JpcHRzOiBOb2RlU2NyaXB0SW5mb1tdLCBub2RlTmFtZTogc3RyaW5nKTogTm9kZVNjcmlwdEluZm8gfCB1bmRlZmluZWQge1xyXG4gICAgY29uc3Qgd2l0aE1hcmtlcnMgPSBzY3JpcHRzLmZpbHRlcigoc2NyaXB0KSA9PiBoYXNCaW5kTWFya2VycyhzY3JpcHQuc291cmNlKSk7XHJcbiAgICBpZiAod2l0aE1hcmtlcnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsb3dlck5vZGVOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IGJ5Q2xhc3NOYW1lID0gd2l0aE1hcmtlcnMuZmluZCgoc2NyaXB0KSA9PiBzY3JpcHQuY2xhc3NOYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyTm9kZU5hbWUpO1xyXG4gICAgaWYgKGJ5Q2xhc3NOYW1lKSB7XHJcbiAgICAgICAgcmV0dXJuIGJ5Q2xhc3NOYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJ5RmlsZU5hbWUgPSB3aXRoTWFya2Vycy5maW5kKChzY3JpcHQpID0+IHtcclxuICAgICAgICBjb25zdCBmaWxlTmFtZSA9IGJhc2VuYW1lKHNjcmlwdC5zY3JpcHRVcmwpLnJlcGxhY2UoL1xcLnRzeD8kL2ksICcnKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgICAgIHJldHVybiBmaWxlTmFtZSA9PT0gbG93ZXJOb2RlTmFtZSB8fCBsb3dlck5vZGVOYW1lLnN0YXJ0c1dpdGgoZmlsZU5hbWUpO1xyXG4gICAgfSk7XHJcbiAgICBpZiAoYnlGaWxlTmFtZSkge1xyXG4gICAgICAgIHJldHVybiBieUZpbGVOYW1lO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB3aXRoTWFya2Vyc1swXTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlTZWxlY3RlZE5vZGVUcmVlKHNlbGVjdGVkVXVpZDogc3RyaW5nKTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICBjb25zdCBkaXJlY3QgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlLXRyZWUnLCBzZWxlY3RlZFV1aWQpO1xyXG4gICAgaWYgKGRpcmVjdCAmJiAoZ2V0Q2hpbGRyZW4oZGlyZWN0KS5sZW5ndGggPiAwIHx8IGdldFV1aWQoZGlyZWN0KSA9PT0gc2VsZWN0ZWRVdWlkKSkge1xyXG4gICAgICAgIGlmIChnZXRDaGlsZHJlbihkaXJlY3QpLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgcm9vdCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZm91bmQgPSBmaW5kTm9kZUluVHJlZShyb290LCBzZWxlY3RlZFV1aWQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGZvdW5kICYmIGdldENoaWxkcmVuKGZvdW5kKS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFNlbGVjdGVkIHRyZWUgcmVjb3ZlcmVkIGZyb20gZnVsbCBzY2VuZSB0cmVlLmApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmb3VuZDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlY292ZXIgc2VsZWN0ZWQgdHJlZSBmcm9tIGZ1bGwgc2NlbmUgdHJlZS5gLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGRpcmVjdDtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHJvb3QgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlLXRyZWUnKTtcclxuICAgICAgICByZXR1cm4gZmluZE5vZGVJblRyZWUocm9vdCwgc2VsZWN0ZWRVdWlkKSB8fCBkaXJlY3Q7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gZGlyZWN0O1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBmaW5kTm9kZUluVHJlZShub2RlOiBhbnksIHV1aWQ6IHN0cmluZyk6IGFueSB8IG51bGwge1xyXG4gICAgaWYgKCFub2RlKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBpZiAoZ2V0VXVpZChub2RlKSA9PT0gdXVpZCkge1xyXG4gICAgICAgIHJldHVybiBub2RlO1xyXG4gICAgfVxyXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBnZXRDaGlsZHJlbihub2RlKSkge1xyXG4gICAgICAgIGNvbnN0IGZvdW5kID0gZmluZE5vZGVJblRyZWUoY2hpbGQsIHV1aWQpO1xyXG4gICAgICAgIGlmIChmb3VuZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZm91bmQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGxpc3RTY3JpcHRzT25Ob2RlKG5vZGVVdWlkOiBzdHJpbmcpOiBQcm9taXNlPE5vZGVTY3JpcHRJbmZvW10+IHtcclxuICAgIGNvbnN0IG5vZGUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlJywgbm9kZVV1aWQpO1xyXG4gICAgY29uc3QgY29tcG9uZW50cyA9IEFycmF5LmlzQXJyYXkobm9kZT8uX19jb21wc19fKSA/IG5vZGUuX19jb21wc19fIDogW107XHJcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gcXVlcnktbm9kZSBjb21wcyBjb3VudDogJHtjb21wb25lbnRzLmxlbmd0aH1gKTtcclxuICAgIGlmIChjb21wb25lbnRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgcmVnaXN0ZXJlZDogQXJyYXk8eyBuYW1lPzogc3RyaW5nOyBjaWQ/OiBzdHJpbmc7IHBhdGg/OiBzdHJpbmc7IGFzc2V0VXVpZD86IHN0cmluZyB9PiA9IFtdO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBsaXN0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktY29tcG9uZW50cycpO1xyXG4gICAgICAgIHJlZ2lzdGVyZWQgPSBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBxdWVyeSByZWdpc3RlcmVkIGNvbXBvbmVudHMuYCwgZXJyb3IpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3VsdHM6IE5vZGVTY3JpcHRJbmZvW10gPSBbXTtcclxuICAgIGNvbnN0IHNlZW5VcmxzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcblxyXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xyXG4gICAgICAgIGNvbnN0IGNvbXBvbmVudEFueSA9IGNvbXBvbmVudCBhcyBhbnk7XHJcbiAgICAgICAgY29uc3QgdHlwZSA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8udHlwZSkgfHwgJycpO1xyXG4gICAgICAgIGNvbnN0IGNpZCA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8uY2lkKSB8fCB0eXBlIHx8ICcnKTtcclxuICAgICAgICBjb25zdCBjb21wb25lbnRVdWlkID0gU3RyaW5nKFxyXG4gICAgICAgICAgICByZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8udmFsdWU/LnV1aWQpXHJcbiAgICAgICAgICAgIHx8IHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py51dWlkKVxyXG4gICAgICAgICAgICB8fCAnJyxcclxuICAgICAgICApO1xyXG4gICAgICAgIGNvbnN0IHR5cGVDYW5kaWRhdGVzID0gW3R5cGUsIGNpZF1cclxuICAgICAgICAgICAgLm1hcChyZWFkRHVtcFZhbHVlKVxyXG4gICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAgICAgICAgIC5tYXAoU3RyaW5nKTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIENvbXAgZHVtcCB0eXBlPSR7dHlwZX0sIGNpZD0ke2NpZH0sIHV1aWQ9JHtjb21wb25lbnRVdWlkfWApO1xyXG5cclxuICAgICAgICBpZiAodHlwZUNhbmRpZGF0ZXMubGVuZ3RoID09PSAwIHx8IHR5cGVDYW5kaWRhdGVzLmV2ZXJ5KChjYW5kaWRhdGUpID0+IGlzQnVpbHRpbkNvbXBvbmVudFR5cGUoY2FuZGlkYXRlKSkpIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaGVkID0gZmluZFJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnQocmVnaXN0ZXJlZCwgdHlwZUNhbmRpZGF0ZXMpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBSZWdpc3RlcmVkIG1hdGNoOiAke21hdGNoZWQgPyBgJHttYXRjaGVkLm5hbWV9fCR7bWF0Y2hlZC5jaWR9fCR7bWF0Y2hlZC5wYXRofXwke21hdGNoZWQuYXNzZXRVdWlkfWAgOiAnKG5vbmUpJ31gKTtcclxuXHJcbiAgICAgICAgY29uc3QgYXNzZXRLZXlzID0gW1xyXG4gICAgICAgICAgICBtYXRjaGVkPy5hc3NldFV1aWQsXHJcbiAgICAgICAgICAgIG1hdGNoZWQ/LnBhdGgsXHJcbiAgICAgICAgICAgIC4uLnR5cGVDYW5kaWRhdGVzLFxyXG4gICAgICAgIF0uZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICBsZXQgcmVzb2x2ZWQ6IE5vZGVTY3JpcHRJbmZvIHwgbnVsbCA9IG51bGw7XHJcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgYXNzZXRLZXlzKSB7XHJcbiAgICAgICAgICAgIHJlc29sdmVkID0gYXdhaXQgcmVzb2x2ZVNjcmlwdEFzc2V0QnlLZXkoa2V5LCB0eXBlQ2FuZGlkYXRlcywgY29tcG9uZW50VXVpZCwgY2lkIHx8IHR5cGUpO1xyXG4gICAgICAgICAgICBpZiAocmVzb2x2ZWQpIHtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoIXJlc29sdmVkKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlc29sdmUgc2NyaXB0IGFzc2V0IGZvciBjb21wb25lbnQgdHlwZT0ke3R5cGV9YCk7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHNlZW5VcmxzLmhhcyhyZXNvbHZlZC5zY3JpcHRVcmwpKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2VlblVybHMuYWRkKHJlc29sdmVkLnNjcmlwdFVybCk7XHJcbiAgICAgICAgcmVzdWx0cy5wdXNoKHJlc29sdmVkKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0cztcclxufVxyXG5cclxuZnVuY3Rpb24gZmluZFJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnQoXHJcbiAgICByZWdpc3RlcmVkOiBBcnJheTx7IG5hbWU/OiBzdHJpbmc7IGNpZD86IHN0cmluZzsgcGF0aD86IHN0cmluZzsgYXNzZXRVdWlkPzogc3RyaW5nIH0+LFxyXG4gICAgdHlwZUNhbmRpZGF0ZXM6IHN0cmluZ1tdLFxyXG4pOiB7IG5hbWU/OiBzdHJpbmc7IGNpZD86IHN0cmluZzsgcGF0aD86IHN0cmluZzsgYXNzZXRVdWlkPzogc3RyaW5nIH0gfCB1bmRlZmluZWQge1xyXG4gICAgcmV0dXJuIHJlZ2lzdGVyZWQuZmluZCgoaXRlbSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlZ0NhbmRpZGF0ZXMgPSBbaXRlbT8ubmFtZSwgaXRlbT8uY2lkLCBpdGVtPy5hc3NldFV1aWRdXHJcbiAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgICAgICAgLm1hcChTdHJpbmcpO1xyXG4gICAgICAgIHJldHVybiB0eXBlQ2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IHJlZ0NhbmRpZGF0ZXMuc29tZSgocmVnKSA9PiBpc0V4YWN0Q29tcG9uZW50SWRlbnRpdHkocmVnLCBjYW5kaWRhdGUpKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNFeGFjdENvbXBvbmVudElkZW50aXR5KGxlZnQ6IHN0cmluZywgcmlnaHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3QgYSA9IFN0cmluZyhsZWZ0IHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IGIgPSBTdHJpbmcocmlnaHQgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgaWYgKCFhIHx8ICFiKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGEgPT09IGJcclxuICAgICAgICB8fCBzaG9ydFR5cGVOYW1lKGEpLnRvTG93ZXJDYXNlKCkgPT09IHNob3J0VHlwZU5hbWUoYikudG9Mb3dlckNhc2UoKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVNjcmlwdEFzc2V0QnlLZXkoXHJcbiAgICBrZXk6IHN0cmluZyxcclxuICAgIGNsYXNzTmFtZUNhbmRpZGF0ZXM6IHN0cmluZ1tdLFxyXG4gICAgY29tcG9uZW50VXVpZDogc3RyaW5nLFxyXG4gICAgY2lkOiBzdHJpbmcsXHJcbik6IFByb21pc2U8Tm9kZVNjcmlwdEluZm8gfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIGtleSk7XHJcbiAgICAgICAgaWYgKCFhc3NldD8uZmlsZSB8fCAhL1xcLnRzeD8kL2kudGVzdChTdHJpbmcoYXNzZXQuZmlsZSkpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgc2NyaXB0VXJsID0gU3RyaW5nKGFzc2V0LnVybCB8fCBhc3NldC5zb3VyY2UgfHwgJycpO1xyXG4gICAgICAgIGlmICghc2NyaXB0VXJsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgc291cmNlID0gcmVhZEZpbGVTeW5jKFN0cmluZyhhc3NldC5maWxlKSwgJ3V0ZjgnKTtcclxuICAgICAgICBjb25zdCBjbGFzc05hbWUgPSBleHRyYWN0Q2xhc3NOYW1lRnJvbVNvdXJjZShzb3VyY2UpXHJcbiAgICAgICAgICAgIHx8IGNsYXNzTmFtZUNhbmRpZGF0ZXMuZmluZCgobmFtZSkgPT4gIWlzQnVpbHRpbkNvbXBvbmVudFR5cGUobmFtZSkgJiYgIWxvb2tzTGlrZVV1aWQobmFtZSkgJiYgIWxvb2tzTGlrZUNpZChuYW1lKSlcclxuICAgICAgICAgICAgfHwgYmFzZW5hbWUoU3RyaW5nKGFzc2V0LmZpbGUpLCBleHRuYW1lKFN0cmluZyhhc3NldC5maWxlKSkpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBjbGFzc05hbWUsXHJcbiAgICAgICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICAgICAgc291cmNlLFxyXG4gICAgICAgICAgICBjb21wb25lbnRVdWlkLFxyXG4gICAgICAgICAgICBjaWQsXHJcbiAgICAgICAgfTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpc0J1aWx0aW5Db21wb25lbnRUeXBlKHR5cGVOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IHZhbHVlID0gU3RyaW5nKHR5cGVOYW1lIHx8ICcnKS50cmltKCk7XHJcbiAgICBpZiAoIXZhbHVlKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoJ2NjLicpIHx8IHZhbHVlLnN0YXJ0c1dpdGgoJ3NwLicpKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnVpbHRpbnMgPSBbXHJcbiAgICAgICAgJ05vZGUnLFxyXG4gICAgICAgICdVSVRyYW5zZm9ybScsXHJcbiAgICAgICAgJ1Nwcml0ZScsXHJcbiAgICAgICAgJ0xhYmVsJyxcclxuICAgICAgICAnQnV0dG9uJyxcclxuICAgICAgICAnV2lkZ2V0JyxcclxuICAgICAgICAnQ2FudmFzJyxcclxuICAgICAgICAnQ2FtZXJhJyxcclxuICAgICAgICAnUmljaFRleHQnLFxyXG4gICAgICAgICdFZGl0Qm94JyxcclxuICAgICAgICAnU2Nyb2xsVmlldycsXHJcbiAgICAgICAgJ0xheW91dCcsXHJcbiAgICAgICAgJ01hc2snLFxyXG4gICAgICAgICdHcmFwaGljcycsXHJcbiAgICAgICAgJ1Byb2dyZXNzQmFyJyxcclxuICAgICAgICAnVG9nZ2xlJyxcclxuICAgICAgICAnU2xpZGVyJyxcclxuICAgICAgICAnQmxvY2tJbnB1dEV2ZW50cycsXHJcbiAgICBdO1xyXG5cclxuICAgIGNvbnN0IHNob3J0ID0gc2hvcnRUeXBlTmFtZSh2YWx1ZSk7XHJcbiAgICByZXR1cm4gYnVpbHRpbnMuc29tZSgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSBzaG9ydC50b0xvd2VyQ2FzZSgpIHx8IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvb2tzTGlrZUNpZCh2YWx1ZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gL1srL10vLnRlc3QodmFsdWUpIHx8ICh2YWx1ZS5sZW5ndGggPj0gMjAgJiYgL1tBLVphLXpdLy50ZXN0KHZhbHVlKSAmJiAvXFxkLy50ZXN0KHZhbHVlKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvb2tzTGlrZVV1aWQodmFsdWU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIC9eWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17MTJ9JC9pLnRlc3QodmFsdWUpXHJcbiAgICAgICAgfHwgL15bMC05YS1mXXsyMCx9JC9pLnRlc3QodmFsdWUpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBleHRyYWN0Q2xhc3NOYW1lRnJvbVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgY29uc3QgY2NjbGFzc01hdGNoID0gc291cmNlLm1hdGNoKC9AY2NjbGFzc1xcKFxccypbJ1wiXShbXidcIl0rKVsnXCJdXFxzKlxcKS8pO1xyXG4gICAgaWYgKGNjY2xhc3NNYXRjaD8uWzFdKSB7XHJcbiAgICAgICAgcmV0dXJuIGNjY2xhc3NNYXRjaFsxXTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjbGFzc01hdGNoID0gc291cmNlLm1hdGNoKC9leHBvcnRcXHMrY2xhc3NcXHMrKFtBLVphLXpfJF1bXFx3JF0qKVxccytleHRlbmRzXFxzKy8pO1xyXG4gICAgcmV0dXJuIGNsYXNzTWF0Y2g/LlsxXSB8fCBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNCaW5kTWFya2Vycyhzb3VyY2U6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKVxyXG4gICAgICAgIHx8IGhhc0Jsb2NrKHNvdXJjZSwgTEVHQUNZX0FVVE9fQklORF9TVEFSVCwgTEVHQUNZX0FVVE9fQklORF9FTkQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiB1cGRhdGVVaU1hcmtlZFNvdXJjZShleGlzdGluZzogc3RyaW5nLCBnZW5lcmF0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBpZiAoIWhhc0JpbmRNYXJrZXJzKGV4aXN0aW5nKSkge1xyXG4gICAgICAgIHJldHVybiBleGlzdGluZztcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBiaW5kQmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpO1xyXG4gICAgY29uc3QgYmluZE1hcmtlcnMgPSBnZXRFeGlzdGluZ0Jsb2NrTWFya2VycyhleGlzdGluZywgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKVxyXG4gICAgICAgIHx8IGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKGV4aXN0aW5nLCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJULCBMRUdBQ1lfQVVUT19CSU5EX0VORClcclxuICAgICAgICB8fCAoW0FVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORF0gYXMgY29uc3QpO1xyXG5cclxuICAgIGxldCB1cGRhdGVkID0gcmVwbGFjZUJsb2NrKGV4aXN0aW5nLCBiaW5kTWFya2Vyc1swXSwgYmluZE1hcmtlcnNbMV0sIGJpbmRCbG9jayk7XHJcbiAgICB1cGRhdGVkID0gdXBkYXRlZC5yZXBsYWNlKGJpbmRNYXJrZXJzWzBdLCBBVVRPX0JJTkRfU1RBUlQpLnJlcGxhY2UoYmluZE1hcmtlcnNbMV0sIEFVVE9fQklORF9FTkQpO1xyXG5cclxuICAgIGlmIChoYXNCbG9jayh1cGRhdGVkLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKSkge1xyXG4gICAgICAgIHVwZGF0ZWQgPSByZXBsYWNlQmxvY2soXHJcbiAgICAgICAgICAgIHVwZGF0ZWQsXHJcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULFxyXG4gICAgICAgICAgICBBVVRPX0JVVFRPTl9FVkVOVF9FTkQsXHJcbiAgICAgICAgICAgIHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpLFxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGhhc0Jsb2NrKHVwZGF0ZWQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKSkge1xyXG4gICAgICAgIHVwZGF0ZWQgPSByZXBsYWNlQmxvY2soXHJcbiAgICAgICAgICAgIHVwZGF0ZWQsXHJcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsXHJcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5ELFxyXG4gICAgICAgICAgICBtZXJnZUJ1dHRvbkhhbmRsZXJCbG9jayhcclxuICAgICAgICAgICAgICAgIHBpY2tCbG9jayh1cGRhdGVkLCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCksXHJcbiAgICAgICAgICAgICAgICBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCksXHJcbiAgICAgICAgICAgICksXHJcbiAgICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbWVyZ2VDY0ltcG9ydHModXBkYXRlZCwgZ2VuZXJhdGVkKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gYmluZFNlbGVjdGVkTm9kZShtb2RlOiBCaW5kTW9kZSk6IFByb21pc2U8QmluZFJlc3VsdD4ge1xyXG4gICAgY29uc3Qgc2VsZWN0ZWRVdWlkID0gRWRpdG9yLlNlbGVjdGlvbi5nZXRMYXN0U2VsZWN0ZWQoJ25vZGUnKSB8fCBFZGl0b3IuU2VsZWN0aW9uLmdldFNlbGVjdGVkKCdub2RlJylbMF07XHJcbiAgICBpZiAoIXNlbGVjdGVkVXVpZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHNlbGVjdCBhIG5vZGUgZmlyc3QuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2VsZWN0ZWRUcmVlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZS10cmVlJywgc2VsZWN0ZWRVdWlkKTtcclxuICAgIGlmICghc2VsZWN0ZWRUcmVlKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgcmVhZCB0aGUgc2VsZWN0ZWQgbm9kZS4gTWFrZSBzdXJlIGEgc2NlbmUgb3IgcHJlZmFiIGlzIG9wZW4uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xyXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgcmVhZENvbmZpZygpO1xyXG4gICAgY29uc3QgY2xhc3NOYW1lID0gYXBwbHlTY3JpcHROYW1lUHJlZml4KHRvQ2xhc3NOYW1lKG5vZGVOYW1lKSwgY29uZmlnLnNjcmlwdE5hbWVQcmVmaXgpO1xyXG4gICAgY29uc3Qgb3BlbmVkQXNzZXRVcmwgPSBhd2FpdCBxdWVyeU9wZW5lZEFzc2V0VXJsKHNlbGVjdGVkVHJlZSk7XHJcbiAgICBpZiAoIW9wZW5lZEFzc2V0VXJsKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgbG9jYXRlIHRoZSBvcGVuZWQgcHJlZmFiIG9yIHNjZW5lIGFzc2V0LiBQbGVhc2Ugc2F2ZSB0aGUgcHJlZmFiL3NjZW5lIGFuZCBydW4gYmluZCBhZ2Fpbi4nKTtcclxuICAgIH1cclxuICAgIGNvbnN0IHNjcmlwdEJhc2VEaXIgPSBnZXRTY3JpcHRCYXNlRGlyKG9wZW5lZEFzc2V0VXJsKTtcclxuICAgIGNvbnN0IHNjcmlwdFVybCA9IG1ha2VTY3JpcHRVcmwob3BlbmVkQXNzZXRVcmwsIGNsYXNzTmFtZSwgY29uZmlnLnNjcmlwdFJvb3QpO1xyXG4gICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIE9wZW5lZCBhc3NldDogJHtvcGVuZWRBc3NldFVybH1gKTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBTY3JpcHQgYmFzZTogJHtzY3JpcHRCYXNlRGlyfSwgc2NyaXB0Um9vdDogJHtjb25maWcuc2NyaXB0Um9vdH0sIHNjcmlwdDogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICBjb25zdCBzY2FuID0gc2NhbkJpbmRpbmdzKHNlbGVjdGVkVHJlZSwgY29uZmlnKTtcclxuICAgIGNvbnN0IGJ1dHRvbnMgPSBzY2FuLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5nZW5lcmF0ZUNsaWNrRXZlbnQpO1xyXG4gICAgbGV0IGNyZWF0ZWQgPSBmYWxzZTtcclxuICAgIGxldCBjb21wb25lbnRBdHRhY2hlZCA9IGZhbHNlO1xyXG4gICAgbGV0IHByb3BlcnRpZXNCb3VuZCA9IDA7XHJcblxyXG4gICAgaWYgKG1vZGUgIT09ICdiaW5kJykge1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlbmRlclNjcmlwdChjbGFzc05hbWUsIHNjYW4sIGJ1dHRvbnMpO1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcmVhZEFzc2V0VGV4dChzY3JpcHRVcmwpO1xyXG4gICAgICAgIGNvbnN0IGNhblVwZGF0ZUV4aXN0aW5nID0gZXhpc3RpbmcgPyBoYXNBbGxBdXRvQmxvY2tzKGV4aXN0aW5nKSA6IHRydWU7XHJcbiAgICAgICAgY29uc3QgZmluYWxTb3VyY2UgPSBleGlzdGluZyA/IHVwZGF0ZU1hcmtlZFNvdXJjZShleGlzdGluZywgc291cmNlKSA6IHNvdXJjZTtcclxuXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nICYmICFjYW5VcGRhdGVFeGlzdGluZykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjcmlwdCBleGlzdHMgYnV0IGF1dG8tZ2VuZXJhdGVkIG1hcmtlcnMgYXJlIG1pc3NpbmcuIFN0b3AgdG8gYXZvaWQgb3ZlcndyaXRpbmcgdXNlciBjb2RlOiAke3NjcmlwdFVybH1gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNyZWF0ZWQgPSAhZXhpc3Rpbmc7XHJcbiAgICAgICAgYXdhaXQgd3JpdGVBc3NldChzY3JpcHRVcmwsIGZpbmFsU291cmNlLCBjcmVhdGVkKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgc2NyaXB0VXJsKTtcclxuICAgIH0gZWxzZSBpZiAoIWF3YWl0IHJlYWRBc3NldFRleHQoc2NyaXB0VXJsKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU2NyaXB0IGRvZXMgbm90IGV4aXN0LiBHZW5lcmF0ZSBpdCBmaXJzdDogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1vZGUgIT09ICdnZW5lcmF0ZScpIHtcclxuICAgICAgICBhd2FpdCBlbnN1cmVCdXR0b25Db21wb25lbnRzKGJ1dHRvbnMsIGNvbmZpZyk7XHJcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQgPSBhd2FpdCB0cnlBdHRhY2hDb21wb25lbnQoc2VsZWN0ZWRVdWlkLCBjbGFzc05hbWUsIHNjcmlwdFVybCk7XHJcbiAgICAgICAgcHJvcGVydGllc0JvdW5kID0gYXdhaXQgYXBwbHlCaW5kaW5ncyhcclxuICAgICAgICAgICAgc2VsZWN0ZWRVdWlkLFxyXG4gICAgICAgICAgICBjbGFzc05hbWUsXHJcbiAgICAgICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICAgICAgb3BlbmVkQXNzZXRVcmwsXHJcbiAgICAgICAgICAgIHNlbGVjdGVkVHJlZSxcclxuICAgICAgICAgICAgc2NhbixcclxuICAgICAgICAgICAgbnVsbCxcclxuICAgICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICBvcGVuZWRBc3NldFVybCxcclxuICAgICAgICBzY3JpcHRCYXNlRGlyLFxyXG4gICAgICAgIGJpbmRpbmdzOiBzY2FuLFxyXG4gICAgICAgIGJ1dHRvbnMsXHJcbiAgICAgICAgY3JlYXRlZCxcclxuICAgICAgICBjb21wb25lbnRBdHRhY2hlZCxcclxuICAgICAgICBwcm9wZXJ0aWVzQm91bmQsXHJcbiAgICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiByZWFkQ29uZmlnKCk6IFByb21pc2U8QmluZFRvb2xDb25maWc+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcHJvamVjdENvbmZpZyA9IGF3YWl0IEVkaXRvci5Qcm9maWxlLmdldFByb2plY3QoUEFDS0FHRV9OQU1FKTtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAuLi5kZWZhdWx0Q29uZmlnLFxyXG4gICAgICAgICAgICAuLi4ocHJvamVjdENvbmZpZyB8fCB7fSksXHJcbiAgICAgICAgICAgIHNjcmlwdE5hbWVQcmVmaXg6IFN0cmluZyhwcm9qZWN0Q29uZmlnPy5zY3JpcHROYW1lUHJlZml4ID8/IGRlZmF1bHRDb25maWcuc2NyaXB0TmFtZVByZWZpeCksXHJcbiAgICAgICAgICAgIHJ1bGVzOiBub3JtYWxpemVSdWxlcyhwcm9qZWN0Q29uZmlnPy5ydWxlcyksXHJcbiAgICAgICAgfTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVSdWxlcyhydWxlczogdW5rbm93bik6IEJpbmRSdWxlW10ge1xyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJ1bGVzKSkge1xyXG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnLnJ1bGVzO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBydWxlc1xyXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUgJiYgdHlwZW9mIHJ1bGUgPT09ICdvYmplY3QnKVxyXG4gICAgICAgIC5tYXAoKHJ1bGU6IGFueSkgPT4gbm9ybWFsaXplUnVsZShydWxlKSlcclxuICAgICAgICAuZmlsdGVyKChydWxlKTogcnVsZSBpcyBCaW5kUnVsZSA9PiBCb29sZWFuKHJ1bGUpKTtcclxuXHJcbiAgICByZXR1cm4gbm9ybWFsaXplZC5sZW5ndGggPiAwID8gbm9ybWFsaXplZCA6IGRlZmF1bHRDb25maWcucnVsZXM7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZVJ1bGUocnVsZTogYW55KTogQmluZFJ1bGUgfCBudWxsIHtcclxuICAgIGNvbnN0IHByZWZpeCA9IFN0cmluZyhydWxlLnByZWZpeCB8fCAnJykudHJpbSgpO1xyXG4gICAgaWYgKCFwcmVmaXgpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb21wb25lbnROYW1lID0gU3RyaW5nKHJ1bGUuY29tcG9uZW50TmFtZSB8fCBydWxlLnByb3BlcnR5VHlwZSB8fCAnTm9kZScpLnRyaW0oKTtcclxuICAgIGNvbnN0IHByb3BlcnR5VHlwZSA9IG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZSk7XHJcbiAgICBjb25zdCBiaW5kVGFyZ2V0OiBCaW5kVGFyZ2V0ID0gcHJvcGVydHlUeXBlID09PSAnTm9kZScgPyAnbm9kZScgOiAnY29tcG9uZW50JztcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIHByZWZpeCxcclxuICAgICAgICBjb21wb25lbnROYW1lOiBwcm9wZXJ0eVR5cGUsXHJcbiAgICAgICAgcHJvcGVydHlUeXBlLFxyXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHByb3BlcnR5VHlwZSxcclxuICAgICAgICBiaW5kVGFyZ2V0LFxyXG4gICAgICAgIGNvbXBvbmVudFR5cGU6IGJpbmRUYXJnZXQgPT09ICdjb21wb25lbnQnID8gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZSkgOiAnJyxcclxuICAgICAgICBzdG9wQ2hpbGRyZW46IEJvb2xlYW4ocnVsZS5zdG9wQ2hpbGRyZW4pIHx8IHByZWZpeCA9PT0gJ25vZGVfc3RvcCcsXHJcbiAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBpc0J1dHRvblR5cGUocHJvcGVydHlUeXBlKSxcclxuICAgICAgICBlbmFibGVkOiBydWxlLmVuYWJsZWQgIT09IGZhbHNlLFxyXG4gICAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplQ29tcG9uZW50TmFtZShjb21wb25lbnROYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgdmFsdWUgPSBjb21wb25lbnROYW1lLnRyaW0oKTtcclxuICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSkge1xyXG4gICAgICAgIHJldHVybiBzaG9ydFR5cGVOYW1lKHZhbHVlKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdmFsdWUgfHwgJ05vZGUnO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0b0NvbXBvbmVudFR5cGUocHJvcGVydHlUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgaWYgKGlzQnVpbHRpbkNjQ29tcG9uZW50KHByb3BlcnR5VHlwZSkpIHtcclxuICAgICAgICByZXR1cm4gYGNjLiR7cHJvcGVydHlUeXBlfWA7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNCdWlsdGluQ2NDb21wb25lbnQocHJvcGVydHlUeXBlOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBbXHJcbiAgICAgICAgJ0J1dHRvbicsXHJcbiAgICAgICAgJ0VkaXRCb3gnLFxyXG4gICAgICAgICdMYWJlbCcsXHJcbiAgICAgICAgJ0xheW91dCcsXHJcbiAgICAgICAgJ01hc2snLFxyXG4gICAgICAgICdQYWdlVmlldycsXHJcbiAgICAgICAgJ1Byb2dyZXNzQmFyJyxcclxuICAgICAgICAnUmljaFRleHQnLFxyXG4gICAgICAgICdTY3JvbGxWaWV3JyxcclxuICAgICAgICAnU2xpZGVyJyxcclxuICAgICAgICAnU3ByaXRlJyxcclxuICAgICAgICAnVG9nZ2xlJyxcclxuICAgICAgICAnV2lkZ2V0JyxcclxuICAgIF0uaW5jbHVkZXMocHJvcGVydHlUeXBlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNCdXR0b25UeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gcHJvcGVydHlUeXBlID09PSAnQnV0dG9uJyB8fCBwcm9wZXJ0eVR5cGUgPT09ICdjYy5CdXR0b24nO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeU9wZW5lZEFzc2V0VXJsKHNlbGVjdGVkVHJlZTogYW55KTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICBjb25zdCBmcm9tU2F2ZSA9IGF3YWl0IHF1ZXJ5VXJsRnJvbVNhdmVTY2VuZSgpO1xyXG4gICAgaWYgKGZyb21TYXZlKSB7XHJcbiAgICAgICAgcmV0dXJuIGZyb21TYXZlO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGZyb21QcmVmYWJEdW1wID0gYXdhaXQgcXVlcnlVcmxGcm9tUHJlZmFiRHVtcChzZWxlY3RlZFRyZWUpO1xyXG4gICAgaWYgKGZyb21QcmVmYWJEdW1wKSB7XHJcbiAgICAgICAgcmV0dXJuIGZyb21QcmVmYWJEdW1wO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGZyb21TZWxlY3RlZEFzc2V0ID0gYXdhaXQgcXVlcnlVcmxGcm9tU2VsZWN0ZWRBc3NldCgpO1xyXG4gICAgaWYgKGZyb21TZWxlY3RlZEFzc2V0KSB7XHJcbiAgICAgICAgcmV0dXJuIGZyb21TZWxlY3RlZEFzc2V0O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlV2l0aFJldHJ5KHNlbGVjdGVkVHJlZSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5VXJsRnJvbVNhdmVTY2VuZSgpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgc2F2ZWRJZCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NhdmUtc2NlbmUnKTtcclxuICAgICAgICBpZiAoIXNhdmVkSWQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gcmVzb2x2ZUFzc2V0VXJsKFN0cmluZyhzYXZlZElkKSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlVcmxGcm9tUHJlZmFiRHVtcChzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByb290VHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScpO1xyXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbcm9vdFRyZWUsIHNlbGVjdGVkVHJlZV07XHJcbiAgICAgICAgZm9yIChjb25zdCB0cmVlIG9mIGNhbmRpZGF0ZXMpIHtcclxuICAgICAgICAgICAgY29uc3QgYXNzZXRVdWlkID0gZXh0cmFjdFByZWZhYkFzc2V0VXVpZCh0cmVlKTtcclxuICAgICAgICAgICAgaWYgKCFhc3NldFV1aWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCB1cmwgPSBhd2FpdCByZXNvbHZlQXNzZXRVcmwoYXNzZXRVdWlkKTtcclxuICAgICAgICAgICAgaWYgKHVybCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHVybDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIC8vIGlnbm9yZSBhbmQgZmFsbCB0aHJvdWdoXHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5VXJsRnJvbVNlbGVjdGVkQXNzZXQoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHNlbGVjdGVkQXNzZXQgPSBFZGl0b3IuU2VsZWN0aW9uLmdldExhc3RTZWxlY3RlZCgnYXNzZXQnKSB8fCBFZGl0b3IuU2VsZWN0aW9uLmdldFNlbGVjdGVkKCdhc3NldCcpWzBdO1xyXG4gICAgICAgIGlmICghc2VsZWN0ZWRBc3NldCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHVybCA9IGF3YWl0IHJlc29sdmVBc3NldFVybChTdHJpbmcoc2VsZWN0ZWRBc3NldCkpO1xyXG4gICAgICAgIGlmICh1cmwgJiYgL1xcLihwcmVmYWJ8c2NlbmUpJC9pLnRlc3QodXJsKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdXJsO1xyXG4gICAgICAgIH1cclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIC8vIGlnbm9yZSBhbmQgZmFsbCB0aHJvdWdoXHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVBc3NldFVybChpZE9yVXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgaWRPclVybCk7XHJcbiAgICAgICAgaWYgKGFzc2V0Py51cmwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFN0cmluZyhhc3NldC51cmwpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoYXNzZXQ/LnNvdXJjZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nKGFzc2V0LnNvdXJjZSk7XHJcbiAgICAgICAgfVxyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgICAgLy8gY29udGludWVcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHVybCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LXVybCcsIGlkT3JVcmwpO1xyXG4gICAgICAgIHJldHVybiB1cmwgPyBTdHJpbmcodXJsKSA6IG51bGw7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZXh0cmFjdFByZWZhYkFzc2V0VXVpZCh0cmVlOiBhbnkpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgIGlmICghdHJlZSB8fCB0eXBlb2YgdHJlZSAhPT0gJ29iamVjdCcpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkdW1wcyA9IFtcclxuICAgICAgICB0cmVlLl9fcHJlZmFiX18sXHJcbiAgICAgICAgdHJlZS5fcHJlZmFiLFxyXG4gICAgICAgIHRyZWUuX3ByZWZhYkluc3RhbmNlLFxyXG4gICAgICAgIHJlYWREdW1wVmFsdWUodHJlZS5fX3ByZWZhYl9fKSxcclxuICAgICAgICByZWFkRHVtcFZhbHVlKHRyZWUuX3ByZWZhYiksXHJcbiAgICBdO1xyXG5cclxuICAgIGZvciAoY29uc3QgZHVtcCBvZiBkdW1wcykge1xyXG4gICAgICAgIGlmICghZHVtcCB8fCB0eXBlb2YgZHVtcCAhPT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB1dWlkID0gZHVtcC5hc3NldFV1aWRcclxuICAgICAgICAgICAgfHwgZHVtcC51dWlkXHJcbiAgICAgICAgICAgIHx8IGR1bXAuYXNzZXRcclxuICAgICAgICAgICAgfHwgcmVhZER1bXBWYWx1ZShkdW1wLmFzc2V0VXVpZClcclxuICAgICAgICAgICAgfHwgcmVhZER1bXBWYWx1ZShkdW1wLnV1aWQpXHJcbiAgICAgICAgICAgIHx8IHJlYWREdW1wVmFsdWUoZHVtcC5hc3NldCk7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB1dWlkID09PSAnc3RyaW5nJyAmJiB1dWlkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1dWlkO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHV1aWQgJiYgdHlwZW9mIHV1aWQgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5lc3RlZCA9IHJlYWREdW1wVmFsdWUodXVpZC51dWlkKSB8fCB1dWlkLnV1aWQgfHwgdXVpZC5fX3V1aWRfXztcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBuZXN0ZWQgPT09ICdzdHJpbmcnICYmIG5lc3RlZCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIG5lc3RlZDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZmluZEFzc2V0VXJsQnlOb2RlVHJlZVdpdGhSZXRyeShzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IDU7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICBjb25zdCB1cmwgPSBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XHJcbiAgICAgICAgaWYgKHVybCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdXJsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhd2FpdCBkZWxheSgxMjApO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZTogYW55KTogc3RyaW5nIHwgbnVsbCB7XHJcbiAgICBjb25zdCBhc3NldHNEaXIgPSBqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsICdhc3NldHMnKTtcclxuICAgIGlmICghZXhpc3RzU3luYyhhc3NldHNEaXIpKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgcm9vdE5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xyXG4gICAgY29uc3QgdHJlZU5vZGVOYW1lcyA9IGNvbGxlY3ROb2RlTmFtZXMoc2VsZWN0ZWRUcmVlKTtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBsaXN0QXNzZXRGaWxlcyhhc3NldHNEaXIsIFsnLnByZWZhYicsICcuc2NlbmUnXSk7XHJcbiAgICBsZXQgYmVzdFVybDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XHJcbiAgICBsZXQgYmVzdFNjb3JlID0gTnVtYmVyLk5FR0FUSVZFX0lORklOSVRZO1xyXG5cclxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBjYW5kaWRhdGVzKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlYWRKc29uRmlsZVN5bmMoZmlsZSk7XHJcbiAgICAgICAgICAgIGlmICghQXJyYXkuaXNBcnJheShkYXRhKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHNjb3JlID0gc2NvcmVBc3NldE1hdGNoKGZpbGUsIGRhdGEsIHJvb3ROYW1lLCB0cmVlTm9kZU5hbWVzKTtcclxuICAgICAgICAgICAgaWYgKHNjb3JlIDw9IGJlc3RTY29yZSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGJlc3RTY29yZSA9IHNjb3JlO1xyXG4gICAgICAgICAgICBiZXN0VXJsID0gYGRiOi8vJHtyZWxhdGl2ZShFZGl0b3IuUHJvamVjdC5wYXRoLCBmaWxlKS5yZXBsYWNlKC9cXFxcL2csICcvJyl9YDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBpZiAoIWlzSW5jb21wbGV0ZUpzb25FcnJvcihlcnJvcikpIHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGluc3BlY3QgYXNzZXQgJHtmaWxlfS5gLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGJlc3RTY29yZSA+IDAgPyBiZXN0VXJsIDogbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sbGVjdE5vZGVOYW1lcyhub2RlOiBhbnksIHJlc3VsdDogc3RyaW5nW10gPSBbXSk6IHN0cmluZ1tdIHtcclxuICAgIHJlc3VsdC5wdXNoKGdldE5vZGVOYW1lKG5vZGUpKTtcclxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZ2V0Q2hpbGRyZW4obm9kZSkpIHtcclxuICAgICAgICBjb2xsZWN0Tm9kZU5hbWVzKGNoaWxkLCByZXN1bHQpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gc2NvcmVBc3NldE1hdGNoKGZpbGU6IHN0cmluZywgZGF0YTogYW55W10sIHJvb3ROYW1lOiBzdHJpbmcsIHRyZWVOb2RlTmFtZXM6IHN0cmluZ1tdKTogbnVtYmVyIHtcclxuICAgIGNvbnN0IG5vZGVzID0gZGF0YS5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0/Ll9fdHlwZV9fID09PSAnY2MuTm9kZScpO1xyXG4gICAgY29uc3QgaGFzUm9vdCA9IG5vZGVzLnNvbWUoKG5vZGUpID0+IG5vZGU/Ll9uYW1lID09PSByb290TmFtZSk7XHJcbiAgICBpZiAoIWhhc1Jvb3QpIHtcclxuICAgICAgICByZXR1cm4gTnVtYmVyLk5FR0FUSVZFX0lORklOSVRZO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFzc2V0TmFtZXMgPSBub2Rlcy5tYXAoKG5vZGUpID0+IFN0cmluZyhub2RlPy5fbmFtZSB8fCAnJykpLmZpbHRlcihCb29sZWFuKTtcclxuICAgIGNvbnN0IGFzc2V0TmFtZVNldCA9IG5ldyBTZXQoYXNzZXROYW1lcyk7XHJcbiAgICBjb25zdCBtYXRjaGVkQ291bnQgPSB0cmVlTm9kZU5hbWVzLmZpbHRlcigobmFtZSkgPT4gYXNzZXROYW1lU2V0LmhhcyhuYW1lKSkubGVuZ3RoO1xyXG4gICAgaWYgKG1hdGNoZWRDb3VudCA8PSAwICYmIGJhc2VuYW1lKGZpbGUsIGV4dG5hbWUoZmlsZSkpICE9PSByb290TmFtZSkge1xyXG4gICAgICAgIHJldHVybiBOdW1iZXIuTkVHQVRJVkVfSU5GSU5JVFk7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHNjb3JlID0gbWF0Y2hlZENvdW50ICogMTA7XHJcbiAgICBzY29yZSAtPSBNYXRoLmFicyhhc3NldE5hbWVzLmxlbmd0aCAtIHRyZWVOb2RlTmFtZXMubGVuZ3RoKSAqIDM7XHJcbiAgICBpZiAoYmFzZW5hbWUoZmlsZSwgZXh0bmFtZShmaWxlKSkgPT09IHJvb3ROYW1lKSB7XHJcbiAgICAgICAgc2NvcmUgKz0gNTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBQcmVmZXIgdW5pcXVlIHN0cnVjdHVyYWwgbWF0Y2hlcyB3aGVuIGR1cGxpY2F0ZSBwcmVmYWJzIGV4aXN0IHVuZGVyIGRpZmZlcmVudCBmb2xkZXJzLlxyXG4gICAgc2NvcmUgKz0gTWF0aC5taW4obWF0Y2hlZENvdW50LCBhc3NldE5hbWVzLmxlbmd0aCk7XHJcblxyXG4gICAgcmV0dXJuIHNjb3JlO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkSnNvbkZpbGVTeW5jKGZpbGU6IHN0cmluZyk6IGFueSB8IG51bGwge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGlmIChpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZEpzb25GaWxlV2l0aFJldHJ5KGZpbGU6IHN0cmluZywgYXR0ZW1wdHMgPSA1KTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYXR0ZW1wdHM7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpIHx8IGluZGV4ID09PSBhdHRlbXB0cyAtIDEpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGF3YWl0IGRlbGF5KDEyMCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3I6IHVua25vd24pOiBib29sZWFuIHtcclxuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIFN5bnRheEVycm9yICYmIC9VbmV4cGVjdGVkIGVuZCBvZiBKU09OIGlucHV0Ly50ZXN0KGVycm9yLm1lc3NhZ2UpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBsaXN0QXNzZXRGaWxlcyhkaXI6IHN0cmluZywgZXh0ZW5zaW9uczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWFkZGlyU3luYyhkaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KSkge1xyXG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xyXG4gICAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLmxpc3RBc3NldEZpbGVzKGZ1bGxQYXRoLCBleHRlbnNpb25zKSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChleHRlbnNpb25zLmluY2x1ZGVzKGV4dG5hbWUoZW50cnkubmFtZSkudG9Mb3dlckNhc2UoKSkpIHtcclxuICAgICAgICAgICAgcmVzdWx0LnB1c2goZnVsbFBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlU2NyaXB0VXJsKG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0Um9vdDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHJlbGF0aXZlUm9vdCA9IG5vcm1hbGl6ZVJlbGF0aXZlU2NyaXB0Um9vdChzY3JpcHRSb290KTtcclxuICAgIGNvbnN0IGJhc2VEaXIgPSBnZXRTY3JpcHRCYXNlRGlyKG9wZW5lZEFzc2V0VXJsKTtcclxuICAgIGNvbnN0IHJlc29sdmVkRGlyID0gcmVzb2x2ZVJlbGF0aXZlQXNzZXRQYXRoKGJhc2VEaXIsIHJlbGF0aXZlUm9vdCk7XHJcbiAgICByZXR1cm4gYGRiOi8vJHtyZXNvbHZlZERpcn0vJHtjbGFzc05hbWV9LnRzYDtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0U2NyaXB0QmFzZURpcihvcGVuZWRBc3NldFVybDogc3RyaW5nIHwgbnVsbCk6IHN0cmluZyB7XHJcbiAgICBpZiAob3BlbmVkQXNzZXRVcmwpIHtcclxuICAgICAgICBjb25zdCBidW5kbGVSb290ID0gZmluZEJ1bmRsZVJvb3Qob3BlbmVkQXNzZXRVcmwpO1xyXG4gICAgICAgIGlmIChidW5kbGVSb290KSB7XHJcbiAgICAgICAgICAgIHJldHVybiBidW5kbGVSb290O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBQcmVmYWIvc2NlbmUgaXMgbm90IGluc2lkZSBhbiBBc3NldCBCdW5kbGU6IHJlc29sdmUgcmVsYXRpdmUgdG8gcHJvamVjdCBhc3NldHMgcm9vdC5cclxuICAgIHJldHVybiAnYXNzZXRzJztcclxufVxyXG5cclxuZnVuY3Rpb24gZmluZEJ1bmRsZVJvb3Qob3BlbmVkQXNzZXRVcmw6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgbGV0IGN1cnJlbnQgPSBnZXRPcGVuZWRBc3NldERpcmVjdG9yeShvcGVuZWRBc3NldFVybCk7XHJcblxyXG4gICAgd2hpbGUgKGN1cnJlbnQpIHtcclxuICAgICAgICBpZiAoaXNCdW5kbGVEaXJlY3RvcnkoY3VycmVudCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGN1cnJlbnQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoY3VycmVudCA9PT0gJ2Fzc2V0cycgfHwgIWN1cnJlbnQuaW5jbHVkZXMoJy8nKSkge1xyXG4gICAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGN1cnJlbnQgPSBjdXJyZW50LnNsaWNlKDAsIGN1cnJlbnQubGFzdEluZGV4T2YoJy8nKSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQnVuZGxlRGlyZWN0b3J5KGFzc2V0UmVsYXRpdmVEaXI6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3QgbWV0YVBhdGggPSBqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsIGAke2Fzc2V0UmVsYXRpdmVEaXJ9Lm1ldGFgKTtcclxuICAgIGlmICghZXhpc3RzU3luYyhtZXRhUGF0aCkpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBtZXRhID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMobWV0YVBhdGgsICd1dGY4JykpO1xyXG4gICAgICAgIHJldHVybiBtZXRhPy51c2VyRGF0YT8uaXNCdW5kbGUgPT09IHRydWU7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE9wZW5lZEFzc2V0RGlyZWN0b3J5KG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgYXNzZXRQYXRoID0gb3BlbmVkQXNzZXRVcmxcclxuICAgICAgICAucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXFxcL2csICcvJylcclxuICAgICAgICAucmVwbGFjZSgvXFwvKyQvLCAnJyk7XHJcblxyXG4gICAgY29uc3QgbGFzdFNsYXNoID0gYXNzZXRQYXRoLmxhc3RJbmRleE9mKCcvJyk7XHJcbiAgICBpZiAobGFzdFNsYXNoIDwgMCkge1xyXG4gICAgICAgIHJldHVybiAnYXNzZXRzJztcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYXNzZXRQYXRoLnNsaWNlKDAsIGxhc3RTbGFzaCkgfHwgJ2Fzc2V0cyc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aXZlU2NyaXB0Um9vdChzY3JpcHRSb290OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgdmFsdWUgPSBTdHJpbmcoc2NyaXB0Um9vdCB8fCBkZWZhdWx0Q29uZmlnLnNjcmlwdFJvb3QpLnRyaW0oKS5yZXBsYWNlKC9cXFxcL2csICcvJykgfHwgJy4nO1xyXG4gICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UoL1xcLyskLywgJycpIHx8ICcuJztcclxufVxyXG5cclxuZnVuY3Rpb24gcmVzb2x2ZVJlbGF0aXZlQXNzZXRQYXRoKGJhc2VEaXI6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgYmFzZVBhcnRzID0gYmFzZURpci5yZXBsYWNlKC9cXFxcL2csICcvJykuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICBjb25zdCByZWxhdGl2ZVBhcnRzID0gcmVsYXRpdmVQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKS5zcGxpdCgnLycpLmZpbHRlcihCb29sZWFuKTtcclxuICAgIGNvbnN0IHBhcnRzID0gWy4uLmJhc2VQYXJ0c107XHJcblxyXG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIHJlbGF0aXZlUGFydHMpIHtcclxuICAgICAgICBpZiAocGFydCA9PT0gJy4nKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKHBhcnQgPT09ICcuLicpIHtcclxuICAgICAgICAgICAgaWYgKHBhcnRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIHBhcnRzLnBvcCgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcGFydHMucHVzaChwYXJ0KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNvbHZlZCA9IHBhcnRzLmpvaW4oJy8nKSB8fCAnYXNzZXRzJztcclxuICAgIHJldHVybiByZXNvbHZlZC5zdGFydHNXaXRoKCdhc3NldHMnKSA/IHJlc29sdmVkIDogYGFzc2V0cy8ke3Jlc29sdmVkfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNjYW5CaW5kaW5ncyhyb290OiBhbnksIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBTY2FubmVkQmluZGluZ1tdIHtcclxuICAgIGNvbnN0IHVzZWROYW1lcyA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcbiAgICBjb25zdCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSA9IFtdO1xyXG4gICAgY29uc3QgcnVsZXMgPSBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKTtcclxuXHJcbiAgICBjb25zdCB2aXNpdCA9IChub2RlOiBhbnkpID0+IHtcclxuICAgICAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xyXG4gICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IG5vZGVOYW1lLnRvTG93ZXJDYXNlKCk7XHJcblxyXG4gICAgICAgIGlmIChsb3dlck5hbWUuc3RhcnRzV2l0aChjb25maWcuc3RvcFByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBiaW5kaW5nID0gY3JlYXRlQmluZGluZyhub2RlLCBydWxlcywgdXNlZE5hbWVzKTtcclxuICAgICAgICBpZiAoYmluZGluZykge1xyXG4gICAgICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGJpbmRpbmc/LnN0b3BDaGlsZHJlbikge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGdldENoaWxkcmVuKG5vZGUpKSB7XHJcbiAgICAgICAgICAgIHZpc2l0KGNoaWxkKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHZpc2l0KHJvb3QpO1xyXG4gICAgcmV0dXJuIGJpbmRpbmdzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnOiBCaW5kVG9vbENvbmZpZyk6IEJpbmRSdWxlW10ge1xyXG4gICAgcmV0dXJuIGNvbmZpZy5ydWxlc1xyXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZCAmJiBydWxlLnByZWZpeClcclxuICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IHJpZ2h0LnByZWZpeC5sZW5ndGggLSBsZWZ0LnByZWZpeC5sZW5ndGgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVCaW5kaW5nKG5vZGU6IGFueSwgcnVsZXM6IEJpbmRSdWxlW10sIHVzZWROYW1lczogTWFwPHN0cmluZywgbnVtYmVyPik6IFNjYW5uZWRCaW5kaW5nIHwgbnVsbCB7XHJcbiAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xyXG4gICAgY29uc3QgbG93ZXJOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IHJ1bGUgPSBydWxlcy5maW5kKChpdGVtKSA9PiBsb3dlck5hbWUuc3RhcnRzV2l0aChpdGVtLnByZWZpeC50b0xvd2VyQ2FzZSgpKSk7XHJcblxyXG4gICAgaWYgKCFydWxlKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBub2RlVXVpZDogZ2V0VXVpZChub2RlKSxcclxuICAgICAgICBub2RlTmFtZSxcclxuICAgICAgICBwcm9wZXJ0eU5hbWU6IG1ha2VVbmlxdWVOYW1lKHRvUHJvcGVydHlOYW1lKG5vZGVOYW1lKSwgdXNlZE5hbWVzKSxcclxuICAgICAgICBwcm9wZXJ0eVR5cGU6IHJ1bGUucHJvcGVydHlUeXBlLFxyXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHJ1bGUuZGVjb3JhdG9yVHlwZSxcclxuICAgICAgICBiaW5kVGFyZ2V0OiBydWxlLmJpbmRUYXJnZXQsXHJcbiAgICAgICAgY29tcG9uZW50VHlwZTogcnVsZS5jb21wb25lbnRUeXBlLFxyXG4gICAgICAgIHN0b3BDaGlsZHJlbjogcnVsZS5zdG9wQ2hpbGRyZW4sXHJcbiAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBydWxlLmdlbmVyYXRlQ2xpY2tFdmVudCxcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE5vZGVOYW1lKG5vZGU6IGFueSk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gU3RyaW5nKHJlYWREdW1wVmFsdWUobm9kZT8ubmFtZSkgfHwgJ05vZGUnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0VXVpZChub2RlOiBhbnkpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIFN0cmluZyhyZWFkRHVtcFZhbHVlKG5vZGU/LnV1aWQpIHx8IG5vZGU/LnV1aWQgfHwgJycpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRDaGlsZHJlbihub2RlOiBhbnkpOiBhbnlbXSB7XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheShub2RlPy5jaGlsZHJlbikpIHtcclxuICAgICAgICByZXR1cm4gbm9kZS5jaGlsZHJlbjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkdW1wQ2hpbGRyZW4gPSByZWFkRHVtcFZhbHVlKG5vZGU/LmNoaWxkcmVuKTtcclxuICAgIGlmIChBcnJheS5pc0FycmF5KGR1bXBDaGlsZHJlbikpIHtcclxuICAgICAgICByZXR1cm4gZHVtcENoaWxkcmVuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChBcnJheS5pc0FycmF5KG5vZGU/LnZhbHVlPy5jaGlsZHJlbikpIHtcclxuICAgICAgICByZXR1cm4gbm9kZS52YWx1ZS5jaGlsZHJlbjtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gW107XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWREdW1wVmFsdWUodmFsdWU6IGFueSk6IGFueSB7XHJcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAndmFsdWUnIGluIHZhbHVlKSB7XHJcbiAgICAgICAgcmV0dXJuIHZhbHVlLnZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0b0NsYXNzTmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IG5hbWUgPSB0b1Byb3BlcnR5TmFtZSh2YWx1ZSk7XHJcbiAgICByZXR1cm4gdXBwZXJGaXJzdChuYW1lLnJlcGxhY2UoL15fKy8sICcnKSB8fCAnQXV0b0JpbmRDb21wb25lbnQnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gYXBwbHlTY3JpcHROYW1lUHJlZml4KGNsYXNzTmFtZTogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBzYWZlUHJlZml4ID0gU3RyaW5nKHByZWZpeCB8fCAnJylcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnJlcGxhY2UoL1teXFxwe0lEX1N0YXJ0fVxccHtJRF9Db250aW51ZX0kX1xcdTIwMENcXHUyMDBEXSsvZ3UsICcnKTtcclxuXHJcbiAgICBpZiAoIXNhZmVQcmVmaXggfHwgIWlzSWRlbnRpZmllclN0YXJ0KHNhZmVQcmVmaXhbMF0pKSB7XHJcbiAgICAgICAgcmV0dXJuIGNsYXNzTmFtZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY2xhc3NOYW1lLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChzYWZlUHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XHJcbiAgICAgICAgcmV0dXJuIGNsYXNzTmFtZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gYCR7c2FmZVByZWZpeH0ke2NsYXNzTmFtZX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0b1Byb3BlcnR5TmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWx1ZVxyXG4gICAgICAgIC50cmltKClcclxuICAgICAgICAucmVwbGFjZSgvW15cXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfSRfXFx1MjAwQ1xcdTIwMERdKy9ndSwgJ18nKVxyXG4gICAgICAgIC5yZXBsYWNlKC9fKy9nLCAnXycpXHJcbiAgICAgICAgLnJlcGxhY2UoL15fK3xfKyQvZywgJycpO1xyXG5cclxuICAgIGNvbnN0IGNsZWFuZWQgPSBub3JtYWxpemVkXHJcbiAgICAgICAgLnNwbGl0KCcnKVxyXG4gICAgICAgIC5maWx0ZXIoKGNoYXIsIGluZGV4KSA9PiBpbmRleCA9PT0gMCA/IGlzSWRlbnRpZmllclN0YXJ0KGNoYXIpIDogaXNJZGVudGlmaWVyQ29udGludWUoY2hhcikpXHJcbiAgICAgICAgLmpvaW4oJycpO1xyXG5cclxuICAgIGlmICghY2xlYW5lZCkge1xyXG4gICAgICAgIHJldHVybiAnbm9kZSc7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGlzSWRlbnRpZmllclN0YXJ0KGNsZWFuZWRbMF0pID8gY2xlYW5lZCA6IGBfJHtjbGVhbmVkfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzSWRlbnRpZmllclN0YXJ0KGNoYXI6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIC9bJF9cXHB7SURfU3RhcnR9XS91LnRlc3QoY2hhcik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzSWRlbnRpZmllckNvbnRpbnVlKGNoYXI6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIC9bJF9cXHUyMDBDXFx1MjAwRFxccHtJRF9Db250aW51ZX1dL3UudGVzdChjaGFyKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbWFrZVVuaXF1ZU5hbWUoYmFzZU5hbWU6IHN0cmluZywgdXNlZE5hbWVzOiBNYXA8c3RyaW5nLCBudW1iZXI+KTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGNvdW50ID0gdXNlZE5hbWVzLmdldChiYXNlTmFtZSkgfHwgMDtcclxuICAgIHVzZWROYW1lcy5zZXQoYmFzZU5hbWUsIGNvdW50ICsgMSk7XHJcbiAgICByZXR1cm4gY291bnQgPT09IDAgPyBiYXNlTmFtZSA6IGAke2Jhc2VOYW1lfSR7Y291bnQgKyAxfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHVwcGVyRmlyc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gdmFsdWUgPyB2YWx1ZVswXS50b1VwcGVyQ2FzZSgpICsgdmFsdWUuc2xpY2UoMSkgOiB2YWx1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyU2NyaXB0KGNsYXNzTmFtZTogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSwgYnV0dG9uczogU2Nhbm5lZEJpbmRpbmdbXSk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYGltcG9ydCB7ICR7cmVuZGVyQ2NJbXBvcnRzKGJpbmRpbmdzKX0gfSBmcm9tICdjYyc7XHJcblxyXG5jb25zdCB7IGNjY2xhc3MsIHByb3BlcnR5IH0gPSBfZGVjb3JhdG9yO1xyXG5cclxuQGNjY2xhc3MoJyR7Y2xhc3NOYW1lfScpXHJcbmV4cG9ydCBjbGFzcyAke2NsYXNzTmFtZX0gZXh0ZW5kcyBDb21wb25lbnQge1xyXG5cclxuICAgICR7QVVUT19CSU5EX1NUQVJUfVxyXG4ke3JlbmRlclByb3BlcnRpZXMoYmluZGluZ3MpfVxyXG4gICAgJHtBVVRPX0JJTkRfRU5EfVxyXG5cclxuICAgIHByb3RlY3RlZCBvbkxvYWQoKTogdm9pZCB7XHJcbiAgICAgICAgdGhpcy5iaW5kQnV0dG9uRXZlbnRzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBiaW5kQnV0dG9uRXZlbnRzKCk6IHZvaWQge1xyXG4gICAgICAgICR7QVVUT19CVVRUT05fRVZFTlRfU1RBUlR9XHJcbiR7cmVuZGVyQnV0dG9uRXZlbnRzKGJ1dHRvbnMpfVxyXG4gICAgICAgICR7QVVUT19CVVRUT05fRVZFTlRfRU5EfVxyXG4gICAgfVxyXG5cclxuICAgICR7QVVUT19CVVRUT05fSEFORExFUl9TVEFSVH1cclxuJHtyZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zKX1cclxuICAgICR7QVVUT19CVVRUT05fSEFORExFUl9FTkR9XHJcbn1cclxuYDtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyQ2NJbXBvcnRzKGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGltcG9ydHMgPSBuZXcgU2V0KFsnX2RlY29yYXRvcicsICdDb21wb25lbnQnXSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgY29sbGVjdEltcG9ydEZyb21UeXBlKGltcG9ydHMsIGJpbmRpbmcucHJvcGVydHlUeXBlKTtcclxuICAgICAgICBjb2xsZWN0SW1wb3J0RnJvbVR5cGUoaW1wb3J0cywgYmluZGluZy5kZWNvcmF0b3JUeXBlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmluZGluZ3Muc29tZSgoYmluZGluZykgPT4gYmluZGluZy5nZW5lcmF0ZUNsaWNrRXZlbnQpKSB7XHJcbiAgICAgICAgaW1wb3J0cy5hZGQoJ0J1dHRvbicpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBzb3J0Q2NJbXBvcnRzKGltcG9ydHMpLmpvaW4oJywgJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNvcnRDY0ltcG9ydHMoaW1wb3J0czogSXRlcmFibGU8c3RyaW5nPik6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBbLi4ubmV3IFNldChpbXBvcnRzKV1cclxuICAgICAgICAuZmlsdGVyKChpdGVtKSA9PiBpdGVtICYmIGl0ZW0gIT09ICdjYycpXHJcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IG9yZGVyID0gWydfZGVjb3JhdG9yJywgJ0NvbXBvbmVudCcsICdOb2RlJywgJ0J1dHRvbicsICdMYWJlbCcsICdTcHJpdGUnLCAnV2lkZ2V0JywgJ3NwJ107XHJcbiAgICAgICAgICAgIGNvbnN0IGxlZnRJbmRleCA9IG9yZGVyLmluZGV4T2YobGVmdCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHJpZ2h0SW5kZXggPSBvcmRlci5pbmRleE9mKHJpZ2h0KTtcclxuICAgICAgICAgICAgaWYgKGxlZnRJbmRleCAhPT0gLTEgfHwgcmlnaHRJbmRleCAhPT0gLTEpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAobGVmdEluZGV4ID09PSAtMSA/IDk5IDogbGVmdEluZGV4KSAtIChyaWdodEluZGV4ID09PSAtMSA/IDk5IDogcmlnaHRJbmRleCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIHJldHVybiBsZWZ0LmxvY2FsZUNvbXBhcmUocmlnaHQpO1xyXG4gICAgICAgIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xsZWN0SW1wb3J0RnJvbVR5cGUoaW1wb3J0czogU2V0PHN0cmluZz4sIHR5cGVOYW1lOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGNvbnN0IHZhbHVlID0gdHlwZU5hbWUudHJpbSgpO1xyXG4gICAgY29uc3QgaW1wb3J0TmFtZSA9IHZhbHVlLnN0YXJ0c1dpdGgoJ2NjLicpID8gc2hvcnRUeXBlTmFtZSh2YWx1ZSkgOiB2YWx1ZS5zcGxpdCgnLicpWzBdO1xyXG4gICAgaWYgKC9eW0EtWmEtel8kXVtBLVphLXowLTlfJF0qJC8udGVzdChpbXBvcnROYW1lKSkge1xyXG4gICAgICAgIGltcG9ydHMuYWRkKGltcG9ydE5hbWUpO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBiaW5kaW5ncy5tYXAoKGJpbmRpbmcpID0+IGAgICAgQHByb3BlcnR5KCR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLmRlY29yYXRvclR5cGUpfSlcclxuICAgIHB1YmxpYyAke2JpbmRpbmcucHJvcGVydHlOYW1lfTogJHt0b1NjcmlwdFR5cGVOYW1lKGJpbmRpbmcucHJvcGVydHlUeXBlKX0gfCBudWxsID0gbnVsbDtgKS5qb2luKCdcXG5cXG4nKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9TY3JpcHRUeXBlTmFtZSh0eXBlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHZhbHVlID0gdHlwZU5hbWUudHJpbSgpO1xyXG4gICAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ2NjLicpID8gc2hvcnRUeXBlTmFtZSh2YWx1ZSkgOiB2YWx1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyQnV0dG9uRXZlbnRzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGJ1dHRvbnMubWFwKChidXR0b24pID0+IGAgICAgICAgIGlmICh0aGlzLiR7YnV0dG9uLnByb3BlcnR5TmFtZX0pIHtcclxuICAgICAgICAgICAgdGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9Lm5vZGUub24oQnV0dG9uLkV2ZW50VHlwZS5DTElDSywgdGhpcy4ke2dldENsaWNrSGFuZGxlck5hbWUoYnV0dG9uLnByb3BlcnR5TmFtZSl9LCB0aGlzKTtcclxuICAgICAgICB9YCkuam9pbignXFxuXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkhhbmRsZXJzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGJ1dHRvbnMubWFwKChidXR0b24pID0+IGAgICAgcHJpdmF0ZSAke2dldENsaWNrSGFuZGxlck5hbWUoYnV0dG9uLnByb3BlcnR5TmFtZSl9KCk6IHZvaWQge1xyXG5cclxuICAgIH1gKS5qb2luKCdcXG5cXG4nKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2xpY2tIYW5kbGVyTmFtZShwcm9wZXJ0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYG9uQ2xpY2ske3VwcGVyRmlyc3QocHJvcGVydHlOYW1lLnJlcGxhY2UoL15idXR0b25fPy8sICdCdXR0b25fJykpfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHVwZGF0ZU1hcmtlZFNvdXJjZShleGlzdGluZzogc3RyaW5nLCBnZW5lcmF0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBiaW5kQmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpO1xyXG4gICAgY29uc3QgZXZlbnRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpO1xyXG4gICAgY29uc3QgaGFuZGxlckJsb2NrID0gbWVyZ2VCdXR0b25IYW5kbGVyQmxvY2soXHJcbiAgICAgICAgcGlja0Jsb2NrKGV4aXN0aW5nLCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCksXHJcbiAgICAgICAgcGlja0Jsb2NrKGdlbmVyYXRlZCwgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCwgQVVUT19CVVRUT05fSEFORExFUl9FTkQpLFxyXG4gICAgKTtcclxuXHJcbiAgICBpZiAoIWhhc0FsbEF1dG9CbG9ja3MoZXhpc3RpbmcpKSB7XHJcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJpbmRNYXJrZXJzID0gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORClcclxuICAgICAgICB8fCBnZXRFeGlzdGluZ0Jsb2NrTWFya2VycyhleGlzdGluZywgTEVHQUNZX0FVVE9fQklORF9TVEFSVCwgTEVHQUNZX0FVVE9fQklORF9FTkQpXHJcbiAgICAgICAgfHwgKFtBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkRdIGFzIGNvbnN0KTtcclxuXHJcbiAgICBsZXQgdXBkYXRlZCA9IHJlcGxhY2VCbG9jayhleGlzdGluZywgYmluZE1hcmtlcnNbMF0sIGJpbmRNYXJrZXJzWzFdLCBiaW5kQmxvY2spO1xyXG4gICAgdXBkYXRlZCA9IHVwZGF0ZWQucmVwbGFjZShiaW5kTWFya2Vyc1swXSwgQVVUT19CSU5EX1NUQVJUKS5yZXBsYWNlKGJpbmRNYXJrZXJzWzFdLCBBVVRPX0JJTkRfRU5EKTtcclxuXHJcbiAgICBjb25zdCB1cGRhdGVkQmxvY2tzID0gcmVwbGFjZUJsb2NrKFxyXG4gICAgICAgIHJlcGxhY2VCbG9jayhcclxuICAgICAgICAgICAgdXBkYXRlZCxcclxuICAgICAgICAgICAgQVVUT19CVVRUT05fRVZFTlRfU1RBUlQsXHJcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX0VORCxcclxuICAgICAgICAgICAgZXZlbnRCbG9jayxcclxuICAgICAgICApLFxyXG4gICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsXHJcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9FTkQsXHJcbiAgICAgICAgaGFuZGxlckJsb2NrLFxyXG4gICAgKTtcclxuXHJcbiAgICByZXR1cm4gbWVyZ2VDY0ltcG9ydHModXBkYXRlZEJsb2NrcywgZ2VuZXJhdGVkKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQWxsQXV0b0Jsb2Nrcyhzb3VyY2U6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIChoYXNCbG9jayhzb3VyY2UsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORCkgfHwgaGFzQmxvY2soc291cmNlLCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJULCBMRUdBQ1lfQVVUT19CSU5EX0VORCkpXHJcbiAgICAgICAgJiYgaGFzQmxvY2soc291cmNlLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKVxyXG4gICAgICAgICYmIGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCwgQVVUT19CVVRUT05fSEFORExFUl9FTkQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRFeGlzdGluZ0Jsb2NrTWFya2Vycyhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiByZWFkb25seSBbc3RyaW5nLCBzdHJpbmddIHwgbnVsbCB7XHJcbiAgICByZXR1cm4gaGFzQmxvY2soc291cmNlLCBzdGFydCwgZW5kKSA/IFtzdGFydCwgZW5kXSA6IG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhhc0Jsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHNvdXJjZS5pbmNsdWRlcyhzdGFydCkgJiYgc291cmNlLmluY2x1ZGVzKGVuZCkgJiYgc291cmNlLmluZGV4T2Yoc3RhcnQpIDwgc291cmNlLmluZGV4T2YoZW5kKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcGlja0Jsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBzdGFydEluZGV4ID0gc291cmNlLmluZGV4T2Yoc3RhcnQpO1xyXG4gICAgY29uc3QgZW5kSW5kZXggPSBzb3VyY2UuaW5kZXhPZihlbmQpO1xyXG4gICAgcmV0dXJuIHNvdXJjZS5zbGljZShzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoLCBlbmRJbmRleCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlcGxhY2VCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBzdGFydEluZGV4ID0gc291cmNlLmluZGV4T2Yoc3RhcnQpO1xyXG4gICAgY29uc3QgZW5kSW5kZXggPSBzb3VyY2UuaW5kZXhPZihlbmQpO1xyXG4gICAgcmV0dXJuIGAke3NvdXJjZS5zbGljZSgwLCBzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoKX0ke2NvbnRlbnR9JHtzb3VyY2Uuc2xpY2UoZW5kSW5kZXgpfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1lcmdlQnV0dG9uSGFuZGxlckJsb2NrKGV4aXN0aW5nQmxvY2s6IHN0cmluZywgZ2VuZXJhdGVkQmxvY2s6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBleGlzdGluZ0hhbmRsZXJzID0gbmV3IE1hcChwYXJzZUJ1dHRvbkhhbmRsZXJzKGV4aXN0aW5nQmxvY2spLm1hcCgoaGFuZGxlcikgPT4gW2hhbmRsZXIubmFtZSwgaGFuZGxlci5zb3VyY2VdKSk7XHJcbiAgICBjb25zdCBnZW5lcmF0ZWRIYW5kbGVycyA9IHBhcnNlQnV0dG9uSGFuZGxlcnMoZ2VuZXJhdGVkQmxvY2spO1xyXG5cclxuICAgIGlmIChnZW5lcmF0ZWRIYW5kbGVycy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICByZXR1cm4gZ2VuZXJhdGVkQmxvY2s7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWVyZ2VkSGFuZGxlcnMgPSBnZW5lcmF0ZWRIYW5kbGVyc1xyXG4gICAgICAgIC5tYXAoKGhhbmRsZXIpID0+IG5vcm1hbGl6ZUJ1dHRvbkhhbmRsZXJTb3VyY2UoZXhpc3RpbmdIYW5kbGVycy5nZXQoaGFuZGxlci5uYW1lKSB8fCBoYW5kbGVyLnNvdXJjZSkpXHJcbiAgICAgICAgLmpvaW4oJ1xcblxcbicpO1xyXG5cclxuICAgIHJldHVybiBgXFxuJHttZXJnZWRIYW5kbGVyc31cXG4gICAgYDtcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplQnV0dG9uSGFuZGxlclNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBsaW5lcyA9IHNvdXJjZS50cmltKCkuc3BsaXQoL1xccj9cXG4vKTtcclxuICAgIHJldHVybiBsaW5lcy5tYXAoKGxpbmUsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgaWYgKGluZGV4ID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBgICAgICR7bGluZS50cmltU3RhcnQoKX1gO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbGluZS50cmltRW5kKCk7XHJcbiAgICB9KS5qb2luKCdcXG4nKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcGFyc2VCdXR0b25IYW5kbGVycyhibG9jazogc3RyaW5nKTogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHNvdXJjZTogc3RyaW5nIH0+IHtcclxuICAgIGNvbnN0IHJlc3VsdDogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHNvdXJjZTogc3RyaW5nIH0+ID0gW107XHJcbiAgICBjb25zdCBtZXRob2RQYXR0ZXJuID0gLyg/OnByaXZhdGV8cHJvdGVjdGVkfHB1YmxpYyk/XFxzKihbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopXFxzKlxcKFteKV0qXFwpXFxzKjpcXHMqdm9pZFxccypcXHsvZztcclxuICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcclxuXHJcbiAgICB3aGlsZSAoKG1hdGNoID0gbWV0aG9kUGF0dGVybi5leGVjKGJsb2NrKSkpIHtcclxuICAgICAgICBjb25zdCBuYW1lID0gbWF0Y2hbMV07XHJcbiAgICAgICAgY29uc3QgbWV0aG9kU3RhcnQgPSBtYXRjaC5pbmRleDtcclxuICAgICAgICBjb25zdCBib2R5T3BlbkluZGV4ID0gbWV0aG9kUGF0dGVybi5sYXN0SW5kZXggLSAxO1xyXG4gICAgICAgIGNvbnN0IG1ldGhvZEVuZCA9IGZpbmRNYXRjaGluZ0JyYWNlKGJsb2NrLCBib2R5T3BlbkluZGV4KTtcclxuICAgICAgICBpZiAobWV0aG9kRW5kID09PSAtMSkge1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJlc3VsdC5wdXNoKHtcclxuICAgICAgICAgICAgbmFtZSxcclxuICAgICAgICAgICAgc291cmNlOiBibG9jay5zbGljZShtZXRob2RTdGFydCwgbWV0aG9kRW5kICsgMSkudHJpbUVuZCgpLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIG1ldGhvZFBhdHRlcm4ubGFzdEluZGV4ID0gbWV0aG9kRW5kICsgMTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBmaW5kTWF0Y2hpbmdCcmFjZShzb3VyY2U6IHN0cmluZywgb3BlbkluZGV4OiBudW1iZXIpOiBudW1iZXIge1xyXG4gICAgbGV0IGRlcHRoID0gMDtcclxuICAgIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgJ2AnIHwgbnVsbCA9IG51bGw7XHJcbiAgICBsZXQgZXNjYXBlZCA9IGZhbHNlO1xyXG5cclxuICAgIGZvciAobGV0IGluZGV4ID0gb3BlbkluZGV4OyBpbmRleCA8IHNvdXJjZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICBjb25zdCBjaGFyID0gc291cmNlW2luZGV4XTtcclxuXHJcbiAgICAgICAgaWYgKHF1b3RlKSB7XHJcbiAgICAgICAgICAgIGlmIChlc2NhcGVkKSB7XHJcbiAgICAgICAgICAgICAgICBlc2NhcGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gJ1xcXFwnKSB7XHJcbiAgICAgICAgICAgICAgICBlc2NhcGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgfSBlbHNlIGlmIChjaGFyID09PSBxdW90ZSkge1xyXG4gICAgICAgICAgICAgICAgcXVvdGUgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGNoYXIgPT09ICdcIicgfHwgY2hhciA9PT0gXCInXCIgfHwgY2hhciA9PT0gJ2AnKSB7XHJcbiAgICAgICAgICAgIHF1b3RlID0gY2hhcjtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoY2hhciA9PT0gJ3snKSB7XHJcbiAgICAgICAgICAgIGRlcHRoICs9IDE7XHJcbiAgICAgICAgfSBlbHNlIGlmIChjaGFyID09PSAnfScpIHtcclxuICAgICAgICAgICAgZGVwdGggLT0gMTtcclxuICAgICAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gaW5kZXg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIC0xO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtZXJnZUNjSW1wb3J0cyhleGlzdGluZzogc3RyaW5nLCBnZW5lcmF0ZWQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBpbXBvcnRQYXR0ZXJuID0gL15pbXBvcnRcXHMrXFx7XFxzKihbXn1dKz8pXFxzKlxcfVxccytmcm9tXFxzK1snXCJdY2NbJ1wiXTtcXHMqJC9tO1xyXG4gICAgY29uc3QgZXhpc3RpbmdNYXRjaCA9IGV4aXN0aW5nLm1hdGNoKGltcG9ydFBhdHRlcm4pO1xyXG4gICAgY29uc3QgZ2VuZXJhdGVkTWF0Y2ggPSBnZW5lcmF0ZWQubWF0Y2goaW1wb3J0UGF0dGVybik7XHJcblxyXG4gICAgaWYgKCFnZW5lcmF0ZWRNYXRjaCkge1xyXG4gICAgICAgIHJldHVybiBleGlzdGluZztcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWV4aXN0aW5nTWF0Y2gpIHtcclxuICAgICAgICByZXR1cm4gYCR7Z2VuZXJhdGVkTWF0Y2hbMF19XFxuJHtleGlzdGluZ31gO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1lcmdlZCA9IHNvcnRDY0ltcG9ydHMoW1xyXG4gICAgICAgIC4uLnBhcnNlQ2NJbXBvcnROYW1lcyhleGlzdGluZ01hdGNoWzFdKSxcclxuICAgICAgICAuLi5wYXJzZUNjSW1wb3J0TmFtZXMoZ2VuZXJhdGVkTWF0Y2hbMV0pLFxyXG4gICAgICAgIC4uLmRldGVjdFVzZWRDY1N5bWJvbHMoZXhpc3RpbmcpLFxyXG4gICAgXSk7XHJcblxyXG4gICAgcmV0dXJuIGV4aXN0aW5nLnJlcGxhY2UoaW1wb3J0UGF0dGVybiwgYGltcG9ydCB7ICR7bWVyZ2VkLmpvaW4oJywgJyl9IH0gZnJvbSAnY2MnO2ApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBwYXJzZUNjSW1wb3J0TmFtZXMoaW1wb3J0czogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgcmV0dXJuIGltcG9ydHNcclxuICAgICAgICAuc3BsaXQoJywnKVxyXG4gICAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxyXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRldGVjdFVzZWRDY1N5bWJvbHMoc291cmNlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICdOb2RlJyxcclxuICAgICAgICAnQnV0dG9uJyxcclxuICAgICAgICAnTGFiZWwnLFxyXG4gICAgICAgICdTcHJpdGUnLFxyXG4gICAgICAgICdXaWRnZXQnLFxyXG4gICAgICAgICdVSVRyYW5zZm9ybScsXHJcbiAgICAgICAgJ1Byb2dyZXNzQmFyJyxcclxuICAgICAgICAnU2Nyb2xsVmlldycsXHJcbiAgICAgICAgJ1RvZ2dsZScsXHJcbiAgICAgICAgJ1NsaWRlcicsXHJcbiAgICAgICAgJ0VkaXRCb3gnLFxyXG4gICAgICAgICdSaWNoVGV4dCcsXHJcbiAgICBdO1xyXG5cclxuICAgIHJldHVybiBjYW5kaWRhdGVzLmZpbHRlcigobmFtZSkgPT4gbmV3IFJlZ0V4cChgXFxcXGIke25hbWV9XFxcXGJgKS50ZXN0KHNvdXJjZSkpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiByZWFkQXNzZXRUZXh0KHVybDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICBjb25zdCBhc3NldCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1cmwpO1xyXG4gICAgaWYgKCFhc3NldD8uZmlsZSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZWFkRmlsZVN5bmMoYXNzZXQuZmlsZSwgJ3V0ZjgnKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gd3JpdGVBc3NldCh1cmw6IHN0cmluZywgc291cmNlOiBzdHJpbmcsIGNyZWF0ZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmIChjcmVhdGVkKSB7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnY3JlYXRlLWFzc2V0JywgdXJsLCBzb3VyY2UpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdzYXZlLWFzc2V0JywgdXJsLCBzb3VyY2UpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB0cnlBdHRhY2hDb21wb25lbnQobm9kZVV1aWQ6IHN0cmluZywgY2xhc3NOYW1lOiBzdHJpbmcsIHNjcmlwdFVybDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICBpZiAoYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIGNsYXNzTmFtZSkpIHtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZWdpc3RlcmVkQ2FuZGlkYXRlcyA9IGF3YWl0IHdhaXRGb3JTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZSwgc2NyaXB0VXJsKTtcclxuICAgIGlmIChyZWdpc3RlcmVkQ2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIFNjcmlwdCBjb21wb25lbnQgJHtjbGFzc05hbWV9IHdhcyBub3QgcmVnaXN0ZXJlZCB5ZXQuIFRyeWluZyB0byBhdHRhY2ggYW55d2F5LmApO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbXBvbmVudENhbmRpZGF0ZXMgPSBbLi4ubmV3IFNldChbXHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgICAgIG5vcm1hbGl6ZUNsYXNzTmFtZShjbGFzc05hbWUpLFxyXG4gICAgICAgIC4uLnJlZ2lzdGVyZWRDYW5kaWRhdGVzLFxyXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudE5hbWUgb2YgY29tcG9uZW50Q2FuZGlkYXRlcykge1xyXG4gICAgICAgIGlmIChhd2FpdCBjcmVhdGVDb21wb25lbnRBbmRWZXJpZnkobm9kZVV1aWQsIGNvbXBvbmVudE5hbWUsIGNvbXBvbmVudENhbmRpZGF0ZXMpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIDEyMDAwO1xyXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcclxuICAgIGNvbnN0IGNhY2hlZENpZCA9IHJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpO1xyXG4gICAgbGV0IGxvZ2dlZCA9IGZhbHNlO1xyXG5cclxuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgcXVlcnlSZWdpc3RlcmVkU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWUsIHNjcmlwdEFzc2V0KTtcclxuICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbLi4ubmV3IFNldChbLi4uY2FuZGlkYXRlcywgLi4uY2FjaGVkQ2lkXSldO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKCFsb2dnZWQpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFdhaXRpbmcgZm9yIHNjcmlwdCBpbXBvcnQ6ICR7Y2xhc3NOYW1lfWApO1xyXG4gICAgICAgICAgICBsb2dnZWQgPSB0cnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgZGVsYXkoNTAwKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gY2FjaGVkQ2lkO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeUFzc2V0SW5mb1NhZmUodXJsOiBzdHJpbmcpOiBQcm9taXNlPGFueSB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1cmwpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5UmVnaXN0ZXJlZFNjcmlwdENvbXBvbmVudENhbmRpZGF0ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIHNjcmlwdEFzc2V0OiBhbnkgfCBudWxsKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBjb21wb25lbnRzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktY29tcG9uZW50cycpO1xyXG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb21wb25lbnRzKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzY3JpcHRVdWlkID0gc2NyaXB0QXNzZXQ/LnV1aWQgPyBTdHJpbmcoc2NyaXB0QXNzZXQudXVpZCkgOiAnJztcclxuICAgICAgICBjb25zdCBzY3JpcHRVcmwgPSBzY3JpcHRBc3NldD8udXJsID8gU3RyaW5nKHNjcmlwdEFzc2V0LnVybCkgOiAnJztcclxuICAgICAgICBjb25zdCBzY3JpcHRGaWxlID0gc2NyaXB0QXNzZXQ/LmZpbGUgPyBTdHJpbmcoc2NyaXB0QXNzZXQuZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpIDogJyc7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0OiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnRzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/LmNpZCxcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudD8ucGF0aCxcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudD8uYXNzZXRVdWlkLFxyXG4gICAgICAgICAgICBdLm1hcChyZWFkRHVtcFZhbHVlKS5maWx0ZXIoQm9vbGVhbikubWFwKFN0cmluZyk7XHJcblxyXG4gICAgICAgICAgICBjb25zdCBtYXRjaGVkID0gY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgY2xhc3NOYW1lKSlcclxuICAgICAgICAgICAgICAgIHx8IEJvb2xlYW4oc2NyaXB0VXVpZCAmJiBjYW5kaWRhdGVzLmluY2x1ZGVzKHNjcmlwdFV1aWQpKVxyXG4gICAgICAgICAgICAgICAgfHwgQm9vbGVhbihzY3JpcHRVcmwgJiYgY2FuZGlkYXRlcy5pbmNsdWRlcyhzY3JpcHRVcmwpKVxyXG4gICAgICAgICAgICAgICAgfHwgQm9vbGVhbihzY3JpcHRGaWxlICYmIGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUucmVwbGFjZSgvXFxcXC9nLCAnLycpID09PSBzY3JpcHRGaWxlKSk7XHJcblxyXG4gICAgICAgICAgICBpZiAobWF0Y2hlZCkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4uY2FuZGlkYXRlcyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBbLi4ubmV3IFNldChyZXN1bHQuZmlsdGVyKChjYW5kaWRhdGUpID0+IGlzQ29tcG9uZW50QXR0YWNoQ2FuZGlkYXRlKGNhbmRpZGF0ZSkpKV07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHF1ZXJ5IHJlZ2lzdGVyZWQgY29tcG9uZW50cy5gLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBpc0NvbXBvbmVudEF0dGFjaENhbmRpZGF0ZShjYW5kaWRhdGU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIC9eW0EtWmEtejAtOV8kLi86QC1dKyQvLnRlc3QoY2FuZGlkYXRlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVhZFNjcmlwdENpZEZyb21Qcm9ncmFtQ2FjaGUoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgaWYgKCFzY3JpcHRBc3NldD8uZmlsZSkge1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzb3VyY2VVcmwgPSBgZmlsZTovLy8ke1N0cmluZyhzY3JpcHRBc3NldC5maWxlKS5yZXBsYWNlKC9cXFxcL2csICcvJyl9YDtcclxuICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcclxuICAgIGNvbnN0IHRhcmdldHMgPSBbXHJcbiAgICAgICAgam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAndGVtcCcsICdwcm9ncmFtbWluZycsICdwYWNrZXItZHJpdmVyJywgJ3RhcmdldHMnLCAnZWRpdG9yJyksXHJcbiAgICAgICAgam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAndGVtcCcsICdwcm9ncmFtbWluZycsICdwYWNrZXItZHJpdmVyJywgJ3RhcmdldHMnLCAncHJldmlldycpLFxyXG4gICAgXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHRhcmdldERpciBvZiB0YXJnZXRzKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW1wb3J0TWFwUGF0aCA9IGpvaW4odGFyZ2V0RGlyLCAnaW1wb3J0LW1hcC5qc29uJyk7XHJcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhpbXBvcnRNYXBQYXRoKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGltcG9ydE1hcCA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGltcG9ydE1hcFBhdGgsICd1dGY4JykpO1xyXG4gICAgICAgICAgICBjb25zdCBjaHVua1JlbGF0aXZlID0gaW1wb3J0TWFwPy5pbXBvcnRzPy5bc291cmNlVXJsXSB8fCBpbXBvcnRNYXA/Lltzb3VyY2VVcmxdO1xyXG4gICAgICAgICAgICBpZiAoIWNodW5rUmVsYXRpdmUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBjaHVua0ZpbGUgPSBqb2luKHRhcmdldERpciwgU3RyaW5nKGNodW5rUmVsYXRpdmUpLnJlcGxhY2UoL15cXC5cXC8vLCAnJykpO1xyXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoY2h1bmtGaWxlKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGNodW5rU291cmNlID0gcmVhZEZpbGVTeW5jKGNodW5rRmlsZSwgJ3V0ZjgnKTtcclxuICAgICAgICAgICAgY29uc3QgZXNjYXBlZENsYXNzTmFtZSA9IGNsYXNzTmFtZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xyXG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGNodW5rU291cmNlLm1hdGNoKG5ldyBSZWdFeHAoYF9SRlxcXFwucHVzaFxcXFwoXFxcXHtcXFxcfSxcXFxccypbXCInXShbXlwiJ10rKVtcIiddLFxcXFxzKltcIiddJHtlc2NhcGVkQ2xhc3NOYW1lfVtcIiddYCkpO1xyXG4gICAgICAgICAgICBpZiAobWF0Y2g/LlsxXSkge1xyXG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2gobWF0Y2hbMV0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gcmVhZCBzY3JpcHQgY2lkIGZyb20gcHJvZ3JhbSBjYWNoZS5gLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBbLi4ubmV3IFNldChyZXN1bHQpXTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50QW5kVmVyaWZ5KG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWU6IHN0cmluZywgbWF0Y2hOYW1lczogc3RyaW5nW10pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnY3JlYXRlLWNvbXBvbmVudCcsIHtcclxuICAgICAgICAgICAgdXVpZDogbm9kZVV1aWQsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudDogY29tcG9uZW50TmFtZSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBhd2FpdCBkZWxheSgxMDApO1xyXG4gICAgICAgIGlmIChhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgbWF0Y2hOYW1lcykpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gY3JlYXRlLWNvbXBvbmVudCByZXR1cm5lZCBidXQgJHtjb21wb25lbnROYW1lfSB3YXMgbm90IGZvdW5kIG9uIHRoZSBub2RlLmApO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYXR0YWNoIGNvbXBvbmVudCAke2NvbXBvbmVudE5hbWV9LmAsIGVycm9yKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUNsYXNzTmFtZShjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gY2xhc3NOYW1lLnJlcGxhY2UoL1teQS1aYS16MC05XyRcXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfVxcdTIwMENcXHUyMDBEXS9ndSwgJ18nKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gYXBwbHlCaW5kaW5ncyhcclxuICAgIHNlbGVjdGVkVXVpZDogc3RyaW5nLFxyXG4gICAgY2xhc3NOYW1lOiBzdHJpbmcsXHJcbiAgICBzY3JpcHRVcmw6IHN0cmluZyxcclxuICAgIG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLFxyXG4gICAgc2VsZWN0ZWRUcmVlOiBhbnksXHJcbiAgICBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSxcclxuICAgIHRhcmdldFNjcmlwdD86IE5vZGVTY3JpcHRJbmZvIHwgbnVsbCxcclxuKTogUHJvbWlzZTxudW1iZXI+IHtcclxuICAgIGlmIChiaW5kaW5ncy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIGFwcGx5QmluZGluZ3Mgc2tpcHBlZCBiZWNhdXNlIHNjYW4gcmVzdWx0IGlzIGVtcHR5LmApO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBwcm9wZXJ0aWVzQm91bmQgPSBhd2FpdCBiaW5kQ29tcG9uZW50UHJvcGVydGllcyhzZWxlY3RlZFV1aWQsIGNsYXNzTmFtZSwgc2NyaXB0VXJsLCBiaW5kaW5ncywgdGFyZ2V0U2NyaXB0KTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBTY2VuZSBBUEkgYm91bmQgJHtwcm9wZXJ0aWVzQm91bmR9LyR7YmluZGluZ3MubGVuZ3RofSBwcm9wZXJ0aWVzLmApO1xyXG5cclxuICAgIGlmIChwcm9wZXJ0aWVzQm91bmQgPj0gYmluZGluZ3MubGVuZ3RoKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHNhdmUgc2NlbmUgYWZ0ZXIgcHJvcGVydHkgYmluZGluZy5gLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBwcm9wZXJ0aWVzQm91bmQ7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRG8gTk9UIHNhdmUtc2NlbmUgYmVmb3JlIHNlcmlhbGl6ZWQgZmFsbGJhY2s6IHRoYXQgd291bGQgcGVyc2lzdCBlbXB0eSBsaXZlIHJlZnMgYW5kIGZpZ2h0IHRoZSBmaWxlIHdyaXRlLlxyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzZXJpYWxpemVkQm91bmQgPSBhd2FpdCBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhcclxuICAgICAgICAgICAgb3BlbmVkQXNzZXRVcmwsXHJcbiAgICAgICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICAgICAgc2VsZWN0ZWRVdWlkLFxyXG4gICAgICAgICAgICBjbGFzc05hbWUsXHJcbiAgICAgICAgICAgIHNlbGVjdGVkVHJlZSxcclxuICAgICAgICAgICAgYmluZGluZ3MsXHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gU2VyaWFsaXplZCBhc3NldCBib3VuZCAke3NlcmlhbGl6ZWRCb3VuZH0vJHtiaW5kaW5ncy5sZW5ndGh9IHByb3BlcnRpZXMuYCk7XHJcbiAgICAgICAgaWYgKHNlcmlhbGl6ZWRCb3VuZCA+IHByb3BlcnRpZXNCb3VuZCkge1xyXG4gICAgICAgICAgICBwcm9wZXJ0aWVzQm91bmQgPSBzZXJpYWxpemVkQm91bmQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChvcGVuZWRBc3NldFVybCAmJiBzZXJpYWxpemVkQm91bmQgPiAwKSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlZnJlc2gtYXNzZXQnLCBvcGVuZWRBc3NldFVybCk7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzb2Z0LXJlbG9hZCcpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgICAgICAgIC8vIGlnbm9yZVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIFByZWZhYiBzdGFnZSBtYXkga2VlcCBzdGFsZSBtZW1vcnk7IHJlb3BlbiBmb3JjZXMgaW5zcGVjdG9yIHRvIGxvYWQgZGlzayBiaW5kaW5ncy5cclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ29wZW4tc2NlbmUnLCBvcGVuZWRBc3NldFVybCk7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gUmVvcGVuZWQgYXNzZXQgYWZ0ZXIgc2VyaWFsaXplZCBiaW5kOiAke29wZW5lZEFzc2V0VXJsfWApO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gcmVvcGVuIGFzc2V0IGFmdGVyIHNlcmlhbGl6ZWQgYmluZC5gLCBlcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGJpbmQgc2VyaWFsaXplZCBwcmVmYWIvc2NlbmUgcmVmZXJlbmNlcy5gLCBlcnJvcik7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHByb3BlcnRpZXNCb3VuZDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckJpbmRhYmxlQ29tcG9uZW50KFxyXG4gICAgbm9kZVV1aWQ6IHN0cmluZyxcclxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxyXG4gICAgc2NyaXB0VXJsOiBzdHJpbmcsXHJcbiAgICBwcm9wZXJ0eU5hbWVzOiBzdHJpbmdbXSxcclxuICAgIHRhcmdldFNjcmlwdD86IE5vZGVTY3JpcHRJbmZvIHwgbnVsbCxcclxuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICBjb25zdCBzY3JpcHRBc3NldCA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvU2FmZShzY3JpcHRVcmwpO1xyXG4gICAgY29uc3QgdHlwZU5hbWVzID0gWy4uLm5ldyBTZXQoW1xyXG4gICAgICAgIC4uLih0YXJnZXRTY3JpcHQ/LmNpZCA/IFt0YXJnZXRTY3JpcHQuY2lkXSA6IFtdKSxcclxuICAgICAgICAuLi4odGFyZ2V0U2NyaXB0Py5jbGFzc05hbWUgPyBbdGFyZ2V0U2NyaXB0LmNsYXNzTmFtZV0gOiBbXSksXHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgICAgIC4uLmdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQsIGNsYXNzTmFtZSksXHJcbiAgICBdLmZpbHRlcihCb29sZWFuKSldO1xyXG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgMTIwMDA7XHJcbiAgICBsZXQgbG9nZ2VkID0gZmFsc2U7XHJcblxyXG4gICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xyXG4gICAgICAgIC8vIEFsd2F5cyByZS1xdWVyeSBmcm9tIG5vZGUuIENhY2hlZCBVVUlEIGlzIGludmFsaWQgYWZ0ZXIgc2NyaXB0IHJlaW1wb3J0LlxyXG4gICAgICAgIGNvbnN0IGNvbXBvbmVudFV1aWQgPSBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgdHlwZU5hbWVzKTtcclxuICAgICAgICBpZiAoY29tcG9uZW50VXVpZCkge1xyXG4gICAgICAgICAgICBpZiAocHJvcGVydHlOYW1lcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjb21wb25lbnRVdWlkO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY29tcG9uZW50RHVtcCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudCcsIGNvbXBvbmVudFV1aWQpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcmVhZHlOYW1lcyA9IHByb3BlcnR5TmFtZXMuZmlsdGVyKChuYW1lKSA9PiBCb29sZWFuKGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wLCBuYW1lKSkpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHJlYWR5TmFtZXMubGVuZ3RoID09PSBwcm9wZXJ0eU5hbWVzLmxlbmd0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBCaW5kYWJsZSBjb21wb25lbnQgcmVhZHk6ICR7Y29tcG9uZW50VXVpZH1gKTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY29tcG9uZW50VXVpZDtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmICghbG9nZ2VkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFdhaXRpbmcgcHJvcGVydGllcyByZWFkeSAke3JlYWR5TmFtZXMubGVuZ3RofS8ke3Byb3BlcnR5TmFtZXMubGVuZ3RofSBvbiAke2NvbXBvbmVudFV1aWR9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgICAgICAgLy8ga2VlcCB3YWl0aW5nIGZvciBzY3JpcHQgcmVpbXBvcnRcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKCFsb2dnZWQpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIFdhaXRpbmcgZm9yIGJpbmRhYmxlIHByb3BlcnRpZXMgb24gJHtjbGFzc05hbWV9LCB0eXBlcz0ke3R5cGVOYW1lcy5qb2luKCcsJyl9YCk7XHJcbiAgICAgICAgICAgIGxvZ2dlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGF3YWl0IGRlbGF5KDMwMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkLCB0eXBlTmFtZXMpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBiaW5kQ29tcG9uZW50UHJvcGVydGllcyhcclxuICAgIG5vZGVVdWlkOiBzdHJpbmcsXHJcbiAgICBjbGFzc05hbWU6IHN0cmluZyxcclxuICAgIHNjcmlwdFVybDogc3RyaW5nLFxyXG4gICAgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sXHJcbiAgICB0YXJnZXRTY3JpcHQ/OiBOb2RlU2NyaXB0SW5mbyB8IG51bGwsXHJcbik6IFByb21pc2U8bnVtYmVyPiB7XHJcbiAgICBjb25zdCB0eXBlTmFtZXMgPSBbXHJcbiAgICAgICAgLi4uKHRhcmdldFNjcmlwdD8uY2lkID8gW3RhcmdldFNjcmlwdC5jaWRdIDogW10pLFxyXG4gICAgICAgIC4uLih0YXJnZXRTY3JpcHQ/LmNsYXNzTmFtZSA/IFt0YXJnZXRTY3JpcHQuY2xhc3NOYW1lXSA6IFtdKSxcclxuICAgICAgICBjbGFzc05hbWUsXHJcbiAgICBdLmZpbHRlcihCb29sZWFuKTtcclxuXHJcbiAgICBjb25zdCBjb21wb25lbnRVdWlkID0gYXdhaXQgd2FpdEZvckJpbmRhYmxlQ29tcG9uZW50KFxyXG4gICAgICAgIG5vZGVVdWlkLFxyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBzY3JpcHRVcmwsXHJcbiAgICAgICAgYmluZGluZ3MubWFwKChpdGVtKSA9PiBpdGVtLnByb3BlcnR5TmFtZSksXHJcbiAgICAgICAgdGFyZ2V0U2NyaXB0LFxyXG4gICAgKTtcclxuICAgIGlmICghY29tcG9uZW50VXVpZCkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gQ2Fubm90IGZpbmQgY29tcG9uZW50ICR7Y2xhc3NOYW1lfSBmb3IgcHJvcGVydHkgYmluZGluZy4gY2lkPSR7dGFyZ2V0U2NyaXB0Py5jaWQgfHwgJyd9YCk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29tcG9uZW50SW5kZXggPSBhd2FpdCBmaW5kQ29tcG9uZW50SW5kZXhPbk5vZGUobm9kZVV1aWQsIHR5cGVOYW1lcy5sZW5ndGggPiAwID8gdHlwZU5hbWVzIDogW2NvbXBvbmVudFV1aWRdKTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBCaW5kaW5nIHRocm91Z2ggY29tcG9uZW50VXVpZD0ke2NvbXBvbmVudFV1aWR9LCBjb21wc0luZGV4PSR7Y29tcG9uZW50SW5kZXh9YCk7XHJcbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgbGV0IHByb3BlcnR5RHVtcDogYW55IHwgbnVsbCA9IG51bGw7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50RHVtcCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudCcsIGNvbXBvbmVudFV1aWQpO1xyXG4gICAgICAgICAgICBwcm9wZXJ0eUR1bXAgPSBnZXRQcm9wZXJ0eUR1bXAoY29tcG9uZW50RHVtcCwgYmluZGluZy5wcm9wZXJ0eU5hbWUpO1xyXG4gICAgICAgICAgICBpZiAoIXByb3BlcnR5RHVtcCkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBQcm9wZXJ0eSBkdW1wIG1pc3NpbmcgZm9yICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9LiBkdW1wIGtleXM9JHtPYmplY3Qua2V5cyhjb21wb25lbnREdW1wPy52YWx1ZSB8fCBjb21wb25lbnREdW1wIHx8IHt9KS5qb2luKCcsJyl9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBxdWVyeSBjb21wb25lbnQgZHVtcCBmb3IgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX0uYCwgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKCFwcm9wZXJ0eUR1bXApIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0YXJnZXRVdWlkID0gYmluZGluZy5iaW5kVGFyZ2V0ID09PSAnbm9kZSdcclxuICAgICAgICAgICAgPyBiaW5kaW5nLm5vZGVVdWlkXHJcbiAgICAgICAgICAgIDogYXdhaXQgZmluZENvbXBvbmVudFV1aWQoYmluZGluZy5ub2RlVXVpZCwgW1xyXG4gICAgICAgICAgICAgICAgYmluZGluZy5jb21wb25lbnRUeXBlLFxyXG4gICAgICAgICAgICAgICAgYmluZGluZy5wcm9wZXJ0eVR5cGUsXHJcbiAgICAgICAgICAgICAgICBzaG9ydFR5cGVOYW1lKGJpbmRpbmcuY29tcG9uZW50VHlwZSB8fCAnJyksXHJcbiAgICAgICAgICAgICAgICBzaG9ydFR5cGVOYW1lKGJpbmRpbmcucHJvcGVydHlUeXBlIHx8ICcnKSxcclxuICAgICAgICAgICAgXS5maWx0ZXIoQm9vbGVhbikpO1xyXG5cclxuICAgICAgICBpZiAoIXRhcmdldFV1aWQpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCB0YXJnZXQgZm9yICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9IG9uIG5vZGUgJHtiaW5kaW5nLm5vZGVOYW1lfSAoJHtiaW5kaW5nLm5vZGVVdWlkfSkuYCk7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIHNldC1wcm9wZXJ0eSAke2JpbmRpbmcucHJvcGVydHlOYW1lfSAtPiAke3RhcmdldFV1aWR9ICgke2JpbmRpbmcuYmluZFRhcmdldH0vJHtiaW5kaW5nLnByb3BlcnR5VHlwZX0pYCk7XHJcbiAgICAgICAgaWYgKGF3YWl0IHNldFJlZmVyZW5jZVByb3BlcnR5KG5vZGVVdWlkLCBjb21wb25lbnRVdWlkLCBjb21wb25lbnRJbmRleCwgYmluZGluZy5wcm9wZXJ0eU5hbWUsIHByb3BlcnR5RHVtcCwgdGFyZ2V0VXVpZCkpIHtcclxuICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gc2V0LXByb3BlcnR5IGZhaWxlZCBmb3IgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX0uYCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBib3VuZENvdW50O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmaW5kQ29tcG9uZW50SW5kZXhPbk5vZGUobm9kZVV1aWQ6IHN0cmluZywgbWF0Y2hOYW1lczogc3RyaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xyXG4gICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBub2RlVXVpZCk7XHJcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcclxuXHJcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29tcG9uZW50cy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICBjb25zdCBjb21wb25lbnRBbnkgPSBjb21wb25lbnRzW2luZGV4XSBhcyBhbnk7XHJcbiAgICAgICAgY29uc3QgdXVpZCA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8udmFsdWU/LnV1aWQpIHx8IHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py51dWlkKSB8fCAnJyk7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgICAgICAgdXVpZCxcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py50eXBlLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5uYW1lLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5fX3R5cGVfXyxcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy50eXBlLFxyXG4gICAgICAgIF0ubWFwKHJlYWREdW1wVmFsdWUpLmZpbHRlcihCb29sZWFuKS5tYXAoU3RyaW5nKTtcclxuXHJcbiAgICAgICAgaWYgKGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBtYXRjaE5hbWVzLnNvbWUoKG5hbWUpID0+IGlzRXhhY3RDb21wb25lbnRJZGVudGl0eShTdHJpbmcobmFtZSksIGNhbmRpZGF0ZSkgfHwgbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBTdHJpbmcobmFtZSkpKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGluZGV4O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gLTE7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWU6IHN0cmluZyB8IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIG5vZGVVdWlkKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xyXG4gICAgY29uc3QgY29tcG9uZW50TmFtZXMgPSBBcnJheS5pc0FycmF5KGNvbXBvbmVudE5hbWUpID8gY29tcG9uZW50TmFtZSA6IFtjb21wb25lbnROYW1lXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnRzKSB7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50QW55ID0gY29tcG9uZW50IGFzIGFueTtcclxuICAgICAgICBjb25zdCB1dWlkID0gU3RyaW5nKHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py52YWx1ZT8udXVpZCkgfHwgcmVhZER1bXBWYWx1ZShjb21wb25lbnRBbnk/LnV1aWQpIHx8ICcnKTtcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnR5cGUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8ubmFtZSxcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py5jaWQsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/Ll9fdHlwZV9fLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5jaWQsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/LnR5cGUsXHJcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICBpZiAoY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IGNvbXBvbmVudE5hbWVzLnNvbWUoKG5hbWUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgbmFtZSkpKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdXVpZCB8fCBudWxsO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0UHJvcGVydHlEdW1wKGNvbXBvbmVudER1bXA6IGFueSwgcHJvcGVydHlOYW1lOiBzdHJpbmcpOiBhbnkgfCBudWxsIHtcclxuICAgIGNvbnN0IGR1bXAgPSBjb21wb25lbnREdW1wPy52YWx1ZT8uW3Byb3BlcnR5TmFtZV0gfHwgY29tcG9uZW50RHVtcD8uW3Byb3BlcnR5TmFtZV07XHJcbiAgICByZXR1cm4gZHVtcCAmJiB0eXBlb2YgZHVtcCA9PT0gJ29iamVjdCcgPyBkdW1wIDogbnVsbDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc2V0UmVmZXJlbmNlUHJvcGVydHkoXHJcbiAgICBub2RlVXVpZDogc3RyaW5nLFxyXG4gICAgY29tcG9uZW50VXVpZDogc3RyaW5nLFxyXG4gICAgY29tcG9uZW50SW5kZXg6IG51bWJlcixcclxuICAgIHByb3BlcnR5TmFtZTogc3RyaW5nLFxyXG4gICAgcHJvcGVydHlEdW1wOiBhbnksXHJcbiAgICB0YXJnZXRVdWlkOiBzdHJpbmcsXHJcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IG1ha2VSZWZlcmVuY2VEdW1wQ2FuZGlkYXRlcyhwcm9wZXJ0eUR1bXAsIHRhcmdldFV1aWQpO1xyXG4gICAgY29uc3QgYXR0ZW1wdHM6IEFycmF5PHsgdXVpZDogc3RyaW5nOyBwYXRoOiBzdHJpbmcgfT4gPSBbXTtcclxuXHJcbiAgICAvLyBQcmVmYWIgZWRpdGluZyBtb2RlIG9mdGVuIHJlamVjdHMgY29tcG9uZW50IFVVSUQgZm9yIHNldC1wcm9wZXJ0eTsgcHJlZmVyIG5vZGUgcGF0aCBmaXJzdC5cclxuICAgIGlmIChjb21wb25lbnRJbmRleCA+PSAwKSB7XHJcbiAgICAgICAgYXR0ZW1wdHMucHVzaCh7IHV1aWQ6IG5vZGVVdWlkLCBwYXRoOiBgX19jb21wc19fLiR7Y29tcG9uZW50SW5kZXh9LiR7cHJvcGVydHlOYW1lfWAgfSk7XHJcbiAgICAgICAgYXR0ZW1wdHMucHVzaCh7IHV1aWQ6IG5vZGVVdWlkLCBwYXRoOiBgY29tcG9uZW50cy4ke2NvbXBvbmVudEluZGV4fS4ke3Byb3BlcnR5TmFtZX1gIH0pO1xyXG4gICAgfVxyXG4gICAgYXR0ZW1wdHMucHVzaCh7IHV1aWQ6IGNvbXBvbmVudFV1aWQsIHBhdGg6IHByb3BlcnR5TmFtZSB9KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGF0dGVtcHQgb2YgYXR0ZW1wdHMpIHtcclxuICAgICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY2FuZGlkYXRlcy5sZW5ndGg7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICAgICAgY29uc3QgZHVtcCA9IGNhbmRpZGF0ZXNbaW5kZXhdO1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgdXVpZDogYXR0ZW1wdC51dWlkLFxyXG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IGF0dGVtcHQucGF0aCxcclxuICAgICAgICAgICAgICAgICAgICBkdW1wLFxyXG4gICAgICAgICAgICAgICAgICAgIHJlY29yZDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgaWYgKG9rKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFske1BBQ0tBR0VfTkFNRX1dIHNldC1wcm9wZXJ0eSBvayB2aWEgdXVpZD0ke2F0dGVtcHQudXVpZH0sIHBhdGg9JHthdHRlbXB0LnBhdGh9LCBjYW5kaWRhdGU9JHtpbmRleCArIDF9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAvLyB0cnkgbmV4dCBjYW5kaWRhdGUgc2hhcGVcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIHNldC1wcm9wZXJ0eSBmYWlsZWQgZm9yICR7cHJvcGVydHlOYW1lfSB2aWEgdXVpZD0ke2F0dGVtcHQudXVpZH0sIHBhdGg9JHthdHRlbXB0LnBhdGh9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IGFueVtdIHtcclxuICAgIGNvbnN0IGJhc2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHByb3BlcnR5RHVtcCkpO1xyXG4gICAgY29uc3QgdHlwZSA9IGJhc2UudHlwZSB8fCBiYXNlLmN0eXBlIHx8IHVuZGVmaW5lZDtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IGFueVtdID0gW107XHJcblxyXG4gICAgY29uc3QgdmFsdWVTaGFwZXMgPSBbXHJcbiAgICAgICAgeyB1dWlkOiB0YXJnZXRVdWlkIH0sXHJcbiAgICAgICAgdGFyZ2V0VXVpZCxcclxuICAgICAgICB7IF9fdXVpZF9fOiB0YXJnZXRVdWlkIH0sXHJcbiAgICAgICAgeyB2YWx1ZTogeyB1dWlkOiB0YXJnZXRVdWlkIH0gfSxcclxuICAgICAgICB7IHV1aWQ6IHRhcmdldFV1aWQsIHR5cGUgfSxcclxuICAgIF07XHJcblxyXG4gICAgaWYgKGJhc2UudmFsdWUgJiYgdHlwZW9mIGJhc2UudmFsdWUgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgdmFsdWVTaGFwZXMudW5zaGlmdCh7XHJcbiAgICAgICAgICAgIC4uLmJhc2UudmFsdWUsXHJcbiAgICAgICAgICAgIHV1aWQ6IHRhcmdldFV1aWQsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZVNoYXBlcykge1xyXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7XHJcbiAgICAgICAgICAgIC4uLmJhc2UsXHJcbiAgICAgICAgICAgIHZhbHVlLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBpZiAodHlwZSkge1xyXG4gICAgICAgICAgICBjYW5kaWRhdGVzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgLi4uYmFzZSxcclxuICAgICAgICAgICAgICAgIHR5cGUsXHJcbiAgICAgICAgICAgICAgICB2YWx1ZSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhcclxuICAgIG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLFxyXG4gICAgc2NyaXB0VXJsOiBzdHJpbmcsXHJcbiAgICBzZWxlY3RlZFV1aWQ6IHN0cmluZyxcclxuICAgIGNsYXNzTmFtZTogc3RyaW5nLFxyXG4gICAgc2VsZWN0ZWRUcmVlOiBhbnksXHJcbiAgICBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSxcclxuKTogUHJvbWlzZTxudW1iZXI+IHtcclxuICAgIGlmICghb3BlbmVkQXNzZXRVcmwpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBhc3NldCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCBvcGVuZWRBc3NldFVybCk7XHJcbiAgICBpZiAoIWFzc2V0Py5maWxlIHx8ICEvXFwuKHByZWZhYnxzY2VuZSkkL2kudGVzdChhc3NldC5maWxlKSkge1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkSnNvbkZpbGVXaXRoUmV0cnkoYXNzZXQuZmlsZSk7XHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByb290TmFtZSA9IGdldE5vZGVOYW1lKHNlbGVjdGVkVHJlZSk7XHJcbiAgICBjb25zdCBzZWxlY3RlZENoaWxkTmFtZXMgPSBuZXcgU2V0KGNvbGxlY3ROb2RlTmFtZXMoc2VsZWN0ZWRUcmVlKS5zbGljZSgxKSk7XHJcbiAgICBjb25zdCBub2RlSWRCeVV1aWQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xyXG4gICAgY29uc3Qgbm9kZUlkc0J5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXJbXT4oKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudElkc0J5Tm9kZUlkQW5kVHlwZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcblxyXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGlmIChpdGVtPy5fX3R5cGVfXyA9PT0gJ2NjLk5vZGUnKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vZGVVdWlkID0gaXRlbT8uX2lkIHx8IGl0ZW0/Ll91dWlkIHx8ICcnO1xyXG4gICAgICAgICAgICBpZiAobm9kZVV1aWQpIHtcclxuICAgICAgICAgICAgICAgIG5vZGVJZEJ5VXVpZC5zZXQobm9kZVV1aWQsIGluZGV4KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGl0ZW0/Ll9uYW1lID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGlzdCA9IG5vZGVJZHNCeU5hbWUuZ2V0KGl0ZW0uX25hbWUpIHx8IFtdO1xyXG4gICAgICAgICAgICAgICAgbGlzdC5wdXNoKGluZGV4KTtcclxuICAgICAgICAgICAgICAgIG5vZGVJZHNCeU5hbWUuc2V0KGl0ZW0uX25hbWUsIGxpc3QpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGl0ZW0/Lm5vZGU/Ll9faWRfXztcclxuICAgICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIobm9kZUlkKSB8fCB0eXBlb2YgaXRlbT8uX190eXBlX18gIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbXBvbmVudElkc0J5Tm9kZUlkQW5kVHlwZS5zZXQoYCR7bm9kZUlkfToke2l0ZW0uX190eXBlX199YCwgaW5kZXgpO1xyXG4gICAgICAgIGNvbXBvbmVudElkc0J5Tm9kZUlkQW5kVHlwZS5zZXQoYCR7bm9kZUlkfToke3Nob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXyl9YCwgaW5kZXgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgc2VsZWN0ZWROb2RlSWQgPSBub2RlSWRCeVV1aWQuZ2V0KHNlbGVjdGVkVXVpZClcclxuICAgICAgICA/PyBmaW5kU2VyaWFsaXplZE5vZGVJZEJ5VHJlZShkYXRhLCByb290TmFtZSwgc2VsZWN0ZWRDaGlsZE5hbWVzLCBub2RlSWRzQnlOYW1lKTtcclxuICAgIGlmIChzZWxlY3RlZE5vZGVJZCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgbG9jYXRlIHNlbGVjdGVkIG5vZGUgJHtyb290TmFtZX0gaW4gJHtvcGVuZWRBc3NldFVybH0uYCk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcclxuICAgIGNvbnN0IHNjcmlwdFR5cGVOYW1lcyA9IGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQsIGNsYXNzTmFtZSk7XHJcbiAgICBsZXQgdGFyZ2V0Q29tcG9uZW50ID0gZGF0YS5maW5kKChpdGVtKSA9PiB7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycgfHwgaXRlbT8ubm9kZT8uX19pZF9fICE9PSBzZWxlY3RlZE5vZGVJZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0eXBlTWF0Y2hlZCA9IHNjcmlwdFR5cGVOYW1lcy5pbmNsdWRlcyhpdGVtLl9fdHlwZV9fKVxyXG4gICAgICAgICAgICB8fCBpdGVtLl9fdHlwZV9fID09PSBjbGFzc05hbWVcclxuICAgICAgICAgICAgfHwgc2hvcnRUeXBlTmFtZShpdGVtLl9fdHlwZV9fKSA9PT0gY2xhc3NOYW1lO1xyXG4gICAgICAgIGNvbnN0IGhhc0dlbmVyYXRlZFByb3BlcnR5ID0gYmluZGluZ3Muc29tZSgoYmluZGluZykgPT4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGl0ZW0sIGJpbmRpbmcucHJvcGVydHlOYW1lKSk7XHJcbiAgICAgICAgcmV0dXJuIHR5cGVNYXRjaGVkIHx8IGhhc0dlbmVyYXRlZFByb3BlcnR5O1xyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKCF0YXJnZXRDb21wb25lbnQpIHtcclxuICAgICAgICB0YXJnZXRDb21wb25lbnQgPSBhcHBlbmRTZXJpYWxpemVkU2NyaXB0Q29tcG9uZW50KGRhdGEsIHNlbGVjdGVkTm9kZUlkLCBzY3JpcHRUeXBlTmFtZXNbMF0gfHwgY2xhc3NOYW1lLCBiaW5kaW5ncyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc3VidHJlZU5vZGVJZHMgPSBjb2xsZWN0U2VyaWFsaXplZFN1YnRyZWVOb2RlSWRzKGRhdGEsIHNlbGVjdGVkTm9kZUlkKTtcclxuICAgIGxldCBib3VuZENvdW50ID0gMDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcclxuICAgICAgICBjb25zdCB0YXJnZXROb2RlSWQgPSByZXNvbHZlU2VyaWFsaXplZEJpbmRpbmdOb2RlSWQoXHJcbiAgICAgICAgICAgIGRhdGEsXHJcbiAgICAgICAgICAgIGJpbmRpbmcsXHJcbiAgICAgICAgICAgIHNlbGVjdGVkTm9kZUlkLFxyXG4gICAgICAgICAgICBzdWJ0cmVlTm9kZUlkcyxcclxuICAgICAgICAgICAgbm9kZUlkQnlVdWlkLFxyXG4gICAgICAgICAgICBub2RlSWRzQnlOYW1lLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgaWYgKHRhcmdldE5vZGVJZCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gU2VyaWFsaXplZCBiaW5kIG1pc3NlZCBub2RlIGZvciAke2JpbmRpbmcucHJvcGVydHlOYW1lfSAoJHtiaW5kaW5nLm5vZGVOYW1lfSkuYCk7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnKSB7XHJcbiAgICAgICAgICAgIHRhcmdldENvbXBvbmVudFtiaW5kaW5nLnByb3BlcnR5TmFtZV0gPSB7IF9faWRfXzogdGFyZ2V0Tm9kZUlkIH07XHJcbiAgICAgICAgICAgIGJvdW5kQ291bnQgKz0gMTtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0eXBlTmFtZSA9IGJpbmRpbmcuY29tcG9uZW50VHlwZSB8fCBiaW5kaW5nLnByb3BlcnR5VHlwZTtcclxuICAgICAgICBjb25zdCBjb21wb25lbnRJZCA9IGNvbXBvbmVudElkc0J5Tm9kZUlkQW5kVHlwZS5nZXQoYCR7dGFyZ2V0Tm9kZUlkfToke3R5cGVOYW1lfWApXHJcbiAgICAgICAgICAgID8/IGNvbXBvbmVudElkc0J5Tm9kZUlkQW5kVHlwZS5nZXQoYCR7dGFyZ2V0Tm9kZUlkfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApO1xyXG5cclxuICAgICAgICBpZiAoY29tcG9uZW50SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IGNvbXBvbmVudElkIH07XHJcbiAgICAgICAgICAgIGJvdW5kQ291bnQgKz0gMTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIFNlcmlhbGl6ZWQgYmluZCBtaXNzZWQgY29tcG9uZW50ICR7dHlwZU5hbWV9IG9uICR7YmluZGluZy5ub2RlTmFtZX0uYCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHdyaXRlRmlsZVN5bmMoYXNzZXQuZmlsZSwgYCR7SlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMil9XFxuYCwgJ3V0ZjgnKTtcclxuICAgIHJldHVybiBib3VuZENvdW50O1xyXG59XHJcblxyXG5mdW5jdGlvbiBmaW5kU2VyaWFsaXplZE5vZGVJZEJ5VHJlZShcclxuICAgIGRhdGE6IGFueVtdLFxyXG4gICAgcm9vdE5hbWU6IHN0cmluZyxcclxuICAgIHNlbGVjdGVkQ2hpbGROYW1lczogU2V0PHN0cmluZz4sXHJcbiAgICBub2RlSWRzQnlOYW1lOiBNYXA8c3RyaW5nLCBudW1iZXJbXT4sXHJcbik6IG51bWJlciB8IHVuZGVmaW5lZCB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gbm9kZUlkc0J5TmFtZS5nZXQocm9vdE5hbWUpIHx8IFtdO1xyXG4gICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMSkge1xyXG4gICAgICAgIHJldHVybiBjYW5kaWRhdGVzWzBdO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBiZXN0SWQ6IG51bWJlciB8IHVuZGVmaW5lZDtcclxuICAgIGxldCBiZXN0U2NvcmUgPSBOdW1iZXIuTkVHQVRJVkVfSU5GSU5JVFk7XHJcblxyXG4gICAgZm9yIChjb25zdCBub2RlSWQgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICAgIGNvbnN0IGNoaWxkTmFtZXMgPSBnZXRTZXJpYWxpemVkRGlyZWN0Q2hpbGROYW1lcyhkYXRhLCBub2RlSWQpO1xyXG4gICAgICAgIGNvbnN0IG1hdGNoZWQgPSBjaGlsZE5hbWVzLmZpbHRlcigobmFtZSkgPT4gc2VsZWN0ZWRDaGlsZE5hbWVzLmhhcyhuYW1lKSkubGVuZ3RoO1xyXG4gICAgICAgIGNvbnN0IHNjb3JlID0gbWF0Y2hlZCAqIDEwIC0gTWF0aC5hYnMoY2hpbGROYW1lcy5sZW5ndGggLSBzZWxlY3RlZENoaWxkTmFtZXMuc2l6ZSk7XHJcbiAgICAgICAgaWYgKHNjb3JlID4gYmVzdFNjb3JlKSB7XHJcbiAgICAgICAgICAgIGJlc3RTY29yZSA9IHNjb3JlO1xyXG4gICAgICAgICAgICBiZXN0SWQgPSBub2RlSWQ7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBiZXN0SWQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFNlcmlhbGl6ZWREaXJlY3RDaGlsZE5hbWVzKGRhdGE6IGFueVtdLCBub2RlSWQ6IG51bWJlcik6IHN0cmluZ1tdIHtcclxuICAgIGNvbnN0IG5vZGUgPSBkYXRhW25vZGVJZF07XHJcbiAgICBjb25zdCBjaGlsZHJlbiA9IEFycmF5LmlzQXJyYXkobm9kZT8uX2NoaWxkcmVuKSA/IG5vZGUuX2NoaWxkcmVuIDogW107XHJcbiAgICByZXR1cm4gY2hpbGRyZW5cclxuICAgICAgICAubWFwKChjaGlsZDogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNoaWxkSWQgPSBjaGlsZD8uX19pZF9fO1xyXG4gICAgICAgICAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihjaGlsZElkKSA/IFN0cmluZyhkYXRhW2NoaWxkSWRdPy5fbmFtZSB8fCAnJykgOiAnJztcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbGxlY3RTZXJpYWxpemVkU3VidHJlZU5vZGVJZHMoZGF0YTogYW55W10sIHJvb3ROb2RlSWQ6IG51bWJlcik6IFNldDxudW1iZXI+IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xyXG4gICAgY29uc3Qgc3RhY2sgPSBbcm9vdE5vZGVJZF07XHJcblxyXG4gICAgd2hpbGUgKHN0YWNrLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBub2RlSWQgPSBzdGFjay5wb3AoKTtcclxuICAgICAgICBpZiAobm9kZUlkID09PSB1bmRlZmluZWQgfHwgcmVzdWx0Lmhhcyhub2RlSWQpKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXN1bHQuYWRkKG5vZGVJZCk7XHJcbiAgICAgICAgY29uc3Qgbm9kZSA9IGRhdGFbbm9kZUlkXTtcclxuICAgICAgICBjb25zdCBjaGlsZHJlbiA9IEFycmF5LmlzQXJyYXkobm9kZT8uX2NoaWxkcmVuKSA/IG5vZGUuX2NoaWxkcmVuIDogW107XHJcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xyXG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzSW50ZWdlcihjaGlsZD8uX19pZF9fKSkge1xyXG4gICAgICAgICAgICAgICAgc3RhY2sucHVzaChjaGlsZC5fX2lkX18pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlc29sdmVTZXJpYWxpemVkQmluZGluZ05vZGVJZChcclxuICAgIGRhdGE6IGFueVtdLFxyXG4gICAgYmluZGluZzogU2Nhbm5lZEJpbmRpbmcsXHJcbiAgICBzZWxlY3RlZE5vZGVJZDogbnVtYmVyLFxyXG4gICAgc3VidHJlZU5vZGVJZHM6IFNldDxudW1iZXI+LFxyXG4gICAgbm9kZUlkQnlVdWlkOiBNYXA8c3RyaW5nLCBudW1iZXI+LFxyXG4gICAgbm9kZUlkc0J5TmFtZTogTWFwPHN0cmluZywgbnVtYmVyW10+LFxyXG4pOiBudW1iZXIgfCB1bmRlZmluZWQge1xyXG4gICAgY29uc3QgYnlVdWlkID0gbm9kZUlkQnlVdWlkLmdldChiaW5kaW5nLm5vZGVVdWlkKTtcclxuICAgIGlmIChieVV1aWQgIT09IHVuZGVmaW5lZCAmJiBzdWJ0cmVlTm9kZUlkcy5oYXMoYnlVdWlkKSkge1xyXG4gICAgICAgIHJldHVybiBieVV1aWQ7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYnlOYW1lID0gKG5vZGVJZHNCeU5hbWUuZ2V0KGJpbmRpbmcubm9kZU5hbWUpIHx8IFtdKS5maWx0ZXIoKGlkKSA9PiBzdWJ0cmVlTm9kZUlkcy5oYXMoaWQpKTtcclxuICAgIGlmIChieU5hbWUubGVuZ3RoID09PSAxKSB7XHJcbiAgICAgICAgcmV0dXJuIGJ5TmFtZVswXTtcclxuICAgIH1cclxuICAgIGlmIChieU5hbWUubGVuZ3RoID4gMSkge1xyXG4gICAgICAgIHJldHVybiBieU5hbWVbMF07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGJpbmRpbmcubm9kZU5hbWUgPT09IGRhdGFbc2VsZWN0ZWROb2RlSWRdPy5fbmFtZSkge1xyXG4gICAgICAgIHJldHVybiBzZWxlY3RlZE5vZGVJZDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTZXJpYWxpemVkU2NyaXB0VHlwZU5hbWVzKHNjcmlwdEFzc2V0OiBhbnkgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBbLi4ubmV3IFNldChbXHJcbiAgICAgICAgLi4ucmVhZFNjcmlwdENpZEZyb21Qcm9ncmFtQ2FjaGUoc2NyaXB0QXNzZXQsIGNsYXNzTmFtZSksXHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXTtcclxufVxyXG5cclxuZnVuY3Rpb24gYXBwZW5kU2VyaWFsaXplZFNjcmlwdENvbXBvbmVudChkYXRhOiBhbnlbXSwgbm9kZUlkOiBudW1iZXIsIHNjcmlwdFR5cGU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBhbnkge1xyXG4gICAgY29uc3Qgbm9kZSA9IGRhdGFbbm9kZUlkXTtcclxuICAgIGNvbnN0IGNvbXBvbmVudElkID0gZGF0YS5sZW5ndGg7XHJcbiAgICBjb25zdCBwcmVmYWJJbmZvSWQgPSBjb21wb25lbnRJZCArIDE7XHJcbiAgICBjb25zdCBjb21wb25lbnQ6IGFueSA9IHtcclxuICAgICAgICBfX3R5cGVfXzogc2NyaXB0VHlwZSxcclxuICAgICAgICBfbmFtZTogJycsXHJcbiAgICAgICAgX29iakZsYWdzOiAwLFxyXG4gICAgICAgIF9fZWRpdG9yRXh0cmFzX186IHt9LFxyXG4gICAgICAgIG5vZGU6IHtcclxuICAgICAgICAgICAgX19pZF9fOiBub2RlSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBfZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICBfX3ByZWZhYjoge1xyXG4gICAgICAgICAgICBfX2lkX186IHByZWZhYkluZm9JZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIF9pZDogJycsXHJcbiAgICB9O1xyXG5cclxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xyXG4gICAgICAgIGNvbXBvbmVudFtiaW5kaW5nLnByb3BlcnR5TmFtZV0gPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHByZWZhYkluZm8gPSB7XHJcbiAgICAgICAgX190eXBlX186ICdjYy5Db21wUHJlZmFiSW5mbycsXHJcbiAgICAgICAgZmlsZUlkOiBtYWtlUHJlZmFiRmlsZUlkKCksXHJcbiAgICB9O1xyXG5cclxuICAgIGlmICghQXJyYXkuaXNBcnJheShub2RlLl9jb21wb25lbnRzKSkge1xyXG4gICAgICAgIG5vZGUuX2NvbXBvbmVudHMgPSBbXTtcclxuICAgIH1cclxuICAgIG5vZGUuX2NvbXBvbmVudHMucHVzaCh7IF9faWRfXzogY29tcG9uZW50SWQgfSk7XHJcbiAgICBkYXRhLnB1c2goY29tcG9uZW50LCBwcmVmYWJJbmZvKTtcclxuICAgIHJldHVybiBjb21wb25lbnQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1ha2VQcmVmYWJGaWxlSWQoKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGNoYXJzID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xyXG4gICAgY29uc3QgYnl0ZXMgPSByYW5kb21CeXRlcygyMik7XHJcbiAgICBsZXQgcmVzdWx0ID0gJyc7XHJcbiAgICBmb3IgKGNvbnN0IGJ5dGUgb2YgYnl0ZXMpIHtcclxuICAgICAgICByZXN1bHQgKz0gY2hhcnNbYnl0ZSAlIGNoYXJzLmxlbmd0aF07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBzaG9ydFR5cGVOYW1lKHR5cGU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gdHlwZS5zcGxpdCgnLicpLnBvcCgpIHx8IHR5cGU7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZUJ1dHRvbkNvbXBvbmVudHMoYnV0dG9uczogU2Nhbm5lZEJpbmRpbmdbXSwgY29uZmlnOiBCaW5kVG9vbENvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFjb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IGJ1dHRvbiBvZiBidXR0b25zKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBidXR0b24ubm9kZVV1aWQpO1xyXG4gICAgICAgICAgICBpZiAoaGFzQ29tcG9uZW50KG5vZGUsICdCdXR0b24nKSkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbXBvbmVudFR5cGUgPSBidXR0b24uY29tcG9uZW50VHlwZSB8fCAnY2MuQnV0dG9uJztcclxuICAgICAgICAgICAgYXdhaXQgY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKGJ1dHRvbi5ub2RlVXVpZCwgW2NvbXBvbmVudFR5cGUsIHNob3J0VHlwZU5hbWUoY29tcG9uZW50VHlwZSldKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBlbnN1cmUgQnV0dG9uIGNvbXBvbmVudCBvbiAke2J1dHRvbi5ub2RlTmFtZX0uYCwgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQ29tcG9uZW50KG5vZGU6IGFueSwgY29tcG9uZW50TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcclxuICAgIHJldHVybiBjb21wb25lbnRzLnNvbWUoKGNvbXBvbmVudDogYW55KSA9PiB7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgICAgICAgY29tcG9uZW50Py50eXBlLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5uYW1lLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5fX3R5cGVfXyxcclxuICAgICAgICAgICAgY29tcG9uZW50Py52YWx1ZT8uY2lkLFxyXG4gICAgICAgIF0ubWFwKHJlYWREdW1wVmFsdWUpLmZpbHRlcihCb29sZWFuKS5tYXAoU3RyaW5nKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIGNvbXBvbmVudE5hbWUpKTtcclxuICAgIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGU6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBsZWZ0ID0gU3RyaW5nKGNhbmRpZGF0ZSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCByaWdodCA9IFN0cmluZyhjb21wb25lbnROYW1lIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghbGVmdCB8fCAhcmlnaHQpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbGVmdFNob3J0ID0gc2hvcnRUeXBlTmFtZShjYW5kaWRhdGUpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCByaWdodFNob3J0ID0gc2hvcnRUeXBlTmFtZShjb21wb25lbnROYW1lKS50b0xvd2VyQ2FzZSgpO1xyXG5cclxuICAgIHJldHVybiBsZWZ0ID09PSByaWdodFxyXG4gICAgICAgIHx8IGxlZnRTaG9ydCA9PT0gcmlnaHRTaG9ydFxyXG4gICAgICAgIHx8IGxlZnQuZW5kc1dpdGgoYC4ke3JpZ2h0U2hvcnR9YClcclxuICAgICAgICB8fCByaWdodC5lbmRzV2l0aChgLiR7bGVmdFNob3J0fWApO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnRXaXRoRmFsbGJhY2sobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZXM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBsZXQgbGFzdEVycm9yOiB1bmtub3duO1xyXG5cclxuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIGNvbXBvbmVudE5hbWVzKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnY3JlYXRlLWNvbXBvbmVudCcsIHtcclxuICAgICAgICAgICAgICAgIHV1aWQ6IG5vZGVVdWlkLFxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50LFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGxhc3RFcnJvciA9IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBsYXN0RXJyb3I7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlbGF5KG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xyXG59XHJcbiJdfQ==