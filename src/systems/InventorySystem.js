/**
 * InventorySystem.js — 行囊与装备系统
 *
 * 模块职责：
 *  - 维护 24 格行囊（同类物品按 def.stack 堆叠）、五个装备槽（weapon/shield/cloak/amulet/hands）；
 *  - 解释 data/items.js 的 `use` 字段（heal / stamina / mana / status / xp），转交 StatsSystem；
 *  - 解释 `equip` 字段：装备变化后聚合 maxHealth / armor / damage / moveSpeed /
 *    staminaRegen / manaRegen，并写入 game.systems.stats.setEquipmentBonuses()；
 *  - 负重仅用于展示（超重不禁止移动）；
 *  - init() 中注册「行囊」面板（id 'inventory'，hotkey 'i'）。
 *
 * 对外 API：
 *   inv.items            -> [{ id, count, def }]     行囊内物品（已装备的不在 items 中）
 *   inv.capacity         -> 24
 *   inv.add(id, count=1) -> boolean（格子不足返回 false，不做部分放入）
 *   inv.remove(id, count=1) -> boolean
 *   inv.count(id)        -> number
 *   inv.use(id)          -> boolean（消耗品）
 *   inv.equip(id) / inv.unequip(slot) -> boolean
 *   inv.equipment        -> { weapon, shield, cloak, amulet, hands }  值是物品定义对象或 null
 *   inv.equipmentId(slot) / inv.equipped(slot)
 *   inv.totalWeight() / inv.capacityWeight() / inv.freeSlots()
 *   inv.bonuses          -> 聚合后的装备加成
 *   inv.toJSON() / inv.fromJSON(data)
 *
 * 发出事件：
 *   'inventory:changed' {item, id, count, delta, action}
 *        action ∈ 'add' | 'remove' | 'use' | 'equip' | 'unequip'
 *        count 是变化后该物品在行囊中的总数（已装备时为 0）
 *   'equipment:changed' {slot, item, action:'equip'|'unequip'}
 *   'item:used' {id, def}
 *
 * 监听事件：
 *   'item:collected' {id, count} —— InteractionSystem 拾取后只需 emit，由本系统入包。
 *
 * 依赖：data/items.js、game.events、game.ui、game.systems.stats。
 */
import { getItem, ITEMS } from '../data/items.js';
import { setupInventoryPanel } from '../ui/InventoryPanel.js';

/** 装备槽顺序（与 UI 人偶一致，勿随意改动） */
export const EQUIP_SLOTS = ['weapon', 'shield', 'cloak', 'amulet', 'hands'];

const STARTING_ITEMS = [
  ['mead_horn', 2],
  ['sage_herb', 1],
  ['sword_einherjar', 1],
];

const BONUS_KEYS = ['maxHealth', 'armor', 'damage', 'moveSpeed', 'staminaRegen', 'manaRegen'];

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

export class InventorySystem {
  static id = 'inventory';

  constructor(game) {
    this.game = game;
    this.events = game?.events || null;

    /** @type {Array<{id:string,count:number,def:object}>} */
    this.items = [];
    this.capacity = 24;

    /** @type {{weapon:object|null,shield:object|null,cloak:object|null,amulet:object|null,hands:object|null}} */
    this.equipment = { weapon: null, shield: null, cloak: null, amulet: null, hands: null };

    /** 聚合后的装备加成（供 UI / 其他系统读取） */
    this.bonuses = { maxHealth: 0, armor: 0, damage: 0, moveSpeed: 0, staminaRegen: 0, manaRegen: 0 };
    /** 武器攻击速度倍率（不在 StatsSystem 契约内，供 Combat 可选使用） */
    this.attackSpeedBonus = 0;

    this._inited = false;
    this._seeded = false;
    this._offs = [];
  }

  // ================================================================ 生命周期
  init() {
    if (this._inited) return;
    this._inited = true;

    this._seedStartingItems();
    this._bindEvents();
    setupInventoryPanel(this.game);
    this._applyEquipmentBonuses();
  }

  /** 行囊目前不需要逐帧逻辑（预留：拾取动画、自动整理等） */
  update(dt) { /* no-op */ }

  // ================================================================ 增删
  /**
   * 放入物品。容量不足时整体失败（返回 false，不做部分放入）。
   */
  add(id, count = 1) {
    const n = Math.max(1, Math.floor(num(count, 1)));
    if (!this._insert(id, n)) return false;
    this._emitChanged(getItem(id), 'add', n);
    return true;
  }

