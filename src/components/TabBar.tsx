/**
 * src/components/TabBar.tsx
 *
 * 修正: handleAuxClick に e.stopPropagation() を追加
 *       ミドルクリック時のブラウザ・オートスクロール起動を防止
 */

import { useRef, useState, useCallback } from 'react';
import { X, Plus, FileImage } from 'lucide-react';
import { TabState } from '../hooks/useTabManager';

interface TabBarProps {
    tabs: TabState[];
    activeId: string;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onNewTab: () => void;
    onReorder: (fromId: string, toId: string) => void;
    language: 'ja' | 'en';
}

export const TabBar = ({
    tabs, activeId, onActivate, onClose, onNewTab, onReorder, language,
}: TabBarProps) => {
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const dragIdRef = useRef<string | null>(null);

    const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
        dragIdRef.current = id;
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
        e.preventDefault();
        if (dragIdRef.current !== id) setDragOverId(id);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, toId: string) => {
        e.preventDefault();
        const fromId = dragIdRef.current;
        if (fromId && fromId !== toId) onReorder(fromId, toId);
        setDragOverId(null);
        dragIdRef.current = null;
    }, [onReorder]);

    const handleDragEnd = useCallback(() => {
        setDragOverId(null);
        dragIdRef.current = null;
    }, []);

    const handleCloseClick = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onClose(id);
    }, [onClose]);

    // ✅ stopPropagation を追加してオートスクロールや親イベントへの伝播を防止
    const handleAuxClick = useCallback((e: React.MouseEvent, id: string) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            onClose(id);
        }
    }, [onClose]);

    return (
        <div className="tab-bar" onDragLeave={() => setDragOverId(null)}>
            <div className="tab-bar-inner">
                {tabs.map(tab => {
                    const isActive   = tab.id === activeId;
                    const isDragOver = tab.id === dragOverId;
                    return (
                        <div
                            key={tab.id}
                            className={[
                                'tab-item',
                                isActive   ? 'active'    : '',
                                isDragOver ? 'drag-over' : '',
                                tab.isLoading ? 'loading' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => onActivate(tab.id)}
                            onAuxClick={e => handleAuxClick(e, tab.id)}
                            draggable
                            onDragStart={e => handleDragStart(e, tab.id)}
                            onDragOver={e => handleDragOver(e, tab.id)}
                            onDrop={e => handleDrop(e, tab.id)}
                            onDragEnd={handleDragEnd}
                            title={tab.filePath ?? tab.fileName}
                        >
                            {tab.isLoading ? (
                                <span className="tab-spinner" />
                            ) : (
                                <FileImage size={12} className="tab-file-icon" />
                            )}
                            <span className="tab-name">
                                {tab.isDirty ? '● ' : ''}{tab.fileName}
                            </span>
                            <button
                                className="tab-close"
                                onClick={e => handleCloseClick(e, tab.id)}
                                title={language === 'ja' ? '閉じる' : 'Close'}
                                aria-label="Close tab"
                            >
                                <X size={11} />
                            </button>
                        </div>
                    );
                })}
            </div>
            <button
                className="tab-new-btn"
                onClick={onNewTab}
                title={language === 'ja' ? '新しいタブ' : 'New tab'}
                aria-label="Open new tab"
            >
                <Plus size={13} />
            </button>
        </div>
    );
};