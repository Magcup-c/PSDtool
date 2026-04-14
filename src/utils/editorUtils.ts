import { PsdLayerNode } from '../types';
import { LayerStateNode } from '../hooks/useLayerFavorites';

export function captureLayerState(layers: PsdLayerNode[]): LayerStateNode[] {
    return layers.map(layer => ({
        hidden: !!layer.hidden,
        children: layer.children?.length ? captureLayerState(layer.children) : undefined,
    }));
}

export function applyLayerState(layers: PsdLayerNode[], state: LayerStateNode[] | undefined): PsdLayerNode[] {
    return layers.map((layer, idx) => {
        const node = state?.[idx];
        const isLocked = (layer.name || '').startsWith('!');
        const next: PsdLayerNode = { ...layer };
        if (node && typeof node.hidden === 'boolean' && !isLocked) next.hidden = node.hidden;
        if (layer.children?.length) next.children = applyLayerState(layer.children, node?.children);
        return next;
    });
}

export function formatFavoriteTime(ts: number, lang: 'ja' | 'en') {
    try {
        return new Date(ts).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
    } catch { return ''; }
}
