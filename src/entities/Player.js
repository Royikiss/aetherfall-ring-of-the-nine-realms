/**
 * Player.js — 玩家角色（英灵）。
 *
 * 职责：
 *  - 相机相对的移动（走/跑/跳）、重力、地面贴合、碰撞；
 *  - 程序化骨骼动画（待机/行走/奔跑/跳跃/挥剑）；
 *  - 耐力消耗、脚步事件、位置广播（地图/任务系统依赖）。
 *
 * 坐标约定：object.position 位于脚底；角色面向 +Z，rotation.y = heading。
 */
import * as THREE from 'three';
import { createHumanoid } from './Humanoid.js';

const WALK_SPEED = 5.2;
const RUN_SPEED = 9.4;
const SWIM_SPEED = 3.0;
const ACCEL_GROUND = 26;
const ACCEL_AIR = 8;
const JUMP_VELOCITY = 8.2;
const GRAVITY = -24;
const SPRINT_COST = 17;

export class Player {
  constructor(game) {
    this.game = game;

    const humanoid = createHumanoid({
      height: 1.86,
      palette: {
        cloth: 0x2b3346,
        cloth2: 0x6e2323,
        leather: 0x4a3626,
        leatherDark: 0x2e2117,
        metal: 0x9aa0a6,
        gold: 0xc9a45c,
        goldBright: 0xf4e0a3,
        skin: 0xd8b090,
        fur: 0x6b5a44,
        cape: 0x6e2323,
        eye: 0x9fe8ff,
        blade: 0xc8d2d8,
      },
      cape: true,
      shield: true,
      weapon: 'sword',
      helmet: true,
      horns: true,
      bulk: 1.0,
    });
    this.humanoid = humanoid;
    this.joints = humanoid.joints;
    this.object = new THREE.Group();
    this.object.name = 'player';
    this.object.add(humanoid.group);

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.heading = Math.PI;
    this.onGround = false;
    this.isMoving = false;
    this.isSprinting = false;
    this.isSwimming = false;
    this.speed = 0;

    this.phase = 0;
    this.attackTimer = -1;
    this.attackDuration = 0.52;
    this.hitFlash = 0;

    this._lastMoveEmit = 0;
    this._stepTimer = 0;
    this._lastSafe = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this.spawnAt(game.world?.spawnPoint || new THREE.Vector3(0, 0, 0));
  }

  /** 放置到世界坐标（自动贴地） */
  spawnAt(pos) {
    const ground = this.game.world.groundAt(pos.x, pos.z, 1e9);
    this.position.set(pos.x, ground + 0.05, pos.z);
    this.velocity.set(0, 0, 0);
    this.object.position.copy(this.position);
    this._lastSafe.copy(this.position);
    this.onGround = true;
  }

  get eyePosition() {
    this._tmp.set(this.position.x, this.position.y + 1.55, this.position.z);
    return this._tmp;
  }

  /** 触发一次挥剑动画（由 CombatSystem 调用） */
  playAttack() {
    if (this.attackTimer >= 0) return false;
    this.attackTimer = 0;
    this.game.systems?.audio?.play?.('swing', { volume: 0.55 });
    return true;
  }

