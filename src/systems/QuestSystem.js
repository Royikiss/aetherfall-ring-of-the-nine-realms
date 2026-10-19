/**
 * systems/QuestSystem.js — 任务引擎（任务链 / 目标推进 / 奖励发放 / 追踪）。
 *
 * 职责：
 *  - 维护全部任务实例状态：locked | available | active | completed | failed
 *  - 订阅事件总线，把 item:collected / enemy:killed / poi:discovered / npc:talked / shrine:lit
 *    翻译成 objective 进度（collect / kill / reach / interact / light）
 *  - 阶段推进、整条完成、奖励结算（xp / gold / items）、任务链自动接续
 *  - 把 QuestTracker 挂到 HUD 插槽，并注册「任务纪事」面板（id 'quest'，热键 L）
 *
 * 对外 API（契约见 docs/ARCH.md §6.4）：
 *   start(id) / state(id) / active / tracked / track(id) / notify(type,payload)
 *   toJSON() / fromJSON(data) / dispose()
 *
 * 设计要点：
 *  - collect 用「背包数量下限」而非累加，避免 item:collected 与 inventory:changed 双重计数
 *  - 奖励发放期间屏蔽背包事件，防止奖励物品反过来推进 mission
 *  - reach 目标除了 poi:discovered 事件外，还有低频位置轮询兜底
 */
import {
  QUESTS, QUEST_ORDER, QUEST_CHAIN, QUEST_TRIGGERS, getQuest, nextInChain,
} from '../data/quests.js';
import { QuestTracker, mountToSlot } from '../ui/Minimap.js';
import { QuestPanel } from '../ui/QuestPanel.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** id 归一化：去掉 poi_ 前缀、小写、去掉末尾序号（frost_wolf_3 → frost_wolf） */
function normId(id) {
  return String(id ?? '')
    .toLowerCase()
    .replace(/^poi_/, '')
    .replace(/[_\s-]?\d+$/, '');
}

/** 宽松 id：再去掉 npc_ / beacon_ / gate_ 等实体前缀（Landmarks 两种命名并存） */
function looseId(id) {
  return normId(id).replace(/^(npc|beacon|gate|chest|pickup)_/, '');
}

/** 事件 payload 中可能携带身份的字段 */
function identityCandidates(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return [payload.id, payload.type, payload.name, payload.kind, payload.target, payload.item];
}

export class QuestSystem {
  static id = 'quest';

  constructor(game) {
    this.game = game;
    this.bus = game?.events || null;

    /** @type {Map<string, object>} id → 任务实例 */
    this._inst = new Map();
    /** @type {object|null} */
    this._tracked = null;
    this.tracker = null;
    this.panel = null;

    this._offs = [];
    this._pollTimer = 0;
    this._granting = false;
    this._disposed = false;

    for (const id of QUEST_ORDER) {
      if (getQuest(id)) this._inst.set(id, this._createInstance(id));
    }
    // 主线首条与支线都处于可接取状态，其余主线锁定
    for (const id of QUEST_ORDER) {
      const def = getQuest(id);
      const inst = this._inst.get(id);
      if (!def || !inst) continue;
      inst.state = def.autoStart || !QUEST_CHAIN.includes(id) ? 'available' : 'locked';
    }
  }

  // ================================================================ 生命周期
  init() {
    this._bindEvents();
    this._initUi();

    // 自动接取开场任务（放在 UI 初始化之后，保证 quest:started 有监听者）
    for (const id of QUEST_ORDER) {
      const def = getQuest(id);
      const inst = this._inst.get(id);
      if (def?.autoStart && inst && inst.state === 'available') this.start(id);
    }
    this._refreshQuestTargets();
  }

  update(dt) {
    if (this._disposed) return;
    const d = Number.isFinite(dt) ? dt : 0;
    this.tracker?.update?.(d);

    // 低频兜底：位置触发的 reach 目标、背包下限、地图目标点
    this._pollTimer += d;
    if (this._pollTimer < 0.5) return;
    this._pollTimer = 0;
    this._pollReach();
    this._refreshCollectFloors();
    this._refreshQuestTargets();
  }

  dispose() {
    for (const off of this._offs) {
      try { off(); } catch (e) { /* 订阅已失效 */ }
    }
    this._offs.length = 0;
    this.tracker = null;
    this.panel = null;
    this._disposed = true;
  }

