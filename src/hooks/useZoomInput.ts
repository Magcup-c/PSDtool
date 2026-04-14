import { useState, useRef, useCallback, useEffect } from 'react';

export const useZoomInput = (zoom: number, setZoomTo: (z: number) => void) => {
    const [zoomInputActive, setZoomInputActive] = useState(false);
    const [zoomInputValue, setZoomInputValue] = useState('');
    const zoomInputRef = useRef<HTMLInputElement>(null);
    const zoomSelectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleZoomInputFocus = useCallback(() => {
        setZoomInputValue(String(Math.round(zoom * 100)));
        setZoomInputActive(true);
        if (zoomSelectTimerRef.current) clearTimeout(zoomSelectTimerRef.current);
        zoomSelectTimerRef.current = setTimeout(() => zoomInputRef.current?.select(), 0);
    }, [zoom]);

    const handleZoomInputCommit = useCallback(() => {
        setZoomInputActive(false);
        const parsed = parseInt(zoomInputValue, 10);
        if (!isNaN(parsed) && parsed > 0) {
            setZoomTo(Math.min(500, Math.max(10, parsed)) / 100);
        }
    }, [zoomInputValue, setZoomTo]);

    useEffect(() => {
        return () => {
            if (zoomSelectTimerRef.current) clearTimeout(zoomSelectTimerRef.current);
        };
    }, []);

    return {
        zoomInputActive,
        setZoomInputActive,
        zoomInputValue,
        setZoomInputValue,
        zoomInputRef,
        handleZoomInputFocus,
        handleZoomInputCommit,
    };
};
