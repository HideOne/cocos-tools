const PACKAGE_NAME = 'bind-tool';

interface SimpleRule {
    prefix: string;
    componentName: string;
    enabled?: boolean;
}

interface BindToolConfig {
    scriptRoot: string;
    autoAddButtonComponent: boolean;
    overwriteMode: 'marker';
    stopPrefix: string;
    rules: SimpleRule[];
}

const defaultRules: SimpleRule[] = [
    { prefix: 'node', componentName: 'Node', enabled: true },
    { prefix: 'node_stop', componentName: 'Node', enabled: true },
    { prefix: 'spine', componentName: 'sp.Skeleton', enabled: true },
    { prefix: 'button', componentName: 'Button', enabled: true },
];

let currentConfig: BindToolConfig = makeDefaultConfig();
let panelElements: Record<string, HTMLElement> = {};

export const template = `
<section class="bind-tool-panel">
    <header class="toolbar">
        <div>
            <h2>Bind Rules</h2>
            <p>Configure node name prefix and component name only. Node binds the current node; other names bind that component on the node.</p>
        </div>
        <div class="toolbar-actions">
            <button id="reset">Reset</button>
            <button id="save" class="primary">Save</button>
        </div>
    </header>

    <div class="settings">
        <label>
            <span>Script Root</span>
            <input id="scriptRoot" spellcheck="false" />
        </label>
        <label>
            <span>Stop Prefix</span>
            <input id="stopPrefix" spellcheck="false" />
        </label>
        <label class="checkbox">
            <input id="autoAddButtonComponent" type="checkbox" />
            <span>Auto add Button component</span>
        </label>
    </div>

    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th class="enabled">Enabled</th>
                    <th>Node Prefix</th>
                    <th>Component Name</th>
                    <th class="operation"></th>
                </tr>
            </thead>
            <tbody id="rules"></tbody>
        </table>
    </div>

    <footer class="footer">
        <button id="add">Add Rule</button>
        <span id="status"></span>
    </footer>
</section>
`;

export const style = `
.bind-tool-panel {
    box-sizing: border-box;
    height: 100%;
    padding: 16px;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill);
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
}

.toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
}

p {
    margin: 0;
    color: var(--color-normal-contrast-weakest);
}

.toolbar-actions,
.footer {
    display: flex;
    align-items: center;
    gap: 8px;
}

.settings {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(160px, 220px) minmax(180px, auto);
    gap: 10px;
    align-items: end;
}

label {
    display: grid;
    gap: 6px;
}

.checkbox {
    grid-template-columns: auto 1fr;
    gap: 8px;
    align-items: center;
    padding-bottom: 7px;
}

input {
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    border: 1px solid var(--color-normal-border);
    border-radius: 4px;
    padding: 4px 8px;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill-important);
}

input[type="checkbox"] {
    width: auto;
    min-height: auto;
}

button {
    min-height: 28px;
    border: 1px solid var(--color-normal-border);
    border-radius: 4px;
    padding: 4px 12px;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill-emphasis);
}

button.primary {
    color: var(--color-primary-contrast);
    background: var(--color-primary-fill);
    border-color: var(--color-primary-fill);
}

.table-wrap {
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--color-normal-border);
    border-radius: 6px;
}

table {
    width: 100%;
    border-collapse: collapse;
}

th,
td {
    border-bottom: 1px solid var(--color-normal-border);
    padding: 8px;
    text-align: left;
}

th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-normal-fill-emphasis);
    font-weight: 600;
}

.enabled {
    width: 70px;
}

.operation {
    width: 70px;
}

td.enabled,
td.operation {
    text-align: center;
}

.mini {
    width: 42px;
    padding: 0;
}

.footer {
    justify-content: space-between;
}

#status {
    color: var(--color-success-fill);
}
`;

export const $ = {
    rules: '#rules',
    scriptRoot: '#scriptRoot',
    stopPrefix: '#stopPrefix',
    autoAddButtonComponent: '#autoAddButtonComponent',
    add: '#add',
    save: '#save',
    reset: '#reset',
    status: '#status',
};

export async function ready(this: { $?: Record<string, HTMLElement> }) {
    panelElements = this.$ || {};
    await loadConfig();
    bindEvents();
}

async function loadConfig() {
    try {
        currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'query-config'));
    } catch {
        currentConfig = makeDefaultConfig();
    }

    renderConfig();
}

function makeDefaultConfig(): BindToolConfig {
    return {
        scriptRoot: 'assets/src',
        autoAddButtonComponent: true,
        overwriteMode: 'marker',
        stopPrefix: 'stop',
        rules: defaultRules.map((rule) => ({ ...rule })),
    };
}

