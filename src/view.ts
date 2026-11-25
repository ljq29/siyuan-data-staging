import {confirm, showMessage} from "siyuan";
import {downloadFolderArchive} from "./archive";
import {dataTransferToUploadItems, filesToUploadItems} from "./drop";
import type {UploadItem} from "./drop";
import {icon} from "./icons";
import type {IconName} from "./icons";
import {
    findExistingPaths,
    formatFileSize,
    getDuplicatePaths,
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
    let breadcrumbs: BreadcrumbItem[] = [{path: "", displayName: "数据暂存"}];
    let viewMode: "grid" | "list" = "grid";
    let renamingPath = "";
    let creatingFolder = false;

    const root = document.createElement("section");
    root.className = "data-staging";
    root.innerHTML = `
        <div class="data-staging__header">
            <strong class="data-staging__title">${icon("box")}<span>数据暂存</span></strong>
            <div class="data-staging__actions">
                <button type="button" class="b3-button b3-button--outline" data-action="add">${icon("upload")}<span>添加文件</span></button>
                <button type="button" class="b3-button b3-button--outline" data-action="add-folder">${icon("folderPlus")}<span>添加文件夹</span></button>
                <button type="button" class="b3-button b3-button--outline" data-action="new-folder">${icon("folderPlus")}<span>新建文件夹</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="download-current">${icon("download")}<span>下载目录</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="refresh">${icon("refresh")}<span>刷新</span></button>
                <button type="button" class="b3-button b3-button--text" data-action="toggle-view"></button>
            </div>
        </div>
        <nav class="data-staging__breadcrumbs" aria-label="暂存目录"></nav>
        <input type="file" multiple hidden>
        <input type="file" hidden data-directory-input>
        <div class="data-staging__status" role="status" aria-live="polite"></div>
        <div class="data-staging__content"></div>`;
    options.element.replaceChildren(root);

    const getElement = <T extends Element>(selector: string): T => {
        const element = root.querySelector<T>(selector);
        if (!element) {
            throw new Error(`暂存块界面缺少元素：${selector}`);
        }
        return element;
    };
    const addButton = getElement<HTMLButtonElement>('[data-action="add"]');
    const addFolderButton = getElement<HTMLButtonElement>('[data-action="add-folder"]');
    const newFolderButton = getElement<HTMLButtonElement>('[data-action="new-folder"]');
    const downloadCurrentButton = getElement<HTMLButtonElement>('[data-action="download-current"]');
    const refreshButton = getElement<HTMLButtonElement>('[data-action="refresh"]');
    const toggleViewButton = getElement<HTMLButtonElement>('[data-action="toggle-view"]');
    const input = getElement<HTMLInputElement>('input[type="file"]:not([data-directory-input])');
    const directoryInput = getElement<HTMLInputElement>("input[data-directory-input]");
    const statusElement = getElement<HTMLDivElement>(".data-staging__status");
    const contentElement = getElement<HTMLDivElement>(".data-staging__content");
    const breadcrumbsElement = getElement<HTMLElement>(".data-staging__breadcrumbs");
    directoryInput.setAttribute("webkitdirectory", "");

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
    };

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
                if (busy) {
                    return;
                }
                currentDirectory = item.path;
                breadcrumbs = breadcrumbs.slice(0, index + 1);
                renamingPath = "";
                void refresh();
            }, "data-staging__breadcrumb");
            button.disabled = busy || index === breadcrumbs.length - 1;
            breadcrumbsElement.append(button);
        });
    };

    const downloadFile = async (entry: StagingFileEntry) => {
        if (busy) {
            return;
        }
        setBusy(true);
        setStatus(`正在下载：${entry.displayName}`);
        try {
            saveBlob(await storage.download(blockID, entry.path), entry.displayName);
            setStatus(`已开始下载：${entry.displayName}`);
        } catch (error) {
            console.error("Data staging download failed", error);
            setStatus(`下载失败：${entry.displayName}；${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const downloadFolder = async (directory: string, displayName: string) => {
        if (busy) {
            return;
        }
        setBusy(true);
        setStatus(`正在打包：${displayName}`);
        try {
            const archive = await downloadFolderArchive(storage, blockID, directory, displayName);
            saveBlob(archive.blob, archive.fileName);
            setStatus(`已开始下载：${archive.fileName}（${archive.fileCount} 个文件）`);
        } catch (error) {
            console.error("Data staging folder download failed", error);
            setStatus(`文件夹下载失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const remove = async (entry: StagingFileEntry) => {
        if (busy) {
            return;
        }
        const detail = entry.isDir ? "文件夹及其中全部内容都会被删除。" : "此操作会同步到其他设备。";
        if (!await confirmAction("删除暂存内容", `确定删除“${entry.displayName}”吗？${detail}`, true, "删除")) {
            return;
        }
        setBusy(true);
        setStatus(`正在删除：${entry.displayName}`);
        try {
            await storage.remove(blockID, entry.path);
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(`已删除：${entry.displayName}`);
        } catch (error) {
            console.error("Data staging removal failed", error);
            setStatus(`删除失败：${entry.displayName}；${error instanceof Error ? error.message : String(error)}`);
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
            renderContent();
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
            console.error("Data staging rename failed", error);
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
            console.error("Data staging folder creation failed", error);
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
            const ordered = [...accepted].sort((a, b) => Number(b.isDir) - Number(a.isDir));
            for (const item of ordered) {
                setStatus(`正在处理 ${completed + 1}/${ordered.length}：${item.path}`);
                try {
                    if (item.isDir) {
                        await storage.ensureFolder(blockID, item.fullPath);
                    } else if (item.file) {
                        await storage.upload(blockID, item.fullPath, item.file);
                    }
                    completed++;
                } catch (error) {
                    console.error("Data staging upload failed", error);
                    errors.push(`${item.path} 失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            const summary = `已完成 ${completed}/${ordered.length} 项`;
            setStatus([summary, ...errors].join("；"));
            if (completed < ordered.length || errors.length) {
                showMessage("部分暂存内容上传失败，请在块内查看详情", 0, "error");
            }
        } catch (error) {
            console.error("Data staging upload preparation failed", error);
            setStatus(`上传失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (!disposed) {
                setBusy(false);
            }
        }
    };

    const hasDraggedFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");

    const handleDrop = async (event: DragEvent, targetDirectory: string) => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        contentElement.classList.remove("data-staging__content--over");
        root.querySelectorAll(".data-staging__entry--over").forEach(element => element.classList.remove("data-staging__entry--over"));
        if (busy || !event.dataTransfer) {
            return;
        }
        try {
            await upload(await dataTransferToUploadItems(event.dataTransfer), targetDirectory);
        } catch (error) {
            console.error("Data staging drop failed", error);
            setStatus(`无法读取拖入内容：${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const renderRename = (entry: StagingFileEntry, container: HTMLElement) => {
        const form = document.createElement("form");
        form.className = "data-staging__rename";
        const renameInput = document.createElement("input");
        renameInput.className = "b3-text-field";
        renameInput.value = entry.displayName;
        renameInput.setAttribute("aria-label", `显示名称：${entry.displayName}`);
        const save = makeButton("保存", "rename", () => undefined, "b3-button--outline");
        const cancel = makeButton("取消", "rename", () => undefined);
        save.type = "submit";
        cancel.addEventListener("click", () => {
            renamingPath = "";
            renderContent();
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
        const card = document.createElement("article");
        card.className = `data-staging__entry${entry.isDir ? " data-staging__entry--folder" : ""}`;
        card.dataset.path = entry.path;

        const main = document.createElement(entry.isDir ? "button" : "div");
        main.className = "data-staging__entry-main";
        if (main instanceof HTMLButtonElement) {
            main.type = "button";
            main.disabled = busy;
            main.title = `打开 ${entry.displayName}`;
            main.addEventListener("click", () => openFolder(entry), {signal});
        }
        const iconElement = document.createElement("span");
        iconElement.className = "data-staging__entry-icon";
        iconElement.innerHTML = icon(entry.isDir ? "folder" : "file");
        const name = document.createElement("span");
        name.className = "data-staging__name";
        name.textContent = entry.displayName;
        name.title = entry.displayName === entry.name ? entry.displayName : `实际存储名：${entry.name}`;
        main.append(iconElement, name);
        card.append(main);

        if (renamingPath === entry.path) {
            renderRename(entry, card);
        } else {
            const time = document.createElement("div");
            time.className = "data-staging__time";
            time.textContent = entry.isDir ? "文件夹" : formatTime(entry.updated);
            card.append(time);
        }

        const actions = document.createElement("div");
        actions.className = "data-staging__entry-actions";
        actions.append(
            makeButton(`重命名 ${entry.displayName}`, "rename", () => {
                renamingPath = entry.path;
                renderContent();
            }),
            makeButton(`${entry.isDir ? "下载 ZIP" : "下载"} ${entry.displayName}`, "download", () => {
                void (entry.isDir ? downloadFolder(entry.path, entry.displayName) : downloadFile(entry));
            }),
            makeButton(`删除 ${entry.displayName}`, "trash", () => void remove(entry), "data-staging__remove"),
        );
        card.append(actions);

        if (entry.isDir) {
            card.addEventListener("dragover", event => {
                if (!hasDraggedFiles(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                contentElement.classList.remove("data-staging__content--over");
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = busy ? "none" : "copy";
                }
                card.classList.toggle("data-staging__entry--over", !busy);
            }, {signal});
            card.addEventListener("dragleave", event => {
                if (!card.contains(event.relatedTarget as Node | null)) {
                    card.classList.remove("data-staging__entry--over");
                }
            }, {signal});
            card.addEventListener("drop", event => void handleDrop(event, entry.path), {signal});
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
        const cancel = makeButton("取消", "folderPlus", () => undefined);
        cancel.addEventListener("click", () => {
            creatingFolder = false;
            renderContent();
        }, {signal});
        form.append(folderInput, save, cancel);
        form.addEventListener("submit", event => {
            event.preventDefault();
            void createFolder(folderInput.value);
        }, {signal});
        contentElement.append(form);
        requestAnimationFrame(() => folderInput.focus());
    };

    function renderContent() {
        contentElement.className = `data-staging__content data-staging__content--${viewMode}`;
        contentElement.replaceChildren();
        renderNewFolder();
        if (!entries.length) {
            const empty = document.createElement("div");
            empty.className = "data-staging__empty";
            empty.textContent = "暂无文件或文件夹\n拖动文件或文件夹到此处，或点击“添加文件”";
            contentElement.append(empty);
            return;
        }
        entries.forEach(entry => contentElement.append(renderEntry(entry)));
    }

    function renderAll() {
        renderBreadcrumbs();
        renderContent();
        const nextMode = viewMode === "grid" ? "列表" : "图标";
        toggleViewButton.innerHTML = `${icon(viewMode === "grid" ? "list" : "grid")}<span>${nextMode}视图</span>`;
        toggleViewButton.title = `切换为${nextMode}视图`;
        toggleViewButton.setAttribute("aria-label", toggleViewButton.title);
    }

    async function refresh() {
        if (busy || disposed) {
            return;
        }
        setBusy(true);
        setStatus("正在读取文件列表...");
        try {
            entries = await storage.list(blockID, currentDirectory);
            renderAll();
            setStatus(entries.length ? `共 ${entries.length} 项` : "");
        } catch (error) {
            console.error("Data staging refresh failed", error);
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
        renderContent();
    }, {signal});
    downloadCurrentButton.addEventListener("click", () => {
        const current = breadcrumbs[breadcrumbs.length - 1];
        void downloadFolder(current.path, current.displayName);
    }, {signal});
    refreshButton.addEventListener("click", () => void refresh(), {signal});
    toggleViewButton.addEventListener("click", () => {
        viewMode = viewMode === "grid" ? "list" : "grid";
        renderAll();
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
    contentElement.addEventListener("dragover", event => {
        if (!hasDraggedFiles(event)) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }
        contentElement.classList.toggle("data-staging__content--over", !busy);
    }, {signal});
    contentElement.addEventListener("dragleave", event => {
        if (!contentElement.contains(event.relatedTarget as Node | null)) {
            contentElement.classList.remove("data-staging__content--over");
        }
    }, {signal});
    contentElement.addEventListener("drop", event => void handleDrop(event, currentDirectory), {signal});

    if (!blockID) {
        addButton.disabled = true;
        addFolderButton.disabled = true;
        newFolderButton.disabled = true;
        downloadCurrentButton.disabled = true;
        refreshButton.disabled = true;
        setStatus("无法确定暂存块 ID，请重新插入数据暂存块");
    } else {
        renderAll();
        void refresh();
    }

    return () => {
        disposed = true;
        controller.abort();
    };
};
