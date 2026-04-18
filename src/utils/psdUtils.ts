import { PsdLayerNode, SearchResult, PsdRoot } from '../types';

export interface LayerThumbEntry {
    key: string;
    bitmap: ImageBitmap | null;
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
 * Worker から返ってきた LayerThumbEntry[] を PSD ツリーに注入する。
 *
 * - bitmap が null のエントリは _bitmap をセットしない (undefined のまま)
 *   → drawCanvas / LayerThumbnail で「サムネなし」として正しく扱われる
 * - グループレイヤーは map に存在しないため { ...layer } のままになる
 * - children を持つレイヤーは再帰的に処理する
 */
export function attachThumbs(psd: PsdRoot, entries: LayerThumbEntry[]): PsdRoot {
    // bitmap が存在するエントリのみ map に登録
    // null エントリを map に入れると既存の _bitmap を null で上書きしてしまう
    const map = new Map<string, ImageBitmap>();
    for (const e of entries) {
        if (e.bitmap != null) {
            map.set(e.key, e.bitmap);
        }
    }

    function walk(nodes: PsdLayerNode[], parentPath: number[]): PsdLayerNode[] {
        return nodes.map((layer, i) => {
            const key = [...parentPath, i].join('-');
            const bitmap = map.get(key);

            // bitmap がある場合のみ _bitmap をセット、ない場合は既存を維持
            const next: PsdLayerNode = bitmap != null
                ? { ...layer, _bitmap: bitmap }
                : { ...layer };

            // children は再帰処理
            if (Array.isArray(next.children)) {
                next.children = walk(next.children, [...parentPath, i]);
            }

            return next;
        });
    }

    return { ...psd, children: walk(psd.children ?? [], []) };
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