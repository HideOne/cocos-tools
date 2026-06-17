"use strict";

const fs = require("fs");
const path = require("path");
const compat = require("../editor-compat");
compat.install("bind-tool");

const PACKAGE_NAME = "bind-tool";

const defaultRules = [
    { prefix: "node", componentName: "Node", enabled: true },
    { prefix: "node_stop", componentName: "Node", enabled: true },
    { prefix: "spine", componentName: "sp.Skeleton", enabled: true },
    { prefix: "button", componentName: "Button", enabled: true },
    { prefix: "img", componentName: "Sprite", enabled: true },
    { prefix: "text", componentName: "Label", enabled: true },
];

function makeDefaultConfig() {
    return {
        scriptRoot: "assets/src",
        autoAddButtonComponent: true,
        overwriteMode: "marker",
        stopPrefix: "stop",
        rules: defaultRules.map((rule) => Object.assign({}, rule)),
    };
}

function findProjectPath() {
    let current = __dirname;
    while (current && current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, "project.json"))) {
            return current;
        }
        current = path.dirname(current);
    }
    return path.resolve(__dirname, "..", "..", "..");
}

function configPath() {
    return path.join(findProjectPath(), "settings", `${PACKAGE_NAME}.json`);
}

function readLocalConfig() {
    try {
        return normalizeConfig(JSON.parse(fs.readFileSync(configPath(), "utf8")));
    } catch (error) {
        return makeDefaultConfig();
    }
}

function writeLocalConfig(config) {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
}

function normalizeConfig(config) {
    const sourceRules = Array.isArray(config && config.rules) && config.rules.length > 0
        ? config.rules
        : defaultRules;
    const rules = sourceRules
        .map((rule) => ({
            prefix: String(rule && rule.prefix || "").trim(),
            componentName: String(rule && (rule.componentName || rule.propertyType) || "Node").trim() || "Node",
            enabled: !rule || rule.enabled !== false,
        }))
        .filter((rule) => rule.prefix);
    const prefixes = new Set(rules.map((rule) => rule.prefix));

    return {
        scriptRoot: String(config && config.scriptRoot || "assets/src"),
        autoAddButtonComponent: !config || config.autoAddButtonComponent !== false,
        overwriteMode: "marker",
        stopPrefix: String(config && config.stopPrefix || "stop"),
        rules: rules.concat(defaultRules.filter((rule) => !prefixes.has(rule.prefix)).map((rule) => Object.assign({}, rule))),
    };
}

const template = `
<section id="bindToolRoot" class="bind-tool-panel">
    <header class="toolbar">
        <div>
            <h2>Bind Rules</h2>
            <p>Configure node name prefix and component name. Node binds the current node; other names bind that component on the node.</p>
        </div>
        <div class="toolbar-actions">
            <button id="reset" type="button">Reset</button>
            <button id="save" type="button">Save</button>
        </div>
    </header>

    <div class="settings">
        <label>
            <span>Script Root</span>
            <input id="scriptRoot" type="text" spellcheck="false">
        </label>
        <label>
            <span>Stop Prefix</span>
            <input id="stopPrefix" type="text" spellcheck="false">
        </label>
        <label class="checkbox">
            <input id="autoAddButtonComponent" type="checkbox">
            <span>Auto add Button component</span>
        </label>
    </div>

    <div class="rules-head">
        <span>Enabled</span>
        <span>Node Prefix</span>
        <span>Component Name</span>
        <span></span>
    </div>
    <div id="rules" class="rules-list"></div>

    <footer class="footer">
        <button id="add" type="button">Add Rule</button>
        <span id="status"></span>
    </footer>
</section>
`;

