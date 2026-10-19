/**
 * AudioSystem.js — 《英灵纪元 · 九界之环》程序化音频引擎。
 *
 * 模块职责
 *  ----------
 * 完全不依赖任何音频文件（无 fetch / 无 <audio>），全部声音由 WebAudio API 实时合成：
 *   - 环境底层：D 小调低频 Drone（D2 / A2 / F3，sine + saw 混合，经 lowpass）
 *                + 程序化白噪声「风」（bandpass 扫频 + 慢速 LFO）。
 *   - 极光铃音：每隔 8~20 秒随机一个柔和正弦泛音（D4 / A4 / F5），带反馈延迟。
 *   - 一次性音效：UI、拾取、任务、圣火、战斗、脚步、升级、死亡……（见 SFX_BUILDERS）。
 *   - 音乐：缓慢和弦铺底（Dm–Bb–F–C 等），每 12~20 秒换和弦；三角波 detune +
 *           程序化脉冲响应 Convolver 混响。没有循环旋律，避免疲劳。
 *
 * 对外 API（与 docs/ARCH.md §6.6 一致）
 *  ----------
 *   audio.init()                       绑定首次用户手势后启动 AudioContext；订阅事件总线
 *   audio.update(dt)                   每帧：风声随玩家状态微调、自动脚步、音乐/铃音调度
 *   audio.play(name, { volume })       播放音效；未知名字 / 未启动 / 静音时安全 no-op
 *   audio.setAmbience(intensity)       0..1 环境强度
 *   audio.setMusicMood(mood)           'explore' | 'combat' | 'sacred' | 'menu'
 *   audio.mute() / unmute() / toggleMute()
 *   audio.muted                        getter / setter
 *   audio.toJSON() / fromJSON(data)    保存音量、静音、环境强度、音乐情绪
 *
 * 音效名（必须完全一致）
 *  ----------
 *   ui_click | ui_open | ui_close | pickup | quest | banner | shrine |
 *   hit | swing | jump | footstep | levelup | death | item | error
 *   （footstep 额外参数 kind: 'stone' | 'grass' | 'snow' | 'wood'）
 *
 * 设计约束
 *  ----------
 *  - 构造与 init 绝不允许抛错：AudioContext 不可用时静默降级，play 变为 no-op。
 *  - 只有 AudioContext 创建失败时才 console.warn 一次；其余静默。
 *  - 一次性发声体节点数预算 40，超出直接丢弃（持续层 Drone/风/音乐不计入）。
 *  - 页面隐藏时 suspend，恢复时 resume；全部节点最终都会 disconnect。
 *
 * 依赖：仅浏览器 WebAudio / document / window；不依赖 three.js。
 */

/* ================================================================== *
 * 常量
 * ================================================================== */

/** 混音总线电平（ARCH 约定） */
const BUS = { master: 0.7, ambience: 0.35, sfx: 0.8, music: 0.28 };

/** 一次性音效同时活跃的 AudioNode 上限（性能红线 40） */
const MAX_LIVE_NODES = 40;
/** 一次性发声体（voice）数量上限，防止极端情况下节点被反复创建 */
const MAX_VOICES = 16;

/** 脚步可用的地面类型 */
const FOOTSTEP_KINDS = ['stone', 'grass', 'snow', 'wood'];

/**
 * 音效名 → 内部构建方法名。
 * 新增音效只需在这里挂一个 builder，无需改动 play()。
 */
const SFX_BUILDERS = {
  ui_click: '_sfxUiClick',
  ui_open: '_sfxUiOpen',
  ui_close: '_sfxUiClose',
  pickup: '_sfxPickup',
  quest: '_sfxQuest',
  banner: '_sfxBanner',
  shrine: '_sfxShrine',
  hit: '_sfxHit',
  swing: '_sfxSwing',
  jump: '_sfxJump',
  footstep: '_sfxFootstep',
  levelup: '_sfxLevelup',
  death: '_sfxDeath',
  item: '_sfxItem',
  error: '_sfxError',
};

/** 同名音效最小间隔（秒），防止事件风暴把混音糊成一团 */
const SFX_THROTTLE = {
  ui_click: 0.03,
  ui_open: 0.12,
  ui_close: 0.12,
  pickup: 0.04,
  item: 0.05,
  quest: 0.45,
  banner: 0.45,
  shrine: 0.6,
  hit: 0.045,
  swing: 0.06,
  jump: 0.1,
  footstep: 0.14,
  levelup: 0.3,
  death: 1.0,
  error: 0.2,
};

/**
 * 音乐情绪配置。
 * chords：三和弦频率（Hz），遵循 D 小调 / 北欧色彩（Dm–Bb–F–C / Dm–Gm–Bb–A）。
 * min/max：换和弦间隔（秒）；attack：铺底淡入时间；cutoff：pad 低通；gain：和弦峰值系数。
 * bell：极光铃音间隔范围（秒）。
 */
const MUSIC_MOODS = {
  explore: {
    chords: [
      [146.83, 174.61, 220.0],   // Dm
      [116.54, 146.83, 174.61],  // Bb
      [87.31, 110.0, 130.81],    // F
      [130.81, 164.81, 196.0],   // C
    ],
    min: 12, max: 20, attack: 2.4, cutoff: 950, gain: 1.0, bell: [8, 20],
  },
  combat: {
    chords: [
      [146.83, 174.61, 220.0],   // Dm
      [98.0, 116.54, 146.83],    // Gm
      [116.54, 146.83, 174.61],  // Bb
      [110.0, 138.59, 164.81],   // A（和声小调属和弦）
    ],
    min: 12, max: 16, attack: 1.2, cutoff: 1500, gain: 1.15, bell: [12, 20],
  },
  sacred: {
    chords: [
      [146.83, 174.61, 220.0],   // Dm
      [98.0, 116.54, 146.83],    // Gm
      [116.54, 146.83, 174.61],  // Bb
      [110.0, 138.59, 164.81],   // A
    ],
    min: 12, max: 18, attack: 2.0, cutoff: 1800, gain: 1.0, bell: [8, 14],
  },
  menu: {
    chords: [
      [146.83, 174.61, 220.0],   // Dm
      [116.54, 146.83, 174.61],  // Bb
      [87.31, 110.0, 130.81],    // F
      [130.81, 164.81, 196.0],   // C
    ],
    min: 14, max: 20, attack: 2.8, cutoff: 700, gain: 0.9, bell: [10, 20],
  },
};

/** 极光铃音可选基频：D4 / A4 / F5 */
const BELL_NOTES = [293.66, 440.0, 698.46];

/* ================================================================== *
 * 工具
 * ================================================================== */

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const rnd = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ================================================================== *
 * AudioSystem
 * ================================================================== */

export class AudioSystem {
  static id = 'audio';

