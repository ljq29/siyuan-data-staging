import {fetchSyncPost} from "siyuan";
import type {DirectoryEntry} from "siyuan";
import {
    emptyMetadata,
    forgetMetadataPath,
    getBaseName,
    getBlockDirectory,
    getParentPath,
    joinRelativePath,
    METADATA_FILE,
    moveMetadataPath,
    normalizeEntries,
    normalizeMetadata,
    normalizeRelativePath,
} from "./model";
import type {StagingFileEntry, StagingMetadata} from "./model";

interface APIResponse<T> {
    code: number;
    data: T;
    msg: string;
}

const isAPIEnvelope = (value: unknown): value is APIResponse<unknown> => {
    return !!value && typeof value === "object"
        && typeof (value as APIResponse<unknown>).code === "number"
        && typeof (value as APIResponse<unknown>).msg === "string"
        && "data" in value;
};

const request = async <T>(url: string, data: Record<string, unknown> | FormData): Promise<T> => {
    const response = await fetchSyncPost(url, data) as unknown as APIResponse<T>;
    if (!response || response.code !== 0) {
        throw new Error(response?.msg || `请求失败：${url}`);
    }
    return response.data;
};

export class StagingStorage {
    constructor(private readonly appID: string) {
    }

    private getFileResponse(blockID: string, path: string) {
        const relative = path === METADATA_FILE ? METADATA_FILE : normalizeRelativePath(path);
        return fetch("/api/file/getFile", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-SiYuan-App-ID": this.appID,
            },
            body: JSON.stringify({path: `${getBlockDirectory(blockID)}/${relative}`}),
        });
    }

    private async readDirectory(blockID: string, directory: string): Promise<DirectoryEntry[]> {
        const relative = normalizeRelativePath(directory);
        const path = `${getBlockDirectory(blockID)}${relative ? `/${relative}` : ""}`;
        const response = await fetchSyncPost("/api/file/readDir", {path}) as unknown as APIResponse<DirectoryEntry[]>;
        if (response?.code === -404 || response?.code === 404) {
            return [];
        }
        if (!response || response.code !== 0) {
            throw new Error(response?.msg || "无法读取暂存目录");
        }
        return Array.isArray(response.data) ? response.data : [];
    }

    public async readMetadata(blockID: string): Promise<StagingMetadata> {
        const response = await this.getFileResponse(blockID, METADATA_FILE);
        if (response.status === 404) {
            return emptyMetadata();
        }
        const text = await response.text();
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch {
            if (!response.ok) {
                throw new Error(`无法读取显示名元数据（HTTP ${response.status}）`);
            }
            throw new Error("显示名元数据格式无效");
        }
        if (isAPIEnvelope(value)) {
            if (value.code === -404 || value.code === 404) {
                return emptyMetadata();
            }
            throw new Error(value.msg || `无法读取显示名元数据（HTTP ${response.status}）`);
        }
        if (!response.ok) {
            throw new Error(`无法读取显示名元数据（HTTP ${response.status}）`);
        }
        return normalizeMetadata(value);
    }

    private async saveMetadata(blockID: string, metadata: StagingMetadata) {
        const formData = new FormData();
        const content = new Blob([JSON.stringify(metadata)], {type: "application/json"});
        formData.append("path", `${getBlockDirectory(blockID)}/${METADATA_FILE}`);
        formData.append("file", content, METADATA_FILE);
        formData.append("isDir", "false");
        formData.append("modTime", Date.now().toString());
        await request<null>("/api/file/putFile", formData);
    }

    public async list(blockID: string, directory = ""): Promise<StagingFileEntry[]> {
        const [entries, metadata] = await Promise.all([
            this.readDirectory(blockID, directory),
            this.readMetadata(blockID),
        ]);
        return normalizeEntries(entries, directory, metadata);
    }

    public async listRecursive(blockID: string, directory = ""): Promise<StagingFileEntry[]> {
        const metadata = await this.readMetadata(blockID);
        const walk = async (current: string): Promise<StagingFileEntry[]> => {
            const entries = normalizeEntries(await this.readDirectory(blockID, current), current, metadata);
            const nested = await Promise.all(entries.filter(entry => entry.isDir).map(entry => walk(entry.path)));
            return [...entries, ...nested.flat()];
        };
        return walk(normalizeRelativePath(directory));
    }

    public async createFolder(blockID: string, directory: string): Promise<void> {
        const relative = normalizeRelativePath(directory);
        if (!relative) {
            return;
        }
        const formData = new FormData();
        formData.append("path", `${getBlockDirectory(blockID)}/${relative}`);
        formData.append("isDir", "true");
        formData.append("modTime", Date.now().toString());
        await request<null>("/api/file/putFile", formData);
    }

    public async ensureFolder(blockID: string, directory: string): Promise<void> {
        const relative = normalizeRelativePath(directory);
        let current = "";
        for (const segment of relative.split("/").filter(Boolean)) {
            current = joinRelativePath(current, segment);
            await this.createFolder(blockID, current);
        }
    }

    public async upload(blockID: string, path: string, file: File): Promise<void> {
        const relative = normalizeRelativePath(path);
        await this.ensureFolder(blockID, getParentPath(relative));
        const formData = new FormData();
        formData.append("path", `${getBlockDirectory(blockID)}/${relative}`);
        formData.append("file", file, getBaseName(relative));
        formData.append("isDir", "false");
        formData.append("modTime", Date.now().toString());
        await request<null>("/api/file/putFile", formData);
    }

    public async recordSizes(blockID: string, sizes: Record<string, number>): Promise<void> {
        const entries = Object.entries(sizes);
        if (!entries.length) {
            return;
        }
        const metadata = await this.readMetadata(blockID);
        let changed = false;
        for (const [path, size] of entries) {
            if (Number.isFinite(size) && size >= 0) {
                metadata.sizes[normalizeRelativePath(path)] = Math.floor(size);
                changed = true;
            }
        }
        if (changed) {
            await this.saveMetadata(blockID, metadata);
        }
    }

    public async remove(blockID: string, path: string): Promise<void> {
        const relative = normalizeRelativePath(path);
        await request<null>("/api/file/removeFile", {
            path: `${getBlockDirectory(blockID)}/${relative}`,
        });
        const metadata = await this.readMetadata(blockID);
        if (forgetMetadataPath(metadata, relative)) {
            await this.saveMetadata(blockID, metadata);
        }
    }

    public async move(blockID: string, source: string, target: string): Promise<void> {
        const from = normalizeRelativePath(source);
        const to = normalizeRelativePath(target);
        const directory = getBlockDirectory(blockID);
        await request<null>("/api/file/renameFile", {
            path: `${directory}/${from}`,
            newPath: `${directory}/${to}`,
        });
        const metadata = await this.readMetadata(blockID);
        if (moveMetadataPath(metadata, from, to)) {
            await this.saveMetadata(blockID, metadata);
        }
    }

    public async rename(blockID: string, path: string, displayName: string): Promise<void> {
        const relative = normalizeRelativePath(path);
        const metadata = await this.readMetadata(blockID);
        if (displayName === getBaseName(relative)) {
            delete metadata.names[relative];
        } else {
            metadata.names[relative] = displayName;
        }
        await this.saveMetadata(blockID, metadata);
    }

    public async download(blockID: string, path: string): Promise<Blob> {
        const response = await this.getFileResponse(blockID, path);
        const blob = await response.blob();
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const text = await blob.text();
            let value: unknown;
            try {
                value = JSON.parse(text);
            } catch {
                if (!response.ok) {
                    throw new Error(`下载失败（HTTP ${response.status}）`);
                }
                return new Blob([text], {type: contentType});
            }
            if (isAPIEnvelope(value)) {
                throw new Error(value.msg || `下载失败（HTTP ${response.status}）`);
            }
            return new Blob([text], {type: contentType});
        }
        if (!response.ok) {
            throw new Error(`下载失败（HTTP ${response.status}）`);
        }
        return blob;
    }
}
