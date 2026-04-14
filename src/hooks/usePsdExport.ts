import { useCallback, RefObject } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { PsdRoot, PsdLayerNode, LocaleStrings } from '../types';
import { AppSettings } from './useSettings';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export async function exportCanvas(
    canvas: HTMLCanvasElement,
    format: ExportFormat,
    quality: number,
): Promise<Uint8Array> {
    if (format === 'svg') {
        const svgStr =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">` +
            `<image href="${canvas.toDataURL('image/png')}" width="${canvas.width}" height="${canvas.height}"/>` +
            `</svg>`;
        return new TextEncoder().encode(svgStr);
    }
    const mimeMap: Record<ExportFormat, string> = {
        png:  'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        svg:  'image/png',
    };
    return new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) { reject(new Error('toBlob failed')); return; }
            blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab))).catch(reject);
        }, mimeMap[format], format === 'png' ? undefined : quality);
    });
}

export async function renderPsdToBytes(psd: PsdRoot): Promise<Uint8Array> {
    const oc  = new OffscreenCanvas(psd.width, psd.height);
    const ctx = oc.getContext('2d')!;

    const drawLayers = (layers: PsdLayerNode[]) => {
        for (const layer of layers) {
            if (layer.hidden) continue;
            if (layer.children) drawLayers(layer.children);
            else if (layer._bitmap) ctx.drawImage(layer._bitmap, layer.left || 0, layer.top || 0);
        }
    };
    if (psd.children) drawLayers(psd.children);

    const blob = await oc.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
}

export function usePsdExport(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    psd: PsdRoot | null,
    settings: AppSettings,
    showToast: (msg: string, type?: 'success' | 'error') => void,
    L: LocaleStrings,
) {
    const handleExportPng = useCallback(async () => {
        if (!canvasRef.current || !psd) return;
        const fmt     = (settings.exportFormat ?? 'png') as ExportFormat;
        const quality = settings.exportQuality ?? 0.92;
        const extMap:  Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg' };
        const nameMap: Record<ExportFormat, string> = { png: 'PNG Image', jpeg: 'JPEG Image', webp: 'WebP Image', svg: 'SVG File' };
        try {
            const selected = await save({
                title: `Export as ${fmt.toUpperCase()}`,
                filters: [{ name: nameMap[fmt], extensions: [extMap[fmt]] }],
            });
            if (selected) {
                const bytes = await exportCanvas(canvasRef.current, fmt, quality);
                await writeFile(selected, bytes);
                showToast(L.exportSuccess as string);
            }
        } catch (err) { showToast(`${L.exportFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error'); }
    }, [canvasRef, psd, settings.exportFormat, settings.exportQuality, showToast, L]);

    return { handleExportPng };
}
