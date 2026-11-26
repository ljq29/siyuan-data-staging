import {confirm, showMessage} from "siyuan";
import {downloadFolderArchive} from "./archive";
import {dataTransferToUploadItems, filesToUploadItems} from "./drop";
import type {UploadItem} from "./drop";
import {filterEntries, resolveRangeSelection, SORT_KEY_LABELS, sortEntries, toggleSelected} from "./entries";
import type {SortKey} from "./entries";
import {icon} from "./icons";
import type {IconName} from "./icons";
import {FILE_KIND_LABELS, getFileKind} from "./kind";
import type {FileKind} from "./kind";
import {
    findExistingPaths,
    formatFileSize,
    getBaseName,
    getDuplicatePaths,
    getParentPath,
    hasDisplayNameConflict,
    joinRelativePath,
    MAX_FILE_SIZE,
    normalizeRelativePath,
    validateFileName,
} from "./model";
import type {StagingFileEntry} from "./model";
import type {StagingStorage} from "./storage";

interface StagingRenderOptions {
    element: HTMLElement;
    content: string;
    setContent: (content: string) => boolean;
}

interface BreadcrumbItem {
    path: string;
    displayName: string;
}

interface PreparedUpload extends UploadItem {
    fullPath: string;
}

const INTERNAL_DRAG_TYPE = "application/x-siyuan-data-staging";

const KIND_ICONS: Record<FileKind, IconName> = {
    folder: "folder",
    image: "image",
    audio: "audio",
    video: "video",
    pdf: "pdf",
    word: "word",
    sheet: "sheet",
    slides: "slides",
    archive: "archive",
    code: "code",
    text: "text",
    markdown: "text",
    package: "package",
    file: "file",
};

const confirmAction = (title: string, text: string, isDelete: boolean, confirmLabel: string) => {
    return new Promise<boolean>(resolve => {
        confirm(title, text, () => resolve(true), () => resolve(false), isDelete, undefined, confirmLabel);
    });
};

const formatTime = (timestamp: number) => {
    if (!timestamp) {
        return "";
    }
    return new Date(timestamp).toLocaleString("zh-CN", {hour12: false});
};

