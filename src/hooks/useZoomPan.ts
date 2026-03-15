import { useState, useRef, useEffect } from 'react';
import { Psd } from 'ag-psd';

export function useZoomPan(psdRef: React.MutableRefObject<Psd | null>, scrollRef: React.RefObject<HTMLDivElement | null>) {
    const [zoom, setZoom] = useState(1);
    const centerOnLoadRef = useRef(false);
    const prevPsdSizeRef = useRef<{ w: number; h: number } | null>(null);
    const MARGIN = 200;
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    useEffect(() => {
        if (!psdRef.current) return;
        const psd = psdRef.current;
        const size = { w: psd.width, h: psd.height };
        if (!prevPsdSizeRef.current ||
            prevPsdSizeRef.current.w !== size.w ||
            prevPsdSizeRef.current.h !== size.h) {
            prevPsdSizeRef.current = size;
            centerOnLoadRef.current = true;
        }
    }, [psdRef.current]);

    useEffect(() => {
        if (!centerOnLoadRef.current || !psdRef.current) return;
        centerOnLoadRef.current = false;
        const el = scrollRef.current;
        if (!el) return;
        const psd = psdRef.current;
        requestAnimationFrame(() => {
            el.scrollLeft = (psd.width * zoom + MARGIN * 2 - el.clientWidth) / 2;
            el.scrollTop = (psd.height * zoom + MARGIN * 2 - el.clientHeight) / 2;
        });
    }, [psdRef.current, zoom, scrollRef]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const handleWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (!psdRef.current) return;
            const mul = e.deltaMode === 1 ? 16 : 1;
            const raw = e.deltaY * mul;
            const factor = 1 - raw * 0.002;
            const rect = el.getBoundingClientRect();
            const cursorX = e.clientX - rect.left + el.scrollLeft;
            const cursorY = e.clientY - rect.top + el.scrollTop;
            setZoom(prev => {
                const next = Math.min(5, Math.max(0.1, Math.round(prev * factor * 100) / 100));
                if (next === prev) return prev;
                const ratio = next / prev;
                requestAnimationFrame(() => {
                    if(!scrollRef.current) return;
                    scrollRef.current.scrollLeft = cursorX * ratio - (e.clientX - rect.left);
                    scrollRef.current.scrollTop = cursorY * ratio - (e.clientY - rect.top);
                });
                return next;
            });
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [scrollRef, psdRef]);

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
            el.scrollTop -= e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
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
    }, [scrollRef]);

    const handleZoom = (delta: number) => {
        const el = scrollRef.current;
        setZoom(prev => {
            const next = Math.max(0.1, Math.min(5, Math.round((prev + delta) * 100) / 100));
            if (!el || !psdRef.current) return next;
            const cx = el.scrollLeft + el.clientWidth / 2;
            const cy = el.scrollTop + el.clientHeight / 2;
            const ratio = next / prev;
            requestAnimationFrame(() => {
                el.scrollLeft = cx * ratio - el.clientWidth / 2;
                el.scrollTop = cy * ratio - el.clientHeight / 2;
            });
            return next;
        });
    };

    const resetZoom = () => {
        const el = scrollRef.current;
        setZoom(1);
        if (!el || !psdRef.current) return;
        const p = psdRef.current;
        requestAnimationFrame(() => {
            el.scrollLeft = (p.width + MARGIN * 2 - el.clientWidth) / 2;
            el.scrollTop = (p.height + MARGIN * 2 - el.clientHeight) / 2;
        });
    };

    return { zoom, setZoom, handleZoom, resetZoom, MARGIN };
}
