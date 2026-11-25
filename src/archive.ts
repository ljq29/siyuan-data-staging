import {zipSync} from "fflate";
import {formatFileSize, MAX_ARCHIVE_SIZE, normalizeRelativePath} from "./model";
import type {StagingFileEntry} from "./model";
import type {StagingStorage} from "./storage";

const getDisplayPath = (entry: StagingFileEntry, root: string, entries: Map<string, StagingFileEntry>) => {
    const relative = root ? entry.path.slice(root.length + 1) : entry.path;
    const segments = relative.split("/").filter(Boolean);
    return segments.map((segment, index) => {
        const path = [root, ...segments.slice(0, index + 1)].filter(Boolean).join("/");
        return entries.get(path)?.displayName || segment;
    }).join("/");
};

export const downloadFolderArchive = async (
    storage: StagingStorage,
    blockID: string,
    directory: string,
    displayName: string,
) => {
    const root = normalizeRelativePath(directory);
    const entries = await storage.listRecursive(blockID, root);
    const entryMap = new Map(entries.map(entry => [entry.path, entry]));
    const archiveEntries: Record<string, Uint8Array> = {[`${displayName}/`]: new Uint8Array()};
    let fileCount = 0;
    let totalSize = 0;

    for (const entry of entries) {
        const path = `${displayName}/${getDisplayPath(entry, root, entryMap)}`;
        if (entry.isDir) {
            archiveEntries[`${path}/`] = new Uint8Array();
            continue;
        }
        const data = new Uint8Array(await (await storage.download(blockID, entry.path)).arrayBuffer());
        totalSize += data.byteLength;
        if (totalSize > MAX_ARCHIVE_SIZE) {
            throw new Error(`文件夹内容超过 ${formatFileSize(MAX_ARCHIVE_SIZE)} 的 ZIP 下载限制`);
        }
        archiveEntries[path] = data;
        fileCount++;
    }

    const archive = zipSync(archiveEntries, {level: 0});
    return {
        blob: new Blob([archive], {type: "application/zip"}),
        fileName: `${displayName}.zip`,
        fileCount,
        totalSize,
    };
};
