import type { DataSource } from '../data/source';
import { traderLabel, type Model, type Scope } from '../data/model';
import type {
  Difficulty,
  Door,
  DoorSwitch,
  Enemy,
  EnemyKind,
  ServiceNpc,
  Stage,
  Platform,
  TriggerArea,
  TrainControl,
} from '../data/types';
import {
  doorActivations,
  doorLabel,
  doorSummary,
  platformLabel,
  platformMovements,
  platformSummary,
  visibleDoors,
  visiblePlatforms,
} from '../data/doors';
import { h } from './dom';
import {
  markerRank,
  markersAtSpot,
  nextMarkerAtSpot,
  pickMarker,
  stageMarkers,
  type Marker,
} from './markers';
import { hasHeightVariation } from './map-legend';

export const KIND_COLOR: Record<EnemyKind, string> = {
  enemy: '#ff6b6b',
  boss: '#ffcc4d',
  object: '#6bc7ff',
};
export const KIND_LABEL: Record<EnemyKind, string> = {
  enemy: 'Enemy',
  boss: 'Boss',
  object: 'Box / crate / barrel',
};

interface View {
  tx: number;
  ty: number;
  scale: number;
}

export interface MapEvents {
  onSelect(generator: number | null): void;
  /** A trader's pin was clicked; `index` is its place in `Model.tradersAt`. */
  onTrader(index: number): void;
  onService(index: number): void;
  onDoor(id: string): void;
  onPlatform(id: string): void;
  onTrain(id: string): void;
}

export const TRADER_COLOR = '#b98cff';
export const SERVICE_COLOR = '#73dfb5';
export const DOOR_COLOR = '#ffd166';
export const DOOR_TRIGGER_COLOR = '#73dfd5';
export const PLATFORM_COLOR = '#b8e986';
const ROUTE_COLOR = '#ffb46b';

/** A trader standing in a shop room. */
interface Pin {
  train?: TrainControl;
  platform?: Platform;
  area?: TriggerArea;
  detail?: string;
  door?: Door;
  trigger?: DoorSwitch;
  service?: ServiceNpc;
  landmark?: ServiceNpc;
  index: number;
  x: number;
  z: number;
  label: string;
  trades: number;
  facing: number;
}

/** Maps this full are a flat floor with nothing to show; the plain grid reads better. */
const FLAT_FILL = 0.97;
const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const HIT_RADIUS = 12;