  _bindEvents() {
    const bus = this.bus;
    if (!bus) return;
    const map = [
      'item:collected',
      'inventory:changed',
      'enemy:killed',
      'poi:discovered',
      'npc:talked',
      'shrine:lit',
      'player:spawn',
    ];
    for (const type of map) {
      this._offs.push(bus.on(type, (payload) => this.notify(type, payload)));
    }
  }

  _initUi() {
    const ui = this.game?.ui;
    // 追踪器挂在 HUD 的 questtracker 插槽
    this.tracker = new QuestTracker(this.game, this);
    mountToSlot(ui, 'questtracker', this.tracker.el);

    try {
      if (ui?.registerPanel) {
        this.panel = new QuestPanel(this.game, this);
        ui.registerPanel(this.panel.definition());
      }
    } catch (err) {
      this.panel = null;
    }
  }

  // ================================================================ 实例
  _createInstance(id) {
    const def = getQuest(id);
    return {
      id,
      def,
      state: 'locked',
      stageIndex: 0,
      objectives: [],
      completed: false,
      startedAt: 0,
      completedAt: 0,
      /** 当前阶段（只读） */
      get stage() {
        return this.def?.stages?.[this.stageIndex] || null;
      },
    };
  }

  _buildObjectives(inst) {
    const stage = inst.def?.stages?.[inst.stageIndex];
    if (!stage) return [];
    return (stage.objectives || []).map((o) => ({ def: o, progress: 0, done: false }));
  }

  /** @returns {object[]} 全部任务实例（面板展示用，顺序同 QUEST_ORDER） */
  get quests() {
    const list = [];
    for (const id of QUEST_ORDER) {
      const inst = this._inst.get(id);
      if (inst) list.push(inst);
    }
    return list;
  }

  /** @returns {object[]} 进行中的任务实例 */
  get active() {
    const list = [];
    for (const inst of this._inst.values()) {
      if (inst.state === 'active') list.push(inst);
    }
    return list;
  }

  /** @returns {object|null} 当前追踪的任务 */
  get tracked() {
    return this._tracked;
  }

  /**
   * @param {string} id
   * @returns {'locked'|'available'|'active'|'completed'|'failed'}
   */
  state(id) {
    const inst = this._inst.get(id);
    return inst ? inst.state : 'locked';
  }

  /**
   * 开始任务。
   * @returns {boolean} 是否成功开始
   */
  start(id) {
    const inst = this._inst.get(id);
    if (!inst) return false;
    if (inst.state === 'active' || inst.state === 'completed') return false;

    inst.state = 'active';
    inst.stageIndex = 0;
    inst.objectives = this._buildObjectives(inst);
    inst.startedAt = nowMs();
    inst.completedAt = 0;

    if (!this._tracked) this._tracked = inst;

    this.bus?.emit('quest:started', {
      questId: inst.def.id,
      title: inst.def.title,
      latin: inst.def.latin,
    });
    this.game?.ui?.toast?.(`接受使命 · ${inst.def.title}`, {
      kind: 'quest',
      latin: inst.def.latin,
      glyph: 'ᛞ',
    });

    // 新任务的目标可能已经满足（例如奖励物品已在背包里 / 人已站在地点上）
    this._refreshCollectFloors(inst);
    this._pollReach(inst);
    this._refreshUi();
    this._refreshQuestTargets();
    return true;
  }

  /**
   * 设置追踪任务。
   * @returns {boolean}
   */
  track(id) {
    const inst = this._inst.get(id);
    if (!inst) return false;
    if (inst.state !== 'active' && inst.state !== 'completed') return false;
    this._tracked = inst;
    this._refreshUi();
    this._refreshQuestTargets();
    this.bus?.emit('quest:tracked', { questId: inst.def.id, title: inst.def.title });
    return true;
  }

  // ================================================================ 事件入口
  /**
   * 事件 → 目标推进。所有订阅最终都汇聚到这里（可由外部直接调用，便于测试）。
   */
  notify(eventType, payload) {
    if (this._disposed) return;
    switch (eventType) {
      case 'item:collected':
        if (!this._granting) this._onCollectItem(payload);
        break;
      case 'inventory:changed':
        if (!this._granting) this._onInventoryChanged(payload);
        break;
      case 'enemy:killed':
        this._matchProgress('kill', payload, 1);
        break;
      case 'poi:discovered':
        this._matchProgress('reach', payload, 1);
        break;
      case 'shrine:lit':
        this._matchProgress('light', payload, 1);
        break;
      case 'npc:talked':
        this._matchProgress('interact', payload, 1);
        this._maybeStartFromNpc(payload);
        break;
      case 'player:spawn':
        this._pollReach();
        break;
      default:
        break;
    }
  }

