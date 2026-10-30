import { PsdLayerNode, SearchResult, PsdRoot } from '../types';

// 旧workerに合わせた型: bitmap は必ず ImageBitmap（null なし）
export interface LayerThumbEntry {
    key: string;
    bitmap: ImageBitmap;
    left: number;
    top: number;
    kind?: 'layer' | 'mask';
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
 */
export function attachThumbs(psd: PsdRoot, entries: LayerThumbEntry[]): PsdRoot {
    const map = new Map<string, ImageBitmap>();
    for (const e of entries) {
        map.set(`${e.kind === 'mask' ? 'mask:' : ''}${e.key}`, e.bitmap);
    }

    function walk(nodes: PsdLayerNode[], parentPath: number[]): PsdLayerNode[] {
        return nodes.map((layer, i) => {
            const key = [...parentPath, i].join('-');
            const bitmap = map.get(key);
            const maskBitmap = map.get(`mask:${key}`);

            const next: PsdLayerNode = {
                ...layer,
                ...(bitmap != null ? { _bitmap: bitmap } : {}),
                ...(maskBitmap != null && layer.mask
                    ? { mask: { ...layer.mask, _maskBitmap: maskBitmap } }
                    : {}),
            };

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

export function closeBitmaps(bitmaps: Iterable<ImageBitmap>) {
    for (const b of bitmaps) {
        try {
            b.close();
        } catch (e) {
            console.warn('Failed to close ImageBitmap:', e);
        }
    }
}
