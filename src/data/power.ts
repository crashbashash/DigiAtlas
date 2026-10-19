import type { Manifest, PowerSpell } from './types';

/** Retail player-cast rules. Restrict inputs to ordinary game stat/skill values. */
export function validPowerStat(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 9999;
}

export function powerDuration(spell: PowerSpell, wisdom: number): number | null {
  if (!validPowerStat(wisdom)) return null;
  return spell.baseFrames + (spell.kind === 'up' ? wisdom : Math.floor(wisdom / 2));
}

/** Percentage for the application roll alone; hit/immunity/script gates are separate. */
export function powerDownChance(force: number, spirit: number): number | null {
  if (!validPowerStat(force) || !Number.isInteger(spirit) || spirit <= 0) return null;
  const a =
    force <= 1000
      ? 550 + Math.floor(force / 4)
      : force <= 2000
        ? 800 + Math.floor((force - 1000) / 5)
        : 1000 + Math.floor((force - 2000) / 10);
  return Math.min(100, Math.max(0, Math.floor((100 * a) / spirit) / 10));
}

export function gameFrameRate(manifest: Pick<Manifest, 'region' | 'framesPerSecond'>): 50 | 60 {
  if (manifest.framesPerSecond) return manifest.framesPerSecond;
  return ['europe', 'pal'].includes(manifest.region.toLowerCase()) ? 50 : 60;
}

export function durationText(frames: number, framesPerSecond = 60): string {
  return `${(frames / framesPerSecond).toFixed(2)} s`;
}