  _onCollectItem(payload) {
    const id = typeof payload?.item === 'string'
      ? payload.item
      : payload?.id || payload?.item?.id;
    if (!id) return;
    this._collectProgress(id, Number(payload?.count) || 1);
  }

  _onInventoryChanged(payload) {
    const action = payload?.action;
    if (action && action !== 'add' && action !== 'pickup' && action !== 'gain') return;
    const id = typeof payload?.item === 'string'
      ? payload.item
      : payload?.item?.id || payload?.id;
    if (!id) return;
    this._collectProgress(id, 0);
  }

  /** 收集类目标的统一入口：以背包数量为下限，天然幂等 */
  _collectProgress(itemId, delta = 0) {
    if (!itemId) return;
    const inv = this.game?.systems?.inventory;
    const invCount = typeof inv?.count === 'function' ? Number(inv.count(itemId)) || 0 : null;
    const norm = normId(itemId);

    for (const inst of this.active) {
      if (inst.completed) continue;
      const stage = inst.stageIndex;
      for (const obj of inst.objectives) {
        if (obj.done || obj.def.type !== 'collect') continue;
        if (normId(obj.def.target) !== norm) continue;
        const value = invCount == null ? obj.progress + delta : Math.max(obj.progress + delta, invCount);
        this._setProgress(inst, obj, value);
        if (inst.completed || inst.stageIndex !== stage) break;
      }
      if (inst.completed || inst.stageIndex !== stage) break;
    }
  }

  /** 背包下限回填：任务开始时 / 定期执行，保证"先捡到后接任务"也能计数 */
  _refreshCollectFloors(only = null) {
    const inv = this.game?.systems?.inventory;
    if (typeof inv?.count !== 'function') return;
    const list = only ? [only] : this.active;
    for (const inst of list) {
      if (!inst || inst.state !== 'active' || inst.completed) continue;
      const stage = inst.stageIndex;
      for (const obj of inst.objectives) {
        if (obj.done || obj.def.type !== 'collect') continue;
        const count = Number(inv.count(obj.def.target)) || 0;
        if (count > obj.progress) this._setProgress(inst, obj, count);
        if (inst.completed || inst.stageIndex !== stage) break;
      }
      if (inst.completed || inst.stageIndex !== stage) break;
    }
  }

  /** 位置轮询兜底：reach 目标（poi:discovered 没触发时也能完成） */
  _pollReach(only = null) {
    const player = this.game?.player?.position;
    if (!player) return;
    const list = only ? [only] : this.active;
    for (const inst of list) {
      if (!inst || inst.state !== 'active' || inst.completed) continue;
      const stage = inst.stageIndex;
      for (const obj of inst.objectives) {
        if (obj.done) continue;
        if (obj.def.type === 'reach') {
          const pos = this._targetPos(obj.def.target);
          if (!pos) continue;
          const poi = this._poiFor(obj.def.target);
          const r = (Number(poi?.radius) || 26) + 6;
          const dx = pos.x - player.x;
          const dz = pos.z - player.z;
          if (dx * dx + dz * dz <= r * r) this._setProgress(inst, obj, obj.def.count);
        } else if (obj.def.type === 'light') {
          // 圣火可能在本任务开始前就被点亮：POI 字段与世界状态双重兜底
          const world = this.game?.world;
          const litByWorld = world?.isBeaconLit?.(obj.def.target)
            || world?.landmarks?.isBeaconLit?.(obj.def.target)
            || false;
          const poi = this._poiFor(obj.def.target);
          const litByPoi = !!(poi && (poi.lit === true || poi.activated === true || poi.isLit === true));
          if (litByWorld || litByPoi) this._setProgress(inst, obj, obj.def.count);
        }
        if (inst.completed || inst.stageIndex !== stage) break;
      }
      if (inst.completed || inst.stageIndex !== stage) break;
    }
  }

  /** 匹配事件目标并推进（kill / reach / interact / light） */
  _matchProgress(type, payload, increment = 1) {
    if (!payload) return;
    const candidates = identityCandidates(payload).map((v) => String(v ?? ''));
    for (const inst of this.active) {
      if (inst.completed) continue;
      const stage = inst.stageIndex;
      for (const obj of inst.objectives) {
        if (obj.done || obj.def.type !== type) continue;
        if (!this._matches(obj.def.target, candidates, payload)) continue;
        this._setProgress(inst, obj, obj.progress + increment);
        if (inst.completed || inst.stageIndex !== stage) break;
      }
      if (inst.completed || inst.stageIndex !== stage) break;
    }
  }

