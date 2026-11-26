export type FileKind = "folder" | "image" | "audio" | "video" | "pdf" | "word" | "sheet" | "slides"
    | "archive" | "code" | "text" | "markdown" | "package" | "file";

const KIND_EXTENSIONS: Record<Exclude<FileKind, "folder" | "file">, string[]> = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic", "heif", "tif", "tiff"],
    audio: ["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "opus", "wma", "aiff", "aif"],
    video: ["mp4", "mkv", "mov", "webm", "avi", "flv", "wmv", "m4v", "mpg", "mpeg", "ts"],
    pdf: ["pdf"],
    word: ["doc", "docx", "rtf", "odt", "wps"],
    sheet: ["xls", "xlsx", "csv", "tsv", "ods", "et", "numbers"],
    slides: ["ppt", "pptx", "key", "odp", "dps"],
    archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "jar"],
    code: ["js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "jsonc", "css", "scss", "less", "html", "htm", "vue",
        "svelte", "py", "rb", "go", "rs", "java", "c", "h", "cc", "cpp", "hpp", "cs", "php", "swift", "kt", "kts",
        "sh", "bash", "zsh", "ps1", "sql", "yaml", "yml", "toml", "ini", "conf", "xml", "lua", "pl", "r", "dart"],
    text: ["txt", "log"],
    markdown: ["md", "markdown", "mdx"],
    package: ["exe", "msi", "dmg", "pkg", "apk", "ipa", "deb", "rpm", "appimage", "iso", "dll", "so", "dylib"],
};

const EXTENSION_KINDS = new Map<string, FileKind>();
Object.entries(KIND_EXTENSIONS).forEach(([kind, extensions]) => {
    extensions.forEach(extension => EXTENSION_KINDS.set(extension, kind as FileKind));
});

export const getExtension = (name: string) => {
    const base = name.split("/").pop() || "";
    const index = base.lastIndexOf(".");
    return index > 0 ? base.slice(index + 1).toLowerCase() : "";
};

export const getFileKind = (name: string, isDir = false): FileKind => {
    if (isDir) {
        return "folder";
    }
    return EXTENSION_KINDS.get(getExtension(name)) || "file";
};

export const FILE_KIND_LABELS: Record<FileKind, string> = {
    folder: "文件夹",
    image: "图片",
    audio: "音频",
    video: "视频",
    pdf: "PDF 文档",
    word: "Word 文档",
    sheet: "表格",
    slides: "演示文稿",
    archive: "压缩包",
    code: "代码/配置",
    text: "文本",
    markdown: "Markdown",
    package: "安装包/二进制",
    file: "文件",
};
