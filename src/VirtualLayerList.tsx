/**
 * VirtualLayerList.tsx
 * 仮想スクロール付きレイヤーリスト（ドラッグ中は全行描画して DnD の座標検出を維持）
 */
import React, {
    memo, useMemo, useCallback, useRef, useEffect, useState, forwardRef,
} from 'react';
import {
    ChevronDown, ChevronRight, Eye, EyeOff,
    Image as ImageIcon, Folder as FolderIcon,
    Trash2, GripVertical,
} from 'lucide-react';
import type { DropTargetInfo } from './types';

export interface FlatLayer {
    layer: any;
    path: number[];
    siblings: any[];
    depth: number;
    hasChildren: boolean;
    isOpen: boolean;
    key: string;
}

interface VirtualLayerListProps {
    flatLayers: FlatLayer[];
    radioEnabled: boolean;
    lockedEnabled: boolean;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
    onToggleExpand: (key: string) => void;
    onDelete: (path: number[]) => void;
    onDragStart: (e: React.MouseEvent, path: number[]) => void;
    draggingPath: number[] | null;
    dropTarget: DropTargetInfo | null;
    height: number;
    className?: string;
}

const ITEM_HEIGHT = 36;
const OVERSCAN = 8;

const THUMB_SIZE = 28;

const LayerThumbnailCell = memo(({
    bitmap, hasChildren,
}: { bitmap?: ImageBitmap; hasChildren: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bitmap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = THUMB_SIZE;
        canvas.height = THUMB_SIZE;
        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);

        const bw = bitmap.width;
        const bh = bitmap.height;
        const scale = Math.min(THUMB_SIZE / bw, THUMB_SIZE / bh);
        const dw = bw * scale;
        const dh = bh * scale;
        const dx = (THUMB_SIZE - dw) / 2;
        const dy = (THUMB_SIZE - dh) / 2;
        ctx.drawImage(bitmap, 0, 0, bw, bh, dx, dy, dw, dh);
    }, [bitmap]);

    return (
        <div className="layer-preview-thumbnail" style={{ flexShrink: 0 }}>
            {bitmap ? (
                <canvas
                    ref={canvasRef}
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                    style={{ display: 'block', width: THUMB_SIZE, height: THUMB_SIZE }}
                />
            ) : hasChildren ? (
                <FolderIcon size={16} className="text-muted" fill="currentColor" fillOpacity={0.1} />
            ) : (
                <ImageIcon size={16} className="text-muted" />
            )}
        </div>
    );
});

interface LayerRowProps {
    flatLayer: FlatLayer;
    radioEnabled: boolean;
    lockedEnabled: boolean;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
    onToggleExpand: (key: string) => void;
    onDelete: (path: number[]) => void;
    onDragStart: (e: React.MouseEvent, path: number[]) => void;
    draggingPath: number[] | null;
    dropTarget: DropTargetInfo | null;
    top: number;
}

const LayerRow = memo(({
    flatLayer, radioEnabled, lockedEnabled,
    onToggle, onRename, onRadioSelect, onToggleExpand, onDelete, onDragStart,
    draggingPath, dropTarget, top,
}: LayerRowProps) => {
    const { layer, path, siblings, depth, hasChildren, isOpen, key } = flatLayer;

    const name = layer.name || '';
    const isRadio = radioEnabled && name.startsWith('*');
    const isLocked = lockedEnabled && name.startsWith('!');
    const displayName = (isRadio || isLocked) ? name.slice(1) : name;

    const isDraggingThis = draggingPath?.join('-') === key;
    const isDropBefore = dropTarget?.path.join('-') === key && dropTarget.position === 'before';
    const isDropAfter = dropTarget?.path.join('-') === key && dropTarget.position === 'after';
    const isDropInside = dropTarget?.path.join('-') === key && dropTarget.position === 'inside';

    const handleVisibilityClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (isLocked) return;
        if (isRadio) onRadioSelect(path, siblings);
        else onToggle(path);
    }, [isLocked, isRadio, path, siblings, onToggle, onRadioSelect]);

    const handleRename = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const prefix = isRadio ? '*' : isLocked ? '!' : '';
        onRename(path, prefix + e.target.value);
    }, [isRadio, isLocked, path, onRename]);

    const handleToggleExpand = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleExpand(key);
    }, [onToggleExpand, key]);

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(path);
    }, [onDelete, path]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        (document.activeElement as HTMLElement)?.blur();
        onDragStart(e, path);
    }, [onDragStart, path]);

    return (
        <div
            style={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height: ITEM_HEIGHT,
                paddingLeft: depth * 20,
                boxSizing: 'border-box',
            }}
        >
            {isDropBefore && <div className="drop-indicator" />}
            <div
                className={[
                    'layer-item',
                    isLocked ? 'layer-locked' : '',
                    isRadio ? 'layer-radio' : '',
                    isDraggingThis ? 'layer-dragging' : '',
                    isDropInside ? 'layer-drop-inside' : '',
                ].filter(Boolean).join(' ')}
                data-path={key}
                data-group={hasChildren ? 'true' : 'false'}
                style={{
                    height: '100%',
                    width: '100%',
                    boxSizing: 'border-box',
                    marginBottom: 0,
                }}
                onMouseDown={(e: React.MouseEvent) => {
                    if ((e.target as HTMLElement).tagName !== 'INPUT')
                        (document.activeElement as HTMLElement)?.blur();
                }}
            >
                <span className="drag-handle" onMouseDown={handleDragStart} title="Drag to reorder">
                    <GripVertical size={12} />
                </span>

                {hasChildren ? (
                    <button
                        type="button"
                        className="toggle-expand"
                        onClick={handleToggleExpand}
                        style={{ flexShrink: 0 }}
                    >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span style={{ width: 24, flexShrink: 0, display: 'inline-block' }} />
                )}

                {!isLocked ? (
                    <div
                        className="visibility-toggle"
                        onClick={handleVisibilityClick}
                        title={isRadio ? 'Select (radio)' : 'Toggle visibility'}
                        style={{ flexShrink: 0 }}
                    >
                        {isRadio ? (
                            <div className={`radio-indicator ${!layer.hidden ? 'active' : ''}`} />
                        ) : !layer.hidden ? (
                            <Eye size={16} className="text-accent" />
                        ) : (
                            <EyeOff size={16} className="text-muted" />
                        )}
                    </div>
                ) : (
                    <span className="visibility-locked" title="Visibility locked" style={{ flexShrink: 0 }}>
                        <Eye size={16} className="text-accent" style={{ opacity: 0.4 }} />
                    </span>
                )}

                <LayerThumbnailCell bitmap={layer._bitmap} hasChildren={hasChildren} />

                <input
                    type="text"
                    className="layer-name-input"
                    value={displayName}
                    onChange={handleRename}
                    placeholder={hasChildren ? 'New Group' : 'New Layer'}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                />

                <button
                    type="button"
                    className="layer-delete-btn"
                    onClick={handleDelete}
                    title="Delete layer"
                    onMouseDown={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        (document.activeElement as HTMLElement)?.blur();
                    }}
                >
                    <Trash2 size={12} />
                </button>
            </div>
            {isDropAfter && <div className="drop-indicator" />}
        </div>
    );
}, (prev, next) => {
    const dtEq = (a: DropTargetInfo | null, b: DropTargetInfo | null) => {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.position === b.position && a.path.join('-') === b.path.join('-');
    };
    return (
        prev.flatLayer.layer === next.flatLayer.layer &&
        prev.flatLayer.isOpen === next.flatLayer.isOpen &&
        prev.radioEnabled === next.radioEnabled &&
        prev.lockedEnabled === next.lockedEnabled &&
        prev.top === next.top &&
        (prev.draggingPath?.join('-') ?? '') === (next.draggingPath?.join('-') ?? '') &&
        dtEq(prev.dropTarget, next.dropTarget)
    );
});

