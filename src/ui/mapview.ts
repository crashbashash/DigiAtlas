import type { DataSource } from '../data/source';
import type { Model } from '../data/model';
import type { Difficulty, Enemy, EnemyKind, Stage } from '../data/types';
import { h } from './dom';
import { makeMarkers, type Marker } from './markers';

export const KIND_COLOR: Record<EnemyKind, string> = {
  enemy: '#ff6b6b',
  boss: '#ffcc4d',
  object: '#6bc7ff',
};
export const KIND_LABEL: Record<EnemyKind, string> = { enemy: 'Enemy', boss: 'Boss', object: 'Box / crate / barrel' };

interface View {
  tx: number;
  ty: number;
  scale: number;
}

export interface MapEvents {
  onSelect(generator: number | null): void;
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
  private readonly tip = h('div', { class: 'tip', hidden: true });
  private view: View = { tx: 0, ty: 0, scale: 1 };
  private bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  private image: HTMLImageElement | null = null;
  private markers: Marker[] = [];
  private highlight: Set<number> | null = null;
  private selected: number | null = null;
  private stageId: string | null = null;
  private pendingFit = false;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private hover: Marker | null = null;

  constructor(
    private readonly model: Model,
    private readonly source: DataSource,
    private readonly events: MapEvents,
  ) {
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'map' }, this.canvas, this.tip, this.legend());
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => this.setHover(null));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.fit());
  }

  private legend(): HTMLElement {
    return h(
      'div',
      { class: 'legend' },
      ...(Object.keys(KIND_COLOR) as EnemyKind[]).map((k) =>
        h('span', null, h('i', { style: `background:${KIND_COLOR[k]}` }), KIND_LABEL[k]),
      ),
      h('span', { class: 'muted' }, 'Dashed circle = how close you must get · number = enemies at that spot'),
    );
  }

  show(stage: Stage, d: Difficulty, highlight: Set<number> | null, selected: number | null): void {
    const stageChanged = stage.id !== this.stageId;
    this.stageId = stage.id;
    this.highlight = highlight;
    this.selected = selected;
    this.markers = this.buildMarkers(stage, d);
    if (stageChanged) {
      this.setHover(null);
      this.image = null;
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
              this.draw();
            }
          };
          img.src = url;
        });
      }
    }
    this.draw();
  }

  private buildMarkers(stage: Stage, d: Difficulty): Marker[] {
    return makeMarkers(this.model.generators(stage, d), this.model.enemies, this.model.hideUnused);
  }

  private computeBounds(stage: Stage): void {
    if (stage.map) {
      this.bounds = { ...stage.map.bounds };
      return;
    }
    const xs = this.markers.map((m) => m.x);
    const zs = this.markers.map((m) => m.z);
    const pad = 120;
    this.bounds = {
      minX: Math.min(...xs, 0) - pad,
      maxX: Math.max(...xs, 0) + pad,
      minZ: Math.min(...zs, 0) - pad,
      maxZ: Math.max(...zs, 0) + pad,
    };
  }

  /** Zoom so the spawners with these indices fill the view (at least a room's worth of map). */
  zoomTo(generators: Set<number>): void {
    const ms = this.markers.filter((m) => generators.has(m.gi));
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!ms.length || !w || !hgt) return;
    const xs = ms.map((m) => m.x);
    const zs = ms.map((m) => m.z);
    const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 200);
    const spanZ = Math.max(Math.max(...zs) - Math.min(...zs), 200);
    const scale = Math.min(MAX_SCALE, (Math.min(w / spanX, hgt / spanZ)) * 0.75);
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
    const b = this.bounds;
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
    for (const m of order) this.drawMarker(ctx, m);
  }

  private rank(m: Marker): number {
    return (m.gi === this.selected ? 100 : 0) + (m.kind === 'object' ? 0 : m.kind === 'enemy' ? 1 : 2);
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

  /** How close you must get for a radar spawner to start; stronger on hover or selection. */
  private drawTrigger(ctx: CanvasRenderingContext2D, m: Marker): void {
    if (!m.trigger) return;
    const strong = m.gi === this.selected || m.gi === this.hover?.gi;
    ctx.globalAlpha = 1;
    ctx.fillStyle = `${KIND_COLOR[m.kind]}${strong ? '26' : '0d'}`;
    ctx.strokeStyle = `${KIND_COLOR[m.kind]}${strong ? 'dd' : '4d'}`;
    ctx.lineWidth = strong ? 1.8 : 1;
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
      ctx.arc(this.view.tx + x * this.view.scale, this.view.ty + z * this.view.scale, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private toScreen(m: Marker): [number, number] {
    return [this.view.tx + m.x * this.view.scale, this.view.ty + m.z * this.view.scale];
  }

  private drawMarker(ctx: CanvasRenderingContext2D, m: Marker): void {
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
    ctx.globalAlpha = 1;
  }

  // --- interaction -------------------------------------------------------------------------

  private pick(px: number, py: number): Marker | null {
    let best: Marker | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const m of this.markers) {
      const [sx, sy] = this.toScreen(m);
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d <= bestD && (d < bestD || (best && this.rank(m) > this.rank(best)))) {
        best = m;
        bestD = d;
      }
    }
    return best;
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
    this.setHover(this.pick(px, py), px, py);
  }

  private onUp(e: PointerEvent): void {
    const wasClick = this.drag && !this.drag.moved;
    this.drag = null;
    if (wasClick) {
      const [px, py] = this.local(e);
      const m = this.pick(px, py);
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
    this.draw();
  }

  private setHover(m: Marker | null, px = 0, py = 0): void {
    if (m === this.hover && m === null) return;
    const before = this.hover;
    this.hover = m;
    if ((before?.others || m?.others) && before?.gi !== m?.gi) this.draw();
    this.canvas.style.cursor = m ? 'pointer' : 'grab';
    if (!m) {
      this.tip.hidden = true;
      return;
    }
    this.tip.replaceChildren(h('strong', null, m.label), ...m.detail.split('\n').filter(Boolean).map((t) => h('span', { class: 'muted' }, t)));
    this.tip.hidden = false;
    this.tip.style.left = `${px + 14}px`;
    this.tip.style.top = `${py + 14}px`;
  }
}
