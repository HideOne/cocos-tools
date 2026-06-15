import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, extname, join, relative } from 'path';

const PACKAGE_NAME = 'bind-tool';

const AUTO_BIND_START = '/***************stsrt*************/';
const AUTO_BIND_END = '/************************end***************/';
const LEGACY_AUTO_BIND_START = '// AUTO_BIND_START';
const LEGACY_AUTO_BIND_END = '// AUTO_BIND_END';
const AUTO_BUTTON_EVENT_START = '// AUTO_BUTTON_EVENT_START';
const AUTO_BUTTON_EVENT_END = '// AUTO_BUTTON_EVENT_END';
const AUTO_BUTTON_HANDLER_START = '// AUTO_BUTTON_HANDLER_START';
const AUTO_BUTTON_HANDLER_END = '// AUTO_BUTTON_HANDLER_END';

type BindTarget = 'node' | 'component';

interface BindToolConfig {
    scriptRoot: string;
    autoAddButtonComponent: boolean;
    overwriteMode: 'marker';
    stopPrefix: string;
    rules: BindRule[];
}

interface BindRule {
    prefix: string;
    componentName?: string;
    propertyType: string;
    decoratorType: string;
    bindTarget: BindTarget;
    componentType: string;
    stopChildren: boolean;
    generateClickEvent: boolean;
    enabled: boolean;
}

interface ScannedBinding {
    nodeUuid: string;
    nodeName: string;
    propertyName: string;
    propertyType: string;
    decoratorType: string;
    bindTarget: BindTarget;
    componentType: string;
    stopChildren: boolean;
    generateClickEvent: boolean;
}

interface BindResult {
    className: string;
    scriptUrl: string;
    bindings: ScannedBinding[];
    buttons: ScannedBinding[];
    created: boolean;
    componentAttached: boolean;
    propertiesBound: number;
}

