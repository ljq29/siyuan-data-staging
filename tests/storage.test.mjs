import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const loadStorage = async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/storage.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "browser",
        format: "cjs",
        target: "es2020",
        external: ["siyuan"],
    });
    const module = {exports: {}};
    const require = id => {
        if (id === "siyuan") {
            return {fetchSyncPost: async () => ({code: 0, data: null, msg: ""})};
        }
        throw new Error(`Unexpected dependency: ${id}`);
    };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
    return module.exports.StagingStorage;
};

const jsonResponse = value => new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status: 200,
    headers: {"Content-Type": "application/json"},
});

test("原始 JSON 文件不会被误判为 API 错误", async () => {
    const StagingStorage = await loadStorage();
    const storage = new StagingStorage("test-app");
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => jsonResponse({version: 1, names: {"a.txt": "显示.txt"}});
        assert.deepEqual(await storage.readMetadata("20261125103000-abcdefg"), {version: 1, names: {"a.txt": "显示.txt"}});

        globalThis.fetch = async () => jsonResponse('{"hello":"world"}');
        const blob = await storage.download("20261125103000-abcdefg", "data.json");
        assert.equal(await blob.text(), '{"hello":"world"}');

        globalThis.fetch = async () => jsonResponse({code: 404, msg: "path does not exist", data: null});
        assert.deepEqual(await storage.readMetadata("20261125103000-abcdefg"), {version: 1, names: {}});
        await assert.rejects(() => storage.download("20261125103000-abcdefg", "missing.txt"), /path does not exist/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
