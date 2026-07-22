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
    scrollAction: 'zoom' | 'pan' = 'pan'
) {
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);

    const PADDING = 200;

    const isClampingRef         = useRef(false);
    const ignoreScrollUntilRef  = useRef(0);
    const isPanningRef          = useRef(false);
    const scrollClampTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeInputUntilRef   = useRef(0);
    const lastPointerRef        = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        return () => {
            if (scrollClampTimerRef.current) {
                clearTimeout(scrollClampTimerRef.current);
                scrollClampTimerRef.current = null;
            }
        };
    }, []);

    const getScrollability = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return { canScrollX: false, canScrollY: false };
        const scaledWidth  = psd.width  * z;
        const scaledHeight = psd.height * z;
        return {
            canScrollX: scaledWidth  - el.clientWidth  > 1,
            canScrollY: scaledHeight - el.clientHeight > 1,
        };
    }, [psdRef]);

    const clampScroll = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return;
        const { x: ox, y: oy } = canvasOrigin(psd);

        const scaledWidth  = psd.width  * z;
        const scaledHeight = psd.height * z;

        const canvasVisualLeft   = ox;
        const canvasVisualTop    = oy;
        const canvasVisualRight  = ox + scaledWidth;
        const canvasVisualBottom = oy + scaledHeight;

        const scrollableWidth  = scaledWidth  - el.clientWidth;
        const scrollableHeight = scaledHeight - el.clientHeight;

        let targetScrollLeft = el.scrollLeft;
        let targetScrollTop  = el.scrollTop;

        if (scrollableWidth <= 0) {
            targetScrollLeft = canvasVisualLeft + scaledWidth / 2 - el.clientWidth / 2;
        } else {
            targetScrollLeft = Math.min(
                Math.max(canvasVisualLeft - PADDING, el.scrollLeft),
                canvasVisualRight - el.clientWidth + PADDING,
            );
        }

        if (scrollableHeight <= 0) {
            targetScrollTop = canvasVisualTop + scaledHeight / 2 - el.clientHeight / 2;
        } else {
            targetScrollTop = Math.min(
                Math.max(canvasVisualTop - PADDING, el.scrollTop),
                canvasVisualBottom - el.clientHeight + PADDING,
            );
        }

        const EPS = 0.5;
        let changed = false;
        if (Math.abs(targetScrollLeft - el.scrollLeft) > EPS) { el.scrollLeft = targetScrollLeft; changed = true; }
        if (Math.abs(targetScrollTop  - el.scrollTop)  > EPS) { el.scrollTop  = targetScrollTop;  changed = true; }
        if (changed) ignoreScrollUntilRef.current = performance.now() + 80;
    }, [psdRef]);

    // ★ 外部から直接 zoom の transform だけを適用する（scroll 位置は変えない）
    const applyZoom = useCallback((nextZoom: number) => {
        zoomRef.current = nextZoom;
        if (canvasContainerRef.current) {
            canvasContainerRef.current.style.transform = `scale(${nextZoom})`;
        }
        setZoom(nextZoom);
    }, [canvasContainerRef]);

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

        const canvasX = (el.scrollLeft + anchorViewX - ox) / zoomOld;
        const canvasY = (el.scrollTop  + anchorViewY - oy) / zoomOld;

        applyZoom(zoomNew);

        el.scrollLeft = ox + canvasX * zoomNew - anchorViewX;
        el.scrollTop  = oy + canvasY * zoomNew - anchorViewY;

        requestAnimationFrame(() => clampScroll(el, zoomNew));
    }, [psdRef, applyZoom, clampScroll]);

    const centerPsd = useCallback(() => {
        const el  = scrollRef.current;
        const psd = psdRef.current;
        if (!el || !psd) return;
        const z = zoomRef.current;
        const { x: ox, y: oy } = canvasOrigin(psd);
        el.scrollLeft = ox + psd.width  * z / 2 - (el.clientWidth  > 0 ? el.clientWidth  / 2 : 0);
        el.scrollTop  = oy + psd.height * z / 2 - (el.clientHeight > 0 ? el.clientHeight / 2 : 0);
    }, [scrollRef, psdRef]);

    // ── ホイール / ジェスチャー ────────────────────────────────────────────────

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
            const ctrlLike  = e.ctrlKey || e.metaKey;
            const shiftLike = e.shiftKey;

           // scrollAction === 'zoom' (拡大・縮小モード / 標準):
            //   ホイール単体      → 拡大縮小 (Zoom)
            //   Ctrl + ホイール   → 上下移動 (Pan Y)
            //   Shift + ホイール  → 左右移動 (Pan X)
            //
            // scrollAction === 'pan' (上下移動モード / Photoshop風):
            //   ホイール単体      → 上下移動 (Pan Y)
            //   Shift + ホイール  → 左右移動 (Pan X)
            //   Ctrl + ホイール   → 拡大縮小 (Zoom)
            const isZoomIntent = scrollAction === 'zoom'
                ? (!ctrlLike && !shiftLike)
               : ctrlLike;

            if (!isZoomIntent) {
                e.preventDefault();

                if (scrollAction === 'zoom') {
                    if (ctrlLike) {
                        el.scrollTop += deltaY;
                    } else if (shiftLike) {
                        el.scrollLeft += (deltaX !== 0 ? deltaX : deltaY);
                    }
                } else {
                    if (shiftLike) {
                        el.scrollLeft += (deltaX !== 0 ? deltaX : deltaY);
                    } else {
                        if (deltaY !== 0) el.scrollTop  += deltaY;
                        if (deltaX !== 0) el.scrollLeft += deltaX;
                    }
                }

                clampScroll(el, zoomRef.current);
                return;
            }

            e.preventDefault();
            const zoomOld     = zoomRef.current;
            const clamped     = Math.max(-20, Math.min(20, deltaY));
            const zoomNew     = Math.min(5, Math.max(0.1, zoomOld * Math.exp(-clamped * 0.015)));
            if (Math.abs(zoomNew - zoomOld) < 0.0005) return;

            const rect   = el.getBoundingClientRect();
            const anchor = (e.clientX !== 0 || e.clientY !== 0)
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
            window.removeEventListener('wheel', handleWheelCapture, { capture: true });
        };
    }, [scrollRef, zoomAround, clampScroll, scrollAction]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;
        const setup = async () => {
            unlisten = await listen<
                | { kind: 'zoom'; scale: number; x: number; y: number }
                | { kind: 'pan';  dx: number; dy: number }
            >('native-gesture', (event) => {
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
                    if (payload.dy !== 0) el.scrollTop  -= payload.dy;
                    clampScroll(el, zoomRef.current);
                }
            });
        };
        setup();
        return () => { if (unlisten) unlisten(); };
    }, [scrollRef, zoomAround, clampScroll]);

    // ── スクロールクランプ ────────────────────────────────────────────────────

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const onScroll = () => {
            if (isPanningRef.current) return;
            if (performance.now() < ignoreScrollUntilRef.current) return;

            if (scrollClampTimerRef.current) clearTimeout(scrollClampTimerRef.current);
            scrollClampTimerRef.current = setTimeout(() => {
                scrollClampTimerRef.current = null;
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
            if (scrollClampTimerRef.current) {
                clearTimeout(scrollClampTimerRef.current);
                scrollClampTimerRef.current = null;
            }
        };
    }, [scrollRef, clampScroll]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onResize = () => clampScroll(el, zoomRef.current);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [scrollRef, clampScroll]);

    // ── マウスドラッグパン ────────────────────────────────────────────────────

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        let dragging = false, lastX = 0, lastY = 0;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 && e.button !== 1) return;
            dragging = true; lastX = e.clientX; lastY = e.clientY;
            isPanningRef.current = true;
            el.style.cursor = 'grabbing';
            e.preventDefault();
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
        const onMouseUp = () => {
            dragging = false;
            isPanningRef.current = false;
            el.style.cursor = '';
        };

        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [scrollRef, clampScroll, getScrollability]);

    // ── 公開API ───────────────────────────────────────────────────────────────

    const handleZoom = useCallback((delta: number) => {
        const el      = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, Math.round((zoomOld + delta) * 100) / 100));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
    }, [scrollRef, zoomAround]);

    const setZoomTo = useCallback((nextZoom: number) => {
        const el      = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, nextZoom));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
    }, [scrollRef, zoomAround]);

    const resetZoom = useCallback(() => {
        applyZoom(1);
        requestAnimationFrame(() => centerPsd());
    }, [applyZoom, centerPsd]);

    const fitToScreen = useCallback(() => {
        const el  = scrollRef.current;
        const psd = psdRef.current;
        if (!el || !psd) return;
        const MARGIN  = 40;
        const scale   = Math.min(
            (el.clientWidth  - MARGIN * 2) / psd.width,
            (el.clientHeight - MARGIN * 2) / psd.height,
        );
        setZoomTo(Math.max(0.1, Math.min(5, scale)));
        requestAnimationFrame(() => centerPsd());
    }, [scrollRef, psdRef, setZoomTo, centerPsd]);

    // ★ applyZoom を外部に公開
    return { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, fitToScreen, SCROLL_AREA, applyZoom };
}