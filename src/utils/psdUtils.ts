import { Psd } from 'ag-psd';
import { SearchResult } from '../types';

export function getLayersAtPath(children: any[], parentPath: number[]): any[] {
    let current = children;
    for (const idx of parentPath) current = current[idx].children;
    return current;
}

export function cacheDataUrls(layers: any[]): void {
    for (const layer of layers) {
        if (layer.canvas && layer._dataUrl === undefined) {
            try { layer._dataUrl = layer.canvas.toDataURL(); }
            catch { layer._dataUrl = null; }
        }
        if (layer.children?.length) cacheDataUrls(layer.children);
    }
}

// [FIX] Bug #4: commitPsd / updateLayerByPath 後にサムネイルが更新されない問題を解消。
// 単一レイヤーに対して _dataUrl を再生成するヘルパー。
// updateLayerByPath でシャローコピーされた後のレイヤーに対して呼ぶ。
export function refreshLayerThumb(layer: any): any {
    if (!layer.canvas) return layer;
    try {
        return { ...layer, _dataUrl: layer.canvas.toDataURL() };
    } catch {
        return { ...layer, _dataUrl: null };
    }
}

export function updateLayerByPath(psd: Psd, path: number[], update: (layer: any) => any): Psd {
    const newPsd = { ...psd };
    if (!newPsd.children) return newPsd;
    newPsd.children = [...newPsd.children];
    let current = newPsd.children;
    const pathCopy = [...path];
    const lastIdx = pathCopy.pop();
    if (lastIdx === undefined) return newPsd;
    for (const idx of pathCopy) {
        current[idx] = { ...current[idx], children: [...(current[idx].children || [])] };
        current = current[idx].children!;
    }
    current[lastIdx] = update(current[lastIdx]);
    return newPsd;
}

export function collectSearchResults(layers: any[], query: string, parentPath: number[] = []): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    layers.forEach((layer, idx) => {
        const rawName = layer.name || '';
        const displayName = rawName.startsWith('*') || rawName.startsWith('!') ? rawName.slice(1) : rawName;
        const matchStart = displayName.toLowerCase().indexOf(lowerQuery);
        if (matchStart !== -1)
            results.push({ layer, path: [...parentPath, idx], displayName, matchStart, matchEnd: matchStart + lowerQuery.length });
        if (layer.children?.length)
            results.push(...collectSearchResults(layer.children, query, [...parentPath, idx]));
    });
    return results;
}

export function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let last = 0;
    return ((...args: any[]) => {
        const now = Date.now();
        if (now - last >= ms) { last = now; fn(...args); }
    }) as T;
}