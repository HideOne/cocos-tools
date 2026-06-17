"use strict";

const compat = require("../editor-compat");
compat.install("bind-tool");

const rules = require("../dist/panels/rules");

Editor.Panel.extend({
    style: rules.style,
    template: rules.template,
    $: rules.$,

    ready() {
        compat.install("bind-tool");
        if (typeof rules.ready === "function") {
            rules.ready.call(this);
        }
    },
});