  update(dt) {
    const game = this.game;
    const input = game.input;
    const camera = game.camera3p;
    const stats = game.systems?.stats;
    const modal = game.ui?.isOpen?.();
    const canControl = input.enabled && !modal;

    // ---------------------------------------------------------- 输入 → 期望速度
    const axis = canControl ? input.axis() : { x: 0, y: 0 };
    const yaw = camera?.yaw ?? Math.PI;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // 相机前向（水平）与右向
    this._forward.set(-sin, 0, -cos);
    this._right.set(cos, 0, -sin);
    this._wish
      .copy(this._forward).multiplyScalar(axis.y)
      .addScaledVector(this._right, axis.x);

    const wishLen = this._wish.length();
    if (wishLen > 1) this._wish.divideScalar(wishLen);
    const wantsMove = wishLen > 0.01;

    // ---------------------------------------------------------- 速度与耐力
    const wantSprint = canControl && input.isDown('sprint') && axis.y > 0.1;
    const underwater = game.world.terrain.sampleHeight(this.position.x, this.position.z) < game.world.waterLevel - 0.35
      && this.position.y < game.world.waterLevel + 0.6;
    this.isSwimming = underwater;

    let targetSpeed = this.isSwimming ? SWIM_SPEED : WALK_SPEED;
    this.isSprinting = false;
    if (wantSprint && !this.isSwimming && stats?.stamina > 1) {
      const ok = stats.consumeStamina(SPRINT_COST * dt);
      if (ok) {
        targetSpeed = RUN_SPEED;
        this.isSprinting = true;
      }
    }
    if (this.attackTimer >= 0) targetSpeed *= 0.35;
    const speedMult = stats?.moveSpeedMult;
    if (typeof speedMult === 'number' && Number.isFinite(speedMult)) targetSpeed *= speedMult;

    const targetVx = this._wish.x * targetSpeed * (wantsMove ? 1 : 0);
    const targetVz = this._wish.z * targetSpeed * (wantsMove ? 1 : 0);
    const accel = this.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const blend = Math.min(1, dt * accel);
    this.velocity.x += (targetVx - this.velocity.x) * blend;
    this.velocity.z += (targetVz - this.velocity.z) * blend;

    // 上坡减速
    if (this.onGround && wantsMove) {
      const n = game.world.sampleNormal(this.position.x, this.position.z);
      const slopePenalty = THREE.MathUtils.clamp(1 - (1 - n.y) * 1.6, 0.45, 1);
      this.velocity.x *= slopePenalty;
      this.velocity.z *= slopePenalty;
    }

    // ---------------------------------------------------------- 跳跃与重力
    if (canControl && input.wasPressed('jump') && this.onGround && !this.isSwimming) {
      this.velocity.y = JUMP_VELOCITY;
      this.onGround = false;
      stats?.consumeStamina(12);
      game.systems?.audio?.play?.('jump', { volume: 0.45 });
    }
    if (this.isSwimming) {
      this.velocity.y += (0 - this.velocity.y) * Math.min(1, dt * 4);
      // 缓慢浮向水面
      const surface = game.world.waterLevel + 0.2;
      if (this.position.y < surface) this.position.y += (surface - this.position.y) * Math.min(1, dt * 1.6);
    } else {
      this.velocity.y += GRAVITY * dt;
    }

    // ---------------------------------------------------------- 位移与碰撞
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    game.world.resolveCollisions(this.position, 0.45);

    const ground = game.world.groundAt(this.position.x, this.position.z, this.position.y + 0.6);
    if (this.position.y <= ground + 0.001 || (this.velocity.y <= 0 && this.position.y < ground + 0.12)) {
      this.position.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
    // 掉出世界保护
    if (this.position.y < -80) {
      this.position.copy(this._lastSafe);
      this.velocity.set(0, 0, 0);
    }
    if (this.onGround && !this.isSwimming) {
      const dist = this.position.distanceToSquared(this._lastSafe);
      if (dist > 4) this._lastSafe.copy(this.position);
    }

    // ---------------------------------------------------------- 朝向
    this.isMoving = Math.hypot(this.velocity.x, this.velocity.z) > 0.6;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.isMoving && this.attackTimer < 0) {
      const targetHeading = Math.atan2(this.velocity.x, this.velocity.z);
      this.heading = this._lerpAngle(this.heading, targetHeading, Math.min(1, dt * 10));
    }
    this.object.position.copy(this.position);
    this.object.rotation.y = this.heading;

    // ---------------------------------------------------------- 动画
    if (this.attackTimer >= 0) {
      this.attackTimer += dt;
      if (this.attackTimer > this.attackDuration) this.attackTimer = -1;
    }
    this._animate(dt);

    // ---------------------------------------------------------- 脚步
    this._stepTimer -= dt * (0.55 + this.speed * 0.22);
    if ((this.isMoving || this.isSwimming) && this._stepTimer <= 0) {
      this._stepTimer = 1;
      if (!this.isSwimming) {
        const groundSlope = game.world.terrain.sampleHeight(this.position.x, this.position.z);
        const snowy = this.position.y > 70 || this.position.x > 560;
        game.systems?.audio?.play?.('footstep', {
          volume: this.isSprinting ? 0.34 : 0.22,
          kind: snowy ? 'snow' : this.position.y < game.world.waterLevel + 1 ? 'stone' : 'grass',
        });
      }
    }

    // ---------------------------------------------------------- 位置广播
    this._lastMoveEmit += dt;
    if (this._lastMoveEmit > 0.25) {
      this._lastMoveEmit = 0;
      game.events.emit('player:moved', {
        x: this.position.x,
        z: this.position.z,
        y: this.position.y,
        chunk: `${Math.floor(this.position.x / 200)},${Math.floor(this.position.z / 200)}`,
      });
    }
  }

