// Accessible HSV color wheel: drag/click to pick hue + saturation, a slider for brightness.
// Keyboard: ←/→ hue, ↑/↓ saturation (Shift = bigger steps). The brightness slider is a native range.
import { hexToHsv, hsvToHex, clamp } from './core.js';

export function createWheel(el, { label, onChange }) {
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', `${label} color wheel. Left and right arrows change hue, up and down change saturation.`);
  const knob = document.createElement('span');
  knob.className = 'wheel-knob';
  el.append(knob);

  const bright = document.createElement('input');
  bright.type = 'range';
  bright.min = '15';
  bright.max = '100';
  bright.className = 'wheel-bright';
  bright.setAttribute('aria-label', `${label} brightness`);
  el.after(bright);

  let hsv = { h: 0, s: 1, v: 1 };
  let hex = '#ff0000';

  function render() {
    const r = hsv.s * 50;
    const a = (hsv.h * Math.PI) / 180; // 0° = top, clockwise, matching the CSS conic gradient
    knob.style.left = `${50 + r * Math.sin(a)}%`;
    knob.style.top = `${50 - r * Math.cos(a)}%`;
    knob.style.background = hex;
    el.style.setProperty('--v', String(hsv.v));
    bright.value = String(Math.round(hsv.v * 100));
    bright.style.setProperty('--fill', `${((hsv.v * 100 - 15) / 85) * 100}%`);
    el.setAttribute('aria-valuetext', `${hex}, hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)}%`);
  }

  function commit(next) {
    hsv = { h: ((next.h % 360) + 360) % 360, s: clamp(next.s, 0, 1), v: clamp(next.v, 0.15, 1) };
    hex = hsvToHex(hsv);
    render();
    onChange(hex);
  }

  function fromPointer(e) {
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const h = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    commit({ h, s, v: hsv.v });
  }

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    el.focus();
    fromPointer(e);
  });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fromPointer(e); });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 3;
    const map = {
      ArrowLeft: { h: hsv.h - step }, ArrowRight: { h: hsv.h + step },
      ArrowUp: { s: hsv.s + step / 100 }, ArrowDown: { s: hsv.s - step / 100 },
    };
    if (!map[e.key]) return;
    e.preventDefault();
    commit({ ...hsv, ...map[e.key] });
  });
  bright.addEventListener('input', () => commit({ ...hsv, v: Number(bright.value) / 100 }));

  return {
    /** Sync from settings without echoing back, keeping hue stable for greys. */
    set(nextHex) {
      if (nextHex === hex) return;
      const n = hexToHsv(nextHex);
      hsv = { h: n.s === 0 ? hsv.h : n.h, s: n.s, v: Math.max(0.15, n.v) };
      hex = nextHex;
      render();
    },
    setDisabled(disabled) {
      el.setAttribute('aria-disabled', String(disabled));
      el.tabIndex = disabled ? -1 : 0;
      el.style.pointerEvents = disabled ? 'none' : '';
      bright.disabled = disabled;
    },
  };
}
