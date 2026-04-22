export const EDITOR_SCALE_DEFAULT_PERCENT = 100;
export const EDITOR_SCALE_MIN_PERCENT = 70;
export const EDITOR_SCALE_MAX_PERCENT = 130;
export const EDITOR_SCALE_STEP_PERCENT = 5;

export function createDefaultEditorScalePercent(): number {
  return EDITOR_SCALE_DEFAULT_PERCENT;
}

export function resetEditorScalePercent(): number {
  return EDITOR_SCALE_DEFAULT_PERCENT;
}

export function normalizeEditorScalePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return EDITOR_SCALE_DEFAULT_PERCENT;
  }

  return Math.min(
    EDITOR_SCALE_MAX_PERCENT,
    Math.max(EDITOR_SCALE_MIN_PERCENT, Math.round(value))
  );
}

export function stepEditorScalePercent(currentPercent: number, deltaY: number): number {
  if (deltaY === 0) {
    return normalizeEditorScalePercent(currentPercent);
  }

  const direction = deltaY < 0 ? 1 : -1;
  return normalizeEditorScalePercent(currentPercent + direction * EDITOR_SCALE_STEP_PERCENT);
}

export function shouldHandleEditorScaleWheel(options: {
  ctrlKey: boolean;
  targetWithinEditor: boolean;
}): boolean {
  return options.ctrlKey && options.targetWithinEditor;
}