const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export const renderDataStaging = (options: StagingRenderOptions, storage: StagingStorage) => {
    const blockID = options.element.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId || "";
    const controller = new AbortController();
    const {signal} = controller;
    let disposed = false;
    let busy = false;
    let entries: StagingFileEntry[] = [];
    let currentDirectory = "";
    let breadcrumbs: BreadcrumbItem[] = [{path: "", displayName: "文件暂存"}];
    let viewMode: "grid" | "list" = "grid";
    let sortKey: SortKey = "name";
    let sortDescending = false;
    let filterKeyword = "";
    let selected: string[] = [];
    let selectionAnchor = "";
    let renamingPath = "";
    let creatingFolder = false;
    let detailsVisible = true;

    const root = document.createElement("section");
    root.className = "data-staging";
    root.tabIndex = 0;
    root.innerHTML = `
        <div class="data-staging__header">
            <strong class="data-staging__title">${icon("box")}<span>文件暂存</span></strong>
            <div class="data-staging__actions">
                <input type="search" class="b3-text-field data-staging__search" placeholder="搜索当前目录" aria-label="搜索当前目录">
                <select class="b3-select data-staging__sort" aria-label="排序方式"></select>
                <button type="button" class="b3-button b3-button--text" data-action="sort-direction"></button>
                <button type="button" class="b3-button b3-button--outline" data-action="add">${icon("upload")}<span>添加文件</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="add-folder" title="添加文件夹" aria-label="添加文件夹">${icon("upload")}</button>
                <button type="button" class="b3-button b3-button--text" data-action="new-folder" title="新建文件夹" aria-label="新建文件夹">${icon("folderPlus")}</button>
                <button type="button" class="b3-button b3-button--text" data-action="download-current" title="下载当前目录为 ZIP" aria-label="下载当前目录为 ZIP">${icon("download")}</button>
                <button type="button" class="b3-button b3-button--text" data-action="refresh" title="刷新" aria-label="刷新">${icon("refresh")}</button>
                <button type="button" class="b3-button b3-button--text" data-action="toggle-view"></button>
                <button type="button" class="b3-button b3-button--text" data-action="toggle-detail" title="显示或隐藏详情面板" aria-label="显示或隐藏详情面板">${icon("info")}</button>
            </div>
        </div>
        <div class="data-staging__toolbar" hidden>
            <span class="data-staging__selection-count"></span>
            <div class="data-staging__toolbar-actions">
                <button type="button" class="b3-button b3-button--text" data-action="download-selected">${icon("download")}<span>下载</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="rename-selected">${icon("rename")}<span>重命名</span></button>
                <button type="button" class="b3-button b3-button--text data-staging__remove" data-action="remove-selected">${icon("trash")}<span>删除</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="clear-selection" title="取消选择" aria-label="取消选择">${icon("close")}</button>
            </div>
        </div>
        <nav class="data-staging__breadcrumbs" aria-label="暂存目录"></nav>
        <div class="data-staging__main">
            <div class="data-staging__content"></div>
            <aside class="data-staging__detail" aria-label="选中项详情"></aside>
        </div>
        <div class="data-staging__status" role="status" aria-live="polite"></div>
        <input type="file" multiple hidden>
        <input type="file" hidden data-directory-input>`;
    options.element.replaceChildren(root);

    const getElement = <T extends Element>(selector: string): T => {
        const element = root.querySelector<T>(selector);
        if (!element) {
            throw new Error(`暂存块界面缺少元素：${selector}`);
        }
        return element;
    };
    const searchInput = getElement<HTMLInputElement>(".data-staging__search");
    const sortSelect = getElement<HTMLSelectElement>(".data-staging__sort");
    const sortDirectionButton = getElement<HTMLButtonElement>('[data-action="sort-direction"]');
    const addButton = getElement<HTMLButtonElement>('[data-action="add"]');
    const addFolderButton = getElement<HTMLButtonElement>('[data-action="add-folder"]');
    const newFolderButton = getElement<HTMLButtonElement>('[data-action="new-folder"]');
    const downloadCurrentButton = getElement<HTMLButtonElement>('[data-action="download-current"]');
    const refreshButton = getElement<HTMLButtonElement>('[data-action="refresh"]');
    const toggleViewButton = getElement<HTMLButtonElement>('[data-action="toggle-view"]');
    const toggleDetailButton = getElement<HTMLButtonElement>('[data-action="toggle-detail"]');
    const toolbarElement = getElement<HTMLDivElement>(".data-staging__toolbar");
    const selectionCount = getElement<HTMLSpanElement>(".data-staging__selection-count");
    const downloadSelectedButton = getElement<HTMLButtonElement>('[data-action="download-selected"]');
    const renameSelectedButton = getElement<HTMLButtonElement>('[data-action="rename-selected"]');
    const removeSelectedButton = getElement<HTMLButtonElement>('[data-action="remove-selected"]');
    const clearSelectionButton = getElement<HTMLButtonElement>('[data-action="clear-selection"]');
    const input = getElement<HTMLInputElement>('input[type="file"]:not([data-directory-input])');
    const directoryInput = getElement<HTMLInputElement>("input[data-directory-input]");
    const statusElement = getElement<HTMLDivElement>(".data-staging__status");
    const contentElement = getElement<HTMLDivElement>(".data-staging__content");
    const detailElement = getElement<HTMLElement>(".data-staging__detail");
    const breadcrumbsElement = getElement<HTMLElement>(".data-staging__breadcrumbs");
    directoryInput.setAttribute("webkitdirectory", "");
    (Object.keys(SORT_KEY_LABELS) as SortKey[]).forEach(key => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `按${SORT_KEY_LABELS[key]}排序`;
        sortSelect.append(option);
    });
    sortSelect.value = sortKey;

    const setStatus = (text = "") => {
        statusElement.textContent = text;
        statusElement.classList.toggle("data-staging__status--error", !!text && !text.startsWith("正在") && !text.startsWith("已") && !text.startsWith("共"));
    };

    const setBusy = (value: boolean) => {
        busy = value;
        root.classList.toggle("data-staging--busy", value);
        root.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
            button.disabled = value;
        });
        contentElement.setAttribute("aria-busy", String(value));
        renameSelectedButton.disabled = value || selected.length !== 1;
        downloadSelectedButton.disabled = value || !selected.length;
        removeSelectedButton.disabled = value || !selected.length;
    };

    const visibleEntries = () => sortEntries(filterEntries(entries, filterKeyword), sortKey, sortDescending);
    const visiblePaths = () => visibleEntries().map(entry => entry.path);
    const selectedEntries = () => selected.map(path => entries.find(entry => entry.path === path))
        .filter((entry): entry is StagingFileEntry => !!entry);

    const makeButton = (label: string, iconName: IconName, handler: () => void, className = "") => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `b3-button b3-button--text ${className}`;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.innerHTML = `${icon(iconName)}<span>${label}</span>`;
        button.disabled = busy;
        button.addEventListener("click", event => {
            event.stopPropagation();
            handler();
        }, {signal});
        return button;
    };

    const clearSelection = () => {
        selected = [];
        selectionAnchor = "";
    };

    const renderToolbarState = () => {
        toolbarElement.hidden = !selected.length;
        selectionCount.textContent = `已选 ${selected.length} 项`;
        renameSelectedButton.disabled = busy || selected.length !== 1;
        downloadSelectedButton.disabled = busy || !selected.length;
        removeSelectedButton.disabled = busy || !selected.length;
    };

    const renderSelection = () => {
        contentElement.querySelectorAll<HTMLElement>(".data-staging__entry").forEach(element => {
            const isSelected = selected.includes(element.dataset.path || "");
            element.classList.toggle("data-staging__entry--selected", isSelected);
            if (isSelected) {
                element.setAttribute("aria-selected", "true");
            } else {
                element.removeAttribute("aria-selected");
            }
        });
        renderToolbarState();
        renderDetail();
    };

    const navigateTo = (path: string, depth: number) => {
        currentDirectory = path;
        breadcrumbs = breadcrumbs.slice(0, depth + 1);
        renamingPath = "";
        creatingFolder = false;
        clearSelection();
        void refresh();
    };

    const downloadFile = async (entry: StagingFileEntry) => {
        setStatus(`正在下载：${entry.displayName}`);
        saveBlob(await storage.download(blockID, entry.path), entry.displayName);
        setStatus(`已开始下载：${entry.displayName}`);
    };

    const downloadFolder = async (directory: string, displayName: string) => {
        setStatus(`正在打包：${displayName}`);
        const archive = await downloadFolderArchive(storage, blockID, directory, displayName);
        saveBlob(archive.blob, archive.fileName);
        setStatus(`已开始下载：${archive.fileName}（${archive.fileCount} 个文件）`);
    };

    const downloadEntry = async (entry: StagingFileEntry) => {
        if (entry.isDir) {
            await downloadFolder(entry.path, entry.displayName);
        } else {
            await downloadFile(entry);
        }
    };

    const downloadSelected = async () => {
        const targets = selectedEntries();
        if (busy || !targets.length) {
            return;
        }
        setBusy(true);
        const errors: string[] = [];
        try {
            for (const entry of targets) {
                try {
                    await downloadEntry(entry);
                } catch (error) {
                    console.error("File staging download failed", error);
                    errors.push(`${entry.displayName}：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            setStatus(errors.length ? `部分下载失败：${errors.join("；")}` : `已开始下载 ${targets.length} 项`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const downloadCurrent = async () => {
        if (busy) {
            return;
        }
        const current = breadcrumbs[breadcrumbs.length - 1];
        setBusy(true);
        try {
            await downloadFolder(current.path, current.displayName);
        } catch (error) {
            console.error("File staging folder download failed", error);
            setStatus(`文件夹下载失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const removeEntries = async (targets: StagingFileEntry[]) => {
        if (busy || !targets.length) {
            return;
        }
        const names = targets.map(entry => entry.displayName).join("、");
        const hasFolder = targets.some(entry => entry.isDir);
        const detail = hasFolder ? "文件夹及其中全部内容都会被删除。" : "此操作会同步到其他设备。";
        if (!await confirmAction("删除暂存内容", `确定删除“${names}”吗？${detail}`, true, "删除")) {
            return;
        }
        setBusy(true);
        const errors: string[] = [];
        let completed = 0;
        try {
            for (const entry of targets) {
                setStatus(`正在删除 ${completed + 1}/${targets.length}：${entry.displayName}`);
                try {
                    await storage.remove(blockID, entry.path);
                    completed++;
                } catch (error) {
                    console.error("File staging removal failed", error);
                    errors.push(`${entry.displayName}：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            clearSelection();
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(errors.length ? `部分删除失败：${errors.join("；")}` : `已删除 ${completed} 项`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const rename = async (entry: StagingFileEntry, displayName: string) => {
        if (busy) {
            return;
        }
        if (displayName === entry.displayName) {
            renamingPath = "";
            renderAll();
            return;
        }
        const nameError = validateFileName(displayName);
        if (nameError) {
            setStatus(nameError);
            return;
        }
        if (hasDisplayNameConflict(entries, displayName, entry.path)) {
            setStatus(`当前目录已存在同名显示项：${displayName}`);
            return;
        }
        setBusy(true);
        setStatus(`正在修改显示名：${entry.displayName}`);
        try {
            await storage.rename(blockID, entry.path, displayName);
            renamingPath = "";
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(`已修改显示名：${displayName}（实际存储路径不变）`);
        } catch (error) {
            console.error("File staging rename failed", error);
            setStatus(`重命名失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const createFolder = async (name: string) => {
        if (busy) {
            return;
        }
        const nameError = validateFileName(name);
        if (nameError) {
            setStatus(nameError);
            return;
        }
        if (hasDisplayNameConflict(entries, name)) {
            setStatus(`当前目录已存在同名项目：${name}`);
            return;
        }
        setBusy(true);
        setStatus(`正在新建文件夹：${name}`);
        try {
            await storage.createFolder(blockID, joinRelativePath(currentDirectory, name));
            creatingFolder = false;
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(`已新建文件夹：${name}`);
        } catch (error) {
            console.error("File staging folder creation failed", error);
            setStatus(`新建文件夹失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const openFolder = (entry: StagingFileEntry) => {
        if (busy || !entry.isDir) {
            return;
        }
        currentDirectory = entry.path;
        breadcrumbs.push({path: entry.path, displayName: entry.displayName});
        renamingPath = "";
        creatingFolder = false;
        clearSelection();
        void refresh();
    };

    const upload = async (items: UploadItem[], targetDirectory: string) => {
        if (busy || items.length === 0) {
            return;
        }
        const duplicates = getDuplicatePaths(items);
        if (duplicates.length) {
            setStatus(`同一批次中存在重复路径：${duplicates.join("、")}`);
            return;
        }
        const errors: string[] = [];
        const prepared: PreparedUpload[] = [];
        items.forEach(item => {
            try {
                const relative = normalizeRelativePath(item.path);
                if (relative !== item.path) {
                    throw new Error("路径格式无效");
                }
                if (!item.isDir && !item.file) {
                    throw new Error("无法读取文件");
                }
                if (item.file && item.file.size > MAX_FILE_SIZE) {
                    throw new Error(`超过 ${formatFileSize(MAX_FILE_SIZE)} 限制`);
                }
                prepared.push({...item, fullPath: joinRelativePath(targetDirectory, relative)});
            } catch (error) {
                errors.push(`${item.path}：${error instanceof Error ? error.message : String(error)}`);
            }
        });
        if (!prepared.length) {
            setStatus(errors.join("；"));
            return;
        }

        setBusy(true);
        try {
            setStatus("正在检查已有文件...");
            const existingEntries = await storage.listRecursive(blockID, targetDirectory);
            const existingMap = new Map(existingEntries.map(entry => [entry.path.toLocaleLowerCase(), entry]));
            const overwrites = findExistingPaths(prepared.filter(item => !item.isDir), existingEntries.filter(entry => !entry.isDir));
            const accepted = prepared.filter(item => {
                const existing = existingMap.get(item.fullPath.toLocaleLowerCase());
                if (existing && existing.isDir !== item.isDir) {
                    errors.push(`${item.path} 与现有${existing.isDir ? "文件夹" : "文件"}类型冲突`);
                    return false;
                }
                return true;
            });
            if (overwrites.length && !await confirmAction("覆盖同名文件",
                `以下文件已存在，上传后将覆盖最新内容：\n${overwrites.join("\n")}`, false, "覆盖")) {
                setStatus("已取消上传");
                return;
            }

            let completed = 0;
            const uploadedSizes: Record<string, number> = {};
            const ordered = [...accepted].sort((a, b) => Number(b.isDir) - Number(a.isDir));
            for (const item of ordered) {
                setStatus(`正在处理 ${completed + 1}/${ordered.length}：${item.path}`);
                try {
                    if (item.isDir) {
                        await storage.ensureFolder(blockID, item.fullPath);
                    } else if (item.file) {
                        await storage.upload(blockID, item.fullPath, item.file);
                        uploadedSizes[item.fullPath] = item.file.size;
                    }
                    completed++;
                } catch (error) {
                    console.error("File staging upload failed", error);
                    errors.push(`${item.path} 失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (Object.keys(uploadedSizes).length) {
                try {
                    await storage.recordSizes(blockID, uploadedSizes);
                } catch (error) {
                    console.error("File staging size metadata failed", error);
                    errors.push(`大小记录失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            clearSelection();
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            const summary = `已完成 ${completed}/${ordered.length} 项`;
            setStatus([summary, ...errors].join("；"));
            if (completed < ordered.length || errors.length) {
                showMessage("部分暂存内容上传失败，请在块内查看详情", 0, "error");
            }
        } catch (error) {
            console.error("File staging upload preparation failed", error);
            setStatus(`上传失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const moveEntries = async (paths: string[], targetDirectory: string) => {
        if (busy || !paths.length) {
            return;
        }
        const sources = paths.filter(path => getParentPath(path) !== targetDirectory);
        if (!sources.length) {
            return;
        }
        const invalid = sources.find(path => path === targetDirectory || targetDirectory.startsWith(`${path}/`));
        if (invalid) {
            setStatus("不能移动到自身或其子目录中");
            return;
        }
        setBusy(true);
        const errors: string[] = [];
        let completed = 0;
        try {
            const targetEntries = await storage.list(blockID, targetDirectory);
            const targetNames = new Set(targetEntries.map(entry => entry.name.toLocaleLowerCase()));
            for (const path of sources) {
                const baseName = getBaseName(path);
                if (targetNames.has(baseName.toLocaleLowerCase())) {
                    errors.push(`${baseName}：目标目录已存在同名项目`);
                    continue;
                }
                setStatus(`正在移动 ${completed + 1}/${sources.length}：${baseName}`);
                try {
                    await storage.move(blockID, path, joinRelativePath(targetDirectory, baseName));
                    targetNames.add(baseName.toLocaleLowerCase());
                    completed++;
                } catch (error) {
                    console.error("File staging move failed", error);
                    errors.push(`${baseName}：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            clearSelection();
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(errors.length ? `部分移动失败：${errors.join("；")}` : `已移动 ${completed} 项`);
        } catch (error) {
            console.error("File staging move failed", error);
            setStatus(`移动失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const hasDraggedFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
    const hasInternalDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes(INTERNAL_DRAG_TYPE);

    const clearDropHighlights = () => {
        contentElement.classList.remove("data-staging__content--over");
        root.querySelectorAll(".data-staging__entry--over").forEach(element => element.classList.remove("data-staging__entry--over"));
        root.querySelectorAll(".data-staging__breadcrumb--over").forEach(element => element.classList.remove("data-staging__breadcrumb--over"));
    };

    const readInternalPaths = (event: DragEvent): string[] => {
        const raw = event.dataTransfer?.getData(INTERNAL_DRAG_TYPE);
        if (!raw) {
            return [];
        }
        try {
            const value: unknown = JSON.parse(raw);
            return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        } catch {
            return [];
        }
    };

    const handleDrop = async (event: DragEvent, targetDirectory: string) => {
        if (!hasDraggedFiles(event) && !hasInternalDrag(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        clearDropHighlights();
        if (busy || !event.dataTransfer) {
            return;
        }
        try {
            if (hasInternalDrag(event)) {
                await moveEntries(readInternalPaths(event), targetDirectory);
            } else {
                await upload(await dataTransferToUploadItems(event.dataTransfer), targetDirectory);
            }
        } catch (error) {
            console.error("File staging drop failed", error);
            setStatus(`无法处理拖入内容：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const bindDropTarget = (element: HTMLElement, getTargetDirectory: () => string, highlight: () => void) => {
        element.addEventListener("dragover", event => {
            if (!hasDraggedFiles(event) && !hasInternalDrag(event)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            clearDropHighlights();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = busy ? "none" : (hasInternalDrag(event) ? "move" : "copy");
            }
            if (!busy) {
                highlight();
            }
        }, {signal});
        element.addEventListener("dragleave", event => {
            if (!element.contains(event.relatedTarget as Node | null)) {
                clearDropHighlights();
            }
        }, {signal});
        element.addEventListener("drop", event => void handleDrop(event, getTargetDirectory()), {signal});
    };

    const renderBreadcrumbs = () => {
        breadcrumbsElement.replaceChildren();
        breadcrumbs.forEach((item, index) => {
            if (index) {
                const separator = document.createElement("span");
                separator.className = "data-staging__breadcrumb-separator";
                separator.innerHTML = icon("chevron");
                breadcrumbsElement.append(separator);
            }
            const button = makeButton(item.displayName, index === 0 ? "box" : "folder", () => {
                if (!busy) {
                    navigateTo(item.path, index);
                }
            }, "data-staging__breadcrumb");
            button.disabled = busy || index === breadcrumbs.length - 1;
            bindDropTarget(button, () => item.path, () => button.classList.add("data-staging__breadcrumb--over"));
            breadcrumbsElement.append(button);
        });
    };

    const renderRename = (entry: StagingFileEntry, container: HTMLElement) => {
        const form = document.createElement("form");
        form.className = "data-staging__rename";
        const renameInput = document.createElement("input");
        renameInput.className = "b3-text-field";
        renameInput.value = entry.displayName;
        renameInput.setAttribute("aria-label", `显示名称：${entry.displayName}`);
        const save = makeButton("保存", "rename", () => undefined, "b3-button--outline");
        const cancel = makeButton("取消", "close", () => undefined);
        save.type = "submit";
        cancel.addEventListener("click", () => {
            renamingPath = "";
            renderAll();
        }, {signal});
        form.append(renameInput, save, cancel);
        form.addEventListener("submit", event => {
            event.preventDefault();
            void rename(entry, renameInput.value);
        }, {signal});
        container.append(form);
        requestAnimationFrame(() => {
            renameInput.focus();
            renameInput.select();
        });
    };

    const renderEntry = (entry: StagingFileEntry) => {
        const kind = getFileKind(entry.name, entry.isDir);
        const card = document.createElement("article");
        card.className = `data-staging__entry data-staging__entry--${kind}${entry.isDir ? " data-staging__entry--folder" : ""}`;
        card.dataset.path = entry.path;
        card.draggable = !busy;
        if (selected.includes(entry.path)) {
            card.classList.add("data-staging__entry--selected");
            card.setAttribute("aria-selected", "true");
        }

        if (renamingPath === entry.path) {
            renderRename(entry, card);
            return card;
        }

        const iconElement = document.createElement("span");
        iconElement.className = "data-staging__entry-icon";
        iconElement.innerHTML = icon(KIND_ICONS[kind]);
        const name = document.createElement("span");
        name.className = "data-staging__name";
        name.textContent = entry.displayName;
        name.title = entry.displayName === entry.name ? entry.displayName : `实际存储名：${entry.name}`;
        const kindLabel = document.createElement("span");
        kindLabel.className = "data-staging__kind";
        kindLabel.textContent = FILE_KIND_LABELS[kind];
        const size = document.createElement("span");
        size.className = "data-staging__size";
        size.textContent = entry.isDir ? "—" : (typeof entry.size === "number" ? formatFileSize(entry.size) : "未记录");
        const time = document.createElement("span");
        time.className = "data-staging__time";
        time.textContent = formatTime(entry.updated);
        card.append(iconElement, name, kindLabel, size, time);

        card.addEventListener("click", event => {
            if (busy) {
                return;
            }
            if (event.shiftKey && selectionAnchor) {
                selected = resolveRangeSelection(visiblePaths(), selectionAnchor, entry.path);
            } else if (event.ctrlKey || event.metaKey) {
                selected = toggleSelected(selected, entry.path);
                selectionAnchor = entry.path;
            } else {
                selected = [entry.path];
                selectionAnchor = entry.path;
            }
            renderSelection();
        }, {signal});
        card.addEventListener("dblclick", event => {
            event.preventDefault();
            if (busy) {
                return;
            }
            if (entry.isDir) {
                openFolder(entry);
            } else {
                detailsVisible = true;
                selected = [entry.path];
                selectionAnchor = entry.path;
                renderAll();
            }
        }, {signal});
        card.addEventListener("dragstart", event => {
            if (busy || !event.dataTransfer) {
                return;
            }
            if (!selected.includes(entry.path)) {
                selected = [entry.path];
                selectionAnchor = entry.path;
            }
            event.dataTransfer.setData(INTERNAL_DRAG_TYPE, JSON.stringify(selected));
            event.dataTransfer.effectAllowed = "move";
        }, {signal});
        card.addEventListener("dragend", clearDropHighlights, {signal});
        if (entry.isDir) {
            bindDropTarget(card, () => entry.path, () => card.classList.add("data-staging__entry--over"));
        }
        return card;
    };

    const renderNewFolder = () => {
        if (!creatingFolder) {
            return;
        }
        const form = document.createElement("form");
        form.className = "data-staging__new-folder";
        const folderInput = document.createElement("input");
        folderInput.className = "b3-text-field";
        folderInput.placeholder = "文件夹名称";
        folderInput.setAttribute("aria-label", "新文件夹名称");
        const save = makeButton("创建", "folderPlus", () => undefined, "b3-button--outline");
        save.type = "submit";
        const cancel = makeButton("取消", "close", () => undefined);
        cancel.addEventListener("click", () => {
            creatingFolder = false;
            renderAll();
        }, {signal});
        form.append(folderInput, save, cancel);
        form.addEventListener("submit", event => {
            event.preventDefault();
            void createFolder(folderInput.value);
        }, {signal});
        contentElement.append(form);
        requestAnimationFrame(() => folderInput.focus());
    };

    const renderDetailField = (container: HTMLElement, label: string, value: string) => {
        const row = document.createElement("div");
        row.className = "data-staging__detail-row";
        const key = document.createElement("span");
        key.className = "data-staging__detail-label";
        key.textContent = label;
        const text = document.createElement("span");
        text.className = "data-staging__detail-value";
        text.textContent = value;
        text.title = value;
        row.append(key, text);
        container.append(row);
    };

    const renderDetail = () => {
        detailElement.replaceChildren();
        detailElement.hidden = !detailsVisible;
        root.classList.toggle("data-staging--detail-hidden", !detailsVisible);
        if (!detailsVisible) {
            return;
        }
        const targets = selectedEntries();
        const title = document.createElement("div");
        title.className = "data-staging__detail-title";
        detailElement.append(title);
        if (!targets.length) {
            title.innerHTML = `${icon("info")}<span>详情</span>`;
            const hint = document.createElement("p");
            hint.className = "data-staging__detail-hint";
            hint.textContent = "单击选择项目，双击进入文件夹。拖动文件到此处即可上传，拖动条目到文件夹即可移动。";
            detailElement.append(hint);
            renderDetailField(detailElement, "当前目录", breadcrumbs[breadcrumbs.length - 1].displayName);
            renderDetailField(detailElement, "项目数", `${entries.length} 项`);
            return;
        }
        if (targets.length > 1) {
            title.innerHTML = `${icon("box")}<span>已选 ${targets.length} 项</span>`;
            const known = targets.filter(entry => !entry.isDir && typeof entry.size === "number");
            const total = known.reduce((sum, entry) => sum + (entry.size || 0), 0);
            renderDetailField(detailElement, "文件", `${targets.filter(entry => !entry.isDir).length} 个`);
            renderDetailField(detailElement, "文件夹", `${targets.filter(entry => entry.isDir).length} 个`);
            renderDetailField(detailElement, "已记录大小", known.length ? `${formatFileSize(total)}（${known.length} 个文件）` : "未记录");
            const actions = document.createElement("div");
            actions.className = "data-staging__detail-actions";
            actions.append(
                makeButton("下载所选项", "download", () => void downloadSelected()),
                makeButton("删除所选项", "trash", () => void removeEntries(targets), "data-staging__remove"),
            );
            detailElement.append(actions);
            return;
        }
        const entry = targets[0];
        const kind = getFileKind(entry.name, entry.isDir);
        title.innerHTML = icon(KIND_ICONS[kind]);
        const titleLabel = document.createElement("span");
        titleLabel.textContent = entry.displayName;
        title.append(titleLabel);
        title.title = entry.displayName;
        renderDetailField(detailElement, "类型", FILE_KIND_LABELS[kind]);
        renderDetailField(detailElement, "大小", entry.isDir ? "—" : (typeof entry.size === "number" ? formatFileSize(entry.size) : "未记录（旧版上传）"));
        renderDetailField(detailElement, "修改时间", formatTime(entry.updated) || "未知");
        renderDetailField(detailElement, "实际存储名", entry.name);
        renderDetailField(detailElement, "相对路径", entry.path);
        const actions = document.createElement("div");
        actions.className = "data-staging__detail-actions";
        actions.append(
            makeButton(entry.isDir ? "下载 ZIP" : "下载", "download", () => {
                setBusy(true);
                void downloadEntry(entry).catch(error => {
                    console.error("File staging download failed", error);
                    setStatus(`下载失败：${error instanceof Error ? error.message : String(error)}`);
                }).finally(() => {
                    if (!disposed) {
                        setBusy(false);
                    }
                });
            }),
            makeButton("重命名", "rename", () => {
                renamingPath = entry.path;
                renderAll();
            }),
            makeButton("删除", "trash", () => void removeEntries([entry]), "data-staging__remove"),
        );
        detailElement.append(actions);
    };

    function renderContent() {
        contentElement.className = `data-staging__content data-staging__content--${viewMode}`;
        contentElement.replaceChildren();
        renderNewFolder();
        const visible = visibleEntries();
        if (viewMode === "list" && visible.length) {
            const head = document.createElement("div");
            head.className = "data-staging__list-head";
            head.innerHTML = "<span></span><span>名称</span><span>类型</span><span>大小</span><span>修改时间</span>";
            contentElement.append(head);
        }
        if (!visible.length) {
            const empty = document.createElement("div");
            empty.className = "data-staging__empty";
            empty.textContent = entries.length
                ? "当前目录没有匹配搜索条件的项目"
                : "暂无文件或文件夹\n拖动文件或文件夹到此处，或点击“添加文件”";
            contentElement.append(empty);
            return;
        }
        visible.forEach(entry => contentElement.append(renderEntry(entry)));
    }

    function renderAll() {
        renderBreadcrumbs();
        renderContent();
        renderDetail();
        const nextMode = viewMode === "grid" ? "列表" : "图标";
        toggleViewButton.innerHTML = `${icon(viewMode === "grid" ? "list" : "grid")}<span>${nextMode}视图</span>`;
        toggleViewButton.title = `切换为${nextMode}视图`;
        toggleViewButton.setAttribute("aria-label", toggleViewButton.title);
        sortDirectionButton.textContent = sortDescending ? "降序" : "升序";
        sortDirectionButton.title = sortDescending ? "切换为升序" : "切换为降序";
        sortDirectionButton.setAttribute("aria-label", sortDirectionButton.title);
        renderToolbarState();
    }

    async function refresh() {
        if (busy || disposed) {
            return;
        }
        setBusy(true);
        setStatus("正在读取文件列表...");
        try {
            entries = await storage.list(blockID, currentDirectory);
            selected = selected.filter(path => entries.some(entry => entry.path === path));
            renderAll();
            setStatus(entries.length ? `共 ${entries.length} 项` : "");
        } catch (error) {
            console.error("File staging refresh failed", error);
            setStatus(`读取失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    }

    addButton.addEventListener("click", () => input.click(), {signal});
    addFolderButton.addEventListener("click", () => directoryInput.click(), {signal});
    newFolderButton.addEventListener("click", () => {
        creatingFolder = true;
        renamingPath = "";
        renderAll();
    }, {signal});
    downloadCurrentButton.addEventListener("click", () => void downloadCurrent(), {signal});
    refreshButton.addEventListener("click", () => void refresh(), {signal});
    toggleViewButton.addEventListener("click", () => {
        viewMode = viewMode === "grid" ? "list" : "grid";
        renderAll();
    }, {signal});
    toggleDetailButton.addEventListener("click", () => {
        detailsVisible = !detailsVisible;
        renderAll();
    }, {signal});
    searchInput.addEventListener("input", () => {
        filterKeyword = searchInput.value;
        renderAll();
    }, {signal});
    sortSelect.addEventListener("change", () => {
        sortKey = sortSelect.value as SortKey;
        renderAll();
    }, {signal});
    sortDirectionButton.addEventListener("click", () => {
        sortDescending = !sortDescending;
        renderAll();
    }, {signal});
    downloadSelectedButton.addEventListener("click", () => void downloadSelected(), {signal});
    renameSelectedButton.addEventListener("click", () => {
        if (selected.length === 1) {
            renamingPath = selected[0];
            renderAll();
        }
    }, {signal});
    removeSelectedButton.addEventListener("click", () => void removeEntries(selectedEntries()), {signal});
    clearSelectionButton.addEventListener("click", () => {
        clearSelection();
        renderSelection();
    }, {signal});
    input.addEventListener("change", () => {
        const files = Array.from(input.files || []);
        input.value = "";
        void upload(filesToUploadItems(files), currentDirectory);
    }, {signal});
    directoryInput.addEventListener("change", () => {
        const files = Array.from(directoryInput.files || []);
        directoryInput.value = "";
        void upload(filesToUploadItems(files), currentDirectory);
    }, {signal});
    contentElement.addEventListener("click", event => {
        if (event.target === contentElement && !busy) {
            clearSelection();
            renderSelection();
        }
    }, {signal});
    bindDropTarget(contentElement, () => currentDirectory, () => contentElement.classList.add("data-staging__content--over"));
    root.addEventListener("keydown", event => {
        const target = event.target as HTMLElement | null;
        const isField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
        if (event.key === "Escape") {
            if (renamingPath || creatingFolder) {
                renamingPath = "";
                creatingFolder = false;
            } else {
                clearSelection();
            }
            renderAll();
            event.stopPropagation();
            return;
        }
        if (isField || busy) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();
            selected = visiblePaths();
            selectionAnchor = selected[0] || "";
            renderAll();
        } else if (event.key === "Delete") {
            event.preventDefault();
            event.stopPropagation();
            void removeEntries(selectedEntries());
        } else if (event.key === "F2" && selected.length === 1) {
            event.preventDefault();
            event.stopPropagation();
            renamingPath = selected[0];
            renderAll();
        } else if (event.key === "Enter" && selected.length === 1) {
            const entry = selectedEntries()[0];
            if (entry?.isDir) {
                event.preventDefault();
                event.stopPropagation();
                openFolder(entry);
            }
        }
    }, {signal});

    if (!blockID) {
        addButton.disabled = true;
        addFolderButton.disabled = true;
        newFolderButton.disabled = true;
        downloadCurrentButton.disabled = true;
        refreshButton.disabled = true;
        setStatus("无法确定暂存块 ID，请重新插入文件暂存块");
    } else {
        renderAll();
        void refresh();
    }

    return () => {
        disposed = true;
        controller.abort();
    };
};
