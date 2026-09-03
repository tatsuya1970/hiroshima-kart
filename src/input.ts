// キーボード / タッチ入力
export interface Input {
  throttle: number; // 0..1
  brake: number;    // 0..1
  steer: number;    // -1 (左) .. 1 (右)
  drift: boolean;
  item: boolean;    // 押した瞬間だけ true
  lookBack: boolean;
}

export class InputManager {
  keys = new Set<string>();
  private itemPressed = false;
  private itemLatched = false;
  onCamera: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onAny: (() => void) | null = null;
  touch = { left: false, right: false, gas: false, drift: false, item: false };

  constructor() {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'KeyM') this.onMute?.();
      if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Enter' || e.code === 'KeyX') this.itemPressed = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.onAny?.();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const bind = (id: string, key: keyof typeof this.touch) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e: Event) => { e.preventDefault(); this.touch[key] = true; if (key === 'item') this.itemPressed = true; this.onAny?.(); };
      const off = (e: Event) => { e.preventDefault(); this.touch[key] = false; };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    };
    bind('tLeft', 'left'); bind('tRight', 'right'); bind('tGas', 'gas'); bind('tDrift', 'drift'); bind('tItem', 'item');
  }

  read(): Input {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA') || this.touch.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || this.touch.right;
    const item = this.itemPressed && !this.itemLatched;
    this.itemLatched = this.itemPressed;
    this.itemPressed = false;
    return {
      throttle: (k.has('ArrowUp') || k.has('KeyW') || this.touch.gas) ? 1 : 0,
      brake: (k.has('ArrowDown') || k.has('KeyS')) ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      drift: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space') || this.touch.drift,
      item,
      lookBack: k.has('KeyB'),
    };
  }
}
