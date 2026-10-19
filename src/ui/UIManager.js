/**
 * UIManager.js — 全部界面层的统一管理者。
 *
 * 职责：
 *  - 面板生命周期（懒构建 / 打开 / 关闭 / 热键 / 互斥）
 *  - HUD 插槽注册（小地图、罗盘、任务追踪等由各系统挂载）
 *  - 通知（toast）与史诗横幅（banner）
 *  - 载入屏 / 标题屏 / 帮助屏
 *  - 打开面板时通知引擎暂停输入并释放鼠标锁定
 *
 * 设计原则：面板只关心自己的 DOM 结构与数据，样式统一走 theme.css 令牌。
 */
export class UIManager {
  constructor(game) {
    this.game = game;
    this.panelLayer = document.getElementById('panel-layer');
    this.toastLayer = document.getElementById('toast-layer');
    this.bannerLayer = document.getElementById('banner-layer');
    this.hudRoot = document.getElementById('hud');
    this.loadingScreen = document.getElementById('loading-screen');
    this.titleScreen = document.getElementById('title-screen');
    this.helpScreen = document.getElementById('help-screen');
    this.loadingFill = document.getElementById('loading-fill');
    this.loadingStatus = document.getElementById('loading-status');
    this.loadingTip = document.getElementById('loading-tip');

    /** @type {Map<string, object>} */
    this.panels = new Map();
    /** @type {Map<string, HTMLElement>} */
    this.slots = new Map();
    this.openId = null;
    this._toastSeq = 0;
    this.api = {
      game,
      ui: this,
      bus: game.events,
      /** 面板内部用来主动重绘 */
      refresh: () => this.refresh(),
      fmt: (n) => Math.round(n).toLocaleString('zh-CN'),
    };
  }

