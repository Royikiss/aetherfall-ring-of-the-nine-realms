/**
 * ui/Minimap.js — HUD 上的三个轻量组件：
 *   Minimap      圆形小地图（北朝上、玩家居中、金色箭头）
 *   Compass      屏幕顶部横向刻度带（方位字母 + 附近 POI 方位点 + 航向读数）
 *   QuestTracker 任务追踪器（当前追踪任务 + 当前阶段目标进度）
 *
 * 与 HUD 的分工（src/ui/HUD.js 已提供）：
 *   #hud-minimap      圆形裁切容器 + 外环 + 北向字母 + 区域名
 *   #hud-compass      横向刻度装饰带 + 中央指针
 *   #hud-questtracker 右上追踪容器
 * 因此本文件只画「会动的东西」，不重复 HUD 的静态装饰。
 *
 * 性能：
 *  - 小地图 / 罗盘用累加时间限制在 12fps 重绘；容器尺寸变化时才重建后备缓冲
 *  - 追踪器只在任务状态签名变化时重建 DOM，距离读数 2Hz 更新
 *  - 插槽暂不存在时逐帧重试（最多 60 帧），兼容 HUD 晚于系统初始化的情况
 *
 * 依赖：无外部资源；样式见 ui/styles/mapquest.css。
 */

const TAU = Math.PI * 2;
const DISPLAY_FONT = "'Cinzel', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Songti SC', serif";
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 插槽别名：契约里写 questtracker，UIManager 注释里写 questTracker，两种都兼容 */
const SLOT_ALIASES = {
  minimap: ['minimap'],
  compass: ['compass'],
  questtracker: ['questtracker', 'questTracker', 'quest_tracker'],
};

const dprOf = () => Math.min(2, Math.max(1, Number(typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1));

/** 角度归一化到 [-π, π] */
function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/**
 * 把元素挂到 HUD 插槽。HUD 可能晚于系统创建，所以逐帧重试。
 * @param {object} ui UIManager
 * @param {string} name 插槽名（minimap / compass / questtracker）
 * @param {HTMLElement} el
 * @param {() => void} [onMount] 成功挂载后的回调（用于测量尺寸）
 * @param {number} [maxTries=60]
 */
export function mountToSlot(ui, name, el, onMount, maxTries = 60) {
  if (!el || typeof document === 'undefined') return;
  const aliases = SLOT_ALIASES[name] || [name];
  let tries = 0;

  const resolve = () => {
    for (const key of aliases) {
      const slot = ui?.slot?.(key);
      if (slot) return slot;
    }
    // 兜底：直接找 HUD 预留容器（#hud-minimap / #hud-compass / #hud-questtracker）
    for (const key of aliases) {
      const node = document.getElementById(`hud-${key.toLowerCase()}`);
      if (node) return node;
    }
    return null;
  };

  const attempt = () => {
    const slot = resolve();
    if (slot) {
      if (el.parentNode !== slot) slot.appendChild(el);
      el.classList.add('is-mounted');
      try { onMount?.(); } catch (err) { /* 尺寸测量失败不阻断挂载 */ }
      return;
    }
    tries++;
    if (tries < maxTries && typeof requestAnimationFrame === 'function') requestAnimationFrame(attempt);
  };
  attempt();
}

// ===========================================================================
// 小地图
// ===========================================================================
export class Minimap {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.size = 208;          // HUD 桌面端容器尺寸，作为兜底
    this._acc = 0;
    this._interval = 1 / 12;  // ≤ 12fps
    this._ro = null;

    this.el = document.createElement('div');
    this.el.className = 'mq-minimap';
    this.el.innerHTML = '<canvas class="mq-minimap__canvas" aria-label="小地图"></canvas>';
    this.canvas = this.el.querySelector('.mq-minimap__canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    this._draw();
  }

  /** 插槽挂载成功后测量真实尺寸 */
  onMounted() {
    this._resize();
    this._draw();
    this._observe();
  }

  update(dt) {
    if (!this.map) return;
    this._acc += Number.isFinite(dt) ? dt : 0;
    if (this._acc < this._interval) return;
    this._acc = 0;
    this._draw();
  }

  dispose() {
    this._ro?.disconnect?.();
    this._ro = null;
    this.ctx = null;
  }

  _observe() {
    if (this._ro || typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(() => {
      this._resize();
      this._draw();
    });
    this._ro.observe(this.el.parentElement || this.el);
  }

  _resize() {
    const parent = this.el.parentElement;
    const measured = this.el.clientWidth || (parent && parent.clientWidth) || 0;
    const size = Math.max(120, Math.min(300, Math.round(measured || this.size)));
    const dpr = dprOf();
    const px = Math.round(size * dpr);
    this.size = size;
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
      this.canvas.style.width = `${size}px`;
      this.canvas.style.height = `${size}px`;
    }
    this.ctx = this.canvas.getContext('2d') || this.ctx;
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx || !this.map) return;
    const s = this.size;
    const r = s / 2;
    const dpr = dprOf();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    this.map.renderMinimap(ctx, s, { rotation: 0, viewRadius: 150 });

    // 边缘暗角：让地图自然融入 HUD
    const g = ctx.createRadialGradient(r, r, r * 0.3, r, r, r);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(2, 4, 7, 0.66)');
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    // 内圈细金线（外环与北向字母由 HUD 提供）
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, TAU);
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.34)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// ===========================================================================
// 罗盘
// ===========================================================================
export class Compass {
  constructor(game, map) {
    this.game = game;
    this.map = map;
    this.w = 560;
    this.h = 46;
    this._acc = 0;
    this._interval = 1 / 12;
    this._readText = '';
    this._ro = null;

    this.el = document.createElement('div');
    this.el.className = 'mq-compass';
    this.el.innerHTML = `
      <canvas class="mq-compass__canvas" aria-label="罗盘"></canvas>
      <span class="mq-compass__read latin">N · 000°</span>`;
    this.canvas = this.el.querySelector('.mq-compass__canvas');
    this.ctx = this.canvas.getContext('2d');
    this.readout = this.el.querySelector('.mq-compass__read');
    this._resize();
    this._draw();
  }

