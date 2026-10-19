/**
 * StatsSystem.js — 玩家数值中枢（生命 / 耐力 / 法力 / 等级 / 状态 / 死亡与复活）
 *
 * 模块职责：
 *  - 维护英灵的全部资源数值，每帧处理自然回复与状态效果 tick；
 *  - 把装备加成（由 InventorySystem 汇总）折算进护甲、攻击、上限与回复倍率；
 *  - 通过 EventBus 向 HUD / 状态面板 / 任务系统广播变化（见下）。
 *
 * 对外 API（供 Player / Combat / Quest / HUD 使用）：
 *   stats.health, stats.maxHealth
 *   stats.stamina, stats.maxStamina
 *   stats.mana, stats.maxMana
 *   stats.level, stats.xp, stats.xpToNext, stats.gold
 *   stats.armor, stats.attackDamage         ← 只读 getter（装备 + 状态加成）
 *                                              （damage 是受击方法，故攻击力用 attackDamage）
 *   stats.moveSpeedMult, stats.staminaRegenMult, stats.manaRegenMult
 *   stats.statuses                          ← StatusMap（Map，可当数组迭代）
 *   stats.damage(amount, source) -> 实际扣血
 *   stats.heal(amount) / restoreStamina(n) / restoreMana(n)
 *   stats.consumeStamina(n) -> boolean
 *   stats.applyStatus(def) / removeStatus(id) / hasStatus(id)
 *   stats.addXp(n) / addGold(n) / spendGold(n)
 *   stats.setEquipmentBonuses({...})
 *   stats.isDead
 *   stats.toJSON() / stats.fromJSON(data)
 *
 * 发出事件：
 *   'stat:changed'  {id, value, max}        id ∈ health/maxHealth/stamina/maxStamina/
 *                                            mana/maxMana/xp/level/gold/armor/damage
 *   'status:applied' / 'status:removed'     {id, name, duration, kind, icon}
 *   'player:damaged' {amount, raw, source}  ← 只有本系统扣血时发出，Combat 不要重复发
 *   'player:died'    {source, level}
 *   'player:respawn' {health}
 *   'levelup'        {level, maxHealth, maxStamina, maxMana}
 *
 * 依赖：game.events（EventBus）、game.ui（面板注册）、game.respawnPlayer（由 main 提供）。
 */
import { setupStatusPanel } from '../ui/StatusPanel.js';

// ---------------------------------------------------------------- 常量
const BASE = { health: 100, stamina: 100, mana: 60 };
/** 每秒自然回复：耐力 12 / 法力 3 / 生命 0.5 */
const REGEN_PER_SEC = { health: 0.5, stamina: 12, mana: 3 };
/** 每级提升的上限 */
const LEVEL_UP_GAIN = { health: 8, stamina: 4, mana: 4 };
/** 护甲减伤曲线：reduction = armor / (armor + 50)，上限 75% */
const ARMOR_SOFTNESS = 50;
const MAX_ARMOR_REDUCTION = 0.75;
const RESPAWN_DELAY = 2.6;
const RESPAWN_HEALTH_RATIO = 0.6;
/** 连续回复的广播节流（秒）——避免每帧刷 HUD */
const VITAL_EMIT_INTERVAL = 0.1;
/** 击杀获得的经验（按敌人 type 取，未登记的类型用默认值） */
const ENEMY_XP = {
  draugr: 24, draugr_archer: 20, draugr_brute: 40,
  wolf: 16, frost_wolf: 18, troll: 52, jotunn: 80, boss: 240,
};
const DEFAULT_ENEMY_XP = 16;

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

/**
 * StatusMap — 状态容器。
 *
 * 契约要求它是 Map（.get / .size / .delete 可用），而 ARCH 文档把 statuses 描述成数组。
 * 为了同时满足两种调用习惯，这里只把「默认迭代器」改成产出状态对象：
 *   for (const s of stats.statuses)        → 状态对象
 *   [...stats.statuses]                    → 状态对象数组
 *   stats.statuses.get(id) / .size / .delete(id) 仍是 Map 行为
 * 需要键值对时请显式用 .entries()。
 */
