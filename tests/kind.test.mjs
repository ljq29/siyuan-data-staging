import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";

const loadKind = async () => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL("../src/kind.ts", import.meta.url))],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "es2020",
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

test("常用扩展名映射到对应类型", async () => {
    const {getFileKind} = await loadKind();
    const cases = {
        "照片.JPG": "image",
        "录音.mp3": "audio",
        "视频.mkv": "video",
        "文档.pdf": "pdf",
        "报告.docx": "word",
        "统计.xlsx": "sheet",
        "数据.csv": "sheet",
        "介绍.pptx": "slides",
        "备份.7z": "archive",
        "脚本.ts": "code",
        "说明.md": "markdown",
        "日志.txt": "text",
        "安装包.exe": "package",
        "无扩展名": "file",
        "archive.tar.gz": "archive",
    };
    for (const [name, kind] of Object.entries(cases)) {
        assert.equal(getFileKind(name), kind, name);
    }
    assert.equal(getFileKind("任意目录", true), "folder");
    assert.equal(getFileKind(".gitignore"), "file");
});

test("类型都有中文标签", async () => {
    const {FILE_KIND_LABELS, getFileKind} = await loadKind();
    for (const kind of ["folder", "image", "audio", "video", "pdf", "word", "sheet", "slides", "archive", "code", "text", "markdown", "package", "file"]) {
        assert.ok(FILE_KIND_LABELS[kind], kind);
    }
    assert.equal(FILE_KIND_LABELS[getFileKind("a.pdf")], "PDF 文档");
});
