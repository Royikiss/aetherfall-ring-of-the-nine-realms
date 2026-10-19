/**
 * systems/MapSystem.js — 世界地图、战争迷雾与小地图数据源。
 *
 * 职责：
 *  - 战争迷雾：8m 网格（300 × 300），玩家 90m 半径渐进揭示；每移动 4m 才更新一次
 *  - 大地图底图：init 时一次性把地形高度着色烘焙到离屏 canvas（自适应 512 / 384）
 *  - POI 标记：从 world.pois 同步；靠近时发现并 emit('poi:discovered')
 *  - 提供 renderMinimap / renderWorldMap 两个纯绘制入口（UI 层只负责 DOM 与交互）
 *  - 把 Minimap / Compass 挂到 HUD 插槽，并注册「九界舆图」面板
 *
 * 对外 API（契约见 docs/ARCH.md §6.3）：
 *   reveal(x,z,radius) / isRevealed(x,z) / exploredRatio()
 *   markers / addMarker / removeMarker / discoverPoi / playerAngle()
 *   renderMinimap(ctx,size,{rotation,viewRadius})
 *   renderWorldMap(ctx,size,{panX,panZ,zoom,hoverId,selectedId})
 *   worldToScreen(size,x,z,view) / screenToWorld(size,sx,sy,view) / clampPan(pan,zoom)
 *   setQuestTargets(list) / toJSON() / fromJSON(data) / dispose()
 *
 * 坐标约定：世界 x → 画布 x，世界 z → 画布 y（北 = -z 在画布上方）。
 * 依赖：data/world.js（WORLD / REGIONS / ROADS）、UI 面板与小地图组件、EventBus。
 */
import { WORLD, REGIONS, ROADS } from '../data/world.js';
import { Minimap, Compass, mountToSlot } from '../ui/Minimap.js';
import { MapPanel } from '../ui/MapPanel.js';

// ---------------------------------------------------------------- 常量
const WORLD_SIZE = WORLD.size;            // 2400
const HALF = WORLD.half;                  // 1200
const CELL = 8;                           // 迷雾单元（米）
const GRID = Math.round(WORLD_SIZE / CELL); // 300
const REVEAL_RADIUS = 90;                 // 揭示半径（米）
const REVEAL_INNER = 0.55;                // 内圈全亮比例
const REVEAL_STEP = 4;                    // 每移动多少米更新一次迷雾
const EXPLORED_THRESHOLD = 64;            // 计入探索率的迷雾阈值
const FOG_R = 5, FOG_G = 7, FOG_B = 12;   // 未探索处的墨色
const FOG_ALPHA = 218;                    // 未探索处的最大不透明度（保留一丝地形剪影，避免整张图死黑）
const DISCOVER_PAD = 22;                  // 发现半径 = poi.radius + 该值

/** 标记图标与配色：用卢恩符文区分类型，颜色对应九界语义 */
const MARKER_STYLE = {
  shrine: { glyph: 'ᛊ', color: '#8fd8ef', name: '圣火' },
  hall: { glyph: 'ᚺ', color: '#f4e0a3', name: '殿堂' },
  village: { glyph: 'ᛃ', color: '#9fb27a', name: '村落' },
  ruin: { glyph: 'ᚱ', color: '#b9b2a2', name: '遗迹' },
  gate: { glyph: 'ᚦ', color: '#c9a45c', name: '界门' },
  tree: { glyph: 'ᛉ', color: '#e8c76a', name: '神木' },
  boss: { glyph: 'ᚾ', color: '#d4574a', name: '凶地' },
  default: { glyph: 'ᛟ', color: '#c9a45c', name: '地标' },
};

