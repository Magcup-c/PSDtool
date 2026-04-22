import { useLayoutEffect, useEffect, useRef } from 'react';
import { PsdRoot } from '../types';
import { TabState } from './useTabManager';

interface UseTabSyncProps {
    activeId: string;
    tabs: TabState[];
    updateTab: (id: string, state: Partial<TabState>) => void;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    canvasContainerRef: React.RefObject<HTMLDivElement | null>;
    zoom: number;
    flipX: boolean;
    flipY: boolean;
    closedKeys: Set<string>;
    resetHistory: (psd: PsdRoot | null) => void;
    setCurrentFilePath: (path: string | null) => void;
    setFlipX: (v: boolean) => void;
    setFlipY: (v: boolean) => void;
    setClosedKeys: (keys: Set<string>) => void;
    setSearchQuery: (q: string) => void;
    setZoomInputActive: (a: boolean) => void;
    applyZoom: (z: number) => void;
    isFirstLoadRef: React.MutableRefObject<boolean>;
    layerDragCleanup: () => void;
    favoriteDragCleanupRef: React.MutableRefObject<(() => void) | null>;
    setFavoriteDrop: (v: any) => void;
    renameSessionRef: React.MutableRefObject<boolean>;
    renameTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    psd: PsdRoot | null;
    /** タブ復元後に明示的にキャンバスを再描画するコールバック */
    drawCanvas: (psd?: PsdRoot) => void;
}

export const useTabSync = ({
    activeId, tabs, updateTab, scrollRef, zoom, flipX, flipY, closedKeys,
    resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
    setSearchQuery, setZoomInputActive, applyZoom, isFirstLoadRef,
    layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
    renameSessionRef, renameTimerRef, psd, drawCanvas,
}: UseTabSyncProps) => {
    const prevActiveIdRef = useRef<string>(activeId);
    const outgoingUiRef = useRef({ zoom, flipX, flipY, closedKeys: Array.from(closedKeys) });

    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    // タブ切り替え後に psd が DOM に現れてから適用する zoom/scroll/psd を保持する
    const pendingRestoreRef = useRef<{
        zoom: number;
        scrollLeft: number;
        scrollTop: number;
        psd: PsdRoot | null;
    } | null>(null);

    outgoingUiRef.current = { zoom, flipX, flipY, closedKeys: Array.from(closedKeys) };

    // ── タブ切り替え検出 ──────────────────────────────────────────────────────
    useLayoutEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;

        // 退出するタブのUI状態を保存
        const { zoom: z, flipX: fx, flipY: fy, closedKeys: ck } = outgoingUiRef.current;
        updateTab(prevId, {
            zoom: z, flipX: fx, flipY: fy, closedKeys: ck,
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop: scrollRef.current?.scrollTop ?? 0,
        });

        prevActiveIdRef.current = activeId;

        const nextTab = tabsRef.current.find(t => t.id === activeId);
        if (!nextTab) return;

        // ドラッグ中状態をリセット
        layerDragCleanup();
        if (favoriteDragCleanupRef.current) {
            favoriteDragCleanupRef.current();
            favoriteDragCleanupRef.current = null;
            setFavoriteDrop(null);
        }

        // リネームセッションをリセット
        renameSessionRef.current = false;
        if (renameTimerRef.current) {
            clearTimeout(renameTimerRef.current);
            renameTimerRef.current = null;
        }

        // psd・flip・closedKeys などを即時復元
        resetHistory(nextTab.psd ?? null);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        setSearchQuery('');
        setZoomInputActive(false);
        isFirstLoadRef.current = true;

        // zoom と scroll は psd state が確定してからの useEffect で適用する
        // psdも一緒に保持して drawCanvas に渡せるようにする
        pendingRestoreRef.current = {
            zoom: nextTab.zoom,
            scrollLeft: nextTab.scrollLeft,
            scrollTop: nextTab.scrollTop,
            psd: nextTab.psd ?? null,
        };
    }, [
        activeId, updateTab, resetHistory, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
    ]);

    // ── psd が確定してDOMが更新された後に zoom/scroll/描画 を適用 ─────────────
    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending) return;
        pendingRestoreRef.current = null;

        // RAF で1フレーム待ってから適用することで
        // psd の width/height が canvasContainerRef のスタイルに反映された後に
        // applyZoom、scroll、drawCanvas が正しく動作する
        const raf = requestAnimationFrame(() => {
            applyZoom(pending.zoom);
            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop = pending.scrollTop;
            }
            // 明示的に再描画: psd参照が同一オブジェクトの場合でも確実に描画する
            if (pending.psd) {
                drawCanvas(pending.psd);
            }
        });
        return () => cancelAnimationFrame(raf);
        // psd を依存に入れることで resetHistory → setPsd → re-render の後に必ず発火する
    }, [psd, applyZoom, scrollRef, drawCanvas]);
};