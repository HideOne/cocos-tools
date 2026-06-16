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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQXNOQSxvQkFBeUI7QUFFekIsd0JBQTJCO0FBeE4zQiwyQkFBMEU7QUFDMUUsK0JBQXlEO0FBQ3pELG1DQUFxQztBQUVyQyxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFFakMsTUFBTSxlQUFlLEdBQUcscUNBQXFDLENBQUM7QUFDOUQsTUFBTSxhQUFhLEdBQUcsOENBQThDLENBQUM7QUFDckUsTUFBTSxzQkFBc0IsR0FBRyxvQkFBb0IsQ0FBQztBQUNwRCxNQUFNLG9CQUFvQixHQUFHLGtCQUFrQixDQUFDO0FBQ2hELE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUFDN0QsTUFBTSxxQkFBcUIsR0FBRywwQkFBMEIsQ0FBQztBQUN6RCxNQUFNLHlCQUF5QixHQUFHLDhCQUE4QixDQUFDO0FBQ2pFLE1BQU0sdUJBQXVCLEdBQUcsNEJBQTRCLENBQUM7QUErQzdELE1BQU0sYUFBYSxHQUFtQjtJQUNsQyxVQUFVLEVBQUUsWUFBWTtJQUN4QixzQkFBc0IsRUFBRSxJQUFJO0lBQzVCLGFBQWEsRUFBRSxRQUFRO0lBQ3ZCLFVBQVUsRUFBRSxNQUFNO0lBQ2xCLEtBQUssRUFBRTtRQUNIO1lBQ0ksTUFBTSxFQUFFLE1BQU07WUFDZCxhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFVLEVBQUUsTUFBTTtZQUNsQixhQUFhLEVBQUUsRUFBRTtZQUNqQixZQUFZLEVBQUUsS0FBSztZQUNuQixrQkFBa0IsRUFBRSxLQUFLO1lBQ3pCLE9BQU8sRUFBRSxJQUFJO1NBQ2hCO1FBQ0Q7WUFDSSxNQUFNLEVBQUUsV0FBVztZQUNuQixhQUFhLEVBQUUsTUFBTTtZQUNyQixZQUFZLEVBQUUsTUFBTTtZQUNwQixhQUFhLEVBQUUsTUFBTTtZQUNyQixVQUFV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QyxXQUFXLEVBQUUsQ0FBQztJQUMxQyxNQUFNLFNBQVMsR0FBRyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDekQsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTlELE9BQU8sSUFBSSxLQUFLLEtBQUs7V0FDZCxTQUFTLEtBQUssVUFBVTtXQUN4QixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksVUFBVSxFQUFFLENBQUM7V0FDL0IsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLFFBQWdCLEVBQUUsY0FBd0I7SUFDakYsSUFBSSxTQUFrQixDQUFDO0lBRXZCLEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDO1lBQ0QsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ3RELElBQUksRUFBRSxRQUFRO2dCQUNkLFNBQVM7YUFDWixDQUFDLENBQUM7WUFDSCxPQUFPO1FBQ1gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDYixTQUFTLEdBQUcsS0FBSyxDQUFDO1FBQ3RCLENBQUM7SUFDTCxDQUFDO0lBRUQsTUFBTSxTQUFTLENBQUM7QUFDcEIsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEVBQVU7SUFDckIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGlzdHNTeW5jLCByZWFkRmlsZVN5bmMsIHJlYWRkaXJTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xyXG5pbXBvcnQgeyBiYXNlbmFtZSwgZXh0bmFtZSwgam9pbiwgcmVsYXRpdmUgfSBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgcmFuZG9tQnl0ZXMgfSBmcm9tICdjcnlwdG8nO1xyXG5cclxuY29uc3QgUEFDS0FHRV9OQU1FID0gJ2JpbmQtdG9vbCc7XHJcblxyXG5jb25zdCBBVVRPX0JJTkRfU1RBUlQgPSAnLyoqKioqKioqKioqKioqKnN0c3J0KioqKioqKioqKioqKi8nO1xyXG5jb25zdCBBVVRPX0JJTkRfRU5EID0gJy8qKioqKioqKioqKioqKioqKioqKioqKiplbmQqKioqKioqKioqKioqKiovJztcclxuY29uc3QgTEVHQUNZX0FVVE9fQklORF9TVEFSVCA9ICcvLyBBVVRPX0JJTkRfU1RBUlQnO1xyXG5jb25zdCBMRUdBQ1lfQVVUT19CSU5EX0VORCA9ICcvLyBBVVRPX0JJTkRfRU5EJztcclxuY29uc3QgQVVUT19CVVRUT05fRVZFTlRfU1RBUlQgPSAnLy8gQVVUT19CVVRUT05fRVZFTlRfU1RBUlQnO1xyXG5jb25zdCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQgPSAnLy8gQVVUT19CVVRUT05fRVZFTlRfRU5EJztcclxuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCA9ICcvLyBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJUJztcclxuY29uc3QgQVVUT19CVVRUT05fSEFORExFUl9FTkQgPSAnLy8gQVVUT19CVVRUT05fSEFORExFUl9FTkQnO1xyXG5cclxudHlwZSBCaW5kVGFyZ2V0ID0gJ25vZGUnIHwgJ2NvbXBvbmVudCc7XHJcbnR5cGUgQmluZE1vZGUgPSAnZ2VuZXJhdGUtYW5kLWJpbmQnIHwgJ2dlbmVyYXRlJyB8ICdiaW5kJztcclxuXHJcbmludGVyZmFjZSBCaW5kVG9vbENvbmZpZyB7XHJcbiAgICBzY3JpcHRSb290OiBzdHJpbmc7XHJcbiAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiBib29sZWFuO1xyXG4gICAgb3ZlcndyaXRlTW9kZTogJ21hcmtlcic7XHJcbiAgICBzdG9wUHJlZml4OiBzdHJpbmc7XHJcbiAgICBydWxlczogQmluZFJ1bGVbXTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEJpbmRSdWxlIHtcclxuICAgIHByZWZpeDogc3RyaW5nO1xyXG4gICAgY29tcG9uZW50TmFtZT86IHN0cmluZztcclxuICAgIHByb3BlcnR5VHlwZTogc3RyaW5nO1xyXG4gICAgZGVjb3JhdG9yVHlwZTogc3RyaW5nO1xyXG4gICAgYmluZFRhcmdldDogQmluZFRhcmdldDtcclxuICAgIGNvbXBvbmVudFR5cGU6IHN0cmluZztcclxuICAgIHN0b3BDaGlsZHJlbjogYm9vbGVhbjtcclxuICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogYm9vbGVhbjtcclxuICAgIGVuYWJsZWQ6IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBTY2FubmVkQmluZGluZyB7XHJcbiAgICBub2RlVXVpZDogc3RyaW5nO1xyXG4gICAgbm9kZU5hbWU6IHN0cmluZztcclxuICAgIHByb3BlcnR5TmFtZTogc3RyaW5nO1xyXG4gICAgcHJvcGVydHlUeXBlOiBzdHJpbmc7XHJcbiAgICBkZWNvcmF0b3JUeXBlOiBzdHJpbmc7XHJcbiAgICBiaW5kVGFyZ2V0OiBCaW5kVGFyZ2V0O1xyXG4gICAgY29tcG9uZW50VHlwZTogc3RyaW5nO1xyXG4gICAgc3RvcENoaWxkcmVuOiBib29sZWFuO1xyXG4gICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBib29sZWFuO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQmluZFJlc3VsdCB7XHJcbiAgICBjbGFzc05hbWU6IHN0cmluZztcclxuICAgIHNjcmlwdFVybDogc3RyaW5nO1xyXG4gICAgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW107XHJcbiAgICBidXR0b25zOiBTY2FubmVkQmluZGluZ1tdO1xyXG4gICAgY3JlYXRlZDogYm9vbGVhbjtcclxuICAgIGNvbXBvbmVudEF0dGFjaGVkOiBib29sZWFuO1xyXG4gICAgcHJvcGVydGllc0JvdW5kOiBudW1iZXI7XHJcbn1cclxuXHJcbmNvbnN0IGRlZmF1bHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xyXG4gICAgc2NyaXB0Um9vdDogJ2Fzc2V0cy9zcmMnLFxyXG4gICAgYXV0b0FkZEJ1dHRvbkNvbXBvbmVudDogdHJ1ZSxcclxuICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxyXG4gICAgc3RvcFByZWZpeDogJ3N0b3AnLFxyXG4gICAgcnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGUnLFxyXG4gICAgICAgICAgICBjb21wb25lbnROYW1lOiAnTm9kZScsXHJcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ05vZGUnLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTm9kZScsXHJcbiAgICAgICAgICAgIGJpbmRUYXJnZXQ6ICdub2RlJyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJycsXHJcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ25vZGVfc3RvcCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdOb2RlJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTm9kZScsXHJcbiAgICAgICAgICAgIGRlY29yYXRvclR5cGU6ICdOb2RlJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ25vZGUnLFxyXG4gICAgICAgICAgICBjb21wb25lbnRUeXBlOiAnJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiB0cnVlLFxyXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IGZhbHNlLFxyXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgICBwcmVmaXg6ICdzcGluZScsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdzcC5Ta2VsZXRvbicsXHJcbiAgICAgICAgICAgIHByb3BlcnR5VHlwZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgZGVjb3JhdG9yVHlwZTogJ3NwLlNrZWxldG9uJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdzcC5Ta2VsZXRvbicsXHJcbiAgICAgICAgICAgIHN0b3BDaGlsZHJlbjogZmFsc2UsXHJcbiAgICAgICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogZmFsc2UsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ2J1dHRvbicsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudE5hbWU6ICdCdXR0b24nLFxyXG4gICAgICAgICAgICBwcm9wZXJ0eVR5cGU6ICdCdXR0b24nLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnQnV0dG9uJyxcclxuICAgICAgICAgICAgYmluZFRhcmdldDogJ2NvbXBvbmVudCcsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudFR5cGU6ICdjYy5CdXR0b24nLFxyXG4gICAgICAgICAgICBzdG9wQ2hpbGRyZW46IGZhbHNlLFxyXG4gICAgICAgICAgICBnZW5lcmF0ZUNsaWNrRXZlbnQ6IHRydWUsXHJcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICAgIHByZWZpeDogJ2xhYmVsJyxcclxuICAgICAgICAgICAgY29tcG9uZW50TmFtZTogJ0xhYmVsJyxcclxuICAgICAgICAgICAgcHJvcGVydHlUeXBlOiAnTGFiZWwnLFxyXG4gICAgICAgICAgICBkZWNvcmF0b3JUeXBlOiAnTGFiZWwnLFxyXG4gICAgICAgICAgICBiaW5kVGFyZ2V0OiAnY29tcG9uZW50JyxcclxuICAgICAgICAgICAgY29tcG9uZW50VHlwZTogJ2NjLkxhYmVsJyxcclxuICAgICAgICAgICAgc3RvcENoaWxkcmVuOiBmYWxzZSxcclxuICAgICAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBmYWxzZSxcclxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgXSxcclxufTtcclxuXHJcbmV4cG9ydCBjb25zdCBtZXRob2RzOiB7IFtrZXk6IHN0cmluZ106ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55IH0gPSB7XHJcbiAgICBhc3luYyBvcGVuUnVsZXNQYW5lbCgpIHtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUGFuZWwub3BlbihgJHtQQUNLQUdFX05BTUV9LnJ1bGVzYCk7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIHF1ZXJ5Q29uZmlnKCkge1xyXG4gICAgICAgIHJldHVybiByZWFkQ29uZmlnKCk7XHJcbiAgICB9LFxyXG5cclxuICAgIGFzeW5jIHNhdmVDb25maWcoY29uZmlnOiBQYXJ0aWFsPEJpbmRUb29sQ29uZmlnPikge1xyXG4gICAgICAgIGNvbnN0IG5leHRDb25maWc6IEJpbmRUb29sQ29uZmlnID0ge1xyXG4gICAgICAgICAgICAuLi5kZWZhdWx0Q29uZmlnLFxyXG4gICAgICAgICAgICAuLi5jb25maWcsXHJcbiAgICAgICAgICAgIHJ1bGVzOiBub3JtYWxpemVSdWxlcyhjb25maWcucnVsZXMpLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc2NyaXB0Um9vdCcsIG5leHRDb25maWcuc2NyaXB0Um9vdCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdhdXRvQWRkQnV0dG9uQ29tcG9uZW50JywgbmV4dENvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ292ZXJ3cml0ZU1vZGUnLCBuZXh0Q29uZmlnLm92ZXJ3cml0ZU1vZGUpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnc3RvcFByZWZpeCcsIG5leHRDb25maWcuc3RvcFByZWZpeCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdydWxlcycsIG5leHRDb25maWcucnVsZXMpO1xyXG4gICAgICAgIHJldHVybiBuZXh0Q29uZmlnO1xyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyByZXNldENvbmZpZygpIHtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3NjcmlwdFJvb3QnLCBkZWZhdWx0Q29uZmlnLnNjcmlwdFJvb3QpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAnYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcsIGRlZmF1bHRDb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCk7XHJcbiAgICAgICAgYXdhaXQgRWRpdG9yLlByb2ZpbGUuc2V0UHJvamVjdChQQUNLQUdFX05BTUUsICdvdmVyd3JpdGVNb2RlJywgZGVmYXVsdENvbmZpZy5vdmVyd3JpdGVNb2RlKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuUHJvZmlsZS5zZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSwgJ3N0b3BQcmVmaXgnLCBkZWZhdWx0Q29uZmlnLnN0b3BQcmVmaXgpO1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5Qcm9maWxlLnNldFByb2plY3QoUEFDS0FHRV9OQU1FLCAncnVsZXMnLCBkZWZhdWx0Q29uZmlnLnJ1bGVzKTtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcclxuICAgIH0sXHJcblxyXG4gICAgYXN5bmMgYmluZFNlbGVjdGVkTm9kZSgpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdnZW5lcmF0ZS1hbmQtYmluZCcpO1xyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyBnZW5lcmF0ZVNlbGVjdGVkTm9kZVNjcmlwdCgpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdnZW5lcmF0ZScpO1xyXG4gICAgfSxcclxuXHJcbiAgICBhc3luYyBiaW5kU2VsZWN0ZWROb2RlUmVmZXJlbmNlcygpIHtcclxuICAgICAgICBhd2FpdCBydW5CaW5kU2VsZWN0ZWROb2RlKCdiaW5kJyk7XHJcbiAgICB9LFxyXG59O1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gcnVuQmluZFNlbGVjdGVkTm9kZShtb2RlOiBCaW5kTW9kZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgbW9kZVRpdGxlID0gZ2V0TW9kZVRpdGxlKG1vZGUpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBiaW5kU2VsZWN0ZWROb2RlKG1vZGUpO1xyXG4gICAgICAgIGNvbnN0IGRldGFpbCA9IFtcclxuICAgICAgICAgICAgYFNjcmlwdDogJHtyZXN1bHQuc2NyaXB0VXJsfWAsXHJcbiAgICAgICAgICAgIGBQcm9wZXJ0aWVzOiAke3Jlc3VsdC5iaW5kaW5ncy5sZW5ndGh9YCxcclxuICAgICAgICAgICAgYEJ1dHRvbiBldmVudHM6ICR7cmVzdWx0LmJ1dHRvbnMubGVuZ3RofWAsXHJcbiAgICAgICAgICAgIG1vZGUgPT09ICdnZW5lcmF0ZScgPyAnQ29tcG9uZW50OiBza2lwcGVkJyA6IChyZXN1bHQuY29tcG9uZW50QXR0YWNoZWQgPyAnQ29tcG9uZW50OiBhdHRhY2ggYXR0ZW1wdGVkIHN1Y2Nlc3NmdWxseScgOiAnQ29tcG9uZW50OiBub3QgYXR0YWNoZWQnKSxcclxuICAgICAgICAgICAgbW9kZSA9PT0gJ2dlbmVyYXRlJyA/ICdCb3VuZCByZWZlcmVuY2VzOiBza2lwcGVkJyA6IGBCb3VuZCByZWZlcmVuY2VzOiAke3Jlc3VsdC5wcm9wZXJ0aWVzQm91bmR9YCxcclxuICAgICAgICBdLmpvaW4oJ1xcbicpO1xyXG5cclxuICAgICAgICBFZGl0b3IuVGFzay5hZGROb3RpY2Uoe1xyXG4gICAgICAgICAgICB0aXRsZTogYCR7bW9kZVRpdGxlfSBjb21wbGV0ZWAsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IGRldGFpbCxcclxuICAgICAgICAgICAgdHlwZTogJ3N1Y2Nlc3MnLFxyXG4gICAgICAgICAgICBzb3VyY2U6IFBBQ0tBR0VfTkFNRSxcclxuICAgICAgICAgICAgdGltZW91dDogNjAwMCxcclxuICAgICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBbJHtQQUNLQUdFX05BTUV9XSAke21lc3NhZ2V9YCwgZXJyb3IpO1xyXG4gICAgICAgIEVkaXRvci5UYXNrLmFkZE5vdGljZSh7XHJcbiAgICAgICAgICAgIHRpdGxlOiBgJHttb2RlVGl0bGV9IGZhaWxlZGAsXHJcbiAgICAgICAgICAgIG1lc3NhZ2UsXHJcbiAgICAgICAgICAgIHR5cGU6ICdlcnJvcicsXHJcbiAgICAgICAgICAgIHNvdXJjZTogUEFDS0FHRV9OQU1FLFxyXG4gICAgICAgICAgICB0aW1lb3V0OiA4MDAwLFxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRNb2RlVGl0bGUobW9kZTogQmluZE1vZGUpOiBzdHJpbmcge1xyXG4gICAgaWYgKG1vZGUgPT09ICdnZW5lcmF0ZScpIHtcclxuICAgICAgICByZXR1cm4gJ0dlbmVyYXRlIHNjcmlwdCc7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1vZGUgPT09ICdiaW5kJykge1xyXG4gICAgICAgIHJldHVybiAnQmluZCByZWZlcmVuY2VzJztcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gJ0dlbmVyYXRlIGFuZCBiaW5kJztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxvYWQoKSB7fVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHVubG9hZCgpIHt9XHJcblxyXG5hc3luYyBmdW5jdGlvbiBiaW5kU2VsZWN0ZWROb2RlKG1vZGU6IEJpbmRNb2RlKTogUHJvbWlzZTxCaW5kUmVzdWx0PiB7XHJcbiAgICBjb25zdCBzZWxlY3RlZFV1aWQgPSBFZGl0b3IuU2VsZWN0aW9uLmdldExhc3RTZWxlY3RlZCgnbm9kZScpIHx8IEVkaXRvci5TZWxlY3Rpb24uZ2V0U2VsZWN0ZWQoJ25vZGUnKVswXTtcclxuICAgIGlmICghc2VsZWN0ZWRVdWlkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc2VsZWN0IGEgbm9kZSBmaXJzdC4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzZWxlY3RlZFRyZWUgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdzY2VuZScsICdxdWVyeS1ub2RlLXRyZWUnLCBzZWxlY3RlZFV1aWQpO1xyXG4gICAgaWYgKCFzZWxlY3RlZFRyZWUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCByZWFkIHRoZSBzZWxlY3RlZCBub2RlLiBNYWtlIHN1cmUgYSBzY2VuZSBvciBwcmVmYWIgaXMgb3Blbi4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKHNlbGVjdGVkVHJlZSk7XHJcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0b0NsYXNzTmFtZShub2RlTmFtZSk7XHJcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKCk7XHJcbiAgICBjb25zdCBvcGVuZWRBc3NldFVybCA9IGF3YWl0IHF1ZXJ5T3BlbmVkQXNzZXRVcmwoc2VsZWN0ZWRUcmVlKTtcclxuICAgIGlmICghb3BlbmVkQXNzZXRVcmwpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBsb2NhdGUgdGhlIG9wZW5lZCBwcmVmYWIgb3Igc2NlbmUgYXNzZXQuIFBsZWFzZSBzYXZlIHRoZSBwcmVmYWIvc2NlbmUgYW5kIHJ1biBiaW5kIGFnYWluLicpO1xyXG4gICAgfVxyXG4gICAgY29uc3Qgc2NyaXB0VXJsID0gbWFrZVNjcmlwdFVybChvcGVuZWRBc3NldFVybCwgY2xhc3NOYW1lLCBjb25maWcuc2NyaXB0Um9vdCk7XHJcbiAgICBjb25zdCBzY2FuID0gc2NhbkJpbmRpbmdzKHNlbGVjdGVkVHJlZSwgY29uZmlnKTtcclxuICAgIGNvbnN0IGJ1dHRvbnMgPSBzY2FuLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5nZW5lcmF0ZUNsaWNrRXZlbnQpO1xyXG4gICAgbGV0IGNyZWF0ZWQgPSBmYWxzZTtcclxuICAgIGxldCBjb21wb25lbnRBdHRhY2hlZCA9IGZhbHNlO1xyXG4gICAgbGV0IHByb3BlcnRpZXNCb3VuZCA9IDA7XHJcblxyXG4gICAgaWYgKG1vZGUgIT09ICdiaW5kJykge1xyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlbmRlclNjcmlwdChjbGFzc05hbWUsIHNjYW4sIGJ1dHRvbnMpO1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcmVhZEFzc2V0VGV4dChzY3JpcHRVcmwpO1xyXG4gICAgICAgIGNvbnN0IGNhblVwZGF0ZUV4aXN0aW5nID0gZXhpc3RpbmcgPyBoYXNBbGxBdXRvQmxvY2tzKGV4aXN0aW5nKSA6IHRydWU7XHJcbiAgICAgICAgY29uc3QgZmluYWxTb3VyY2UgPSBleGlzdGluZyA/IHVwZGF0ZU1hcmtlZFNvdXJjZShleGlzdGluZywgc291cmNlKSA6IHNvdXJjZTtcclxuXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nICYmICFjYW5VcGRhdGVFeGlzdGluZykge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFNjcmlwdCBleGlzdHMgYnV0IGF1dG8tZ2VuZXJhdGVkIG1hcmtlcnMgYXJlIG1pc3NpbmcuIFN0b3AgdG8gYXZvaWQgb3ZlcndyaXRpbmcgdXNlciBjb2RlOiAke3NjcmlwdFVybH1gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNyZWF0ZWQgPSAhZXhpc3Rpbmc7XHJcbiAgICAgICAgYXdhaXQgd3JpdGVBc3NldChzY3JpcHRVcmwsIGZpbmFsU291cmNlLCBjcmVhdGVkKTtcclxuICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgc2NyaXB0VXJsKTtcclxuICAgIH0gZWxzZSBpZiAoIWF3YWl0IHJlYWRBc3NldFRleHQoc2NyaXB0VXJsKSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU2NyaXB0IGRvZXMgbm90IGV4aXN0LiBHZW5lcmF0ZSBpdCBmaXJzdDogJHtzY3JpcHRVcmx9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1vZGUgIT09ICdnZW5lcmF0ZScpIHtcclxuICAgICAgICBhd2FpdCBlbnN1cmVCdXR0b25Db21wb25lbnRzKGJ1dHRvbnMsIGNvbmZpZyk7XHJcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQgPSBhd2FpdCB0cnlBdHRhY2hDb21wb25lbnQoc2VsZWN0ZWRVdWlkLCBjbGFzc05hbWUsIHNjcmlwdFVybCk7XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NhdmUtc2NlbmUnKTtcclxuICAgICAgICAgICAgcHJvcGVydGllc0JvdW5kID0gYXdhaXQgYmluZFNlcmlhbGl6ZWRBc3NldFJlZmVyZW5jZXMob3BlbmVkQXNzZXRVcmwsIHNjcmlwdFVybCwgc2VsZWN0ZWRVdWlkLCBjbGFzc05hbWUsIGdldE5vZGVOYW1lKHNlbGVjdGVkVHJlZSksIHNjYW4pO1xyXG4gICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdyZWZyZXNoLWFzc2V0Jywgb3BlbmVkQXNzZXRVcmwpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHNhdmUgdGhlIGN1cnJlbnQgc2NlbmUgb3IgcHJlZmFiLiBQbGVhc2Ugc2F2ZSBtYW51YWxseS5gLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgY2xhc3NOYW1lLFxyXG4gICAgICAgIHNjcmlwdFVybCxcclxuICAgICAgICBiaW5kaW5nczogc2NhbixcclxuICAgICAgICBidXR0b25zLFxyXG4gICAgICAgIGNyZWF0ZWQsXHJcbiAgICAgICAgY29tcG9uZW50QXR0YWNoZWQsXHJcbiAgICAgICAgcHJvcGVydGllc0JvdW5kLFxyXG4gICAgfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZENvbmZpZygpOiBQcm9taXNlPEJpbmRUb29sQ29uZmlnPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHByb2plY3RDb25maWcgPSBhd2FpdCBFZGl0b3IuUHJvZmlsZS5nZXRQcm9qZWN0KFBBQ0tBR0VfTkFNRSk7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgLi4uZGVmYXVsdENvbmZpZyxcclxuICAgICAgICAgICAgLi4uKHByb2plY3RDb25maWcgfHwge30pLFxyXG4gICAgICAgICAgICBydWxlczogbm9ybWFsaXplUnVsZXMocHJvamVjdENvbmZpZz8ucnVsZXMpLFxyXG4gICAgICAgIH07XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZztcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZXMocnVsZXM6IHVua25vd24pOiBCaW5kUnVsZVtdIHtcclxuICAgIGlmICghQXJyYXkuaXNBcnJheShydWxlcykpIHtcclxuICAgICAgICByZXR1cm4gZGVmYXVsdENvbmZpZy5ydWxlcztcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gcnVsZXNcclxuICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlICYmIHR5cGVvZiBydWxlID09PSAnb2JqZWN0JylcclxuICAgICAgICAubWFwKChydWxlOiBhbnkpID0+IG5vcm1hbGl6ZVJ1bGUocnVsZSkpXHJcbiAgICAgICAgLmZpbHRlcigocnVsZSk6IHJ1bGUgaXMgQmluZFJ1bGUgPT4gQm9vbGVhbihydWxlKSk7XHJcblxyXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQubGVuZ3RoID4gMCA/IG5vcm1hbGl6ZWQgOiBkZWZhdWx0Q29uZmlnLnJ1bGVzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVSdWxlKHJ1bGU6IGFueSk6IEJpbmRSdWxlIHwgbnVsbCB7XHJcbiAgICBjb25zdCBwcmVmaXggPSBTdHJpbmcocnVsZS5wcmVmaXggfHwgJycpLnRyaW0oKTtcclxuICAgIGlmICghcHJlZml4KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29tcG9uZW50TmFtZSA9IFN0cmluZyhydWxlLmNvbXBvbmVudE5hbWUgfHwgcnVsZS5wcm9wZXJ0eVR5cGUgfHwgJ05vZGUnKS50cmltKCk7XHJcbiAgICBjb25zdCBwcm9wZXJ0eVR5cGUgPSBub3JtYWxpemVDb21wb25lbnROYW1lKGNvbXBvbmVudE5hbWUpO1xyXG4gICAgY29uc3QgYmluZFRhcmdldDogQmluZFRhcmdldCA9IHByb3BlcnR5VHlwZSA9PT0gJ05vZGUnID8gJ25vZGUnIDogJ2NvbXBvbmVudCc7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBwcmVmaXgsXHJcbiAgICAgICAgY29tcG9uZW50TmFtZTogcHJvcGVydHlUeXBlLFxyXG4gICAgICAgIHByb3BlcnR5VHlwZSxcclxuICAgICAgICBkZWNvcmF0b3JUeXBlOiBwcm9wZXJ0eVR5cGUsXHJcbiAgICAgICAgYmluZFRhcmdldCxcclxuICAgICAgICBjb21wb25lbnRUeXBlOiBiaW5kVGFyZ2V0ID09PSAnY29tcG9uZW50JyA/IHRvQ29tcG9uZW50VHlwZShwcm9wZXJ0eVR5cGUpIDogJycsXHJcbiAgICAgICAgc3RvcENoaWxkcmVuOiBCb29sZWFuKHJ1bGUuc3RvcENoaWxkcmVuKSB8fCBwcmVmaXggPT09ICdub2RlX3N0b3AnLFxyXG4gICAgICAgIGdlbmVyYXRlQ2xpY2tFdmVudDogaXNCdXR0b25UeXBlKHByb3BlcnR5VHlwZSksXHJcbiAgICAgICAgZW5hYmxlZDogcnVsZS5lbmFibGVkICE9PSBmYWxzZSxcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbXBvbmVudE5hbWUoY29tcG9uZW50TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHZhbHVlID0gY29tcG9uZW50TmFtZS50cmltKCk7XHJcbiAgICBpZiAodmFsdWUuc3RhcnRzV2l0aCgnY2MuJykpIHtcclxuICAgICAgICByZXR1cm4gc2hvcnRUeXBlTmFtZSh2YWx1ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHZhbHVlIHx8ICdOb2RlJztcclxufVxyXG5cclxuZnVuY3Rpb24gdG9Db21wb25lbnRUeXBlKHByb3BlcnR5VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGlmIChpc0J1aWx0aW5DY0NvbXBvbmVudChwcm9wZXJ0eVR5cGUpKSB7XHJcbiAgICAgICAgcmV0dXJuIGBjYy4ke3Byb3BlcnR5VHlwZX1gO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBwcm9wZXJ0eVR5cGU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQnVpbHRpbkNjQ29tcG9uZW50KHByb3BlcnR5VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gW1xyXG4gICAgICAgICdCdXR0b24nLFxyXG4gICAgICAgICdFZGl0Qm94JyxcclxuICAgICAgICAnTGFiZWwnLFxyXG4gICAgICAgICdMYXlvdXQnLFxyXG4gICAgICAgICdNYXNrJyxcclxuICAgICAgICAnUGFnZVZpZXcnLFxyXG4gICAgICAgICdQcm9ncmVzc0JhcicsXHJcbiAgICAgICAgJ1JpY2hUZXh0JyxcclxuICAgICAgICAnU2Nyb2xsVmlldycsXHJcbiAgICAgICAgJ1NsaWRlcicsXHJcbiAgICAgICAgJ1Nwcml0ZScsXHJcbiAgICAgICAgJ1RvZ2dsZScsXHJcbiAgICAgICAgJ1dpZGdldCcsXHJcbiAgICBdLmluY2x1ZGVzKHByb3BlcnR5VHlwZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzQnV0dG9uVHlwZShwcm9wZXJ0eVR5cGU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHByb3BlcnR5VHlwZSA9PT0gJ0J1dHRvbicgfHwgcHJvcGVydHlUeXBlID09PSAnY2MuQnV0dG9uJztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlPcGVuZWRBc3NldFVybChzZWxlY3RlZFRyZWU6IGFueSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzYXZlZElkID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAnc2F2ZS1zY2VuZScpO1xyXG4gICAgICAgIGlmICghc2F2ZWRJZCkge1xyXG4gICAgICAgICAgICByZXR1cm4gZmluZEFzc2V0VXJsQnlOb2RlVHJlZVdpdGhSZXRyeShzZWxlY3RlZFRyZWUpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgc2F2ZWRJZCk7XHJcbiAgICAgICAgcmV0dXJuIGFzc2V0Py51cmwgfHwgYXNzZXQ/LnNvdXJjZSB8fCBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlV2l0aFJldHJ5KHNlbGVjdGVkVHJlZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gZmluZEFzc2V0VXJsQnlOb2RlVHJlZVdpdGhSZXRyeShzZWxlY3RlZFRyZWUpO1xyXG4gICAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmaW5kQXNzZXRVcmxCeU5vZGVUcmVlV2l0aFJldHJ5KHNlbGVjdGVkVHJlZTogYW55KTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XHJcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgNTsgaW5kZXggKz0gMSkge1xyXG4gICAgICAgIGNvbnN0IHVybCA9IGZpbmRBc3NldFVybEJ5Tm9kZVRyZWUoc2VsZWN0ZWRUcmVlKTtcclxuICAgICAgICBpZiAodXJsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB1cmw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGF3YWl0IGRlbGF5KDEyMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZpbmRBc3NldFVybEJ5Tm9kZVRyZWUoc2VsZWN0ZWRUcmVlOiBhbnkpOiBzdHJpbmcgfCBudWxsIHtcclxuICAgIGNvbnN0IGFzc2V0c0RpciA9IGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ2Fzc2V0cycpO1xyXG4gICAgaWYgKCFleGlzdHNTeW5jKGFzc2V0c0RpcikpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByb290TmFtZSA9IGdldE5vZGVOYW1lKHNlbGVjdGVkVHJlZSk7XHJcbiAgICBjb25zdCBjaGlsZE5hbWVzID0gbmV3IFNldChnZXRDaGlsZHJlbihzZWxlY3RlZFRyZWUpLm1hcChnZXROb2RlTmFtZSkpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGxpc3RBc3NldEZpbGVzKGFzc2V0c0RpciwgWycucHJlZmFiJywgJy5zY2VuZSddKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSByZWFkSnNvbkZpbGVTeW5jKGZpbGUpO1xyXG4gICAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZGF0YSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBub2RlcyA9IGRhdGEuZmlsdGVyKChpdGVtKSA9PiBpdGVtPy5fX3R5cGVfXyA9PT0gJ2NjLk5vZGUnKTtcclxuICAgICAgICAgICAgY29uc3QgaGFzUm9vdCA9IG5vZGVzLnNvbWUoKG5vZGUpID0+IG5vZGU/Ll9uYW1lID09PSByb290TmFtZSk7XHJcbiAgICAgICAgICAgIGlmICghaGFzUm9vdCkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IG5vZGVOYW1lcyA9IG5ldyBTZXQobm9kZXMubWFwKChub2RlKSA9PiBub2RlPy5fbmFtZSkuZmlsdGVyKEJvb2xlYW4pKTtcclxuICAgICAgICAgICAgY29uc3QgY2hpbGRNYXRjaENvdW50ID0gWy4uLmNoaWxkTmFtZXNdLmZpbHRlcigobmFtZSkgPT4gbm9kZU5hbWVzLmhhcyhuYW1lKSkubGVuZ3RoO1xyXG4gICAgICAgICAgICBpZiAoY2hpbGROYW1lcy5zaXplID09PSAwIHx8IGNoaWxkTWF0Y2hDb3VudCA+IDAgfHwgYmFzZW5hbWUoZmlsZSwgZXh0bmFtZShmaWxlKSkgPT09IHJvb3ROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhc3NldFJlbGF0aXZlID0gcmVsYXRpdmUoRWRpdG9yLlByb2plY3QucGF0aCwgZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGBkYjovLyR7YXNzZXRSZWxhdGl2ZX1gO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBpbnNwZWN0IGFzc2V0ICR7ZmlsZX0uYCwgZXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkSnNvbkZpbGVTeW5jKGZpbGU6IHN0cmluZyk6IGFueSB8IG51bGwge1xyXG4gICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGlmIChpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZEpzb25GaWxlV2l0aFJldHJ5KGZpbGU6IHN0cmluZywgYXR0ZW1wdHMgPSA1KTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgYXR0ZW1wdHM7IGluZGV4ICs9IDEpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMoZmlsZSwgJ3V0ZjgnKSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgaWYgKCFpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3IpIHx8IGluZGV4ID09PSBhdHRlbXB0cyAtIDEpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGF3YWl0IGRlbGF5KDEyMCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0luY29tcGxldGVKc29uRXJyb3IoZXJyb3I6IHVua25vd24pOiBib29sZWFuIHtcclxuICAgIHJldHVybiBlcnJvciBpbnN0YW5jZW9mIFN5bnRheEVycm9yICYmIC9VbmV4cGVjdGVkIGVuZCBvZiBKU09OIGlucHV0Ly50ZXN0KGVycm9yLm1lc3NhZ2UpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBsaXN0QXNzZXRGaWxlcyhkaXI6IHN0cmluZywgZXh0ZW5zaW9uczogc3RyaW5nW10pOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWFkZGlyU3luYyhkaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KSkge1xyXG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gam9pbihkaXIsIGVudHJ5Lm5hbWUpO1xyXG4gICAgICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XHJcbiAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLmxpc3RBc3NldEZpbGVzKGZ1bGxQYXRoLCBleHRlbnNpb25zKSk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChleHRlbnNpb25zLmluY2x1ZGVzKGV4dG5hbWUoZW50cnkubmFtZSkudG9Mb3dlckNhc2UoKSkpIHtcclxuICAgICAgICAgICAgcmVzdWx0LnB1c2goZnVsbFBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlU2NyaXB0VXJsKG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0Um9vdDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWRSb290ID0gbm9ybWFsaXplQXNzZXRQYXRoKHNjcmlwdFJvb3QgfHwgZGVmYXVsdENvbmZpZy5zY3JpcHRSb290KS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcclxuICAgIGNvbnN0IHJvb3RTY3JpcHRVcmwgPSBgZGI6Ly8ke25vcm1hbGl6ZWRSb290fS8ke2NsYXNzTmFtZX0udHNgO1xyXG4gICAgaWYgKGFzc2V0VXJsRXhpc3RzKHJvb3RTY3JpcHRVcmwpKSB7XHJcbiAgICAgICAgcmV0dXJuIHJvb3RTY3JpcHRVcmw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFvcGVuZWRBc3NldFVybCkge1xyXG4gICAgICAgIHJldHVybiByb290U2NyaXB0VXJsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFzc2V0UGF0aCA9IG9wZW5lZEFzc2V0VXJsXHJcbiAgICAgICAgLnJlcGxhY2UoL15kYjpcXC9cXC8vLCAnJylcclxuICAgICAgICAucmVwbGFjZSgvXFwuKHByZWZhYnxzY2VuZSkkL2ksICcnKVxyXG4gICAgICAgIC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XHJcblxyXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gYXNzZXRQYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cy8nKVxyXG4gICAgICAgID8gYXNzZXRQYXRoLnNsaWNlKCdhc3NldHMvJy5sZW5ndGgpXHJcbiAgICAgICAgOiBhc3NldFBhdGgucmVwbGFjZSgvXi4qP2Fzc2V0c1xcLy8sICcnKTtcclxuICAgIGNvbnN0IGRpciA9IHJlbGF0aXZlUGF0aC5pbmNsdWRlcygnLycpID8gcmVsYXRpdmVQYXRoLnNsaWNlKDAsIHJlbGF0aXZlUGF0aC5sYXN0SW5kZXhPZignLycpKSA6ICcnO1xyXG5cclxuICAgIHJldHVybiBgZGI6Ly8ke25vcm1hbGl6ZWRSb290fSR7ZGlyID8gYC8ke2Rpcn1gIDogJyd9LyR7Y2xhc3NOYW1lfS50c2A7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFzc2V0VXJsRXhpc3RzKHVybDogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB1cmwucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKS5yZXBsYWNlKC9cXC8vZywgJ1xcXFwnKTtcclxuICAgIHJldHVybiBleGlzdHNTeW5jKGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgcmVsYXRpdmVQYXRoKSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZUFzc2V0UGF0aCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHBhdGggPSB2YWx1ZS5yZXBsYWNlKC9cXFxcL2csICcvJykucmVwbGFjZSgvXmRiOlxcL1xcLy8sICcnKS5yZXBsYWNlKC9eXFwvKy8sICcnKTtcclxuICAgIHJldHVybiBwYXRoLnN0YXJ0c1dpdGgoJ2Fzc2V0cycpID8gcGF0aCA6IGBhc3NldHMvJHtwYXRofWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNjYW5CaW5kaW5ncyhyb290OiBhbnksIGNvbmZpZzogQmluZFRvb2xDb25maWcpOiBTY2FubmVkQmluZGluZ1tdIHtcclxuICAgIGNvbnN0IHVzZWROYW1lcyA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcbiAgICBjb25zdCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSA9IFtdO1xyXG4gICAgY29uc3QgcnVsZXMgPSBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnKTtcclxuXHJcbiAgICBjb25zdCB2aXNpdCA9IChub2RlOiBhbnkpID0+IHtcclxuICAgICAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xyXG4gICAgICAgIGNvbnN0IGxvd2VyTmFtZSA9IG5vZGVOYW1lLnRvTG93ZXJDYXNlKCk7XHJcblxyXG4gICAgICAgIGlmIChsb3dlck5hbWUuc3RhcnRzV2l0aChjb25maWcuc3RvcFByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBiaW5kaW5nID0gY3JlYXRlQmluZGluZyhub2RlLCBydWxlcywgdXNlZE5hbWVzKTtcclxuICAgICAgICBpZiAoYmluZGluZykge1xyXG4gICAgICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGJpbmRpbmc/LnN0b3BDaGlsZHJlbikge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGdldENoaWxkcmVuKG5vZGUpKSB7XHJcbiAgICAgICAgICAgIHZpc2l0KGNoaWxkKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHZpc2l0KHJvb3QpO1xyXG4gICAgcmV0dXJuIGJpbmRpbmdzO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTb3J0ZWRFbmFibGVkUnVsZXMoY29uZmlnOiBCaW5kVG9vbENvbmZpZyk6IEJpbmRSdWxlW10ge1xyXG4gICAgcmV0dXJuIGNvbmZpZy5ydWxlc1xyXG4gICAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZCAmJiBydWxlLnByZWZpeClcclxuICAgICAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IHJpZ2h0LnByZWZpeC5sZW5ndGggLSBsZWZ0LnByZWZpeC5sZW5ndGgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjcmVhdGVCaW5kaW5nKG5vZGU6IGFueSwgcnVsZXM6IEJpbmRSdWxlW10sIHVzZWROYW1lczogTWFwPHN0cmluZywgbnVtYmVyPik6IFNjYW5uZWRCaW5kaW5nIHwgbnVsbCB7XHJcbiAgICBjb25zdCBub2RlTmFtZSA9IGdldE5vZGVOYW1lKG5vZGUpO1xyXG4gICAgY29uc3QgbG93ZXJOYW1lID0gbm9kZU5hbWUudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IHJ1bGUgPSBydWxlcy5maW5kKChpdGVtKSA9PiBsb3dlck5hbWUuc3RhcnRzV2l0aChpdGVtLnByZWZpeC50b0xvd2VyQ2FzZSgpKSk7XHJcblxyXG4gICAgaWYgKCFydWxlKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBub2RlVXVpZDogZ2V0VXVpZChub2RlKSxcclxuICAgICAgICBub2RlTmFtZSxcclxuICAgICAgICBwcm9wZXJ0eU5hbWU6IG1ha2VVbmlxdWVOYW1lKHRvUHJvcGVydHlOYW1lKG5vZGVOYW1lKSwgdXNlZE5hbWVzKSxcclxuICAgICAgICBwcm9wZXJ0eVR5cGU6IHJ1bGUucHJvcGVydHlUeXBlLFxyXG4gICAgICAgIGRlY29yYXRvclR5cGU6IHJ1bGUuZGVjb3JhdG9yVHlwZSxcclxuICAgICAgICBiaW5kVGFyZ2V0OiBydWxlLmJpbmRUYXJnZXQsXHJcbiAgICAgICAgY29tcG9uZW50VHlwZTogcnVsZS5jb21wb25lbnRUeXBlLFxyXG4gICAgICAgIHN0b3BDaGlsZHJlbjogcnVsZS5zdG9wQ2hpbGRyZW4sXHJcbiAgICAgICAgZ2VuZXJhdGVDbGlja0V2ZW50OiBydWxlLmdlbmVyYXRlQ2xpY2tFdmVudCxcclxuICAgIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE5vZGVOYW1lKG5vZGU6IGFueSk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gU3RyaW5nKHJlYWREdW1wVmFsdWUobm9kZT8ubmFtZSkgfHwgJ05vZGUnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0VXVpZChub2RlOiBhbnkpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIFN0cmluZyhyZWFkRHVtcFZhbHVlKG5vZGU/LnV1aWQpIHx8IG5vZGU/LnV1aWQgfHwgJycpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRDaGlsZHJlbihub2RlOiBhbnkpOiBhbnlbXSB7XHJcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShub2RlPy5jaGlsZHJlbikgPyBub2RlLmNoaWxkcmVuIDogW107XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWREdW1wVmFsdWUodmFsdWU6IGFueSk6IGFueSB7XHJcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAndmFsdWUnIGluIHZhbHVlKSB7XHJcbiAgICAgICAgcmV0dXJuIHZhbHVlLnZhbHVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0b0NsYXNzTmFtZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IG5hbWUgPSB0b1Byb3BlcnR5TmFtZSh2YWx1ZSk7XHJcbiAgICByZXR1cm4gdXBwZXJGaXJzdChuYW1lLnJlcGxhY2UoL15fKy8sICcnKSB8fCAnQXV0b0JpbmRDb21wb25lbnQnKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9Qcm9wZXJ0eU5hbWUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gdmFsdWVcclxuICAgICAgICAudHJpbSgpXHJcbiAgICAgICAgLnJlcGxhY2UoL1teXFxwe0lEX1N0YXJ0fVxccHtJRF9Db250aW51ZX0kX1xcdTIwMENcXHUyMDBEXSsvZ3UsICdfJylcclxuICAgICAgICAucmVwbGFjZSgvXysvZywgJ18nKVxyXG4gICAgICAgIC5yZXBsYWNlKC9eXyt8XyskL2csICcnKTtcclxuXHJcbiAgICBjb25zdCBjbGVhbmVkID0gbm9ybWFsaXplZFxyXG4gICAgICAgIC5zcGxpdCgnJylcclxuICAgICAgICAuZmlsdGVyKChjaGFyLCBpbmRleCkgPT4gaW5kZXggPT09IDAgPyBpc0lkZW50aWZpZXJTdGFydChjaGFyKSA6IGlzSWRlbnRpZmllckNvbnRpbnVlKGNoYXIpKVxyXG4gICAgICAgIC5qb2luKCcnKTtcclxuXHJcbiAgICBpZiAoIWNsZWFuZWQpIHtcclxuICAgICAgICByZXR1cm4gJ25vZGUnO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBpc0lkZW50aWZpZXJTdGFydChjbGVhbmVkWzBdKSA/IGNsZWFuZWQgOiBgXyR7Y2xlYW5lZH1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJTdGFydChjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvWyRfXFxwe0lEX1N0YXJ0fV0vdS50ZXN0KGNoYXIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0lkZW50aWZpZXJDb250aW51ZShjaGFyOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvWyRfXFx1MjAwQ1xcdTIwMERcXHB7SURfQ29udGludWV9XS91LnRlc3QoY2hhcik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1ha2VVbmlxdWVOYW1lKGJhc2VOYW1lOiBzdHJpbmcsIHVzZWROYW1lczogTWFwPHN0cmluZywgbnVtYmVyPik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBjb3VudCA9IHVzZWROYW1lcy5nZXQoYmFzZU5hbWUpIHx8IDA7XHJcbiAgICB1c2VkTmFtZXMuc2V0KGJhc2VOYW1lLCBjb3VudCArIDEpO1xyXG4gICAgcmV0dXJuIGNvdW50ID09PSAwID8gYmFzZU5hbWUgOiBgJHtiYXNlTmFtZX0ke2NvdW50ICsgMX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiB1cHBlckZpcnN0KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIHZhbHVlID8gdmFsdWVbMF0udG9VcHBlckNhc2UoKSArIHZhbHVlLnNsaWNlKDEpIDogdmFsdWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlclNjcmlwdChjbGFzc05hbWU6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10sIGJ1dHRvbnM6IFNjYW5uZWRCaW5kaW5nW10pOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGBpbXBvcnQgeyAke3JlbmRlckNjSW1wb3J0cyhiaW5kaW5ncyl9IH0gZnJvbSAnY2MnO1xyXG5cclxuY29uc3QgeyBjY2NsYXNzLCBwcm9wZXJ0eSB9ID0gX2RlY29yYXRvcjtcclxuXHJcbkBjY2NsYXNzKCcke2NsYXNzTmFtZX0nKVxyXG5leHBvcnQgY2xhc3MgJHtjbGFzc05hbWV9IGV4dGVuZHMgQ29tcG9uZW50IHtcclxuXHJcbiAgICAke0FVVE9fQklORF9TVEFSVH1cclxuJHtyZW5kZXJQcm9wZXJ0aWVzKGJpbmRpbmdzKX1cclxuICAgICR7QVVUT19CSU5EX0VORH1cclxuXHJcbiAgICBwcm90ZWN0ZWQgb25Mb2FkKCk6IHZvaWQge1xyXG4gICAgICAgIHRoaXMuYmluZEJ1dHRvbkV2ZW50cygpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYmluZEJ1dHRvbkV2ZW50cygpOiB2b2lkIHtcclxuICAgICAgICAke0FVVE9fQlVUVE9OX0VWRU5UX1NUQVJUfVxyXG4ke3JlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zKX1cclxuICAgICAgICAke0FVVE9fQlVUVE9OX0VWRU5UX0VORH1cclxuICAgIH1cclxuXHJcbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlR9XHJcbiR7cmVuZGVyQnV0dG9uSGFuZGxlcnMoYnV0dG9ucyl9XHJcbiAgICAke0FVVE9fQlVUVE9OX0hBTkRMRVJfRU5EfVxyXG59XHJcbmA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckNjSW1wb3J0cyhiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBpbXBvcnRzID0gbmV3IFNldChbJ19kZWNvcmF0b3InLCAnQ29tcG9uZW50J10pO1xyXG5cclxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xyXG4gICAgICAgIGNvbGxlY3RJbXBvcnRGcm9tVHlwZShpbXBvcnRzLCBiaW5kaW5nLnByb3BlcnR5VHlwZSk7XHJcbiAgICAgICAgY29sbGVjdEltcG9ydEZyb21UeXBlKGltcG9ydHMsIGJpbmRpbmcuZGVjb3JhdG9yVHlwZSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGJpbmRpbmdzLnNvbWUoKGJpbmRpbmcpID0+IGJpbmRpbmcuZ2VuZXJhdGVDbGlja0V2ZW50KSkge1xyXG4gICAgICAgIGltcG9ydHMuYWRkKCdCdXR0b24nKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gc29ydENjSW1wb3J0cyhpbXBvcnRzKS5qb2luKCcsICcpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzb3J0Q2NJbXBvcnRzKGltcG9ydHM6IEl0ZXJhYmxlPHN0cmluZz4pOiBzdHJpbmdbXSB7XHJcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQoaW1wb3J0cyldXHJcbiAgICAgICAgLmZpbHRlcigoaXRlbSkgPT4gaXRlbSAmJiBpdGVtICE9PSAnY2MnKVxyXG4gICAgICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCBvcmRlciA9IFsnX2RlY29yYXRvcicsICdDb21wb25lbnQnLCAnTm9kZScsICdCdXR0b24nLCAnTGFiZWwnLCAnU3ByaXRlJywgJ1dpZGdldCcsICdzcCddO1xyXG4gICAgICAgICAgICBjb25zdCBsZWZ0SW5kZXggPSBvcmRlci5pbmRleE9mKGxlZnQpO1xyXG4gICAgICAgICAgICBjb25zdCByaWdodEluZGV4ID0gb3JkZXIuaW5kZXhPZihyaWdodCk7XHJcbiAgICAgICAgICAgIGlmIChsZWZ0SW5kZXggIT09IC0xIHx8IHJpZ2h0SW5kZXggIT09IC0xKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gKGxlZnRJbmRleCA9PT0gLTEgPyA5OSA6IGxlZnRJbmRleCkgLSAocmlnaHRJbmRleCA9PT0gLTEgPyA5OSA6IHJpZ2h0SW5kZXgpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gbGVmdC5sb2NhbGVDb21wYXJlKHJpZ2h0KTtcclxuICAgICAgICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gY29sbGVjdEltcG9ydEZyb21UeXBlKGltcG9ydHM6IFNldDxzdHJpbmc+LCB0eXBlTmFtZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcclxuICAgIGNvbnN0IGltcG9ydE5hbWUgPSB2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSA/IHNob3J0VHlwZU5hbWUodmFsdWUpIDogdmFsdWUuc3BsaXQoJy4nKVswXTtcclxuICAgIGlmICgvXltBLVphLXpfJF1bQS1aYS16MC05XyRdKiQvLnRlc3QoaW1wb3J0TmFtZSkpIHtcclxuICAgICAgICBpbXBvcnRzLmFkZChpbXBvcnROYW1lKTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVuZGVyUHJvcGVydGllcyhiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYmluZGluZ3MubWFwKChiaW5kaW5nKSA9PiBgICAgIEBwcm9wZXJ0eSgke3RvU2NyaXB0VHlwZU5hbWUoYmluZGluZy5kZWNvcmF0b3JUeXBlKX0pXHJcbiAgICBwdWJsaWMgJHtiaW5kaW5nLnByb3BlcnR5TmFtZX06ICR7dG9TY3JpcHRUeXBlTmFtZShiaW5kaW5nLnByb3BlcnR5VHlwZSl9IHwgbnVsbCA9IG51bGw7YCkuam9pbignXFxuXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHRvU2NyaXB0VHlwZU5hbWUodHlwZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVOYW1lLnRyaW0oKTtcclxuICAgIHJldHVybiB2YWx1ZS5zdGFydHNXaXRoKCdjYy4nKSA/IHNob3J0VHlwZU5hbWUodmFsdWUpIDogdmFsdWU7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbmRlckJ1dHRvbkV2ZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgICAgICBpZiAodGhpcy4ke2J1dHRvbi5wcm9wZXJ0eU5hbWV9KSB7XHJcbiAgICAgICAgICAgIHRoaXMuJHtidXR0b24ucHJvcGVydHlOYW1lfS5ub2RlLm9uKEJ1dHRvbi5FdmVudFR5cGUuQ0xJQ0ssIHRoaXMuJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSwgdGhpcyk7XHJcbiAgICAgICAgfWApLmpvaW4oJ1xcblxcbicpO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZW5kZXJCdXR0b25IYW5kbGVycyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdKTogc3RyaW5nIHtcclxuICAgIHJldHVybiBidXR0b25zLm1hcCgoYnV0dG9uKSA9PiBgICAgIHByaXZhdGUgJHtnZXRDbGlja0hhbmRsZXJOYW1lKGJ1dHRvbi5wcm9wZXJ0eU5hbWUpfSgpOiB2b2lkIHtcclxuXHJcbiAgICB9YCkuam9pbignXFxuXFxuJyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldENsaWNrSGFuZGxlck5hbWUocHJvcGVydHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGBvbkNsaWNrJHt1cHBlckZpcnN0KHByb3BlcnR5TmFtZS5yZXBsYWNlKC9eYnV0dG9uXz8vLCAnQnV0dG9uXycpKX1gO1xyXG59XHJcblxyXG5mdW5jdGlvbiB1cGRhdGVNYXJrZWRTb3VyY2UoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGJpbmRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORCk7XG4gICAgY29uc3QgZXZlbnRCbG9jayA9IHBpY2tCbG9jayhnZW5lcmF0ZWQsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpO1xuICAgIGNvbnN0IGhhbmRsZXJCbG9jayA9IG1lcmdlQnV0dG9uSGFuZGxlckJsb2NrKFxuICAgICAgICBwaWNrQmxvY2soZXhpc3RpbmcsIEFVVE9fQlVUVE9OX0hBTkRMRVJfU1RBUlQsIEFVVE9fQlVUVE9OX0hBTkRMRVJfRU5EKSxcbiAgICAgICAgcGlja0Jsb2NrKGdlbmVyYXRlZCwgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCwgQVVUT19CVVRUT05fSEFORExFUl9FTkQpLFxuICAgICk7XG5cclxuICAgIGlmICghaGFzQWxsQXV0b0Jsb2NrcyhleGlzdGluZykpIHtcclxuICAgICAgICByZXR1cm4gZXhpc3Rpbmc7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYmluZE1hcmtlcnMgPSBnZXRFeGlzdGluZ0Jsb2NrTWFya2VycyhleGlzdGluZywgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKVxyXG4gICAgICAgIHx8IGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKGV4aXN0aW5nLCBMRUdBQ1lfQVVUT19CSU5EX1NUQVJULCBMRUdBQ1lfQVVUT19CSU5EX0VORClcclxuICAgICAgICB8fCAoW0FVVE9fQklORF9TVEFSVCwgQVVUT19CSU5EX0VORF0gYXMgY29uc3QpO1xyXG5cclxuICAgIGxldCB1cGRhdGVkID0gcmVwbGFjZUJsb2NrKGV4aXN0aW5nLCBiaW5kTWFya2Vyc1swXSwgYmluZE1hcmtlcnNbMV0sIGJpbmRCbG9jayk7XHJcbiAgICB1cGRhdGVkID0gdXBkYXRlZC5yZXBsYWNlKGJpbmRNYXJrZXJzWzBdLCBBVVRPX0JJTkRfU1RBUlQpLnJlcGxhY2UoYmluZE1hcmtlcnNbMV0sIEFVVE9fQklORF9FTkQpO1xyXG5cclxuICAgIGNvbnN0IHVwZGF0ZWRCbG9ja3MgPSByZXBsYWNlQmxvY2soXHJcbiAgICAgICAgcmVwbGFjZUJsb2NrKFxyXG4gICAgICAgICAgICB1cGRhdGVkLFxyXG4gICAgICAgICAgICBBVVRPX0JVVFRPTl9FVkVOVF9TVEFSVCxcclxuICAgICAgICAgICAgQVVUT19CVVRUT05fRVZFTlRfRU5ELFxyXG4gICAgICAgICAgICBldmVudEJsb2NrLFxyXG4gICAgICAgICksXHJcbiAgICAgICAgQVVUT19CVVRUT05fSEFORExFUl9TVEFSVCxcclxuICAgICAgICBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCxcclxuICAgICAgICBoYW5kbGVyQmxvY2ssXHJcbiAgICApO1xyXG5cclxuICAgIHJldHVybiBtZXJnZUNjSW1wb3J0cyh1cGRhdGVkQmxvY2tzLCBnZW5lcmF0ZWQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNBbGxBdXRvQmxvY2tzKHNvdXJjZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gKGhhc0Jsb2NrKHNvdXJjZSwgQVVUT19CSU5EX1NUQVJULCBBVVRPX0JJTkRfRU5EKSB8fCBoYXNCbG9jayhzb3VyY2UsIExFR0FDWV9BVVRPX0JJTkRfU1RBUlQsIExFR0FDWV9BVVRPX0JJTkRfRU5EKSlcclxuICAgICAgICAmJiBoYXNCbG9jayhzb3VyY2UsIEFVVE9fQlVUVE9OX0VWRU5UX1NUQVJULCBBVVRPX0JVVFRPTl9FVkVOVF9FTkQpXHJcbiAgICAgICAgJiYgaGFzQmxvY2soc291cmNlLCBBVVRPX0JVVFRPTl9IQU5ETEVSX1NUQVJULCBBVVRPX0JVVFRPTl9IQU5ETEVSX0VORCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldEV4aXN0aW5nQmxvY2tNYXJrZXJzKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZyk6IHJlYWRvbmx5IFtzdHJpbmcsIHN0cmluZ10gfCBudWxsIHtcclxuICAgIHJldHVybiBoYXNCbG9jayhzb3VyY2UsIHN0YXJ0LCBlbmQpID8gW3N0YXJ0LCBlbmRdIDogbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gc291cmNlLmluY2x1ZGVzKHN0YXJ0KSAmJiBzb3VyY2UuaW5jbHVkZXMoZW5kKSAmJiBzb3VyY2UuaW5kZXhPZihzdGFydCkgPCBzb3VyY2UuaW5kZXhPZihlbmQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBwaWNrQmxvY2soc291cmNlOiBzdHJpbmcsIHN0YXJ0OiBzdHJpbmcsIGVuZDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHN0YXJ0SW5kZXggPSBzb3VyY2UuaW5kZXhPZihzdGFydCk7XHJcbiAgICBjb25zdCBlbmRJbmRleCA9IHNvdXJjZS5pbmRleE9mKGVuZCk7XHJcbiAgICByZXR1cm4gc291cmNlLnNsaWNlKHN0YXJ0SW5kZXggKyBzdGFydC5sZW5ndGgsIGVuZEluZGV4KTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVwbGFjZUJsb2NrKHNvdXJjZTogc3RyaW5nLCBzdGFydDogc3RyaW5nLCBlbmQ6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gc291cmNlLmluZGV4T2Yoc3RhcnQpO1xuICAgIGNvbnN0IGVuZEluZGV4ID0gc291cmNlLmluZGV4T2YoZW5kKTtcbiAgICByZXR1cm4gYCR7c291cmNlLnNsaWNlKDAsIHN0YXJ0SW5kZXggKyBzdGFydC5sZW5ndGgpfSR7Y29udGVudH0ke3NvdXJjZS5zbGljZShlbmRJbmRleCl9YDtcbn1cblxuZnVuY3Rpb24gbWVyZ2VCdXR0b25IYW5kbGVyQmxvY2soZXhpc3RpbmdCbG9jazogc3RyaW5nLCBnZW5lcmF0ZWRCbG9jazogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBleGlzdGluZ0hhbmRsZXJzID0gbmV3IE1hcChwYXJzZUJ1dHRvbkhhbmRsZXJzKGV4aXN0aW5nQmxvY2spLm1hcCgoaGFuZGxlcikgPT4gW2hhbmRsZXIubmFtZSwgaGFuZGxlci5zb3VyY2VdKSk7XG4gICAgY29uc3QgZ2VuZXJhdGVkSGFuZGxlcnMgPSBwYXJzZUJ1dHRvbkhhbmRsZXJzKGdlbmVyYXRlZEJsb2NrKTtcblxuICAgIGlmIChnZW5lcmF0ZWRIYW5kbGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlZEJsb2NrO1xuICAgIH1cblxuICAgIGNvbnN0IG1lcmdlZEhhbmRsZXJzID0gZ2VuZXJhdGVkSGFuZGxlcnNcbiAgICAgICAgLm1hcCgoaGFuZGxlcikgPT4gbm9ybWFsaXplQnV0dG9uSGFuZGxlclNvdXJjZShleGlzdGluZ0hhbmRsZXJzLmdldChoYW5kbGVyLm5hbWUpIHx8IGhhbmRsZXIuc291cmNlKSlcbiAgICAgICAgLmpvaW4oJ1xcblxcbicpO1xuXG4gICAgcmV0dXJuIGBcXG4ke21lcmdlZEhhbmRsZXJzfVxcbiAgICBgO1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVCdXR0b25IYW5kbGVyU291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBsaW5lcyA9IHNvdXJjZS50cmltKCkuc3BsaXQoL1xccj9cXG4vKTtcbiAgICByZXR1cm4gbGluZXMubWFwKChsaW5lLCBpbmRleCkgPT4ge1xuICAgICAgICBpZiAoaW5kZXggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBgICAgICR7bGluZS50cmltU3RhcnQoKX1gO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBsaW5lLnRyaW1FbmQoKTtcbiAgICB9KS5qb2luKCdcXG4nKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCdXR0b25IYW5kbGVycyhibG9jazogc3RyaW5nKTogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHNvdXJjZTogc3RyaW5nIH0+IHtcbiAgICBjb25zdCByZXN1bHQ6IEFycmF5PHsgbmFtZTogc3RyaW5nOyBzb3VyY2U6IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IG1ldGhvZFBhdHRlcm4gPSAvKD86cHJpdmF0ZXxwcm90ZWN0ZWR8cHVibGljKT9cXHMqKFtBLVphLXpfJF1bQS1aYS16MC05XyRdKilcXHMqXFwoW14pXSpcXClcXHMqOlxccyp2b2lkXFxzKlxcey9nO1xuICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSBtZXRob2RQYXR0ZXJuLmV4ZWMoYmxvY2spKSkge1xuICAgICAgICBjb25zdCBuYW1lID0gbWF0Y2hbMV07XG4gICAgICAgIGNvbnN0IG1ldGhvZFN0YXJ0ID0gbWF0Y2guaW5kZXg7XG4gICAgICAgIGNvbnN0IGJvZHlPcGVuSW5kZXggPSBtZXRob2RQYXR0ZXJuLmxhc3RJbmRleCAtIDE7XG4gICAgICAgIGNvbnN0IG1ldGhvZEVuZCA9IGZpbmRNYXRjaGluZ0JyYWNlKGJsb2NrLCBib2R5T3BlbkluZGV4KTtcbiAgICAgICAgaWYgKG1ldGhvZEVuZCA9PT0gLTEpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzdWx0LnB1c2goe1xuICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgIHNvdXJjZTogYmxvY2suc2xpY2UobWV0aG9kU3RhcnQsIG1ldGhvZEVuZCArIDEpLnRyaW1FbmQoKSxcbiAgICAgICAgfSk7XG4gICAgICAgIG1ldGhvZFBhdHRlcm4ubGFzdEluZGV4ID0gbWV0aG9kRW5kICsgMTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBmaW5kTWF0Y2hpbmdCcmFjZShzb3VyY2U6IHN0cmluZywgb3BlbkluZGV4OiBudW1iZXIpOiBudW1iZXIge1xuICAgIGxldCBkZXB0aCA9IDA7XG4gICAgbGV0IHF1b3RlOiAnXCInIHwgXCInXCIgfCAnYCcgfCBudWxsID0gbnVsbDtcbiAgICBsZXQgZXNjYXBlZCA9IGZhbHNlO1xuXG4gICAgZm9yIChsZXQgaW5kZXggPSBvcGVuSW5kZXg7IGluZGV4IDwgc291cmNlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICBjb25zdCBjaGFyID0gc291cmNlW2luZGV4XTtcblxuICAgICAgICBpZiAocXVvdGUpIHtcbiAgICAgICAgICAgIGlmIChlc2NhcGVkKSB7XG4gICAgICAgICAgICAgICAgZXNjYXBlZCA9IGZhbHNlO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChjaGFyID09PSAnXFxcXCcpIHtcbiAgICAgICAgICAgICAgICBlc2NhcGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoY2hhciA9PT0gcXVvdGUpIHtcbiAgICAgICAgICAgICAgICBxdW90ZSA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjaGFyID09PSAnXCInIHx8IGNoYXIgPT09IFwiJ1wiIHx8IGNoYXIgPT09ICdgJykge1xuICAgICAgICAgICAgcXVvdGUgPSBjaGFyO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2hhciA9PT0gJ3snKSB7XG4gICAgICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICB9IGVsc2UgaWYgKGNoYXIgPT09ICd9Jykge1xuICAgICAgICAgICAgZGVwdGggLT0gMTtcbiAgICAgICAgICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBpbmRleDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAtMTtcbn1cblxuZnVuY3Rpb24gbWVyZ2VDY0ltcG9ydHMoZXhpc3Rpbmc6IHN0cmluZywgZ2VuZXJhdGVkOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGltcG9ydFBhdHRlcm4gPSAvXmltcG9ydFxccytcXHtcXHMqKFtefV0rPylcXHMqXFx9XFxzK2Zyb21cXHMrWydcIl1jY1snXCJdO1xccyokL207XHJcbiAgICBjb25zdCBleGlzdGluZ01hdGNoID0gZXhpc3RpbmcubWF0Y2goaW1wb3J0UGF0dGVybik7XHJcbiAgICBjb25zdCBnZW5lcmF0ZWRNYXRjaCA9IGdlbmVyYXRlZC5tYXRjaChpbXBvcnRQYXR0ZXJuKTtcclxuXHJcbiAgICBpZiAoIWdlbmVyYXRlZE1hdGNoKSB7XHJcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghZXhpc3RpbmdNYXRjaCkge1xyXG4gICAgICAgIHJldHVybiBgJHtnZW5lcmF0ZWRNYXRjaFswXX1cXG4ke2V4aXN0aW5nfWA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbWVyZ2VkID0gc29ydENjSW1wb3J0cyhbXG4gICAgICAgIC4uLnBhcnNlQ2NJbXBvcnROYW1lcyhleGlzdGluZ01hdGNoWzFdKSxcbiAgICAgICAgLi4ucGFyc2VDY0ltcG9ydE5hbWVzKGdlbmVyYXRlZE1hdGNoWzFdKSxcbiAgICAgICAgLi4uZGV0ZWN0VXNlZENjU3ltYm9scyhleGlzdGluZyksXG4gICAgXSk7XG5cbiAgICByZXR1cm4gZXhpc3RpbmcucmVwbGFjZShpbXBvcnRQYXR0ZXJuLCBgaW1wb3J0IHsgJHttZXJnZWQuam9pbignLCAnKX0gfSBmcm9tICdjYyc7YCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ2NJbXBvcnROYW1lcyhpbXBvcnRzOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIGltcG9ydHNcclxuICAgICAgICAuc3BsaXQoJywnKVxyXG4gICAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0udHJpbSgpKVxuICAgICAgICAuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBkZXRlY3RVc2VkQ2NTeW1ib2xzKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXG4gICAgICAgICdOb2RlJyxcbiAgICAgICAgJ0J1dHRvbicsXG4gICAgICAgICdMYWJlbCcsXG4gICAgICAgICdTcHJpdGUnLFxuICAgICAgICAnV2lkZ2V0JyxcbiAgICAgICAgJ1VJVHJhbnNmb3JtJyxcbiAgICAgICAgJ1Byb2dyZXNzQmFyJyxcbiAgICAgICAgJ1Njcm9sbFZpZXcnLFxuICAgICAgICAnVG9nZ2xlJyxcbiAgICAgICAgJ1NsaWRlcicsXG4gICAgICAgICdFZGl0Qm94JyxcbiAgICAgICAgJ1JpY2hUZXh0JyxcbiAgICBdO1xuXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuZmlsdGVyKChuYW1lKSA9PiBuZXcgUmVnRXhwKGBcXFxcYiR7bmFtZX1cXFxcYmApLnRlc3Qoc291cmNlKSk7XG59XG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZEFzc2V0VGV4dCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcclxuICAgIGlmICghYXNzZXQ/LmZpbGUpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFzc2V0LmZpbGUsICd1dGY4Jyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHdyaXRlQXNzZXQodXJsOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nLCBjcmVhdGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoY3JlYXRlZCkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2Fzc2V0LWRiJywgJ2NyZWF0ZS1hc3NldCcsIHVybCwgc291cmNlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnYXNzZXQtZGInLCAnc2F2ZS1hc3NldCcsIHVybCwgc291cmNlKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gdHJ5QXR0YWNoQ29tcG9uZW50KG5vZGVVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgaWYgKGF3YWl0IGZpbmRDb21wb25lbnRVdWlkKG5vZGVVdWlkLCBjbGFzc05hbWUpKSB7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVnaXN0ZXJlZENhbmRpZGF0ZXMgPSBhd2FpdCB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWUsIHNjcmlwdFVybCk7XHJcbiAgICBpZiAocmVnaXN0ZXJlZENhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBTY3JpcHQgY29tcG9uZW50ICR7Y2xhc3NOYW1lfSB3YXMgbm90IHJlZ2lzdGVyZWQgeWV0LiBUcnlpbmcgdG8gYXR0YWNoIGFueXdheS5gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb21wb25lbnRDYW5kaWRhdGVzID0gWy4uLm5ldyBTZXQoW1xyXG4gICAgICAgIGNsYXNzTmFtZSxcclxuICAgICAgICBub3JtYWxpemVDbGFzc05hbWUoY2xhc3NOYW1lKSxcclxuICAgICAgICAuLi5yZWdpc3RlcmVkQ2FuZGlkYXRlcyxcclxuICAgIF0uZmlsdGVyKEJvb2xlYW4pKV07XHJcblxyXG4gICAgZm9yIChjb25zdCBjb21wb25lbnROYW1lIG9mIGNvbXBvbmVudENhbmRpZGF0ZXMpIHtcclxuICAgICAgICBpZiAoYXdhaXQgY3JlYXRlQ29tcG9uZW50QW5kVmVyaWZ5KG5vZGVVdWlkLCBjb21wb25lbnROYW1lLCBjb21wb25lbnRDYW5kaWRhdGVzKSkge1xyXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yU2NyaXB0Q29tcG9uZW50Q2FuZGlkYXRlcyhjbGFzc05hbWU6IHN0cmluZywgc2NyaXB0VXJsOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XHJcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyAxMjAwMDtcclxuICAgIGNvbnN0IHNjcmlwdEFzc2V0ID0gYXdhaXQgcXVlcnlBc3NldEluZm9TYWZlKHNjcmlwdFVybCk7XHJcbiAgICBjb25zdCBjYWNoZWRDaWQgPSByZWFkU2NyaXB0Q2lkRnJvbVByb2dyYW1DYWNoZShzY3JpcHRBc3NldCwgY2xhc3NOYW1lKTtcclxuICAgIGxldCBsb2dnZWQgPSBmYWxzZTtcclxuXHJcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHF1ZXJ5UmVnaXN0ZXJlZFNjcmlwdENvbXBvbmVudENhbmRpZGF0ZXMoY2xhc3NOYW1lLCBzY3JpcHRBc3NldCk7XHJcbiAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQoWy4uLmNhbmRpZGF0ZXMsIC4uLmNhY2hlZENpZF0pXTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmICghbG9nZ2VkKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbJHtQQUNLQUdFX05BTUV9XSBXYWl0aW5nIGZvciBzY3JpcHQgaW1wb3J0OiAke2NsYXNzTmFtZX1gKTtcclxuICAgICAgICAgICAgbG9nZ2VkID0gdHJ1ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IGRlbGF5KDUwMCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNhY2hlZENpZDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcXVlcnlBc3NldEluZm9TYWZlKHVybDogc3RyaW5nKTogUHJvbWlzZTxhbnkgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgdXJsKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBxdWVyeVJlZ2lzdGVyZWRTY3JpcHRDb21wb25lbnRDYW5kaWRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRBc3NldDogYW55IHwgbnVsbCk6IFByb21pc2U8c3RyaW5nW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50cyA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudHMnKTtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoY29tcG9uZW50cykpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qgc2NyaXB0VXVpZCA9IHNjcmlwdEFzc2V0Py51dWlkID8gU3RyaW5nKHNjcmlwdEFzc2V0LnV1aWQpIDogJyc7XHJcbiAgICAgICAgY29uc3Qgc2NyaXB0VXJsID0gc2NyaXB0QXNzZXQ/LnVybCA/IFN0cmluZyhzY3JpcHRBc3NldC51cmwpIDogJyc7XHJcbiAgICAgICAgY29uc3Qgc2NyaXB0RmlsZSA9IHNjcmlwdEFzc2V0Py5maWxlID8gU3RyaW5nKHNjcmlwdEFzc2V0LmZpbGUpLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA6ICcnO1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdDogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgICAgICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xyXG4gICAgICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5uYW1lLFxyXG4gICAgICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/LnBhdGgsXHJcbiAgICAgICAgICAgICAgICBjb21wb25lbnQ/LmFzc2V0VXVpZCxcclxuICAgICAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgbWF0Y2hlZCA9IGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIGNsYXNzTmFtZSkpXHJcbiAgICAgICAgICAgICAgICB8fCBCb29sZWFuKHNjcmlwdFV1aWQgJiYgY2FuZGlkYXRlcy5pbmNsdWRlcyhzY3JpcHRVdWlkKSlcclxuICAgICAgICAgICAgICAgIHx8IEJvb2xlYW4oc2NyaXB0VXJsICYmIGNhbmRpZGF0ZXMuaW5jbHVkZXMoc2NyaXB0VXJsKSlcclxuICAgICAgICAgICAgICAgIHx8IEJvb2xlYW4oc2NyaXB0RmlsZSAmJiBjYW5kaWRhdGVzLnNvbWUoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLnJlcGxhY2UoL1xcXFwvZywgJy8nKSA9PT0gc2NyaXB0RmlsZSkpO1xyXG5cclxuICAgICAgICAgICAgaWYgKG1hdGNoZWQpIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKC4uLmNhbmRpZGF0ZXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0LmZpbHRlcigoY2FuZGlkYXRlKSA9PiBpc0NvbXBvbmVudEF0dGFjaENhbmRpZGF0ZShjYW5kaWRhdGUpKSldO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIEZhaWxlZCB0byBxdWVyeSByZWdpc3RlcmVkIGNvbXBvbmVudHMuYCwgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxufVxyXG5cclxuZnVuY3Rpb24gaXNDb21wb25lbnRBdHRhY2hDYW5kaWRhdGUoY2FuZGlkYXRlOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAvXltBLVphLXowLTlfJC4vOkAtXSskLy50ZXN0KGNhbmRpZGF0ZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWRTY3JpcHRDaWRGcm9tUHJvZ3JhbUNhY2hlKHNjcmlwdEFzc2V0OiBhbnkgfCBudWxsLCBjbGFzc05hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICAgIGlmICghc2NyaXB0QXNzZXQ/LmZpbGUpIHtcclxuICAgICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc291cmNlVXJsID0gYGZpbGU6Ly8vJHtTdHJpbmcoc2NyaXB0QXNzZXQuZmlsZSkucmVwbGFjZSgvXFxcXC9nLCAnLycpfWA7XHJcbiAgICBjb25zdCByZXN1bHQ6IHN0cmluZ1tdID0gW107XHJcbiAgICBjb25zdCB0YXJnZXRzID0gW1xyXG4gICAgICAgIGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ3RlbXAnLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ2VkaXRvcicpLFxyXG4gICAgICAgIGpvaW4oRWRpdG9yLlByb2plY3QucGF0aCwgJ3RlbXAnLCAncHJvZ3JhbW1pbmcnLCAncGFja2VyLWRyaXZlcicsICd0YXJnZXRzJywgJ3ByZXZpZXcnKSxcclxuICAgIF07XHJcblxyXG4gICAgZm9yIChjb25zdCB0YXJnZXREaXIgb2YgdGFyZ2V0cykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGltcG9ydE1hcFBhdGggPSBqb2luKHRhcmdldERpciwgJ2ltcG9ydC1tYXAuanNvbicpO1xyXG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoaW1wb3J0TWFwUGF0aCkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBpbXBvcnRNYXAgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhpbXBvcnRNYXBQYXRoLCAndXRmOCcpKTtcclxuICAgICAgICAgICAgY29uc3QgY2h1bmtSZWxhdGl2ZSA9IGltcG9ydE1hcD8uaW1wb3J0cz8uW3NvdXJjZVVybF0gfHwgaW1wb3J0TWFwPy5bc291cmNlVXJsXTtcclxuICAgICAgICAgICAgaWYgKCFjaHVua1JlbGF0aXZlKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgY2h1bmtGaWxlID0gam9pbih0YXJnZXREaXIsIFN0cmluZyhjaHVua1JlbGF0aXZlKS5yZXBsYWNlKC9eXFwuXFwvLywgJycpKTtcclxuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGNodW5rRmlsZSkpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBjaHVua1NvdXJjZSA9IHJlYWRGaWxlU3luYyhjaHVua0ZpbGUsICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IGVzY2FwZWRDbGFzc05hbWUgPSBjbGFzc05hbWUucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcclxuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBjaHVua1NvdXJjZS5tYXRjaChuZXcgUmVnRXhwKGBfUkZcXFxcLnB1c2hcXFxcKFxcXFx7XFxcXH0sXFxcXHMqW1wiJ10oW15cIiddKylbXCInXSxcXFxccypbXCInXSR7ZXNjYXBlZENsYXNzTmFtZX1bXCInXWApKTtcclxuICAgICAgICAgICAgaWYgKG1hdGNoPy5bMV0pIHtcclxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG1hdGNoWzFdKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIHJlYWQgc2NyaXB0IGNpZCBmcm9tIHByb2dyYW0gY2FjaGUuYCwgZXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gWy4uLm5ldyBTZXQocmVzdWx0KV07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbXBvbmVudEFuZFZlcmlmeShub2RlVXVpZDogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcsIG1hdGNoTmFtZXM6IHN0cmluZ1tdKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XHJcbiAgICAgICAgICAgIHV1aWQ6IG5vZGVVdWlkLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ6IGNvbXBvbmVudE5hbWUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYXdhaXQgZGVsYXkoMTAwKTtcclxuICAgICAgICBpZiAoYXdhaXQgZmluZENvbXBvbmVudFV1aWQobm9kZVV1aWQsIG1hdGNoTmFtZXMpKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIGNyZWF0ZS1jb21wb25lbnQgcmV0dXJuZWQgYnV0ICR7Y29tcG9uZW50TmFtZX0gd2FzIG5vdCBmb3VuZCBvbiB0aGUgbm9kZS5gKTtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGF0dGFjaCBjb21wb25lbnQgJHtjb21wb25lbnROYW1lfS5gLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVDbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGNsYXNzTmFtZS5yZXBsYWNlKC9bXkEtWmEtejAtOV8kXFxwe0lEX1N0YXJ0fVxccHtJRF9Db250aW51ZX1cXHUyMDBDXFx1MjAwRF0vZ3UsICdfJyk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGJpbmRDb21wb25lbnRQcm9wZXJ0aWVzKG5vZGVVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCBzY3JpcHRVcmw6IHN0cmluZywgYmluZGluZ3M6IFNjYW5uZWRCaW5kaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xyXG4gICAgY29uc3Qgc2NyaXB0QXNzZXQgPSBhd2FpdCBxdWVyeUFzc2V0SW5mb1NhZmUoc2NyaXB0VXJsKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudFV1aWQgPSBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZCwgZ2V0U2VyaWFsaXplZFNjcmlwdFR5cGVOYW1lcyhzY3JpcHRBc3NldCwgY2xhc3NOYW1lKSk7XHJcbiAgICBpZiAoIWNvbXBvbmVudFV1aWQpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYFske1BBQ0tBR0VfTkFNRX1dIENhbm5vdCBmaW5kIGNvbXBvbmVudCAke2NsYXNzTmFtZX0gZm9yIHByb3BlcnR5IGJpbmRpbmcuYCk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29tcG9uZW50RHVtcCA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LWNvbXBvbmVudCcsIGNvbXBvbmVudFV1aWQpO1xyXG4gICAgbGV0IGJvdW5kQ291bnQgPSAwO1xyXG5cclxuICAgIGZvciAoY29uc3QgYmluZGluZyBvZiBiaW5kaW5ncykge1xyXG4gICAgICAgIGNvbnN0IHByb3BlcnR5RHVtcCA9IGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wLCBiaW5kaW5nLnByb3BlcnR5TmFtZSk7XHJcbiAgICAgICAgaWYgKCFwcm9wZXJ0eUR1bXApIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCBwcm9wZXJ0eSBkdW1wICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9LmApO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHRhcmdldFV1aWQgPSBiaW5kaW5nLmJpbmRUYXJnZXQgPT09ICdub2RlJ1xyXG4gICAgICAgICAgICA/IGJpbmRpbmcubm9kZVV1aWRcclxuICAgICAgICAgICAgOiBhd2FpdCBmaW5kQ29tcG9uZW50VXVpZChiaW5kaW5nLm5vZGVVdWlkLCBiaW5kaW5nLmNvbXBvbmVudFR5cGUgfHwgYmluZGluZy5wcm9wZXJ0eVR5cGUpO1xyXG5cclxuICAgICAgICBpZiAoIXRhcmdldFV1aWQpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBDYW5ub3QgZmluZCB0YXJnZXQgZm9yICR7YmluZGluZy5wcm9wZXJ0eU5hbWV9LmApO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChhd2FpdCBzZXRSZWZlcmVuY2VQcm9wZXJ0eShjb21wb25lbnRVdWlkLCBiaW5kaW5nLnByb3BlcnR5TmFtZSwgcHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKSkge1xyXG4gICAgICAgICAgICBib3VuZENvdW50ICs9IDE7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBib3VuZENvdW50O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBmaW5kQ29tcG9uZW50VXVpZChub2RlVXVpZDogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcgfCBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xyXG4gICAgY29uc3Qgbm9kZSA9IGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3F1ZXJ5LW5vZGUnLCBub2RlVXVpZCk7XHJcbiAgICBjb25zdCBjb21wb25lbnRzID0gQXJyYXkuaXNBcnJheShub2RlPy5fX2NvbXBzX18pID8gbm9kZS5fX2NvbXBzX18gOiBbXTtcclxuICAgIGNvbnN0IGNvbXBvbmVudE5hbWVzID0gQXJyYXkuaXNBcnJheShjb21wb25lbnROYW1lKSA/IGNvbXBvbmVudE5hbWUgOiBbY29tcG9uZW50TmFtZV07XHJcblxyXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgY29tcG9uZW50cykge1xyXG4gICAgICAgIGNvbnN0IGNvbXBvbmVudEFueSA9IGNvbXBvbmVudCBhcyBhbnk7XHJcbiAgICAgICAgY29uc3QgdXVpZCA9IFN0cmluZyhyZWFkRHVtcFZhbHVlKGNvbXBvbmVudEFueT8udmFsdWU/LnV1aWQpIHx8IHJlYWREdW1wVmFsdWUoY29tcG9uZW50QW55Py51dWlkKSB8fCAnJyk7XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py50eXBlLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudEFueT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5uYW1lLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy5fX3R5cGVfXyxcclxuICAgICAgICAgICAgY29tcG9uZW50QW55Py52YWx1ZT8uY2lkLFxyXG4gICAgICAgICAgICBjb21wb25lbnRBbnk/LnZhbHVlPy50eXBlLFxyXG4gICAgICAgIF0ubWFwKHJlYWREdW1wVmFsdWUpLmZpbHRlcihCb29sZWFuKS5tYXAoU3RyaW5nKTtcclxuXHJcbiAgICAgICAgaWYgKGNhbmRpZGF0ZXMuc29tZSgoY2FuZGlkYXRlKSA9PiBjb21wb25lbnROYW1lcy5zb21lKChuYW1lKSA9PiBtYXRjaGVzQ29tcG9uZW50TmFtZShjYW5kaWRhdGUsIG5hbWUpKSkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHV1aWQgfHwgbnVsbDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFByb3BlcnR5RHVtcChjb21wb25lbnREdW1wOiBhbnksIHByb3BlcnR5TmFtZTogc3RyaW5nKTogYW55IHwgbnVsbCB7XHJcbiAgICBjb25zdCBkdW1wID0gY29tcG9uZW50RHVtcD8udmFsdWU/Lltwcm9wZXJ0eU5hbWVdIHx8IGNvbXBvbmVudER1bXA/Lltwcm9wZXJ0eU5hbWVdO1xyXG4gICAgcmV0dXJuIGR1bXAgJiYgdHlwZW9mIGR1bXAgPT09ICdvYmplY3QnID8gZHVtcCA6IG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHNldFJlZmVyZW5jZVByb3BlcnR5KGNvbXBvbmVudFV1aWQ6IHN0cmluZywgcHJvcGVydHlOYW1lOiBzdHJpbmcsIHByb3BlcnR5RHVtcDogYW55LCB0YXJnZXRVdWlkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wLCB0YXJnZXRVdWlkKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGR1bXAgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ3NldC1wcm9wZXJ0eScsIHtcclxuICAgICAgICAgICAgICAgIHV1aWQ6IGNvbXBvbmVudFV1aWQsXHJcbiAgICAgICAgICAgICAgICBwYXRoOiBwcm9wZXJ0eU5hbWUsXHJcbiAgICAgICAgICAgICAgICBkdW1wLFxyXG4gICAgICAgICAgICAgICAgcmVjb3JkOiB0cnVlLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGBbJHtQQUNLQUdFX05BTUV9XSBGYWlsZWQgdG8gYmluZCAke3Byb3BlcnR5TmFtZX0gd2l0aCBvbmUgcmVmZXJlbmNlIGR1bXAgY2FuZGlkYXRlLmAsIGVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG5mdW5jdGlvbiBtYWtlUmVmZXJlbmNlRHVtcENhbmRpZGF0ZXMocHJvcGVydHlEdW1wOiBhbnksIHRhcmdldFV1aWQ6IHN0cmluZyk6IGFueVtdIHtcclxuICAgIGNvbnN0IGJhc2UgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHByb3BlcnR5RHVtcCkpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlczogYW55W10gPSBbXTtcclxuXHJcbiAgICBjYW5kaWRhdGVzLnB1c2goe1xyXG4gICAgICAgIC4uLmJhc2UsXHJcbiAgICAgICAgdmFsdWU6IHtcclxuICAgICAgICAgICAgdXVpZDogdGFyZ2V0VXVpZCxcclxuICAgICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcclxuICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgIHZhbHVlOiB0YXJnZXRVdWlkLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY2FuZGlkYXRlcy5wdXNoKHtcclxuICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgICAgIF9fdXVpZF9fOiB0YXJnZXRVdWlkLFxyXG4gICAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoYmFzZS52YWx1ZSAmJiB0eXBlb2YgYmFzZS52YWx1ZSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICBjYW5kaWRhdGVzLnVuc2hpZnQoe1xyXG4gICAgICAgICAgICAuLi5iYXNlLFxyXG4gICAgICAgICAgICB2YWx1ZToge1xyXG4gICAgICAgICAgICAgICAgLi4uYmFzZS52YWx1ZSxcclxuICAgICAgICAgICAgICAgIHV1aWQ6IHRhcmdldFV1aWQsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXM7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGJpbmRTZXJpYWxpemVkQXNzZXRSZWZlcmVuY2VzKG9wZW5lZEFzc2V0VXJsOiBzdHJpbmcgfCBudWxsLCBzY3JpcHRVcmw6IHN0cmluZywgc2VsZWN0ZWRVdWlkOiBzdHJpbmcsIGNsYXNzTmFtZTogc3RyaW5nLCByb290TmFtZTogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IFByb21pc2U8bnVtYmVyPiB7XHJcbiAgICBpZiAoIW9wZW5lZEFzc2V0VXJsKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYXNzZXQgPSBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdhc3NldC1kYicsICdxdWVyeS1hc3NldC1pbmZvJywgb3BlbmVkQXNzZXRVcmwpO1xyXG4gICAgaWYgKCFhc3NldD8uZmlsZSB8fCAhL1xcLihwcmVmYWJ8c2NlbmUpJC9pLnRlc3QoYXNzZXQuZmlsZSkpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVhZEpzb25GaWxlV2l0aFJldHJ5KGFzc2V0LmZpbGUpO1xyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGRhdGEpKSB7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm9kZUlkQnlVdWlkID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcclxuICAgIGNvbnN0IG5vZGVJZEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XHJcbiAgICBjb25zdCBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcclxuICAgIGNvbnN0IGNvbXBvbmVudElkQnlOb2RlTmFtZUFuZFR5cGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xyXG5cclxuICAgIGRhdGEuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcclxuICAgICAgICBpZiAoaXRlbT8uX190eXBlX18gPT09ICdjYy5Ob2RlJykge1xyXG4gICAgICAgICAgICBjb25zdCBub2RlVXVpZCA9IGl0ZW0/Ll9pZCB8fCBpdGVtPy5fdXVpZCB8fCAnJztcclxuICAgICAgICAgICAgaWYgKG5vZGVVdWlkKSB7XHJcbiAgICAgICAgICAgICAgICBub2RlSWRCeVV1aWQuc2V0KG5vZGVVdWlkLCBpbmRleCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBpdGVtPy5fbmFtZSA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgICAgIG5vZGVJZEJ5TmFtZS5zZXQoaXRlbS5fbmFtZSwgaW5kZXgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZGF0YS5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGl0ZW0/Lm5vZGU/Ll9faWRfXztcclxuICAgICAgICBjb25zdCBub2RlID0gTnVtYmVyLmlzSW50ZWdlcihub2RlSWQpID8gZGF0YVtub2RlSWRdIDogbnVsbDtcclxuICAgICAgICBjb25zdCBub2RlVXVpZCA9IG5vZGU/Ll9pZCB8fCBub2RlPy5fdXVpZCB8fCAnJztcclxuICAgICAgICBjb25zdCBub2RlTmFtZSA9IG5vZGU/Ll9uYW1lIHx8ICcnO1xyXG4gICAgICAgIGlmICh0eXBlb2YgaXRlbT8uX190eXBlX18gIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChub2RlVXVpZCkge1xyXG4gICAgICAgICAgICBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLnNldChgJHtub2RlVXVpZH06JHtpdGVtLl9fdHlwZV9ffWAsIGluZGV4KTtcclxuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVVdWlkQW5kVHlwZS5zZXQoYCR7bm9kZVV1aWR9OiR7c2hvcnRUeXBlTmFtZShpdGVtLl9fdHlwZV9fKX1gLCBpbmRleCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAobm9kZU5hbWUpIHtcclxuICAgICAgICAgICAgY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5zZXQoYCR7bm9kZU5hbWV9OiR7aXRlbS5fX3R5cGVfX31gLCBpbmRleCk7XHJcbiAgICAgICAgICAgIGNvbXBvbmVudElkQnlOb2RlTmFtZUFuZFR5cGUuc2V0KGAke25vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXyl9YCwgaW5kZXgpO1xyXG4gICAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlbGVjdGVkTm9kZUlkID0gbm9kZUlkQnlVdWlkLmdldChzZWxlY3RlZFV1aWQpID8/IG5vZGVJZEJ5TmFtZS5nZXQocm9vdE5hbWUpO1xyXG4gICAgaWYgKHNlbGVjdGVkTm9kZUlkID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzY3JpcHRBc3NldCA9IGF3YWl0IHF1ZXJ5QXNzZXRJbmZvU2FmZShzY3JpcHRVcmwpO1xyXG4gICAgY29uc3Qgc2NyaXB0VHlwZU5hbWVzID0gZ2V0U2VyaWFsaXplZFNjcmlwdFR5cGVOYW1lcyhzY3JpcHRBc3NldCwgY2xhc3NOYW1lKTtcclxuICAgIGxldCB0YXJnZXRDb21wb25lbnQgPSBkYXRhLmZpbmQoKGl0ZW0pID0+IHtcclxuICAgICAgICBpZiAodHlwZW9mIGl0ZW0/Ll9fdHlwZV9fICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBub2RlSWQgPSBpdGVtPy5ub2RlPy5fX2lkX187XHJcbiAgICAgICAgY29uc3Qgbm9kZSA9IE51bWJlci5pc0ludGVnZXIobm9kZUlkKSA/IGRhdGFbbm9kZUlkXSA6IG51bGw7XHJcbiAgICAgICAgY29uc3QgYXR0YWNoZWRUb1NlbGVjdGVkTm9kZSA9IG5vZGVJZCA9PT0gc2VsZWN0ZWROb2RlSWQgfHwgbm9kZT8uX25hbWUgPT09IHJvb3ROYW1lO1xyXG4gICAgICAgIGNvbnN0IGhhc0dlbmVyYXRlZFByb3BlcnR5ID0gYmluZGluZ3Muc29tZSgoYmluZGluZykgPT4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGl0ZW0sIGJpbmRpbmcucHJvcGVydHlOYW1lKSk7XHJcblxyXG4gICAgICAgIHJldHVybiBzY3JpcHRUeXBlTmFtZXMuaW5jbHVkZXMoaXRlbS5fX3R5cGVfXylcclxuICAgICAgICAgICAgfHwgaXRlbS5fX3R5cGVfXyA9PT0gY2xhc3NOYW1lXHJcbiAgICAgICAgICAgIHx8IHNob3J0VHlwZU5hbWUoaXRlbS5fX3R5cGVfXykgPT09IGNsYXNzTmFtZVxyXG4gICAgICAgICAgICB8fCAoYXR0YWNoZWRUb1NlbGVjdGVkTm9kZSAmJiBoYXNHZW5lcmF0ZWRQcm9wZXJ0eSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoIXRhcmdldENvbXBvbmVudCkge1xyXG4gICAgICAgIHRhcmdldENvbXBvbmVudCA9IGFwcGVuZFNlcmlhbGl6ZWRTY3JpcHRDb21wb25lbnQoZGF0YSwgc2VsZWN0ZWROb2RlSWQsIHNjcmlwdFR5cGVOYW1lc1swXSB8fCBjbGFzc05hbWUsIGJpbmRpbmdzKTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgYm91bmRDb3VudCA9IDA7XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgaWYgKGJpbmRpbmcuYmluZFRhcmdldCA9PT0gJ25vZGUnKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG5vZGVJZCA9IG5vZGVJZEJ5VXVpZC5nZXQoYmluZGluZy5ub2RlVXVpZCkgPz8gbm9kZUlkQnlOYW1lLmdldChiaW5kaW5nLm5vZGVOYW1lKTtcclxuICAgICAgICAgICAgaWYgKG5vZGVJZCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IG5vZGVJZCB9O1xyXG4gICAgICAgICAgICAgICAgYm91bmRDb3VudCArPSAxO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgdHlwZU5hbWUgPSBiaW5kaW5nLmNvbXBvbmVudFR5cGUgfHwgYmluZGluZy5wcm9wZXJ0eVR5cGU7XHJcbiAgICAgICAgY29uc3QgY29tcG9uZW50SWQgPSBjb21wb25lbnRJZEJ5Tm9kZVV1aWRBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVVdWlkfToke3R5cGVOYW1lfWApXHJcbiAgICAgICAgICAgID8/IGNvbXBvbmVudElkQnlOb2RlVXVpZEFuZFR5cGUuZ2V0KGAke2JpbmRpbmcubm9kZVV1aWR9OiR7c2hvcnRUeXBlTmFtZSh0eXBlTmFtZSl9YClcclxuICAgICAgICAgICAgPz8gY29tcG9uZW50SWRCeU5vZGVOYW1lQW5kVHlwZS5nZXQoYCR7YmluZGluZy5ub2RlTmFtZX06JHt0eXBlTmFtZX1gKVxyXG4gICAgICAgICAgICA/PyBjb21wb25lbnRJZEJ5Tm9kZU5hbWVBbmRUeXBlLmdldChgJHtiaW5kaW5nLm5vZGVOYW1lfToke3Nob3J0VHlwZU5hbWUodHlwZU5hbWUpfWApO1xyXG5cclxuICAgICAgICBpZiAoY29tcG9uZW50SWQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICB0YXJnZXRDb21wb25lbnRbYmluZGluZy5wcm9wZXJ0eU5hbWVdID0geyBfX2lkX186IGNvbXBvbmVudElkIH07XHJcbiAgICAgICAgICAgIGJvdW5kQ291bnQgKz0gMTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgd3JpdGVGaWxlU3luYyhhc3NldC5maWxlLCBgJHtKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKX1cXG5gLCAndXRmOCcpO1xyXG4gICAgcmV0dXJuIGJvdW5kQ291bnQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldFNlcmlhbGl6ZWRTY3JpcHRUeXBlTmFtZXMoc2NyaXB0QXNzZXQ6IGFueSB8IG51bGwsIGNsYXNzTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KFtcclxuICAgICAgICAuLi5yZWFkU2NyaXB0Q2lkRnJvbVByb2dyYW1DYWNoZShzY3JpcHRBc3NldCwgY2xhc3NOYW1lKSxcclxuICAgICAgICBjbGFzc05hbWUsXHJcbiAgICBdLmZpbHRlcihCb29sZWFuKSldO1xyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBlbmRTZXJpYWxpemVkU2NyaXB0Q29tcG9uZW50KGRhdGE6IGFueVtdLCBub2RlSWQ6IG51bWJlciwgc2NyaXB0VHlwZTogc3RyaW5nLCBiaW5kaW5nczogU2Nhbm5lZEJpbmRpbmdbXSk6IGFueSB7XHJcbiAgICBjb25zdCBub2RlID0gZGF0YVtub2RlSWRdO1xyXG4gICAgY29uc3QgY29tcG9uZW50SWQgPSBkYXRhLmxlbmd0aDtcclxuICAgIGNvbnN0IHByZWZhYkluZm9JZCA9IGNvbXBvbmVudElkICsgMTtcclxuICAgIGNvbnN0IGNvbXBvbmVudDogYW55ID0ge1xyXG4gICAgICAgIF9fdHlwZV9fOiBzY3JpcHRUeXBlLFxyXG4gICAgICAgIF9uYW1lOiAnJyxcclxuICAgICAgICBfb2JqRmxhZ3M6IDAsXHJcbiAgICAgICAgX19lZGl0b3JFeHRyYXNfXzoge30sXHJcbiAgICAgICAgbm9kZToge1xyXG4gICAgICAgICAgICBfX2lkX186IG5vZGVJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIF9lbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIF9fcHJlZmFiOiB7XHJcbiAgICAgICAgICAgIF9faWRfXzogcHJlZmFiSW5mb0lkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX2lkOiAnJyxcclxuICAgIH07XHJcblxyXG4gICAgZm9yIChjb25zdCBiaW5kaW5nIG9mIGJpbmRpbmdzKSB7XHJcbiAgICAgICAgY29tcG9uZW50W2JpbmRpbmcucHJvcGVydHlOYW1lXSA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcHJlZmFiSW5mbyA9IHtcclxuICAgICAgICBfX3R5cGVfXzogJ2NjLkNvbXBQcmVmYWJJbmZvJyxcclxuICAgICAgICBmaWxlSWQ6IG1ha2VQcmVmYWJGaWxlSWQoKSxcclxuICAgIH07XHJcblxyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG5vZGUuX2NvbXBvbmVudHMpKSB7XHJcbiAgICAgICAgbm9kZS5fY29tcG9uZW50cyA9IFtdO1xyXG4gICAgfVxyXG4gICAgbm9kZS5fY29tcG9uZW50cy5wdXNoKHsgX19pZF9fOiBjb21wb25lbnRJZCB9KTtcclxuICAgIGRhdGEucHVzaChjb21wb25lbnQsIHByZWZhYkluZm8pO1xyXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcclxufVxyXG5cclxuZnVuY3Rpb24gbWFrZVByZWZhYkZpbGVJZCgpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgY2hhcnMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XHJcbiAgICBjb25zdCBieXRlcyA9IHJhbmRvbUJ5dGVzKDIyKTtcclxuICAgIGxldCByZXN1bHQgPSAnJztcclxuICAgIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xyXG4gICAgICAgIHJlc3VsdCArPSBjaGFyc1tieXRlICUgY2hhcnMubGVuZ3RoXTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNob3J0VHlwZU5hbWUodHlwZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiB0eXBlLnNwbGl0KCcuJykucG9wKCkgfHwgdHlwZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlQnV0dG9uQ29tcG9uZW50cyhidXR0b25zOiBTY2FubmVkQmluZGluZ1tdLCBjb25maWc6IEJpbmRUb29sQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIWNvbmZpZy5hdXRvQWRkQnV0dG9uQ29tcG9uZW50KSB7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAoY29uc3QgYnV0dG9uIG9mIGJ1dHRvbnMpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBub2RlID0gYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgnc2NlbmUnLCAncXVlcnktbm9kZScsIGJ1dHRvbi5ub2RlVXVpZCk7XHJcbiAgICAgICAgICAgIGlmIChoYXNDb21wb25lbnQobm9kZSwgJ0J1dHRvbicpKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgY29uc3QgY29tcG9uZW50VHlwZSA9IGJ1dHRvbi5jb21wb25lbnRUeXBlIHx8ICdjYy5CdXR0b24nO1xyXG4gICAgICAgICAgICBhd2FpdCBjcmVhdGVDb21wb25lbnRXaXRoRmFsbGJhY2soYnV0dG9uLm5vZGVVdWlkLCBbY29tcG9uZW50VHlwZSwgc2hvcnRUeXBlTmFtZShjb21wb25lbnRUeXBlKV0pO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihgWyR7UEFDS0FHRV9OQU1FfV0gRmFpbGVkIHRvIGVuc3VyZSBCdXR0b24gY29tcG9uZW50IG9uICR7YnV0dG9uLm5vZGVOYW1lfS5gLCBlcnJvcik7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNDb21wb25lbnQobm9kZTogYW55LCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBBcnJheS5pc0FycmF5KG5vZGU/Ll9fY29tcHNfXykgPyBub2RlLl9fY29tcHNfXyA6IFtdO1xyXG4gICAgcmV0dXJuIGNvbXBvbmVudHMuc29tZSgoY29tcG9uZW50OiBhbnkpID0+IHtcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnR5cGUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8ubmFtZSxcclxuICAgICAgICAgICAgY29tcG9uZW50Py5jaWQsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Lm5hbWUsXHJcbiAgICAgICAgICAgIGNvbXBvbmVudD8udmFsdWU/Ll9fdHlwZV9fLFxyXG4gICAgICAgICAgICBjb21wb25lbnQ/LnZhbHVlPy5jaWQsXHJcbiAgICAgICAgXS5tYXAocmVhZER1bXBWYWx1ZSkuZmlsdGVyKEJvb2xlYW4pLm1hcChTdHJpbmcpO1xyXG5cclxuICAgICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjYW5kaWRhdGUpID0+IG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZSwgY29tcG9uZW50TmFtZSkpO1xyXG4gICAgfSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1hdGNoZXNDb21wb25lbnROYW1lKGNhbmRpZGF0ZTogc3RyaW5nLCBjb21wb25lbnROYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGxlZnQgPSBjYW5kaWRhdGUudG9Mb3dlckNhc2UoKTtcclxuICAgIGNvbnN0IHJpZ2h0ID0gY29tcG9uZW50TmFtZS50b0xvd2VyQ2FzZSgpO1xyXG4gICAgY29uc3QgbGVmdFNob3J0ID0gc2hvcnRUeXBlTmFtZShjYW5kaWRhdGUpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBjb25zdCByaWdodFNob3J0ID0gc2hvcnRUeXBlTmFtZShjb21wb25lbnROYW1lKS50b0xvd2VyQ2FzZSgpO1xyXG5cclxuICAgIHJldHVybiBsZWZ0ID09PSByaWdodFxyXG4gICAgICAgIHx8IGxlZnRTaG9ydCA9PT0gcmlnaHRTaG9ydFxyXG4gICAgICAgIHx8IGxlZnQuZW5kc1dpdGgoYC4ke3JpZ2h0U2hvcnR9YClcclxuICAgICAgICB8fCBsZWZ0LmluY2x1ZGVzKHJpZ2h0KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29tcG9uZW50V2l0aEZhbGxiYWNrKG5vZGVVdWlkOiBzdHJpbmcsIGNvbXBvbmVudE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgbGV0IGxhc3RFcnJvcjogdW5rbm93bjtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiBjb21wb25lbnROYW1lcykge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3NjZW5lJywgJ2NyZWF0ZS1jb21wb25lbnQnLCB7XHJcbiAgICAgICAgICAgICAgICB1dWlkOiBub2RlVXVpZCxcclxuICAgICAgICAgICAgICAgIGNvbXBvbmVudCxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBsYXN0RXJyb3IgPSBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbGFzdEVycm9yO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWxheShtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcclxufVxyXG4iXX0=