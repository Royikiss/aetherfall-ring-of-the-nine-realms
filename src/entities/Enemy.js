/**
 * Enemy.js — 敌人（尸鬼 / 霜狼）与它们的近战 AI。
 *
 * 设计：
 *  - 状态机：idle（游荡）→ chase（追击）→ attack（前摇/挥击）→ dead；
 *  - 移动使用世界碰撞（world.resolveCollisions）与地形高度；
 *  - 头顶血条使用 Sprite，始终朝向相机，性能开销极小；
 *  - 死亡时广播 enemy:killed，由 CombatSystem 处理掉落与清理。
 */
import * as THREE from 'three';
import { createHumanoid } from './Humanoid.js';
import { mergeColored, CHARACTER_MATERIAL, GLOW_MATERIAL } from '../core/GeomUtil.js';

const ENEMY_DEFS = {
  draugr: {
    name: '尸鬼', latin: 'DRAUGR', hp: 62, speed: 2.5, damage: 9,
    aggro: 20, attackRange: 2.6, attackCd: 1.5, height: 1.9,
    loot: ['draugr_bone', 'rune_fragment', 'iron_ore'],
  },
  frost_wolf: {
    name: '霜狼', latin: 'FROST WOLF', hp: 48, speed: 4.4, damage: 7,
    aggro: 24, attackRange: 2.5, attackCd: 1.15, height: 1.15,
    loot: ['wolf_pelt', 'wolf_jerky'],
  },
};

function makeWolf() {
  const p = {
    fur: 0xa9bcc4, furDark: 0x6d8088, belly: 0xd8e2e6, eye: 0x8fe8ff, claw: 0x2a2e30,
  };
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.62;
  group.add(body);

  const torso = mergeColored([
    { geo: new THREE.BoxGeometry(0.46, 0.44, 1.15), color: p.fur, y: 0.02 },
    { geo: new THREE.BoxGeometry(0.36, 0.3, 0.9), color: p.belly, y: -0.14 },
    { geo: new THREE.BoxGeometry(0.3, 0.34, 0.34), color: p.furDark, y: 0.18, z: 0.35 },
  ]);
  const torsoMesh = new THREE.Mesh(torso, CHARACTER_MATERIAL);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  body.add(torsoMesh);

  const head = new THREE.Group();
  head.position.set(0, 0.18, 0.62);
  body.add(head);
  const headMesh = new THREE.Mesh(mergeColored([
    { geo: new THREE.BoxGeometry(0.32, 0.3, 0.36), color: p.fur, z: 0.1 },
    { geo: new THREE.BoxGeometry(0.2, 0.16, 0.28), color: p.furDark, y: -0.06, z: 0.32 },
    { geo: new THREE.BoxGeometry(0.12, 0.08, 0.1), color: p.belly, y: 0.02, z: 0.46 },
    { geo: new THREE.ConeGeometry(0.08, 0.24, 4), color: p.furDark, x: 0.12, y: 0.24, z: 0.02, rz: -0.25 },
    { geo: new THREE.ConeGeometry(0.08, 0.24, 4), color: p.furDark, x: -0.12, y: 0.24, z: 0.02, rz: 0.25 },
    // 颈部冰晶
    { geo: new THREE.ConeGeometry(0.07, 0.3, 4), color: 0x9fd6e8, y: 0.18, z: -0.3, rx: -0.5 },
  ]), CHARACTER_MATERIAL);
  headMesh.castShadow = true;
  head.add(headMesh);
  const eyes = new THREE.Mesh(mergeColored([
    { geo: new THREE.BoxGeometry(0.045, 0.035, 0.02), color: p.eye, x: 0.08, y: 0.06, z: 0.28 },
    { geo: new THREE.BoxGeometry(0.045, 0.035, 0.02), color: p.eye, x: -0.08, y: 0.06, z: 0.28 },
  ]), GLOW_MATERIAL);
  head.add(eyes);

  const legs = [];
  const legPos = [
    [0.22, 0.42], [-0.22, 0.42], [0.22, -0.42], [-0.22, -0.42],
  ];
  for (const [x, z] of legPos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.05, z);
    const legMesh = new THREE.Mesh(mergeColored([
      { geo: new THREE.CylinderGeometry(0.075, 0.06, 0.5, 5), color: p.fur, y: -0.25 },
      { geo: new THREE.BoxGeometry(0.14, 0.1, 0.2), color: p.claw, y: -0.48, z: 0.04 },
    ]), CHARACTER_MATERIAL);
    legMesh.castShadow = true;
    pivot.add(legMesh);
    body.add(pivot);
    legs.push(pivot);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.12, -0.58);
  body.add(tailPivot);
  const tailMesh = new THREE.Mesh(mergeColored([
    { geo: new THREE.CylinderGeometry(0.07, 0.03, 0.55, 5), color: p.furDark, y: -0.1, z: -0.2, rx: 0.9 },
  ]), CHARACTER_MATERIAL);
  tailMesh.castShadow = true;
  tailPivot.add(tailMesh);

  return { group, body, head, legs, tail: tailPivot };
}

