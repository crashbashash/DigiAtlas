/** Retail FIGHTCALC case 1 (P2EISHITCHECK), 0x3fdeb8..0x3fe130.
 * Enemy Speed is effective Speed after any transient reduction; imported rows
 * use the unmodified value. The roll is independent of collision geometry.
 */
export function attackHitChance(
  speed: number,
  skill: number,
  accuracy: number,
  enemySpeed: number,
): number | null {
  if (
    ![speed, skill].every((n) => Number.isInteger(n) && n >= 0 && n <= 9999) ||
    !Number.isInteger(accuracy) ||
    accuracy < 0 ||
    accuracy > 32767 ||
    !Number.isInteger(enemySpeed) ||
    enemySpeed < -32768 ||
    enemySpeed > 32767
  )
    return null;
  const numerator = Math.imul(accuracy, 30 * speed + 20 * skill + 6000);
  const threshold =
    enemySpeed === 0 ? (numerator < 0 ? 1 : -1) : Math.trunc(numerator / enemySpeed) | 0;
  return Math.max(0, Math.min(10000, threshold)) / 100;
}
