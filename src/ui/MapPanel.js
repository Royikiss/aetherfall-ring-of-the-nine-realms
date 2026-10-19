/**
 * ui/MapPanel.js — 「九界舆图」面板。
 *
 * 布局：左侧图例 / 探索度 · 中央大幅地图（切角画布）· 右侧当前使命与已发现之地。
 * 交互：滚轮缩放（围绕光标）、拖拽平移、悬停显示地名、点击标记选择并追踪相关任务。
 *
 * 性能：
 *  - 仅在打开 / 交互时按需重绘（rAF 合并），不做持续动画
 *  - 画布尺寸只在容器变化时重设，避免每次绘制重建后备缓冲
 *
 * 面板注册信息：id 'map'，title '九界舆图'，latin 'MAP OF THE NINE REALMS'，hotkey 'm'
 * （Tab 已由 UIManager 用作关闭，这里不重复绑定。）
 */
import { REGIONS } from '../data/world.js';

const DISPLAY_FONT = "'Cinzel', 'Noto Serif CJK SC', 'Source Han Serif SC', 'Songti SC', serif";

function normId(id) {
  return String(id ?? '').toLowerCase().replace(/^poi_/, '');
}

function fmtDist(meters) {
  if (!Number.isFinite(meters)) return '';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export class MapPanel {
  constructor(game, mapSystem) {
    this.game = game;
    this.map = mapSystem;
    this.ui = game?.ui;

    this.panX = 0;
    this.panZ = 0;
    this.zoom = 1;
    this.hoverId = null;
    this.selectedId = null;
    this._open = false;
    this._everOpened = false;

    // 画布与视图状态
    this.stageEl = null;
    this.canvas = null;
    this.ctx = null;
    this._cw = 0;
    this._ch = 0;
    this._mapSize = 0;
    this._ox = 0;
    this._oy = 0;

    this._raf = 0;
    this._dirty = false;
    this._dragging = false;
    this._dragMoved = false;
    this._drag = null;
    this._pointer = { x: 0, y: 0 };

    this._railSig = '';
    this._tipHtml = '';
    this._offs = [];
    this._ro = null;
  }

  // ================================================================ 注册
  definition() {
    return {
      id: 'map',
      title: '九界舆图',
      latin: 'MAP OF THE NINE REALMS',
      hotkey: 'm',
      build: (body) => this.build(body),
      refresh: () => this.refresh(),
      onOpen: () => this.onOpen(),
      onClose: () => this.onClose(),
    };
  }

  build(body) {
    body.innerHTML = `
      <div class="mq-map">
        <aside class="mq-map__rail mq-map__rail--left">
          <section class="mq-block">
            <div class="mq-block__head"><span class="mq-block__title">探 索</span><span class="mq-block__latin latin">EXPLORED</span></div>
            <div class="mq-explore">
              <div class="mq-explore__num"><b>0</b><span>%</span></div>
              <div class="stat-bar stat-bar--xp mq-explore__bar"><div class="stat-bar__fill" style="width:0%"></div></div>
              <div class="mq-explore__meta">已发现地标 <b>0</b> / <i>0</i></div>
            </div>
          </section>
          <section class="mq-block">
            <div class="mq-block__head"><span class="mq-block__title">图 例</span><span class="mq-block__latin latin">LEGEND</span></div>
            <ul class="mq-legend"></ul>
          </section>
          <section class="mq-block mq-block--grow">
            <div class="mq-block__head"><span class="mq-block__title">当前位置</span><span class="mq-block__latin latin">POSITION</span></div>
            <div class="mq-kv">
              <div class="kv-row"><span class="k">区域</span><span class="v" data-pos="region">—</span></div>
              <div class="kv-row"><span class="k">坐标</span><span class="v mono" data-pos="coord">—</span></div>
              <div class="kv-row"><span class="k">追踪</span><span class="v" data-pos="track">未追踪</span></div>
            </div>
          </section>
          <div class="mq-hint">滚轮缩放 · 拖拽平移<br />点击标记以追踪</div>
        </aside>

        <div class="mq-map__stage">
          <canvas class="mq-map__canvas" aria-label="九界舆图"></canvas>
          <div class="mq-map__tooltip" hidden></div>
          <div class="mq-map__coord latin" data-coord>0 · 0</div>
          <div class="mq-map__controls">
            <button class="btn btn--ghost btn--sm" data-act="center" title="回到英灵所在">定 位</button>
            <button class="btn btn--ghost btn--sm" data-act="zoom-out" title="缩小">－</button>
            <button class="btn btn--ghost btn--sm" data-act="zoom-in" title="放大">＋</button>
          </div>
        </div>

        <aside class="mq-map__rail mq-map__rail--right">
          <section class="mq-block">
            <div class="mq-block__head"><span class="mq-block__title">当前使命</span><span class="mq-block__latin latin">SAGA</span></div>
            <div class="mq-map-quest"></div>
          </section>
          <section class="mq-block mq-block--grow">
            <div class="mq-block__head"><span class="mq-block__title">已发现之地</span><span class="mq-block__latin latin">LANDMARKS</span></div>
            <div class="mq-markers scroll"></div>
          </section>
        </aside>
      </div>`;

    // 缓存节点
    const root = body;
    this.stageEl = root.querySelector('.mq-map__stage');
    this.canvas = root.querySelector('.mq-map__canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.tooltipEl = root.querySelector('.mq-map__tooltip');
    this.coordEl = root.querySelector('[data-coord]');
    this.exploreNum = root.querySelector('.mq-explore__num b');
    this.exploreBar = root.querySelector('.mq-explore__bar .stat-bar__fill');
    this.exploreMeta = root.querySelector('.mq-explore__meta');
    this.legendEl = root.querySelector('.mq-legend');
    this.questCardEl = root.querySelector('.mq-map-quest');
    this.markersEl = root.querySelector('.mq-markers');
    this._posRegion = root.querySelector('[data-pos="region"]');
    this._posCoord = root.querySelector('[data-pos="coord"]');
    this._posTrack = root.querySelector('[data-pos="track"]');

    this._buildLegend();
    this._bindStage();
    this._bindButtons();
    this._subscribe();
    this._syncRails(true);
    this._syncPosition();
  }

  // ================================================================ 生命周期
  onOpen() {
    this._open = true;
    // 首次打开显示九界全览；之后沿用上次的缩放与位置
    if (!this._everOpened) {
      this._everOpened = true;
      this.panX = 0;
      this.panZ = 0;
      this.zoom = 1;
      const pan = this.map.clampPan(this.panX, this.panZ, this.zoom);
      this.panX = pan.panX;
      this.panZ = pan.panZ;
    }
    this.refresh();
    this._observe();
    this._requestDraw();
  }

  onClose() {
    this._open = false;
    if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._dragging = false;
    this.hoverId = null;
    this._hideTooltip();
  }

  refresh() {
    if (!this.canvas) return;
    this._syncRails();
    this._syncPosition();
    this._resizeCanvas();
    this._requestDraw();
  }

  dispose() {
    for (const off of this._offs) {
      try { off(); } catch (e) { /* 已取消 */ }
    }
    this._offs.length = 0;
    this._ro?.disconnect?.();
    this._ro = null;
    this._open = false;
  }

  // ================================================================ DOM 构建
  _buildLegend() {
    if (!this.legendEl) return;
    const style = this.map?.markerStyle || {};
    const order = ['shrine', 'hall', 'village', 'ruin', 'gate', 'tree', 'boss'];
    const frag = document.createDocumentFragment();
    for (const key of order) {
      const st = style[key];
      if (!st) continue;
      const li = document.createElement('li');
      li.className = 'mq-legend__item';
      li.innerHTML = `<i class="mq-legend__glyph" style="color:${st.color};border-color:${st.color}66">${st.glyph}</i>`
        + `<span class="mq-legend__name">${st.name}</span>`;
      frag.appendChild(li);
    }
    this.legendEl.innerHTML = '';
    this.legendEl.appendChild(frag);
  }

  _bindButtons() {
    const stage = this.stageEl;
    if (!stage) return;
    stage.querySelector('[data-act="center"]')?.addEventListener('click', () => {
      this._centerOnPlayer(true);
    });
    stage.querySelector('[data-act="zoom-in"]')?.addEventListener('click', () => {
      this._zoomAt(this._cw / 2, this._ch / 2, 1.35);
    });
    stage.querySelector('[data-act="zoom-out"]')?.addEventListener('click', () => {
      this._zoomAt(this._cw / 2, this._ch / 2, 1 / 1.35);
    });
  }

  _bindStage() {
    const stage = this.stageEl;
    if (!stage) return;

    stage.addEventListener('wheel', (e) => {
      if (!this._open) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0016);
      this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });

    stage.addEventListener('pointerdown', (e) => {
      if (!this._open || e.button !== 0) return;
      // 控件区域（定位 / 缩放按钮）不参与拖拽
      if (e.target?.closest?.('.mq-map__controls')) return;
      const rect = stage.getBoundingClientRect();
      this._dragging = true;
      this._dragMoved = false;
      this._pointer.x = e.clientX - rect.left;
      this._pointer.y = e.clientY - rect.top;
      this._drag = {
        x: this._pointer.x,
        y: this._pointer.y,
        panX: this.panX,
        panZ: this.panZ,
      };
      stage.setPointerCapture?.(e.pointerId);
    });

    stage.addEventListener('pointermove', (e) => {
      if (!this._open) return;
      const rect = stage.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      this._pointer.x = px;
      this._pointer.y = py;

      if (this._dragging && this._drag) {
        const dx = px - this._drag.x;
        const dy = py - this._drag.y;
        if (!this._dragMoved && dx * dx + dy * dy > 16) this._dragMoved = true;
        if (this._dragMoved) {
          const scale = this._scale();
          const pan = this.map.clampPan(
            this._drag.panX - dx / scale,
            this._drag.panZ - dy / scale,
            this.zoom,
          );
          this.panX = pan.panX;
          this.panZ = pan.panZ;
          this._hideTooltip();
          this._requestDraw();
        }
        return;
      }
      this._updateHover(px, py);
    });

    const endDrag = (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      const stage2 = this.stageEl;
      stage2?.releasePointerCapture?.(e.pointerId);
      if (!this._dragMoved) this._clickAt(this._pointer.x, this._pointer.y);
      this._drag = null;
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', () => {
      this._hideTooltip();
      if (!this._dragging && this.hoverId) {
        this._setHover(null);
        this._requestDraw();
      }
    });
  }

  _subscribe() {
    const bus = this.game?.events;
    if (!bus || !bus.on) return;
    const onPoi = () => {
      this._syncRails(true);
      this._requestDraw();
    };
    this._offs.push(bus.on('poi:discovered', onPoi));
    this._offs.push(bus.on('shrine:lit', () => {
      this._syncRails(true);
      this._requestDraw();
    }));
    const onQuest = () => {
      this._syncRails(true);
      this._requestDraw();
    };
    this._offs.push(bus.on('quest:started', onQuest));
    this._offs.push(bus.on('quest:objective', onQuest));
    this._offs.push(bus.on('quest:completed', onQuest));
    this._offs.push(bus.on('quest:tracked', onQuest));
    this._offs.push(bus.on('player:spawn', () => {
      this._syncPosition();
      this._requestDraw();
    }));
  }

  _observe() {
    if (this._ro || typeof ResizeObserver === 'undefined' || !this.stageEl) return;
    this._ro = new ResizeObserver(() => {
      if (!this._open) return;
      this._resizeCanvas();
      this._requestDraw();
    });
    this._ro.observe(this.stageEl);
  }

  // ================================================================ 视图
  _scale() {
    // 直接用 MapSystem 的投影换算，保证拖拽手感与绘制完全一致
    const size = this._mapSize || 1;
    const p = this.map.worldToScreen(size, this.panX, this.panZ, {
      panX: this.panX, panZ: this.panZ, zoom: this.zoom,
    });
    return p.scale || 1;
  }

  _resizeCanvas() {
    const stage = this.stageEl;
    const canvas = this.canvas;
    if (!stage || !canvas) return;
    const rect = stage.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(120, Math.round(rect.height));
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    this._cw = w;
    this._ch = h;
    this._mapSize = Math.min(w, h);
    this._ox = (w - this._mapSize) / 2;
    this._oy = (h - this._mapSize) / 2;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _centerOnPlayer(redraw = true) {
    // 全览级别下 clamp 会把视图钉在世界中心，先放大到能真正对准玩家的级别
    this.zoom = Math.max(this.zoom, 2.2);
    const p = this.game?.player?.position;
    if (p && Number.isFinite(p.x)) {
      this.panX = p.x;
      this.panZ = p.z;
    }
    const pan = this.map.clampPan(this.panX, this.panZ, this.zoom);
    this.panX = pan.panX;
    this.panZ = pan.panZ;
    if (redraw) this._requestDraw();
  }

  _zoomAt(px, py, factor) {
    const size = this._mapSize;
    if (!size) return;
    const before = this._screenToWorld(px, py);
    this.zoom = Math.max(1, Math.min(5, this.zoom * factor));
    const after = this._screenToWorld(px, py);
    const pan = this.map.clampPan(
      this.panX + (before.x - after.x),
      this.panZ + (before.z - after.z),
      this.zoom,
    );
    this.panX = pan.panX;
    this.panZ = pan.panZ;
    this._hideTooltip();
    this._requestDraw();
  }

  /** 画布客户坐标 → 世界坐标（考虑居中留白） */
  _screenToWorld(px, py) {
    const size = this._mapSize;
    const lx = px - this._ox;
    const ly = py - this._oy;
    return this.map.screenToWorld(size, lx, ly, { panX: this.panX, panZ: this.panZ, zoom: this.zoom });
  }

  /** 世界坐标 → 画布客户坐标 */
  _worldToScreen(x, z) {
    const size = this._mapSize;
    const p = this.map.worldToScreen(size, x, z, { panX: this.panX, panZ: this.panZ, zoom: this.zoom });
    return { x: p.x + this._ox, y: p.y + this._oy, scale: p.scale };
  }

  // ================================================================ 交互
  _markerAt(px, py) {
    let best = null;
    let bestD = 15 * 15;
    for (const m of this.map.markers || []) {
      if (!m.discovered) continue;
      const p = this._worldToScreen(m.x, m.z);
      if (p.x < -20 || p.y < -20 || p.x > this._cw + 20 || p.y > this._ch + 20) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  _updateHover(px, py) {
    const m = this._markerAt(px, py);
    const id = m ? m.id : null;
    if (id !== this.hoverId) {
      this._setHover(id);
      this._requestDraw();
    }
    if (m) this._showTooltip(m, px, py);
    else this._hideTooltip();
  }

  _setHover(id) {
    this.hoverId = id;
  }

  _showTooltip(marker, px, py) {
    const el = this.tooltipEl;
    if (!el) return;
    const st = this.map.markerStyle?.[marker.type] || this.map.markerStyle?.default || { name: '地标', glyph: 'ᛟ', color: '#c9a45c' };
    const player = this.game?.player?.position;
    let dist = '';
    if (player && Number.isFinite(player.x)) {
      dist = fmtDist(Math.hypot(marker.x - player.x, marker.z - player.z));
    }
    const quest = this._questForMarker(marker.id);
    const html = `<i style="color:${st.color}">${st.glyph}</i>`
      + `<span class="mq-tip__name">${this._esc(marker.label)}</span>`
      + `<span class="mq-tip__meta">${st.name}${marker.lit ? ' · 已点亮' : ''}${dist ? ` · ${dist}` : ''}</span>`
      + (quest ? `<span class="mq-tip__quest">◆ ${this._esc(quest.title)}</span>` : '');
    if (html !== this._tipHtml) {
      this._tipHtml = html;
      el.innerHTML = html;
    }
    el.hidden = false;
    const pad = 14;
    const w = el.offsetWidth || 160;
    const h = el.offsetHeight || 54;
    const left = Math.min(this._cw - w - 8, Math.max(8, px + pad));
    const top = Math.min(this._ch - h - 8, Math.max(8, py + pad));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  _hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.hidden = true;
    this._tipHtml = '';
  }

  _clickAt(px, py) {
    const m = this._markerAt(px, py);
    if (!m) {
      this.selectedId = null;
      this._requestDraw();
      return;
    }
    this.selectedId = m.id;
    // 若该地标正被某条进行中的任务指向，则直接追踪该任务
    const quest = this._questForMarker(m.id);
    if (quest) this.game?.systems?.quest?.track?.(quest.id);
    this._syncRails(true);
    this._requestDraw();
  }

  /** 找出把该地标作为当前目标的进行中任务 */
  _questForMarker(markerId) {
    const qs = this.game?.systems?.quest;
    if (!qs || !Array.isArray(qs.active)) return null;
    const want = normId(markerId);
    for (const inst of qs.active) {
      for (const obj of inst.objectives || []) {
        if (obj.done) continue;
        if (normId(obj.def.target) === want) return inst.def;
      }
    }
    return null;
  }

  // ================================================================ 绘制
  _requestDraw() {
    if (!this._open || !this.ctx) return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._open) return;
      this._draw();
    });
  }

  _draw() {
    const ctx = this.ctx;
    const size = this._mapSize;
    if (!ctx || !size) return;
    const w = this._cw;
    const h = this._ch;
    const ox = this._ox;
    const oy = this._oy;

    ctx.clearRect(0, 0, w, h);
    // 画布留白处填黑曜石底色，避免露出面板背景纹理
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, oy);
    this._chamferPath(ctx, size, 14);
    ctx.clip();
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, size, size);
    this.map.renderWorldMap(ctx, size, {
      panX: this.panX,
      panZ: this.panZ,
      zoom: this.zoom,
      hoverId: this.hoverId,
      selectedId: this.selectedId,
    });
    ctx.restore();

    this._drawFrame(ctx, ox, oy, size);
    this._syncCoordReadout();
  }

  _chamferPath(ctx, s, cut) {
    ctx.beginPath();
    ctx.moveTo(cut, 0);
    ctx.lineTo(s - cut, 0);
    ctx.lineTo(s, cut);
    ctx.lineTo(s, s - cut);
    ctx.lineTo(s - cut, s);
    ctx.lineTo(cut, s);
    ctx.lineTo(0, s - cut);
    ctx.lineTo(0, cut);
    ctx.closePath();
  }

  _drawFrame(ctx, ox, oy, s) {
    ctx.save();
    ctx.translate(ox, oy);
    // 外框
    this._chamferPath(ctx, s, 14);
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 内框（先平移再构建路径，Canvas 的路径坐标在添加时就被 CTM 变换）
    ctx.translate(5, 5);
    this._chamferPath(ctx, s - 10, 11);
    ctx.strokeStyle = 'rgba(201, 164, 92, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 四角符文
    const runes = [
      { x: ox + 20, y: oy + 20, r: 'ᛟ' },
      { x: ox + s - 20, y: oy + 20, r: 'ᛉ' },
      { x: ox + 20, y: oy + s - 20, r: 'ᚨ' },
      { x: ox + s - 20, y: oy + s - 20, r: 'ᚱ' },
    ];
    ctx.save();
    ctx.font = `14px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(201, 164, 92, 0.62)';
    for (const r of runes) ctx.fillText(r.r, r.x, r.y);
    ctx.restore();
  }

  _syncCoordReadout() {
    if (!this.coordEl) return;
    const x = Math.round(this.panX);
    const z = Math.round(this.panZ);
    const text = `${x} · ${z} · ${this.zoom.toFixed(1)}×`;
    if (this.coordEl.textContent !== text) this.coordEl.textContent = text;
  }

  // ================================================================ 两侧栏
  _syncRails(force = false) {
    if (!this.stageEl) return;
    const map = this.map;
    const qs = this.game?.systems?.quest;
    const discovered = (map.markers || []).filter((m) => m.discovered);
    const tracked = qs?.tracked || null;
    const sig = `${discovered.length}|${this.selectedId || ''}|${tracked?.def?.id || ''}|`
      + `${tracked?.stageIndex ?? -1}|${(tracked?.objectives || []).map((o) => `${o.progress}${o.done ? 'd' : ''}`).join(',')}|`
      + `${this.map.questTargets.length}`;
    if (!force && sig === this._railSig) return;
    this._railSig = sig;

    // 探索度
    const ratio = map.exploredRatio?.() || 0;
    const pct = Math.round(ratio * 100);
    if (this.exploreNum) this.exploreNum.textContent = String(pct);
    if (this.exploreBar) this.exploreBar.style.width = `${Math.max(1, pct)}%`;
    if (this.exploreMeta) {
      this.exploreMeta.innerHTML = `已发现地标 <b>${discovered.length}</b> / <i>${(map.markers || []).length}</i>`;
    }

    this._renderQuestCard(tracked);
    this._renderMarkerList(discovered);
    this._syncPosition();
  }

  _renderQuestCard(tracked) {
    const el = this.questCardEl;
    if (!el) return;
    if (!tracked) {
      el.innerHTML = '<div class="empty-hint">尚未追踪任何使命</div>';
      return;
    }
    const stage = tracked.stage || null;
    const objs = (tracked.objectives || []).map((o) => {
      const progress = o.def.count > 1 ? `${o.progress}/${o.def.count}` : (o.done ? '✓' : '待办');
      return `<li class="mq-miniobj${o.done ? ' is-done' : ''}">`
        + `<span class="mq-miniobj__mark">${o.done ? '✓' : '◇'}</span>`
        + `<span class="mq-miniobj__text">${this._esc(o.def.text)}</span>`
        + `<span class="mq-miniobj__num">${progress}</span></li>`;
    }).join('');
    el.innerHTML = `
      <div class="mq-questcard__title">${this._esc(tracked.def.title)}</div>
      <div class="mq-questcard__latin latin">${this._esc(tracked.def.latin)}</div>
      <div class="mq-questcard__stage">${tracked.completed ? '使命已成' : `第 ${tracked.stageIndex + 1} 幕 · ${this._esc(stage?.text || '')}`}</div>
      <ul class="mq-miniobjs">${objs || '<li class="empty-hint">无目标</li>'}</ul>`;
  }

  _renderMarkerList(discovered) {
    const el = this.markersEl;
    if (!el) return;
    const player = this.game?.player?.position;
    const rows = discovered.map((m) => {
      const dist = player && Number.isFinite(player.x)
        ? Math.hypot(m.x - player.x, m.z - player.z)
        : Infinity;
      return { m, dist };
    }).sort((a, b) => a.dist - b.dist);

    if (!rows.length) {
      el.innerHTML = '<div class="empty-hint">尚未发现任何地标<br />向未知之地走去</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const { m, dist } of rows) {
      const st = this.map.markerStyle?.[m.type] || this.map.markerStyle?.default || { glyph: 'ᛟ', color: '#c9a45c', name: '地标' };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mq-marker-row' + (this.selectedId === m.id ? ' is-active' : '');
      btn.dataset.markerId = m.id;
      btn.innerHTML = `<i class="mq-marker-row__glyph" style="color:${m.lit ? '#f4e0a3' : st.color}">${st.glyph}</i>`
        + `<span class="mq-marker-row__name">${this._esc(m.label)}</span>`
        + `<span class="mq-marker-row__dist latin">${Number.isFinite(dist) ? fmtDist(dist) : '—'}</span>`;
      btn.addEventListener('click', () => {
        this.selectedId = m.id;
        const pan = this.map.clampPan(m.x, m.z, Math.max(this.zoom, 1.6));
        this.panX = pan.panX;
        this.panZ = pan.panZ;
        const quest = this._questForMarker(m.id);
        if (quest) this.game?.systems?.quest?.track?.(quest.id);
        this._syncRails(true);
        this._requestDraw();
      });
      frag.appendChild(btn);
    }
    el.innerHTML = '';
    el.appendChild(frag);
  }

  _syncPosition() {
    const player = this.game?.player?.position;
    if (!this._posCoord) return;
    if (player && Number.isFinite(player.x)) {
      this._posCoord.textContent = `${Math.round(player.x)} · ${Math.round(player.z)}`;
      const regions = this.game?.world?.regions || REGIONS;
      let best = null;
      let bestD = Infinity;
      for (const r of regions) {
        const dx = player.x - r.cx;
        const dz = player.z - r.cz;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = r; }
      }
      if (this._posRegion) this._posRegion.textContent = best ? best.name : '九界';
    }
    const tracked = this.game?.systems?.quest?.tracked;
    if (this._posTrack) {
      this._posTrack.textContent = tracked ? tracked.def.title : '未追踪';
      this._posTrack.classList.toggle('gold', !!tracked);
    }
  }

  _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
}