  /** 目标 id 与事件 payload 的宽松匹配（兼容 poi_ 前缀与 _序号 后缀） */
  _matches(target, candidates, payload) {
    const t = normId(target);
    if (!t) return false;
    const looseT = looseId(target);
    for (const raw of candidates) {
      const c = normId(raw);
      if (!c) continue;
      if (c === t) return true;
      if (c.startsWith(`${t}_`)) return true;
      // npc_warden ↔ warden、poi_gate_asgard ↔ gate_asgard 等前缀差异
      if (looseT && (looseId(raw) === looseT || looseId(raw) === t)) return true;
    }
    // 兜底：payload.name 与 target 的中文/英文标签直接相同
    const name = payload?.name || payload?.label;
    if (name && String(name) === String(target)) return true;
    return false;
  }

  _maybeStartFromNpc(payload) {
    const id = payload?.id;
    if (!id) return;
    const keys = new Set([
      String(id),
      String(id).toLowerCase(),
      normId(id),
      looseId(id),
      `npc_${looseId(id)}`,
    ]);
    for (const key of keys) {
      const questId = QUEST_TRIGGERS[key];
      if (questId && this.state(questId) === 'available') this.start(questId);
    }
  }

  // ================================================================ 进度与阶段
  _setProgress(inst, obj, value) {
    if (!inst || !obj || obj.done || inst.state !== 'active') return;
    const cap = Number(obj.def.count) || 1;
    const v = Math.min(cap, Math.max(obj.progress, Number(value) || 0));
    if (v === obj.progress) return;
    obj.progress = v;

    if (v >= cap) {
      obj.done = true;
      this.bus?.emit('quest:objective', {
        questId: inst.def.id,
        objectiveId: obj.def.id,
        text: obj.def.text,
      });
      this.game?.ui?.toast?.(obj.def.text, {
        kind: 'quest',
        latin: 'OBJECTIVE COMPLETE',
        glyph: '◇',
      });
    }

    this._checkStage(inst);
    this._refreshUi();
    this._refreshQuestTargets();
  }

  _checkStage(inst) {
    if (!inst || inst.state !== 'active') return;
    if (!inst.objectives.length || !inst.objectives.every((o) => o.done)) return;

    if (inst.stageIndex < (inst.def.stages?.length || 0) - 1) {
      inst.stageIndex++;
      inst.objectives = this._buildObjectives(inst);
      // 新阶段目标可能立刻满足（同一地点 / 已有物品 / 已点亮的圣火）
      this._refreshCollectFloors(inst);
      this._pollReach(inst);
      this._refreshUi();
      this._refreshQuestTargets();
      return;
    }
    this._complete(inst);
  }

  _complete(inst) {
    if (inst.state === 'completed') return;
    inst.state = 'completed';
    inst.completed = true;
    inst.completedAt = nowMs();
    inst.objectives = inst.objectives.map((o) => ({ ...o, done: true, progress: o.def.count }));

    this._grantRewards(inst.def);

    this.bus?.emit('quest:completed', {
      questId: inst.def.id,
      title: inst.def.title,
      latin: inst.def.latin,
    });
    this.game?.ui?.banner?.('任务完成', inst.def.title, { latin: inst.def.latin, kind: 'quest' });
    this.game?.ui?.toast?.(`「${inst.def.title}」已完成`, { kind: 'quest', latin: 'SAGA COMPLETE', glyph: 'ᛟ' });
    this.game?.systems?.audio?.play?.('quest', { volume: 0.6 });

    // 任务链：完成后自动接续下一条
    const nextId = nextInChain(inst.def.id);
    if (nextId && this.state(nextId) === 'locked') {
      const next = this._inst.get(nextId);
      if (next) next.state = 'available';
    }
    if (nextId && this.state(nextId) === 'available') this.start(nextId);

    // 追踪切换到下一条进行中的任务
    if (this._tracked === inst) {
      const nextActive = this.active[0] || null;
      this._tracked = nextActive;
    }
    this._refreshUi();
    this._refreshQuestTargets();
  }

  _grantRewards(def) {
    const rewards = def?.rewards;
    if (!rewards) return;
    const stats = this.game?.systems?.stats;
    const inv = this.game?.systems?.inventory;

    this._granting = true;
    try {
      if (Number(rewards.xp) > 0 && typeof stats?.addXp === 'function') {
        stats.addXp(rewards.xp);
      }
      if (Number(rewards.gold) > 0) {
        if (typeof stats?.addGold === 'function') stats.addGold(rewards.gold);
        else if (stats) stats.gold = (Number(stats.gold) || 0) + rewards.gold;
      }
      if (Array.isArray(rewards.items) && typeof inv?.add === 'function') {
        for (const it of rewards.items) {
          if (it?.id) inv.add(it.id, Number(it.count) || 1);
        }
      }
    } finally {
      this._granting = false;
    }
  }

