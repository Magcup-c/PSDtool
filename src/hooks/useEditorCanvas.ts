import { useState, useCallback, useRef, useEffect } from 'react';
import { PsdLayerNode, PsdRoot } from '../types';

export const useEditorCanvas = (psd: PsdRoot | null, psdRef: React.MutableRefObject<any>) => {
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawDirtyRef = useRef(false);
    const drawRafRef = useRef<number | null>(null);

    // flip 系の最新値を ref で保持して drawCanvas 内の closure stale を防ぐ
    const flipXRef = useRef(flipX);
    const flipYRef = useRef(flipY);
    const flipEnabledRef = useRef(flipEnabled);
    flipXRef.current = flipX;
    flipYRef.current = flipY;
    flipEnabledRef.current = flipEnabled;

    const getFlipSuffix = useCallback(() => {
        if (flipXRef.current && flipYRef.current) return ':flipxy';
        if (flipXRef.current) return ':flipx';
        if (flipYRef.current) return ':flipy';
        return '';
    }, []);

    const hasFlipSuffix = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    /**
     * targetPsd を引数で受け取れるようにする。
     * タブ切り替え時など、psd state の反映前に呼ばれる場合でも
     * 正しい PSD を描画できるようにするため。
     */
    const drawCanvas = useCallback((targetPsd?: PsdRoot | null) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // isConnected チェックを削除: タブ切り替え直後に DOM から切り離されても
        // canvasRef は同じ要素を指し続けるので isConnected は常に true のはず。
        // ただし念のため parentNode で代替チェックする。
        if (!canvas.parentNode) return;

        // 引数で渡されたものを優先、なければ psdRef.current を使う
        const currentPsd = targetPsd !== undefined ? targetPsd : psdRef.current;
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

        const fxCur = flipXRef.current;
        const fyCur = flipYRef.current;
        const feCur = flipEnabledRef.current;
        const flipSuffix = feCur ? getFlipSuffix() : '';

        ctx.save();
        if (fxCur && fyCur) { ctx.translate(w, h); ctx.scale(-1, -1); }
        else if (fxCur) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        else if (fyCur) { ctx.translate(0, h); ctx.scale(1, -1); }

        const drawLayers = (layers: PsdLayerNode[]) => {
            const flipMap = new Map<string, PsdLayerNode>();
            const plainNameSet = new Set<string>();
            if (feCur) {
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
                if (feCur && hasFlipSuffix(name)) {
                    if (!flipSuffix || !lowerName.endsWith(flipSuffix.toLowerCase())) continue;
                    if (plainNameSet.has(getBaseName(name).toLowerCase())) continue;
                }
                const effectiveLayer = flipMap.get(lowerName) ?? layer;
                if (effectiveLayer.children) drawLayers(effectiveLayer.children);
                else if (effectiveLayer._bitmap) {
                    try {
                        ctx.drawImage(effectiveLayer._bitmap, effectiveLayer.left || 0, effectiveLayer.top || 0);
                    } catch (e) {
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
            try { ctx.drawImage(currentPsd._bitmap, 0, 0); }
            catch (e) { console.warn('[drawCanvas] Failed to draw root bitmap:', e); }
        }
        ctx.restore();
        drawDirtyRef.current = false;
    }, [getFlipSuffix, getBaseName, hasFlipSuffix, psdRef]);

    // psd / flip 系が変わったときに RAF で再描画
    // ★ psd を直接 drawCanvas に渡すことで stale psdRef 問題を回避
    useEffect(() => {
        if (!psd) return;
        drawDirtyRef.current = true;
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = requestAnimationFrame(() => {
            drawCanvas(psd);
            drawRafRef.current = null;
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