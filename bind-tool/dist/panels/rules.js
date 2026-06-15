"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.$ = exports.style = exports.template = void 0;
exports.ready = ready;
const PACKAGE_NAME = 'bind-tool';
const defaultRules = [
    { prefix: 'node', componentName: 'Node', enabled: true },
    { prefix: 'node_stop', componentName: 'Node', enabled: true },
    { prefix: 'spine', componentName: 'sp.Skeleton', enabled: true },
    { prefix: 'button', componentName: 'Button', enabled: true },
];
let currentConfig = makeDefaultConfig();
let panelElements = {};
exports.template = `
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
exports.style = `
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
exports.$ = {
    rules: '#rules',
    scriptRoot: '#scriptRoot',
    stopPrefix: '#stopPrefix',
    autoAddButtonComponent: '#autoAddButtonComponent',
    add: '#add',
    save: '#save',
    reset: '#reset',
    status: '#status',
};
async function ready() {
    panelElements = this.$ || {};
    await loadConfig();
    bindEvents();
}
async function loadConfig() {
    try {
        currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'query-config'));
    }
    catch (_a) {
        currentConfig = makeDefaultConfig();
    }
    renderConfig();
}
function makeDefaultConfig() {
    return {
        scriptRoot: 'assets/src',
        autoAddButtonComponent: true,
        overwriteMode: 'marker',
        stopPrefix: 'stop',
        rules: defaultRules.map((rule) => (Object.assign({}, rule))),
    };
}
function normalizeConfig(config) {
    const rules = Array.isArray(config === null || config === void 0 ? void 0 : config.rules) && config.rules.length > 0
        ? config.rules.map(normalizeRule).filter((rule) => rule.prefix)
        : defaultRules.map((rule) => (Object.assign({}, rule)));
    return {
        scriptRoot: String((config === null || config === void 0 ? void 0 : config.scriptRoot) || 'assets/src'),
        autoAddButtonComponent: (config === null || config === void 0 ? void 0 : config.autoAddButtonComponent) !== false,
        overwriteMode: 'marker',
        stopPrefix: String((config === null || config === void 0 ? void 0 : config.stopPrefix) || 'stop'),
        rules: rules.length > 0 ? rules : defaultRules.map((rule) => (Object.assign({}, rule))),
    };
}
function normalizeRule(rule) {
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
function renderRule(rule, index) {
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
        const target = event.target;
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
function onRulesChanged(event) {
    const target = event.target;
    const key = target.dataset.key;
    const index = getRowIndex(target);
    if (!key || index < 0) {
        return;
    }
    const rule = currentConfig.rules[index];
    rule[key] = target.type === 'checkbox' ? target.checked : target.value;
}
function collectConfig() {
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
function getRowIndex(target) {
    const row = target.closest('tr');
    const index = Number(row === null || row === void 0 ? void 0 : row.dataset.index);
    return Number.isInteger(index) ? index : -1;
}
function setStatus(message) {
    element('status').textContent = message;
    window.setTimeout(() => {
        element('status').textContent = '';
    }, 2500);
}
function element(key) {
    const fromPanel = panelElements[key];
    if (fromPanel) {
        return fromPanel;
    }
    const found = document.querySelector(exports.$[key]);
    if (!found) {
        throw new Error(`Missing element: ${exports.$[key]}`);
    }
    return found;
}
function input(key) {
    return element(key);
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVsZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvcGFuZWxzL3J1bGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQW9PQSxzQkFJQztBQXhPRCxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUM7QUFnQmpDLE1BQU0sWUFBWSxHQUFpQjtJQUMvQixFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsYUFBYSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO0lBQ3hELEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUU7SUFDN0QsRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRTtJQUNoRSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO0NBQy9ELENBQUM7QUFFRixJQUFJLGFBQWEsR0FBbUIsaUJBQWlCLEVBQUUsQ0FBQztBQUN4RCxJQUFJLGFBQWEsR0FBZ0MsRUFBRSxDQUFDO0FBRXZDLFFBQUEsUUFBUSxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQStDdkIsQ0FBQztBQUVXLFFBQUEsS0FBSyxHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQTRJcEIsQ0FBQztBQUVXLFFBQUEsQ0FBQyxHQUFHO0lBQ2IsS0FBSyxFQUFFLFFBQVE7SUFDZixVQUFVLEVBQUUsYUFBYTtJQUN6QixVQUFVLEVBQUUsYUFBYTtJQUN6QixzQkFBc0IsRUFBRSx5QkFBeUI7SUFDakQsR0FBRyxFQUFFLE1BQU07SUFDWCxJQUFJLEVBQUUsT0FBTztJQUNiLEtBQUssRUFBRSxRQUFRO0lBQ2YsTUFBTSxFQUFFLFNBQVM7Q0FDcEIsQ0FBQztBQUVLLEtBQUssVUFBVSxLQUFLO0lBQ3ZCLGFBQWEsR0FBRyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUM3QixNQUFNLFVBQVUsRUFBRSxDQUFDO0lBQ25CLFVBQVUsRUFBRSxDQUFDO0FBQ2pCLENBQUM7QUFFRCxLQUFLLFVBQVUsVUFBVTtJQUNyQixJQUFJLENBQUM7UUFDRCxhQUFhLEdBQUcsZUFBZSxDQUFDLE1BQU0sTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUM7SUFDaEcsQ0FBQztJQUFDLFdBQU0sQ0FBQztRQUNMLGFBQWEsR0FBRyxpQkFBaUIsRUFBRSxDQUFDO0lBQ3hDLENBQUM7SUFFRCxZQUFZLEVBQUUsQ0FBQztBQUNuQixDQUFDO0FBRUQsU0FBUyxpQkFBaUI7SUFDdEIsT0FBTztRQUNILFVBQVUsRUFBRSxZQUFZO1FBQ3hCLHNCQUFzQixFQUFFLElBQUk7UUFDNUIsYUFBYSxFQUFFLFFBQVE7UUFDdkIsVUFBVSxFQUFFLE1BQU07UUFDbEIsS0FBSyxFQUFFLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1CQUFNLElBQUksRUFBRyxDQUFDO0tBQ25ELENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsTUFBVztJQUNoQyxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sYUFBTixNQUFNLHVCQUFOLE1BQU0sQ0FBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO1FBQ2pFLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFnQixFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQzNFLENBQUMsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxtQkFBTSxJQUFJLEVBQUcsQ0FBQyxDQUFDO0lBRWhELE9BQU87UUFDSCxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLFVBQVUsS0FBSSxZQUFZLENBQUM7UUFDdEQsc0JBQXNCLEVBQUUsQ0FBQSxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsc0JBQXNCLE1BQUssS0FBSztRQUNoRSxhQUFhLEVBQUUsUUFBUTtRQUN2QixVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUEsTUFBTSxhQUFOLE1BQU0sdUJBQU4sTUFBTSxDQUFFLFVBQVUsS0FBSSxNQUFNLENBQUM7UUFDaEQsS0FBSyxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1CQUFNLElBQUksRUFBRyxDQUFDO0tBQzlFLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUMsSUFBUztJQUM1QixPQUFPO1FBQ0gsTUFBTSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRTtRQUN4QyxhQUFhLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLElBQUksSUFBSSxDQUFDLFlBQVksSUFBSSxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxNQUFNO1FBQ3pGLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxLQUFLLEtBQUs7S0FDbEMsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFTLFlBQVk7SUFDakIsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLEtBQUssR0FBRyxhQUFhLENBQUMsVUFBVSxDQUFDO0lBQ3JELEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxLQUFLLEdBQUcsYUFBYSxDQUFDLFVBQVUsQ0FBQztJQUNyRCxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxPQUFPLEdBQUcsYUFBYSxDQUFDLHNCQUFzQixDQUFDO0lBQy9FLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxTQUFTLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzlFLENBQUM7QUFFRCxTQUFTLFVBQVUsQ0FBQyxJQUFnQixFQUFFLEtBQWE7SUFDL0MsT0FBTzswQkFDZSxLQUFLOzRFQUM2QyxJQUFJLENBQUMsT0FBTyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFFO2tEQUNqRSxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQzt5REFDaEIsVUFBVSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7OztLQUdsRixDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsVUFBVTtJQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO1FBQzFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3JGLFlBQVksRUFBRSxDQUFDO1FBQ2YsU0FBUyxDQUFDLDRCQUE0QixDQUFDLENBQUM7SUFDNUMsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ2pELGFBQWEsR0FBRyxlQUFlLENBQUMsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUM1RyxZQUFZLEVBQUUsQ0FBQztRQUNmLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN4QixDQUFDLENBQUMsQ0FBQztJQUVILE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDbEQsYUFBYSxHQUFHLGVBQWUsQ0FBQyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxjQUFjLENBQUMsQ0FBQyxDQUFDO1FBQzVGLFlBQVksRUFBRSxDQUFDO1FBQ2YsU0FBUyxDQUFDLHlCQUF5QixDQUFDLENBQUM7SUFDekMsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQyxDQUFDO0lBQzNELE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDNUQsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFO1FBQ2pELE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFxQixDQUFDO1FBQzNDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDckMsT0FBTztRQUNYLENBQUM7UUFFRCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbEMsSUFBSSxLQUFLLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDWixPQUFPO1FBQ1gsQ0FBQztRQUVELGFBQWEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNyQyxZQUFZLEVBQUUsQ0FBQztRQUNmLFNBQVMsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0lBQzlDLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELFNBQVMsY0FBYyxDQUFDLEtBQVk7SUFDaEMsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQTBCLENBQUM7SUFDaEQsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFtQyxDQUFDO0lBQy9ELE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNsQyxJQUFJLENBQUMsR0FBRyxJQUFJLEtBQUssR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNwQixPQUFPO0lBQ1gsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFRLENBQUM7SUFDL0MsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDO0FBQzNFLENBQUM7QUFFRCxTQUFTLGFBQWE7SUFDbEIsT0FBTztRQUNILFVBQVUsRUFBRSxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLFlBQVk7UUFDNUQsVUFBVSxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksTUFBTTtRQUN0RCxzQkFBc0IsRUFBRSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxPQUFPO1FBQy9ELGFBQWEsRUFBRSxRQUFRO1FBQ3ZCLEtBQUssRUFBRSxhQUFhLENBQUMsS0FBSzthQUNyQixHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDWixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7WUFDMUIsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLElBQUksTUFBTTtZQUNsRCxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sS0FBSyxLQUFLO1NBQ2xDLENBQUMsQ0FBQzthQUNGLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztLQUNyQyxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLE1BQW1CO0lBQ3BDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUErQixDQUFDO0lBQy9ELE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxHQUFHLGFBQUgsR0FBRyx1QkFBSCxHQUFHLENBQUUsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3pDLE9BQU8sTUFBTSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNoRCxDQUFDO0FBRUQsU0FBUyxTQUFTLENBQUMsT0FBZTtJQUM5QixPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsV0FBVyxHQUFHLE9BQU8sQ0FBQztJQUN4QyxNQUFNLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNuQixPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsV0FBVyxHQUFHLEVBQUUsQ0FBQztJQUN2QyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDYixDQUFDO0FBRUQsU0FBUyxPQUFPLENBQXNDLEdBQW1CO0lBQ3JFLE1BQU0sU0FBUyxHQUFHLGFBQWEsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyQyxJQUFJLFNBQVMsRUFBRSxDQUFDO1FBQ1osT0FBTyxTQUFjLENBQUM7SUFDMUIsQ0FBQztJQUVELE1BQU0sS0FBSyxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsU0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDN0MsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1QsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsU0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNsRCxDQUFDO0lBRUQsT0FBTyxLQUFVLENBQUM7QUFDdEIsQ0FBQztBQUVELFNBQVMsS0FBSyxDQUFDLEdBQW1CO0lBQzlCLE9BQU8sT0FBTyxDQUFtQixHQUFHLENBQUMsQ0FBQztBQUMxQyxDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsS0FBYTtJQUM3QixPQUFPLEtBQUs7U0FDUCxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQztTQUN0QixPQUFPLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQztTQUNyQixPQUFPLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQztTQUNyQixPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0FBQ2pDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBQQUNLQUdFX05BTUUgPSAnYmluZC10b29sJztcblxuaW50ZXJmYWNlIFNpbXBsZVJ1bGUge1xuICAgIHByZWZpeDogc3RyaW5nO1xuICAgIGNvbXBvbmVudE5hbWU6IHN0cmluZztcbiAgICBlbmFibGVkPzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIEJpbmRUb29sQ29uZmlnIHtcbiAgICBzY3JpcHRSb290OiBzdHJpbmc7XG4gICAgYXV0b0FkZEJ1dHRvbkNvbXBvbmVudDogYm9vbGVhbjtcbiAgICBvdmVyd3JpdGVNb2RlOiAnbWFya2VyJztcbiAgICBzdG9wUHJlZml4OiBzdHJpbmc7XG4gICAgcnVsZXM6IFNpbXBsZVJ1bGVbXTtcbn1cblxuY29uc3QgZGVmYXVsdFJ1bGVzOiBTaW1wbGVSdWxlW10gPSBbXG4gICAgeyBwcmVmaXg6ICdub2RlJywgY29tcG9uZW50TmFtZTogJ05vZGUnLCBlbmFibGVkOiB0cnVlIH0sXG4gICAgeyBwcmVmaXg6ICdub2RlX3N0b3AnLCBjb21wb25lbnROYW1lOiAnTm9kZScsIGVuYWJsZWQ6IHRydWUgfSxcbiAgICB7IHByZWZpeDogJ3NwaW5lJywgY29tcG9uZW50TmFtZTogJ3NwLlNrZWxldG9uJywgZW5hYmxlZDogdHJ1ZSB9LFxuICAgIHsgcHJlZml4OiAnYnV0dG9uJywgY29tcG9uZW50TmFtZTogJ0J1dHRvbicsIGVuYWJsZWQ6IHRydWUgfSxcbl07XG5cbmxldCBjdXJyZW50Q29uZmlnOiBCaW5kVG9vbENvbmZpZyA9IG1ha2VEZWZhdWx0Q29uZmlnKCk7XG5sZXQgcGFuZWxFbGVtZW50czogUmVjb3JkPHN0cmluZywgSFRNTEVsZW1lbnQ+ID0ge307XG5cbmV4cG9ydCBjb25zdCB0ZW1wbGF0ZSA9IGBcbjxzZWN0aW9uIGNsYXNzPVwiYmluZC10b29sLXBhbmVsXCI+XG4gICAgPGhlYWRlciBjbGFzcz1cInRvb2xiYXJcIj5cbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxoMj5CaW5kIFJ1bGVzPC9oMj5cbiAgICAgICAgICAgIDxwPkNvbmZpZ3VyZSBub2RlIG5hbWUgcHJlZml4IGFuZCBjb21wb25lbnQgbmFtZSBvbmx5LiBOb2RlIGJpbmRzIHRoZSBjdXJyZW50IG5vZGU7IG90aGVyIG5hbWVzIGJpbmQgdGhhdCBjb21wb25lbnQgb24gdGhlIG5vZGUuPC9wPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInRvb2xiYXItYWN0aW9uc1wiPlxuICAgICAgICAgICAgPGJ1dHRvbiBpZD1cInJlc2V0XCI+UmVzZXQ8L2J1dHRvbj5cbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJzYXZlXCIgY2xhc3M9XCJwcmltYXJ5XCI+U2F2ZTwvYnV0dG9uPlxuICAgICAgICA8L2Rpdj5cbiAgICA8L2hlYWRlcj5cblxuICAgIDxkaXYgY2xhc3M9XCJzZXR0aW5nc1wiPlxuICAgICAgICA8bGFiZWw+XG4gICAgICAgICAgICA8c3Bhbj5TY3JpcHQgUm9vdDwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCBpZD1cInNjcmlwdFJvb3RcIiBzcGVsbGNoZWNrPVwiZmFsc2VcIiAvPlxuICAgICAgICA8L2xhYmVsPlxuICAgICAgICA8bGFiZWw+XG4gICAgICAgICAgICA8c3Bhbj5TdG9wIFByZWZpeDwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCBpZD1cInN0b3BQcmVmaXhcIiBzcGVsbGNoZWNrPVwiZmFsc2VcIiAvPlxuICAgICAgICA8L2xhYmVsPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJjaGVja2JveFwiPlxuICAgICAgICAgICAgPGlucHV0IGlkPVwiYXV0b0FkZEJ1dHRvbkNvbXBvbmVudFwiIHR5cGU9XCJjaGVja2JveFwiIC8+XG4gICAgICAgICAgICA8c3Bhbj5BdXRvIGFkZCBCdXR0b24gY29tcG9uZW50PC9zcGFuPlxuICAgICAgICA8L2xhYmVsPlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cInRhYmxlLXdyYXBcIj5cbiAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgPHRoZWFkPlxuICAgICAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgICAgICAgPHRoIGNsYXNzPVwiZW5hYmxlZFwiPkVuYWJsZWQ8L3RoPlxuICAgICAgICAgICAgICAgICAgICA8dGg+Tm9kZSBQcmVmaXg8L3RoPlxuICAgICAgICAgICAgICAgICAgICA8dGg+Q29tcG9uZW50IE5hbWU8L3RoPlxuICAgICAgICAgICAgICAgICAgICA8dGggY2xhc3M9XCJvcGVyYXRpb25cIj48L3RoPlxuICAgICAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICA8L3RoZWFkPlxuICAgICAgICAgICAgPHRib2R5IGlkPVwicnVsZXNcIj48L3Rib2R5PlxuICAgICAgICA8L3RhYmxlPlxuICAgIDwvZGl2PlxuXG4gICAgPGZvb3RlciBjbGFzcz1cImZvb3RlclwiPlxuICAgICAgICA8YnV0dG9uIGlkPVwiYWRkXCI+QWRkIFJ1bGU8L2J1dHRvbj5cbiAgICAgICAgPHNwYW4gaWQ9XCJzdGF0dXNcIj48L3NwYW4+XG4gICAgPC9mb290ZXI+XG48L3NlY3Rpb24+XG5gO1xuXG5leHBvcnQgY29uc3Qgc3R5bGUgPSBgXG4uYmluZC10b29sLXBhbmVsIHtcbiAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xuICAgIGhlaWdodDogMTAwJTtcbiAgICBwYWRkaW5nOiAxNnB4O1xuICAgIGNvbG9yOiB2YXIoLS1jb2xvci1ub3JtYWwtY29udHJhc3QpO1xuICAgIGJhY2tncm91bmQ6IHZhcigtLWNvbG9yLW5vcm1hbC1maWxsKTtcbiAgICBkaXNwbGF5OiBmbGV4O1xuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gICAgZ2FwOiAxNHB4O1xuICAgIGZvbnQtc2l6ZTogMTNweDtcbn1cblxuLnRvb2xiYXIge1xuICAgIGRpc3BsYXk6IGZsZXg7XG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47XG4gICAgZ2FwOiAxNnB4O1xufVxuXG5oMiB7XG4gICAgbWFyZ2luOiAwIDAgNHB4O1xuICAgIGZvbnQtc2l6ZTogMThweDtcbiAgICBmb250LXdlaWdodDogNjAwO1xufVxuXG5wIHtcbiAgICBtYXJnaW46IDA7XG4gICAgY29sb3I6IHZhcigtLWNvbG9yLW5vcm1hbC1jb250cmFzdC13ZWFrZXN0KTtcbn1cblxuLnRvb2xiYXItYWN0aW9ucyxcbi5mb290ZXIge1xuICAgIGRpc3BsYXk6IGZsZXg7XG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgICBnYXA6IDhweDtcbn1cblxuLnNldHRpbmdzIHtcbiAgICBkaXNwbGF5OiBncmlkO1xuICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczogbWlubWF4KDE4MHB4LCAxZnIpIG1pbm1heCgxNjBweCwgMjIwcHgpIG1pbm1heCgxODBweCwgYXV0byk7XG4gICAgZ2FwOiAxMHB4O1xuICAgIGFsaWduLWl0ZW1zOiBlbmQ7XG59XG5cbmxhYmVsIHtcbiAgICBkaXNwbGF5OiBncmlkO1xuICAgIGdhcDogNnB4O1xufVxuXG4uY2hlY2tib3gge1xuICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczogYXV0byAxZnI7XG4gICAgZ2FwOiA4cHg7XG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgICBwYWRkaW5nLWJvdHRvbTogN3B4O1xufVxuXG5pbnB1dCB7XG4gICAgYm94LXNpemluZzogYm9yZGVyLWJveDtcbiAgICB3aWR0aDogMTAwJTtcbiAgICBtaW4taGVpZ2h0OiAyOHB4O1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpO1xuICAgIGJvcmRlci1yYWRpdXM6IDRweDtcbiAgICBwYWRkaW5nOiA0cHggOHB4O1xuICAgIGNvbG9yOiB2YXIoLS1jb2xvci1ub3JtYWwtY29udHJhc3QpO1xuICAgIGJhY2tncm91bmQ6IHZhcigtLWNvbG9yLW5vcm1hbC1maWxsLWltcG9ydGFudCk7XG59XG5cbmlucHV0W3R5cGU9XCJjaGVja2JveFwiXSB7XG4gICAgd2lkdGg6IGF1dG87XG4gICAgbWluLWhlaWdodDogYXV0bztcbn1cblxuYnV0dG9uIHtcbiAgICBtaW4taGVpZ2h0OiAyOHB4O1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpO1xuICAgIGJvcmRlci1yYWRpdXM6IDRweDtcbiAgICBwYWRkaW5nOiA0cHggMTJweDtcbiAgICBjb2xvcjogdmFyKC0tY29sb3Itbm9ybWFsLWNvbnRyYXN0KTtcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jb2xvci1ub3JtYWwtZmlsbC1lbXBoYXNpcyk7XG59XG5cbmJ1dHRvbi5wcmltYXJ5IHtcbiAgICBjb2xvcjogdmFyKC0tY29sb3ItcHJpbWFyeS1jb250cmFzdCk7XG4gICAgYmFja2dyb3VuZDogdmFyKC0tY29sb3ItcHJpbWFyeS1maWxsKTtcbiAgICBib3JkZXItY29sb3I6IHZhcigtLWNvbG9yLXByaW1hcnktZmlsbCk7XG59XG5cbi50YWJsZS13cmFwIHtcbiAgICBtaW4taGVpZ2h0OiAwO1xuICAgIG92ZXJmbG93OiBhdXRvO1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWNvbG9yLW5vcm1hbC1ib3JkZXIpO1xuICAgIGJvcmRlci1yYWRpdXM6IDZweDtcbn1cblxudGFibGUge1xuICAgIHdpZHRoOiAxMDAlO1xuICAgIGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7XG59XG5cbnRoLFxudGQge1xuICAgIGJvcmRlci1ib3R0b206IDFweCBzb2xpZCB2YXIoLS1jb2xvci1ub3JtYWwtYm9yZGVyKTtcbiAgICBwYWRkaW5nOiA4cHg7XG4gICAgdGV4dC1hbGlnbjogbGVmdDtcbn1cblxudGgge1xuICAgIHBvc2l0aW9uOiBzdGlja3k7XG4gICAgdG9wOiAwO1xuICAgIHotaW5kZXg6IDE7XG4gICAgYmFja2dyb3VuZDogdmFyKC0tY29sb3Itbm9ybWFsLWZpbGwtZW1waGFzaXMpO1xuICAgIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG5cbi5lbmFibGVkIHtcbiAgICB3aWR0aDogNzBweDtcbn1cblxuLm9wZXJhdGlvbiB7XG4gICAgd2lkdGg6IDcwcHg7XG59XG5cbnRkLmVuYWJsZWQsXG50ZC5vcGVyYXRpb24ge1xuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcbn1cblxuLm1pbmkge1xuICAgIHdpZHRoOiA0MnB4O1xuICAgIHBhZGRpbmc6IDA7XG59XG5cbi5mb290ZXIge1xuICAgIGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2Vlbjtcbn1cblxuI3N0YXR1cyB7XG4gICAgY29sb3I6IHZhcigtLWNvbG9yLXN1Y2Nlc3MtZmlsbCk7XG59XG5gO1xuXG5leHBvcnQgY29uc3QgJCA9IHtcbiAgICBydWxlczogJyNydWxlcycsXG4gICAgc2NyaXB0Um9vdDogJyNzY3JpcHRSb290JyxcbiAgICBzdG9wUHJlZml4OiAnI3N0b3BQcmVmaXgnLFxuICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6ICcjYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcsXG4gICAgYWRkOiAnI2FkZCcsXG4gICAgc2F2ZTogJyNzYXZlJyxcbiAgICByZXNldDogJyNyZXNldCcsXG4gICAgc3RhdHVzOiAnI3N0YXR1cycsXG59O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZHkodGhpczogeyAkPzogUmVjb3JkPHN0cmluZywgSFRNTEVsZW1lbnQ+IH0pIHtcbiAgICBwYW5lbEVsZW1lbnRzID0gdGhpcy4kIHx8IHt9O1xuICAgIGF3YWl0IGxvYWRDb25maWcoKTtcbiAgICBiaW5kRXZlbnRzKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRDb25maWcoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY3VycmVudENvbmZpZyA9IG5vcm1hbGl6ZUNvbmZpZyhhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFBBQ0tBR0VfTkFNRSwgJ3F1ZXJ5LWNvbmZpZycpKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgY3VycmVudENvbmZpZyA9IG1ha2VEZWZhdWx0Q29uZmlnKCk7XG4gICAgfVxuXG4gICAgcmVuZGVyQ29uZmlnKCk7XG59XG5cbmZ1bmN0aW9uIG1ha2VEZWZhdWx0Q29uZmlnKCk6IEJpbmRUb29sQ29uZmlnIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBzY3JpcHRSb290OiAnYXNzZXRzL3NyYycsXG4gICAgICAgIGF1dG9BZGRCdXR0b25Db21wb25lbnQ6IHRydWUsXG4gICAgICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxuICAgICAgICBzdG9wUHJlZml4OiAnc3RvcCcsXG4gICAgICAgIHJ1bGVzOiBkZWZhdWx0UnVsZXMubWFwKChydWxlKSA9PiAoeyAuLi5ydWxlIH0pKSxcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBub3JtYWxpemVDb25maWcoY29uZmlnOiBhbnkpOiBCaW5kVG9vbENvbmZpZyB7XG4gICAgY29uc3QgcnVsZXMgPSBBcnJheS5pc0FycmF5KGNvbmZpZz8ucnVsZXMpICYmIGNvbmZpZy5ydWxlcy5sZW5ndGggPiAwXG4gICAgICAgID8gY29uZmlnLnJ1bGVzLm1hcChub3JtYWxpemVSdWxlKS5maWx0ZXIoKHJ1bGU6IFNpbXBsZVJ1bGUpID0+IHJ1bGUucHJlZml4KVxuICAgICAgICA6IGRlZmF1bHRSdWxlcy5tYXAoKHJ1bGUpID0+ICh7IC4uLnJ1bGUgfSkpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgc2NyaXB0Um9vdDogU3RyaW5nKGNvbmZpZz8uc2NyaXB0Um9vdCB8fCAnYXNzZXRzL3NyYycpLFxuICAgICAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiBjb25maWc/LmF1dG9BZGRCdXR0b25Db21wb25lbnQgIT09IGZhbHNlLFxuICAgICAgICBvdmVyd3JpdGVNb2RlOiAnbWFya2VyJyxcbiAgICAgICAgc3RvcFByZWZpeDogU3RyaW5nKGNvbmZpZz8uc3RvcFByZWZpeCB8fCAnc3RvcCcpLFxuICAgICAgICBydWxlczogcnVsZXMubGVuZ3RoID4gMCA/IHJ1bGVzIDogZGVmYXVsdFJ1bGVzLm1hcCgocnVsZSkgPT4gKHsgLi4ucnVsZSB9KSksXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUnVsZShydWxlOiBhbnkpOiBTaW1wbGVSdWxlIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBwcmVmaXg6IFN0cmluZyhydWxlLnByZWZpeCB8fCAnJykudHJpbSgpLFxuICAgICAgICBjb21wb25lbnROYW1lOiBTdHJpbmcocnVsZS5jb21wb25lbnROYW1lIHx8IHJ1bGUucHJvcGVydHlUeXBlIHx8ICdOb2RlJykudHJpbSgpIHx8ICdOb2RlJyxcbiAgICAgICAgZW5hYmxlZDogcnVsZS5lbmFibGVkICE9PSBmYWxzZSxcbiAgICB9O1xufVxuXG5mdW5jdGlvbiByZW5kZXJDb25maWcoKSB7XG4gICAgaW5wdXQoJ3NjcmlwdFJvb3QnKS52YWx1ZSA9IGN1cnJlbnRDb25maWcuc2NyaXB0Um9vdDtcbiAgICBpbnB1dCgnc3RvcFByZWZpeCcpLnZhbHVlID0gY3VycmVudENvbmZpZy5zdG9wUHJlZml4O1xuICAgIGlucHV0KCdhdXRvQWRkQnV0dG9uQ29tcG9uZW50JykuY2hlY2tlZCA9IGN1cnJlbnRDb25maWcuYXV0b0FkZEJ1dHRvbkNvbXBvbmVudDtcbiAgICBlbGVtZW50KCdydWxlcycpLmlubmVySFRNTCA9IGN1cnJlbnRDb25maWcucnVsZXMubWFwKHJlbmRlclJ1bGUpLmpvaW4oJycpO1xufVxuXG5mdW5jdGlvbiByZW5kZXJSdWxlKHJ1bGU6IFNpbXBsZVJ1bGUsIGluZGV4OiBudW1iZXIpOiBzdHJpbmcge1xuICAgIHJldHVybiBgXG4gICAgICAgIDx0ciBkYXRhLWluZGV4PVwiJHtpbmRleH1cIj5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImVuYWJsZWRcIj48aW5wdXQgZGF0YS1rZXk9XCJlbmFibGVkXCIgdHlwZT1cImNoZWNrYm94XCIgJHtydWxlLmVuYWJsZWQgIT09IGZhbHNlID8gJ2NoZWNrZWQnIDogJyd9PjwvdGQ+XG4gICAgICAgICAgICA8dGQ+PGlucHV0IGRhdGEta2V5PVwicHJlZml4XCIgdmFsdWU9XCIke2VzY2FwZUh0bWwocnVsZS5wcmVmaXgpfVwiIHNwZWxsY2hlY2s9XCJmYWxzZVwiPjwvdGQ+XG4gICAgICAgICAgICA8dGQ+PGlucHV0IGRhdGEta2V5PVwiY29tcG9uZW50TmFtZVwiIHZhbHVlPVwiJHtlc2NhcGVIdG1sKHJ1bGUuY29tcG9uZW50TmFtZSl9XCIgc3BlbGxjaGVjaz1cImZhbHNlXCI+PC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cIm9wZXJhdGlvblwiPjxidXR0b24gY2xhc3M9XCJtaW5pXCIgZGF0YS1hY3Rpb249XCJkZWxldGVcIj5EZWw8L2J1dHRvbj48L3RkPlxuICAgICAgICA8L3RyPlxuICAgIGA7XG59XG5cbmZ1bmN0aW9uIGJpbmRFdmVudHMoKSB7XG4gICAgZWxlbWVudCgnYWRkJykuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICAgIGN1cnJlbnRDb25maWcucnVsZXMucHVzaCh7IHByZWZpeDogJ2xhYmVsJywgY29tcG9uZW50TmFtZTogJ0xhYmVsJywgZW5hYmxlZDogdHJ1ZSB9KTtcbiAgICAgICAgcmVuZGVyQ29uZmlnKCk7XG4gICAgICAgIHNldFN0YXR1cygnUnVsZSBhZGRlZC4gU2F2ZSB0byBhcHBseS4nKTtcbiAgICB9KTtcblxuICAgIGVsZW1lbnQoJ3NhdmUnKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY3VycmVudENvbmZpZyA9IG5vcm1hbGl6ZUNvbmZpZyhhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFBBQ0tBR0VfTkFNRSwgJ3NhdmUtY29uZmlnJywgY29sbGVjdENvbmZpZygpKSk7XG4gICAgICAgIHJlbmRlckNvbmZpZygpO1xuICAgICAgICBzZXRTdGF0dXMoJ1NhdmVkLicpO1xuICAgIH0pO1xuXG4gICAgZWxlbWVudCgncmVzZXQnKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY3VycmVudENvbmZpZyA9IG5vcm1hbGl6ZUNvbmZpZyhhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KFBBQ0tBR0VfTkFNRSwgJ3Jlc2V0LWNvbmZpZycpKTtcbiAgICAgICAgcmVuZGVyQ29uZmlnKCk7XG4gICAgICAgIHNldFN0YXR1cygnRGVmYXVsdCBydWxlcyByZXN0b3JlZC4nKTtcbiAgICB9KTtcblxuICAgIGVsZW1lbnQoJ3J1bGVzJykuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCBvblJ1bGVzQ2hhbmdlZCk7XG4gICAgZWxlbWVudCgncnVsZXMnKS5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCBvblJ1bGVzQ2hhbmdlZCk7XG4gICAgZWxlbWVudCgncnVsZXMnKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChldmVudCkgPT4ge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBldmVudC50YXJnZXQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgIGlmICh0YXJnZXQuZGF0YXNldC5hY3Rpb24gIT09ICdkZWxldGUnKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbmRleCA9IGdldFJvd0luZGV4KHRhcmdldCk7XG4gICAgICAgIGlmIChpbmRleCA8IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGN1cnJlbnRDb25maWcucnVsZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgcmVuZGVyQ29uZmlnKCk7XG4gICAgICAgIHNldFN0YXR1cygnUnVsZSBkZWxldGVkLiBTYXZlIHRvIGFwcGx5LicpO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBvblJ1bGVzQ2hhbmdlZChldmVudDogRXZlbnQpIHtcbiAgICBjb25zdCB0YXJnZXQgPSBldmVudC50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgICBjb25zdCBrZXkgPSB0YXJnZXQuZGF0YXNldC5rZXkgYXMga2V5b2YgU2ltcGxlUnVsZSB8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBpbmRleCA9IGdldFJvd0luZGV4KHRhcmdldCk7XG4gICAgaWYgKCFrZXkgfHwgaW5kZXggPCAwKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBydWxlID0gY3VycmVudENvbmZpZy5ydWxlc1tpbmRleF0gYXMgYW55O1xuICAgIHJ1bGVba2V5XSA9IHRhcmdldC50eXBlID09PSAnY2hlY2tib3gnID8gdGFyZ2V0LmNoZWNrZWQgOiB0YXJnZXQudmFsdWU7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RDb25maWcoKTogQmluZFRvb2xDb25maWcge1xuICAgIHJldHVybiB7XG4gICAgICAgIHNjcmlwdFJvb3Q6IGlucHV0KCdzY3JpcHRSb290JykudmFsdWUudHJpbSgpIHx8ICdhc3NldHMvc3JjJyxcbiAgICAgICAgc3RvcFByZWZpeDogaW5wdXQoJ3N0b3BQcmVmaXgnKS52YWx1ZS50cmltKCkgfHwgJ3N0b3AnLFxuICAgICAgICBhdXRvQWRkQnV0dG9uQ29tcG9uZW50OiBpbnB1dCgnYXV0b0FkZEJ1dHRvbkNvbXBvbmVudCcpLmNoZWNrZWQsXG4gICAgICAgIG92ZXJ3cml0ZU1vZGU6ICdtYXJrZXInLFxuICAgICAgICBydWxlczogY3VycmVudENvbmZpZy5ydWxlc1xuICAgICAgICAgICAgLm1hcCgocnVsZSkgPT4gKHtcbiAgICAgICAgICAgICAgICBwcmVmaXg6IHJ1bGUucHJlZml4LnRyaW0oKSxcbiAgICAgICAgICAgICAgICBjb21wb25lbnROYW1lOiBydWxlLmNvbXBvbmVudE5hbWUudHJpbSgpIHx8ICdOb2RlJyxcbiAgICAgICAgICAgICAgICBlbmFibGVkOiBydWxlLmVuYWJsZWQgIT09IGZhbHNlLFxuICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICAuZmlsdGVyKChydWxlKSA9PiBydWxlLnByZWZpeCksXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0Um93SW5kZXgodGFyZ2V0OiBIVE1MRWxlbWVudCk6IG51bWJlciB7XG4gICAgY29uc3Qgcm93ID0gdGFyZ2V0LmNsb3Nlc3QoJ3RyJykgYXMgSFRNTFRhYmxlUm93RWxlbWVudCB8IG51bGw7XG4gICAgY29uc3QgaW5kZXggPSBOdW1iZXIocm93Py5kYXRhc2V0LmluZGV4KTtcbiAgICByZXR1cm4gTnVtYmVyLmlzSW50ZWdlcihpbmRleCkgPyBpbmRleCA6IC0xO1xufVxuXG5mdW5jdGlvbiBzZXRTdGF0dXMobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgZWxlbWVudCgnc3RhdHVzJykudGV4dENvbnRlbnQgPSBtZXNzYWdlO1xuICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgZWxlbWVudCgnc3RhdHVzJykudGV4dENvbnRlbnQgPSAnJztcbiAgICB9LCAyNTAwKTtcbn1cblxuZnVuY3Rpb24gZWxlbWVudDxUIGV4dGVuZHMgSFRNTEVsZW1lbnQgPSBIVE1MRWxlbWVudD4oa2V5OiBrZXlvZiB0eXBlb2YgJCk6IFQge1xuICAgIGNvbnN0IGZyb21QYW5lbCA9IHBhbmVsRWxlbWVudHNba2V5XTtcbiAgICBpZiAoZnJvbVBhbmVsKSB7XG4gICAgICAgIHJldHVybiBmcm9tUGFuZWwgYXMgVDtcbiAgICB9XG5cbiAgICBjb25zdCBmb3VuZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJFtrZXldKTtcbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBlbGVtZW50OiAkeyRba2V5XX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm91bmQgYXMgVDtcbn1cblxuZnVuY3Rpb24gaW5wdXQoa2V5OiBrZXlvZiB0eXBlb2YgJCk6IEhUTUxJbnB1dEVsZW1lbnQge1xuICAgIHJldHVybiBlbGVtZW50PEhUTUxJbnB1dEVsZW1lbnQ+KGtleSk7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHZhbHVlXG4gICAgICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXG4gICAgICAgIC5yZXBsYWNlKC88L2csICcmbHQ7JylcbiAgICAgICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgICAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xufVxuIl19