/**
 * StatusPanel.js — 「英灵状态」面板
 *
 * 布局：左侧巨幅等级徽记（符文环 + 等级数字 + 经验条 + 名字 + 金币）；
 *       右侧生命/耐力/法力三条 stat-bar、属性格（护甲/攻击/负重/移速）、
 *       状态效果区（tag--buff / tag--debuff，带剩余秒数）、装备概览。
 *
 * 对外：export function setupStatusPanel(game) —— 在 StatsSystem.init() 中调用；
 *       面板 id 'status'，hotkey 'c'。
 * 依赖：game.systems.stats / game.systems.inventory / game.ui。
 *
 * 刷新策略：订阅 stat:changed / status:applied / status:removed / levelup /
 *          inventory:changed / player:died / player:respawn，且仅在面板打开时更新 DOM；
 *          面板打开期间另有 450ms 低频计时器刷新状态剩余时间。
 */

const SLOT_ROWS = [
  ['weapon', '武器'],
  ['shield', '盾'],
  ['cloak', '斗篷'],
  ['amulet', '护符'],
  ['hands', '护手'],
];

const ATTR_ROWS = [
  { key: 'armor', glyph: 'ᛉ', name: '护甲', latin: 'ARMOR' },
  { key: 'damage', glyph: 'ᛏ', name: '攻击', latin: 'POWER' },
  { key: 'weight', glyph: 'ᚹ', name: '负重', latin: 'BURDEN' },
  { key: 'speed', glyph: 'ᚱ', name: '移动速度', latin: 'SWIFTNESS' },
];

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function setupStatusPanel(game) {
  if (!game?.ui) return;

  const ui = game.ui;
  const stats = () => game.systems?.stats;
  const inv = () => game.systems?.inventory;

  const refs = {};
  let built = false;
  let tickTimer = null;
  let lastStatusSig = null;
  let lastEquipSig = null;

  /** 资源条：写入宽度与「当前 / 上限」文本 */
  function setBar(bar, value, max) {
    if (!bar) return;
    const v = Number(value) || 0;
    const m = Number(max) || 0;
    bar.fill.style.width = `${(m > 0 ? clamp(v / m, 0, 1) * 100 : 0).toFixed(1)}%`;
    bar.num.textContent = `${Math.round(v)} / ${Math.round(m)}`;
  }

  // ---------------------------------------------------------------- 渲染
  function renderStatuses(sys) {
    if (!refs.statuses) return;
    const list = Array.from(sys.statuses.values());
    // 只在「id + 剩余整秒」变化时重建 DOM，避免高频刷新造成 hover 抖动
    const signature = list.map((s) => `${s.id}:${Math.ceil(s.remaining)}`).join('|');
    if (signature === lastStatusSig) return;
    lastStatusSig = signature;

    if (!list.length) {
      refs.statuses.innerHTML = '<span class="st-empty">身心澄澈，无咒加身</span>';
      return;
    }
    refs.statuses.innerHTML = list.map((status) => {
      const kind = status.kind === 'debuff' ? 'tag--debuff' : 'tag--buff';
      const seconds = Math.max(0, Math.ceil(status.remaining));
      return `<span class="tag ${kind} st-status" title="${esc(status.name)}">
        <b class="tag__glyph">${esc(status.icon)}</b>${esc(status.name)}
        <em class="tag__time">${seconds}s</em>
      </span>`;
    }).join('');
  }

  function renderEquipment(sys) {
    if (!refs.equip) return;
    const equipment = sys?.equipment || {};
    // 装备未变化就不重建 DOM（stat:changed 以 10Hz 触发，避免无意义写入）
    const signature = SLOT_ROWS.map(([slot]) => equipment[slot]?.id || '').join('|');
    if (signature === lastEquipSig) return;
    lastEquipSig = signature;
    refs.equip.innerHTML = SLOT_ROWS.map(([slot, name]) => {
      const def = equipment[slot];
      return `<div class="row"><span class="k">${name}</span>
        <span class="v">${def ? esc(def.name) : '<i class="dim">—</i>'}</span></div>`;
    }).join('');
  }

  function sync() {
    if (!built) return;
    const sys = stats();
    if (!sys) return;
    const invSys = inv();

    setBar(refs.health, sys.health, sys.maxHealth);
    setBar(refs.stamina, sys.stamina, sys.maxStamina);
    setBar(refs.mana, sys.mana, sys.maxMana);

    if (refs.level) refs.level.textContent = String(Math.round(sys.level));
    if (refs.xpFill) {
      const ratio = sys.xpToNext > 0 ? clamp(sys.xp / sys.xpToNext, 0, 1) : 0;
      refs.xpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    }
    if (refs.xpText) {
      refs.xpText.textContent = `经验 ${Math.round(sys.xp)} / ${Math.round(sys.xpToNext)}`;
    }
    if (refs.gold) refs.gold.textContent = String(Math.max(0, Math.round(sys.gold)));

    if (refs.attrArmor) refs.attrArmor.textContent = String(sys.armor);
    if (refs.attrDamage) refs.attrDamage.textContent = String(sys.attackDamage);
    if (refs.attrWeight) {
      refs.attrWeight.textContent = `${Math.round(invSys?.totalWeight?.() || 0)} / ${Math.round(invSys?.capacityWeight?.() || 0)}`;
    }
    if (refs.attrSpeed) refs.attrSpeed.textContent = `${Math.round(sys.moveSpeedMult * 100)}%`;

    renderStatuses(sys);
    renderEquipment(invSys);
    if (refs.dead) refs.dead.classList.toggle('is-on', !!sys.isDead);
  }

  /** 面板打开期间用低频计时器推进状态剩余时间显示 */
  function startTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (!ui.isOpen('status')) { stopTick(); return; }
      sync();
    }, 450);
  }

  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  // ---------------------------------------------------------------- 面板注册
  const def = ui.registerPanel({
    id: 'status',
    title: '英灵状态',
    latin: 'EINHERJAR',
    hotkey: 'c',

    build(root) {
      root.innerHTML = `
        <div class="st">
          <section class="st__left">
            <div class="st-emblem">
              <svg class="st-ring" viewBox="0 0 260 260" aria-hidden="true">
                <circle class="st-ring__outer" cx="130" cy="130" r="120" />
                <circle class="st-ring__inner" cx="130" cy="130" r="104" />
                <circle class="st-ring__dash" cx="130" cy="130" r="88" />
                <circle class="st-ring__core" cx="130" cy="130" r="64" />
                <g class="st-ring__runes">
                  <text x="130" y="22">ᚠ</text><text x="208" y="52">ᚢ</text>
                  <text x="240" y="130">ᚦ</text><text x="208" y="208">ᚨ</text>
                  <text x="130" y="238">ᚱ</text><text x="52" y="208">ᚲ</text>
                  <text x="20" y="130">ᚷ</text><text x="52" y="52">ᚹ</text>
                </g>
              </svg>
              <div class="st-emblem__level">
                <span class="st-emblem__num" data-ref="level">1</span>
                <span class="st-emblem__label latin">LEVEL</span>
              </div>
            </div>

            <div class="st-xp">
              <div class="st-xp__head">
                <span class="latin">EXPERIENCE</span>
                <span class="st-xp__num" data-ref="xpText">经验 0 / 100</span>
              </div>
              <div class="stat-bar stat-bar--xp"><span class="stat-bar__fill" data-ref="xpFill"></span></div>
            </div>

            <div class="st-name">
              <div class="st-name__cn">英灵 · 无名者</div>
              <div class="st-name__latin latin">THE NAMELESS EINHERJAR</div>
            </div>

            <div class="st-gold">
              <span class="latin">GOLD</span>
              <span class="st-gold__num" data-ref="gold">0</span>
            </div>
          </section>

          <section class="st__right scroll">
            <div class="st-block st-vitals">
              <div class="st-vital">
                <div class="st-vital__head">
                  <span class="st-vital__name">生命</span>
                  <span class="latin st-vital__latin">HEALTH</span>
                  <span class="st-vital__num" data-ref="healthNum">100 / 100</span>
                </div>
                <div class="stat-bar stat-bar--health"><span class="stat-bar__fill" data-ref="healthFill"></span></div>
              </div>
              <div class="st-vital">
                <div class="st-vital__head">
                  <span class="st-vital__name">耐力</span>
                  <span class="latin st-vital__latin">STAMINA</span>
                  <span class="st-vital__num" data-ref="staminaNum">100 / 100</span>
                </div>
                <div class="stat-bar stat-bar--stamina"><span class="stat-bar__fill" data-ref="staminaFill"></span></div>
              </div>
              <div class="st-vital">
                <div class="st-vital__head">
                  <span class="st-vital__name">法力</span>
                  <span class="latin st-vital__latin">MANA</span>
                  <span class="st-vital__num" data-ref="manaNum">60 / 60</span>
                </div>
                <div class="stat-bar stat-bar--mana"><span class="stat-bar__fill" data-ref="manaFill"></span></div>
              </div>
            </div>

            <div class="rune-divider"></div>

            <div class="st-block">
              <div class="st-block__head"><span>属性</span><span class="latin">ATTRIBUTES</span></div>
              <div class="st-attrs">
                ${ATTR_ROWS.map((row) => `
                  <div class="st-attr">
                    <span class="st-attr__glyph">${row.glyph}</span>
                    <div class="st-attr__text">
                      <span class="st-attr__k">${row.name}</span>
                      <span class="st-attr__v" data-ref="attr-${row.key}">0</span>
                    </div>
                    <span class="st-attr__latin latin">${row.latin}</span>
                  </div>`).join('')}
              </div>
            </div>

            <div class="st-block">
              <div class="st-block__head"><span>状态效果</span><span class="latin">EFFECTS</span></div>
              <div class="st-statuses" data-ref="statuses"></div>
            </div>

            <div class="st-block">
              <div class="st-block__head"><span>装备</span><span class="latin">ARMAMENT</span></div>
              <div class="rows st-equip" data-ref="equip"></div>
            </div>
          </section>

          <div class="st-dead" data-ref="dead" aria-hidden="true">
            <span class="st-dead__title">英灵陨落</span>
            <span class="latin">FALLEN · RETURNING TO THE RING</span>
          </div>
        </div>`;

      refs.health = { fill: root.querySelector('[data-ref="healthFill"]'), num: root.querySelector('[data-ref="healthNum"]') };
      refs.stamina = { fill: root.querySelector('[data-ref="staminaFill"]'), num: root.querySelector('[data-ref="staminaNum"]') };
      refs.mana = { fill: root.querySelector('[data-ref="manaFill"]'), num: root.querySelector('[data-ref="manaNum"]') };
      refs.level = root.querySelector('[data-ref="level"]');
      refs.xpFill = root.querySelector('[data-ref="xpFill"]');
      refs.xpText = root.querySelector('[data-ref="xpText"]');
      refs.gold = root.querySelector('[data-ref="gold"]');
      refs.attrArmor = root.querySelector('[data-ref="attr-armor"]');
      refs.attrDamage = root.querySelector('[data-ref="attr-damage"]');
      refs.attrWeight = root.querySelector('[data-ref="attr-weight"]');
      refs.attrSpeed = root.querySelector('[data-ref="attr-speed"]');
      refs.statuses = root.querySelector('[data-ref="statuses"]');
      refs.equip = root.querySelector('[data-ref="equip"]');
      refs.dead = root.querySelector('[data-ref="dead"]');

      built = true;
    },

    refresh() {
      sync();
    },

    onOpen() {
      lastStatusSig = null;
      lastEquipSig = null;
      sync();
      startTick();
    },

    onClose() {
      stopTick();
    },
  });

  // ---------------------------------------------------------------- 事件订阅
  const offs = [];
  const requestSync = () => {
    if (!ui.isOpen('status')) return;
    sync();
  };
  for (const type of [
    'stat:changed',
    'status:applied',
    'status:removed',
    'levelup',
    'inventory:changed',
    'equipment:changed',
    'player:died',
    'player:respawn',
  ]) {
    offs.push(game.events.on(type, requestSync));
  }
  def._offs = offs; // 便于后续 dispose 时统一取消
}