export class Enemy {
  /**
   * @param {{type:string, position:THREE.Vector3, game:object, id:string}} opts
   */
  constructor({ type, position, game, id }) {
    this.type = type;
    this.def = ENEMY_DEFS[type] || ENEMY_DEFS.draugr;
    this.game = game;
    this.id = id || `${type}_${Math.random().toString(36).slice(2, 7)}`;
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'idle';
    this.home = position.clone();
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.heading = Math.random() * Math.PI * 2;
    this.attackTimer = 0;
    this.attackWindup = 0;
    this.hasHit = false;
    this.phase = Math.random() * 10;
    this.wanderTimer = Math.random() * 3;
    this.wanderDir = new THREE.Vector2();
    this.deadTimer = 0;
    this.removed = false;

    this.object = new THREE.Group();
    this.object.name = this.id;
    this.object.position.copy(position);

    if (type === 'frost_wolf') {
      const wolf = makeWolf();
      this.model = wolf;
      this.object.add(wolf.group);
      this.radius = 0.75;
    } else {
      const humanoid = createHumanoid({
        height: this.def.height,
        palette: {
          cloth: 0x2a2c26, cloth2: 0x1c1e19, leather: 0x1e1f1a, leatherDark: 0x15160f,
          metal: 0x55584f, gold: 0x6e6240, skin: 0x7f8d7a, fur: 0x2a2a24,
          cape: 0x1a1a16, eye: 0x8fe8ff, blade: 0x7a8078,
        },
        cape: false, shield: false, weapon: 'axe', helmet: true, horns: false,
        bulk: 1.02, glowEyes: true,
      });
      this.model = humanoid;
      this.object.add(humanoid.group);
      this.radius = 0.55;
    }

    // 头顶血条
    this.hpBg = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0x15090a, transparent: true, opacity: 0.72, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    this.hpBg.scale.set(1.25, 0.11, 1);
    this.hpFg = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xb8483a, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    this.hpFg.scale.set(1.2, 0.07, 1);
    this.hpBarY = type === 'frost_wolf' ? 1.5 : 2.3;
    this.hpBg.position.y = this.hpBarY;
    this.hpFg.position.y = this.hpBarY;
    this.object.add(this.hpBg, this.hpFg);

    this._onGround = false;
    this._vy = 0;
    this._targetVec = new THREE.Vector3();
  }

  get eyeHeight() { return this.type === 'frost_wolf' ? 1.0 : 1.65; }

  takeDamage(amount, fromPos = null) {
    if (!this.alive) return false;
    this.hp -= amount;
    // 受击反馈：向后小退 + 变红由血条体现
    if (fromPos) {
      const d = _v1.copy(this.position).sub(fromPos).setY(0).normalize();
      this.velocity.addScaledVector(d, 3.2);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return true;
    }
    if (this.state === 'idle') this.state = 'chase';
    return false;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dead';
    this.deadTimer = 0;
    this.hpBg.visible = false;
    this.hpFg.visible = false;
    this.game.events.emit('enemy:killed', { id: this.id, type: this.type, position: this.position.clone() });
    this.game.systems?.audio?.play?.('hit', { volume: 0.55 });
  }

