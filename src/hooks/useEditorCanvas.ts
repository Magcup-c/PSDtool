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

    // flip 系は ref でも保持して drawCanvas が stale closure にならないようにする
    const flipXRef = useRef(flipX);
    const flipYRef = useRef(flipY);
    const flipEnabledRef = useRef(flipEnabled);
    flipXRef.current = flipX;
    flipYRef.current = flipY;
    flipEnabledRef.current = flipEnabled;

    const hasFlipSuffix = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    // drawCanvas は targetPsd を直接受け取る。
    // psdRef には依存しない（タブ切り替え時の不整合を防ぐ）。
    const drawCanvas = useCallback((targetPsd?: any) => {
        const canvas = canvasRef.current;
        if (!canvas || !canvas.isConnected) return;

        // targetPsd が明示的に渡された場合はそれを使う。
        // 渡されない場合は psdRef.current を使う（通常の描画パス）。
        const currentPsd = (targetPsd !== undefined) ? targetPsd : psdRef.current;
        if (!currentPsd) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = currentPsd.width, h = currentPsd.height;
        if (!w || !h) return;

        // canvas リサイズ（内容がクリアされるので必ず再描画する）
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        } else {
            ctx.clearRect(0, 0, w, h);
        }

        // ref から最新の flip 状態を取得
        const fx = flipXRef.current;
        const fy = flipYRef.current;
        const fe = flipEnabledRef.current;
        const flipSuffix = fe
            ? (fx && fy ? ':flipxy' : fx ? ':flipx' : fy ? ':flipy' : '')
            : '';

        ctx.save();
        if (fx && fy) { ctx.translate(w, h); ctx.scale(-1, -1); }
        else if (fx) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        else if (fy) { ctx.translate(0, h); ctx.scale(1, -1); }

        const drawLayers = (layers: PsdLayerNode[]) => {
            const flipMap = new Map<string, PsdLayerNode>();
            const plainNameSet = new Set<string>();
            if (fe) {
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
                if (fe && hasFlipSuffix(name)) {
                    if (!flipSuffix || !lowerName.endsWith(flipSuffix.toLowerCase())) continue;
                    if (plainNameSet.has(getBaseName(name).toLowerCase())) continue;
                }
                const effectiveLayer = flipMap.get(lowerName) ?? layer;
                if (effectiveLayer.children) {
                    drawLayers(effectiveLayer.children);
                } else if (effectiveLayer._bitmap) {
                    try {
                        ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                    } catch (e) {
                        console.warn('[drawCanvas] Failed to draw layer bitmap:', e);
                    }
                } else if (effectiveLayer.canvas) {
                    try {
                        ctx.drawImage(effectiveLayer.canvas, effectiveLayer.left || 0, effectiveLayer.top || 0);
                    } catch (e) {
                        console.warn('[drawCanvas] Failed to draw layer canvas:', e);
                    }
                }
            }
        };

        if (currentPsd.children) {
            drawLayers(currentPsd.children);
        } else if (currentPsd._bitmap) {
            try {
                ctx.drawImage(currentPsd._bitmap, 0, 0);
            } catch (e) {
                console.warn('[drawCanvas] Failed to draw root bitmap:', e);
            }
        }
        ctx.restore();
        drawDirtyRef.current = false;
    }, [hasFlipSuffix, getBaseName, psdRef]);

    // psd または flip 系が変わったら再描画
    useEffect(() => {
        if (!psd) return;
        drawDirtyRef.current = true;
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = requestAnimationFrame(() => {
            drawRafRef.current = null;
            drawCanvas(psd);
        });
        return () => {
            if (drawRafRef.current) {
                cancelAnimationFrame(drawRafRef.current);
                drawRafRef.current = null;
            }
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