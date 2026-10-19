import type { AttackElement } from './types';

export const WEAPON_SKILLS = ['Blunt', 'Slash', 'Stab', 'Bash', 'Shot', 'Crush'] as const;
export const ELEMENTS: { value: AttackElement; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fire', label: 'Fire' },
  { value: 'ice', label: 'Ice' },
  { value: 'thunder', label: 'Thunder' },
  { value: 'dark', label: 'Dark' },
];
export interface WeaponDamageInput {
  strength: number;
  skill: number;
  defense: number;
  critChance: number;
  element: AttackElement;
  resistance: number;
}
export interface DamageRange {
  min: number;
  max: number;
  mean: number;
}
export interface WeaponDamageResult {
  base: number;
  criticalBonus: number;
  elementChance: number;
  normal: DamageRange;
  critical: DamageRange;
  average: number;
}
const cap = (n: number) => Math.max(0, Math.min(99999, n));
const ordinary = (n: number) => Number.isInteger(n) && n >= 0 && n <= 9999;

/** Sum min(99999, floor(t / 1000)) from integer t=0 through n, inclusive. */
function sumRounded(n: number): number {
  if (n < 0) return 0;
  const end = Math.min(n, 99999 * 1000 - 1);
  const q = Math.floor(end / 1000);
  const sum = (1000 * q * (q - 1)) / 2 + q * ((end % 1000) + 1);
  return sum + Math.max(0, n - end) * 99999;
}

/** The four equal RNG bands concatenate into integer t in [950*d, 1050*d). */
export function damageSpread(damage: number): DamageRange {
  if (damage === 0) return { min: 0, max: 0, mean: 0 };
  const first = 950 * damage;
  const last = 1050 * damage - 1;
  return {
    min: cap(Math.trunc(first / 1000)),
    max: cap(Math.trunc(last / 1000)),
    mean: (sumRounded(last) - sumRounded(first - 1)) / (100 * damage),
  };
}

export function criticalBonus(skill: number): number {
  return skill <= 1000
    ? Math.trunc(skill / 20) + 30
    : skill <= 2000
      ? Math.trunc((skill - 1000) / 50) + 80
      : Math.trunc((skill - 2000) / 100) + 100;
}

function combine(parts: { chance: number; range: DamageRange }[]): DamageRange {
  const possible = parts.filter((p) => p.chance > 0);
  return {
    min: Math.min(...possible.map((p) => p.range.min)),
    max: Math.max(...possible.map((p) => p.range.max)),
    mean: possible.reduce((sum, p) => sum + p.chance * p.range.mean, 0),
  };
}

/** Single landed weapon hit: retail P2EDAMAGE, not the technique-damage branch.
 * Defense is the effective value. Default enemy rows represent no temporary debuff.
 * Means use nominal uniform RNG outcomes and account for every truncation/cap.
 */
export function weaponDamage(input: WeaponDamageInput): WeaponDamageResult | null {
  const { strength, skill, defense, critChance, element, resistance } = input;
  if (
    !ordinary(strength) ||
    !ordinary(skill) ||
    !Number.isInteger(defense) ||
    defense < -32768 ||
    defense > 32767 ||
    !Number.isFinite(critChance) ||
    critChance < 0 ||
    critChance > 100 ||
    !ELEMENTS.some((e) => e.value === element) ||
    (element !== 'none' &&
      (!Number.isInteger(resistance) || resistance < -32768 || resistance > 32767))
  )
    return null;
  // Positive/zero numerator divided by zero returns -1 on EE DIV; the next clamp makes it 0.
  const base = cap(defense === 0 ? -1 : Math.trunc((6 * strength + 4 * skill) / defense));
  const bonus = criticalBonus(skill);
  const proc = element === 'none' ? 0 : Math.min(1, Math.max(0, (999 - resistance) / 1000));
  const boosted = cap((base + Math.trunc(Math.imul(base, 1000 - resistance) / 1000)) | 0);
  const hit = (value: number, crit: boolean) =>
    damageSpread(crit ? value + Math.trunc((value * bonus) / 100) : value);
  const range = (crit: boolean) =>
    combine([
      { chance: 1 - proc, range: hit(base, crit) },
      { chance: proc, range: hit(boosted, crit) },
    ]);
  const normal = range(false),
    critical = range(true);
  return {
    base,
    criticalBonus: bonus,
    elementChance: proc * 100,
    normal,
    critical,
    average: normal.mean * (1 - critChance / 100) + (critical.mean * critChance) / 100,
  };
}

/** Sum per-hit expectations. The retail cap applies to each hit, not the input total. */
export function averageAttackDamage(
  perHit: number,
  hitChance: number,
  hits: number,
): number | null {
  if (
    !Number.isFinite(perHit) ||
    perHit < 0 ||
    perHit > 99999 ||
    !Number.isFinite(hitChance) ||
    hitChance < 0 ||
    hitChance > 100 ||
    !Number.isInteger(hits) ||
    hits < 1 ||
    hits > 16
  )
    return null;
  return perHit * (hitChance / 100) * hits;
}
