import type { ReconstructionBounds } from "../shared/reconstruction.js";

export function projectBounds(
  bounds: ReconstructionBounds,
  targetWidth: number,
  targetHeight: number,
): ReconstructionBounds {
  return {
    x: Math.round(bounds.x * targetWidth),
    y: Math.round(bounds.y * targetHeight),
    width: Math.max(8, Math.round(bounds.width * targetWidth)),
    height: Math.max(8, Math.round(bounds.height * targetHeight)),
  };
}

export function boundsArea(bounds: ReconstructionBounds) {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

export function overlapScore(left: ReconstructionBounds, right: ReconstructionBounds) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  if (!intersection) {
    return 0;
  }

  const union = boundsArea(left) + boundsArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

export function blendBounds(
  left: ReconstructionBounds,
  right: ReconstructionBounds,
  ratio: number,
): ReconstructionBounds {
  const clamped = Math.max(0, Math.min(1, ratio));
  const inverse = 1 - clamped;
  return {
    x: Math.round(left.x * inverse + right.x * clamped),
    y: Math.round(left.y * inverse + right.y * clamped),
    width: Math.max(8, Math.round(left.width * inverse + right.width * clamped)),
    height: Math.max(8, Math.round(left.height * inverse + right.height * clamped)),
  };
}
