import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const loadStorage = async (fetchSyncPost = async () => ({code: 0, data: null, msg: ""})) => {
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
            return {fetchSyncPost};
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
        assert.deepEqual(await storage.readMetadata("20261125103000-abcdefg"), {version: 2, names: {"a.txt": "显示.txt"}, sizes: {}});

        globalThis.fetch = async () => jsonResponse('{"hello":"world"}');
        const blob = await storage.download("20261125103000-abcdefg", "data.json");
        assert.equal(await blob.text(), '{"hello":"world"}');

        globalThis.fetch = async () => jsonResponse({code: 404, msg: "path does not exist", data: null});
        assert.deepEqual(await storage.readMetadata("20261125103000-abcdefg"), {version: 2, names: {}, sizes: {}});
        await assert.rejects(() => storage.download("20261125103000-abcdefg", "missing.txt"), /path does not exist/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("上传后记录大小，删除和移动同步维护元数据", async () => {
    const blockID = "20261125103000-abcdefg";
    const saved = [];
    const calls = [];
    let current = {
        version: 1,
        names: {"folder/a.txt": "甲.txt"},
        sizes: {"folder/a.txt": 3},
    };
    const StagingStorage = await loadStorage(async (url, data) => {
        calls.push({url, data});
        if (url === "/api/file/putFile" && data instanceof FormData) {
            current = JSON.parse(await data.get("file").text());
            saved.push(current);
        }
        return {code: 0, data: null, msg: ""};
    });
    const storage = new StagingStorage("test-app");
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => jsonResponse(current);

        await storage.recordSizes(blockID, {"b.txt": 1024, "bad.txt": -1});
        assert.deepEqual(saved.at(-1), {
            version: 2,
            names: {"folder/a.txt": "甲.txt"},
            sizes: {"folder/a.txt": 3, "b.txt": 1024},
        });

        await storage.move(blockID, "folder", "archive/folder");
        const renameCall = calls.find(call => call.url === "/api/file/renameFile");
        assert.deepEqual(renameCall.data, {
            path: `/data/staging/${blockID}/folder`,
            newPath: `/data/staging/${blockID}/archive/folder`,
        });
        assert.deepEqual(saved.at(-1), {
            version: 2,
            names: {"archive/folder/a.txt": "甲.txt"},
            sizes: {"archive/folder/a.txt": 3, "b.txt": 1024},
        });

        await storage.remove(blockID, "archive/folder");
        assert.ok(calls.some(call => call.url === "/api/file/removeFile"
            && call.data.path === `/data/staging/${blockID}/archive/folder`));
        assert.deepEqual(saved.at(-1), {version: 2, names: {}, sizes: {"b.txt": 1024}});
    } finally {
        globalThis.fetch = originalFetch;
    }
});
