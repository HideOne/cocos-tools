import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, extname, join, relative } from 'path';
import { randomBytes } from 'crypto';

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
type BindMode = 'generate-and-bind' | 'generate' | 'bind';

interface BindToolConfig {
    scriptRoot: string;
    scriptNamePrefix: string;
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
    openedAssetUrl: string;
    scriptBaseDir: string;
    bindings: ScannedBinding[];
    buttons: ScannedBinding[];
    created: boolean;
    componentAttached: boolean;
    propertiesBound: number;
}

const defaultConfig: BindToolConfig = {
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

async function runBindSelectedNode(mode: BindMode): Promise<void> {
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
    } catch (error) {
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

function getModeTitle(mode: BindMode): string {
    if (mode === 'generate') {
        return 'Generate script';
    }

    if (mode === 'bind') {
        return 'Bind references';
    }

    return 'Generate and bind';
}

async function runBindUiOnSelectedNode(): Promise<void> {
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
    } catch (error) {
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

export function load() {}

export function unload() {}

async function bindUiOnSelectedNode(): Promise<BindResult> {
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
    } else {
        console.log(`[${PACKAGE_NAME}] Script content unchanged, skip refresh: ${scriptUrl}`);
    }

    await ensureButtonComponents(buttons, config);
    const liveComponentUuid = await waitForBindableComponent(
        selectedUuid,
        className,
        scriptUrl,
        scan.map((item) => item.propertyName),
        targetScript,
    );
    targetScript.componentUuid = liveComponentUuid || '';
    console.log(`[${PACKAGE_NAME}] Live componentUuid for binding: ${targetScript.componentUuid || '(missing)'}`);

    const propertiesBound = await applyBindings(
        selectedUuid,
        className,
        scriptUrl,
        openedAssetUrl,
        selectedTree,
        scan,
        targetScript,
    );
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

interface NodeScriptInfo {
    className: string;
    scriptUrl: string;
    source: string;
    componentUuid: string;
    cid: string;
}

function pickBindUiTargetScript(scripts: NodeScriptInfo[], nodeName: string): NodeScriptInfo | undefined {
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
        const fileName = basename(script.scriptUrl).replace(/\.tsx?$/i, '').toLowerCase();
        return fileName === lowerNodeName || lowerNodeName.startsWith(fileName);
    });
    if (byFileName) {
        return byFileName;
    }

    return withMarkers[0];
}

async function querySelectedNodeTree(selectedUuid: string): Promise<any | null> {
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
            } catch (error) {
                console.warn(`[${PACKAGE_NAME}] Failed to recover selected tree from full scene tree.`, error);
            }
        }
        return direct;
    }

    try {
        const root = await Editor.Message.request('scene', 'query-node-tree');
        return findNodeInTree(root, selectedUuid) || direct;
    } catch {
        return direct;
    }
}

