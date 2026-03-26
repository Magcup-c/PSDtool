import React from 'react';
import { Monitor } from 'lucide-react';
import { Psd } from 'ag-psd';

interface PreviewAreaProps {
    psd: Psd | null;
    isLoading: boolean;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    canvasContainerRef: React.RefObject<HTMLDivElement | null>;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    SCROLL_AREA: number;
    L: any;
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
            {isLoading ? (
                <div className="preview-loading">
                    <div className="preview-loading-inner">
                        <div className="loading-spinner" aria-hidden="true" />
                        <p className="loading-label">{L.loading}</p>
                    </div>
                </div>
            ) : psd ? (
                <div className="preview-scroll-inner" style={{ width: SCROLL_AREA, height: SCROLL_AREA, position: 'relative' }}>
                    <div
                        ref={canvasContainerRef}
                        className="canvas-container"
                        style={{
                            position: 'absolute',
                            left: SCROLL_AREA / 2 - psd.width / 2,
                            top: SCROLL_AREA / 2 - psd.height / 2,
                            width: psd.width,
                            height: psd.height,
                            transformOrigin: 'top left',
                        }}
                    >
                        <canvas ref={canvasRef} />
                    </div>
                </div>
            ) : (
                <div className="placeholder" style={{ position: 'absolute', inset: 0 }}>
                    <Monitor className="placeholder-icon" />
                    <p>{L.dropPsd}</p>
                </div>
            )}
        </div>
    );
};
