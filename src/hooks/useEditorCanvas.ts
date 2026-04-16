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

    // ★ FIX: psdRef.currentではなく引数のpsdを直接使う
    // これによりstale closure問題を回避し、最新のpsd状態で描画する
    const drawCanvas = useCallback((targetPsd?: any) => {
        const canvas = canvasRef.current;
        // ★ FIX: canvasが存在しない・DOMに接続されていない場合は何もしない
        if (!canvas || !canvas.isConnected) return;

        const currentPsd = targetPsd ?? psdRef.current;
        if (!currentPsd) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = currentPsd.width, h = currentPsd.height;
        if (!w || !h) return;

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
            const plainNameSet = new Set<string>();
            if (flipEnabled) {
                for (const l of layers) {
                    const layerName = l.name || '';
                    const lower = layerName.toLowerCase();
                    if (!hasFlipSuffix(layerName)) plainNameSet.add(lower);
                    if (flipSuffix && lower.endsWith(flipSuffix.toLowerCase())) {
                        flipMap.set(getBaseName(layerName).toLowerCase(), l);
                    }
                }
            }
            for (const layer of layers) {
                if (layer.hidden) continue;
                const name = layer.name || '';
                const lowerName = name.toLowerCase();
                if (flipEnabled && hasFlipSuffix(name)) {
                    if (!flipSuffix || !lowerName.endsWith(flipSuffix.toLowerCase())) continue;
                    if (plainNameSet.has(getBaseName(name).toLowerCase())) continue;
                }
                const effectiveLayer = flipMap.get(lowerName) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer._bitmap) {
                    try {
                        ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                    } catch (e) {
                        // ★ FIX: ImageBitmapが既にclose()されている場合のエラーを握りつぶす
                        console.warn('[drawCanvas] Failed to draw layer bitmap:', e);
                    }
                }
                else if (effectiveLayer.canvas) {
                    try {
                        ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
                    } catch (e) {
                        console.warn('[drawCanvas] Failed to draw layer canvas:', e);
                    }
                }
            }
        };

        if (currentPsd.children) drawLayers(currentPsd.children);
        else if (currentPsd._bitmap) {
            try {
                ctx.drawImage(currentPsd._bitmap, 0, 0);
            } catch (e) {
                console.warn('[drawCanvas] Failed to draw root bitmap:', e);
            }
        }
        ctx.restore();
        drawDirtyRef.current = false;
    }, [flipX, flipY, flipEnabled, getFlipSuffix, getBaseName, hasFlipSuffix, psdRef]);

    useEffect(() => {
        if (!psd) return;
        drawDirtyRef.current = true;
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        // ★ FIX: psdを直接drawCanvasに渡してstale refの問題を回避
        drawRafRef.current = requestAnimationFrame(() => {
            drawCanvas(psd);
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