  update(dt, elapsed) {
    if (this.removed) return;
    if (!this.alive) {
      this.deadTimer += dt;
      // 倒地动画
      const k = Math.min(1, this.deadTimer * 2.4);
      this.object.rotation.z = k * (Math.PI / 2) * 0.92;
      this.object.position.y -= dt * 0.4 * (1 - k);
      const fade = Math.max(0, 1 - this.deadTimer / 2.6);
      this.object.traverse((o) => {
        if (o.material && o.material.transparent !== true) {
          // 共享材质不能单独改透明度，这里用缩放淡出代替
        }
      });
      if (this.deadTimer > 3.2) {
        this.object.scale.setScalar(Math.max(0.001, fade));
      }
      if (this.deadTimer > 4) this.removed = true;
      return;
    }

    const player = this.game.player;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    // ---- 状态机 ----
    if (this.state !== 'attack') {
      if (dist < this.def.aggro) this.state = 'chase';
      else if (dist > this.def.aggro * 1.6) this.state = 'idle';
    }

    let moveSpeed = 0;
    let dirX = 0;
    let dirZ = 0;

    if (this.state === 'chase') {
      if (dist < this.def.attackRange) {
        this.state = 'attack';
        this.attackWindup = 0;
        this.hasHit = false;
      } else {
        dirX = dx / (dist || 1);
        dirZ = dz / (dist || 1);
        moveSpeed = this.def.speed;
      }
    } else if (this.state === 'attack') {
      this.attackWindup += dt;
      this.attackTimer += dt;
      // 前摇 0.38s 后判定一次
      if (this.attackWindup > 0.38 && !this.hasHit) {
        this.hasHit = true;
        if (dist < this.def.attackRange + 0.6) {
          const stats = this.game.systems?.stats;
          stats?.damage?.(this.def.damage, this.type);
          this.game.events.emit('combat:playerHit', { by: this.type, damage: this.def.damage });
        }
        this.game.systems?.audio?.play?.('swing', { volume: 0.42 });
      }
      if (this.attackWindup > this.def.attackCd) {
        this.state = dist < this.def.aggro ? 'chase' : 'idle';
        this.attackWindup = 0;
        this.hasHit = false;
      }
    } else {
      // 游荡
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2.5 + Math.random() * 4;
        const a = Math.random() * Math.PI * 2;
        this.wanderDir.set(Math.cos(a), Math.sin(a));
        this.wanderMoving = Math.random() < 0.55;
      }
      const homeDist = Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z);
      if (this.wanderMoving && homeDist < 14) {
        dirX = this.wanderDir.x;
        dirZ = this.wanderDir.y;
        moveSpeed = this.def.speed * 0.28;
      }
    }

    // ---- 位移 ----
    const accel = this.state === 'chase' ? 14 : 5;
    const targetVx = dirX * moveSpeed;
    const targetVz = dirZ * moveSpeed;
    this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, dt * accel);
    this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, dt * accel);
    this.velocity.multiplyScalar(Math.pow(0.001, dt)); // 空气阻力，避免击退过远

    const nextX = this.position.x + this.velocity.x * dt;
    const nextZ = this.position.z + this.velocity.z * dt;
    this.position.x = nextX;
    this.position.z = nextZ;
    this.game.world.resolveCollisions(this.position, this.radius);

    // 分离：避免敌人重叠
    const enemies = this.game.systems?.combat?.enemies;
    if (enemies) {
      for (const other of enemies) {
        if (other === this || !other.alive) continue;
        const ox = this.position.x - other.position.x;
        const oz = this.position.z - other.position.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 1.6 && d2 > 0.0001) {
          const inv = (1.26 - Math.sqrt(d2)) * 0.5;
          const d = Math.sqrt(d2);
          this.position.x += (ox / d) * inv;
          this.position.z += (oz / d) * inv;
        }
      }
    }

    // 贴地
    const groundH = this.game.world.groundAt(this.position.x, this.position.z);
    this.position.y = groundH;
    this.object.position.set(this.position.x, groundH, this.position.z);

    // 朝向
    if (moveSpeed > 0.1) {
      const targetHeading = Math.atan2(dirX, dirZ);
      this.heading = this._lerpAngle(this.heading, targetHeading, Math.min(1, dt * 8));
    } else if (this.state === 'attack' || dist < 6) {
      const targetHeading = Math.atan2(dx, dz);
      this.heading = this._lerpAngle(this.heading, targetHeading, Math.min(1, dt * 6));
    }
    this.object.rotation.y = this.heading;

    // ---- 动画 ----
    this._animate(dt, elapsed, moveSpeed, dist);
    this._updateHpBar();
  }

  _lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  _animate(dt, elapsed, moveSpeed, dist) {
    this.phase += dt * (2.2 + moveSpeed * 1.5);
    const t = elapsed + this.phase;
    const wolf = this.type === 'frost_wolf';

    if (wolf) {
      const m = this.model;
      const swing = moveSpeed > 0.2 ? 0.55 : 0.08;
      const sp = this.phase * 1.6;
      m.legs[0].rotation.x = Math.sin(sp) * swing;
      m.legs[1].rotation.x = Math.sin(sp + Math.PI) * swing;
      m.legs[2].rotation.x = Math.sin(sp + Math.PI) * swing;
      m.legs[3].rotation.x = Math.sin(sp) * swing;
      m.body.position.y = 0.62 + (moveSpeed > 0.2 ? Math.abs(Math.sin(sp)) * 0.05 : Math.sin(t * 0.9) * 0.012);
      m.tail.rotation.y = Math.sin(t * 2.2) * 0.3;
      m.head.rotation.x = this.state === 'attack' ? -0.35 : Math.sin(t * 0.8) * 0.05;
      if (this.state === 'attack') {
        m.body.rotation.x = -0.16 * Math.sin(Math.min(1, this.attackWindup / 0.38) * Math.PI);
      } else {
        m.body.rotation.x *= 0.9;
      }
    } else {
      const j = this.model.joints;
      const moving = moveSpeed > 0.2;
      const swing = moving ? 0.62 : 0.0;
      const sp = this.phase * 1.7;
      if (moving) {
        j.hipL.rotation.x = Math.sin(sp) * swing;
        j.hipR.rotation.x = Math.sin(sp + Math.PI) * swing;
        j.kneeL.rotation.x = Math.max(0, Math.sin(sp + 0.7)) * 0.7;
        j.kneeR.rotation.x = Math.max(0, Math.sin(sp + Math.PI + 0.7)) * 0.7;
        j.shoulderL.rotation.x = Math.sin(sp + Math.PI) * swing * 0.8;
        j.shoulderR.rotation.x = Math.sin(sp) * swing * 0.7;
        j.torso.rotation.x = 0.08;
        j.torso.position.y = 0.12 + Math.abs(Math.sin(sp)) * 0.03;
      } else {
        j.hipL.rotation.x *= 0.9;
        j.hipR.rotation.x *= 0.9;
        j.kneeL.rotation.x *= 0.9;
        j.kneeR.rotation.x *= 0.9;
        j.shoulderL.rotation.x += (0.05 - j.shoulderL.rotation.x) * Math.min(1, dt * 5);
        j.shoulderR.rotation.x += (0.05 - j.shoulderR.rotation.x) * Math.min(1, dt * 5);
        j.torso.rotation.x = Math.sin(t * 0.9) * 0.02;
        j.torso.position.y = 0.12 + Math.sin(t * 1.2) * 0.01;
      }
      j.elbowL.rotation.x = -0.3;
      j.elbowR.rotation.x = -0.35;

      if (this.state === 'attack') {
        const w = Math.min(1, this.attackWindup / 0.38);
        // 举斧 → 下劈
        j.shoulderR.rotation.x = -2.1 * Math.sin(w * Math.PI * 0.5) + (this.attackWindup > 0.38 ? Math.min(1, (this.attackWindup - 0.38) * 6) * 2.6 : 0);
        j.torso.rotation.y = -0.25 * w;
      } else {
        j.torso.rotation.y *= 0.9;
      }
      j.head.rotation.y = Math.sin(t * 0.7) * 0.1;
    }

    // 面向玩家（攻击/追击时更聚焦）
    if (dist < 8 && this.state !== 'idle') {
      this.object.rotation.y = this.heading;
    }
  }

  _updateHpBar() {
    const k = Math.max(0, this.hp / this.maxHp);
    this.hpFg.scale.x = 1.2 * k;
    // 左对齐：Sprite 以中心缩放，因此需要偏移
    this.hpFg.position.x = -(1.2 - 1.2 * k) / 2;
  }

  dispose() {
    this.object.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

const _v1 = new THREE.Vector3();

export { ENEMY_DEFS };
