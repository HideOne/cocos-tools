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
        try {
            const result = await bindSelectedNode();
            const detail = [
                `Script: ${result.scriptUrl}`,
                `Properties: ${result.bindings.length}`,
                `Button events: ${result.buttons.length}`,
                result.componentAttached ? 'Component: attach attempted successfully' : 'Component: script generated; run again after import if attach is needed',
                `Bound references: ${result.propertiesBound}`,
            ].join('\n');
            Editor.Task.addNotice({
                title: result.created ? 'Bind node complete' : 'Bind node updated',
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
                title: 'Bind node failed',
                message,
                type: 'error',
                source: PACKAGE_NAME,
                timeout: 8000,
            });
        }
    },
};
function load() { }
function unload() { }
async function bindSelectedNode() {
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
    await ensureButtonComponents(buttons, config);
    const source = renderScript(className, scan, buttons);
    const existing = await readAssetText(scriptUrl);
    const canUpdateExisting = existing ? hasAllAutoBlocks(existing) : true;
    const finalSource = existing ? updateMarkedSource(existing, source) : source;
    if (existing && !canUpdateExisting) {
        throw new Error(`Script exists but auto-generated markers are missing. Stop to avoid overwriting user code: ${scriptUrl}`);
    }
    const created = !existing;
    await writeAsset(scriptUrl, finalSource, created);
    await Editor.Message.request('asset-db', 'refresh-asset', scriptUrl);
    const componentAttached = await tryAttachComponent(selectedUuid, className, scriptUrl);
    let propertiesBound = 0;
    try {
        await Editor.Message.request('scene', 'save-scene');
        propertiesBound = await bindSerializedAssetReferences(openedAssetUrl, scriptUrl, selectedUuid, className, getNodeName(selectedTree), scan);
        if (openedAssetUrl) {
            await Editor.Message.request('asset-db', 'refresh-asset', openedAssetUrl);
        }
    }
    catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to save the current scene or prefab. Please save manually.`, error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQTRMQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBOUwzQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBQ3pELG1DQUFxQztBQUVyQyxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFFakMsTUFBTSxlQUFlLEdBQUcscUNBQXFDLENBQUM7QUFDOUQsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUM7QUFDckUsTUFBTSxzQkFBc0IsR0FBRyxvQkFBb0IsQ0FBQztBQUNwRCxNQUFNLG9CQUFvQixHQUFHLGtCQUFrQixDQUFDO0FBQ2hELE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFDN0QsTUFBTSxxQkFBcUIsR0FBRywwQkFBMEIsQ0FBQztBQUN6RCxNQUFNLHlCQUF5QixHQUFHLDhCQUE4QixDQUFDO0FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUE4QzdELE1BQU0sYUFBYSxHQUFtQjtJQUNsQyxVQUFVLEVBQUUsWUFBWTtJQUN4QixzQkFBc0IsRUFBRSxJQUFJO0lBQzVCLGFBQWEsRUFBRSxRQUFRO0lBQ3ZCLFVBQVUsRUFBRSxNQUFNO0lBQ2xCLEtBQUssRUFBRTtRQUNIO1lBQ0ksTUFBTSxFQUFFLE1BQU07WUFDZCxhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTTtZQUNsQixhQUFhLEVBQUUsRUFBRTtZQUNqQixZQUFZLEVBQUUsS0FBSztZQUNuQixrQkFBa0IsRUFBRSxLQUFLO1lBQ3pCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCO1FBQ0Q7WUFDSSxNQUFNLEVBQUUsV0FBVztZQUNuQixhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFV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QyxTQUFTLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUN6RCxNQUFNLFVBQVUsR0FBRyxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFOUQsT0FBTyxJQUFJLEtBQUssS0FBSztXQUNkLFNBQVMsS0FBSyxVQUFVO1dBQ3hCLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxVQUFVLEVBQUUsQ0FBQztXQUMvQixJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2hDLENBQUM7QUFFRCxLQUFLLFVBQVUsMkJBQTJCLENBQUMsUUFBZ0IsRUFBRSxjQUF3QjtJQUNqRixJQUFJLFNBQWtCLENBQUM7SUFFdkIsS0FBSyxNQUFNLFNBQVMsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNyQyxJQUFJLENBQUM7WUFDRCxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxrQkFBa0IsRUFBRTtnQkFDdEQsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsU0FBUzthQUNaLENBQUMsQ0FBQztZQUNILE9BQU87UUFDWCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNiLFNBQVMsR0FBRyxLQUFLLENBQUM7UUFDdEIsQ0FBQztJQUNMLENBQUM7SUFFRCxNQUFNLFNBQVMsQ0FBQztBQUNwQixDQUFDO0FBRUQsU0FBUyxLQUFLLENBQUMsRUFBVTtJQUNyQixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGV4aXN0c1N5bmMsIHJlYWRGaWxlU3luYywgcmVhZGRpclN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgZXh0bmFtZSwgam9pbiwgcmVsYXRpdmUgfSBmcm9tICdwYXRoJztcbmltcG9ydCB7IHJhbmRvbUJ5dGVzIH0gZnJvbSAnY3J5cHRvJztcblxuY29uc3QgUEFDS0FHRV9OQU1FID0gJ2JpbmQtdG9vbCc7XG5cbmNvbnN0IEFVVE9fQklORF9TVEFSVCA9ICcvKioqKioqKioqKioqKioqc3RzcnQqKioqKioqKioqKioqLyc7XG5jb25zdCBBVVRPX0JJTkRfRU5EID0gJy8qKioqKioqKioqKioqKioqKioqKioqKiplbmQqKioqKioqKioqKioqKiovJztcbmNvbnN0IExFR0FDWV9BVVRPX0JJTkRfU1RBUlQgPSAnLy8gQVVUT19CSU5EX1NUQVJUJztcbmNvbnN0IExFR0FDWV9BVVRPX0JJTkRfRU5EID0gJy8vIEFVVE9fQklORF9FTkQnO1xuY29uc3QgQVVUT19CVVRUT05fRVZFTlRfU1RBUlQgPSAnLy8gQVVUT19CVVRUT05fRVZFTlRfU1RBUlQnO1xuY29uc3QgQVVUT19CVVRUT05fRVZFTlRfRU5EID0gJy8vIEFVVE9fQlVUVE9OX0VWRU5UX0VORCc7XG5jb25zdCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUID0gJy8vIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQnO1xuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9FTkQgPSAnLy8gQVVUT19CVVRUT05fSEFORExFUl9FTkQnO1xuXG50eXBlIEJpbmRUYXJnZXQgPSAnbm9kZScgfCAnY29tcG9uZW50JztcblxuaW50ZXJmYWNlIEJpbmRUb29sQ29uZmlnIHtcbiAgICBzY3JpcHRSb290OiBzdHJpbmc7XG4gICAgYXV0b0FkZEJ1dHRvbkNvbXBvbmVudDogYm9vbGVhbjtcbiAgICBvdmVyd3JpdGVNb2RlOiAnbWFya2VyJztcbiAgICBzdG9wUHJlZml4OiBzdHJpbmc7XG4gICAgcnVsZXM6IEJpbmRSdWxlW107XG59XG5cbmludGVyZmFjZSBCaW5kUnVsZSB7XG4gICAgcHJlZml4OiBzdHJpbmc7XG4gICAgY29tcG9uZW50TmFtZT86IHN0cmluZztcbiAgICBwcm9wZXJ0eVR5cGU6IHN0cmluZztcbiAgICBkZWNvcmF0b3JUeXBlOiBzdHJpbmc7XG4gICAgYmluZFRhcmdldDogQmluZFRhcmdldDtcbiAgICBjb21wb25lbnRUeXBlOiBzdHJpbmc7XG4gICAgc3RvcENoaWxkcmVuOiBib29sZWFuO1xuICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogYm9vbGVhbjtcbiAgICBlbmFibGVkOiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgU2Nhbm5lZEJpbmRpbmcge1xuICAgIG5vZGVVdWlkOiBzdHJpbmc7XG4gICAgbm9kZU5hbWU6IHN0cmluZztcbiAgICBwcm9wZXJ0eU5hbWU6IHN0cmluZztcbiAgICBwcm9wZXJ0eVR5cGU6IHN0cmluZztcbiAgICBkZWNvcmF0b3JUeXBlOiBzdHJpbmc7XG4gICAgYmluZFRhcmdldDogQmluZFRhcmdldDtcbiAgICBjb21wb25lbnRUeXBlOiBzdHJpbmc7XG4gICAgc3RvcENoaWxkcmVuOiBib29sZWFuO1xuICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIEJpbmRSZXN1bHQge1xuICAgIGNsYXNzTmFtZTogc3RyaW5nO1xuICAgIHNjcmlwdFVybDogc3RyaW5nO1xuICAgIGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdO1xuICAgIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW107XG4gICAgY3JlYXRlZDogYm9vbGVhbjtcbiAgICBjb21wb25lbnRBdHRhY2hlZDogYm9vbGVhbjtcbiAgICBwcm9wZXJ0aWVzQm91bmQ6IG51bWJlcjtcbn1cblxuY29uc3QgZGVmYXVsdENvbmZpZzogQmluZFRvb2xDb25maWcgPSB7XG4gICAgc2NyaXB0Um9vdDogJ2Fzc2V0cy9zcmMnLFxuICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6IHRydWUsXG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcicsXG4gICAgc3RvcFByZWZpeDogJ3N0b3AnLFxuICAgIHJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGUnLFxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ05vZGUnLFxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTm9kZScsXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTm9kZScsXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnbm9kZScsXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnJyxcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGZhbHNlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgICAgcHJlZml4OiAnbm9kZV9zdG9wJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJycsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IHRydWUsXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGZhbHNlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgICAgcHJlZml4OiAnc3BpbmUnLFxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ3NwLlNrZWxldG9uJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ3NwLlNrZWxldG9uJyxcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ2J1dHRvbicsXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnQnV0dG9uJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ0J1dHRvbicsXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnQnV0dG9uJyxcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdjb21wb25lbnQnLFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJ2NjLkJ1dHRvbicsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiB0cnVlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgICAgcHJlZml4OiAnbGFiZWwnLFxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0xhYmVsJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ0xhYmVsJyxcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdMYWJlbCcsXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdjYy5MYWJlbCcsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgXSxcbn07XG5cbmV4cG9ydCBjb25zdCBtZXRob2RzOiB7IFtrZXk6IHN0cmluZ106ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55IH0gPSB7XG4gICAgYXN5bmMgb3BlblJ1bGVzUGFuZWwoKSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5QYW5lbC5vcGVuKGAke1BBQ0tBR0VfTkFNRX0ucnVsZXNgKTtcbiAgICB9LFxuXG4gICAgYXN5bmMgcXVlcnlDb25maWcoKSB7XG4gICAgICAgIHJldHVybiByZWFkQ29uZmlnKCk7XG4gICAgfSxcblxuICAgIGFzeW5jIHNhdmVDb25maWcoY29uZmlnOiBQYXJ0aWFsPEJpbmRUb29sQ29uZmlnPikge1xuICAgICAgICBjb25zdCBuZXh0Q29uZmlnOiBCaW5kVG9vbENvbmZpZyA9IHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRDb25maWcsXG4gICAgICAgICAgICAuLi5jb25maWcsXG4gICAgICAgICAgICBydWxlczogbm9ybWFsaXplUnVsZXMoY29uZmlnLnJ1bGVzKSxcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3NjcmlwdFJvb3QnLCBuZXh0Q29uZmlnLnNjcmlwdFJvb3QpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ2F1dG9BZGRCdXR0b25Db21wb25lbnQnLCBuZXh0Q29uZmlnLmF1dG9BZGRCdXR0b25Db21wb25lbnQpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ292ZXJ3cml0ZU1vZGUnLCBuZXh0Q29uZmlnLm92ZXJ3cml0ZU1vZGUpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3N0b3BQcmVmaXgnLCBuZXh0Q29uZmlnLnN0b3BQcmVmaXgpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3J1bGVzJywgbmV4dENvbmZpZy5ydWxlcyk7XG4gICAgICAgIHJldHVybiBuZXh0Q29uZmlnO1xuICAgIH0sXG5cbiAgICBhc3luYyByZXNldENvbmZpZygpIHtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHRSb290JywgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdhdXRvQWRkQnV0dG9uQ29tcG9uZW50JywgZGVmYXVsdENvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgZGVmYXVsdENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzdG9wUHJlZml4JywgZGVmYXVsdENvbmZpZy5zdG9wUHJlZml4KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdydWxlcycsIGRlZmF1bHRDb25maWcucnVsZXMpO1xuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcbiAgICB9LFxuXG4gICAgYXN5bmMgYmluZFNlbGVjdGVkTm9kZSgpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGJpbmRTZWxlY3RlZE5vZGUoKTtcbiAgICAgICAgICAgIGNvbnN0IGRldGFpbCA9IFtcbiAgICAgICAgICAgICAgICBgU2NyaXB0OiAke3Jlc3VsdC5zY3JpcHRVcmx9YCxcbiAgICAgICAgICAgICAgICBgUHJvcGVydGllczogJHtyZXN1bHQuYmluZGluZ3MubGVuZ3RofWAsXG4gICAgICAgICAgICAgICAgYEJ1dHRvbiBldmVudHM6ICR7cmVzdWx0LmJ1dHRvbnMubGVuZ3RofWAsXG4gICAgICAgICAgICAgICAgcmVzdWx0LmNvbXBvbmVudEF0dGFjaGVkID8gJ0NvbXBvbmVudDogYXR0YWNoIGF0dGVtcHRlZCBzdWNjZXNzZnVsbHknIDogJ0NvbXBvbmVudDogc2NyaXB0IGdlbmVyYXRlZDsgcnVuIGFnYWluIGFmdGVyIGltcG9ydCBpZiBhdHRhY2ggaXMgbmVlZGVkJyxcbiAgICAgICAgICAgICAgICBgQm91bmQgcmVmZXJlbmNlczogJHtyZXN1bHQucHJvcGVydGllc0JvdW5kfWAsXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuXG4gICAgICAgICAgICBFZGl0b3IuVGFzay5hZGROb3RpY2Uoe1xuICAgICAgICAgICAgICAgIHRpdGxlOiByZXN1bHQuY3JlYXRlZCA/ICdCaW5kIG5vZGUgY29tcGxldGUnIDogJ0JpbmQgbm9kZSB1cGRhdGVkJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBkZXRhaWwsXG4gICAgICAgICAgICAgICAgdHlwZTogJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAgIHNvdXJjZTogUEFDS0FHRV9OQU1FLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IDYwMDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbJHtQQUNLQUdFX05BTUV9XSAke21lc3NhZ2V9YCwgZXJyb3IpO1xuICAgICAgICAgICAgRWRpdG9yLlRhc2suYWRkTm90aWNlKHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ0JpbmQgbm9kZSBmYWlsZWQnLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgdHlwZTogJ2Vycm9yJyxcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiA4MDAwLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9LFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWQoKSB7fVxuXG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCkge31cblxuYXN5bmMgZnVuY3Rpb24gYmluZFNlbGVjdGVkTm9kZSgpOiBQcm9taXNlPEJpbmRSZXN1bHQ+IHtcbiAgICBjb25zdCBzZWxlY3RlZFV1aWQgPSBFZGl0b3IuU2VsZWN0aW9uLmdldExhc3RTZWxlY3RlZCgnbm9kZScpIHx8IEVkaXRvci5TZWxlY3Rpb24uZ2V0U2VsZWN0ZWQoJ25vZGUnKVswXTtcbiAgICBpZiAoIXNlbGVjdGVkVXVpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzZWxlY3QgYSBub2RlIGZpcnN0LicpO1xuICAgIH1cblxuICAgIGNvbnN0IHNlbGVjdGVkVHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScsIHNlbGVjdGVkVXVpZCk7XG4gICAgaWYgKCFzZWxlY3RlZFRyZWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgcmVhZCB0aGUgc2VsZWN0ZWQgbm9kZS4gTWFrZSBzdXJlIGEgc2NlbmUgb3IgcHJlZmFiIGlzIG9wZW4uJyk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRvQ2xhc3NOYW1lKG5vZGVOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKCk7XG4gICAgY29uc3Qgb3BlbmVkQXNzZXRVcmwgPSBhd2FpdCBxdWVyeU9wZW5lZEFzc2V0VXJsKHNlbGVjdGVkVHJlZSk7XG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBsb2NhdGUgdGhlIG9wZW5lZCBwcmVmYWIgb3Igc2NlbmUgYXNzZXQuIFBsZWFzZSBzYXZlIHRoZSBwcmVmYWIvc2NlbmUgYW5kIHJ1biBiaW5kIGFnYWluLicpO1xuICAgIH1cbiAgICBjb25zdCBzY3JpcHRVcmwgPSBtYWtlU2NyaXB0VXJsKG9wZW5lZEFzc2V0VXJsLCBjbGFzc05hbWUsIGNvbmZpZy5zY3JpcHRSb290KTtcbiAgICBjb25zdCBzY2FuID0gc2NhbkJpbmRpbmdzKHNlbGVjdGVkVHJlZSwgY29uZmlnKTtcbiAgICBjb25zdCBidXR0b25zID0gc2Nhbi5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0uZ2VuZXJhdGVDbGlja0V2ZW50KTtcbiAgICBhd2FpdCBlbnN1cmVCdXR0b25Db21wb25lbnRzKGJ1dHRvbnMsIGNvbmZpZyk7XG4gICAgY29uc3Qgc291cmNlID0gcmVuZGVyU2NyaXB0KGNsYXNzTmFtZSwgc2NhbiwgYnV0dG9ucyk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCByZWFkQXNzZXRUZXh0KHNjcmlwdFVybCk7XG4gICAgY29uc3QgY2FuVXBkYXRlRXhpc3RpbmcgPSBleGlzdGluZyA/IGhhc0FsbEF1dG9CbG9ja3MoZXhpc3RpbmcpIDogdHJ1ZTtcbiAgICBjb25zdCBmaW5hbFNvdXJjZSA9IGV4aXN0aW5nID8gdXBkYXRlTWFya2VkU291cmNlKGV4aXN0aW5nLCBzb3VyY2UpIDogc291cmNlO1xuXG4gICAgaWYgKGV4aXN0aW5nICYmICFjYW5VcGRhdGVFeGlzdGluZykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjcmlwdCBleGlzdHMgYnV0IGF1dG8tZ2VuZXJhdGVkIG1hcmtlcnMgYXJlIG1pc3NpbmcuIFN0b3AgdG8gYXZvaWQgb3ZlcndyaXRpbmcgdXNlciBjb2RlOiAke3NjcmlwdFVybH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBjcmVhdGVkID0gIWV4aXN0aW5nO1xuICAgIGF3YWl0IHdyaXRlQXNzZXQoc2NyaXB0VXJsLCBmaW5hbFNvdXJjZSwgY3JlYXRlZCk7XG4gICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncmVmcmVzaC1hc3NldCcsIHNjcmlwdFVybCk7XG5cbiAgICBjb25zdCBjb21wb25lbnRBdHRhY2hlZCA9IGF3YWl0IHRyeUF0dGFjaENvbXBvbmVudChzZWxlY3RlZFV1aWQsIGNsYXNzTmFtZSwgc2NyaXB0VXJsKTtcbiAgICBsZXQgcHJvcGVydGllc0JvdW5kID0gMDtcblxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NhdmUtc2NlbmUnKTtcbiAgICAgICAgcHJvcGVydGllc0JvdW5kID0gYXdhaXQgYmluZFNlcmlhbGl6ZWRBc3NldFJlZmVyZW5jZXMob3BlbmVkQXNzZXRVcmwsIHNjcmlwdFVybCwgc2VsZWN0ZWRVdWlkLCBjbGFzc05hbWUsIGdldE5vZGVOYW1lKHNlbGVjdGVkVHJlZSksIHNjYW4pO1xuICAgICAgICBpZiAob3BlbmVkQXNzZXRVcmwpIHtcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlZnJlc2gtYXNzZXQnLCBvcGVuZWRBc3NldFVybCk7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBzYXZlIHRoZSBjdXJyZW50IHNjZW5lIG9yIHByZWZhYi4gUGxlYXNlIHNhdmUgbWFudWFsbHkuYCwgZXJyb3IpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgc2NyaXB0VXJsLFxuICAgICAgICBiaW5kaW5nczogc2NhbixcbiAgICAgICAgYnV0dG9ucyxcbiAgICAgICAgY3JlYXRlZCxcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQsXG4gICAgICAgIHByb3BlcnRpZXNCb3VuZCxcbiAgICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkQ29uZmlnKCk6IFByb21pc2U8QmluZFRvb2xDb25maWc+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBwcm9qZWN0Q29uZmlnID0gYXdhaXQgRWRpdG9yLlByb2ZpbGUuZ2V0UHJvamVjdChQQUNLQUdFX05BTUUpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uZGVmYXVsdENvbmZpZyxcbiAgICAgICAgICAgIC4uLihwcm9qZWN0Q29uZmlnIHx8IHt9KSxcbiAgICAgICAgICAgIHJ1bGVzOiBub3JtYWxpemVSdWxlcyhwcm9qZWN0Q29uZmlnPy5ydWxlcyksXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZXMocnVsZXM6IHVua25vd24pOiBCaW5kUnVsZVtdIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocnVsZXMpKSB7XG4gICAgICAgIHJldHVybiBkZWZhdWx0Q29uZmlnLnJ1bGVzO1xuICAgIH1cblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBydWxlc1xuICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlICYmIHR5cGVvZiBydWxlID09PSAnb2JqZWN0JylcbiAgICAgICAgLm1hcCgocnVsZTogYW55KSA9PiBub3JtYWxpemVSdWxlKHJ1bGUpKVxuICAgICAgICAuZmlsdGVyKChydWxlKTogcnVsZSBpcyBCaW5kUnVsZSA9PiBCb29sZWFuKHJ1bGUpKTtcblxuICAgIHJldHVybiBub3JtYWxpemVkLmxlbmd0aCA+IDAgPyBub3JtYWxpemVkIDogZGVmYXVsdENvbmZpZy5ydWxlcztcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZShydWxlOiBhbnkpOiBCaW5kUnVsZSB8IG51bGwge1xuICAgIGNvbnN0IHByZWZpeCA9IFN0cmluZyhydWxlLnByZWZpeCB8fCAnJykudHJpbSgpO1xuICAgIGlmICghcHJlZml4KSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudE5hbWUgPSBTdHJpbmcocnVsZS5jb21wb25lbnROYW1lIHx8IHJ1bGUucHJvcGVydHlUeXBlIHx8ICdOb2RlJykudHJpbSgpO1xuICAgIGNvbnN0IHByb3BlcnR5VHlwZSA9IG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZSk7XG4gICAgY29uc3QgYmluZFRhcmdldDogQmluZFRhcmdldCA9IHByb3BlcnR5VHlwZSA9PT0gJ05vZGUnID8gJ25vZGUnIDogJ2NvbXBvbmVudCc7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBwcmVmaXgsXG4gICAgICAgIGNvbXBvbmVudE5hbWU6IHByb3BlcnR5VHlwZSxcbiAgICAgICAgcHJvcGVydHlUeXBlLFxuICAgICAgICBkZWNvcmF0b3JUeXBlOiBwcm9wZXJ0eVR5cGUsXG4gICAgICAgIGJpbmRUYXJnZXQsXG4gICAgICAgIGNvbXBvbmVudFR5cGU6IGJpbmRUYXJnZXQgPT09ICdjb21wb25lbnQnID8gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZSkgOiAnJyxcbiAgICAgICAgc3RvcENoaWxkcmVuOiBCb29sZWFuKHJ1bGUuc3RvcENoaWxkcmVuKSB8fCBwcmVmaXggPT09ICdub2RlX3N0b3AnLFxuICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGlzQnV0dG9uVHlwZShwcm9wZXJ0eVR5cGUpLFxuICAgICAgICBlbmFibGVkOiBydWxlLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB2YWx1ZSA9IGNvbXBvbmVudE5hbWUudHJpbSgpO1xuICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSkge1xuICAgICAgICByZXR1cm4gc2hvcnRUeXBlTmFtZSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICdOb2RlJztcbn1cblxuZnVuY3Rpb24gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBpZiAoaXNCdWlsdGluQ2NDb21wb25lbnQocHJvcGVydHlUeXBlKSkge1xuICAgICAgICByZXR1cm4gYGNjLiR7cHJvcGVydHlUeXBlfWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZTtcbn1cblxuZnVuY3Rpb24gaXNCdWlsdGluQ2NDb21wb25lbnQocHJvcGVydHlUeXBlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gW1xuICAgICAgICAnQnV0dG9uJyxcbiAgICAgICAgJ0VkaXRCb3gnLFxuICAgICAgICAnTGFiZWwnLFxuICAgICAgICAnTGF5b3V0JyxcbiAgICAgICAgJ01hc2snLFxuICAgICAgICAnUGFnZVZpZXcnLFxuICAgICAgICAnUHJvZ3Jlc3NCYXInLFxuICAgICAgICAnUmljaFRleHQnLFxuICAgICAgICAnU2Nyb2xsVmlldycsXG4gICAgICAgICdTbGlkZXInLFxuICAgICAgICAnU3ByaXRlJyxcbiAgICAgICAgJ1RvZ2dsZScsXG4gICAgICAgICdXaWRnZXQnLFxuICAgIF0uaW5jbHVkZXMocHJvcGVydHlUeXBlKTtcbn1cblxuZnVuY3Rpb24gaXNCdXR0b25UeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZSA9PT0gJ0J1dHRvbicgfHwgcHJvcGVydHlUeXBlID09PSAnY2MuQnV0dG9uJztcbn1cblxuYXN5bmMgZnVuY3Rpb24gcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNhdmVkSWQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzYXZlLXNjZW5lJyk7XG4gICAgICAgIGlmICghc2F2ZWRJZCkge1xuICAgICAgICAgICAgcmV0dXJuIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIHNhdmVkSWQpO1xuICAgICAgICByZXR1cm4gYXNzZXQ/LnVybCB8fCBhc3NldD8uc291cmNlIHx8IGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWVXaXRoUmV0cnkoc2VsZWN0ZWRUcmVlOiBhbnkpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgNTsgaW5kZXggKz0gMSkge1xuICAgICAgICBjb25zdCB1cmwgPSBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XG4gICAgICAgIGlmICh1cmwpIHtcbiAgICAgICAgICAgIHJldHVybiB1cmw7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgZGVsYXkoMTIwKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gZmluZEFzc2V0VXJsQnlOb2RlVHJlZShzZWxlY3RlZFRyZWU6IGFueSk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGFzc2V0c0RpciA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycpO1xuICAgIGlmICghZXhpc3RzU3luYyhhc3NldHNEaXIpKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IHJvb3ROYW1lID0gZ2V0Tm9kZU5hbWUoc2VsZWN0ZWRUcmVlKTtcbiAgICBjb25zdCBjaGlsZE5hbWVzID0gbmV3IFNldChnZXRDaGlsZHJlbihzZWxlY3RlZFRyZWUpLm1hcChnZXROb2RlTmFtZSkpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBsaXN0QXNzZXRGaWxlcyhhc3NldHNEaXIsIFsnLnByZWZhYicsICcuc2NlbmUnXSk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlYWRKc29uRmlsZVN5bmMoZmlsZSk7XG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgbm9kZXMgPSBkYXRhLmZpbHRlcigoaXRlbSkgPT4gaXRlbT8uX190eXBlX18gPT09ICdjYy5Ob2RlJyk7XG4gICAgICAgICAgICBjb25zdCBoYXNSb290ID0gbm9kZXMuc29tZSgobm9kZSkgPT4gbm9kZT8uX25hbWUgPT09IHJvb3ROYW1lKTtcbiAgICAgICAgICAgIGlmICghaGFzUm9vdCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBub2RlTmFtZXMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobm9kZSkgPT4gbm9kZT8uX25hbWUpLmZpbHRlcihCb29sZWFuKSk7XG4gICAgICAgICAgICBjb25zdCBjaGlsZE1hdGNoQ291bnQgPSBbLi4uY2hpbGROYW1lc10uZmlsdGVyKChuYW1lKSA9PiBub2RlTmFtZXMuaGFzKG5hbWUpKS5sZW5ndGg7XG4gICAgICAgICAgICBpZiAoY2hpbGROYW1lcy5zaXplID09PSAwIHx8IGNoaWxkTWF0Y2hDb3VudCA+IDAgfHwgYmFzZW5hbWUoZmlsZSwgZXh0bmFtZShmaWxlKSkgPT09IHJvb3ROYW1lKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRSZWxhdGl2ZSA9IHJlbGF0aXZlKEVkaXRvci5Qcm9qZWN0LnBhdGgsIGZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYGRiOi8vJHthc3NldFJlbGF0aXZlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAoIWlzSW5jb21wbGV0ZUpzb25FcnJvcihlcnJvcikpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBpbnNwZWN0IGFzc2V0ICR7ZmlsZX0uYCwgZXJyb3IpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHJlYWRKc29uRmlsZVN5bmMoZmlsZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XG4gICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRKc29uRmlsZVdpdGhSZXRyeShmaWxlOiBzdHJpbmcsIGF0dGVtcHRzID0gNSk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBhdHRlbXB0czsgaW5kZXggKz0gMSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGZpbGUsICd1dGY4JykpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpIHx8IGluZGV4ID09PSBhdHRlbXB0cyAtIDEpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IGRlbGF5KDEyMCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNJbmNvbXBsZXRlSnNvbkVycm9yKGVycm9yOiB1bmtub3duKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGVycm9yIGluc3RhbmNlb2YgU3ludGF4RXJyb3IgJiYgL1VuZXhwZWN0ZWQgZW5kIG9mIEpTT04gaW5wdXQvLnRlc3QoZXJyb3IubWVzc2FnZSk7XG59XG5cbmZ1bmN0aW9uIGxpc3RBc3NldEZpbGVzKGRpcjogc3RyaW5nLCBleHRlbnNpb25zOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlYWRkaXJTeW5jKGRpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xuICAgICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4ubGlzdEFzc2V0RmlsZXMoZnVsbFBhdGgsIGV4dGVuc2lvbnMpKTtcbiAgICAgICAgfSBlbHNlIGlmIChleHRlbnNpb25zLmluY2x1ZGVzKGV4dG5hbWUoZW50cnkubmFtZSkudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIG1ha2VTY3JpcHRVcmwob3BlbmVkQXNzZXRVcmw6IHN0cmluZyB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRSb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRSb290ID0gbm9ybWFsaXplQXNzZXRQYXRoKHNjcmlwdFJvb3QgfHwgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBjb25zdCByb290U2NyaXB0VXJsID0gYGRiOi8vJHtub3JtYWxpemVkUm9vdH0vJHtjbGFzc05hbWV9LnRzYDtcbiAgICBpZiAoYXNzZXRVcmxFeGlzdHMocm9vdFNjcmlwdFVybCkpIHtcbiAgICAgICAgcmV0dXJuIHJvb3RTY3JpcHRVcmw7XG4gICAgfVxuXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xuICAgICAgICByZXR1cm4gcm9vdFNjcmlwdFVybDtcbiAgICB9XG5cbiAgICBjb25zdCBhc3NldFBhdGggPSBvcGVuZWRBc3NldFVybFxuICAgICAgICAucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKVxuICAgICAgICAucmVwbGFjZSgvXFwuKHByZWZhYnxzY2VuZSkkL2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gYXNzZXRQYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cy8nKVxuICAgICAgICA/IGFzc2V0UGF0aC5zbGljZSgnYXNzZXRzLycubGVuZ3RoKVxuICAgICAgICA6IGFzc2V0UGF0aC5yZXBsYWNlKC9eLio/YXNzZXRzXFwvLywgJycpO1xuICAgIGNvbnN0IGRpciA9IHJlbGF0aXZlUGF0aC5pbmNsdWRlcygnLycpID8gcmVsYXRpdmVQYXRoLnNsaWNlKDAsIHJlbGF0aXZlUGF0aC5sYXN0SW5kZXhPZignLycpKSA6ICcnO1xuXG4gICAgcmV0dXJuIGBkYjovLyR7bm9ybWFsaXplZFJvb3R9JHtkaXIgPyBgLyR7ZGlyfWAgOiAnJ30vJHtjbGFzc05hbWV9LnRzYDtcbn1cblxuZnVuY3Rpb24gYXNzZXRVcmxFeGlzdHModXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB1cmwucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKS5yZXBsYWNlKC9cXC8vZywgJ1xcXFwnKTtcbiAgICByZXR1cm4gZXhpc3RzU3luYyhqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsIHJlbGF0aXZlUGF0aCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVBc3NldFBhdGgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnJlcGxhY2UoL1xcXFwvZywgJy8nKS5yZXBsYWNlKC9eZGI6XFwvXFwvLywgJycpLnJlcGxhY2UoL15cXC8rLywgJycpO1xuICAgIHJldHVybiBwYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cycpID8gcGF0aCA6IGBhc3NldHMvJHtwYXRofWA7XG59XG5cbmZ1bmN0aW9uIHNjYW5CaW5kaW5ncyhyb290OiBhbnksIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBTY2FubmVkQmluZGluZ1tdIHtcbiAgICBjb25zdCB1c2VkTmFtZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdID0gW107XG4gICAgY29uc3QgcnVsZXMgPSBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKTtcblxuICAgIGNvbnN0IHZpc2l0ID0gKG5vZGU6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xuICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBub2RlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmIChsb3dlck5hbWUuc3RhcnRzV2l0aChjb25maWcuc3RvcFByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobm9kZSwgcnVsZXMsIHVzZWROYW1lcyk7XG4gICAgICAgIGlmIChiaW5kaW5nKSB7XG4gICAgICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJpbmRpbmc/LnN0b3BDaGlsZHJlbikge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBnZXRDaGlsZHJlbihub2RlKSkge1xuICAgICAgICAgICAgdmlzaXQoY2hpbGQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZpc2l0KHJvb3QpO1xuICAgIHJldHVybiBiaW5kaW5ncztcbn1cblxuZnVuY3Rpb24gZ2V0U29ydGVkRW5hYmxlZFJ1bGVzKGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBCaW5kUnVsZVtdIHtcbiAgICByZXR1cm4gY29uZmlnLnJ1bGVzXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZCAmJiBydWxlLnByZWZpeClcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5wcmVmaXgubGVuZ3RoIC0gbGVmdC5wcmVmaXgubGVuZ3RoKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhub2RlOiBhbnksIHJ1bGVzOiBCaW5kUnVsZVtdLCB1c2VkTmFtZXM6IE1hcDxzdHJpbmcsIG51bWJlcj4pOiBTY2FubmVkQmluZGluZyB8IG51bGwge1xuICAgIGNvbnN0IG5vZGVOYW1lID0gZ2V0Tm9kZU5hbWUobm9kZSk7XG4gICAgY29uc3QgbG93ZXJOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBydWxlID0gcnVsZXMuZmluZCgoaXRlbSkgPT4gbG93ZXJOYW1lLnN0YXJ0c1dpdGgoaXRlbS5wcmVmaXgudG9Mb3dlckNhc2UoKSkpO1xuXG4gICAgaWYgKCFydWxlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG5vZGVVdWlkOiBnZXRVdWlkKG5vZGUpLFxuICAgICAgICBub2RlTmFtZSxcbiAgICAgICAgcHJvcGVydHlOYW1lOiBtYWtlVW5pcXVlTmFtZSh0b1Byb3BlcnR5TmFtZShub2RlTmFtZSksIHVzZWROYW1lcyksXG4gICAgICAgIHByb3BlcnR5VHlwZTogcnVsZS5wcm9wZXJ0eVR5cGUsXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHJ1bGUuZGVjb3JhdG9yVHlwZSxcbiAgICAgICAgYmluZFRhcmdldDogcnVsZS5iaW5kVGFyZ2V0LFxuICAgICAgICBjb21wb25lbnRUeXBlOiBydWxlLmNvbXBvbmVudFR5cGUsXG4gICAgICAgIHN0b3BDaGlsZHJlbjogcnVsZS5zdG9wQ2hpbGRyZW4sXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogcnVsZS5nZW5lcmF0ZUNsaWNrRXZlbnQsXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0Tm9kZU5hbWUobm9kZTogYW55KTogc3RyaW5nIHtcbiAgICByZXR1cm4gU3RyaW5nKHJlYWREdW1wVmFsdWUobm9kZT8ubmFtZSkgfHwgJ05vZGUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0VXVpZChub2RlOiBhbnkpOiBzdHJpbmcge1xuICAgIHJldHVybiBTdHJpbmcocmVhZER1bXBWYWx1ZShub2RlPy51dWlkKSB8fCBub2RlPy51dWlkIHx8ICcnKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2hpbGRyZW4obm9kZTogYW55KTogYW55W10ge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KG5vZGU/LmNoaWxkcmVuKSA/IG5vZGUuY2hpbGRyZW4gOiBbXTtcbn1cblxuZnVuY3Rpb24gcmVhZER1bXBWYWx1ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAndmFsdWUnIGluIHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS52YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b0NsYXNzTmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBuYW1lID0gdG9Qcm9wZXJ0eU5hbWUodmFsdWUpO1xuICAgIHJldHVybiB1cHBlckZpcnN0KG5hbWUucmVwbGFjZSgvXl8rLywgJycpIHx8ICdBdXRvQmluZENvbXBvbmVudCcpO1xufVxuXG5mdW5jdGlvbiB0b1Byb3BlcnR5TmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAucmVwbGFjZSgvW15cXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfSRfXFx1MjAwQ1xcdTIwMERdKy9ndSwgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXysvZywgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXl8rfF8rJC9nLCAnJyk7XG5cbiAgICBjb25zdCBjbGVhbmVkID0gbm9ybWFsaXplZFxuICAgICAgICAuc3BsaXQoJycpXG4gICAgICAgIC5maWx0ZXIoKGNoYXIsIGluZGV4KSA9PiBpbmRleCA9PT0gMCA/IGlzSWRlbnRpZmllclN0YXJ0KGNoYXIpIDogaXNJZGVudGlmaWVyQ29udGludWUoY2hhcikpXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgIGlmICghY2xlYW5lZCkge1xuICAgICAgICByZXR1cm4gJ25vZGUnO1xuICAgIH1cblxuICAgIHJldHVybiBpc0lkZW50aWZpZXJTdGFydChjbGVhbmVkWzBdKSA/IGNsZWFuZWQgOiBgXyR7Y2xlYW5lZH1gO1xufVxuXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJTdGFydChjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gL1skX1xccHtJRF9TdGFydH1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gaXNJZGVudGlmaWVyQ29udGludWUoY2hhcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9bJF9cXHUyMDBDXFx1MjAwRFxccHtJRF9Db250aW51ZX1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gbWFrZVVuaXF1ZU5hbWUoYmFzZU5hbWU6IHN0cmluZywgdXNlZE5hbWVzOiBNYXA8c3RyaW5nLCBudW1iZXI+KTogc3RyaW5nIHtcbiAgICBjb25zdCBjb3VudCA9IHVzZWROYW1lcy5nZXQoYmFzZU5hbWUpIHx8IDA7XG4gICAgdXNlZE5hbWVzLnNldChiYXNlTmFtZSwgY291bnQgKyAxKTtcbiAgICByZXR1cm4gY291bnQgPT09IDAgPyBiYXNlTmFtZSA6IGAke2Jhc2VOYW1lfSR7Y291bnQgKyAxfWA7XG59XG5cbmZ1bmN0aW9uIHVwcGVyRmlyc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHZhbHVlID8gdmFsdWVbMF0udG9VcHBlckNhc2UoKSArIHZhbHVlLnNsaWNlKDEpIDogdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNjcmlwdChjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBgaW1wb3J0IHsgJHtyZW5kZXJDY0ltcG9ydHMoYmluZGluZ3MpfSB9IGZyb20gJ2NjJztcblxuY29uc3QgeyBjY2NsYXNzLCBwcm9wZXJ0eSB9ID0gX2RlY29yYXRvcjtcblxuQGNjY2xhc3MoJyR7Y2xhc3NOYW1lfScpXG5leHBvcnQgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgQ29tcG9uZW50IHtcblxuICAgICR7QVVUT19CSU5EX1NUQVJUfVxuJHtyZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzKX1cbiAgICAke0FVVE9fQklORF9FTkR9XG5cbiAgICBwcm90ZWN0ZWQgb25Mb2FkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLmJpbmRCdXR0b25FdmVudHMoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGJpbmRCdXR0b25FdmVudHMoKTogdm9pZCB7XG4gICAgICAgICR7QVVUT19CVVRUT05fRVZFTlRfU1RBUlR9XG4ke3JlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zKX1cbiAgICAgICAgJHtBVVRPX0JVVFRPTl9FVkVOVF9FTkR9XG4gICAgfVxuXG4gICAgJHtBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUfVxuJHtyZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zKX1cbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfRU5EfVxufVxuYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2NJbXBvcnRzKGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCBpbXBvcnRzID0gbmV3IFNldChbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50J10pO1xuXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLmRlY29yYXRvclR5cGUpO1xuICAgIH1cblxuICAgIGlmIChiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBiaW5kaW5nLmdlbmVyYXRlQ2xpY2tFdmVudCkpIHtcbiAgICAgICAgaW1wb3J0cy5hZGQoJ0J1dHRvbicpO1xuICAgIH1cblxuICAgIHJldHVybiBzb3J0Q2NJbXBvcnRzKGltcG9ydHMpLmpvaW4oJywgJyk7XG59XG5cbmZ1bmN0aW9uIHNvcnRDY0ltcG9ydHMoaW1wb3J0czogSXRlcmFibGU8c3RyaW5nPik6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQoaW1wb3J0cyldXG4gICAgICAgIC5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0gJiYgaXRlbSAhPT0gJ2NjJylcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IFsnX2RlY29yYXRvcicsICdDb21wb25lbnQnLCAnTm9kZScsICdCdXR0b24nLCAnTGFiZWwnLCAnU3ByaXRlJywgJ1dpZGdldCcsICdzcCddO1xuICAgICAgICAgICAgY29uc3QgbGVmdEluZGV4ID0gb3JkZXIuaW5kZXhPZihsZWZ0KTtcbiAgICAgICAgICAgIGNvbnN0IHJpZ2h0SW5kZXggPSBvcmRlci5pbmRleE9mKHJpZ2h0KTtcbiAgICAgICAgICAgIGlmIChsZWZ0SW5kZXggIT09IC0xIHx8IHJpZ2h0SW5kZXggIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChsZWZ0SW5kZXggPT09IC0xID8gOTkgOiBsZWZ0SW5kZXgpIC0gKHJpZ2h0SW5kZXggPT09IC0xID8gOTkgOiByaWdodEluZGV4KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGxlZnQubG9jYWxlQ29tcGFyZShyaWdodCk7XG4gICAgICAgIH0pO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0SW1wb3J0RnJvbVR5cGUoaW1wb3J0czogU2V0PHN0cmluZz4sIHR5cGVOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcbiAgICBjb25zdCBpbXBvcnROYW1lID0gdmFsdWUuc3RhcnRzV2l0aCgnY2MuJykgPyBzaG9ydFR5cGVOYW1lKHZhbHVlKSA6IHZhbHVlLnNwbGl0KCcuJylbMF07XG4gICAgaWYgKC9eW0EtWmEtel8kXVtBLVphLXowLTlfJF0qJC8udGVzdChpbXBvcnROYW1lKSkge1xuICAgICAgICBpbXBvcnRzLmFkZChpbXBvcnROYW1lKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlclByb3BlcnRpZXMoYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBiaW5kaW5ncy5tYXAoKGJpbmRpbmcpID0+IGAgICAgQHByb3BlcnR5KCR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLmRlY29yYXRvclR5cGUpfSlcbiAgICBwdWJsaWMgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX06ICR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLnByb3BlcnR5VHlwZSl9IHwgbnVsbCA9IG51bGw7YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHRvU2NyaXB0VHlwZU5hbWUodHlwZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdmFsdWUgPSB0eXBlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHZhbHVlLnN0YXJ0c1dpdGgoJ2NjLicpID8gc2hvcnRUeXBlTmFtZSh2YWx1ZSkgOiB2YWx1ZTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyQnV0dG9uRXZlbnRzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgICAgICBpZiAodGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9KSB7XG4gICAgICAgICAgICB0aGlzLiR7YnV0dG9uLnByb3BlcnR5TmFtZX0ubm9kZS5vbihCdXR0b24uRXZlbnRUeXBlLkNMSUNLLCB0aGlzLiR7Z2V0Q2xpY2tIYW5kbGVyTmFtZShidXR0b24ucHJvcGVydHlOYW1lKX0sIHRoaXMpO1xuICAgICAgICB9YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkhhbmRsZXJzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgIHByaXZhdGUgJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSgpOiB2b2lkIHtcblxuICAgIH1gKS5qb2luKCdcXG5cXG4nKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2xpY2tIYW5kbGVyTmFtZShwcm9wZXJ0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBvbkNsaWNrJHt1cHBlckZpcnN0KHByb3BlcnR5TmFtZS5yZXBsYWNlKC9eYnV0dG9uXz8vLCAnQnV0dG9uXycpKX1gO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGJpbmRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORCk7XG4gICAgY29uc3QgZXZlbnRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpO1xuICAgIGNvbnN0IGhhbmRsZXJCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKTtcblxuICAgIGlmICghaGFzQWxsQXV0b0Jsb2NrcyhleGlzdGluZykpIHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGNvbnN0IGJpbmRNYXJrZXJzID0gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORClcbiAgICAgICAgfHwgZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoZXhpc3RpbmcsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKVxuICAgICAgICB8fCAoW0FVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORF0gYXMgY29uc3QpO1xuXG4gICAgbGV0IHVwZGF0ZWQgPSByZXBsYWNlQmxvY2soZXhpc3RpbmcsIGJpbmRNYXJrZXJzWzBdLCBiaW5kTWFya2Vyc1sxXSwgYmluZEJsb2NrKTtcbiAgICB1cGRhdGVkID0gdXBkYXRlZC5yZXBsYWNlKGJpbmRNYXJrZXJzWzBdLCBBVVRPX0JJTkRfU1RBUlQpLnJlcGxhY2UoYmluZE1hcmtlcnNbMV0sIEFVVE9fQklORF9FTkQpO1xuXG4gICAgY29uc3QgdXBkYXRlZEJsb2NrcyA9IHJlcGxhY2VCbG9jayhcbiAgICAgICAgcmVwbGFjZUJsb2NrKFxuICAgICAgICAgICAgdXBkYXRlZCxcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULFxuICAgICAgICAgICAgQVVUT19CVVRUT05fRVZFTlRfRU5ELFxuICAgICAgICAgICAgZXZlbnRCbG9jayxcbiAgICAgICAgKSxcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCxcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9FTkQsXG4gICAgICAgIGhhbmRsZXJCbG9jayxcbiAgICApO1xuXG4gICAgcmV0dXJuIG1lcmdlQ2NJbXBvcnRzKHVwZGF0ZWRCbG9ja3MsIGdlbmVyYXRlZCk7XG59XG5cbmZ1bmN0aW9uIGhhc0FsbEF1dG9CbG9ja3Moc291cmNlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKSB8fCBoYXNCbG9jayhzb3VyY2UsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKSlcbiAgICAgICAgJiYgaGFzQmxvY2soc291cmNlLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKVxuICAgICAgICAmJiBoYXNCbG9jayhzb3VyY2UsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKTtcbn1cblxuZnVuY3Rpb24gZ2V0RXhpc3RpbmdCbG9ja01hcmtlcnMoc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogcmVhZG9ubHkgW3N0cmluZywgc3RyaW5nXSB8IG51bGwge1xuICAgIHJldHVybiBoYXNCbG9jayhzb3VyY2UsIHN0YXJ0LCBlbmQpID8gW3N0YXJ0LCBlbmRdIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gaGFzQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHNvdXJjZS5pbmNsdWRlcyhzdGFydCkgJiYgc291cmNlLmluY2x1ZGVzKGVuZCkgJiYgc291cmNlLmluZGV4T2Yoc3RhcnQpIDwgc291cmNlLmluZGV4T2YoZW5kKTtcbn1cblxuZnVuY3Rpb24gcGlja0Jsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcbiAgICBjb25zdCBlbmRJbmRleCA9IHNvdXJjZS5pbmRleE9mKGVuZCk7XG4gICAgcmV0dXJuIHNvdXJjZS5zbGljZShzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoLCBlbmRJbmRleCk7XG59XG5cbmZ1bmN0aW9uIHJlcGxhY2VCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IHNvdXJjZS5pbmRleE9mKHN0YXJ0KTtcbiAgICBjb25zdCBlbmRJbmRleCA9IHNvdXJjZS5pbmRleE9mKGVuZCk7XG4gICAgcmV0dXJuIGAke3NvdXJjZS5zbGljZSgwLCBzdGFydEluZGV4ICsgc3RhcnQubGVuZ3RoKX0ke2NvbnRlbnR9JHtzb3VyY2Uuc2xpY2UoZW5kSW5kZXgpfWA7XG59XG5cbmZ1bmN0aW9uIG1lcmdlQ2NJbXBvcnRzKGV4aXN0aW5nOiBzdHJpbmcsIGdlbmVyYXRlZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBpbXBvcnRQYXR0ZXJuID0gL15pbXBvcnRcXHMrXFx7XFxzKihbXn1dKz8pXFxzKlxcfVxccytmcm9tXFxzK1snXCJdY2NbJ1wiXTtcXHMqJC9tO1xuICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBleGlzdGluZy5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcbiAgICBjb25zdCBnZW5lcmF0ZWRNYXRjaCA9IGdlbmVyYXRlZC5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcblxuICAgIGlmICghZ2VuZXJhdGVkTWF0Y2gpIHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGlmICghZXhpc3RpbmdNYXRjaCkge1xuICAgICAgICByZXR1cm4gYCR7Z2VuZXJhdGVkTWF0Y2hbMF19XFxuJHtleGlzdGluZ31gO1xuICAgIH1cblxuICAgIGNvbnN0IG1lcmdlZCA9IHNvcnRDY0ltcG9ydHMoW1xuICAgICAgICAuLi5wYXJzZUNjSW1wb3J0TmFtZXMoZXhpc3RpbmdNYXRjaFsxXSksXG4gICAgICAgIC4uLnBhcnNlQ2NJbXBvcnROYW1lcyhnZW5lcmF0ZWRNYXRjaFsxXSksXG4gICAgXSk7XG5cbiAgICByZXR1cm4gZXhpc3RpbmcucmVwbGFjZShpbXBvcnRQYXR0ZXJuLCBgaW1wb3J0IHsgJHttZXJnZWQuam9pbignLCAnKX0gfSBmcm9tICdjYyc7YCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2NJbXBvcnROYW1lcyhpbXBvcnRzOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGltcG9ydHNcbiAgICAgICAgLnNwbGl0KCcsJylcbiAgICAgICAgLm1hcCgoaXRlbSkgPT4gaXRlbS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRBc3NldFRleHQodXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBhc3NldCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCB1cmwpO1xuICAgIGlmICghYXNzZXQ/LmZpbGUpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYyhhc3NldC5maWxlLCAndXRmOCcpO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZUFzc2V0KHVybDogc3RyaW5nLCBzb3VyY2U6IHN0cmluZywgY3JlYXRlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChjcmVhdGVkKSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ2NyZWF0ZS1hc3NldCcsIHVybCwgc291cmNlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3NhdmUtYXNzZXQnLCB1cmwsIHNvdXJjZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeUF0dGFjaENvbXBvbmVudChub2RlVXVpZDogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0VXJsOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIGNsYXNzTmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc3QgcmVnaXN0ZXJlZENhbmRpZGF0ZXMgPSBhd2FpdCB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWUsIHNjcmlwdFVybCk7XG4gICAgaWYgKHJlZ2lzdGVyZWRDYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIFNjcmlwdCBjb21wb25lbnQgJHtjbGFzc05hbWV9IHdhcyBub3QgcmVnaXN0ZXJlZCB5ZXQuIFRyeWluZyB0byBhdHRhY2ggYW55d2F5LmApO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudENhbmRpZGF0ZXMgPSBbLi4ubmV3IFNldChbXG4gICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgbm9ybWFsaXplQ2xhc3NOYW1lKGNsYXNzTmFtZSksXG4gICAgICAgIC4uLnJlZ2lzdGVyZWRDYW5kaWRhdGVzLFxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKV07XG5cbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudE5hbWUgb2YgY29tcG9uZW50Q2FuZGlkYXRlcykge1xuICAgICAgICBpZiAoYXdhaXQgY3JlYXRlQ29tcG9uZW50QW5kVmVyaWZ5KG5vZGVVdWlkLCBjb21wb25lbnROYW1lLCBjb21wb25lbnRDYW5kaWRhdGVzKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyAxMjAwMDtcbiAgICBjb25zdCBzY3JpcHRBc3NldCA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvU2FmZShzY3JpcHRVcmwpO1xuICAgIGNvbnN0IGNhY2hlZENpZCA9IHJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpO1xuICAgIGxldCBsb2dnZWQgPSBmYWxzZTtcblxuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHF1ZXJ5UmVnaXN0ZXJlZFNjcmlwdENvbXBvbmVudENhbmRpZGF0ZXMoY2xhc3NOYW1lLCBzY3JpcHRBc3NldCk7XG4gICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiBbLi4ubmV3IFNldChbLi4uY2FuZGlkYXRlcywgLi4uY2FjaGVkQ2lkXSldO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFsb2dnZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBXYWl0aW5nIGZvciBzY3JpcHQgaW1wb3J0OiAke2NsYXNzTmFtZX1gKTtcbiAgICAgICAgICAgIGxvZ2dlZCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBkZWxheSg1MDApO1xuICAgIH1cblxuICAgIHJldHVybiBjYWNoZWRDaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5QXNzZXRJbmZvU2FmZSh1cmw6IHN0cmluZyk6IFByb21pc2U8YW55IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBxdWVyeVJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRBc3NldDogYW55IHwgbnVsbCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBjb21wb25lbnRzID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktY29tcG9uZW50cycpO1xuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29tcG9uZW50cykpIHtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNjcmlwdFV1aWQgPSBzY3JpcHRBc3NldD8udXVpZCA/IFN0cmluZyhzY3JpcHRBc3NldC51dWlkKSA6ICcnO1xuICAgICAgICBjb25zdCBzY3JpcHRVcmwgPSBzY3JpcHRBc3NldD8udXJsID8gU3RyaW5nKHNjcmlwdEFzc2V0LnVybCkgOiAnJztcbiAgICAgICAgY29uc3Qgc2NyaXB0RmlsZSA9IHNjcmlwdEFzc2V0Py5maWxlID8gU3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA6ICcnO1xuICAgICAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xuICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5wYXRoLFxuICAgICAgICAgICAgICAgIGNvbXBvbmVudD8uYXNzZXRVdWlkLFxuICAgICAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgICAgICBjb25zdCBtYXRjaGVkID0gY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgY2xhc3NOYW1lKSlcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFV1aWQgJiYgY2FuZGlkYXRlcy5pbmNsdWRlcyhzY3JpcHRVdWlkKSlcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFVybCAmJiBjYW5kaWRhdGVzLmluY2x1ZGVzKHNjcmlwdFVybCkpXG4gICAgICAgICAgICAgICAgfHwgQm9vbGVhbihzY3JpcHRGaWxlICYmIGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUucmVwbGFjZSgvXFxcXC9nLCAnLycpID09PSBzY3JpcHRGaWxlKSk7XG5cbiAgICAgICAgICAgIGlmIChtYXRjaGVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4uY2FuZGlkYXRlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0LmZpbHRlcigoY2FuZGlkYXRlKSA9PiBpc0NvbXBvbmVudEF0dGFjaENhbmRpZGF0ZShjYW5kaWRhdGUpKSldO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHF1ZXJ5IHJlZ2lzdGVyZWQgY29tcG9uZW50cy5gLCBlcnJvcik7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGlzQ29tcG9uZW50QXR0YWNoQ2FuZGlkYXRlKGNhbmRpZGF0ZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9eW0EtWmEtejAtOV8kLi86QC1dKyQvLnRlc3QoY2FuZGlkYXRlKTtcbn1cblxuZnVuY3Rpb24gcmVhZFNjcmlwdENpZEZyb21Qcm9ncmFtQ2FjaGUoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGlmICghc2NyaXB0QXNzZXQ/LmZpbGUpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZVVybCA9IGBmaWxlOi8vLyR7U3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKX1gO1xuICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB0YXJnZXRzID0gW1xuICAgICAgICBqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsICd0ZW1wJywgJ3Byb2dyYW1taW5nJywgJ3BhY2tlci1kcml2ZXInLCAndGFyZ2V0cycsICdlZGl0b3InKSxcbiAgICAgICAgam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAndGVtcCcsICdwcm9ncmFtbWluZycsICdwYWNrZXItZHJpdmVyJywgJ3RhcmdldHMnLCAncHJldmlldycpLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHRhcmdldERpciBvZiB0YXJnZXRzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXBQYXRoID0gam9pbih0YXJnZXREaXIsICdpbXBvcnQtbWFwLmpzb24nKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhpbXBvcnRNYXBQYXRoKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXAgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhpbXBvcnRNYXBQYXRoLCAndXRmOCcpKTtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rUmVsYXRpdmUgPSBpbXBvcnRNYXA/LmltcG9ydHM/Lltzb3VyY2VVcmxdIHx8IGltcG9ydE1hcD8uW3NvdXJjZVVybF07XG4gICAgICAgICAgICBpZiAoIWNodW5rUmVsYXRpdmUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY2h1bmtGaWxlID0gam9pbih0YXJnZXREaXIsIFN0cmluZyhjaHVua1JlbGF0aXZlKS5yZXBsYWNlKC9eXFwuXFwvLywgJycpKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhjaHVua0ZpbGUpKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGNodW5rU291cmNlID0gcmVhZEZpbGVTeW5jKGNodW5rRmlsZSwgJ3V0ZjgnKTtcbiAgICAgICAgICAgIGNvbnN0IGVzY2FwZWRDbGFzc05hbWUgPSBjbGFzc05hbWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gY2h1bmtTb3VyY2UubWF0Y2gobmV3IFJlZ0V4cChgX1JGXFxcXC5wdXNoXFxcXChcXFxce1xcXFx9LFxcXFxzKltcIiddKFteXCInXSspW1wiJ10sXFxcXHMqW1wiJ10ke2VzY2FwZWRDbGFzc05hbWV9W1wiJ11gKSk7XG4gICAgICAgICAgICBpZiAobWF0Y2g/LlsxXSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG1hdGNoWzFdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlYWQgc2NyaXB0IGNpZCBmcm9tIHByb2dyYW0gY2FjaGUuYCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KHJlc3VsdCldO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnRBbmRWZXJpZnkobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nLCBtYXRjaE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XG4gICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudDogY29tcG9uZW50TmFtZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IGRlbGF5KDEwMCk7XG4gICAgICAgIGlmIChhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgbWF0Y2hOYW1lcykpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gY3JlYXRlLWNvbXBvbmVudCByZXR1cm5lZCBidXQgJHtjb21wb25lbnROYW1lfSB3YXMgbm90IGZvdW5kIG9uIHRoZSBub2RlLmApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYXR0YWNoIGNvbXBvbmVudCAke2NvbXBvbmVudE5hbWV9LmAsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQ2xhc3NOYW1lKGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gY2xhc3NOYW1lLnJlcGxhY2UoL1teQS1aYS16MC05XyRcXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfVxcdTIwMENcXHUyMDBEXS9ndSwgJ18nKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYmluZENvbXBvbmVudFByb3BlcnRpZXMobm9kZVV1aWQ6IHN0cmluZywgY2xhc3NOYW1lOiBzdHJpbmcsIHNjcmlwdFVybDogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcbiAgICBjb25zdCBjb21wb25lbnRVdWlkID0gYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQsIGNsYXNzTmFtZSkpO1xuICAgIGlmICghY29tcG9uZW50VXVpZCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIGNvbXBvbmVudCAke2NsYXNzTmFtZX0gZm9yIHByb3BlcnR5IGJpbmRpbmcuYCk7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBvbmVudER1bXAgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1jb21wb25lbnQnLCBjb21wb25lbnRVdWlkKTtcbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcbiAgICAgICAgY29uc3QgcHJvcGVydHlEdW1wID0gZ2V0UHJvcGVydHlEdW1wKGNvbXBvbmVudER1bXAsIGJpbmRpbmcucHJvcGVydHlOYW1lKTtcbiAgICAgICAgaWYgKCFwcm9wZXJ0eUR1bXApIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gQ2Fubm90IGZpbmQgcHJvcGVydHkgZHVtcCAke2JpbmRpbmcucHJvcGVydHlOYW1lfS5gKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdGFyZ2V0VXVpZCA9IGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnXG4gICAgICAgICAgICA/IGJpbmRpbmcubm9kZVV1aWRcbiAgICAgICAgICAgIDogYXdhaXQgZmluZENvbXBvbmVudFV1aWQoYmluZGluZy5ub2RlVXVpZCwgYmluZGluZy5jb21wb25lbnRUeXBlIHx8IGJpbmRpbmcucHJvcGVydHlUeXBlKTtcblxuICAgICAgICBpZiAoIXRhcmdldFV1aWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gQ2Fubm90IGZpbmQgdGFyZ2V0IGZvciAke2JpbmRpbmcucHJvcGVydHlOYW1lfS5gKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGF3YWl0IHNldFJlZmVyZW5jZVByb3BlcnR5KGNvbXBvbmVudFV1aWQsIGJpbmRpbmcucHJvcGVydHlOYW1lLCBwcm9wZXJ0eUR1bXAsIHRhcmdldFV1aWQpKSB7XG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYm91bmRDb3VudDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZTogc3RyaW5nIHwgc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIG5vZGVVdWlkKTtcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcbiAgICBjb25zdCBjb21wb25lbnROYW1lcyA9IEFycmF5LmlzQXJyYXkoY29tcG9uZW50TmFtZSkgPyBjb21wb25lbnROYW1lIDogW2NvbXBvbmVudE5hbWVdO1xuXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xuICAgICAgICBjb25zdCBjb21wb25lbnRBbnkgPSBjb21wb25lbnQgYXMgYW55O1xuICAgICAgICBjb25zdCB1dWlkID0gU3RyaW5nKHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py52YWx1ZT8udXVpZCkgfHwgcmVhZER1bXBWYWx1ZShjb21wb25lbnRBbnk/LnV1aWQpIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udHlwZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/Ll9fdHlwZV9fLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8udHlwZSxcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgIGlmIChjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gY29tcG9uZW50TmFtZXMuc29tZSgobmFtZSkgPT4gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBuYW1lKSkpKSB7XG4gICAgICAgICAgICByZXR1cm4gdXVpZCB8fCBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wOiBhbnksIHByb3BlcnR5TmFtZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XG4gICAgY29uc3QgZHVtcCA9IGNvbXBvbmVudER1bXA/LnZhbHVlPy5bcHJvcGVydHlOYW1lXSB8fCBjb21wb25lbnREdW1wPy5bcHJvcGVydHlOYW1lXTtcbiAgICByZXR1cm4gZHVtcCAmJiB0eXBlb2YgZHVtcCA9PT0gJ29iamVjdCcgPyBkdW1wIDogbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2V0UmVmZXJlbmNlUHJvcGVydHkoY29tcG9uZW50VXVpZDogc3RyaW5nLCBwcm9wZXJ0eU5hbWU6IHN0cmluZywgcHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKTtcblxuICAgIGZvciAoY29uc3QgZHVtcCBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdzZXQtcHJvcGVydHknLCB7XG4gICAgICAgICAgICAgICAgdXVpZDogY29tcG9uZW50VXVpZCxcbiAgICAgICAgICAgICAgICBwYXRoOiBwcm9wZXJ0eU5hbWUsXG4gICAgICAgICAgICAgICAgZHVtcCxcbiAgICAgICAgICAgICAgICByZWNvcmQ6IHRydWUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYmluZCAke3Byb3BlcnR5TmFtZX0gd2l0aCBvbmUgcmVmZXJlbmNlIGR1bXAgY2FuZGlkYXRlLmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gbWFrZVJlZmVyZW5jZUR1bXBDYW5kaWRhdGVzKHByb3BlcnR5RHVtcDogYW55LCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBhbnlbXSB7XG4gICAgY29uc3QgYmFzZSA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkocHJvcGVydHlEdW1wKSk7XG4gICAgY29uc3QgY2FuZGlkYXRlczogYW55W10gPSBbXTtcblxuICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgIC4uLmJhc2UsXG4gICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgICB1dWlkOiB0YXJnZXRVdWlkLFxuICAgICAgICB9LFxuICAgIH0pO1xuXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcbiAgICAgICAgLi4uYmFzZSxcbiAgICAgICAgdmFsdWU6IHRhcmdldFV1aWQsXG4gICAgfSk7XG5cbiAgICBjYW5kaWRhdGVzLnB1c2goe1xuICAgICAgICAuLi5iYXNlLFxuICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgX191dWlkX186IHRhcmdldFV1aWQsXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBpZiAoYmFzZS52YWx1ZSAmJiB0eXBlb2YgYmFzZS52YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgY2FuZGlkYXRlcy51bnNoaWZ0KHtcbiAgICAgICAgICAgIC4uLmJhc2UsXG4gICAgICAgICAgICB2YWx1ZToge1xuICAgICAgICAgICAgICAgIC4uLmJhc2UudmFsdWUsXG4gICAgICAgICAgICAgICAgdXVpZDogdGFyZ2V0VXVpZCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhvcGVuZWRBc3NldFVybDogc3RyaW5nIHwgbnVsbCwgc2NyaXB0VXJsOiBzdHJpbmcsIHNlbGVjdGVkVXVpZDogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgcm9vdE5hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGlmICghb3BlbmVkQXNzZXRVcmwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgb3BlbmVkQXNzZXRVcmwpO1xuICAgIGlmICghYXNzZXQ/LmZpbGUgfHwgIS9cXC4ocHJlZmFifHNjZW5lKSQvaS50ZXN0KGFzc2V0LmZpbGUpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkSnNvbkZpbGVXaXRoUmV0cnkoYXNzZXQuZmlsZSk7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IG5vZGVJZEJ5VXVpZCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgY29uc3Qgbm9kZUlkQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcblxuICAgIGRhdGEuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGl0ZW0/Ll9fdHlwZV9fID09PSAnY2MuTm9kZScpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVVdWlkID0gaXRlbT8uX2lkIHx8IGl0ZW0/Ll91dWlkIHx8ICcnO1xuICAgICAgICAgICAgaWYgKG5vZGVVdWlkKSB7XG4gICAgICAgICAgICAgICAgbm9kZUlkQnlVdWlkLnNldChub2RlVXVpZCwgaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fbmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBub2RlSWRCeU5hbWUuc2V0KGl0ZW0uX25hbWUsIGluZGV4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XG4gICAgICAgIGNvbnN0IG5vZGUgPSBOdW1iZXIuaXNJbnRlZ2VyKG5vZGVJZCkgPyBkYXRhW25vZGVJZF0gOiBudWxsO1xuICAgICAgICBjb25zdCBub2RlVXVpZCA9IG5vZGU/Ll9pZCB8fCBub2RlPy5fdXVpZCB8fCAnJztcbiAgICAgICAgY29uc3Qgbm9kZU5hbWUgPSBub2RlPy5fbmFtZSB8fCAnJztcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlVXVpZCkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5zZXQoYCR7bm9kZVV1aWR9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLnNldChgJHtub2RlVXVpZH06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlTmFtZSkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5zZXQoYCR7bm9kZU5hbWV9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLnNldChgJHtub2RlTmFtZX06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2VsZWN0ZWROb2RlSWQgPSBub2RlSWRCeVV1aWQuZ2V0KHNlbGVjdGVkVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChyb290TmFtZSk7XG4gICAgaWYgKHNlbGVjdGVkTm9kZUlkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcbiAgICBjb25zdCBzY3JpcHRUeXBlTmFtZXMgPSBnZXRTZXJpYWxpemVkU2NyaXB0VHlwZU5hbWVzKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpO1xuICAgIGxldCB0YXJnZXRDb21wb25lbnQgPSBkYXRhLmZpbmQoKGl0ZW0pID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGl0ZW0/Lm5vZGU/Ll9faWRfXztcbiAgICAgICAgY29uc3Qgbm9kZSA9IE51bWJlci5pc0ludGVnZXIobm9kZUlkKSA/IGRhdGFbbm9kZUlkXSA6IG51bGw7XG4gICAgICAgIGNvbnN0IGF0dGFjaGVkVG9TZWxlY3RlZE5vZGUgPSBub2RlSWQgPT09IHNlbGVjdGVkTm9kZUlkIHx8IG5vZGU/Ll9uYW1lID09PSByb290TmFtZTtcbiAgICAgICAgY29uc3QgaGFzR2VuZXJhdGVkUHJvcGVydHkgPSBiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaXRlbSwgYmluZGluZy5wcm9wZXJ0eU5hbWUpKTtcblxuICAgICAgICByZXR1cm4gc2NyaXB0VHlwZU5hbWVzLmluY2x1ZGVzKGl0ZW0uX190eXBlX18pXG4gICAgICAgICAgICB8fCBpdGVtLl9fdHlwZV9fID09PSBjbGFzc05hbWVcbiAgICAgICAgICAgIHx8IHNob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXykgPT09IGNsYXNzTmFtZVxuICAgICAgICAgICAgfHwgKGF0dGFjaGVkVG9TZWxlY3RlZE5vZGUgJiYgaGFzR2VuZXJhdGVkUHJvcGVydHkpO1xuICAgIH0pO1xuXG4gICAgaWYgKCF0YXJnZXRDb21wb25lbnQpIHtcbiAgICAgICAgdGFyZ2V0Q29tcG9uZW50ID0gYXBwZW5kU2VyaWFsaXplZFNjcmlwdENvbXBvbmVudChkYXRhLCBzZWxlY3RlZE5vZGVJZCwgc2NyaXB0VHlwZU5hbWVzWzBdIHx8IGNsYXNzTmFtZSwgYmluZGluZ3MpO1xuICAgIH1cblxuICAgIGxldCBib3VuZENvdW50ID0gMDtcblxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xuICAgICAgICBpZiAoYmluZGluZy5iaW5kVGFyZ2V0ID09PSAnbm9kZScpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVJZCA9IG5vZGVJZEJ5VXVpZC5nZXQoYmluZGluZy5ub2RlVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChiaW5kaW5nLm5vZGVOYW1lKTtcbiAgICAgICAgICAgIGlmIChub2RlSWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHRhcmdldENvbXBvbmVudFtiaW5kaW5nLnByb3BlcnR5TmFtZV0gPSB7IF9faWRfXzogbm9kZUlkIH07XG4gICAgICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0eXBlTmFtZSA9IGJpbmRpbmcuY29tcG9uZW50VHlwZSB8fCBiaW5kaW5nLnByb3BlcnR5VHlwZTtcbiAgICAgICAgY29uc3QgY29tcG9uZW50SWQgPSBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3R5cGVOYW1lfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3R5cGVOYW1lfWApXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApO1xuXG4gICAgICAgIGlmIChjb21wb25lbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IGNvbXBvbmVudElkIH07XG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3cml0ZUZpbGVTeW5jKGFzc2V0LmZpbGUsIGAke0pTT04uc3RyaW5naWZ5KGRhdGEsIG51bGwsIDIpfVxcbmAsICd1dGY4Jyk7XG4gICAgcmV0dXJuIGJvdW5kQ291bnQ7XG59XG5cbmZ1bmN0aW9uIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbLi4ubmV3IFNldChbXG4gICAgICAgIC4uLnJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0LCBjbGFzc05hbWUpLFxuICAgICAgICBjbGFzc05hbWUsXG4gICAgXS5maWx0ZXIoQm9vbGVhbikpXTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kU2VyaWFsaXplZFNjcmlwdENvbXBvbmVudChkYXRhOiBhbnlbXSwgbm9kZUlkOiBudW1iZXIsIHNjcmlwdFR5cGU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBhbnkge1xuICAgIGNvbnN0IG5vZGUgPSBkYXRhW25vZGVJZF07XG4gICAgY29uc3QgY29tcG9uZW50SWQgPSBkYXRhLmxlbmd0aDtcbiAgICBjb25zdCBwcmVmYWJJbmZvSWQgPSBjb21wb25lbnRJZCArIDE7XG4gICAgY29uc3QgY29tcG9uZW50OiBhbnkgPSB7XG4gICAgICAgIF9fdHlwZV9fOiBzY3JpcHRUeXBlLFxuICAgICAgICBfbmFtZTogJycsXG4gICAgICAgIF9vYmpGbGFnczogMCxcbiAgICAgICAgX19lZGl0b3JFeHRyYXNfXzoge30sXG4gICAgICAgIG5vZGU6IHtcbiAgICAgICAgICAgIF9faWRfXzogbm9kZUlkLFxuICAgICAgICB9LFxuICAgICAgICBfZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgX19wcmVmYWI6IHtcbiAgICAgICAgICAgIF9faWRfXzogcHJlZmFiSW5mb0lkLFxuICAgICAgICB9LFxuICAgICAgICBfaWQ6ICcnLFxuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcbiAgICAgICAgY29tcG9uZW50W2JpbmRpbmcucHJvcGVydHlOYW1lXSA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgcHJlZmFiSW5mbyA9IHtcbiAgICAgICAgX190eXBlX186ICdjYy5Db21wUHJlZmFiSW5mbycsXG4gICAgICAgIGZpbGVJZDogbWFrZVByZWZhYkZpbGVJZCgpLFxuICAgIH07XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobm9kZS5fY29tcG9uZW50cykpIHtcbiAgICAgICAgbm9kZS5fY29tcG9uZW50cyA9IFtdO1xuICAgIH1cbiAgICBub2RlLl9jb21wb25lbnRzLnB1c2goeyBfX2lkX186IGNvbXBvbmVudElkIH0pO1xuICAgIGRhdGEucHVzaChjb21wb25lbnQsIHByZWZhYkluZm8pO1xuICAgIHJldHVybiBjb21wb25lbnQ7XG59XG5cbmZ1bmN0aW9uIG1ha2VQcmVmYWJGaWxlSWQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjaGFycyA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcbiAgICBjb25zdCBieXRlcyA9IHJhbmRvbUJ5dGVzKDIyKTtcbiAgICBsZXQgcmVzdWx0ID0gJyc7XG4gICAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgICAgIHJlc3VsdCArPSBjaGFyc1tieXRlICUgY2hhcnMubGVuZ3RoXTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZnVuY3Rpb24gc2hvcnRUeXBlTmFtZSh0eXBlOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiB0eXBlLnNwbGl0KCcuJykucG9wKCkgfHwgdHlwZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdLCBjb25maWc6IEJpbmRUb29sQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBidXR0b24gb2YgYnV0dG9ucykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBidXR0b24ubm9kZVV1aWQpO1xuICAgICAgICAgICAgaWYgKGhhc0NvbXBvbmVudChub2RlLCAnQnV0dG9uJykpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50VHlwZSA9IGJ1dHRvbi5jb21wb25lbnRUeXBlIHx8ICdjYy5CdXR0b24nO1xuICAgICAgICAgICAgYXdhaXQgY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKGJ1dHRvbi5ub2RlVXVpZCwgW2NvbXBvbmVudFR5cGUsIHNob3J0VHlwZU5hbWUoY29tcG9uZW50VHlwZSldKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGVuc3VyZSBCdXR0b24gY29tcG9uZW50IG9uICR7YnV0dG9uLm5vZGVOYW1lfS5gLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIGhhc0NvbXBvbmVudChub2RlOiBhbnksIGNvbXBvbmVudE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xuICAgIHJldHVybiBjb21wb25lbnRzLnNvbWUoKGNvbXBvbmVudDogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXG4gICAgICAgICAgICBjb21wb25lbnQ/LnR5cGUsXG4gICAgICAgICAgICBjb21wb25lbnQ/Lm5hbWUsXG4gICAgICAgICAgICBjb21wb25lbnQ/LmNpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Lm5hbWUsXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5fX3R5cGVfXyxcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/LmNpZCxcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBjb21wb25lbnROYW1lKSk7XG4gICAgfSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZTogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBsZWZ0ID0gY2FuZGlkYXRlLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmlnaHQgPSBjb21wb25lbnROYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbGVmdFNob3J0ID0gc2hvcnRUeXBlTmFtZShjYW5kaWRhdGUpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmlnaHRTaG9ydCA9IHNob3J0VHlwZU5hbWUoY29tcG9uZW50TmFtZSkudG9Mb3dlckNhc2UoKTtcblxuICAgIHJldHVybiBsZWZ0ID09PSByaWdodFxuICAgICAgICB8fCBsZWZ0U2hvcnQgPT09IHJpZ2h0U2hvcnRcbiAgICAgICAgfHwgbGVmdC5lbmRzV2l0aChgLiR7cmlnaHRTaG9ydH1gKVxuICAgICAgICB8fCBsZWZ0LmluY2x1ZGVzKHJpZ2h0KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsYXN0RXJyb3I6IHVua25vd247XG5cbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnROYW1lcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnY3JlYXRlLWNvbXBvbmVudCcsIHtcbiAgICAgICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgICAgICBjb21wb25lbnQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxhc3RFcnJvciA9IGVycm9yO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdGhyb3cgbGFzdEVycm9yO1xufVxuXG5mdW5jdGlvbiBkZWxheShtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG4iXX0=