import { useState, useCallback, useRef, useEffect } from 'react';
import { PsdLayerNode } from '../types';

export const useEditorCanvas = (psd: any, psdRef: React.MutableRefObject<any>) => {
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawDirtyRef = useRef(false);
    const drawRafRef = useRef<number | null>(null);

    const getFlipSuffix = useCallback(() => {
        if (flipX && flipY) return ':flipxy';
        if (flipX) return ':flipx';
        if (flipY) return ':flipy';
        return '';
    }, [flipX, flipY]);

    const hasFlipSuffix = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const currentPsd = psdRef.current;
        if (!canvas || !currentPsd) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = currentPsd.width, h = currentPsd.height;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        } else {
            ctx.clearRect(0, 0, w, h);
        }

        const flipSuffix = flipEnabled ? getFlipSuffix() : '';
        ctx.save();
        if (flipX && flipY) { ctx.translate(w, h); ctx.scale(-1, -1); }
        else if (flipX) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        else if (flipY) { ctx.translate(0, h); ctx.scale(1, -1); }

        const drawLayers = (layers: PsdLayerNode[]) => {
            const flipMap = new Map<string, PsdLayerNode>();
            if (flipEnabled && flipSuffix) {
                for (const l of layers)
                    if ((l.name || '').toLowerCase().endsWith(flipSuffix.toLowerCase()))
                        flipMap.set(getBaseName(l.name || '').toLowerCase(), l);
            }
            for (const layer of layers) {
                if (layer.hidden) continue;
                const name = layer.name || '';
                if (flipEnabled && hasFlipSuffix(name) && getFlipSuffix() && name.toLowerCase().endsWith(getFlipSuffix().toLowerCase())) continue;
                const effectiveLayer = flipMap.get(name.toLowerCase()) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer._bitmap) ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                else if (effectiveLayer.canvas) ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
            }
        };
        if (currentPsd.children) drawLayers(currentPsd.children);
        else if (currentPsd._bitmap) ctx.drawImage(currentPsd._bitmap, 0, 0);
        ctx.restore();
        drawDirtyRef.current = false;
    }, [flipX, flipY, flipEnabled, getFlipSuffix, getBaseName, hasFlipSuffix, psdRef]);

    useEffect(() => {
        if (!psd) return;
        drawDirtyRef.current = true;
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = requestAnimationFrame(() => {
            drawCanvas();
            drawRafRef.current = null;
        });
        return () => {
            if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        };
    }, [psd, flipX, flipY, flipEnabled, drawCanvas]);

    return {
        canvasRef,
        flipX, setFlipX,
        flipY, setFlipY,
        radioEnabled, setRadioEnabled,
        lockedEnabled, setLockedEnabled,
        flipEnabled, setFlipEnabled,
        drawCanvas,
        drawRafRef,
        hasFlipSuffix,
    };
};
