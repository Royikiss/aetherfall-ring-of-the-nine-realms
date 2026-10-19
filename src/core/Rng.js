/**
 * Rng — 可复现的确定性随机数（mulberry32）。
 * 开放世界的所有程序化内容都必须经由它生成，保证「同一个种子 = 同一个世界」。
 */
export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._s = this.seed || 1;
  }

  /** 重置到初始种子 */
  reset() { this._s = this.seed || 1; }

  /** [0,1) 均匀分布 */
  next() {
    let t = (this._s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1) { return min + this.next() * (max - min); }

  /** [min,max] 整数 */
  int(min, max) { return Math.floor(this.float(min, max + 1)); }

  chance(p) { return this.next() < p; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** 带权重挑选：items = [{w, ...}] */
  weighted(items, key = 'w') {
    let total = 0;
    for (const it of items) total += it[key] || 1;
    let r = this.next() * total;
    for (const it of items) {
      r -= it[key] || 1;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** 近似正态分布（Irwin–Hall） */
  gaussian(mean = 0, dev = 1) {
    const n = (this.next() + this.next() + this.next() + this.next()) / 4;
    return mean + (n - 0.5) * 3.464 * dev;
  }

  /** 原地洗牌 */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** 随机单位向量（水平面） */
  dirXZ() {
    const a = this.next() * Math.PI * 2;
    return { x: Math.cos(a), z: Math.sin(a) };
  }
}

/** 字符串 → 32 位种子（用于按区域名生成稳定内容） */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 全局默认随机源（非确定性场景用，例如 UI 抖动） */
export const rand = new Rng(20261019);
