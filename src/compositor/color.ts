export type PsdColorMode = 'bitmap' | 'grayscale' | 'indexed' | 'rgb' | 'cmyk' | 'multichannel' | 'duotone' | 'lab' | 'unknown';

export interface ColorPipeline {
    mode: PsdColorMode;
    bitsPerChannel: number;
    canUseCanvasRgb8: boolean;
    reason?: string;
}

const COLOR_MODE_NAMES: Record<number, PsdColorMode> = {
    0: 'bitmap',
    1: 'grayscale',
    2: 'indexed',
    3: 'rgb',
    4: 'cmyk',
    7: 'multichannel',
    8: 'duotone',
    9: 'lab',
};

export function getColorPipeline(colorMode: number | undefined, bitsPerChannel: number | undefined): ColorPipeline {
    const bits = bitsPerChannel ?? 8;
    const mode = COLOR_MODE_NAMES[colorMode ?? -1] ?? 'unknown';
    const canUseCanvasRgb8 = mode === 'rgb' && bits === 8;
    return {
        mode,
        bitsPerChannel: bits,
        canUseCanvasRgb8,
        ...(canUseCanvasRgb8 ? {} : {
            reason: `Canvas RGB/8 compositor is not enabled for ${mode}/${bits}bit`,
        }),
    };
}
