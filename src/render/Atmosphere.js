/**
 * Atmosphere.js — 时间、光照、雾与天空的统一调度。
 *
 * 每帧：
 *  1) 采样天空调色板；
 *  2) 更新太阳/月亮方向与颜色；
 *  3) 同步平行光阴影相机到玩家附近（保证 2048 阴影贴图覆盖主要视野）；
 *  4) 调整雾色/雾密度/曝光，让昼夜过渡自然。
 */
import * as THREE from 'three';
import { Sky, sampleSkyPalette, sunDirectionAt } from './Sky.js';

export const DAY_LENGTH = 900; // 一整天 15 分钟

export class Atmosphere {
  constructor(scene, renderer, { shadows = true } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.shadowsEnabled = shadows;
    this.timeOfDay = 0.7;
    this.palette = sampleSkyPalette(this.timeOfDay);

    this.sky = new Sky();
    this.sky.addTo(scene);

    // ---- 太阳 ----
    this.sun = new THREE.DirectionalLight(0xffd9a0, 3);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.near = 20;
    cam.far = 620;
    cam.left = -110;
    cam.right = 110;
    cam.top = 110;
    cam.bottom = -110;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    // ---- 月光补光（夜间可视性） ----
    this.moon = new THREE.DirectionalLight(0x8fa8d8, 0.35);
    scene.add(this.moon);
    scene.add(this.moon.target);

    // ---- 半球光 + 环境光 ----
    this.hemi = new THREE.HemisphereLight(0x5a7d9e, 0x2a241c, 0.55);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x4a4a58, 0.28);
    scene.add(this.ambient);

    // ---- 雾 ----
    this.fog = new THREE.FogExp2(0x6a6258, 0.0017);
    scene.fog = this.fog;

    this._sunDir = new THREE.Vector3();
    this._shadowTarget = new THREE.Vector3();
    this.exposure = 1.1;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} focus 玩家位置（阴影相机跟随）
   * @param {boolean} advance 是否推进时间
   */
  update(dt, camera, focus, advance = true) {
    if (advance) {
      this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
    }
    const p = sampleSkyPalette(this.timeOfDay);
    this.palette = p;

    sunDirectionAt(this.timeOfDay, this._sunDir);

    // ---- 天空 ----
    this.sky.update(dt, this.timeOfDay, camera);

    // ---- 太阳 ----
    const elevation = this._sunDir.y;
    const dayFactor = THREE.MathUtils.smoothstep(elevation, -0.12, 0.22);
    this.sun.position.copy(focus).addScaledVector(this._sunDir, 300);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunIntensity * 2.15;
    this.sun.castShadow = this.shadowsEnabled && elevation > 0.06;
    if (this.sun.shadow.camera) {
      // 让阴影相机围绕玩家
      this._shadowTarget.copy(focus);
      this.sun.shadow.camera.updateProjectionMatrix();
    }

    // ---- 月光 ----
    this.moon.position.copy(focus).addScaledVector(this._sunDir, -300);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 0.95 * (1 - dayFactor);

    // ---- 半球/环境 ----
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = 0.5 + dayFactor * 0.4;
    this.ambient.color.copy(p.ambient);
    this.ambient.intensity = p.ambientIntensity * (1.0 + 0.85 * (1 - dayFactor));

    // ---- 雾与曝光 ----
    this.fog.color.copy(p.fog);
    this.fog.density = p.fogDensity;
    this.scene.background.copy(p.fog);

    const targetExposure = p.exposure;
    this.exposure += (targetExposure - this.exposure) * Math.min(1, dt * 0.8);
    this.renderer.toneMappingExposure = this.exposure;

    // 给外部读取的光照信息
    this.sunFactor = dayFactor;
  }
}
