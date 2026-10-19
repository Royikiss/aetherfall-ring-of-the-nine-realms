/**
 * CombatSystem.js — 玩家近战、敌人管理与战斗掉落。
 *
 * 设计：
 *  - 玩家攻击：以角色朝向为扇形判定（距离 + 角度），命中多个敌人；
 *  - 敌人：从世界 POI 附近生成，死亡后延迟重生，保持世界的"活"感；
 *  - 掉落：击杀直接获得材料/经验，并通过事件通知任务系统。
 */
import * as THREE from 'three';
import { Enemy, ENEMY_DEFS } from '../entities/Enemy.js';

const ATTACK_RANGE = 3.2;
const ATTACK_ARC = Math.PI * 0.55;
const ATTACK_DAMAGE = 24;

/** 刷怪点：[类型, 中心 x, 中心 z, 数量, 半径] */
const SPAWN_TABLE = [
  ['draugr', 438, 246, 3, 26],     // 低语石环
  ['draugr', -690, -210, 3, 24],   // 锻炉废址
  ['draugr', -520, -640, 3, 26],   // 古坟岗
  ['draugr', 268, -486, 1, 20],    // 巨像脚下
  ['frost_wolf', 566, -262, 3, 34],// 霜崖瞭望塔
  ['frost_wolf', 760, 60, 2, 40],  // 东境冰原
  ['frost_wolf', 320, -700, 2, 36],// 北部雪原
];

export class CombatSystem {
  static id = 'combat';

  constructor(game) {
    this.game = game;
    /** @type {Enemy[]} */
    this.enemies = [];
    this.spawnPoints = [];
    this.attackCooldown = 0;
    this.totalKills = 0;
    this._pendingRespawn = [];
  }

  init() {
    this._spawnAll();

    this.game.events.on('enemy:killed', ({ id, type, position }) => this._onKilled(id, type, position));
    this.game.events.on('player:died', () => {
      // 玩家死亡时敌人停止追击（由 Enemy 自身状态机自然达成）
    });
  }

  _spawnAll() {
    for (const [type, cx, cz, count, radius] of SPAWN_TABLE) {
      this.spawnPoints.push({ type, cx, cz, count, radius });
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * radius;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        this.spawnEnemy(type, x, z);
      }
    }
  }

  spawnEnemy(type, x, z) {
    const altitude = this.game.world.sampleHeight(x, z);
    if (altitude < this.game.world.terrain.waterLevel + 0.4) return null;
    const pos = new THREE.Vector3(x, altitude, z);
    const enemy = new Enemy({
      type,
      position: pos,
      game: this.game,
      id: `${type}_${Math.round(x)}_${Math.round(z)}_${this.enemies.length}`,
    });
    this.game.scene.add(enemy.object);
    this.enemies.push(enemy);
    return enemy;
  }

  /** 从玩家位置向前的扇形内寻找目标 */
  _pickTargets() {
    const player = this.game.player;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const hits = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.position.x - player.position.x;
      const dz = e.position.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > ATTACK_RANGE + e.radius) continue;
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dot < Math.cos(ATTACK_ARC)) continue;
      hits.push(e);
    }
    return hits;
  }

  tryAttack() {
    const player = this.game.player;
    if (!player || this.attackCooldown > 0) return;
    if (!player.playAttack()) return;
    this.attackCooldown = 0.58;

    const stats = this.game.systems?.stats;
    // 注意：stats.damage 是"受击方法"，攻击力字段是 stats.attack
    const bonus = stats?.attack || stats?.attackDamage || stats?.weaponDamage || 0;
    const damage = ATTACK_DAMAGE + Math.max(0, bonus - 20) * 0.6;

    // 判定略微延迟，与挥砍动画的中段对齐
    setTimeout(() => {
      const targets = this._pickTargets();
      let hitAny = false;
      for (const e of targets) {
        hitAny = true;
        const dead = e.takeDamage(damage + Math.random() * 6, player.position);
        if (dead) {
          this.totalKills++;
          this.game.systems?.stats?.addXp?.(14);
        }
      }
      if (hitAny) {
        this.game.systems?.audio?.play?.('hit', { volume: 0.7 });
        this.game.camera3p?.shake?.(0.12);
        this.game.events.emit('combat:hit', { count: targets.length });
      } else {
        this.game.systems?.audio?.play?.('swing', { volume: 0.35 });
      }
    }, 130);
  }

  _onKilled(id, type, position) {
    const def = ENEMY_DEFS[type];
    const inventory = this.game.systems?.inventory;

    // 战利品
    if (def?.loot?.length && inventory) {
      const count = Math.random() < 0.45 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const itemId = def.loot[Math.floor(Math.random() * def.loot.length)];
        if (inventory.add(itemId, 1)) {
          const name = inventory.items.find((it) => it.id === itemId)?.def?.name || itemId;
          this.game.ui?.toast(`拾取 ${name}`, { kind: 'item', latin: 'SLAIN', glyph: 'ᛏ' });
        }
      }
    }
    this.game.systems?.stats?.addXp?.(def ? 10 : 8);

    // 延迟重生（玩家远离时）
    const point = this.spawnPoints.find((p) => (
      Math.hypot(p.cx - position.x, p.cz - position.z) < p.radius + 40
    ));
    if (point) {
      this._pendingRespawn.push({
        timer: 110 + Math.random() * 50,
        type: point.type,
        x: position.x,
        z: position.z,
      });
    }
  }

  update(dt) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    const input = this.game.input;
    const modal = this.game.ui?.isOpen?.() || this.game.ui?.isDialogueOpen?.();
    const canAct = this.game.started && !modal && !this.game.systems?.stats?.isDead;

    if (canAct && (input.mouse.left || input.wasPressed('attack'))) {
      this.tryAttack();
    }

    // 敌人
    for (const e of this.enemies) {
      if (!e.removed) e.update(dt, this.game.engine.elapsed);
    }

    // 重生
    for (let i = this._pendingRespawn.length - 1; i >= 0; i--) {
      const r = this._pendingRespawn[i];
      r.timer -= dt;
      if (r.timer <= 0) {
        const d = Math.hypot(this.game.player.position.x - r.x, this.game.player.position.z - r.z);
        if (d > 90) {
          this.spawnEnemy(r.type, r.x, r.z);
          this._pendingRespawn.splice(i, 1);
        } else {
          r.timer = 12;
        }
      }
    }

    // 清理
    if (this.enemies.length > 0 && this.enemies.filter((e) => e.removed).length > 2) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        if (this.enemies[i].removed) {
          this.enemies[i].dispose();
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  toJSON() {
    return { totalKills: this.totalKills };
  }

  fromJSON(data) {
    if (data) this.totalKills = data.totalKills || 0;
  }
}
