export type CurvePoint = { input: number; output: number };

export function buildCurveLut(points: CurvePoint[] | undefined): Uint8Array {
    const lut = new Uint8Array(256);
    const sorted = [...(points ?? [])]
        .map(p => ({ input: Math.max(0, Math.min(255, p.input)), output: Math.max(0, Math.min(255, p.output)) }))
        .sort((a, b) => a.input - b.input);
    if (sorted.length === 0) {
        for (let i = 0; i < 256; i++) lut[i] = i;
        return lut;
    }
    for (let x = 0; x < 256; x++) {
        if (x <= sorted[0].input) { lut[x] = sorted[0].output; continue; }
        const last = sorted[sorted.length - 1];
        if (x >= last.input) { lut[x] = last.output; continue; }
        let hi = 1;
        while (hi < sorted.length && x > sorted[hi].input) hi++;
        const lo = sorted[hi - 1];
        const next = sorted[hi];
        const t = (x - lo.input) / Math.max(1, next.input - lo.input);
        lut[x] = Math.round(lo.output + (next.output - lo.output) * t);
    }
    return lut;
}

function buildLevelsLut(channel: any): Uint8Array {
    const lut = new Uint8Array(256);
    const shadow = Math.max(0, Math.min(255, channel?.shadowInput ?? 0));
    const highlight = Math.max(shadow + 1, Math.min(255, channel?.highlightInput ?? 255));
    const outShadow = Math.max(0, Math.min(255, channel?.shadowOutput ?? 0));
    const outHighlight = Math.max(0, Math.min(255, channel?.highlightOutput ?? 255));
    const midtone = Math.max(0.01, channel?.midtoneInput ?? 1);
    for (let x = 0; x < 256; x++) {
        const normalized = Math.max(0, Math.min(1, (x - shadow) / (highlight - shadow)));
        const corrected = Math.pow(normalized, 1 / midtone);
        lut[x] = Math.round(outShadow + corrected * (outHighlight - outShadow));
    }
    return lut;
}

function buildBrightnessContrastLut(brightness = 0, contrast = 0): Uint8Array {
    const lut = new Uint8Array(256);
    const b = Math.max(-100, Math.min(100, brightness)) * 2.55;
    const c = Math.max(-100, Math.min(100, contrast)) * 2.55;
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    for (let x = 0; x < 256; x++) lut[x] = Math.max(0, Math.min(255, Math.round(factor * (x - 128) + 128 + b)));
    return lut;
}

export function applyAdjustmentToImage(
    image: ImageData,
    adjustment: any,
    opacity: number,
    maskData?: Uint8ClampedArray,
): boolean {
    if (!adjustment?.type) return false;
    let rgb: Uint8Array;
    let red: Uint8Array;
    let green: Uint8Array;
    let blue: Uint8Array;
    switch (adjustment.type) {
        case 'curves':
            rgb = buildCurveLut(adjustment.rgb);
            red = buildCurveLut(adjustment.red);
            green = buildCurveLut(adjustment.green);
            blue = buildCurveLut(adjustment.blue);
            break;
        case 'levels':
            rgb = buildLevelsLut(adjustment.rgb);
            red = buildLevelsLut(adjustment.red);
            green = buildLevelsLut(adjustment.green);
            blue = buildLevelsLut(adjustment.blue);
            break;
        case 'brightness/contrast':
            rgb = buildBrightnessContrastLut(adjustment.brightness, adjustment.contrast);
            red = green = blue = buildCurveLut(undefined);
            break;
        default:
            return false;
    }

    const amountBase = Math.max(0, Math.min(1, opacity));
    for (let i = 0; i < image.data.length; i += 4) {
        const amount = amountBase * (maskData ? maskData[i + 3] / 255 : 1);
        const mappedR = red[rgb[image.data[i]]];
        const mappedG = green[rgb[image.data[i + 1]]];
        const mappedB = blue[rgb[image.data[i + 2]]];
        image.data[i] = Math.round(image.data[i] + (mappedR - image.data[i]) * amount);
        image.data[i + 1] = Math.round(image.data[i + 1] + (mappedG - image.data[i + 1]) * amount);
        image.data[i + 2] = Math.round(image.data[i + 2] + (mappedB - image.data[i + 2]) * amount);
    }
    return true;
}
