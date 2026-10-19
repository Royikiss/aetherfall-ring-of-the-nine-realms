/**
 * EventBus — 极简发布订阅，整个工程唯一的事件中枢。
 * 设计目的：系统之间零直接依赖，全部通过事件解耦（便于多人并行开发与后续扩展）。
 *
 * API:
 *   const off = bus.on('type', fn)
 *   bus.once('type', fn)
 *   bus.off('type', fn)
 *   bus.emit('type', payload)
 *
 * 约定：监听器抛出的异常不会阻断其它监听器（污染隔离）。
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    this._silent = false;
  }

  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this._listeners.delete(type);
  }

  emit(type, payload) {
    if (this._silent) return;
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return;
    // 复制一份，允许监听器内部增删订阅
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] listener error on "${type}"`, err);
      }
    }
  }

  /** 调试：静音全部事件 */
  setSilent(v) { this._silent = !!v; }

  clear() { this._listeners.clear(); }
}
