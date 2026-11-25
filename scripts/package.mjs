import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {zipSync} from "fflate";

const files = ["plugin.json", "index.js", "index.css", "README.md"];
const outputDirectory = "dist/data-staging";
await rm("dist", {recursive: true, force: true});
await mkdir(outputDirectory, {recursive: true});

const archive = {};
for (const file of files) {
    await cp(file, `${outputDirectory}/${file}`);
    archive[`data-staging/${file}`] = new Uint8Array(await readFile(file));
}
await writeFile("dist/data-staging.zip", zipSync(archive, {level: 9}));
console.log("已生成 dist/data-staging/ 和 dist/data-staging.zip");
