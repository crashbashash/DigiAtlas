import { routes } from '../app/route';
import { Link } from './common';

export function Calculators() {
  return (
    <div class="page calculators-page">
      <header class="page-head">
        <h1>Calculators</h1>
        <p class="muted">Choose a calculator to get started.</p>
      </header>
      <div class="calculator-tiles">
        <Link to={routes.calculator('stat-growth')} class="section-card calculator-tile">
          <h2>Stat growth</h2>
          <p>Explore all seven stats by level and compare Digimon forms.</p>
          <span class="calculator-open">Open viewer →</span>
        </Link>
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
      </div>
    </div>
  );
}