class StatusMap extends Map {
  [Symbol.iterator]() { return this.values(); }
  /** 兼容数组习惯的 length */
  get length() { return this.size; }
  toArray() { return Array.from(this.values()); }
}

export class StatsSystem {
  static id = 'stats';

  /** 升到下一级所需经验（level 为当前等级） */
  static xpForLevel(level) {
    return Math.round(100 * Math.pow(Math.max(1, level), 1.3));
  }

  constructor(game) {
    this.game = game;
    this.events = game?.events || null;

    // ---- 基础上限（升级会提升） ----
    this.baseMaxHealth = BASE.health;
    this.baseMaxStamina = BASE.stamina;
    this.baseMaxMana = BASE.mana;

    // ---- 装备加成（InventorySystem 汇总后写入） ----
    this.bonuses = { maxHealth: 0, armor: 0, damage: 0, moveSpeed: 0, staminaRegen: 0, manaRegen: 0 };

    // ---- 等级 / 经验 / 金钱 ----
    this.level = 1;
    this.xp = 0;
    this.xpToNext = StatsSystem.xpForLevel(1);
    this.gold = 0;

    // ---- 上限与当前值 ----
    this.maxHealth = this.baseMaxHealth;
    this.maxStamina = this.baseMaxStamina;
    this.maxMana = this.baseMaxMana;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.mana = this.maxMana;

    this.isDead = false;
    /** @type {StatusMap} */
    this.statuses = new StatusMap();

    this._inited = false;
    this._offs = [];
    this._respawnTimer = null;
    this._emitTimer = 0;
    this._statusSeq = 0;
    this._last = { health: -1, stamina: -1, mana: -1 };
  }

  // ================================================================ 派生属性
  /** 护甲（装备 + 状态加成） */
  get armor() {
    return Math.round(num(this.bonuses.armor) + this._statusBonus('armor'));
  }

  /**
   * 攻击力（装备 + 状态加成）。
   * 注意：契约里 damage 同时是「方法」与「字段」——方法优先，
   * 因此攻击力以 stats.attack / stats.attackDamage 暴露（Combat 请用这个）。
   */
  get attack() {
    return Math.round(num(this.bonuses.damage) + this._statusBonus('damage'));
  }

  /** attack 的别名（Combat 用这个读武器伤害） */
  get attackDamage() { return this.attack; }

  /** 又一个别名：语义上等价于「装备提供的攻击力」 */
  get weaponDamage() { return this.attack; }

  /** 移动速度倍率（1 = 基准；Player 可直接乘在自身速度上） */
  get moveSpeedMult() {
    return 1 + num(this.bonuses.moveSpeed) + this._statusBonus('moveSpeed');
  }

  get staminaRegenMult() {
    return (1 + num(this.bonuses.staminaRegen)) * (1 + this._statusBonus('staminaRegen'));
  }

  get manaRegenMult() {
    return (1 + num(this.bonuses.manaRegen)) * (1 + this._statusBonus('manaRegen'));
  }

  // ================================================================ 生命周期
  init() {
    if (this._inited) return;
    this._inited = true;
    this._bindEvents();
    // 状态面板：由本系统负责注册（hotkey 'c'）
    setupStatusPanel(this.game);
    this._emitAll();
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.isDead) return; // 死亡期间由复活计时器接管

    // 1) 状态效果：倒计时 + 每秒 tick
    this._updateStatuses(dt);
    if (this.isDead) return;

    // 2) 自然回复（装备倍率 + 状态平铺回复）
    const staminaRate = REGEN_PER_SEC.stamina * this.staminaRegenMult + this._statusRegen('stamina');
    const manaRate = REGEN_PER_SEC.mana * this.manaRegenMult + this._statusRegen('mana');
    const healthRate = REGEN_PER_SEC.health * (1 + this._statusBonus('healthRegen')) + this._statusRegen('health');

