"use strict";

const compat = require("./editor-compat");
compat.install("bind-tool");

const core = require("./dist/main");
const methods = core.methods || {};

function invoke(name, ...args) {
    compat.install("bind-tool");
    if (!methods[name]) {
        throw new Error(`Missing bind-tool method: ${name}`);
    }

    return methods[name](...args);
}

module.exports = {
    load() {
        compat.install("bind-tool");
        if (typeof core.load === "function") {
            core.load();
        }
    },

    unload() {
        if (typeof core.unload === "function") {
            core.unload();
        }
    },

    messages: {
        "open-rules-panel"() {
            Editor.Panel.open("bind-tool");
        },

        "query-config"() {
            return invoke("queryConfig");
        },

        "save-config"(event, config) {
            return invoke("saveConfig", config);
        },

        "reset-config"() {
            return invoke("resetConfig");
        },

        "bind-selected-node"() {
            return invoke("bindSelectedNode");
        },

        "generate-selected-node-script"() {
            return invoke("generateSelectedNodeScript");
        },

        "bind-selected-node-references"() {
            return invoke("bindSelectedNodeReferences");
        },
    },
};