  init() {
    // 面板热键统一在这里绑定，避免 Input 与 UI 双重处理
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();

      // Esc / Tab 关闭
      if (key === 'escape' || key === 'tab') {
        if (this.openId) {
          e.preventDefault();
          this.closeAll();
        } else if (key === 'tab') {
          e.preventDefault();
        }
        return;
      }
      // 面板热键
      for (const def of this.panels.values()) {
        if (def.hotkey && def.hotkey === key) {
          e.preventDefault();
          this.toggle(def.id);
          return;
        }
      }
    });

    // 点击面板外的暗色区域关闭
    this.panelLayer.addEventListener('mousedown', (e) => {
      if (e.target === this.panelLayer) this.closeAll();
    });

    // 帮助屏
    const help = this.helpScreen;
    help.querySelector('[data-close-help]')?.addEventListener('click', () => help.classList.add('hidden'));
    help.addEventListener('mousedown', (e) => {
      if (e.target === help) help.classList.add('hidden');
    });
    document.getElementById('btn-help')?.addEventListener('click', () => help.classList.remove('hidden'));
    this.helpScreen.classList.add('hidden');
  }

  // ================================================================ 面板
  /**
   * @param {{
   *  id:string, title:string, latin?:string, hotkey?:string, width?:number, height?:number,
   *  build:(body:HTMLElement, api:object)=>void,
   *  refresh?:(body:HTMLElement, api:object)=>void,
   *  onOpen?:(api:object)=>void, onClose?:(api:object)=>void
   * }} def
   */
  registerPanel(def) {
    if (!def || !def.id) throw new Error('[UI] panel needs id');
    this.panels.set(def.id, def);
    return def;
  }

  _ensurePanel(def) {
    if (def._el) return def._el;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.dataset.panel = def.id;
    if (def.width) panel.style.width = def.width;
    if (def.height) panel.style.height = def.height;

    const frame = document.createElement('div');
    frame.className = 'panel-frame';

    const head = document.createElement('header');
    head.className = 'panel-head';
    const text = document.createElement('div');
    text.className = 'panel-head__text';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = def.title;
    text.appendChild(title);
    if (def.latin) {
      const latin = document.createElement('div');
      latin.className = 'panel-sub latin';
      latin.textContent = def.latin;
      text.appendChild(latin);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.addEventListener('click', () => this.closeAll());
    head.appendChild(text);
    head.appendChild(closeBtn);

    const divider = document.createElement('div');
    divider.className = 'rune-divider';

    const body = document.createElement('div');
    body.className = 'panel-body';

    frame.appendChild(head);
    frame.appendChild(divider);
    frame.appendChild(body);
    panel.appendChild(frame);
    this.panelLayer.appendChild(panel);

    def._el = panel;
    def._body = body;
    if (def.build) {
      try {
        def.build(body, this.api);
      } catch (err) {
        console.error(`[UI] panel "${def.id}" build failed`, err);
        body.innerHTML = '<div class="empty-hint">界面构建失败，请查看控制台。</div>';
      }
    }
    return panel;
  }

  refresh() {
    if (!this.openId) return;
    const def = this.panels.get(this.openId);
    if (!def) return;
    try {
      def.refresh?.(def._body, this.api);
    } catch (err) {
      console.error(`[UI] panel "${def.id}" refresh failed`, err);
    }
  }

  open(id) {
    const def = this.panels.get(id);
    if (!def) { console.warn('[UI] unknown panel', id); return false; }
    if (this.openId === id) return true;
    this.closeAll(true);
    this._ensurePanel(def);
    def._el.classList.remove('hidden');
    this.panelLayer.classList.add('is-visible');
    this.openId = id;
    this.hudRoot?.classList.add('is-dimmed');
    try { def.refresh?.(def._body, this.api); } catch (e) { console.error(e); }
    try { def.onOpen?.(this.api); } catch (e) { console.error(e); }
    document.exitPointerLock?.();
    this.game.events.emit('ui:modal', { open: true, id });
    this.playUiSound('ui_open');
    return true;
  }

  close(id) {
    const def = this.panels.get(id);
    if (!def || this.openId !== id) return;
    def._el?.classList.add('hidden');
    this.openId = null;
    this.panelLayer.classList.remove('is-visible');
    this.hudRoot?.classList.remove('is-dimmed');
    try { def.onClose?.(this.api); } catch (e) { console.error(e); }
    this.game.events.emit('ui:modal', { open: false, id });
    this.playUiSound('ui_close');
  }

  closeAll(silent = false) {
    if (!this.openId) return;
    const id = this.openId;
    const def = this.panels.get(id);
    def?._el?.classList.add('hidden');
    this.openId = null;
    this.panelLayer.classList.remove('is-visible');
    this.hudRoot?.classList.remove('is-dimmed');
    if (!silent) {
      try { def?.onClose?.(this.api); } catch (e) { console.error(e); }
      this.game.events.emit('ui:modal', { open: false, id });
      this.playUiSound('ui_close');
    }
  }

  toggle(id) {
    if (this.openId === id) this.closeAll();
    else this.open(id);
  }

  isOpen(id) { return id ? this.openId === id : !!this.openId; }

  playUiSound(name) {
    this.game.systems?.audio?.play?.(name, { volume: 0.5 });
  }

  // ================================================================ HUD
  registerSlot(name, el) { this.slots.set(name, el); }
  /** @returns {HTMLElement|undefined} */
  slot(name) { return this.slots.get(name); }
  setHudVisible(v) { this.hudRoot?.classList.toggle('hidden', !v); }

  // ================================================================ 通知
  /**
   * 右下角轻提示。
   * @param {string} text
   * @param {{kind?:'info'|'quest'|'item'|'danger', latin?:string, duration?:number, glyph?:string}} opts
   */
  toast(text, opts = {}) {
    if (!this.toastLayer) return;
    const { kind = 'info', latin = '', duration = 3400, glyph = 'ᛟ' } = opts;
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.style.animationDelay = `${(this._toastSeq++ % 3) * 40}ms`;
    el.innerHTML = `
      <span class="toast__glyph">${glyph}</span>
      <span class="toast__text">${this._escape(text)}${latin ? `<i class="latin">${this._escape(latin)}</i>` : ''}</span>`;
    this.toastLayer.appendChild(el);
    // 最多保留 5 条
    while (this.toastLayer.children.length > 5) this.toastLayer.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 500);
    }, duration);
  }

  /**
   * 屏幕中央史诗横幅（任务完成、区域发现、升级）。
   */
  banner(title, subtitle = '', opts = {}) {
    if (!this.bannerLayer) return;
    const { duration = 3000, kind = 'default', latin = '' } = opts;
    const el = document.createElement('div');
    el.className = `banner banner--${kind}`;
    el.innerHTML = `
      <div class="banner__top line"></div>
      <div class="banner__text">
        ${latin ? `<div class="banner__latin latin">${this._escape(latin)}</div>` : ''}
        <div class="banner__title">${this._escape(title)}</div>
        ${subtitle ? `<div class="banner__sub">${this._escape(subtitle)}</div>` : ''}
      </div>
      <div class="banner__bottom line"></div>`;
    this.bannerLayer.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 900);
    }, duration);
    this.game.systems?.audio?.play?.('quest', { volume: 0.5 });
  }

  // ================================================================ 对话
  /**
   * 底部对话条（NPC 交谈）。逐句推进，结束后自动恢复操作。
   * @param {{speaker:string, latin?:string, lines:string[], glyph?:string, onClose?:Function}} opts
   */
  showDialogue({ speaker, latin = '', lines = [], glyph = 'ᚱ', onClose = null }) {
    if (this._dialogue) this._closeDialogue();
    if (!lines.length) return;

    const el = document.createElement('div');
    el.className = 'dialogue';
    el.innerHTML = `
      <div class="dialogue__inner">
        <div class="dialogue__glyph">${this._escape(glyph)}</div>
        <div class="dialogue__body">
          <div class="dialogue__speaker">${this._escape(speaker)}${latin ? `<span class="latin">${this._escape(latin)}</span>` : ''}</div>
          <div class="dialogue__line"></div>
          <div class="dialogue__hint">按 F / 空格 继续　·　ESC 结束</div>
        </div>
      </div>`;
    document.getElementById('ui-root')?.appendChild(el);

    const lineEl = el.querySelector('.dialogue__line');
    let index = 0;
    let typing = 0;
    let timer = null;

    const renderLine = () => {
      const text = lines[index] || '';
      typing = 0;
      lineEl.textContent = '';
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        typing++;
        lineEl.textContent = text.slice(0, typing);
        if (typing >= text.length) {
          clearInterval(timer);
          timer = null;
        }
      }, 22);
    };

    const advance = () => {
      // 打字中 → 立即显示完整句子
      if (timer) {
        clearInterval(timer);
        timer = null;
        lineEl.textContent = lines[index];
        typing = lines[index].length;
        return;
      }
      index++;
      if (index >= lines.length) {
        close();
        return;
      }
      this.playUiSound('ui_click');
      renderLine();
    };

    const close = () => {
      if (timer) clearInterval(timer);
      this._dialogue = null;
      window.removeEventListener('keydown', onKey, true);
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
      this.game.events.emit('ui:modal', { open: false, id: 'dialogue' });
      this.game.ui?.setHudVisible?.(true);
      this.game.input?.setEnabled?.(true);
      this.game.input?.requestLock?.();
      onClose?.();
    };

    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'f' || k === ' ' || k === 'enter') {
        e.preventDefault();
        e.stopPropagation();
        advance();
      } else if (k === 'escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };

    this._dialogue = { el, advance, close };
    this.game.events.emit('ui:modal', { open: true, id: 'dialogue' });
    this.game.input?.setEnabled?.(false);
    document.exitPointerLock?.();
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('click', advance);
    renderLine();
    this.playUiSound('ui_open');
  }

  _closeDialogue() {
    this._dialogue?.close?.();
  }

  isDialogueOpen() { return !!this._dialogue; }

  // ================================================================ 屏幕
  setLoading(percent, status) {
    if (this.loadingFill) this.loadingFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (status && this.loadingStatus) this.loadingStatus.textContent = status;
  }

  setLoadingTip(text) {
    if (this.loadingTip) this.loadingTip.textContent = text;
  }

  finishLoading() {
    if (!this.loadingScreen) return;
    this.setLoading(100, '世界已就绪');
    this.loadingScreen.classList.add('is-out');
    setTimeout(() => this.loadingScreen.classList.add('hidden'), 900);
  }

  showTitle(hasSave) {
    if (!this.titleScreen) return;
    this.titleScreen.classList.remove('hidden');
    document.getElementById('btn-continue')?.classList.toggle('hidden', !hasSave);
  }

  hideTitle() {
    if (!this.titleScreen) return;
    this.titleScreen.classList.add('is-out');
    setTimeout(() => this.titleScreen.classList.add('hidden'), 900);
  }

  showHelp() { this.helpScreen?.classList.remove('hidden'); }

  // ================================================================ 工具
  _escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
}
