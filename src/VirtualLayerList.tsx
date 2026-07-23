/**
 * VirtualLayerList.tsx
 * 仮想スクロール付きレイヤーリスト（ドラッグ中は全行描画して DnD の座標検出を維持）
 *
 * 修正: LayerThumbnailCell — bitmap が close 済みでエラーになった場合に
 *       dataUrl へフォールバックし、UIにアイコンが表示されるよう改善
 */
import React, {
    memo, useMemo, useCallback, useEffect, useState, forwardRef,
} from 'react';
import {
    ChevronDown, ChevronRight, Eye, EyeOff,
    Image as ImageIcon, Folder as FolderIcon,
    Trash2, GripVertical,
} from 'lucide-react';
import type { DropTargetInfo, PsdLayerNode } from './types';

export interface FlatLayer {
    layer: PsdLayerNode;
    path: number[];
    siblings: PsdLayerNode[];
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
    onRadioSelect: (path: number[], siblings: PsdLayerNode[]) => void;
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
const THUMB_SIZE = 22;

// ── ステップダウンスケール ────────────────────────────────────────────────────
function drawStepDown(
    ctx: OffscreenCanvasRenderingContext2D,
    src: ImageBitmap,
    targetW: number,
    targetH: number,
): void {
    let curW = src.width;
    let curH = src.height;
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

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (cur) {
        ctx.drawImage(cur, 0, 0, targetW, targetH);
    } else {
        ctx.drawImage(src, 0, 0, targetW, targetH);
    }
}

// ── サムネイルセル ────────────────────────────────────────────────────────────
const LayerThumbnailCell = memo(({
    bitmap, dataUrl, hasChildren,
}: { bitmap?: ImageBitmap | null; dataUrl?: string | null; hasChildren: boolean }) => {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    // bitmap の描画に失敗したかどうか（close済みなど）
    const [bitmapFailed, setBitmapFailed] = useState(false);

    useEffect(() => {
        // bitmap が変わったらエラーフラグをリセット
        setBitmapFailed(false);

        if (!bitmap || hasChildren) { setObjectUrl(null); return; }
        let cancelled = false;
        let createdUrl: string | null = null;

        (async () => {
            try {
                const dpr = Math.max(1, window.devicePixelRatio ?? 1);
                const canvasPx = Math.round(THUMB_SIZE * dpr);

                const bw = bitmap.width || 1;
                const bh = bitmap.height || 1;
                const scale = Math.min(1, canvasPx / bw, canvasPx / bh);
                const dw = Math.max(1, Math.round(bw * scale));
                const dh = Math.max(1, Math.round(bh * scale));
                const dx = Math.floor((canvasPx - dw) / 2);
                const dy = Math.floor((canvasPx - dh) / 2);

                const oc = new OffscreenCanvas(canvasPx, canvasPx);
                const ctx = oc.getContext('2d')!;

                const tmp = new OffscreenCanvas(dw, dh);
                const tctx = tmp.getContext('2d')!;
                drawStepDown(tctx, bitmap, dw, dh);

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(tmp, dx, dy);

                const blob = await oc.convertToBlob({ type: 'image/png' });
                const url = URL.createObjectURL(blob);

                if (cancelled) { URL.revokeObjectURL(url); return; }
                createdUrl = url;
                setObjectUrl(prev => {
                    if (prev) URL.revokeObjectURL(prev);
                    return url;
                });
            } catch {
                // bitmap が close() 済みなどの場合は dataUrl へフォールバック
                if (!cancelled) {
                    setObjectUrl(null);
                    setBitmapFailed(true);
                }
            }
        })();

        return () => {
            cancelled = true;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [bitmap, hasChildren]);

    // objectUrl → dataUrl (bitmapFailed 時) → アイコン の順でフォールバック
    const src = objectUrl ?? ((!hasChildren && (bitmapFailed || !bitmap)) ? (dataUrl ?? null) : null);

    return (
        <div className="layer-preview-thumbnail" style={{ flexShrink: 0 }}>
            {src ? (
                <img src={src} alt="" className="layer-thumbnail-img" />
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
    onRadioSelect: (path: number[], siblings: PsdLayerNode[]) => void;
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
                    <span style={{ width: 18, flexShrink: 0, display: 'inline-block' }} />
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

                <LayerThumbnailCell
                    bitmap={layer._bitmap}
                    dataUrl={layer._dataUrl}
                    hasChildren={hasChildren}
                />

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
    layers: PsdLayerNode[],
    closedKeys: Set<string>,
    flipEnabled: boolean,
    hasFlipSuffix: (name: string) => boolean,
    parentPath: number[] = [],
    depth: number = 0,
    siblings?: PsdLayerNode[],
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
                layer.children || [], closedKeys, flipEnabled, hasFlipSuffix,
                path, depth + 1, layer.children || [],
            ));
        }
    });

    return result;
}