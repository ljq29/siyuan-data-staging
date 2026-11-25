const paths = {
    box: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/>',
    folder: '<path d="M3 6.5h6l2 2h10v10.5H3z"/><path d="M3 6.5v-2h6l2 2"/>',
    file: '<path d="M6 2.5h8l4 4v15H6z"/><path d="M14 2.5v5h4M9 12h6M9 16h6"/>',
    upload: '<path d="M12 16V3m0 0L7 8m5-5 5 5M4 14v6h16v-6"/>',
    folderPlus: '<path d="M3 6.5h6l2 2h10v10.5H3zM12 11v5m-2.5-2.5h5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 11.9-2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    download: '<path d="M12 3v13m0 0 5-5m-5 5-5-5M4 20h16"/>',
    rename: '<path d="m14 5 5 5M4 20l3.5-.7L20 6.8 17.2 4 4.7 16.5zM13 20h8"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
};

export type IconName = keyof typeof paths;

export const icon = (name: IconName, className = "") => {
    return `<svg class="data-staging__icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