const DISPLAY_FONT = "'Cinzel', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Songti SC', serif";
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 小工具
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** #rrggbb → rgba(...) 字符串 */
function rgba(hex, alpha) {
  let h = String(hex || '#c9a45c').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 确定性哈希：用于底图颗粒感（不使用 Math.random，保证每次生成一致） */
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 把 id 归一化：去掉 poi_ 前缀、统一小写（兼容 Landmarks 两种命名习惯） */
function normId(id) {
  return String(id ?? '').toLowerCase().replace(/^poi_/, '');
}

export class MapSystem {
  static id = 'map';

  constructor(game) {
    this.game = game;
    this.bus = game?.events || null;

    /** 迷雾网格：0 = 未探索，255 = 完全揭示 */
    this.fog = new Uint8Array(GRID * GRID);
    this.size = GRID;
    this._exploredCount = 0;

    /** @type {Array<{id:string,x:number,z:number,type:string,label:string,discovered:boolean,radius:number,lit:boolean}>} */
    this.markers = [];
    this._byId = new Map();
    this.markerStyle = MARKER_STYLE;

    /** 当前追踪任务的目标点（世界坐标），由 QuestSystem 推送 */
    this.questTargets = [];

    this._lastRevealX = NaN;
    this._lastRevealZ = NaN;
    this._uptime = 0;
    this._poiTimer = 0;

    this._baseCanvas = null;
    this._baseSize = 0;
    this._fogCanvas = null;
    this._fogCtx = null;
    this._fogImage = null;
    this._fogTouched = false;

    this.minimap = null;
    this.compass = null;
    this.panel = null;

    this._offs = [];
    this._disposed = false;
  }

  // ================================================================ 生命周期
  init() {
    const bus = this.bus;
    if (bus) {
      this._offs.push(bus.on('player:spawn', (p) => this._onSpawn(p)));
      this._offs.push(bus.on('player:moved', (p) => this._onMoved(p)));
      this._offs.push(bus.on('poi:discovered', (p) => this._onPoiDiscovered(p)));
      this._offs.push(bus.on('shrine:lit', (p) => this._onShrineLit(p)));
    }

    this._initFogCanvas();
    this._syncPois();
    this._buildBasemap();

    // 出生点先揭示一次，避免首帧全黑
    const p = this._playerPos();
    this.reveal(p.x, p.z, REVEAL_RADIUS);
    this._checkDiscovery(p.x, p.z);

    this._initUi();
  }

  update(dt) {
    if (this._disposed) return;
    const d = Number.isFinite(dt) ? dt : 0;
    this._uptime += d;

    // 兜底：即使 player:moved 事件缺失，也按位移推进迷雾（每 4m 一次）
    const p = this._playerPos();
    const dx = p.x - this._lastRevealX;
    const dz = p.z - this._lastRevealZ;
    if (!(dx * dx + dz * dz < REVEAL_STEP * REVEAL_STEP)) {
      this.reveal(p.x, p.z, REVEAL_RADIUS);
      this._checkDiscovery(p.x, p.z);
    }

    this.minimap?.update(d);
    this.compass?.update(d);

    // 启动后 15 秒内持续同步 POI（Landmarks 可能晚于系统初始化完成注册）
    this._poiTimer += d;
    if (this._poiTimer > 0.5) {
      this._poiTimer = 0;
      if (this._uptime < 15) this._syncPois();
    }
  }

  dispose() {
    for (const off of this._offs) {
      try { off(); } catch (e) { /* 忽略：订阅已被清理 */ }
    }
    this._offs.length = 0;
    this.minimap?.dispose?.();
    this.compass?.dispose?.();
    this.minimap = null;
    this.compass = null;
    this.panel = null;
    this._disposed = true;
  }

  // ================================================================ UI 挂载
  _initUi() {
    this.minimap = new Minimap(this.game, this);
    this.compass = new Compass(this.game, this);
    const ui = this.game?.ui;
    // HUD 插槽由 HUD.init() 注册；挂载成功后组件测量真实容器尺寸再绘制
    mountToSlot(ui, 'minimap', this.minimap.el, () => this.minimap.onMounted());
    mountToSlot(ui, 'compass', this.compass.el, () => this.compass.onMounted());

    // 大地图面板：id 'map'，热键 M（Tab 由 UIManager 用作关闭，不重复绑定）
    try {
      if (ui?.registerPanel) {
        this.panel = new MapPanel(this.game, this);
        ui.registerPanel(this.panel.definition());
      }
    } catch (err) {
      this.panel = null;
    }
  }

  // ================================================================ 迷雾
  /**
   * 揭示圆形区域。内圈 55% 全亮，外圈用 smoothstep 渐隐。
   * @param {number} x @param {number} z @param {number} [radius]
   */
  reveal(x, z, radius = REVEAL_RADIUS) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const rOut = Math.max(CELL, radius || REVEAL_RADIUS);
    const rIn = rOut * REVEAL_INNER;
    const g = this.size;
    const ix0 = this._cell(x - rOut);
    const ix1 = this._cell(x + rOut);
    const iz0 = this._cell(z - rOut);
    const iz1 = this._cell(z + rOut);

    for (let iz = iz0; iz <= iz1; iz++) {
      const cz = -HALF + (iz + 0.5) * CELL;
      const dz = cz - z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = -HALF + (ix + 0.5) * CELL;
        const dx = cx - x;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > rOut) continue;
        let v;
        if (d <= rIn) {
          v = 255;
        } else {
          const u = 1 - (d - rIn) / (rOut - rIn);
          v = Math.round(255 * u * u * (3 - 2 * u));
        }
        const i = iz * g + ix;
        const old = this.fog[i];
        if (v <= old) continue;
        if (old < EXPLORED_THRESHOLD && v >= EXPLORED_THRESHOLD) this._exploredCount++;
        this.fog[i] = v;
        this._paintFogCell(i);
      }
    }
    if (this._fogTouched) this._flushFog();
    this._lastRevealX = x;
    this._lastRevealZ = z;
  }

  /** @returns {boolean} 该点是否已揭示 */
  isRevealed(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
    return this.fog[this._cell(z) * this.size + this._cell(x)] > 0;
  }

  /** @returns {number} 0..1 已探索比例 */
  exploredRatio() {
    return this._exploredCount / (this.size * this.size);
  }

  _cell(v) {
    return clamp(Math.floor((v + HALF) / CELL), 0, this.size - 1);
  }

  _initFogCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(this.size, this.size);
    this._fogCanvas = canvas;
    this._fogCtx = ctx;
    this._fogImage = img;
    for (let i = 0; i < this.size * this.size; i++) this._paintFogCell(i);
    ctx.putImageData(img, 0, 0);
    this._fogTouched = false;
  }

  /** 把单个格子的迷雾值写入 ImageData（只改像素，不提交） */
  _paintFogCell(i) {
    const d = this._fogImage?.data;
    if (!d) return;
    const v = this.fog[i];
    const t = 1 - v / 255;
    // alpha 用 1.35 次方压暗边缘，形成柔和的前沿
    const grain = (hash2(i % this.size, (i / this.size) | 0) - 0.5) * 10;
    const a = clamp(FOG_ALPHA * Math.pow(t, 1.35) + (v > 0 && v < 250 ? grain : 0), 0, FOG_ALPHA);
    const o = i * 4;
    d[o] = FOG_R;
    d[o + 1] = FOG_G;
    d[o + 2] = FOG_B;
    d[o + 3] = a | 0;
    this._fogTouched = true;
  }

  _flushFog() {
    if (!this._fogCtx) return;
    this._fogCtx.putImageData(this._fogImage, 0, 0);
    this._fogTouched = false;
  }

  // ================================================================ 底图
  /**
   * 生成地形底图（一次性）。
   * 逐像素用 world.sampleHeight 着色：水 / 沙 / 草 / 岩 / 雪 + 区域色调 + 山体阴影，
   * 再叠加 ROADS 折线与极淡的坐标网格。
   * 512² 若预估超过 320ms，则降到 384²（低端机保护）。
   */
  _buildBasemap() {
    const t0 = now();
    const size = this._pickBaseSize();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) { this._baseCanvas = null; return; }

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const step = WORLD_SIZE / size;
    const water = WORLD.waterLevel;

    // 1) 高度场
    const heights = new Float32Array(size * size);
    for (let py = 0; py < size; py++) {
      const z = -HALF + (py + 0.5) * step;
      const row = py * size;
      for (let px = 0; px < size; px++) {
        heights[row + px] = this._sampleHeight(-HALF + (px + 0.5) * step, z);
      }
    }

    // 2) 区域色调（预先转成 rgb）
    const tints = REGIONS.map((r) => {
      const h = String(r.color || '#c9a45c').replace('#', '');
      const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h, 16) || 0;
      return { cx: r.cx, cz: r.cz, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    });

    // 3) 逐像素着色
    for (let py = 0; py < size; py++) {
      const z = -HALF + (py + 0.5) * step;
      const row = py * size;
      for (let px = 0; px < size; px++) {
        const i = row + px;
        const h = heights[i];
        const hL = heights[row + (px > 0 ? px - 1 : px)];
        const hR = heights[row + (px < size - 1 ? px + 1 : px)];
        const hU = heights[(py > 0 ? py - 1 : py) * size + px];
        const hD = heights[(py < size - 1 ? py + 1 : py) * size + px];
        const gx = (hR - hL) / (2 * step);
        const gz = (hD - hU) / (2 * step);
        const slope = Math.sqrt(gx * gx + gz * gz);

        let r, g, b;
        if (h < water - 3) {
          // 深水
          const t = clamp((water - h) / 26, 0, 1);
          r = 16 - t * 6; g = 38 - t * 10; b = 48 - t * 8;
        } else if (h < water + 0.4) {
          // 浅水 / 水线
          r = 30; g = 62; b = 72;
        } else if (h < water + 3.4) {
          // 岸滩
          r = 118; g = 106; b = 78;
        } else if (h > 52) {
          // 雪线之上
          const t = clamp((h - 52) / 24, 0, 1);
          r = 198 - t * 12; g = 206 - t * 10; b = 216 - t * 6;
        } else if (h > 32 || slope > 0.9) {
          // 高地裸岩 / 陡坡
          const t = clamp(slope * 0.7, 0, 1);
          r = 84 - t * 20; g = 82 - t * 18; b = 76 - t * 14;
        } else {
          // 苔原草地
          const t = clamp((h - water) / 40, 0, 1);
          r = 62 + t * 22; g = 78 + t * 16; b = 50 + t * 14;
        }

        // 山体阴影（光来自西北）
        const shade = clamp(1 - (gx + gz) * 0.34, 0.66, 1.32);
        r *= shade; g *= shade; b *= shade;

        // 区域色调
        const x = -HALF + (px + 0.5) * step;
        for (let k = 0; k < tints.length; k++) {
          const t = tints[k];
          const dx = x - t.cx;
          const dz = z - t.cz;
          const dq = dx * dx + dz * dz;
          if (dq > 620 * 620) continue;
          const w = Math.pow(1 - Math.sqrt(dq) / 620, 1.7) * 0.26;
          r += (t.r - r) * w;
          g += (t.g - g) * w;
          b += (t.b - b) * w;
        }

        // 确定性颗粒，避免大面积纯色
        const grain = (hash2(px, py) - 0.5) * 9;
        const o = i * 4;
        data[o] = clamp(r + grain, 0, 255) | 0;
        data[o + 1] = clamp(g + grain, 0, 255) | 0;
        data[o + 2] = clamp(b + grain, 0, 255) | 0;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 4) 道路：先描深色底衬再描金线，保证在水面与雪地上都能看清
    const toPx = (v) => ((v + HALF) / WORLD_SIZE) * size;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const road of ROADS) {
      if (!road?.points?.length) continue;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let i = 0; i < road.points.length; i++) {
          const [wx, wz] = road.points[i];
          const sx = toPx(wx);
          const sy = toPx(wz);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        if (pass === 0) {
          ctx.strokeStyle = 'rgba(8, 10, 14, 0.62)';
          ctx.lineWidth = Math.max(1.4, size / 384);
        } else {
          ctx.strokeStyle = 'rgba(201, 164, 92, 0.42)';
          ctx.lineWidth = Math.max(0.7, size / 780);
        }
        ctx.stroke();
      }
    }

    // 5) 极淡的坐标网格（每 400m 一条），强化"舆图"气质
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.07)';
    ctx.lineWidth = 1;
    for (let w = -HALF; w <= HALF; w += 400) {
      const p = toPx(w);
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }

    // 6) 边缘暗角，让地图与黑曜石面板自然衔接
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.26, size / 2, size / 2, size * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(3, 5, 8, 0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    this._baseCanvas = canvas;
    this._baseSize = size;
    this._baseBuildMs = now() - t0;
  }

  /**
   * 采样一小块估算耗时，决定底图分辨率：
   * 目标是让一次性烘焙 ≤ 300ms，低端机自动降到 448 / 384。
   */
  _pickBaseSize() {
    const hasSampler = typeof this.game?.world?.sampleHeight === 'function';
    if (!hasSampler) return 256;
    const N = 28;
    const t0 = now();
    let acc = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) acc += this._sampleHeight(-800 + i * 57, -800 + j * 57);
    }
    const per = (now() - t0) / (N * N);
    if (!Number.isFinite(per) || per <= 0) return 512;
    for (const candidate of [512, 448, 384]) {
      if (per * candidate * candidate <= 300) return candidate;
    }
    return 384;
  }

  _sampleHeight(x, z) {
    const fn = this.game?.world?.sampleHeight;
    if (typeof fn === 'function') {
      const h = fn.call(this.game.world, x, z);
      return Number.isFinite(h) ? h : 0;
    }
    return 0;
  }

  // ================================================================ POI 标记
  addMarker(m) {
    if (!m || !m.id) return null;
    const marker = {
      id: m.id,
      x: Number(m.x) || 0,
      z: Number(m.z) || 0,
      type: m.type || 'default',
      label: m.label || m.name || m.id,
      discovered: !!m.discovered,
      radius: Number(m.radius) || 30,
      lit: !!m.lit,
    };
    const old = this._byId.get(marker.id);
    if (old) {
      // 合并时保留已发现 / 已点亮状态，避免同步 POI 时把进度冲掉
      marker.discovered = marker.discovered || old.discovered;
      marker.lit = marker.lit || old.lit;
      Object.assign(old, marker);
      return old;
    }
    this.markers.push(marker);
    this._byId.set(marker.id, marker);
    return marker;
  }

  removeMarker(id) {
    const m = this._byId.get(id);
    if (!m) return false;
    this._byId.delete(id);
    const i = this.markers.indexOf(m);
    if (i >= 0) this.markers.splice(i, 1);
    return true;
  }

  /**
   * 标记一个 POI 为已发现，并广播 poi:discovered（每条只发一次）。
   * @returns {boolean} 本次是否发生变化
   */
  discoverPoi(poi) {
    const id = poi?.id;
    if (!id) return false;
    let m = this._byId.get(id);
    if (!m) m = this.addMarker(poi);
    if (!m || m.discovered) return false;
    m.discovered = true;
    if (Number.isFinite(poi.x)) m.x = poi.x;
    if (Number.isFinite(poi.z)) m.z = poi.z;
    if (poi.label) m.label = poi.label;

    const worldPoi = this._worldPoi(id);
    if (worldPoi) worldPoi.discovered = true;

    this.bus?.emit('poi:discovered', { id: m.id, name: m.label, type: m.type, x: m.x, z: m.z });
    return true;
  }

  /** 从 world.pois 同步标记（幂等，可反复调用） */
  _syncPois() {
    const pois = this.game?.world?.pois;
    if (!Array.isArray(pois)) return;
    for (const poi of pois) {
      if (!poi?.id) continue;
      const existing = this._byId.get(poi.id);
      if (!existing) {
        this.addMarker(poi);
      } else {
        existing.x = Number.isFinite(poi.x) ? poi.x : existing.x;
        existing.z = Number.isFinite(poi.z) ? poi.z : existing.z;
        existing.type = poi.type || existing.type;
        existing.label = poi.label || poi.name || existing.label;
        existing.radius = Number(poi.radius) || existing.radius;
        if (poi.discovered) existing.discovered = true;
      }
    }
  }

  _worldPoi(id) {
    const w = this.game?.world;
    if (!w) return null;
    if (typeof w.getPoi === 'function') {
      const poi = w.getPoi(id);
      if (poi) return poi;
      // 兼容 poi_ 前缀差异
      const alt = typeof id === 'string' && id.startsWith('poi_') ? id.slice(4) : `poi_${id}`;
      const poi2 = w.getPoi(alt);
      if (poi2) return poi2;
    }
    const list = Array.isArray(w.pois) ? w.pois : null;
    if (list) {
      for (const p of list) {
        if (p?.id === id || normId(p?.id) === normId(id)) return p;
      }
    }
    return null;
  }

  /** 半径内自动发现 POI（只在地图更新时调用，成本 = 标记数量） */
  _checkDiscovery(x, z) {
    for (const m of this.markers) {
      if (m.discovered) continue;
      const poi = this._worldPoi(m.id);
      const r = (Number(poi?.radius) || m.radius || 30) + DISCOVER_PAD;
      const dx = m.x - x;
      const dz = m.z - z;
      if (dx * dx + dz * dz <= r * r) this.discoverPoi(m);
    }
  }

  // ================================================================ 事件
  _onSpawn(payload) {
    const pos = payload?.position || payload;
    const x = Number.isFinite(pos?.x) ? pos.x : this._playerPos().x;
    const z = Number.isFinite(pos?.z) ? pos.z : this._playerPos().z;
    this._lastRevealX = NaN;
    this._lastRevealZ = NaN;
    this.reveal(x, z, REVEAL_RADIUS);
    this._checkDiscovery(x, z);
  }

  _onMoved(payload) {
    const p = this._playerPos();
    const x = Number.isFinite(payload?.x) ? payload.x : p.x;
    const z = Number.isFinite(payload?.z) ? payload.z : p.z;
    const dx = x - this._lastRevealX;
    const dz = z - this._lastRevealZ;
    if (dx * dx + dz * dz < REVEAL_STEP * REVEAL_STEP) return;
    this.reveal(x, z, REVEAL_RADIUS);
    this._checkDiscovery(x, z);
  }

  _onPoiDiscovered(payload) {
    const id = payload?.id;
    if (!id) return;
    let m = this._byId.get(id);
    if (!m) {
      m = this.addMarker({ id, x: payload.x, z: payload.z, type: payload.type, label: payload.name, discovered: true });
    }
    if (m) {
      m.discovered = true;
      if (payload.name) m.label = payload.name;
      if (payload.type) m.type = payload.type;
      if (Number.isFinite(payload.x)) m.x = payload.x;
      if (Number.isFinite(payload.z)) m.z = payload.z;
    }
  }

  _onShrineLit(payload) {
    const id = payload?.id;
    if (!id) return;
    const m = this._byId.get(id) || this.markers.find((k) => normId(k.id) === normId(id));
    if (m) m.lit = true;
  }

  // ================================================================ 玩家
  _playerPos() {
    const pos = this.game?.player?.position;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) return { x: pos.x, z: pos.z };
    return { x: WORLD.spawn.x, z: WORLD.spawn.z };
  }

  /**
   * 小地图指针角度（画布顺时针弧度，0 = 指向正上方 / 北）。
   * 约定：player.heading 为绕 Y 轴朝向，heading = 0 面向 +Z（南），heading = π 面向 -Z（北）。
   */
  playerAngle() {
    const p = this.game?.player;
    let h = p?.heading;
    if (!Number.isFinite(h)) h = p?.object?.rotation?.y;
    if (!Number.isFinite(h)) h = WORLD.spawn.heading || 0;
    // 画布角度 = π - heading，自然把「面向北」映射为向上
    let a = Math.PI - h;
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  // ================================================================ 视图换算
  _viewRect(panX, panZ, zoom) {
    const z = clamp(Number.isFinite(zoom) ? zoom : 1, 0.35, 6);
    const halfView = HALF / z; // 半幅（世界单位）
    return { panX, panZ, zoom: z, halfView, x0: panX - halfView, z0: panZ - halfView };
  }

  /** 世界 → 画布像素（size 为绘制边长，正方形） */
  worldToScreen(size, x, z, opts = {}) {
    const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
    const panZ = Number.isFinite(opts.panZ) ? opts.panZ : 0;
    const v = this._viewRect(panX, panZ, opts.zoom);
    const s = size / (2 * v.halfView);
    return { x: size / 2 + (x - v.panX) * s, y: size / 2 + (z - v.panZ) * s, scale: s };
  }

  /** 画布像素 → 世界坐标 */
  screenToWorld(size, sx, sy, opts = {}) {
    const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
    const panZ = Number.isFinite(opts.panZ) ? opts.panZ : 0;
    const v = this._viewRect(panX, panZ, opts.zoom);
    const s = size / (2 * v.halfView);
    return { x: v.panX + (sx - size / 2) / s, z: v.panZ + (sy - size / 2) / s, scale: s };
  }

  /** 约束平移：视野不越出世界（允许少量留白） */
  clampPan(panX, panZ, zoom) {
    const v = this._viewRect(panX, panZ, zoom);
    const max = Math.max(0, HALF - v.halfView * 0.92);
    return { panX: clamp(panX, -max, max), panZ: clamp(panZ, -max, max) };
  }

  /** 由 QuestSystem 推送当前追踪目标，用于地图上的金色菱形标记 */
  setQuestTargets(list) {
    this.questTargets = Array.isArray(list) ? list.filter((t) => Number.isFinite(t?.x) && Number.isFinite(t?.z)).slice(0, 12) : [];
  }

  // ================================================================ 小地图绘制
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} size 逻辑边长（正方形）
   * @param {{rotation?:number, viewRadius?:number}} [opts]
   */
  renderMinimap(ctx, size, opts = {}) {
    if (!ctx || !size) return;
    const rotation = Number.isFinite(opts.rotation) ? opts.rotation : 0;
    const viewRadius = Number.isFinite(opts.viewRadius) ? opts.viewRadius : 150;
    const r = size / 2;
    const p = this._playerPos();
    const scale = r / viewRadius;

    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(rotation);
    ctx.translate(-r, -r);

    // 底图（按玩家居中裁切）
    if (this._baseCanvas && this._baseSize) {
      const sx = ((p.x - viewRadius + HALF) / WORLD_SIZE) * this._baseSize;
      const sy = ((p.z - viewRadius + HALF) / WORLD_SIZE) * this._baseSize;
      const sw = ((viewRadius * 2) / WORLD_SIZE) * this._baseSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this._baseCanvas, sx, sy, sw, sw, 0, 0, size, size);
    }

    // 迷雾
    if (this._fogCanvas) {
      const sx = ((p.x - viewRadius + HALF) / WORLD_SIZE) * this.size;
      const sy = ((p.z - viewRadius + HALF) / WORLD_SIZE) * this.size;
      const sw = ((viewRadius * 2) / WORLD_SIZE) * this.size;
      ctx.drawImage(this._fogCanvas, sx, sy, sw, sw, 0, 0, size, size);
    }

    // 已发现标记
    const glyphSize = Math.max(9, Math.round(size * 0.072));
    for (const m of this.markers) {
      if (!m.discovered) continue;
      let dx = (m.x - p.x) * scale;
      let dz = (m.z - p.z) * scale;
      const d = Math.sqrt(dx * dx + dz * dz);
      const edge = r - glyphSize * 0.9;
      let alpha = 1;
      if (d > edge) {
        if (d > edge * 1.9) continue; // 太远不显示
        alpha = 0.34;
        dx = (dx / d) * edge;
        dz = (dz / d) * edge;
      }
      const st = MARKER_STYLE[m.type] || MARKER_STYLE.default;
      const color = m.lit ? '#f4e0a3' : st.color;
      const x = r + dx;
      const y = r + dz;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, glyphSize * 0.72, 0, TAU);
      ctx.fillStyle = 'rgba(5, 8, 12, 0.82)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(color, 0.72);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `${glyphSize}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.glyph, x, y + 0.5);
      ctx.globalAlpha = 1;
    }

    // 追踪任务目标
    for (const t of this.questTargets) {
      const dx = (t.x - p.x) * scale;
      const dz = (t.z - p.z) * scale;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > r - 6) continue;
      this._drawQuestDiamond(ctx, r + dx, r + dz, 6, 1);
    }

    ctx.restore(); // 取消旋转

    // 中心玩家箭头（金色）
    this._drawPlayerArrow(ctx, r, r, this.playerAngle() + rotation, Math.max(7, size * 0.052));

    ctx.restore(); // 取消裁剪

    // 内环刻度：每 30° 一格，强化罗盘感
    ctx.save();
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + rotation;
      const r0 = r - 3;
      const r1 = r - (i % 3 === 0 ? 9 : 6);
      ctx.beginPath();
      ctx.moveTo(r + Math.sin(a) * r0, r - Math.cos(a) * r0);
      ctx.lineTo(r + Math.sin(a) * r1, r - Math.cos(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPlayerArrow(ctx, cx, cy, angle, s) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.68, s * 0.74);
    ctx.lineTo(0, s * 0.38);
    ctx.lineTo(-s * 0.68, s * 0.74);
    ctx.closePath();
    ctx.fillStyle = '#f4e0a3';
    ctx.shadowColor = 'rgba(244, 224, 163, 0.9)';
    ctx.shadowBlur = s * 0.8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, s * 0.16);
    ctx.strokeStyle = 'rgba(30, 22, 8, 0.85)';
    ctx.stroke();
    ctx.restore();
  }

  _drawQuestDiamond(ctx, x, y, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#f4e0a3';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, TAU);
    ctx.fillStyle = '#f4e0a3';
    ctx.fill();
    ctx.restore();
  }

  // ================================================================ 大地图绘制
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} size 逻辑边长（正方形）
   * @param {{panX?:number, panZ?:number, zoom?:number, hoverId?:string, selectedId?:string}} [opts]
   */
  renderWorldMap(ctx, size, opts = {}) {
    if (!ctx || !size) return;
    const panX = Number.isFinite(opts.panX) ? opts.panX : 0;
    const panZ = Number.isFinite(opts.panZ) ? opts.panZ : 0;
    const pan = this.clampPan(panX, panZ, opts.zoom);
    const v = this._viewRect(pan.panX, pan.panZ, opts.zoom);
    const s = size / (2 * v.halfView); // 像素 / 米
    const toX = (x) => size / 2 + (x - v.panX) * s;
    const toY = (z) => size / 2 + (z - v.panZ) * s;

    ctx.save();
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, size, size);

    // 底图
    if (this._baseCanvas && this._baseSize) {
      const srcX = ((v.x0 + HALF) / WORLD_SIZE) * this._baseSize;
      const srcY = ((v.z0 + HALF) / WORLD_SIZE) * this._baseSize;
      const srcW = ((v.halfView * 2) / WORLD_SIZE) * this._baseSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this._baseCanvas, srcX, srcY, srcW, srcW, 0, 0, size, size);
    }

    // 战争迷雾
    if (this._fogCanvas) {
      const srcX = ((v.x0 + HALF) / WORLD_SIZE) * this.size;
      const srcY = ((v.z0 + HALF) / WORLD_SIZE) * this.size;
      const srcW = ((v.halfView * 2) / WORLD_SIZE) * this.size;
      ctx.drawImage(this._fogCanvas, srcX, srcY, srcW, srcW, 0, 0, size, size);
    }

    // 世界边界
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.28)';
    ctx.strokeRect(toX(-HALF), toY(-HALF), HALF * 2 * s, HALF * 2 * s);

    // 200m 网格
    const gridStep = 200;
    if (gridStep * s > 16) {
      ctx.strokeStyle = 'rgba(201, 164, 92, 0.055)';
      for (let g = -HALF; g <= HALF; g += gridStep) {
        ctx.beginPath();
        ctx.moveTo(toX(g), toY(-HALF));
        ctx.lineTo(toX(g), toY(HALF));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(toX(-HALF), toY(g));
        ctx.lineTo(toX(HALF), toY(g));
        ctx.stroke();
      }
    }

    // 区域名（绘制时叠加，保证任意缩放都可读）
    this._drawRegionLabels(ctx, size, toX, toY, v.zoom);

    // 任务目标
    for (const t of this.questTargets) {
      const x = toX(t.x);
      const y = toY(t.z);
      if (x < -30 || y < -30 || x > size + 30 || y > size + 30) continue;
      const r = clamp(7 + v.zoom * 1.4, 7, 13);
      this._drawQuestDiamond(ctx, x, y, r, 0.95);
      ctx.font = `600 ${Math.round(clamp(11 + v.zoom, 11, 15))}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(244, 224, 163, 0.92)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(t.label || '目标', x, y + r + 11);
      ctx.shadowBlur = 0;
    }

    // POI 标记
    const baseR = clamp(6 + v.zoom * 1.0, 6, 11);
    for (const m of this.markers) {
      if (!m.discovered) continue;
      const x = toX(m.x);
      const y = toY(m.z);
      if (x < -24 || y < -24 || x > size + 24 || y > size + 24) continue;
      const st = MARKER_STYLE[m.type] || MARKER_STYLE.default;
      const color = m.lit ? '#f4e0a3' : st.color;
      const active = opts.hoverId === m.id || opts.selectedId === m.id;
      const r = active ? baseR * 1.35 : baseR;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = 'rgba(5, 8, 12, 0.82)';
      ctx.fill();
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeStyle = rgba(color, active ? 1 : 0.72);
      ctx.stroke();
      if (m.lit) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, TAU);
        ctx.strokeStyle = 'rgba(244, 224, 163, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.font = `${Math.round(r * 1.15)}px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.glyph, x, y + 0.5);

      if (active || v.zoom >= 2.2) {
        const fs = Math.round(clamp(10 + v.zoom * 0.8, 10, 15));
        ctx.font = `600 ${fs}px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = active ? '#f4e0a3' : 'rgba(234, 227, 212, 0.82)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
        ctx.shadowBlur = 7;
        ctx.fillText(m.label, x, y + r + 5);
        ctx.shadowBlur = 0;
      }
    }

    // 玩家位置
    const p = this._playerPos();
    const px = toX(p.x);
    const py = toY(p.z);
    if (px > -20 && py > -20 && px < size + 20 && py < size + 20) {
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, TAU);
      ctx.fillStyle = 'rgba(244, 224, 163, 0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(244, 224, 163, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this._drawPlayerArrow(ctx, px, py, this.playerAngle(), clamp(8 + v.zoom, 8, 12));
    }

    // 罗盘玫瑰与比例尺
    this._drawRose(ctx, size - 42, 42, 22);
    this._drawScaleBar(ctx, size, s);

    ctx.restore();
  }

  _drawRegionLabels(ctx, size, toX, toY, zoom) {
    const fs = Math.round(clamp(11 + zoom * 1.6, 11, 17));
    const latinFs = Math.max(8, Math.round(fs * 0.6));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const region of REGIONS) {
      const x = toX(region.cx);
      const y = toY(region.cz);
      if (x < -80 || y < -60 || x > size + 80 || y > size + 60) continue;
      const revealed = this.isRevealed(region.cx, region.cz);
      const a = revealed ? 0.92 : 0.42;
      // 菱形符文
      ctx.save();
      ctx.translate(x, y - fs * 1.15);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = rgba(region.color, a * 0.8);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      // 中文名
      ctx.font = `600 ${fs}px ${DISPLAY_FONT}`;
      ctx.fillStyle = rgba(region.color, a);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 8;
      ctx.fillText(region.name, x, y);
      // 拉丁名
      ctx.font = `400 ${latinFs}px ${DISPLAY_FONT}`;
      ctx.fillStyle = rgba('#c9a45c', a * 0.6);
      ctx.fillText(region.latin, x, y + fs * 0.95);
      ctx.shadowBlur = 0;
    }
  }

  _drawRose(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, TAU);
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.16)';
    ctx.stroke();
    // 指北针
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.92);
    ctx.lineTo(r * 0.2, 0);
    ctx.lineTo(0, r * 0.24);
    ctx.lineTo(-r * 0.2, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(244, 224, 163, 0.86)';
    ctx.fill();
    ctx.font = `600 ${Math.round(r * 0.44)}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(244, 224, 163, 0.9)';
    ctx.fillText('N', 0, -r * 0.55);
    ctx.fillStyle = 'rgba(201, 164, 92, 0.55)';
    ctx.font = `400 ${Math.round(r * 0.3)}px ${DISPLAY_FONT}`;
    ctx.fillText('E', r * 0.55, 0);
    ctx.fillText('W', -r * 0.55, 0);
    ctx.fillText('S', 0, r * 0.55);
    ctx.restore();
  }

  _drawScaleBar(ctx, size, pxPerMeter) {
    const targetPx = size * 0.16;
    let meters = 100;
    for (const candidate of [50, 100, 200, 400, 800]) {
      if (candidate * pxPerMeter <= targetPx) meters = candidate;
    }
    const len = meters * pxPerMeter;
    const x = 18;
    const y = size - 20;
    ctx.save();
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.moveTo(x + len, y - 3);
    ctx.lineTo(x + len, y + 3);
    ctx.stroke();
    ctx.font = `400 10px ${DISPLAY_FONT}`;
    ctx.fillStyle = 'rgba(201, 164, 92, 0.7)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${meters} m`, x + 4, y - 6);
    ctx.restore();
  }

  // ================================================================ 存档
  toJSON() {
    return {
      v: 1,
      fog: this._encodeFog(),
      explored: this._exploredCount,
      markers: this.markers.filter((m) => m.discovered).map((m) => ({
        id: m.id, discovered: true, lit: !!m.lit,
      })),
    };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.fog === 'string' && data.fog) {
      const bits = this._decodeFog(data.fog);
      if (bits) {
        let count = 0;
        for (let i = 0; i < this.fog.length; i++) {
          const v = bits[i] ? 255 : 0;
          this.fog[i] = v;
          if (v >= EXPLORED_THRESHOLD) count++;
          this._paintFogCell(i);
        }
        this._exploredCount = count;
        this._flushFog();
      }
    } else if (Number.isFinite(data.explored)) {
      this._exploredCount = clamp(data.explored | 0, 0, this.fog.length);
    }

    if (Array.isArray(data.markers)) {
      for (const saved of data.markers) {
        if (!saved?.id) continue;
        let m = this._byId.get(saved.id);
        if (!m) {
          const poi = this._worldPoi(saved.id);
          m = this.addMarker(poi || { id: saved.id, discovered: true });
        }
        m.discovered = true;
        m.lit = !!saved.lit;
        const poi = this._worldPoi(saved.id);
        if (poi) poi.discovered = true;
      }
    }
  }

  /** 迷雾 → 位图 → base64（约 15KB，比逐格存档小两个数量级） */
  _encodeFog() {
    const total = this.fog.length;
    const bytes = new Uint8Array(Math.ceil(total / 8));
    for (let i = 0; i < total; i++) {
      if (this.fog[i] > 0) bytes[i >> 3] |= 1 << (i & 7);
    }
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  _decodeFog(b64) {
    try {
      const bin = atob(b64);
      const total = this.fog.length;
      const bits = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        const byte = bin.charCodeAt(i >> 3) || 0;
        bits[i] = (byte >> (i & 7)) & 1;
      }
      return bits;
    } catch (err) {
      return null;
    }
  }
}

export { MARKER_STYLE, normId };
