import React from 'react';
import { Monitor } from 'lucide-react';
import { PsdRoot, LocaleStrings } from '../../types';

interface PreviewAreaProps {
    activeTabId: string;
    psd: PsdRoot | null;
    isLoading: boolean;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    canvasContainerRef: React.RefObject<HTMLDivElement | null>;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    SCROLL_AREA: number;
    L: LocaleStrings;
}

export const PreviewArea: React.FC<PreviewAreaProps> = ({
    psd, isLoading, scrollRef, canvasContainerRef, canvasRef, SCROLL_AREA, L
}) => {
    return (
        <div
            className="preview-panel"
            ref={scrollRef}
            style={{ overflow: 'scroll', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
            aria-label="PSD Canvas Preview"
            role="img"
        >
            {/* ローディングオーバーレイ */}
            {isLoading && (
                <div className="preview-loading">
                    <div className="preview-loading-inner">
                        <div className="loading-spinner" aria-hidden="true" />
                        <p className="loading-label">{L.loading}</p>
                    </div>
                </div>
            )}

            {/* placeholder: psd がなくローディングでもない時に表示 */}
            {!psd && !isLoading && (
                <div className="placeholder" style={{ position: 'absolute', inset: 0 }}>
                    <Monitor className="placeholder-icon" />
                    <p>{L.dropPsd}</p>
                </div>
            )}

            {/*
             * canvas は常に DOM に存在させる。
             * psd=null の時は visibility:hidden で非表示にするだけで
             * canvasRef / canvasContainerRef が常に有効な DOM ノードを指し続ける。
             * これにより タブ切り替え時に psd が null→non-null になる瞬間でも
             * applyZoom や drawCanvas が正しく動作する。
             */}
            <div
                className="preview-scroll-inner"
                style={{
                    width: SCROLL_AREA,
                    height: SCROLL_AREA,
                    position: 'relative',
                    visibility: psd ? 'visible' : 'hidden',
                }}
            >
                <div
                    ref={canvasContainerRef}
                    className="canvas-container"
                    style={{
                        position: 'absolute',
                        left: psd ? SCROLL_AREA / 2 - psd.width  / 2 : 0,
                        top:  psd ? SCROLL_AREA / 2 - psd.height / 2 : 0,
                        width:  psd ? psd.width  : 0,
                        height: psd ? psd.height : 0,
                        transformOrigin: 'top left',
                    }}
                >
                    <canvas ref={canvasRef} />
                </div>
            </div>
        </div>
    );
};