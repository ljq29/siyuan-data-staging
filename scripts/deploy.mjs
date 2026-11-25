import {readFile} from "node:fs/promises";

const baseURL = process.env.SIYUAN_BASE_URL?.replace(/\/$/, "");
const token = process.env.SIYUAN_TOKEN;
if (!baseURL || !token) {
    throw new Error("请通过 SIYUAN_BASE_URL 和 SIYUAN_TOKEN 指定目标实例");
}

const manifest = JSON.parse(await readFile("dist/data-staging/plugin.json", "utf8"));
const directory = `/data/plugins/${manifest.name}`;
const headers = {Authorization: `Token ${token}`};

const request = async (path, body, allowMissing = false) => {
    const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        headers: body instanceof FormData ? headers : {...headers, "Content-Type": "application/json"},
        body: body instanceof FormData ? body : JSON.stringify(body),
    });
    const result = await response.json();
    if (allowMissing && (result.code === -404 || result.code === 404)) {
        return null;
    }
    if (result.code !== 0) {
        throw new Error(`${path}: ${result.code} ${result.msg}`);
    }
    return result.data;
};

const existing = await request("/api/file/readDir", {path: directory}, true);
if (existing?.length && process.env.SIYUAN_DEPLOY_OVERWRITE !== "1") {
    throw new Error(`${directory} 已存在；确认覆盖时请设置 SIYUAN_DEPLOY_OVERWRITE=1`);
}

for (const file of ["plugin.json", "index.js", "index.css", "README.md"]) {
    const data = await readFile(`dist/data-staging/${file}`);
    const form = new FormData();
    form.append("path", `${directory}/${file}`);
    form.append("file", new Blob([data]), file);
    form.append("isDir", "false");
    form.append("modTime", Date.now().toString());
    await request("/api/file/putFile", form);
    console.log(`已上传 ${directory}/${file}`);
}
console.log("部署完成，请重新加载思源前端");
