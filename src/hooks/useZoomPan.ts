import { useState, useRef, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Psd } from 'ag-psd';

const SCROLL_AREA = 16000;

function canvasOrigin(psd: Psd) {
    return {
        x: SCROLL_AREA / 2 - psd.width  / 2,
        y: SCROLL_AREA / 2 - psd.height / 2,
    };
}

export function useZoomPan(
    psdRef: React.MutableRefObject<Psd | null>,
    scrollRef: React.RefObject<HTMLDivElement | null>,
    canvasContainerRef: React.RefObject<HTMLDivElement | null>,
) {
    // zoom state は UI 表示（%インジケーター）専用。
    // 実際の transform は canvasContainerRef を直接操作して管理する。
    // → React render と DOM 操作の競合を防ぐ。
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);

    // キャンバス外の「何もない領域」へスクロールできないようにする
    const PADDING = 200;

    const isClampingRef = useRef(false);
    const ignoreScrollUntilRef = useRef(0);
    const isPanningRef = useRef(false);
    const scrollClampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeInputUntilRef = useRef(0);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

    const getScrollability = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return { canScrollX: false, canScrollY: false };
        const scaledWidth = psd.width * z;
        const scaledHeight = psd.height * z;
        const canScrollX = scaledWidth - el.clientWidth > 1;
        const canScrollY = scaledHeight - el.clientHeight > 1;
        return { canScrollX, canScrollY };
    }, [psdRef]);

    const clampScroll = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return;
        const { x: ox, y: oy } = canvasOrigin(psd);
        
        // ズームされたキャンバスのサイズ
        const scaledWidth = psd.width * z;
        const scaledHeight = psd.height * z;
        
        // キャンバスの視覚的な左上座標
        const canvasVisualLeft = ox;
        const canvasVisualTop = oy;
        const canvasVisualRight = canvasVisualLeft + scaledWidth;
        const canvasVisualBottom = canvasVisualTop + scaledHeight;
        
        // スクロール範囲の計算
        const scrollableWidth = scaledWidth - el.clientWidth;
        const scrollableHeight = scaledHeight - el.clientHeight;
        
        let targetScrollLeft = el.scrollLeft;
        let targetScrollTop = el.scrollTop;
        
        if (scrollableWidth <= 0) {
            // キャンバスがビューポートより小さい場合は中央に配置
            targetScrollLeft = canvasVisualLeft + scaledWidth / 2 - el.clientWidth / 2;
        } else {
            // スクロール可能な場合は範囲内に収める
            const minL = canvasVisualLeft - PADDING;
            const maxL = canvasVisualRight - el.clientWidth + PADDING;
            targetScrollLeft = Math.min(Math.max(minL, el.scrollLeft), maxL);
        }
        
        if (scrollableHeight <= 0) {
            // 同様に垂直方向も中央に配置
            targetScrollTop = canvasVisualTop + scaledHeight / 2 - el.clientHeight / 2;
        } else {
            const minT = canvasVisualTop - PADDING;
            const maxT = canvasVisualBottom - el.clientHeight + PADDING;
            targetScrollTop = Math.min(Math.max(minT, el.scrollTop), maxT);
        }
        
        const EPS = 0.5;
        const nextLeft = targetScrollLeft;
        const nextTop = targetScrollTop;
        let changed = false;
        if (Math.abs(nextLeft - el.scrollLeft) > EPS) {
            el.scrollLeft = nextLeft;
            changed = true;
        }
        if (Math.abs(nextTop - el.scrollTop) > EPS) {
            el.scrollTop = nextTop;
            changed = true;
        }
        if (changed) ignoreScrollUntilRef.current = performance.now() + 80;
    }, [psdRef]);

    // DOM への transform 書き込みと React state 更新を分離。
    // canvasContainerRef.current.style.transform が「実際のズーム」。
    // setZoom は表示用 (% インジケーター) のみ。
    const applyZoom = useCallback((nextZoom: number) => {
        zoomRef.current = nextZoom;
        if (canvasContainerRef.current) {
            canvasContainerRef.current.style.transform = `scale(${nextZoom})`;
        }
        setZoom(nextZoom);
    }, [canvasContainerRef]);

    // アンカー点を固定したままズームするスクロール計算。
    // transform-origin: top left のため、キャンバス左上は常に (ox, oy)。
    // アンカー固定条件: scrollLeft = ox + canvasX * z - anchorViewX
    const zoomAround = useCallback((
        el: HTMLDivElement,
        zoomOld: number,
        zoomNew: number,
        anchorViewX: number,
        anchorViewY: number,
    ) => {
        const psd = psdRef.current;
        if (!psd) return;
        const { x: ox, y: oy } = canvasOrigin(psd);

        // アンカーが指すキャンバス論理座標
        const canvasX = (el.scrollLeft + anchorViewX - ox) / zoomOld;
        const canvasY = (el.scrollTop  + anchorViewY - oy) / zoomOld;

        // ズーム適用（DOM直接操作）
        applyZoom(zoomNew);

        // ズーム後のスクロール位置（アンカー固定）
        // 計算結果を一度クランプして妥当な値にする
        const rawScrollLeft = ox + canvasX * zoomNew - anchorViewX;
        const rawScrollTop = oy + canvasY * zoomNew - anchorViewY;
        
        el.scrollLeft = rawScrollLeft;
        el.scrollTop = rawScrollTop;
        
        // 次のフレームでクランプを適用（レイアウトが確定した後）
        requestAnimationFrame(() => clampScroll(el, zoomNew));
    }, [psdRef, applyZoom, clampScroll]);

    // transform-origin: top left で z のとき、
    // キャンバスの視覚的中心 = ox + w*z/2
    // scrollLeft = ox + w*z/2 - clientWidth/2
    const centerPsd = useCallback(() => {
        const el = scrollRef.current;
        const psd = psdRef.current;
        if (!el || !psd) return;
        // clientWidth が 0 の場合でもスクロール位置を設定（後で調整される）
        const z = zoomRef.current;
        const { x: ox, y: oy } = canvasOrigin(psd);
        el.scrollLeft = ox + psd.width  * z / 2 - (el.clientWidth  > 0 ? el.clientWidth  / 2 : 0);
        el.scrollTop  = oy + psd.height * z / 2 - (el.clientHeight > 0 ? el.clientHeight / 2 : 0);
    }, [scrollRef, psdRef]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const handlePointerMove = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect();
            lastPointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const normalizeDelta = (e: WheelEvent, v: number) => {
            if (e.deltaMode === 1) return v * 16;
            if (e.deltaMode === 2) return v * 400;
            return v;
        };

        const handleWheel = (e: WheelEvent) => {
            if (performance.now() < nativeInputUntilRef.current) return;
            const deltaY = normalizeDelta(e, e.deltaY);
            const deltaX = normalizeDelta(e, e.deltaX);
            if (!e.ctrlKey && !e.metaKey) {
                // ネイティブスクロール（慣性）を止めて、手動でピタッと止める
                e.preventDefault();
                if (deltaX !== 0) el.scrollLeft += deltaX;
                if (deltaY !== 0) el.scrollTop += deltaY;
                clampScroll(el, zoomRef.current);
                return;
            }

            e.preventDefault();
            const sensitivity = 0.015;
            const zoomOld = zoomRef.current;
            const clampedDelta = Math.max(-20, Math.min(20, deltaY));
            const zoomNew = Math.min(5, Math.max(0.1,
                zoomOld * Math.exp(-clampedDelta * sensitivity)
            ));
            if (Math.abs(zoomNew - zoomOld) < 0.0005) return;
            const rect = el.getBoundingClientRect();
            const anchor =
                (e.clientX !== 0 || e.clientY !== 0)
                    ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
                    : (lastPointerRef.current ?? { x: rect.width / 2, y: rect.height / 2 });
            zoomAround(el, zoomOld, zoomNew, anchor.x, anchor.y);
        };

        const handleWheelCapture = (e: WheelEvent) => {
            if (!el.contains(e.target as Node)) return;
            handleWheel(e);
        };

        el.addEventListener('pointermove', handlePointerMove, { passive: true });
        window.addEventListener('wheel', handleWheelCapture, { passive: false, capture: true });
        return () => {
            el.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('wheel', handleWheelCapture, { capture: true } as AddEventListenerOptions);
        };
    }, [scrollRef, zoomAround, clampScroll]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;
        const setup = async () => {
            unlisten = await listen<{ kind: 'zoom'; scale: number; x: number; y: number } | { kind: 'pan'; dx: number; dy: number }>(
                'native-gesture',
                (event) => {
                    const el = scrollRef.current;
                    if (!el) return;
                    nativeInputUntilRef.current = performance.now() + 120;
                    const payload = event.payload;
                    if (!payload || typeof payload !== 'object') return;
                    if (payload.kind === 'zoom') {
                        const zoomOld = zoomRef.current;
                        const zoomNew = Math.max(0.1, Math.min(5, zoomOld * payload.scale));
                        if (Math.abs(zoomNew - zoomOld) < 0.0005) return;
                        zoomAround(el, zoomOld, zoomNew, payload.x, payload.y);
                        return;
                    }
                    if (payload.kind === 'pan') {
                        if (payload.dx !== 0) el.scrollLeft -= payload.dx;
                        if (payload.dy !== 0) el.scrollTop -= payload.dy;
                        clampScroll(el, zoomRef.current);
                    }
                }
            );
        };
        setup();
        return () => {
            if (unlisten) unlisten();
        };
    }, [scrollRef, zoomAround, clampScroll]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onScroll = () => {
            if (isPanningRef.current) return;
            if (performance.now() < ignoreScrollUntilRef.current) return;
            if (scrollClampTimerRef.current) clearTimeout(scrollClampTimerRef.current);
            scrollClampTimerRef.current = setTimeout(() => {
                if (performance.now() < ignoreScrollUntilRef.current) return;
                if (isClampingRef.current) return;
                isClampingRef.current = true;
                requestAnimationFrame(() => {
                    clampScroll(el, zoomRef.current);
                    isClampingRef.current = false;
                });
            }, 50);
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            el.removeEventListener('scroll', onScroll);
            if (scrollClampTimerRef.current) clearTimeout(scrollClampTimerRef.current);
        };
    }, [scrollRef, clampScroll]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onResize = () => clampScroll(el, zoomRef.current);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [scrollRef, clampScroll]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        let dragging = false, lastX = 0, lastY = 0;
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 && e.button !== 1) return;
            dragging = true; lastX = e.clientX; lastY = e.clientY;
            isPanningRef.current = true;
            el.style.cursor = 'grabbing'; e.preventDefault();
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            const { canScrollX, canScrollY } = getScrollability(el, zoomRef.current);
            if (!canScrollX && !canScrollY) return;
            el.scrollLeft -= e.clientX - lastX;
            el.scrollTop  -= e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            clampScroll(el, zoomRef.current);
        };
        const onMouseUp = () => { dragging = false; isPanningRef.current = false; el.style.cursor = ''; };
        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [scrollRef, clampScroll, getScrollability]);

    const handleZoom = useCallback((delta: number) => {
        const el = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, Math.round((zoomOld + delta) * 100) / 100));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
    }, [scrollRef, zoomAround]);

    const setZoomTo = useCallback((nextZoom: number) => {
        const el = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, nextZoom));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
    }, [scrollRef, zoomAround]);

    const resetZoom = useCallback(() => {
        applyZoom(1);
        requestAnimationFrame(() => centerPsd());
    }, [applyZoom, centerPsd]);

    return { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, SCROLL_AREA };
}