export class MapView {
  readonly el: HTMLElement;
  private readonly canvas = h('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly markerKeys = new Map(
    (Object.keys(KIND_COLOR) as EnemyKind[]).map((kind) => [
      kind,
      h(
        'span',
        { hidden: true },
        h('i', { style: `background:${KIND_COLOR[kind]}` }),
        KIND_LABEL[kind],
      ),
    ]),
  );
  private readonly traderKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${TRADER_COLOR}` }),
    'Trader',
  );
  private readonly numberKey = h(
    'span',
    { class: 'muted', hidden: true },
    'Number = enemies at a spot',
  );
  private readonly heightKey = h(
    'span',
    {
      class: 'height-key',
      hidden: true,
      title: 'Relative floor height within this map; brighter means higher.',
    },
    'Height: Lower',
    h('i', { class: 'height-ramp', 'aria-hidden': 'true' }),
    'Higher',
  );
  private readonly sceneryKey = h(
    'span',
    { hidden: true },
    h('i', { style: 'background:rgb(57,72,89)' }),
    'Scenery',
  );
  private readonly routeKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${ROUTE_COLOR}` }),
    'Boat route',
  );
  private readonly serviceKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${SERVICE_COLOR}` }),
    'Service NPC',
  );
  private readonly doorKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${DOOR_COLOR}` }),
    'Door / gate',
  );
  private readonly switchKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${DOOR_TRIGGER_COLOR}` }),
    'Activation trigger',
  );
  private focusedDoor: Door | null = null;
  private selectedTrain: string | null = null;
  private trainSteps = new Map<string, number>();
  private deviation: [number, number, number][] = [];
  private readonly deviationKey = h(
    'span',
    { hidden: true },
    h('i', { style: 'background:#c396ff' }),
    'Selected train branch',
  );
  private pinLabels: { left: number; right: number; top: number; bottom: number }[] = [];
  private readonly trainKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${DOOR_TRIGGER_COLOR}` }),
    'Train controls',
  );
  private focusedPlatform: Platform | null = null;
  private triggerAreas: TriggerArea[] = [];
  private groupNumbers = new Map<number, number>();
  private readonly platformKey = h(
    'span',
    { hidden: true },
    h('i', { style: `background:${PLATFORM_COLOR}` }),
    'Moving platform',
  );
  private doorPoints: { x: number; y: number; z: number }[] = [];
  private readonly tip = h('div', { class: 'tip', hidden: true });
  private view: View = { tx: 0, ty: 0, scale: 1 };
  private bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  private image: HTMLImageElement | null = null;
  private markers: Marker[] = [];
  private route: [number, number, number][] = [];
  private highlight: Set<number> | null = null;
  private selected: number | null = null;
  private stageId: string | null = null;
  private pendingFit = false;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private hover: Marker | null = null;
  private pointer: [number, number] | null = null;
  private pins: Pin[] = [];
  private litPins: Set<number> | null = null;
  private hoverPin: Pin | null = null;
  private readonly legendEl = this.legend();

  constructor(
    private readonly model: Model,
    private readonly source: DataSource,
    private readonly events: MapEvents,
  ) {
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'map' }, this.canvas, this.tip, this.legendEl);
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.setHover(null);
      this.setHoverPin(null);
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // The browser's own menu (back, reload, inspect) has nothing to offer on the map.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private legend(): HTMLElement {
    return h(
      'div',
      { class: 'legend' },
      ...this.markerKeys.values(),
      this.traderKey,
      this.numberKey,
      this.serviceKey,
      this.doorKey,
      this.platformKey,
      this.switchKey,
      this.trainKey,
      this.deviationKey,
      this.routeKey,
      this.heightKey,
      this.sceneryKey,
    );
  }

  show(
    stage: Stage,
    d: Difficulty,
    scope: Scope,
    highlight: Set<number> | null,
    selected: number | null,
    litPins: Set<number> | null = null,
    selectedDoor: string | null = null,
    selectedPlatform: string | null = null,
    selectedTrain: string | null = null,
  ): void {
    const stageChanged = stage.id !== this.stageId;
    const showTrainRoute = selectedTrain === 'route' && this.selectedTrain !== 'route';
    const trainSelectionChanged = selectedTrain !== this.selectedTrain;
    this.selectedTrain = selectedTrain;
    this.trainSteps = new Map(
      (stage.train?.steps ?? []).map((step, index) => [step.controlId, index + 1]),
    );
    this.stageId = stage.id;
    this.highlight = highlight;
    this.route = stage.train?.points ?? stage.boatRoute ?? [];
    this.deviation = stage.train?.controls.find((c) => c.id === selectedTrain)?.preview ?? [];
    this.deviationKey.hidden = this.deviation.length < 2;
    this.routeKey.lastChild!.textContent = stage.train ? 'Fastest train route' : 'Boat route';
    this.trainKey.hidden = !stage.train?.controls.length;
    this.selected = selected;
    this.litPins = litPins;
    this.markers = stageMarkers(this.model, stage, d, scope);
    for (const [kind, key] of this.markerKeys)
      key.hidden = !this.markers.some((m) => m.kind === kind);
    this.numberKey.hidden = !this.markers.some((m) => m.badge > 1);
    this.traderKey.hidden = !this.model.tradersAt(stage, d).length;
    this.pins = this.model.tradersAt(stage, d).map((t, index) => ({
      index,
      x: t.position.x,
      z: t.position.z,
      label: traderLabel(t),
      trades: t.tables[d]?.length ?? 0,
      facing: t.facing,
    }));
    this.pins.push(
      ...(stage.services ?? []).map((service, index) => ({
        index,
        service,
        x: service.position.x,
        z: service.position.z,
        label: service.label,
        trades: 0,
        facing: service.facing,
      })),
    );
    this.pins.push(
      ...(stage.landmarks ?? []).map((landmark, index) => ({
        index,
        landmark,
        x: landmark.position.x,
        z: landmark.position.z,
        label: landmark.label,
        trades: 0,
        facing: landmark.facing,
      })),
    );
    const doors = visibleDoors(stage);
    const platforms = visiblePlatforms(stage, d, scope.players);
    this.focusedDoor = doors.find((door) => door.id === selectedDoor) ?? null;
    this.focusedPlatform = platforms.find((p) => p.id === selectedPlatform) ?? null;
    this.groupNumbers = new Map(
      (this.focusedDoor || this.focusedPlatform
        ? [...(highlight ?? [])].sort((a, b) => a - b)
        : []
      ).map((index, n) => [index, n + 1]),
    );
    this.doorPoints = [...doors, ...platforms].flatMap((door) => [
      door.position,
      ...door.activations.flatMap((a) => a.switches.map((s) => s.position)),
      ...door.activations.flatMap((a) =>
        (a.areas ?? []).flatMap((area) => [
          area.position,
          { x: area.bounds.minX, y: area.position.y, z: area.bounds.minZ },
          { x: area.bounds.maxX, y: area.position.y, z: area.bounds.maxZ },
        ]),
      ),
    ]);
    this.doorPoints.push(
      ...(stage.train?.controls.map((c) => c.position) ?? []),
      ...(stage.train?.points.map(([x, y, z]) => ({ x, y, z })) ?? []),
    );
    this.doorPoints.push(...this.deviation.map(([x, y, z]) => ({ x, y, z })));
    this.pins.push(
      ...(stage.train?.controls.map((train, index) => ({
        train,
        index,
        x: train.position.x,
        z: train.position.z,
        facing: train.facing,
        trades: 0,
        label: train.label,
        detail:
          train.choice === 'gate'
            ? 'Hit this post to open the barrier and continue.'
            : `Select ${train.choice}. The choice applies when the train leaves this junction; the next junction resets to straight.`,
      })) ?? []),
    );
    if (stage.train) {
      const points = stage.train.points;
      for (const [index, point] of [points[0], points[points.length - 1]].entries()) {
        const [x, y, z] = point;
        const label = index === 0 ? 'Train start' : 'Power Plant exit';
        const landmark = {
          id: `train-endpoint-${index}`,
          name: 'Train route',
          label,
          description: label,
          position: { x, y, z },
          facing: 0,
        };
        this.pins.push({ landmark, index, x, z, label, trades: 0, facing: 0 });
      }
    }
    this.pins.push(
      ...doors.map((door, index) => ({
        door,
        index,
        x: door.position.x,
        z: door.position.z,
        label: doorLabel(door, stage),
        detail: doorSummary(door, stage, d, scope.players),
        trades: 0,
        facing: door.facing,
      })),
    );
    this.pins.push(
      ...platforms.map((platform, index) => ({
        platform,
        index,
        x: platform.position.x,
        z: platform.position.z,
        label: platformLabel(platform, stage),
        detail: platformSummary(platform, stage, d, scope.players),
        trades: 0,
        facing: platform.facing,
      })),
    );
    const activations = this.focusedPlatform
      ? platformMovements(this.focusedPlatform, d, scope.players).flatMap((m) => m.activations)
      : this.focusedDoor
        ? doorActivations(this.focusedDoor, d, scope.players)
        : [];
    const switches = new Map(activations.flatMap((a) => a.switches).map((s) => [s.id, s]));
    this.pins.push(
      ...[...switches.values()].map((trigger, index) => ({
        trigger,
        index,
        x: trigger.position.x,
        z: trigger.position.z,
        label: trigger.label,
        trades: 0,
        facing: trigger.facing,
      })),
    );
    this.triggerAreas = [
      ...new Map(activations.flatMap((a) => a.areas ?? []).map((area) => [area.id, area])).values(),
    ];
    this.pins.push(
      ...this.triggerAreas.map((area, index) => ({
        area,
        index,
        x: area.position.x,
        z: area.position.z,
        label: area.label,
        detail:
          area.event === 'leave'
            ? area.allPlayers
              ? 'At least one player must leave this area.'
              : 'Leave this area to rearm the platform.'
            : area.allPlayers
              ? 'All players must enter this trigger area.'
              : 'Enter this trigger area.',
        trades: 0,
        facing: 0,
      })),
    );
    this.doorKey.hidden = doors.length === 0;
    this.platformKey.hidden = platforms.length === 0;
    this.switchKey.hidden = switches.size === 0 && this.triggerAreas.length === 0;
    this.routeKey.hidden = !stage.landmarks?.length && this.route.length < 2;
    this.serviceKey.hidden = !stage.services?.length;
    if (stageChanged) {
      this.pointer = null;
      this.setHover(null);
      this.setHoverPin(null);
      this.image = null;
      this.heightKey.hidden = true;
      this.sceneryKey.hidden = true;
      this.computeBounds(stage);
      this.pendingFit = true;
      this.fit();
      if (stage.map && stage.map.fill < FLAT_FILL) {
        const id = stage.id;
        void this.source.imageUrl(stage.map.image).then((url) => {
          const img = new Image();
          img.onload = () => {
            if (this.stageId === id) {
              this.image = img;
              let varied = false;
              if (stage.map?.shading === 'height') {
                const sample = document.createElement('canvas');
                sample.width = img.naturalWidth;
                sample.height = img.naturalHeight;
                const pixels = sample.getContext('2d', { willReadFrequently: true })!;
                pixels.drawImage(img, 0, 0);
                varied = hasHeightVariation(
                  pixels.getImageData(0, 0, sample.width, sample.height).data,
                );
              }
              this.heightKey.hidden = !varied;
              this.sceneryKey.hidden = !stage.map?.scenery;
              this.updateLegendVisibility();
              this.draw();
            }
          };
          img.src = url;
        });
      }
    }
    // Marker objects are rebuilt when difficulty, party size, filters or selection change.
    // Re-hit the pointer so the tooltip cannot retain a different group's old name or stats.
    if (this.pointer && !this.drag) this.hoverAt(...this.pointer);
    this.updateLegendVisibility();
    if (showTrainRoute || (trainSelectionChanged && !!stage.train)) this.fit();
    this.draw();
  }

  private updateLegendVisibility(): void {
    this.legendEl.hidden = Array.from(this.legendEl.children).every(
      (key) => (key as HTMLElement).hidden,
    );
  }

  private computeBounds(stage: Stage): void {
    if (stage.map) {
      this.bounds = { ...stage.map.bounds };
      return;
    }
    const xs = [...this.markers.map((m) => m.x), ...this.pins.map((p) => p.x)];
    const zs = [...this.markers.map((m) => m.z), ...this.pins.map((p) => p.z)];
    const pad = 120;
    this.bounds = {
      minX: Math.min(...xs, 0) - pad,
      maxX: Math.max(...xs, 0) + pad,
      minZ: Math.min(...zs, 0) - pad,
      maxZ: Math.max(...zs, 0) + pad,
    };
  }

  /** Zoom so the spawners with these indices fill the view (at least a room's worth of map). */
  zoomTo(generators: Set<number>, pins: Set<number> | null = null): void {
    const ms: { x: number; z: number }[] = [
      ...this.markers.filter((m) => generators.has(m.gi)),
      ...this.pins.filter(
        (p) =>
          !p.service &&
          !p.landmark &&
          !p.door &&
          !p.platform &&
          !p.train &&
          !p.area &&
          !p.trigger &&
          pins?.has(p.index),
      ),
    ];
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!ms.length || !w || !hgt) return;
    const xs = ms.map((m) => m.x);
    const zs = ms.map((m) => m.z);
    const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 200);
    const spanZ = Math.max(Math.max(...zs) - Math.min(...zs), 200);
    const scale = Math.min(MAX_SCALE, Math.min(w / spanX, hgt / spanZ) * 0.75);
    this.view = {
      scale,
      tx: w / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale,
      ty: hgt / 2 - ((Math.min(...zs) + Math.max(...zs)) / 2) * scale,
    };
    this.draw();
  }

  fit(): void {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!w || !hgt) {
      this.pendingFit = true;
      return;
    }
    // Frame mechanisms outside the extracted floor too (for example a train gate),
    // while keeping the floor image's original world coordinates intact.
    const b = {
      minX: Math.min(this.bounds.minX, ...this.doorPoints.map((p) => p.x)),
      maxX: Math.max(this.bounds.maxX, ...this.doorPoints.map((p) => p.x)),
      minZ: Math.min(this.bounds.minZ, ...this.doorPoints.map((p) => p.z)),
      maxZ: Math.max(this.bounds.maxZ, ...this.doorPoints.map((p) => p.z)),
    };
    const scale = Math.min(w / (b.maxX - b.minX), hgt / (b.maxZ - b.minZ)) * 0.94;
    this.view = {
      scale,
      tx: w / 2 - ((b.minX + b.maxX) / 2) * scale,
      ty: hgt / 2 - ((b.minZ + b.maxZ) / 2) * scale,
    };
    this.pendingFit = false;
    this.draw();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.pendingFit) this.fit();
    else this.draw();
  }

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const { ctx, view: v } = this;
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const b = this.bounds;
    ctx.save();
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.tx, dpr * v.ty);
    if (this.image) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    } else {
      this.drawGrid(ctx, v);
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRoute(ctx);
    this.drawTriggerAreas(ctx);
    this.drawDoorLinks(ctx);
    const order = [...this.markers].sort((a, c) => this.rank(a) - this.rank(c));
    const triggered = new Set<number>();
    for (const m of order) {
      if (m.trigger && !triggered.has(m.gi)) {
        triggered.add(m.gi);
        this.drawTrigger(ctx, m);
      }
    }
    const withOthers = new Set<number>();
    for (const m of order) {
      if (m.others && !withOthers.has(m.gi)) {
        withOthers.add(m.gi);
        this.drawOthers(ctx, m);
      }
    }
    const labelledGroups = new Set<number>();
    for (const m of order) {
      const label = this.groupNumbers.has(m.gi) && !labelledGroups.has(m.gi);
      this.drawMarker(ctx, m, label);
      if (label) for (const other of markersAtSpot(order, m)) labelledGroups.add(other.gi);
    }
    this.pinLabels = [];
    for (const p of this.pins) this.drawPin(ctx, p);
  }

  private drawRoute(ctx: CanvasRenderingContext2D): void {
    this.drawPath(ctx, this.route, ROUTE_COLOR);
    if (this.deviation.length > 1) this.drawPath(ctx, this.deviation, '#c396ff');
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    points: [number, number, number][],
    color: string,
  ): void {
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    points.forEach(([x, , z], i) => {
      const px = this.view.tx + x * this.view.scale;
      const py = this.view.ty + z * this.view.scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 14, 24, 0.75)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    if (this.trainSteps.size) {
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      let untilArrow = 45;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const dx = (b[0] - a[0]) * this.view.scale,
          dy = (b[2] - a[2]) * this.view.scale;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.01) continue;
        for (; untilArrow < distance; untilArrow += 80) {
          const x = this.view.tx + a[0] * this.view.scale + (dx * untilArrow) / distance;
          const y = this.view.ty + a[2] * this.view.scale + (dy * untilArrow) / distance;
          ctx.beginPath();
          ctx.moveTo(x + (dx / distance) * 5, y + (dy / distance) * 5);
          ctx.lineTo(
            x - (dx / distance) * 5 - (dy / distance) * 4,
            y - (dy / distance) * 5 + (dx / distance) * 4,
          );
          ctx.lineTo(
            x - (dx / distance) * 5 + (dy / distance) * 4,
            y - (dy / distance) * 5 - (dx / distance) * 4,
          );
          ctx.closePath();
          ctx.fill();
        }
        untilArrow -= distance;
      }
    }
    ctx.restore();
  }

  /** A trader: a violet disc with a nose pointing the way it faces, and its name beside it. */
  private drawPin(ctx: CanvasRenderingContext2D, p: Pin): void {
    const sx = this.view.tx + p.x * this.view.scale;
    const sy = this.view.ty + p.z * this.view.scale;
    if (p.door || p.trigger || p.platform || p.area || p.train) {
      this.drawDoorPin(ctx, p, sx, sy);
      return;
    }
    const lit = !p.service && !p.landmark && (this.litPins?.has(p.index) ?? false);
    const r = lit || this.hoverPin === p ? 10 : 8;
    // Rotation is about the vertical axis; 0 faces +z (down the map) and positive turns toward +x.
    const a = (p.facing * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    ctx.fillStyle = p.landmark ? ROUTE_COLOR : p.service ? SERVICE_COLOR : TRADER_COLOR;
    ctx.strokeStyle = lit ? '#ffffff' : 'rgba(10,14,24,0.9)';
    ctx.lineWidth = lit ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!p.landmark) {
      ctx.beginPath();
      ctx.moveTo(sx + dx * r, sy + dy * r);
      ctx.lineTo(sx + dx * (r + 6) - dy * 4, sy + dy * (r + 6) + dx * 4);
      ctx.lineTo(sx + dx * (r + 6) + dy * 4, sy + dy * (r + 6) - dx * 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,14,24,0.85)';
    const labelPosition = this.placePinLabel(ctx, p.label, sx, sy - r - 3);
    ctx.strokeText(p.label, ...labelPosition);
    ctx.fillStyle = lit ? '#ffffff' : p.landmark ? '#ffe0bf' : p.service ? '#c3f7e3' : '#e6dcff';
    ctx.fillText(p.label, ...labelPosition);
    if (lit) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawDoorLinks(ctx: CanvasRenderingContext2D): void {
    const focus = this.focusedPlatform ?? this.focusedDoor;
    if (!focus) return;
    const targets: { x: number; z: number }[] = [
      ...this.pins.filter((p) => p.trigger || p.area),
      ...this.markers.filter((m) => this.highlight?.has(m.gi)),
    ];
    const door = focus.position;
    ctx.save();
    ctx.strokeStyle = this.focusedPlatform ? '#b8e986aa' : '#ffd16690';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    for (const target of targets) {
      ctx.beginPath();
      ctx.moveTo(this.view.tx + door.x * this.view.scale, this.view.ty + door.z * this.view.scale);
      ctx.lineTo(
        this.view.tx + target.x * this.view.scale,
        this.view.ty + target.z * this.view.scale,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDoorPin(ctx: CanvasRenderingContext2D, p: Pin, x: number, y: number): void {
    const selected = !!(
      (p.door && p.door.id === this.focusedDoor?.id) ||
      (p.platform && p.platform.id === this.focusedPlatform?.id) ||
      (p.train && p.train.id === this.selectedTrain)
    );
    const hovered = this.hoverPin === p;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = p.door ? DOOR_COLOR : p.platform ? PLATFORM_COLOR : DOOR_TRIGGER_COLOR;
    ctx.strokeStyle = selected || hovered ? '#fff' : '#101723';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath();
    if (p.platform) {
      ctx.moveTo(-10, -3);
      ctx.lineTo(6, -3);
      ctx.lineTo(11, 2);
      ctx.lineTo(-5, 2);
      ctx.closePath();
      ctx.moveTo(-5, 2);
      ctx.lineTo(-5, 6);
      ctx.lineTo(11, 6);
      ctx.lineTo(11, 2);
    } else if (p.door) {
      ctx.rotate((p.facing * Math.PI) / 180);
      ctx.rect(-11, -4, 22, 8);
    } else {
      ctx.moveTo(0, -8);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-8, 0);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const step = p.train ? this.trainSteps.get(p.train.id) : undefined;
    if (p.train) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#101723';
      ctx.fillText(
        step
          ? String(step)
          : p.train.choice === 'left'
            ? '‹'
            : p.train.choice === 'right'
              ? '›'
              : p.train.choice === 'gate'
                ? '!'
                : '↑',
        x,
        y,
      );
    }
    if (selected || hovered || p.trigger || p.area || step) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#101723';
      const label =
        step && p.train
          ? `${step}. ${p.train.choice === 'gate' ? p.train.label : p.train.choice[0].toUpperCase() + p.train.choice.slice(1)}`
          : p.label;
      const labelPosition = this.placePinLabel(ctx, label, x, y - 12);
      ctx.strokeText(label, ...labelPosition);
      ctx.fillStyle = p.door ? '#ffe6ac' : p.platform ? '#e4ffca' : '#bffaf0';
      ctx.fillText(label, ...labelPosition);
    }
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private placePinLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
  ): [number, number] {
    if (x < 0 || x > this.canvas.clientWidth || y < 0 || y > this.canvas.clientHeight)
      return [x, y];
    const half = ctx.measureText(text).width / 2 + 3;
    const left = Math.max(half + 4, Math.min(x, this.canvas.clientWidth - half - 4));
    let baseline = y;
    for (let row = 0; row < 12; row++) {
      baseline = Math.max(16, y - row * 18);
      const box = {
        left: left - half,
        right: left + half,
        top: baseline - 15,
        bottom: baseline + 3,
      };
      if (
        !this.pinLabels.some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        )
      ) {
        this.pinLabels.push(box);
        break;
      }
    }
    if (Math.abs(baseline - y) > 4 || Math.abs(left - x) > 4) {
      ctx.save();
      ctx.strokeStyle = '#bffaf080';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 5);
      ctx.lineTo(left, baseline + 3);
      ctx.stroke();
      ctx.restore();
    }
    return [left, baseline];
  }

  private drawTriggerAreas(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = DOOR_TRIGGER_COLOR;
    ctx.fillStyle = '#73dfd518';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const area of this.triggerAreas) {
      const b = area.bounds;
      const x = this.view.tx + b.minX * this.view.scale;
      const z = this.view.ty + b.minZ * this.view.scale;
      const width = (b.maxX - b.minX) * this.view.scale;
      const height = (b.maxZ - b.minZ) * this.view.scale;
      ctx.fillRect(x, z, width, height);
      ctx.strokeRect(x, z, width, height);
    }
    ctx.restore();
  }

  private rank(m: Marker): number {
    return markerRank(m, this.selected);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, v: View): void {
    const b = this.bounds;
    ctx.lineWidth = 1 / v.scale;
    ctx.strokeStyle = 'rgba(140,160,190,0.18)';
    const step = 100;
    for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, b.minZ);
      ctx.lineTo(x, b.maxZ);
      ctx.stroke();
    }
    for (let z = Math.ceil(b.minZ / step) * step; z <= b.maxZ; z += step) {
      ctx.beginPath();
      ctx.moveTo(b.minX, z);
      ctx.lineTo(b.maxX, z);
      ctx.stroke();
    }
  }

  /**
   * How close you must get for a radar spawner to start. Drawn only for the spawners you are looking
   * at (hovered, selected or highlighted): drawn for all of them, busy rooms turn into overlapping rings.
   */
  private drawTrigger(ctx: CanvasRenderingContext2D, m: Marker): void {
    if (!m.trigger) return;
    const focused = m.gi === this.selected || m.gi === this.hover?.gi;
    if (!focused && !this.highlight?.has(m.gi)) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = `${KIND_COLOR[m.kind]}${focused ? '26' : '14'}`;
    ctx.strokeStyle = `${KIND_COLOR[m.kind]}${focused ? 'dd' : '80'}`;
    ctx.lineWidth = focused ? 1.8 : 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(
      this.view.tx + m.trigger.x * this.view.scale,
      this.view.ty + m.trigger.z * this.view.scale,
      m.trigger.radius * this.view.scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** A spawner's unused spots, shown faintly on hover or selection so you can see where else it could place enemies. */
  private drawOthers(ctx: CanvasRenderingContext2D, m: Marker): void {
    if (!m.others || !(m.gi === this.selected || m.gi === this.hover?.gi)) return;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    for (const [x, z] of m.others) {
      ctx.beginPath();
      ctx.arc(
        this.view.tx + x * this.view.scale,
        this.view.ty + z * this.view.scale,
        5,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private toScreen(m: Marker): [number, number] {
    return [this.view.tx + m.x * this.view.scale, this.view.ty + m.z * this.view.scale];
  }

  private drawMarker(ctx: CanvasRenderingContext2D, m: Marker, groupLabel = false): void {
    const [sx, sy] = this.toScreen(m);
    const lit = this.highlight !== null && this.highlight.has(m.gi);
    // Everything the current search or item matches is drawn as selected; the rest is left as it was.
    const selected = m.gi === this.selected || lit;
    const r = (selected ? 8 : 6) * (m.badge > 1 ? 1.5 : 1);
    ctx.globalAlpha = m.unused ? 0.4 : 1;
    ctx.fillStyle = KIND_COLOR[m.kind];
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(10,14,24,0.9)';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath();
    if (m.kind === 'object') ctx.rect(sx - r * 0.85, sy - r * 0.85, r * 1.7, r * 1.7);
    else if (m.kind === 'boss') {
      ctx.moveTo(sx, sy - r * 1.25);
      ctx.lineTo(sx + r * 1.25, sy);
      ctx.lineTo(sx, sy + r * 1.25);
      ctx.lineTo(sx - r * 1.25, sy);
      ctx.closePath();
    } else ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (m.badge > 1) {
      ctx.fillStyle = '#0b0f18';
      ctx.font = `700 ${m.badge >= 10 ? 10 : 12}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.badge), sx, sy + 0.5);
    }
    if (lit) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (groupLabel) {
      const groups = [
        ...new Set(
          markersAtSpot(this.markers, m)
            .map((other) => this.groupNumbers.get(other.gi))
            .filter((n): n is number => n !== undefined),
        ),
      ].sort((a, b) => a - b);
      const text =
        groups.length > 1 ? `Groups ${groups.join(', ')}` : `Group ${this.groupNumbers.get(m.gi)}`;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,14,24,0.95)';
      const width = ctx.measureText(text).width;
      const labelX = Math.max(width / 2 + 5, Math.min(sx, this.canvas.clientWidth - width / 2 - 5));
      ctx.strokeText(text, labelX, sy - r - 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, labelX, sy - r - 4);
    }
    ctx.globalAlpha = 1;
  }

  // --- interaction -------------------------------------------------------------------------

  private pickPin(px: number, py: number): Pin | null {
    let best: Pin | null = null;
    let bestD = (HIT_RADIUS + 4) ** 2;
    for (const p of this.pins) {
      const d =
        (this.view.tx + p.x * this.view.scale - px) ** 2 +
        (this.view.ty + p.z * this.view.scale - py) ** 2;
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  private pick(px: number, py: number): Marker | null {
    return pickMarker(this.markers, (m) => this.toScreen(m), px, py, this.selected, HIT_RADIUS);
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent): void {
    this.drag = { x: e.clientX, y: e.clientY, moved: false };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const [px, py] = this.local(e);
    this.pointer = [px, py];
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
      if (this.drag.moved) {
        this.view = { ...this.view, tx: this.view.tx + dx, ty: this.view.ty + dy };
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.setHover(null);
        this.draw();
      }
      return;
    }
    this.hoverAt(px, py);
  }

  private hoverAt(px: number, py: number): void {
    const pin = this.pickPin(px, py);
    this.setHoverPin(pin, px, py);
    if (pin) this.setHover(null);
    else this.setHover(this.pick(px, py), px, py);
  }

  private onUp(e: PointerEvent): void {
    const wasClick = this.drag && !this.drag.moved;
    this.drag = null;
    if (wasClick) {
      const [px, py] = this.local(e);
      this.pointer = [px, py];
      const pin = this.pickPin(px, py);
      if (pin) {
        if (pin.train) {
          this.events.onTrain(pin.train.id);
          return;
        }
        if (pin.door) {
          this.events.onDoor(pin.door.id);
          return;
        }
        if (pin.platform) {
          this.events.onPlatform(pin.platform.id);
          return;
        }
        if (pin.area) return;
        if (pin.trigger) return;
        if (pin.landmark) return;
        if (pin.service) this.events.onService(pin.index);
        else this.events.onTrader(pin.index);
        return;
      }
      const hit = this.pick(px, py);
      const m = hit ? nextMarkerAtSpot(this.markers, hit, this.selected) : null;
      this.setHover(m, px, py);
      this.events.onSelect(m ? m.gi : null);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const [px, py] = this.local(e);
    const factor = Math.exp(-e.deltaY * 0.0012);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.view.scale * factor));
    const k = scale / this.view.scale;
    this.view = { scale, tx: px - (px - this.view.tx) * k, ty: py - (py - this.view.ty) * k };
    this.pointer = [px, py];
    this.hoverAt(px, py);
    this.draw();
  }

  private placeTip(px: number, py: number): void {
    this.tip.style.left = `${Math.max(8, Math.min(px + 14, this.el.clientWidth - this.tip.offsetWidth - 8))}px`;
    this.tip.style.top = `${Math.max(8, Math.min(py + 14, this.el.clientHeight - this.tip.offsetHeight - 8))}px`;
  }

  private setHoverPin(p: Pin | null, px = 0, py = 0): void {
    if (p === this.hoverPin) return;
    this.hoverPin = p;
    this.draw();
    if (!p) {
      if (!this.hover) this.tip.hidden = true;
      return;
    }
    this.canvas.style.cursor = 'pointer';
    this.tip.replaceChildren(
      h('strong', null, p.label),
      h(
        'span',
        { class: 'muted' },
        p.landmark
          ? p.landmark.description
          : p.door || p.platform || p.area || p.train
            ? (p.detail ?? 'Select to see what opens this door.')
            : p.trigger
              ? p.trigger.action === 'destroy'
                ? 'Destroy this object to complete the requirement.'
                : p.trigger.action === 'break'
                  ? 'Break this object to complete the requirement.'
                  : p.trigger.action === 'hold'
                    ? 'Stand on this button and keep it held.'
                    : 'Activates the selected mechanism.'
              : p.service
                ? `${p.service.name} · ${p.service.description}`
                : `${p.trades} trades on this difficulty`,
      ),
    );
    this.tip.hidden = false;
    this.placeTip(px, py);
  }

  private setHover(m: Marker | null, px = 0, py = 0): void {
    if (m === this.hover && m === null) return;
    const before = this.hover;
    this.hover = m;
    // Hover reveals a spawner's other spots and its trigger ring, so those need a redraw.
    const reveals = (x: Marker | null) => !!(x?.others || x?.trigger);
    if ((reveals(before) || reveals(m)) && before?.gi !== m?.gi) this.draw();
    this.canvas.style.cursor = m ? 'pointer' : 'grab';
    if (!m) {
      if (!this.hoverPin) this.tip.hidden = true;
      return;
    }
    const others = markersAtSpot(this.markers, m).filter((other) => other.gi !== m.gi);
    const groups = [m, ...others];
    this.tip.replaceChildren(
      ...groups.slice(0, 4).flatMap((group) => [
        h('strong', null, group.label),
        ...group.detail
          .split('\n')
          .filter(Boolean)
          .map((t) => h('span', { class: 'muted' }, t)),
      ]),
      ...(others.length
        ? [
            h(
              'span',
              { class: 'muted' },
              `${groups.length} groups share this point${groups.length > 4 ? ` (${groups.length - 4} more)` : ''} · Click again to select another group`,
            ),
          ]
        : []),
    );
    this.tip.hidden = false;
    this.placeTip(px, py);
  }
}
