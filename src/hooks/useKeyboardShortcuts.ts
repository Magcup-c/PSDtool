import { useEffect } from 'react';
import { TabState } from './useTabManager';

interface KeyboardShortcutHandlers {
    handleUndo: () => void;
    handleRedo: () => void;
    handleCopyCanvas: () => void;
    handleToggleFullscreen: () => void;
    handleOpenFile: () => void;
    setShowSettings: (show: boolean) => void;
    handleZoom: (amount: number) => void;
    centerPsd: () => void;
    tabs: TabState[];
    activeId: string;
    handleActivateTab: (id: string) => void;
    handleCloseTab: (id: string) => void;
    handleNewTab: () => void;
}

export function useKeyboardShortcuts({
    handleUndo, handleRedo, handleCopyCanvas, handleToggleFullscreen,
    handleOpenFile, setShowSettings, handleZoom, centerPsd,
    tabs, activeId, handleActivateTab, handleCloseTab, handleNewTab
}: KeyboardShortcutHandlers) {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
            if ((e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) ||
                (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); handleRedo(); return; }
            if (e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) {
                if (window.getSelection()?.toString().length) return;
                e.preventDefault(); handleCopyCanvas();
            }
            if (e.key === 'F11') { e.preventDefault(); handleToggleFullscreen(); return; }
            if (e.key.toLowerCase() === 'o' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleOpenFile(); return; }
            if (e.key === ',' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowSettings(true); return; }
            if (e.key === 'F5') { e.preventDefault(); return; }
            if (e.key === 'F12') { e.preventDefault(); return; }
            if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
            if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
            if (e.key.toLowerCase() === 'r' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
            if (e.key.toLowerCase() === 'i' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); return; }
            if ((e.key === '+' || e.key === ';') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(0.1); return; }
            if ((e.key === '=' || e.key === '-') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleZoom(-0.1); return; }
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); centerPsd(); return; }
            if (e.key === 'Tab' && e.ctrlKey) {
                e.preventDefault();
                const idx  = tabs.findIndex(t => t.id === activeId);
                const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
                handleActivateTab(tabs[next].id);
            }
            if (e.key.toLowerCase() === 'w' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleCloseTab(activeId); }
            if (e.key.toLowerCase() === 't' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleNewTab(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleUndo, handleRedo, handleCopyCanvas, handleOpenFile, handleToggleFullscreen,
        handleZoom, centerPsd, tabs, activeId, handleActivateTab, handleCloseTab, handleNewTab, setShowSettings]);
}
