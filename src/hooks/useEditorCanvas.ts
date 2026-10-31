import { useState, useCallback, useRef, useEffect } from 'react';
import { PsdLayerNode } from '../types';
import { isPassThrough, resolvePsdBlendMode } from '../compositor/blendMode';
import { findClippingBaseIndex } from '../compositor/clipping';
import { createPsdMaskAlphaCanvas } from '../compositor/mask';
import { applyAdjustmentToImage } from '../compositor/adjustment';

// undefined との区別が必要なので専用センチネルを使う。
// drawCanvas(USE_PSD_REF) → psdRef.current を使う（従来の引数なし呼び出しと同義）
// drawCanvas(null)        → 何もしない（将来のキャンバスクリア用途に対応）
const USE_PSD_REF = Symbol('USE_PSD_REF');
function applyCurvesAdjustment(
    ctx: CanvasRenderingContext2D,
    adjustment: any,
    layer: PsdLayerNode,
): void {
    if (adjustment?.type !== 'curves') return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    if (!width || !height) return;

    const image = ctx.getImageData(0, 0, width, height);
    const opacity = typeof layer.opacity === 'number'
        ? Math.max(0, Math.min(1, layer.opacity)) : 1;

    // Layer-mask pixels are grayscale in PSD. Render the transferred mask to
    // a document-sized canvas and use its red channel as the influence.
    let maskData: Uint8ClampedArray | null = null;
    if (layer.mask?._maskBitmap && !layer.mask.disabled) {
        const normalizedMask = createPsdMaskAlphaCanvas(
            layer.mask._maskBitmap,
            width,
            height,
            layer.mask.left ?? layer.left ?? 0,
            layer.mask.top ?? layer.top ?? 0,
            layer.mask.defaultColor,
            layer.mask.userMaskDensity ?? layer.mask.vectorMaskDensity ?? 1,
            layer.mask.userMaskFeather ?? layer.mask.vectorMaskFeather ?? 0,
        );
        if (normalizedMask) maskData = normalizedMask.getContext('2d')!.getImageData(0, 0, width, height).data;
    }

    applyAdjustmentToImage(image, adjustment, opacity, maskData ?? undefined);
    ctx.putImageData(image, 0, 0);
}

