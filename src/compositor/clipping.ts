import type { PsdLayerNode } from '../types';

/**
 * Returns the visible, non-clipping sibling that owns a clipping run.
 * Photoshop clips consecutive clipped layers to the nearest base layer in
 * the same parent; a group boundary is handled by the caller and is never
 * crossed here.
 */
export function findClippingBaseIndex(
    layers: PsdLayerNode[],
    index: number,
): number | null {
    if (!layers[index]?.clipping) return null;
    for (let i = index - 1; i >= 0; i--) {
        const candidate = layers[i];
        if (candidate.hidden) continue;
        if (candidate.clipping) continue;
        if (candidate.children?.length) return null;
        return i;
    }
    return null;
}

export interface ClippingRun {
    baseIndex: number;
    layerIndices: number[];
}

/** Partition one parent stack into deterministic clipping runs. */
export function collectClippingRuns(layers: PsdLayerNode[]): ClippingRun[] {
    const runs: ClippingRun[] = [];
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].hidden || layers[i].clipping) continue;
        const layerIndices: number[] = [];
        for (let j = i + 1; j < layers.length && layers[j].clipping; j++) {
            if (!layers[j].hidden) layerIndices.push(j);
        }
        if (layerIndices.length) runs.push({ baseIndex: i, layerIndices });
    }
    return runs;
}
