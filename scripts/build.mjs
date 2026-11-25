import {build} from "esbuild";
import {copyFile} from "node:fs/promises";

await build({
    entryPoints: ["src/index.ts"],
    outfile: "index.js",
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    external: ["siyuan", "electron"],
    sourcemap: true,
    logLevel: "info",
});
await copyFile("src/index.css", "index.css");
