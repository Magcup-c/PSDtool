import { useState, useRef, useCallback, useEffect } from 'react';
import { FolderOpen, Clock, Trash2, ChevronRight } from 'lucide-react';
import { RecentFile } from '../hooks/useRecentFiles';

interface FileMenuProps {
    recentFiles: RecentFile[];
    onOpen: () => void;
    onOpenRecent: (path: string) => void;
    onClearRecent: () => void;
    language: 'ja' | 'en';
}

const L = {
    ja: {
        file:        'File',
        open:        '開く',
        openRecent:  '最近使ったファイル',
        noRecent:    '履歴なし',
        clearRecent: '履歴を消去',
    },
    en: {
        file:        'File',
        open:        'Open…',
        openRecent:  'Open Recent',
        noRecent:    'No recent files',
        clearRecent: 'Clear Menu',
    },
} as const;

export const FileMenu = ({
    recentFiles, onOpen, onOpenRecent, onClearRecent, language,
}: FileMenuProps) => {
    const t = L[language];
    const [open, setOpen] = useState(false);
    const [recentHover, setRecentHover] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleClose = useCallback(() => {
        closeTimer.current = setTimeout(() => {
            setOpen(false);
            setRecentHover(false);
        }, 150);
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
                setRecentHover(false);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    const handleOpenClick = useCallback(() => {
        setOpen(false);
        setRecentHover(false);
        // Tauri ウィンドウにフォーカスが戻るのを待ってからダイアログを開く
        setTimeout(() => onOpen(), 80);
    }, [onOpen]);

    const handleRecentClick = useCallback((path: string) => {
        setOpen(false);
        setRecentHover(false);
        setTimeout(() => onOpenRecent(path), 80);
    }, [onOpenRecent]);

    const handleClear = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onClearRecent();
    }, [onClearRecent]);

    const handleTriggerClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(v => !v);
        if (open) setRecentHover(false);
    }, [open]);

    return (
        <div
            ref={menuRef}
            className="file-menu-root"
            onMouseLeave={scheduleClose}
            onMouseEnter={cancelClose}
        >
            {/* タイトルバーのトリガーボタン */}
            <button
                className={`file-menu-trigger ${open ? 'active' : ''}`}
                onMouseDown={e => e.stopPropagation()}
                onClick={handleTriggerClick}
                onMouseEnter={() => { cancelClose(); setOpen(true); }}
            >
                {t.file}
            </button>

            {/* ドロップダウン — トリガーとの隙間をなくすため padding-top で橋渡し */}
            {open && (
                <div
                    className="file-menu-dropdown"
                    onMouseEnter={cancelClose}
                    onMouseDown={e => e.stopPropagation()}
                >
                    {/* 開く */}
                    <button
                        className="file-menu-item"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={handleOpenClick}
                    >
                        <FolderOpen size={13} />
                        <span>{t.open}</span>
                        <span className="file-menu-shortcut">Ctrl + O (Open)</span>
                    </button>

                    <div className="file-menu-sep" />

                    {/* 最近使ったファイル（サブメニュー） */}
                    <div
                        className={`file-menu-item has-sub ${recentHover ? 'hover' : ''}`}
                        onMouseEnter={() => { cancelClose(); setRecentHover(true); }}
                        onMouseLeave={() => setRecentHover(false)}
                        onMouseDown={e => e.stopPropagation()}
                    >
                        <Clock size={13} />
                        <span>{t.openRecent}</span>
                        <ChevronRight size={11} className="file-menu-arrow" />

                        {/* サブメニュー */}
                        {recentHover && (
                            <div
                                className="file-menu-submenu"
                                onMouseEnter={cancelClose}
                                onMouseDown={e => e.stopPropagation()}
                            >
                                {recentFiles.length === 0 ? (
                                    <div className="file-menu-empty">{t.noRecent}</div>
                                ) : (
                                    <>
                                        {recentFiles.map(f => (
                                            <button
                                                key={f.path}
                                                className="file-menu-item recent-item"
                                                onClick={() => handleRecentClick(f.path)}
                                                onMouseDown={e => e.stopPropagation()}
                                                title={f.path}
                                            >
                                                <span className="recent-name">{f.name}</span>
                                                <span className="recent-dir">{dirpart(f.path)}</span>
                                            </button>
                                        ))}
                                        <div className="file-menu-sep" />
                                        <button
                                            className="file-menu-item clear-item"
                                            onClick={handleClear}
                                            onMouseDown={e => e.stopPropagation()}
                                        >
                                            <Trash2 size={11} />
                                            <span>{t.clearRecent}</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

function dirpart(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const dir = normalized.substring(0, normalized.lastIndexOf('/'));
    const parts = dir.split('/').filter(Boolean);
    if (parts.length <= 2) return dir;
    return '…/' + parts.slice(-2).join('/');
}