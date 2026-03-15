export interface DropTargetInfo {
    path: number[];
    position: 'before' | 'after' | 'inside';
}

export interface SearchResult {
    layer: any;
    path: number[];
    displayName: string;
    matchStart: number;
    matchEnd: number;
}
