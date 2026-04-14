export interface DropTargetInfo {
    path: number[];
    position: 'before' | 'after' | 'inside';
}

export interface PsdLayerNode {
    name?: string;
    hidden?: boolean;
    opacity?: number;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
    children?: PsdLayerNode[];
    _bitmap?: ImageBitmap;
    _dataUrl?: string;
    canvas?: HTMLCanvasElement | any;
}

export interface PsdRoot {
    width: number;
    height: number;
    children: PsdLayerNode[];
    _bitmap?: ImageBitmap;
}

export interface SearchResult {
    layer: PsdLayerNode;
    path: number[];
    displayName: string;
    matchStart: number;
    matchEnd: number;
}

export interface LocaleStrings {
    open: string;
    png: string;
    savePsd: string;
    workspace: string;
    layers: string;
    addLayer: string;
    addGroup: string;
    expandAll: string;
    collapseAll: string;
    searchPlaceholder: string;
    radio: string;
    fixed: string;
    flip: string;
    dropPsd: string;
    noLayers: string;
    loading: string;
    dragDrop: string;
    dragRelease: string;
    settings: string;
    favorites: string;
    saveState: string;
    noFavorites: string;
    applyState: string;
    deleteState: string;
    promptName: string;
    renameState: string;
    promptRename: string;
    moveUp: string;
    moveDown: string;
    dragHandle: string;
    saved: string;
    applied: string;
    cancel: string;
    ok: string;
    copied: string;
    copyFailed: string;
    loadFailed: string;
    openFailed: string;
    saveSuccess: string;
    saveFailed: string;
    exportSuccess: string;
    exportFailed: string;
    newTab: string;
    closeTab: string;
    exportAllFavDone: (n: number) => string;
    copyToClipboard: string;
    fitToScreen: string;
    centerView: string;
    undo: string;
    redo: string;
    zoomIn: string;
    zoomOut: string;
    zoom100: string;
    enterFullscreen: string;
    exitFullscreen: string;
    theme: string;
    themeBlack: string;
    themeGrey: string;
    themeLight: string;
    themeWhite: string;
    [key: string]: string | ((n: number) => string);
}
