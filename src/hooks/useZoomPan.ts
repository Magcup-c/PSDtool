import { useState, useRef, useEffect, useCallback } from 'react';
import { Psd } from 'ag-psd';

const MARGIN = 200;
const SCROLL_AREA = 16000 + MARGIN * 2;

export function useZoomPan(
    psdRef: React.MutableRefObject<Psd | null>,
    scrollRef: React.RefObject<HTMLDivElement | null>,
    canvasContainerRef: React.RefObject<HTMLDivElement | null>,
) {
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);

    /**
     * スクロール位置をキャンバス表示範囲（+ MARGIN）に制限する。
     *
     * キャンバスは left=MARGIN, top=MARGIN に配置され、
     * scale(zoom) で拡大されるため表示サイズは psd.width * zoom。
     *
     * スクロール可能な範囲:
     *   左端:  scrollLeft >= 0
     *          （ビューポート左端がスクロール領域の左端 = キャンバス左MARGIN外の端）
     *   右端:  scrollLeft <= MARGIN*2 + psd.width*zoom - viewportWidth
     *          （ビューポート右端がスクロール領域の右端）
     *
     * ただし「キャンバスが小さくてビューポートに収まる」場合は
     * キャンバスがビューポート内に常に見えるよう中央寄せ位置に固定する。
     */
    const clampScroll = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return;

        const canvasW = psd.width * z;
        const canvasH = psd.height * z;

        // スクロール領域内でキャンバスが占める範囲: [MARGIN, MARGIN + canvasW]
        // ビューポートがこの範囲を超えてスクロールできる最大値
        const maxScrollLeft = Math.max(0, MARGIN * 2 + canvasW - el.clientWidth);
        const maxScrollTop = Math.max(0, MARGIN * 2 + canvasH - el.clientHeight);

        // キャンバスがビューポートより小さい場合、中央に固定
        const minScrollLeft = canvasW < el.clientWidth
            ? MARGIN - (el.clientWidth - canvasW) / 2
            : 0;
        const minScrollTop = canvasH < el.clientHeight
            ? MARGIN - (el.clientHeight - canvasH) / 2
            : 0;

        el.scrollLeft = Math.min(maxScrollLeft, Math.max(minScrollLeft, el.scrollLeft));
        el.scrollTop = Math.min(maxScrollTop, Math.max(minScrollTop, el.scrollTop));
    }, [psdRef]);

    /** zoom を更新し canvas-container の transform を直接書き換える */
    const applyZoom = useCallback((nextZoom: number) => {
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
        if (canvasContainerRef.current) {
            canvasContainerRef.current.style.transform = `scale(${nextZoom})`;
        }
    }, [canvasContainerRef]);

    // ─── センタリング ──────────────────────────────────────────────────────
    const centerPsd = useCallback(() => {
        const el = scrollRef.current;
        const psd = psdRef.current;
        if (!el || !psd) return;
        const z = zoomRef.current;
        el.scrollLeft = MARGIN + (psd.width * z - el.clientWidth) / 2;
        el.scrollTop = MARGIN + (psd.height * z - el.clientHeight) / 2;
        // センタリング後もクランプ（ビューポートがキャンバスより大きい場合の補正）
        clampScroll(el, z);
    }, [scrollRef, psdRef, clampScroll]);

    // ─── ホイールズーム ───────────────────────────────────────────────────
    useEffect(() => {
        const normalizeDeltaToPixels = (e: WheelEvent, value: number) => {
            if (e.deltaMode === 1) return value * 16; // line -> pixel
            if (e.deltaMode === 2) return value * 400; // page -> pixel
            return value;
        };

        const getWheelDeltas = (e: WheelEvent) => {
            let deltaX = e.deltaX;
            let deltaY = e.deltaY;

            // Shift+wheel は横スクロール扱い（マウスホイール互換）
            if (deltaX === 0 && deltaY !== 0 && e.shiftKey) {
                deltaX = deltaY;
                deltaY = 0;
            }

            deltaX = normalizeDeltaToPixels(e, deltaX);
            deltaY = normalizeDeltaToPixels(e, deltaY);

            // 一部環境の軸ロック対策: 非標準 wheelDeltaX/Y をフォールバック利用
            if (deltaX === 0 || deltaY === 0) {
                const anyEvent = e as WheelEvent & {
                    wheelDeltaX?: number;
                    wheelDeltaY?: number;
                    wheelDelta?: number;
                };
                const wheelDeltaX = typeof anyEvent.wheelDeltaX === 'number' ? -anyEvent.wheelDeltaX : 0;
                const wheelDeltaY = typeof anyEvent.wheelDeltaY === 'number'
                    ? -anyEvent.wheelDeltaY
                    : (typeof anyEvent.wheelDelta === 'number' ? -anyEvent.wheelDelta : 0);

                if (deltaX === 0 && wheelDeltaX !== 0) deltaX = wheelDeltaX;
                if (deltaY === 0 && wheelDeltaY !== 0) deltaY = wheelDeltaY;
            }

            return { deltaX, deltaY };
        };

        const handleWheel = (e: WheelEvent) => {
            const el = scrollRef.current;
            if (!el) return;

            const rect = el.getBoundingClientRect();
            const withinView = e.clientX >= rect.left
                && e.clientX <= rect.right
                && e.clientY >= rect.top
                && e.clientY <= rect.bottom;

            // target が期待要素でない環境でも、ポインタ位置がプレビュー上なら処理する
            const target = e.target;
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const isInsideByTarget = target instanceof Node && el.contains(target);
            const isInsideByPath = path.includes(el);
            if (!withinView && !isInsideByTarget && !isInsideByPath) return;

            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();

                const delta = normalizeDeltaToPixels(e, e.deltaY);

                // |delta| が小さい → トラックパッドのピンチ（高頻度・小刻み）
                // |delta| が大きい → マウスホイール（低頻度・大きい値）
                const isTrackpad = Math.abs(delta) < 20;
                const sensitivity = isTrackpad ? 0.008 : 0.002;

                const factor = 1 - delta * sensitivity;

                const zoomOld = zoomRef.current;
                const zoomNew = Math.min(5, Math.max(0.1, Math.round(zoomOld * factor * 100) / 100));
                if (zoomNew === zoomOld) return;

                const cursorViewX = e.clientX - rect.left;
                const cursorViewY = e.clientY - rect.top;

                const scrollLeftNew = (el.scrollLeft + cursorViewX - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewX;
                const scrollTopNew = (el.scrollTop + cursorViewY - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewY;

                applyZoom(zoomNew);
                el.scrollLeft = scrollLeftNew;
                el.scrollTop = scrollTopNew;
                clampScroll(el, zoomNew);
                return;
            }

            e.preventDefault();
            const { deltaX, deltaY } = getWheelDeltas(e);
            if (deltaX !== 0) el.scrollLeft += deltaX;
            if (deltaY !== 0) el.scrollTop += deltaY;
            clampScroll(el, zoomRef.current);
        };

        window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        return () => window.removeEventListener('wheel', handleWheel, { capture: true });
    }, [scrollRef, applyZoom, clampScroll]);

    // ─── 通常スクロール（非Ctrl）のクランプ ──────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const handleScroll = () => {
            clampScroll(el, zoomRef.current);
        };
        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, [scrollRef, clampScroll]);

    // ─── マウスドラッグによるパン ─────────────────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 && e.button !== 1) return;
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            el.style.cursor = 'grabbing';
            e.preventDefault();
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            el.scrollLeft -= e.clientX - lastX;
            el.scrollTop -= e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            // ドラッグ中もクランプ
            clampScroll(el, zoomRef.current);
        };

        const onMouseUp = () => {
            dragging = false;
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
    }, [scrollRef, clampScroll]);

    // ─── ズームボタン（ビューポート中心基準） ────────────────────────────
    const handleZoom = useCallback((delta: number) => {
        const el = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, Math.round((zoomOld + delta) * 100) / 100));
        if (zoomNew === zoomOld || !el) return;

        const cursorViewX = el.clientWidth / 2;
        const cursorViewY = el.clientHeight / 2;

        const scrollLeftNew = (el.scrollLeft + cursorViewX - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewX;
        const scrollTopNew = (el.scrollTop + cursorViewY - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewY;

        applyZoom(zoomNew);
        el.scrollLeft = scrollLeftNew;
        el.scrollTop = scrollTopNew;
        clampScroll(el, zoomNew);
    }, [scrollRef, applyZoom, clampScroll]);

    // ─── ズームリセット ───────────────────────────────────────────────────
    const resetZoom = useCallback(() => {
        applyZoom(1);
        requestAnimationFrame(() => centerPsd());
    }, [applyZoom, centerPsd]);

    return { zoom, handleZoom, resetZoom, centerPsd, MARGIN, SCROLL_AREA };
}
