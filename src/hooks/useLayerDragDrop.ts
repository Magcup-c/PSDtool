import { useState, useRef, useCallback, RefObject } from 'react';
import { DropTargetInfo, PsdRoot } from '../types';
import { moveLayer } from '../utils/psdTreeOps';
import { throttle } from '../utils/psdUtils';

export function useLayerDragDrop(
    layerScrollRef: RefObject<HTMLDivElement | null>,
    psdRef: React.MutableRefObject<PsdRoot | null>,
    commitPsd: (next: PsdRoot) => void,
    markDirty: () => void,
) {
    const [draggingPath, setDraggingPath] = useState<number[] | null>(null);
    const [dropTarget, setDropTarget]     = useState<DropTargetInfo | null>(null);

    const dragStateRef = useRef<{ path: number[]; startY: number; moved: boolean } | null>(null);
    const itemRectsRef = useRef<{ rect: DOMRect; path: number[]; isGroup: boolean }[]>([]);
    const layerDragCleanupRef = useRef<(() => void) | null>(null);

    const cacheItemRects = useCallback(() => {
        const scroll = layerScrollRef.current; if (!scroll) return;
        const items  = Array.from(scroll.querySelectorAll<HTMLElement>('[data-path]'));
        itemRectsRef.current = items.map(el => ({
            rect: el.getBoundingClientRect(),
            path: (el.getAttribute('data-path') ?? '').split('-').map(Number),
            isGroup: el.getAttribute('data-group') === 'true',
        }));
    }, [layerScrollRef]);

    const findDropTargetFromCache = useCallback((clientY: number) => {
        const items = itemRectsRef.current; if (!items.length) return null;
        let best: { path: number[]; position: DropTargetInfo['position']; dist: number } | null = null;
        for (const { rect, path, isGroup } of items) {
            const zone = rect.height * 0.25;
            let position: DropTargetInfo['position'], dist: number;
            if (clientY < rect.top + zone)         { position = 'before'; dist = Math.abs(clientY - rect.top); }
            else if (clientY > rect.bottom - zone) { position = 'after';  dist = Math.abs(clientY - rect.bottom); }
            else if (isGroup)                      { position = 'inside'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            else { position = clientY < rect.top + rect.height / 2 ? 'before' : 'after'; dist = Math.abs(clientY - (rect.top + rect.height / 2)); }
            if (!best || dist < best.dist) best = { path, position, dist };
        }
        return best ? { path: best.path, position: best.position } as DropTargetInfo : null;
    }, []);

    const cleanupDrag = useCallback(() => {
        if (layerDragCleanupRef.current) {
            layerDragCleanupRef.current();
            layerDragCleanupRef.current = null;
        }
        setDraggingPath(null);
        setDropTarget(null);
        dragStateRef.current = null;
    }, []);

    const handleLayerDragStart = useCallback((e: React.MouseEvent, path: number[]) => {
        e.preventDefault(); e.stopPropagation();
        dragStateRef.current = { path, startY: e.clientY, moved: false };
        setDraggingPath(path); cacheItemRects();
        const throttledMove = throttle((ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (target) {
                const dragKey   = dragStateRef.current.path.join('-');
                const targetKey = target.path.join('-');
                if (targetKey !== dragKey && !targetKey.startsWith(dragKey + '-')) { setDropTarget(target); return; }
            }
            setDropTarget(null);
        }, 32);
        const onMouseMove = (ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            if (Math.abs(ev.clientY - dragStateRef.current.startY) > 3) dragStateRef.current.moved = true;
            throttledMove(ev);
        };
        const onMouseUp = (ev: MouseEvent) => {
            const state = dragStateRef.current;
            cleanupDrag();
            if (!state?.moved) return;
            const target = findDropTargetFromCache(ev.clientY);
            if (!target) return;
            const dragKey   = state.path.join('-');
            const targetKey = target.path.join('-');
            if (targetKey === dragKey || targetKey.startsWith(dragKey + '-')) return;
            if (!psdRef.current) return;
            const nextPsd = moveLayer(psdRef.current, state.path, target.path, target.position);
            if (nextPsd) { commitPsd(nextPsd); markDirty(); }
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        layerDragCleanupRef.current = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [cacheItemRects, findDropTargetFromCache, psdRef, commitPsd, markDirty, cleanupDrag]);

    return {
        draggingPath,
        dropTarget,
        handleLayerDragStart,
        cleanupDrag,
    };
}
