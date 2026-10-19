import { routes } from '../app/route';
import { Link } from './common';

const planned = [
  { title: 'Build planner', description: 'Plan a Digimon’s level, equipment, chips and XData.' },
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
        <Link to={routes.calculator('mp-tech')} class="section-card calculator-tile">
          <h2>MP Tech calculator</h2>
          <p>Calculate MP Tech damage, healing, buffs and status effects.</p>
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
