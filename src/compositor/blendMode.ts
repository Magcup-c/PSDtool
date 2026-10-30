import type { BlendMode } from 'ag-psd';

/** PSD blend-mode names shared by preview and future compositor stages. */
const NATIVE_BLEND_MODES: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
    normal: 'source-over', dissolve: 'source-over', darken: 'darken', multiply: 'multiply',
    lighten: 'lighten', screen: 'screen', overlay: 'overlay', 'color dodge': 'color-dodge',
    'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light',
    difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation',
    color: 'color', luminosity: 'luminosity', 'linear dodge': 'lighter', 'linear burn': 'multiply',
    'vivid light': 'hard-light', 'linear light': 'hard-light', 'pin light': 'lighten',
    'hard mix': 'hard-light', 'darker color': 'darken', 'lighter color': 'lighten',
    'pass through': 'source-over',
};

export function resolvePsdBlendMode(mode?: BlendMode): GlobalCompositeOperation {
    return (mode && NATIVE_BLEND_MODES[mode]) || 'source-over';
}

export function isPassThrough(mode?: BlendMode): boolean {
    return mode === 'pass through';
}

export function hasNativeBlendMode(mode?: BlendMode): boolean {
    return !mode || mode in NATIVE_BLEND_MODES;
}
