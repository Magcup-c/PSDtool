import { useCallback } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { writePsd } from 'ag-psd';
import { PsdRoot, PsdLayerNode, LocaleStrings } from '../types';

interface UseFileActionsProps {
    psd: PsdRoot | null;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    openPsdUnified: (path: string) => void;
    showToast: (msg: string, type?: 'success' | 'error') => void;
    L: LocaleStrings;
    activeId: string;
    updateTab: (id: string, state: any) => void;
    language: string;
}

/**
 * ワーカー側で stripCanvas() により削除された layer.canvas を、
 * 保持している _bitmap (ImageBitmap) から一時的に再構築する。
 * ag-psd の writePsd() は layer.canvas / layer.imageData がないと
 * ピクセルデータを書き出せず、空・透明なレイヤーになってしまうため必須。
 */
async function withRebuiltCanvases(layers: PsdLayerNode[]): Promise<PsdLayerNode[]> {
    return Promise.all(layers.map(async (layer) => {
        const next: PsdLayerNode = { ...layer };

        if (layer.children?.length) {
            next.children = await withRebuiltCanvases(layer.children);
            return next;
        }

        if (layer._bitmap) {
            const bmp = layer._bitmap;
            const canvas = new OffscreenCanvas(bmp.width, bmp.height);
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(bmp, 0, 0);
                (next as any).canvas = canvas;
            }
        }

        if (layer.mask?._maskBitmap) {
            const bmp = layer.mask._maskBitmap;
            const maskCanvas = new OffscreenCanvas(bmp.width, bmp.height);
            const maskCtx = maskCanvas.getContext('2d');
            if (maskCtx) {
                maskCtx.drawImage(bmp, 0, 0);
                next.mask = { ...layer.mask, canvas: maskCanvas };
            }
        }

        return next;
    }));
}

async function buildPsdForSave(psd: PsdRoot): Promise<PsdRoot> {
    return {
        ...psd,
        children: psd.children ? await withRebuiltCanvases(psd.children) : psd.children,
    };
}

export const useFileActions = ({
    psd, canvasRef, openPsdUnified, showToast, L, activeId, updateTab, language
}: UseFileActionsProps) => {

    const handleOpenFile = useCallback(async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'PSD Image', extensions: ['psd'] }]
            });
            if (selected && typeof selected === 'string') {
                openPsdUnified(selected);
            }
        } catch (err) {
            showToast(`${L.openFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [openPsdUnified, showToast, L]);

    const handleCopyCanvas = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            await new Promise<void>((resolve, reject) => {
                canvas.toBlob(async blob => {
                    if (!blob) { reject(new Error('toBlob failed')); return; }
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        resolve();
                    } catch (e) { reject(e); }
                }, 'image/png');
            });
            showToast(L.copied);
        } catch (err) {
            showToast(`${L.copyFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    }, [showToast, L, canvasRef]);

    const handleSaveFile = async () => {
        if (!psd) return;
        try {
            const selected = await save({
                title: language === 'ja' ? 'PSDファイルを保存' : 'Save PSD File',
                filters: [{ name: 'PSD Image', extensions: ['psd'] }],
            });
            if (selected) {
                // ★ 保存直前に canvas を再構築してから writePsd に渡す
                const psdForSave = await buildPsdForSave(psd);
                await writeFile(selected, new Uint8Array(writePsd(psdForSave) as ArrayBuffer));
                updateTab(activeId, {
                    isDirty: false,
                    filePath: selected,
                    fileName: selected.replace(/\\/g, '/').split('/').pop() ?? selected,
                });
                showToast(L.saveSuccess);
            }
        } catch (err) {
            showToast(`${L.saveFailed}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
    };

    return {
        handleOpenFile,
        handleCopyCanvas,
        handleSaveFile
    };
};
