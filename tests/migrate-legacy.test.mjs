import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createServer} from "node:http";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);

const respond = (response, data) => {
    response.writeHead(200, {"Content-Type": "application/json"});
    response.end(JSON.stringify({code: 0, data, msg: ""}));
};

test("迁移脚本保留块 ID 并等待索引清除旧值", async t => {
    const legacyBlocks = ["20261125193101-ffk74md", "20261125210243-iygmwim"].map(id => ({
        id,
        markdown: ";;;data-staging/data-staging\n{\"version\":1}\n;;;",
    }));
    const updates = [];
    let migrated = false;
    let staleReads = 0;
    const server = createServer((request, response) => {
        let body = "";
        request.on("data", chunk => body += chunk);
        request.on("end", () => {
            const data = JSON.parse(body);
            if (request.url === "/api/query/sql") {
                if (migrated && staleReads < 2) {
                    staleReads++;
                    respond(response, legacyBlocks);
                } else {
                    respond(response, migrated ? [] : legacyBlocks);
                }
                return;
            }
            if (request.url === "/api/block/updateBlock") {
                updates.push(data);
                migrated = true;
                respond(response, null);
                return;
            }
            response.writeHead(404).end();
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = server.address();
    await exec(process.execPath, ["scripts/migrate-legacy.mjs"], {
        cwd: root,
        env: {...process.env, SIYUAN_BASE_URL: `http://127.0.0.1:${address.port}`, SIYUAN_TOKEN: "test"},
    });
    assert.equal(staleReads, 2);
    assert.deepEqual(updates.map(update => update.id), legacyBlocks.map(block => block.id));
    for (const update of updates) {
        assert.equal(update.dataType, "markdown");
        assert.equal(update.data, ";;;siyuan-data-staging/siyuan-data-staging\n{\"version\":1}\n;;;");
    }
});
