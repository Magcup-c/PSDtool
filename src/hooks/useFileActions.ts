import { useCallback } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { writePsd } from 'ag-psd';
import { PsdRoot, LocaleStrings } from '../types';

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
                await writeFile(selected, new Uint8Array(writePsd(psd) as ArrayBuffer));
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
