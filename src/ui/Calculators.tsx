import { routes } from '../app/route';
import { Link } from './common';

const planned = [
  { title: 'Technique damage', description: 'Calculate technique damage and elemental effects.' },
  { title: 'Healing', description: 'Calculate how much HP a healing technique restores.' },
  { title: 'Status effects', description: 'Explore other buffs, debuffs and their durations.' },
  { title: 'Character stats', description: 'Compare stats across Digimon, levels and equipment.' },
];

export function Calculators() {
  return (
    <div class="page calculators-page">
      <header class="page-head">
        <h1>Calculators</h1>
        <p class="muted">Choose a calculator to get started.</p>
      </header>
      <div class="calculator-tiles">
        <Link to={routes.calculator('attack-damage')} class="section-card calculator-tile">
          <h2>Attack damage</h2>
          <p>Compare normal, critical and elemental damage against enemies.</p>
          <span class="calculator-open">Open calculator →</span>
        </Link>
        <Link to={routes.calculator('power-up')} class="section-card calculator-tile">
          <h2>Power Up</h2>
          <p>See how long each spell grade lasts with your Wisdom.</p>
          <span class="calculator-open">Open calculator →</span>
        </Link>
        <Link to={routes.calculator('power-down')} class="section-card calculator-tile">
          <h2>Power Down</h2>
          <p>Calculate duration and your chance to apply it to an enemy.</p>
          <span class="calculator-open">Open calculator →</span>
        </Link>
        {planned.map((c) => (
          <section key={c.title} class="section-card calculator-tile calculator-planned">
            <span class="calculator-status">Coming soon</span>
            <h2>{c.title}</h2>
            <p>{c.description}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
