/**
 * HUD.js — 游戏内抬头显示。
 *
 * 包含：生命体征面板、罗盘插槽、小地图插槽、任务追踪插槽、交互提示、
 * 区域标题卡、受击红晕、死亡遮罩、性能面板、快捷键菜单。
 *
 * 与其它系统的耦合方式：
 *  - 数值：低频轮询 game.systems.stats（避免依赖具体事件名，容错性更好）
 *  - 插槽：ui.registerSlot('minimap'|'compass'|'questtracker', el)
 *  - 交互：订阅 interaction:focus / player:damaged / player:died / player:respawn
 */
import { REGIONS } from '../data/world.js';

const _v3 = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
const _screen = { x: 0, y: 0, visible: false };
function THREE_clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

const STAT_POLL_INTERVAL = 0.14;

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud');
    this.el = {};
    this._pollTimer = 0;
    this._perfTimer = 0;
    this._regionTimer = 0;
    this._regionHideTimer = 0;
    this._currentRegion = null;
    this._perfVisible = false;
    this._damageTimer = 0;
    this._regionFallback = null;
  }

  init() {
    this.root.innerHTML = `
      <div class="hud-vitals hud-plate">
        <div class="vitals__portrait">
          <svg viewBox="0 0 66 66" aria-hidden="true">
            <circle class="portrait-ring" cx="33" cy="33" r="31" stroke-width="1"/>
            <circle class="portrait-ring--dash" cx="33" cy="33" r="26" stroke-width="1"/>
            <circle class="portrait-ring" cx="33" cy="33" r="21" stroke-width="0.6" opacity="0.5"/>
          </svg>
          <div class="vitals__level"><span id="hud-level">1</span><small>EINHERJAR</small></div>
        </div>
        <div class="vitals__bars">
          <div class="vitals__name">
            <span class="n">英灵 · 无名者</span>
            <span class="l">THE NAMELESS</span>
          </div>
          <div class="bar-row">
            <span class="bar-label">生命</span>
            <div class="stat-bar stat-bar--health"><i class="stat-bar__fill" id="hud-hp-fill"></i></div>
            <span class="bar-value" id="hud-hp-val">100</span>
          </div>
          <div class="bar-row">
            <span class="bar-label">耐力</span>
            <div class="stat-bar stat-bar--stamina"><i class="stat-bar__fill" id="hud-st-fill"></i></div>
            <span class="bar-value" id="hud-st-val">100</span>
          </div>
          <div class="bar-row">
            <span class="bar-label">法力</span>
            <div class="stat-bar stat-bar--mana"><i class="stat-bar__fill" id="hud-mp-fill"></i></div>
            <span class="bar-value" id="hud-mp-val">60</span>
          </div>
          <div class="vitals__statuses" id="hud-statuses"></div>
        </div>
      </div>

      <div class="hud-compass">
        <div class="hud-compass__slot" id="hud-compass"></div>
        <div class="hud-compass__center"></div>
      </div>

      <div class="hud-menu">
        <button class="hud-menu__btn" data-panel="inventory" title="行囊 (I)">
          <span class="glyph">ᛞ</span><span class="key">I</span><span class="label">行囊</span>
        </button>
        <button class="hud-menu__btn" data-panel="status" title="状态 (C)">
          <span class="glyph">ᛉ</span><span class="key">C</span><span class="label">状态</span>
        </button>
        <button class="hud-menu__btn" data-panel="map" title="舆图 (M)">
          <span class="glyph">ᛟ</span><span class="key">M</span><span class="label">舆图</span>
        </button>
        <button class="hud-menu__btn" data-panel="quest" title="纪事 (L)">
          <span class="glyph">ᚱ</span><span class="key">L</span><span class="label">纪事</span>
        </button>
      </div>

      <div class="hud-minimap">
        <div class="hud-minimap__slot" id="hud-minimap"></div>
        <div class="hud-minimap__north">N</div>
        <div class="hud-minimap__label" id="hud-region-label">尤克特拉希尔</div>
      </div>

      <div class="hud-questtracker"><div class="hud-questtracker__slot" id="hud-questtracker"></div></div>

      <div class="hud-prompt" id="hud-prompt">
        <span class="key" id="hud-prompt-key">F</span>
        <span class="text" id="hud-prompt-text">交互</span>
      </div>

      <div class="hud-hints">
        <span><kbd>WASD</kbd>移动</span>
        <span><kbd>Shift</kbd>疾跑</span>
        <span><kbd>Space</kbd>跳跃</span>
        <span><kbd>F</kbd>交互</span>
        <span><kbd>左键</kbd>攻击</span>
        <span><kbd>M</kbd>舆图</span>
      </div>

      <div class="hud-region" id="hud-region">
        <div class="latin" id="hud-region-latin">YGGDRASIL</div>
        <div class="name" id="hud-region-name">尤克特拉希尔</div>
        <div class="rule"></div>
      </div>

      <div class="hud-damage" id="hud-damage"></div>

      <div class="hud-death" id="hud-death">
        <div>
          <div class="title">你 已 倒 下</div>
          <div class="latin">THE VALKYRIES CALL</div>
          <div class="sub">英灵殿的号角再次响起……</div>
        </div>
      </div>

      <div class="hud-objective" id="hud-objective">
        <span class="diamond">◆</span>
        <span class="dist" id="hud-objective-dist"></span>
        <span class="label" id="hud-objective-label"></span>
      </div>

      <div class="hud-perf" id="hud-perf"></div>
    `;

    this.el = {
      level: document.getElementById('hud-level'),
      minimap: document.getElementById('hud-minimap'),
      hpFill: document.getElementById('hud-hp-fill'),
      stFill: document.getElementById('hud-st-fill'),
      mpFill: document.getElementById('hud-mp-fill'),
      hpVal: document.getElementById('hud-hp-val'),
      stVal: document.getElementById('hud-st-val'),
      mpVal: document.getElementById('hud-mp-val'),
      statuses: document.getElementById('hud-statuses'),
      prompt: document.getElementById('hud-prompt'),
      promptKey: document.getElementById('hud-prompt-key'),
      promptText: document.getElementById('hud-prompt-text'),
      region: document.getElementById('hud-region'),
      regionName: document.getElementById('hud-region-name'),
      regionLatin: document.getElementById('hud-region-latin'),
      regionLabel: document.getElementById('hud-region-label'),
      damage: document.getElementById('hud-damage'),
      death: document.getElementById('hud-death'),
      perf: document.getElementById('hud-perf'),
      objective: document.getElementById('hud-objective'),
      objectiveDist: document.getElementById('hud-objective-dist'),
      objectiveLabel: document.getElementById('hud-objective-label'),
    };

    // 注册 HUD 插槽（其它系统会向里面挂载内容）
    this.game.ui.registerSlot('minimap', this.el.minimap || document.getElementById('hud-minimap'));
    this.game.ui.registerSlot('compass', document.getElementById('hud-compass'));
    this.game.ui.registerSlot('questtracker', document.getElementById('hud-questtracker'));

    // 菜单按钮
    for (const btn of this.root.querySelectorAll('.hud-menu__btn')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.panel;
        if (this.game.ui.panels.has(id)) this.game.ui.toggle(id);
        else this.game.ui.toast('该界面尚未解锁。', { kind: 'info', latin: 'NOT YET' });
      });
    }

    // F3 性能面板
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this._perfVisible = !this._perfVisible;
        this.el.perf.classList.toggle('is-visible', this._perfVisible);
      }
    });

    this._bindEvents();
    this._setRegionLabel(REGIONS[0]);
  }

  _bindEvents() {
    const bus = this.game.events;

    bus.on('interaction:focus', (payload) => {
      if (!payload) {
        this.el.prompt.classList.remove('is-visible');
        return;
      }
      this.el.promptKey.textContent = payload.key || 'F';
      this.el.promptText.innerHTML = `${this._esc(payload.label)}${payload.latin ? `<small>${this._esc(payload.latin)}</small>` : ''}`;
      this.el.prompt.classList.add('is-visible');
    });

    bus.on('player:damaged', () => {
      this.el.damage.classList.add('is-hit');
      clearTimeout(this._damageTimer);
      this._damageTimer = setTimeout(() => this.el.damage.classList.remove('is-hit'), 60);
      this.game.camera3p?.shake?.(0.16);
    });

    bus.on('player:died', () => {
      this.el.death.classList.add('is-visible');
      this.el.prompt.classList.remove('is-visible');
    });

    bus.on('player:respawn', () => {
      this.el.death.classList.remove('is-visible');
    });

    bus.on('quest:completed', () => {
      this.game.camera3p?.shake?.(0.08);
    });
  }

  // ---------------------------------------------------------------- 更新
  update(dt) {
    this._pollTimer += dt;
    if (this._pollTimer >= STAT_POLL_INTERVAL) {
      this._pollTimer = 0;
      this._syncVitals();
      this._syncStatuses();
    }

    if (this._perfVisible) {
      this._perfTimer += dt;
      if (this._perfTimer > 0.2) {
        this._perfTimer = 0;
        this._syncPerf();
      }
    }

    this._objectiveTimer = (this._objectiveTimer || 0) + dt;
    if (this._objectiveTimer > 0.2) {
      this._objectiveTimer = 0;
      this._syncObjectiveMarker();
    }

    this._regionTimer += dt;
    if (this._regionTimer > 0.8) {
      this._regionTimer = 0;
      this._detectRegion();
    }
    if (this._regionHideTimer > 0) {
      this._regionHideTimer -= dt;
      if (this._regionHideTimer <= 0) this.el.region.classList.remove('is-visible');
    }
  }

  _syncVitals() {
    const stats = this.game.systems?.stats;
    if (!stats) return;
    const hp = Math.max(0, stats.health ?? 0);
    const hpMax = Math.max(1, stats.maxHealth ?? 100);
    const st = Math.max(0, stats.stamina ?? 0);
    const stMax = Math.max(1, stats.maxStamina ?? 100);
    const mp = Math.max(0, stats.mana ?? 0);
    const mpMax = Math.max(1, stats.maxMana ?? 60);

    this.el.hpFill.style.width = `${(hp / hpMax) * 100}%`;
    this.el.stFill.style.width = `${(st / stMax) * 100}%`;
    this.el.mpFill.style.width = `${(mp / mpMax) * 100}%`;
    this.el.hpVal.textContent = `${Math.round(hp)}`;
    this.el.stVal.textContent = `${Math.round(st)}`;
    this.el.mpVal.textContent = `${Math.round(mp)}`;
    this.el.level.textContent = String(stats.level ?? 1);
  }

  _syncStatuses() {
    const stats = this.game.systems?.stats;
    if (!stats) return;
    const raw = stats.statuses;
    let list = [];
    if (raw instanceof Map) list = Array.from(raw.values());
    else if (Array.isArray(raw)) list = raw;
    if (!list.length) {
      if (this.el.statuses.childElementCount) this.el.statuses.innerHTML = '';
      return;
    }
    this.el.statuses.innerHTML = list.slice(0, 6).map((s) => {
      const remain = s.remaining != null ? `${Math.ceil(s.remaining)}s` : '';
      return `<span class="tag tag--${s.kind === 'debuff' ? 'debuff' : 'buff'}"><i>${this._esc(s.icon || 'ᛟ')}</i>${this._esc(s.name || s.id)}<em>${remain}</em></span>`;
    }).join('');
  }

  /** 当前追踪任务的第一个未完成目标：在屏幕上显示金色菱形标记与距离 */
  _syncObjectiveMarker() {
    const el = this.el.objective;
    if (!el) return;
    const quest = this.game.systems?.quest;
    const world = this.game.world;
    const player = this.game.player;
    if (!quest || !world || !player || !this.game.started) { el.classList.remove('is-visible'); return; }
    const tracked = quest.tracked;
    const inst = Array.isArray(tracked) ? tracked[0] : tracked;
    if (!inst) { el.classList.remove('is-visible'); return; }
    const obj = (inst.objectives || []).find((o) => !o.done);
    if (!obj || !obj.def) { el.classList.remove('is-visible'); return; }

    const def = obj.def;
    let target = null;
    if (def.type === 'reach') {
      target = world.getPoi(def.target) || world.getPoi(`poi_${String(def.target).replace(/^poi_/, '')}`);
    } else if (def.type === 'light') {
      target = world.pois.find((p) => p.landmarkId === def.target);
    } else if (def.type === 'interact') {
      const it = world.interactables.find((x) => x.id === `npc_${String(def.target).replace(/^npc_/, '')}`);
      if (it) target = { x: it.position.x, z: it.position.z };
    }
    if (!target) { el.classList.remove('is-visible'); return; }

    const dx = target.x - player.position.x;
    const dz = target.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    const screen = this.game.engine.projectToScreen(
      _v3.set(target.x, (target.y || world.sampleHeight(target.x, target.z)) + 6, target.z),
      _screen,
    );
    const w = window.innerWidth;
    const h = window.innerHeight;
    let x = screen.x;
    let y = screen.y;
    let clamped = false;
    if (!screen.visible || x < 40 || x > w - 40 || y < 70 || y > h - 90) {
      clamped = true;
      x = THREE_clamp(x, 50, w - 50);
      y = THREE_clamp(y, 84, h - 110);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.add('is-visible');
    el.classList.toggle('is-edge', clamped || dist > 750);
    this.el.objectiveDist.textContent = dist > 999 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    this.el.objectiveLabel.textContent = def.text || '';
  }

  _syncPerf() {
    const engine = this.game.engine;
    const s = engine.stats;
    const p = this.game.player;
    const chunkCount = this.game.world?.terrain?.chunks?.size ?? 0;
    this.el.perf.textContent =
      `FPS ${s.fps.toFixed(0)}  |  ${s.frameMs.toFixed(1)}ms\n` +
      `DRAW ${s.drawCalls}  |  TRI ${(s.triangles / 1000).toFixed(0)}k\n` +
      `PR ${s.pixelRatio.toFixed(2)}  |  CHUNK ${chunkCount}\n` +
      `POS ${p ? `${p.position.x.toFixed(0)}, ${p.position.z.toFixed(0)}` : '-'}\n` +
      `QUALITY ${this.game.quality.toUpperCase()}`;
  }

  _detectRegion() {
    const p = this.game.player;
    if (!p || !this.game.started) return;
    let best = null;
    let bestD = Infinity;
    for (const r of REGIONS) {
      const d = Math.hypot(p.position.x - r.cx, p.position.z - r.cz);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best) return;
    if (!this._currentRegion) {
      this._currentRegion = best;
      this._setRegionLabel(best);
      return;
    }
    if (best.id !== this._currentRegion.id && bestD < 620) {
      this._currentRegion = best;
      this._setRegionLabel(best);
      this._showRegionCard(best);
    }
  }

  _setRegionLabel(region) {
    if (this.el.regionLabel && region) this.el.regionLabel.textContent = region.name.split(' · ')[0];
  }

  _showRegionCard(region) {
    this.el.regionName.textContent = region.name;
    this.el.regionLatin.textContent = region.latin;
    this.el.region.classList.add('is-visible');
    this._regionHideTimer = 2.6;
    this.game.systems?.audio?.play?.('banner', { volume: 0.35 });
  }

  /** 玩家点击"开始旅程"后触发首次区域标题 */
  announceRegion() {
    this._currentRegion = null;
    this._detectRegion();
    if (this._currentRegion) this._showRegionCard(this._currentRegion);
  }

  _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
}