  /**
   * @param {object} game 全局 Game 实例（事件总线 / 玩家 / 世界 / UI）
   */
  constructor(game) {
    this.game = game || null;

    // ---- 运行时 ----
    this._ctx = null;
    this._booted = false;      // AudioContext 与所有节点已就绪
    this._failed = false;      // 创建失败 → 永久静默降级
    this._warned = false;      // console.warn 只打一次
    this._initialized = false; // init() 只订阅一次
    this._visibilityBound = false;

    // ---- 手势 ----
    this._gestureBound = false;
    this._onGesture = this._onGesture.bind(this);
    this._onVisibility = this._onVisibility.bind(this);

    // ---- 事件订阅 ----
    /** @type {Array<() => void>} */
    this._subs = [];

    // ---- 混音节点 ----
    this._master = null;
    this._compressor = null;
    this._ambienceGain = null;
    this._sfxGain = null;
    this._musicGain = null;
    this._musicSend = null;
    this._musicWet = null;
    this._musicConvolver = null;

    // ---- 环境层 ----
    this._bedGain = null;
    this._bedFilter = null;
    this._windGain = null;
    this._windFilter = null;
    this._auroraDelay = null;
    this._auroraFeedback = null;
    this._auroraWet = null;
    this._intensity = 0.35;    // 0..1 环境强度
    this._windFactor = 0;      // 由速度/高度推导的风力系数 0..1

    // ---- 音乐 ----
    this._mood = 'explore';
    this._chordStep = 0;
    this._musicTimer = 0;
    /** @type {Array<object>} 正在发声的和弦声部（最多同时 3 个） */
    this._chordVoices = [];

    // ---- 极光铃音 ----
    this._bellTimer = rnd(8, 20);

    // ---- 一次性发声体 ----
    /** @type {Set<{nodes: AudioNode[], end: number}>} */
    this._voices = new Set();
    this._liveNodes = 0;
    /** @type {Record<string, number>} 上次播放时间（节流） */
    this._lastSfx = Object.create(null);

    // ---- 存档态 ----
    this._muted = false;
    this._masterLevel = BUS.master;

    // ---- 玩家状态缓存（避免每帧分配） ----
    this._pState = { x: 0, y: 0, z: 0, speed: 0, grounded: true, valid: false };
    this._lastPos = null;
    this._stepTimer = 0;
    this._kindTimer = 0;
    this._kind = 'grass';
    this._externalStepAt = -Infinity; // 其他系统（Player）最近一次主动播放脚步的时间
    this._autoFootstep = false;       // play() 内部标记：当前脚步是否由本系统自动触发
    this._groundTimer = 0;
    this._groundH = null;
    this._windTimer = 0;

    // ---- 噪声 / 脉冲响应缓存 ----
    this._noiseBuf = null;

    // ---- 全部需要手动回收的持续节点（dispose 用） ----
    /** @type {AudioNode[]} */
    this._persistent = [];
  }

  /* ================================================================ *
   * 生命周期
   * ================================================================ */