function findNodeInTree(node: any, uuid: string): any | null {
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

async function listScriptsOnNode(nodeUuid: string): Promise<NodeScriptInfo[]> {
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node?.__comps__) ? node.__comps__ : [];
    console.log(`[${PACKAGE_NAME}] query-node comps count: ${components.length}`);
    if (components.length === 0) {
        return [];
    }

    let registered: Array<{ name?: string; cid?: string; path?: string; assetUuid?: string }> = [];
    try {
        const list = await Editor.Message.request('scene', 'query-components');
        registered = Array.isArray(list) ? list : [];
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to query registered components.`, error);
    }

    const results: NodeScriptInfo[] = [];
    const seenUrls = new Set<string>();

    for (const component of components) {
        const componentAny = component as any;
        const type = String(readDumpValue(componentAny?.type) || '');
        const cid = String(readDumpValue(componentAny?.cid) || type || '');
        const componentUuid = String(
            readDumpValue(componentAny?.value?.uuid)
            || readDumpValue(componentAny?.uuid)
            || '',
        );
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
            matched?.assetUuid,
            matched?.path,
            ...typeCandidates,
        ].filter(Boolean).map(String);

        let resolved: NodeScriptInfo | null = null;
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

function findRegisteredScriptComponent(
    registered: Array<{ name?: string; cid?: string; path?: string; assetUuid?: string }>,
    typeCandidates: string[],
): { name?: string; cid?: string; path?: string; assetUuid?: string } | undefined {
    return registered.find((item) => {
        const regCandidates = [item?.name, item?.cid, item?.assetUuid]
            .filter(Boolean)
            .map(String);
        return typeCandidates.some((candidate) => regCandidates.some((reg) => isExactComponentIdentity(reg, candidate)));
    });
}

function isExactComponentIdentity(left: string, right: string): boolean {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    if (!a || !b) {
        return false;
    }
    return a === b
        || shortTypeName(a).toLowerCase() === shortTypeName(b).toLowerCase();
}

async function resolveScriptAssetByKey(
    key: string,
    classNameCandidates: string[],
    componentUuid: string,
    cid: string,
): Promise<NodeScriptInfo | null> {
    try {
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', key);
        if (!asset?.file || !/\.tsx?$/i.test(String(asset.file))) {
            return null;
        }

        const scriptUrl = String(asset.url || asset.source || '');
        if (!scriptUrl) {
            return null;
        }

        const source = readFileSync(String(asset.file), 'utf8');
        const className = extractClassNameFromSource(source)
            || classNameCandidates.find((name) => !isBuiltinComponentType(name) && !looksLikeUuid(name) && !looksLikeCid(name))
            || basename(String(asset.file), extname(String(asset.file)));

        return {
            className,
            scriptUrl,
            source,
            componentUuid,
            cid,
        };
    } catch {
        return null;
    }
}

function isBuiltinComponentType(typeName: string): boolean {
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

function looksLikeCid(value: string): boolean {
    return /[+/]/.test(value) || (value.length >= 20 && /[A-Za-z]/.test(value) && /\d/.test(value));
}

function looksLikeUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        || /^[0-9a-f]{20,}$/i.test(value);
}

function extractClassNameFromSource(source: string): string | null {
    const ccclassMatch = source.match(/@ccclass\(\s*['"]([^'"]+)['"]\s*\)/);
    if (ccclassMatch?.[1]) {
        return ccclassMatch[1];
    }

    const classMatch = source.match(/export\s+class\s+([A-Za-z_$][\w$]*)\s+extends\s+/);
    return classMatch?.[1] || null;
}

function hasBindMarkers(source: string): boolean {
    return hasBlock(source, AUTO_BIND_START, AUTO_BIND_END)
        || hasBlock(source, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END);
}

function updateUiMarkedSource(existing: string, generated: string): string {
    if (!hasBindMarkers(existing)) {
        return existing;
    }

    const bindBlock = pickBlock(generated, AUTO_BIND_START, AUTO_BIND_END);
    const bindMarkers = getExistingBlockMarkers(existing, AUTO_BIND_START, AUTO_BIND_END)
        || getExistingBlockMarkers(existing, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END)
        || ([AUTO_BIND_START, AUTO_BIND_END] as const);

    let updated = replaceBlock(existing, bindMarkers[0], bindMarkers[1], bindBlock);
    updated = updated.replace(bindMarkers[0], AUTO_BIND_START).replace(bindMarkers[1], AUTO_BIND_END);

    if (hasBlock(updated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END)) {
        updated = replaceBlock(
            updated,
            AUTO_BUTTON_EVENT_START,
            AUTO_BUTTON_EVENT_END,
            pickBlock(generated, AUTO_BUTTON_EVENT_START, AUTO_BUTTON_EVENT_END),
        );
    }

    if (hasBlock(updated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END)) {
        updated = replaceBlock(
            updated,
            AUTO_BUTTON_HANDLER_START,
            AUTO_BUTTON_HANDLER_END,
            mergeButtonHandlerBlock(
                pickBlock(updated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END),
                pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END),
            ),
        );
    }

    return mergeCcImports(updated, generated);
}

async function bindSelectedNode(mode: BindMode): Promise<BindResult> {
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
    } else if (!await readAssetText(scriptUrl)) {
        throw new Error(`Script does not exist. Generate it first: ${scriptUrl}`);
    }

    if (mode !== 'generate') {
        await ensureButtonComponents(buttons, config);
        componentAttached = await tryAttachComponent(selectedUuid, className, scriptUrl);
        propertiesBound = await applyBindings(
            selectedUuid,
            className,
            scriptUrl,
            openedAssetUrl,
            selectedTree,
            scan,
            null,
        );
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

async function readConfig(): Promise<BindToolConfig> {
    try {
        const projectConfig = await Editor.Profile.getProject(PACKAGE_NAME);
        return {
            ...defaultConfig,
            ...(projectConfig || {}),
            scriptNamePrefix: String(projectConfig?.scriptNamePrefix ?? defaultConfig.scriptNamePrefix),
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
    if (value.startsWith('cc.')) {
        return shortTypeName(value);
    }

    return value || 'Node';
}

function toComponentType(propertyType: string): string {
    if (isBuiltinCcComponent(propertyType)) {
        return `cc.${propertyType}`;
    }

    return propertyType;
}

function isBuiltinCcComponent(propertyType: string): boolean {
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

function isButtonType(propertyType: string): boolean {
    return propertyType === 'Button' || propertyType === 'cc.Button';
}

async function queryOpenedAssetUrl(selectedTree: any): Promise<string | null> {
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

async function queryUrlFromSaveScene(): Promise<string | null> {
    try {
        const savedId = await Editor.Message.request('scene', 'save-scene');
        if (!savedId) {
            return null;
        }

        return resolveAssetUrl(String(savedId));
    } catch {
        return null;
    }
}

async function queryUrlFromPrefabDump(selectedTree: any): Promise<string | null> {
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
    } catch {
        // ignore and fall through
    }

    return null;
}

async function queryUrlFromSelectedAsset(): Promise<string | null> {
    try {
        const selectedAsset = Editor.Selection.getLastSelected('asset') || Editor.Selection.getSelected('asset')[0];
        if (!selectedAsset) {
            return null;
        }

        const url = await resolveAssetUrl(String(selectedAsset));
        if (url && /\.(prefab|scene)$/i.test(url)) {
            return url;
        }
    } catch {
        // ignore and fall through
    }

    return null;
}

async function resolveAssetUrl(idOrUrl: string): Promise<string | null> {
    try {
        const asset = await Editor.Message.request('asset-db', 'query-asset-info', idOrUrl);
        if (asset?.url) {
            return String(asset.url);
        }
        if (asset?.source) {
            return String(asset.source);
        }
    } catch {
        // continue
    }

    try {
        const url = await Editor.Message.request('asset-db', 'query-url', idOrUrl);
        return url ? String(url) : null;
    } catch {
        return null;
    }
}

function extractPrefabAssetUuid(tree: any): string | null {
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

async function findAssetUrlByNodeTreeWithRetry(selectedTree: any): Promise<string | null> {
    for (let index = 0; index < 5; index += 1) {
        const url = findAssetUrlByNodeTree(selectedTree);
        if (url) {
            return url;
        }
        await delay(120);
    }

    return null;
}

function findAssetUrlByNodeTree(selectedTree: any): string | null {
    const assetsDir = join(Editor.Project.path, 'assets');
    if (!existsSync(assetsDir)) {
        return null;
    }

    const rootName = getNodeName(selectedTree);
    const treeNodeNames = collectNodeNames(selectedTree);
    const candidates = listAssetFiles(assetsDir, ['.prefab', '.scene']);
    let bestUrl: string | null = null;
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
            bestUrl = `db://${relative(Editor.Project.path, file).replace(/\\/g, '/')}`;
        } catch (error) {
            if (!isIncompleteJsonError(error)) {
                console.warn(`[${PACKAGE_NAME}] Failed to inspect asset ${file}.`, error);
            }
        }
    }

    return bestScore > 0 ? bestUrl : null;
}

