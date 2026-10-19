/**
 * Landmarks.js — 把 data/world.js 的地标数据变成真实的世界。
 *
 * 职责：
 *  - 动态加载 architecture/ 下的建筑生成器（缺失时优雅降级为占位结构，方便分工开发）；
 *  - 摆放、缩放、旋转、贴地；
 *  - 注册碰撞体 / 可行走平台 / POI；
 *  - 创建圣火火焰、界门光晕、NPC、宝箱、可拾取物；
 *  - 提供圣火点亮逻辑（任务系统的核心目标）。
 */
import * as THREE from 'three';
import { LANDMARKS, EXTRA_POIS, WORLD } from '../data/world.js';
import { COL } from '../render/Materials.js';
import { Kit } from './architecture/Kit.js';
import { Npc } from '../entities/Npc.js';
import { Rng } from '../core/Rng.js';
import { getItem } from '../data/items.js';

/** 建筑生成器的加载表（按需 import，提高启动速度、容错缺失模块） */
const BUILDER_TABLE = {
  cathedral: ['./Cathedral.js', 'buildCathedral'],
  greatHall: ['./GreatHall.js', 'buildGreatHall'],
  tower: ['./Tower.js', 'buildTower'],
  gate: ['./Gate.js', 'buildGate'],
  colossus: ['./Colossus.js', 'buildColossus'],
  worldTree: ['./WorldTree.js', 'buildWorldTree'],
  bridge: ['./Bridge.js', 'buildBridge'],
  ruins: ['./Ruins.js', 'buildRuins'],
  village: ['./Village.js', 'buildVillage'],
};

