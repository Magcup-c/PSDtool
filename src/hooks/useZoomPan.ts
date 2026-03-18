import { useState, useRef, useEffect, useCallback } from 'react';
import { Psd } from 'ag-psd';

// スクロール領域は十分大きく取り、キャンバスはその中央に配置する
const SCROLL_AREA = 16000;

// キャンバスの左上座標（スクロール領域内、ズーム等倍時）
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
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);

    // ── スクロール範囲制限 ────────────────────────────────────────────────────
    // キャンバスの端より外に出すぎないよう制限する（余白 PADDING 分は許容）
    const PADDING = 200;
    const clampScroll = useCallback((el: HTMLDivElement, z: number) => {
        const psd = psdRef.current;
        if (!psd) return;
        const { x: ox, y: oy } = canvasOrigin(psd);
        const canvasW = psd.width  * z;
        const canvasH = psd.height * z;
        // キャンバス左端から PADDING 外まで、右端から PADDING 外まで
        const minL = ox - PADDING;
        const maxL = ox + canvasW - el.clientWidth  + PADDING;
        const minT = oy - PADDING;
        const maxT = oy + canvasH - el.clientHeight + PADDING;
        el.scrollLeft = Math.min(Math.max(minL, el.scrollLeft), Math.max(minL, maxL));
        el.scrollTop  = Math.min(Math.max(minT, el.scrollTop),  Math.max(minT, maxT));
    }, [psdRef]);

    const applyZoom = useCallback((nextZoom: number) => {
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
        if (canvasContainerRef.current) {
            canvasContainerRef.current.style.transform = `scale(${nextZoom})`;
        }
    }, [canvasContainerRef]);

    // ── ズームしながらアンカー点を固定するスクロール計算 ──────────────────────
    // anchorViewX/Y: ビューポート内のアンカー点（ピクセル）
    // anchorScrollX/Y: そのアンカー点がスクロール領域上で指していた座標（ズーム前）
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

        // アンカー点がキャンバス上のどの座標を指しているか（キャンバス座標系）
        const canvasX = (el.scrollLeft + anchorViewX - ox) / zoomOld;
        const canvasY = (el.scrollTop  + anchorViewY - oy) / zoomOld;

        // ズーム後、同じキャンバス座標がアンカー点に来るようにスクロール位置を決める
        applyZoom(zoomNew);
        el.scrollLeft = ox + canvasX * zoomNew - anchorViewX;
        el.scrollTop  = oy + canvasY * zoomNew - anchorViewY;
    }, [psdRef, applyZoom]);

    // ── センタリング ──────────────────────────────────────────────────────────
    const centerPsd = useCallback(() => {
        const el = scrollRef.current;
        const psd = psdRef.current;
        if (!el || !psd) return;
        if (el.clientWidth === 0 || el.clientHeight === 0) return;
        const z = zoomRef.current;
        const { x: ox, y: oy } = canvasOrigin(psd);
        el.scrollLeft = ox - (el.clientWidth  - psd.width  * z) / 2;
        el.scrollTop  = oy - (el.clientHeight - psd.height * z) / 2;
    }, [scrollRef, psdRef]);

    // ── ホイールズーム ────────────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const normalizeDelta = (e: WheelEvent, v: number) => {
            if (e.deltaMode === 1) return v * 16;
            if (e.deltaMode === 2) return v * 400;
            return v;
        };

        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = normalizeDelta(e, e.deltaY);
            const isTrackpad = Math.abs(delta) < 20;
            const sensitivity = isTrackpad ? 0.008 : 0.002;
            const zoomOld = zoomRef.current;
            const zoomNew = Math.min(5, Math.max(0.1,
                Math.round(zoomOld * (1 - delta * sensitivity) * 100) / 100
            ));
            if (zoomNew === zoomOld) return;
            const rect = el.getBoundingClientRect();
            zoomAround(el, zoomOld, zoomNew, e.clientX - rect.left, e.clientY - rect.top);
            clampScroll(el, zoomNew);
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [scrollRef, zoomAround, clampScroll]);

    // ── 通常スクロール（クランプ不要 — スクロール領域が十分大きいので自然に止まる）
    // ── マウスドラッグパン ────────────────────────────────────────────────────
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        let dragging = false, lastX = 0, lastY = 0;
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0 && e.button !== 1) return;
            dragging = true; lastX = e.clientX; lastY = e.clientY;
            el.style.cursor = 'grabbing'; e.preventDefault();
        };
        const onMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            el.scrollLeft -= e.clientX - lastX;
            el.scrollTop  -= e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            clampScroll(el, zoomRef.current);
        };
        const onMouseUp = () => { dragging = false; el.style.cursor = ''; };
        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [scrollRef, clampScroll]);

    // ── ズームボタン（ビューポート中心基準） ──────────────────────────────────
    const handleZoom = useCallback((delta: number) => {
        const el = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, Math.round((zoomOld + delta) * 100) / 100));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
        clampScroll(el, zoomNew);
    }, [scrollRef, zoomAround, clampScroll]);

    // ── ズーム値を直接セット（テキスト入力用） ────────────────────────────────
    const setZoomTo = useCallback((nextZoom: number) => {
        const el = scrollRef.current;
        const zoomOld = zoomRef.current;
        const zoomNew = Math.max(0.1, Math.min(5, nextZoom));
        if (zoomNew === zoomOld || !el) return;
        zoomAround(el, zoomOld, zoomNew, el.clientWidth / 2, el.clientHeight / 2);
        clampScroll(el, zoomNew);
    }, [scrollRef, zoomAround, clampScroll]);

    // ── ズームリセット ────────────────────────────────────────────────────────
    const resetZoom = useCallback(() => {
        applyZoom(1);
        requestAnimationFrame(() => centerPsd());
    }, [applyZoom, centerPsd]);

    return { zoom, handleZoom, setZoomTo, resetZoom, centerPsd, SCROLL_AREA };
}