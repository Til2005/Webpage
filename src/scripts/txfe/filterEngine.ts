import type { FilterState } from './stateManager';

export function buildCSSFilter(filters: FilterState): string {
  const parts: string[] = [];

  // Saturation: 0-200% maps to saturate(0) to saturate(2)
  parts.push(`saturate(${filters.saturation / 100})`);

  // Brightness: 0-200% maps to brightness(0) to brightness(2)
  parts.push(`brightness(${filters.brightness / 100})`);

  // Contrast: 0-200% maps to contrast(0) to contrast(2)
  // Adjust contrast if sharpness is positive
  let contrastValue = filters.contrast / 100;
  if (filters.sharpness > 0) {
    const contrastBoost = 1 + (filters.sharpness / 200);
    contrastValue *= contrastBoost;
  }
  parts.push(`contrast(${contrastValue})`);

  // Hue rotate: -180 to 180 degrees
  if (filters.hue !== 0) {
    parts.push(`hue-rotate(${filters.hue}deg)`);
  }

  // Warmth: implemented via sepia + hue adjustment
  // Positive warmth adds orange/yellow, negative adds blue
  if (filters.warmth !== 0) {
    const sepiaAmount = Math.abs(filters.warmth) / 200;
    parts.push(`sepia(${sepiaAmount})`);
    if (filters.warmth < 0) {
      // Cool tones: shift hue towards blue
      parts.push(`hue-rotate(180deg)`);
    }
  }

  // Sharpness: CSS doesn't have native sharpness
  // Negative values: blur
  if (filters.sharpness < 0) {
    const blurAmount = Math.abs(filters.sharpness) / 100;
    parts.push(`blur(${blurAmount}px)`);
  }
  // Positive values: handled via contrast boost above

  return parts.join(' ');
}

export function getFilterDefaults(): FilterState {
  return {
    saturation: 100,
    brightness: 100,
    contrast: 100,
    warmth: 0,
    hue: 0,
    sharpness: 0,
  };
}

export function isFilterModified(filters: FilterState): boolean {
  const defaults = getFilterDefaults();
  return (
    filters.saturation !== defaults.saturation ||
    filters.brightness !== defaults.brightness ||
    filters.contrast !== defaults.contrast ||
    filters.warmth !== defaults.warmth ||
    filters.hue !== defaults.hue ||
    filters.sharpness !== defaults.sharpness
  );
}
