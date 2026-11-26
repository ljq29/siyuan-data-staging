import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const loadEntries = async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/entries.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "es2020",
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

const entry = (path, extra = {}) => ({
    path,
    name: path.split("/").pop(),
    displayName: path.split("/").pop(),
    isDir: false,
    updated: 0,
    ...extra,
});

test("排序保持文件夹在前，未记录大小始终排尾", async () => {
    const {sortEntries} = await loadEntries();
    const entries = [
        entry("b.txt", {size: 20, updated: 200}),
        entry("folder", {isDir: true}),
        entry("a.txt", {size: 10, updated: 100}),
        entry("unknown.txt"),
    ];
    assert.deepEqual(sortEntries(entries, "name", false).map(item => item.path),
        ["folder", "a.txt", "b.txt", "unknown.txt"]);
    assert.deepEqual(sortEntries(entries, "size", false).map(item => item.path),
        ["folder", "a.txt", "b.txt", "unknown.txt"]);
    assert.deepEqual(sortEntries(entries, "size", true).map(item => item.path),
        ["folder", "b.txt", "a.txt", "unknown.txt"]);
    assert.deepEqual(sortEntries(entries, "updated", true).map(item => item.path),
        ["folder", "b.txt", "a.txt", "unknown.txt"]);
    assert.deepEqual(sortEntries(entries, "kind", false)[0].path, "folder");
});

test("过滤同时匹配显示名和实际存储名", async () => {
    const {filterEntries} = await loadEntries();
    const entries = [
        entry("a.txt", {displayName: "季度报告.txt"}),
        entry("b.png"),
    ];
    assert.deepEqual(filterEntries(entries, "报告").map(item => item.path), ["a.txt"]);
    assert.deepEqual(filterEntries(entries, "A.TXT").map(item => item.path), ["a.txt"]);
    assert.equal(filterEntries(entries, "  ").length, 2);
    assert.equal(filterEntries(entries, "不存在").length, 0);
});

test("选择支持切换和范围选择", async () => {
    const {toggleSelected, resolveRangeSelection} = await loadEntries();
    assert.deepEqual(toggleSelected([], "a"), ["a"]);
    assert.deepEqual(toggleSelected(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleSelected(["a", "b"], "a"), ["b"]);
    const visible = ["a", "b", "c", "d"];
    assert.deepEqual(resolveRangeSelection(visible, "b", "d"), ["b", "c", "d"]);
    assert.deepEqual(resolveRangeSelection(visible, "d", "b"), ["b", "c", "d"]);
    assert.deepEqual(resolveRangeSelection(visible, "missing", "c"), ["c"]);
});
