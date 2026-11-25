import assert from "node:assert/strict";

const baseURL = process.env.SIYUAN_BASE_URL?.replace(/\/$/, "");
const token = process.env.SIYUAN_TOKEN;
if (!baseURL || !token) {
    throw new Error("请通过 SIYUAN_BASE_URL 和 SIYUAN_TOKEN 指定测试实例");
}

const blockID = "20990101000000-abcde12";
const directory = `/data/staging/${blockID}`;
const headers = {Authorization: `Token ${token}`};

const request = async (path, body) => {
    const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        headers: body instanceof FormData ? headers : {...headers, "Content-Type": "application/json"},
        body: body instanceof FormData ? body : JSON.stringify(body),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        assert.equal(response.ok, true, `${path}: HTTP ${response.status}`);
        return response;
    }
    const result = await response.json();
    if (result.code !== 0) {
        const error = new Error(`${path}: ${result.code} ${result.msg}`);
        error.code = result.code;
        throw error;
    }
    return result.data;
};

const list = async (path = directory) => {
    try {
        return await request("/api/file/readDir", {path}) || [];
    } catch (error) {
        if (error.code === -404 || error.code === 404) {
            return [];
        }
        throw error;
    }
};

const upload = (name, content) => {
    const form = new FormData();
    form.append("path", `${directory}/${name}`);
    form.append("file", new Blob([content], {type: "text/plain"}), name.split("/").pop());
    form.append("isDir", "false");
    form.append("modTime", Date.now().toString());
    return request("/api/file/putFile", form);
};

const createFolder = name => {
    const form = new FormData();
    form.append("path", `${directory}/${name}`);
    form.append("isDir", "true");
    form.append("modTime", Date.now().toString());
    return request("/api/file/putFile", form);
};

const download = async name => {
    const response = await request("/api/file/getFile", {path: `${directory}/${name}`});
    return response.text();
};

const remove = path => request("/api/file/removeFile", {path});

try {
    for (const entry of await list()) {
        await remove(`${directory}/${entry.name}`);
    }
    await upload("smoke.txt", "first");
    assert.equal(await download("smoke.txt"), "first");

    await upload("smoke.txt", "second");
    assert.equal(await download("smoke.txt"), "second");
    assert.equal((await list()).filter(entry => entry.name === "smoke.txt").length, 1);

    await upload("测试-暂存.txt", "中文文件名");
    assert.equal(await download("测试-暂存.txt"), "中文文件名");
    assert.equal((await list()).length, 2);

    await createFolder("文件夹/空目录");
    await upload("文件夹/子目录/nested.txt", "nested");
    assert.equal(await download("文件夹/子目录/nested.txt"), "nested");
    assert.equal((await list(`${directory}/文件夹/空目录`)).length, 0);
    assert.equal((await list(`${directory}/文件夹/子目录`)).length, 1);
    await remove(`${directory}/文件夹`);
    assert.equal((await list(`${directory}/文件夹`)).length, 0);
    assert.equal((await list()).length, 2);
    console.log("API 冒烟测试通过：上传、中文文件名、同名覆盖、嵌套目录、空目录、下载和递归删除均正常");
} finally {
    for (const entry of await list()) {
        await remove(`${directory}/${entry.name}`);
    }
    try {
        await remove(directory);
    } catch (error) {
        if (error.code !== -404 && error.code !== 404) {
            throw error;
        }
    }
}
