/** Ignore transparent pixels and neutral scenery when checking for visible floor-height colours. */
export function hasHeightVariation(pixels: Uint8ClampedArray): boolean {
  let first: [number, number, number] | null = null;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2],
      alpha = pixels[i + 3];
    if (!alpha || r < 108 || g < 150 || b < 182) continue;
    if (!first) first = [r, g, b];
    else if (
      Math.abs(first[0] - r) >= 3 ||
      Math.abs(first[1] - g) >= 3 ||
      Math.abs(first[2] - b) >= 3
    )
      return true;
  }
  return false;
}
