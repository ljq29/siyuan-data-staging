export interface UploadItem {
    path: string;
    isDir: boolean;
    file?: File;
}

const readFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const readEntries = (reader: FileSystemDirectoryReader) => {
    return new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
};

const readAllEntries = async (reader: FileSystemDirectoryReader) => {
    const entries: FileSystemEntry[] = [];
    while (true) {
        const batch = await readEntries(reader);
        if (!batch.length) {
            return entries;
        }
        entries.push(...batch);
    }
};

const readEntry = async (entry: FileSystemEntry, path: string): Promise<UploadItem[]> => {
    if (entry.isFile) {
        return [{path, isDir: false, file: await readFile(entry as FileSystemFileEntry)}];
    }
    if (!entry.isDirectory) {
        return [];
    }
    const items: UploadItem[] = [{path, isDir: true}];
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
        items.push(...await readEntry(child, `${path}/${child.name}`));
    }
    return items;
};

export const filesToUploadItems = (files: File[]): UploadItem[] => files.map(file => ({
    path: file.webkitRelativePath || file.name,
    isDir: false,
    file,
}));

export const dataTransferToUploadItems = async (dataTransfer: DataTransfer): Promise<UploadItem[]> => {
    const entries = Array.from(dataTransfer.items).map(item => {
        try {
            return item.webkitGetAsEntry?.();
        } catch {
            return null;
        }
    }).filter((entry): entry is FileSystemEntry => !!entry);
    if (!entries.length) {
        return filesToUploadItems(Array.from(dataTransfer.files));
    }
    const items: UploadItem[] = [];
    for (const entry of entries) {
        items.push(...await readEntry(entry, entry.name));
    }
    return items;
};
