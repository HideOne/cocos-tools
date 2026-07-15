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
};
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
function load() { }
function unload() { }
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
        try {
            await Editor.Message.request('scene', 'save-scene');
            propertiesBound = await bindSerializedAssetReferences(openedAssetUrl, scriptUrl, selectedUuid, className, getNodeName(selectedTree), scan);
            await Editor.Message.request('asset-db', 'refresh-asset', openedAssetUrl);
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to save the current scene or prefab. Please save manually.`, error);
        }
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
    return Array.isArray(node === null || node === void 0 ? void 0 : node.children) ? node.children : [];
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
async function bindComponentProperties(nodeUuid, className, scriptUrl, bindings) {
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const componentUuid = await findComponentUuid(nodeUuid, getSerializedScriptTypeNames(scriptAsset, className));
    if (!componentUuid) {
        console.warn(`[${PACKAGE_NAME}] Cannot find component ${className} for property binding.`);
        return 0;
    }
    const componentDump = await Editor.Message.request('scene', 'query-component', componentUuid);
    let boundCount = 0;
    for (const binding of bindings) {
        const propertyDump = getPropertyDump(componentDump, binding.propertyName);
        if (!propertyDump) {
            console.warn(`[${PACKAGE_NAME}] Cannot find property dump ${binding.propertyName}.`);
            continue;
        }
        const targetUuid = binding.bindTarget === 'node'
            ? binding.nodeUuid
            : await findComponentUuid(binding.nodeUuid, binding.componentType || binding.propertyType);
        if (!targetUuid) {
            console.warn(`[${PACKAGE_NAME}] Cannot find target for ${binding.propertyName}.`);
            continue;
        }
        if (await setReferenceProperty(componentUuid, binding.propertyName, propertyDump, targetUuid)) {
            boundCount += 1;
        }
    }
    return boundCount;
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
async function setReferenceProperty(componentUuid, propertyName, propertyDump, targetUuid) {
    const candidates = makeReferenceDumpCandidates(propertyDump, targetUuid);
    for (const dump of candidates) {
        try {
            await Editor.Message.request('scene', 'set-property', {
                uuid: componentUuid,
                path: propertyName,
                dump,
                record: true,
            });
            return true;
        }
        catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to bind ${propertyName} with one reference dump candidate.`, error);
        }
    }
    return false;
}
function makeReferenceDumpCandidates(propertyDump, targetUuid) {
    const base = JSON.parse(JSON.stringify(propertyDump));
    const candidates = [];
    candidates.push(Object.assign(Object.assign({}, base), { value: {
            uuid: targetUuid,
        } }));
    candidates.push(Object.assign(Object.assign({}, base), { value: targetUuid }));
    candidates.push(Object.assign(Object.assign({}, base), { value: {
            __uuid__: targetUuid,
        } }));
    if (base.value && typeof base.value === 'object') {
        candidates.unshift(Object.assign(Object.assign({}, base), { value: Object.assign(Object.assign({}, base.value), { uuid: targetUuid }) }));
    }
    return candidates;
}
async function bindSerializedAssetReferences(openedAssetUrl, scriptUrl, selectedUuid, className, rootName, bindings) {
    var _a, _b, _c, _d, _e;
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
    const nodeIdByUuid = new Map();
    const nodeIdByName = new Map();
    const componentIdByNodeUuidAndType = new Map();
    const componentIdByNodeNameAndType = new Map();
    data.forEach((item, index) => {
        if ((item === null || item === void 0 ? void 0 : item.__type__) === 'cc.Node') {
            const nodeUuid = (item === null || item === void 0 ? void 0 : item._id) || (item === null || item === void 0 ? void 0 : item._uuid) || '';
            if (nodeUuid) {
                nodeIdByUuid.set(nodeUuid, index);
            }
            if (typeof (item === null || item === void 0 ? void 0 : item._name) === 'string') {
                nodeIdByName.set(item._name, index);
            }
        }
    });
    data.forEach((item, index) => {
        var _a;
        const nodeId = (_a = item === null || item === void 0 ? void 0 : item.node) === null || _a === void 0 ? void 0 : _a.__id__;
        const node = Number.isInteger(nodeId) ? data[nodeId] : null;
        const nodeUuid = (node === null || node === void 0 ? void 0 : node._id) || (node === null || node === void 0 ? void 0 : node._uuid) || '';
        const nodeName = (node === null || node === void 0 ? void 0 : node._name) || '';
        if (typeof (item === null || item === void 0 ? void 0 : item.__type__) !== 'string') {
            return;
        }
        if (nodeUuid) {
            componentIdByNodeUuidAndType.set(`${nodeUuid}:${item.__type__}`, index);
            componentIdByNodeUuidAndType.set(`${nodeUuid}:${shortTypeName(item.__type__)}`, index);
        }
        if (nodeName) {
            componentIdByNodeNameAndType.set(`${nodeName}:${item.__type__}`, index);
            componentIdByNodeNameAndType.set(`${nodeName}:${shortTypeName(item.__type__)}`, index);
        }
    });
    const selectedNodeId = (_a = nodeIdByUuid.get(selectedUuid)) !== null && _a !== void 0 ? _a : nodeIdByName.get(rootName);
    if (selectedNodeId === undefined) {
        return 0;
    }
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const scriptTypeNames = getSerializedScriptTypeNames(scriptAsset, className);
    let targetComponent = data.find((item) => {
        var _a;
        if (typeof (item === null || item === void 0 ? void 0 : item.__type__) !== 'string') {
            return false;
        }
        const nodeId = (_a = item === null || item === void 0 ? void 0 : item.node) === null || _a === void 0 ? void 0 : _a.__id__;
        const node = Number.isInteger(nodeId) ? data[nodeId] : null;
        const attachedToSelectedNode = nodeId === selectedNodeId || (node === null || node === void 0 ? void 0 : node._name) === rootName;
        const hasGeneratedProperty = bindings.some((binding) => Object.prototype.hasOwnProperty.call(item, binding.propertyName));
        return scriptTypeNames.includes(item.__type__)
            || item.__type__ === className
            || shortTypeName(item.__type__) === className
            || (attachedToSelectedNode && hasGeneratedProperty);
    });
    if (!targetComponent) {
        targetComponent = appendSerializedScriptComponent(data, selectedNodeId, scriptTypeNames[0] || className, bindings);
    }
    let boundCount = 0;
    for (const binding of bindings) {
        if (binding.bindTarget === 'node') {
            const nodeId = (_b = nodeIdByUuid.get(binding.nodeUuid)) !== null && _b !== void 0 ? _b : nodeIdByName.get(binding.nodeName);
            if (nodeId !== undefined) {
                targetComponent[binding.propertyName] = { __id__: nodeId };
                boundCount += 1;
            }
            continue;
        }
        const typeName = binding.componentType || binding.propertyType;
        const componentId = (_e = (_d = (_c = componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${typeName}`)) !== null && _c !== void 0 ? _c : componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${shortTypeName(typeName)}`)) !== null && _d !== void 0 ? _d : componentIdByNodeNameAndType.get(`${binding.nodeName}:${typeName}`)) !== null && _e !== void 0 ? _e : componentIdByNodeNameAndType.get(`${binding.nodeName}:${shortTypeName(typeName)}`);
        if (componentId !== undefined) {
            targetComponent[binding.propertyName] = { __id__: componentId };
            boundCount += 1;
        }
    }
    (0, fs_1.writeFileSync)(asset.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return boundCount;
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
    const left = candidate.toLowerCase();
    const right = componentName.toLowerCase();
    const leftShort = shortTypeName(candidate).toLowerCase();
    const rightShort = shortTypeName(componentName).toLowerCase();
    return left === right
        || leftShort === rightShort
        || left.endsWith(`.${rightShort}`)
        || left.includes(right);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQThOQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBaE8zQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBQ3pELG1DQUFxQztBQUVyQyxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFFakMsTUFBTSxlQUFlLEdBQUcscUNBQXFDLENBQUM7QUFDOUQsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUM7QUFDckUsTUFBTSxzQkFBc0IsR0FBRyxvQkFBb0IsQ0FBQztBQUNwRCxNQUFNLG9CQUFvQixHQUFHLGtCQUFrQixDQUFDO0FBQ2hELE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFDN0QsTUFBTSxxQkFBcUIsR0FBRywwQkFBMEIsQ0FBQztBQUN6RCxNQUFNLHlCQUF5QixHQUFHLDhCQUE4QixDQUFDO0FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFrRDdELE1BQU0sYUFBYSxHQUFtQjtJQUNsQyxVQUFVLEVBQUUsR0FBRztJQUNmLGdCQUFnQixFQUFFLEVBQUU7SUFDcEIsc0JBQXNCLEVBQUUsSUFBSTtJQUM1QixhQUFhLEVBQUUsUUFBUTtJQUN2QixVQUFVLEVBQUUsTUFBTTtJQUNsQixLQUFLLEVBQUU7UUFDSDtZQUNJLE1BQU0sRUFBRSxNQUFNO1lBQ2QsYUFBYSxFQUFFLE1BQU07WUFDckIsWUFBWSxFQUFFLE1BQU07WUFDcEIsYUFBYSxFQUFFLE1BQU07WUFDckIsVUFBVSxFQUFFLE1BQU07WUFDbEIsYUFBYSxFQUFFLEVBQUU7WUFDakIsWUFBWSxFQUFFLEtBQUs7WUFDbkIsa0JBQWtCLEVBQUUsS0FBSztZQUN6QixPQUFPLEVBQUUsSUFBSTtTQUNoQjtRQUNEO1lBQ0ksTUFBTSxFQUFFLFdBQVc7WUFDbkIsYUFBYSxFQUFFLE1BQU07WUFDckIsWUFBWSxFQUFFLE1BQU07WUFDcEIsYUFB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LFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLFFBQWdCLEVBQUUsY0FBd0I7SUFDakYsSUFBSSxTQUFrQixDQUFDO0lBRXZCLEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ3RELElBQUksRUFBRSxRQUFRO2dCQUNkLFNBQVM7YUFDWixDQUFDLENBQUM7WUFDSCxPQUFPO1FBQ1gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixTQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ3RCLENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxTQUFTLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGlzdHNTeW5jLCByZWFkRmlsZVN5bmMsIHJlYWRkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xyXG5pbXBvcnQgeyBiYXNlbmFtZSwgZXh0bmFtZSwgam9pbiwgcmVsYXRpdmUgfSBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdjcnlwdG8nO1xyXG5cclxuY29uc3QgUEFDS0FHRV9OQU1FID0gJ2JpbmQtdG9vbCc7XHJcblxyXG5jb25zdCBBVVRPX0JJTkRfU1RBUlQgPSAnLyoqKioqKioqKioqKioqKnN0c3J0KioqKioqKioqKioqKi8nO1xyXG5jb25zdCBBVVRPX0JJTkRfRU5EID0gJy8qKioqKioqKioqKioqKioqKioqKioqKiplbmQqKioqKioqKioqKioqKiovJztcclxuY29uc3QgTEVHQUNZX0FVVE9fQklORF9TVEFSVCA9ICcvLyBBVVRPX0JJTkRfU1RBUlQnO1xyXG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX0VORCA9ICcvLyBBVVRPX0JJTkRfRU5EJztcclxuY29uc3QgQVVUT19CVVRUT05fRVZFTlRfU1RBUlQgPSAnLy8gQVVUT19CVVRUT05fRVZFTlRfU1RBUlQnO1xyXG5jb25zdCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQgPSAnLy8gQVVUT19CVVRUT05fRVZFTlRfRU5EJztcclxuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCA9ICcvLyBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUJztcclxuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9FTkQgPSAnLy8gQVVUT19CVVRUT05fSEFORExFUl9FTkQnO1xyXG5cclxudHlwZSBCaW5kVGFyZ2V0ID0gJ25vZGUnIHwgJ2NvbXBvbmVudCc7XHJcbnR5cGUgQmluZE1vZGUgPSAnZ2VuZXJhdGUtYW5kLWJpbmQnIHwgJ2dlbmVyYXRlJyB8ICdiaW5kJztcclxuXHJcbmludGVyZmFjZSBCaW5kVG9vbENvbmZpZyB7XHJcbiAgICBzY3JpcHRSb290OiBzdHJpbmc7XHJcbiAgICBzY3JpcHROYW1lUHJlZml4OiBzdHJpbmc7XHJcbiAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiBib29sZWFuO1xyXG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcic7XHJcbiAgICBzdG9wUHJlZml4OiBzdHJpbmc7XHJcbiAgICBydWxlczogQmluZFJ1bGVbXTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEJpbmRSdWxlIHtcclxuICAgIHByZWZpeDogc3RyaW5nO1xyXG4gICAgY29tcG9uZW50TmFtZT86IHN0cmluZztcclxuICAgIHByb3BlcnR5VHlwZTogc3RyaW5nO1xyXG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xyXG4gICAgYmluZFRhcmdldDogQmluZFRhcmdldDtcclxuICAgIGNvbXBvbmVudFR5cGU6IHN0cmluZztcclxuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcclxuICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogYm9vbGVhbjtcclxuICAgIGVuYWJsZWQ6IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY2FubmVkQmluZGluZyB7XHJcbiAgICBub2RlVXVpZDogc3RyaW5nO1xyXG4gICAgbm9kZU5hbWU6IHN0cmluZztcclxuICAgIHByb3BlcnR5TmFtZTogc3RyaW5nO1xyXG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XHJcbiAgICBkZWNvcmF0b3JUeXBlOiBzdHJpbmc7XHJcbiAgICBiaW5kVGFyZ2V0OiBCaW5kVGFyZ2V0O1xyXG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xyXG4gICAgc3RvcENoaWxkcmVuOiBib29sZWFuO1xyXG4gICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBib29sZWFuO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQmluZFJlc3VsdCB7XHJcbiAgICBjbGFzc05hbWU6IHN0cmluZztcclxuICAgIHNjcmlwdFVybDogc3RyaW5nO1xyXG4gICAgb3BlbmVkQXNzZXRVcmw6IHN0cmluZztcclxuICAgIHNjcmlwdEJhc2VEaXI6IHN0cmluZztcclxuICAgIGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdO1xyXG4gICAgYnV0dG9uczogU2Nhbm5lZEJpbmRpbmdbXTtcclxuICAgIGNyZWF0ZWQ6IGJvb2xlYW47XHJcbiAgICBjb21wb25lbnRBdHRhY2hlZDogYm9vbGVhbjtcclxuICAgIHByb3BlcnRpZXNCb3VuZDogbnVtYmVyO1xyXG59XHJcblxyXG5jb25zdCBkZWZhdWx0Q29uZmlnOiBCaW5kVG9vbENvbmZpZyA9IHtcclxuICAgIHNjcmlwdFJvb3Q6ICcuJyxcclxuICAgIHNjcmlwdE5hbWVQcmVmaXg6ICcnLFxyXG4gICAgYXV0b0FkZEJ1dHRvbkNvbXBvbmVudDogdHJ1ZSxcclxuICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxyXG4gICAgc3RvcFByZWZpeDogJ3N0b3AnLFxyXG4gICAgcnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGUnLFxyXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnTm9kZScsXHJcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ05vZGUnLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTm9kZScsXHJcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdub2RlJyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJycsXHJcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGVfc3RvcCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTm9kZScsXHJcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdOb2RlJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxyXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiB0cnVlLFxyXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGZhbHNlLFxyXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBwcmVmaXg6ICdzcGluZScsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdzcC5Ta2VsZXRvbicsXHJcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdzcC5Ta2VsZXRvbicsXHJcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ2J1dHRvbicsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdCdXR0b24nLFxyXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdCdXR0b24nLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnQnV0dG9uJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdjYy5CdXR0b24nLFxyXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxyXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ2xhYmVsJyxcclxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0xhYmVsJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTGFiZWwnLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTGFiZWwnLFxyXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJ2NjLkxhYmVsJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcclxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgXSxcclxufTtcclxuXHJcbmV4cG9ydCBjb25zdCBtZXRob2RzOiB7IFtrZXk6IHN0cmluZ106ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55IH0gPSB7XHJcbiAgICBhc3luYyBvcGVuUnVsZXNQYW5lbCgpIHtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUGFuZWwub3BlbihgJHtQQUNLQUdFX05BTUV9LnJ1bGVzYCk7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIHF1ZXJ5Q29uZmlnKCkge1xyXG4gICAgICAgIHJldHVybiByZWFkQ29uZmlnKCk7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIHNhdmVDb25maWcoY29uZmlnOiBQYXJ0aWFsPEJpbmRUb29sQ29uZmlnPikge1xyXG4gICAgICAgIGNvbnN0IG5leHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xyXG4gICAgICAgICAgICAuLi5kZWZhdWx0Q29uZmlnLFxyXG4gICAgICAgICAgICAuLi5jb25maWcsXHJcbiAgICAgICAgICAgIHJ1bGVzOiBub3JtYWxpemVSdWxlcyhjb25maWcucnVsZXMpLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc2NyaXB0Um9vdCcsIG5leHRDb25maWcuc2NyaXB0Um9vdCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHROYW1lUHJlZml4JywgbmV4dENvbmZpZy5zY3JpcHROYW1lUHJlZml4KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ2F1dG9BZGRCdXR0b25Db21wb25lbnQnLCBuZXh0Q29uZmlnLmF1dG9BZGRCdXR0b25Db21wb25lbnQpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnb3ZlcndyaXRlTW9kZScsIG5leHRDb25maWcub3ZlcndyaXRlTW9kZSk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzdG9wUHJlZml4JywgbmV4dENvbmZpZy5zdG9wUHJlZml4KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3J1bGVzJywgbmV4dENvbmZpZy5ydWxlcyk7XHJcbiAgICAgICAgcmV0dXJuIG5leHRDb25maWc7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIHJlc2V0Q29uZmlnKCkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc2NyaXB0Um9vdCcsIGRlZmF1bHRDb25maWcuc2NyaXB0Um9vdCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHROYW1lUHJlZml4JywgZGVmYXVsdENvbmZpZy5zY3JpcHROYW1lUHJlZml4KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ2F1dG9BZGRCdXR0b25Db21wb25lbnQnLCBkZWZhdWx0Q29uZmlnLmF1dG9BZGRCdXR0b25Db21wb25lbnQpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnb3ZlcndyaXRlTW9kZScsIGRlZmF1bHRDb25maWcub3ZlcndyaXRlTW9kZSk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzdG9wUHJlZml4JywgZGVmYXVsdENvbmZpZy5zdG9wUHJlZml4KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3J1bGVzJywgZGVmYXVsdENvbmZpZy5ydWxlcyk7XHJcbiAgICAgICAgcmV0dXJuIGRlZmF1bHRDb25maWc7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIGJpbmRTZWxlY3RlZE5vZGUoKSB7XHJcbiAgICAgICAgYXdhaXQgcnVuQmluZFNlbGVjdGVkTm9kZSgnZ2VuZXJhdGUtYW5kLWJpbmQnKTtcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgZ2VuZXJhdGVTZWxlY3RlZE5vZGVTY3JpcHQoKSB7XHJcbiAgICAgICAgYXdhaXQgcnVuQmluZFNlbGVjdGVkTm9kZSgnZ2VuZXJhdGUnKTtcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgYmluZFNlbGVjdGVkTm9kZVJlZmVyZW5jZXMoKSB7XHJcbiAgICAgICAgYXdhaXQgcnVuQmluZFNlbGVjdGVkTm9kZSgnYmluZCcpO1xyXG4gICAgfSxcclxufTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJ1bkJpbmRTZWxlY3RlZE5vZGUobW9kZTogQmluZE1vZGUpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IG1vZGVUaXRsZSA9IGdldE1vZGVUaXRsZShtb2RlKTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgYmluZFNlbGVjdGVkTm9kZShtb2RlKTtcclxuICAgICAgICBjb25zdCBkZXRhaWwgPSBbXHJcbiAgICAgICAgICAgIGBPcGVuZWQ6ICR7cmVzdWx0Lm9wZW5lZEFzc2V0VXJsfWAsXHJcbiAgICAgICAgICAgIGBTY3JpcHQgYmFzZTogJHtyZXN1bHQuc2NyaXB0QmFzZURpcn1gLFxyXG4gICAgICAgICAgICBgU2NyaXB0OiAke3Jlc3VsdC5zY3JpcHRVcmx9YCxcclxuICAgICAgICAgICAgYFByb3BlcnRpZXM6ICR7cmVzdWx0LmJpbmRpbmdzLmxlbmd0aH1gLFxyXG4gICAgICAgICAgICBgQnV0dG9uIGV2ZW50czogJHtyZXN1bHQuYnV0dG9ucy5sZW5ndGh9YCxcclxuICAgICAgICAgICAgbW9kZSA9PT0gJ2dlbmVyYXRlJyA/ICdDb21wb25lbnQ6IHNraXBwZWQnIDogKHJlc3VsdC5jb21wb25lbnRBdHRhY2hlZCA/ICdDb21wb25lbnQ6IGF0dGFjaCBhdHRlbXB0ZWQgc3VjY2Vzc2Z1bGx5JyA6ICdDb21wb25lbnQ6IG5vdCBhdHRhY2hlZCcpLFxyXG4gICAgICAgICAgICBtb2RlID09PSAnZ2VuZXJhdGUnID8gJ0JvdW5kIHJlZmVyZW5jZXM6IHNraXBwZWQnIDogYEJvdW5kIHJlZmVyZW5jZXM6ICR7cmVzdWx0LnByb3BlcnRpZXNCb3VuZH1gLFxyXG4gICAgICAgIF0uam9pbignXFxuJyk7XHJcblxyXG4gICAgICAgIEVkaXRvci5UYXNrLmFkZE5vdGljZSh7XHJcbiAgICAgICAgICAgIHRpdGxlOiBgJHttb2RlVGl0bGV9IGNvbXBsZXRlYCxcclxuICAgICAgICAgICAgbWVzc2FnZTogZGV0YWlsLFxyXG4gICAgICAgICAgICB0eXBlOiAnc3VjY2VzcycsXHJcbiAgICAgICAgICAgIHNvdXJjZTogUEFDS0FHRV9OQU1FLFxyXG4gICAgICAgICAgICB0aW1lb3V0OiA2MDAwLFxyXG4gICAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFske1BBQ0tBR0VfTkFNRX1dICR7bWVzc2FnZX1gLCBlcnJvcik7XHJcbiAgICAgICAgRWRpdG9yLlRhc2suYWRkTm90aWNlKHtcclxuICAgICAgICAgICAgdGl0bGU6IGAke21vZGVUaXRsZX0gZmFpbGVkYCxcclxuICAgICAgICAgICAgbWVzc2FnZSxcclxuICAgICAgICAgICAgdHlwZTogJ2Vycm9yJyxcclxuICAgICAgICAgICAgc291cmNlOiBQQUNLQUdFX05BTUUsXHJcbiAgICAgICAgICAgIHRpbWVvdXQ6IDgwMDAsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE1vZGVUaXRsZShtb2RlOiBCaW5kTW9kZSk6IHN0cmluZyB7XHJcbiAgICBpZiAobW9kZSA9PT0gJ2dlbmVyYXRlJykge1xyXG4gICAgICAgIHJldHVybiAnR2VuZXJhdGUgc2NyaXB0JztcclxuICAgIH1cclxuXHJcbiAgICBpZiAobW9kZSA9PT0gJ2JpbmQnKSB7XHJcbiAgICAgICAgcmV0dXJuICdCaW5kIHJlZmVyZW5jZXMnO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiAnR2VuZXJhdGUgYW5kIGJpbmQnO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gbG9hZCgpIHt9XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCkge31cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGJpbmRTZWxlY3RlZE5vZGUobW9kZTogQmluZE1vZGUpOiBQcm9taXNlPEJpbmRSZXN1bHQ+IHtcclxuICAgIGNvbnN0IHNlbGVjdGVkVXVpZCA9IEVkaXRvci5TZWxlY3Rpb24uZ2V0TGFzdFNlbGVjdGVkKCdub2RlJykgfHwgRWRpdG9yLlNlbGVjdGlvbi5nZXRTZWxlY3RlZCgnbm9kZScpWzBdO1xyXG4gICAgaWYgKCFzZWxlY3RlZFV1aWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzZWxlY3QgYSBub2RlIGZpcnN0LicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNlbGVjdGVkVHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScsIHNlbGVjdGVkVXVpZCk7XHJcbiAgICBpZiAoIXNlbGVjdGVkVHJlZSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IHJlYWQgdGhlIHNlbGVjdGVkIG5vZGUuIE1ha2Ugc3VyZSBhIHNjZW5lIG9yIHByZWZhYiBpcyBvcGVuLicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5vZGVOYW1lID0gZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKTtcclxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHJlYWRDb25maWcoKTtcclxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IGFwcGx5U2NyaXB0TmFtZVByZWZpeCh0b0NsYXNzTmFtZShub2RlTmFtZSksIGNvbmZpZy5zY3JpcHROYW1lUHJlZml4KTtcclxuICAgIGNvbnN0IG9wZW5lZEFzc2V0VXJsID0gYXdhaXQgcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWUpO1xyXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGxvY2F0ZSB0aGUgb3BlbmVkIHByZWZhYiBvciBzY2VuZSBhc3NldC4gUGxlYXNlIHNhdmUgdGhlIHByZWZhYi9zY2VuZSBhbmQgcnVuIGJpbmQgYWdhaW4uJyk7XHJcbiAgICB9XHJcbiAgICBjb25zdCBzY3JpcHRCYXNlRGlyID0gZ2V0U2NyaXB0QmFzZURpcihvcGVuZWRBc3NldFVybCk7XHJcbiAgICBjb25zdCBzY3JpcHRVcmwgPSBtYWtlU2NyaXB0VXJsKG9wZW5lZEFzc2V0VXJsLCBjbGFzc05hbWUsIGNvbmZpZy5zY3JpcHRSb290KTtcclxuICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBPcGVuZWQgYXNzZXQ6ICR7b3BlbmVkQXNzZXRVcmx9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhgWyR7UEFDS0FHRV9OQU1FfV0gU2NyaXB0IGJhc2U6ICR7c2NyaXB0QmFzZURpcn0sIHNjcmlwdFJvb3Q6ICR7Y29uZmlnLnNjcmlwdFJvb3R9LCBzY3JpcHQ6ICR7c2NyaXB0VXJsfWApO1xyXG4gICAgY29uc3Qgc2NhbiA9IHNjYW5CaW5kaW5ncyhzZWxlY3RlZFRyZWUsIGNvbmZpZyk7XHJcbiAgICBjb25zdCBidXR0b25zID0gc2Nhbi5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0uZ2VuZXJhdGVDbGlja0V2ZW50KTtcclxuICAgIGxldCBjcmVhdGVkID0gZmFsc2U7XHJcbiAgICBsZXQgY29tcG9uZW50QXR0YWNoZWQgPSBmYWxzZTtcclxuICAgIGxldCBwcm9wZXJ0aWVzQm91bmQgPSAwO1xyXG5cclxuICAgIGlmIChtb2RlICE9PSAnYmluZCcpIHtcclxuICAgICAgICBjb25zdCBzb3VyY2UgPSByZW5kZXJTY3JpcHQoY2xhc3NOYW1lLCBzY2FuLCBidXR0b25zKTtcclxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHJlYWRBc3NldFRleHQoc2NyaXB0VXJsKTtcclxuICAgICAgICBjb25zdCBjYW5VcGRhdGVFeGlzdGluZyA9IGV4aXN0aW5nID8gaGFzQWxsQXV0b0Jsb2NrcyhleGlzdGluZykgOiB0cnVlO1xyXG4gICAgICAgIGNvbnN0IGZpbmFsU291cmNlID0gZXhpc3RpbmcgPyB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3RpbmcsIHNvdXJjZSkgOiBzb3VyY2U7XHJcblxyXG4gICAgICAgIGlmIChleGlzdGluZyAmJiAhY2FuVXBkYXRlRXhpc3RpbmcpIHtcclxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY3JpcHQgZXhpc3RzIGJ1dCBhdXRvLWdlbmVyYXRlZCBtYXJrZXJzIGFyZSBtaXNzaW5nLiBTdG9wIHRvIGF2b2lkIG92ZXJ3cml0aW5nIHVzZXIgY29kZTogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjcmVhdGVkID0gIWV4aXN0aW5nO1xyXG4gICAgICAgIGF3YWl0IHdyaXRlQXNzZXQoc2NyaXB0VXJsLCBmaW5hbFNvdXJjZSwgY3JlYXRlZCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVmcmVzaC1hc3NldCcsIHNjcmlwdFVybCk7XHJcbiAgICB9IGVsc2UgaWYgKCFhd2FpdCByZWFkQXNzZXRUZXh0KHNjcmlwdFVybCkpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjcmlwdCBkb2VzIG5vdCBleGlzdC4gR2VuZXJhdGUgaXQgZmlyc3Q6ICR7c2NyaXB0VXJsfWApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtb2RlICE9PSAnZ2VuZXJhdGUnKSB7XHJcbiAgICAgICAgYXdhaXQgZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zLCBjb25maWcpO1xyXG4gICAgICAgIGNvbXBvbmVudEF0dGFjaGVkID0gYXdhaXQgdHJ5QXR0YWNoQ29tcG9uZW50KHNlbGVjdGVkVXVpZCwgY2xhc3NOYW1lLCBzY3JpcHRVcmwpO1xyXG5cclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyk7XHJcbiAgICAgICAgICAgIHByb3BlcnRpZXNCb3VuZCA9IGF3YWl0IGJpbmRTZXJpYWxpemVkQXNzZXRSZWZlcmVuY2VzKG9wZW5lZEFzc2V0VXJsLCBzY3JpcHRVcmwsIHNlbGVjdGVkVXVpZCwgY2xhc3NOYW1lLCBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpLCBzY2FuKTtcclxuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVmcmVzaC1hc3NldCcsIG9wZW5lZEFzc2V0VXJsKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBzYXZlIHRoZSBjdXJyZW50IHNjZW5lIG9yIHByZWZhYi4gUGxlYXNlIHNhdmUgbWFudWFsbHkuYCwgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBzY3JpcHRVcmwsXHJcbiAgICAgICAgb3BlbmVkQXNzZXRVcmwsXHJcbiAgICAgICAgc2NyaXB0QmFzZURpcixcclxuICAgICAgICBiaW5kaW5nczogc2NhbixcclxuICAgICAgICBidXR0b25zLFxyXG4gICAgICAgIGNyZWF0ZWQsXHJcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQsXHJcbiAgICAgICAgcHJvcGVydGllc0JvdW5kLFxyXG4gICAgfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZENvbmZpZygpOiBQcm9taXNlPEJpbmRUb29sQ29uZmlnPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHByb2plY3RDb25maWcgPSBhd2FpdCBFZGl0b3IuUHJvZmlsZS5nZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgLi4uZGVmYXVsdENvbmZpZyxcclxuICAgICAgICAgICAgLi4uKHByb2plY3RDb25maWcgfHwge30pLFxyXG4gICAgICAgICAgICBzY3JpcHROYW1lUHJlZml4OiBTdHJpbmcocHJvamVjdENvbmZpZz8uc2NyaXB0TmFtZVByZWZpeCA/PyBkZWZhdWx0Q29uZmlnLnNjcmlwdE5hbWVQcmVmaXgpLFxyXG4gICAgICAgICAgICBydWxlczogbm9ybWFsaXplUnVsZXMocHJvamVjdENvbmZpZz8ucnVsZXMpLFxyXG4gICAgICAgIH07XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZXMocnVsZXM6IHVua25vd24pOiBCaW5kUnVsZVtdIHtcclxuICAgIGlmICghQXJyYXkuaXNBcnJheShydWxlcykpIHtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZy5ydWxlcztcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gcnVsZXNcclxuICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlICYmIHR5cGVvZiBydWxlID09PSAnb2JqZWN0JylcclxuICAgICAgICAubWFwKChydWxlOiBhbnkpID0+IG5vcm1hbGl6ZVJ1bGUocnVsZSkpXHJcbiAgICAgICAgLmZpbHRlcigocnVsZSk6IHJ1bGUgaXMgQmluZFJ1bGUgPT4gQm9vbGVhbihydWxlKSk7XHJcblxyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiBkZWZhdWx0Q29uZmlnLnJ1bGVzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVSdWxlKHJ1bGU6IGFueSk6IEJpbmRSdWxlIHwgbnVsbCB7XHJcbiAgICBjb25zdCBwcmVmaXggPSBTdHJpbmcocnVsZS5wcmVmaXggfHwgJycpLnRyaW0oKTtcclxuICAgIGlmICghcHJlZml4KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29tcG9uZW50TmFtZSA9IFN0cmluZyhydWxlLmNvbXBvbmVudE5hbWUgfHwgcnVsZS5wcm9wZXJ0eVR5cGUgfHwgJ05vZGUnKS50cmltKCk7XHJcbiAgICBjb25zdCBwcm9wZXJ0eVR5cGUgPSBub3JtYWxpemVDb21wb25lbnROYW1lKGNvbXBvbmVudE5hbWUpO1xyXG4gICAgY29uc3QgYmluZFRhcmdldDogQmluZFRhcmdldCA9IHByb3BlcnR5VHlwZSA9PT0gJ05vZGUnID8gJ25vZGUnIDogJ2NvbXBvbmVudCc7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmVmaXgsXHJcbiAgICAgICAgY29tcG9uZW50TmFtZTogcHJvcGVydHlUeXBlLFxyXG4gICAgICAgIHByb3BlcnR5VHlwZSxcclxuICAgICAgICBkZWNvcmF0b3JUeXBlOiBwcm9wZXJ0eVR5cGUsXHJcbiAgICAgICAgYmluZFRhcmdldCxcclxuICAgICAgICBjb21wb25lbnRUeXBlOiBiaW5kVGFyZ2V0ID09PSAnY29tcG9uZW50JyA/IHRvQ29tcG9uZW50VHlwZShwcm9wZXJ0eVR5cGUpIDogJycsXHJcbiAgICAgICAgc3RvcENoaWxkcmVuOiBCb29sZWFuKHJ1bGUuc3RvcENoaWxkcmVuKSB8fCBwcmVmaXggPT09ICdub2RlX3N0b3AnLFxyXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogaXNCdXR0b25UeXBlKHByb3BlcnR5VHlwZSksXHJcbiAgICAgICAgZW5hYmxlZDogcnVsZS5lbmFibGVkICE9PSBmYWxzZSxcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHZhbHVlID0gY29tcG9uZW50TmFtZS50cmltKCk7XHJcbiAgICBpZiAodmFsdWUuc3RhcnRzV2l0aCgnY2MuJykpIHtcclxuICAgICAgICByZXR1cm4gc2hvcnRUeXBlTmFtZSh2YWx1ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHZhbHVlIHx8ICdOb2RlJztcclxufVxyXG5cclxuZnVuY3Rpb24gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGlmIChpc0J1aWx0aW5DY0NvbXBvbmVudChwcm9wZXJ0eVR5cGUpKSB7XHJcbiAgICAgICAgcmV0dXJuIGBjYy4ke3Byb3BlcnR5VHlwZX1gO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBwcm9wZXJ0eVR5cGU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQnVpbHRpbkNjQ29tcG9uZW50KHByb3BlcnR5VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gW1xyXG4gICAgICAgICdCdXR0b24nLFxyXG4gICAgICAgICdFZGl0Qm94JyxcclxuICAgICAgICAnTGFiZWwnLFxyXG4gICAgICAgICdMYXlvdXQnLFxyXG4gICAgICAgICdNYXNrJyxcclxuICAgICAgICAnUGFnZVZpZXcnLFxyXG4gICAgICAgICdQcm9ncmVzc0JhcicsXHJcbiAgICAgICAgJ1JpY2hUZXh0JyxcclxuICAgICAgICAnU2Nyb2xsVmlldycsXHJcbiAgICAgICAgJ1NsaWRlcicsXHJcbiAgICAgICAgJ1Nwcml0ZScsXHJcbiAgICAgICAgJ1RvZ2dsZScsXHJcbiAgICAgICAgJ1dpZGdldCcsXHJcbiAgICBdLmluY2x1ZGVzKHByb3BlcnR5VHlwZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQnV0dG9uVHlwZShwcm9wZXJ0eVR5cGU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZSA9PT0gJ0J1dHRvbicgfHwgcHJvcGVydHlUeXBlID09PSAnY2MuQnV0dG9uJztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgY29uc3QgZnJvbVNhdmUgPSBhd2FpdCBxdWVyeVVybEZyb21TYXZlU2NlbmUoKTtcclxuICAgIGlmIChmcm9tU2F2ZSkge1xyXG4gICAgICAgIHJldHVybiBmcm9tU2F2ZTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmcm9tUHJlZmFiRHVtcCA9IGF3YWl0IHF1ZXJ5VXJsRnJvbVByZWZhYkR1bXAoc2VsZWN0ZWRUcmVlKTtcclxuICAgIGlmIChmcm9tUHJlZmFiRHVtcCkge1xyXG4gICAgICAgIHJldHVybiBmcm9tUHJlZmFiRHVtcDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmcm9tU2VsZWN0ZWRBc3NldCA9IGF3YWl0IHF1ZXJ5VXJsRnJvbVNlbGVjdGVkQXNzZXQoKTtcclxuICAgIGlmIChmcm9tU2VsZWN0ZWRBc3NldCkge1xyXG4gICAgICAgIHJldHVybiBmcm9tU2VsZWN0ZWRBc3NldDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZmluZEFzc2V0VXJsQnlOb2RlVHJlZVdpdGhSZXRyeShzZWxlY3RlZFRyZWUpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeVVybEZyb21TYXZlU2NlbmUoKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHNhdmVkSWQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyk7XHJcbiAgICAgICAgaWYgKCFzYXZlZElkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHJlc29sdmVBc3NldFVybChTdHJpbmcoc2F2ZWRJZCkpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5VXJsRnJvbVByZWZhYkR1bXAoc2VsZWN0ZWRUcmVlOiBhbnkpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3Qgcm9vdFRyZWUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlLXRyZWUnKTtcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW3Jvb3RUcmVlLCBzZWxlY3RlZFRyZWVdO1xyXG4gICAgICAgIGZvciAoY29uc3QgdHJlZSBvZiBjYW5kaWRhdGVzKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGFzc2V0VXVpZCA9IGV4dHJhY3RQcmVmYWJBc3NldFV1aWQodHJlZSk7XHJcbiAgICAgICAgICAgIGlmICghYXNzZXRVdWlkKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgdXJsID0gYXdhaXQgcmVzb2x2ZUFzc2V0VXJsKGFzc2V0VXVpZCk7XHJcbiAgICAgICAgICAgIGlmICh1cmwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB1cmw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICAvLyBpZ25vcmUgYW5kIGZhbGwgdGhyb3VnaFxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeVVybEZyb21TZWxlY3RlZEFzc2V0KCk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzZWxlY3RlZEFzc2V0ID0gRWRpdG9yLlNlbGVjdGlvbi5nZXRMYXN0U2VsZWN0ZWQoJ2Fzc2V0JykgfHwgRWRpdG9yLlNlbGVjdGlvbi5nZXRTZWxlY3RlZCgnYXNzZXQnKVswXTtcclxuICAgICAgICBpZiAoIXNlbGVjdGVkQXNzZXQpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB1cmwgPSBhd2FpdCByZXNvbHZlQXNzZXRVcmwoU3RyaW5nKHNlbGVjdGVkQXNzZXQpKTtcclxuICAgICAgICBpZiAodXJsICYmIC9cXC4ocHJlZmFifHNjZW5lKSQvaS50ZXN0KHVybCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHVybDtcclxuICAgICAgICB9XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICAvLyBpZ25vcmUgYW5kIGZhbGwgdGhyb3VnaFxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlQXNzZXRVcmwoaWRPclVybDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIGlkT3JVcmwpO1xyXG4gICAgICAgIGlmIChhc3NldD8udXJsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcoYXNzZXQudXJsKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGFzc2V0Py5zb3VyY2UpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFN0cmluZyhhc3NldC5zb3VyY2UpO1xyXG4gICAgICAgIH1cclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIC8vIGNvbnRpbnVlXHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB1cmwgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS11cmwnLCBpZE9yVXJsKTtcclxuICAgICAgICByZXR1cm4gdXJsID8gU3RyaW5nKHVybCkgOiBudWxsO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGV4dHJhY3RQcmVmYWJBc3NldFV1aWQodHJlZTogYW55KTogc3RyaW5nIHwgbnVsbCB7XHJcbiAgICBpZiAoIXRyZWUgfHwgdHlwZW9mIHRyZWUgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZHVtcHMgPSBbXHJcbiAgICAgICAgdHJlZS5fX3ByZWZhYl9fLFxyXG4gICAgICAgIHRyZWUuX3ByZWZhYixcclxuICAgICAgICB0cmVlLl9wcmVmYWJJbnN0YW5jZSxcclxuICAgICAgICByZWFkRHVtcFZhbHVlKHRyZWUuX19wcmVmYWJfXyksXHJcbiAgICAgICAgcmVhZER1bXBWYWx1ZSh0cmVlLl9wcmVmYWIpLFxyXG4gICAgXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGR1bXAgb2YgZHVtcHMpIHtcclxuICAgICAgICBpZiAoIWR1bXAgfHwgdHlwZW9mIGR1bXAgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdXVpZCA9IGR1bXAuYXNzZXRVdWlkXHJcbiAgICAgICAgICAgIHx8IGR1bXAudXVpZFxyXG4gICAgICAgICAgICB8fCBkdW1wLmFzc2V0XHJcbiAgICAgICAgICAgIHx8IHJlYWREdW1wVmFsdWUoZHVtcC5hc3NldFV1aWQpXHJcbiAgICAgICAgICAgIHx8IHJlYWREdW1wVmFsdWUoZHVtcC51dWlkKVxyXG4gICAgICAgICAgICB8fCByZWFkRHVtcFZhbHVlKGR1bXAuYXNzZXQpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgdXVpZCA9PT0gJ3N0cmluZycgJiYgdXVpZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gdXVpZDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICh1dWlkICYmIHR5cGVvZiB1dWlkID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgICBjb25zdCBuZXN0ZWQgPSByZWFkRHVtcFZhbHVlKHV1aWQudXVpZCkgfHwgdXVpZC51dWlkIHx8IHV1aWQuX191dWlkX187XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbmVzdGVkID09PSAnc3RyaW5nJyAmJiBuZXN0ZWQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBuZXN0ZWQ7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlOiBhbnkpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcclxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCA1OyBpbmRleCArPSAxKSB7XHJcbiAgICAgICAgY29uc3QgdXJsID0gZmluZEFzc2V0VXJsQnlOb2RlVHJlZShzZWxlY3RlZFRyZWUpO1xyXG4gICAgICAgIGlmICh1cmwpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHVybDtcclxuICAgICAgICB9XHJcbiAgICAgICAgYXdhaXQgZGVsYXkoMTIwKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZmluZEFzc2V0VXJsQnlOb2RlVHJlZShzZWxlY3RlZFRyZWU6IGFueSk6IHN0cmluZyB8IG51bGwge1xyXG4gICAgY29uc3QgYXNzZXRzRGlyID0gam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnYXNzZXRzJyk7XHJcbiAgICBpZiAoIWV4aXN0c1N5bmMoYXNzZXRzRGlyKSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb3ROYW1lID0gZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKTtcclxuICAgIGNvbnN0IHRyZWVOb2RlTmFtZXMgPSBjb2xsZWN0Tm9kZU5hbWVzKHNlbGVjdGVkVHJlZSk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gbGlzdEFzc2V0RmlsZXMoYXNzZXRzRGlyLCBbJy5wcmVmYWInLCAnLnNjZW5lJ10pO1xyXG4gICAgbGV0IGJlc3RVcmw6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG4gICAgbGV0IGJlc3RTY29yZSA9IE51bWJlci5ORUdBVElWRV9JTkZJTklUWTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSByZWFkSnNvbkZpbGVTeW5jKGZpbGUpO1xyXG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzY29yZSA9IHNjb3JlQXNzZXRNYXRjaChmaWxlLCBkYXRhLCByb290TmFtZSwgdHJlZU5vZGVOYW1lcyk7XHJcbiAgICAgICAgICAgIGlmIChzY29yZSA8PSBiZXN0U2NvcmUpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBiZXN0U2NvcmUgPSBzY29yZTtcclxuICAgICAgICAgICAgYmVzdFVybCA9IGBkYjovLyR7cmVsYXRpdmUoRWRpdG9yLlByb2plY3QucGF0aCwgZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpfWA7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBpbnNwZWN0IGFzc2V0ICR7ZmlsZX0uYCwgZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBiZXN0U2NvcmUgPiAwID8gYmVzdFVybCA6IG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbGxlY3ROb2RlTmFtZXMobm9kZTogYW55LCByZXN1bHQ6IHN0cmluZ1tdID0gW10pOiBzdHJpbmdbXSB7XHJcbiAgICByZXN1bHQucHVzaChnZXROb2RlTmFtZShub2RlKSk7XHJcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGdldENoaWxkcmVuKG5vZGUpKSB7XHJcbiAgICAgICAgY29sbGVjdE5vZGVOYW1lcyhjaGlsZCwgcmVzdWx0KTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNjb3JlQXNzZXRNYXRjaChmaWxlOiBzdHJpbmcsIGRhdGE6IGFueVtdLCByb290TmFtZTogc3RyaW5nLCB0cmVlTm9kZU5hbWVzOiBzdHJpbmdbXSk6IG51bWJlciB7XHJcbiAgICBjb25zdCBub2RlcyA9IGRhdGEuZmlsdGVyKChpdGVtKSA9PiBpdGVtPy5fX3R5cGVfXyA9PT0gJ2NjLk5vZGUnKTtcclxuICAgIGNvbnN0IGhhc1Jvb3QgPSBub2Rlcy5zb21lKChub2RlKSA9PiBub2RlPy5fbmFtZSA9PT0gcm9vdE5hbWUpO1xyXG4gICAgaWYgKCFoYXNSb290KSB7XHJcbiAgICAgICAgcmV0dXJuIE51bWJlci5ORUdBVElWRV9JTkZJTklUWTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBhc3NldE5hbWVzID0gbm9kZXMubWFwKChub2RlKSA9PiBTdHJpbmcobm9kZT8uX25hbWUgfHwgJycpKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICBjb25zdCBhc3NldE5hbWVTZXQgPSBuZXcgU2V0KGFzc2V0TmFtZXMpO1xyXG4gICAgY29uc3QgbWF0Y2hlZENvdW50ID0gdHJlZU5vZGVOYW1lcy5maWx0ZXIoKG5hbWUpID0+IGFzc2V0TmFtZVNldC5oYXMobmFtZSkpLmxlbmd0aDtcclxuICAgIGlmIChtYXRjaGVkQ291bnQgPD0gMCAmJiBiYXNlbmFtZShmaWxlLCBleHRuYW1lKGZpbGUpKSAhPT0gcm9vdE5hbWUpIHtcclxuICAgICAgICByZXR1cm4gTnVtYmVyLk5FR0FUSVZFX0lORklOSVRZO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCBzY29yZSA9IG1hdGNoZWRDb3VudCAqIDEwO1xyXG4gICAgc2NvcmUgLT0gTWF0aC5hYnMoYXNzZXROYW1lcy5sZW5ndGggLSB0cmVlTm9kZU5hbWVzLmxlbmd0aCkgKiAzO1xyXG4gICAgaWYgKGJhc2VuYW1lKGZpbGUsIGV4dG5hbWUoZmlsZSkpID09PSByb290TmFtZSkge1xyXG4gICAgICAgIHNjb3JlICs9IDU7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUHJlZmVyIHVuaXF1ZSBzdHJ1Y3R1cmFsIG1hdGNoZXMgd2hlbiBkdXBsaWNhdGUgcHJlZmFicyBleGlzdCB1bmRlciBkaWZmZXJlbnQgZm9sZGVycy5cclxuICAgIHNjb3JlICs9IE1hdGgubWluKG1hdGNoZWRDb3VudCwgYXNzZXROYW1lcy5sZW5ndGgpO1xyXG5cclxuICAgIHJldHVybiBzY29yZTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVhZEpzb25GaWxlU3luYyhmaWxlOiBzdHJpbmcpOiBhbnkgfCBudWxsIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBpZiAoaXNJbmNvbXBsZXRlSnNvbkVycm9yKGVycm9yKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlYWRKc29uRmlsZVdpdGhSZXRyeShmaWxlOiBzdHJpbmcsIGF0dGVtcHRzID0gNSk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xyXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGF0dGVtcHRzOyBpbmRleCArPSAxKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGlmICghaXNJbmNvbXBsZXRlSnNvbkVycm9yKGVycm9yKSB8fCBpbmRleCA9PT0gYXR0ZW1wdHMgLSAxKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBhd2FpdCBkZWxheSgxMjApO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNJbmNvbXBsZXRlSnNvbkVycm9yKGVycm9yOiB1bmtub3duKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gZXJyb3IgaW5zdGFuY2VvZiBTeW50YXhFcnJvciAmJiAvVW5leHBlY3RlZCBlbmQgb2YgSlNPTiBpbnB1dC8udGVzdChlcnJvci5tZXNzYWdlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbGlzdEFzc2V0RmlsZXMoZGlyOiBzdHJpbmcsIGV4dGVuc2lvbnM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xyXG4gICAgY29uc3QgcmVzdWx0OiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVhZGRpclN5bmMoZGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSkpIHtcclxuICAgICAgICBjb25zdCBmdWxsUGF0aCA9IGpvaW4oZGlyLCBlbnRyeS5uYW1lKTtcclxuICAgICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xyXG4gICAgICAgICAgICByZXN1bHQucHVzaCguLi5saXN0QXNzZXRGaWxlcyhmdWxsUGF0aCwgZXh0ZW5zaW9ucykpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoZXh0ZW5zaW9ucy5pbmNsdWRlcyhleHRuYW1lKGVudHJ5Lm5hbWUpLnRvTG93ZXJDYXNlKCkpKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGZ1bGxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gbWFrZVNjcmlwdFVybChvcGVuZWRBc3NldFVybDogc3RyaW5nIHwgbnVsbCwgY2xhc3NOYW1lOiBzdHJpbmcsIHNjcmlwdFJvb3Q6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCByZWxhdGl2ZVJvb3QgPSBub3JtYWxpemVSZWxhdGl2ZVNjcmlwdFJvb3Qoc2NyaXB0Um9vdCk7XHJcbiAgICBjb25zdCBiYXNlRGlyID0gZ2V0U2NyaXB0QmFzZURpcihvcGVuZWRBc3NldFVybCk7XHJcbiAgICBjb25zdCByZXNvbHZlZERpciA9IHJlc29sdmVSZWxhdGl2ZUFzc2V0UGF0aChiYXNlRGlyLCByZWxhdGl2ZVJvb3QpO1xyXG4gICAgcmV0dXJuIGBkYjovLyR7cmVzb2x2ZWREaXJ9LyR7Y2xhc3NOYW1lfS50c2A7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFNjcmlwdEJhc2VEaXIob3BlbmVkQXNzZXRVcmw6IHN0cmluZyB8IG51bGwpOiBzdHJpbmcge1xyXG4gICAgaWYgKG9wZW5lZEFzc2V0VXJsKSB7XHJcbiAgICAgICAgY29uc3QgYnVuZGxlUm9vdCA9IGZpbmRCdW5kbGVSb290KG9wZW5lZEFzc2V0VXJsKTtcclxuICAgICAgICBpZiAoYnVuZGxlUm9vdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gYnVuZGxlUm9vdDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUHJlZmFiL3NjZW5lIGlzIG5vdCBpbnNpZGUgYW4gQXNzZXQgQnVuZGxlOiByZXNvbHZlIHJlbGF0aXZlIHRvIHByb2plY3QgYXNzZXRzIHJvb3QuXHJcbiAgICByZXR1cm4gJ2Fzc2V0cyc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZpbmRCdW5kbGVSb290KG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgIGxldCBjdXJyZW50ID0gZ2V0T3BlbmVkQXNzZXREaXJlY3Rvcnkob3BlbmVkQXNzZXRVcmwpO1xyXG5cclxuICAgIHdoaWxlIChjdXJyZW50KSB7XHJcbiAgICAgICAgaWYgKGlzQnVuZGxlRGlyZWN0b3J5KGN1cnJlbnQpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBjdXJyZW50O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGN1cnJlbnQgPT09ICdhc3NldHMnIHx8ICFjdXJyZW50LmluY2x1ZGVzKCcvJykpIHtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjdXJyZW50ID0gY3VycmVudC5zbGljZSgwLCBjdXJyZW50Lmxhc3RJbmRleE9mKCcvJykpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0J1bmRsZURpcmVjdG9yeShhc3NldFJlbGF0aXZlRGlyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IG1ldGFQYXRoID0gam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCBgJHthc3NldFJlbGF0aXZlRGlyfS5tZXRhYCk7XHJcbiAgICBpZiAoIWV4aXN0c1N5bmMobWV0YVBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgbWV0YSA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKG1ldGFQYXRoLCAndXRmOCcpKTtcclxuICAgICAgICByZXR1cm4gbWV0YT8udXNlckRhdGE/LmlzQnVuZGxlID09PSB0cnVlO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRPcGVuZWRBc3NldERpcmVjdG9yeShvcGVuZWRBc3NldFVybDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGFzc2V0UGF0aCA9IG9wZW5lZEFzc2V0VXJsXHJcbiAgICAgICAgLnJlcGxhY2UoL15kYjpcXC9cXC8vLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvXFxcXC9nLCAnLycpXHJcbiAgICAgICAgLnJlcGxhY2UoL1xcLyskLywgJycpO1xyXG5cclxuICAgIGNvbnN0IGxhc3RTbGFzaCA9IGFzc2V0UGF0aC5sYXN0SW5kZXhPZignLycpO1xyXG4gICAgaWYgKGxhc3RTbGFzaCA8IDApIHtcclxuICAgICAgICByZXR1cm4gJ2Fzc2V0cyc7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGFzc2V0UGF0aC5zbGljZSgwLCBsYXN0U2xhc2gpIHx8ICdhc3NldHMnO1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVSZWxhdGl2ZVNjcmlwdFJvb3Qoc2NyaXB0Um9vdDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHZhbHVlID0gU3RyaW5nKHNjcmlwdFJvb3QgfHwgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KS50cmltKCkucmVwbGFjZSgvXFxcXC9nLCAnLycpIHx8ICcuJztcclxuICAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cXC8rJC8sICcnKSB8fCAnLic7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlc29sdmVSZWxhdGl2ZUFzc2V0UGF0aChiYXNlRGlyOiBzdHJpbmcsIHJlbGF0aXZlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGJhc2VQYXJ0cyA9IGJhc2VEaXIucmVwbGFjZSgvXFxcXC9nLCAnLycpLnNwbGl0KCcvJykuZmlsdGVyKEJvb2xlYW4pO1xyXG4gICAgY29uc3QgcmVsYXRpdmVQYXJ0cyA9IHJlbGF0aXZlUGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJykuc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICBjb25zdCBwYXJ0cyA9IFsuLi5iYXNlUGFydHNdO1xyXG5cclxuICAgIGZvciAoY29uc3QgcGFydCBvZiByZWxhdGl2ZVBhcnRzKSB7XHJcbiAgICAgICAgaWYgKHBhcnQgPT09ICcuJykge1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChwYXJ0ID09PSAnLi4nKSB7XHJcbiAgICAgICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAgICAgICBwYXJ0cy5wb3AoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHBhcnRzLnB1c2gocGFydCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzb2x2ZWQgPSBwYXJ0cy5qb2luKCcvJykgfHwgJ2Fzc2V0cyc7XHJcbiAgICByZXR1cm4gcmVzb2x2ZWQuc3RhcnRzV2l0aCgnYXNzZXRzJykgPyByZXNvbHZlZCA6IGBhc3NldHMvJHtyZXNvbHZlZH1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzY2FuQmluZGluZ3Mocm9vdDogYW55LCBjb25maWc6IEJpbmRUb29sQ29uZmlnKTogU2Nhbm5lZEJpbmRpbmdbXSB7XHJcbiAgICBjb25zdCB1c2VkTmFtZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xyXG4gICAgY29uc3QgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10gPSBbXTtcclxuICAgIGNvbnN0IHJ1bGVzID0gZ2V0U29ydGVkRW5hYmxlZFJ1bGVzKGNvbmZpZyk7XHJcblxyXG4gICAgY29uc3QgdmlzaXQgPSAobm9kZTogYW55KSA9PiB7XHJcbiAgICAgICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShub2RlKTtcclxuICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBub2RlTmFtZS50b0xvd2VyQ2FzZSgpO1xyXG5cclxuICAgICAgICBpZiAobG93ZXJOYW1lLnN0YXJ0c1dpdGgoY29uZmlnLnN0b3BQcmVmaXgudG9Mb3dlckNhc2UoKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobm9kZSwgcnVsZXMsIHVzZWROYW1lcyk7XHJcbiAgICAgICAgaWYgKGJpbmRpbmcpIHtcclxuICAgICAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChiaW5kaW5nPy5zdG9wQ2hpbGRyZW4pIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBnZXRDaGlsZHJlbihub2RlKSkge1xyXG4gICAgICAgICAgICB2aXNpdChjaGlsZCk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICB2aXNpdChyb290KTtcclxuICAgIHJldHVybiBiaW5kaW5ncztcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0U29ydGVkRW5hYmxlZFJ1bGVzKGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBCaW5kUnVsZVtdIHtcclxuICAgIHJldHVybiBjb25maWcucnVsZXNcclxuICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlLmVuYWJsZWQgJiYgcnVsZS5wcmVmaXgpXHJcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5wcmVmaXgubGVuZ3RoIC0gbGVmdC5wcmVmaXgubGVuZ3RoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhub2RlOiBhbnksIHJ1bGVzOiBCaW5kUnVsZVtdLCB1c2VkTmFtZXM6IE1hcDxzdHJpbmcsIG51bWJlcj4pOiBTY2FubmVkQmluZGluZyB8IG51bGwge1xyXG4gICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShub2RlKTtcclxuICAgIGNvbnN0IGxvd2VyTmFtZSA9IG5vZGVOYW1lLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCBydWxlID0gcnVsZXMuZmluZCgoaXRlbSkgPT4gbG93ZXJOYW1lLnN0YXJ0c1dpdGgoaXRlbS5wcmVmaXgudG9Mb3dlckNhc2UoKSkpO1xyXG5cclxuICAgIGlmICghcnVsZSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgbm9kZVV1aWQ6IGdldFV1aWQobm9kZSksXHJcbiAgICAgICAgbm9kZU5hbWUsXHJcbiAgICAgICAgcHJvcGVydHlOYW1lOiBtYWtlVW5pcXVlTmFtZSh0b1Byb3BlcnR5TmFtZShub2RlTmFtZSksIHVzZWROYW1lcyksXHJcbiAgICAgICAgcHJvcGVydHlUeXBlOiBydWxlLnByb3BlcnR5VHlwZSxcclxuICAgICAgICBkZWNvcmF0b3JUeXBlOiBydWxlLmRlY29yYXRvclR5cGUsXHJcbiAgICAgICAgYmluZFRhcmdldDogcnVsZS5iaW5kVGFyZ2V0LFxyXG4gICAgICAgIGNvbXBvbmVudFR5cGU6IHJ1bGUuY29tcG9uZW50VHlwZSxcclxuICAgICAgICBzdG9wQ2hpbGRyZW46IHJ1bGUuc3RvcENoaWxkcmVuLFxyXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogcnVsZS5nZW5lcmF0ZUNsaWNrRXZlbnQsXHJcbiAgICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXROb2RlTmFtZShub2RlOiBhbnkpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIFN0cmluZyhyZWFkRHVtcFZhbHVlKG5vZGU/Lm5hbWUpIHx8ICdOb2RlJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFV1aWQobm9kZTogYW55KTogc3RyaW5nIHtcclxuICAgIHJldHVybiBTdHJpbmcocmVhZER1bXBWYWx1ZShub2RlPy51dWlkKSB8fCBub2RlPy51dWlkIHx8ICcnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0Q2hpbGRyZW4obm9kZTogYW55KTogYW55W10ge1xyXG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkobm9kZT8uY2hpbGRyZW4pID8gbm9kZS5jaGlsZHJlbiA6IFtdO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkRHVtcFZhbHVlKHZhbHVlOiBhbnkpOiBhbnkge1xyXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgJ3ZhbHVlJyBpbiB2YWx1ZSkge1xyXG4gICAgICAgIHJldHVybiB2YWx1ZS52YWx1ZTtcclxuICAgIH1cclxuICAgIHJldHVybiB2YWx1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9DbGFzc05hbWUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBuYW1lID0gdG9Qcm9wZXJ0eU5hbWUodmFsdWUpO1xyXG4gICAgcmV0dXJuIHVwcGVyRmlyc3QobmFtZS5yZXBsYWNlKC9eXysvLCAnJykgfHwgJ0F1dG9CaW5kQ29tcG9uZW50Jyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGx5U2NyaXB0TmFtZVByZWZpeChjbGFzc05hbWU6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgc2FmZVByZWZpeCA9IFN0cmluZyhwcmVmaXggfHwgJycpXHJcbiAgICAgICAgLnRyaW0oKVxyXG4gICAgICAgIC5yZXBsYWNlKC9bXlxccHtJRF9TdGFydH1cXHB7SURfQ29udGludWV9JF9cXHUyMDBDXFx1MjAwRF0rL2d1LCAnJyk7XHJcblxyXG4gICAgaWYgKCFzYWZlUHJlZml4IHx8ICFpc0lkZW50aWZpZXJTdGFydChzYWZlUHJlZml4WzBdKSkge1xyXG4gICAgICAgIHJldHVybiBjbGFzc05hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNsYXNzTmFtZS50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgoc2FmZVByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xyXG4gICAgICAgIHJldHVybiBjbGFzc05hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGAke3NhZmVQcmVmaXh9JHtjbGFzc05hbWV9YDtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9Qcm9wZXJ0eU5hbWUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnJlcGxhY2UoL1teXFxwe0lEX1N0YXJ0fVxccHtJRF9Db250aW51ZX0kX1xcdTIwMENcXHUyMDBEXSsvZ3UsICdfJylcclxuICAgICAgICAucmVwbGFjZSgvXysvZywgJ18nKVxyXG4gICAgICAgIC5yZXBsYWNlKC9eXyt8XyskL2csICcnKTtcclxuXHJcbiAgICBjb25zdCBjbGVhbmVkID0gbm9ybWFsaXplZFxyXG4gICAgICAgIC5zcGxpdCgnJylcclxuICAgICAgICAuZmlsdGVyKChjaGFyLCBpbmRleCkgPT4gaW5kZXggPT09IDAgPyBpc0lkZW50aWZpZXJTdGFydChjaGFyKSA6IGlzSWRlbnRpZmllckNvbnRpbnVlKGNoYXIpKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuXHJcbiAgICBpZiAoIWNsZWFuZWQpIHtcclxuICAgICAgICByZXR1cm4gJ25vZGUnO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBpc0lkZW50aWZpZXJTdGFydChjbGVhbmVkWzBdKSA/IGNsZWFuZWQgOiBgXyR7Y2xlYW5lZH1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJTdGFydChjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvWyRfXFxwe0lEX1N0YXJ0fV0vdS50ZXN0KGNoYXIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJDb250aW51ZShjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvWyRfXFx1MjAwQ1xcdTIwMERcXHB7SURfQ29udGludWV9XS91LnRlc3QoY2hhcik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1ha2VVbmlxdWVOYW1lKGJhc2VOYW1lOiBzdHJpbmcsIHVzZWROYW1lczogTWFwPHN0cmluZywgbnVtYmVyPik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBjb3VudCA9IHVzZWROYW1lcy5nZXQoYmFzZU5hbWUpIHx8IDA7XHJcbiAgICB1c2VkTmFtZXMuc2V0KGJhc2VOYW1lLCBjb3VudCArIDEpO1xyXG4gICAgcmV0dXJuIGNvdW50ID09PSAwID8gYmFzZU5hbWUgOiBgJHtiYXNlTmFtZX0ke2NvdW50ICsgMX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiB1cHBlckZpcnN0KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIHZhbHVlID8gdmFsdWVbMF0udG9VcHBlckNhc2UoKSArIHZhbHVlLnNsaWNlKDEpIDogdmFsdWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNjcmlwdChjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGBpbXBvcnQgeyAke3JlbmRlckNjSW1wb3J0cyhiaW5kaW5ncyl9IH0gZnJvbSAnY2MnO1xyXG5cclxuY29uc3QgeyBjY2NsYXNzLCBwcm9wZXJ0eSB9ID0gX2RlY29yYXRvcjtcclxuXHJcbkBjY2NsYXNzKCcke2NsYXNzTmFtZX0nKVxyXG5leHBvcnQgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgQ29tcG9uZW50IHtcclxuXHJcbiAgICAke0FVVE9fQklORF9TVEFSVH1cclxuJHtyZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzKX1cclxuICAgICR7QVVUT19CSU5EX0VORH1cclxuXHJcbiAgICBwcm90ZWN0ZWQgb25Mb2FkKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMuYmluZEJ1dHRvbkV2ZW50cygpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYmluZEJ1dHRvbkV2ZW50cygpOiB2b2lkIHtcclxuICAgICAgICAke0FVVE9fQlVUVE9OX0VWRU5UX1NUQVJUfVxyXG4ke3JlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zKX1cclxuICAgICAgICAke0FVVE9fQlVUVE9OX0VWRU5UX0VORH1cclxuICAgIH1cclxuXHJcbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlR9XHJcbiR7cmVuZGVyQnV0dG9uSGFuZGxlcnMoYnV0dG9ucyl9XHJcbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfRU5EfVxyXG59XHJcbmA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckNjSW1wb3J0cyhiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBpbXBvcnRzID0gbmV3IFNldChbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50J10pO1xyXG5cclxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xyXG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XHJcbiAgICAgICAgY29sbGVjdEltcG9ydEZyb21UeXBlKGltcG9ydHMsIGJpbmRpbmcuZGVjb3JhdG9yVHlwZSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGJpbmRpbmdzLnNvbWUoKGJpbmRpbmcpID0+IGJpbmRpbmcuZ2VuZXJhdGVDbGlja0V2ZW50KSkge1xyXG4gICAgICAgIGltcG9ydHMuYWRkKCdCdXR0b24nKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gc29ydENjSW1wb3J0cyhpbXBvcnRzKS5qb2luKCcsICcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzb3J0Q2NJbXBvcnRzKGltcG9ydHM6IEl0ZXJhYmxlPHN0cmluZz4pOiBzdHJpbmdbXSB7XHJcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQoaW1wb3J0cyldXHJcbiAgICAgICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbSAmJiBpdGVtICE9PSAnY2MnKVxyXG4gICAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IFsnX2RlY29yYXRvcicsICdDb21wb25lbnQnLCAnTm9kZScsICdCdXR0b24nLCAnTGFiZWwnLCAnU3ByaXRlJywgJ1dpZGdldCcsICdzcCddO1xyXG4gICAgICAgICAgICBjb25zdCBsZWZ0SW5kZXggPSBvcmRlci5pbmRleE9mKGxlZnQpO1xyXG4gICAgICAgICAgICBjb25zdCByaWdodEluZGV4ID0gb3JkZXIuaW5kZXhPZihyaWdodCk7XHJcbiAgICAgICAgICAgIGlmIChsZWZ0SW5kZXggIT09IC0xIHx8IHJpZ2h0SW5kZXggIT09IC0xKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gKGxlZnRJbmRleCA9PT0gLTEgPyA5OSA6IGxlZnRJbmRleCkgLSAocmlnaHRJbmRleCA9PT0gLTEgPyA5OSA6IHJpZ2h0SW5kZXgpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gbGVmdC5sb2NhbGVDb21wYXJlKHJpZ2h0KTtcclxuICAgICAgICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sbGVjdEltcG9ydEZyb21UeXBlKGltcG9ydHM6IFNldDxzdHJpbmc+LCB0eXBlTmFtZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcclxuICAgIGNvbnN0IGltcG9ydE5hbWUgPSB2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSA/IHNob3J0VHlwZU5hbWUodmFsdWUpIDogdmFsdWUuc3BsaXQoJy4nKVswXTtcclxuICAgIGlmICgvXltBLVphLXpfJF1bQS1aYS16MC05XyRdKiQvLnRlc3QoaW1wb3J0TmFtZSkpIHtcclxuICAgICAgICBpbXBvcnRzLmFkZChpbXBvcnROYW1lKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyUHJvcGVydGllcyhiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYmluZGluZ3MubWFwKChiaW5kaW5nKSA9PiBgICAgIEBwcm9wZXJ0eSgke3RvU2NyaXB0VHlwZU5hbWUoYmluZGluZy5kZWNvcmF0b3JUeXBlKX0pXHJcbiAgICBwdWJsaWMgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX06ICR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLnByb3BlcnR5VHlwZSl9IHwgbnVsbCA9IG51bGw7YCkuam9pbignXFxuXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRvU2NyaXB0VHlwZU5hbWUodHlwZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcclxuICAgIHJldHVybiB2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSA/IHNob3J0VHlwZU5hbWUodmFsdWUpIDogdmFsdWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgICAgICBpZiAodGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9KSB7XHJcbiAgICAgICAgICAgIHRoaXMuJHtidXR0b24ucHJvcGVydHlOYW1lfS5ub2RlLm9uKEJ1dHRvbi5FdmVudFR5cGUuQ0xJQ0ssIHRoaXMuJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSwgdGhpcyk7XHJcbiAgICAgICAgfWApLmpvaW4oJ1xcblxcbicpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgIHByaXZhdGUgJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSgpOiB2b2lkIHtcclxuXHJcbiAgICB9YCkuam9pbignXFxuXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENsaWNrSGFuZGxlck5hbWUocHJvcGVydHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGBvbkNsaWNrJHt1cHBlckZpcnN0KHByb3BlcnR5TmFtZS5yZXBsYWNlKC9eYnV0dG9uXz8vLCAnQnV0dG9uXycpKX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgYmluZEJsb2NrID0gcGlja0Jsb2NrKGdlbmVyYXRlZCwgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKTtcclxuICAgIGNvbnN0IGV2ZW50QmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKTtcclxuICAgIGNvbnN0IGhhbmRsZXJCbG9jayA9IG1lcmdlQnV0dG9uSGFuZGxlckJsb2NrKFxyXG4gICAgICAgIHBpY2tCbG9jayhleGlzdGluZywgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCwgQVVUT19CVVRUT05fSEFORExFUl9FTkQpLFxyXG4gICAgICAgIHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKSxcclxuICAgICk7XHJcblxyXG4gICAgaWYgKCFoYXNBbGxBdXRvQmxvY2tzKGV4aXN0aW5nKSkge1xyXG4gICAgICAgIHJldHVybiBleGlzdGluZztcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBiaW5kTWFya2VycyA9IGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKGV4aXN0aW5nLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpXHJcbiAgICAgICAgfHwgZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKVxyXG4gICAgICAgIHx8IChbQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EXSBhcyBjb25zdCk7XHJcblxyXG4gICAgbGV0IHVwZGF0ZWQgPSByZXBsYWNlQmxvY2soZXhpc3RpbmcsIGJpbmRNYXJrZXJzWzBdLCBiaW5kTWFya2Vyc1sxXSwgYmluZEJsb2NrKTtcclxuICAgIHVwZGF0ZWQgPSB1cGRhdGVkLnJlcGxhY2UoYmluZE1hcmtlcnNbMF0sIEFVVE9fQklORF9TVEFSVCkucmVwbGFjZShiaW5kTWFya2Vyc1sxXSwgQVVUT19CSU5EX0VORCk7XHJcblxyXG4gICAgY29uc3QgdXBkYXRlZEJsb2NrcyA9IHJlcGxhY2VCbG9jayhcclxuICAgICAgICByZXBsYWNlQmxvY2soXHJcbiAgICAgICAgICAgIHVwZGF0ZWQsXHJcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULFxyXG4gICAgICAgICAgICBBVVRPX0JVVFRPTl9FVkVOVF9FTkQsXHJcbiAgICAgICAgICAgIGV2ZW50QmxvY2ssXHJcbiAgICAgICAgKSxcclxuICAgICAgICBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULFxyXG4gICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5ELFxyXG4gICAgICAgIGhhbmRsZXJCbG9jayxcclxuICAgICk7XHJcblxyXG4gICAgcmV0dXJuIG1lcmdlQ2NJbXBvcnRzKHVwZGF0ZWRCbG9ja3MsIGdlbmVyYXRlZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGhhc0FsbEF1dG9CbG9ja3Moc291cmNlOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoaGFzQmxvY2soc291cmNlLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpIHx8IGhhc0Jsb2NrKHNvdXJjZSwgTEVHQUNZX0FVVE9fQklORF9TVEFSVCwgTEVHQUNZX0FVVE9fQklORF9FTkQpKVxyXG4gICAgICAgICYmIGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CVVRUT05fRVZFTlRfU1RBUlQsIEFVVE9fQlVUVE9OX0VWRU5UX0VORClcclxuICAgICAgICAmJiBoYXNCbG9jayhzb3VyY2UsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogcmVhZG9ubHkgW3N0cmluZywgc3RyaW5nXSB8IG51bGwge1xyXG4gICAgcmV0dXJuIGhhc0Jsb2NrKHNvdXJjZSwgc3RhcnQsIGVuZCkgPyBbc3RhcnQsIGVuZF0gOiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBzb3VyY2UuaW5jbHVkZXMoc3RhcnQpICYmIHNvdXJjZS5pbmNsdWRlcyhlbmQpICYmIHNvdXJjZS5pbmRleE9mKHN0YXJ0KSA8IHNvdXJjZS5pbmRleE9mKGVuZCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHBpY2tCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcclxuICAgIGNvbnN0IGVuZEluZGV4ID0gc291cmNlLmluZGV4T2YoZW5kKTtcclxuICAgIHJldHVybiBzb3VyY2Uuc2xpY2Uoc3RhcnRJbmRleCArIHN0YXJ0Lmxlbmd0aCwgZW5kSW5kZXgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZXBsYWNlQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcclxuICAgIGNvbnN0IGVuZEluZGV4ID0gc291cmNlLmluZGV4T2YoZW5kKTtcclxuICAgIHJldHVybiBgJHtzb3VyY2Uuc2xpY2UoMCwgc3RhcnRJbmRleCArIHN0YXJ0Lmxlbmd0aCl9JHtjb250ZW50fSR7c291cmNlLnNsaWNlKGVuZEluZGV4KX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtZXJnZUJ1dHRvbkhhbmRsZXJCbG9jayhleGlzdGluZ0Jsb2NrOiBzdHJpbmcsIGdlbmVyYXRlZEJsb2NrOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgZXhpc3RpbmdIYW5kbGVycyA9IG5ldyBNYXAocGFyc2VCdXR0b25IYW5kbGVycyhleGlzdGluZ0Jsb2NrKS5tYXAoKGhhbmRsZXIpID0+IFtoYW5kbGVyLm5hbWUsIGhhbmRsZXIuc291cmNlXSkpO1xyXG4gICAgY29uc3QgZ2VuZXJhdGVkSGFuZGxlcnMgPSBwYXJzZUJ1dHRvbkhhbmRsZXJzKGdlbmVyYXRlZEJsb2NrKTtcclxuXHJcbiAgICBpZiAoZ2VuZXJhdGVkSGFuZGxlcnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlZEJsb2NrO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1lcmdlZEhhbmRsZXJzID0gZ2VuZXJhdGVkSGFuZGxlcnNcclxuICAgICAgICAubWFwKChoYW5kbGVyKSA9PiBub3JtYWxpemVCdXR0b25IYW5kbGVyU291cmNlKGV4aXN0aW5nSGFuZGxlcnMuZ2V0KGhhbmRsZXIubmFtZSkgfHwgaGFuZGxlci5zb3VyY2UpKVxyXG4gICAgICAgIC5qb2luKCdcXG5cXG4nKTtcclxuXHJcbiAgICByZXR1cm4gYFxcbiR7bWVyZ2VkSGFuZGxlcnN9XFxuICAgIGA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUJ1dHRvbkhhbmRsZXJTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgbGluZXMgPSBzb3VyY2UudHJpbSgpLnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICByZXR1cm4gbGluZXMubWFwKChsaW5lLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGlmIChpbmRleCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gYCAgICAke2xpbmUudHJpbVN0YXJ0KCl9YDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGxpbmUudHJpbUVuZCgpO1xyXG4gICAgfSkuam9pbignXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHBhcnNlQnV0dG9uSGFuZGxlcnMoYmxvY2s6IHN0cmluZyk6IEFycmF5PHsgbmFtZTogc3RyaW5nOyBzb3VyY2U6IHN0cmluZyB9PiB7XHJcbiAgICBjb25zdCByZXN1bHQ6IEFycmF5PHsgbmFtZTogc3RyaW5nOyBzb3VyY2U6IHN0cmluZyB9PiA9IFtdO1xyXG4gICAgY29uc3QgbWV0aG9kUGF0dGVybiA9IC8oPzpwcml2YXRlfHByb3RlY3RlZHxwdWJsaWMpP1xccyooW0EtWmEtel8kXVtBLVphLXowLTlfJF0qKVxccypcXChbXildKlxcKVxccyo6XFxzKnZvaWRcXHMqXFx7L2c7XHJcbiAgICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XHJcblxyXG4gICAgd2hpbGUgKChtYXRjaCA9IG1ldGhvZFBhdHRlcm4uZXhlYyhibG9jaykpKSB7XHJcbiAgICAgICAgY29uc3QgbmFtZSA9IG1hdGNoWzFdO1xyXG4gICAgICAgIGNvbnN0IG1ldGhvZFN0YXJ0ID0gbWF0Y2guaW5kZXg7XHJcbiAgICAgICAgY29uc3QgYm9keU9wZW5JbmRleCA9IG1ldGhvZFBhdHRlcm4ubGFzdEluZGV4IC0gMTtcclxuICAgICAgICBjb25zdCBtZXRob2RFbmQgPSBmaW5kTWF0Y2hpbmdCcmFjZShibG9jaywgYm9keU9wZW5JbmRleCk7XHJcbiAgICAgICAgaWYgKG1ldGhvZEVuZCA9PT0gLTEpIHtcclxuICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgICAgIG5hbWUsXHJcbiAgICAgICAgICAgIHNvdXJjZTogYmxvY2suc2xpY2UobWV0aG9kU3RhcnQsIG1ldGhvZEVuZCArIDEpLnRyaW1FbmQoKSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBtZXRob2RQYXR0ZXJuLmxhc3RJbmRleCA9IG1ldGhvZEVuZCArIDE7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZnVuY3Rpb24gZmluZE1hdGNoaW5nQnJhY2Uoc291cmNlOiBzdHJpbmcsIG9wZW5JbmRleDogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgIGxldCBkZXB0aCA9IDA7XHJcbiAgICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8ICdgJyB8IG51bGwgPSBudWxsO1xyXG4gICAgbGV0IGVzY2FwZWQgPSBmYWxzZTtcclxuXHJcbiAgICBmb3IgKGxldCBpbmRleCA9IG9wZW5JbmRleDsgaW5kZXggPCBzb3VyY2UubGVuZ3RoOyBpbmRleCArPSAxKSB7XHJcbiAgICAgICAgY29uc3QgY2hhciA9IHNvdXJjZVtpbmRleF07XHJcblxyXG4gICAgICAgIGlmIChxdW90ZSkge1xyXG4gICAgICAgICAgICBpZiAoZXNjYXBlZCkge1xyXG4gICAgICAgICAgICAgICAgZXNjYXBlZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGNoYXIgPT09ICdcXFxcJykge1xyXG4gICAgICAgICAgICAgICAgZXNjYXBlZCA9IHRydWU7XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gcXVvdGUpIHtcclxuICAgICAgICAgICAgICAgIHF1b3RlID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChjaGFyID09PSAnXCInIHx8IGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09ICdgJykge1xyXG4gICAgICAgICAgICBxdW90ZSA9IGNoYXI7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGNoYXIgPT09ICd7Jykge1xyXG4gICAgICAgICAgICBkZXB0aCArPSAxO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gJ30nKSB7XHJcbiAgICAgICAgICAgIGRlcHRoIC09IDE7XHJcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGluZGV4O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiAtMTtcclxufVxyXG5cclxuZnVuY3Rpb24gbWVyZ2VDY0ltcG9ydHMoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgaW1wb3J0UGF0dGVybiA9IC9eaW1wb3J0XFxzK1xce1xccyooW159XSs/KVxccypcXH1cXHMrZnJvbVxccytbJ1wiXWNjWydcIl07XFxzKiQvbTtcclxuICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBleGlzdGluZy5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcclxuICAgIGNvbnN0IGdlbmVyYXRlZE1hdGNoID0gZ2VuZXJhdGVkLm1hdGNoKGltcG9ydFBhdHRlcm4pO1xyXG5cclxuICAgIGlmICghZ2VuZXJhdGVkTWF0Y2gpIHtcclxuICAgICAgICByZXR1cm4gZXhpc3Rpbmc7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFleGlzdGluZ01hdGNoKSB7XHJcbiAgICAgICAgcmV0dXJuIGAke2dlbmVyYXRlZE1hdGNoWzBdfVxcbiR7ZXhpc3Rpbmd9YDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBtZXJnZWQgPSBzb3J0Q2NJbXBvcnRzKFtcclxuICAgICAgICAuLi5wYXJzZUNjSW1wb3J0TmFtZXMoZXhpc3RpbmdNYXRjaFsxXSksXHJcbiAgICAgICAgLi4ucGFyc2VDY0ltcG9ydE5hbWVzKGdlbmVyYXRlZE1hdGNoWzFdKSxcclxuICAgICAgICAuLi5kZXRlY3RVc2VkQ2NTeW1ib2xzKGV4aXN0aW5nKSxcclxuICAgIF0pO1xyXG5cclxuICAgIHJldHVybiBleGlzdGluZy5yZXBsYWNlKGltcG9ydFBhdHRlcm4sIGBpbXBvcnQgeyAke21lcmdlZC5qb2luKCcsICcpfSB9IGZyb20gJ2NjJztgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcGFyc2VDY0ltcG9ydE5hbWVzKGltcG9ydHM6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgIHJldHVybiBpbXBvcnRzXHJcbiAgICAgICAgLnNwbGl0KCcsJylcclxuICAgICAgICAubWFwKChpdGVtKSA9PiBpdGVtLnRyaW0oKSlcclxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZXRlY3RVc2VkQ2NTeW1ib2xzKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgICAnTm9kZScsXHJcbiAgICAgICAgJ0J1dHRvbicsXHJcbiAgICAgICAgJ0xhYmVsJyxcclxuICAgICAgICAnU3ByaXRlJyxcclxuICAgICAgICAnV2lkZ2V0JyxcclxuICAgICAgICAnVUlUcmFuc2Zvcm0nLFxyXG4gICAgICAgICdQcm9ncmVzc0JhcicsXHJcbiAgICAgICAgJ1Njcm9sbFZpZXcnLFxyXG4gICAgICAgICdUb2dnbGUnLFxyXG4gICAgICAgICdTbGlkZXInLFxyXG4gICAgICAgICdFZGl0Qm94JyxcclxuICAgICAgICAnUmljaFRleHQnLFxyXG4gICAgXTtcclxuXHJcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5maWx0ZXIoKG5hbWUpID0+IG5ldyBSZWdFeHAoYFxcXFxiJHtuYW1lfVxcXFxiYCkudGVzdChzb3VyY2UpKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZEFzc2V0VGV4dCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcclxuICAgIGlmICghYXNzZXQ/LmZpbGUpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFzc2V0LmZpbGUsICd1dGY4Jyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHdyaXRlQXNzZXQodXJsOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBjcmVhdGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoY3JlYXRlZCkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ2NyZWF0ZS1hc3NldCcsIHVybCwgc291cmNlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldCcsIHVybCwgc291cmNlKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5QXR0YWNoQ29tcG9uZW50KG5vZGVVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgaWYgKGF3YWl0IGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkLCBjbGFzc05hbWUpKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVnaXN0ZXJlZENhbmRpZGF0ZXMgPSBhd2FpdCB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWUsIHNjcmlwdFVybCk7XHJcbiAgICBpZiAocmVnaXN0ZXJlZENhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBTY3JpcHQgY29tcG9uZW50ICR7Y2xhc3NOYW1lfSB3YXMgbm90IHJlZ2lzdGVyZWQgeWV0LiBUcnlpbmcgdG8gYXR0YWNoIGFueXdheS5gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb21wb25lbnRDYW5kaWRhdGVzID0gWy4uLm5ldyBTZXQoW1xyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBub3JtYWxpemVDbGFzc05hbWUoY2xhc3NOYW1lKSxcclxuICAgICAgICAuLi5yZWdpc3RlcmVkQ2FuZGlkYXRlcyxcclxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKV07XHJcblxyXG4gICAgZm9yIChjb25zdCBjb21wb25lbnROYW1lIG9mIGNvbXBvbmVudENhbmRpZGF0ZXMpIHtcclxuICAgICAgICBpZiAoYXdhaXQgY3JlYXRlQ29tcG9uZW50QW5kVmVyaWZ5KG5vZGVVdWlkLCBjb21wb25lbnROYW1lLCBjb21wb25lbnRDYW5kaWRhdGVzKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0VXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XHJcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyAxMjAwMDtcclxuICAgIGNvbnN0IHNjcmlwdEFzc2V0ID0gYXdhaXQgcXVlcnlBc3NldEluZm9TYWZlKHNjcmlwdFVybCk7XHJcbiAgICBjb25zdCBjYWNoZWRDaWQgPSByZWFkU2NyaXB0Q2lkRnJvbVByb2dyYW1DYWNoZShzY3JpcHRBc3NldCwgY2xhc3NOYW1lKTtcclxuICAgIGxldCBsb2dnZWQgPSBmYWxzZTtcclxuXHJcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHF1ZXJ5UmVnaXN0ZXJlZFNjcmlwdENvbXBvbmVudENhbmRpZGF0ZXMoY2xhc3NOYW1lLCBzY3JpcHRBc3NldCk7XHJcbiAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQoWy4uLmNhbmRpZGF0ZXMsIC4uLmNhY2hlZENpZF0pXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICghbG9nZ2VkKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBXYWl0aW5nIGZvciBzY3JpcHQgaW1wb3J0OiAke2NsYXNzTmFtZX1gKTtcclxuICAgICAgICAgICAgbG9nZ2VkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IGRlbGF5KDUwMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNhY2hlZENpZDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlBc3NldEluZm9TYWZlKHVybDogc3RyaW5nKTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeVJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRBc3NldDogYW55IHwgbnVsbCk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50cyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudHMnKTtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29tcG9uZW50cykpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgc2NyaXB0VXVpZCA9IHNjcmlwdEFzc2V0Py51dWlkID8gU3RyaW5nKHNjcmlwdEFzc2V0LnV1aWQpIDogJyc7XHJcbiAgICAgICAgY29uc3Qgc2NyaXB0VXJsID0gc2NyaXB0QXNzZXQ/LnVybCA/IFN0cmluZyhzY3JpcHRBc3NldC51cmwpIDogJyc7XHJcbiAgICAgICAgY29uc3Qgc2NyaXB0RmlsZSA9IHNjcmlwdEFzc2V0Py5maWxlID8gU3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xyXG4gICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5uYW1lLFxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/LnBhdGgsXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/LmFzc2V0VXVpZCxcclxuICAgICAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgbWF0Y2hlZCA9IGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIGNsYXNzTmFtZSkpXHJcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFV1aWQgJiYgY2FuZGlkYXRlcy5pbmNsdWRlcyhzY3JpcHRVdWlkKSlcclxuICAgICAgICAgICAgICAgIHx8IEJvb2xlYW4oc2NyaXB0VXJsICYmIGNhbmRpZGF0ZXMuaW5jbHVkZXMoc2NyaXB0VXJsKSlcclxuICAgICAgICAgICAgICAgIHx8IEJvb2xlYW4oc2NyaXB0RmlsZSAmJiBjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA9PT0gc2NyaXB0RmlsZSkpO1xyXG5cclxuICAgICAgICAgICAgaWYgKG1hdGNoZWQpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLmNhbmRpZGF0ZXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0LmZpbHRlcigoY2FuZGlkYXRlKSA9PiBpc0NvbXBvbmVudEF0dGFjaENhbmRpZGF0ZShjYW5kaWRhdGUpKSldO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBxdWVyeSByZWdpc3RlcmVkIGNvbXBvbmVudHMuYCwgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaXNDb21wb25lbnRBdHRhY2hDYW5kaWRhdGUoY2FuZGlkYXRlOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvXltBLVphLXowLTlfJC4vOkAtXSskLy50ZXN0KGNhbmRpZGF0ZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0OiBhbnkgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgIGlmICghc2NyaXB0QXNzZXQ/LmZpbGUpIHtcclxuICAgICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc291cmNlVXJsID0gYGZpbGU6Ly8vJHtTdHJpbmcoc2NyaXB0QXNzZXQuZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpfWA7XHJcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XHJcbiAgICBjb25zdCB0YXJnZXRzID0gW1xyXG4gICAgICAgIGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ3RlbXAnLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ2VkaXRvcicpLFxyXG4gICAgICAgIGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ3RlbXAnLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ3ByZXZpZXcnKSxcclxuICAgIF07XHJcblxyXG4gICAgZm9yIChjb25zdCB0YXJnZXREaXIgb2YgdGFyZ2V0cykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGltcG9ydE1hcFBhdGggPSBqb2luKHRhcmdldERpciwgJ2ltcG9ydC1tYXAuanNvbicpO1xyXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoaW1wb3J0TWFwUGF0aCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXAgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhpbXBvcnRNYXBQYXRoLCAndXRmOCcpKTtcclxuICAgICAgICAgICAgY29uc3QgY2h1bmtSZWxhdGl2ZSA9IGltcG9ydE1hcD8uaW1wb3J0cz8uW3NvdXJjZVVybF0gfHwgaW1wb3J0TWFwPy5bc291cmNlVXJsXTtcclxuICAgICAgICAgICAgaWYgKCFjaHVua1JlbGF0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgY2h1bmtGaWxlID0gam9pbih0YXJnZXREaXIsIFN0cmluZyhjaHVua1JlbGF0aXZlKS5yZXBsYWNlKC9eXFwuXFwvLywgJycpKTtcclxuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGNodW5rRmlsZSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBjaHVua1NvdXJjZSA9IHJlYWRGaWxlU3luYyhjaHVua0ZpbGUsICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGVzY2FwZWRDbGFzc05hbWUgPSBjbGFzc05hbWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcclxuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBjaHVua1NvdXJjZS5tYXRjaChuZXcgUmVnRXhwKGBfUkZcXFxcLnB1c2hcXFxcKFxcXFx7XFxcXH0sXFxcXHMqW1wiJ10oW15cIiddKylbXCInXSxcXFxccypbXCInXSR7ZXNjYXBlZENsYXNzTmFtZX1bXCInXWApKTtcclxuICAgICAgICAgICAgaWYgKG1hdGNoPy5bMV0pIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG1hdGNoWzFdKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlYWQgc2NyaXB0IGNpZCBmcm9tIHByb2dyYW0gY2FjaGUuYCwgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0KV07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudEFuZFZlcmlmeShub2RlVXVpZDogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcsIG1hdGNoTmFtZXM6IHN0cmluZ1tdKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XHJcbiAgICAgICAgICAgIHV1aWQ6IG5vZGVVdWlkLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ6IGNvbXBvbmVudE5hbWUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYXdhaXQgZGVsYXkoMTAwKTtcclxuICAgICAgICBpZiAoYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIG1hdGNoTmFtZXMpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIGNyZWF0ZS1jb21wb25lbnQgcmV0dXJuZWQgYnV0ICR7Y29tcG9uZW50TmFtZX0gd2FzIG5vdCBmb3VuZCBvbiB0aGUgbm9kZS5gKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGF0dGFjaCBjb21wb25lbnQgJHtjb21wb25lbnROYW1lfS5gLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVDbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGNsYXNzTmFtZS5yZXBsYWNlKC9bXkEtWmEtejAtOV8kXFxwe0lEX1N0YXJ0fVxccHtJRF9Db250aW51ZX1cXHUyMDBDXFx1MjAwRF0vZ3UsICdfJyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGJpbmRDb21wb25lbnRQcm9wZXJ0aWVzKG5vZGVVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xyXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudFV1aWQgPSBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgZ2V0U2VyaWFsaXplZFNjcmlwdFR5cGVOYW1lcyhzY3JpcHRBc3NldCwgY2xhc3NOYW1lKSk7XHJcbiAgICBpZiAoIWNvbXBvbmVudFV1aWQpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIGNvbXBvbmVudCAke2NsYXNzTmFtZX0gZm9yIHByb3BlcnR5IGJpbmRpbmcuYCk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29tcG9uZW50RHVtcCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudCcsIGNvbXBvbmVudFV1aWQpO1xyXG4gICAgbGV0IGJvdW5kQ291bnQgPSAwO1xyXG5cclxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xyXG4gICAgICAgIGNvbnN0IHByb3BlcnR5RHVtcCA9IGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wLCBiaW5kaW5nLnByb3BlcnR5TmFtZSk7XHJcbiAgICAgICAgaWYgKCFwcm9wZXJ0eUR1bXApIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCBwcm9wZXJ0eSBkdW1wICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9LmApO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRhcmdldFV1aWQgPSBiaW5kaW5nLmJpbmRUYXJnZXQgPT09ICdub2RlJ1xyXG4gICAgICAgICAgICA/IGJpbmRpbmcubm9kZVV1aWRcclxuICAgICAgICAgICAgOiBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChiaW5kaW5nLm5vZGVVdWlkLCBiaW5kaW5nLmNvbXBvbmVudFR5cGUgfHwgYmluZGluZy5wcm9wZXJ0eVR5cGUpO1xyXG5cclxuICAgICAgICBpZiAoIXRhcmdldFV1aWQpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCB0YXJnZXQgZm9yICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9LmApO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChhd2FpdCBzZXRSZWZlcmVuY2VQcm9wZXJ0eShjb21wb25lbnRVdWlkLCBiaW5kaW5nLnByb3BlcnR5TmFtZSwgcHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKSkge1xyXG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBib3VuZENvdW50O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZDogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcgfCBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBub2RlVXVpZCk7XHJcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcclxuICAgIGNvbnN0IGNvbXBvbmVudE5hbWVzID0gQXJyYXkuaXNBcnJheShjb21wb25lbnROYW1lKSA/IGNvbXBvbmVudE5hbWUgOiBbY29tcG9uZW50TmFtZV07XHJcblxyXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xyXG4gICAgICAgIGNvbnN0IGNvbXBvbmVudEFueSA9IGNvbXBvbmVudCBhcyBhbnk7XHJcbiAgICAgICAgY29uc3QgdXVpZCA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8udmFsdWU/LnV1aWQpIHx8IHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py51dWlkKSB8fCAnJyk7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py50eXBlLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5uYW1lLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5fX3R5cGVfXyxcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy50eXBlLFxyXG4gICAgICAgIF0ubWFwKHJlYWREdW1wVmFsdWUpLmZpbHRlcihCb29sZWFuKS5tYXAoU3RyaW5nKTtcclxuXHJcbiAgICAgICAgaWYgKGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBjb21wb25lbnROYW1lcy5zb21lKChuYW1lKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIG5hbWUpKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHV1aWQgfHwgbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wOiBhbnksIHByb3BlcnR5TmFtZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XHJcbiAgICBjb25zdCBkdW1wID0gY29tcG9uZW50RHVtcD8udmFsdWU/Lltwcm9wZXJ0eU5hbWVdIHx8IGNvbXBvbmVudER1bXA/Lltwcm9wZXJ0eU5hbWVdO1xyXG4gICAgcmV0dXJuIGR1bXAgJiYgdHlwZW9mIGR1bXAgPT09ICdvYmplY3QnID8gZHVtcCA6IG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHNldFJlZmVyZW5jZVByb3BlcnR5KGNvbXBvbmVudFV1aWQ6IHN0cmluZywgcHJvcGVydHlOYW1lOiBzdHJpbmcsIHByb3BlcnR5RHVtcDogYW55LCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGR1bXAgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NldC1wcm9wZXJ0eScsIHtcclxuICAgICAgICAgICAgICAgIHV1aWQ6IGNvbXBvbmVudFV1aWQsXHJcbiAgICAgICAgICAgICAgICBwYXRoOiBwcm9wZXJ0eU5hbWUsXHJcbiAgICAgICAgICAgICAgICBkdW1wLFxyXG4gICAgICAgICAgICAgICAgcmVjb3JkOiB0cnVlLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYmluZCAke3Byb3BlcnR5TmFtZX0gd2l0aCBvbmUgcmVmZXJlbmNlIGR1bXAgY2FuZGlkYXRlLmAsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IGFueVtdIHtcclxuICAgIGNvbnN0IGJhc2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHByb3BlcnR5RHVtcCkpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlczogYW55W10gPSBbXTtcclxuXHJcbiAgICBjYW5kaWRhdGVzLnB1c2goe1xyXG4gICAgICAgIC4uLmJhc2UsXHJcbiAgICAgICAgdmFsdWU6IHtcclxuICAgICAgICAgICAgdXVpZDogdGFyZ2V0VXVpZCxcclxuICAgICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcclxuICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgIHZhbHVlOiB0YXJnZXRVdWlkLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcclxuICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgICAgIF9fdXVpZF9fOiB0YXJnZXRVdWlkLFxyXG4gICAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoYmFzZS52YWx1ZSAmJiB0eXBlb2YgYmFzZS52YWx1ZSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBjYW5kaWRhdGVzLnVuc2hpZnQoe1xyXG4gICAgICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgICAgICB2YWx1ZToge1xyXG4gICAgICAgICAgICAgICAgLi4uYmFzZS52YWx1ZSxcclxuICAgICAgICAgICAgICAgIHV1aWQ6IHRhcmdldFV1aWQsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXM7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGJpbmRTZXJpYWxpemVkQXNzZXRSZWZlcmVuY2VzKG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLCBzY3JpcHRVcmw6IHN0cmluZywgc2VsZWN0ZWRVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCByb290TmFtZTogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IFByb21pc2U8bnVtYmVyPiB7XHJcbiAgICBpZiAoIW9wZW5lZEFzc2V0VXJsKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgb3BlbmVkQXNzZXRVcmwpO1xyXG4gICAgaWYgKCFhc3NldD8uZmlsZSB8fCAhL1xcLihwcmVmYWJ8c2NlbmUpJC9pLnRlc3QoYXNzZXQuZmlsZSkpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVhZEpzb25GaWxlV2l0aFJldHJ5KGFzc2V0LmZpbGUpO1xyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEpKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm9kZUlkQnlVdWlkID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcclxuICAgIGNvbnN0IG5vZGVJZEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudElkQnlOb2RlTmFtZUFuZFR5cGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xyXG5cclxuICAgIGRhdGEuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcclxuICAgICAgICBpZiAoaXRlbT8uX190eXBlX18gPT09ICdjYy5Ob2RlJykge1xyXG4gICAgICAgICAgICBjb25zdCBub2RlVXVpZCA9IGl0ZW0/Ll9pZCB8fCBpdGVtPy5fdXVpZCB8fCAnJztcclxuICAgICAgICAgICAgaWYgKG5vZGVVdWlkKSB7XHJcbiAgICAgICAgICAgICAgICBub2RlSWRCeVV1aWQuc2V0KG5vZGVVdWlkLCBpbmRleCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fbmFtZSA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgICAgIG5vZGVJZEJ5TmFtZS5zZXQoaXRlbS5fbmFtZSwgaW5kZXgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGl0ZW0/Lm5vZGU/Ll9faWRfXztcclxuICAgICAgICBjb25zdCBub2RlID0gTnVtYmVyLmlzSW50ZWdlcihub2RlSWQpID8gZGF0YVtub2RlSWRdIDogbnVsbDtcclxuICAgICAgICBjb25zdCBub2RlVXVpZCA9IG5vZGU/Ll9pZCB8fCBub2RlPy5fdXVpZCB8fCAnJztcclxuICAgICAgICBjb25zdCBub2RlTmFtZSA9IG5vZGU/Ll9uYW1lIHx8ICcnO1xyXG4gICAgICAgIGlmICh0eXBlb2YgaXRlbT8uX190eXBlX18gIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChub2RlVXVpZCkge1xyXG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLnNldChgJHtub2RlVXVpZH06JHtpdGVtLl9fdHlwZV9ffWAsIGluZGV4KTtcclxuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5zZXQoYCR7bm9kZVV1aWR9OiR7c2hvcnRUeXBlTmFtZShpdGVtLl9fdHlwZV9fKX1gLCBpbmRleCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAobm9kZU5hbWUpIHtcclxuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5zZXQoYCR7bm9kZU5hbWV9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XHJcbiAgICAgICAgICAgIGNvbXBvbmVudElkQnlOb2RlTmFtZUFuZFR5cGUuc2V0KGAke25vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXyl9YCwgaW5kZXgpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlbGVjdGVkTm9kZUlkID0gbm9kZUlkQnlVdWlkLmdldChzZWxlY3RlZFV1aWQpID8/IG5vZGVJZEJ5TmFtZS5nZXQocm9vdE5hbWUpO1xyXG4gICAgaWYgKHNlbGVjdGVkTm9kZUlkID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzY3JpcHRBc3NldCA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvU2FmZShzY3JpcHRVcmwpO1xyXG4gICAgY29uc3Qgc2NyaXB0VHlwZU5hbWVzID0gZ2V0U2VyaWFsaXplZFNjcmlwdFR5cGVOYW1lcyhzY3JpcHRBc3NldCwgY2xhc3NOYW1lKTtcclxuICAgIGxldCB0YXJnZXRDb21wb25lbnQgPSBkYXRhLmZpbmQoKGl0ZW0pID0+IHtcclxuICAgICAgICBpZiAodHlwZW9mIGl0ZW0/Ll9fdHlwZV9fICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XHJcbiAgICAgICAgY29uc3Qgbm9kZSA9IE51bWJlci5pc0ludGVnZXIobm9kZUlkKSA/IGRhdGFbbm9kZUlkXSA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgYXR0YWNoZWRUb1NlbGVjdGVkTm9kZSA9IG5vZGVJZCA9PT0gc2VsZWN0ZWROb2RlSWQgfHwgbm9kZT8uX25hbWUgPT09IHJvb3ROYW1lO1xyXG4gICAgICAgIGNvbnN0IGhhc0dlbmVyYXRlZFByb3BlcnR5ID0gYmluZGluZ3Muc29tZSgoYmluZGluZykgPT4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGl0ZW0sIGJpbmRpbmcucHJvcGVydHlOYW1lKSk7XHJcblxyXG4gICAgICAgIHJldHVybiBzY3JpcHRUeXBlTmFtZXMuaW5jbHVkZXMoaXRlbS5fX3R5cGVfXylcclxuICAgICAgICAgICAgfHwgaXRlbS5fX3R5cGVfXyA9PT0gY2xhc3NOYW1lXHJcbiAgICAgICAgICAgIHx8IHNob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXykgPT09IGNsYXNzTmFtZVxyXG4gICAgICAgICAgICB8fCAoYXR0YWNoZWRUb1NlbGVjdGVkTm9kZSAmJiBoYXNHZW5lcmF0ZWRQcm9wZXJ0eSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoIXRhcmdldENvbXBvbmVudCkge1xyXG4gICAgICAgIHRhcmdldENvbXBvbmVudCA9IGFwcGVuZFNlcmlhbGl6ZWRTY3JpcHRDb21wb25lbnQoZGF0YSwgc2VsZWN0ZWROb2RlSWQsIHNjcmlwdFR5cGVOYW1lc1swXSB8fCBjbGFzc05hbWUsIGJpbmRpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgaWYgKGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vZGVJZCA9IG5vZGVJZEJ5VXVpZC5nZXQoYmluZGluZy5ub2RlVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChiaW5kaW5nLm5vZGVOYW1lKTtcclxuICAgICAgICAgICAgaWYgKG5vZGVJZCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IG5vZGVJZCB9O1xyXG4gICAgICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdHlwZU5hbWUgPSBiaW5kaW5nLmNvbXBvbmVudFR5cGUgfHwgYmluZGluZy5wcm9wZXJ0eVR5cGU7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50SWQgPSBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3R5cGVOYW1lfWApXHJcbiAgICAgICAgICAgID8/IGNvbXBvbmVudElkQnlOb2RlVXVpZEFuZFR5cGUuZ2V0KGAke2JpbmRpbmcubm9kZVV1aWR9OiR7c2hvcnRUeXBlTmFtZSh0eXBlTmFtZSl9YClcclxuICAgICAgICAgICAgPz8gY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlTmFtZX06JHt0eXBlTmFtZX1gKVxyXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApO1xyXG5cclxuICAgICAgICBpZiAoY29tcG9uZW50SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IGNvbXBvbmVudElkIH07XHJcbiAgICAgICAgICAgIGJvdW5kQ291bnQgKz0gMTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgd3JpdGVGaWxlU3luYyhhc3NldC5maWxlLCBgJHtKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKX1cXG5gLCAndXRmOCcpO1xyXG4gICAgcmV0dXJuIGJvdW5kQ291bnQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KFtcclxuICAgICAgICAuLi5yZWFkU2NyaXB0Q2lkRnJvbVByb2dyYW1DYWNoZShzY3JpcHRBc3NldCwgY2xhc3NOYW1lKSxcclxuICAgICAgICBjbGFzc05hbWUsXHJcbiAgICBdLmZpbHRlcihCb29sZWFuKSldO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBlbmRTZXJpYWxpemVkU2NyaXB0Q29tcG9uZW50KGRhdGE6IGFueVtdLCBub2RlSWQ6IG51bWJlciwgc2NyaXB0VHlwZTogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IGFueSB7XHJcbiAgICBjb25zdCBub2RlID0gZGF0YVtub2RlSWRdO1xyXG4gICAgY29uc3QgY29tcG9uZW50SWQgPSBkYXRhLmxlbmd0aDtcclxuICAgIGNvbnN0IHByZWZhYkluZm9JZCA9IGNvbXBvbmVudElkICsgMTtcclxuICAgIGNvbnN0IGNvbXBvbmVudDogYW55ID0ge1xyXG4gICAgICAgIF9fdHlwZV9fOiBzY3JpcHRUeXBlLFxyXG4gICAgICAgIF9uYW1lOiAnJyxcclxuICAgICAgICBfb2JqRmxhZ3M6IDAsXHJcbiAgICAgICAgX19lZGl0b3JFeHRyYXNfXzoge30sXHJcbiAgICAgICAgbm9kZToge1xyXG4gICAgICAgICAgICBfX2lkX186IG5vZGVJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIF9lbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIF9fcHJlZmFiOiB7XHJcbiAgICAgICAgICAgIF9faWRfXzogcHJlZmFiSW5mb0lkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX2lkOiAnJyxcclxuICAgIH07XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgY29tcG9uZW50W2JpbmRpbmcucHJvcGVydHlOYW1lXSA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcHJlZmFiSW5mbyA9IHtcclxuICAgICAgICBfX3R5cGVfXzogJ2NjLkNvbXBQcmVmYWJJbmZvJyxcclxuICAgICAgICBmaWxlSWQ6IG1ha2VQcmVmYWJGaWxlSWQoKSxcclxuICAgIH07XHJcblxyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG5vZGUuX2NvbXBvbmVudHMpKSB7XHJcbiAgICAgICAgbm9kZS5fY29tcG9uZW50cyA9IFtdO1xyXG4gICAgfVxyXG4gICAgbm9kZS5fY29tcG9uZW50cy5wdXNoKHsgX19pZF9fOiBjb21wb25lbnRJZCB9KTtcclxuICAgIGRhdGEucHVzaChjb21wb25lbnQsIHByZWZhYkluZm8pO1xyXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcclxufVxyXG5cclxuZnVuY3Rpb24gbWFrZVByZWZhYkZpbGVJZCgpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgY2hhcnMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XHJcbiAgICBjb25zdCBieXRlcyA9IHJhbmRvbUJ5dGVzKDIyKTtcclxuICAgIGxldCByZXN1bHQgPSAnJztcclxuICAgIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xyXG4gICAgICAgIHJlc3VsdCArPSBjaGFyc1tieXRlICUgY2hhcnMubGVuZ3RoXTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNob3J0VHlwZU5hbWUodHlwZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiB0eXBlLnNwbGl0KCcuJykucG9wKCkgfHwgdHlwZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdLCBjb25maWc6IEJpbmRUb29sQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWNvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAoY29uc3QgYnV0dG9uIG9mIGJ1dHRvbnMpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIGJ1dHRvbi5ub2RlVXVpZCk7XHJcbiAgICAgICAgICAgIGlmIChoYXNDb21wb25lbnQobm9kZSwgJ0J1dHRvbicpKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50VHlwZSA9IGJ1dHRvbi5jb21wb25lbnRUeXBlIHx8ICdjYy5CdXR0b24nO1xyXG4gICAgICAgICAgICBhd2FpdCBjcmVhdGVDb21wb25lbnRXaXRoRmFsbGJhY2soYnV0dG9uLm5vZGVVdWlkLCBbY29tcG9uZW50VHlwZSwgc2hvcnRUeXBlTmFtZShjb21wb25lbnRUeXBlKV0pO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGVuc3VyZSBCdXR0b24gY29tcG9uZW50IG9uICR7YnV0dG9uLm5vZGVOYW1lfS5gLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNDb21wb25lbnQobm9kZTogYW55LCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xyXG4gICAgcmV0dXJuIGNvbXBvbmVudHMuc29tZSgoY29tcG9uZW50OiBhbnkpID0+IHtcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnR5cGUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8ubmFtZSxcclxuICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Ll9fdHlwZV9fLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5jaWQsXHJcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgY29tcG9uZW50TmFtZSkpO1xyXG4gICAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZTogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGxlZnQgPSBjYW5kaWRhdGUudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IHJpZ2h0ID0gY29tcG9uZW50TmFtZS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgY29uc3QgbGVmdFNob3J0ID0gc2hvcnRUeXBlTmFtZShjYW5kaWRhdGUpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCByaWdodFNob3J0ID0gc2hvcnRUeXBlTmFtZShjb21wb25lbnROYW1lKS50b0xvd2VyQ2FzZSgpO1xyXG5cclxuICAgIHJldHVybiBsZWZ0ID09PSByaWdodFxyXG4gICAgICAgIHx8IGxlZnRTaG9ydCA9PT0gcmlnaHRTaG9ydFxyXG4gICAgICAgIHx8IGxlZnQuZW5kc1dpdGgoYC4ke3JpZ2h0U2hvcnR9YClcclxuICAgICAgICB8fCBsZWZ0LmluY2x1ZGVzKHJpZ2h0KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgbGV0IGxhc3RFcnJvcjogdW5rbm93bjtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnROYW1lcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XHJcbiAgICAgICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudCxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBsYXN0RXJyb3IgPSBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbGFzdEVycm9yO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWxheShtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcclxufVxyXG4iXX0=