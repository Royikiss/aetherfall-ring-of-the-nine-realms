/**
 * InventoryPanel.js — 「行囊」面板（装备人偶 / 物品格 / 详情卡 / 负重）
 *
 * 布局：顶部五分类页签 → 左「装备人偶」→ 中 6×4 物品格 → 右物品详情 → 底部负重条。
 * 交互：单击选中、双击使用/装备、右键丢弃、悬停提示；空背包显示「行囊空空如也」。
 *
 * 对外：export function setupInventoryPanel(game) —— 在 InventorySystem.init() 中调用；
 *       面板 id 'inventory'，hotkey 'i'。
 * 依赖：data/items.js（只读取定义）、game.systems.inventory、game.ui。
 */
import { getItem, RARITY, ITEM_CATEGORIES } from '../data/items.js';

/** 装备槽顺序（与 InventorySystem.EQUIP_SLOTS 保持一致） */
const SLOT_ORDER = ['weapon', 'shield', 'cloak', 'amulet', 'hands'];

const SLOT_META = {
  weapon: { name: '武器', latin: 'WEAPON', glyph: 'ᛇ' },
  shield: { name: '盾', latin: 'SHIELD', glyph: 'ᛒ' },
  cloak: { name: '斗篷', latin: 'CLOAK', glyph: 'ᚱ' },
  amulet: { name: '护符', latin: 'AMULET', glyph: 'ᛉ' },
  hands: { name: '护手', latin: 'HANDS', glyph: 'ᛗ' },
};

/** 顶部五个分类：全部 / 消耗 / 材料 / 遗物 / 装备（装备 = weapon + armor） */
const CATEGORIES = [
  ...ITEM_CATEGORIES.filter((c) => ['all', 'consumable', 'material', 'relic'].includes(c.id)),
  { id: 'gear', name: '装备', glyph: 'ᛇ' },
];

const TYPE_NAMES = {
  consumable: '消耗品', material: '材料', relic: '遗物', weapon: '武器', armor: '护甲',
};

/** 装备属性展示 */
const EQUIP_STAT_META = {
  maxHealth: { label: '生命上限', fmt: (v) => `+${Math.round(v)}` },
  armor: { label: '护甲', fmt: (v) => `+${Math.round(v)}` },
  damage: { label: '攻击', fmt: (v) => `+${Math.round(v)}` },
  moveSpeed: { label: '移动速度', fmt: (v) => `+${Math.round(v * 100)}%` },
  staminaRegen: { label: '耐力回复', fmt: (v) => `+${Math.round(v * 100)}%` },
  manaRegen: { label: '法力回复', fmt: (v) => `+${Math.round(v * 100)}%` },
  attackSpeed: { label: '攻击速度', fmt: (v) => `×${(Math.round(v * 100) / 100).toFixed(2)}` },
};

/** 消耗品效果展示 */
const USE_STAT_META = {
  heal: { label: '恢复生命', fmt: (v) => `+${Math.round(v)}` },
  stamina: { label: '恢复耐力', fmt: (v) => `+${Math.round(v)}` },
  mana: { label: '恢复法力', fmt: (v) => `+${Math.round(v)}` },
  xp: { label: '获得经验', fmt: (v) => `+${Math.round(v)}` },
};

const HINT_DEFAULT = '悬停查看 · 双击使用 / 装备 · 右键丢弃';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 分类过滤：'gear' 同时包含 weapon 与 armor */
function inCategory(def, cat) {
  if (cat === 'all') return true;
  if (cat === 'gear') return def.type === 'weapon' || def.type === 'armor';
  return def.type === cat;
}

