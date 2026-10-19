import type { Enemy, MpTech, MpTechKind } from './types';
import { validPowerStat } from './power';
import { criticalBonus, damageSpread } from './weapon-damage';

export const MP_TECH_NAMES: Record<MpTechKind, string> = {
  fire: 'Fire',
  ice: 'Ice',
  bolt: 'Bolt',
  dark: 'Dark',
  venom: 'Venom',
  impact: 'Impact',
  cutter: 'Cutter',
  bomb: 'Bomb',
  'heal-light': 'Heal Lt',
  'heal-aura': 'Aura',
  raise: 'Raise',
  'cure-light': 'Cure Lt',
  'cure-aura': 'Cure',
  speed: 'Speed',
  freeze: 'Freeze',
  resist: 'Resist',
  'power-up': 'Pwr Up',
  'power-down': 'Pwr Down',
  sleep: 'Sleep',
  bind: 'Bind',
};
export const ELEMENT_NAMES = {
  none: 'None',
  fire: 'Fire',
  ice: 'Ice',
  thunder: 'Thunder',
  dark: 'Dark',
  poison: 'Poison',
};
export const targetsEnemy = (tech: MpTech) =>
  tech.skill === 'blast' || ['freeze', 'power-down', 'sleep', 'bind'].includes(tech.kind);
export const isHealing = (tech: MpTech) => ['heal-light', 'heal-aura'].includes(tech.kind);
export const isCure = (tech: MpTech) => ['cure-light', 'cure-aura'].includes(tech.kind);
const cap = (n: number, max = 99999) => Math.max(0, Math.min(max, n));
const signedStat = (n: number) => Number.isInteger(n) && n >= -32768 && n <= 32767;
// EE DIV returns -1 for a nonnegative numerator and zero divisor.
const divide = (n: number, d: number) => (d === 0 ? (n < 0 ? 1 : -1) : Math.trunc(n / d));

export function mpDuration(tech: MpTech, wisdom: number): number | null {
  if (!validPowerStat(wisdom) || tech.baseFrames <= 0) return null;
  return (
    tech.baseFrames +
    (tech.kind === 'resist'
      ? 0
      : ['power-up', 'speed'].includes(tech.kind)
        ? wisdom
        : Math.floor(wisdom / 2))
  );
}

export function applicationValue(skill: number, poison = false): number | null {
  if (!validPowerStat(skill)) return null;
  return skill <= 1000
    ? (poison ? 750 : 550) + Math.floor(skill / 4)
    : skill <= 2000
      ? (poison ? 1000 : 800) + Math.floor((skill - 1000) / 5)
      : (poison ? 1200 : 1000) + Math.floor((skill - 2000) / 10);
}

export function powerUpBoosts(tech: MpTech, force: number) {
  if (tech.kind !== 'power-up' || !validPowerStat(force)) return null;
  const skillBonus = Math.floor(force / 5);
  return {
    maxHp: tech.boosts.maxHp + skillBonus,
    strength: tech.boosts.strength + skillBonus,
    defense: tech.boosts.defense + skillBonus,
  };
}

/** Positive reduction amounts. Retail bounds the signed change at -80% of the original stat. */
export function powerDownReductions(tech: MpTech, force: number, enemy: Enemy | undefined) {
  if (
    tech.kind !== 'power-down' ||
    !validPowerStat(force) ||
    !enemy ||
    ![enemy.stats.strength, enemy.stats.defense].every((n) => signedStat(n) && n >= 0)
  )
    return null;
  const reduction = (stat: 'strength' | 'defense') =>
    -Math.max(
      tech.boosts[stat] - Math.floor(force / 20),
      Math.trunc((-80 * enemy.stats[stat]) / 100),
    );
  return { strength: reduction('strength'), defense: reduction('defense') };
}

export function venomPoison(tech: MpTech, wisdom: number, blast: number, resistance: number) {
  const a = applicationValue(blast, true);
  const frames = mpDuration(tech, wisdom);
  if (tech.kind !== 'venom' || a === null || frames === null || !signedStat(resistance))
    return null;
  const threshold = Math.trunc(Math.imul(a, 1000 - resistance) / 1000);
  return {
    a,
    threshold,
    chance: cap(threshold, 1000) / 10,
    frames,
    damage: Math.trunc(tech.power / 5),
  };
}

/** Retail MP Tech branch of P2EDAMAGE/P2EISCRITICAL, including both pre-spread caps. */
export function mpDamage(
  tech: MpTech,
  wisdom: number,
  blast: number,
  spirit: number,
  resistance: number,
) {
  if (
    tech.skill !== 'blast' ||
    !validPowerStat(wisdom) ||
    !validPowerStat(blast) ||
    !signedStat(spirit) ||
    !signedStat(resistance) ||
    !Number.isInteger(tech.power) ||
    tech.power < 0
  )
    return null;
  const rawBase = tech.power === 0 ? 0 : divide(20 * tech.power + 10 * wisdom + 5 * blast, spirit);
  const base = cap(rawBase);
  const damage = cap(Math.trunc(Math.imul(base, 1000 - resistance) / 1000));
  const bonus = criticalBonus(blast);
  const criticalDamage = damage + Math.trunc((damage * bonus) / 100);
  const criticalDivisor = Math.trunc((resistance * 12) / 10) + 50;
  const criticalScale = divide(10000, criticalDivisor);
  const criticalThreshold =
    tech.element === 'none'
      ? tech.criticalRate
      : Math.trunc(Math.imul(tech.criticalRate + 100, criticalScale) / 100);
  const criticalChance =
    tech.element === 'none' ? cap(criticalThreshold, 100) : cap(criticalThreshold, 1000) / 10;
  const normal = damageSpread(damage),
    critical = damageSpread(criticalDamage);
  return {
    rawBase,
    base,
    damage,
    bonus,
    criticalDamage,
    criticalDivisor,
    criticalScale,
    criticalThreshold,
    criticalChance,
    normal,
    critical,
    average: normal.mean * (1 - criticalChance / 100) + (critical.mean * criticalChance) / 100,
  };
}

export function healingAmount(tech: MpTech, wisdom: number, heal: number) {
  if (!isHealing(tech) || !validPowerStat(wisdom) || !validPowerStat(heal)) return null;
  return (tech.healBase ?? 0) + wisdom + heal;
}
export function speedEffects(tech: MpTech, force: number, enemy?: Enemy) {
  if (!['speed', 'freeze'].includes(tech.kind) || !validPowerStat(force)) return null;
  const speedBase = tech.boosts.speed ?? 0;
  if (tech.kind === 'freeze' && (!enemy || !signedStat(enemy.stats.speed) || enemy.stats.speed < 0))
    return null;
  const speed =
    tech.kind === 'speed'
      ? speedBase + Math.floor(force / 5)
      : Math.max(speedBase - Math.floor(force / 20), Math.trunc((-80 * enemy!.stats.speed) / 100));
  return {
    speed,
    criticalRate: tech.criticalRate,
    hitRate: tech.boosts.hitRate ?? 0,
    evasion: tech.boosts.evasion ?? 0,
  };
}
export function cureChance(tech: MpTech, poisonStrength: number) {
  if (!isCure(tech) || !Number.isInteger(poisonStrength) || poisonStrength < 0) return null;
  const threshold = (tech.row % 5) + 5 - poisonStrength;
  return cap(threshold + 1, 10) * 10;
}