const VirtualLayerListInner = memo(forwardRef<HTMLDivElement, VirtualLayerListProps>(function VirtualLayerList(
    {
        flatLayers,
        radioEnabled,
        lockedEnabled,
        onToggle,
        onRename,
        onRadioSelect,
        onToggleExpand,
        onDelete,
        onDragStart,
        draggingPath,
        dropTarget,
        height,
        className,
    },
    ref,
) {
    const [scrollTop, setScrollTop] = useState(0);
    const totalHeight = flatLayers.length * ITEM_HEIGHT;
    const dragging = draggingPath != null;

    const { startIndex, endIndex } = useMemo(() => {
        if (dragging || flatLayers.length === 0) {
            return { startIndex: 0, endIndex: Math.max(0, flatLayers.length - 1) };
        }
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
        const end = Math.min(
            flatLayers.length - 1,
            start + Math.ceil(height / ITEM_HEIGHT) + OVERSCAN * 2,
        );
        return { startIndex: start, endIndex: end };
    }, [scrollTop, height, flatLayers.length, dragging]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    const visibleRows = useMemo(() => {
        const rows: React.ReactNode[] = [];
        for (let i = startIndex; i <= endIndex; i++) {
            const fl = flatLayers[i];
            if (!fl) continue;
            rows.push(
                <LayerRow
                    key={fl.key}
                    flatLayer={fl}
                    radioEnabled={radioEnabled}
                    lockedEnabled={lockedEnabled}
                    onToggle={onToggle}
                    onRename={onRename}
                    onRadioSelect={onRadioSelect}
                    onToggleExpand={onToggleExpand}
                    onDelete={onDelete}
                    onDragStart={onDragStart}
                    draggingPath={draggingPath}
                    dropTarget={dropTarget}
                    top={i * ITEM_HEIGHT}
                />,
            );
        }
        return rows;
    }, [
        startIndex, endIndex, flatLayers, radioEnabled, lockedEnabled,
        onToggle, onRename, onRadioSelect, onToggleExpand, onDelete, onDragStart,
        draggingPath, dropTarget,
    ]);

    return (
        <div
            ref={ref}
            className={className ?? 'layer-scroll'}
            style={{ height, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, padding: '3px 0' }}
            onScroll={handleScroll}
        >
            <div style={{ position: 'relative', height: totalHeight }}>
                {visibleRows}
            </div>
        </div>
    );
}));

VirtualLayerListInner.displayName = 'VirtualLayerList';

export const VirtualLayerList = VirtualLayerListInner;

export function flattenLayers(
    layers: any[],
    closedKeys: Set<string>,
    flipEnabled: boolean,
    hasFlipSuffix: (name: string) => boolean,
    parentPath: number[] = [],
    depth: number = 0,
    siblings?: any[],
): FlatLayer[] {
    const result: FlatLayer[] = [];
    const actualSiblings = siblings ?? layers;

    [...layers].reverse().forEach((layer, i) => {
        const originalIndex = layers.length - 1 - i;
        const path = [...parentPath, originalIndex];
        const key = path.join('-');
        const hasChildren = !!(layer.children?.length);
        const isOpen = !closedKeys.has(key);

        if (flipEnabled && hasFlipSuffix(layer.name || '')) return;

        result.push({ layer, path, siblings: actualSiblings, depth, hasChildren, isOpen, key });

        if (hasChildren && isOpen) {
            result.push(...flattenLayers(
                layer.children, closedKeys, flipEnabled, hasFlipSuffix,
                path, depth + 1, layer.children,
            ));
        }
    });

    return result;
}