const style = `
.bind-tool-panel {
    box-sizing: border-box;
    height: 100%;
    padding: 16px;
    color: #d8d8d8;
    background: #3f3f3f;
    font-size: 13px;
    overflow: auto;
}
.toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
}
h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
}
p {
    margin: 0;
    max-width: 720px;
    color: #c8c8c8;
}
.toolbar-actions,
.footer {
    display: flex;
    align-items: center;
    gap: 8px;
}
.settings {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(160px, 220px) minmax(210px, auto);
    gap: 12px;
    align-items: end;
    margin-bottom: 16px;
}
label {
    display: grid;
    gap: 6px;
}
.checkbox {
    grid-template-columns: auto 1fr;
    align-items: center;
    padding-bottom: 6px;
}
input[type="text"] {
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    border: 1px solid #666;
    border-radius: 3px;
    padding: 4px 8px;
    color: #eee;
    background: #2f2f2f;
}
button {
    min-height: 28px;
    border: 1px solid #666;
    border-radius: 3px;
    padding: 4px 12px;
    color: #eee;
    background: #555;
}
button:hover {
    background: #606060;
}
.rules-head,
.rule-row {
    display: grid;
    grid-template-columns: 76px minmax(150px, 1fr) minmax(180px, 1fr) 72px;
    gap: 8px;
    align-items: center;
}
.rules-head {
    margin-bottom: 6px;
    color: #e0e0e0;
    font-weight: 600;
}
.rules-list {
    min-height: 120px;
    border: 1px solid #626262;
    background: #363636;
}
.rule-row {
    min-height: 38px;
    padding: 5px 8px;
    border-bottom: 1px solid #505050;
}
.rule-row:last-child {
    border-bottom: 0;
}
.rule-row .enabled-cell,
.rule-row .operation-cell {
    text-align: center;
}
.mini {
    width: 58px;
    padding: 0;
}
.footer {
    justify-content: space-between;
    margin-top: 10px;
}
#status {
    color: #8fd36d;
}
`;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getElement(panel, key) {
    const selector = `#${key}`;
    const direct = panel && panel[`$${key}`];
    if (direct && typeof direct.addEventListener === "function") {
        return direct;
    }
    if (panel && panel.$ && panel.$[key] && typeof panel.$[key].addEventListener === "function") {
        return panel.$[key];
    }
    const found = document.querySelector(selector);
    if (found) {
        return found;
    }
    throw new Error(`Missing element: ${selector}`);
}

function requestPackage(message, ...args) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`Request timeout: ${message}`));
            }
        }, 1500);
        const done = (...callbackArgs) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            const error = callbackArgs.find((item) => item instanceof Error);
            if (error) {
                reject(error);
                return;
            }
            resolve(callbackArgs[callbackArgs.length - 1]);
        };

        try {
            if (Editor.Ipc && typeof Editor.Ipc.sendToMain === "function") {
                Editor.Ipc.sendToMain(`${PACKAGE_NAME}:${message}`, ...args, done);
                return;
            }
            if (Editor.Message && typeof Editor.Message.request === "function") {
                Editor.Message.request(PACKAGE_NAME, message, ...args).then(done, (error) => done(error));
                return;
            }
            done(new Error("Editor IPC is unavailable."));
        } catch (error) {
            done(error);
        }
    });
}

