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
    scriptRoot: 'assets/src',
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
        await Editor.Profile.setProject(PACKAGE_NAME, 'autoAddButtonComponent', nextConfig.autoAddButtonComponent);
        await Editor.Profile.setProject(PACKAGE_NAME, 'overwriteMode', nextConfig.overwriteMode);
        await Editor.Profile.setProject(PACKAGE_NAME, 'stopPrefix', nextConfig.stopPrefix);
        await Editor.Profile.setProject(PACKAGE_NAME, 'rules', nextConfig.rules);
        return nextConfig;
    },
    async resetConfig() {
        await Editor.Profile.setProject(PACKAGE_NAME, 'scriptRoot', defaultConfig.scriptRoot);
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
    const className = toClassName(nodeName);
    const config = await readConfig();
    const openedAssetUrl = await queryOpenedAssetUrl(selectedTree);
    if (!openedAssetUrl) {
        throw new Error('Cannot locate the opened prefab or scene asset. Please save the prefab/scene and run bind again.');
    }
    const scriptUrl = makeScriptUrl(openedAssetUrl, className, config.scriptRoot);
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
        bindings: scan,
        buttons,
        created,
        componentAttached,
        propertiesBound,
    };
}
async function readConfig() {
    try {
        const projectConfig = await Editor.Profile.getProject(PACKAGE_NAME);
        return Object.assign(Object.assign(Object.assign({}, defaultConfig), (projectConfig || {})), { rules: normalizeRules(projectConfig === null || projectConfig === void 0 ? void 0 : projectConfig.rules) });
    }
    catch (_a) {
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
    try {
        const savedId = await Editor.Message.request('scene', 'save-scene');
        if (!savedId) {
            return findAssetUrlByNodeTreeWithRetry(selectedTree);
        }
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', savedId);
        return (asset === null || asset === void 0 ? void 0 : asset.url) || (asset === null || asset === void 0 ? void 0 : asset.source) || findAssetUrlByNodeTreeWithRetry(selectedTree);
    }
    catch (_a) {
        return findAssetUrlByNodeTreeWithRetry(selectedTree);
    }
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
    const childNames = new Set(getChildren(selectedTree).map(getNodeName));
    const candidates = listAssetFiles(assetsDir, ['.prefab', '.scene']);
    for (const file of candidates) {
        try {
            const data = readJsonFileSync(file);
            if (!Array.isArray(data)) {
                continue;
            }
            const nodes = data.filter((item) => (item === null || item === void 0 ? void 0 : item.__type__) === 'cc.Node');
            const hasRoot = nodes.some((node) => (node === null || node === void 0 ? void 0 : node._name) === rootName);
            if (!hasRoot) {
                continue;
            }
            const nodeNames = new Set(nodes.map((node) => node === null || node === void 0 ? void 0 : node._name).filter(Boolean));
            const childMatchCount = [...childNames].filter((name) => nodeNames.has(name)).length;
            if (childNames.size === 0 || childMatchCount > 0 || (0, path_1.basename)(file, (0, path_1.extname)(file)) === rootName) {
                const assetRelative = (0, path_1.relative)(Editor.Project.path, file).replace(/\\/g, '/');
                return `db://${assetRelative}`;
            }
        }
        catch (error) {
            if (!isIncompleteJsonError(error)) {
                console.warn(`[${PACKAGE_NAME}] Failed to inspect asset ${file}.`, error);
            }
        }
    }
    return null;
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
    const normalizedRoot = normalizeAssetPath(scriptRoot || defaultConfig.scriptRoot).replace(/\/+$/, '');
    const rootScriptUrl = `db://${normalizedRoot}/${className}.ts`;
    if (assetUrlExists(rootScriptUrl)) {
        return rootScriptUrl;
    }
    if (!openedAssetUrl) {
        return rootScriptUrl;
    }
    const assetPath = openedAssetUrl
        .replace(/^db:\/\//, '')
        .replace(/\.(prefab|scene)$/i, '')
        .replace(/\\/g, '/');
    const relativePath = assetPath.startsWith('assets/')
        ? assetPath.slice('assets/'.length)
        : assetPath.replace(/^.*?assets\//, '');
    const dir = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
    return `db://${normalizedRoot}${dir ? `/${dir}` : ''}/${className}.ts`;
}
function assetUrlExists(url) {
    const relativePath = url.replace(/^db:\/\//, '').replace(/\//g, '\\');
    return (0, fs_1.existsSync)((0, path_1.join)(Editor.Project.path, relativePath));
}
function normalizeAssetPath(value) {
    const path = value.replace(/\\/g, '/').replace(/^db:\/\//, '').replace(/^\/+/, '');
    return path.startsWith('assets') ? path : `assets/${path}`;
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
    const handlerBlock = pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END);
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
    ]);
    return existing.replace(importPattern, `import { ${merged.join(', ')} } from 'cc';`);
}
function parseCcImportNames(imports) {
    return imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQXNOQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBeE4zQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBQ3pELG1DQUFxQztBQUVyQyxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFFakMsTUFBTSxlQUFlLEdBQUcscUNBQXFDLENBQUM7QUFDOUQsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUM7QUFDckUsTUFBTSxzQkFBc0IsR0FBRyxvQkFBb0IsQ0FBQztBQUNwRCxNQUFNLG9CQUFvQixHQUFHLGtCQUFrQixDQUFDO0FBQ2hELE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFDN0QsTUFBTSxxQkFBcUIsR0FBRywwQkFBMEIsQ0FBQztBQUN6RCxNQUFNLHlCQUF5QixHQUFHLDhCQUE4QixDQUFDO0FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUErQzdELE1BQU0sYUFBYSxHQUFtQjtJQUNsQyxVQUFVLEVBQUUsWUFBWTtJQUN4QixzQkFBc0IsRUFBRSxJQUFJO0lBQzVCLGFBQWEsRUFBRSxRQUFRO0lBQ3ZCLFVBQVUsRUFBRSxNQUFNO0lBQ2xCLEtBQUssRUFBRTtRQUNIO1lBQ0ksTUFBTSxFQUFFLE1BQU07WUFDZCxhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTTtZQUNsQixhQUFhLEVBQUUsRUFBRTtZQUNqQixZQUFZLEVBQUUsS0FBSztZQUNuQixrQkFBa0IsRUFBRSxLQUFLO1lBQ3pCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCO1FBQ0Q7WUFDSSxNQUFNLEVBQUUsV0FBVztZQUNuQixhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTTtZQUNsQixhQUFhLEVBQUUsRUFBRTtZQUNqQixZQUFZLEVBQUUsSUFBSTtZQUNsQixrQkFBa0IsRUFBRSxLQUFLO1lBQ3pCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCO1FBQ0Q7WUFDSSxNQUFNLEVBQUUsT0FBTztZQUNmLGFBQWEsRUFBRSxhQUFhO1lBQzVCLFlBQVksRUFBRSxhQUFhO1lBQzNCLGFBQWEsRUFBRSxhQUFhO1lBQzVCLFVBQVUsRUFBRSxXQUFXO1lBQ3ZCLGFBQWEsRUFBRSxhQUFhO1lBQzVCLFlBQVksRUFBRSxLQUFLO1lBQ25CLGtCQUFrQixFQUFFLEtBQUs7WUFDekIsT0FBTyxFQUFFLElBQUk7U0FDaEI7UUFDRDtZQUNJLE1BQU0sRUFBRSxRQUFRO1lBQ2hCLGFBQWEsRUFBRSxRQUFRO1lBQ3ZCLFlBQVksRUFBRSxRQUFRO1lBQ3RCLGFBQWEsRUFBRSxRQUFRO1lBQ3ZCLFVBQVUsRUFBRSxXQUFXO1lBQ3ZCLGFBQWEsRUFBRSxXQUFXO1lBQzFCLFlBQVksRUFBRSxLQUFLO1lBQ25CLGtCQUFrQixFQUFFLElBQUk7WUFDeEIsT0FBTyxFQUFFLElBQUk7U0FDaEI7UUFDRDtZQUNJLE1BQU0sRUFBRSxPQUFPO1lBQ2YsYUFBYSxFQUFFLE9BQU87WUFDdEIsWUFBWSxFQUFFLE9BQU87WUFDckIsYUFBYSxFQUFFLE9BQU87WUFDdEIsVUFBVSxFQUFFLFdBQVc7WUFDdkIsYUFBYSxFQUFFLFVBQVU7WUFDekIsWUFBWSxFQUFFLEtBQUs7WUFDbkIsa0JBQWtCLEVBQUUsS0FBSztZQUN6QixPQUFPLEVBQUUsSUFBSTtTQUNoQjtLQUNKO0NBQ0osQ0FBQztBQUVXLFFBQUEsT0FBTyxHQUErQztJQUMvRCxLQUFLLENBQUMsY0FBYztRQUNoQixNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSxRQUFRLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVc7UUFDYixPQUFPLFVBQVUsRUFBRSxDQUFDO0lBQ3hCLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQStCO1FBQzVDLE1BQU0sVUFBVSxpREFDVCxhQUFhLEdBQ2IsTUFBTSxLQUNULEtBQUssRUFBRSxjQUFjLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUN0QyxDQUFDO1FBRUYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNuRixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSx3QkFBd0IsRUFBRSxVQUFVLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUMzRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxlQUFlLEVBQUUsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3pGLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN6RSxPQUFPLFVBQVUsQ0FBQztJQUN0QixDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVc7UUFDYixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RGLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLHdCQUF3QixFQUFFLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBQzlHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLGVBQWUsRUFBRSxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDNUYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN0RixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVFLE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ2xCLE1BQU0sbUJBQW1CLENBQUMsbUJBQW1CLENBQUMsQ0FBQztJQUNuRCxDQUFDO0lBRUQsS0FBSyxDQUFDLDBCQUEwQjtRQUM1QixNQUFNLG1CQUFtQixDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxLQUFLLENBQUMsMEJBQTBCO1FBQzVCLE1BQU0sbUJBQW1CLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdEMsQ0FBQztDQUNKLENBQUM7QUFFRixLQUFLLFVBQVUsbUJBQW1CLENBQUMsSUFBYztJQUM3QyxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckMsSUFBSSxDQUFDO1FBQ0QsTUFBTSxNQUFNLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM1QyxNQUFNLE1BQU0sR0FBRztZQUNYLFdBQVcsTUFBTSxDQUFDLFNBQVMsRUFBRTtZQUM3QixlQUFlLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFO1lBQ3ZDLGtCQUFrQixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtZQUN6QyxJQUFJLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLDBDQUEwQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsQ0FBQztZQUNoSixJQUFJLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLENBQUMscUJBQXFCLE1BQU0sQ0FBQyxlQUFlLEVBQUU7U0FDcEcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFYixNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztZQUNsQixLQUFLLEVBQUUsR0FBRyxTQUFTLFdBQVc7WUFDOUIsT0FBTyxFQUFFLE1BQU07WUFDZixJQUFJLEVBQUUsU0FBUztZQUNmLE1BQU0sRUFBRSxZQUFZO1lBQ3BCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCLENBQUMsQ0FBQztJQUNQLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxZQUFZLEtBQUssT0FBTyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDckQsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDbEIsS0FBSyxFQUFFLEdBQUcsU0FBUyxTQUFTO1lBQzVCLE9BQU87WUFDUCxJQUFJLEVBQUUsT0FBTztZQUNiLE1BQU0sRUFBRSxZQUFZO1lBQ3BCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCLENBQUMsQ0FBQztJQUNQLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsSUFBYztJQUNoQyxJQUFJLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztRQUN0QixPQUFPLGlCQUFpQixDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFJLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztRQUNsQixPQUFPLGlCQUFpQixDQUFDO0lBQzdCLENBQUM7SUFFRCxPQUFPLG1CQUFtQixDQUFDO0FBQy9CLENBQUM7QUFFRCxTQUFnQixJQUFJLEtBQUksQ0FBQztBQUV6QixTQUFnQixNQUFNLEtBQUksQ0FBQztBQUUzQixLQUFLLFVBQVUsZ0JBQWdCLENBQUMsSUFBYztJQUMxQyxNQUFNLFlBQVksR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN6RyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUM1RixJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxxRUFBcUUsQ0FBQyxDQUFDO0lBQzNGLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDM0MsTUFBTSxTQUFTLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3hDLE1BQU0sTUFBTSxHQUFHLE1BQU0sVUFBVSxFQUFFLENBQUM7SUFDbEMsTUFBTSxjQUFjLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUMvRCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDbEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxrR0FBa0csQ0FBQyxDQUFDO0lBQ3hILENBQUM7SUFDRCxNQUFNLFNBQVMsR0FBRyxhQUFhLENBQUMsY0FBYyxFQUFFLFNBQVMsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDOUUsTUFBTSxJQUFJLEdBQUcsWUFBWSxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNoRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQztJQUMvRCxJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUM7SUFDcEIsSUFBSSxpQkFBaUIsR0FBRyxLQUFLLENBQUM7SUFDOUIsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0lBRXhCLElBQUksSUFBSSxLQUFLLE1BQU0sRUFBRSxDQUFDO1FBQ2xCLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3RELE1BQU0sUUFBUSxHQUFHLE1BQU0sYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0saUJBQWlCLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQ3ZFLE1BQU0sV0FBVyxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFFN0UsSUFBSSxRQUFRLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sSUFBSSxLQUFLLENBQUMsOEZBQThGLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDL0gsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLFFBQVEsQ0FBQztRQUNwQixNQUFNLFVBQVUsQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ2xELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLGVBQWUsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUN6RSxDQUFDO1NBQU0sSUFBSSxDQUFDLE1BQU0sYUFBYSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDekMsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUM5RSxDQUFDO0lBRUQsSUFBSSxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7UUFDdEIsTUFBTSxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDOUMsaUJBQWlCLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxZQUFZLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRWpGLElBQUksQ0FBQztZQUNELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQyxDQUFDO1lBQ3BELGVBQWUsR0FBRyxNQUFNLDZCQUE2QixDQUFDLGNBQWMsRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsWUFBWSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDM0ksTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsZUFBZSxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQzlFLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVkscUVBQXFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDL0csQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPO1FBQ0gsU0FBUztRQUNULFNBQVM7UUFDVCxRQUFRLEVBQUUsSUFBSTtRQUNkLE9BQU87UUFDUCxPQUFPO1FBQ1AsaUJBQWlCO1FBQ2pCLGVBQWU7S0FDbEIsQ0FBQztBQUNOLENBQUM7QUFFRCxLQUFLLFVBQVUsVUFBVTtJQUNyQixJQUFJLENBQUM7UUFDRCxNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3BFLHFEQUNPLGFBQWEsR0FDYixDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsS0FDeEIsS0FBSyxFQUFFLGNBQWMsQ0FBQyxhQUFhLGFBQWIsYUFBYSx1QkFBYixhQUFhLENBQUUsS0FBSyxDQUFDLElBQzdDO0lBQ04sQ0FBQztJQUFDLFdBQU0sQ0FBQztRQUNMLE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsS0FBYztJQUNsQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3hCLE9BQU8sYUFBYSxDQUFDLEtBQUssQ0FBQztJQUMvQixDQUFDO0lBRUQsTUFBTSxVQUFVLEdBQUcsS0FBSztTQUNuQixNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLENBQUM7U0FDbEQsR0FBRyxDQUFDLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7U0FDdkMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFvQixFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFFdkQsT0FBTyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO0FBQ3BFLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxJQUFTO0lBQzVCLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ2hELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNWLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsWUFBWSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ3ZGLE1BQU0sWUFBWSxHQUFHLHNCQUFzQixDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzNELE1BQU0sVUFBVSxHQUFlLFlBQVksS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO0lBRTlFLE9BQU87UUFDSCxNQUFNO1FBQ04sYUFBYSxFQUFFLFlBQVk7UUFDM0IsWUFBWTtRQUNaLGFBQWEsRUFBRSxZQUFZO1FBQzNCLFVBQVU7UUFDVixhQUFhLEVBQUUsVUFBVSxLQUFLLFdBQVcsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQzlFLFlBQVksRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLE1BQU0sS0FBSyxXQUFXO1FBQ2xFLGtCQUFrQixFQUFFLFlBQVksQ0FBQyxZQUFZLENBQUM7UUFDOUMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEtBQUssS0FBSztLQUNsQyxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQUMsYUFBcUI7SUFDakQsTUFBTSxLQUFLLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ25DLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzFCLE9BQU8sYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2hDLENBQUM7SUFFRCxPQUFPLEtBQUssSUFBSSxNQUFNLENBQUM7QUFDM0IsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLFlBQW9CO0lBQ3pDLElBQUksb0JBQW9CLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztRQUNyQyxPQUFPLE1BQU0sWUFBWSxFQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVELE9BQU8sWUFBWSxDQUFDO0FBQ3hCLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLFlBQW9CO0lBQzlDLE9BQU87UUFDSCxRQUFRO1FBQ1IsU0FBUztRQUNULE9BQU87UUFDUCxRQUFRO1FBQ1IsTUFBTTtRQUNOLFVBQVU7UUFDVixhQUFhO1FBQ2IsVUFBVTtRQUNWLFlBQVk7UUFDWixRQUFRO1FBQ1IsUUFBUTtRQUNSLFFBQVE7UUFDUixRQUFRO0tBQ1gsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDN0IsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLFlBQW9CO0lBQ3RDLE9BQU8sWUFBWSxLQUFLLFFBQVEsSUFBSSxZQUFZLEtBQUssV0FBVyxDQUFDO0FBQ3JFLENBQUM7QUFFRCxLQUFLLFVBQVUsbUJBQW1CLENBQUMsWUFBaUI7SUFDaEQsSUFBSSxDQUFDO1FBQ0QsTUFBTSxPQUFPLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDcEUsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ1gsT0FBTywrQkFBK0IsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUN6RCxDQUFDO1FBRUQsTUFBTSxLQUFLLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsa0JBQWtCLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDcEYsT0FBTyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxHQUFHLE1BQUksS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLE1BQU0sQ0FBQSxJQUFJLCtCQUErQixDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ3hGLENBQUM7SUFBQyxXQUFNLENBQUM7UUFDTCxPQUFPLCtCQUErQixDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ3pELENBQUM7QUFDTCxDQUFDO0FBRUQsS0FBSyxVQUFVLCtCQUErQixDQUFDLFlBQWlCO0lBQzVELEtBQUssSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLEtBQUssR0FBRyxDQUFDLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sR0FBRyxHQUFHLHNCQUFzQixDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2pELElBQUksR0FBRyxFQUFFLENBQUM7WUFDTixPQUFPLEdBQUcsQ0FBQztRQUNmLENBQUM7UUFDRCxNQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyQixDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDaEIsQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQUMsWUFBaUI7SUFDN0MsTUFBTSxTQUFTLEdBQUcsSUFBQSxXQUFJLEVBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDdEQsSUFBSSxDQUFDLElBQUEsZUFBVSxFQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDekIsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUMzQyxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxXQUFXLENBQUMsWUFBWSxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDdkUsTUFBTSxVQUFVLEdBQUcsY0FBYyxDQUFDLFNBQVMsRUFBRSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO0lBRXBFLEtBQUssTUFBTSxJQUFJLElBQUksVUFBVSxFQUFFLENBQUM7UUFDNUIsSUFBSSxDQUFDO1lBQ0QsTUFBTSxJQUFJLEdBQUcsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDdkIsU0FBUztZQUNiLENBQUM7WUFFRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxRQUFRLE1BQUssU0FBUyxDQUFDLENBQUM7WUFDbEUsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxNQUFLLFFBQVEsQ0FBQyxDQUFDO1lBQy9ELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDWCxTQUFTO1lBQ2IsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM1RSxNQUFNLGVBQWUsR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO1lBQ3JGLElBQUksVUFBVSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksZUFBZSxHQUFHLENBQUMsSUFBSSxJQUFBLGVBQVEsRUFBQyxJQUFJLEVBQUUsSUFBQSxjQUFPLEVBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxRQUFRLEVBQUUsQ0FBQztnQkFDN0YsTUFBTSxhQUFhLEdBQUcsSUFBQSxlQUFRLEVBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztnQkFDOUUsT0FBTyxRQUFRLGFBQWEsRUFBRSxDQUFDO1lBQ25DLENBQUM7UUFDTCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNoQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSw2QkFBNkIsSUFBSSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDOUUsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDaEIsQ0FBQztBQUVELFNBQVMsZ0JBQWdCLENBQUMsSUFBWTtJQUNsQyxJQUFJLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBQSxpQkFBWSxFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU8sSUFBSSxDQUFDO1FBQ2hCLENBQUM7UUFDRCxNQUFNLEtBQUssQ0FBQztJQUNoQixDQUFDO0FBQ0wsQ0FBQztBQUVELEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxJQUFZLEVBQUUsUUFBUSxHQUFHLENBQUM7SUFDM0QsS0FBSyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsS0FBSyxHQUFHLFFBQVEsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDL0MsSUFBSSxDQUFDO1lBQ0QsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUEsaUJBQVksRUFBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssUUFBUSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMxRCxNQUFNLEtBQUssQ0FBQztZQUNoQixDQUFDO1lBQ0QsTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDckIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNoQixDQUFDO0FBRUQsU0FBUyxxQkFBcUIsQ0FBQyxLQUFjO0lBQ3pDLE9BQU8sS0FBSyxZQUFZLFdBQVcsSUFBSSw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzlGLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxHQUFXLEVBQUUsVUFBb0I7SUFDckQsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO0lBRTVCLEtBQUssTUFBTSxLQUFLLElBQUksSUFBQSxnQkFBVyxFQUFDLEdBQUcsRUFBRSxFQUFFLGFBQWEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7UUFDNUQsTUFBTSxRQUFRLEdBQUcsSUFBQSxXQUFJLEVBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN2QyxJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxjQUFjLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUM7UUFDekQsQ0FBQzthQUFNLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFBLGNBQU8sRUFBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQ2hFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDMUIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsY0FBNkIsRUFBRSxTQUFpQixFQUFFLFVBQWtCO0lBQ3ZGLE1BQU0sY0FBYyxHQUFHLGtCQUFrQixDQUFDLFVBQVUsSUFBSSxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN0RyxNQUFNLGFBQWEsR0FBRyxRQUFRLGNBQWMsSUFBSSxTQUFTLEtBQUssQ0FBQztJQUMvRCxJQUFJLGNBQWMsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQ2hDLE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDbEIsT0FBTyxhQUFhLENBQUM7SUFDekIsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFHLGNBQWM7U0FDM0IsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUM7U0FDdkIsT0FBTyxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQztTQUNqQyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBRXpCLE1BQU0sWUFBWSxHQUFHLFNBQVMsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDO1FBQ2hELENBQUMsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUM7UUFDbkMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQzVDLE1BQU0sR0FBRyxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBRW5HLE9BQU8sUUFBUSxjQUFjLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksU0FBUyxLQUFLLENBQUM7QUFDM0UsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLEdBQVc7SUFDL0IsTUFBTSxZQUFZLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQztJQUN0RSxPQUFPLElBQUEsZUFBVSxFQUFDLElBQUEsV0FBSSxFQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7QUFDL0QsQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsS0FBYTtJQUNyQyxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDbkYsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUM7QUFDL0QsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLElBQVMsRUFBRSxNQUFzQjtJQUNuRCxNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUM1QyxNQUFNLFFBQVEsR0FBcUIsRUFBRSxDQUFDO0lBQ3RDLE1BQU0sS0FBSyxHQUFHLHFCQUFxQixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBRTVDLE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBUyxFQUFFLEVBQUU7UUFDeEIsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ25DLE1BQU0sU0FBUyxHQUFHLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUV6QyxJQUFJLFNBQVMsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDeEQsT0FBTztRQUNYLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQztRQUN0RCxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ1YsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBRUQsSUFBSSxPQUFPLGFBQVAsT0FBTyx1QkFBUCxPQUFPLENBQUUsWUFBWSxFQUFFLENBQUM7WUFDeEIsT0FBTztRQUNYLENBQUM7UUFFRCxLQUFLLE1BQU0sS0FBSyxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3BDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNqQixDQUFDO0lBQ0wsQ0FBQyxDQUFDO0lBRUYsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ1osT0FBTyxRQUFRLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMscUJBQXFCLENBQUMsTUFBc0I7SUFDakQsT0FBTyxNQUFNLENBQUMsS0FBSztTQUNkLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDO1NBQzdDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDekUsQ0FBQztBQUVELFNBQVMsYUFBYSxDQUFDLElBQVMsRUFBRSxLQUFpQixFQUFFLFNBQThCO0lBQy9FLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNuQyxNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDekMsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUVuRixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDUixPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsT0FBTztRQUNILFFBQVEsRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDO1FBQ3ZCLFFBQVE7UUFDUixZQUFZLEVBQUUsY0FBYyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsRUFBRSxTQUFTLENBQUM7UUFDakUsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZO1FBQy9CLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtRQUNqQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7UUFDM0IsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1FBQ2pDLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTtRQUMvQixrQkFBa0IsRUFBRSxJQUFJLENBQUMsa0JBQWtCO0tBQzlDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxXQUFXLENBQUMsSUFBUztJQUMxQixPQUFPLE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxDQUFDO0FBQ3ZELENBQUM7QUFFRCxTQUFTLE9BQU8sQ0FBQyxJQUFTO0lBQ3RCLE9BQU8sTUFBTSxDQUFDLGFBQWEsQ0FBQyxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsSUFBSSxDQUFDLEtBQUksSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLElBQUksQ0FBQSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQ2pFLENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxJQUFTO0lBQzFCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUM5RCxDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsS0FBVTtJQUM3QixJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3pELE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQztJQUN2QixDQUFDO0lBQ0QsT0FBTyxLQUFLLENBQUM7QUFDakIsQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLEtBQWE7SUFDOUIsTUFBTSxJQUFJLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25DLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLG1CQUFtQixDQUFDLENBQUM7QUFDdEUsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLEtBQWE7SUFDakMsTUFBTSxVQUFVLEdBQUcsS0FBSztTQUNuQixJQUFJLEVBQUU7U0FDTixPQUFPLENBQUMsaURBQWlELEVBQUUsR0FBRyxDQUFDO1NBQy9ELE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDO1NBQ25CLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFFN0IsTUFBTSxPQUFPLEdBQUcsVUFBVTtTQUNyQixLQUFLLENBQUMsRUFBRSxDQUFDO1NBQ1QsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO1NBQzNGLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUVkLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNYLE9BQU8sTUFBTSxDQUFDO0lBQ2xCLENBQUM7SUFFRCxPQUFPLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksT0FBTyxFQUFFLENBQUM7QUFDbkUsQ0FBQztBQUVELFNBQVMsaUJBQWlCLENBQUMsSUFBWTtJQUNuQyxPQUFPLG1CQUFtQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMxQyxDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBQyxJQUFZO0lBQ3RDLE9BQU8sa0NBQWtDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3pELENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxRQUFnQixFQUFFLFNBQThCO0lBQ3BFLE1BQU0sS0FBSyxHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNDLFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNuQyxPQUFPLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsR0FBRyxRQUFRLEdBQUcsS0FBSyxHQUFHLENBQUMsRUFBRSxDQUFDO0FBQzlELENBQUM7QUFFRCxTQUFTLFVBQVUsQ0FBQyxLQUFhO0lBQzdCLE9BQU8sS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO0FBQ25FLENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxTQUFpQixFQUFFLFFBQTBCLEVBQUUsT0FBeUI7SUFDMUYsT0FBTyxZQUFZLGVBQWUsQ0FBQyxRQUFRLENBQUM7Ozs7WUFJcEMsU0FBUztlQUNOLFNBQVM7O01BRWxCLGVBQWU7RUFDbkIsZ0JBQWdCLENBQUMsUUFBUSxDQUFDO01BQ3RCLGFBQWE7Ozs7Ozs7VUFPVCx1QkFBdUI7RUFDL0Isa0JBQWtCLENBQUMsT0FBTyxDQUFDO1VBQ25CLHFCQUFxQjs7O01BR3pCLHlCQUF5QjtFQUM3QixvQkFBb0IsQ0FBQyxPQUFPLENBQUM7TUFDekIsdUJBQXVCOztDQUU1QixDQUFDO0FBQ0YsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLFFBQTBCO0lBQy9DLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFFckQsS0FBSyxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUM3QixxQkFBcUIsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3JELHFCQUFxQixDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDMUQsQ0FBQztJQUVELElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQztRQUN6RCxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQzFCLENBQUM7SUFFRCxPQUFPLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDN0MsQ0FBQztBQUVELFNBQVMsYUFBYSxDQUFDLE9BQXlCO0lBQzVDLE9BQU8sQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQ3ZCLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUM7U0FDdkMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQ2xCLE1BQU0sS0FBSyxHQUFHLENBQUMsWUFBWSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEMsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN4QyxJQUFJLFNBQVMsS0FBSyxDQUFDLENBQUMsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN4QyxPQUFPLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDckMsQ0FBQyxDQUFDLENBQUM7QUFDWCxDQUFDO0FBRUQsU0FBUyxxQkFBcUIsQ0FBQyxPQUFvQixFQUFFLFFBQWdCO0lBQ2pFLE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUM5QixNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEYsSUFBSSw0QkFBNEIsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUNoRCxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzVCLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxRQUEwQjtJQUNoRCxPQUFPLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDO2FBQ2hGLE9BQU8sQ0FBQyxZQUFZLEtBQUssZ0JBQWdCLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUM1RyxDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxRQUFnQjtJQUN0QyxNQUFNLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDOUIsT0FBTyxLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztBQUNsRSxDQUFDO0FBRUQsU0FBUyxrQkFBa0IsQ0FBQyxPQUF5QjtJQUNqRCxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixNQUFNLENBQUMsWUFBWTttQkFDdkQsTUFBTSxDQUFDLFlBQVkseUNBQXlDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUM7VUFDN0csQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUN6QixDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBQyxPQUF5QjtJQUNuRCxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLGVBQWUsbUJBQW1CLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQzs7TUFFcEYsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUNyQixDQUFDO0FBRUQsU0FBUyxtQkFBbUIsQ0FBQyxZQUFvQjtJQUM3QyxPQUFPLFVBQVUsVUFBVSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztBQUNoRixDQUFDO0FBRUQsU0FBUyxrQkFBa0IsQ0FBQyxRQUFnQixFQUFFLFNBQWlCO0lBQzNELE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxTQUFTLEVBQUUsZUFBZSxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxTQUFTLEVBQUUsdUJBQXVCLEVBQUUscUJBQXFCLENBQUMsQ0FBQztJQUN4RixNQUFNLFlBQVksR0FBRyxTQUFTLENBQUMsU0FBUyxFQUFFLHlCQUF5QixFQUFFLHVCQUF1QixDQUFDLENBQUM7SUFFOUYsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDOUIsT0FBTyxRQUFRLENBQUM7SUFDcEIsQ0FBQztJQUVELE1BQU0sV0FBVyxHQUFHLHVCQUF1QixDQUFDLFFBQVEsRUFBRSxlQUFlLEVBQUUsYUFBYSxDQUFDO1dBQzlFLHVCQUF1QixDQUFDLFFBQVEsRUFBRSxzQkFBc0IsRUFBRSxvQkFBb0IsQ0FBQztXQUM5RSxDQUFDLGVBQWUsRUFBRSxhQUFhLENBQVcsQ0FBQztJQUVuRCxJQUFJLE9BQU8sR0FBRyxZQUFZLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDaEYsT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFbEcsTUFBTSxhQUFhLEdBQUcsWUFBWSxDQUM5QixZQUFZLENBQ1IsT0FBTyxFQUNQLHVCQUF1QixFQUN2QixxQkFBcUIsRUFDckIsVUFBVSxDQUNiLEVBQ0QseUJBQXlCLEVBQ3pCLHVCQUF1QixFQUN2QixZQUFZLENBQ2YsQ0FBQztJQUVGLE9BQU8sY0FBYyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztBQUNwRCxDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxNQUFjO0lBQ3BDLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLGVBQWUsRUFBRSxhQUFhLENBQUMsSUFBSSxRQUFRLENBQUMsTUFBTSxFQUFFLHNCQUFzQixFQUFFLG9CQUFvQixDQUFDLENBQUM7V0FDcEgsUUFBUSxDQUFDLE1BQU0sRUFBRSx1QkFBdUIsRUFBRSxxQkFBcUIsQ0FBQztXQUNoRSxRQUFRLENBQUMsTUFBTSxFQUFFLHlCQUF5QixFQUFFLHVCQUF1QixDQUFDLENBQUM7QUFDaEYsQ0FBQztBQUVELFNBQVMsdUJBQXVCLENBQUMsTUFBYyxFQUFFLEtBQWEsRUFBRSxHQUFXO0lBQ3ZFLE9BQU8sUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDOUQsQ0FBQztBQUVELFNBQVMsUUFBUSxDQUFDLE1BQWMsRUFBRSxLQUFhLEVBQUUsR0FBVztJQUN4RCxPQUFPLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDekcsQ0FBQztBQUVELFNBQVMsU0FBUyxDQUFDLE1BQWMsRUFBRSxLQUFhLEVBQUUsR0FBVztJQUN6RCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3pDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDckMsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQzdELENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxNQUFjLEVBQUUsS0FBYSxFQUFFLEdBQVcsRUFBRSxPQUFlO0lBQzdFLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyQyxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsVUFBVSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO0FBQzlGLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxRQUFnQixFQUFFLFNBQWlCO0lBQ3ZELE1BQU0sYUFBYSxHQUFHLHdEQUF3RCxDQUFDO0lBQy9FLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDcEQsTUFBTSxjQUFjLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUV0RCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDbEIsT0FBTyxRQUFRLENBQUM7SUFDcEIsQ0FBQztJQUVELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNqQixPQUFPLEdBQUcsY0FBYyxDQUFDLENBQUMsQ0FBQyxLQUFLLFFBQVEsRUFBRSxDQUFDO0lBQy9DLENBQUM7SUFFRCxNQUFNLE1BQU0sR0FBRyxhQUFhLENBQUM7UUFDekIsR0FBRyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkMsR0FBRyxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7S0FDM0MsQ0FBQyxDQUFDO0lBRUgsT0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxZQUFZLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO0FBQ3pGLENBQUM7QUFFRCxTQUFTLGtCQUFrQixDQUFDLE9BQWU7SUFDdkMsT0FBTyxPQUFPO1NBQ1QsS0FBSyxDQUFDLEdBQUcsQ0FBQztTQUNWLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1NBQzFCLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUN6QixDQUFDO0FBRUQsS0FBSyxVQUFVLGFBQWEsQ0FBQyxHQUFXO0lBQ3BDLE1BQU0sS0FBSyxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ2hGLElBQUksQ0FBQyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxJQUFJLENBQUEsRUFBRSxDQUFDO1FBQ2YsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE9BQU8sSUFBQSxpQkFBWSxFQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDNUMsQ0FBQztBQUVELEtBQUssVUFBVSxVQUFVLENBQUMsR0FBVyxFQUFFLE1BQWMsRUFBRSxPQUFnQjtJQUNuRSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ1YsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN0RSxPQUFPO0lBQ1gsQ0FBQztJQUVELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDeEUsQ0FBQztBQUVELEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxRQUFnQixFQUFFLFNBQWlCLEVBQUUsU0FBaUI7SUFDcEYsSUFBSSxNQUFNLGlCQUFpQixDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQy9DLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLG9CQUFvQixHQUFHLE1BQU0sZ0NBQWdDLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQzFGLElBQUksb0JBQW9CLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3BDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxZQUFZLHNCQUFzQixTQUFTLG1EQUFtRCxDQUFDLENBQUM7SUFDckgsQ0FBQztJQUVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDO1lBQ3BDLFNBQVM7WUFDVCxrQkFBa0IsQ0FBQyxTQUFTLENBQUM7WUFDN0IsR0FBRyxvQkFBb0I7U0FDMUIsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRXBCLEtBQUssTUFBTSxhQUFhLElBQUksbUJBQW1CLEVBQUUsQ0FBQztRQUM5QyxJQUFJLE1BQU0sd0JBQXdCLENBQUMsUUFBUSxFQUFFLGFBQWEsRUFBRSxtQkFBbUIsQ0FBQyxFQUFFLENBQUM7WUFDL0UsT0FBTyxJQUFJLENBQUM7UUFDaEIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQsS0FBSyxVQUFVLGdDQUFnQyxDQUFDLFNBQWlCLEVBQUUsU0FBaUI7SUFDaEYsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLEtBQUssQ0FBQztJQUNwQyxNQUFNLFdBQVcsR0FBRyxNQUFNLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3hELE1BQU0sU0FBUyxHQUFHLDZCQUE2QixDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUN4RSxJQUFJLE1BQU0sR0FBRyxLQUFLLENBQUM7SUFFbkIsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsUUFBUSxFQUFFLENBQUM7UUFDM0IsTUFBTSxVQUFVLEdBQUcsTUFBTSx3Q0FBd0MsQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDMUYsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hCLE9BQU8sQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxVQUFVLEVBQUUsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNWLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxZQUFZLGdDQUFnQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQ3pFLE1BQU0sR0FBRyxJQUFJLENBQUM7UUFDbEIsQ0FBQztRQUVELE1BQU0sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JCLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNyQixDQUFDO0FBRUQsS0FBSyxVQUFVLGtCQUFrQixDQUFDLEdBQVc7SUFDekMsSUFBSSxDQUFDO1FBQ0QsT0FBTyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUM3RSxDQUFDO0lBQUMsV0FBTSxDQUFDO1FBQ0wsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztBQUNMLENBQUM7QUFFRCxLQUFLLFVBQVUsd0NBQXdDLENBQUMsU0FBaUIsRUFBRSxXQUF1QjtJQUM5RixJQUFJLENBQUM7UUFDRCxNQUFNLFVBQVUsR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO1FBQzdFLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDN0IsT0FBTyxFQUFFLENBQUM7UUFDZCxDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQUcsQ0FBQSxXQUFXLGFBQVgsV0FBVyx1QkFBWCxXQUFXLENBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDckUsTUFBTSxTQUFTLEdBQUcsQ0FBQSxXQUFXLGFBQVgsV0FBVyx1QkFBWCxXQUFXLENBQUUsR0FBRyxFQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDbEUsTUFBTSxVQUFVLEdBQUcsQ0FBQSxXQUFXLGFBQVgsV0FBVyx1QkFBWCxXQUFXLENBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN6RixNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFFNUIsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztZQUNqQyxNQUFNLFVBQVUsR0FBRztnQkFDZixTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsSUFBSTtnQkFDZixTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsR0FBRztnQkFDZCxTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsSUFBSTtnQkFDZixTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsU0FBUzthQUN2QixDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRWpELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQzttQkFDbkYsT0FBTyxDQUFDLFVBQVUsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO21CQUN0RCxPQUFPLENBQUMsU0FBUyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7bUJBQ3BELE9BQU8sQ0FBQyxVQUFVLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQztZQUUzRyxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNWLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxVQUFVLENBQUMsQ0FBQztZQUMvQixDQUFDO1FBQ0wsQ0FBQztRQUVELE9BQU8sQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLDBCQUEwQixDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzdGLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVksMENBQTBDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDaEYsT0FBTyxFQUFFLENBQUM7SUFDZCxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsMEJBQTBCLENBQUMsU0FBaUI7SUFDakQsT0FBTyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDbkQsQ0FBQztBQUVELFNBQVMsNkJBQTZCLENBQUMsV0FBdUIsRUFBRSxTQUFpQjs7SUFDN0UsSUFBSSxDQUFDLENBQUEsV0FBVyxhQUFYLFdBQVcsdUJBQVgsV0FBVyxDQUFFLElBQUksQ0FBQSxFQUFFLENBQUM7UUFDckIsT0FBTyxFQUFFLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxTQUFTLEdBQUcsV0FBVyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQztJQUM1RSxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxPQUFPLEdBQUc7UUFDWixJQUFBLFdBQUksRUFBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsUUFBUSxDQUFDO1FBQ3RGLElBQUEsV0FBSSxFQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUM7S0FDMUYsQ0FBQztJQUVGLEtBQUssTUFBTSxTQUFTLElBQUksT0FBTyxFQUFFLENBQUM7UUFDOUIsSUFBSSxDQUFDO1lBQ0QsTUFBTSxhQUFhLEdBQUcsSUFBQSxXQUFJLEVBQUMsU0FBUyxFQUFFLGlCQUFpQixDQUFDLENBQUM7WUFDekQsSUFBSSxDQUFDLElBQUEsZUFBVSxFQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQzdCLFNBQVM7WUFDYixDQUFDO1lBRUQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFBLGlCQUFZLEVBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDbEUsTUFBTSxhQUFhLEdBQUcsQ0FBQSxNQUFBLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxPQUFPLDBDQUFHLFNBQVMsQ0FBQyxNQUFJLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRyxTQUFTLENBQUMsQ0FBQSxDQUFDO1lBQ2hGLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztnQkFDakIsU0FBUztZQUNiLENBQUM7WUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFBLFdBQUksRUFBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUM5RSxJQUFJLENBQUMsSUFBQSxlQUFVLEVBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDekIsU0FBUztZQUNiLENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFBLGlCQUFZLEVBQUMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ3BELE1BQU0sZ0JBQWdCLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxNQUFNLENBQUMsQ0FBQztZQUMxRSxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLG9EQUFvRCxnQkFBZ0IsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUN4SCxJQUFJLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNiLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDMUIsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVksaURBQWlELEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0YsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0FBQ2hDLENBQUM7QUFFRCxLQUFLLFVBQVUsd0JBQXdCLENBQUMsUUFBZ0IsRUFBRSxhQUFxQixFQUFFLFVBQW9CO0lBQ2pHLElBQUksQ0FBQztRQUNELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLGtCQUFrQixFQUFFO1lBQ3RELElBQUksRUFBRSxRQUFRO1lBQ2QsU0FBUyxFQUFFLGFBQWE7U0FDM0IsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDakIsSUFBSSxNQUFNLGlCQUFpQixDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ2hELE9BQU8sSUFBSSxDQUFDO1FBQ2hCLENBQUM7UUFDRCxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSxtQ0FBbUMsYUFBYSw2QkFBNkIsQ0FBQyxDQUFDO1FBQzVHLE9BQU8sS0FBSyxDQUFDO0lBQ2pCLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVksZ0NBQWdDLGFBQWEsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3RGLE9BQU8sS0FBSyxDQUFDO0lBQ2pCLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBUyxrQkFBa0IsQ0FBQyxTQUFpQjtJQUN6QyxPQUFPLFNBQVMsQ0FBQyxPQUFPLENBQUMseURBQXlELEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDN0YsQ0FBQztBQUVELEtBQUssVUFBVSx1QkFBdUIsQ0FBQyxRQUFnQixFQUFFLFNBQWlCLEVBQUUsU0FBaUIsRUFBRSxRQUEwQjtJQUNySCxNQUFNLFdBQVcsR0FBRyxNQUFNLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3hELE1BQU0sYUFBYSxHQUFHLE1BQU0saUJBQWlCLENBQUMsUUFBUSxFQUFFLDRCQUE0QixDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQzlHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNqQixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSwyQkFBMkIsU0FBUyx3QkFBd0IsQ0FBQyxDQUFDO1FBQzNGLE9BQU8sQ0FBQyxDQUFDO0lBQ2IsQ0FBQztJQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBQzlGLElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQztJQUVuQixLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzdCLE1BQU0sWUFBWSxHQUFHLGVBQWUsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQzFFLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNoQixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSwrQkFBK0IsT0FBTyxDQUFDLFlBQVksR0FBRyxDQUFDLENBQUM7WUFDckYsU0FBUztRQUNiLENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVSxLQUFLLE1BQU07WUFDNUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRO1lBQ2xCLENBQUMsQ0FBQyxNQUFNLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLGFBQWEsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFL0YsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ2QsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVksNEJBQTRCLE9BQU8sQ0FBQyxZQUFZLEdBQUcsQ0FBQyxDQUFDO1lBQ2xGLFNBQVM7UUFDYixDQUFDO1FBRUQsSUFBSSxNQUFNLG9CQUFvQixDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsWUFBWSxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQzVGLFVBQVUsSUFBSSxDQUFDLENBQUM7UUFDcEIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQztBQUN0QixDQUFDO0FBRUQsS0FBSyxVQUFVLGlCQUFpQixDQUFDLFFBQWdCLEVBQUUsYUFBZ0M7O0lBQy9FLE1BQU0sSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQztJQUMzRSxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3hFLE1BQU0sY0FBYyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUV0RixLQUFLLE1BQU0sU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQ2pDLE1BQU0sWUFBWSxHQUFHLFNBQWdCLENBQUM7UUFDdEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFBLFlBQVksYUFBWixZQUFZLHVCQUFaLFlBQVksQ0FBRSxLQUFLLDBDQUFFLElBQUksQ0FBQyxJQUFJLGFBQWEsQ0FBQyxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7UUFDekcsTUFBTSxVQUFVLEdBQUc7WUFDZixZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsSUFBSTtZQUNsQixZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsSUFBSTtZQUNsQixZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsR0FBRztZQUNqQixNQUFBLFlBQVksYUFBWixZQUFZLHVCQUFaLFlBQVksQ0FBRSxLQUFLLDBDQUFFLElBQUk7WUFDekIsTUFBQSxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsS0FBSywwQ0FBRSxRQUFRO1lBQzdCLE1BQUEsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLEtBQUssMENBQUUsR0FBRztZQUN4QixNQUFBLFlBQVksYUFBWixZQUFZLHVCQUFaLFlBQVksQ0FBRSxLQUFLLDBDQUFFLElBQUk7U0FDNUIsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVqRCxJQUFJLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN2RyxPQUFPLElBQUksSUFBSSxJQUFJLENBQUM7UUFDeEIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNoQixDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsYUFBa0IsRUFBRSxZQUFvQjs7SUFDN0QsTUFBTSxJQUFJLEdBQUcsQ0FBQSxNQUFBLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxLQUFLLDBDQUFHLFlBQVksQ0FBQyxNQUFJLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRyxZQUFZLENBQUMsQ0FBQSxDQUFDO0lBQ25GLE9BQU8sSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDMUQsQ0FBQztBQUVELEtBQUssVUFBVSxvQkFBb0IsQ0FBQyxhQUFxQixFQUFFLFlBQW9CLEVBQUUsWUFBaUIsRUFBRSxVQUFrQjtJQUNsSCxNQUFNLFVBQVUsR0FBRywyQkFBMkIsQ0FBQyxZQUFZLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFFekUsS0FBSyxNQUFNLElBQUksSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUM1QixJQUFJLENBQUM7WUFDRCxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxjQUFjLEVBQUU7Z0JBQ2xELElBQUksRUFBRSxhQUFhO2dCQUNuQixJQUFJLEVBQUUsWUFBWTtnQkFDbEIsSUFBSTtnQkFDSixNQUFNLEVBQUUsSUFBSTthQUNmLENBQUMsQ0FBQztZQUNILE9BQU8sSUFBSSxDQUFDO1FBQ2hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVksb0JBQW9CLFlBQVkscUNBQXFDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDL0csQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQsU0FBUywyQkFBMkIsQ0FBQyxZQUFpQixFQUFFLFVBQWtCO0lBQ3RFLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBQ3RELE1BQU0sVUFBVSxHQUFVLEVBQUUsQ0FBQztJQUU3QixVQUFVLENBQUMsSUFBSSxpQ0FDUixJQUFJLEtBQ1AsS0FBSyxFQUFFO1lBQ0gsSUFBSSxFQUFFLFVBQVU7U0FDbkIsSUFDSCxDQUFDO0lBRUgsVUFBVSxDQUFDLElBQUksaUNBQ1IsSUFBSSxLQUNQLEtBQUssRUFBRSxVQUFVLElBQ25CLENBQUM7SUFFSCxVQUFVLENBQUMsSUFBSSxpQ0FDUixJQUFJLEtBQ1AsS0FBSyxFQUFFO1lBQ0gsUUFBUSxFQUFFLFVBQVU7U0FDdkIsSUFDSCxDQUFDO0lBRUgsSUFBSSxJQUFJLENBQUMsS0FBSyxJQUFJLE9BQU8sSUFBSSxDQUFDLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUMvQyxVQUFVLENBQUMsT0FBTyxpQ0FDWCxJQUFJLEtBQ1AsS0FBSyxrQ0FDRSxJQUFJLENBQUMsS0FBSyxLQUNiLElBQUksRUFBRSxVQUFVLE9BRXRCLENBQUM7SUFDUCxDQUFDO0lBRUQsT0FBTyxVQUFVLENBQUM7QUFDdEIsQ0FBQztBQUVELEtBQUssVUFBVSw2QkFBNkIsQ0FBQyxjQUE2QixFQUFFLFNBQWlCLEVBQUUsWUFBb0IsRUFBRSxTQUFpQixFQUFFLFFBQWdCLEVBQUUsUUFBMEI7O0lBQ2hMLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUNsQixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7SUFFRCxNQUFNLEtBQUssR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUMzRixJQUFJLENBQUMsQ0FBQSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsSUFBSSxDQUFBLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDekQsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQsTUFBTSxJQUFJLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckQsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN2QixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUMvQyxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUMvQyxNQUFNLDRCQUE0QixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0lBQy9ELE1BQU0sNEJBQTRCLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFFL0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUN6QixJQUFJLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsTUFBSyxTQUFTLEVBQUUsQ0FBQztZQUMvQixNQUFNLFFBQVEsR0FBRyxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxHQUFHLE1BQUksSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLEtBQUssQ0FBQSxJQUFJLEVBQUUsQ0FBQztZQUNoRCxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNYLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3RDLENBQUM7WUFDRCxJQUFJLE9BQU8sQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxDQUFBLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ2xDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4QyxDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTs7UUFDekIsTUFBTSxNQUFNLEdBQUcsTUFBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsSUFBSSwwQ0FBRSxNQUFNLENBQUM7UUFDbEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDNUQsTUFBTSxRQUFRLEdBQUcsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsR0FBRyxNQUFJLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxLQUFLLENBQUEsSUFBSSxFQUFFLENBQUM7UUFDaEQsTUFBTSxRQUFRLEdBQUcsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxLQUFJLEVBQUUsQ0FBQztRQUNuQyxJQUFJLE9BQU8sQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsUUFBUSxDQUFBLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDckMsT0FBTztRQUNYLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ1gsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4RSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNGLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ1gsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4RSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNGLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILE1BQU0sY0FBYyxHQUFHLE1BQUEsWUFBWSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsbUNBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNwRixJQUFJLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUMvQixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7SUFFRCxNQUFNLFdBQVcsR0FBRyxNQUFNLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3hELE1BQU0sZUFBZSxHQUFHLDRCQUE0QixDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUM3RSxJQUFJLGVBQWUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUU7O1FBQ3JDLElBQUksT0FBTyxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxRQUFRLENBQUEsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNyQyxPQUFPLEtBQUssQ0FBQztRQUNqQixDQUFDO1FBRUQsTUFBTSxNQUFNLEdBQUcsTUFBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsSUFBSSwwQ0FBRSxNQUFNLENBQUM7UUFDbEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDNUQsTUFBTSxzQkFBc0IsR0FBRyxNQUFNLEtBQUssY0FBYyxJQUFJLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLEtBQUssTUFBSyxRQUFRLENBQUM7UUFDckYsTUFBTSxvQkFBb0IsR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDO1FBRTFILE9BQU8sZUFBZSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO2VBQ3ZDLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUztlQUMzQixhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFNBQVM7ZUFDMUMsQ0FBQyxzQkFBc0IsSUFBSSxvQkFBb0IsQ0FBQyxDQUFDO0lBQzVELENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1FBQ25CLGVBQWUsR0FBRywrQkFBK0IsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSSxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDdkgsQ0FBQztJQUVELElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQztJQUVuQixLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzdCLElBQUksT0FBTyxDQUFDLFVBQVUsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUNoQyxNQUFNLE1BQU0sR0FBRyxNQUFBLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxtQ0FBSSxZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUN4RixJQUFJLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDdkIsZUFBZSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsQ0FBQztnQkFDM0QsVUFBVSxJQUFJLENBQUMsQ0FBQztZQUNwQixDQUFDO1lBQ0QsU0FBUztRQUNiLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUM7UUFDL0QsTUFBTSxXQUFXLEdBQUcsTUFBQSxNQUFBLE1BQUEsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxRQUFRLEVBQUUsQ0FBQyxtQ0FDaEYsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxtQ0FDbEYsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxRQUFRLEVBQUUsQ0FBQyxtQ0FDbkUsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRTFGLElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzVCLGVBQWUsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEdBQUcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLENBQUM7WUFDaEUsVUFBVSxJQUFJLENBQUMsQ0FBQztRQUNwQixDQUFDO0lBQ0wsQ0FBQztJQUVELElBQUEsa0JBQWEsRUFBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDeEUsT0FBTyxVQUFVLENBQUM7QUFDdEIsQ0FBQztBQUVELFNBQVMsNEJBQTRCLENBQUMsV0FBdUIsRUFBRSxTQUFpQjtJQUM1RSxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQztZQUNmLEdBQUcsNkJBQTZCLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQztZQUN4RCxTQUFTO1NBQ1osQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3hCLENBQUM7QUFFRCxTQUFTLCtCQUErQixDQUFDLElBQVcsRUFBRSxNQUFjLEVBQUUsVUFBa0IsRUFBRSxRQUEwQjtJQUNoSCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDMUIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNoQyxNQUFNLFlBQVksR0FBRyxXQUFXLEdBQUcsQ0FBQyxDQUFDO0lBQ3JDLE1BQU0sU0FBUyxHQUFRO1FBQ25CLFFBQVEsRUFBRSxVQUFVO1FBQ3BCLEtBQUssRUFBRSxFQUFFO1FBQ1QsU0FBUyxFQUFFLENBQUM7UUFDWixnQkFBZ0IsRUFBRSxFQUFFO1FBQ3BCLElBQUksRUFBRTtZQUNGLE1BQU0sRUFBRSxNQUFNO1NBQ2pCO1FBQ0QsUUFBUSxFQUFFLElBQUk7UUFDZCxRQUFRLEVBQUU7WUFDTixNQUFNLEVBQUUsWUFBWTtTQUN2QjtRQUNELEdBQUcsRUFBRSxFQUFFO0tBQ1YsQ0FBQztJQUVGLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IsU0FBUyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsR0FBRyxJQUFJLENBQUM7SUFDM0MsQ0FBQztJQUVELE1BQU0sVUFBVSxHQUFHO1FBQ2YsUUFBUSxFQUFFLG1CQUFtQjtRQUM3QixNQUFNLEVBQUUsZ0JBQWdCLEVBQUU7S0FDN0IsQ0FBQztJQUVGLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQ25DLElBQUksQ0FBQyxXQUFXLEdBQUcsRUFBRSxDQUFDO0lBQzFCLENBQUM7SUFDRCxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0lBQy9DLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBQ2pDLE9BQU8sU0FBUyxDQUFDO0FBQ3JCLENBQUM7QUFFRCxTQUFTLGdCQUFnQjtJQUNyQixNQUFNLEtBQUssR0FBRyxrRUFBa0UsQ0FBQztJQUNqRixNQUFNLEtBQUssR0FBRyxJQUFBLG9CQUFXLEVBQUMsRUFBRSxDQUFDLENBQUM7SUFDOUIsSUFBSSxNQUFNLEdBQUcsRUFBRSxDQUFDO0lBQ2hCLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdkIsTUFBTSxJQUFJLEtBQUssQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3pDLENBQUM7SUFDRCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsSUFBWTtJQUMvQixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDO0FBQ3pDLENBQUM7QUFFRCxLQUFLLFVBQVUsc0JBQXNCLENBQUMsT0FBeUIsRUFBRSxNQUFzQjtJQUNuRixJQUFJLENBQUMsTUFBTSxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFDakMsT0FBTztJQUNYLENBQUM7SUFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQztZQUNELE1BQU0sSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDbEYsSUFBSSxZQUFZLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLFNBQVM7WUFDYixDQUFDO1lBRUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxDQUFDLGFBQWEsSUFBSSxXQUFXLENBQUM7WUFDMUQsTUFBTSwyQkFBMkIsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEcsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSwwQ0FBMEMsTUFBTSxDQUFDLFFBQVEsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3RHLENBQUM7SUFDTCxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLElBQVMsRUFBRSxhQUFxQjtJQUNsRCxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3hFLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQWMsRUFBRSxFQUFFOztRQUN0QyxNQUFNLFVBQVUsR0FBRztZQUNmLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxJQUFJO1lBQ2YsU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLElBQUk7WUFDZixTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsR0FBRztZQUNkLE1BQUEsU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLEtBQUssMENBQUUsSUFBSTtZQUN0QixNQUFBLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxLQUFLLDBDQUFFLFFBQVE7WUFDMUIsTUFBQSxTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsS0FBSywwQ0FBRSxHQUFHO1NBQ3hCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFakQsT0FBTyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQztJQUMxRixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLFNBQWlCLEVBQUUsYUFBcUI7SUFDbEUsTUFBTSxJQUFJLEdBQUcsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMxQyxNQUFNLFNBQVMsR0FBRyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDekQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTlELE9BQU8sSUFBSSxLQUFLLEtBQUs7V0FDZCxTQUFTLEtBQUssVUFBVTtXQUN4QixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksVUFBVSxFQUFFLENBQUM7V0FDL0IsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLFFBQWdCLEVBQUUsY0FBd0I7SUFDakYsSUFBSSxTQUFrQixDQUFDO0lBRXZCLEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ3RELElBQUksRUFBRSxRQUFRO2dCQUNkLFNBQVM7YUFDWixDQUFDLENBQUM7WUFDSCxPQUFPO1FBQ1gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixTQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ3RCLENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxTQUFTLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGlzdHNTeW5jLCByZWFkRmlsZVN5bmMsIHJlYWRkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGV4dG5hbWUsIGpvaW4sIHJlbGF0aXZlIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyByYW5kb21CeXRlcyB9IGZyb20gJ2NyeXB0byc7XG5cbmNvbnN0IFBBQ0tBR0VfTkFNRSA9ICdiaW5kLXRvb2wnO1xuXG5jb25zdCBBVVRPX0JJTkRfU1RBUlQgPSAnLyoqKioqKioqKioqKioqKnN0c3J0KioqKioqKioqKioqKi8nO1xuY29uc3QgQVVUT19CSU5EX0VORCA9ICcvKioqKioqKioqKioqKioqKioqKioqKioqZW5kKioqKioqKioqKioqKioqLyc7XG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJUID0gJy8vIEFVVE9fQklORF9TVEFSVCc7XG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX0VORCA9ICcvLyBBVVRPX0JJTkRfRU5EJztcbmNvbnN0IEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJUID0gJy8vIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJUJztcbmNvbnN0IEFVVE9fQlVUVE9OX0VWRU5UX0VORCA9ICcvLyBBVVRPX0JVVFRPTl9FVkVOVF9FTkQnO1xuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCA9ICcvLyBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUJztcbmNvbnN0IEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EID0gJy8vIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EJztcblxudHlwZSBCaW5kVGFyZ2V0ID0gJ25vZGUnIHwgJ2NvbXBvbmVudCc7XG50eXBlIEJpbmRNb2RlID0gJ2dlbmVyYXRlLWFuZC1iaW5kJyB8ICdnZW5lcmF0ZScgfCAnYmluZCc7XG5cbmludGVyZmFjZSBCaW5kVG9vbENvbmZpZyB7XG4gICAgc2NyaXB0Um9vdDogc3RyaW5nO1xuICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6IGJvb2xlYW47XG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcic7XG4gICAgc3RvcFByZWZpeDogc3RyaW5nO1xuICAgIHJ1bGVzOiBCaW5kUnVsZVtdO1xufVxuXG5pbnRlcmZhY2UgQmluZFJ1bGUge1xuICAgIHByZWZpeDogc3RyaW5nO1xuICAgIGNvbXBvbmVudE5hbWU/OiBzdHJpbmc7XG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xuICAgIGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQ7XG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcbiAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGJvb2xlYW47XG4gICAgZW5hYmxlZDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFNjYW5uZWRCaW5kaW5nIHtcbiAgICBub2RlVXVpZDogc3RyaW5nO1xuICAgIG5vZGVOYW1lOiBzdHJpbmc7XG4gICAgcHJvcGVydHlOYW1lOiBzdHJpbmc7XG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xuICAgIGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQ7XG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcbiAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBCaW5kUmVzdWx0IHtcbiAgICBjbGFzc05hbWU6IHN0cmluZztcbiAgICBzY3JpcHRVcmw6IHN0cmluZztcbiAgICBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXTtcbiAgICBidXR0b25zOiBTY2FubmVkQmluZGluZ1tdO1xuICAgIGNyZWF0ZWQ6IGJvb2xlYW47XG4gICAgY29tcG9uZW50QXR0YWNoZWQ6IGJvb2xlYW47XG4gICAgcHJvcGVydGllc0JvdW5kOiBudW1iZXI7XG59XG5cbmNvbnN0IGRlZmF1bHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xuICAgIHNjcmlwdFJvb3Q6ICdhc3NldHMvc3JjJyxcbiAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiB0cnVlLFxuICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxuICAgIHN0b3BQcmVmaXg6ICdzdG9wJyxcbiAgICBydWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgICBwcmVmaXg6ICdub2RlJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJycsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGVfc3RvcCcsXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnTm9kZScsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdOb2RlJyxcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdOb2RlJyxcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdub2RlJyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICcnLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiB0cnVlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ3NwaW5lJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnc3AuU2tlbGV0b24nLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnc3AuU2tlbGV0b24nLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgICBwcmVmaXg6ICdidXR0b24nLFxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0J1dHRvbicsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdCdXR0b24nLFxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ0J1dHRvbicsXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdjYy5CdXR0b24nLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogdHJ1ZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ2xhYmVsJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdMYWJlbCcsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdMYWJlbCcsXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTGFiZWwnLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnY2MuTGFiZWwnLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICB9LFxuICAgIF0sXG59O1xuXG5leHBvcnQgY29uc3QgbWV0aG9kczogeyBba2V5OiBzdHJpbmddOiAoLi4uYXJnczogYW55W10pID0+IGFueSB9ID0ge1xuICAgIGFzeW5jIG9wZW5SdWxlc1BhbmVsKCkge1xuICAgICAgICBhd2FpdCBFZGl0b3IuUGFuZWwub3BlbihgJHtQQUNLQUdFX05BTUV9LnJ1bGVzYCk7XG4gICAgfSxcblxuICAgIGFzeW5jIHF1ZXJ5Q29uZmlnKCkge1xuICAgICAgICByZXR1cm4gcmVhZENvbmZpZygpO1xuICAgIH0sXG5cbiAgICBhc3luYyBzYXZlQ29uZmlnKGNvbmZpZzogUGFydGlhbDxCaW5kVG9vbENvbmZpZz4pIHtcbiAgICAgICAgY29uc3QgbmV4dENvbmZpZzogQmluZFRvb2xDb25maWcgPSB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0Q29uZmlnLFxuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgcnVsZXM6IG5vcm1hbGl6ZVJ1bGVzKGNvbmZpZy5ydWxlcyksXG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHRSb290JywgbmV4dENvbmZpZy5zY3JpcHRSb290KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdhdXRvQWRkQnV0dG9uQ29tcG9uZW50JywgbmV4dENvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgbmV4dENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzdG9wUHJlZml4JywgbmV4dENvbmZpZy5zdG9wUHJlZml4KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdydWxlcycsIG5leHRDb25maWcucnVsZXMpO1xuICAgICAgICByZXR1cm4gbmV4dENvbmZpZztcbiAgICB9LFxuXG4gICAgYXN5bmMgcmVzZXRDb25maWcoKSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc2NyaXB0Um9vdCcsIGRlZmF1bHRDb25maWcuc2NyaXB0Um9vdCk7XG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcsIGRlZmF1bHRDb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCk7XG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnb3ZlcndyaXRlTW9kZScsIGRlZmF1bHRDb25maWcub3ZlcndyaXRlTW9kZSk7XG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc3RvcFByZWZpeCcsIGRlZmF1bHRDb25maWcuc3RvcFByZWZpeCk7XG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAncnVsZXMnLCBkZWZhdWx0Q29uZmlnLnJ1bGVzKTtcbiAgICAgICAgcmV0dXJuIGRlZmF1bHRDb25maWc7XG4gICAgfSxcblxuICAgIGFzeW5jIGJpbmRTZWxlY3RlZE5vZGUoKSB7XG4gICAgICAgIGF3YWl0IHJ1bkJpbmRTZWxlY3RlZE5vZGUoJ2dlbmVyYXRlLWFuZC1iaW5kJyk7XG4gICAgfSxcblxuICAgIGFzeW5jIGdlbmVyYXRlU2VsZWN0ZWROb2RlU2NyaXB0KCkge1xuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdnZW5lcmF0ZScpO1xuICAgIH0sXG5cbiAgICBhc3luYyBiaW5kU2VsZWN0ZWROb2RlUmVmZXJlbmNlcygpIHtcbiAgICAgICAgYXdhaXQgcnVuQmluZFNlbGVjdGVkTm9kZSgnYmluZCcpO1xuICAgIH0sXG59O1xuXG5hc3luYyBmdW5jdGlvbiBydW5CaW5kU2VsZWN0ZWROb2RlKG1vZGU6IEJpbmRNb2RlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbW9kZVRpdGxlID0gZ2V0TW9kZVRpdGxlKG1vZGUpO1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGJpbmRTZWxlY3RlZE5vZGUobW9kZSk7XG4gICAgICAgIGNvbnN0IGRldGFpbCA9IFtcbiAgICAgICAgICAgIGBTY3JpcHQ6ICR7cmVzdWx0LnNjcmlwdFVybH1gLFxuICAgICAgICAgICAgYFByb3BlcnRpZXM6ICR7cmVzdWx0LmJpbmRpbmdzLmxlbmd0aH1gLFxuICAgICAgICAgICAgYEJ1dHRvbiBldmVudHM6ICR7cmVzdWx0LmJ1dHRvbnMubGVuZ3RofWAsXG4gICAgICAgICAgICBtb2RlID09PSAnZ2VuZXJhdGUnID8gJ0NvbXBvbmVudDogc2tpcHBlZCcgOiAocmVzdWx0LmNvbXBvbmVudEF0dGFjaGVkID8gJ0NvbXBvbmVudDogYXR0YWNoIGF0dGVtcHRlZCBzdWNjZXNzZnVsbHknIDogJ0NvbXBvbmVudDogbm90IGF0dGFjaGVkJyksXG4gICAgICAgICAgICBtb2RlID09PSAnZ2VuZXJhdGUnID8gJ0JvdW5kIHJlZmVyZW5jZXM6IHNraXBwZWQnIDogYEJvdW5kIHJlZmVyZW5jZXM6ICR7cmVzdWx0LnByb3BlcnRpZXNCb3VuZH1gLFxuICAgICAgICBdLmpvaW4oJ1xcbicpO1xuXG4gICAgICAgIEVkaXRvci5UYXNrLmFkZE5vdGljZSh7XG4gICAgICAgICAgICB0aXRsZTogYCR7bW9kZVRpdGxlfSBjb21wbGV0ZWAsXG4gICAgICAgICAgICBtZXNzYWdlOiBkZXRhaWwsXG4gICAgICAgICAgICB0eXBlOiAnc3VjY2VzcycsXG4gICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IDYwMDAsXG4gICAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFske1BBQ0tBR0VfTkFNRX1dICR7bWVzc2FnZX1gLCBlcnJvcik7XG4gICAgICAgIEVkaXRvci5UYXNrLmFkZE5vdGljZSh7XG4gICAgICAgICAgICB0aXRsZTogYCR7bW9kZVRpdGxlfSBmYWlsZWRgLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHR5cGU6ICdlcnJvcicsXG4gICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IDgwMDAsXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0TW9kZVRpdGxlKG1vZGU6IEJpbmRNb2RlKTogc3RyaW5nIHtcbiAgICBpZiAobW9kZSA9PT0gJ2dlbmVyYXRlJykge1xuICAgICAgICByZXR1cm4gJ0dlbmVyYXRlIHNjcmlwdCc7XG4gICAgfVxuXG4gICAgaWYgKG1vZGUgPT09ICdiaW5kJykge1xuICAgICAgICByZXR1cm4gJ0JpbmQgcmVmZXJlbmNlcyc7XG4gICAgfVxuXG4gICAgcmV0dXJuICdHZW5lcmF0ZSBhbmQgYmluZCc7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2FkKCkge31cblxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpIHt9XG5cbmFzeW5jIGZ1bmN0aW9uIGJpbmRTZWxlY3RlZE5vZGUobW9kZTogQmluZE1vZGUpOiBQcm9taXNlPEJpbmRSZXN1bHQ+IHtcbiAgICBjb25zdCBzZWxlY3RlZFV1aWQgPSBFZGl0b3IuU2VsZWN0aW9uLmdldExhc3RTZWxlY3RlZCgnbm9kZScpIHx8IEVkaXRvci5TZWxlY3Rpb24uZ2V0U2VsZWN0ZWQoJ25vZGUnKVswXTtcbiAgICBpZiAoIXNlbGVjdGVkVXVpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzZWxlY3QgYSBub2RlIGZpcnN0LicpO1xuICAgIH1cblxuICAgIGNvbnN0IHNlbGVjdGVkVHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScsIHNlbGVjdGVkVXVpZCk7XG4gICAgaWYgKCFzZWxlY3RlZFRyZWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgcmVhZCB0aGUgc2VsZWN0ZWQgbm9kZS4gTWFrZSBzdXJlIGEgc2NlbmUgb3IgcHJlZmFiIGlzIG9wZW4uJyk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRvQ2xhc3NOYW1lKG5vZGVOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKCk7XG4gICAgY29uc3Qgb3BlbmVkQXNzZXRVcmwgPSBhd2FpdCBxdWVyeU9wZW5lZEFzc2V0VXJsKHNlbGVjdGVkVHJlZSk7XG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBsb2NhdGUgdGhlIG9wZW5lZCBwcmVmYWIgb3Igc2NlbmUgYXNzZXQuIFBsZWFzZSBzYXZlIHRoZSBwcmVmYWIvc2NlbmUgYW5kIHJ1biBiaW5kIGFnYWluLicpO1xuICAgIH1cbiAgICBjb25zdCBzY3JpcHRVcmwgPSBtYWtlU2NyaXB0VXJsKG9wZW5lZEFzc2V0VXJsLCBjbGFzc05hbWUsIGNvbmZpZy5zY3JpcHRSb290KTtcbiAgICBjb25zdCBzY2FuID0gc2NhbkJpbmRpbmdzKHNlbGVjdGVkVHJlZSwgY29uZmlnKTtcbiAgICBjb25zdCBidXR0b25zID0gc2Nhbi5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0uZ2VuZXJhdGVDbGlja0V2ZW50KTtcbiAgICBsZXQgY3JlYXRlZCA9IGZhbHNlO1xuICAgIGxldCBjb21wb25lbnRBdHRhY2hlZCA9IGZhbHNlO1xuICAgIGxldCBwcm9wZXJ0aWVzQm91bmQgPSAwO1xuXG4gICAgaWYgKG1vZGUgIT09ICdiaW5kJykge1xuICAgICAgICBjb25zdCBzb3VyY2UgPSByZW5kZXJTY3JpcHQoY2xhc3NOYW1lLCBzY2FuLCBidXR0b25zKTtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCByZWFkQXNzZXRUZXh0KHNjcmlwdFVybCk7XG4gICAgICAgIGNvbnN0IGNhblVwZGF0ZUV4aXN0aW5nID0gZXhpc3RpbmcgPyBoYXNBbGxBdXRvQmxvY2tzKGV4aXN0aW5nKSA6IHRydWU7XG4gICAgICAgIGNvbnN0IGZpbmFsU291cmNlID0gZXhpc3RpbmcgPyB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3RpbmcsIHNvdXJjZSkgOiBzb3VyY2U7XG5cbiAgICAgICAgaWYgKGV4aXN0aW5nICYmICFjYW5VcGRhdGVFeGlzdGluZykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY3JpcHQgZXhpc3RzIGJ1dCBhdXRvLWdlbmVyYXRlZCBtYXJrZXJzIGFyZSBtaXNzaW5nLiBTdG9wIHRvIGF2b2lkIG92ZXJ3cml0aW5nIHVzZXIgY29kZTogJHtzY3JpcHRVcmx9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBjcmVhdGVkID0gIWV4aXN0aW5nO1xuICAgICAgICBhd2FpdCB3cml0ZUFzc2V0KHNjcmlwdFVybCwgZmluYWxTb3VyY2UsIGNyZWF0ZWQpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgc2NyaXB0VXJsKTtcbiAgICB9IGVsc2UgaWYgKCFhd2FpdCByZWFkQXNzZXRUZXh0KHNjcmlwdFVybCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY3JpcHQgZG9lcyBub3QgZXhpc3QuIEdlbmVyYXRlIGl0IGZpcnN0OiAke3NjcmlwdFVybH1gKTtcbiAgICB9XG5cbiAgICBpZiAobW9kZSAhPT0gJ2dlbmVyYXRlJykge1xuICAgICAgICBhd2FpdCBlbnN1cmVCdXR0b25Db21wb25lbnRzKGJ1dHRvbnMsIGNvbmZpZyk7XG4gICAgICAgIGNvbXBvbmVudEF0dGFjaGVkID0gYXdhaXQgdHJ5QXR0YWNoQ29tcG9uZW50KHNlbGVjdGVkVXVpZCwgY2xhc3NOYW1lLCBzY3JpcHRVcmwpO1xuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyk7XG4gICAgICAgICAgICBwcm9wZXJ0aWVzQm91bmQgPSBhd2FpdCBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhvcGVuZWRBc3NldFVybCwgc2NyaXB0VXJsLCBzZWxlY3RlZFV1aWQsIGNsYXNzTmFtZSwgZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKSwgc2Nhbik7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgb3BlbmVkQXNzZXRVcmwpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gc2F2ZSB0aGUgY3VycmVudCBzY2VuZSBvciBwcmVmYWIuIFBsZWFzZSBzYXZlIG1hbnVhbGx5LmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgc2NyaXB0VXJsLFxuICAgICAgICBiaW5kaW5nczogc2NhbixcbiAgICAgICAgYnV0dG9ucyxcbiAgICAgICAgY3JlYXRlZCxcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQsXG4gICAgICAgIHByb3BlcnRpZXNCb3VuZCxcbiAgICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkQ29uZmlnKCk6IFByb21pc2U8QmluZFRvb2xDb25maWc+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9qZWN0Q29uZmlnID0gYXdhaXQgRWRpdG9yLlByb2ZpbGUuZ2V0UHJvamVjdChQQUNLQUdFX05BTUUpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uZGVmYXVsdENvbmZpZyxcbiAgICAgICAgICAgIC4uLihwcm9qZWN0Q29uZmlnIHx8IHt9KSxcbiAgICAgICAgICAgIHJ1bGVzOiBub3JtYWxpemVSdWxlcyhwcm9qZWN0Q29uZmlnPy5ydWxlcyksXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZXMocnVsZXM6IHVua25vd24pOiBCaW5kUnVsZVtdIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocnVsZXMpKSB7XG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnLnJ1bGVzO1xuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBydWxlc1xuICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlICYmIHR5cGVvZiBydWxlID09PSAnb2JqZWN0JylcbiAgICAgICAgLm1hcCgocnVsZTogYW55KSA9PiBub3JtYWxpemVSdWxlKHJ1bGUpKVxuICAgICAgICAuZmlsdGVyKChydWxlKTogcnVsZSBpcyBCaW5kUnVsZSA9PiBCb29sZWFuKHJ1bGUpKTtcblxuICAgIHJldHVybiBub3JtYWxpemVkLmxlbmd0aCA+IDAgPyBub3JtYWxpemVkIDogZGVmYXVsdENvbmZpZy5ydWxlcztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZShydWxlOiBhbnkpOiBCaW5kUnVsZSB8IG51bGwge1xuICAgIGNvbnN0IHByZWZpeCA9IFN0cmluZyhydWxlLnByZWZpeCB8fCAnJykudHJpbSgpO1xuICAgIGlmICghcHJlZml4KSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudE5hbWUgPSBTdHJpbmcocnVsZS5jb21wb25lbnROYW1lIHx8IHJ1bGUucHJvcGVydHlUeXBlIHx8ICdOb2RlJykudHJpbSgpO1xuICAgIGNvbnN0IHByb3BlcnR5VHlwZSA9IG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZSk7XG4gICAgY29uc3QgYmluZFRhcmdldDogQmluZFRhcmdldCA9IHByb3BlcnR5VHlwZSA9PT0gJ05vZGUnID8gJ25vZGUnIDogJ2NvbXBvbmVudCc7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBwcmVmaXgsXG4gICAgICAgIGNvbXBvbmVudE5hbWU6IHByb3BlcnR5VHlwZSxcbiAgICAgICAgcHJvcGVydHlUeXBlLFxuICAgICAgICBkZWNvcmF0b3JUeXBlOiBwcm9wZXJ0eVR5cGUsXG4gICAgICAgIGJpbmRUYXJnZXQsXG4gICAgICAgIGNvbXBvbmVudFR5cGU6IGJpbmRUYXJnZXQgPT09ICdjb21wb25lbnQnID8gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZSkgOiAnJyxcbiAgICAgICAgc3RvcENoaWxkcmVuOiBCb29sZWFuKHJ1bGUuc3RvcENoaWxkcmVuKSB8fCBwcmVmaXggPT09ICdub2RlX3N0b3AnLFxuICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGlzQnV0dG9uVHlwZShwcm9wZXJ0eVR5cGUpLFxuICAgICAgICBlbmFibGVkOiBydWxlLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB2YWx1ZSA9IGNvbXBvbmVudE5hbWUudHJpbSgpO1xuICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSkge1xuICAgICAgICByZXR1cm4gc2hvcnRUeXBlTmFtZSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICdOb2RlJztcbn1cblxuZnVuY3Rpb24gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBpZiAoaXNCdWlsdGluQ2NDb21wb25lbnQocHJvcGVydHlUeXBlKSkge1xuICAgICAgICByZXR1cm4gYGNjLiR7cHJvcGVydHlUeXBlfWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZTtcbn1cblxuZnVuY3Rpb24gaXNCdWlsdGluQ2NDb21wb25lbnQocHJvcGVydHlUeXBlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gW1xuICAgICAgICAnQnV0dG9uJyxcbiAgICAgICAgJ0VkaXRCb3gnLFxuICAgICAgICAnTGFiZWwnLFxuICAgICAgICAnTGF5b3V0JyxcbiAgICAgICAgJ01hc2snLFxuICAgICAgICAnUGFnZVZpZXcnLFxuICAgICAgICAnUHJvZ3Jlc3NCYXInLFxuICAgICAgICAnUmljaFRleHQnLFxuICAgICAgICAnU2Nyb2xsVmlldycsXG4gICAgICAgICdTbGlkZXInLFxuICAgICAgICAnU3ByaXRlJyxcbiAgICAgICAgJ1RvZ2dsZScsXG4gICAgICAgICdXaWRnZXQnLFxuICAgIF0uaW5jbHVkZXMocHJvcGVydHlUeXBlKTtcbn1cblxuZnVuY3Rpb24gaXNCdXR0b25UeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZSA9PT0gJ0J1dHRvbicgfHwgcHJvcGVydHlUeXBlID09PSAnY2MuQnV0dG9uJztcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNhdmVkSWQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyk7XG4gICAgICAgIGlmICghc2F2ZWRJZCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIHNhdmVkSWQpO1xuICAgICAgICByZXR1cm4gYXNzZXQ/LnVybCB8fCBhc3NldD8uc291cmNlIHx8IGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlOiBhbnkpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgNTsgaW5kZXggKz0gMSkge1xuICAgICAgICBjb25zdCB1cmwgPSBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XG4gICAgICAgIGlmICh1cmwpIHtcbiAgICAgICAgICAgIHJldHVybiB1cmw7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgZGVsYXkoMTIwKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gZmluZEFzc2V0VXJsQnlOb2RlVHJlZShzZWxlY3RlZFRyZWU6IGFueSk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGFzc2V0c0RpciA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycpO1xuICAgIGlmICghZXhpc3RzU3luYyhhc3NldHNEaXIpKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IHJvb3ROYW1lID0gZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKTtcbiAgICBjb25zdCBjaGlsZE5hbWVzID0gbmV3IFNldChnZXRDaGlsZHJlbihzZWxlY3RlZFRyZWUpLm1hcChnZXROb2RlTmFtZSkpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBsaXN0QXNzZXRGaWxlcyhhc3NldHNEaXIsIFsnLnByZWZhYicsICcuc2NlbmUnXSk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlYWRKc29uRmlsZVN5bmMoZmlsZSk7XG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgbm9kZXMgPSBkYXRhLmZpbHRlcigoaXRlbSkgPT4gaXRlbT8uX190eXBlX18gPT09ICdjYy5Ob2RlJyk7XG4gICAgICAgICAgICBjb25zdCBoYXNSb290ID0gbm9kZXMuc29tZSgobm9kZSkgPT4gbm9kZT8uX25hbWUgPT09IHJvb3ROYW1lKTtcbiAgICAgICAgICAgIGlmICghaGFzUm9vdCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBub2RlTmFtZXMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobm9kZSkgPT4gbm9kZT8uX25hbWUpLmZpbHRlcihCb29sZWFuKSk7XG4gICAgICAgICAgICBjb25zdCBjaGlsZE1hdGNoQ291bnQgPSBbLi4uY2hpbGROYW1lc10uZmlsdGVyKChuYW1lKSA9PiBub2RlTmFtZXMuaGFzKG5hbWUpKS5sZW5ndGg7XG4gICAgICAgICAgICBpZiAoY2hpbGROYW1lcy5zaXplID09PSAwIHx8IGNoaWxkTWF0Y2hDb3VudCA+IDAgfHwgYmFzZW5hbWUoZmlsZSwgZXh0bmFtZShmaWxlKSkgPT09IHJvb3ROYW1lKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRSZWxhdGl2ZSA9IHJlbGF0aXZlKEVkaXRvci5Qcm9qZWN0LnBhdGgsIGZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYGRiOi8vJHthc3NldFJlbGF0aXZlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAoIWlzSW5jb21wbGV0ZUpzb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBpbnNwZWN0IGFzc2V0ICR7ZmlsZX0uYCwgZXJyb3IpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHJlYWRKc29uRmlsZVN5bmMoZmlsZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XG4gICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRKc29uRmlsZVdpdGhSZXRyeShmaWxlOiBzdHJpbmcsIGF0dGVtcHRzID0gNSk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhdHRlbXB0czsgaW5kZXggKz0gMSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpIHx8IGluZGV4ID09PSBhdHRlbXB0cyAtIDEpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IGRlbGF5KDEyMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNJbmNvbXBsZXRlSnNvbkVycm9yKGVycm9yOiB1bmtub3duKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgU3ludGF4RXJyb3IgJiYgL1VuZXhwZWN0ZWQgZW5kIG9mIEpTT04gaW5wdXQvLnRlc3QoZXJyb3IubWVzc2FnZSk7XG59XG5cbmZ1bmN0aW9uIGxpc3RBc3NldEZpbGVzKGRpcjogc3RyaW5nLCBleHRlbnNpb25zOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlYWRkaXJTeW5jKGRpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xuICAgICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4ubGlzdEFzc2V0RmlsZXMoZnVsbFBhdGgsIGV4dGVuc2lvbnMpKTtcbiAgICAgICAgfSBlbHNlIGlmIChleHRlbnNpb25zLmluY2x1ZGVzKGV4dG5hbWUoZW50cnkubmFtZSkudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIG1ha2VTY3JpcHRVcmwob3BlbmVkQXNzZXRVcmw6IHN0cmluZyB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRSb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRSb290ID0gbm9ybWFsaXplQXNzZXRQYXRoKHNjcmlwdFJvb3QgfHwgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBjb25zdCByb290U2NyaXB0VXJsID0gYGRiOi8vJHtub3JtYWxpemVkUm9vdH0vJHtjbGFzc05hbWV9LnRzYDtcbiAgICBpZiAoYXNzZXRVcmxFeGlzdHMocm9vdFNjcmlwdFVybCkpIHtcbiAgICAgICAgcmV0dXJuIHJvb3RTY3JpcHRVcmw7XG4gICAgfVxuXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xuICAgICAgICByZXR1cm4gcm9vdFNjcmlwdFVybDtcbiAgICB9XG5cbiAgICBjb25zdCBhc3NldFBhdGggPSBvcGVuZWRBc3NldFVybFxuICAgICAgICAucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKVxuICAgICAgICAucmVwbGFjZSgvXFwuKHByZWZhYnxzY2VuZSkkL2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gYXNzZXRQYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cy8nKVxuICAgICAgICA/IGFzc2V0UGF0aC5zbGljZSgnYXNzZXRzLycubGVuZ3RoKVxuICAgICAgICA6IGFzc2V0UGF0aC5yZXBsYWNlKC9eLio/YXNzZXRzXFwvLywgJycpO1xuICAgIGNvbnN0IGRpciA9IHJlbGF0aXZlUGF0aC5pbmNsdWRlcygnLycpID8gcmVsYXRpdmVQYXRoLnNsaWNlKDAsIHJlbGF0aXZlUGF0aC5sYXN0SW5kZXhPZignLycpKSA6ICcnO1xuXG4gICAgcmV0dXJuIGBkYjovLyR7bm9ybWFsaXplZFJvb3R9JHtkaXIgPyBgLyR7ZGlyfWAgOiAnJ30vJHtjbGFzc05hbWV9LnRzYDtcbn1cblxuZnVuY3Rpb24gYXNzZXRVcmxFeGlzdHModXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB1cmwucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKS5yZXBsYWNlKC9cXC8vZywgJ1xcXFwnKTtcbiAgICByZXR1cm4gZXhpc3RzU3luYyhqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsIHJlbGF0aXZlUGF0aCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVBc3NldFBhdGgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnJlcGxhY2UoL1xcXFwvZywgJy8nKS5yZXBsYWNlKC9eZGI6XFwvXFwvLywgJycpLnJlcGxhY2UoL15cXC8rLywgJycpO1xuICAgIHJldHVybiBwYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cycpID8gcGF0aCA6IGBhc3NldHMvJHtwYXRofWA7XG59XG5cbmZ1bmN0aW9uIHNjYW5CaW5kaW5ncyhyb290OiBhbnksIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBTY2FubmVkQmluZGluZ1tdIHtcbiAgICBjb25zdCB1c2VkTmFtZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdID0gW107XG4gICAgY29uc3QgcnVsZXMgPSBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKTtcblxuICAgIGNvbnN0IHZpc2l0ID0gKG5vZGU6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xuICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBub2RlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmIChsb3dlck5hbWUuc3RhcnRzV2l0aChjb25maWcuc3RvcFByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobm9kZSwgcnVsZXMsIHVzZWROYW1lcyk7XG4gICAgICAgIGlmIChiaW5kaW5nKSB7XG4gICAgICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJpbmRpbmc/LnN0b3BDaGlsZHJlbikge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBnZXRDaGlsZHJlbihub2RlKSkge1xuICAgICAgICAgICAgdmlzaXQoY2hpbGQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZpc2l0KHJvb3QpO1xuICAgIHJldHVybiBiaW5kaW5ncztcbn1cblxuZnVuY3Rpb24gZ2V0U29ydGVkRW5hYmxlZFJ1bGVzKGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBCaW5kUnVsZVtdIHtcbiAgICByZXR1cm4gY29uZmlnLnJ1bGVzXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZCAmJiBydWxlLnByZWZpeClcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5wcmVmaXgubGVuZ3RoIC0gbGVmdC5wcmVmaXgubGVuZ3RoKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhub2RlOiBhbnksIHJ1bGVzOiBCaW5kUnVsZVtdLCB1c2VkTmFtZXM6IE1hcDxzdHJpbmcsIG51bWJlcj4pOiBTY2FubmVkQmluZGluZyB8IG51bGwge1xuICAgIGNvbnN0IG5vZGVOYW1lID0gZ2V0Tm9kZU5hbWUobm9kZSk7XG4gICAgY29uc3QgbG93ZXJOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBydWxlID0gcnVsZXMuZmluZCgoaXRlbSkgPT4gbG93ZXJOYW1lLnN0YXJ0c1dpdGgoaXRlbS5wcmVmaXgudG9Mb3dlckNhc2UoKSkpO1xuXG4gICAgaWYgKCFydWxlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG5vZGVVdWlkOiBnZXRVdWlkKG5vZGUpLFxuICAgICAgICBub2RlTmFtZSxcbiAgICAgICAgcHJvcGVydHlOYW1lOiBtYWtlVW5pcXVlTmFtZSh0b1Byb3BlcnR5TmFtZShub2RlTmFtZSksIHVzZWROYW1lcyksXG4gICAgICAgIHByb3BlcnR5VHlwZTogcnVsZS5wcm9wZXJ0eVR5cGUsXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHJ1bGUuZGVjb3JhdG9yVHlwZSxcbiAgICAgICAgYmluZFRhcmdldDogcnVsZS5iaW5kVGFyZ2V0LFxuICAgICAgICBjb21wb25lbnRUeXBlOiBydWxlLmNvbXBvbmVudFR5cGUsXG4gICAgICAgIHN0b3BDaGlsZHJlbjogcnVsZS5zdG9wQ2hpbGRyZW4sXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogcnVsZS5nZW5lcmF0ZUNsaWNrRXZlbnQsXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0Tm9kZU5hbWUobm9kZTogYW55KTogc3RyaW5nIHtcbiAgICByZXR1cm4gU3RyaW5nKHJlYWREdW1wVmFsdWUobm9kZT8ubmFtZSkgfHwgJ05vZGUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0VXVpZChub2RlOiBhbnkpOiBzdHJpbmcge1xuICAgIHJldHVybiBTdHJpbmcocmVhZER1bXBWYWx1ZShub2RlPy51dWlkKSB8fCBub2RlPy51dWlkIHx8ICcnKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2hpbGRyZW4obm9kZTogYW55KTogYW55W10ge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KG5vZGU/LmNoaWxkcmVuKSA/IG5vZGUuY2hpbGRyZW4gOiBbXTtcbn1cblxuZnVuY3Rpb24gcmVhZER1bXBWYWx1ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAndmFsdWUnIGluIHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS52YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b0NsYXNzTmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBuYW1lID0gdG9Qcm9wZXJ0eU5hbWUodmFsdWUpO1xuICAgIHJldHVybiB1cHBlckZpcnN0KG5hbWUucmVwbGFjZSgvXl8rLywgJycpIHx8ICdBdXRvQmluZENvbXBvbmVudCcpO1xufVxuXG5mdW5jdGlvbiB0b1Byb3BlcnR5TmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAucmVwbGFjZSgvW15cXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfSRfXFx1MjAwQ1xcdTIwMERdKy9ndSwgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXysvZywgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXl8rfF8rJC9nLCAnJyk7XG5cbiAgICBjb25zdCBjbGVhbmVkID0gbm9ybWFsaXplZFxuICAgICAgICAuc3BsaXQoJycpXG4gICAgICAgIC5maWx0ZXIoKGNoYXIsIGluZGV4KSA9PiBpbmRleCA9PT0gMCA/IGlzSWRlbnRpZmllclN0YXJ0KGNoYXIpIDogaXNJZGVudGlmaWVyQ29udGludWUoY2hhcikpXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgIGlmICghY2xlYW5lZCkge1xuICAgICAgICByZXR1cm4gJ25vZGUnO1xuICAgIH1cblxuICAgIHJldHVybiBpc0lkZW50aWZpZXJTdGFydChjbGVhbmVkWzBdKSA/IGNsZWFuZWQgOiBgXyR7Y2xlYW5lZH1gO1xufVxuXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJTdGFydChjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gL1skX1xccHtJRF9TdGFydH1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gaXNJZGVudGlmaWVyQ29udGludWUoY2hhcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9bJF9cXHUyMDBDXFx1MjAwRFxccHtJRF9Db250aW51ZX1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gbWFrZVVuaXF1ZU5hbWUoYmFzZU5hbWU6IHN0cmluZywgdXNlZE5hbWVzOiBNYXA8c3RyaW5nLCBudW1iZXI+KTogc3RyaW5nIHtcbiAgICBjb25zdCBjb3VudCA9IHVzZWROYW1lcy5nZXQoYmFzZU5hbWUpIHx8IDA7XG4gICAgdXNlZE5hbWVzLnNldChiYXNlTmFtZSwgY291bnQgKyAxKTtcbiAgICByZXR1cm4gY291bnQgPT09IDAgPyBiYXNlTmFtZSA6IGAke2Jhc2VOYW1lfSR7Y291bnQgKyAxfWA7XG59XG5cbmZ1bmN0aW9uIHVwcGVyRmlyc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHZhbHVlID8gdmFsdWVbMF0udG9VcHBlckNhc2UoKSArIHZhbHVlLnNsaWNlKDEpIDogdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNjcmlwdChjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBgaW1wb3J0IHsgJHtyZW5kZXJDY0ltcG9ydHMoYmluZGluZ3MpfSB9IGZyb20gJ2NjJztcblxuY29uc3QgeyBjY2NsYXNzLCBwcm9wZXJ0eSB9ID0gX2RlY29yYXRvcjtcblxuQGNjY2xhc3MoJyR7Y2xhc3NOYW1lfScpXG5leHBvcnQgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgQ29tcG9uZW50IHtcblxuICAgICR7QVVUT19CSU5EX1NUQVJUfVxuJHtyZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzKX1cbiAgICAke0FVVE9fQklORF9FTkR9XG5cbiAgICBwcm90ZWN0ZWQgb25Mb2FkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLmJpbmRCdXR0b25FdmVudHMoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGJpbmRCdXR0b25FdmVudHMoKTogdm9pZCB7XG4gICAgICAgICR7QVVUT19CVVRUT05fRVZFTlRfU1RBUlR9XG4ke3JlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zKX1cbiAgICAgICAgJHtBVVRPX0JVVFRPTl9FVkVOVF9FTkR9XG4gICAgfVxuXG4gICAgJHtBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUfVxuJHtyZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zKX1cbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfRU5EfVxufVxuYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2NJbXBvcnRzKGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCBpbXBvcnRzID0gbmV3IFNldChbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50J10pO1xuXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLmRlY29yYXRvclR5cGUpO1xuICAgIH1cblxuICAgIGlmIChiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBiaW5kaW5nLmdlbmVyYXRlQ2xpY2tFdmVudCkpIHtcbiAgICAgICAgaW1wb3J0cy5hZGQoJ0J1dHRvbicpO1xuICAgIH1cblxuICAgIHJldHVybiBzb3J0Q2NJbXBvcnRzKGltcG9ydHMpLmpvaW4oJywgJyk7XG59XG5cbmZ1bmN0aW9uIHNvcnRDY0ltcG9ydHMoaW1wb3J0czogSXRlcmFibGU8c3RyaW5nPik6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQoaW1wb3J0cyldXG4gICAgICAgIC5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0gJiYgaXRlbSAhPT0gJ2NjJylcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IFsnX2RlY29yYXRvcicsICdDb21wb25lbnQnLCAnTm9kZScsICdCdXR0b24nLCAnTGFiZWwnLCAnU3ByaXRlJywgJ1dpZGdldCcsICdzcCddO1xuICAgICAgICAgICAgY29uc3QgbGVmdEluZGV4ID0gb3JkZXIuaW5kZXhPZihsZWZ0KTtcbiAgICAgICAgICAgIGNvbnN0IHJpZ2h0SW5kZXggPSBvcmRlci5pbmRleE9mKHJpZ2h0KTtcbiAgICAgICAgICAgIGlmIChsZWZ0SW5kZXggIT09IC0xIHx8IHJpZ2h0SW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChsZWZ0SW5kZXggPT09IC0xID8gOTkgOiBsZWZ0SW5kZXgpIC0gKHJpZ2h0SW5kZXggPT09IC0xID8gOTkgOiByaWdodEluZGV4KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGxlZnQubG9jYWxlQ29tcGFyZShyaWdodCk7XG4gICAgICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0SW1wb3J0RnJvbVR5cGUoaW1wb3J0czogU2V0PHN0cmluZz4sIHR5cGVOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcbiAgICBjb25zdCBpbXBvcnROYW1lID0gdmFsdWUuc3RhcnRzV2l0aCgnY2MuJykgPyBzaG9ydFR5cGVOYW1lKHZhbHVlKSA6IHZhbHVlLnNwbGl0KCcuJylbMF07XG4gICAgaWYgKC9eW0EtWmEtel8kXVtBLVphLXowLTlfJF0qJC8udGVzdChpbXBvcnROYW1lKSkge1xuICAgICAgICBpbXBvcnRzLmFkZChpbXBvcnROYW1lKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlclByb3BlcnRpZXMoYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBiaW5kaW5ncy5tYXAoKGJpbmRpbmcpID0+IGAgICAgQHByb3BlcnR5KCR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLmRlY29yYXRvclR5cGUpfSlcbiAgICBwdWJsaWMgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX06ICR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLnByb3BlcnR5VHlwZSl9IHwgbnVsbCA9IG51bGw7YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHRvU2NyaXB0VHlwZU5hbWUodHlwZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdmFsdWUgPSB0eXBlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ2NjLicpID8gc2hvcnRUeXBlTmFtZSh2YWx1ZSkgOiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyQnV0dG9uRXZlbnRzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgICAgICBpZiAodGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9KSB7XG4gICAgICAgICAgICB0aGlzLiR7YnV0dG9uLnByb3BlcnR5TmFtZX0ubm9kZS5vbihCdXR0b24uRXZlbnRUeXBlLkNMSUNLLCB0aGlzLiR7Z2V0Q2xpY2tIYW5kbGVyTmFtZShidXR0b24ucHJvcGVydHlOYW1lKX0sIHRoaXMpO1xuICAgICAgICB9YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkhhbmRsZXJzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgIHByaXZhdGUgJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSgpOiB2b2lkIHtcblxuICAgIH1gKS5qb2luKCdcXG5cXG4nKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2xpY2tIYW5kbGVyTmFtZShwcm9wZXJ0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBvbkNsaWNrJHt1cHBlckZpcnN0KHByb3BlcnR5TmFtZS5yZXBsYWNlKC9eYnV0dG9uXz8vLCAnQnV0dG9uXycpKX1gO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGJpbmRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORCk7XG4gICAgY29uc3QgZXZlbnRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpO1xuICAgIGNvbnN0IGhhbmRsZXJCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKTtcblxuICAgIGlmICghaGFzQWxsQXV0b0Jsb2NrcyhleGlzdGluZykpIHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGNvbnN0IGJpbmRNYXJrZXJzID0gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORClcbiAgICAgICAgfHwgZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKVxuICAgICAgICB8fCAoW0FVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORF0gYXMgY29uc3QpO1xuXG4gICAgbGV0IHVwZGF0ZWQgPSByZXBsYWNlQmxvY2soZXhpc3RpbmcsIGJpbmRNYXJrZXJzWzBdLCBiaW5kTWFya2Vyc1sxXSwgYmluZEJsb2NrKTtcbiAgICB1cGRhdGVkID0gdXBkYXRlZC5yZXBsYWNlKGJpbmRNYXJrZXJzWzBdLCBBVVRPX0JJTkRfU1RBUlQpLnJlcGxhY2UoYmluZE1hcmtlcnNbMV0sIEFVVE9fQklORF9FTkQpO1xuXG4gICAgY29uc3QgdXBkYXRlZEJsb2NrcyA9IHJlcGxhY2VCbG9jayhcbiAgICAgICAgcmVwbGFjZUJsb2NrKFxuICAgICAgICAgICAgdXBkYXRlZCxcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULFxuICAgICAgICAgICAgQVVUT19CVVRUT05fRVZFTlRfRU5ELFxuICAgICAgICAgICAgZXZlbnRCbG9jayxcbiAgICAgICAgKSxcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCxcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9FTkQsXG4gICAgICAgIGhhbmRsZXJCbG9jayxcbiAgICApO1xuXG4gICAgcmV0dXJuIG1lcmdlQ2NJbXBvcnRzKHVwZGF0ZWRCbG9ja3MsIGdlbmVyYXRlZCk7XG59XG5cbmZ1bmN0aW9uIGhhc0FsbEF1dG9CbG9ja3Moc291cmNlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKSB8fCBoYXNCbG9jayhzb3VyY2UsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKSlcbiAgICAgICAgJiYgaGFzQmxvY2soc291cmNlLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKVxuICAgICAgICAmJiBoYXNCbG9jayhzb3VyY2UsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKTtcbn1cblxuZnVuY3Rpb24gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogcmVhZG9ubHkgW3N0cmluZywgc3RyaW5nXSB8IG51bGwge1xuICAgIHJldHVybiBoYXNCbG9jayhzb3VyY2UsIHN0YXJ0LCBlbmQpID8gW3N0YXJ0LCBlbmRdIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gaGFzQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHNvdXJjZS5pbmNsdWRlcyhzdGFydCkgJiYgc291cmNlLmluY2x1ZGVzKGVuZCkgJiYgc291cmNlLmluZGV4T2Yoc3RhcnQpIDwgc291cmNlLmluZGV4T2YoZW5kKTtcbn1cblxuZnVuY3Rpb24gcGlja0Jsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcbiAgICBjb25zdCBlbmRJbmRleCA9IHNvdXJjZS5pbmRleE9mKGVuZCk7XG4gICAgcmV0dXJuIHNvdXJjZS5zbGljZShzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoLCBlbmRJbmRleCk7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcbiAgICBjb25zdCBlbmRJbmRleCA9IHNvdXJjZS5pbmRleE9mKGVuZCk7XG4gICAgcmV0dXJuIGAke3NvdXJjZS5zbGljZSgwLCBzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoKX0ke2NvbnRlbnR9JHtzb3VyY2Uuc2xpY2UoZW5kSW5kZXgpfWA7XG59XG5cbmZ1bmN0aW9uIG1lcmdlQ2NJbXBvcnRzKGV4aXN0aW5nOiBzdHJpbmcsIGdlbmVyYXRlZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBpbXBvcnRQYXR0ZXJuID0gL15pbXBvcnRcXHMrXFx7XFxzKihbXn1dKz8pXFxzKlxcfVxccytmcm9tXFxzK1snXCJdY2NbJ1wiXTtcXHMqJC9tO1xuICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBleGlzdGluZy5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcbiAgICBjb25zdCBnZW5lcmF0ZWRNYXRjaCA9IGdlbmVyYXRlZC5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcblxuICAgIGlmICghZ2VuZXJhdGVkTWF0Y2gpIHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdNYXRjaCkge1xuICAgICAgICByZXR1cm4gYCR7Z2VuZXJhdGVkTWF0Y2hbMF19XFxuJHtleGlzdGluZ31gO1xuICAgIH1cblxuICAgIGNvbnN0IG1lcmdlZCA9IHNvcnRDY0ltcG9ydHMoW1xuICAgICAgICAuLi5wYXJzZUNjSW1wb3J0TmFtZXMoZXhpc3RpbmdNYXRjaFsxXSksXG4gICAgICAgIC4uLnBhcnNlQ2NJbXBvcnROYW1lcyhnZW5lcmF0ZWRNYXRjaFsxXSksXG4gICAgXSk7XG5cbiAgICByZXR1cm4gZXhpc3RpbmcucmVwbGFjZShpbXBvcnRQYXR0ZXJuLCBgaW1wb3J0IHsgJHttZXJnZWQuam9pbignLCAnKX0gfSBmcm9tICdjYyc7YCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2NJbXBvcnROYW1lcyhpbXBvcnRzOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGltcG9ydHNcbiAgICAgICAgLnNwbGl0KCcsJylcbiAgICAgICAgLm1hcCgoaXRlbSkgPT4gaXRlbS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRBc3NldFRleHQodXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBhc3NldCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1cmwpO1xuICAgIGlmICghYXNzZXQ/LmZpbGUpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYyhhc3NldC5maWxlLCAndXRmOCcpO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZUFzc2V0KHVybDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgY3JlYXRlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChjcmVhdGVkKSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ2NyZWF0ZS1hc3NldCcsIHVybCwgc291cmNlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3NhdmUtYXNzZXQnLCB1cmwsIHNvdXJjZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeUF0dGFjaENvbXBvbmVudChub2RlVXVpZDogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0VXJsOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIGNsYXNzTmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc3QgcmVnaXN0ZXJlZENhbmRpZGF0ZXMgPSBhd2FpdCB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWUsIHNjcmlwdFVybCk7XG4gICAgaWYgKHJlZ2lzdGVyZWRDYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIFNjcmlwdCBjb21wb25lbnQgJHtjbGFzc05hbWV9IHdhcyBub3QgcmVnaXN0ZXJlZCB5ZXQuIFRyeWluZyB0byBhdHRhY2ggYW55d2F5LmApO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudENhbmRpZGF0ZXMgPSBbLi4ubmV3IFNldChbXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgbm9ybWFsaXplQ2xhc3NOYW1lKGNsYXNzTmFtZSksXG4gICAgICAgIC4uLnJlZ2lzdGVyZWRDYW5kaWRhdGVzLFxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKV07XG5cbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudE5hbWUgb2YgY29tcG9uZW50Q2FuZGlkYXRlcykge1xuICAgICAgICBpZiAoYXdhaXQgY3JlYXRlQ29tcG9uZW50QW5kVmVyaWZ5KG5vZGVVdWlkLCBjb21wb25lbnROYW1lLCBjb21wb25lbnRDYW5kaWRhdGVzKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyAxMjAwMDtcbiAgICBjb25zdCBzY3JpcHRBc3NldCA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvU2FmZShzY3JpcHRVcmwpO1xuICAgIGNvbnN0IGNhY2hlZENpZCA9IHJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpO1xuICAgIGxldCBsb2dnZWQgPSBmYWxzZTtcblxuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHF1ZXJ5UmVnaXN0ZXJlZFNjcmlwdENvbXBvbmVudENhbmRpZGF0ZXMoY2xhc3NOYW1lLCBzY3JpcHRBc3NldCk7XG4gICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiBbLi4ubmV3IFNldChbLi4uY2FuZGlkYXRlcywgLi4uY2FjaGVkQ2lkXSldO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFsb2dnZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBXYWl0aW5nIGZvciBzY3JpcHQgaW1wb3J0OiAke2NsYXNzTmFtZX1gKTtcbiAgICAgICAgICAgIGxvZ2dlZCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBkZWxheSg1MDApO1xuICAgIH1cblxuICAgIHJldHVybiBjYWNoZWRDaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5QXNzZXRJbmZvU2FmZSh1cmw6IHN0cmluZyk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBxdWVyeVJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRBc3NldDogYW55IHwgbnVsbCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBjb21wb25lbnRzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktY29tcG9uZW50cycpO1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29tcG9uZW50cykpIHtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFV1aWQgPSBzY3JpcHRBc3NldD8udXVpZCA/IFN0cmluZyhzY3JpcHRBc3NldC51dWlkKSA6ICcnO1xuICAgICAgICBjb25zdCBzY3JpcHRVcmwgPSBzY3JpcHRBc3NldD8udXJsID8gU3RyaW5nKHNjcmlwdEFzc2V0LnVybCkgOiAnJztcbiAgICAgICAgY29uc3Qgc2NyaXB0RmlsZSA9IHNjcmlwdEFzc2V0Py5maWxlID8gU3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA6ICcnO1xuICAgICAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xuICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5wYXRoLFxuICAgICAgICAgICAgICAgIGNvbXBvbmVudD8uYXNzZXRVdWlkLFxuICAgICAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgICAgICBjb25zdCBtYXRjaGVkID0gY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgY2xhc3NOYW1lKSlcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFV1aWQgJiYgY2FuZGlkYXRlcy5pbmNsdWRlcyhzY3JpcHRVdWlkKSlcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFVybCAmJiBjYW5kaWRhdGVzLmluY2x1ZGVzKHNjcmlwdFVybCkpXG4gICAgICAgICAgICAgICAgfHwgQm9vbGVhbihzY3JpcHRGaWxlICYmIGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUucmVwbGFjZSgvXFxcXC9nLCAnLycpID09PSBzY3JpcHRGaWxlKSk7XG5cbiAgICAgICAgICAgIGlmIChtYXRjaGVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4uY2FuZGlkYXRlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0LmZpbHRlcigoY2FuZGlkYXRlKSA9PiBpc0NvbXBvbmVudEF0dGFjaENhbmRpZGF0ZShjYW5kaWRhdGUpKSldO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHF1ZXJ5IHJlZ2lzdGVyZWQgY29tcG9uZW50cy5gLCBlcnJvcik7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGlzQ29tcG9uZW50QXR0YWNoQ2FuZGlkYXRlKGNhbmRpZGF0ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9eW0EtWmEtejAtOV8kLi86QC1dKyQvLnRlc3QoY2FuZGlkYXRlKTtcbn1cblxuZnVuY3Rpb24gcmVhZFNjcmlwdENpZEZyb21Qcm9ncmFtQ2FjaGUoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGlmICghc2NyaXB0QXNzZXQ/LmZpbGUpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZVVybCA9IGBmaWxlOi8vLyR7U3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gO1xuICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB0YXJnZXRzID0gW1xuICAgICAgICBqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsICd0ZW1wJywgJ3Byb2dyYW1taW5nJywgJ3BhY2tlci1kcml2ZXInLCAndGFyZ2V0cycsICdlZGl0b3InKSxcbiAgICAgICAgam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAndGVtcCcsICdwcm9ncmFtbWluZycsICdwYWNrZXItZHJpdmVyJywgJ3RhcmdldHMnLCAncHJldmlldycpLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHRhcmdldERpciBvZiB0YXJnZXRzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXBQYXRoID0gam9pbih0YXJnZXREaXIsICdpbXBvcnQtbWFwLmpzb24nKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhpbXBvcnRNYXBQYXRoKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXAgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhpbXBvcnRNYXBQYXRoLCAndXRmOCcpKTtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rUmVsYXRpdmUgPSBpbXBvcnRNYXA/LmltcG9ydHM/Lltzb3VyY2VVcmxdIHx8IGltcG9ydE1hcD8uW3NvdXJjZVVybF07XG4gICAgICAgICAgICBpZiAoIWNodW5rUmVsYXRpdmUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2h1bmtGaWxlID0gam9pbih0YXJnZXREaXIsIFN0cmluZyhjaHVua1JlbGF0aXZlKS5yZXBsYWNlKC9eXFwuXFwvLywgJycpKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhjaHVua0ZpbGUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNodW5rU291cmNlID0gcmVhZEZpbGVTeW5jKGNodW5rRmlsZSwgJ3V0ZjgnKTtcbiAgICAgICAgICAgIGNvbnN0IGVzY2FwZWRDbGFzc05hbWUgPSBjbGFzc05hbWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gY2h1bmtTb3VyY2UubWF0Y2gobmV3IFJlZ0V4cChgX1JGXFxcXC5wdXNoXFxcXChcXFxce1xcXFx9LFxcXFxzKltcIiddKFteXCInXSspW1wiJ10sXFxcXHMqW1wiJ10ke2VzY2FwZWRDbGFzc05hbWV9W1wiJ11gKSk7XG4gICAgICAgICAgICBpZiAobWF0Y2g/LlsxXSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG1hdGNoWzFdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlYWQgc2NyaXB0IGNpZCBmcm9tIHByb2dyYW0gY2FjaGUuYCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHJlc3VsdCldO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnRBbmRWZXJpZnkobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nLCBtYXRjaE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XG4gICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudDogY29tcG9uZW50TmFtZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IGRlbGF5KDEwMCk7XG4gICAgICAgIGlmIChhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgbWF0Y2hOYW1lcykpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gY3JlYXRlLWNvbXBvbmVudCByZXR1cm5lZCBidXQgJHtjb21wb25lbnROYW1lfSB3YXMgbm90IGZvdW5kIG9uIHRoZSBub2RlLmApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYXR0YWNoIGNvbXBvbmVudCAke2NvbXBvbmVudE5hbWV9LmAsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQ2xhc3NOYW1lKGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gY2xhc3NOYW1lLnJlcGxhY2UoL1teQS1aYS16MC05XyRcXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfVxcdTIwMENcXHUyMDBEXS9ndSwgJ18nKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYmluZENvbXBvbmVudFByb3BlcnRpZXMobm9kZVV1aWQ6IHN0cmluZywgY2xhc3NOYW1lOiBzdHJpbmcsIHNjcmlwdFVybDogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcbiAgICBjb25zdCBjb21wb25lbnRVdWlkID0gYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQsIGNsYXNzTmFtZSkpO1xuICAgIGlmICghY29tcG9uZW50VXVpZCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIGNvbXBvbmVudCAke2NsYXNzTmFtZX0gZm9yIHByb3BlcnR5IGJpbmRpbmcuYCk7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudER1bXAgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1jb21wb25lbnQnLCBjb21wb25lbnRVdWlkKTtcbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcbiAgICAgICAgY29uc3QgcHJvcGVydHlEdW1wID0gZ2V0UHJvcGVydHlEdW1wKGNvbXBvbmVudER1bXAsIGJpbmRpbmcucHJvcGVydHlOYW1lKTtcbiAgICAgICAgaWYgKCFwcm9wZXJ0eUR1bXApIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gQ2Fubm90IGZpbmQgcHJvcGVydHkgZHVtcCAke2JpbmRpbmcucHJvcGVydHlOYW1lfS5gKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGFyZ2V0VXVpZCA9IGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnXG4gICAgICAgICAgICA/IGJpbmRpbmcubm9kZVV1aWRcbiAgICAgICAgICAgIDogYXdhaXQgZmluZENvbXBvbmVudFV1aWQoYmluZGluZy5ub2RlVXVpZCwgYmluZGluZy5jb21wb25lbnRUeXBlIHx8IGJpbmRpbmcucHJvcGVydHlUeXBlKTtcblxuICAgICAgICBpZiAoIXRhcmdldFV1aWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gQ2Fubm90IGZpbmQgdGFyZ2V0IGZvciAke2JpbmRpbmcucHJvcGVydHlOYW1lfS5gKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGF3YWl0IHNldFJlZmVyZW5jZVByb3BlcnR5KGNvbXBvbmVudFV1aWQsIGJpbmRpbmcucHJvcGVydHlOYW1lLCBwcm9wZXJ0eUR1bXAsIHRhcmdldFV1aWQpKSB7XG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYm91bmRDb3VudDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nIHwgc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIG5vZGVVdWlkKTtcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcbiAgICBjb25zdCBjb21wb25lbnROYW1lcyA9IEFycmF5LmlzQXJyYXkoY29tcG9uZW50TmFtZSkgPyBjb21wb25lbnROYW1lIDogW2NvbXBvbmVudE5hbWVdO1xuXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xuICAgICAgICBjb25zdCBjb21wb25lbnRBbnkgPSBjb21wb25lbnQgYXMgYW55O1xuICAgICAgICBjb25zdCB1dWlkID0gU3RyaW5nKHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py52YWx1ZT8udXVpZCkgfHwgcmVhZER1bXBWYWx1ZShjb21wb25lbnRBbnk/LnV1aWQpIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udHlwZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/Ll9fdHlwZV9fLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8udHlwZSxcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgIGlmIChjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gY29tcG9uZW50TmFtZXMuc29tZSgobmFtZSkgPT4gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBuYW1lKSkpKSB7XG4gICAgICAgICAgICByZXR1cm4gdXVpZCB8fCBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wOiBhbnksIHByb3BlcnR5TmFtZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XG4gICAgY29uc3QgZHVtcCA9IGNvbXBvbmVudER1bXA/LnZhbHVlPy5bcHJvcGVydHlOYW1lXSB8fCBjb21wb25lbnREdW1wPy5bcHJvcGVydHlOYW1lXTtcbiAgICByZXR1cm4gZHVtcCAmJiB0eXBlb2YgZHVtcCA9PT0gJ29iamVjdCcgPyBkdW1wIDogbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2V0UmVmZXJlbmNlUHJvcGVydHkoY29tcG9uZW50VXVpZDogc3RyaW5nLCBwcm9wZXJ0eU5hbWU6IHN0cmluZywgcHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKTtcblxuICAgIGZvciAoY29uc3QgZHVtcCBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XG4gICAgICAgICAgICAgICAgdXVpZDogY29tcG9uZW50VXVpZCxcbiAgICAgICAgICAgICAgICBwYXRoOiBwcm9wZXJ0eU5hbWUsXG4gICAgICAgICAgICAgICAgZHVtcCxcbiAgICAgICAgICAgICAgICByZWNvcmQ6IHRydWUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYmluZCAke3Byb3BlcnR5TmFtZX0gd2l0aCBvbmUgcmVmZXJlbmNlIGR1bXAgY2FuZGlkYXRlLmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gbWFrZVJlZmVyZW5jZUR1bXBDYW5kaWRhdGVzKHByb3BlcnR5RHVtcDogYW55LCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBhbnlbXSB7XG4gICAgY29uc3QgYmFzZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocHJvcGVydHlEdW1wKSk7XG4gICAgY29uc3QgY2FuZGlkYXRlczogYW55W10gPSBbXTtcblxuICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgIC4uLmJhc2UsXG4gICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgICB1dWlkOiB0YXJnZXRVdWlkLFxuICAgICAgICB9LFxuICAgIH0pO1xuXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcbiAgICAgICAgLi4uYmFzZSxcbiAgICAgICAgdmFsdWU6IHRhcmdldFV1aWQsXG4gICAgfSk7XG5cbiAgICBjYW5kaWRhdGVzLnB1c2goe1xuICAgICAgICAuLi5iYXNlLFxuICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgX191dWlkX186IHRhcmdldFV1aWQsXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoYmFzZS52YWx1ZSAmJiB0eXBlb2YgYmFzZS52YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgY2FuZGlkYXRlcy51bnNoaWZ0KHtcbiAgICAgICAgICAgIC4uLmJhc2UsXG4gICAgICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgICAgIC4uLmJhc2UudmFsdWUsXG4gICAgICAgICAgICAgICAgdXVpZDogdGFyZ2V0VXVpZCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhvcGVuZWRBc3NldFVybDogc3RyaW5nIHwgbnVsbCwgc2NyaXB0VXJsOiBzdHJpbmcsIHNlbGVjdGVkVXVpZDogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgcm9vdE5hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGlmICghb3BlbmVkQXNzZXRVcmwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgb3BlbmVkQXNzZXRVcmwpO1xuICAgIGlmICghYXNzZXQ/LmZpbGUgfHwgIS9cXC4ocHJlZmFifHNjZW5lKSQvaS50ZXN0KGFzc2V0LmZpbGUpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkSnNvbkZpbGVXaXRoUmV0cnkoYXNzZXQuZmlsZSk7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IG5vZGVJZEJ5VXVpZCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgY29uc3Qgbm9kZUlkQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcblxuICAgIGRhdGEuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGl0ZW0/Ll9fdHlwZV9fID09PSAnY2MuTm9kZScpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVVdWlkID0gaXRlbT8uX2lkIHx8IGl0ZW0/Ll91dWlkIHx8ICcnO1xuICAgICAgICAgICAgaWYgKG5vZGVVdWlkKSB7XG4gICAgICAgICAgICAgICAgbm9kZUlkQnlVdWlkLnNldChub2RlVXVpZCwgaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fbmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBub2RlSWRCeU5hbWUuc2V0KGl0ZW0uX25hbWUsIGluZGV4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XG4gICAgICAgIGNvbnN0IG5vZGUgPSBOdW1iZXIuaXNJbnRlZ2VyKG5vZGVJZCkgPyBkYXRhW25vZGVJZF0gOiBudWxsO1xuICAgICAgICBjb25zdCBub2RlVXVpZCA9IG5vZGU/Ll9pZCB8fCBub2RlPy5fdXVpZCB8fCAnJztcbiAgICAgICAgY29uc3Qgbm9kZU5hbWUgPSBub2RlPy5fbmFtZSB8fCAnJztcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlVXVpZCkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5zZXQoYCR7bm9kZVV1aWR9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLnNldChgJHtub2RlVXVpZH06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlTmFtZSkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5zZXQoYCR7bm9kZU5hbWV9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLnNldChgJHtub2RlTmFtZX06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2VsZWN0ZWROb2RlSWQgPSBub2RlSWRCeVV1aWQuZ2V0KHNlbGVjdGVkVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChyb290TmFtZSk7XG4gICAgaWYgKHNlbGVjdGVkTm9kZUlkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcbiAgICBjb25zdCBzY3JpcHRUeXBlTmFtZXMgPSBnZXRTZXJpYWxpemVkU2NyaXB0VHlwZU5hbWVzKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpO1xuICAgIGxldCB0YXJnZXRDb21wb25lbnQgPSBkYXRhLmZpbmQoKGl0ZW0pID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGl0ZW0/Lm5vZGU/Ll9faWRfXztcbiAgICAgICAgY29uc3Qgbm9kZSA9IE51bWJlci5pc0ludGVnZXIobm9kZUlkKSA/IGRhdGFbbm9kZUlkXSA6IG51bGw7XG4gICAgICAgIGNvbnN0IGF0dGFjaGVkVG9TZWxlY3RlZE5vZGUgPSBub2RlSWQgPT09IHNlbGVjdGVkTm9kZUlkIHx8IG5vZGU/Ll9uYW1lID09PSByb290TmFtZTtcbiAgICAgICAgY29uc3QgaGFzR2VuZXJhdGVkUHJvcGVydHkgPSBiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaXRlbSwgYmluZGluZy5wcm9wZXJ0eU5hbWUpKTtcblxuICAgICAgICByZXR1cm4gc2NyaXB0VHlwZU5hbWVzLmluY2x1ZGVzKGl0ZW0uX190eXBlX18pXG4gICAgICAgICAgICB8fCBpdGVtLl9fdHlwZV9fID09PSBjbGFzc05hbWVcbiAgICAgICAgICAgIHx8IHNob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXykgPT09IGNsYXNzTmFtZVxuICAgICAgICAgICAgfHwgKGF0dGFjaGVkVG9TZWxlY3RlZE5vZGUgJiYgaGFzR2VuZXJhdGVkUHJvcGVydHkpO1xuICAgIH0pO1xuXG4gICAgaWYgKCF0YXJnZXRDb21wb25lbnQpIHtcbiAgICAgICAgdGFyZ2V0Q29tcG9uZW50ID0gYXBwZW5kU2VyaWFsaXplZFNjcmlwdENvbXBvbmVudChkYXRhLCBzZWxlY3RlZE5vZGVJZCwgc2NyaXB0VHlwZU5hbWVzWzBdIHx8IGNsYXNzTmFtZSwgYmluZGluZ3MpO1xuICAgIH1cblxuICAgIGxldCBib3VuZENvdW50ID0gMDtcblxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xuICAgICAgICBpZiAoYmluZGluZy5iaW5kVGFyZ2V0ID09PSAnbm9kZScpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVJZCA9IG5vZGVJZEJ5VXVpZC5nZXQoYmluZGluZy5ub2RlVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChiaW5kaW5nLm5vZGVOYW1lKTtcbiAgICAgICAgICAgIGlmIChub2RlSWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRhcmdldENvbXBvbmVudFtiaW5kaW5nLnByb3BlcnR5TmFtZV0gPSB7IF9faWRfXzogbm9kZUlkIH07XG4gICAgICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0eXBlTmFtZSA9IGJpbmRpbmcuY29tcG9uZW50VHlwZSB8fCBiaW5kaW5nLnByb3BlcnR5VHlwZTtcbiAgICAgICAgY29uc3QgY29tcG9uZW50SWQgPSBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3R5cGVOYW1lfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3R5cGVOYW1lfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApO1xuXG4gICAgICAgIGlmIChjb21wb25lbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IGNvbXBvbmVudElkIH07XG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3cml0ZUZpbGVTeW5jKGFzc2V0LmZpbGUsIGAke0pTT04uc3RyaW5naWZ5KGRhdGEsIG51bGwsIDIpfVxcbmAsICd1dGY4Jyk7XG4gICAgcmV0dXJuIGJvdW5kQ291bnQ7XG59XG5cbmZ1bmN0aW9uIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldChbXG4gICAgICAgIC4uLnJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kU2VyaWFsaXplZFNjcmlwdENvbXBvbmVudChkYXRhOiBhbnlbXSwgbm9kZUlkOiBudW1iZXIsIHNjcmlwdFR5cGU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBhbnkge1xuICAgIGNvbnN0IG5vZGUgPSBkYXRhW25vZGVJZF07XG4gICAgY29uc3QgY29tcG9uZW50SWQgPSBkYXRhLmxlbmd0aDtcbiAgICBjb25zdCBwcmVmYWJJbmZvSWQgPSBjb21wb25lbnRJZCArIDE7XG4gICAgY29uc3QgY29tcG9uZW50OiBhbnkgPSB7XG4gICAgICAgIF9fdHlwZV9fOiBzY3JpcHRUeXBlLFxuICAgICAgICBfbmFtZTogJycsXG4gICAgICAgIF9vYmpGbGFnczogMCxcbiAgICAgICAgX19lZGl0b3JFeHRyYXNfXzoge30sXG4gICAgICAgIG5vZGU6IHtcbiAgICAgICAgICAgIF9faWRfXzogbm9kZUlkLFxuICAgICAgICB9LFxuICAgICAgICBfZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgX19wcmVmYWI6IHtcbiAgICAgICAgICAgIF9faWRfXzogcHJlZmFiSW5mb0lkLFxuICAgICAgICB9LFxuICAgICAgICBfaWQ6ICcnLFxuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcbiAgICAgICAgY29tcG9uZW50W2JpbmRpbmcucHJvcGVydHlOYW1lXSA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgcHJlZmFiSW5mbyA9IHtcbiAgICAgICAgX190eXBlX186ICdjYy5Db21wUHJlZmFiSW5mbycsXG4gICAgICAgIGZpbGVJZDogbWFrZVByZWZhYkZpbGVJZCgpLFxuICAgIH07XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobm9kZS5fY29tcG9uZW50cykpIHtcbiAgICAgICAgbm9kZS5fY29tcG9uZW50cyA9IFtdO1xuICAgIH1cbiAgICBub2RlLl9jb21wb25lbnRzLnB1c2goeyBfX2lkX186IGNvbXBvbmVudElkIH0pO1xuICAgIGRhdGEucHVzaChjb21wb25lbnQsIHByZWZhYkluZm8pO1xuICAgIHJldHVybiBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIG1ha2VQcmVmYWJGaWxlSWQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjaGFycyA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcbiAgICBjb25zdCBieXRlcyA9IHJhbmRvbUJ5dGVzKDIyKTtcbiAgICBsZXQgcmVzdWx0ID0gJyc7XG4gICAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgICAgIHJlc3VsdCArPSBjaGFyc1tieXRlICUgY2hhcnMubGVuZ3RoXTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gc2hvcnRUeXBlTmFtZSh0eXBlOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiB0eXBlLnNwbGl0KCcuJykucG9wKCkgfHwgdHlwZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdLCBjb25maWc6IEJpbmRUb29sQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBidXR0b24gb2YgYnV0dG9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBidXR0b24ubm9kZVV1aWQpO1xuICAgICAgICAgICAgaWYgKGhhc0NvbXBvbmVudChub2RlLCAnQnV0dG9uJykpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50VHlwZSA9IGJ1dHRvbi5jb21wb25lbnRUeXBlIHx8ICdjYy5CdXR0b24nO1xuICAgICAgICAgICAgYXdhaXQgY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKGJ1dHRvbi5ub2RlVXVpZCwgW2NvbXBvbmVudFR5cGUsIHNob3J0VHlwZU5hbWUoY29tcG9uZW50VHlwZSldKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGVuc3VyZSBCdXR0b24gY29tcG9uZW50IG9uICR7YnV0dG9uLm5vZGVOYW1lfS5gLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGhhc0NvbXBvbmVudChub2RlOiBhbnksIGNvbXBvbmVudE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xuICAgIHJldHVybiBjb21wb25lbnRzLnNvbWUoKGNvbXBvbmVudDogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXG4gICAgICAgICAgICBjb21wb25lbnQ/LnR5cGUsXG4gICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXG4gICAgICAgICAgICBjb21wb25lbnQ/LmNpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Lm5hbWUsXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5fX3R5cGVfXyxcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/LmNpZCxcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBjb21wb25lbnROYW1lKSk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZTogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBsZWZ0ID0gY2FuZGlkYXRlLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmlnaHQgPSBjb21wb25lbnROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGVmdFNob3J0ID0gc2hvcnRUeXBlTmFtZShjYW5kaWRhdGUpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmlnaHRTaG9ydCA9IHNob3J0VHlwZU5hbWUoY29tcG9uZW50TmFtZSkudG9Mb3dlckNhc2UoKTtcblxuICAgIHJldHVybiBsZWZ0ID09PSByaWdodFxuICAgICAgICB8fCBsZWZ0U2hvcnQgPT09IHJpZ2h0U2hvcnRcbiAgICAgICAgfHwgbGVmdC5lbmRzV2l0aChgLiR7cmlnaHRTaG9ydH1gKVxuICAgICAgICB8fCBsZWZ0LmluY2x1ZGVzKHJpZ2h0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsYXN0RXJyb3I6IHVua25vd247XG5cbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnROYW1lcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnY3JlYXRlLWNvbXBvbmVudCcsIHtcbiAgICAgICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgICAgICBjb21wb25lbnQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxhc3RFcnJvciA9IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbGFzdEVycm9yO1xufVxuXG5mdW5jdGlvbiBkZWxheShtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG4iXX0=