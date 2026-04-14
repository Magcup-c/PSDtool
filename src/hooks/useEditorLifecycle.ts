import { useEffect, useRef } from 'react';
import { PsdRoot } from '../types';

interface UseEditorLifecycleProps {
    psd: PsdRoot | null;
    isFirstLoadRef: React.MutableRefObject<boolean>;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    centerPsd: () => void;
    drawRafRef: React.MutableRefObject<number | null>;
    layerDragCleanup: () => void;
}

export const useEditorLifecycle = ({
    psd, isFirstLoadRef, scrollRef, centerPsd, drawRafRef, layerDragCleanup
}: UseEditorLifecycleProps) => {
    const centerRafRef = useRef<number | null>(null);

    // Centering effect
    useEffect(() => {
        if (!psd || !isFirstLoadRef.current) return;
        isFirstLoadRef.current = false;
        const el = scrollRef.current;
        if (!el) return;
        let attempts = 0;
        const tryCenter = () => {
            attempts++;
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                centerPsd();
                return;
            }
            if (attempts < 10) {
                centerRafRef.current = requestAnimationFrame(tryCenter);
            }
        };
        centerRafRef.current = requestAnimationFrame(tryCenter);
        return () => {
            if (centerRafRef.current) cancelAnimationFrame(centerRafRef.current);
        };
    }, [psd, centerPsd, isFirstLoadRef, scrollRef]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
            if (centerRafRef.current) cancelAnimationFrame(centerRafRef.current);
            layerDragCleanup();
        };
    }, [layerDragCleanup, drawRafRef]);
};
