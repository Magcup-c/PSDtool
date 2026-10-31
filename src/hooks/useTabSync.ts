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
    drawCanvas: (psd?: PsdRoot | null, force?: boolean) => void;
}

interface PendingRestore {
    /** どのタブへの切り替えで生成された pending か */
    tabId: string;
    zoom: number;
    scrollLeft: number;
    scrollTop: number;
    /** resetHistory に渡した psd（参照比較用） */
    psd: PsdRoot | null;
    /** psd が変化しない場合（null→null 等）に RAF で即フラッシュするフラグ */
    skipPsdWait: boolean;
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

    const pendingDrawRef = useRef<PendingRestore | null>(null);

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
        const nextPsd = nextTab.psd ?? null;
        resetHistory(nextPsd);
        setCurrentFilePath(nextTab.filePath);
        setFlipX(nextTab.flipX);
        setFlipY(nextTab.flipY);
        setClosedKeys(new Set(nextTab.closedKeys));
        setSearchQuery('');
        setZoomInputActive(false);
        isFirstLoadRef.current = true;

        // pending を記録。
        // skipPsdWait=true のケース: 現在の psd state と nextPsd が同一参照の場合、
        // useEffect([psd]) が発火しないため RAF で直接フラッシュする。
        // 典型例: 空タブ(null)→空タブ(null) の切り替え。
        const currentPsd = psd; // useLayoutEffect は同期なのでこの時点の値を使う
        pendingDrawRef.current = {
            tabId: activeId,
            zoom: nextTab.zoom,
            scrollLeft: nextTab.scrollLeft,
            scrollTop: nextTab.scrollTop,
            psd: nextPsd,
            skipPsdWait: currentPsd === nextPsd,
        };

        // psd が変化しない場合は useEffect([psd]) が発火しないので、
        // ここで RAF を即スケジュールしてフラッシュする
        if (currentPsd === nextPsd) {
            const rafId = requestAnimationFrame(() => {
                const pending = pendingDrawRef.current;
                // activeId がまだ同じタブを指しているか確認
                if (!pending || pending.tabId !== activeId || !pending.skipPsdWait) return;
                pendingDrawRef.current = null;

                applyZoom(pending.zoom);
                const el = scrollRef.current;
                if (el) {
                    el.scrollLeft = pending.scrollLeft;
                    el.scrollTop = pending.scrollTop;
                }
                if (pending.psd) {
                    drawCanvas(pending.psd, true);
                }
            });

            // cleanup: コンポーネントアンマウント時やさらに切り替えが起きた場合は
            // RAFをキャンセルして pending をクリア
            return () => {
                cancelAnimationFrame(rafId);
                // 同じタブの pending のみクリア（別タブへの切り替えが割り込んだ場合は触らない）
                if (pendingDrawRef.current?.tabId === activeId) {
                    pendingDrawRef.current = null;
                }
            };
        }
    }, [
        activeId, updateTab, resetHistory, layerDragCleanup,
        favoriteDragCleanupRef, setFavoriteDrop, renameSessionRef, renameTimerRef,
        isFirstLoadRef, setFlipX, setFlipY, scrollRef, setCurrentFilePath,
        setClosedKeys, setSearchQuery, setZoomInputActive,
        // psd は依存配列に含めない（useLayoutEffect は psd の変化に反応しない）
        // psd の現在値は outgoingUiRef 経由ではなく直接参照する
    ]);

    // ── psd の React state が更新されてから zoom/scroll/描画を適用 ─────────────
    //
    // resetHistory(nextPsd) を呼んだ後、React が setPsd(next) を処理して
    // 再レンダーが終わると psd が新しい値になる。
    // skipPsdWait=true のケースはすでに上の RAF で処理済みなので、
    // ここでは skipPsdWait=false（psd が変化する）ケースだけを扱う。
    useEffect(() => {
        const pending = pendingDrawRef.current;
        if (!pending) return;
        if (pending.skipPsdWait) return; // 上の RAF で処理済み

        // psd state が pending に記録した値と一致するまで待つ
        if (psd !== pending.psd) return;

        pendingDrawRef.current = null;

        const rafId = requestAnimationFrame(() => {
            applyZoom(pending.zoom);

            const el = scrollRef.current;
            if (el) {
                el.scrollLeft = pending.scrollLeft;
                el.scrollTop = pending.scrollTop;
            }

            if (pending.psd) {
                drawCanvas(pending.psd, true);
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [psd, applyZoom, scrollRef, drawCanvas]);
};
