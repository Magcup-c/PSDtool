/**
 * src/components/LayerThumbnail.tsx
 *
 * _bitmap（フルサイズ ImageBitmap）を受け取り、
 * 段階的縮小（ステップダウンスケール）で高品質なサムネイルを生成して表示する。
 * フォルダー（hasChildren=true）は bitmap を持たないのでアイコン表示のみ。
 */

import { memo, useState, useEffect } from 'react';
import { Image as ImageIcon, Folder as FolderIcon } from 'lucide-react';

interface LayerThumbnailProps {
    dataUrl?: string | null;
    bitmap?: ImageBitmap | null;
    hasChildren: boolean;
}

const CONTAINER_PX = 22;

/**
 * 大きい ImageBitmap を小さい canvas に1ステップで縮小すると
 * ブラウザの bilinear フィルタが荒くなる。
 * 「半分ずつ縮小」を繰り返すことで品質を保つ（ミップマップ的手法）。
 */
function drawStepDown(
    ctx: OffscreenCanvasRenderingContext2D,
    src: ImageBitmap,
    targetW: number,
    targetH: number,
): void {
    let curW = src.width;
    let curH = src.height;

    // 最初のステップ: src → 中間 canvas
    let cur: OffscreenCanvas | null = null;

    while (curW > targetW * 2 || curH > targetH * 2) {
        const nextW = Math.max(Math.floor(curW / 2), targetW);
        const nextH = Math.max(Math.floor(curH / 2), targetH);
        const tmp = new OffscreenCanvas(nextW, nextH);
        const tctx = tmp.getContext('2d')!;
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        if (cur) {
            tctx.drawImage(cur, 0, 0, nextW, nextH);
        } else {
            tctx.drawImage(src, 0, 0, nextW, nextH);
        }
        cur = tmp;
        curW = nextW;
        curH = nextH;
    }

    // 最終ステップ: 目的サイズの canvas に contain 描画
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (cur) {
        ctx.drawImage(cur, 0, 0, targetW, targetH);
    } else {
        ctx.drawImage(src, 0, 0, targetW, targetH);
    }
}

async function bitmapToObjectUrl(bitmap: ImageBitmap): Promise<string> {
    const dpr = Math.max(1, window.devicePixelRatio ?? 1);
    const canvasPx = Math.round(CONTAINER_PX * dpr);

    const bw = bitmap.width  || 1;
    const bh = bitmap.height || 1;
    // 小さいレイヤーの拡大はガビつくので、1x 以上の拡大はしない
    const scale = Math.min(1, canvasPx / bw, canvasPx / bh);
    const dw = Math.max(1, Math.round(bw * scale));
    const dh = Math.max(1, Math.round(bh * scale));
    const dx = Math.floor((canvasPx - dw) / 2);
    const dy = Math.floor((canvasPx - dh) / 2);

    const oc = new OffscreenCanvas(canvasPx, canvasPx);
    const ctx = oc.getContext('2d')!;

    // contain 用の一時 canvas に段階縮小してから最終配置
    const tmp = new OffscreenCanvas(dw, dh);
    const tctx = tmp.getContext('2d')!;
    drawStepDown(tctx, bitmap, dw, dh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, dx, dy);

    const blob = await oc.convertToBlob({ type: 'image/png' });
    return URL.createObjectURL(blob);
}

export const LayerThumbnail = memo(
    ({ dataUrl, bitmap, hasChildren }: LayerThumbnailProps) => {
        const [objectUrl, setObjectUrl] = useState<string | null>(null);

        useEffect(() => {
            // フォルダーや bitmap なしの場合は変換しない
            if (!bitmap || hasChildren) { setObjectUrl(null); return; }
            let cancelled = false;
            let createdUrl: string | null = null;

            bitmapToObjectUrl(bitmap).then((url) => {
                if (cancelled) { URL.revokeObjectURL(url); return; }
                createdUrl = url;
                setObjectUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return url;
                });
            });

            return () => {
                cancelled = true;
                if (createdUrl) URL.revokeObjectURL(createdUrl);
            };
        }, [bitmap, hasChildren]);

        const src = objectUrl ?? (!hasChildren ? dataUrl : null);

        return (
            <div className="layer-preview-thumbnail">
                {src ? (
                    <img src={src} alt="" className="layer-thumbnail-img" />
                ) : hasChildren ? (
                    <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
                ) : (
                    <ImageIcon size={16} className="text-muted" />
                )}
            </div>
        );
    },
);
