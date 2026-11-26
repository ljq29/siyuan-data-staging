import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/model.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020},
}).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("块目录只接受规范块 ID", () => {
    assert.equal(model.getBlockDirectory("20261125103000-abcdefg"), "/data/staging/20261125103000-abcdefg");
    assert.throws(() => model.getBlockDirectory("../other"));
    assert.throws(() => model.getBlockDirectory("20261125103000-abcdefg/../../other"));
});

test("名称允许中文并拒绝路径和系统保留字符", () => {
    assert.equal(model.validateFileName("测试 文档.txt"), undefined);
    assert.equal(model.validateFileName("archive.tar.gz"), undefined);
    for (const name of ["", "../a.txt", "dir/a.txt", "dir\\a.txt", "a?.txt", "a.txt.", "a.txt ", ".", ".."]) {
        assert.notEqual(model.validateFileName(name), undefined, name);
    }
});

test("相对路径保留目录层级并阻止越界和保留元数据文件", () => {
    assert.equal(model.normalizeRelativePath("文件夹/子目录/a.txt"), "文件夹/子目录/a.txt");
    assert.equal(model.joinRelativePath("文件夹", "子目录/a.txt"), "文件夹/子目录/a.txt");
    assert.equal(model.getParentPath("文件夹/子目录/a.txt"), "文件夹/子目录");
    assert.equal(model.getBaseName("文件夹/子目录/a.txt"), "a.txt");
    for (const path of ["/absolute", "folder/", "../a.txt", "folder/../a.txt", ".data-staging.json"]) {
        assert.throws(() => model.normalizeRelativePath(path), path);
    }
});

test("显示名元数据仅保留合法路径和名称", () => {
    assert.deepEqual(model.normalizeMetadata({version: 1, names: {
        "folder/a.txt": "显示名.txt",
        "../bad.txt": "越界.txt",
        "folder/b.txt": "bad/name.txt",
    }}), {version: 2, names: {"folder/a.txt": "显示名.txt"}, sizes: {}});
    assert.throws(() => model.normalizeMetadata(null));
    assert.throws(() => model.normalizeMetadata({names: []}));
});

test("目录结果包含文件夹、排除链接和元数据并应用显示名", () => {
    assert.deepEqual(model.normalizeEntries([
        {name: "old.txt", updated: 100, isDir: false, isSymlink: false},
        {name: "new.txt", updated: 200, isDir: false, isSymlink: false},
        {name: "folder", updated: 300, isDir: true, isSymlink: false},
        {name: "link.txt", updated: 400, isDir: false, isSymlink: true},
        {name: "../bad.txt", updated: 500, isDir: false, isSymlink: false},
        {name: ".data-staging.json", updated: 600, isDir: false, isSymlink: false},
    ], "", {version: 2, names: {"old.txt": "旧文件.txt", folder: "资料"}, sizes: {"old.txt": 2048}}), [
        {name: "folder", path: "folder", isDir: true, updated: 300000, displayName: "资料", size: undefined},
        {name: "old.txt", path: "old.txt", isDir: false, updated: 100000, displayName: "旧文件.txt", size: 2048},
        {name: "new.txt", path: "new.txt", isDir: false, updated: 200000, displayName: "new.txt", size: undefined},
    ]);
    assert.deepEqual(model.normalizeEntries([
        {name: "milliseconds.txt", updated: 1795602234000, isDir: false, isSymlink: false},
    ]), [{name: "milliseconds.txt", path: "milliseconds.txt", isDir: false, updated: 1795602234000, displayName: "milliseconds.txt", size: undefined}]);
});

test("路径去重和覆盖检测不区分大小写", () => {
    assert.deepEqual(model.getDuplicatePaths([{path: "a.txt"}, {path: "A.TXT"}, {path: "b.txt"}]), ["A.TXT"]);
    assert.deepEqual(model.findExistingPaths(
        [{path: "folder/A.TXT"}, {path: "folder/new.txt"}],
        [{path: "folder/a.txt"}],
    ), ["folder/A.TXT"]);
});

test("显示名冲突检查可排除当前项目", () => {
    const entries = [
        {path: "a", displayName: "资料"},
        {path: "b", displayName: "文档"},
    ];
    assert.equal(model.hasDisplayNameConflict(entries, "资料"), true);
    assert.equal(model.hasDisplayNameConflict(entries, "资料", "a"), false);
    assert.equal(model.hasDisplayNameConflict(entries, "新名称"), false);
});

test("文件大小用于上传限制提示", () => {
    assert.equal(model.formatFileSize(100), "100 B");
    assert.equal(model.formatFileSize(2048), "2.0 KiB");
    assert.equal(model.formatFileSize(100 * 1024 * 1024), "100.0 MiB");
});

test("大小记录随元数据归一化，非法记录被忽略", () => {
    assert.deepEqual(model.normalizeMetadata({version: 1, names: {}, sizes: {
        "a.txt": 1024,
        "b.txt": 12.9,
        "c.txt": -1,
        "d.txt": "2048",
        "../e.txt": 10,
    }}), {version: 2, names: {}, sizes: {"a.txt": 1024, "b.txt": 12}});
    assert.deepEqual(model.emptyMetadata(), {version: 2, names: {}, sizes: {}});
});

test("删除路径会清理自身和后代的显示名与大小", () => {
    const metadata = {
        version: 2,
        names: {"folder": "资料", "folder/a.txt": "甲.txt", "other.txt": "乙.txt"},
        sizes: {"folder/a.txt": 10, "folder/nested/b.txt": 20, "other.txt": 30},
    };
    assert.equal(model.forgetMetadataPath(metadata, "folder"), true);
    assert.deepEqual(metadata, {version: 2, names: {"other.txt": "乙.txt"}, sizes: {"other.txt": 30}});
    assert.equal(model.forgetMetadataPath(metadata, "missing"), false);
});

test("移动路径会迁移显示名和大小记录", () => {
    const metadata = {
        version: 2,
        names: {"folder": "资料", "folder/a.txt": "甲.txt"},
        sizes: {"folder/a.txt": 10, "other.txt": 30},
    };
    assert.equal(model.moveMetadataPath(metadata, "folder", "archive/folder"), true);
    assert.deepEqual(metadata, {
        version: 2,
        names: {"archive/folder": "资料", "archive/folder/a.txt": "甲.txt"},
        sizes: {"archive/folder/a.txt": 10, "other.txt": 30},
    });
    assert.equal(model.moveMetadataPath(metadata, "other.txt", "other.txt"), false);
});

test("单文件上限为 200 MiB，大小格式化支持 GiB", () => {
    assert.equal(model.MAX_FILE_SIZE, 200 * 1024 * 1024);
    assert.equal(model.formatFileSize(model.MAX_FILE_SIZE), "200.0 MiB");
    assert.equal(model.formatFileSize(2 * 1024 * 1024 * 1024), "2.00 GiB");
});
