import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {unzipSync} from "fflate";
import {fileURLToPath} from "node:url";

const loadArchive = async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/archive.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "es2020",
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

test("文件夹 ZIP 使用显示名并保留嵌套和空目录", async () => {
    const {downloadFolderArchive} = await loadArchive();
    const entries = [
        {path: "folder/a.txt", name: "a.txt", displayName: "甲.txt", isDir: false, updated: 1},
        {path: "folder/nested", name: "nested", displayName: "资料", isDir: true, updated: 1},
        {path: "folder/nested/b.txt", name: "b.txt", displayName: "乙.txt", isDir: false, updated: 1},
        {path: "folder/empty", name: "empty", displayName: "空目录", isDir: true, updated: 1},
    ];
    const downloaded = [];
    const storage = {
        listRecursive: async () => entries,
        download: async (blockID, path) => {
            downloaded.push(path);
            return new Blob([path === "folder/a.txt" ? "first" : "second"]);
        },
    };
    const archive = await downloadFolderArchive(storage, "20261125103000-abcdefg", "folder", "显示目录");
    assert.equal(archive.fileName, "显示目录.zip");
    assert.equal(archive.fileCount, 2);
    const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), [
        "显示目录/",
        "显示目录/资料/",
        "显示目录/资料/乙.txt",
        "显示目录/空目录/",
        "显示目录/甲.txt",
    ].sort());
    assert.equal(new TextDecoder().decode(files["显示目录/甲.txt"]), "first");
    assert.equal(new TextDecoder().decode(files["显示目录/资料/乙.txt"]), "second");
    assert.deepEqual(downloaded, ["folder/a.txt", "folder/nested/b.txt"]);
});
