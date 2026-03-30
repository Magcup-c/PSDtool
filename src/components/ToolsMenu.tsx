/**
 * src/components/ToolsMenu.tsx
 *
 * 修正点:
 *   - onMouseLeave で即閉じていた問題 → scheduleClose/cancelClose で 150ms の猶予
 *   - `cancelClose` が定義前に dropdown の onMouseEnter で参照されていたバグを解消
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, Layers, GitCompare, Grid2x2, FolderDown } from 'lucide-react';
import { BatchModal }        from './tools/BatchModal';
import { ExportLayersModal } from './tools/ExportLayersModal';
import { CompareModal }      from './tools/CompareModal';
import { SpriteModal }       from './tools/SpriteModal';

type Tool = 'batch' | 'exportLayers' | 'compare' | 'sprite' | null;

interface ToolsMenuProps {
    currentFilePath: string | null;
    language: 'ja' | 'en';
}

const L = {
    ja: {
        tools:        'Tools',
        batch:        'Batch変換',
        exportLayers: 'レイヤー個別Export',
        compare:      'PSD比較 (Diff)',
        sprite:       'スプライトシート',
    },
    en: {
        tools:        'Tools',
        batch:        'Batch Convert',
        exportLayers: 'Export Layers',
        compare:      'Compare PSDs',
        sprite:       'Sprite Sheet',
    },
} as const;

export const ToolsMenu = ({ currentFilePath, language }: ToolsMenuProps) => {
    const t = L[language];
    const [open, setOpen]     = useState(false);
    const [active, setActive] = useState<Tool>(null);
    const menuRef             = useRef<HTMLDivElement>(null);
    const closeTimer          = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── ホバー遅延クローズ（FileMenu と同じパターン）──────────────────────
    const scheduleClose = useCallback(() => {
        closeTimer.current = setTimeout(() => setOpen(false), 150);
    }, []);

    const cancelClose = useCallback(() => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }, []);

    // メニュー外クリックで閉じる
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    const openTool = useCallback((tool: Tool) => {
        setOpen(false);
        setActive(tool);
    }, []);

    const items: { key: Tool; label: string; icon: React.ReactNode }[] = [
        { key: 'batch',        label: t.batch,        icon: <FolderDown size={13} /> },
        { key: 'exportLayers', label: t.exportLayers, icon: <Layers size={13} /> },
        { key: 'compare',      label: t.compare,      icon: <GitCompare size={13} /> },
        { key: 'sprite',       label: t.sprite,       icon: <Grid2x2 size={13} /> },
    ];

    return (
        <>
            <div
                ref={menuRef}
                className="file-menu-root"
                onMouseLeave={scheduleClose}
                onMouseEnter={cancelClose}
            >
                <button
                    className={`file-menu-trigger ${open ? 'active' : ''}`}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => setOpen(v => !v)}
                    onMouseEnter={() => { cancelClose(); setOpen(true); }}
                >
                    {t.tools}
                </button>

                {open && (
                    <div
                        className="file-menu-dropdown"
                        onMouseEnter={cancelClose}
                        onMouseDown={e => e.stopPropagation()}
                    >
                        {items.map(item => (
                            <button
                                key={item.key}
                                className="file-menu-item"
                                onClick={() => openTool(item.key)}
                                onMouseDown={e => e.stopPropagation()}
                            >
                                {item.icon}
                                <span>{item.label}</span>
                                <ChevronRight size={11} style={{ marginLeft: 'auto', color: 'var(--fg-3)' }} />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {active === 'batch'        && <BatchModal        language={language} onClose={() => setActive(null)} />}
            {active === 'exportLayers' && <ExportLayersModal language={language} currentFilePath={currentFilePath} onClose={() => setActive(null)} />}
            {active === 'compare'      && <CompareModal      language={language} currentFilePath={currentFilePath} onClose={() => setActive(null)} />}
            {active === 'sprite'       && <SpriteModal       language={language} onClose={() => setActive(null)} />}
        </>
    );
};