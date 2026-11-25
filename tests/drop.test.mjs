import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const loadDrop = async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/drop.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "es2020",
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

const fileEntry = (name, content) => ({
    name,
    isFile: true,
    isDirectory: false,
    file: resolve => resolve(new File([content], name)),
});

const directoryEntry = (name, children) => ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
        let read = false;
        return {
            readEntries: resolve => {
                resolve(read ? [] : children);
                read = true;
            },
        };
    },
});

test("拖放目录递归保留层级和空目录", async () => {
    const {dataTransferToUploadItems} = await loadDrop();
    const folder = directoryEntry("资料", [
        fileEntry("a.txt", "first"),
        directoryEntry("子目录", [fileEntry("b.txt", "second")]),
        directoryEntry("空目录", []),
    ]);
    const items = await dataTransferToUploadItems({
        items: [{webkitGetAsEntry: () => folder}],
        files: [],
    });
    assert.deepEqual(items.map(item => ({path: item.path, isDir: item.isDir})), [
        {path: "资料", isDir: true},
        {path: "资料/a.txt", isDir: false},
        {path: "资料/子目录", isDir: true},
        {path: "资料/子目录/b.txt", isDir: false},
        {path: "资料/空目录", isDir: true},
    ]);
    assert.equal(await items[1].file.text(), "first");
    assert.equal(await items[3].file.text(), "second");
});

test("不支持目录入口时回退到普通文件列表", async () => {
    const {dataTransferToUploadItems} = await loadDrop();
    const file = new File(["content"], "plain.txt");
    const items = await dataTransferToUploadItems({items: [], files: [file]});
    assert.equal(items.length, 1);
    assert.equal(items[0].path, "plain.txt");
    assert.equal(items[0].file, file);
});