  /**
   * 初始化：订阅事件、绑定首次用户手势。
   * 任何情况下都不能抛错影响游戏启动。
   */
  init() {
    try {
      if (!this._initialized) {
        this._initialized = true;
        this._subscribeEvents();
      }
      this._bindGesture();
      if (!this._visibilityBound && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this._onVisibility);
        this._visibilityBound = true;
      }
    } catch (err) {
      // 初始化失败只影响音频，不阻断游戏；这里不打印警告，
      // 真正「AudioContext 不可用」的提示统一由 _boot() 的 catch 负责一次。
      this._failed = true;
    }
  }

  /** 可选：销毁音频系统（切换关卡 / 重新开始游戏时可调用）。 */
  dispose() {
    // 取消事件订阅
    for (const off of this._subs) {
      try { off(); } catch (e) { /* 忽略 */ }
    }
    this._subs.length = 0;

    if (this._visibilityBound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._visibilityBound = false;
    }
    this._unbindGesture();

    // 回收持续节点
    for (const node of this._persistent) {
      try { node.stop?.(); } catch (e) { /* 忽略 */ }
      try { node.disconnect?.(); } catch (e) { /* 忽略 */ }
    }
    this._persistent.length = 0;

    // 回收一次性与和弦声部
    for (const voice of this._voices) this._disposeNodes(voice.nodes);
    this._voices.clear();
    this._liveNodes = 0;
    for (const chord of this._chordVoices) this._disposeChord(chord);
    this._chordVoices.length = 0;

    if (this._ctx) {
      const p = this._ctx.close?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    this._ctx = null;
    this._booted = false;
  }

  /* ================================================================ *
   * 事件订阅（docs/ARCH.md 事件表）
   * ================================================================ */

  _subscribeEvents() {
    const bus = this.game && this.game.events;
    if (!bus || typeof bus.on !== 'function') return;

    const on = (type, fn) => {
      try {
        const off = bus.on(type, fn);
        if (typeof off === 'function') this._subs.push(off);
      } catch (e) { /* 事件总线异常不影响音频 */ }
    };

    // 任务完成：庄严 Dm 和弦 + 铜管横幅感（延迟叠入，避免和 UI 音撞在一起）
    on('quest:completed', () => {
      this.play('quest', { volume: 0.8 });
      this.play('banner', { volume: 0.4, delay: 0.32 });
    });

    // 圣火点亮：火焰噪声 + 升调和弦
    on('shrine:lit', () => this.play('shrine', { volume: 0.85 }));

    // 受伤 / 击杀：低频冲击（受伤音量随伤害略增）
    on('player:damaged', (payload) => {
      const amount = payload && Number.isFinite(payload.amount) ? payload.amount : 10;
      this.play('hit', { volume: clamp(0.35 + amount / 60, 0.35, 1) });
    });
    on('enemy:killed', () => this.play('hit', { volume: 0.55 }));

    // 升级 / 死亡
    on('levelup', () => this.play('levelup', { volume: 0.9 }));
    on('player:died', () => this.play('death', { volume: 0.9 }));

    // 拾取 / 发现
    on('item:collected', () => this.play('pickup', { volume: 0.8 }));
    on('poi:discovered', () => this.play('banner', { volume: 0.7 }));

    // 通用音效事件：任意系统可 bus.emit('audio:sfx', { name, volume })
    on('audio:sfx', (payload) => {
      if (!payload || typeof payload.name !== 'string') return;
      this.play(payload.name, { volume: payload.volume });
    });

    // 注意：ui:modal 不在此订阅。UIManager 在开关面板时已直接调用
    // game.systems.audio.play('ui_open' / 'ui_close')，此处重复订阅会叠音。
  }

  /* ================================================================ *
   * 首次用户手势 → 启动 AudioContext
   * ================================================================ */

  _bindGesture() {
    if (this._booted || this._failed || this._gestureBound) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    this._gestureBound = true;
    // pointerdown 覆盖鼠标 / 触屏；keydown 覆盖纯键盘玩家。
    window.addEventListener('pointerdown', this._onGesture, { passive: true });
    window.addEventListener('keydown', this._onGesture);
  }

  _unbindGesture() {
    if (!this._gestureBound) return;
    this._gestureBound = false;
    if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return;
    window.removeEventListener('pointerdown', this._onGesture);
    window.removeEventListener('keydown', this._onGesture);
  }

  /** 首次手势回调：解锁并创建 AudioContext（浏览器自动播放策略要求）。 */
  _onGesture() {
    if (this._booted || this._failed) {
      this._unbindGesture();
      return;
    }
    this._unbindGesture();
    this._boot();
  }

  /**
   * 创建 Audiocontext、混音总线、环境层与音乐层。
   * 失败时静默降级：play 之后全部 no-op。
   */
  _boot() {
    if (this._booted || this._failed) return;
    try {
      const Ctor = (typeof window !== 'undefined')
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!Ctor) throw new Error('AudioContext 不可用');

      this._ctx = new Ctor({ latencyHint: 'interactive' });

      this._createBuses();      // master → compressor → destination
      this._createAmbience();   // Drone + 风
      this._createMusic();      // 混响 / 铃音延迟（不含和弦）

      this._booted = true;
      this._applyAmbience();

      // 启动音乐与铃音调度
      this._musicTimer = 0;
      this._bellTimer = this._nextBellDelay();
      if (!this._muted) this._nextChord(0.8);

      // Safari 等浏览器在手势回调里仍需显式 resume
      const p = this._ctx.resume?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) {
      this._booted = false;
      this._failed = true;
      const ctx = this._ctx;
      this._ctx = null;
      if (ctx) {
        const p = ctx.close?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      this._warnOnce(err);
    }
  }

  /** AudioContext 创建失败时只提示一次（其余情况一律静默）。 */
  _warnOnce(err) {
    if (this._warned) return;
    this._warned = true;
    try {
      console.warn('[AudioSystem] AudioContext 创建失败，音频已静默降级：',
        (err && err.message) || err);
    } catch (e) { /* 控制台不可用则彻底忽略 */ }
  }

  /* ================================================================ *
   * 混音总线
   * ================================================================ */

  /**
   * 总线结构：
   *   sfx / ambience / music ──→ master(0.7) ──→ compressor ──→ destination
   * 音乐额外通过 send 进入 Convolver 混响，再汇入 master。
   */
  _createBuses() {
    const ctx = this._ctx;

    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0.0001 : this._masterLevel;

    // 总线末端压缩器：防止多音效叠加时削波
    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -10;
    this._compressor.knee.value = 20;
    this._compressor.ratio.value = 10;
    this._compressor.attack.value = 0.004;
    this._compressor.release.value = 0.25;

    this._master.connect(this._compressor);
    this._compressor.connect(ctx.destination);

    this._ambienceGain = ctx.createGain();
    this._ambienceGain.gain.value = BUS.ambience;
    this._ambienceGain.connect(this._master);

    this._sfxGain = ctx.createGain();
    this._sfxGain.gain.value = BUS.sfx;
    this._sfxGain.connect(this._master);

    this._musicGain = ctx.createGain();
    this._musicGain.gain.value = BUS.music;
    this._musicGain.connect(this._master);

    this._persistent.push(
      this._master, this._compressor,
      this._ambienceGain, this._sfxGain, this._musicGain,
    );
  }

  /* ================================================================ *
   * 环境层：Drone + 风
   * ================================================================ */

  /**
   * 2~3 个低频 Drone（D2 / A2 / F3）：每个由 sine + sawtooth 叠加，
   * 经过共享 lowpass，再被一条极慢 LFO（0.045Hz）轻微推动音量。
   * 风：白噪声循环 → bandpass(约 500~1100Hz) → 增益，LFO 同时调制频率与增益。
   */
  _createAmbience() {
    const ctx = this._ctx;

    // ---- 低频床 ----
    this._bedGain = ctx.createGain();
    this._bedGain.gain.value = 0.9;
    this._bedGain.connect(this._ambienceGain);

    this._bedFilter = ctx.createBiquadFilter();
    this._bedFilter.type = 'lowpass';
    this._bedFilter.frequency.value = 300;
    this._bedFilter.Q.value = 0.6;
    this._bedFilter.connect(this._bedGain);

    // 一条共享 LFO 调制所有 Drone 的音量，节省节点
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.045;
    lfo.start(0);
    this._persistent.push(lfo);

    // [频率, 基础增益]
    const droneDefs = [
      [73.42, 0.04],    // D2
      [110.0, 0.028],   // A2
      [174.61, 0.018],  // F3
    ];
    for (const [freq, level] of droneDefs) {
      const g = ctx.createGain();
      g.gain.value = level;

      const sine = ctx.createOscillator();
      sine.type = 'sine';
      sine.frequency.value = freq;

      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = freq;
      saw.detune.value = 6; // 轻微失谐，产生缓慢拍频

      sine.connect(g);
      saw.connect(g);
      g.connect(this._bedFilter);

      // LFO → depth → 音量参数（只做小幅波动，避免听感起伏过大）
      const depth = ctx.createGain();
      depth.gain.value = level * 0.35;
      lfo.connect(depth);
      depth.connect(g.gain);

      sine.start(0);
      saw.start(0);
      this._persistent.push(sine, saw, g, depth);
    }

    // ---- 风 ----
    this._noiseBuf = this._makeNoiseBuffer(2.0);

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this._noiseBuf;
    windSrc.loop = true;

    this._windFilter = ctx.createBiquadFilter();
    this._windFilter.type = 'bandpass';
    this._windFilter.frequency.value = 720;
    this._windFilter.Q.value = 0.55;

    this._windGain = ctx.createGain();
    this._windGain.gain.value = 0.045;

    windSrc.connect(this._windFilter);
    this._windFilter.connect(this._windGain);
    this._windGain.connect(this._ambienceGain);

    // 频率 LFO：0.055Hz ±260Hz，让风像在峡谷里游走
    const lfoFreq = ctx.createOscillator();
    lfoFreq.type = 'sine';
    lfoFreq.frequency.value = 0.055;
    const lfoFreqDepth = ctx.createGain();
    lfoFreqDepth.gain.value = 260;
    lfoFreq.connect(lfoFreqDepth);
    lfoFreqDepth.connect(this._windFilter.frequency);

    // 音量 LFO：0.09Hz ±0.015，制造阵风
    const lfoGain = ctx.createOscillator();
    lfoGain.type = 'sine';
    lfoGain.frequency.value = 0.09;
    const lfoGainDepth = ctx.createGain();
    lfoGainDepth.gain.value = 0.015;
    lfoGain.connect(lfoGainDepth);
    lfoGainDepth.connect(this._windGain.gain);

    windSrc.start(0);
    lfoFreq.start(0);
    lfoGain.start(0);
    this._persistent.push(
      windSrc, this._windFilter, this._windGain,
      lfoFreq, lfoFreqDepth, lfoGain, lfoGainDepth,
    );
  }

  /**
   * 环境强度（0..1）：进战斗 / 遗迹时增强风声与 Drone 厚度。
   * 总线电平保持 0.35，只调整内部比例，保证整体依旧很轻。
   */
  setAmbience(intensity) {
    const v = Number(intensity);
    if (!Number.isFinite(v)) return;
    this._intensity = clamp(v, 0, 1);
    this._applyAmbience();
  }

  _applyAmbience() {
    if (!this._booted || !this._ctx || !this._bedGain) return;
    const now = this._now();
    const i = this._intensity;
    const wf = this._windFactor;

    // 低频床：0.75 ~ 1.30
    this._bedGain.gain.setTargetAtTime(0.75 + 0.55 * i, now, 1.2);
    // 风：基础 0.042，随强度 + 玩家速度/高度产生的阵风系数
    this._windGain.gain.setTargetAtTime(
      0.042 * (0.7 + 1.1 * i) * (1 + wf * 0.25), now, 1.2,
    );
    // 风越强越明亮
    this._windFilter.frequency.setTargetAtTime(500 + 600 * i + wf * 300, now, 1.5);
    // Drone 随强度略开一点高频
    this._bedFilter.frequency.setTargetAtTime(240 + 140 * i, now, 2.0);
  }

  /* ================================================================ *
   * 音乐层：慢和弦 + 程序化混响 + 极光铃音
   * ================================================================ */

  _createMusic() {
    const ctx = this._ctx;

    // ---- 程序化混响（ConvolverNode + 指数衰减噪声脉冲响应） ----
    this._musicConvolver = ctx.createConvolver();
    this._musicConvolver.buffer = this._makeImpulseResponse(2.6, 2.8);

    this._musicSend = ctx.createGain();
    this._musicSend.gain.value = 0.55;

    this._musicWet = ctx.createGain();
    this._musicWet.gain.value = 0.7;

    // 后级发送：musicGain → send → convolver → wet → master
    this._musicGain.connect(this._musicSend);
    this._musicSend.connect(this._musicConvolver);
    this._musicConvolver.connect(this._musicWet);
    this._musicWet.connect(this._master);

    // ---- 极光铃音反馈延迟 ----
    this._auroraDelay = ctx.createDelay(1.0);
    this._auroraDelay.delayTime.value = 0.37;

    this._auroraFeedback = ctx.createGain();
    this._auroraFeedback.gain.value = 0.34;

    this._auroraWet = ctx.createGain();
    this._auroraWet.gain.value = 0.3;

    this._auroraDelay.connect(this._auroraFeedback);
    this._auroraFeedback.connect(this._auroraDelay);
    this._auroraDelay.connect(this._auroraWet);
    this._auroraWet.connect(this._ambienceGain);

    this._persistent.push(
      this._musicConvolver, this._musicSend, this._musicWet,
      this._auroraDelay, this._auroraFeedback, this._auroraWet,
    );
  }

  /**
   * 生成程序化脉冲响应：指数衰减的立体声噪声，带一点高频衰减与预延迟。
   * 避免外部音频文件，同时得到长而暗的「神殿混响」。
   */
  _makeImpulseResponse(seconds = 2.6, decay = 2.8) {
    const rate = this._ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this._ctx.createBuffer(2, len, rate);
    const preDelay = Math.floor(rate * 0.018); // 18ms 预延迟
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        if (i < preDelay) { data[i] = 0; continue; }
        // 一阶低通让混响尾巴变暗
        smooth = smooth * 0.72 + (Math.random() * 2 - 1) * 0.28;
        const env = Math.pow(1 - i / len, decay);
        data[i] = smooth * env;
      }
    }
    return buf;
  }

  /**
   * 切换音乐情绪。
   * @param {'explore'|'combat'|'sacred'|'menu'} mood
   */
  setMusicMood(mood) {
    if (!MUSIC_MOODS[mood]) return false;
    const changed = mood !== this._mood;
    this._mood = mood;
    if (changed && this._booted) {
      // 尽快换到新调式的和弦；旧和弦由 _nextChord 交叉淡出
      this._musicTimer = Math.min(this._musicTimer > 0 ? this._musicTimer : 0.8, 0.8);
      this._bellTimer = this._nextBellDelay();
      if (!this._muted) this._nextChord(0.35);
    }
    return true;
  }

  _nextBellDelay() {
    const cfg = MUSIC_MOODS[this._mood] || MUSIC_MOODS.explore;
    const range = cfg.bell || [8, 20];
    return rnd(range[0], range[1]);
  }

  /**
   * 生成下一个和弦声部。
   * 每次创建 3 个音 × 2 个失谐三角波，经 shared lowpass 后进入 music bus 与混响。
   */
  _nextChord(delay = 0) {
    if (!this._ctx || !this._musicGain || !this._musicSend) return;
    const cfg = MUSIC_MOODS[this._mood] || MUSIC_MOODS.explore;

    const now = this._now() + Math.max(0, delay);
    const dur = rnd(cfg.min, cfg.max);
    this._musicTimer = dur;
    if (this._muted) return; // 静音时只推进计时，不创建节点

    const notes = cfg.chords[this._chordStep % cfg.chords.length];
    this._chordStep++;

    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cfg.cutoff;
    filter.Q.value = 0.5;

    const gain = this._ctx.createGain();
    const peak = 0.085 * cfg.gain;
    const attack = cfg.attack;

    // 长 attack / 超长 release：和弦像呼吸一样进出
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.setValueAtTime(peak, now + Math.max(attack, dur));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 3.2);

    filter.connect(gain);
    // 和弦只进 music 总线；_createMusic 已把 musicGain 后级发送到混响，
    // 避免同一条干声被送两次导致混响过重。
    gain.connect(this._musicGain);

    const oscs = [];
    for (const freq of notes) {
      for (const detune of [-5, 5]) {
        const osc = this._ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune + rnd(-1.5, 1.5);
        osc.connect(filter);
        osc.start(now);
        osc.stop(now + dur + 3.5);
        oscs.push(osc);
      }
    }

    const voice = { nodes: [filter, gain, ...oscs], gain, oscs, end: now + dur + 3.6 };

    // 旧和弦交叉淡出（通常只有 1~2 个正在发声）
    for (const old of this._chordVoices) this._fadeChord(old, now, 2.0);
    this._chordVoices.push(voice);
    // 极端情况下（情绪频繁切换）最多保留 3 个声部
    while (this._chordVoices.length > 3) {
      this._disposeChord(this._chordVoices.shift());
    }
  }

  /** 让一个旧和弦平滑消失并提前释放节点。 */
  _fadeChord(voice, now, fade = 2.0) {
    if (!voice || voice.fading) return;
    voice.fading = true;
    const p = voice.gain.gain;
    try {
      if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
      else p.cancelScheduledValues(now);
    } catch (e) { /* 老浏览器忽略 */ }
    try {
      p.setTargetAtTime(0.0001, now + 0.02, fade / 3);
    } catch (e) { /* 忽略 */ }
    for (const osc of voice.oscs) {
      try { osc.stop(now + fade + 0.1); } catch (e) { /* 忽略 */ }
    }
    voice.end = Math.min(voice.end, now + fade + 0.3);
  }

  _disposeChord(voice) {
    if (!voice) return;
    for (const osc of voice.oscs) {
      try { osc.stop(); } catch (e) { /* 忽略 */ }
    }
    this._disposeNodes(voice.nodes);
  }

  _cleanupChords() {
    if (this._chordVoices.length > 0) {
      const now = this._now();
      for (let i = this._chordVoices.length - 1; i >= 0; i--) {
        const voice = this._chordVoices[i];
        if (now >= voice.end) {
          this._disposeChord(voice);
          this._chordVoices.splice(i, 1);
        }
      }
    }
    // 兜底：若因为长时间暂停 / 时间跳变导致一个和弦声部都不剩，
    // 下一帧立刻补一个，避免音乐莫名其妙地永久中断。
    if (this._chordVoices.length === 0) this._musicTimer = Math.min(this._musicTimer, 0);
  }

  /**
   * 极光铃音：随机 D4/A4/F5 正弦泛音，长 attack/release + 反馈延迟。
   * 由 update 每 8~20 秒（随情绪变化）触发。
   */
  _playAuroraBell() {
    if (!this._ambienceGain || !this._auroraDelay) return;
    const freq = pick(BELL_NOTES);
    const vol = 0.035 * (0.75 + this._intensity * 0.5);
    const pan = rnd(-0.55, 0.55);

    const base = this._playTone({
      freq, type: 'sine', pan,
      attack: 1.3, decay: 0.6, hold: 1.2, release: 3.0, sustain: 0.5,
      volume: vol,
      detune: rnd(-6, 6),
      dest: this._ambienceGain,
      send: this._auroraDelay,
    });
    const over = this._playTone({
      freq: freq * 2.005, type: 'sine', pan: -pan * 0.6,
      attack: 1.8, decay: 0.8, hold: 1.0, release: 3.4, sustain: 0.35,
      volume: vol * 0.35,
      dest: this._ambienceGain,
      send: this._auroraDelay,
    });

    this._trackVoice(this._merge([base, over]));
  }

  /* ================================================================ *
   * 主更新：每帧轻量调度
   * ================================================================ */

  update(dt) {
    if (!this._booted || this._failed || !this._ctx) return;

    // 先回收过期的一次性发声体（即使 context 被挂起也安全）
    this._cleanupVoices();
    this._cleanupChords();

    if (this._ctx.state !== 'running') return;

    const step = clamp(Number(dt) || 0, 0, 0.1);
    if (this._muted) return;

    // ---- 音乐和弦推进 ----
    this._musicTimer -= step;
    if (this._musicTimer <= 0) this._nextChord(0.05);

    // ---- 极光铃音 ----
    this._bellTimer -= step;
    if (this._bellTimer <= 0) {
      this._playAuroraBell();
      this._bellTimer = this._nextBellDelay();
    }

    // ---- 玩家状态 → 风声 / 脚步 ----
    this._updatePlayerAudio(step);
  }

  /**
   * 根据玩家状态调整风声，并在移动时自动播放脚步。
   * 对 Player 的实现保持宽容：只读取它能提供的字段。
   */
  _updatePlayerAudio(step) {
    const player = this.game && this.game.player;
    if (!player) {
      this._pState.valid = false;
      this._lastPos = null;
      return;
    }

    const pos = this._readPosition(player);
    if (!pos) return;

    const x = pos.x;
    const y = pos.y;
    const z = pos.z;

    // ---- 水平速度：优先 velocity，其次 speed 字段，最后用位置差回退 ----
    let speed = 0;
    const vel = player.velocity || player.vel || player.moveVelocity;
    if (vel && typeof vel.x === 'number') {
      speed = Math.hypot(vel.x, vel.z || 0);
    } else if (typeof player.speed === 'number') {
      speed = Math.abs(player.speed);
    } else if (typeof player.horizontalSpeed === 'number') {
      speed = Math.abs(player.horizontalSpeed);
    }
    if (!speed && this._lastPos) {
      const dist = Math.hypot(x - this._lastPos.x, z - this._lastPos.z);
      // 位置跳变（传送）不当作移动
      if (dist < 6) speed = dist / Math.max(step, 0.001);
    }
    speed = clamp(speed, 0, 20);
    this._lastPos = { x, z };

    // ---- 是否着地 ----
    let grounded = true;
    let hasGroundFlag = false;
    for (const key of ['grounded', 'onGround', 'isGrounded']) {
      if (typeof player[key] === 'boolean') {
        grounded = player[key];
        hasGroundFlag = true;
        break;
      }
    }
    if (!hasGroundFlag) {
      this._groundTimer -= step;
      if (this._groundTimer <= 0) {
        this._groundTimer = 0.18;
        this._groundH = this._sampleHeight(x, z);
      }
      if (this._groundH != null) grounded = (y - this._groundH) < 0.85;
    }

    // ---- 缓存玩家状态（供调试 / 后续扩展） ----
    const st = this._pState;
    st.x = x; st.y = y; st.z = z;
    st.speed = speed;
    st.grounded = grounded;
    st.valid = true;

    // ---- 风力系数：速度 + 高度 + 环境强度，每 0.7s 更新一次 ----
    this._windTimer -= step;
    if (this._windTimer <= 0) {
      this._windTimer = 0.7;
      const alt = this._groundH != null ? Math.max(0, y - this._groundH) : 0;
      const next = clamp(speed / 10 * 0.5 + alt / 120 * 0.5 + this._intensity * 0.4, 0, 1);
      if (Math.abs(next - this._windFactor) > 0.02) {
        this._windFactor = next;
        this._applyAmbience();
      }
    }

    // ---- 脚步：着地、有速度、界面未阻挡 ----
    if (!grounded || speed < 0.75 || this._isUiBlocking() || player.isSwimming) {
      // 起步时尽快踏出第一步
      this._stepTimer = Math.min(this._stepTimer, 0.06);
      return;
    }

    // 兼容性：Player.js 自己也会调用 audio.play('footstep')。
    // 一旦观察到外部脚步在持续驱动，本系统主动退让，避免每一步响两次；
    // 停用 3 秒后（例如换了控制器实现）再自动接管。
    if (this._now() - this._externalStepAt < 3.0) {
      this._stepTimer = 0.55;
      return;
    }

    this._stepTimer -= step;
    if (this._stepTimer > 0) return;

    // 步频与速度相关：走 ~0.5s，跑 ~0.3s
    const interval = clamp(0.95 / (0.55 + speed * 0.42), 0.24, 0.68);
    this._stepTimer = interval;

    const kind = this._groundKind(x, y, z, player, step);
    const volume = 0.5 + Math.min(speed / 7, 1) * 0.3;
    this._autoFootstep = true;
    try {
      this.play('footstep', { kind, volume });
    } finally {
      this._autoFootstep = false;
    }
  }

  /** UI 打开 / 游戏暂停时不播放脚步。 */
  _isUiBlocking() {
    const game = this.game;
    if (!game) return false;
    const ui = game.ui;
    if (ui) {
      if (ui.openId) return true;
      if (typeof ui.isOpen === 'function') {
        try { if (ui.isOpen()) return true; } catch (e) { /* 忽略 */ }
      }
    }
    if (game.paused || game.suspended) return true;
    return false;
  }

  /**
   * 读取玩家位置。兼容 Player 可能暴露的多种结构：
   * position / object3D.position / group.position / root.position / mesh.position / body.position / 直接 x,z。
   */
  _readPosition(player) {
    const src = player.position
      || (player.object3D && player.object3D.position)
      || (player.group && player.group.position)
      || (player.root && player.root.position)
      || (player.mesh && player.mesh.position)
      || (player.body && player.body.position)
      || (player.transform && player.transform.position);
    if (src && Number.isFinite(src.x) && Number.isFinite(src.z)) {
      return { x: src.x, y: Number.isFinite(src.y) ? src.y : 0, z: src.z };
    }
    if (Number.isFinite(player.x) && Number.isFinite(player.z)) {
      return { x: player.x, y: Number.isFinite(player.y) ? player.y : 0, z: player.z };
    }
    return null;
  }

  /** 地形高度采样（世界未就绪时返回 null）。 */
  _sampleHeight(x, z) {
    const world = this.game && this.game.world;
    if (!world || typeof world.sampleHeight !== 'function') return null;
    try {
      const h = world.sampleHeight(x, z);
      return Number.isFinite(h) ? h : null;
    } catch (e) {
      return null;
    }
  }

  /** 地面类型：优先玩家/世界显式提供，其次 POI、水域与高程启发式。 */
  _groundKind(x, y, z, player, step) {
    this._kindTimer -= step;
    if (this._kindTimer > 0) return this._kind;
    this._kindTimer = 0.9;

    const explicit = player.groundKind || player.groundSurface
      || player.surfaceType || player.terrainKind;
    if (FOOTSTEP_KINDS.includes(explicit)) {
      this._kind = explicit;
      return this._kind;
    }

    const world = this.game && this.game.world;
    if (world) {
      // 世界可选提供按坐标查询地面类型的方法
      let fn = null;
      let thisArg = null;
      if (typeof world.getGroundKind === 'function') {
        fn = world.getGroundKind;
        thisArg = world;
      } else if (world.terrain && typeof world.terrain.groundKindAt === 'function') {
        fn = world.terrain.groundKindAt;
        thisArg = world.terrain;
      } else if (typeof world.groundKindAt === 'function') {
        fn = world.groundKindAt;
        thisArg = world;
      }
      if (fn) {
        try {
          const k = fn.call(thisArg, x, z);
          if (FOOTSTEP_KINDS.includes(k)) { this._kind = k; return this._kind; }
        } catch (e) { /* 忽略 */ }
      }

      // POI 启发式：村庄是木栈道，遗迹/圣所/界门是石头
      if (typeof world.nearestPoi === 'function') {
        try {
          const poi = world.nearestPoi(x, z, 45);
          if (poi && poi.type) {
            this._kind = poi.type === 'village' ? 'wood' : 'stone';
            return this._kind;
          }
        } catch (e) { /* 忽略 */ }
      }

      // 水边默认石滩
      if (Number.isFinite(world.waterLevel) && y < world.waterLevel + 1) {
        this._kind = 'stone';
        return this._kind;
      }
    }

    // 高程启发式（与 Player.js 的视觉判断保持一致）：高处是雪，其余草地
    if (y > 70 || x > 560) {
      this._kind = 'snow';
      return this._kind;
    }
    this._kind = 'grass';
    return this._kind;
  }

  /* ================================================================ *
   * 播放 API
   * ================================================================ */

  /**
   * 播放一次性音效。
   * @param {string} name 音效名（见 SFX_BUILDERS）
   * @param {{volume?:number, delay?:number, kind?:string}} opts
   * @returns {boolean} 是否真正触发（未启动 / 静音 / 未知音效 / 节流时为 false）
   */
  play(name, opts = {}) {
    if (!this._booted || this._failed || this._muted) return false;
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return false;

    const builderName = SFX_BUILDERS[name];
    if (!builderName) return false;
    const builder = this[builderName];
    if (typeof builder !== 'function') return false;

    const now = this._now();

    // 记录外部驱动的脚步：Player.js 自己也会调用 play('footstep')。
    // 即使这一次被节流掉，也说明有外部控制器在管理步频，update 应主动退让，
    // 避免两种步频叠加导致「一步两声」。
    if (name === 'footstep' && !this._autoFootstep) this._externalStepAt = now;

    const gap = SFX_THROTTLE[name] || 0;
    const last = this._lastSfx[name];
    if (gap > 0 && last !== undefined && now - last < gap) return false;
    this._lastSfx[name] = now;

    // 快照参数，避免构建器读取到外部可变选项
    const volume = clamp(
      typeof opts.volume === 'number' && Number.isFinite(opts.volume) ? opts.volume : 1,
      0, 2,
    );
    const delay = Number.isFinite(opts.delay) ? Math.max(0, opts.delay) : 0;
    const o = {
      volume,
      when: now + delay,
      kind: opts.kind,
    };

    try {
      const out = builder.call(this, o);
      if (out) this._trackVoice(out);
    } catch (e) {
      // 单个音效合成失败绝不能影响游戏
    }
    return true;
  }

  /* ================================================================ *
   * 一次性发声体管理（节点预算 / 自动回收）
   * ================================================================ */

  /**
   * 登记发声体。超过节点/声部预算时立刻拆掉（静默丢弃），
   * 保证「同时活跃的一次性节点 ≤ 40」。
   * @param {{nodes: AudioNode[], end: number}} voice
   */
  _trackVoice(voice) {
    if (!voice || !voice.nodes || voice.nodes.length === 0) return;
    const nodes = voice.nodes;
    if (this._liveNodes + nodes.length > MAX_LIVE_NODES || this._voices.size >= MAX_VOICES) {
      this._disposeNodes(nodes);
      return;
    }
    const entry = { nodes, end: voice.end || 0 };
    this._voices.add(entry);
    this._liveNodes += nodes.length;
  }

  _cleanupVoices() {
    if (this._voices.size === 0) return;
    const now = this._now();
    for (const voice of this._voices) {
      if (now >= voice.end) {
        this._disposeNodes(voice.nodes);
        this._liveNodes = Math.max(0, this._liveNodes - voice.nodes.length);
        this._voices.delete(voice);
      }
    }
  }

  _disposeNodes(nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      try { node.disconnect(); } catch (e) { /* 已断开则忽略 */ }
    }
  }

  /* ================================================================ *
   * 静音 / 音量 / 存档
   * ================================================================ */

  /** @returns {boolean} */
  get muted() { return this._muted; }

  set muted(v) {
    if (v) this.mute();
    else this.unmute();
  }

  mute() {
    if (this._muted) return;
    this._muted = true;
    if (this._master && this._ctx) this._rampMaster(0.0001, 0.12);
  }

  unmute() {
    if (!this._muted) return;
    this._muted = false;
    if (this._master && this._ctx) this._rampMaster(this._masterLevel, 0.18);
    // 解除静音后尽快恢复音乐，避免长时间空白
    if (this._booted) this._musicTimer = Math.min(this._musicTimer > 0 ? this._musicTimer : 0.6, 0.6);
  }

  /** @returns {boolean} 切换后的静音状态 */
  toggleMute() {
    if (this._muted) this.unmute();
    else this.mute();
    return this._muted;
  }

  _rampMaster(target, seconds) {
    const p = this._master.gain;
    const now = this._now();
    const value = clamp(target, 0.0001, 1);
    try {
      if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
      else p.cancelScheduledValues(now);
      p.setValueAtTime(Math.max(0.0001, p.value), now);
      p.exponentialRampToValueAtTime(value, now + Math.max(0.02, seconds));
    } catch (e) {
      // 极端浏览器下直接赋值即可
      try { p.value = value; } catch (e2) { /* 忽略 */ }
    }
  }

  /** 存档：只保存与音频相关的用户偏好。 */
  toJSON() {
    return {
      muted: this._muted,
      volume: this._masterLevel,
      ambience: this._intensity,
      musicMood: this._mood,
    };
  }

  /** 读档：任何字段缺失/非法都安全忽略。 */
  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    if (Number.isFinite(data.volume)) {
      this._masterLevel = clamp(data.volume, 0, 1);
      if (this._master && this._ctx) {
        this._rampMaster(this._muted ? 0.0001 : this._masterLevel, 0.15);
      }
    }
    if (Number.isFinite(data.ambience)) this.setAmbience(data.ambience);
    if (typeof data.musicMood === 'string') this.setMusicMood(data.musicMood);
    if (data.muted !== undefined) {
      if (data.muted) this.mute();
      else this.unmute();
    }
  }

  /* ================================================================ *
   * 页面可见性
   * ================================================================ */

  _onVisibility() {
    if (!this._ctx) return;
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        const p = this._ctx.suspend?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else {
        const p = this._ctx.resume?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ================================================================ *
   * 底层合成原语
   * ================================================================ */

  _now() {
    return this._ctx ? this._ctx.currentTime : 0;
  }

  /** 生成并缓存白噪声 buffer（用于风与噪声类打击音）。 */
  _makeNoiseBuffer(seconds = 2.0) {
    if (this._noiseBuf) return this._noiseBuf;
    const rate = this._ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this._ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  /**
   * 应用 ADSR 包络（指数段，避免爆音）。
   * @returns {number} 包络绝对结束时间
   */
  _applyEnv(param, t0, peak, attack, decay, hold, release, sustain) {
    const p = Math.max(0.00025, peak);
    const s = Math.max(0.0002, p * clamp(sustain, 0.0001, 1));
    const a = Math.max(0.004, attack);
    const d = Math.max(0, decay);
    const h = Math.max(0, hold);
    const r = Math.max(0.02, release);

    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(p, t0 + a);
    if (d > 0) param.exponentialRampToValueAtTime(s, t0 + a + d);
    else param.setValueAtTime(p, t0 + a);

    const holdEnd = t0 + a + d + h;
    if (h > 0) param.setValueAtTime(s, holdEnd);
    param.exponentialRampToValueAtTime(0.0001, holdEnd + r);
    return holdEnd + r;
  }

  /**
   * 播放一个带包络的振荡器音。
   * @param {object} o
   *   freq / endFreq / slide / type / detune
   *   attack / decay / hold / release / sustain / volume
   *   when / delay / pan
   *   filter: {type, freq, freqEnd, q}
   *   dest / send
   * @returns {{nodes: AudioNode[], end: number}}
   */
  _playTone(o = {}) {
    const ctx = this._ctx;
    const t0 = (Number.isFinite(o.when) ? o.when : this._now()) + (o.delay || 0);

    const attack = o.attack ?? 0.006;
    const decay = o.decay ?? 0.1;
    const hold = o.hold ?? 0;
    const release = o.release ?? 0.12;
    const sustain = o.sustain ?? 0.35;
    const total = attack + decay + hold + release;

    const nodes = [];
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const freq = Math.max(20, o.freq ?? 220);
    osc.frequency.setValueAtTime(freq, t0);
    if (Number.isFinite(o.endFreq)) {
      const slide = Math.max(0.01, o.slide ?? total * 0.9);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t0 + slide);
    }
    osc.detune.value = o.detune || 0;
    nodes.push(osc);

    const gain = ctx.createGain();
    const end = this._applyEnv(gain.gain, t0, o.volume ?? 0.1, attack, decay, hold, release, sustain);
    nodes.push(gain);

    let chain = osc;
    if (o.filter) {
      const filt = ctx.createBiquadFilter();
      filt.type = o.filter.type || 'lowpass';
      filt.frequency.setValueAtTime(Math.max(20, o.filter.freq || 1200), t0);
      if (Number.isFinite(o.filter.freqEnd)) {
        filt.frequency.exponentialRampToValueAtTime(
          Math.max(20, o.filter.freqEnd), t0 + total,
        );
      }
      filt.Q.value = o.filter.q ?? 0.7;
      chain.connect(filt);
      chain = filt;
      nodes.push(filt);
    }

    chain.connect(gain);
    chain = gain;

    // 立体声定位（可选）
    if (typeof o.pan === 'number' && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(o.pan, -1, 1);
      chain.connect(panner);
      chain = panner;
      nodes.push(panner);
    }

    const dest = o.dest || this._sfxGain;
    if (dest) chain.connect(dest);
    if (o.send) chain.connect(o.send);

    osc.start(t0);
    osc.stop(end + 0.03);
    return { nodes, end: end + 0.05 };
  }

  /**
   * 播放一段带滤波扫频的噪声（打击 / 风 / 火焰）。
   * @param {object} o duration / volume / attack / filterType / freq / freqEnd / q / when / delay / pan / dest / send
   * @returns {{nodes: AudioNode[], end: number}}
   */
  _playNoise(o = {}) {
    const ctx = this._ctx;
    if (!this._noiseBuf) this._makeNoiseBuffer(2.0);

    const t0 = (Number.isFinite(o.when) ? o.when : this._now()) + (o.delay || 0);
    const dur = Math.max(0.02, o.duration ?? 0.15);
    const attack = Math.max(0.001, o.attack ?? 0.004);

    const nodes = [];
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = false;
    nodes.push(src);

    let chain = src;
    const filterType = o.filterType || 'bandpass';
    if (filterType !== 'none') {
      const filt = ctx.createBiquadFilter();
      filt.type = filterType;
      filt.frequency.setValueAtTime(Math.max(20, o.freq || 1000), t0);
      if (Number.isFinite(o.freqEnd)) {
        filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
      }
      filt.Q.value = o.q ?? 0.8;
      chain.connect(filt);
      chain = filt;
      nodes.push(filt);
    }

    const gain = ctx.createGain();
    const peak = Math.max(0.00025, o.volume ?? 0.1);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    chain.connect(gain);
    chain = gain;
    nodes.push(gain);

    if (typeof o.pan === 'number' && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(o.pan, -1, 1);
      chain.connect(panner);
      chain = panner;
      nodes.push(panner);
    }

    const dest = o.dest || this._sfxGain;
    if (dest) chain.connect(dest);
    if (o.send) chain.connect(o.send);

    // 从缓存 buffer 的随机位置开始，避免重复听感
    const maxOffset = Math.max(0, this._noiseBuf.duration - dur - 0.05);
    src.start(t0, Math.random() * maxOffset, dur + 0.02);

    return { nodes, end: t0 + dur + 0.05 };
  }

  /** 合并多个合成片段为一个发声体。 */
  _merge(parts) {
    const nodes = [];
    let end = 0;
    for (const part of parts) {
      if (!part) continue;
      if (part.nodes) for (const n of part.nodes) nodes.push(n);
      if (part.end > end) end = part.end;
    }
    return { nodes, end };
  }

  /* ================================================================ *
   * 音效构建器
   * ================================================================ */

  /** 短促木石轻响 */
  _sfxUiClick(o) {
    const v = o.volume;
    const w = o.when;
    const r = rnd(0.92, 1.08);
    return this._merge([
      this._playNoise({
        when: w, duration: 0.05, volume: 0.11 * v,
        filterType: 'bandpass', freq: 1800 * r, q: 1.1, attack: 0.001,
      }),
      this._playTone({
        when: w, freq: 520 * r, endFreq: 340 * r, type: 'sine',
        attack: 0.002, decay: 0.045, hold: 0, release: 0.035, sustain: 0.15,
        volume: 0.09 * v,
      }),
    ]);
  }

  /** 低频上扬 + 金属泛音 */
  _sfxUiOpen(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 110, endFreq: 216, type: 'sine',
        attack: 0.04, decay: 0.3, hold: 0.12, release: 0.4, sustain: 0.55,
        volume: 0.15 * v,
      }),
      this._playTone({
        when: w + 0.02, freq: 880, type: 'triangle', detune: 6,
        attack: 0.05, decay: 0.35, hold: 0.05, release: 0.45, sustain: 0.2,
        volume: 0.04 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w + 0.04, freq: 1320, type: 'sine',
        attack: 0.07, decay: 0.4, hold: 0, release: 0.5, sustain: 0.1,
        volume: 0.025 * v, send: this._musicSend,
      }),
    ]);
  }

  /** ui_open 的反向：高频下行 + 低频收束 */
  _sfxUiClose(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 216, endFreq: 110, type: 'sine',
        attack: 0.02, decay: 0.22, hold: 0.05, release: 0.35, sustain: 0.4,
        volume: 0.13 * v,
      }),
      this._playTone({
        when: w, freq: 1320, endFreq: 880, type: 'triangle', detune: 5,
        attack: 0.02, decay: 0.28, hold: 0, release: 0.4, sustain: 0.1,
        volume: 0.032 * v, send: this._musicSend,
      }),
    ]);
  }

  /** 清脆两音上行 */
  _sfxPickup(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 587.33, type: 'triangle',   // D5
        attack: 0.004, decay: 0.08, hold: 0.02, release: 0.16, sustain: 0.15,
        volume: 0.09 * v,
      }),
      this._playTone({
        when: w + 0.07, freq: 880.0, type: 'triangle',  // A5
        attack: 0.004, decay: 0.12, hold: 0.04, release: 0.3, sustain: 0.12,
        volume: 0.075 * v, send: this._auroraDelay,
      }),
      this._playTone({
        when: w + 0.07, freq: 1760.0, type: 'sine',
        attack: 0.01, decay: 0.2, hold: 0, release: 0.35, sustain: 0.05,
        volume: 0.018 * v,
      }),
    ]);
  }

  /** 庄严的 Dm 三音和弦（任务完成 / 史诗横幅） */
  _sfxQuest(o) {
    const v = o.volume;
    const w = o.when;
    const notes = [146.83, 174.61, 220.0, 293.66]; // D3 F3 A3 D4
    const parts = [
      this._playTone({
        when: w, freq: 73.42, type: 'sine',          // D2 低音支点
        attack: 0.25, decay: 0.6, hold: 0.7, release: 1.6, sustain: 0.55,
        volume: 0.08 * v, send: this._musicSend,
      }),
    ];
    for (const freq of notes) {
      parts.push(this._playTone({
        when: w, freq, type: 'triangle',
        attack: 0.18, decay: 0.5, hold: 0.55, release: 1.6, sustain: 0.45,
        volume: 0.045 * v, send: this._musicSend,
      }));
    }
    return this._merge(parts);
  }

  /** 铜管感横幅：sawtooth + 低通 + 慢起音 */
  _sfxBanner(o) {
    const v = o.volume;
    const w = o.when;
    const notes = [146.83, 174.61, 220.0]; // D3 F3 A3
    const parts = [
      this._playTone({
        when: w, freq: 73.42, type: 'sine',
        attack: 0.14, decay: 0.4, hold: 0.35, release: 1.2, sustain: 0.6,
        volume: 0.07 * v,
      }),
    ];
    for (const freq of notes) {
      parts.push(this._playTone({
        when: w, freq, type: 'sawtooth',
        filter: { type: 'lowpass', freq: 1100, freqEnd: 700, q: 0.8 },
        attack: 0.16, decay: 0.5, hold: 0.35, release: 1.2, sustain: 0.5,
        volume: 0.032 * v, send: this._musicSend,
      }));
    }
    return this._merge(parts);
  }

  /** 圣火点亮：火焰噪声爆发 + 升调和弦 */
  _sfxShrine(o) {
    const v = o.volume;
    const w = o.when;
    const parts = [
      // 火焰 / 柴堆爆燃
      this._playNoise({
        when: w, duration: 0.9, volume: 0.1 * v,
        filterType: 'bandpass', freq: 1000, freqEnd: 280, q: 0.6, attack: 0.05,
      }),
      this._playNoise({
        when: w + 0.1, duration: 0.18, volume: 0.035 * v,
        filterType: 'bandpass', freq: 2600, q: 1.5, attack: 0.004,
      }),
      // 升腾和弦：Dm → A（D3 F3 A3 起，A3 D4 F4 A4 依次叠入）
      this._playTone({
        when: w, freq: 146.83, type: 'triangle',
        attack: 0.4, decay: 0.5, hold: 0.5, release: 1.8, sustain: 0.5,
        volume: 0.042 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w + 0.05, freq: 174.61, type: 'triangle',
        attack: 0.45, decay: 0.5, hold: 0.5, release: 1.8, sustain: 0.45,
        volume: 0.036 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w + 0.1, freq: 220.0, type: 'triangle',
        attack: 0.5, decay: 0.5, hold: 0.5, release: 1.8, sustain: 0.4,
        volume: 0.032 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w + 0.25, freq: 293.66, type: 'sine',
        attack: 0.3, decay: 0.4, hold: 0.3, release: 1.4, sustain: 0.3,
        volume: 0.025 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w + 0.4, freq: 440.0, type: 'sine',
        attack: 0.25, decay: 0.4, hold: 0.2, release: 1.2, sustain: 0.25,
        volume: 0.018 * v, send: this._musicSend,
      }),
    ];
    return this._merge(parts);
  }

  /** 低频冲击 + 噪声 */
  _sfxHit(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 110, endFreq: 44, type: 'sine',
        attack: 0.003, decay: 0.16, hold: 0, release: 0.1, sustain: 0.05,
        volume: 0.22 * v,
      }),
      this._playNoise({
        when: w, duration: 0.14, volume: 0.15 * v,
        filterType: 'lowpass', freq: 620, freqEnd: 220, q: 0.7, attack: 0.002,
      }),
      this._playNoise({
        when: w, duration: 0.045, volume: 0.045 * v,
        filterType: 'bandpass', freq: 2400, q: 1.2, attack: 0.001,
      }),
    ]);
  }

  /** 风声扫过：带通噪声快速扫频 */
  _sfxSwing(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playNoise({
        when: w, duration: 0.24, volume: 0.1 * v,
        filterType: 'bandpass', freq: 420, freqEnd: 2600, q: 1.2, attack: 0.03,
        pan: rnd(-0.25, 0.25),
      }),
      this._playNoise({
        when: w + 0.07, duration: 0.18, volume: 0.05 * v,
        filterType: 'bandpass', freq: 2400, freqEnd: 700, q: 1.5, attack: 0.02,
      }),
    ]);
  }

  /** 短促上滑 */
  _sfxJump(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 300, endFreq: 620, type: 'triangle',
        attack: 0.004, decay: 0.1, hold: 0.02, release: 0.12, sustain: 0.2,
        volume: 0.1 * v,
      }),
      this._playNoise({
        when: w, duration: 0.06, volume: 0.03 * v,
        filterType: 'bandpass', freq: 900, q: 0.8, attack: 0.002,
      }),
    ]);
  }

  /**
   * 不同地面的脚步。由 update 自动触发，也可手动：
   *   audio.play('footstep', { kind: 'snow' })
   */
  _sfxFootstep(o) {
    const kind = FOOTSTEP_KINDS.includes(o.kind) ? o.kind : 'stone';
    const v = o.volume;
    const w = o.when;
    const r = rnd(0.9, 1.1); // 每步轻微随机，避免机械重复

    switch (kind) {
      case 'grass':
        return this._merge([
          this._playNoise({
            when: w, duration: 0.12, volume: 0.1 * v,
            filterType: 'bandpass', freq: 620 * r, q: 0.6, attack: 0.006,
          }),
          this._playTone({
            when: w, freq: 92 * r, endFreq: 58, type: 'sine',
            attack: 0.004, decay: 0.05, hold: 0, release: 0.05, sustain: 0,
            volume: 0.06 * v,
          }),
        ]);

      case 'snow':
        return this._merge([
          this._playNoise({
            when: w, duration: 0.16, volume: 0.09 * v,
            filterType: 'bandpass', freq: 2300 * r, q: 0.45, attack: 0.012,
          }),
          this._playNoise({
            when: w + 0.01, duration: 0.05, volume: 0.03 * v,
            filterType: 'highpass', freq: 3600, q: 0.5, attack: 0.004,
          }),
        ]);

      case 'wood':
        return this._merge([
          this._playNoise({
            when: w, duration: 0.085, volume: 0.1 * v,
            filterType: 'bandpass', freq: 920 * r, q: 2.0, attack: 0.002,
          }),
          this._playTone({
            when: w, freq: 190 * r, endFreq: 150, type: 'triangle',
            attack: 0.003, decay: 0.06, hold: 0, release: 0.06, sustain: 0.05,
            volume: 0.05 * v,
          }),
        ]);

      case 'stone':
      default:
        return this._merge([
          this._playNoise({
            when: w, duration: 0.075, volume: 0.12 * v,
            filterType: 'bandpass', freq: 1300 * r, q: 0.85, attack: 0.002,
          }),
          this._playTone({
            when: w, freq: 104 * r, endFreq: 62, type: 'sine',
            attack: 0.002, decay: 0.055, hold: 0, release: 0.05, sustain: 0,
            volume: 0.07 * v,
          }),
        ]);
    }
  }

  /** 上行琶音（D4 → F4 → A4 → D5） */
  _sfxLevelup(o) {
    const v = o.volume;
    const w = o.when;
    const notes = [293.66, 349.23, 440.0, 587.33];
    const parts = [];
    notes.forEach((freq, i) => {
      parts.push(this._playTone({
        when: w + i * 0.09, freq, type: 'triangle',
        attack: 0.006, decay: 0.14, hold: 0.04, release: 0.5, sustain: 0.12,
        volume: 0.055 * v, send: this._musicSend,
      }));
    });
    // 高八度泛音收尾
    parts.push(this._playTone({
      when: w + 0.38, freq: 1174.66, type: 'sine',
      attack: 0.02, decay: 0.3, hold: 0.1, release: 0.8, sustain: 0.1,
      volume: 0.02 * v, send: this._auroraDelay,
    }));
    parts.push(this._playTone({
      when: w, freq: 146.83, type: 'sine',
      attack: 0.08, decay: 0.3, hold: 0.2, release: 0.9, sustain: 0.3,
      volume: 0.035 * v,
    }));
    return this._merge(parts);
  }

  /** 下行低频（死亡） */
  _sfxDeath(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 146.83, endFreq: 73.42, type: 'sawtooth',
        filter: { type: 'lowpass', freq: 420, q: 0.8 },
        attack: 0.05, decay: 0.6, hold: 0.3, release: 1.3, sustain: 0.45,
        volume: 0.1 * v, send: this._musicSend,
      }),
      this._playTone({
        when: w, freq: 110, endFreq: 48, type: 'sine',
        attack: 0.1, decay: 0.7, hold: 0.3, release: 1.5, sustain: 0.4,
        volume: 0.075 * v,
      }),
      this._playNoise({
        when: w, duration: 1.4, volume: 0.055 * v,
        filterType: 'lowpass', freq: 300, freqEnd: 90, q: 0.6, attack: 0.1,
      }),
    ]);
  }

  /** 金属轻响（拾取物品 / 行囊） */
  _sfxItem(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 1568, type: 'sine',
        attack: 0.002, decay: 0.16, hold: 0, release: 0.24, sustain: 0.06,
        volume: 0.04 * v, send: this._auroraDelay,
      }),
      this._playTone({
        when: w + 0.012, freq: 2093, type: 'sine',
        attack: 0.002, decay: 0.14, hold: 0, release: 0.2, sustain: 0.04,
        volume: 0.024 * v,
      }),
      this._playTone({
        when: w, freq: 784, type: 'triangle',
        attack: 0.003, decay: 0.07, hold: 0, release: 0.12, sustain: 0.05,
        volume: 0.025 * v,
      }),
    ]);
  }

  /** 低沉短音（错误） */
  _sfxError(o) {
    const v = o.volume;
    const w = o.when;
    return this._merge([
      this._playTone({
        when: w, freq: 140, endFreq: 108, type: 'sawtooth',
        filter: { type: 'lowpass', freq: 620, q: 0.9 },
        attack: 0.005, decay: 0.1, hold: 0.05, release: 0.18, sustain: 0.3,
        volume: 0.09 * v,
      }),
      this._playTone({
        when: w, freq: 70, endFreq: 60, type: 'sine',
        attack: 0.006, decay: 0.1, hold: 0.04, release: 0.16, sustain: 0.2,
        volume: 0.05 * v,
      }),
    ]);
  }
}