    this.stamina = clamp(this.stamina + staminaRate * dt, 0, this.maxStamina);
    this.mana = clamp(this.mana + manaRate * dt, 0, this.maxMana);
    if (this.health < this.maxHealth) {
      this.health = clamp(this.health + healthRate * dt, 0, this.maxHealth);
    }

    // 3) 节流广播（HUD 用 CSS 过渡平滑，不必每帧发）
    this._emitTimer += dt;
    if (this._emitTimer >= VITAL_EMIT_INTERVAL) {
      this._emitTimer = 0;
      this._emitVitals();
    }
  }

  // ================================================================ 受击 / 恢复
  /**
   * 受到伤害（按护甲减免）。
   * @param {number} amount 原始伤害
   * @param {string} source 伤害来源（用于 HUD 文案与统计）
   * @returns {number} 实际扣除的生命
   */
  damage(amount, source = '未知') {
    const raw = Math.max(0, num(amount));
    if (raw <= 0 || this.isDead) return 0;

    const reduction = Math.min(MAX_ARMOR_REDUCTION, this.armor / (this.armor + ARMOR_SOFTNESS));
    // 至少造成 1 点伤害，避免高护甲玩家完全免疫
    const dealt = Math.min(raw, Math.max(1, raw * (1 - reduction)));

    this.health = Math.max(0, this.health - dealt);
    this._emitVitals(true);
    this.events?.emit('player:damaged', { amount: dealt, raw, source });

    if (this.health <= 0 && !this.isDead) this._die(source);
    return dealt;
  }

  /** 治疗，返回实际回复量 */
  heal(amount) {
    const n = Math.max(0, num(amount));
    if (n <= 0 || this.isDead) return 0;
    const before = this.health;
    this.health = clamp(this.health + n, 0, this.maxHealth);
    this._emitVitals(true);
    return this.health - before;
  }

  /** 恢复耐力，返回实际回复量 */
  restoreStamina(amount) {
    const n = Math.max(0, num(amount));
    if (n <= 0 || this.isDead) return 0;
    const before = this.stamina;
    this.stamina = clamp(this.stamina + n, 0, this.maxStamina);
    this._emitVitals(true);
    return this.stamina - before;
  }

  /** 恢复法力，返回实际回复量 */
  restoreMana(amount) {
    const n = Math.max(0, num(amount));
    if (n <= 0 || this.isDead) return 0;
    const before = this.mana;
    this.mana = clamp(this.mana + n, 0, this.maxMana);
    this._emitVitals(true);
    return this.mana - before;
  }

  /**
   * 消耗耐力（疾跑 / 翻滚由 Player 调用）。
   * 不足时返回 false 且不扣除（不做"扣到 0"的部分消耗）。
   */
  consumeStamina(amount) {
    const n = Math.max(0, num(amount));
    if (this.isDead || n > this.stamina) return false;
    this.stamina = clamp(this.stamina - n, 0, this.maxStamina);
    this._emitVitals(true);
    return true;
  }

  // ================================================================ 状态效果
  /**
   * 施加状态（同 id 再次施加则刷新时长）。
   * @param {{id?:string,name?:string,icon?:string,duration?:number,kind?:'buff'|'debuff',
   *          tick?:number|{damage?:number,heal?:number,stamina?:number,mana?:number},
   *          regen?:{health?:number,stamina?:number,mana?:number},
   *          bonus?:{armor?:number,damage?:number,moveSpeed?:number,
   *                  staminaRegen?:number,manaRegen?:number,healthRegen?:number}}} def
   */
  applyStatus(def = {}) {
    const id = String(def.id || `status_${++this._statusSeq}`);
    const duration = Math.max(0.1, num(def.duration, 10));
    const existing = this.statuses.get(id);

    if (existing) {
      existing.remaining = duration;
      existing.duration = duration;
      existing.elapsed = 0;
      if (def.tick !== undefined) existing.tick = def.tick;
      this.events?.emit('status:applied', {
        id, name: existing.name, duration, kind: existing.kind, icon: existing.icon,
      });
      return existing;
    }

    const status = {
      id,
      name: String(def.name || id),
      icon: String(def.icon || 'ᛟ'),
      remaining: duration,
      duration,
      kind: def.kind === 'debuff' ? 'debuff' : 'buff',
      tick: def.tick ?? null,
      elapsed: 0,
      regen: def.regen || null,
      bonus: def.bonus || null,
    };
    this.statuses.set(id, status);
    this.events?.emit('status:applied', {
      id, name: status.name, duration, kind: status.kind, icon: status.icon,
    });
    return status;
  }

  /** 移除状态，返回是否存在 */
  removeStatus(id) {
    const status = this.statuses.get(id);
    if (!status) return false;
    this.statuses.delete(id);
    this.events?.emit('status:removed', {
      id: status.id, name: status.name, duration: status.duration, kind: status.kind, icon: status.icon,
    });
    return true;
  }

  hasStatus(id) { return this.statuses.has(id); }

  // ================================================================ 经验 / 等级
  /** 获得经验，可能连续升级；升级时上限提升并全恢复 */
  addXp(amount) {
    const gain = Math.floor(num(amount));
    if (gain <= 0) return 0;

    this.xp += gain;
    let levels = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      levels += 1;
      this.baseMaxHealth += LEVEL_UP_GAIN.health;
      this.baseMaxStamina += LEVEL_UP_GAIN.stamina;
      this.baseMaxMana += LEVEL_UP_GAIN.mana;
      this.xpToNext = StatsSystem.xpForLevel(this.level);
    }

    if (levels > 0) {
      this._recalculateMaxima();
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.mana = this.maxMana;
      this._emitAll();
      this.events?.emit('levelup', {
        level: this.level,
        maxHealth: this.maxHealth,
        maxStamina: this.maxStamina,
        maxMana: this.maxMana,
      });
    } else {
      this._emitStat('xp', this.xp, this.xpToNext);
    }
    return gain;
  }

  addGold(amount) {
    const n = Math.floor(num(amount));
    if (n <= 0) return 0;
    this.gold += n;
    this._emitStat('gold', this.gold, 0);
    return n;
  }

  /** 消费金钱：不足返回 false 且不扣款 */
  spendGold(amount) {
    const n = Math.floor(num(amount));
    if (n <= 0) return false;
    if (this.gold < n) return false;
    this.gold -= n;
    this._emitStat('gold', this.gold, 0);
    return true;
  }

  // ================================================================ 装备加成
  /**
   * 写入装备汇总加成（InventorySystem 每次装备变化后调用）。
   * 生命上限提升时同步补足当前生命，避免"换了护符反而掉血"。
   */
  setEquipmentBonuses(next = {}) {
    const oldMaxHealth = this.maxHealth;
    this.bonuses = {
      maxHealth: num(next?.maxHealth),
      armor: num(next?.armor),
      damage: num(next?.damage),
      moveSpeed: num(next?.moveSpeed),
      staminaRegen: num(next?.staminaRegen),
      manaRegen: num(next?.manaRegen),
    };
    this._recalculateMaxima();
    if (this.maxHealth > oldMaxHealth) this.health += this.maxHealth - oldMaxHealth;
    this.health = clamp(this.health, 0, this.maxHealth);

    this._emitStat('armor', this.armor, 0);
    this._emitStat('damage', this.attackDamage, 0);
    this._emitAll();
    return this.bonuses;
  }

  // ================================================================ 存读档
  toJSON() {
    return {
      health: this.health,
      stamina: this.stamina,
      mana: this.mana,
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      gold: this.gold,
      baseMaxHealth: this.baseMaxHealth,
      baseMaxStamina: this.baseMaxStamina,
      baseMaxMana: this.baseMaxMana,
      statuses: Array.from(this.statuses.values()).map((s) => ({
        id: s.id, name: s.name, icon: s.icon, remaining: s.remaining, duration: s.duration,
        kind: s.kind, tick: s.tick, elapsed: s.elapsed, regen: s.regen, bonus: s.bonus,
      })),
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;

    if (this._respawnTimer) { clearTimeout(this._respawnTimer); this._respawnTimer = null; }
    this.isDead = false;

    this.level = Math.max(1, Math.floor(num(data.level, 1)));
    this.xp = Math.max(0, Math.floor(num(data.xp, 0)));
    this.xpToNext = Math.max(
      1,
      Math.floor(num(data.xpToNext, StatsSystem.xpForLevel(this.level))),
    );
    this.gold = Math.max(0, Math.floor(num(data.gold, 0)));

    const levelHealth = (this.level - 1) * LEVEL_UP_GAIN.health;
    const levelStamina = (this.level - 1) * LEVEL_UP_GAIN.stamina;
    const levelMana = (this.level - 1) * LEVEL_UP_GAIN.mana;
    this.baseMaxHealth = Math.max(BASE.health, Math.floor(num(data.baseMaxHealth, BASE.health + levelHealth)));
    this.baseMaxStamina = Math.max(BASE.stamina, Math.floor(num(data.baseMaxStamina, BASE.stamina + levelStamina)));
    this.baseMaxMana = Math.max(BASE.mana, Math.floor(num(data.baseMaxMana, BASE.mana + levelMana)));

    this.statuses.clear();
    const saved = Array.isArray(data.statuses)
      ? data.statuses
      : (data.statuses && typeof data.statuses === 'object' ? Object.values(data.statuses) : []);
    for (const s of saved) {
      if (!s || !s.id) continue;
      const duration = Math.max(0.1, num(s.duration, 5));
      this.statuses.set(String(s.id), {
        id: String(s.id),
        name: String(s.name || s.id),
        icon: String(s.icon || 'ᛟ'),
        remaining: clamp(num(s.remaining, duration), 0.1, duration),
        duration,
        kind: s.kind === 'debuff' ? 'debuff' : 'buff',
        tick: s.tick ?? null,
        elapsed: Math.max(0, num(s.elapsed, 0)),
        regen: s.regen || null,
        bonus: s.bonus || null,
      });
    }

    this._recalculateMaxima();
    this.health = clamp(num(data.health, this.maxHealth), 0, this.maxHealth);
    this.stamina = clamp(num(data.stamina, this.maxStamina), 0, this.maxStamina);
    this.mana = clamp(num(data.mana, this.maxMana), 0, this.maxMana);
    this._emitAll();
  }

  // ================================================================ 内部
  _bindEvents() {
    const bus = this.events;
    if (!bus) return;
    // 击杀给经验（任务奖励经验由 QuestSystem 直接调用 addXp，不经过这里）
    this._offs.push(bus.on('enemy:killed', (payload) => {
      const type = String(payload?.type || '');
      this.addXp(ENEMY_XP[type] ?? DEFAULT_ENEMY_XP);
    }));
  }

  /** 上限 = 基础 + 装备加成 */
  _recalculateMaxima() {
    this.maxHealth = Math.max(1, Math.round(this.baseMaxHealth + num(this.bonuses.maxHealth)));
    this.maxStamina = Math.max(1, Math.round(this.baseMaxStamina));
    this.maxMana = Math.max(1, Math.round(this.baseMaxMana));
  }

  _updateStatuses(dt) {
    if (this.statuses.size === 0) return;
    const snapshot = Array.from(this.statuses.values());
    for (const status of snapshot) {
      if (this.isDead) return;
      status.remaining -= dt;

      // 用 Math.floor 计时：跨过整秒边界时结算 tick，避免每帧触发
      const before = Math.floor(status.elapsed);
      status.elapsed += dt;
      const after = Math.floor(status.elapsed);
      if (status.tick !== null && status.tick !== undefined && after > before) {
        const ticks = Math.min(after - before, 10); // 卡顿后最多补 10 次，防止瞬间暴毙
        for (let i = 0; i < ticks && !this.isDead; i += 1) this._tickStatus(status);
      }

      if (status.remaining <= 0) this.removeStatus(status.id);
    }
  }

  _tickStatus(status) {
    const tick = status.tick;
    if (typeof tick === 'number') {
      if (status.kind === 'debuff') this.damage(tick, status.id);
      else this.heal(tick);
      return;
    }
    if (!tick || typeof tick !== 'object') return;
    if (num(tick.damage) > 0) this.damage(tick.damage, status.id);
    if (num(tick.heal) > 0) this.heal(tick.heal);
    if (num(tick.stamina) > 0) this.restoreStamina(tick.stamina);
    if (num(tick.mana) > 0) this.restoreMana(tick.mana);
  }

  /** 状态对属性的加成合计 */
  _statusBonus(key) {
    let sum = 0;
    for (const s of this.statuses.values()) {
      const b = s.bonus;
      if (b && Number.isFinite(Number(b[key]))) sum += Number(b[key]);
    }
    return sum;
  }

  /** 状态带来的每秒平铺回复 */
  _statusRegen(key) {
    let sum = 0;
    for (const s of this.statuses.values()) {
      const r = s.regen;
      if (r && Number.isFinite(Number(r[key]))) sum += Number(r[key]);
    }
    return sum;
  }

  _die(source) {
    this.isDead = true;
    this.health = 0;
    this._emitVitals(true);
    this.events?.emit('stat:changed', { id: 'health', value: 0, max: this.maxHealth });
    this.events?.emit('player:died', { source: String(source ?? '未知'), level: this.level });
    this._scheduleRespawn();
  }

  _scheduleRespawn() {
    if (this._respawnTimer) clearTimeout(this._respawnTimer);
    this._respawnTimer = setTimeout(() => {
      this._respawnTimer = null;
      this._respawn();
    }, RESPAWN_DELAY * 1000);
  }

  /** 死亡 2.6s 后：通知 main 移动玩家 → 恢复 60% 生命 → 清空负面状态 → 广播复活 */
  _respawn() {
    try {
      this.game?.respawnPlayer?.();
    } catch (err) {
      // 复活回调失败不应阻止状态恢复（错误由 main 侧自行记录）
    }
    this.health = Math.round(this.maxHealth * RESPAWN_HEALTH_RATIO);
    this.isDead = false;

    // 清空负面状态（buff 保留）
    for (const status of Array.from(this.statuses.values())) {
      if (status.kind === 'debuff') this.removeStatus(status.id);
    }

    this._emitAll();
    this.events?.emit('player:respawn', { health: this.health });
  }

  // ---------------------------------------------------------------- 广播
  _emitStat(id, value, max) {
    this.events?.emit('stat:changed', { id, value, max });
  }

  /** 广播三条资源条（值未变化则跳过） */
  _emitVitals(force = false) {
    const last = this._last;
    if (force || Math.abs(this.health - last.health) > 0.0001) {
      last.health = this.health;
      this._emitStat('health', this.health, this.maxHealth);
    }
    if (force || Math.abs(this.stamina - last.stamina) > 0.0001) {
      last.stamina = this.stamina;
      this._emitStat('stamina', this.stamina, this.maxStamina);
    }
    if (force || Math.abs(this.mana - last.mana) > 0.0001) {
      last.mana = this.mana;
      this._emitStat('mana', this.mana, this.maxMana);
    }
  }

  /** 初始化 / 复活 / 升级 / 读档后广播全量 */
  _emitAll() {
    this._last.health = this.health;
    this._last.stamina = this.stamina;
    this._last.mana = this.mana;
    this._emitStat('health', this.health, this.maxHealth);
    this._emitStat('maxHealth', this.maxHealth, this.maxHealth);
    this._emitStat('stamina', this.stamina, this.maxStamina);
    this._emitStat('maxStamina', this.maxStamina, this.maxStamina);
    this._emitStat('mana', this.mana, this.maxMana);
    this._emitStat('maxMana', this.maxMana, this.maxMana);
    this._emitStat('xp', this.xp, this.xpToNext);
    this._emitStat('level', this.level, 0);
    this._emitStat('gold', this.gold, 0);
    this._emitStat('armor', this.armor, 0);
    this._emitStat('damage', this.attackDamage, 0);
  }
}
