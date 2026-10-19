/**
 * SaveSystem.js — 本地存档（localStorage）。
 *
 * 存档内容：玩家位置/朝向、属性与状态、背包与装备、地图迷雾与标记、
 * 任务进度、世界状态（点亮的圣火、已发现 POI）、世界时间。
 *
 * 快捷键：F5 保存 / F9 读取；每 90 秒自动保存一次。
 */
export class SaveSystem {
  static id = 'save';
  static KEY = 'aetherfall.save.v1';
  static VERSION = 1;

  constructor(game) {
    this.game = game;
    this.autoTimer = 0;
    this.enabled = true;
  }

  init() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') {
        e.preventDefault();
        this.save();
      } else if (e.code === 'F9') {
        e.preventDefault();
        this.load();
      }
    });
  }

  hasSave() {
    try {
      return !!localStorage.getItem(SaveSystem.KEY);
    } catch (err) {
      return false;
    }
  }

  /** 收集所有系统的状态 */
  collect() {
    const g = this.game;
    return {
      version: SaveSystem.VERSION,
      savedAt: Date.now(),
      timeOfDay: g.atmosphere?.timeOfDay ?? 0.7,
      player: g.player?.toJSON?.(),
      stats: g.systems?.stats?.toJSON?.(),
      inventory: g.systems?.inventory?.toJSON?.(),
      map: g.systems?.map?.toJSON?.(),
      quest: g.systems?.quest?.toJSON?.(),
      world: g.world?.toJSON?.(),
      combat: g.systems?.combat?.toJSON?.(),
      audio: g.systems?.audio?.toJSON?.(),
    };
  }

  save(silent = false) {
    if (!this.game.started) return false;
    try {
      const data = this.collect();
      localStorage.setItem(SaveSystem.KEY, JSON.stringify(data));
      this.game.events.emit('game:saved', { at: data.savedAt });
      if (!silent) {
        this.game.ui?.toast('旅程已铭刻于符文石。', {
          kind: 'quest', latin: 'PROGRESS SAVED', glyph: 'ᛞ',
        });
        this.game.systems?.audio?.play?.('ui_open', { volume: 0.5 });
      }
      return true;
    } catch (err) {
      console.error('[Save] failed', err);
      if (!silent) this.game.ui?.toast('存档失败：浏览器存储不可用。', { kind: 'danger' });
      return false;
    }
  }

  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(SaveSystem.KEY);
    } catch (err) {
      raw = null;
    }
    if (!raw) {
      this.game.ui?.toast('尚未留下任何符文记录。', { kind: 'info', latin: 'NO SAVE' });
      return false;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.game.ui?.toast('存档已损坏。', { kind: 'danger', latin: 'CORRUPTED' });
      return false;
    }
    if (!data || data.version !== SaveSystem.VERSION) {
      this.game.ui?.toast('存档版本不兼容。', { kind: 'danger' });
      return false;
    }
    return this.apply(data);
  }

  /** 应用存档数据（也用于"继续旅程"） */
  apply(data) {
    const g = this.game;
    try {
      if (data.timeOfDay != null && g.atmosphere) g.atmosphere.timeOfDay = data.timeOfDay;
      g.player?.fromJSON?.(data.player);
      g.systems?.stats?.fromJSON?.(data.stats);
      g.systems?.inventory?.fromJSON?.(data.inventory);
      g.systems?.map?.fromJSON?.(data.map);
      g.systems?.quest?.fromJSON?.(data.quest);
      g.world?.fromJSON?.(data.world);
      g.systems?.combat?.fromJSON?.(data.combat);
      g.systems?.audio?.fromJSON?.(data.audio);

      // 位置修正：确保玩家站在地面上
      if (g.player) {
        g.player.position.y = g.world.groundAt(g.player.position.x, g.player.position.z, 1e9);
        g.camera3p?.snapBehind?.();
        if (g.camera3p) g.camera3p._initialized = false;
      }
      g.events.emit('game:loaded', { at: data.savedAt });
      g.ui?.toast('符文记录已展开。', { kind: 'quest', latin: 'PROGRESS RESTORED', glyph: 'ᛟ' });
      return true;
    } catch (err) {
      console.error('[Save] load failed', err);
      g.ui?.toast('读取存档时发生错误。', { kind: 'danger' });
      return false;
    }
  }

  /** 供"继续旅程"使用：读取但不触发读档提示 */
  loadSilent() {
    try {
      const raw = localStorage.getItem(SaveSystem.KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.version !== SaveSystem.VERSION) return false;
      return this.apply(data);
    } catch (err) {
      return false;
    }
  }

  deleteSave() {
    try {
      localStorage.removeItem(SaveSystem.KEY);
    } catch (err) { /* ignore */ }
  }

  update(dt) {
    if (!this.game.started) return;
    this.autoTimer += dt;
    if (this.autoTimer > 90) {
      this.autoTimer = 0;
      this.save(true);
    }
  }
}
