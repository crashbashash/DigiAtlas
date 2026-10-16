import { pan, zoomAt, type Viewport } from './viewport';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const status = document.getElementById('status')!;
let view: Viewport = { x: 0, y: 0, scale: 1 };

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = canvas;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
  // Placeholder grid until floor maps load.
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeStyle = '#2c313a';
  for (let i = -50; i <= 50; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64, -3200);
    ctx.lineTo(i * 64, 3200);
    ctx.moveTo(-3200, i * 64);
    ctx.lineTo(3200, i * 64);
    ctx.stroke();
  }
  status.textContent = `Zoom ${(view.scale * 100).toFixed(0)}%`;
}

let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view = pan(view, e.clientX - drag.x, e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
  draw();
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    view = zoomAt(view, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.001));
    draw();
  },
  { passive: false },
);
window.addEventListener('resize', draw);
view = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, scale: 1 };
draw();
