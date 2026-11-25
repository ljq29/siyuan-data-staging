import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {zipSync} from "fflate";

const files = ["plugin.json", "index.js", "index.css", "README.md"];
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const outputDirectory = `dist/${manifest.name}`;
await rm("dist", {recursive: true, force: true});
await mkdir(outputDirectory, {recursive: true});

const manualArchive = {};
const bazaarArchive = {};
for (const file of files) {
    await cp(file, `${outputDirectory}/${file}`);
    const data = new Uint8Array(await readFile(file));
    manualArchive[`${manifest.name}/${file}`] = data;
    bazaarArchive[file] = data;
}
await writeFile(`dist/${manifest.name}.zip`, zipSync(manualArchive, {level: 9}));
await writeFile("dist/package.zip", zipSync(bazaarArchive, {level: 9}));
console.log(`已生成 ${outputDirectory}/、dist/${manifest.name}.zip 和 dist/package.zip`);