  // ================================================================ 目标定位（地图 / 追踪器）
  _poiFor(target) {
    const world = this.game?.world;
    if (!world) return null;
    const raw = String(target ?? '');
    const bare = raw.replace(/^poi_/, '');
    const keys = [raw, bare, `poi_${bare}`];
    if (typeof world.getPoi === 'function') {
      for (const key of keys) {
        const poi = world.getPoi(key);
        if (poi) return poi;
      }
    }
    if (Array.isArray(world.pois)) {
      for (const p of world.pois) {
        if (p && normId(p.id) === normId(raw)) return p;
      }
    }
    return null;
  }

  _targetPos(target) {
    const poi = this._poiFor(target);
    if (poi && Number.isFinite(poi.x)) return { x: poi.x, z: poi.z };
    // NPC：尝试从可交互物中找
    const list = this.game?.world?.interactables;
    if (Array.isArray(list)) {
      const want = normId(target);
      for (const it of list) {
        if (normId(it?.id) === want) {
          const pos = it.position;
          if (pos && Number.isFinite(pos.x)) return { x: pos.x, z: pos.z };
          if (Number.isFinite(it.x)) return { x: it.x, z: it.z };
        }
      }
    }
    return null;
  }

  /** 把追踪任务当前的 reach/light 目标推给地图系统（金色菱形） */
  _refreshQuestTargets() {
    const map = this.game?.systems?.map;
    if (!map || typeof map.setQuestTargets !== 'function') return;
    const q = this._tracked;
    if (!q || q.state !== 'active') {
      map.setQuestTargets([]);
      return;
    }
    const targets = [];
    for (const obj of q.objectives) {
      if (obj.done) continue;
      if (obj.def.type !== 'reach' && obj.def.type !== 'light') continue;
      const pos = this._targetPos(obj.def.target);
      if (pos) targets.push({ x: pos.x, z: pos.z, label: obj.def.text, id: obj.def.id });
    }
    map.setQuestTargets(targets);
  }

  // ================================================================ UI
  _refreshUi() {
    this.tracker?.sync?.();
    const ui = this.game?.ui;
    if (ui?.isOpen?.('quest')) ui.refresh();
  }

  // ================================================================ 存档
  toJSON() {
    const quests = {};
    for (const [id, inst] of this._inst) {
      quests[id] = {
        state: inst.state,
        stageIndex: inst.stageIndex,
        completed: !!inst.completed,
        startedAt: inst.startedAt || 0,
        completedAt: inst.completedAt || 0,
        objectives: (inst.objectives || []).map((o) => ({ id: o.def.id, progress: o.progress, done: !!o.done })),
      };
    }
    return {
      v: 1,
      quests,
      tracked: this._tracked?.def?.id || null,
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object' || !data.quests) return;
    for (const [id, saved] of Object.entries(data.quests)) {
      const inst = this._inst.get(id);
      if (!inst || !saved) continue;
      inst.state = saved.state || 'available';
      inst.stageIndex = Math.max(0, Number(saved.stageIndex) || 0);
      inst.completed = !!saved.completed || inst.state === 'completed';
      inst.startedAt = Number(saved.startedAt) || 0;
      inst.completedAt = Number(saved.completedAt) || 0;
      inst.objectives = this._buildObjectives(inst);
      if (Array.isArray(saved.objectives)) {
        for (const so of saved.objectives) {
          const obj = inst.objectives.find((o) => o.def.id === so.id);
          if (!obj) continue;
          obj.progress = Math.min(Number(obj.def.count) || 1, Math.max(0, Number(so.progress) || 0));
          obj.done = !!so.done || obj.progress >= (Number(obj.def.count) || 1);
        }
      }
      if (inst.completed) {
        inst.objectives = inst.objectives.map((o) => ({ ...o, done: true, progress: o.def.count }));
      }
    }

    this._tracked = data.tracked ? this._inst.get(data.tracked) || null : null;
    if (!this._tracked) this._tracked = this.active[0] || null;
    this._refreshUi();
    this._refreshQuestTargets();
  }
}

/** 供面板/追踪器复用的任务顺序 */
export { QUEST_ORDER, QUESTS };
