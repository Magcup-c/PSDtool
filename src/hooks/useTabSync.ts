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
    drawCanvas: (psd?: PsdRoot | null) => void;
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

    // 復元すべき情報を保持
    const pendingDrawRef = useRef<{
        zoom: number;
        scrollLeft: number;
        scrollTop: number;
        psd: PsdRoot | null;
    } | null>(null);

    // 常に最新の ui 値を保持
    outgoingUiRef.current = { zoom, flipX, flipY, closedKeys: Array.from(closedKeys) };

    // ── タブ切り替え検出 ──────────────────────────────────────────────────────
    useLayoutEffect(() => {
        const prevId = prevActiveIdRef.current;
        if (prevId === activeId) return;

        // 退出タブの UI 状態を保存
        const { zoom: z, flipX: fx, flipY: fy, closedKeys: ck } = outgoingUiRef.current;
        updateTab(prevId, {
            zoom: z, flipX: fx, flipY: fy, closedKeys: ck,
            scrollLeft: scrollRef.current?.scrollLeft ?? 0,
            scrollTop: scrollRef.current?.scrollTop ?? 0,
        });

        prevActiveIdRef.current = activeId;

        const nextTab = tabsRef.current.find(t => t.id === activeId);
        if (!nextTab) return;

        // ドラッグ・リネームのリセット
        layerDragCleanup();
        if (favoriteDragCleanupRef.current) {
            favoriteDragCleanupRef.current();
            favoriteDragCleanupRef.current = null;
            setFavoriteDrop(null);
        }
        renameSessionRef.current = false;
        if (renameTimerRef.current) {
            clearTimeout(renameTimerRef.current);
            renameTimerRef.current = null;
        }

        // 次タブの状態を復元
        resetHistory(nextTab.psd ?? null);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        setSearchQuery('');
        setZoomInputActive(false);
        isFirstLoadRef.current = true;

        // zoom/scroll/描画の復元情報を記録
        pendingDrawRef.current = {
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

    // ── psd の React state が更新されてから zoom/scroll/描画を適用 ─────────────
    //
    // resetHistory(nextTab.psd) を呼んだ後、React が setPsd(next) を処理して
    // 再レンダーが終わると psd が新しい値になる。
    // その時点でこの useEffect が発火するので、ここで描画を行う。
    //
    // 依存配列に psd だけを入れることで「psd が変わったら必ず1回実行」になる。
    useEffect(() => {
        const pending = pendingDrawRef.current;
        if (!pending) return;

        // psd state が pending に記録した値と一致するまで待つ。
        // null 同士の場合（空タブへの切り替え）は即実行。
        if (psd !== pending.psd) return;

        pendingDrawRef.current = null;

        // RAF でレイアウト確定後に実行
        const rafId = requestAnimationFrame(() => {
            applyZoom(pending.zoom);

            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop = pending.scrollTop;
            }

            // psd があれば強制再描画（useEditorCanvas の useEffect だけでは
            // タイミングによって描画がスキップされることがあるため）
            if (pending.psd) {
                drawCanvas(pending.psd);
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [psd, applyZoom, scrollRef, drawCanvas]);
};