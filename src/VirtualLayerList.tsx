/**
 * VirtualLayerList.tsx
 * 自前実装の仮想スクロール付きレイヤーリスト
 */
import React, {
    memo, useMemo, useCallback, useRef, useEffect, useState
} from 'react';
import {
    ChevronDown, ChevronRight, Eye, EyeOff,
    Image as ImageIcon, Folder as FolderIcon,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────
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
    onToggleOpen: (key: string) => void;
    height: number;
}

// CSSの .layer-item { padding: 0.5rem 0.75rem } + border 1px = 実測値に合わせる
// ブラウザの DevTools で .layer-item の offsetHeight を確認して調整
const ITEM_HEIGHT = 36;
const OVERSCAN = 6;

// ────────────────────────────────────────────────────────────
// サムネイルセル
// ────────────────────────────────────────────────────────────
// サムネイルセル（動的アスペクト比対応版）
//
// 高さを THUMB_H に固定し、幅をビットマップのアスペクト比から
// 動的に計算する（最小 THUMB_H、最大 THUMB_MAX_W）。
// これにより縦長・横長・正方形どのレイヤーも正しく表示される。
// ────────────────────────────────────────────────────────────
const THUMB_SIZE = 28; // コンテナは常に 28×28 固定

const LayerThumbnailCell = memo(({
    bitmap, hasChildren,
}: { bitmap?: ImageBitmap; hasChildren: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !bitmap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 論理サイズを 28×28 に固定
        canvas.width = THUMB_SIZE;
        canvas.height = THUMB_SIZE;
        ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);

        // object-fit: contain 相当の計算
        // アスペクト比を維持しながら 28×28 に収め、余白は空白のまま
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
        // コンテナは CSS クラスの 28×28 固定サイズをそのまま使う
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

// ────────────────────────────────────────────────────────────
// 1行レイヤーアイテム
// ────────────────────────────────────────────────────────────
interface LayerRowProps {
    flatLayer: FlatLayer;
    radioEnabled: boolean;
    lockedEnabled: boolean;
    onToggle: (path: number[]) => void;
    onRename: (path: number[], newName: string) => void;
    onRadioSelect: (path: number[], siblings: any[]) => void;
    onToggleOpen: (key: string) => void;
    top: number;
}

const LayerRow = memo(({
    flatLayer, radioEnabled, lockedEnabled,
    onToggle, onRename, onRadioSelect, onToggleOpen, top,
}: LayerRowProps) => {
    const { layer, path, siblings, depth, hasChildren, isOpen, key } = flatLayer;

    const name = layer.name || '';
    const isRadio = radioEnabled && name.startsWith('*');
    const isLocked = lockedEnabled && name.startsWith('!');
    const displayName = (isRadio || isLocked) ? name.slice(1) : name;

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

    const handleToggleOpen = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleOpen(key);
    }, [onToggleOpen, key]);

    return (
        <div
            style={{
                position: 'absolute',
                top,
                left: 0,
                right: 0,
                height: ITEM_HEIGHT,
                // インデントは外側ラッパーで吸収してCSSに干渉させない
                paddingLeft: depth * 20,
                boxSizing: 'border-box',
            }}
        >
            <div
                className={`layer-item ${isLocked ? 'layer-locked' : ''} ${isRadio ? 'layer-radio' : ''}`}
                style={{
                    height: '100%',
                    // [FIX] flex コンテナの幅を 100% に固定
                    width: '100%',
                    boxSizing: 'border-box',
                    // margin をリセットして行高さのズレを防ぐ
                    marginBottom: 0,
                }}
            >
                {/* 展開ボタン or スペーサー（固定幅で縮まない） */}
                {hasChildren ? (
                    <button
                        className="toggle-expand"
                        onClick={handleToggleOpen}
                        style={{ flexShrink: 0 }}
                    >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                ) : (
                    <span style={{ width: 24, flexShrink: 0, display: 'inline-block' }} />
                )}

                {/* 表示/非表示トグル（固定幅） */}
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

                {/* サムネイル（固定幅） */}
                <LayerThumbnailCell bitmap={layer._thumb} hasChildren={hasChildren} />

                {/* レイヤー名: min-width:0 で flex 縮小を許可し、はみ出しを防ぐ */}
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
            </div>
        </div>
    );
}, (prev, next) =>
    prev.flatLayer.layer === next.flatLayer.layer &&
    prev.flatLayer.isOpen === next.flatLayer.isOpen &&
    prev.radioEnabled === next.radioEnabled &&
    prev.lockedEnabled === next.lockedEnabled &&
    prev.top === next.top
);

// ────────────────────────────────────────────────────────────
// 仮想スクロールコンテナ
// ────────────────────────────────────────────────────────────
export const VirtualLayerList = memo(({
    flatLayers, radioEnabled, lockedEnabled,
    onToggle, onRename, onRadioSelect, onToggleOpen, height,
}: VirtualLayerListProps) => {
    const [scrollTop, setScrollTop] = useState(0);
    const totalHeight = flatLayers.length * ITEM_HEIGHT;

    const { startIndex, endIndex } = useMemo(() => {
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
        const end = Math.min(
            flatLayers.length - 1,
            start + Math.ceil(height / ITEM_HEIGHT) + OVERSCAN * 2,
        );
        return { startIndex: start, endIndex: end };
    }, [scrollTop, height, flatLayers.length]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    const visibleRows = useMemo(() => {
        const rows = [];
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
                    onToggleOpen={onToggleOpen}
                    top={i * ITEM_HEIGHT}
                />
            );
        }
        return rows;
    }, [startIndex, endIndex, flatLayers, radioEnabled, lockedEnabled,
        onToggle, onRename, onRadioSelect, onToggleOpen]);

    return (
        <div
            style={{ height, overflowY: 'auto', overflowX: 'hidden' }}
            onScroll={handleScroll}
        >
            {/* [FIX] totalHeight で全アイテム分の高さを確保してスクロール量を正確にする */}
            <div style={{ position: 'relative', height: totalHeight }}>
                {visibleRows}
            </div>
        </div>
    );
});

// ────────────────────────────────────────────────────────────
// ツリー → フラット配列変換
// ────────────────────────────────────────────────────────────
export function flattenLayers(
    layers: any[],
    openKeys: Set<string>,
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
        const isOpen = openKeys.has(key);

        if (flipEnabled && hasFlipSuffix(layer.name || '')) return;

        result.push({ layer, path, siblings: actualSiblings, depth, hasChildren, isOpen, key });

        if (hasChildren && isOpen) {
            result.push(...flattenLayers(
                layer.children, openKeys, flipEnabled, hasFlipSuffix,
                path, depth + 1, layer.children,
            ));
        }
    });

    return result;
}
