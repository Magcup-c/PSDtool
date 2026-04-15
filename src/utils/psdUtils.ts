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

import { PsdLayerNode, SearchResult, PsdRoot } from '../types';

export interface LayerThumbEntry {
    key: string;
    bitmap: ImageBitmap;
    left: number;
    top: number;
}

export function getLayersAtPath(children: PsdLayerNode[], parentPath: number[]): PsdLayerNode[] {
    let current = children;
    for (const idx of parentPath) {
        if (!current[idx].children) return current;
        current = current[idx].children!;
    }
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
export function attachThumbs(psd: PsdRoot, entries: LayerThumbEntry[]): PsdRoot {
    const map = new Map(entries.map((e) => [e.key, e]));

    function walk(nodes: PsdLayerNode[], parentPath: number[]): PsdLayerNode[] {
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

    return { ...psd, children: walk(psd.children ?? [], []) } as any;
}

export function updateLayerByPath(
    psd: PsdRoot,
    path: number[],
    update: (layer: PsdLayerNode) => PsdLayerNode,
): PsdRoot {
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
    layers: PsdLayerNode[],
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

/**
 * PSDツリー内にある全ての ImageBitmap を収集する。
 */
export function collectBitmaps(psd: PsdRoot | null): Set<ImageBitmap> {
    const bitmaps = new Set<ImageBitmap>();
    if (!psd) return bitmaps;

    function walk(nodes: PsdLayerNode[]) {
        for (const node of nodes) {
            if (node._bitmap) bitmaps.add(node._bitmap);
            if (node.children) walk(node.children);
        }
    }
    if (psd.children) walk(psd.children);
    return bitmaps;
}

/**
 * 指定したビットマップ集合を全て close() する。
 */
export function closeBitmaps(bitmaps: Iterable<ImageBitmap>) {
    for (const b of bitmaps) {
        try {
            b.close();
        } catch (e) {
            console.warn('Failed to close ImageBitmap:', e);
        }
    }
}