export function setupInventoryPanel(game) {
  if (!game?.ui) return;

  const ui = game.ui;
  const inv = () => game.systems?.inventory;
  const stats = () => game.systems?.stats;

  const refs = {};
  /** 面板视图状态（本次构建内共享，重绘不丢失） */
  const view = { cat: 'all', selectedId: null };
  let built = false;

  // ---------------------------------------------------------------- 数据助手
  function visibleEntries() {
    const sys = inv();
    if (!sys) return [];
    return sys.items.filter((entry) => inCategory(entry.def || getItem(entry.id), view.cat));
  }

  function selectedDef() {
    if (!view.selectedId) return null;
    return getItem(view.selectedId);
  }

  /** 选中项是否已不存在（用完 / 丢弃 / 装备后） */
  function pruneSelection() {
    const sys = inv();
    if (!sys || !view.selectedId) return;
    if (!sys.count(view.selectedId) && !sys.slotOf(view.selectedId)) view.selectedId = null;
  }

  function equippedSlotOf(id) {
    return inv()?.slotOf(id) || null;
  }

  // ---------------------------------------------------------------- 渲染
  function renderTabs() {
    if (!refs.tabs) return;
    refs.tabs.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.classList.toggle('tab--active', btn.dataset.cat === view.cat);
    });
  }

  function renderDoll() {
    if (!refs.dollSlots) return;
    const sys = inv();
    const equipment = sys?.equipment || {};
    const html = SLOT_ORDER.map((slot) => {
      const def = equipment[slot];
      const meta = SLOT_META[slot];
      const selected = def && view.selectedId === def.id ? ' slot--selected' : '';
      const empty = def ? '' : ' slot--empty';
      const data = def
        ? ` data-item="${esc(def.id)}" data-rarity="${esc(def.rarity)}" title="${esc(def.name)}"`
        : ` title="${esc(meta.name)} · 空"`;
      return `<button type="button" class="slot inv-doll__slot inv-doll__slot--${slot}${selected}${empty}" data-slot="${slot}"${data}>
        <span class="slot__glyph">${esc(def ? def.glyph : meta.glyph)}</span>
        <span class="slot__label">${esc(meta.name)}</span>
      </button>`;
    }).join('');
    refs.dollSlots.innerHTML = html;
  }

  function renderBonus() {
    if (!refs.bonus) return;
    const b = inv()?.bonuses;
    if (!b) { refs.bonus.innerHTML = ''; return; }
    const lines = [
      ['生命上限', b.maxHealth, (v) => `+${Math.round(v)}`],
      ['护甲', b.armor, (v) => `+${Math.round(v)}`],
      ['攻击', b.damage, (v) => `+${Math.round(v)}`],
      ['移动速度', b.moveSpeed, (v) => `+${Math.round(v * 100)}%`],
      ['耐力回复', b.staminaRegen, (v) => `+${Math.round(v * 100)}%`],
      ['法力回复', b.manaRegen, (v) => `+${Math.round(v * 100)}%`],
    ].filter(([, value]) => Math.abs(Number(value) || 0) > 0.0001);

    if (!lines.length) {
      refs.bonus.innerHTML = '<span class="inv-doll__nobonus">尚无装备加成</span>';
      return;
    }
    refs.bonus.innerHTML = `<div class="rows inv-bonus">${lines
      .map(([label, value, fmt]) => `<div class="row"><span class="k">${label}</span><span class="v">${fmt(Number(value))}</span></div>`)
      .join('')}</div>`;
  }

  function renderGrid() {
    if (!refs.grid) return;
    const sys = inv();
    if (!sys) return;

    const entries = visibleEntries();
    let html = '';
    for (let i = 0; i < sys.capacity; i += 1) {
      const entry = entries[i];
      if (!entry) {
        html += '<div class="slot slot--empty" aria-hidden="true"></div>';
        continue;
      }
      const def = entry.def || getItem(entry.id);
      const selected = view.selectedId === def.id ? ' slot--selected' : '';
      const countTag = entry.count > 1 ? `<span class="slot__count">${entry.count}</span>` : '';
      html += `<button type="button" class="slot${selected}" data-item="${esc(def.id)}" data-rarity="${esc(def.rarity)}" title="${esc(def.name)} ×${entry.count}">
        <span class="slot__glyph">${esc(def.glyph)}</span>${countTag}
      </button>`;
    }
    refs.grid.innerHTML = html;

    if (refs.empty) refs.empty.classList.toggle('hidden', entries.length > 0);
    if (refs.count) refs.count.textContent = `${sys.items.length} / ${sys.capacity}`;
  }

  function renderDetail() {
    if (!refs.detail) return;
    const sys = inv();
    pruneSelection();
    const def = selectedDef();
    if (!def) {
      delete refs.detail.dataset.rarity;
      refs.detail.innerHTML = `<div class="inv-detail__empty">
        <span class="inv-detail__empty-glyph">ᛟ</span>
        <span>选择一件物品</span>
        <span class="latin">SELECT AN ITEM</span>
      </div>`;
      return;
    }

    refs.detail.dataset.rarity = def.rarity || 'common';
    const rarity = RARITY[def.rarity] || RARITY.common;
    const equippedSlot = equippedSlotOf(def.id);
    const count = sys ? sys.count(def.id) : 0;
    const shownCount = count || 1;

    const equipRows = def.equip
      ? Object.entries(def.equip)
        .filter(([key]) => key !== 'slot' && EQUIP_STAT_META[key])
        .map(([key, value]) => `<div class="row"><span class="k">${EQUIP_STAT_META[key].label}</span>
          <span class="v gold">${EQUIP_STAT_META[key].fmt(Number(value))}</span></div>`)
        .join('')
      : '';

    const useRows = def.use
      ? Object.entries(def.use).map(([key, value]) => {
        if (key === 'status' && value) {
          const kind = value.kind === 'debuff' ? '减益' : '增益';
          return `<div class="row"><span class="k">施加状态</span><span class="v">
            ${esc(value.name || value.id)} · ${Math.round(Number(value.duration) || 0)} 秒 · ${kind}</span></div>`;
        }
        if (!USE_STAT_META[key]) return '';
        return `<div class="row"><span class="k">${USE_STAT_META[key].label}</span>
          <span class="v gold">${USE_STAT_META[key].fmt(Number(value))}</span></div>`;
      }).join('')
      : '';

    const actions = [];
    if (def.use) {
      actions.push('<button type="button" class="btn btn--sm btn--gold" data-act="use">使用<span class="latin">USE</span></button>');
    }
    if (def.equip?.slot) {
      if (equippedSlot) {
        actions.push('<button type="button" class="btn btn--sm" data-act="unequip">卸下<span class="latin">UNEQUIP</span></button>');
      } else {
        actions.push('<button type="button" class="btn btn--sm btn--gold" data-act="equip">装备<span class="latin">EQUIP</span></button>');
      }
    }
    actions.push('<button type="button" class="btn btn--sm btn--ghost" data-act="discard">丢弃<span class="latin">DISCARD</span></button>');

    refs.detail.innerHTML = `
      <div class="inv-detail__head">
        <div class="inv-detail__glyph" aria-hidden="true">${esc(def.glyph)}</div>
        <div class="inv-detail__titles">
          <div class="inv-detail__name">${esc(def.name)}</div>
          <div class="latin inv-detail__latin">${esc(def.latin || '')}</div>
          <div class="inv-detail__badges">
            <span class="inv-badge inv-badge--rar">${esc(rarity.name)}</span>
            <span class="inv-badge">${esc(TYPE_NAMES[def.type] || def.type)}</span>
            ${equippedSlot ? `<span class="inv-badge inv-badge--on">已装备 · ${esc(SLOT_META[equippedSlot]?.name || equippedSlot)}</span>` : ''}
          </div>
        </div>
      </div>
      <p class="inv-detail__desc">${esc(def.desc || '')}</p>
      <div class="rune-divider inv-detail__divider"></div>
      <div class="rows inv-detail__rows">
        <div class="row"><span class="k">数量</span><span class="v">${count || '—'}${def.stack > 1 ? ` <i class="dim">/ 堆叠 ${def.stack}</i>` : ''}</span></div>
        <div class="row"><span class="k">重量</span><span class="v">${Math.round((Number(def.weight) || 0) * shownCount)}</span></div>
        <div class="row"><span class="k">价值</span><span class="v">${def.value > 0 ? `${Math.round(def.value)} 银` : '无价'}</span></div>
      </div>
      ${equipRows ? `<div class="inv-detail__block"><div class="inv-detail__block-title">装备属性<span class="latin">ATTRIBUTES</span></div>
        <div class="rows inv-detail__rows">${equipRows}</div></div>` : ''}
      ${useRows ? `<div class="inv-detail__block"><div class="inv-detail__block-title">使用效果<span class="latin">EFFECTS</span></div>
        <div class="rows inv-detail__rows">${useRows}</div></div>` : ''}
      <div class="inv-detail__actions">${actions.join('')}</div>`;
  }

  function renderFoot() {
    const sys = inv();
    if (!sys || !refs.weightFill) return;
    const weight = sys.totalWeight();
    const capacity = sys.capacityWeight() || 1;
    const ratio = Math.max(0, Math.min(1, weight / capacity));
    refs.weightFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    refs.weightFill.parentElement?.classList.toggle('is-heavy', ratio > 0.85);
    if (refs.weightText) refs.weightText.textContent = `负重 ${Math.round(weight)} / ${Math.round(capacity)}`;
    if (refs.gold) refs.gold.textContent = String(Math.max(0, Math.round(Number(stats()?.gold) || 0)));
  }

  function renderAll() {
    pruneSelection();
    // 未选中任何物品时默认选中第一件，避免右侧详情区长期空白
    if (!view.selectedId) {
      const first = visibleEntries()[0];
      if (first) view.selectedId = first.id;
    }
    renderTabs();
    renderDoll();
    renderBonus();
    renderGrid();
    renderDetail();
    renderFoot();
  }

  // ---------------------------------------------------------------- 交互
  function quickAction(def) {
    if (equippedSlotOf(def.id)) return 'unequip';
    if (def.equip?.slot) return 'equip';
    if (def.use) return 'use';
    return null;
  }

  function doAction(action) {
    const sys = inv();
    const id = view.selectedId;
    if (!sys || !id) return;
    const def = getItem(id);
    const equippedSlot = equippedSlotOf(id);

    if (action === 'use') {
      if (!sys.use(id)) {
        ui.toast('此刻无法使用此物', { kind: 'danger', glyph: 'ᚨ' });
        return;
      }
      if (!sys.count(id) && !equippedSlotOf(id)) view.selectedId = null;
    } else if (action === 'equip') {
      if (!sys.equip(id)) {
        ui.toast('无法装备此物', { kind: 'danger', glyph: 'ᚨ' });
        return;
      }
      ui.toast(`装备了 ${def.name}`, { kind: 'info', latin: def.latin, glyph: def.glyph });
    } else if (action === 'unequip') {
      if (!equippedSlot || !sys.unequip(equippedSlot)) {
        ui.toast('行囊已满，无法卸下', { kind: 'danger', glyph: 'ᚨ' });
        return;
      }
      ui.toast(`卸下了 ${def.name}`, { kind: 'info', latin: def.latin, glyph: def.glyph });
    } else if (action === 'discard') {
      if (equippedSlot) {
        ui.toast('已装备的物品需要先卸下', { kind: 'danger', glyph: 'ᚨ' });
        return;
      }
      if (!sys.remove(id, 1)) return;
      ui.toast(`丢弃了 ${def.name}`, { kind: 'item', latin: def.latin, glyph: def.glyph });
      if (!sys.count(id)) view.selectedId = null;
    }

    pruneSelection();
    renderAll();
  }

  function resetHint() {
    if (refs.hoverHint) refs.hoverHint.textContent = HINT_DEFAULT;
  }

  function onClick(event) {
    const tab = event.target.closest('[data-cat]');
    if (tab) {
      view.cat = tab.dataset.cat;
      renderTabs();
      renderGrid();
      return;
    }

    const actionBtn = event.target.closest('[data-act]');
    if (actionBtn) {
      event.preventDefault();
      doAction(actionBtn.dataset.act);
      return;
    }

    const slot = event.target.closest('.slot');
    if (!slot || slot.classList.contains('slot--empty')) return;
    const itemId = slot.dataset.item;
    if (!itemId) return;
    view.selectedId = itemId;
    renderDoll();
    renderGrid();
    renderDetail();
  }

  function onDoubleClick(event) {
    const slot = event.target.closest('.slot[data-item]');
    if (!slot) return;
    const def = getItem(slot.dataset.item);
    view.selectedId = def.id;
    const action = quickAction(def);
    if (action) doAction(action);
  }

  function onContextMenu(event) {
    event.preventDefault();
    const slot = event.target.closest('.slot[data-item]');
    if (!slot) return;
    const id = slot.dataset.item;
    view.selectedId = id;
    if (equippedSlotOf(id)) {
      ui.toast('已装备的物品需要先卸下', { kind: 'danger', glyph: 'ᚨ' });
      renderAll();
      return;
    }
    doAction('discard');
  }

  function onMouseOver(event) {
    const slot = event.target.closest('.slot');
    if (!slot || !refs.hoverHint) return;
    const id = slot.dataset.item;
    if (!id) { resetHint(); return; }
    const def = getItem(id);
    const rarity = RARITY[def.rarity] || RARITY.common;
    refs.hoverHint.textContent = `${def.name} · ${rarity.name} · ${TYPE_NAMES[def.type] || def.type}`;
  }

  function onMouseOut(event) {
    const slot = event.target.closest('.slot');
    if (!slot) return;
    const to = event.relatedTarget;
    if (to && to.closest && to.closest('.slot')) return;
    resetHint();
  }

  // ---------------------------------------------------------------- 面板注册
  const def = ui.registerPanel({
    id: 'inventory',
    title: '行囊',
    latin: 'INVENTORY',
    hotkey: 'i',

    build(root) {
      root.innerHTML = `
        <div class="inv">
          <div class="inv-tabs tabs" data-ref="tabs" role="tablist"></div>
          <div class="inv-main">
            <section class="inv-col inv-col--doll">
              <div class="inv-col__head"><span class="latin">ARMAMENT</span><span class="inv-col__sub">装备</span></div>
              <div class="inv-doll">
                <svg class="inv-doll__ring" viewBox="0 0 260 260" aria-hidden="true">
                  <circle class="inv-ring__outer" cx="130" cy="130" r="118" />
                  <circle class="inv-ring__inner" cx="130" cy="130" r="100" />
                  <circle class="inv-ring__dash" cx="130" cy="130" r="86" />
                  <circle class="inv-ring__core" cx="130" cy="130" r="58" />
                  <g class="inv-ring__runes">
                    <text x="130" y="22">ᚠ</text><text x="208" y="52">ᚢ</text>
                    <text x="240" y="130">ᚦ</text><text x="208" y="208">ᚨ</text>
                    <text x="130" y="238">ᚱ</text><text x="52" y="208">ᚲ</text>
                    <text x="20" y="130">ᚷ</text><text x="52" y="52">ᚹ</text>
                  </g>
                </svg>
                <div class="inv-doll__core">
                  <span class="inv-doll__sigil">ᛟ</span>
                  <span class="inv-doll__core-latin latin">EINHERJAR</span>
                </div>
                <div class="inv-doll__slots" data-ref="dollSlots"></div>
              </div>
              <div class="inv-doll__bonus" data-ref="bonus"></div>
            </section>

            <section class="inv-col inv-col--grid">
              <div class="inv-col__head"><span class="latin">SATCHEL</span><span class="inv-col__count" data-ref="count">0 / 24</span></div>
              <div class="inv-grid-wrap">
                <div class="inv-grid" data-ref="grid"></div>
                <div class="inv-grid__empty hidden" data-ref="empty">行囊空空如也<span class="latin">THE SATCHEL IS EMPTY</span></div>
              </div>
              <div class="inv-grid__foot" data-ref="hoverHint">${HINT_DEFAULT}</div>
            </section>

            <aside class="inv-col inv-col--detail">
              <div class="inv-detail scroll" data-ref="detail"></div>
            </aside>
          </div>

          <div class="inv-foot">
            <div class="inv-foot__left">
              <span class="latin">BURDEN</span>
              <div class="stat-bar stat-bar--thin inv-foot__bar"><span class="stat-bar__fill" data-ref="weightFill"></span></div>
              <span class="inv-foot__num" data-ref="weightText">负重 0 / 60</span>
            </div>
            <div class="inv-foot__right">
              <span class="latin">GOLD</span>
              <span class="inv-foot__gold" data-ref="gold">0</span>
            </div>
          </div>
        </div>`;

      refs.tabs = root.querySelector('[data-ref="tabs"]');
      refs.dollSlots = root.querySelector('[data-ref="dollSlots"]');
      refs.bonus = root.querySelector('[data-ref="bonus"]');
      refs.grid = root.querySelector('[data-ref="grid"]');
      refs.empty = root.querySelector('[data-ref="empty"]');
      refs.count = root.querySelector('[data-ref="count"]');
      refs.hoverHint = root.querySelector('[data-ref="hoverHint"]');
      refs.detail = root.querySelector('[data-ref="detail"]');
      refs.weightFill = root.querySelector('[data-ref="weightFill"]');
      refs.weightText = root.querySelector('[data-ref="weightText"]');
      refs.gold = root.querySelector('[data-ref="gold"]');

      if (refs.tabs) {
        refs.tabs.innerHTML = CATEGORIES.map((cat) => (
          `<button type="button" class="tab" role="tab" data-cat="${esc(cat.id)}">
            <span class="tab__glyph">${esc(cat.glyph)}</span>${esc(cat.name)}
          </button>`
        )).join('');
      }

      // 事件委托：只绑一次，重绘不失效
      root.addEventListener('click', onClick);
      root.addEventListener('dblclick', onDoubleClick);
      root.addEventListener('contextmenu', onContextMenu);
      root.addEventListener('mouseover', onMouseOver);
      root.addEventListener('mouseout', onMouseOut);
      root.addEventListener('dragstart', (e) => e.preventDefault());

      built = true;
    },

    refresh() {
      if (!built) return;
      pruneSelection();
      renderAll();
    },

    onOpen() {
      pruneSelection();
      renderAll();
      resetHint();
    },

    onClose() {
      resetHint();
    },
  });

  // 数据变化时刷新（仅面板打开时；UIManager.refresh 对关闭状态是空操作）
  const offs = [];
  const requestRefresh = () => {
    if (!ui.isOpen('inventory')) return;
    pruneSelection();
    renderAll();
  };
  for (const type of ['inventory:changed', 'item:used', 'equipment:changed', 'levelup', 'player:respawn']) {
    offs.push(game.events.on(type, requestRefresh));
  }
  // 金币 / 等级影响底栏（负重上限随等级变化），只刷新底栏
  offs.push(game.events.on('stat:changed', (payload) => {
    if (!ui.isOpen('inventory')) return;
    if (payload?.id !== 'gold' && payload?.id !== 'level') return;
    renderFoot();
  }));
  def._offs = offs; // 便于后续 dispose 时统一取消
}
