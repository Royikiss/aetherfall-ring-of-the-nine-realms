/**
 * ThirdPersonCamera.js — 第三人称弹簧臂相机。
 *
 * 特性：
 *  - 鼠标 / QE 控制环绕角，滚轮缩放，带阻尼；
 *  - 弹簧臂遇地形与建筑碰撞体自动收短，避免穿墙；
 *  - 支持"电影模式"：标题界面环绕世界地标；
 *  - 受击/落地抖动。
 */
import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;

    this.yaw = Math.PI;
    this.pitch = 0.2;
    this.distance = 6.4;
    this.targetDistance = 6.4;
    this.minDistance = 2.4;
    this.maxDistance = 13;
    this.currentDistance = 6.4;

    this.sensitivity = 0.0023;
    this.offsetY = 1.55;

    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._smoothPos = new THREE.Vector3(0, 10, 20);
    this._shake = 0;
    this._shakeTime = 0;
    this._cinematic = null;
    this._initialized = false;
  }

  /** 进入电影模式（标题界面） */
  setCinematic({ center, radius = 120, height = 55, speed = 0.05, lookAt = null, startAngle = null }) {
    this._cinematic = {
      center: center.clone(),
      radius,
      height,
      speed,
      lookAt: (lookAt || center).clone(),
      angle: startAngle != null ? startAngle : Math.random() * Math.PI * 2,
    };
    this._initialized = false;
  }

  clearCinematic() {
    this._cinematic = null;
    this._initialized = false;
  }

  shake(amount = 0.25) {
    this._shake = Math.max(this._shake, amount);
  }

  /** 立即对齐到玩家背后（重生/读档时） */
  snapBehind() {
    const player = this.game.player;
    if (!player) return;
    this.yaw = player.heading + Math.PI;
    this._initialized = false;
  }

  update(dt, elapsed) {
    if (this._cinematic) {
      this._updateCinematic(dt);
      return;
    }
    const player = this.game.player;
    if (!player) return;
    const input = this.game.input;
    const modal = this.game.ui?.isOpen?.();

    // ---- 输入 ----
    if (input.locked && !modal) {
      this.yaw -= input.mouse.dx * this.sensitivity;
      this.pitch += input.mouse.dy * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.42, 1.08);
    }
    if (!modal) {
      if (input.isDown('camLeft')) this.yaw += dt * 1.8;
      if (input.isDown('camRight')) this.yaw -= dt * 1.8;
      if (input.mouse.wheel !== 0) {
        this.targetDistance = THREE.MathUtils.clamp(
          this.targetDistance + input.mouse.wheel * 0.9,
          this.minDistance,
          this.maxDistance,
        );
      }
    }
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 8);

    // ---- 平滑跟随目标 ----
    const px = player.position.x;
    const py = player.position.y;
    const pz = player.position.z;
    this._target.set(px, py + this.offsetY, pz);

    if (!this._initialized) {
      this._smoothPos.copy(this._target);
      this._initialized = true;
    }
    // 目标点轻微滞后，产生"重量感"
    this._smoothPos.x += (this._target.x - this._smoothPos.x) * Math.min(1, dt * 14);
    this._smoothPos.y += (this._target.y - this._smoothPos.y) * Math.min(1, dt * 9);
    this._smoothPos.z += (this._target.z - this._smoothPos.z) * Math.min(1, dt * 14);

    // ---- 弹簧臂 ----
    const cosP = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cosP;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cosP;

    let allowed = this.distance;
    const steps = 7;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * this.distance;
      const sx = this._smoothPos.x + dirX * t;
      const sy = this._smoothPos.y + dirY * t;
      const sz = this._smoothPos.z + dirZ * t;
      // 地形
      const groundH = this.game.world.groundAt(sx, sz, 1e9);
      let blocked = sy < groundH + 0.55;
      // 建筑碰撞体
      if (!blocked) {
        for (const c of this.game.world.colliders) {
          const dx = sx - c.x;
          const dz = sz - c.z;
          if (dx * dx + dz * dz < (c.r + 0.35) * (c.r + 0.35)) { blocked = true; break; }
        }
      }
      if (blocked) {
        allowed = Math.max(3.4, t - 0.5);
        break;
      }
    }
    this.currentDistance += (allowed - this.currentDistance) * Math.min(1, dt * 18);

    this._desired.set(
      this._smoothPos.x + dirX * this.currentDistance,
      this._smoothPos.y + dirY * this.currentDistance,
      this._smoothPos.z + dirZ * this.currentDistance,
    );

    // ---- 抖动 ----
    let shakeX = 0;
    let shakeY = 0;
    if (this._shake > 0.001) {
      this._shakeTime += dt * 34;
      shakeX = Math.sin(this._shakeTime * 1.7) * this._shake * 0.35;
      shakeY = Math.cos(this._shakeTime * 2.3) * this._shake * 0.35;
      this._shake *= Math.pow(0.002, dt);
    }

    // 镜头抬升：贴着坡面时宁可抬高也不要把镜头怼到角色脸上
    const groundAtCam = this.game.world.groundAt(this._desired.x, this._desired.z, 1e9);
    if (this._desired.y < groundAtCam + 0.9) this._desired.y = groundAtCam + 0.9;

    this.camera.position.set(this._desired.x + shakeX, this._desired.y + shakeY, this._desired.z);
    this.camera.lookAt(this._smoothPos);
  }

  _updateCinematic(dt) {
    const c = this._cinematic;
    c.angle += dt * c.speed;
    const x = c.center.x + Math.cos(c.angle) * c.radius;
    const z = c.center.z + Math.sin(c.angle) * c.radius;
    const y = c.center.y + c.height;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(c.lookAt);
  }
}