  _lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  _animate(dt) {
    const j = this.joints;
    const moving = this.isMoving;
    this.phase += dt * (1.4 + this.speed * 1.45);
    const sp = this.phase * 1.15;
    const runK = THREE.MathUtils.clamp((this.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
    const swing = moving ? 0.5 + runK * 0.45 : 0;

    if (!this.onGround && !this.isSwimming) {
      // 跳跃姿态
      j.hipL.rotation.x += (-0.55 - j.hipL.rotation.x) * Math.min(1, dt * 8);
      j.hipR.rotation.x += (0.35 - j.hipR.rotation.x) * Math.min(1, dt * 8);
      j.kneeL.rotation.x += (0.9 - j.kneeL.rotation.x) * Math.min(1, dt * 8);
      j.kneeR.rotation.x += (0.35 - j.kneeR.rotation.x) * Math.min(1, dt * 8);
      j.shoulderL.rotation.x += (-0.55 - j.shoulderL.rotation.x) * Math.min(1, dt * 8);
      j.shoulderR.rotation.x += (-0.35 - j.shoulderR.rotation.x) * Math.min(1, dt * 8);
    } else if (moving) {
      j.hipL.rotation.x = Math.sin(sp) * swing;
      j.hipR.rotation.x = Math.sin(sp + Math.PI) * swing;
      j.kneeL.rotation.x = Math.max(0, Math.sin(sp + 0.8)) * (0.5 + runK * 0.5);
      j.kneeR.rotation.x = Math.max(0, Math.sin(sp + Math.PI + 0.8)) * (0.5 + runK * 0.5);
      j.shoulderL.rotation.x = Math.sin(sp + Math.PI) * swing * 0.75;
      j.shoulderR.rotation.x = Math.sin(sp) * swing * 0.75;
      j.elbowL.rotation.x = -0.45 - runK * 0.5;
      j.elbowR.rotation.x = -0.4 - runK * 0.45;
      j.torso.rotation.x = 0.06 + runK * 0.13;
      j.torso.rotation.y = Math.sin(sp) * 0.06;
      j.torso.position.y = 0.12 + Math.abs(Math.sin(sp)) * 0.035;
      j.head.rotation.x = -0.04 - runK * 0.06;
    } else {
      // 待机呼吸
      j.hipL.rotation.x *= Math.max(0, 1 - dt * 8);
      j.hipR.rotation.x *= Math.max(0, 1 - dt * 8);
      j.kneeL.rotation.x *= Math.max(0, 1 - dt * 8);
      j.kneeR.rotation.x *= Math.max(0, 1 - dt * 8);
      j.shoulderL.rotation.x += (0.06 - j.shoulderL.rotation.x) * Math.min(1, dt * 6);
      j.shoulderR.rotation.x += (0.06 - j.shoulderR.rotation.x) * Math.min(1, dt * 6);
      j.elbowL.rotation.x += (-0.3 - j.elbowL.rotation.x) * Math.min(1, dt * 6);
      j.elbowR.rotation.x += (-0.28 - j.elbowR.rotation.x) * Math.min(1, dt * 6);
      j.torso.rotation.x = Math.sin(this.phase * 0.55) * 0.012;
      j.torso.rotation.y = Math.sin(this.phase * 0.32) * 0.02;
      j.torso.position.y = 0.12 + Math.sin(this.phase * 0.55) * 0.008;
      j.head.rotation.x = 0;
      j.head.rotation.y = Math.sin(this.phase * 0.3) * 0.12;
    }

    // 攻击动作覆盖右臂
    if (this.attackTimer >= 0) {
      const t = this.attackTimer / this.attackDuration;
      // 0..0.3 抬起，0.3..0.55 下劈，之后回位
      let armX;
      if (t < 0.3) armX = -2.3 * (t / 0.3);
      else if (t < 0.55) armX = -2.3 + 3.3 * ((t - 0.3) / 0.25);
      else armX = 1.0 * (1 - (t - 0.55) / 0.45);
      j.shoulderR.rotation.x = armX;
      j.shoulderR.rotation.z = -0.25 * Math.sin(t * Math.PI);
      j.elbowR.rotation.x = -0.35 + Math.sin(t * Math.PI) * 0.5;
      j.torso.rotation.y = -0.35 * Math.sin(t * Math.PI);
      j.torso.rotation.x = 0.05 + 0.12 * Math.sin(t * Math.PI);
    } else {
      j.shoulderR.rotation.z *= 0.9;
      j.torso.rotation.y *= 0.85;
    }

    // 斗篷随速度飘动
    if (j.cape) {
      const target = 0.12 + Math.min(1, this.speed / RUN_SPEED) * 0.55 + Math.sin(this.phase * 0.9) * 0.04;
      j.cape.rotation.x += (target - j.cape.rotation.x) * Math.min(1, dt * 5);
    }
  }

  toJSON() {
    return {
      x: this.position.x, y: this.position.y, z: this.position.z,
      heading: this.heading,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.position.set(data.x, data.y, data.z);
    this.heading = data.heading ?? 0;
    this.velocity.set(0, 0, 0);
    this.object.position.copy(this.position);
    this.object.rotation.y = this.heading;
    this._lastSafe.copy(this.position);
  }
}
