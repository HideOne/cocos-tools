"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const fs_1 = require("fs");
const path_1 = require("path");
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
    const componentAttached = await tryAttachComponent(selectedUuid, className);
    let propertiesBound = 0;
    try {
        await Editor.Message.request('scene', 'save-scene');
        propertiesBound = await bindSerializedAssetReferences(openedAssetUrl, className, getNodeName(selectedTree), scan);
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
    if (value === 'cc.Node') {
        return 'Node';
    }
    if (value === 'cc.Button') {
        return 'Button';
    }
    return value || 'Node';
}
function toComponentType(propertyType) {
    if (propertyType === 'Button') {
        return 'cc.Button';
    }
    return propertyType;
}
function isButtonType(propertyType) {
    return propertyType === 'Button' || propertyType === 'cc.Button';
}
async function queryOpenedAssetUrl(selectedTree) {
    try {
        const savedId = await Editor.Message.request('scene', 'save-scene');
        if (!savedId) {
            return findAssetUrlByNodeTree(selectedTree);
        }
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', savedId);
        return (asset === null || asset === void 0 ? void 0 : asset.url) || (asset === null || asset === void 0 ? void 0 : asset.source) || findAssetUrlByNodeTree(selectedTree);
    }
    catch (_a) {
        return findAssetUrlByNodeTree(selectedTree);
    }
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
            const data = JSON.parse((0, fs_1.readFileSync)(file, 'utf8'));
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
            console.warn(`[${PACKAGE_NAME}] Failed to inspect asset ${file}.`, error);
        }
    }
    return null;
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
    return [...imports].sort((left, right) => {
        const order = ['_decorator', 'Component', 'Node', 'Button', 'sp'];
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
        }
        return left.localeCompare(right);
    }).join(', ');
}
function collectImportFromType(imports, typeName) {
    const firstPart = typeName.trim().split('.')[0];
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(firstPart)) {
        imports.add(firstPart);
    }
}
function renderProperties(bindings) {
    return bindings.map((binding) => `    @property(${binding.decoratorType})
    public ${binding.propertyName}: ${binding.propertyType} | null = null;`).join('\n\n');
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
    return replaceBlock(replaceBlock(updated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END, eventBlock), AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END, handlerBlock);
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
async function tryAttachComponent(nodeUuid, className) {
    if (await findComponentUuid(nodeUuid, className)) {
        return true;
    }
    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: className,
        });
        return true;
    }
    catch (firstError) {
        console.warn(`[${PACKAGE_NAME}] First component attach failed. Waiting for script import before retry.`, firstError);
    }
    await delay(1000);
    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: className,
        });
        return true;
    }
    catch (secondError) {
        console.warn(`[${PACKAGE_NAME}] Automatic component attach failed.`, secondError);
        return false;
    }
}
async function bindComponentProperties(nodeUuid, className, bindings) {
    const componentUuid = await findComponentUuid(nodeUuid, className);
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
        if (candidates.some((candidate) => matchesComponentName(candidate, componentName))) {
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
async function bindSerializedAssetReferences(openedAssetUrl, className, rootName, bindings) {
    var _a, _b, _c, _d;
    if (!openedAssetUrl) {
        return 0;
    }
    const asset = await Editor.Message.request('asset-db', 'query-asset-info', openedAssetUrl);
    if (!(asset === null || asset === void 0 ? void 0 : asset.file) || !/\.(prefab|scene)$/i.test(asset.file)) {
        return 0;
    }
    const raw = (0, fs_1.readFileSync)(asset.file, 'utf8');
    const data = JSON.parse(raw);
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
    const targetComponent = data.find((item) => {
        var _a;
        if (typeof (item === null || item === void 0 ? void 0 : item.__type__) !== 'string') {
            return false;
        }
        const nodeId = (_a = item === null || item === void 0 ? void 0 : item.node) === null || _a === void 0 ? void 0 : _a.__id__;
        const node = Number.isInteger(nodeId) ? data[nodeId] : null;
        const attachedToRoot = (node === null || node === void 0 ? void 0 : node._name) === rootName;
        const hasGeneratedProperty = bindings.some((binding) => Object.prototype.hasOwnProperty.call(item, binding.propertyName));
        const looksLikeScriptComponent = !item.__type__.startsWith('cc.') && !item.__type__.startsWith('sp.');
        return item.__type__ === className
            || shortTypeName(item.__type__) === className
            || hasGeneratedProperty
            || (attachedToRoot && looksLikeScriptComponent);
    });
    if (!targetComponent) {
        return 0;
    }
    let boundCount = 0;
    for (const binding of bindings) {
        if (binding.bindTarget === 'node') {
            const nodeId = (_a = nodeIdByUuid.get(binding.nodeUuid)) !== null && _a !== void 0 ? _a : nodeIdByName.get(binding.nodeName);
            if (nodeId !== undefined) {
                targetComponent[binding.propertyName] = { __id__: nodeId };
                boundCount += 1;
            }
            continue;
        }
        const typeName = binding.componentType || binding.propertyType;
        const componentId = (_d = (_c = (_b = componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${typeName}`)) !== null && _b !== void 0 ? _b : componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${shortTypeName(typeName)}`)) !== null && _c !== void 0 ? _c : componentIdByNodeNameAndType.get(`${binding.nodeName}:${typeName}`)) !== null && _d !== void 0 ? _d : componentIdByNodeNameAndType.get(`${binding.nodeName}:${shortTypeName(typeName)}`);
        if (componentId !== undefined) {
            targetComponent[binding.propertyName] = { __id__: componentId };
            boundCount += 1;
        }
    }
    (0, fs_1.writeFileSync)(asset.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return boundCount;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWdMQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBbEwzQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBRXpELE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQztBQUVqQyxNQUFNLGVBQWUsR0FBRyxxQ0FBcUMsQ0FBQztBQUM5RCxNQUFNLGFBQWEsR0FBRyw4Q0FBOEMsQ0FBQztBQUNyRSxNQUFNLHNCQUFzQixHQUFHLG9CQUFvQixDQUFDO0FBQ3BELE1BQU0sb0JBQW9CLEdBQUcsa0JBQWtCLENBQUM7QUFDaEQsTUFBTSx1QkFBdUIsR0FBRyw0QkFBNEIsQ0FBQztBQUM3RCxNQUFNLHFCQUFxQixHQUFHLDBCQUEwQixDQUFDO0FBQ3pELE1BQU0seUJBQXlCLEdBQUcsOEJBQThCLENBQUM7QUFDakUsTUFBTSx1QkFBdUIsR0FBRyw0QkFBNEIsQ0FBQztBQThDN0QsTUFBTSxhQUFhLEdBQW1CO0lBQ2xDLFVBQVUsRUFBRSxZQUFZO0lBQ3hCLHNCQUFzQixFQUFFLElBQUk7SUFDNUIsYUFBYSxFQUFFLFFBQVE7SUFDdkIsVUFBVSxFQUFFLE1BQU07SUFDbEIsS0FBSyxFQUFFO1FBQ0g7WUFDSSxNQUFNLEVBQUUsTUFBTTtZQUNkLGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFlBQVksRUFBRSxNQUFNO1lBQ3BCLGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFVBQVUsRUFBRSxNQUFNO1lBQ2xCLGFBQWEsRUFBRSxFQUFFO1lBQ2pCLFlBQVksRUFBRSxLQUFLO1lBQ25CLGtCQUFrQixFQUFFLEtBQUs7WUFDekIsT0FBTyxFQUFFLElBQUk7U0FDaEI7UUFDRDtZQUNJLE1BQU0sRUFBRSxXQUFXO1lBQ25CLGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFlBQVksRUFBRSxNQUFNO1lBQ3BCLGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFVBQVUsRUFBRSxNQUFNO1lBQ2xCLGFBQWEsRUFBRSxFQUFFO1lBQ2pCLFlBQVksRUFBRSxJQUFJO1lBQ2xCLGtCQUFrQixFQUFFLEtBQUs7WUFDekIsT0FBTyxFQUFFLElBQUk7U0FDaEI7UUFDRDtZQUNJLE1BQU0sRUFBRSxPQUFPO1lBQ2YsYUFBYSxFQUFFLGFBQWE7WUFDNUIsWUFBWSxFQUFFLGFBQWE7WUFDM0IsYUFBYSxFQUFFLGFBQWE7WUFDNUIsVUFBVSxFQUFFLFdBQVc7WUFDdkIsYUFBYSxFQUFFLGFBQWE7WUFDNUIsWUFBWSxFQUFFLEtBQUs7WUFDbkIsa0JBQWtCLEVBQUUsS0FBSztZQUN6QixPQUFPLEVBQUUsSUFBSTtTQUNoQjtRQUNEO1lBQ0ksTUFBTSxFQUFFLFFBQVE7WUFDaEIsYUFBYSxFQUFFLFFBQVE7WUFDdkIsWUFBWSxFQUFFLFFBQVE7WUFDdEIsYUFBYSxFQUFFLFFBQVE7WUFDdkIsVUFBVSxFQUFFLFdBQVc7WUFDdkIsYUFBYSxFQUFFLFdBQVc7WUFDMUIsWUFBWSxFQUFFLEtBQUs7WUFDbkIsa0JBQWtCLEVBQUUsSUFBSTtZQUN4QixPQUFPLEVBQUUsSUFBSTtTQUNoQjtLQUNKO0NBQ0osQ0FBQztBQUVXLFFBQUEsT0FBTyxHQUErQztJQUMvRCxLQUFLLENBQUMsY0FBYztRQUNoQixNQUFNLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSxRQUFRLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVc7UUFDYixPQUFPLFVBQVUsRUFBRSxDQUFDO0lBQ3hCLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQStCO1FBQzVDLE1BQU0sVUFBVSxpREFDVCxhQUFhLEdBQ2IsTUFBTSxLQUNULEtBQUssRUFBRSxjQUFjLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUN0QyxDQUFDO1FBRUYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNuRixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSx3QkFBd0IsRUFBRSxVQUFVLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUMzRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxlQUFlLEVBQUUsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3pGLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLFlBQVksRUFBRSxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN6RSxPQUFPLFVBQVUsQ0FBQztJQUN0QixDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVc7UUFDYixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxZQUFZLEVBQUUsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RGLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLHdCQUF3QixFQUFFLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1FBQzlHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxFQUFFLGVBQWUsRUFBRSxhQUFhLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDNUYsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLGFBQWEsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN0RixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzVFLE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ2xCLElBQUksQ0FBQztZQUNELE1BQU0sTUFBTSxHQUFHLE1BQU0sZ0JBQWdCLEVBQUUsQ0FBQztZQUN4QyxNQUFNLE1BQU0sR0FBRztnQkFDWCxXQUFXLE1BQU0sQ0FBQyxTQUFTLEVBQUU7Z0JBQzdCLGVBQWUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUU7Z0JBQ3ZDLGtCQUFrQixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtnQkFDekMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDLENBQUMseUVBQXlFO2dCQUNqSixxQkFBcUIsTUFBTSxDQUFDLGVBQWUsRUFBRTthQUNoRCxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUViLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNsQixLQUFLLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxDQUFDLG1CQUFtQjtnQkFDbEUsT0FBTyxFQUFFLE1BQU07Z0JBQ2YsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsTUFBTSxFQUFFLFlBQVk7Z0JBQ3BCLE9BQU8sRUFBRSxJQUFJO2FBQ2hCLENBQUMsQ0FBQztRQUNQLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2IsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3ZFLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxZQUFZLEtBQUssT0FBTyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDckQsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ2xCLEtBQUssRUFBRSxrQkFBa0I7Z0JBQ3pCLE9BQU87Z0JBQ1AsSUFBSSxFQUFFLE9BQU87Z0JBQ2IsTUFBTSxFQUFFLFlBQVk7Z0JBQ3BCLE9BQU8sRUFBRSxJQUFJO2FBQ2hCLENBQUMsQ0FBQztRQUNQLENBQUM7SUFDTCxDQUFDO0NBQ0osQ0FBQztBQUVGLFNBQWdCLElBQUksS0FBSSxDQUFDO0FBRXpCLFNBQWdCLE1BQU0sS0FBSSxDQUFDO0FBRTNCLEtBQUssVUFBVSxnQkFBZ0I7SUFDM0IsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDekcsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQztJQUNuRCxDQUFDO0lBRUQsTUFBTSxZQUFZLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFDNUYsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMscUVBQXFFLENBQUMsQ0FBQztJQUMzRixDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzNDLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN4QyxNQUFNLE1BQU0sR0FBRyxNQUFNLFVBQVUsRUFBRSxDQUFDO0lBQ2xDLE1BQU0sY0FBYyxHQUFHLE1BQU0sbUJBQW1CLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDL0QsTUFBTSxTQUFTLEdBQUcsYUFBYSxDQUFDLGNBQWMsRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzlFLE1BQU0sSUFBSSxHQUFHLFlBQVksQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDaEQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUM7SUFDL0QsTUFBTSxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDOUMsTUFBTSxNQUFNLEdBQUcsWUFBWSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDdEQsTUFBTSxRQUFRLEdBQUcsTUFBTSxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDaEQsTUFBTSxpQkFBaUIsR0FBRyxRQUFRLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDdkUsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztJQUU3RSxJQUFJLFFBQVEsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQyw4RkFBOEYsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUMvSCxDQUFDO0lBRUQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDMUIsTUFBTSxVQUFVLENBQUMsU0FBUyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNsRCxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFFckUsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLGtCQUFrQixDQUFDLFlBQVksRUFBRSxTQUFTLENBQUMsQ0FBQztJQUM1RSxJQUFJLGVBQWUsR0FBRyxDQUFDLENBQUM7SUFFeEIsSUFBSSxDQUFDO1FBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFDcEQsZUFBZSxHQUFHLE1BQU0sNkJBQTZCLENBQUMsY0FBYyxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsWUFBWSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDbEgsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNqQixNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDOUUsQ0FBQztJQUNMLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2IsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLFlBQVkscUVBQXFFLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDL0csQ0FBQztJQUVELE9BQU87UUFDSCxTQUFTO1FBQ1QsU0FBUztRQUNULFFBQVEsRUFBRSxJQUFJO1FBQ2QsT0FBTztRQUNQLE9BQU87UUFDUCxpQkFBaUI7UUFDakIsZUFBZTtLQUNsQixDQUFDO0FBQ04sQ0FBQztBQUVELEtBQUssVUFBVSxVQUFVO0lBQ3JCLElBQUksQ0FBQztRQUNELE1BQU0sYUFBYSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDcEUscURBQ08sYUFBYSxHQUNiLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQyxLQUN4QixLQUFLLEVBQUUsY0FBYyxDQUFDLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxLQUFLLENBQUMsSUFDN0M7SUFDTixDQUFDO0lBQUMsV0FBTSxDQUFDO1FBQ0wsT0FBTyxhQUFhLENBQUM7SUFDekIsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxLQUFjO0lBQ2xDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDeEIsT0FBTyxhQUFhLENBQUMsS0FBSyxDQUFDO0lBQy9CLENBQUM7SUFFRCxNQUFNLFVBQVUsR0FBRyxLQUFLO1NBQ25CLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQztTQUNsRCxHQUFHLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztTQUN2QyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQW9CLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUV2RCxPQUFPLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7QUFDcEUsQ0FBQztBQUVELFNBQVMsYUFBYSxDQUFDLElBQVM7SUFDNUIsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ1YsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDdkYsTUFBTSxZQUFZLEdBQUcsc0JBQXNCLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDM0QsTUFBTSxVQUFVLEdBQWUsWUFBWSxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7SUFFOUUsT0FBTztRQUNILE1BQU07UUFDTixhQUFhLEVBQUUsWUFBWTtRQUMzQixZQUFZO1FBQ1osYUFBYSxFQUFFLFlBQVk7UUFDM0IsVUFBVTtRQUNWLGFBQWEsRUFBRSxVQUFVLEtBQUssV0FBVyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7UUFDOUUsWUFBWSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksTUFBTSxLQUFLLFdBQVc7UUFDbEUsa0JBQWtCLEVBQUUsWUFBWSxDQUFDLFlBQVksQ0FBQztRQUM5QyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sS0FBSyxLQUFLO0tBQ2xDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxzQkFBc0IsQ0FBQyxhQUFxQjtJQUNqRCxNQUFNLEtBQUssR0FBRyxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDbkMsSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDdEIsT0FBTyxNQUFNLENBQUM7SUFDbEIsQ0FBQztJQUVELElBQUksS0FBSyxLQUFLLFdBQVcsRUFBRSxDQUFDO1FBQ3hCLE9BQU8sUUFBUSxDQUFDO0lBQ3BCLENBQUM7SUFFRCxPQUFPLEtBQUssSUFBSSxNQUFNLENBQUM7QUFDM0IsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLFlBQW9CO0lBQ3pDLElBQUksWUFBWSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQzVCLE9BQU8sV0FBVyxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxPQUFPLFlBQVksQ0FBQztBQUN4QixDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsWUFBb0I7SUFDdEMsT0FBTyxZQUFZLEtBQUssUUFBUSxJQUFJLFlBQVksS0FBSyxXQUFXLENBQUM7QUFDckUsQ0FBQztBQUVELEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxZQUFpQjtJQUNoRCxJQUFJLENBQUM7UUFDRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUMsQ0FBQztRQUNwRSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDWCxPQUFPLHNCQUFzQixDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFFRCxNQUFNLEtBQUssR0FBRyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNwRixPQUFPLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLEdBQUcsTUFBSSxLQUFLLGFBQUwsS0FBSyx1QkFBTCxLQUFLLENBQUUsTUFBTSxDQUFBLElBQUksc0JBQXNCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDL0UsQ0FBQztJQUFDLFdBQU0sQ0FBQztRQUNMLE9BQU8sc0JBQXNCLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDaEQsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLHNCQUFzQixDQUFDLFlBQWlCO0lBQzdDLE1BQU0sU0FBUyxHQUFHLElBQUEsV0FBSSxFQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ3RELElBQUksQ0FBQyxJQUFBLGVBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDM0MsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLFlBQVksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUVwRSxLQUFLLE1BQU0sSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQztZQUNELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBQSxpQkFBWSxFQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ3BELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZCLFNBQVM7WUFDYixDQUFDO1lBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsUUFBUSxNQUFLLFNBQVMsQ0FBQyxDQUFDO1lBQ2xFLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLEtBQUssTUFBSyxRQUFRLENBQUMsQ0FBQztZQUMvRCxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ1gsU0FBUztZQUNiLENBQUM7WUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDNUUsTUFBTSxlQUFlLEdBQUcsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztZQUNyRixJQUFJLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLGVBQWUsR0FBRyxDQUFDLElBQUksSUFBQSxlQUFRLEVBQUMsSUFBSSxFQUFFLElBQUEsY0FBTyxFQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzdGLE1BQU0sYUFBYSxHQUFHLElBQUEsZUFBUSxFQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBQzlFLE9BQU8sUUFBUSxhQUFhLEVBQUUsQ0FBQztZQUNuQyxDQUFDO1FBQ0wsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSw2QkFBNkIsSUFBSSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDOUUsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNoQixDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsR0FBVyxFQUFFLFVBQW9CO0lBQ3JELE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztJQUU1QixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUEsZ0JBQVcsRUFBQyxHQUFHLEVBQUUsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQzVELE1BQU0sUUFBUSxHQUFHLElBQUEsV0FBSSxFQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdkMsSUFBSSxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0QixNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsY0FBYyxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDO1FBQ3pELENBQUM7YUFBTSxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBQSxjQUFPLEVBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNoRSxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzFCLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQztBQUVELFNBQVMsYUFBYSxDQUFDLGNBQTZCLEVBQUUsU0FBaUIsRUFBRSxVQUFrQjtJQUN2RixNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxVQUFVLElBQUksYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdEcsTUFBTSxhQUFhLEdBQUcsUUFBUSxjQUFjLElBQUksU0FBUyxLQUFLLENBQUM7SUFDL0QsSUFBSSxjQUFjLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztRQUNoQyxPQUFPLGFBQWEsQ0FBQztJQUN6QixDQUFDO0lBRUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ2xCLE9BQU8sYUFBYSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxNQUFNLFNBQVMsR0FBRyxjQUFjO1NBQzNCLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDO1NBQ3ZCLE9BQU8sQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUM7U0FDakMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztJQUV6QixNQUFNLFlBQVksR0FBRyxTQUFTLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQztRQUNoRCxDQUFDLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDO1FBQ25DLENBQUMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUM1QyxNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUVuRyxPQUFPLFFBQVEsY0FBYyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLFNBQVMsS0FBSyxDQUFDO0FBQzNFLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxHQUFXO0lBQy9CLE1BQU0sWUFBWSxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDdEUsT0FBTyxJQUFBLGVBQVUsRUFBQyxJQUFBLFdBQUksRUFBQyxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO0FBQy9ELENBQUM7QUFFRCxTQUFTLGtCQUFrQixDQUFDLEtBQWE7SUFDckMsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ25GLE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO0FBQy9ELENBQUM7QUFFRCxTQUFTLFlBQVksQ0FBQyxJQUFTLEVBQUUsTUFBc0I7SUFDbkQsTUFBTSxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFDNUMsTUFBTSxRQUFRLEdBQXFCLEVBQUUsQ0FBQztJQUN0QyxNQUFNLEtBQUssR0FBRyxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUU1QyxNQUFNLEtBQUssR0FBRyxDQUFDLElBQVMsRUFBRSxFQUFFO1FBQ3hCLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNuQyxNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFekMsSUFBSSxTQUFTLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQ3hELE9BQU87UUFDWCxDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDdEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNWLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDM0IsQ0FBQztRQUVELElBQUksT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLFlBQVksRUFBRSxDQUFDO1lBQ3hCLE9BQU87UUFDWCxDQUFDO1FBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNwQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakIsQ0FBQztJQUNMLENBQUMsQ0FBQztJQUVGLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNaLE9BQU8sUUFBUSxDQUFDO0FBQ3BCLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLE1BQXNCO0lBQ2pELE9BQU8sTUFBTSxDQUFDLEtBQUs7U0FDZCxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQztTQUM3QyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3pFLENBQUM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxJQUFTLEVBQUUsS0FBaUIsRUFBRSxTQUE4QjtJQUMvRSxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkMsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3pDLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFbkYsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1IsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE9BQU87UUFDSCxRQUFRLEVBQUUsT0FBTyxDQUFDLElBQUksQ0FBQztRQUN2QixRQUFRO1FBQ1IsWUFBWSxFQUFFLGNBQWMsQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxDQUFDO1FBQ2pFLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTtRQUMvQixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7UUFDakMsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO1FBQzNCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtRQUNqQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7UUFDL0Isa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtLQUM5QyxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLElBQVM7SUFDMUIsT0FBTyxNQUFNLENBQUMsYUFBYSxDQUFDLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsQ0FBQztBQUN2RCxDQUFDO0FBRUQsU0FBUyxPQUFPLENBQUMsSUFBUztJQUN0QixPQUFPLE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLElBQUksQ0FBQyxLQUFJLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxJQUFJLENBQUEsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUNqRSxDQUFDO0FBRUQsU0FBUyxXQUFXLENBQUMsSUFBUztJQUMxQixPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDOUQsQ0FBQztBQUVELFNBQVMsYUFBYSxDQUFDLEtBQVU7SUFDN0IsSUFBSSxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUN6RCxPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUM7SUFDdkIsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2pCLENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxLQUFhO0lBQzlCLE1BQU0sSUFBSSxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNuQyxPQUFPLFVBQVUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxtQkFBbUIsQ0FBQyxDQUFDO0FBQ3RFLENBQUM7QUFFRCxTQUFTLGNBQWMsQ0FBQyxLQUFhO0lBQ2pDLE1BQU0sVUFBVSxHQUFHLEtBQUs7U0FDbkIsSUFBSSxFQUFFO1NBQ04sT0FBTyxDQUFDLGlEQUFpRCxFQUFFLEdBQUcsQ0FBQztTQUMvRCxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQztTQUNuQixPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBRTdCLE1BQU0sT0FBTyxHQUFHLFVBQVU7U0FDckIsS0FBSyxDQUFDLEVBQUUsQ0FBQztTQUNULE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztTQUMzRixJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFZCxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDWCxPQUFPLE1BQU0sQ0FBQztJQUNsQixDQUFDO0lBRUQsT0FBTyxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLE9BQU8sRUFBRSxDQUFDO0FBQ25FLENBQUM7QUFFRCxTQUFTLGlCQUFpQixDQUFDLElBQVk7SUFDbkMsT0FBTyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDMUMsQ0FBQztBQUVELFNBQVMsb0JBQW9CLENBQUMsSUFBWTtJQUN0QyxPQUFPLGtDQUFrQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN6RCxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsUUFBZ0IsRUFBRSxTQUE4QjtJQUNwRSxNQUFNLEtBQUssR0FBRyxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDbkMsT0FBTyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEdBQUcsUUFBUSxHQUFHLEtBQUssR0FBRyxDQUFDLEVBQUUsQ0FBQztBQUM5RCxDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsS0FBYTtJQUM3QixPQUFPLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztBQUNuRSxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsU0FBaUIsRUFBRSxRQUEwQixFQUFFLE9BQXlCO0lBQzFGLE9BQU8sWUFBWSxlQUFlLENBQUMsUUFBUSxDQUFDOzs7O1lBSXBDLFNBQVM7ZUFDTixTQUFTOztNQUVsQixlQUFlO0VBQ25CLGdCQUFnQixDQUFDLFFBQVEsQ0FBQztNQUN0QixhQUFhOzs7Ozs7O1VBT1QsdUJBQXVCO0VBQy9CLGtCQUFrQixDQUFDLE9BQU8sQ0FBQztVQUNuQixxQkFBcUI7OztNQUd6Qix5QkFBeUI7RUFDN0Isb0JBQW9CLENBQUMsT0FBTyxDQUFDO01BQ3pCLHVCQUF1Qjs7Q0FFNUIsQ0FBQztBQUNGLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxRQUEwQjtJQUMvQyxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLFlBQVksRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBRXJELEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IscUJBQXFCLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNyRCxxQkFBcUIsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQzFELENBQUM7SUFFRCxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUM7UUFDekQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUMxQixDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQ3JDLE1BQU0sS0FBSyxHQUFHLENBQUMsWUFBWSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ2xFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEMsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN4QyxJQUFJLFNBQVMsS0FBSyxDQUFDLENBQUMsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN4QyxPQUFPLENBQUMsU0FBUyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDckMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2xCLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLE9BQW9CLEVBQUUsUUFBZ0I7SUFDakUsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNoRCxJQUFJLDRCQUE0QixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQy9DLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDM0IsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUFDLFFBQTBCO0lBQ2hELE9BQU8sUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsaUJBQWlCLE9BQU8sQ0FBQyxhQUFhO2FBQzlELE9BQU8sQ0FBQyxZQUFZLEtBQUssT0FBTyxDQUFDLFlBQVksaUJBQWlCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDMUYsQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsT0FBeUI7SUFDakQsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsTUFBTSxDQUFDLFlBQVk7bUJBQ3ZELE1BQU0sQ0FBQyxZQUFZLHlDQUF5QyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDO1VBQzdHLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDekIsQ0FBQztBQUVELFNBQVMsb0JBQW9CLENBQUMsT0FBeUI7SUFDbkQsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxlQUFlLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUM7O01BRXBGLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDckIsQ0FBQztBQUVELFNBQVMsbUJBQW1CLENBQUMsWUFBb0I7SUFDN0MsT0FBTyxVQUFVLFVBQVUsQ0FBQyxZQUFZLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDaEYsQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsUUFBZ0IsRUFBRSxTQUFpQjtJQUMzRCxNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUMsU0FBUyxFQUFFLGVBQWUsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUN2RSxNQUFNLFVBQVUsR0FBRyxTQUFTLENBQUMsU0FBUyxFQUFFLHVCQUF1QixFQUFFLHFCQUFxQixDQUFDLENBQUM7SUFDeEYsTUFBTSxZQUFZLEdBQUcsU0FBUyxDQUFDLFNBQVMsRUFBRSx5QkFBeUIsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO0lBRTlGLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1FBQzlCLE9BQU8sUUFBUSxDQUFDO0lBQ3BCLENBQUM7SUFFRCxNQUFNLFdBQVcsR0FBRyx1QkFBdUIsQ0FBQyxRQUFRLEVBQUUsZUFBZSxFQUFFLGFBQWEsQ0FBQztXQUM5RSx1QkFBdUIsQ0FBQyxRQUFRLEVBQUUsc0JBQXNCLEVBQUUsb0JBQW9CLENBQUM7V0FDOUUsQ0FBQyxlQUFlLEVBQUUsYUFBYSxDQUFXLENBQUM7SUFFbkQsSUFBSSxPQUFPLEdBQUcsWUFBWSxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ2hGLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxlQUFlLENBQUMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBRWxHLE9BQU8sWUFBWSxDQUNmLFlBQVksQ0FDUixPQUFPLEVBQ1AsdUJBQXVCLEVBQ3ZCLHFCQUFxQixFQUNyQixVQUFVLENBQ2IsRUFDRCx5QkFBeUIsRUFDekIsdUJBQXVCLEVBQ3ZCLFlBQVksQ0FDZixDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsZ0JBQWdCLENBQUMsTUFBYztJQUNwQyxPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxlQUFlLEVBQUUsYUFBYSxDQUFDLElBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1dBQ3BILFFBQVEsQ0FBQyxNQUFNLEVBQUUsdUJBQXVCLEVBQUUscUJBQXFCLENBQUM7V0FDaEUsUUFBUSxDQUFDLE1BQU0sRUFBRSx5QkFBeUIsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO0FBQ2hGLENBQUM7QUFFRCxTQUFTLHVCQUF1QixDQUFDLE1BQWMsRUFBRSxLQUFhLEVBQUUsR0FBVztJQUN2RSxPQUFPLFFBQVEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQzlELENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxNQUFjLEVBQUUsS0FBYSxFQUFFLEdBQVc7SUFDeEQsT0FBTyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3pHLENBQUM7QUFFRCxTQUFTLFNBQVMsQ0FBQyxNQUFjLEVBQUUsS0FBYSxFQUFFLEdBQVc7SUFDekQsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUN6QyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JDLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztBQUM3RCxDQUFDO0FBRUQsU0FBUyxZQUFZLENBQUMsTUFBYyxFQUFFLEtBQWEsRUFBRSxHQUFXLEVBQUUsT0FBZTtJQUM3RSxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3pDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDckMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFVBQVUsR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztBQUM5RixDQUFDO0FBRUQsS0FBSyxVQUFVLGFBQWEsQ0FBQyxHQUFXO0lBQ3BDLE1BQU0sS0FBSyxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ2hGLElBQUksQ0FBQyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxJQUFJLENBQUEsRUFBRSxDQUFDO1FBQ2YsT0FBTyxJQUFJLENBQUM7SUFDaEIsQ0FBQztJQUVELE9BQU8sSUFBQSxpQkFBWSxFQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDNUMsQ0FBQztBQUVELEtBQUssVUFBVSxVQUFVLENBQUMsR0FBVyxFQUFFLE1BQWMsRUFBRSxPQUFnQjtJQUNuRSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ1YsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN0RSxPQUFPO0lBQ1gsQ0FBQztJQUVELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLFlBQVksRUFBRSxHQUFHLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDeEUsQ0FBQztBQUVELEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxRQUFnQixFQUFFLFNBQWlCO0lBQ2pFLElBQUksTUFBTSxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUMvQyxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBRUQsSUFBSSxDQUFDO1FBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7WUFDdEQsSUFBSSxFQUFFLFFBQVE7WUFDZCxTQUFTLEVBQUUsU0FBUztTQUN2QixDQUFDLENBQUM7UUFDSCxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBQUMsT0FBTyxVQUFVLEVBQUUsQ0FBQztRQUNsQixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSwwRUFBMEUsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUN6SCxDQUFDO0lBRUQsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFbEIsSUFBSSxDQUFDO1FBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7WUFDdEQsSUFBSSxFQUFFLFFBQVE7WUFDZCxTQUFTLEVBQUUsU0FBUztTQUN2QixDQUFDLENBQUM7UUFDSCxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0lBQUMsT0FBTyxXQUFXLEVBQUUsQ0FBQztRQUNuQixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSxzQ0FBc0MsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUNsRixPQUFPLEtBQUssQ0FBQztJQUNqQixDQUFDO0FBQ0wsQ0FBQztBQUVELEtBQUssVUFBVSx1QkFBdUIsQ0FBQyxRQUFnQixFQUFFLFNBQWlCLEVBQUUsUUFBMEI7SUFDbEcsTUFBTSxhQUFhLEdBQUcsTUFBTSxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDbkUsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxZQUFZLDJCQUEyQixTQUFTLHdCQUF3QixDQUFDLENBQUM7UUFDM0YsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsaUJBQWlCLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDOUYsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBRW5CLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDMUUsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ2hCLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxZQUFZLCtCQUErQixPQUFPLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQztZQUNyRixTQUFTO1FBQ2IsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVLEtBQUssTUFBTTtZQUM1QyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVE7WUFDbEIsQ0FBQyxDQUFDLE1BQU0saUJBQWlCLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsYUFBYSxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUUvRixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDZCxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSw0QkFBNEIsT0FBTyxDQUFDLFlBQVksR0FBRyxDQUFDLENBQUM7WUFDbEYsU0FBUztRQUNiLENBQUM7UUFFRCxJQUFJLE1BQU0sb0JBQW9CLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDNUYsVUFBVSxJQUFJLENBQUMsQ0FBQztRQUNwQixDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFDO0FBQ3RCLENBQUM7QUFFRCxLQUFLLFVBQVUsaUJBQWlCLENBQUMsUUFBZ0IsRUFBRSxhQUFxQjs7SUFDcEUsTUFBTSxJQUFJLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzNFLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFFeEUsS0FBSyxNQUFNLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUNqQyxNQUFNLFlBQVksR0FBRyxTQUFnQixDQUFDO1FBQ3RDLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBQSxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsS0FBSywwQ0FBRSxJQUFJLENBQUMsSUFBSSxhQUFhLENBQUMsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3pHLE1BQU0sVUFBVSxHQUFHO1lBQ2YsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLElBQUk7WUFDbEIsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLElBQUk7WUFDbEIsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLEdBQUc7WUFDakIsTUFBQSxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsS0FBSywwQ0FBRSxJQUFJO1lBQ3pCLE1BQUEsWUFBWSxhQUFaLFlBQVksdUJBQVosWUFBWSxDQUFFLEtBQUssMENBQUUsUUFBUTtZQUM3QixNQUFBLFlBQVksYUFBWixZQUFZLHVCQUFaLFlBQVksQ0FBRSxLQUFLLDBDQUFFLEdBQUc7WUFDeEIsTUFBQSxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUUsS0FBSywwQ0FBRSxJQUFJO1NBQzVCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFakQsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ2pGLE9BQU8sSUFBSSxJQUFJLElBQUksQ0FBQztRQUN4QixDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFDO0FBQ2hCLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxhQUFrQixFQUFFLFlBQW9COztJQUM3RCxNQUFNLElBQUksR0FBRyxDQUFBLE1BQUEsYUFBYSxhQUFiLGFBQWEsdUJBQWIsYUFBYSxDQUFFLEtBQUssMENBQUcsWUFBWSxDQUFDLE1BQUksYUFBYSxhQUFiLGFBQWEsdUJBQWIsYUFBYSxDQUFHLFlBQVksQ0FBQyxDQUFBLENBQUM7SUFDbkYsT0FBTyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUMxRCxDQUFDO0FBRUQsS0FBSyxVQUFVLG9CQUFvQixDQUFDLGFBQXFCLEVBQUUsWUFBb0IsRUFBRSxZQUFpQixFQUFFLFVBQWtCO0lBQ2xILE1BQU0sVUFBVSxHQUFHLDJCQUEyQixDQUFDLFlBQVksRUFBRSxVQUFVLENBQUMsQ0FBQztJQUV6RSxLQUFLLE1BQU0sSUFBSSxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQztZQUNELE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLGNBQWMsRUFBRTtnQkFDbEQsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLElBQUksRUFBRSxZQUFZO2dCQUNsQixJQUFJO2dCQUNKLE1BQU0sRUFBRSxJQUFJO2FBQ2YsQ0FBQyxDQUFDO1lBQ0gsT0FBTyxJQUFJLENBQUM7UUFDaEIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSxvQkFBb0IsWUFBWSxxQ0FBcUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMvRyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFDO0FBQ2pCLENBQUM7QUFFRCxTQUFTLDJCQUEyQixDQUFDLFlBQWlCLEVBQUUsVUFBa0I7SUFDdEUsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFDdEQsTUFBTSxVQUFVLEdBQVUsRUFBRSxDQUFDO0lBRTdCLFVBQVUsQ0FBQyxJQUFJLGlDQUNSLElBQUksS0FDUCxLQUFLLEVBQUU7WUFDSCxJQUFJLEVBQUUsVUFBVTtTQUNuQixJQUNILENBQUM7SUFFSCxVQUFVLENBQUMsSUFBSSxpQ0FDUixJQUFJLEtBQ1AsS0FBSyxFQUFFLFVBQVUsSUFDbkIsQ0FBQztJQUVILFVBQVUsQ0FBQyxJQUFJLGlDQUNSLElBQUksS0FDUCxLQUFLLEVBQUU7WUFDSCxRQUFRLEVBQUUsVUFBVTtTQUN2QixJQUNILENBQUM7SUFFSCxJQUFJLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxJQUFJLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQy9DLFVBQVUsQ0FBQyxPQUFPLGlDQUNYLElBQUksS0FDUCxLQUFLLGtDQUNFLElBQUksQ0FBQyxLQUFLLEtBQ2IsSUFBSSxFQUFFLFVBQVUsT0FFdEIsQ0FBQztJQUNQLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQztBQUN0QixDQUFDO0FBRUQsS0FBSyxVQUFVLDZCQUE2QixDQUFDLGNBQTZCLEVBQUUsU0FBaUIsRUFBRSxRQUFnQixFQUFFLFFBQTBCOztJQUN2SSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDbEIsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQsTUFBTSxLQUFLLEdBQUcsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsa0JBQWtCLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDM0YsSUFBSSxDQUFDLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLElBQUksQ0FBQSxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ3pELE9BQU8sQ0FBQyxDQUFDO0lBQ2IsQ0FBQztJQUVELE1BQU0sR0FBRyxHQUFHLElBQUEsaUJBQVksRUFBQyxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQzdDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDN0IsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztRQUN2QixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUMvQyxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUMvQyxNQUFNLDRCQUE0QixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0lBQy9ELE1BQU0sNEJBQTRCLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7SUFFL0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUN6QixJQUFJLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsTUFBSyxTQUFTLEVBQUUsQ0FBQztZQUMvQixNQUFNLFFBQVEsR0FBRyxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxHQUFHLE1BQUksSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLEtBQUssQ0FBQSxJQUFJLEVBQUUsQ0FBQztZQUNoRCxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNYLFlBQVksQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3RDLENBQUM7WUFDRCxJQUFJLE9BQU8sQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxDQUFBLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ2xDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4QyxDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRTs7UUFDekIsTUFBTSxNQUFNLEdBQUcsTUFBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsSUFBSSwwQ0FBRSxNQUFNLENBQUM7UUFDbEMsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7UUFDNUQsTUFBTSxRQUFRLEdBQUcsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsR0FBRyxNQUFJLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxLQUFLLENBQUEsSUFBSSxFQUFFLENBQUM7UUFDaEQsTUFBTSxRQUFRLEdBQUcsQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsS0FBSyxLQUFJLEVBQUUsQ0FBQztRQUNuQyxJQUFJLE9BQU8sQ0FBQSxJQUFJLGFBQUosSUFBSSx1QkFBSixJQUFJLENBQUUsUUFBUSxDQUFBLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDckMsT0FBTztRQUNYLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ1gsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4RSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNGLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQ1gsNEJBQTRCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4RSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzNGLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRTs7UUFDdkMsSUFBSSxPQUFPLENBQUEsSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLFFBQVEsQ0FBQSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sS0FBSyxDQUFDO1FBQ2pCLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxNQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxJQUFJLDBDQUFFLE1BQU0sQ0FBQztRQUNsQyxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztRQUM1RCxNQUFNLGNBQWMsR0FBRyxDQUFBLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxLQUFLLE1BQUssUUFBUSxDQUFDO1FBQ2hELE1BQU0sb0JBQW9CLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztRQUMxSCxNQUFNLHdCQUF3QixHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUV0RyxPQUFPLElBQUksQ0FBQyxRQUFRLEtBQUssU0FBUztlQUMzQixhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLFNBQVM7ZUFDMUMsb0JBQW9CO2VBQ3BCLENBQUMsY0FBYyxJQUFJLHdCQUF3QixDQUFDLENBQUM7SUFDeEQsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDbkIsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBRW5CLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IsSUFBSSxPQUFPLENBQUMsVUFBVSxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQ2hDLE1BQU0sTUFBTSxHQUFHLE1BQUEsWUFBWSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLG1DQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3hGLElBQUksTUFBTSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUN2QixlQUFlLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxDQUFDO2dCQUMzRCxVQUFVLElBQUksQ0FBQyxDQUFDO1lBQ3BCLENBQUM7WUFDRCxTQUFTO1FBQ2IsQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQztRQUMvRCxNQUFNLFdBQVcsR0FBRyxNQUFBLE1BQUEsTUFBQSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLFFBQVEsRUFBRSxDQUFDLG1DQUNoRiw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLG1DQUNsRiw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLFFBQVEsRUFBRSxDQUFDLG1DQUNuRSw0QkFBNEIsQ0FBQyxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFMUYsSUFBSSxXQUFXLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUIsZUFBZSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQztZQUNoRSxVQUFVLElBQUksQ0FBQyxDQUFDO1FBQ3BCLENBQUM7SUFDTCxDQUFDO0lBRUQsSUFBQSxrQkFBYSxFQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN4RSxPQUFPLFVBQVUsQ0FBQztBQUN0QixDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsSUFBWTtJQUMvQixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDO0FBQ3pDLENBQUM7QUFFRCxLQUFLLFVBQVUsc0JBQXNCLENBQUMsT0FBeUIsRUFBRSxNQUFzQjtJQUNuRixJQUFJLENBQUMsTUFBTSxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFDakMsT0FBTztJQUNYLENBQUM7SUFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQztZQUNELE1BQU0sSUFBSSxHQUFHLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDbEYsSUFBSSxZQUFZLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQy9CLFNBQVM7WUFDYixDQUFDO1lBRUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxDQUFDLGFBQWEsSUFBSSxXQUFXLENBQUM7WUFDMUQsTUFBTSwyQkFBMkIsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsYUFBYSxFQUFFLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEcsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksWUFBWSwwQ0FBMEMsTUFBTSxDQUFDLFFBQVEsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3RHLENBQUM7SUFDTCxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLElBQVMsRUFBRSxhQUFxQjtJQUNsRCxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksYUFBSixJQUFJLHVCQUFKLElBQUksQ0FBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3hFLE9BQU8sVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQWMsRUFBRSxFQUFFOztRQUN0QyxNQUFNLFVBQVUsR0FBRztZQUNmLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxJQUFJO1lBQ2YsU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLElBQUk7WUFDZixTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsR0FBRztZQUNkLE1BQUEsU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLEtBQUssMENBQUUsSUFBSTtZQUN0QixNQUFBLFNBQVMsYUFBVCxTQUFTLHVCQUFULFNBQVMsQ0FBRSxLQUFLLDBDQUFFLFFBQVE7WUFDMUIsTUFBQSxTQUFTLGFBQVQsU0FBUyx1QkFBVCxTQUFTLENBQUUsS0FBSywwQ0FBRSxHQUFHO1NBQ3hCLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFakQsT0FBTyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQztJQUMxRixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLFNBQWlCLEVBQUUsYUFBcUI7SUFDbEUsTUFBTSxJQUFJLEdBQUcsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMxQyxNQUFNLFNBQVMsR0FBRyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDekQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTlELE9BQU8sSUFBSSxLQUFLLEtBQUs7V0FDZCxTQUFTLEtBQUssVUFBVTtXQUN4QixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksVUFBVSxFQUFFLENBQUM7V0FDL0IsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLFFBQWdCLEVBQUUsY0FBd0I7SUFDakYsSUFBSSxTQUFrQixDQUFDO0lBRXZCLEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ3RELElBQUksRUFBRSxRQUFRO2dCQUNkLFNBQVM7YUFDWixDQUFDLENBQUM7WUFDSCxPQUFPO1FBQ1gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixTQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ3RCLENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxTQUFTLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGlzdHNTeW5jLCByZWFkRmlsZVN5bmMsIHJlYWRkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGV4dG5hbWUsIGpvaW4sIHJlbGF0aXZlIH0gZnJvbSAncGF0aCc7XG5cbmNvbnN0IFBBQ0tBR0VfTkFNRSA9ICdiaW5kLXRvb2wnO1xuXG5jb25zdCBBVVRPX0JJTkRfU1RBUlQgPSAnLyoqKioqKioqKioqKioqKnN0c3J0KioqKioqKioqKioqKi8nO1xuY29uc3QgQVVUT19CSU5EX0VORCA9ICcvKioqKioqKioqKioqKioqKioqKioqKioqZW5kKioqKioqKioqKioqKioqLyc7XG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJUID0gJy8vIEFVVE9fQklORF9TVEFSVCc7XG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX0VORCA9ICcvLyBBVVRPX0JJTkRfRU5EJztcbmNvbnN0IEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJUID0gJy8vIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJUJztcbmNvbnN0IEFVVE9fQlVUVE9OX0VWRU5UX0VORCA9ICcvLyBBVVRPX0JVVFRPTl9FVkVOVF9FTkQnO1xuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCA9ICcvLyBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUJztcbmNvbnN0IEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EID0gJy8vIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EJztcblxudHlwZSBCaW5kVGFyZ2V0ID0gJ25vZGUnIHwgJ2NvbXBvbmVudCc7XG5cbmludGVyZmFjZSBCaW5kVG9vbENvbmZpZyB7XG4gICAgc2NyaXB0Um9vdDogc3RyaW5nO1xuICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6IGJvb2xlYW47XG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcic7XG4gICAgc3RvcFByZWZpeDogc3RyaW5nO1xuICAgIHJ1bGVzOiBCaW5kUnVsZVtdO1xufVxuXG5pbnRlcmZhY2UgQmluZFJ1bGUge1xuICAgIHByZWZpeDogc3RyaW5nO1xuICAgIGNvbXBvbmVudE5hbWU/OiBzdHJpbmc7XG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xuICAgIGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQ7XG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcbiAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGJvb2xlYW47XG4gICAgZW5hYmxlZDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFNjYW5uZWRCaW5kaW5nIHtcbiAgICBub2RlVXVpZDogc3RyaW5nO1xuICAgIG5vZGVOYW1lOiBzdHJpbmc7XG4gICAgcHJvcGVydHlOYW1lOiBzdHJpbmc7XG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xuICAgIGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQ7XG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcbiAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBCaW5kUmVzdWx0IHtcbiAgICBjbGFzc05hbWU6IHN0cmluZztcbiAgICBzY3JpcHRVcmw6IHN0cmluZztcbiAgICBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXTtcbiAgICBidXR0b25zOiBTY2FubmVkQmluZGluZ1tdO1xuICAgIGNyZWF0ZWQ6IGJvb2xlYW47XG4gICAgY29tcG9uZW50QXR0YWNoZWQ6IGJvb2xlYW47XG4gICAgcHJvcGVydGllc0JvdW5kOiBudW1iZXI7XG59XG5cbmNvbnN0IGRlZmF1bHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xuICAgIHNjcmlwdFJvb3Q6ICdhc3NldHMvc3JjJyxcbiAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiB0cnVlLFxuICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxuICAgIHN0b3BQcmVmaXg6ICdzdG9wJyxcbiAgICBydWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgICBwcmVmaXg6ICdub2RlJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ05vZGUnLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJycsXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGVfc3RvcCcsXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnTm9kZScsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdOb2RlJyxcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdOb2RlJyxcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdub2RlJyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICcnLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiB0cnVlLFxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAgIHByZWZpeDogJ3NwaW5lJyxcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdzcC5Ta2VsZXRvbicsXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnc3AuU2tlbGV0b24nLFxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnc3AuU2tlbGV0b24nLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgICBwcmVmaXg6ICdidXR0b24nLFxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0J1dHRvbicsXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdCdXR0b24nLFxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ0J1dHRvbicsXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdjYy5CdXR0b24nLFxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogdHJ1ZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgXSxcbn07XG5cbmV4cG9ydCBjb25zdCBtZXRob2RzOiB7IFtrZXk6IHN0cmluZ106ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55IH0gPSB7XG4gICAgYXN5bmMgb3BlblJ1bGVzUGFuZWwoKSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5QYW5lbC5vcGVuKGAke1BBQ0tBR0VfTkFNRX0ucnVsZXNgKTtcbiAgICB9LFxuXG4gICAgYXN5bmMgcXVlcnlDb25maWcoKSB7XG4gICAgICAgIHJldHVybiByZWFkQ29uZmlnKCk7XG4gICAgfSxcblxuICAgIGFzeW5jIHNhdmVDb25maWcoY29uZmlnOiBQYXJ0aWFsPEJpbmRUb29sQ29uZmlnPikge1xuICAgICAgICBjb25zdCBuZXh0Q29uZmlnOiBCaW5kVG9vbENvbmZpZyA9IHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRDb25maWcsXG4gICAgICAgICAgICAuLi5jb25maWcsXG4gICAgICAgICAgICBydWxlczogbm9ybWFsaXplUnVsZXMoY29uZmlnLnJ1bGVzKSxcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3NjcmlwdFJvb3QnLCBuZXh0Q29uZmlnLnNjcmlwdFJvb3QpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ2F1dG9BZGRCdXR0b25Db21wb25lbnQnLCBuZXh0Q29uZmlnLmF1dG9BZGRCdXR0b25Db21wb25lbnQpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ292ZXJ3cml0ZU1vZGUnLCBuZXh0Q29uZmlnLm92ZXJ3cml0ZU1vZGUpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3N0b3BQcmVmaXgnLCBuZXh0Q29uZmlnLnN0b3BQcmVmaXgpO1xuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3J1bGVzJywgbmV4dENvbmZpZy5ydWxlcyk7XG4gICAgICAgIHJldHVybiBuZXh0Q29uZmlnO1xuICAgIH0sXG5cbiAgICBhc3luYyByZXNldENvbmZpZygpIHtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzY3JpcHRSb290JywgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdhdXRvQWRkQnV0dG9uQ29tcG9uZW50JywgZGVmYXVsdENvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgZGVmYXVsdENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdzdG9wUHJlZml4JywgZGVmYXVsdENvbmZpZy5zdG9wUHJlZml4KTtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdydWxlcycsIGRlZmF1bHRDb25maWcucnVsZXMpO1xuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcbiAgICB9LFxuXG4gICAgYXN5bmMgYmluZFNlbGVjdGVkTm9kZSgpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGJpbmRTZWxlY3RlZE5vZGUoKTtcbiAgICAgICAgICAgIGNvbnN0IGRldGFpbCA9IFtcbiAgICAgICAgICAgICAgICBgU2NyaXB0OiAke3Jlc3VsdC5zY3JpcHRVcmx9YCxcbiAgICAgICAgICAgICAgICBgUHJvcGVydGllczogJHtyZXN1bHQuYmluZGluZ3MubGVuZ3RofWAsXG4gICAgICAgICAgICAgICAgYEJ1dHRvbiBldmVudHM6ICR7cmVzdWx0LmJ1dHRvbnMubGVuZ3RofWAsXG4gICAgICAgICAgICAgICAgcmVzdWx0LmNvbXBvbmVudEF0dGFjaGVkID8gJ0NvbXBvbmVudDogYXR0YWNoIGF0dGVtcHRlZCBzdWNjZXNzZnVsbHknIDogJ0NvbXBvbmVudDogc2NyaXB0IGdlbmVyYXRlZDsgcnVuIGFnYWluIGFmdGVyIGltcG9ydCBpZiBhdHRhY2ggaXMgbmVlZGVkJyxcbiAgICAgICAgICAgICAgICBgQm91bmQgcmVmZXJlbmNlczogJHtyZXN1bHQucHJvcGVydGllc0JvdW5kfWAsXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xuXG4gICAgICAgICAgICBFZGl0b3IuVGFzay5hZGROb3RpY2Uoe1xuICAgICAgICAgICAgICAgIHRpdGxlOiByZXN1bHQuY3JlYXRlZCA/ICdCaW5kIG5vZGUgY29tcGxldGUnIDogJ0JpbmQgbm9kZSB1cGRhdGVkJyxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBkZXRhaWwsXG4gICAgICAgICAgICAgICAgdHlwZTogJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgICAgIHNvdXJjZTogUEFDS0FHRV9OQU1FLFxuICAgICAgICAgICAgICAgIHRpbWVvdXQ6IDYwMDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbJHtQQUNLQUdFX05BTUV9XSAke21lc3NhZ2V9YCwgZXJyb3IpO1xuICAgICAgICAgICAgRWRpdG9yLlRhc2suYWRkTm90aWNlKHtcbiAgICAgICAgICAgICAgICB0aXRsZTogJ0JpbmQgbm9kZSBmYWlsZWQnLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgdHlwZTogJ2Vycm9yJyxcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcbiAgICAgICAgICAgICAgICB0aW1lb3V0OiA4MDAwLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9LFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWQoKSB7fVxuXG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCkge31cblxuYXN5bmMgZnVuY3Rpb24gYmluZFNlbGVjdGVkTm9kZSgpOiBQcm9taXNlPEJpbmRSZXN1bHQ+IHtcbiAgICBjb25zdCBzZWxlY3RlZFV1aWQgPSBFZGl0b3IuU2VsZWN0aW9uLmdldExhc3RTZWxlY3RlZCgnbm9kZScpIHx8IEVkaXRvci5TZWxlY3Rpb24uZ2V0U2VsZWN0ZWQoJ25vZGUnKVswXTtcbiAgICBpZiAoIXNlbGVjdGVkVXVpZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzZWxlY3QgYSBub2RlIGZpcnN0LicpO1xuICAgIH1cblxuICAgIGNvbnN0IHNlbGVjdGVkVHJlZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUtdHJlZScsIHNlbGVjdGVkVXVpZCk7XG4gICAgaWYgKCFzZWxlY3RlZFRyZWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgcmVhZCB0aGUgc2VsZWN0ZWQgbm9kZS4gTWFrZSBzdXJlIGEgc2NlbmUgb3IgcHJlZmFiIGlzIG9wZW4uJyk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZU5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRvQ2xhc3NOYW1lKG5vZGVOYW1lKTtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKCk7XG4gICAgY29uc3Qgb3BlbmVkQXNzZXRVcmwgPSBhd2FpdCBxdWVyeU9wZW5lZEFzc2V0VXJsKHNlbGVjdGVkVHJlZSk7XG4gICAgY29uc3Qgc2NyaXB0VXJsID0gbWFrZVNjcmlwdFVybChvcGVuZWRBc3NldFVybCwgY2xhc3NOYW1lLCBjb25maWcuc2NyaXB0Um9vdCk7XG4gICAgY29uc3Qgc2NhbiA9IHNjYW5CaW5kaW5ncyhzZWxlY3RlZFRyZWUsIGNvbmZpZyk7XG4gICAgY29uc3QgYnV0dG9ucyA9IHNjYW4uZmlsdGVyKChpdGVtKSA9PiBpdGVtLmdlbmVyYXRlQ2xpY2tFdmVudCk7XG4gICAgYXdhaXQgZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zLCBjb25maWcpO1xuICAgIGNvbnN0IHNvdXJjZSA9IHJlbmRlclNjcmlwdChjbGFzc05hbWUsIHNjYW4sIGJ1dHRvbnMpO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcmVhZEFzc2V0VGV4dChzY3JpcHRVcmwpO1xuICAgIGNvbnN0IGNhblVwZGF0ZUV4aXN0aW5nID0gZXhpc3RpbmcgPyBoYXNBbGxBdXRvQmxvY2tzKGV4aXN0aW5nKSA6IHRydWU7XG4gICAgY29uc3QgZmluYWxTb3VyY2UgPSBleGlzdGluZyA/IHVwZGF0ZU1hcmtlZFNvdXJjZShleGlzdGluZywgc291cmNlKSA6IHNvdXJjZTtcblxuICAgIGlmIChleGlzdGluZyAmJiAhY2FuVXBkYXRlRXhpc3RpbmcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTY3JpcHQgZXhpc3RzIGJ1dCBhdXRvLWdlbmVyYXRlZCBtYXJrZXJzIGFyZSBtaXNzaW5nLiBTdG9wIHRvIGF2b2lkIG92ZXJ3cml0aW5nIHVzZXIgY29kZTogJHtzY3JpcHRVcmx9YCk7XG4gICAgfVxuXG4gICAgY29uc3QgY3JlYXRlZCA9ICFleGlzdGluZztcbiAgICBhd2FpdCB3cml0ZUFzc2V0KHNjcmlwdFVybCwgZmluYWxTb3VyY2UsIGNyZWF0ZWQpO1xuICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3JlZnJlc2gtYXNzZXQnLCBzY3JpcHRVcmwpO1xuXG4gICAgY29uc3QgY29tcG9uZW50QXR0YWNoZWQgPSBhd2FpdCB0cnlBdHRhY2hDb21wb25lbnQoc2VsZWN0ZWRVdWlkLCBjbGFzc05hbWUpO1xuICAgIGxldCBwcm9wZXJ0aWVzQm91bmQgPSAwO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpO1xuICAgICAgICBwcm9wZXJ0aWVzQm91bmQgPSBhd2FpdCBiaW5kU2VyaWFsaXplZEFzc2V0UmVmZXJlbmNlcyhvcGVuZWRBc3NldFVybCwgY2xhc3NOYW1lLCBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpLCBzY2FuKTtcbiAgICAgICAgaWYgKG9wZW5lZEFzc2V0VXJsKSB7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgb3BlbmVkQXNzZXRVcmwpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gc2F2ZSB0aGUgY3VycmVudCBzY2VuZSBvciBwcmVmYWIuIFBsZWFzZSBzYXZlIG1hbnVhbGx5LmAsIGVycm9yKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgIHNjcmlwdFVybCxcbiAgICAgICAgYmluZGluZ3M6IHNjYW4sXG4gICAgICAgIGJ1dHRvbnMsXG4gICAgICAgIGNyZWF0ZWQsXG4gICAgICAgIGNvbXBvbmVudEF0dGFjaGVkLFxuICAgICAgICBwcm9wZXJ0aWVzQm91bmQsXG4gICAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZENvbmZpZygpOiBQcm9taXNlPEJpbmRUb29sQ29uZmlnPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcHJvamVjdENvbmZpZyA9IGF3YWl0IEVkaXRvci5Qcm9maWxlLmdldFByb2plY3QoUEFDS0FHRV9OQU1FKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLmRlZmF1bHRDb25maWcsXG4gICAgICAgICAgICAuLi4ocHJvamVjdENvbmZpZyB8fCB7fSksXG4gICAgICAgICAgICBydWxlczogbm9ybWFsaXplUnVsZXMocHJvamVjdENvbmZpZz8ucnVsZXMpLFxuICAgICAgICB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcbiAgICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJ1bGVzKHJ1bGVzOiB1bmtub3duKTogQmluZFJ1bGVbXSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJ1bGVzKSkge1xuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZy5ydWxlcztcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkID0gcnVsZXNcbiAgICAgICAgLmZpbHRlcigocnVsZSkgPT4gcnVsZSAmJiB0eXBlb2YgcnVsZSA9PT0gJ29iamVjdCcpXG4gICAgICAgIC5tYXAoKHJ1bGU6IGFueSkgPT4gbm9ybWFsaXplUnVsZShydWxlKSlcbiAgICAgICAgLmZpbHRlcigocnVsZSk6IHJ1bGUgaXMgQmluZFJ1bGUgPT4gQm9vbGVhbihydWxlKSk7XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZC5sZW5ndGggPiAwID8gbm9ybWFsaXplZCA6IGRlZmF1bHRDb25maWcucnVsZXM7XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJ1bGUocnVsZTogYW55KTogQmluZFJ1bGUgfCBudWxsIHtcbiAgICBjb25zdCBwcmVmaXggPSBTdHJpbmcocnVsZS5wcmVmaXggfHwgJycpLnRyaW0oKTtcbiAgICBpZiAoIXByZWZpeCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBjb21wb25lbnROYW1lID0gU3RyaW5nKHJ1bGUuY29tcG9uZW50TmFtZSB8fCBydWxlLnByb3BlcnR5VHlwZSB8fCAnTm9kZScpLnRyaW0oKTtcbiAgICBjb25zdCBwcm9wZXJ0eVR5cGUgPSBub3JtYWxpemVDb21wb25lbnROYW1lKGNvbXBvbmVudE5hbWUpO1xuICAgIGNvbnN0IGJpbmRUYXJnZXQ6IEJpbmRUYXJnZXQgPSBwcm9wZXJ0eVR5cGUgPT09ICdOb2RlJyA/ICdub2RlJyA6ICdjb21wb25lbnQnO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgcHJlZml4LFxuICAgICAgICBjb21wb25lbnROYW1lOiBwcm9wZXJ0eVR5cGUsXG4gICAgICAgIHByb3BlcnR5VHlwZSxcbiAgICAgICAgZGVjb3JhdG9yVHlwZTogcHJvcGVydHlUeXBlLFxuICAgICAgICBiaW5kVGFyZ2V0LFxuICAgICAgICBjb21wb25lbnRUeXBlOiBiaW5kVGFyZ2V0ID09PSAnY29tcG9uZW50JyA/IHRvQ29tcG9uZW50VHlwZShwcm9wZXJ0eVR5cGUpIDogJycsXG4gICAgICAgIHN0b3BDaGlsZHJlbjogQm9vbGVhbihydWxlLnN0b3BDaGlsZHJlbikgfHwgcHJlZml4ID09PSAnbm9kZV9zdG9wJyxcbiAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBpc0J1dHRvblR5cGUocHJvcGVydHlUeXBlKSxcbiAgICAgICAgZW5hYmxlZDogcnVsZS5lbmFibGVkICE9PSBmYWxzZSxcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDb21wb25lbnROYW1lKGNvbXBvbmVudE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdmFsdWUgPSBjb21wb25lbnROYW1lLnRyaW0oKTtcbiAgICBpZiAodmFsdWUgPT09ICdjYy5Ob2RlJykge1xuICAgICAgICByZXR1cm4gJ05vZGUnO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PT0gJ2NjLkJ1dHRvbicpIHtcbiAgICAgICAgcmV0dXJuICdCdXR0b24nO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnTm9kZSc7XG59XG5cbmZ1bmN0aW9uIHRvQ29tcG9uZW50VHlwZShwcm9wZXJ0eVR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgaWYgKHByb3BlcnR5VHlwZSA9PT0gJ0J1dHRvbicpIHtcbiAgICAgICAgcmV0dXJuICdjYy5CdXR0b24nO1xuICAgIH1cblxuICAgIHJldHVybiBwcm9wZXJ0eVR5cGU7XG59XG5cbmZ1bmN0aW9uIGlzQnV0dG9uVHlwZShwcm9wZXJ0eVR5cGU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwcm9wZXJ0eVR5cGUgPT09ICdCdXR0b24nIHx8IHByb3BlcnR5VHlwZSA9PT0gJ2NjLkJ1dHRvbic7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHF1ZXJ5T3BlbmVkQXNzZXRVcmwoc2VsZWN0ZWRUcmVlOiBhbnkpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzYXZlZElkID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpO1xuICAgICAgICBpZiAoIXNhdmVkSWQpIHtcbiAgICAgICAgICAgIHJldHVybiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhc3NldCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ3F1ZXJ5LWFzc2V0LWluZm8nLCBzYXZlZElkKTtcbiAgICAgICAgcmV0dXJuIGFzc2V0Py51cmwgfHwgYXNzZXQ/LnNvdXJjZSB8fCBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZSk7XG4gICAgfVxufVxuXG5mdW5jdGlvbiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlKHNlbGVjdGVkVHJlZTogYW55KTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgYXNzZXRzRGlyID0gam9pbihFZGl0b3IuUHJvamVjdC5wYXRoLCAnYXNzZXRzJyk7XG4gICAgaWYgKCFleGlzdHNTeW5jKGFzc2V0c0RpcikpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgY29uc3Qgcm9vdE5hbWUgPSBnZXROb2RlTmFtZShzZWxlY3RlZFRyZWUpO1xuICAgIGNvbnN0IGNoaWxkTmFtZXMgPSBuZXcgU2V0KGdldENoaWxkcmVuKHNlbGVjdGVkVHJlZSkubWFwKGdldE5vZGVOYW1lKSk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGxpc3RBc3NldEZpbGVzKGFzc2V0c0RpciwgWycucHJlZmFiJywgJy5zY2VuZSddKTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMoZmlsZSwgJ3V0ZjgnKSk7XG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3Qgbm9kZXMgPSBkYXRhLmZpbHRlcigoaXRlbSkgPT4gaXRlbT8uX190eXBlX18gPT09ICdjYy5Ob2RlJyk7XG4gICAgICAgICAgICBjb25zdCBoYXNSb290ID0gbm9kZXMuc29tZSgobm9kZSkgPT4gbm9kZT8uX25hbWUgPT09IHJvb3ROYW1lKTtcbiAgICAgICAgICAgIGlmICghaGFzUm9vdCkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBub2RlTmFtZXMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobm9kZSkgPT4gbm9kZT8uX25hbWUpLmZpbHRlcihCb29sZWFuKSk7XG4gICAgICAgICAgICBjb25zdCBjaGlsZE1hdGNoQ291bnQgPSBbLi4uY2hpbGROYW1lc10uZmlsdGVyKChuYW1lKSA9PiBub2RlTmFtZXMuaGFzKG5hbWUpKS5sZW5ndGg7XG4gICAgICAgICAgICBpZiAoY2hpbGROYW1lcy5zaXplID09PSAwIHx8IGNoaWxkTWF0Y2hDb3VudCA+IDAgfHwgYmFzZW5hbWUoZmlsZSwgZXh0bmFtZShmaWxlKSkgPT09IHJvb3ROYW1lKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYXNzZXRSZWxhdGl2ZSA9IHJlbGF0aXZlKEVkaXRvci5Qcm9qZWN0LnBhdGgsIGZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYGRiOi8vJHthc3NldFJlbGF0aXZlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBpbnNwZWN0IGFzc2V0ICR7ZmlsZX0uYCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGxpc3RBc3NldEZpbGVzKGRpcjogc3RyaW5nLCBleHRlbnNpb25zOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlYWRkaXJTeW5jKGRpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xuICAgICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgICAgcmVzdWx0LnB1c2goLi4ubGlzdEFzc2V0RmlsZXMoZnVsbFBhdGgsIGV4dGVuc2lvbnMpKTtcbiAgICAgICAgfSBlbHNlIGlmIChleHRlbnNpb25zLmluY2x1ZGVzKGV4dG5hbWUoZW50cnkubmFtZSkudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIG1ha2VTY3JpcHRVcmwob3BlbmVkQXNzZXRVcmw6IHN0cmluZyB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRSb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRSb290ID0gbm9ybWFsaXplQXNzZXRQYXRoKHNjcmlwdFJvb3QgfHwgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBjb25zdCByb290U2NyaXB0VXJsID0gYGRiOi8vJHtub3JtYWxpemVkUm9vdH0vJHtjbGFzc05hbWV9LnRzYDtcbiAgICBpZiAoYXNzZXRVcmxFeGlzdHMocm9vdFNjcmlwdFVybCkpIHtcbiAgICAgICAgcmV0dXJuIHJvb3RTY3JpcHRVcmw7XG4gICAgfVxuXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xuICAgICAgICByZXR1cm4gcm9vdFNjcmlwdFVybDtcbiAgICB9XG5cbiAgICBjb25zdCBhc3NldFBhdGggPSBvcGVuZWRBc3NldFVybFxuICAgICAgICAucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKVxuICAgICAgICAucmVwbGFjZSgvXFwuKHByZWZhYnxzY2VuZSkkL2ksICcnKVxuICAgICAgICAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gYXNzZXRQYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cy8nKVxuICAgICAgICA/IGFzc2V0UGF0aC5zbGljZSgnYXNzZXRzLycubGVuZ3RoKVxuICAgICAgICA6IGFzc2V0UGF0aC5yZXBsYWNlKC9eLio/YXNzZXRzXFwvLywgJycpO1xuICAgIGNvbnN0IGRpciA9IHJlbGF0aXZlUGF0aC5pbmNsdWRlcygnLycpID8gcmVsYXRpdmVQYXRoLnNsaWNlKDAsIHJlbGF0aXZlUGF0aC5sYXN0SW5kZXhPZignLycpKSA6ICcnO1xuXG4gICAgcmV0dXJuIGBkYjovLyR7bm9ybWFsaXplZFJvb3R9JHtkaXIgPyBgLyR7ZGlyfWAgOiAnJ30vJHtjbGFzc05hbWV9LnRzYDtcbn1cblxuZnVuY3Rpb24gYXNzZXRVcmxFeGlzdHModXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB1cmwucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKS5yZXBsYWNlKC9cXC8vZywgJ1xcXFwnKTtcbiAgICByZXR1cm4gZXhpc3RzU3luYyhqb2luKEVkaXRvci5Qcm9qZWN0LnBhdGgsIHJlbGF0aXZlUGF0aCkpO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVBc3NldFBhdGgodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF0aCA9IHZhbHVlLnJlcGxhY2UoL1xcXFwvZywgJy8nKS5yZXBsYWNlKC9eZGI6XFwvXFwvLywgJycpLnJlcGxhY2UoL15cXC8rLywgJycpO1xuICAgIHJldHVybiBwYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cycpID8gcGF0aCA6IGBhc3NldHMvJHtwYXRofWA7XG59XG5cbmZ1bmN0aW9uIHNjYW5CaW5kaW5ncyhyb290OiBhbnksIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBTY2FubmVkQmluZGluZ1tdIHtcbiAgICBjb25zdCB1c2VkTmFtZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdID0gW107XG4gICAgY29uc3QgcnVsZXMgPSBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKTtcblxuICAgIGNvbnN0IHZpc2l0ID0gKG5vZGU6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xuICAgICAgICBjb25zdCBsb3dlck5hbWUgPSBub2RlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmIChsb3dlck5hbWUuc3RhcnRzV2l0aChjb25maWcuc3RvcFByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcobm9kZSwgcnVsZXMsIHVzZWROYW1lcyk7XG4gICAgICAgIGlmIChiaW5kaW5nKSB7XG4gICAgICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJpbmRpbmc/LnN0b3BDaGlsZHJlbikge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBnZXRDaGlsZHJlbihub2RlKSkge1xuICAgICAgICAgICAgdmlzaXQoY2hpbGQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZpc2l0KHJvb3QpO1xuICAgIHJldHVybiBiaW5kaW5ncztcbn1cblxuZnVuY3Rpb24gZ2V0U29ydGVkRW5hYmxlZFJ1bGVzKGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBCaW5kUnVsZVtdIHtcbiAgICByZXR1cm4gY29uZmlnLnJ1bGVzXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZCAmJiBydWxlLnByZWZpeClcbiAgICAgICAgLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiByaWdodC5wcmVmaXgubGVuZ3RoIC0gbGVmdC5wcmVmaXgubGVuZ3RoKTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlQmluZGluZyhub2RlOiBhbnksIHJ1bGVzOiBCaW5kUnVsZVtdLCB1c2VkTmFtZXM6IE1hcDxzdHJpbmcsIG51bWJlcj4pOiBTY2FubmVkQmluZGluZyB8IG51bGwge1xuICAgIGNvbnN0IG5vZGVOYW1lID0gZ2V0Tm9kZU5hbWUobm9kZSk7XG4gICAgY29uc3QgbG93ZXJOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBydWxlID0gcnVsZXMuZmluZCgoaXRlbSkgPT4gbG93ZXJOYW1lLnN0YXJ0c1dpdGgoaXRlbS5wcmVmaXgudG9Mb3dlckNhc2UoKSkpO1xuXG4gICAgaWYgKCFydWxlKSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIG5vZGVVdWlkOiBnZXRVdWlkKG5vZGUpLFxuICAgICAgICBub2RlTmFtZSxcbiAgICAgICAgcHJvcGVydHlOYW1lOiBtYWtlVW5pcXVlTmFtZSh0b1Byb3BlcnR5TmFtZShub2RlTmFtZSksIHVzZWROYW1lcyksXG4gICAgICAgIHByb3BlcnR5VHlwZTogcnVsZS5wcm9wZXJ0eVR5cGUsXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHJ1bGUuZGVjb3JhdG9yVHlwZSxcbiAgICAgICAgYmluZFRhcmdldDogcnVsZS5iaW5kVGFyZ2V0LFxuICAgICAgICBjb21wb25lbnRUeXBlOiBydWxlLmNvbXBvbmVudFR5cGUsXG4gICAgICAgIHN0b3BDaGlsZHJlbjogcnVsZS5zdG9wQ2hpbGRyZW4sXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogcnVsZS5nZW5lcmF0ZUNsaWNrRXZlbnQsXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0Tm9kZU5hbWUobm9kZTogYW55KTogc3RyaW5nIHtcbiAgICByZXR1cm4gU3RyaW5nKHJlYWREdW1wVmFsdWUobm9kZT8ubmFtZSkgfHwgJ05vZGUnKTtcbn1cblxuZnVuY3Rpb24gZ2V0VXVpZChub2RlOiBhbnkpOiBzdHJpbmcge1xuICAgIHJldHVybiBTdHJpbmcocmVhZER1bXBWYWx1ZShub2RlPy51dWlkKSB8fCBub2RlPy51dWlkIHx8ICcnKTtcbn1cblxuZnVuY3Rpb24gZ2V0Q2hpbGRyZW4obm9kZTogYW55KTogYW55W10ge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KG5vZGU/LmNoaWxkcmVuKSA/IG5vZGUuY2hpbGRyZW4gOiBbXTtcbn1cblxuZnVuY3Rpb24gcmVhZER1bXBWYWx1ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAndmFsdWUnIGluIHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS52YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG5mdW5jdGlvbiB0b0NsYXNzTmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBuYW1lID0gdG9Qcm9wZXJ0eU5hbWUodmFsdWUpO1xuICAgIHJldHVybiB1cHBlckZpcnN0KG5hbWUucmVwbGFjZSgvXl8rLywgJycpIHx8ICdBdXRvQmluZENvbXBvbmVudCcpO1xufVxuXG5mdW5jdGlvbiB0b1Byb3BlcnR5TmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVcbiAgICAgICAgLnRyaW0oKVxuICAgICAgICAucmVwbGFjZSgvW15cXHB7SURfU3RhcnR9XFxwe0lEX0NvbnRpbnVlfSRfXFx1MjAwQ1xcdTIwMERdKy9ndSwgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXysvZywgJ18nKVxuICAgICAgICAucmVwbGFjZSgvXl8rfF8rJC9nLCAnJyk7XG5cbiAgICBjb25zdCBjbGVhbmVkID0gbm9ybWFsaXplZFxuICAgICAgICAuc3BsaXQoJycpXG4gICAgICAgIC5maWx0ZXIoKGNoYXIsIGluZGV4KSA9PiBpbmRleCA9PT0gMCA/IGlzSWRlbnRpZmllclN0YXJ0KGNoYXIpIDogaXNJZGVudGlmaWVyQ29udGludWUoY2hhcikpXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgIGlmICghY2xlYW5lZCkge1xuICAgICAgICByZXR1cm4gJ25vZGUnO1xuICAgIH1cblxuICAgIHJldHVybiBpc0lkZW50aWZpZXJTdGFydChjbGVhbmVkWzBdKSA/IGNsZWFuZWQgOiBgXyR7Y2xlYW5lZH1gO1xufVxuXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJTdGFydChjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gL1skX1xccHtJRF9TdGFydH1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gaXNJZGVudGlmaWVyQ29udGludWUoY2hhcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIC9bJF9cXHUyMDBDXFx1MjAwRFxccHtJRF9Db250aW51ZX1dL3UudGVzdChjaGFyKTtcbn1cblxuZnVuY3Rpb24gbWFrZVVuaXF1ZU5hbWUoYmFzZU5hbWU6IHN0cmluZywgdXNlZE5hbWVzOiBNYXA8c3RyaW5nLCBudW1iZXI+KTogc3RyaW5nIHtcbiAgICBjb25zdCBjb3VudCA9IHVzZWROYW1lcy5nZXQoYmFzZU5hbWUpIHx8IDA7XG4gICAgdXNlZE5hbWVzLnNldChiYXNlTmFtZSwgY291bnQgKyAxKTtcbiAgICByZXR1cm4gY291bnQgPT09IDAgPyBiYXNlTmFtZSA6IGAke2Jhc2VOYW1lfSR7Y291bnQgKyAxfWA7XG59XG5cbmZ1bmN0aW9uIHVwcGVyRmlyc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHZhbHVlID8gdmFsdWVbMF0udG9VcHBlckNhc2UoKSArIHZhbHVlLnNsaWNlKDEpIDogdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNjcmlwdChjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBgaW1wb3J0IHsgJHtyZW5kZXJDY0ltcG9ydHMoYmluZGluZ3MpfSB9IGZyb20gJ2NjJztcblxuY29uc3QgeyBjY2NsYXNzLCBwcm9wZXJ0eSB9ID0gX2RlY29yYXRvcjtcblxuQGNjY2xhc3MoJyR7Y2xhc3NOYW1lfScpXG5leHBvcnQgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgQ29tcG9uZW50IHtcblxuICAgICR7QVVUT19CSU5EX1NUQVJUfVxuJHtyZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzKX1cbiAgICAke0FVVE9fQklORF9FTkR9XG5cbiAgICBwcm90ZWN0ZWQgb25Mb2FkKCk6IHZvaWQge1xuICAgICAgICB0aGlzLmJpbmRCdXR0b25FdmVudHMoKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGJpbmRCdXR0b25FdmVudHMoKTogdm9pZCB7XG4gICAgICAgICR7QVVUT19CVVRUT05fRVZFTlRfU1RBUlR9XG4ke3JlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zKX1cbiAgICAgICAgJHtBVVRPX0JVVFRPTl9FVkVOVF9FTkR9XG4gICAgfVxuXG4gICAgJHtBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUfVxuJHtyZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zKX1cbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfRU5EfVxufVxuYDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyQ2NJbXBvcnRzKGJpbmRpbmdzOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcbiAgICBjb25zdCBpbXBvcnRzID0gbmV3IFNldChbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50J10pO1xuXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLmRlY29yYXRvclR5cGUpO1xuICAgIH1cblxuICAgIGlmIChiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBiaW5kaW5nLmdlbmVyYXRlQ2xpY2tFdmVudCkpIHtcbiAgICAgICAgaW1wb3J0cy5hZGQoJ0J1dHRvbicpO1xuICAgIH1cblxuICAgIHJldHVybiBbLi4uaW1wb3J0c10uc29ydCgobGVmdCwgcmlnaHQpID0+IHtcbiAgICAgICAgY29uc3Qgb3JkZXIgPSBbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50JywgJ05vZGUnLCAnQnV0dG9uJywgJ3NwJ107XG4gICAgICAgIGNvbnN0IGxlZnRJbmRleCA9IG9yZGVyLmluZGV4T2YobGVmdCk7XG4gICAgICAgIGNvbnN0IHJpZ2h0SW5kZXggPSBvcmRlci5pbmRleE9mKHJpZ2h0KTtcbiAgICAgICAgaWYgKGxlZnRJbmRleCAhPT0gLTEgfHwgcmlnaHRJbmRleCAhPT0gLTEpIHtcbiAgICAgICAgICAgIHJldHVybiAobGVmdEluZGV4ID09PSAtMSA/IDk5IDogbGVmdEluZGV4KSAtIChyaWdodEluZGV4ID09PSAtMSA/IDk5IDogcmlnaHRJbmRleCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbGVmdC5sb2NhbGVDb21wYXJlKHJpZ2h0KTtcbiAgICB9KS5qb2luKCcsICcpO1xufVxuXG5mdW5jdGlvbiBjb2xsZWN0SW1wb3J0RnJvbVR5cGUoaW1wb3J0czogU2V0PHN0cmluZz4sIHR5cGVOYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBmaXJzdFBhcnQgPSB0eXBlTmFtZS50cmltKCkuc3BsaXQoJy4nKVswXTtcbiAgICBpZiAoL15bQS1aYS16XyRdW0EtWmEtejAtOV8kXSokLy50ZXN0KGZpcnN0UGFydCkpIHtcbiAgICAgICAgaW1wb3J0cy5hZGQoZmlyc3RQYXJ0KTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHJlbmRlclByb3BlcnRpZXMoYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xuICAgIHJldHVybiBiaW5kaW5ncy5tYXAoKGJpbmRpbmcpID0+IGAgICAgQHByb3BlcnR5KCR7YmluZGluZy5kZWNvcmF0b3JUeXBlfSlcbiAgICBwdWJsaWMgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX06ICR7YmluZGluZy5wcm9wZXJ0eVR5cGV9IHwgbnVsbCA9IG51bGw7YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYnV0dG9ucy5tYXAoKGJ1dHRvbikgPT4gYCAgICAgICAgaWYgKHRoaXMuJHtidXR0b24ucHJvcGVydHlOYW1lfSkge1xuICAgICAgICAgICAgdGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9Lm5vZGUub24oQnV0dG9uLkV2ZW50VHlwZS5DTElDSywgdGhpcy4ke2dldENsaWNrSGFuZGxlck5hbWUoYnV0dG9uLnByb3BlcnR5TmFtZSl9LCB0aGlzKTtcbiAgICAgICAgfWApLmpvaW4oJ1xcblxcbicpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYnV0dG9ucy5tYXAoKGJ1dHRvbikgPT4gYCAgICBwcml2YXRlICR7Z2V0Q2xpY2tIYW5kbGVyTmFtZShidXR0b24ucHJvcGVydHlOYW1lKX0oKTogdm9pZCB7XG5cbiAgICB9YCkuam9pbignXFxuXFxuJyk7XG59XG5cbmZ1bmN0aW9uIGdldENsaWNrSGFuZGxlck5hbWUocHJvcGVydHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBgb25DbGljayR7dXBwZXJGaXJzdChwcm9wZXJ0eU5hbWUucmVwbGFjZSgvXmJ1dHRvbl8/LywgJ0J1dHRvbl8nKSl9YDtcbn1cblxuZnVuY3Rpb24gdXBkYXRlTWFya2VkU291cmNlKGV4aXN0aW5nOiBzdHJpbmcsIGdlbmVyYXRlZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBiaW5kQmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpO1xuICAgIGNvbnN0IGV2ZW50QmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCwgQVVUT19CVVRUT05fRVZFTlRfRU5EKTtcbiAgICBjb25zdCBoYW5kbGVyQmxvY2sgPSBwaWNrQmxvY2soZ2VuZXJhdGVkLCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCk7XG5cbiAgICBpZiAoIWhhc0FsbEF1dG9CbG9ja3MoZXhpc3RpbmcpKSB7XG4gICAgICAgIHJldHVybiBleGlzdGluZztcbiAgICB9XG5cbiAgICBjb25zdCBiaW5kTWFya2VycyA9IGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKGV4aXN0aW5nLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpXG4gICAgICAgIHx8IGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKGV4aXN0aW5nLCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJULCBMRUdBQ1lfQVVUT19CSU5EX0VORClcbiAgICAgICAgfHwgKFtBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkRdIGFzIGNvbnN0KTtcblxuICAgIGxldCB1cGRhdGVkID0gcmVwbGFjZUJsb2NrKGV4aXN0aW5nLCBiaW5kTWFya2Vyc1swXSwgYmluZE1hcmtlcnNbMV0sIGJpbmRCbG9jayk7XG4gICAgdXBkYXRlZCA9IHVwZGF0ZWQucmVwbGFjZShiaW5kTWFya2Vyc1swXSwgQVVUT19CSU5EX1NUQVJUKS5yZXBsYWNlKGJpbmRNYXJrZXJzWzFdLCBBVVRPX0JJTkRfRU5EKTtcblxuICAgIHJldHVybiByZXBsYWNlQmxvY2soXG4gICAgICAgIHJlcGxhY2VCbG9jayhcbiAgICAgICAgICAgIHVwZGF0ZWQsXG4gICAgICAgICAgICBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCxcbiAgICAgICAgICAgIEFVVE9fQlVUVE9OX0VWRU5UX0VORCxcbiAgICAgICAgICAgIGV2ZW50QmxvY2ssXG4gICAgICAgICksXG4gICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsXG4gICAgICAgIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5ELFxuICAgICAgICBoYW5kbGVyQmxvY2ssXG4gICAgKTtcbn1cblxuZnVuY3Rpb24gaGFzQWxsQXV0b0Jsb2Nrcyhzb3VyY2U6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAoaGFzQmxvY2soc291cmNlLCBBVVRPX0JJTkRfU1RBUlQsIEFVVE9fQklORF9FTkQpIHx8IGhhc0Jsb2NrKHNvdXJjZSwgTEVHQUNZX0FVVE9fQklORF9TVEFSVCwgTEVHQUNZX0FVVE9fQklORF9FTkQpKVxuICAgICAgICAmJiBoYXNCbG9jayhzb3VyY2UsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpXG4gICAgICAgICYmIGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCwgQVVUT19CVVRUT05fSEFORExFUl9FTkQpO1xufVxuXG5mdW5jdGlvbiBnZXRFeGlzdGluZ0Jsb2NrTWFya2Vycyhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiByZWFkb25seSBbc3RyaW5nLCBzdHJpbmddIHwgbnVsbCB7XG4gICAgcmV0dXJuIGhhc0Jsb2NrKHNvdXJjZSwgc3RhcnQsIGVuZCkgPyBbc3RhcnQsIGVuZF0gOiBudWxsO1xufVxuXG5mdW5jdGlvbiBoYXNCbG9jayhzb3VyY2U6IHN0cmluZywgc3RhcnQ6IHN0cmluZywgZW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gc291cmNlLmluY2x1ZGVzKHN0YXJ0KSAmJiBzb3VyY2UuaW5jbHVkZXMoZW5kKSAmJiBzb3VyY2UuaW5kZXhPZihzdGFydCkgPCBzb3VyY2UuaW5kZXhPZihlbmQpO1xufVxuXG5mdW5jdGlvbiBwaWNrQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gc291cmNlLmluZGV4T2Yoc3RhcnQpO1xuICAgIGNvbnN0IGVuZEluZGV4ID0gc291cmNlLmluZGV4T2YoZW5kKTtcbiAgICByZXR1cm4gc291cmNlLnNsaWNlKHN0YXJ0SW5kZXggKyBzdGFydC5sZW5ndGgsIGVuZEluZGV4KTtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZUJsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gc291cmNlLmluZGV4T2Yoc3RhcnQpO1xuICAgIGNvbnN0IGVuZEluZGV4ID0gc291cmNlLmluZGV4T2YoZW5kKTtcbiAgICByZXR1cm4gYCR7c291cmNlLnNsaWNlKDAsIHN0YXJ0SW5kZXggKyBzdGFydC5sZW5ndGgpfSR7Y29udGVudH0ke3NvdXJjZS5zbGljZShlbmRJbmRleCl9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZEFzc2V0VGV4dCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAncXVlcnktYXNzZXQtaW5mbycsIHVybCk7XG4gICAgaWYgKCFhc3NldD8uZmlsZSkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFzc2V0LmZpbGUsICd1dGY4Jyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlQXNzZXQodXJsOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBjcmVhdGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNyZWF0ZWQpIHtcbiAgICAgICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnY3JlYXRlLWFzc2V0JywgdXJsLCBzb3VyY2UpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldCcsIHVybCwgc291cmNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdHJ5QXR0YWNoQ29tcG9uZW50KG5vZGVVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGF3YWl0IGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkLCBjbGFzc05hbWUpKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XG4gICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudDogY2xhc3NOYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZmlyc3RFcnJvcikge1xuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZpcnN0IGNvbXBvbmVudCBhdHRhY2ggZmFpbGVkLiBXYWl0aW5nIGZvciBzY3JpcHQgaW1wb3J0IGJlZm9yZSByZXRyeS5gLCBmaXJzdEVycm9yKTtcbiAgICB9XG5cbiAgICBhd2FpdCBkZWxheSgxMDAwKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XG4gICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcbiAgICAgICAgICAgIGNvbXBvbmVudDogY2xhc3NOYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoc2Vjb25kRXJyb3IpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBBdXRvbWF0aWMgY29tcG9uZW50IGF0dGFjaCBmYWlsZWQuYCwgc2Vjb25kRXJyb3IpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBiaW5kQ29tcG9uZW50UHJvcGVydGllcyhub2RlVXVpZDogc3RyaW5nLCBjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGNvbXBvbmVudFV1aWQgPSBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgY2xhc3NOYW1lKTtcbiAgICBpZiAoIWNvbXBvbmVudFV1aWQpIHtcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCBjb21wb25lbnQgJHtjbGFzc05hbWV9IGZvciBwcm9wZXJ0eSBiaW5kaW5nLmApO1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBjb25zdCBjb21wb25lbnREdW1wID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktY29tcG9uZW50JywgY29tcG9uZW50VXVpZCk7XG4gICAgbGV0IGJvdW5kQ291bnQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGNvbnN0IHByb3BlcnR5RHVtcCA9IGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wLCBiaW5kaW5nLnByb3BlcnR5TmFtZSk7XG4gICAgICAgIGlmICghcHJvcGVydHlEdW1wKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIHByb3BlcnR5IGR1bXAgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX0uYCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRhcmdldFV1aWQgPSBiaW5kaW5nLmJpbmRUYXJnZXQgPT09ICdub2RlJ1xuICAgICAgICAgICAgPyBiaW5kaW5nLm5vZGVVdWlkXG4gICAgICAgICAgICA6IGF3YWl0IGZpbmRDb21wb25lbnRVdWlkKGJpbmRpbmcubm9kZVV1aWQsIGJpbmRpbmcuY29tcG9uZW50VHlwZSB8fCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XG5cbiAgICAgICAgaWYgKCF0YXJnZXRVdWlkKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIHRhcmdldCBmb3IgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX0uYCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhd2FpdCBzZXRSZWZlcmVuY2VQcm9wZXJ0eShjb21wb25lbnRVdWlkLCBiaW5kaW5nLnByb3BlcnR5TmFtZSwgcHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKSkge1xuICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGJvdW5kQ291bnQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGNvbnN0IG5vZGUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlJywgbm9kZVV1aWQpO1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xuXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xuICAgICAgICBjb25zdCBjb21wb25lbnRBbnkgPSBjb21wb25lbnQgYXMgYW55O1xuICAgICAgICBjb25zdCB1dWlkID0gU3RyaW5nKHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py52YWx1ZT8udXVpZCkgfHwgcmVhZER1bXBWYWx1ZShjb21wb25lbnRBbnk/LnV1aWQpIHx8ICcnKTtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udHlwZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8udmFsdWU/Ll9fdHlwZV9fLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8udHlwZSxcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xuXG4gICAgICAgIGlmIChjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlLCBjb21wb25lbnROYW1lKSkpIHtcbiAgICAgICAgICAgIHJldHVybiB1dWlkIHx8IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gZ2V0UHJvcGVydHlEdW1wKGNvbXBvbmVudER1bXA6IGFueSwgcHJvcGVydHlOYW1lOiBzdHJpbmcpOiBhbnkgfCBudWxsIHtcbiAgICBjb25zdCBkdW1wID0gY29tcG9uZW50RHVtcD8udmFsdWU/Lltwcm9wZXJ0eU5hbWVdIHx8IGNvbXBvbmVudER1bXA/Lltwcm9wZXJ0eU5hbWVdO1xuICAgIHJldHVybiBkdW1wICYmIHR5cGVvZiBkdW1wID09PSAnb2JqZWN0JyA/IGR1bXAgOiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZXRSZWZlcmVuY2VQcm9wZXJ0eShjb21wb25lbnRVdWlkOiBzdHJpbmcsIHByb3BlcnR5TmFtZTogc3RyaW5nLCBwcm9wZXJ0eUR1bXA6IGFueSwgdGFyZ2V0VXVpZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IG1ha2VSZWZlcmVuY2VEdW1wQ2FuZGlkYXRlcyhwcm9wZXJ0eUR1bXAsIHRhcmdldFV1aWQpO1xuXG4gICAgZm9yIChjb25zdCBkdW1wIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NldC1wcm9wZXJ0eScsIHtcbiAgICAgICAgICAgICAgICB1dWlkOiBjb21wb25lbnRVdWlkLFxuICAgICAgICAgICAgICAgIHBhdGg6IHByb3BlcnR5TmFtZSxcbiAgICAgICAgICAgICAgICBkdW1wLFxuICAgICAgICAgICAgICAgIHJlY29yZDogdHJ1ZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBiaW5kICR7cHJvcGVydHlOYW1lfSB3aXRoIG9uZSByZWZlcmVuY2UgZHVtcCBjYW5kaWRhdGUuYCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IGFueVtdIHtcbiAgICBjb25zdCBiYXNlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShwcm9wZXJ0eUR1bXApKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzOiBhbnlbXSA9IFtdO1xuXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcbiAgICAgICAgLi4uYmFzZSxcbiAgICAgICAgdmFsdWU6IHtcbiAgICAgICAgICAgIHV1aWQ6IHRhcmdldFV1aWQsXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjYW5kaWRhdGVzLnB1c2goe1xuICAgICAgICAuLi5iYXNlLFxuICAgICAgICB2YWx1ZTogdGFyZ2V0VXVpZCxcbiAgICB9KTtcblxuICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgIC4uLmJhc2UsXG4gICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgICBfX3V1aWRfXzogdGFyZ2V0VXVpZCxcbiAgICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmIChiYXNlLnZhbHVlICYmIHR5cGVvZiBiYXNlLnZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgICBjYW5kaWRhdGVzLnVuc2hpZnQoe1xuICAgICAgICAgICAgLi4uYmFzZSxcbiAgICAgICAgICAgIHZhbHVlOiB7XG4gICAgICAgICAgICAgICAgLi4uYmFzZS52YWx1ZSxcbiAgICAgICAgICAgICAgICB1dWlkOiB0YXJnZXRVdWlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGJpbmRTZXJpYWxpemVkQXNzZXRSZWZlcmVuY2VzKG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZywgcm9vdE5hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGlmICghb3BlbmVkQXNzZXRVcmwpIHtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgb3BlbmVkQXNzZXRVcmwpO1xuICAgIGlmICghYXNzZXQ/LmZpbGUgfHwgIS9cXC4ocHJlZmFifHNjZW5lKSQvaS50ZXN0KGFzc2V0LmZpbGUpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IHJhdyA9IHJlYWRGaWxlU3luYyhhc3NldC5maWxlLCAndXRmOCcpO1xuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJhdyk7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEpKSB7XG4gICAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIGNvbnN0IG5vZGVJZEJ5VXVpZCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgY29uc3Qgbm9kZUlkQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcblxuICAgIGRhdGEuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKGl0ZW0/Ll9fdHlwZV9fID09PSAnY2MuTm9kZScpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vZGVVdWlkID0gaXRlbT8uX2lkIHx8IGl0ZW0/Ll91dWlkIHx8ICcnO1xuICAgICAgICAgICAgaWYgKG5vZGVVdWlkKSB7XG4gICAgICAgICAgICAgICAgbm9kZUlkQnlVdWlkLnNldChub2RlVXVpZCwgaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fbmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBub2RlSWRCeU5hbWUuc2V0KGl0ZW0uX25hbWUsIGluZGV4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XG4gICAgICAgIGNvbnN0IG5vZGUgPSBOdW1iZXIuaXNJbnRlZ2VyKG5vZGVJZCkgPyBkYXRhW25vZGVJZF0gOiBudWxsO1xuICAgICAgICBjb25zdCBub2RlVXVpZCA9IG5vZGU/Ll9pZCB8fCBub2RlPy5fdXVpZCB8fCAnJztcbiAgICAgICAgY29uc3Qgbm9kZU5hbWUgPSBub2RlPy5fbmFtZSB8fCAnJztcbiAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fX3R5cGVfXyAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlVXVpZCkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5zZXQoYCR7bm9kZVV1aWR9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLnNldChgJHtub2RlVXVpZH06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChub2RlTmFtZSkge1xuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5zZXQoYCR7bm9kZU5hbWV9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLnNldChgJHtub2RlTmFtZX06JHtzaG9ydFR5cGVOYW1lKGl0ZW0uX190eXBlX18pfWAsIGluZGV4KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgdGFyZ2V0Q29tcG9uZW50ID0gZGF0YS5maW5kKChpdGVtKSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgaXRlbT8uX190eXBlX18gIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XG4gICAgICAgIGNvbnN0IG5vZGUgPSBOdW1iZXIuaXNJbnRlZ2VyKG5vZGVJZCkgPyBkYXRhW25vZGVJZF0gOiBudWxsO1xuICAgICAgICBjb25zdCBhdHRhY2hlZFRvUm9vdCA9IG5vZGU/Ll9uYW1lID09PSByb290TmFtZTtcbiAgICAgICAgY29uc3QgaGFzR2VuZXJhdGVkUHJvcGVydHkgPSBiaW5kaW5ncy5zb21lKChiaW5kaW5nKSA9PiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaXRlbSwgYmluZGluZy5wcm9wZXJ0eU5hbWUpKTtcbiAgICAgICAgY29uc3QgbG9va3NMaWtlU2NyaXB0Q29tcG9uZW50ID0gIWl0ZW0uX190eXBlX18uc3RhcnRzV2l0aCgnY2MuJykgJiYgIWl0ZW0uX190eXBlX18uc3RhcnRzV2l0aCgnc3AuJyk7XG5cbiAgICAgICAgcmV0dXJuIGl0ZW0uX190eXBlX18gPT09IGNsYXNzTmFtZVxuICAgICAgICAgICAgfHwgc2hvcnRUeXBlTmFtZShpdGVtLl9fdHlwZV9fKSA9PT0gY2xhc3NOYW1lXG4gICAgICAgICAgICB8fCBoYXNHZW5lcmF0ZWRQcm9wZXJ0eVxuICAgICAgICAgICAgfHwgKGF0dGFjaGVkVG9Sb290ICYmIGxvb2tzTGlrZVNjcmlwdENvbXBvbmVudCk7XG4gICAgfSk7XG5cbiAgICBpZiAoIXRhcmdldENvbXBvbmVudCkge1xuICAgICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgYmluZGluZ3MpIHtcbiAgICAgICAgaWYgKGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnKSB7XG4gICAgICAgICAgICBjb25zdCBub2RlSWQgPSBub2RlSWRCeVV1aWQuZ2V0KGJpbmRpbmcubm9kZVV1aWQpID8/IG5vZGVJZEJ5TmFtZS5nZXQoYmluZGluZy5ub2RlTmFtZSk7XG4gICAgICAgICAgICBpZiAobm9kZUlkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IG5vZGVJZCB9O1xuICAgICAgICAgICAgICAgIGJvdW5kQ291bnQgKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdHlwZU5hbWUgPSBiaW5kaW5nLmNvbXBvbmVudFR5cGUgfHwgYmluZGluZy5wcm9wZXJ0eVR5cGU7XG4gICAgICAgIGNvbnN0IGNvbXBvbmVudElkID0gY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlVXVpZH06JHt0eXBlTmFtZX1gKVxuICAgICAgICAgICAgPz8gY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlVXVpZH06JHtzaG9ydFR5cGVOYW1lKHR5cGVOYW1lKX1gKVxuICAgICAgICAgICAgPz8gY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlTmFtZX06JHt0eXBlTmFtZX1gKVxuICAgICAgICAgICAgPz8gY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlTmFtZX06JHtzaG9ydFR5cGVOYW1lKHR5cGVOYW1lKX1gKTtcblxuICAgICAgICBpZiAoY29tcG9uZW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGFyZ2V0Q29tcG9uZW50W2JpbmRpbmcucHJvcGVydHlOYW1lXSA9IHsgX19pZF9fOiBjb21wb25lbnRJZCB9O1xuICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgd3JpdGVGaWxlU3luYyhhc3NldC5maWxlLCBgJHtKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKX1cXG5gLCAndXRmOCcpO1xuICAgIHJldHVybiBib3VuZENvdW50O1xufVxuXG5mdW5jdGlvbiBzaG9ydFR5cGVOYW1lKHR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHR5cGUuc3BsaXQoJy4nKS5wb3AoKSB8fCB0eXBlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVCdXR0b25Db21wb25lbnRzKGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10sIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGJ1dHRvbiBvZiBidXR0b25zKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIGJ1dHRvbi5ub2RlVXVpZCk7XG4gICAgICAgICAgICBpZiAoaGFzQ29tcG9uZW50KG5vZGUsICdCdXR0b24nKSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBjb21wb25lbnRUeXBlID0gYnV0dG9uLmNvbXBvbmVudFR5cGUgfHwgJ2NjLkJ1dHRvbic7XG4gICAgICAgICAgICBhd2FpdCBjcmVhdGVDb21wb25lbnRXaXRoRmFsbGJhY2soYnV0dG9uLm5vZGVVdWlkLCBbY29tcG9uZW50VHlwZSwgc2hvcnRUeXBlTmFtZShjb21wb25lbnRUeXBlKV0pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gZW5zdXJlIEJ1dHRvbiBjb21wb25lbnQgb24gJHtidXR0b24ubm9kZU5hbWV9LmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gaGFzQ29tcG9uZW50KG5vZGU6IGFueSwgY29tcG9uZW50TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgY29tcG9uZW50cyA9IEFycmF5LmlzQXJyYXkobm9kZT8uX19jb21wc19fKSA/IG5vZGUuX19jb21wc19fIDogW107XG4gICAgcmV0dXJuIGNvbXBvbmVudHMuc29tZSgoY29tcG9uZW50OiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICAgICAgICAgIGNvbXBvbmVudD8udHlwZSxcbiAgICAgICAgICAgIGNvbXBvbmVudD8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudD8uY2lkLFxuICAgICAgICAgICAgY29tcG9uZW50Py52YWx1ZT8ubmFtZSxcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Ll9fdHlwZV9fLFxuICAgICAgICAgICAgY29tcG9uZW50Py52YWx1ZT8uY2lkLFxuICAgICAgICBdLm1hcChyZWFkRHVtcFZhbHVlKS5maWx0ZXIoQm9vbGVhbikubWFwKFN0cmluZyk7XG5cbiAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIGNvbXBvbmVudE5hbWUpKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hlc0NvbXBvbmVudE5hbWUoY2FuZGlkYXRlOiBzdHJpbmcsIGNvbXBvbmVudE5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGxlZnQgPSBjYW5kaWRhdGUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCByaWdodCA9IGNvbXBvbmVudE5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBsZWZ0U2hvcnQgPSBzaG9ydFR5cGVOYW1lKGNhbmRpZGF0ZSkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCByaWdodFNob3J0ID0gc2hvcnRUeXBlTmFtZShjb21wb25lbnROYW1lKS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgcmV0dXJuIGxlZnQgPT09IHJpZ2h0XG4gICAgICAgIHx8IGxlZnRTaG9ydCA9PT0gcmlnaHRTaG9ydFxuICAgICAgICB8fCBsZWZ0LmVuZHNXaXRoKGAuJHtyaWdodFNob3J0fWApXG4gICAgICAgIHx8IGxlZnQuaW5jbHVkZXMocmlnaHQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnRXaXRoRmFsbGJhY2sobm9kZVV1aWQ6IHN0cmluZywgY29tcG9uZW50TmFtZXM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxhc3RFcnJvcjogdW5rbm93bjtcblxuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIGNvbXBvbmVudE5hbWVzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdjcmVhdGUtY29tcG9uZW50Jywge1xuICAgICAgICAgICAgICAgIHV1aWQ6IG5vZGVVdWlkLFxuICAgICAgICAgICAgICAgIGNvbXBvbmVudCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbGFzdEVycm9yID0gZXJyb3I7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBsYXN0RXJyb3I7XG59XG5cbmZ1bmN0aW9uIGRlbGF5KG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbn1cbiJdfQ==