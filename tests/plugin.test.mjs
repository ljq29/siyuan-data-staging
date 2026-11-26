import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

class Plugin {
    constructor() {
        this.app = {appId: "test-app"};
        this.customBlockRenders = {};
        this.protyleSlash = [];
    }
}

const loadPlugin = () => {
    const module = {exports: {}};
    const api = {
        Plugin,
        confirm: () => undefined,
        showMessage: () => undefined,
        fetchSyncPost: async () => ({code: 0, data: null, msg: ""}),
    };
    const require = id => {
        if (id === "siyuan") {
            return api;
        }
        throw new Error(`Unexpected dependency: ${id}`);
    };
    const code = readFileSync(new URL("../index.js", import.meta.url), "utf8");
    new Function("require", "module", "exports", code)(require, module, module.exports);
    return module.exports.default;
};

test("插件注册文件暂存自定义块和斜杠命令", () => {
    const DataStagingPlugin = loadPlugin();
    const plugin = new DataStagingPlugin();
    plugin.onload();
    assert.equal(typeof plugin.customBlockRenders["siyuan-data-staging"].render, "function");
    assert.equal(plugin.protyleSlash.length, 1);
    assert.ok(plugin.protyleSlash[0].filter.includes("文件暂存"));
    assert.ok(plugin.protyleSlash[0].filter.includes("数据暂存"));
    assert.ok(plugin.protyleSlash[0].filter.includes("file store"));
    assert.match(plugin.protyleSlash[0].html, /<svg/);
    assert.match(plugin.protyleSlash[0].html, /文件暂存/);

    let inserted;
    plugin.protyleSlash[0].callback({
        insert: (...args) => {
            inserted = args;
        },
    });
    assert.equal(inserted[1], true);
    assert.equal(inserted[2], true);
    assert.match(inserted[0], /^;;;siyuan-data-staging\/siyuan-data-staging\n/);
    assert.match(inserted[0], /\{"version":1\}/);
});
