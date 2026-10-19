/**
 * Engine.js — 渲染器、相机、主循环与性能自适应。
 *
 * 职责边界：
 *  - 只管"怎么画"和"什么时候更新"，不关心游戏规则；
 *  - Game 通过 engine.setUpdate(fn) 注入每帧逻辑；
 *  - 内置自适应分辨率：帧率过低时自动降低 pixelRatio，保证开放世界的流畅度。
 */
import * as THREE from 'three';
import { createEnvironment, applyEnvironment } from '../render/Materials.js';

const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1.0,
    antialias: false,
    shadows: false,
    shadowSize: 512,
    exposure: 1.12,
  },
  medium: {
    pixelRatio: 1.25,
    antialias: true,
    shadows: true,
    shadowSize: 1024,
    exposure: 1.12,
  },
  high: {
    pixelRatio: 1.75,
    antialias: true,
    shadows: true,
    shadowSize: 2048,
    exposure: 1.12,
  },
};

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'high';
    this.preset = QUALITY_PRESETS[this.quality];

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.15, 1900);
    this.camera.position.set(0, 6, 14);

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.dt = 0;
    this.running = false;
    this.paused = false;

    this.updateFn = null;
    this.renderFn = null;
    this._raf = 0;

    this.stats = {
      fps: 60,
      frameMs: 16.7,
      drawCalls: 0,
      triangles: 0,
      pixelRatio: 1,
      autoRatio: 1,
    };
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._adaptTimer = 0;
    this._maxPixelRatio = this.preset.pixelRatio;

    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
  }

  init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.preset.exposure;
    renderer.shadowMap.enabled = this.preset.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.stats.pixelRatio = renderer.getPixelRatio();

    // 场景基础：雾与背景（具体颜色由 Sky/Atmosphere 每帧更新）
    this.scene.fog = new THREE.FogExp2(0x2b3340, 0.0016);
    this.scene.background = new THREE.Color(0x0a0f16);

    // 程序化环境反射（金属、冰面需要）
    try {
      const env = createEnvironment(renderer);
      this.scene.environment = env;
      applyEnvironment(env);
      this.envTexture = env;
    } catch (err) {
      console.warn('[Engine] environment map failed', err);
    }

    window.addEventListener('resize', this._onResize);
    this._onResize();

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[Engine] WebGL context lost, pausing render');
      this.pause();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[Engine] WebGL context restored');
      this.resume();
    });

    return this;
  }

  /** 每帧逻辑（由 Game 注入） */
  setUpdate(fn) { this.updateFn = fn; }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  pause() { this.paused = true; }
  resume() {
    this.paused = false;
    this.clock.getDelta(); // 丢弃暂停期间的时间
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);

    const raw = this.clock.getDelta();
    // 上限 1/20s：切后台或卡顿后不会产生"瞬移"
    this.dt = Math.min(raw, 0.05);
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.elapsed += this.dt;

    const t0 = performance.now();
    try {
      this.updateFn?.(this.dt, this.elapsed);
    } catch (err) {
      console.error('[Engine] update error', err);
      this.running = false;
    }
    this.renderFn?.(this.dt, this.elapsed);

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;

    const frameMs = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.92 + frameMs * 0.08;
    this._trackFps(raw);
  }

  _trackFps(raw) {
    this._fpsAccum += raw;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.stats.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._adapt();
    }
  }

  /**
   * 自适应分辨率：低帧率降采样，高帧率恢复（带迟滞，避免抖动）。
   */
  _adapt() {
    if (!this.autoQuality) return;
    const fps = this.stats.fps;
    this._adaptTimer += 0.5;
    if (fps < 40 && this.stats.pixelRatio > 0.85) {
      this.stats.autoRatio = Math.max(0.8, this.stats.autoRatio - 0.1);
      this.renderer.setPixelRatio(this.stats.autoRatio * Math.min(window.devicePixelRatio || 1, 1));
      this.stats.pixelRatio = this.renderer.getPixelRatio();
      this._adaptTimer = 0;
    } else if (fps > 58 && this._adaptTimer > 4 && this.stats.pixelRatio < this._maxPixelRatio) {
      this.stats.autoRatio = Math.min(1, this.stats.autoRatio + 0.05);
      this.renderer.setPixelRatio(this.stats.autoRatio * Math.min(window.devicePixelRatio || 1, this._maxPixelRatio));
      this.stats.pixelRatio = this.renderer.getPixelRatio();
      this._adaptTimer = 0;
    }
  }

  setAutoQuality(v) {
    this.autoQuality = !!v;
    this.stats.autoRatio = 1;
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.stats.pixelRatio = this.renderer.getPixelRatio();
  }

  /** 世界坐标 → 屏幕坐标（用于 HUD 标记） */
  projectToScreen(vec3, out = { x: 0, y: 0, visible: false }) {
    const v = _tmpVec.copy(vec3).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = v.z < 1 && v.z > -1;
    return out;
  }
}

const _tmpVec = new THREE.Vector3();
