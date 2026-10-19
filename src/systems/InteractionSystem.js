/**
 * InteractionSystem.js — 交互目标扫描与触发。
 *
 * 世界中的可交互物（圣火、NPC、宝箱、拾取物）由 Landmarks 注册到 world.interactables，
 * 本系统每帧寻找最近的目标，向 HUD 广播提示，并在按下交互键时执行回调。
 */
export class InteractionSystem {
  static id = 'interaction';

  constructor(game) {
    this.game = game;
    this.focus = null;
    this._lastFocusId = null;
  }

  init() {
    this.game.events.on('ui:modal', ({ open }) => {
      if (open && this.focus) {
        this.focus = null;
        this._lastFocusId = null;
        this.game.events.emit('interaction:focus', null);
      }
    });
  }

  update(dt) {
    const game = this.game;
    const player = game.player;
    if (!player) return;

    const modal = game.ui?.isOpen?.() || game.ui?.isDialogueOpen?.();
    if (modal) return;

    // ---- 寻找最近的交互目标 ----
    let best = null;
    let bestD = Infinity;
    for (const it of game.world.interactables) {
      if (it.enabled === false) continue;
      if (it.disabled) continue;
      const dx = it.position.x - player.position.x;
      const dz = it.position.z - player.position.z;
      const dy = it.position.y - player.position.y;
      if (Math.abs(dy) > 6) continue;
      const d = Math.hypot(dx, dz);
      if (d > (it.radius || 4)) continue;
      if (d < bestD) { bestD = d; best = it; }
    }

    if (best !== this.focus) {
      this.focus = best;
      if (best) {
        game.events.emit('interaction:focus', {
          label: best.label || '交互',
          key: 'F',
          id: best.id,
          kind: best.kind,
        });
      } else {
        game.events.emit('interaction:focus', null);
      }
    }

    // ---- 触发 ----
    if (this.focus && game.input.enabled && !modal && game.input.wasPressed('interact')) {
      const target = this.focus;
      try {
        const result = target.onInteract?.(target);
        if (target.once && result !== false) {
          target.disabled = true;
          // 从世界中移除已完成的交互点
          const idx = game.world.interactables.indexOf(target);
          if (idx >= 0) game.world.interactables.splice(idx, 1);
          this.focus = null;
          game.events.emit('interaction:focus', null);
        }
        game.systems?.audio?.play?.('ui_click', { volume: 0.4 });
      } catch (err) {
        console.error('[Interaction] error', err);
      }
    }
  }
}