  /** 移除物品。数量不足时整体失败。 */
  remove(id, count = 1) {
    const n = Math.max(1, Math.floor(num(count, 1)));
    if (this.count(id) < n) return false;

    let remaining = n;
    for (let i = this.items.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const entry = this.items[i];
      if (entry.id !== id) continue;
      const take = Math.min(entry.count, remaining);
      entry.count -= take;
      remaining -= take;
      if (entry.count <= 0) this.items.splice(i, 1);
    }

    this._emitChanged(getItem(id), 'remove', -n);
    return true;
  }

  /** 行囊中该物品的总数（已装备的物品不计入） */
  count(id) {
    let total = 0;
    for (const entry of this.items) {
      if (entry.id === id) total += entry.count;
    }
    return total;
  }

  freeSlots() { return Math.max(0, this.capacity - this.items.length); }

  // ================================================================ 使用
  /**
   * 使用消耗品：解释 def.use 并转交 StatsSystem。
   * @returns {boolean} 是否成功消耗
   */
  use(id) {
    const stats = this.game?.systems?.stats;
    const index = this.items.findIndex((entry) => entry.id === id);
    if (index < 0 || !stats || stats.isDead) return false;

    const def = getItem(id);
    const effect = def.use;
    if (!effect || typeof effect !== 'object') return false;

    let applied = false;
    if (num(effect.heal) > 0) { stats.heal(effect.heal); applied = true; }
    if (num(effect.stamina) > 0) { stats.restoreStamina(effect.stamina); applied = true; }
    if (num(effect.mana) > 0) { stats.restoreMana(effect.mana); applied = true; }
    if (effect.status) { stats.applyStatus(effect.status); applied = true; }
    if (num(effect.xp) > 0) { stats.addXp(effect.xp); applied = true; }
    if (!applied) return false;

    // 消耗一件
    const entry = this.items[index];
    entry.count -= 1;
    if (entry.count <= 0) this.items.splice(index, 1);

    this.events?.emit('item:used', { id, def });
    this._emitChanged(def, 'use', -1);
    return true;
  }

  // ================================================================ 装备
  /**
   * 装备行囊中的某件物品。槽位已有装备时自动换下（换下的回到行囊）。
   * @returns {boolean}
   */
  equip(id) {
    const def = getItem(id);
    const equipDef = def.equip;
    const slot = equipDef?.slot;
    if (!slot || !EQUIP_SLOTS.includes(slot)) return false;

    const index = this.items.findIndex((entry) => entry.id === id);
    if (index < 0) return false;

    const current = this.equipment[slot];
    if (current && current.id === id) return false;

    // 先从行囊取出一件
    const entry = this.items[index];
    entry.count -= 1;
    if (entry.count <= 0) this.items.splice(index, 1);

    this.equipment[slot] = def;
    if (current && !this._insert(current.id, 1)) {
      // 极端情况（容量异常）回滚，保证不丢物品
      this.equipment[slot] = current;
      this._insert(def.id, 1);
      return false;
    }

    this._applyEquipmentBonuses();
    this._emitChanged(def, 'equip', -1);
    this.events?.emit('equipment:changed', { slot, item: def, action: 'equip' });
    return true;
  }

  /**
   * 卸下某个槽位的装备（放回行囊）。
   * @returns {boolean} 行囊已满时返回 false 且保持装备状态
   */
  unequip(slot) {
    if (!EQUIP_SLOTS.includes(slot)) return false;
    const def = this.equipment[slot];
    if (!def) return false;
    if (!this._insert(def.id, 1)) return false;

    this.equipment[slot] = null;
    this._applyEquipmentBonuses();
    this._emitChanged(def, 'unequip', 1);
    this.events?.emit('equipment:changed', { slot, item: null, action: 'unequip' });
    return true;
  }

  /** 槽位上的物品定义（或 null） */
  equipped(slot) { return this.equipment[slot] || null; }

  /** 槽位上装备的 id（或 null），方便只要字符串的调用方 */
  equipmentId(slot) { return this.equipment[slot]?.id || null; }

  /** 该物品当前装备在哪个槽位（未装备返回 null） */
  slotOf(id) {
    for (const slot of EQUIP_SLOTS) {
      if (this.equipment[slot]?.id === id) return slot;
    }
    return null;
  }

  // ================================================================ 负重（仅展示）
  totalWeight() {
    let weight = 0;
    for (const entry of this.items) weight += num(entry.def?.weight) * entry.count;
    return Math.round(weight * 10) / 10;
  }