// ------------------------------------------------------------------ 发光贴图
function makeGlowTexture(inner = 'rgba(255,225,160,1)', mid = 'rgba(255,150,60,0.55)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW_TEX = { warm: null, cold: null };
function glowTex(kind) {
  if (!GLOW_TEX[kind]) {
    GLOW_TEX[kind] = kind === 'cold'
      ? makeGlowTexture('rgba(210,250,255,1)', 'rgba(90,190,255,0.5)')
      : makeGlowTexture();
  }
  return GLOW_TEX[kind];
}

/** 圣火 / 界门光效 */
class Flame {
  constructor(position, { cold = false, scale = 1 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.cold = cold;
    this.baseScale = scale;
    this.lit = false;
    this.intensity = 0;

    const tex = glowTex(cold ? 'cold' : 'warm');
    this.outer = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.outer.scale.setScalar(14 * scale);
    this.inner = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: cold ? 0xa8e8ff : 0xffe0a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.inner.scale.setScalar(6 * scale);
    this.group.add(this.outer, this.inner);

    this.light = new THREE.PointLight(cold ? 0x8fd8ef : 0xffa25a, 0, 90 * scale, 1.6);
    this.group.add(this.light);

    this.seed = Math.random() * 100;
  }

  setLit(lit) { this.lit = lit; }

  update(dt, t) {
    const target = this.lit ? 1 : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.6);
    const flick = 0.86 + 0.14 * Math.sin(t * 9 + this.seed) * Math.sin(t * 3.3 + this.seed * 2);
    this.outer.material.opacity = this.intensity * 0.62 * flick;
    this.inner.material.opacity = this.intensity * 0.95 * flick;
    this.outer.scale.setScalar((13 + Math.sin(t * 5 + this.seed) * 1.5) * this.baseScale * (0.5 + this.intensity * 0.5));
    this.inner.scale.setScalar((5.5 + Math.sin(t * 8 + this.seed) * 0.8) * this.baseScale);
    this.light.intensity = this.intensity * 26 * flick;
    this.group.visible = this.intensity > 0.01;
  }
}

export class Landmarks {
  constructor(world) {
    this.world = world;
    this.game = world.game;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.builders = {};
    this.flames = new Map();
    this.npcs = [];
    this.instances = [];
    this.rng = new Rng(WORLD.seed ^ 0x51ed270b);
    this.missing = [];
  }

  /** 动态加载建筑生成器 */
  async loadBuilders() {
    const jobs = Object.entries(BUILDER_TABLE).map(async ([key, [file, fn]]) => {
      try {
        const mod = await import(`./architecture/${file}`);
        if (typeof mod[fn] === 'function') {
          this.builders[key] = mod[fn];
        } else {
          this.missing.push(`${file}#${fn}`);
        }
      } catch (err) {
        this.missing.push(`${file} (${err.message})`);
      }
    });
    await Promise.all(jobs);
    if (this.missing.length) {
      console.warn('[Landmarks] 缺失建筑生成器，将使用占位结构：', this.missing);
    }
  }

  /** 构建全部地标 */
  build() {
    for (const def of LANDMARKS) {
      try {
        this._buildOne(def);
      } catch (err) {
        console.error('[Landmarks] build failed:', def.id, err);
      }
    }
    // 无几何的额外发现点
    for (const poi of EXTRA_POIS) {
      this.world.addPoi({
        ...poi,
        discovered: false,
      });
    }
    return this.group;
  }

  _buildOne(def) {
    const terrain = this.world.terrain;
    const builder = this.builders[def.builder];

    let object;
    if (builder) {
      object = builder({
        seed: (WORLD.seed + def.id.length * 7919) >>> 0,
        scale: def.scale || 1,
        variant: def.variant ?? 0,
        beacon: !!def.beacon,
        ...(def.bridge || {}),
      });
    } else {
      object = this._fallback(def);
    }

    // ---- 落地高度 ----
    let baseY = terrain.sampleHeight(def.x, def.z);
    if (def.bridge) {
      // 桥：沿桥轴方向采样两端河岸，甲板高于水面且与岸齐平
      const len = def.bridge.length || 96;
      const c = Math.cos(def.rotY || 0);
      const sn = Math.sin(def.rotY || 0);
      const bankA = terrain.sampleHeight(def.x - c * len * 0.5, def.z + sn * len * 0.5);
      const bankB = terrain.sampleHeight(def.x + c * len * 0.5, def.z - sn * len * 0.5);
      const deckY = Math.max(WORLD.waterLevel + 5.5, bankA + 1.2, bankB + 1.2);
      baseY = deckY - (def.bridge.height || 34);
    }
    object.position.set(def.x, baseY, def.z);
    object.rotation.y = def.rotY || 0;
    // 建筑生成器已把 opts.scale 烘焙进几何（group.scale 恒为 1），此处不再缩放
    object.name = def.id;
    object.userData.landmarkId = def.id;
    this.group.add(object);
    this.instances.push({ def, object, baseY });

    // ---- 碰撞体（局部 → 世界）----
    // 注意：碰撞体/平台坐标已是最终尺度的局部坐标
    const cos = Math.cos(def.rotY || 0);
    const sin = Math.sin(def.rotY || 0);
    const toWorld = (lx, lz) => ({
      x: def.x + (lx * cos + lz * sin),
      z: def.z + (-lx * sin + lz * cos),
    });
    for (const c of object.userData.colliders || []) {
      const w = toWorld(c.x, c.z);
      this.world.addCollider({ x: w.x, z: w.z, r: c.r, landmark: def.id });
    }
    for (const b of object.userData.boxColliders || []) {
      const w = toWorld(b.x, b.z);
      this.world.addBoxCollider({
        x: w.x, z: w.z,
        hw: b.hw, hd: b.hd,
        rotY: (def.rotY || 0) + (b.rotY || 0),
        landmark: def.id,
      });
    }
    // ---- 可行走平台 ----
    for (const p of object.userData.platforms || []) {
      const w = toWorld(p.x, p.z);
      this.world.addPlatform({
        x: w.x, z: w.z,
        hw: p.hw, hd: p.hd,
        rotY: (def.rotY || 0) + (p.rotY || 0),
        y: baseY + p.y,
      });
    }

    // ---- POI ----
    if (def.poi) {
      this.world.addPoi({
        id: `poi_${def.id}`,
        landmarkId: def.id,
        name: def.name,
        latin: def.latin,
        type: def.poi.type,
        x: def.x,
        z: def.z,
        radius: def.poi.radius,
        discovered: false,
      });
    }

    // ---- 圣火 / 界门光效 ----
    if (def.beacon && object.userData.beaconPoint) {
      const bp = object.userData.beaconPoint;
      const flamePos = new THREE.Vector3(bp.x, bp.y, bp.z);
      const flame = new Flame(flamePos, { scale: def.scale || 1 });
      object.add(flame.group);
      this.flames.set(def.id, flame);
    }
    if (def.builder === 'gate' && object.userData.beaconPoint) {
      const bp = object.userData.beaconPoint;
      const flame = new Flame(new THREE.Vector3(bp.x, bp.y, bp.z), { cold: true, scale: 1.6 });
      object.add(flame.group);
      this.flames.set(`${def.id}_portal`, flame);
    }

    // ---- 可交互内容 ----
    this._populate(def, object, baseY);
  }

  /** 占位结构：确保缺少建筑模块时世界依然完整可玩 */
  _fallback(def) {
    const kit = new Kit({ seed: 7 });
    const r = (def.flatten || 30) * 0.25;
    const h = 14 + this.rng.next() * 16;
    kit.cyl(r * 0.7, r, h, 8, 0, h / 2, 0, { color: COL.stoneDark });
    kit.cyl(r * 0.5, r * 0.72, 3, 8, 0, h + 1.5, 0, { color: COL.stoneLight });
    kit.spire(0, 0, { h: 10, r: r * 0.7, y0: h + 3, color: COL.stoneCold });
    kit.collider(0, 0, r * 0.9);
    const group = kit.build({ name: `fallback_${def.id}` });
    group.userData.beaconPoint = { x: 0, y: h + 8, z: 0 };
    return group;
  }

  /** NPC / 宝箱 / 拾取物 / 圣火交互点 */
  _populate(def, object, baseY) {
    const world = this.world;
    const addInteractable = (it) => world.addInteractable(it);

    // 建筑外沿尺寸：所有可交互物都必须放在建筑体之外，否则会被碰撞体推出去
    const bb = object.userData.bounds;
    const ext = bb
      ? Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z))
      : Math.max(14, (def.flatten || 30) * 0.55);
    const rot = def.rotY || 0;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    // 局部 (lateral, along) → 世界坐标；along 为建筑正面（本地 +Z）方向
    const placePos = (lateral, along) => {
      const x = def.x + lateral * c + along * sn;
      const z = def.z - lateral * sn + along * c;
      return { x, z, y: world.groundAt(x, z, 1e9) };
    };

    // 圣火（交互点放在塔基正前方，避免被塔身碰撞体挡住）
    if (def.beacon) {
      const p = placePos(0, ext * 0.65 + 5);
      addInteractable({
        id: `beacon_${def.id}`,
        kind: 'beacon',
        position: new THREE.Vector3(p.x, p.y, p.z),
        radius: 12,
        label: '点燃圣火',
        once: false,
        onInteract: () => this.lightBeacon(def.id),
      });
    }

    // 界门
    if (def.builder === 'gate') {
      const gp = placePos(0, ext * 0.6 + 6);
      addInteractable({
        id: `gate_${def.id}`,
        kind: 'gate',
        position: new THREE.Vector3(gp.x, gp.y, gp.z),
        radius: 14,
        label: '触碰界门',
        once: false,
        onInteract: () => {
          this.game.events.emit('gate:touched', { id: def.id });
          this.game.ui?.toast('界门在你掌下低鸣，仿佛九界正在呼吸。', { kind: 'quest', latin: 'THE GATE STIRS' });
          this.game.systems?.audio?.play?.('shrine', { volume: 0.7 });
        },
      });
    }

    // NPC 布点
    const npcTable = {
      great_hall: [
        { id: 'warden', name: '守门人 · 赫尔加', latin: 'HELGA THE WARDEN', lines: ['又一个从灰烬里爬出来的英灵。', '金宫的门永远为战死者敞开——但火种已熄，长夜将至。', '去点燃四座圣火灯塔吧，让九界之环重新闭合。'] },
      ],
      village_midgard: [
        { id: 'herbalist', name: '草药师 · 阿斯克', latin: "ASK THE HERBALIST", lines: ['你身上的灰烬味，比霜还冷。', '北边的石环附近长着贤者草，若你愿意替我采五株……', '我会把伊登的苹果分你一个。'] },
      ],
      forge_ruins: [
        { id: 'smith', name: '矮人匠 · 布洛克', latin: 'BROKK THE SMITH', lines: ['锻炉冷了八百年。', '你以为一把剑就能挡住诸神黄昏？', '去找符文石。火焰需要引信，而符文石就是引信。'] },
      ],
    };
    const spawnNpc = (cfg, lateral) => {
      const p = placePos(lateral, ext + 14);
      const npc = new Npc({
        name: cfg.name, latin: cfg.latin, lines: cfg.lines,
        position: new THREE.Vector3(p.x, p.y, p.z),
        heading: Math.atan2(def.x - p.x, def.z - p.z),
      });
      this.group.add(npc.object);
      this.npcs.push(npc);
      world.addInteractable({
        id: `npc_${cfg.id}`,
        kind: 'npc',
        position: new THREE.Vector3(p.x, p.y, p.z),
        radius: 6,
        label: `交谈 · ${cfg.name}`,
        once: false,
        onInteract: () => {
          this.game.events.emit('npc:talked', { id: cfg.id, name: cfg.name });
          this.game.ui?.showDialogue({
            speaker: cfg.name,
            latin: cfg.latin,
            lines: cfg.lines,
            glyph: 'ᚱ',
          });
          this.game.systems?.audio?.play?.('ui_open', { volume: 0.5 });
        },
      });
    };
    for (const [key, list] of Object.entries(npcTable)) {
      if (def.id !== key) continue;
      let i = 0;
      for (const cfg of list) {
        spawnNpc(cfg, (i - (list.length - 1) / 2) * 8);
        i++;
      }
    }

    // 宝箱（每座地标 1 个，部分地标）
    const chestIds = ['great_hall', 'cathedral', 'stone_circle', 'forge_ruins', 'watch_tower'];
    if (chestIds.includes(def.id)) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      const cp = placePos(side * (ext + 10), (this.rng.next() - 0.5) * 16);
      const chest = this._makeChest(cp.x, cp.y + 0.05, cp.z);
      this.group.add(chest);
      addInteractable({
        id: `chest_${def.id}`,
        kind: 'chest',
        position: new THREE.Vector3(cp.x, cp.y, cp.z),
        radius: 4.2,
        label: '打开宝箱',
        once: true,
        onInteract: () => {
          const loot = [];
          const pool = ['rune_fragment', 'iron_ore', 'wolf_pelt', 'mead_horn', 'frost_tonic', 'rune_draught', 'sage_herb'];
          const n = this.rng.int(1, 3);
          for (let k = 0; k < n; k++) {
            const id = pool[this.rng.int(0, pool.length - 1)];
            if (this.game.systems?.inventory?.add?.(id, 1)) loot.push(id);
          }
          if (this.rng.chance(0.35)) {
            if (this.game.systems?.inventory?.add?.('rune_stone', 1)) loot.push('rune_stone');
          }
          this.game.events.emit('inventory:changed', { item: null, count: loot.length, action: 'loot' });
          this.game.ui?.toast(loot.length ? '宝箱中泛着微光。' : '宝箱已空。', { kind: 'item', latin: 'TREASURE' });
          this.game.systems?.audio?.play?.('item', { volume: 0.7 });
          if (chest.userData.lid) chest.userData.lid.rotation.x = -1.1;
          chest.userData.opened = true;
        },
      });
    }

    // 拾取物：地标周围散落 2–4 个
    const pickupCount = def.beacon ? 2 : this.rng.int(1, 3);
    for (let i = 0; i < pickupCount; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = ext + 8 + this.rng.next() * 22;
      const px = def.x + Math.cos(a) * r;
      const pz = def.z + Math.sin(a) * r;
      const py = world.groundAt(px, pz, 1e9);
      if (py < WORLD.waterLevel + 0.5) continue;
      const id = this.rng.pick(['sage_herb', 'rune_fragment', 'mead_horn', 'iron_ore', 'wolf_pelt', 'rune_stone']);
      this._makePickup(id, px, py, pz);
    }
  }

  _makeChest(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.35, metalness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.0), wood);
    body.position.y = 0.45;
    body.castShadow = true;
    body.receiveShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.36, 1.05), wood);
    lid.position.set(0, 0.95, 0);
    lid.castShadow = true;
    const bands = new THREE.Group();
    for (const bx of [-0.5, 0, 0.5]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.06), metal);
      band.position.set(bx, 0.5, 0);
      bands.add(band);
    }
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.1), metal);
    latch.position.set(0, 0.72, 0.55);
    group.add(body, lid, bands, latch);
    group.userData.lid = lid;
    group.userData.opened = false;
    return group;
  }

  _makePickup(itemId, x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y + 0.7, z);
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffd98a, emissive: 0xffb44a, emissiveIntensity: 2.2,
        roughness: 0.25, metalness: 0.4, toneMapped: false,
      }),
    );
    crystal.castShadow = false;
    group.add(crystal);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex('warm'), color: 0xffc870, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    sprite.scale.setScalar(3.4);
    group.add(sprite);
    this.group.add(group);
    group.userData.phase = this.rng.next() * 10;
    this._pickupVisuals = this._pickupVisuals || [];
    this._pickupVisuals.push(group);

    const world = this.world;
    world.addInteractable({
      id: `pickup_${itemId}_${x.toFixed(0)}_${z.toFixed(0)}`,
      kind: 'pickup',
      position: new THREE.Vector3(x, y, z),
      radius: 3.4,
      label: '拾取',
      once: true,
      onInteract: () => {
        const ok = this.game.systems?.inventory?.add?.(itemId, 1);
        if (!ok) {
          this.game.ui?.toast('行囊已满。', { kind: 'danger', latin: 'INVENTORY FULL' });
          return;
        }
        this.game.events.emit('item:collected', { id: itemId, count: 1 });
        this.game.systems?.audio?.play?.('pickup', { volume: 0.7 });
        const itemName = getItem(itemId)?.name || itemId;
        this.game.ui?.toast(`获得 ${itemName}`, {
          kind: 'item', latin: 'ACQUIRED', glyph: 'ᛞ',
        });
        group.visible = false;
        group.userData.collected = true;
      },
    });
  }

  /** 点亮圣火 */
  lightBeacon(id) {
    const flame = this.flames.get(id);
    if (flame?.lit) {
      this.game.ui?.toast('圣火已在燃烧。', { kind: 'info', latin: 'KINDLED' });
      return false;
    }
    flame?.setLit(true);
    if (!this.litBeacons) this.litBeacons = new Set();
    this.litBeacons.add(id);
    this.game.events.emit('shrine:lit', { id, name: id });
    this.game.ui?.banner('圣火重燃', '九界之环又近了一分', { latin: 'THE BEACON BURNS', kind: 'shrine' });
    this.game.systems?.audio?.play?.('shrine', { volume: 0.9 });
    return true;
  }

  isBeaconLit(id) { return !!this.litBeacons?.has(id); }

  update(dt, elapsed) {
    for (const flame of this.flames.values()) flame.update(dt, elapsed);
    for (const npc of this.npcs) npc.update(dt, elapsed);
    if (this._pickupVisuals) {
      for (const g of this._pickupVisuals) {
        if (g.userData.collected) continue;
        g.rotation.y += dt * 1.2;
        g.position.y += Math.sin(elapsed * 2 + g.userData.phase) * dt * 0.25;
      }
    }
  }

  toJSON() {
    return { litBeacons: Array.from(this.litBeacons || []) };
  }

  fromJSON(data) {
    if (!data) return;
    this.litBeacons = new Set(data.litBeacons || []);
    for (const id of this.litBeacons) this.flames.get(id)?.setLit(true);
  }
}
