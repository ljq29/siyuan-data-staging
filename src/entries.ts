import {FILE_KIND_LABELS, getFileKind} from "./kind";
import type {StagingFileEntry} from "./model";

export type SortKey = "name" | "updated" | "size" | "kind";

export const SORT_KEY_LABELS: Record<SortKey, string> = {
    name: "名称",
    updated: "修改时间",
    size: "大小",
    kind: "类型",
};

export const sortEntries = (entries: StagingFileEntry[], key: SortKey, descending: boolean) => {
    const direction = descending ? -1 : 1;
    return [...entries].sort((a, b) => {
        if (a.isDir !== b.isDir) {
            return Number(b.isDir) - Number(a.isDir);
        }
        let result = 0;
        if (key === "updated") {
            result = direction * (a.updated - b.updated);
        } else if (key === "size") {
            if (a.size === undefined || b.size === undefined) {
                result = a.size === b.size ? 0 : (a.size === undefined ? 1 : -1);
            } else {
                result = direction * (a.size - b.size);
            }
        } else if (key === "kind") {
            const kinds = FILE_KIND_LABELS[getFileKind(a.name, a.isDir)]
                .localeCompare(FILE_KIND_LABELS[getFileKind(b.name, b.isDir)], "zh-CN");
            result = direction * (kinds || a.displayName.localeCompare(b.displayName, "zh-CN", {numeric: true}));
        } else {
            result = direction * a.displayName.localeCompare(b.displayName, "zh-CN", {numeric: true});
        }
        return result || a.displayName.localeCompare(b.displayName, "zh-CN", {numeric: true});
    });
};

export const filterEntries = (entries: StagingFileEntry[], keyword: string) => {
    const query = keyword.trim().toLocaleLowerCase();
    if (!query) {
        return entries;
    }
    return entries.filter(entry => entry.displayName.toLocaleLowerCase().includes(query)
        || entry.name.toLocaleLowerCase().includes(query));
};

export const toggleSelected = (selected: string[], path: string) => {
    return selected.includes(path) ? selected.filter(item => item !== path) : [...selected, path];
};

export const resolveRangeSelection = (visiblePaths: string[], anchor: string, target: string) => {
    const from = visiblePaths.indexOf(anchor);
    const to = visiblePaths.indexOf(target);
    if (from < 0 || to < 0) {
        return [target];
    }
    return visiblePaths.slice(Math.min(from, to), Math.max(from, to) + 1);
};
