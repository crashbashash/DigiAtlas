import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { characterStats, type XDataPower } from '../data/character-stats';
import { readPowerBoxes, type SaveBox } from '../data/power-save-file';
import { recentSaves, rememberSave, type RecentSave } from '../data/recent-saves';
import { emptyEquipment } from '../data/weapon-equipment';
import { WEAPON_SKILLS } from '../data/weapon-damage';
import { useApp } from './context';
import { SearchPicker } from './SearchPicker';
import { WeaponEquipmentEditor } from './WeaponEquipmentEditor';

export type CharacterValues = ReturnType<typeof characterStats> & {
  force: number;
  skill: number;
  equipment: ReturnType<typeof emptyEquipment>;
};

export function CharacterSetup({
  attack = false,
  force = false,
  onChange,
}: {
  attack?: boolean;
  force?: boolean;
  onChange: (value: CharacterValues) => void;
}) {
  const { model } = useApp();
  const stats = model.raw.items.saveStats;
  const fileInput = useRef<HTMLInputElement>(null);
  const fileStatusId = useId();
  const [loadedName, setLoadedName] = useState('');
  const [species, setSpecies] = useState(stats?.forms[0]?.species ?? 0);
  const [level, setLevel] = useState(1);
  const [power, setPower] = useState<XDataPower>({ strength: 0, speed: 0, wisdom: 0 });
  const [equipment, setEquipment] = useState(emptyEquipment);
  const [skills, setSkills] = useState<number[]>(Array(9).fill(0));
  const [boxes, setBoxes] = useState<SaveBox[]>([]);
  const [box, setBox] = useState('');
  const [recent, setRecent] = useState<RecentSave[]>([]);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void recentSaves()
      .then(setRecent)
      .catch(() => setStorageError('Recent saves are unavailable in this browser.'));
  }, []);
  const form = stats?.forms.find((f) => f.species === species) ?? stats?.forms[0];
  const values =
    form && stats ? characterStats(form, level, power, equipment, model.items, stats) : null;
  useEffect(() => {
    if (values)
      onChange({ ...values, force: skills[8], skill: skills[values.weaponSkill], equipment });
  }, [model, species, level, power, equipment, skills]);

  function chooseForm(value: number, list = boxes, id = box) {
    setSpecies(value);
    const saved = list.find((b) => b.id === id)?.digimon.find((d) => d.species === value);
    if (saved) {
      setLevel(saved.level);
      setPower(saved.xdata);
      setEquipment(saved.equipment);
      setSkills(saved.skills);
    } else {
      setPower({ strength: 0, speed: 0, wisdom: 0 });
      setSkills(Array(9).fill(0));
    }
  }
  function chooseBox(id: string, list = boxes) {
    setBox(id);
    const first = list.find((b) => b.id === id)?.digimon[0];
    if (first) chooseForm(first.species, list, id);
  }
  async function load(name: string, data: ArrayBuffer) {
    if (!stats) return;
    const loaded = readPowerBoxes(data, stats, model.items);
    setBoxes(loaded);
    chooseBox(loaded[0].id, loaded);
    setLoadedName(name);
    try {
      await rememberSave(name, data);
      setRecent(await recentSaves());
    } catch {
      setStorageError('Save loaded. Recent saves could not be stored in this browser.');
    }
  }
  async function open(read: () => Promise<{ name: string; data: ArrayBuffer }>) {
    setBusy(true);
    setError('');
    try {
      const file = await read();
      await load(file.name, file.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!stats || !form || !values)
    return <p role="alert">Re-import your disc to load character stats.</p>;
  return (
    <>
      <details class="character-save-loader">
        <summary>Load a save</summary>
        <div class="power-field">
          <p>Open a save file or memory card</p>
          <div class="save-file-choice">
            <button
              type="button"
              class="equipment-edit-button"
              disabled={busy}
              aria-describedby={fileStatusId}
              onClick={() => fileInput.current?.click()}
            >
              Choose file
            </button>
            <span id={fileStatusId} role="status">
              {loadedName ? `Loaded: ${loadedName}` : 'No save loaded'}
            </span>
          </div>
          <input
            ref={fileInput}
            hidden
            aria-label="Open a save file or memory card"
            type="file"
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file)
                void open(async () => ({ name: file.name, data: await file.arrayBuffer() }));
              e.currentTarget.value = '';
            }}
          />
        </div>
        <p class="muted">Recently opened · stored on this device</p>
        {recent.length ? (
          <div class="recent-save-list">
            {recent.map((save) => (
              <button
                type="button"
                key={save.id}
                disabled={busy}
                onClick={() => void open(async () => save)}
              >
                {save.name}
                <small>{new Date(save.opened).toLocaleString()}</small>
              </button>
            ))}
          </div>
        ) : (
          <p class="muted">Your last three saves will appear here.</p>
        )}
        {storageError && <p role="status">{storageError}</p>}
      </details>
      {busy && <p role="status">Loading save…</p>}
      {error && <p role="alert">{error}</p>}
      {boxes.length > 0 && (
        <SearchPicker
          label="Save character"
          value={box}
          onChange={chooseBox}
          options={boxes.map((b) => ({ value: b.id, label: b.label }))}
        />
      )}
      <div class="power-inputs">
        <SearchPicker
          label="Digimon"
          value={String(form.species)}
          searchLabel="Search Digimon"
          onChange={(v) => chooseForm(Number(v))}
          options={stats.forms.map((f) => ({ value: String(f.species), label: f.name }))}
        />
        <label class="power-field">
          Level
          <input
            type="number"
            min="1"
            max="999"
            step="1"
            value={level}
            onInput={(e) => setLevel(e.currentTarget.valueAsNumber)}
          />
        </label>
      </div>
      <div class="character-equipment">
        <p>{equipment.weapon ? model.itemLabel(equipment.weapon.key) : 'No weapon equipped'}</p>
        <WeaponEquipmentEditor equipment={equipment} onChange={setEquipment} />
      </div>
      <details class="character-xdata">
        <summary>XData power</summary>
        <p class="muted">Permanent stat increases from XData, added before equipment.</p>
        <div class="power-inputs">
          {(attack ? (['strength', 'speed'] as const) : (['wisdom'] as const)).map((key) => (
            <label class="power-field" key={key}>
              {key[0].toUpperCase() + key.slice(1)}
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={power[key]}
                onInput={(e) => setPower({ ...power, [key]: e.currentTarget.valueAsNumber })}
              />
            </label>
          ))}
        </div>
      </details>
      {(attack || force) && (
        <label class="power-field">
          {attack ? `${WEAPON_SKILLS[values.weaponSkill]} skill` : 'Force skill'}
          <input
            type="number"
            min="0"
            max="9999"
            step="1"
            value={skills[attack ? values.weaponSkill : 8]}
            onInput={(e) => {
              const index = attack ? values.weaponSkill : 8;
              setSkills(skills.map((s, i) => (i === index ? e.currentTarget.valueAsNumber : s)));
            }}
          />
        </label>
      )}
      <dl class="character-stat-summary" aria-live="polite">
        {(attack
          ? [
              ['Strength', values.strength],
              ['Speed', values.speed],
              ['Accuracy', values.hitRate],
            ]
          : [['Wisdom', values.wisdom]]
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{Number.isFinite(value) ? Number(value).toLocaleString() : '—'}</dd>
          </div>
        ))}
      </dl>
      {(!Number.isInteger(level) ||
        level < 1 ||
        level > 999 ||
        Object.values(power).some((n) => !Number.isInteger(n) || n < 0 || n > 9999)) && (
        <p role="alert">Use a level from 1 to 999 and whole-number XData power from 0 to 9999.</p>
      )}
    </>
  );
}