  /** 负重上限：随等级缓慢增长（等级越高背得越多） */
  capacityWeight() {
    const level = Math.max(1, Math.floor(num(this.game?.systems?.stats?.level, 1)));
    return 60 + (level - 1) * 4;
  }

  // ================================================================ 存读档
  toJSON() {
    const equipment = {};
    for (const slot of EQUIP_SLOTS) equipment[slot] = this.equipment[slot]?.id || null;
    return {
      capacity: this.capacity,
      items: this.items.map((entry) => ({ id: entry.id, count: entry.count })),
      equipment,
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;

    this.capacity = Math.max(1, Math.floor(num(data.capacity, 24)));
    this.items = [];
    const saved = Array.isArray(data.items) ? data.items : [];
    for (const entry of saved) {
      if (!entry || !entry.id) continue;
      if (this.items.length >= this.capacity) break;
      const count = Math.max(1, Math.floor(num(entry.count, 1)));
      // 读档不再触发事件，直接落表；未知 id 用占位定义兜底
      this._insert(entry.id, count);
    }

    for (const slot of EQUIP_SLOTS) {
      const id = data.equipment?.[slot];
      this.equipment[slot] = id && ITEMS[id] ? getItem(id) : null;
    }

    this._applyEquipmentBonuses();
  }

  // ================================================================ 内部
  _seedStartingItems() {
    if (this._seeded) return;
    this._seeded = true;
    for (const [id, count] of STARTING_ITEMS) this._insert(id, count);
  }

  /**
   * 放入指定数量（不广播事件）。容量不足返回 false 且不改变任何状态。
   * 堆叠规则：先补已有未满堆叠，再占用新格子。
   */
  _insert(id, count) {
    const def = getItem(id);
    const stack = Math.max(1, Math.floor(num(def.stack, 1)) || 1);
    let remaining = Math.max(1, Math.floor(num(count, 1)));

    // 先算需要多少新格子
    let spaceInStacks = 0;
    for (const entry of this.items) {
      if (entry.id === id && entry.count < stack) spaceInStacks += stack - entry.count;
    }
    const overflow = Math.max(0, remaining - spaceInStacks);
    const slotsNeeded = overflow > 0 ? Math.ceil(overflow / stack) : 0;
    if (slotsNeeded > this.capacity - this.items.length) return false;

    // 填充已有堆叠
    for (const entry of this.items) {
      if (remaining <= 0) break;
      if (entry.id !== id) continue;
      const space = stack - entry.count;
      if (space <= 0) continue;
      const put = Math.min(space, remaining);
      entry.count += put;
      remaining -= put;
    }
    // 新格子
    while (remaining > 0) {
      const put = Math.min(stack, remaining);
      this.items.push({ id, count: put, def });
      remaining -= put;
    }
    return true;
  }

  /** 聚合装备加成并写入 StatsSystem */
  _applyEquipmentBonuses() {
    const sum = { maxHealth: 0, armor: 0, damage: 0, moveSpeed: 0, staminaRegen: 0, manaRegen: 0 };
    let attackSpeed = 0;

    for (const slot of EQUIP_SLOTS) {
      const def = this.equipment[slot];
      const equip = def?.equip;
      if (!equip) continue;
      for (const key of BONUS_KEYS) {
        if (Number.isFinite(Number(equip[key]))) sum[key] += Number(equip[key]);
      }
      if (Number.isFinite(Number(equip.attackSpeed))) attackSpeed += Number(equip.attackSpeed);
    }

    this.bonuses = sum;
    this.attackSpeedBonus = attackSpeed;
    this.game?.systems?.stats?.setEquipmentBonuses?.(sum);
  }

  _emitChanged(def, action, delta) {
    this.events?.emit('inventory:changed', {
      item: def,
      id: def?.id,
      count: this.count(def?.id),
      delta,
      action,
    });
  }

  _bindEvents() {
    const bus = this.events;
    if (!bus) return;

    // 拾取：InteractionSystem 只需 emit('item:collected', {id,count})
    this._offs.push(bus.on('item:collected', (payload) => {
      const id = payload?.id;
      if (!id) return;
      const count = Math.max(1, Math.floor(num(payload.count, 1)));
      if (!this.add(id, count)) {
        this.game?.ui?.toast?.('行囊已满，无法拾取', { kind: 'danger', glyph: 'ᚨ' });
      }
    }));
  }
}
