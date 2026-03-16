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
        const el = scrollRef.current;
        if (!el) return;

        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();

            const mul = e.deltaMode === 1 ? 16 : 1;
            const factor = 1 - e.deltaY * mul * 0.002;

            const zoomOld = zoomRef.current;
            const zoomNew = Math.min(5, Math.max(0.1, Math.round(zoomOld * factor * 100) / 100));
            if (zoomNew === zoomOld) return;

            const rect = el.getBoundingClientRect();
            const cursorViewX = e.clientX - rect.left;
            const cursorViewY = e.clientY - rect.top;

            const scrollLeftNew = (el.scrollLeft + cursorViewX - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewX;
            const scrollTopNew = (el.scrollTop + cursorViewY - MARGIN) * (zoomNew / zoomOld) + MARGIN - cursorViewY;

            applyZoom(zoomNew);
            el.scrollLeft = scrollLeftNew;
            el.scrollTop = scrollTopNew;
            clampScroll(el, zoomNew);
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
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