function collectNodeNames(node: any, result: string[] = []): string[] {
    result.push(getNodeName(node));
    for (const child of getChildren(node)) {
        collectNodeNames(child, result);
    }
    return result;
}

function scoreAssetMatch(file: string, data: any[], rootName: string, treeNodeNames: string[]): number {
    const nodes = data.filter((item) => item?.__type__ === 'cc.Node');
    const hasRoot = nodes.some((node) => node?._name === rootName);
    if (!hasRoot) {
        return Number.NEGATIVE_INFINITY;
    }

    const assetNames = nodes.map((node) => String(node?._name || '')).filter(Boolean);
    const assetNameSet = new Set(assetNames);
    const matchedCount = treeNodeNames.filter((name) => assetNameSet.has(name)).length;
    if (matchedCount <= 0 && basename(file, extname(file)) !== rootName) {
        return Number.NEGATIVE_INFINITY;
    }

    let score = matchedCount * 10;
    score -= Math.abs(assetNames.length - treeNodeNames.length) * 3;
    if (basename(file, extname(file)) === rootName) {
        score += 5;
    }

    // Prefer unique structural matches when duplicate prefabs exist under different folders.
    score += Math.min(matchedCount, assetNames.length);

    return score;
}

function readJsonFileSync(file: string): any | null {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        if (isIncompleteJsonError(error)) {
            return null;
        }
        throw error;
    }
}

