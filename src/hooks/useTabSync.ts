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
}

export const useTabSync = ({
    activeId, tabs, updateTab, scrollRef, zoom, flipX, flipY, closedKeys,
    resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
    setSearchQuery, setZoomInputActive, applyZoom, isFirstLoadRef,
    layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
    renameSessionRef, renameTimerRef, psd,
}: UseTabSyncProps) => {
    const prevActiveIdRef = useRef<string>(activeId);
    const outgoingUiRef = useRef({ zoom, flipX, flipY, closedKeys: Array.from(closedKeys) });

    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    // タブ切り替え後に適用する zoom/scroll を保持
    const pendingRestoreRef = useRef<{
        zoom: number;
        scrollLeft: number;
        scrollTop: number;
    } | null>(null);

    // 毎レンダーで最新の UI 状態を ref に同期
    outgoingUiRef.current = { zoom, flipX, flipY, closedKeys: Array.from(closedKeys) };

    // ── タブ切り替え検出 ──────────────────────────────────────────────────────
    useLayoutEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;

        // 退出するタブの UI 状態を保存
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

        // ★ psd・flip・closedKeys などを即時復元
        // resetHistory → setPsd(nextTab.psd) → psd state 変化
        // → useEditorCanvas の useEffect が発火 → drawCanvas(psd) が自動で呼ばれる
        resetHistory(nextTab.psd ?? null);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        setSearchQuery('');
        setZoomInputActive(false);
        isFirstLoadRef.current = true;

        // zoom と scroll は psd の DOM 反映後に適用する
        pendingRestoreRef.current = {
            zoom: nextTab.zoom,
            scrollLeft: nextTab.scrollLeft,
            scrollTop: nextTab.scrollTop,
        };
    }, [
        activeId, updateTab, resetHistory, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
    ]);

    // ── psd が確定して DOM が更新された後に zoom/scroll を適用 ──────────────
    // psd を依存に入れることで resetHistory → setPsd → re-render の後に必ず発火する。
    // このタイミングで canvasContainerRef のサイズも新しい psd の width/height に
    // 更新されているため applyZoom が正しく動作する。
    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending) return;
        pendingRestoreRef.current = null;

        // RAF で1フレーム待つことで PreviewArea の style 更新後に実行される
        const raf = requestAnimationFrame(() => {
            applyZoom(pending.zoom);
            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop = pending.scrollTop;
            }
        });
        return () => cancelAnimationFrame(raf);
    }, [psd, applyZoom, scrollRef]);
};