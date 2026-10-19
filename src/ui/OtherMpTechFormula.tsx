import type { Enemy, MpTech } from '../data/types';
import { cureChance, healingAmount, speedEffects } from '../data/mp-tech';
import type { CharacterValues } from './CharacterSetup';
import { FormulaHelp } from './FormulaHelp';

export type OtherMpFormulaKind =
  'healing' | 'reviveHp' | 'reviveExp' | 'cure' | 'speedStats' | 'resistStats';
export function OtherMpTechFormula({
  kind,
  tech,
  family,
  character,
  target,
}: {
  kind: OtherMpFormulaKind;
  tech: MpTech;
  family: MpTech[];
  character: CharacterValues | null;
  target?: Enemy;
}) {
  const w = character?.wisdom ?? NaN,
    h = character?.heal ?? NaN,
    f = character?.force ?? NaN;
  const amount = healingAmount(tech, w, h),
    speed = speedEffects(tech, f, target);
  const missing = <p>Choose valid character stats to see the current example.</p>;
  const rows = (label: string, value: (t: MpTech) => string | number) => (
    <table class="formula-bands">
      <thead>
        <tr>
          <th scope="col">Grade</th>
          <th scope="col">{label}</th>
        </tr>
      </thead>
      <tbody>
        {family.map((t) => (
          <tr key={t.row}>
            <th scope="row">{t.grade}</th>
            <td>{value(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (kind === 'healing')
    return (
      <FormulaHelp
        title="Healing amount formula"
        example={
          amount === null ? (
            missing
          ) : (
            <>
              <p>
                {tech.grade} · Wisdom {w} · Heal skill {h}
              </p>
              <p class="formula-equation">
                Healing = {tech.healBase} + {w} + {h} = {amount} HP
              </p>
            </>
          )
        }
      >
        <p>
          <strong>B</strong> = selected grade’s base healing.
          <br />
          <strong>W</strong> = caster Wisdom.
          <br />
          <strong>H</strong> = caster Heal skill.
        </p>
        <p class="formula-equation">Healing = B + W + H</p>
        {rows('Base healing B', (t) => t.healBase ?? 0)}
        <p>
          Heal Lt restores the caster’s HP. Aura applies the same calculated amount to the caster
          and each nearby ally. Each target’s missing HP limits how much is actually restored.
          Character level affects the derived Wisdom; it is not added separately.
        </p>
      </FormulaHelp>
    );
  if (kind === 'reviveHp')
    return (
      <FormulaHelp
        title="Revive HP formula"
        example={
          tech.revive ? (
            <p class="formula-equation">
              {tech.grade} revival HP = {tech.revive.hp} HP
            </p>
          ) : (
            missing
          )
        }
      >
        <p>
          Raise revives nearby allies from their Backup Chips. HP restoration comes from the
          selected grade’s recovery entry in the game executable.
        </p>
        {rows('Revival HP', (t) => t.revive?.hp ?? '—')}
        <p>
          Wisdom and Heal skill do not add to this amount. The revived Digimon’s maximum HP limits
          its final health.
        </p>
      </FormulaHelp>
    );
  if (kind === 'reviveExp')
    return (
      <FormulaHelp
        title="Revival EXP recovery formula"
        terms={['truncate']}
        example={
          tech.revive ? (
            <>
              <p>
                {tech.grade} Raise · Recovery rate {tech.revive.experiencePercent}%
              </p>
              <p class="formula-equation">
                Recovered EXP = truncate(Backup Chip EXP × {tech.revive.experiencePercent} / 100)
              </p>
            </>
          ) : (
            missing
          )
        }
      >
        <p>
          <strong>X</strong> = the revived Digimon’s EXP stored in its Backup Chip.
          <br />
          <strong>R</strong> = selected grade’s EXP recovery percentage.
        </p>
        <p class="formula-equation">
          Recovered EXP = truncate(X × R / 100)
          <br />
          EXP after revival = current EXP + recovered EXP
        </p>
        {rows('EXP recovery rate', (t) => `${t.revive?.experiencePercent ?? '—'}%`)}
        <p>
          This percentage applies to the EXP recorded in that Backup Chip, rather than all EXP the
          Digimon has ever earned. Wisdom and Heal skill do not change the selected grade’s rate.
        </p>
      </FormulaHelp>
    );
  if (kind === 'cure')
    return (
      <FormulaHelp
        title="Poison removal chance formula"
        terms={['clamp']}
        example={
          <>
            <p>
              {tech.grade} · Grade index {tech.row % 5}
            </p>
            <p class="formula-equation">
              Chance (%) = clamp(({tech.row % 5} + 6 − poison strength) × 10, 0, 100)
            </p>
          </>
        }
      >
        <p>
          <strong>G</strong> = grade index: Petty 0, Mega 1, Giga 2, Terra 3, Infinity 4.
          <br />
          <strong>P</strong> = the current poison’s strength, stored by the game when poison is
          applied.
        </p>
        <p class="formula-equation">
          Threshold = G + 5 − P<br />
          Chance (%) = clamp((Threshold + 1) × 10, 0, 100)
        </p>
        <p>
          A whole-number roll from 0 to 9 must be less than or equal to the threshold. The +1
          includes the matching boundary roll. The results table shows every possible chance by
          poison strength, since saves do not store a live poison effect.
        </p>
        {rows('Chance at poison strength 5', (t) => `${cureChance(t, 5)}%`)}
        <p>
          Cure Lt checks the caster’s poison. Cure checks the caster and nearby allies separately.
          Wisdom and Heal skill do not change this roll at a selected grade.
        </p>
      </FormulaHelp>
    );
  if (kind === 'resistStats')
    return (
      <FormulaHelp
        title="Resistance boost formulas"
        example={
          <>
            <p>{tech.grade}</p>
            {(['fire', 'ice', 'thunder', 'dark'] as const).map((stat) => (
              <p class="formula-equation" key={stat}>
                {stat[0].toUpperCase() + stat.slice(1)} resistance increase = +
                {tech.boosts[stat] ?? 0}
              </p>
            ))}
          </>
        }
      >
        <p>
          Each elemental resistance receives the selected grade’s corresponding base bonus. There is
          no extra Force or Wisdom term.
        </p>
        {rows(
          'Fire / Ice / Thunder / Dark',
          (t) => `${t.boosts.fire} / ${t.boosts.ice} / ${t.boosts.thunder} / ${t.boosts.dark}`,
        )}
        <p>
          Applies to the caster and nearby allies. Each target’s resistance limit can restrict the
          final displayed increase. Resist duration also uses its grade’s base duration directly.
        </p>
      </FormulaHelp>
    );
  const down = tech.kind === 'freeze';
  return (
    <FormulaHelp
      title={`${down ? 'Freeze' : 'Speed'} stat change formulas`}
      terms={['floor', ...(down ? (['truncate'] as const) : [])]}
      example={
        !speed ? (
          missing
        ) : (
          <>
            <p>
              {tech.grade} · Force skill {f}
              {down && ` · Enemy Speed ${target?.stats.speed}`}
            </p>
            <p class="formula-equation">
              {down
                ? `Requested speed reduction = ${-(tech.boosts.speed ?? 0)} + floor(${f} / 20)`
                : `Speed bonus = ${tech.boosts.speed} + floor(${f} / 5)`}
              <br />
              Applied Speed change = {speed.speed > 0 ? '+' : ''}
              {speed.speed}
              <br />
              Critical rate change = {speed.criticalRate}
              <br />
              Hit rate change = {speed.hitRate}
              <br />
              Evasion change = {speed.evasion}
            </p>
          </>
        )
      }
    >
      <p>
        <strong>B</strong> = grade’s base Speed change.
        <br />
        <strong>F</strong> = caster Force skill.
        {down && (
          <>
            <br />
            <strong>E</strong> = selected enemy’s original Speed.
          </>
        )}
      </p>
      <p class="formula-equation">
        {down ? (
          <>
            Requested speed reduction = −B + floor(F / 20)
            <br />
            Limit = truncate(80 × E / 100)
            <br />
            Applied reduction = the smaller of requested reduction and limit
          </>
        ) : (
          <>Speed increase = B + floor(F / 5)</>
        )}
      </p>
      {rows('Base Speed change', (t) => t.boosts.speed ?? 0)}
      {rows(
        'Critical / Hit / Evasion changes',
        (t) => `${t.criticalRate} / ${t.boosts.hitRate} / ${t.boosts.evasion}`,
      )}
      <p>
        The three rate changes use their grade values directly, without an additional Force term.
        These are changes to the underlying rate stats, not final hit or critical probabilities.
        Wisdom affects duration.
        {down && ' The Speed reduction is limited to 80% of the original enemy Speed.'}
      </p>
    </FormulaHelp>
  );
}
