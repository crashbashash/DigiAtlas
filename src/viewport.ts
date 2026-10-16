export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 20;

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Zoom by `factor`, keeping the screen point (sx, sy) fixed over the same map point. */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
}