Editor.Panel.extend({
    style,
    template,
    $: {
        root: "#bindToolRoot",
        rules: "#rules",
        scriptRoot: "#scriptRoot",
        stopPrefix: "#stopPrefix",
        autoAddButtonComponent: "#autoAddButtonComponent",
        add: "#add",
        save: "#save",
        reset: "#reset",
        status: "#status",
    },

    ready() {
        compat.install(PACKAGE_NAME);

        const panel = this;
        let config = makeDefaultConfig();

        const render = () => {
            getElement(panel, "scriptRoot").value = config.scriptRoot;
            getElement(panel, "stopPrefix").value = config.stopPrefix;
            getElement(panel, "autoAddButtonComponent").checked = config.autoAddButtonComponent;
            getElement(panel, "rules").innerHTML = config.rules.map((rule, index) => `
                <div class="rule-row" data-index="${index}">
                    <div class="enabled-cell"><input data-key="enabled" type="checkbox" ${rule.enabled !== false ? "checked" : ""}></div>
                    <input data-key="prefix" type="text" value="${escapeHtml(rule.prefix)}" spellcheck="false">
                    <input data-key="componentName" type="text" value="${escapeHtml(rule.componentName)}" spellcheck="false">
                    <div class="operation-cell"><button class="mini" data-action="delete" type="button">Del</button></div>
                </div>
            `).join("");
        };

        const setStatus = (message) => {
            const status = getElement(panel, "status");
            status.textContent = message;
            setTimeout(() => {
                status.textContent = "";
            }, 2500);
        };

        const collect = () => {
            const rows = Array.from(getElement(panel, "rules").querySelectorAll(".rule-row"));
            const rules = rows.map((row) => {
                const enabled = row.querySelector('[data-key="enabled"]');
                const prefix = row.querySelector('[data-key="prefix"]');
                const componentName = row.querySelector('[data-key="componentName"]');
                return {
                    prefix: String(prefix && prefix.value || "").trim(),
                    componentName: String(componentName && componentName.value || "Node").trim() || "Node",
                    enabled: !enabled || enabled.checked !== false,
                };
            }).filter((rule) => rule.prefix);

            return {
                scriptRoot: getElement(panel, "scriptRoot").value.trim() || "assets/src",
                stopPrefix: getElement(panel, "stopPrefix").value.trim() || "stop",
                autoAddButtonComponent: getElement(panel, "autoAddButtonComponent").checked,
                overwriteMode: "marker",
                rules,
            };
        };

        const bind = () => {
            if (panel.__bindToolRulesBound) {
                return;
            }
            panel.__bindToolRulesBound = true;

            getElement(panel, "add").addEventListener("click", () => {
                config.rules.push({ prefix: "label", componentName: "Label", enabled: true });
                render();
                setStatus("Rule added. Save to apply.");
            });

            getElement(panel, "save").addEventListener("click", () => {
                try {
                    config = normalizeConfig(collect());
                    writeLocalConfig(config);
                    render();
                    setStatus("Saved.");
                    requestPackage("save-config", config).catch(() => {});
                } catch (error) {
                    setStatus(`Save failed: ${error && error.message || error}`);
                }
            });

            getElement(panel, "reset").addEventListener("click", () => {
                try {
                    config = makeDefaultConfig();
                    writeLocalConfig(config);
                    render();
                    setStatus("Default rules restored.");
                    requestPackage("reset-config").catch(() => {});
                } catch (error) {
                    setStatus(`Reset failed: ${error && error.message || error}`);
                }
            });

            getElement(panel, "rules").addEventListener("input", (event) => {
                const target = event.target;
                const row = target && target.closest ? target.closest(".rule-row") : null;
                const index = Number(row && row.dataset.index);
                const key = target && target.dataset && target.dataset.key;
                if (!Number.isInteger(index) || !key || !config.rules[index]) {
                    return;
                }
                config.rules[index][key] = target.type === "checkbox" ? target.checked : target.value;
            });

            getElement(panel, "rules").addEventListener("change", (event) => {
                const target = event.target;
                const row = target && target.closest ? target.closest(".rule-row") : null;
                const index = Number(row && row.dataset.index);
                const key = target && target.dataset && target.dataset.key;
                if (!Number.isInteger(index) || !key || !config.rules[index]) {
                    return;
                }
                config.rules[index][key] = target.type === "checkbox" ? target.checked : target.value;
            });

            getElement(panel, "rules").addEventListener("click", (event) => {
                const target = event.target;
                if (!target || !target.dataset || target.dataset.action !== "delete") {
                    return;
                }
                const row = target.closest(".rule-row");
                const index = Number(row && row.dataset.index);
                if (!Number.isInteger(index)) {
                    return;
                }
                config.rules.splice(index, 1);
                render();
                setStatus("Rule deleted. Save to apply.");
            });
        };

        config = readLocalConfig();
        render();
        bind();
        requestPackage("query-config")
            .then((loadedConfig) => {
                config = normalizeConfig(loadedConfig);
                render();
            })
            .catch(() => {
                config = readLocalConfig();
                render();
            });
    },
});