async function readJsonFileWithRetry(file: string, attempts = 5): Promise<any | null> {
    for (let index = 0; index < attempts; index += 1) {
        try {
            return JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
            if (!isIncompleteJsonError(error) || index === attempts - 1) {
                throw error;
            }
            await delay(120);
        }
    }

    return null;
}

function isIncompleteJsonError(error: unknown): boolean {
    return error instanceof SyntaxError && /Unexpected end of JSON input/.test(error.message);
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
    const relativeRoot = normalizeRelativeScriptRoot(scriptRoot);
    const baseDir = getScriptBaseDir(openedAssetUrl);
    const resolvedDir = resolveRelativeAssetPath(baseDir, relativeRoot);
    return `db://${resolvedDir}/${className}.ts`;
}

function getScriptBaseDir(openedAssetUrl: string | null): string {
    if (openedAssetUrl) {
        const bundleRoot = findBundleRoot(openedAssetUrl);
        if (bundleRoot) {
            return bundleRoot;
        }
    }

    // Prefab/scene is not inside an Asset Bundle: resolve relative to project assets root.
    return 'assets';
}

function findBundleRoot(openedAssetUrl: string): string | null {
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

function isBundleDirectory(assetRelativeDir: string): boolean {
    const metaPath = join(Editor.Project.path, `${assetRelativeDir}.meta`);
    if (!existsSync(metaPath)) {
        return false;
    }

    try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        return meta?.userData?.isBundle === true;
    } catch {
        return false;
    }
}

