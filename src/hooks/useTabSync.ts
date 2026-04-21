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
    activeId, tabs, updateTab, scrollRef, canvasContainerRef, zoom, flipX, flipY, closedKeys,
    resetHistory, setCurrentFilePath, setFlipX, setFlipY, setClosedKeys,
    setSearchQuery, setZoomInputActive, applyZoom, isFirstLoadRef,
    layerDragCleanup, favoriteDragCleanupRef, setFavoriteDrop,
    renameSessionRef, renameTimerRef, psd,
}: UseTabSyncProps) => {
    const prevActiveIdRef = useRef<string>(activeId);
    const outgoingUiRef = useRef({ zoom, flipX, flipY, closedKeys: Array.from(closedKeys) });

    // タブ切り替え後に psd が DOM に現れてから適用する zoom/scroll を保持する
    const pendingRestoreRef = useRef<{
        zoom: number;
        scrollLeft: number;
        scrollTop: number;
    } | null>(null);

    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

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
            scrollTop:  scrollRef.current?.scrollTop  ?? 0,
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

        // zoom と scroll は canvasContainerRef が DOM に現れた後に適用する必要があるため
        // pending に積んでおき、psd state 確定後の useEffect で処理する
        pendingRestoreRef.current = {
            zoom: nextTab.zoom,
            scrollLeft: nextTab.scrollLeft,
            scrollTop:  nextTab.scrollTop,
        };
    }, [
        activeId, updateTab, resetHistory, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
    ]);

    // ── psd が確定して DOM が更新された後に zoom/scroll を適用 ──────────────
    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending) return;
        pendingRestoreRef.current = null;

        const apply = () => {
            applyZoom(pending.zoom);
            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop  = pending.scrollTop;
            }
        };

        // canvasContainerRef が既に DOM にある（psd あり）→ 即時適用
        if (canvasContainerRef.current) {
            apply();
        } else {
            // psd=null の空タブや、React の state 更新が次フレームになる場合は
            // RAF で1フレーム待ってから適用する
            const raf = requestAnimationFrame(apply);
            return () => cancelAnimationFrame(raf);
        }
    // psd を依存に入れることで、resetHistory → setPsd → re-render の後に必ず発火する
    }, [psd, applyZoom, scrollRef, canvasContainerRef]);
};