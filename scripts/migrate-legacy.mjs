const baseURL = process.env.SIYUAN_BASE_URL?.replace(/\/$/, "");
const token = process.env.SIYUAN_TOKEN;
if (!baseURL || !token) {
    throw new Error("请通过 SIYUAN_BASE_URL 和 SIYUAN_TOKEN 指定目标实例");
}

const legacyType = "data-staging/data-staging";
const currentType = "siyuan-data-staging/siyuan-data-staging";
const headers = {Authorization: `Token ${token}`, "Content-Type": "application/json"};

const request = async (path, body) => {
    const response = await fetch(`${baseURL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    const result = await response.json();
    if (result.code !== 0) {
        throw new Error(`${path}: ${result.code} ${result.msg}`);
    }
    return result.data;
};

const findLegacyBlocks = () => request("/api/query/sql", {
    stmt: "SELECT id, markdown FROM blocks WHERE markdown LIKE ';;;data-staging/data-staging%'",
});

const legacyBlocks = await findLegacyBlocks();
for (const block of legacyBlocks) {
    if (!block.markdown.startsWith(`;;;${legacyType}\n`)) {
        throw new Error(`块 ${block.id} 的旧标识不符合预期，已停止迁移`);
    }
    const markdown = block.markdown.replace(`;;;${legacyType}\n`, `;;;${currentType}\n`);
    await request("/api/block/updateBlock", {id: block.id, dataType: "markdown", data: markdown});
    console.log(`已迁移块 ${block.id}`);
}

const remaining = await findLegacyBlocks();
if (remaining.length) {
    throw new Error(`仍有 ${remaining.length} 个旧块未迁移`);
}
console.log(`迁移完成，共更新 ${legacyBlocks.length} 个块；暂存文件未修改`);
