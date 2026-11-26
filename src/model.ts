export const DATA_ROOT = "/data/staging";
export const METADATA_FILE = ".data-staging.json";
export const MAX_FILE_SIZE = 200 * 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 512 * 1024 * 1024;

export interface StagingFileEntry {
    name: string;
    path: string;
    isDir: boolean;
    updated: number;
    displayName: string;
    size?: number;
}

export interface DirectoryEntryLike {
    isDir: boolean;
    isSymlink: boolean;
    name: string;
    updated: number;
}

export interface FileLike {
    name: string;
    size: number;
}

export interface PathLike {
    path: string;
}

export interface StagingMetadata {
    version: 2;
    names: Record<string, string>;
    sizes: Record<string, number>;
}

export const emptyMetadata = (): StagingMetadata => ({version: 2, names: {}, sizes: {}});

export const isValidBlockID = (blockID: string) => /^\d{14}-[0-9a-z]{7}$/.test(blockID);

export const getBlockDirectory = (blockID: string) => {
    if (!isValidBlockID(blockID)) {
        throw new Error("无效的暂存块 ID");
    }
    return `${DATA_ROOT}/${blockID}`;
};

export const validateFileName = (name: string): string | undefined => {
    if (!name || name !== name.trim() || name === "." || name === "..") {
        return "名称不能为空，且首尾不能包含空格";
    }
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) {
        return `名称“${name}”包含不支持的字符`;
    }
    return undefined;
};

export const normalizeRelativePath = (path = "") => {
    if (!path) {
        return "";
    }
    if (path.startsWith("/") || path.endsWith("/")) {
        throw new Error("无效的暂存路径");
    }
    const segments = path.split("/");
    if (segments.some(segment => validateFileName(segment) !== undefined)) {
        throw new Error("无效的暂存路径");
    }
    if (segments[0] === METADATA_FILE) {
        throw new Error("该文件名由插件保留");
    }
    return segments.join("/");
};

export const joinRelativePath = (directory: string, name: string) => {
    const parent = normalizeRelativePath(directory);
    const child = normalizeRelativePath(name);
    return [parent, child].filter(Boolean).join("/");
};

export const getParentPath = (path: string) => normalizeRelativePath(path).split("/").slice(0, -1).join("/");

export const getBaseName = (path: string) => normalizeRelativePath(path).split("/").pop() || "";

export const normalizeMetadata = (value: unknown): StagingMetadata => {
    if (!value || typeof value !== "object") {
        throw new Error("显示名元数据格式无效");
    }
    const names = (value as {names?: unknown}).names;
    if (!names || typeof names !== "object" || Array.isArray(names)) {
        throw new Error("显示名元数据格式无效");
    }
    const normalizedNames: Record<string, string> = {};
    Object.entries(names).forEach(([path, name]) => {
        try {
            const normalizedPath = normalizeRelativePath(path);
            if (typeof name === "string" && validateFileName(name) === undefined) {
                normalizedNames[normalizedPath] = name;
            }
        } catch {
            // 忽略无法对应到合法目录项的旧映射。
        }
    });
    const normalizedSizes: Record<string, number> = {};
    const sizes = (value as {sizes?: unknown}).sizes;
    if (sizes && typeof sizes === "object" && !Array.isArray(sizes)) {
        Object.entries(sizes).forEach(([path, size]) => {
            try {
                const normalizedPath = normalizeRelativePath(path);
                if (typeof size === "number" && Number.isFinite(size) && size >= 0) {
                    normalizedSizes[normalizedPath] = Math.floor(size);
                }
            } catch {
                // 忽略无法对应到合法目录项的旧大小记录。
            }
        });
    }
    return {version: 2, names: normalizedNames, sizes: normalizedSizes};
};

export const forgetMetadataPath = (metadata: StagingMetadata, path: string): boolean => {
    const relative = normalizeRelativePath(path);
    const prefix = `${relative}/`;
    let changed = false;
    for (const record of [metadata.names, metadata.sizes]) {
        for (const key of Object.keys(record)) {
            if (key === relative || key.startsWith(prefix)) {
                delete record[key];
                changed = true;
            }
        }
    }
    return changed;
};

export const moveMetadataPath = (metadata: StagingMetadata, source: string, target: string): boolean => {
    const from = normalizeRelativePath(source);
    const to = normalizeRelativePath(target);
    if (from === to) {
        return false;
    }
    const prefix = `${from}/`;
    let changed = false;
    for (const record of [metadata.names, metadata.sizes]) {
        const moves = Object.entries(record).filter(([key]) => key === from || key.startsWith(prefix));
        for (const [key, value] of moves) {
            delete record[key];
            record[`${to}${key.slice(from.length)}`] = value;
            changed = true;
        }
    }
    return changed;
};

export const normalizeEntries = (
    entries: DirectoryEntryLike[],
    directory = "",
    metadata: StagingMetadata = emptyMetadata(),
): StagingFileEntry[] => {
    const parent = normalizeRelativePath(directory);
    return entries.filter(entry => !entry.isSymlink && validateFileName(entry.name) === undefined)
        .filter(entry => parent || entry.name !== METADATA_FILE)
        .map(entry => {
            const updated = Number(entry.updated) || 0;
            const path = joinRelativePath(parent, entry.name);
            const displayName = metadata.names[path];
            const size = metadata.sizes[path];
            return {
                name: entry.name,
                path,
                isDir: entry.isDir,
                updated: updated > 0 && updated < 1e12 ? updated * 1000 : updated,
                displayName: displayName && validateFileName(displayName) === undefined ? displayName : entry.name,
                size: !entry.isDir && typeof size === "number" ? size : undefined,
            };
        })
        .sort((a, b) => Number(b.isDir) - Number(a.isDir)
            || a.displayName.localeCompare(b.displayName, "zh-CN", {numeric: true}));
};

export const getDuplicatePaths = (items: PathLike[]) => {
    const paths = new Set<string>();
    const duplicates = new Set<string>();
    items.forEach(item => {
        const key = item.path.toLocaleLowerCase();
        if (paths.has(key)) {
            duplicates.add(item.path);
        }
        paths.add(key);
    });
    return [...duplicates];
};

export const findExistingPaths = (items: PathLike[], entries: PathLike[]) => {
    const existing = new Set(entries.map(entry => entry.path.toLocaleLowerCase()));
    return items.map(item => item.path).filter(path => existing.has(path.toLocaleLowerCase()));
};

export const hasDisplayNameConflict = (entries: StagingFileEntry[], name: string, excludePath?: string) => {
    const key = name.toLocaleLowerCase();
    return entries.some(entry => entry.path !== excludePath && entry.displayName.toLocaleLowerCase() === key);
};

export const formatFileSize = (bytes: number) => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
};