function getOpenedAssetDirectory(openedAssetUrl: string): string {
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

function normalizeRelativeScriptRoot(scriptRoot: string): string {
    const value = String(scriptRoot || defaultConfig.scriptRoot).trim().replace(/\\/g, '/') || '.';
    return value.replace(/\/+$/, '') || '.';
}

function resolveRelativeAssetPath(baseDir: string, relativePath: string): string {
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
    if (Array.isArray(node?.children)) {
        return node.children;
    }

    const dumpChildren = readDumpValue(node?.children);
    if (Array.isArray(dumpChildren)) {
        return dumpChildren;
    }

    if (Array.isArray(node?.value?.children)) {
        return node.value.children;
    }

    return [];
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

function applyScriptNamePrefix(className: string, prefix: string): string {
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

    return sortCcImports(imports).join(', ');
}

function sortCcImports(imports: Iterable<string>): string[] {
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

function collectImportFromType(imports: Set<string>, typeName: string): void {
    const value = typeName.trim();
    const importName = value.startsWith('cc.') ? shortTypeName(value) : value.split('.')[0];
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(importName)) {
        imports.add(importName);
    }
}

function renderProperties(bindings: ScannedBinding[]): string {
    return bindings.map((binding) => `    @property(${toScriptTypeName(binding.decoratorType)})
    public ${binding.propertyName}: ${toScriptTypeName(binding.propertyType)} | null = null;`).join('\n\n');
}

function toScriptTypeName(typeName: string): string {
    const value = typeName.trim();
    return value.startsWith('cc.') ? shortTypeName(value) : value;
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
    const handlerBlock = mergeButtonHandlerBlock(
        pickBlock(existing, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END),
        pickBlock(generated, AUTO_BUTTON_HANDLER_START, AUTO_BUTTON_HANDLER_END),
    );

    if (!hasAllAutoBlocks(existing)) {
        return existing;
    }

    const bindMarkers = getExistingBlockMarkers(existing, AUTO_BIND_START, AUTO_BIND_END)
        || getExistingBlockMarkers(existing, LEGACY_AUTO_BIND_START, LEGACY_AUTO_BIND_END)
        || ([AUTO_BIND_START, AUTO_BIND_END] as const);

    let updated = replaceBlock(existing, bindMarkers[0], bindMarkers[1], bindBlock);
    updated = updated.replace(bindMarkers[0], AUTO_BIND_START).replace(bindMarkers[1], AUTO_BIND_END);

    const updatedBlocks = replaceBlock(
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

    return mergeCcImports(updatedBlocks, generated);
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

function mergeButtonHandlerBlock(existingBlock: string, generatedBlock: string): string {
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

function normalizeButtonHandlerSource(source: string): string {
    const lines = source.trim().split(/\r?\n/);
    return lines.map((line, index) => {
        if (index === 0) {
            return `    ${line.trimStart()}`;
        }
        return line.trimEnd();
    }).join('\n');
}

function parseButtonHandlers(block: string): Array<{ name: string; source: string }> {
    const result: Array<{ name: string; source: string }> = [];
    const methodPattern = /(?:private|protected|public)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*:\s*void\s*\{/g;
    let match: RegExpExecArray | null;

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

function findMatchingBrace(source: string, openIndex: number): number {
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let escaped = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
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
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function mergeCcImports(existing: string, generated: string): string {
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

function parseCcImportNames(imports: string): string[] {
    return imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function detectUsedCcSymbols(source: string): string[] {
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

async function tryAttachComponent(nodeUuid: string, className: string, scriptUrl: string): Promise<boolean> {
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

async function waitForScriptComponentCandidates(className: string, scriptUrl: string): Promise<string[]> {
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

async function queryAssetInfoSafe(url: string): Promise<any | null> {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', url);
    } catch {
        return null;
    }
}

async function queryRegisteredScriptComponentCandidates(className: string, scriptAsset: any | null): Promise<string[]> {
    try {
        const components = await Editor.Message.request('scene', 'query-components');
        if (!Array.isArray(components)) {
            return [];
        }

        const scriptUuid = scriptAsset?.uuid ? String(scriptAsset.uuid) : '';
        const scriptUrl = scriptAsset?.url ? String(scriptAsset.url) : '';
        const scriptFile = scriptAsset?.file ? String(scriptAsset.file).replace(/\\/g, '/') : '';
        const result: string[] = [];

        for (const component of components) {
            const candidates = [
                component?.name,
                component?.cid,
                component?.path,
                component?.assetUuid,
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
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to query registered components.`, error);
        return [];
    }
}

function isComponentAttachCandidate(candidate: string): boolean {
    return /^[A-Za-z0-9_$./:@-]+$/.test(candidate);
}

function readScriptCidFromProgramCache(scriptAsset: any | null, className: string): string[] {
    if (!scriptAsset?.file) {
        return [];
    }

    const sourceUrl = `file:///${String(scriptAsset.file).replace(/\\/g, '/')}`;
    const result: string[] = [];
    const targets = [
        join(Editor.Project.path, 'temp', 'programming', 'packer-driver', 'targets', 'editor'),
        join(Editor.Project.path, 'temp', 'programming', 'packer-driver', 'targets', 'preview'),
    ];

    for (const targetDir of targets) {
        try {
            const importMapPath = join(targetDir, 'import-map.json');
            if (!existsSync(importMapPath)) {
                continue;
            }

            const importMap = JSON.parse(readFileSync(importMapPath, 'utf8'));
            const chunkRelative = importMap?.imports?.[sourceUrl] || importMap?.[sourceUrl];
            if (!chunkRelative) {
                continue;
            }

            const chunkFile = join(targetDir, String(chunkRelative).replace(/^\.\//, ''));
            if (!existsSync(chunkFile)) {
                continue;
            }

            const chunkSource = readFileSync(chunkFile, 'utf8');
            const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = chunkSource.match(new RegExp(`_RF\\.push\\(\\{\\},\\s*["']([^"']+)["'],\\s*["']${escapedClassName}["']`));
            if (match?.[1]) {
                result.push(match[1]);
            }
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to read script cid from program cache.`, error);
        }
    }

    return [...new Set(result)];
}

async function createComponentAndVerify(nodeUuid: string, componentName: string, matchNames: string[]): Promise<boolean> {
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
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to attach component ${componentName}.`, error);
        return false;
    }
}

function normalizeClassName(className: string): string {
    return className.replace(/[^A-Za-z0-9_$\p{ID_Start}\p{ID_Continue}\u200C\u200D]/gu, '_');
}

async function applyBindings(
    selectedUuid: string,
    className: string,
    scriptUrl: string,
    openedAssetUrl: string | null,
    selectedTree: any,
    bindings: ScannedBinding[],
    targetScript?: NodeScriptInfo | null,
): Promise<number> {
    if (bindings.length === 0) {
        console.warn(`[${PACKAGE_NAME}] applyBindings skipped because scan result is empty.`);
        return 0;
    }

    let propertiesBound = await bindComponentProperties(selectedUuid, className, scriptUrl, bindings, targetScript);
    console.log(`[${PACKAGE_NAME}] Scene API bound ${propertiesBound}/${bindings.length} properties.`);

    if (propertiesBound >= bindings.length) {
        try {
            await Editor.Message.request('scene', 'save-scene');
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] Failed to save scene after property binding.`, error);
        }
        return propertiesBound;
    }

    // Do NOT save-scene before serialized fallback: that would persist empty live refs and fight the file write.
    try {
        const serializedBound = await bindSerializedAssetReferences(
            openedAssetUrl,
            scriptUrl,
            selectedUuid,
            className,
            selectedTree,
            bindings,
        );
        console.log(`[${PACKAGE_NAME}] Serialized asset bound ${serializedBound}/${bindings.length} properties.`);
        if (serializedBound > propertiesBound) {
            propertiesBound = serializedBound;
        }
        if (openedAssetUrl && serializedBound > 0) {
            await Editor.Message.request('asset-db', 'refresh-asset', openedAssetUrl);
            try {
                await Editor.Message.request('scene', 'soft-reload');
            } catch {
                // ignore
            }
            // Prefab stage may keep stale memory; reopen forces inspector to load disk bindings.
            try {
                await Editor.Message.request('scene', 'open-scene', openedAssetUrl);
                console.log(`[${PACKAGE_NAME}] Reopened asset after serialized bind: ${openedAssetUrl}`);
            } catch (error) {
                console.warn(`[${PACKAGE_NAME}] Failed to reopen asset after serialized bind.`, error);
            }
        }
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] Failed to bind serialized prefab/scene references.`, error);
    }

    return propertiesBound;
}

async function waitForBindableComponent(
    nodeUuid: string,
    className: string,
    scriptUrl: string,
    propertyNames: string[],
    targetScript?: NodeScriptInfo | null,
): Promise<string | null> {
    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const typeNames = [...new Set([
        ...(targetScript?.cid ? [targetScript.cid] : []),
        ...(targetScript?.className ? [targetScript.className] : []),
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
            } catch {
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

async function bindComponentProperties(
    nodeUuid: string,
    className: string,
    scriptUrl: string,
    bindings: ScannedBinding[],
    targetScript?: NodeScriptInfo | null,
): Promise<number> {
    const typeNames = [
        ...(targetScript?.cid ? [targetScript.cid] : []),
        ...(targetScript?.className ? [targetScript.className] : []),
        className,
    ].filter(Boolean);

    const componentUuid = await waitForBindableComponent(
        nodeUuid,
        className,
        scriptUrl,
        bindings.map((item) => item.propertyName),
        targetScript,
    );
    if (!componentUuid) {
        console.warn(`[${PACKAGE_NAME}] Cannot find component ${className} for property binding. cid=${targetScript?.cid || ''}`);
        return 0;
    }

    const componentIndex = await findComponentIndexOnNode(nodeUuid, typeNames.length > 0 ? typeNames : [componentUuid]);
    console.log(`[${PACKAGE_NAME}] Binding through componentUuid=${componentUuid}, compsIndex=${componentIndex}`);
    let boundCount = 0;

    for (const binding of bindings) {
        let propertyDump: any | null = null;
        try {
            const componentDump = await Editor.Message.request('scene', 'query-component', componentUuid);
            propertyDump = getPropertyDump(componentDump, binding.propertyName);
            if (!propertyDump) {
                console.warn(`[${PACKAGE_NAME}] Property dump missing for ${binding.propertyName}. dump keys=${Object.keys(componentDump?.value || componentDump || {}).join(',')}`);
            }
        } catch (error) {
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
        } else {
            console.warn(`[${PACKAGE_NAME}] set-property failed for ${binding.propertyName}.`);
        }
    }

    return boundCount;
}

async function findComponentIndexOnNode(nodeUuid: string, matchNames: string[]): Promise<number> {
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node?.__comps__) ? node.__comps__ : [];

    for (let index = 0; index < components.length; index += 1) {
        const componentAny = components[index] as any;
        const uuid = String(readDumpValue(componentAny?.value?.uuid) || readDumpValue(componentAny?.uuid) || '');
        const candidates = [
            uuid,
            componentAny?.type,
            componentAny?.name,
            componentAny?.cid,
            componentAny?.value?.name,
            componentAny?.value?.__type__,
            componentAny?.value?.cid,
            componentAny?.value?.type,
        ].map(readDumpValue).filter(Boolean).map(String);

        if (candidates.some((candidate) => matchNames.some((name) => isExactComponentIdentity(String(name), candidate) || matchesComponentName(candidate, String(name))))) {
            return index;
        }
    }

    return -1;
}

async function findComponentUuid(nodeUuid: string, componentName: string | string[]): Promise<string | null> {
    const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
    const components = Array.isArray(node?.__comps__) ? node.__comps__ : [];
    const componentNames = Array.isArray(componentName) ? componentName : [componentName];

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

        if (candidates.some((candidate) => componentNames.some((name) => matchesComponentName(candidate, name)))) {
            return uuid || null;
        }
    }

    return null;
}

function getPropertyDump(componentDump: any, propertyName: string): any | null {
    const dump = componentDump?.value?.[propertyName] || componentDump?.[propertyName];
    return dump && typeof dump === 'object' ? dump : null;
}

async function setReferenceProperty(
    nodeUuid: string,
    componentUuid: string,
    componentIndex: number,
    propertyName: string,
    propertyDump: any,
    targetUuid: string,
): Promise<boolean> {
    const candidates = makeReferenceDumpCandidates(propertyDump, targetUuid);
    const attempts: Array<{ uuid: string; path: string }> = [];

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
            } catch (error) {
                // try next candidate shape
            }
        }
        console.warn(`[${PACKAGE_NAME}] set-property failed for ${propertyName} via uuid=${attempt.uuid}, path=${attempt.path}`);
    }

    return false;
}

function makeReferenceDumpCandidates(propertyDump: any, targetUuid: string): any[] {
    const base = JSON.parse(JSON.stringify(propertyDump));
    const type = base.type || base.ctype || undefined;
    const candidates: any[] = [];

    const valueShapes = [
        { uuid: targetUuid },
        targetUuid,
        { __uuid__: targetUuid },
        { value: { uuid: targetUuid } },
        { uuid: targetUuid, type },
    ];

    if (base.value && typeof base.value === 'object') {
        valueShapes.unshift({
            ...base.value,
            uuid: targetUuid,
        });
    }

    for (const value of valueShapes) {
        candidates.push({
            ...base,
            value,
        });

        if (type) {
            candidates.push({
                ...base,
                type,
                value,
            });
        }
    }

    return candidates;
}

async function bindSerializedAssetReferences(
    openedAssetUrl: string | null,
    scriptUrl: string,
    selectedUuid: string,
    className: string,
    selectedTree: any,
    bindings: ScannedBinding[],
): Promise<number> {
    if (!openedAssetUrl) {
        return 0;
    }

    const asset = await Editor.Message.request('asset-db', 'query-asset-info', openedAssetUrl);
    if (!asset?.file || !/\.(prefab|scene)$/i.test(asset.file)) {
        return 0;
    }

    const data = await readJsonFileWithRetry(asset.file);
    if (!Array.isArray(data)) {
        return 0;
    }

    const rootName = getNodeName(selectedTree);
    const selectedChildNames = new Set(collectNodeNames(selectedTree).slice(1));
    const nodeIdByUuid = new Map<string, number>();
    const nodeIdsByName = new Map<string, number[]>();
    const componentIdsByNodeIdAndType = new Map<string, number>();

    data.forEach((item, index) => {
        if (item?.__type__ === 'cc.Node') {
            const nodeUuid = item?._id || item?._uuid || '';
            if (nodeUuid) {
                nodeIdByUuid.set(nodeUuid, index);
            }
            if (typeof item?._name === 'string') {
                const list = nodeIdsByName.get(item._name) || [];
                list.push(index);
                nodeIdsByName.set(item._name, list);
            }
        }
    });

    data.forEach((item, index) => {
        const nodeId = item?.node?.__id__;
        if (!Number.isInteger(nodeId) || typeof item?.__type__ !== 'string') {
            return;
        }

        componentIdsByNodeIdAndType.set(`${nodeId}:${item.__type__}`, index);
        componentIdsByNodeIdAndType.set(`${nodeId}:${shortTypeName(item.__type__)}`, index);
    });

    const selectedNodeId = nodeIdByUuid.get(selectedUuid)
        ?? findSerializedNodeIdByTree(data, rootName, selectedChildNames, nodeIdsByName);
    if (selectedNodeId === undefined) {
        console.warn(`[${PACKAGE_NAME}] Cannot locate selected node ${rootName} in ${openedAssetUrl}.`);
        return 0;
    }

    const scriptAsset = await queryAssetInfoSafe(scriptUrl);
    const scriptTypeNames = getSerializedScriptTypeNames(scriptAsset, className);
    let targetComponent = data.find((item) => {
        if (typeof item?.__type__ !== 'string' || item?.node?.__id__ !== selectedNodeId) {
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
        const targetNodeId = resolveSerializedBindingNodeId(
            data,
            binding,
            selectedNodeId,
            subtreeNodeIds,
            nodeIdByUuid,
            nodeIdsByName,
        );
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
        const componentId = componentIdsByNodeIdAndType.get(`${targetNodeId}:${typeName}`)
            ?? componentIdsByNodeIdAndType.get(`${targetNodeId}:${shortTypeName(typeName)}`);

        if (componentId !== undefined) {
            targetComponent[binding.propertyName] = { __id__: componentId };
            boundCount += 1;
        } else {
            console.warn(`[${PACKAGE_NAME}] Serialized bind missed component ${typeName} on ${binding.nodeName}.`);
        }
    }

    writeFileSync(asset.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return boundCount;
}

function findSerializedNodeIdByTree(
    data: any[],
    rootName: string,
    selectedChildNames: Set<string>,
    nodeIdsByName: Map<string, number[]>,
): number | undefined {
    const candidates = nodeIdsByName.get(rootName) || [];
    if (candidates.length === 0) {
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0];
    }

    let bestId: number | undefined;
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

function getSerializedDirectChildNames(data: any[], nodeId: number): string[] {
    const node = data[nodeId];
    const children = Array.isArray(node?._children) ? node._children : [];
    return children
        .map((child: any) => {
            const childId = child?.__id__;
            return Number.isInteger(childId) ? String(data[childId]?._name || '') : '';
        })
        .filter(Boolean);
}

function collectSerializedSubtreeNodeIds(data: any[], rootNodeId: number): Set<number> {
    const result = new Set<number>();
    const stack = [rootNodeId];

    while (stack.length > 0) {
        const nodeId = stack.pop();
        if (nodeId === undefined || result.has(nodeId)) {
            continue;
        }
        result.add(nodeId);
        const node = data[nodeId];
        const children = Array.isArray(node?._children) ? node._children : [];
        for (const child of children) {
            if (Number.isInteger(child?.__id__)) {
                stack.push(child.__id__);
            }
        }
    }

    return result;
}

function resolveSerializedBindingNodeId(
    data: any[],
    binding: ScannedBinding,
    selectedNodeId: number,
    subtreeNodeIds: Set<number>,
    nodeIdByUuid: Map<string, number>,
    nodeIdsByName: Map<string, number[]>,
): number | undefined {
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

    if (binding.nodeName === data[selectedNodeId]?._name) {
        return selectedNodeId;
    }

    return undefined;
}

function getSerializedScriptTypeNames(scriptAsset: any | null, className: string): string[] {
    return [...new Set([
        ...readScriptCidFromProgramCache(scriptAsset, className),
        className,
    ].filter(Boolean))];
}

function appendSerializedScriptComponent(data: any[], nodeId: number, scriptType: string, bindings: ScannedBinding[]): any {
    const node = data[nodeId];
    const componentId = data.length;
    const prefabInfoId = componentId + 1;
    const component: any = {
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

function makePrefabFileId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = randomBytes(22);
    let result = '';
    for (const byte of bytes) {
        result += chars[byte % chars.length];
    }
    return result;
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