  onMounted() {
    this._resize();
    this._draw();
    this._observe();
  }

  update(dt) {
    if (!this.map) return;
    this._acc += Number.isFinite(dt) ? dt : 0;
    if (this._acc < this._interval) return;
    this._acc = 0;
    this._draw();
  }

  dispose() {
    this._ro?.disconnect?.();
    this._ro = null;
    this.ctx = null;
  }

  _observe() {
    if (this._ro || typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(() => {
      this._resize();
      this._draw();
    });
    this._ro.observe(this.el.parentElement || this.el);
  }

  _resize() {
    const parent = this.el.parentElement;
    const w = this.el.clientWidth || (parent && parent.clientWidth) || 0;
    const h = this.el.clientHeight || (parent && parent.clientHeight) || 0;
    this.w = Math.max(240, Math.min(760, Math.round(w || this.w)));
    this.h = Math.max(30, Math.min(60, Math.round(h || this.h)));
    const dpr = dprOf();
    const pxW = Math.round(this.w * dpr);
    const pxH = Math.round(this.h * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
    }
    this.ctx = this.canvas.getContext('2d') || this.ctx;
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx || !this.map) return;
    const { w, h } = this;
    const dpr = dprOf();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // playerAngle()：0 = 面朝北，顺时针为正（东），可直接当罗盘朝向
    const heading = this.map.playerAngle();
    const fov = Math.PI * 0.62;            // 视野半角约 55.8°
    const halfW = w * 0.5 - 14;
    const cx = w / 2;
    const xAt = (delta) => cx + (delta / (fov / 2)) * halfW;

    // 方位字母：挂在 HUD 刻度带下沿（刻度带与中央指针由 hud.css 提供）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      const delta = wrapAngle(a - heading);
      if (Math.abs(delta) > fov / 2 - 0.02) continue;
      const cardinal = i % 2 === 0;
      ctx.font = `${cardinal ? 600 : 400} ${cardinal ? 12 : 9}px ${DISPLAY_FONT}`;
      ctx.fillStyle = cardinal ? 'rgba(244, 224, 163, 0.92)' : 'rgba(201, 164, 92, 0.62)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 5;
      ctx.fillText(CARDINALS[i], xAt(delta), h - 2);
      ctx.shadowBlur = 0;
    }

    // 附近 POI 的方位点（只在 900m 内显示，避免噪音）
    const markers = this.map.markers || [];
    const player = this.game?.player?.position;
    if (player && markers.length) {
      for (const m of markers) {
        if (!m.discovered) continue;
        const dx = m.x - player.x;
        const dz = m.z - player.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 900 || dist < 6) continue;
        const bearing = Math.atan2(dx, -dz); // 0 = 北，顺时针
        const delta = wrapAngle(bearing - heading);
        if (Math.abs(delta) > fov / 2 - 0.02) continue;
        const st = this.map.markerStyle?.[m.type] || this.map.markerStyle?.default;
        const color = m.lit ? '#f4e0a3' : st?.color || '#c9a45c';
        const alpha = 0.95 - Math.min(0.5, dist / 2000);
        const x = xAt(delta);
        const y = Math.max(8, h * 0.2);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, TAU);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 2.4, y + 0.6);
        ctx.lineTo(x - 2.4, y + 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 航向读数（整数度变化时才写 DOM）
    const deg = Math.round(((heading * 180) / Math.PI + 360) % 360) % 360;
    const label = CARDINALS[Math.round(deg / 45) % 8];
    const text = `${label} · ${String(deg).padStart(3, '0')}°`;
    if (text !== this._readText) {
      this._readText = text;
      if (this.readout) this.readout.textContent = text;
    }
  }
}

