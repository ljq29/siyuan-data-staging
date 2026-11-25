import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {unzipSync} from "fflate";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["plugin.json", "index.js", "index.css", "README.md"];

test("手动安装包和官方集市包使用正确名称与目录结构", () => {
    execFileSync(process.execPath, ["scripts/package.mjs"], {cwd: root, stdio: "pipe"});
    const manual = unzipSync(new Uint8Array(readFileSync(new URL("../dist/siyuan-data-staging.zip", import.meta.url))));
    const bazaar = unzipSync(new Uint8Array(readFileSync(new URL("../dist/package.zip", import.meta.url))));
    assert.deepEqual(Object.keys(manual).sort(), files.map(file => `siyuan-data-staging/${file}`).sort());
    assert.deepEqual(Object.keys(bazaar).sort(), files.sort());
    for (const file of files) {
        assert.ok(manual[`siyuan-data-staging/${file}`].length);
        assert.ok(bazaar[file].length);
    }
    const manifest = JSON.parse(new TextDecoder().decode(bazaar["plugin.json"]));
    const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(manifest.name, "siyuan-data-staging");
    assert.equal(manifest.version, packageManifest.version);
});