function normalizeConfig(config: any): BindToolConfig {
    const rules = Array.isArray(config?.rules) && config.rules.length > 0
        ? config.rules.map(normalizeRule).filter((rule: SimpleRule) => rule.prefix)
        : defaultRules.map((rule) => ({ ...rule }));

    return {
        scriptRoot: String(config?.scriptRoot || 'assets/src'),
        autoAddButtonComponent: config?.autoAddButtonComponent !== false,
        overwriteMode: 'marker',
        stopPrefix: String(config?.stopPrefix || 'stop'),
        rules: rules.length > 0 ? rules : defaultRules.map((rule) => ({ ...rule })),
    };
}

function normalizeRule(rule: any): SimpleRule {
    return {
        prefix: String(rule.prefix || '').trim(),
        componentName: String(rule.componentName || rule.propertyType || 'Node').trim() || 'Node',
        enabled: rule.enabled !== false,
    };
}

function renderConfig() {
    input('scriptRoot').value = currentConfig.scriptRoot;
    input('stopPrefix').value = currentConfig.stopPrefix;
    input('autoAddButtonComponent').checked = currentConfig.autoAddButtonComponent;
    element('rules').innerHTML = currentConfig.rules.map(renderRule).join('');
}

function renderRule(rule: SimpleRule, index: number): string {
    return `
        <tr data-index="${index}">
            <td class="enabled"><input data-key="enabled" type="checkbox" ${rule.enabled !== false ? 'checked' : ''}></td>
            <td><input data-key="prefix" value="${escapeHtml(rule.prefix)}" spellcheck="false"></td>
            <td><input data-key="componentName" value="${escapeHtml(rule.componentName)}" spellcheck="false"></td>
            <td class="operation"><button class="mini" data-action="delete">Del</button></td>
        </tr>
    `;
}

function bindEvents() {
    element('add').addEventListener('click', () => {
        currentConfig.rules.push({ prefix: 'label', componentName: 'Label', enabled: true });
        renderConfig();
        setStatus('Rule added. Save to apply.');
    });

    element('save').addEventListener('click', async () => {
        currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'save-config', collectConfig()));
        renderConfig();
        setStatus('Saved.');
    });

    element('reset').addEventListener('click', async () => {
        currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'reset-config'));
        renderConfig();
        setStatus('Default rules restored.');
    });

    element('rules').addEventListener('input', onRulesChanged);
    element('rules').addEventListener('change', onRulesChanged);
    element('rules').addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.dataset.action !== 'delete') {
            return;
        }

        const index = getRowIndex(target);
        if (index < 0) {
            return;
        }

        currentConfig.rules.splice(index, 1);
        renderConfig();
        setStatus('Rule deleted. Save to apply.');
    });
}

function onRulesChanged(event: Event) {
    const target = event.target as HTMLInputElement;
    const key = target.dataset.key as keyof SimpleRule | undefined;
    const index = getRowIndex(target);
    if (!key || index < 0) {
        return;
    }

    const rule = currentConfig.rules[index] as any;
    rule[key] = target.type === 'checkbox' ? target.checked : target.value;
}

function collectConfig(): BindToolConfig {
    return {
        scriptRoot: input('scriptRoot').value.trim() || 'assets/src',
        stopPrefix: input('stopPrefix').value.trim() || 'stop',
        autoAddButtonComponent: input('autoAddButtonComponent').checked,
        overwriteMode: 'marker',
        rules: currentConfig.rules
            .map((rule) => ({
                prefix: rule.prefix.trim(),
                componentName: rule.componentName.trim() || 'Node',
                enabled: rule.enabled !== false,
            }))
            .filter((rule) => rule.prefix),
    };
}

function getRowIndex(target: HTMLElement): number {
    const row = target.closest('tr') as HTMLTableRowElement | null;
    const index = Number(row?.dataset.index);
    return Number.isInteger(index) ? index : -1;
}

function setStatus(message: string) {
    element('status').textContent = message;
    window.setTimeout(() => {
        element('status').textContent = '';
    }, 2500);
}

function element<T extends HTMLElement = HTMLElement>(key: keyof typeof $): T {
    const fromPanel = panelElements[key];
    if (fromPanel) {
        return fromPanel as T;
    }

    const found = document.querySelector($[key]);
    if (!found) {
        throw new Error(`Missing element: ${$[key]}`);
    }

    return found as T;
}

function input(key: keyof typeof $): HTMLInputElement {
    return element<HTMLInputElement>(key);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
