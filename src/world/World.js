/**
 * World.js — 世界总装。
 *
 * 负责把地形、水域、植被、地标、POI、碰撞体、可行走平台组合成一个可探索的世界，
 * 并向其它系统暴露稳定的查询接口（高度、地面、碰撞、POI、交互物）。
 */
import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { Vegetation } from './Vegetation.js';
import { Landmarks } from './Landmarks.js';
import { Water } from '../render/Water.js';
import { WORLD, REGIONS, ROADS } from '../data/world.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.scene.add(this.group);

    this.terrain = null;
    this.vegetation = null;
    this.landmarks = null;
    this.water = null;

    this.pois = [];
    this.regions = REGIONS;
    this.roads = ROADS;

    /** @type {{x:number,z:number,r:number,landmark?:string}[]} */
    this.colliders = [];
    /** @type {{x:number,z:number,hw:number,hd:number,rotY:number,landmark?:string}[]} */
    this.boxColliders = [];
    /** @type {{x:number,z:number,hw:number,hd:number,rotY:number,y:number}[]} */
    this.platforms = [];
    /** @type {object[]} */
    this.interactables = [];
    this.landmarkGroup = null;
  }

  // ================================================================ 构建
  /**
   * @param {(pct:number, text:string)=>void} onProgress
   */
  async init(onProgress = () => {}) {
    onProgress(4, '推演九界的地脉……');
    this.terrain = new Terrain();
    this.group.add(this.terrain.group);

    onProgress(12, '隆起山脉与河谷……');
    // 分块构建玩家周围的地形（避免一次性阻塞）
    const spawn = WORLD.spawn;
    this.terrain.buildInitial(spawn.x, spawn.z, 2);
    await nextFrame();
    this.terrain.buildInitial(spawn.x, spawn.z, 3);
    await nextFrame();

    onProgress(28, '注入霜河与镜湖……');
    this.water = new Water(WORLD.waterLevel, 2900);
    this.water.mesh.position.x = 0;
    this.water.mesh.position.z = 0;
    this.group.add(this.water.mesh);
    await nextFrame();

    onProgress(40, '雕刻巨石与长屋……');
    this.landmarks = new Landmarks(this);
    await this.landmarks.loadBuilders();
    this.landmarkGroup = this.landmarks.build();
    this.group.add(this.landmarkGroup);
    await nextFrame();

    onProgress(62, '让森林生长……');
    this.vegetation = new Vegetation(this.terrain, {
      seed: WORLD.seed,
      quality: this.game.quality,
    });
    this.group.add(this.vegetation.build(this.game.quality));
    await nextFrame();

    onProgress(78, '点亮远方的火……');

    // 世界边界的隐形墙
    this.bounds = WORLD.half - 20;
    await nextFrame();
    onProgress(84, '世界已成型');
  }

  // ================================================================ 地形查询
  sampleHeight(x, z) { return this.terrain.sampleHeight(x, z); }

  sampleNormal(x, z) {
    return this.terrain.sampleNormal(x, z);
  }

  /**
   * 地面高度（含可行走平台）。
   * @param {number} x
   * @param {number} z
   * @param {number} fromY 角色当前高度：低于平台太多时忽略该平台（避免从桥下被吸上去）
   */
  groundAt(x, z, fromY = Infinity) {
    let h = this.terrain.sampleHeight(x, z);
    for (let i = 0; i < this.platforms.length; i++) {
      const p = this.platforms[i];
      if (fromY < p.y - 0.7) continue;
      const lx = x - p.x;
      const lz = z - p.z;
      const c = Math.cos(p.rotY);
      const s = Math.sin(p.rotY);
      const lX = lx * c - lz * s;
      const lZ = lx * s + lz * c;
      if (Math.abs(lX) <= p.hw && Math.abs(lZ) <= p.hd) {
        if (p.y > h) h = p.y;
      }
    }
    return h;
  }

  isWater(x, z) {
    return this.terrain.sampleHeight(x, z) < WORLD.waterLevel;
  }

  // ================================================================ 碰撞
  addCollider(c) { this.colliders.push(c); }
  addBoxCollider(b) { this.boxColliders.push(b); }
  addPlatform(p) { this.platforms.push(p); }

  /**
   * 把位置推出所有碰撞体（俯视圆柱 / 旋转矩形）。
   * @param {THREE.Vector3} pos 会被直接修改（x/z）
   * @param {number} radius 实体半径
   */
  resolveCollisions(pos, radius = 0.45) {
    // 圆形碰撞
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const rr = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = rr - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      }
    }
    // 矩形碰撞
    for (let i = 0; i < this.boxColliders.length; i++) {
      const b = this.boxColliders[i];
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      const c = Math.cos(b.rotY);
      const s = Math.sin(b.rotY);
      // 世界 → 局部
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const hw = b.hw + radius;
      const hd = b.hd + radius;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        const px = hw - Math.abs(lx);
        const pz = hd - Math.abs(lz);
        let nlx = lx;
        let nlz = lz;
        if (px < pz) nlx = Math.sign(lx || 1) * hw;
        else nlz = Math.sign(lz || 1) * hd;
        // 局部 → 世界
        pos.x = b.x + nlx * c + nlz * s;
        pos.z = b.z - nlx * s + nlz * c;
      }
    }
    // 世界边界
    const b = this.bounds ?? (WORLD.half - 20);
    pos.x = THREE.MathUtils.clamp(pos.x, -b, b);
    pos.z = THREE.MathUtils.clamp(pos.z, -b, b);
  }

  // ================================================================ POI
  addPoi(poi) {
    if (this.pois.some((p) => p.id === poi.id)) return;
    this.pois.push(poi);
  }

  getPoi(id) { return this.pois.find((p) => p.id === id) || null; }

  nearestPoi(x, z, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.pois) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ================================================================ 交互
  addInteractable(it) {
    if (!it.position) return null;
    if (this.interactables.some((i) => i.id === it.id)) return null;
    this.interactables.push(it);
    return it;
  }

  removeInteractable(id) {
    const i = this.interactables.findIndex((x) => x.id === id);
    if (i >= 0) this.interactables.splice(i, 1);
  }

  // ================================================================ 更新
  update(dt, elapsed) {
    const playerPos = this.game.player?.position || _zero;
    this.terrain.update(playerPos);
    this.landmarks.update(dt, elapsed);
    if (this.water) {
      this.water.update(dt, this.game.atmosphere?.palette, this.game.atmosphere?.sky?.sunDir);
    }
  }

  // ================================================================ 存档
  toJSON() {
    return {
      pois: this.pois.map((p) => (p.discovered ? p.id : null)).filter(Boolean),
      beacons: this.landmarks.toJSON(),
    };
  }

  fromJSON(data) {
    if (!data) return;
    for (const id of data.pois || []) {
      const poi = this.getPoi(id);
      if (poi) poi.discovered = true;
    }
    this.landmarks.fromJSON(data.beacons);
  }
}

const _zero = new THREE.Vector3();