// ===========================================================================
// 任务追踪器
// ===========================================================================
export class QuestTracker {
  /**
   * @param {object} game
   * @param {object} questSystem QuestSystem 实例
   */
  constructor(game, questSystem) {
    this.game = game;
    this.qs = questSystem;
    this.el = document.createElement('div');
    this.el.className = 'mq-tracker';
    this.el.innerHTML = `
      <div class="mq-tracker__head">
        <span class="mq-tracker__latin latin">SAGA</span>
        <span class="mq-tracker__title">—</span>
      </div>
      <div class="mq-tracker__stage"></div>
      <ul class="mq-tracker__list"></ul>`;
    this.titleEl = this.el.querySelector('.mq-tracker__title');
    this.stageEl = this.el.querySelector('.mq-tracker__stage');
    this.listEl = this.el.querySelector('.mq-tracker__list');

    this._sig = '';
    this._acc = 0;
    this._distAcc = 0;
    this._items = [];
    this.sync();
  }

  /** 状态变化时重建（按签名比较，绝不每帧重建） */
  sync() {
    const q = this.qs?.tracked;
    const sig = this._signature(q);
    if (sig === this._sig) return;
    this._sig = sig;
    this._items = [];

    if (!q) {
      this.el.classList.add('is-empty');
      this.titleEl.textContent = '暂无追踪的使命';
      this.stageEl.textContent = '';
      this.listEl.innerHTML = '';
      return;
    }
    this.el.classList.remove('is-empty');
    this.titleEl.textContent = q.def.title;
    this.stageEl.textContent = q.completed
      ? '使命已成'
      : `第 ${q.stageIndex + 1} 幕 · ${q.stage?.text || ''}`;

    const frag = document.createDocumentFragment();
    for (const obj of q.objectives || []) {
      const li = document.createElement('li');
      li.className = 'mq-obj' + (obj.done ? ' is-done' : '');
      if (obj.def.type === 'reach' || obj.def.type === 'light' || obj.def.type === 'interact') {
        li.dataset.target = obj.def.target;
      }
      const mark = document.createElement('span');
      mark.className = 'mq-obj__mark';
      mark.textContent = obj.done ? '✓' : '◇';
      const text = document.createElement('span');
      text.className = 'mq-obj__text';
      text.textContent = obj.def.text;
      const count = document.createElement('span');
      count.className = 'mq-obj__count';
      count.textContent = obj.def.count > 1 ? `${obj.progress}/${obj.def.count}` : (obj.done ? '' : '待办');
      li.appendChild(mark);
      li.appendChild(text);
      li.appendChild(count);
      frag.appendChild(li);
      this._items.push({ li, obj, count });
    }
    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);
  }

  update(dt) {
    const d = Number.isFinite(dt) ? dt : 0;
    this._acc += d;
    if (this._acc >= 0.25) {
      this._acc = 0;
      this.sync();
    }
    // 距离读数 2Hz 刷新即可
    this._distAcc += d;
    if (this._distAcc < 0.5) return;
    this._distAcc = 0;
    const player = this.game?.player?.position;
    if (!player) return;
    for (const item of this._items) {
      const target = item.li.dataset.target;
      if (!target || item.obj.done) continue;
      const pos = this._targetPos(target);
      if (!pos) continue;
      const dx = pos.x - player.x;
      const dz = pos.z - player.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const txt = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
      if (item.count.textContent !== txt) item.count.textContent = txt;
    }
  }

  _targetPos(target) {
    const world = this.game?.world;
    if (world) {
      if (typeof world.getPoi === 'function') {
        const raw = String(target ?? '');
        const bare = raw.replace(/^poi_/, '');
        const poi = world.getPoi(raw) || world.getPoi(bare) || world.getPoi(`poi_${bare}`);
        if (poi && Number.isFinite(poi.x)) return { x: poi.x, z: poi.z };
      }
      if (Array.isArray(world.pois)) {
        const norm = String(target).replace(/^poi_/, '');
        for (const p of world.pois) {
          if (String(p?.id).replace(/^poi_/, '') === norm) return { x: p.x, z: p.z };
        }
      }
      // NPC 目标：从可交互物取位置
      const interactables = world.interactables;
      if (Array.isArray(interactables)) {
        const want = String(target).replace(/^npc_/, '');
        for (const it of interactables) {
          if (String(it?.id).replace(/^npc_/, '') === want) {
            const pos = it.position;
            if (pos && Number.isFinite(pos.x)) return { x: pos.x, z: pos.z };
          }
        }
      }
    }
    return null;
  }

  _signature(q) {
    if (!q) return 'none';
    const objs = (q.objectives || []).map((o) => `${o.def.id}:${o.progress}:${o.done ? 1 : 0}`).join('|');
    return `${q.def.id}#${q.stageIndex}#${q.completed ? 'c' : 'a'}#${objs}`;
  }
}
