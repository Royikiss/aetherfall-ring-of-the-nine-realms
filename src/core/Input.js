/**
 * Input.js — 键盘 / 鼠标 / 指针锁定的唯一入口。
 *
 * 设计：
 *  - 键位以 KeyboardEvent.code 为键（不受输入法/布局影响）
 *  - 提供"持续按下 / 本帧按下 / 本帧抬起"三级查询
 *  - 鼠标位移在 postUpdate() 中清零，保证一帧只消费一次
 *  - 指针锁定：点击画布获取；UI 打开或失焦时自动释放
 */
export class Input {
  constructor(game, domElement) {
    this.game = game;
    this.dom = domElement;

    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false };
    this.locked = false;
    this.enabled = true;      // 打开面板时置 false
    this._ignoreNextMove = false;
    this._lockRequested = false;

    // 语义动作映射（便于后续改键）
    this.bindings = {
      forward: ['KeyW', 'ArrowUp'],
      back: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      jump: ['Space'],
      interact: ['KeyF'],
      attack: ['KeyJ'],
      camLeft: ['KeyQ'],
      camRight: ['KeyE'],
    };

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
  }

  init() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('contextmenu', this._onContextMenu);
    return this;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.dom.removeEventListener('contextmenu', this._onContextMenu);
  }

  // ------------------------------------------------------------ 事件
  _onKeyDown(e) {
    // 面板热键 / Esc 由 UIManager 处理；F 系列功能键由 main 处理
    if (e.code === 'Tab') return;
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
    // 空格滚动页面
    if (e.code === 'Space') e.preventDefault();
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    this.released.add(e.code);
  }

  _onBlur() {
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
  }

  _onMouseDown(e) {
    if (!this.enabled) return;
    if (this.game.ui?.isOpen?.()) return;
    if (!this.locked && e.target === this.dom) {
      // 首次点击：请求指针锁定（浏览器要求用户手势）
      this.requestLock();
      return;
    }
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 2) this.mouse.right = true;
  }

  _onMouseUp(e) {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    // 指针锁定完成的瞬间浏览器可能上报一次"光标跳变"，必须丢弃，否则视角会瞬间甩飞
    if (this._ignoreNextMove) {
      this._ignoreNextMove = false;
      return;
    }
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    // 异常大位移（切窗口、远程桌面等）同样丢弃
    if (Math.abs(dx) > 260 || Math.abs(dy) > 260) return;
    this.mouse.dx += dx;
    this.mouse.dy += dy;
  }

  _onWheel(e) {
    if (this.game.ui?.isOpen?.()) return;
    this.mouse.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.dom;
    if (this.locked) this._ignoreNextMove = true;
    if (!this.locked) {
      this.mouse.left = false;
      this.mouse.right = false;
      this.mouse.dx = 0;
      this.mouse.dy = 0;
    }
    this.game.events?.emit('input:lock', { locked: this.locked });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.dom.requestPointerLock?.({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => { /* 用户取消，忽略 */ });
    } catch (e) { /* 某些浏览器不支持 */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!v) {
      this.keys.clear();
      this.mouse.left = false;
      this.mouse.right = false;
    }
  }

  // ------------------------------------------------------------ 查询
  isDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  wasPressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  keyDown(code) { return this.keys.has(code); }
  keyPressed(code) { return this.pressed.has(code); }

  /** 归一化的移动轴（相对相机） */
  axis() {
    let x = 0;
    let y = 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** 每帧末尾调用：清空一次性状态 */
  postUpdate() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
