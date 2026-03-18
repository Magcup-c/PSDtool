/**
 * src/utils/psdUtils.ts  (updated)
 *
 * 変更点:
 *   - cacheDataUrls()  → 削除（Worker 側で ImageBitmap に置き換え）
 *   - refreshLayerThumb() → 削除（同上）
 *   - attachThumbs()   → 新規追加
 *       Worker から返ってきた LayerThumbEntry[] を
 *       PSD ツリーの layer._thumb に注入する純粋関数。
 */

import { Psd } from 'ag-psd';
import { SearchResult } from '../types';
import type { LayerThumbEntry } from '../workers/psdWorker';

export function getLayersAtPath(children: any[], parentPath: number[]): any[] {
    let current = children;
    for (const idx of parentPath) current = current[idx].children;
    return current;
}

/**
 * Worker から返ってきた LayerThumbEntry[] を PSD ツリーに注入し、
 * 新しい Psd オブジェクトを返す（イミュータブル）。
 *
 *   layer._bitmap — 描画用 + サムネイル用を兼ねるフルサイズ ImageBitmap
 *
 * layer オブジェクト自体を新しい参照に置き換えるため、
 * React.memo のキャッシュが正しく無効化されてサムネイルが再描画される。
 */
export function attachThumbs(psd: Psd, entries: LayerThumbEntry[]): Psd {
    const map = new Map(entries.map((e) => [e.key, e]));

    function walk(nodes: any[], parentPath: number[]): any[] {
        return nodes.map((layer, i) => {
            const key = [...parentPath, i].join('-');
            const entry = map.get(key);
            const next = entry
                ? { ...layer, _bitmap: entry.bitmap }
                : { ...layer };
            if (next.children?.length) {
                next.children = walk(next.children, [...parentPath, i]);
            }
            return next;
        });
    }

    return { ...psd, children: walk(psd.children ?? [], []) };
}

export function updateLayerByPath(
    psd: Psd,
    path: number[],
    update: (layer: any) => any,
): Psd {
    const newPsd = { ...psd };
    if (!newPsd.children) return newPsd;
    newPsd.children = [...newPsd.children];
    let current = newPsd.children;
    const pathCopy = [...path];
    const lastIdx = pathCopy.pop();
    if (lastIdx === undefined) return newPsd;
    for (const idx of pathCopy) {
        current[idx] = {
            ...current[idx],
            children: [...(current[idx].children || [])],
        };
        current = current[idx].children!;
    }
    current[lastIdx] = update(current[lastIdx]);
    return newPsd;
}

export function collectSearchResults(
    layers: any[],
    query: string,
    parentPath: number[] = [],
): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    layers.forEach((layer, idx) => {
        const rawName = layer.name || '';
        const displayName =
            rawName.startsWith('*') || rawName.startsWith('!')
                ? rawName.slice(1)
                : rawName;
        const matchStart = displayName.toLowerCase().indexOf(lowerQuery);
        if (matchStart !== -1)
            results.push({
                layer,
                path: [...parentPath, idx],
                displayName,
                matchStart,
                matchEnd: matchStart + lowerQuery.length,
            });
        if (layer.children?.length)
            results.push(
                ...collectSearchResults(layer.children, query, [
                    ...parentPath,
                    idx,
                ]),
            );
    });
    return results;
}

export function throttle<T extends (...args: any[]) => void>(
    fn: T,
    ms: number,
): T {
    let last = 0;
    return ((...args: any[]) => {
        const now = Date.now();
        if (now - last >= ms) {
            last = now;
            fn(...args);
        }
    }) as T;
}