export const useEditorCanvas = (psd: any, psdRef: React.MutableRefObject<any>) => {
    const [flipX, setFlipX] = useState(false);
    const [flipY, setFlipY] = useState(false);
    const [radioEnabled, setRadioEnabled] = useState(true);
    const [lockedEnabled, setLockedEnabled] = useState(true);
    const [flipEnabled, setFlipEnabled] = useState(true);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawDirtyRef = useRef(false);
    const drawRafRef = useRef<number | null>(null);
    const lastDrawRef = useRef<{
        psd: any;
        flipX: boolean;
        flipY: boolean;
        flipEnabled: boolean;
    } | null>(null);
    // Large PSD masks are normalized at document resolution. Cache the result
    // by bitmap and parameters so redraws do not repeat getImageData/putImageData.
    const maskCacheRef = useRef(new WeakMap<object, Map<string, HTMLCanvasElement>>());
    const layerSurfaceCacheRef = useRef(new WeakMap<object, Map<string, HTMLCanvasElement>>());

    // flip 系を ref でも保持して drawCanvas が常に最新値を参照できるようにする
    const flipXRef = useRef(flipX);
    const flipYRef = useRef(flipY);
    const flipEnabledRef = useRef(flipEnabled);
    flipXRef.current = flipX;
    flipYRef.current = flipY;
    flipEnabledRef.current = flipEnabled;

    const hasFlipSuffix = useCallback((name: string) => /(:[Ff]lip(xy|x|y))$/i.test(name), []);
    const getBaseName = useCallback((name: string) => name.replace(/(:[Ff]lip(xy|x|y))$/i, ''), []);

    // drawCanvas は targetPsd を明示指定できる。
    //   drawCanvas()        → psdRef.current を使用（タブ切り替えなど）
    //   drawCanvas(somePsd) → somePsd を使用
    //   drawCanvas(null)    → 何もしない（将来のクリア用途を安全にブロック）
    const drawCanvas = useCallback((targetPsd: any = USE_PSD_REF, force = false) => {
        const canvas = canvasRef.current;
        if (!canvas || !canvas.isConnected) return;

        // null を明示的に渡した場合は描画しない
        if (targetPsd === null) return;

        const currentPsd = targetPsd === USE_PSD_REF ? psdRef.current : targetPsd;
        if (!currentPsd) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = currentPsd.width, h = currentPsd.height;
        if (!w || !h) return;

        // PSD stores a Photoshop-rendered composite. Use it when the document
        // contains features that the browser renderer cannot reproduce exactly
        // (adjustment layers, smart objects, advanced masks/groups, etc.).
        // This keeps the file viewable while preserving the layer tree.
        if (currentPsd._useCompositeFallback && currentPsd._bitmap) {
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            } else {
                ctx.clearRect(0, 0, w, h);
            }
            ctx.save();
            if (flipXRef.current && flipYRef.current) { ctx.translate(w, h); ctx.scale(-1, -1); }
            else if (flipXRef.current) { ctx.translate(w, 0); ctx.scale(-1, 1); }
            else if (flipYRef.current) { ctx.translate(0, h); ctx.scale(1, -1); }
            ctx.drawImage(currentPsd._bitmap, 0, 0);
            ctx.restore();
            drawDirtyRef.current = false;
            return;
        }

        // canvas をリサイズすると内容が消えるので必ず再描画が必要
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        } else {
            ctx.clearRect(0, 0, w, h);
        }

        // ref から最新の flip 状態を取得（stale closure 回避）
        const fx = flipXRef.current;
        const fy = flipYRef.current;
        const fe = flipEnabledRef.current;
        const previousDraw = lastDrawRef.current;
        if (previousDraw && previousDraw.psd === currentPsd &&
            previousDraw.flipX === fx && previousDraw.flipY === fy &&
            previousDraw.flipEnabled === fe && !drawDirtyRef.current && !force) {
            return;
        }
        lastDrawRef.current = { psd: currentPsd, flipX: fx, flipY: fy, flipEnabled: fe };
        const flipSuffix = fe
            ? (fx && fy ? ':flipxy' : fx ? ':flipx' : fy ? ':flipy' : '')
            : '';

        ctx.save();
        if (fx && fy) { ctx.translate(w, h); ctx.scale(-1, -1); }
        else if (fx) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        else if (fy) { ctx.translate(0, h); ctx.scale(1, -1); }

        const getNormalizedMask = (mask: any, fallbackLeft: number, fallbackTop: number) => {
            const bitmap = mask?._maskBitmap as ImageBitmap | undefined;
            if (!bitmap || mask?.disabled) return null;
            const left = mask.left ?? fallbackLeft;
            const top = mask.top ?? fallbackTop;
            const density = mask.userMaskDensity ?? mask.vectorMaskDensity ?? 1;
            const feather = mask.userMaskFeather ?? mask.vectorMaskFeather ?? 0;
            const signature = `${w}x${h}:${left}:${top}:${mask.defaultColor ?? 0}:${density}:${feather}`;
            let variants = maskCacheRef.current.get(bitmap);
            if (!variants) {
                variants = new Map();
                maskCacheRef.current.set(bitmap, variants);
            }
            const cached = variants.get(signature);
            if (cached) return cached;
            const normalized = createPsdMaskAlphaCanvas(bitmap, w, h, left, top, mask.defaultColor, density, feather);
            if (normalized) variants.set(signature, normalized);
            return normalized;
        };

        const drawLayers = (layers: PsdLayerNode[], outputCtx: CanvasRenderingContext2D = ctx) => {
            let clippingBase: HTMLCanvasElement | null = null;
            let clippingBaseIndex: number | null = null;
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
            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                if (layer.hidden) continue;
                const name = layer.name || '';
                const lowerName = name.toLowerCase();
                if (fe && hasFlipSuffix(name)) {
                    if (!flipSuffix || !lowerName.endsWith(flipSuffix.toLowerCase())) continue;
                    if (plainNameSet.has(getBaseName(name).toLowerCase())) continue;
                }
                const effectiveLayer = flipMap.get(lowerName) ?? layer;
                const layerClippingBaseIndex = findClippingBaseIndex(layers, i);
                if (effectiveLayer.adjustment?.type) {
                    try {
                        applyCurvesAdjustment(outputCtx, effectiveLayer.adjustment, effectiveLayer);
                    } catch (e) {
                        console.warn('[drawCanvas] Failed to apply adjustment:', e);
                    }
                } else if (effectiveLayer.children) {
                    // Groups are rendered into an isolated document-sized
                    // surface before being composited into the parent. This
                    // preserves group opacity/blend behavior and prevents a
                    // group's blend mode from leaking into its siblings.
                    const groupOpacity = typeof effectiveLayer.opacity === 'number'
                        ? Math.max(0, Math.min(1, effectiveLayer.opacity)) : 1;
                    const passThrough = isPassThrough(effectiveLayer.blendMode)
                        && groupOpacity === 1
                        && !effectiveLayer.mask?._maskBitmap;
                    if (passThrough) {
                        drawLayers(effectiveLayer.children, outputCtx);
                        continue;
                    }

                    const groupCanvas = document.createElement('canvas');
                    groupCanvas.width = w;
                    groupCanvas.height = h;
                    const groupCtx = groupCanvas.getContext('2d');
                    if (!groupCtx) continue;
                    drawLayers(effectiveLayer.children, groupCtx);
                    if (effectiveLayer.mask?._maskBitmap && !effectiveLayer.mask.disabled) {
                        groupCtx.save();
                        groupCtx.globalCompositeOperation = 'destination-in';
                        const normalizedMask = getNormalizedMask(
                            effectiveLayer.mask,
                            effectiveLayer.left ?? 0,
                            effectiveLayer.top ?? 0,
                        );
                        if (normalizedMask) groupCtx.drawImage(normalizedMask, 0, 0);
                        groupCtx.restore();
                    }
                    outputCtx.save();
                    outputCtx.globalAlpha = groupOpacity;
                    outputCtx.globalCompositeOperation = resolvePsdBlendMode(effectiveLayer.blendMode);
                    outputCtx.drawImage(groupCanvas, 0, 0);
                    outputCtx.restore();
                } else if (effectiveLayer._bitmap || effectiveLayer.canvas) {
                    try {
                        const op = typeof effectiveLayer.opacity === 'number'
                            ? Math.max(0, Math.min(1, effectiveLayer.opacity))
                            : 1;
                        const source = effectiveLayer._bitmap || effectiveLayer.canvas;
                        const layerLeft = effectiveLayer.left || 0;
                        const layerTop = effectiveLayer.top || 0;
                        const sourceWidth = (source as any).width || w;
                        const sourceHeight = (source as any).height || h;
                        const mask = effectiveLayer.mask;
                        const blendMode = resolvePsdBlendMode(effectiveLayer.blendMode);
                        const needsMask = !!(mask?._maskBitmap && !mask.disabled);
                        const needsClipping = !!(effectiveLayer.clipping && clippingBase);

                        // マスクとクリッピングがないレイヤーは、ブレンドモード
                        // や不透明度があっても直接描画できる。ここでフルサイズの
                        // 一時Canvasを作る処理を完全に省略する。
                        if (!needsMask && !needsClipping) {
                            outputCtx.save();
                            outputCtx.globalAlpha = op;
                            outputCtx.globalCompositeOperation = blendMode;
                            outputCtx.drawImage(source, layerLeft, layerTop);
                            outputCtx.restore();
                            if (layers[i + 1]?.clipping) {
                                let baseVariants = layerSurfaceCacheRef.current.get(source as object);
                                if (!baseVariants) {
                                    baseVariants = new Map();
                                    layerSurfaceCacheRef.current.set(source as object, baseVariants);
                                }
                                const baseKey = `${w}x${h}:${layerLeft}:${layerTop}:base`;
                                let base = baseVariants.get(baseKey);
                                if (!base) {
                                    base = document.createElement('canvas');
                                    base.width = w;
                                    base.height = h;
                                    const baseCtx = base.getContext('2d');
                                    if (baseCtx) {
                                        baseCtx.globalAlpha = op;
                                        baseCtx.drawImage(source, layerLeft, layerTop);
                                    }
                                    baseVariants.set(baseKey, base);
                                }
                                clippingBase = base;
                                clippingBaseIndex = i;
                            } else {
                                clippingBase = null;
                                clippingBaseIndex = null;
                            }
                            continue;
                        }

                        const cacheKey = `${sourceWidth}x${sourceHeight}:${op}:${needsMask ? 'mask' : 'plain'}`;
                        let variants = layerSurfaceCacheRef.current.get(source as object);
                        if (!variants) {
                            variants = new Map();
                            layerSurfaceCacheRef.current.set(source as object, variants);
                        }
                        let target = variants?.get(cacheKey);
                        if (!target) {
                            target = document.createElement('canvas');
                            target.width = sourceWidth;
                            target.height = sourceHeight;
                            const cachedCtx = target.getContext('2d');
                            if (!cachedCtx) return;
                            cachedCtx.globalAlpha = op;
                            cachedCtx.drawImage(source, 0, 0);
                            if (needsMask) {
                                cachedCtx.globalCompositeOperation = 'destination-in';
                                const normalizedMask = getNormalizedMask(mask, layerLeft, layerTop);
                                if (normalizedMask) {
                                    cachedCtx.drawImage(normalizedMask, layerLeft, layerTop, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
                                }
                            }
                            variants.set(cacheKey, target);
                        }

                        // クリッピングだけは前のベースレイヤーに依存するため、
                        // キャッシュ済みの元面を複製してからアルファを掛ける。
                        let outputTarget = target;
                        if (needsClipping && layerClippingBaseIndex === clippingBaseIndex && clippingBase) {
                            outputTarget = document.createElement('canvas');
                            outputTarget.width = sourceWidth;
                            outputTarget.height = sourceHeight;
                            const clipCtx = outputTarget.getContext('2d');
                            if (!clipCtx) return;
                            clipCtx.drawImage(target, 0, 0);
                            clipCtx.globalCompositeOperation = 'destination-in';
                            clipCtx.drawImage(clippingBase, layerLeft, layerTop, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
                        }
                        // Basic clipping-mask support: clip the layer to the
                        // alpha of the previous non-clipped layer. Photoshop's
                        // saved composite remains the fallback for advanced
                        // clipping chains.
                        if (effectiveLayer.clipping && layerClippingBaseIndex === clippingBaseIndex && clippingBase) {
                            // The clipped surface was produced above.
                        }

                        outputCtx.save();
                        outputCtx.globalCompositeOperation = blendMode;
                        outputCtx.drawImage(outputTarget, layerLeft, layerTop);
                        outputCtx.restore();

                        if (!effectiveLayer.clipping) {
                            if (layers[i + 1]?.clipping) {
                                const base = document.createElement('canvas');
                                base.width = w;
                                base.height = h;
                                base.getContext('2d')?.drawImage(target, layerLeft, layerTop);
                                clippingBase = base;
                            } else {
                                clippingBase = null;
                            }
                            clippingBaseIndex = i;
                        }
                    } catch (e) {
                        console.warn('[drawCanvas] Failed to draw layer:', e);
                    } finally {
                        outputCtx.globalAlpha = 1;
                        outputCtx.globalCompositeOperation = 'source-over';
                    }
                }
            }
        };

        if (currentPsd.children) {
            const tDraw0 = performance.now();
            drawLayers(currentPsd.children);
            console.info(`[useEditorCanvas] drawLayers: ${(performance.now() - tDraw0).toFixed(0)}ms`); 
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