const defaultConfig: BindToolConfig = {
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

export const methods: { [key: string]: (...args: any[]) => any } = {
    async openRulesPanel() {
        await Editor.Panel.open(`${PACKAGE_NAME}.rules`);
    },

    async queryConfig() {
        return readConfig();
    },

    async saveConfig(config: Partial<BindToolConfig>) {
        const nextConfig: BindToolConfig = {
            ...defaultConfig,
            ...config,
            rules: normalizeRules(config.rules),
        };

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
        } catch (error) {
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

export function load() {}

export function unload() {}

async function bindSelectedNode(): Promise<BindResult> {
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
    } catch (error) {
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

async function readConfig(): Promise<BindToolConfig> {
    try {
        const projectConfig = await Editor.Profile.getProject(PACKAGE_NAME);
        return {
            ...defaultConfig,
            ...(projectConfig || {}),
            rules: normalizeRules(projectConfig?.rules),
        };
    } catch {
        return defaultConfig;
    }
}

function normalizeRules(rules: unknown): BindRule[] {
    if (!Array.isArray(rules)) {
        return defaultConfig.rules;
    }

    const normalized = rules
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule: any) => normalizeRule(rule))
        .filter((rule): rule is BindRule => Boolean(rule));

    return normalized.length > 0 ? normalized : defaultConfig.rules;
}

function normalizeRule(rule: any): BindRule | null {
    const prefix = String(rule.prefix || '').trim();
    if (!prefix) {
        return null;
    }

    const componentName = String(rule.componentName || rule.propertyType || 'Node').trim();
    const propertyType = normalizeComponentName(componentName);
    const bindTarget: BindTarget = propertyType === 'Node' ? 'node' : 'component';

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

function normalizeComponentName(componentName: string): string {
    const value = componentName.trim();
    if (value === 'cc.Node') {
        return 'Node';
    }

    if (value === 'cc.Button') {
        return 'Button';
    }

    return value || 'Node';
}

function toComponentType(propertyType: string): string {
    if (propertyType === 'Button') {
        return 'cc.Button';
    }

    return propertyType;
}

function isButtonType(propertyType: string): boolean {
    return propertyType === 'Button' || propertyType === 'cc.Button';
}

async function queryOpenedAssetUrl(selectedTree: any): Promise<string | null> {
    try {
        const savedId = await Editor.Message.request('scene', 'save-scene');
        if (!savedId) {
            return findAssetUrlByNodeTree(selectedTree);
        }

        const asset = await Editor.Message.request('asset-db', 'query-asset-info', savedId);
        return asset?.url || asset?.source || findAssetUrlByNodeTree(selectedTree);
    } catch {
        return findAssetUrlByNodeTree(selectedTree);
    }
}

function findAssetUrlByNodeTree(selectedTree: any): string | null {
    const assetsDir = join(Editor.Project.path, 'assets');
    if (!existsSync(assetsDir)) {
        return null;
    }

    const rootName = getNodeName(selectedTree);
    const childNames = new Set(getChildren(selectedTree).map(getNodeName));
    const candidates = listAssetFiles(assetsDir, ['.prefab', '.scene']);

    for (const file of candidates) {
        try {
            const data = JSON.parse(readFileSync(file, 'utf8'));
            if (!Array.isArray(data)) {
                continue;
            }

            const nodes = data.filter((item) => item?.__type__ === 'cc.Node');
            const hasRoot = nodes.some((node) => node?._name === rootName);
            if (!hasRoot) {
                continue;
            }

            const nodeNames = new Set(nodes.map((node) => node?._name).filter(Boolean));
            const childMatchCount = [...childNames].filter((name) => nodeNames.has(name)).length;
            if (childNames.size === 0 || childMatchCount > 0 || basename(file, extname(file)) === rootName) {
                const assetRelative = relative(Editor.Project.path, file).replace(/\\/g, '/');
                return `db://${assetRelative}`;
            }
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to inspect asset ${file}.`, error);
        }
    }

    return null;
}

function listAssetFiles(dir: string, extensions: string[]): string[] {
    const result: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...listAssetFiles(fullPath, extensions));
        } else if (extensions.includes(extname(entry.name).toLowerCase())) {
            result.push(fullPath);
        }
    }

    return result;
}

function makeScriptUrl(openedAssetUrl: string | null, className: string, scriptRoot: string): string {
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

function assetUrlExists(url: string): boolean {
    const relativePath = url.replace(/^db:\/\//, '').replace(/\//g, '\\');
    return existsSync(join(Editor.Project.path, relativePath));
}

function normalizeAssetPath(value: string): string {
    const path = value.replace(/\\/g, '/').replace(/^db:\/\//, '').replace(/^\/+/, '');
    return path.startsWith('assets') ? path : `assets/${path}`;
}

function scanBindings(root: any, config: BindToolConfig): ScannedBinding[] {
    const usedNames = new Map<string, number>();
    const bindings: ScannedBinding[] = [];
    const rules = getSortedEnabledRules(config);

    const visit = (node: any) => {
        const nodeName = getNodeName(node);
        const lowerName = nodeName.toLowerCase();

        if (lowerName.startsWith(config.stopPrefix.toLowerCase())) {
            return;
        }

        const binding = createBinding(node, rules, usedNames);
        if (binding) {
            bindings.push(binding);
        }

        if (binding?.stopChildren) {
            return;
        }

        for (const child of getChildren(node)) {
            visit(child);
        }
    };

    visit(root);
    return bindings;
}

function getSortedEnabledRules(config: BindToolConfig): BindRule[] {
    return config.rules
        .filter((rule) => rule.enabled && rule.prefix)
        .sort((left, right) => right.prefix.length - left.prefix.length);
}

function createBinding(node: any, rules: BindRule[], usedNames: Map<string, number>): ScannedBinding | null {
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

function getNodeName(node: any): string {
    return String(readDumpValue(node?.name) || 'Node');
}

function getUuid(node: any): string {
    return String(readDumpValue(node?.uuid) || node?.uuid || '');
}

function getChildren(node: any): any[] {
    return Array.isArray(node?.children) ? node.children : [];
}

function readDumpValue(value: any): any {
    if (value && typeof value === 'object' && 'value' in value) {
        return value.value;
    }
    return value;
}

function toClassName(value: string): string {
    const name = toPropertyName(value);
    return upperFirst(name.replace(/^_+/, '') || 'AutoBindComponent');
}

function toPropertyName(value: string): string {
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

function isIdentifierStart(char: string): boolean {
    return /[$_\p{ID_Start}]/u.test(char);
}

function isIdentifierContinue(char: string): boolean {
    return /[$_\u200C\u200D\p{ID_Continue}]/u.test(char);
}

function makeUniqueName(baseName: string, usedNames: Map<string, number>): string {
    const count = usedNames.get(baseName) || 0;
    usedNames.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}${count + 1}`;
}

function upperFirst(value: string): string {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function renderScript(className: string, bindings: ScannedBinding[], buttons: ScannedBinding[]): string {
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

function renderCcImports(bindings: ScannedBinding[]): string {
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

function collectImportFromType(imports: Set<string>, typeName: string): void {
    const firstPart = typeName.trim().split('.')[0];
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(firstPart)) {
        imports.add(firstPart);
    }
}

function renderProperties(bindings: ScannedBinding[]): string {
    return bindings.map((binding) => `    @property(${binding.decoratorType})
    public ${binding.propertyName}: ${binding.propertyType} | null = null;`).join('\n\n');
}

function renderButtonEvents(buttons: ScannedBinding[]): string {
    return buttons.map((button) => `        if (this.${button.propertyName}) {
            this.${button.propertyName}.node.on(Button.EventType.CLICK, this.${getClickHandlerName(button.propertyName)}, this);
        }`).join('\n\n');
}

function renderButtonHandlers(buttons: ScannedBinding[]): string {
    return buttons.map((button) => `    private ${getClickHandlerName(button.propertyName)}(): void {

    }`).join('\n\n');
}

function getClickHandlerName(propertyName: string): string {
    return `onClick${upperFirst(propertyName.replace(/^button_?/, 'Button_'))}`;
}

function updateMarkedSource(existing: string, generated: string): string {
    const bindBlock = pickBlock(generated, AUTO_BIND_START, AUTO_BIND_END);
    const eventBlock = pickBlock(generated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END);
    const handlerBlock = pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END);

    if (!hasAllAutoBlocks(existing)) {
        return existing;
    }

    const bindMarkers = getExistingBlockMarkers(existing, AUTO_BIND_START, AUTO_BIND_END)
        || getExistingBlockMarkers(existing, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END)
        || ([AUTO_BIND_START, AUTO_BIND_END] as const);

    let updated = replaceBlock(existing, bindMarkers[0], bindMarkers[1], bindBlock);
    updated = updated.replace(bindMarkers[0], AUTO_BIND_START).replace(bindMarkers[1], AUTO_BIND_END);

    return replaceBlock(
        replaceBlock(
            updated,
            AUTO_BUTTON_EVENT_START,
            AUTO_BUTTON_EVENT_END,
            eventBlock,
        ),
        AUTO_BUTTON_HANDLER_START,
        AUTO_BUTTON_HANDLER_END,
        handlerBlock,
    );
}

function hasAllAutoBlocks(source: string): boolean {
    return (hasBlock(source, AUTO_BIND_START, AUTO_BIND_END) || hasBlock(source, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END))
        && hasBlock(source, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END)
        && hasBlock(source, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END);
}

function getExistingBlockMarkers(source: string, start: string, end: string): readonly [string, string] | null {
    return hasBlock(source, start, end) ? [start, end] : null;
}

function hasBlock(source: string, start: string, end: string): boolean {
    return source.includes(start) && source.includes(end) && source.indexOf(start) < source.indexOf(end);
}

function pickBlock(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    return source.slice(startIndex + start.length, endIndex);
}

function replaceBlock(source: string, start: string, end: string, content: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    return `${source.slice(0, startIndex + start.length)}${content}${source.slice(endIndex)}`;
}

async function readAssetText(url: string): Promise<string | null> {
    const asset = await Editor.Message.request('asset-db', 'query-asset-info', url);
    if (!asset?.file) {
        return null;
    }

    return readFileSync(asset.file, 'utf8');
}

async function writeAsset(url: string, source: string, created: boolean): Promise<void> {
    if (created) {
        await Editor.Message.request('asset-db', 'create-asset', url, source);
        return;
    }

    await Editor.Message.request('asset-db', 'save-asset', url, source);
}

async function tryAttachComponent(nodeUuid: string, className: string): Promise<boolean> {
    if (await findComponentUuid(nodeUuid, className)) {
        return true;
    }

    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: className,
        });
        return true;
    } catch (firstError) {
        console.warn(`[${PACKAGE_NAME}] First component attach failed. Waiting for script import before retry.`, firstError);
    }

    await delay(1000);

    try {
        await Editor.Message.request('scene', 'create-component', {
            uuid: nodeUuid,
            component: className,
        });
        return true;
    } catch (secondError) {
        console.warn(`[${PACKAGE_NAME}] Automatic component attach failed.`, secondError);
        return false;
    }
}

async function bindComponentProperties(nodeUuid: string, className: string, bindings: ScannedBinding[]): Promise<number> {
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

async function findComponentUuid(nodeUuid: string, componentName: string): Promise<string | null> {
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node?.__comps__) ? node.__comps__ : [];

    for (const component of components) {
        const componentAny = component as any;
        const uuid = String(readDumpValue(componentAny?.value?.uuid) || readDumpValue(componentAny?.uuid) || '');
        const candidates = [
            componentAny?.type,
            componentAny?.name,
            componentAny?.cid,
            componentAny?.value?.name,
            componentAny?.value?.__type__,
            componentAny?.value?.cid,
            componentAny?.value?.type,
        ].map(readDumpValue).filter(Boolean).map(String);

        if (candidates.some((candidate) => matchesComponentName(candidate, componentName))) {
            return uuid || null;
        }
    }

    return null;
}

function getPropertyDump(componentDump: any, propertyName: string): any | null {
    const dump = componentDump?.value?.[propertyName] || componentDump?.[propertyName];
    return dump && typeof dump === 'object' ? dump : null;
}

async function setReferenceProperty(componentUuid: string, propertyName: string, propertyDump: any, targetUuid: string): Promise<boolean> {
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
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to bind ${propertyName} with one reference dump candidate.`, error);
        }
    }

    return false;
}

function makeReferenceDumpCandidates(propertyDump: any, targetUuid: string): any[] {
    const base = JSON.parse(JSON.stringify(propertyDump));
    const candidates: any[] = [];

    candidates.push({
        ...base,
        value: {
            uuid: targetUuid,
        },
    });

    candidates.push({
        ...base,
        value: targetUuid,
    });

    candidates.push({
        ...base,
        value: {
            __uuid__: targetUuid,
        },
    });

    if (base.value && typeof base.value === 'object') {
        candidates.unshift({
            ...base,
            value: {
                ...base.value,
                uuid: targetUuid,
            },
        });
    }

    return candidates;
}

async function bindSerializedAssetReferences(openedAssetUrl: string | null, className: string, rootName: string, bindings: ScannedBinding[]): Promise<number> {
    if (!openedAssetUrl) {
        return 0;
    }

    const asset = await Editor.Message.request('asset-db', 'query-asset-info', openedAssetUrl);
    if (!asset?.file || !/\.(prefab|scene)$/i.test(asset.file)) {
        return 0;
    }

    const raw = readFileSync(asset.file, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
        return 0;
    }

    const nodeIdByUuid = new Map<string, number>();
    const nodeIdByName = new Map<string, number>();
    const componentIdByNodeUuidAndType = new Map<string, number>();
    const componentIdByNodeNameAndType = new Map<string, number>();

    data.forEach((item, index) => {
        if (item?.__type__ === 'cc.Node') {
            const nodeUuid = item?._id || item?._uuid || '';
            if (nodeUuid) {
                nodeIdByUuid.set(nodeUuid, index);
            }
            if (typeof item?._name === 'string') {
                nodeIdByName.set(item._name, index);
            }
        }
    });

    data.forEach((item, index) => {
        const nodeId = item?.node?.__id__;
        const node = Number.isInteger(nodeId) ? data[nodeId] : null;
        const nodeUuid = node?._id || node?._uuid || '';
        const nodeName = node?._name || '';
        if (typeof item?.__type__ !== 'string') {
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
        if (typeof item?.__type__ !== 'string') {
            return false;
        }

        const nodeId = item?.node?.__id__;
        const node = Number.isInteger(nodeId) ? data[nodeId] : null;
        const attachedToRoot = node?._name === rootName;
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
            const nodeId = nodeIdByUuid.get(binding.nodeUuid) ?? nodeIdByName.get(binding.nodeName);
            if (nodeId !== undefined) {
                targetComponent[binding.propertyName] = { __id__: nodeId };
                boundCount += 1;
            }
            continue;
        }

        const typeName = binding.componentType || binding.propertyType;
        const componentId = componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${typeName}`)
            ?? componentIdByNodeUuidAndType.get(`${binding.nodeUuid}:${shortTypeName(typeName)}`)
            ?? componentIdByNodeNameAndType.get(`${binding.nodeName}:${typeName}`)
            ?? componentIdByNodeNameAndType.get(`${binding.nodeName}:${shortTypeName(typeName)}`);

        if (componentId !== undefined) {
            targetComponent[binding.propertyName] = { __id__: componentId };
            boundCount += 1;
        }
    }

    writeFileSync(asset.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return boundCount;
}

function shortTypeName(type: string): string {
    return type.split('.').pop() || type;
}

async function ensureButtonComponents(buttons: ScannedBinding[], config: BindToolConfig): Promise<void> {
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
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to ensure Button component on ${button.nodeName}.`, error);
        }
    }
}

function hasComponent(node: any, componentName: string): boolean {
    const components = Array.isArray(node?.__comps__) ? node.__comps__ : [];
    return components.some((component: any) => {
        const candidates = [
            component?.type,
            component?.name,
            component?.cid,
            component?.value?.name,
            component?.value?.__type__,
            component?.value?.cid,
        ].map(readDumpValue).filter(Boolean).map(String);

        return candidates.some((candidate) => matchesComponentName(candidate, componentName));
    });
}

function matchesComponentName(candidate: string, componentName: string): boolean {
    const left = candidate.toLowerCase();
    const right = componentName.toLowerCase();
    const leftShort = shortTypeName(candidate).toLowerCase();
    const rightShort = shortTypeName(componentName).toLowerCase();

    return left === right
        || leftShort === rightShort
        || left.endsWith(`.${rightShort}`)
        || left.includes(right);
}

async function createComponentWithFallback(nodeUuid: string, componentNames: string[]): Promise<void> {
    let lastError: unknown;

    for (const component of componentNames) {
        try {
            await Editor.Message.request('scene', 'create-component', {
                uuid: nodeUuid,
                component,
            });
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
