/**
 * WorldTree.js — 世界树 · 尤克特拉希尔（Yggdrasil）
 *
 * 模块职责：
 *   生成全地图可见的终极地标：约 214m 高的巨树、盘根错节的三层根系、
 *   三层递归分叉的枝干、多层发光叶簇树冠、刻满符文的树干，
 *   以及树下的三层石台、四方台阶与献祭台阶 + 祭坛。
 *
 * 对外 API：
 *   buildWorldTree(opts) -> THREE.Group
 *     opts = { scale = 1, seed = 1, variant = 0 }
 *       variant 0：金绿（默认）
 *       variant 1：霜青（约顿海姆的霜冻面向）
 *       variant 2：余烬（诸神黄昏面向）
 *   meta = { id, label, radius, height }
 *
 * 坐标约定：
 *   - 以树心为原点，y=0 为地面，所有几何由 Kit 合并（每种材质 1 个 draw call）；
 *   - 碰撞体（kit.collider / boxCollider）使用**局部坐标**，由 World 摆放时统一变换。
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** 不同 variant 的主题色（树皮 / 叶 / 发光符文） */
const THEMES = [
  { bark: COL.woodWarm, leafA: COL.moss, leafB: COL.mossDark, glow: COL.glowGold, accent: COL.goldBright },
  { bark: COL.wood, leafA: COL.mossDark, leafB: COL.iceDeep, glow: COL.glowCyan, accent: COL.ice },
  { bark: COL.woodDark, leafA: COL.moss, leafB: COL.woodWarm, glow: COL.glowEmber, accent: COL.gold },
];

/* ============================================================================
 * 小工具
 * ==========================================================================*/

/**
 * 在 a→b 之间放一段圆台（树干、枝条、树根、临时木杆通用）。
 * @param {Kit} kit
 * @param {THREE.Vector3} a 起点（半径 r0）
 * @param {THREE.Vector3} b 终点（半径 r1）
 */
function limb(kit, a, b, r0, r1, seg, color, mat = 'wood', shade = true) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.001) return;
  dir.divideScalar(len);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const mat4 = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  kit.place(new THREE.CylinderGeometry(r1, r0, len, seg, 1, false), mat4, color, mat, shade);
}

/** 组一个 TRS 矩阵（供 kit.place 使用） */
function trs(px, py, pz, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

/* ============================================================================
 * 主生成器
 * ==========================================================================*/

/**
 * 构建世界树。
 * @param {{scale?:number, seed?:number, variant?:number}} opts
 * @returns {THREE.Group}
 */
export function buildWorldTree(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const s = Math.max(0.25, Number(scale) || 1);
  const theme = THEMES[Math.abs(Math.round(Number(variant) || 0)) % THEMES.length];
  const kit = new Kit({ seed: 7701 + (Number(seed) || 1) * 131 });

  // ================================================================ 0. 主体尺度
  const rBase = 17 * s;            // 树干基部半径（设计值 17m，符合 14–18m 要求）
  const trunkH = 158 * s;          // 树干本体高度（不含树冠）
  const crownTop = 214 * s;        // 树冠顶端（总高 > 200m）

  /** 树干中轴：随高度缓慢摆动，避免"电线杆"感 */
  const trunkPoint = (t) => {
    const y = trunkH * Math.pow(t, 0.94);
    const wob = (Math.sin(t * 5.1 + 0.7) * 0.9 + Math.sin(t * 11.3) * 0.35) * s * (0.25 + t * 1.7);
    return new THREE.Vector3(Math.cos(t * 3.0) * 0.42 * wob, y, Math.sin(t * 2.2) * 0.36 * wob);
  };
  /** 树干半径：自下而上收分 */
  const trunkR = (t) => rBase * Math.pow(1 - 0.78 * t, 1.26);
  /** 由高度反查归一化参数 t */
  const tOfY = (y) => Math.pow(Math.min(1, Math.max(0, y / trunkH)), 1 / 0.94);

  // ================================================================ 1. 树干
  const TRUNK_SEGS = 14;
  for (let i = 0; i < TRUNK_SEGS; i++) {
    const t0 = i / TRUNK_SEGS;
    const t1 = (i + 1) / TRUNK_SEGS;
    const seg = i < 8 ? 22 : 14;
    limb(kit, trunkPoint(t0), trunkPoint(t1), trunkR(t0), trunkR(t1), seg,
      i % 3 === 2 ? COL.woodDark : theme.bark, 'wood');
  }

  // 1.1 树皮纵向棱脊（十二条，从根部一直爬到枝干分叉区）
  const RIDGE_COUNT = 12;
  for (let i = 0; i < RIDGE_COUNT; i++) {
    const a = (TAU * i) / RIDGE_COUNT + 0.13;
    let prev = null;
    for (let j = 0; j <= 9; j++) {
      const t = (j / 9) * 0.87;
      const c = trunkPoint(t);
      const r = trunkR(t) * 0.95;
      const p = new THREE.Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      if (prev) limb(kit, prev, p, 0.62 * s, 0.5 * s, 5, COL.woodDark, 'wood');
      prev = p;
    }
  }

  // 1.2 树干上的树瘤（ irregularities，让轮廓不那么规整）
  for (let i = 0; i < 26; i++) {
    const t = kit.rand(0.03, 0.82);
    const a = kit.rand(0, TAU);
    const c = trunkPoint(t);
    const r = trunkR(t);
    const rr = kit.rand(0.6, 1.7) * s;
    kit.geo(new THREE.IcosahedronGeometry(rr, 0), {
      x: c.x + Math.cos(a) * r * 0.96,
      y: c.y + kit.rand(-2, 2) * s,
      z: c.z + Math.sin(a) * r * 0.96,
      sx: 1.3, sy: 0.8, sz: 1.3,
      color: COL.woodDark, mat: 'wood',
    });
  }

  // ================================================================ 2. 根系（盘根错节）
  const ROOT_COUNT = 14;
  for (let i = 0; i < ROOT_COUNT; i++) {
    // 在 -Z 方向（献祭台阶所在的"正面"）留出通道，所以整体旋转半格
    const a = -Math.PI / 2 + (TAU * (i + 0.5)) / ROOT_COUNT + kit.rand(-0.05, 0.05);
    const len = kit.rand(24, 40) * s;
    const startY = kit.rand(5.5, 9.5) * s;
    const startR = rBase * 0.86;

    // 折线：从树干外缘向下、向外铺开，末端贴地
    const N = 5;
    const pts = [];
    for (let j = 0; j <= N; j++) {
      const u = j / N;
      const rad = startR + len * Math.pow(u, 0.82);
      const y = startY * Math.pow(1 - u, 1.6) + 0.55 * s;
      const sway = Math.sin(u * 5.0 + i * 1.7) * 1.7 * s * u;
      pts.push(new THREE.Vector3(
        Math.cos(a) * rad + Math.cos(a + Math.PI / 2) * sway,
        y,
        Math.sin(a) * rad + Math.sin(a + Math.PI / 2) * sway,
      ));
    }

    for (let j = 0; j < N; j++) {
      const r0 = (0.75 + 2.5 * (1 - j / N)) * s;
      const r1 = (0.75 + 2.5 * (1 - (j + 1) / N)) * s;
      limb(kit, pts[j], pts[j + 1], r0, r1, j < 2 ? 12 : 8,
        j % 2 ? COL.woodDark : theme.bark, 'wood');
    }

    // 末端分叉成趾根（抓住地面）
    const tip = pts[N];
    const toes = kit.randInt(2, 3);
    for (let k = 0; k < toes; k++) {
      const ta = a + kit.rand(-0.75, 0.75);
      const tl = kit.rand(3.5, 8) * s;
      const end = new THREE.Vector3(tip.x + Math.cos(ta) * tl, 0.45 * s, tip.z + Math.sin(ta) * tl);
      limb(kit, tip, end, 0.75 * s, 0.26 * s, 6, COL.woodDark, 'wood');
    }

    // 根部符文（每隔一条根刻一组）
    if (i % 2 === 0) {
      const p = pts[3];
      const outward = Math.atan2(p.z, p.x);
      kit.runeBand(p.x + Math.cos(outward) * 0.9 * s, p.y + 0.45 * s, p.z + Math.sin(outward) * 0.9 * s, {
        w: 3.2 * s, h: 0.5 * s, rotY: Math.PI / 2 - outward,
        color: theme.glow, count: 5,
      });
      kit.geo(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.5 * s), {
        x: p.x + Math.cos(outward) * 1.05 * s, y: p.y + 0.55 * s, z: p.z + Math.sin(outward) * 1.05 * s,
        color: theme.glow, mat: 'glow', shade: false,
      });
    }
  }

  // ================================================================ 3. 叶簇 / 枝干（递归）
  /** 一团发光叶簇：多个压扁的多面体 + 少量自发光叶片 */
  const leafCluster = (center, radius, density = 1) => {
    const blobs = Math.max(3, Math.round(kit.randInt(5, 8) * density));
    for (let i = 0; i < blobs; i++) {
      const rr = radius * kit.rand(0.4, 0.78);
      kit.geo(new THREE.IcosahedronGeometry(1, 1), {
        x: center.x + kit.rand(-1, 1) * radius * 0.62,
        y: center.y + kit.rand(-0.6, 0.8) * radius * 0.5,
        z: center.z + kit.rand(-1, 1) * radius * 0.62,
        sx: rr * kit.rand(0.85, 1.35),
        sy: rr * kit.rand(0.5, 0.76),
        sz: rr * kit.rand(0.85, 1.35),
        color: kit.chance(0.34) ? theme.leafB : theme.leafA,
        mat: 'wood',
      });
    }
    // 发光叶（尤克特拉希尔的"星辰叶"）
    const glows = kit.randInt(0, 3);
    for (let i = 0; i < glows; i++) {
      const rr = radius * kit.rand(0.06, 0.14);
      kit.geo(new THREE.IcosahedronGeometry(1, 0), {
        x: center.x + kit.rand(-1, 1) * radius * 0.7,
        y: center.y + kit.rand(-0.5, 0.9) * radius * 0.55,
        z: center.z + kit.rand(-1, 1) * radius * 0.7,
        sx: rr, sy: rr, sz: rr,
        color: theme.glow, mat: 'glow', shade: false,
      });
    }
  };

  /** 递归生长一根枝干：depth=2 → 三级分叉 */
  const growBranch = (start, dir, length, radius, depth) => {
    const segs = depth >= 2 ? 4 : 3;
    const stepLen = length / segs;
    const d = dir.clone().normalize();
    let p = start.clone();
    const pts = [start.clone()];
    for (let i = 0; i < segs; i++) {
      d.y += 0.055 * (depth + 1);          // 越往末梢越向上翘
      d.x += kit.rand(-0.13, 0.13);
      d.z += kit.rand(-0.13, 0.13);
      d.normalize();
      p = p.clone().addScaledVector(d, stepLen);
      pts.push(p.clone());
    }

    const rEnd = radius * 0.5;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      limb(kit, pts[i], pts[i + 1],
        radius + (rEnd - radius) * t0,
        radius + (rEnd - radius) * t1,
        depth >= 1 ? 9 : 7,
        i % 2 ? theme.bark : COL.woodDark, 'wood');
    }

    if (depth <= 0) {
      leafCluster(pts[segs], (5.5 + radius * 2.2) * s, 1);
      return;
    }

    // 分叉处的叶团（让树冠内部也有体积感）
    leafCluster(pts[segs], radius * 2.6, 0.65);

    const kids = kit.randInt(2, 3);
    for (let k = 0; k < kids; k++) {
      const ang = kit.rand(0, TAU) + (k * TAU) / kids * 0.55;
      const spread = 0.75 + kit.rand(0, 0.45);
      const nd = new THREE.Vector3(
        d.x + Math.cos(ang) * spread,
        d.y * 0.9 + 0.22,
        d.z + Math.sin(ang) * spread,
      ).normalize();
      const origin = pts[segs - (k === 0 ? 0 : 1)];
      growBranch(origin, nd, length * kit.rand(0.5, 0.66), radius * 0.56, depth - 1);
    }
  };

  // 3.1 八根主枝（黄金角错开，避免对称呆板）
  const MAIN_BRANCHES = 8;
  for (let i = 0; i < MAIN_BRANCHES; i++) {
    const t = 0.44 + (i / (MAIN_BRANCHES - 1)) * 0.46;
    const a = i * 2.39996 + kit.rand(-0.22, 0.22);
    const c = trunkPoint(t);
    const rad = trunkR(t);
    const base = new THREE.Vector3(c.x + Math.cos(a) * rad * 0.9, c.y, c.z + Math.sin(a) * rad * 0.9);
    const rise = 0.45 + (1 - t) * 0.55 + kit.rand(-0.08, 0.08);
    const dir = new THREE.Vector3(Math.cos(a), rise, Math.sin(a)).normalize();
    const len = (t > 0.84 ? 26 : 42) * s * kit.rand(0.86, 1.15);
    const r0 = 3.6 * s * (1 - t * 0.5);
    growBranch(base, dir, len, r0, 2);
  }

  // 3.2 树冠补枝（填补轮廓空隙）
  for (let i = 0; i < 6; i++) {
    const t = kit.rand(0.7, 0.95);
    const a = kit.rand(0, TAU);
    const c = trunkPoint(t);
    const rad = trunkR(t);
    const base = new THREE.Vector3(c.x + Math.cos(a) * rad * 0.85, c.y, c.z + Math.sin(a) * rad * 0.85);
    const dir = new THREE.Vector3(Math.cos(a), kit.rand(0.9, 1.5), Math.sin(a)).normalize();
    growBranch(base, dir, kit.rand(16, 26) * s, kit.rand(1.0, 1.8) * s, 1);
  }

  // ================================================================ 4. 主冠层（体积剪影）
  // 三层大块叶冠，从远处也能读出"世界树"的轮廓
  for (let layer = 0; layer < 3; layer++) {
    const count = 8 - layer * 2;
    const y = (150 + layer * 22) * s;
    const rr = (26 + layer * 12) * s;
    for (let i = 0; i < count; i++) {
      const a = (TAU * i) / count + layer * 0.7 + kit.rand(-0.2, 0.2);
      const R = rr * kit.rand(0.72, 1.1);
      const cx = Math.cos(a) * R;
      const cz = Math.sin(a) * R;
      const cy = y + kit.rand(-7, 7) * s;
      const sz = kit.rand(9, 15) * s;
      kit.geo(new THREE.IcosahedronGeometry(1, 1), {
        x: cx, y: cy, z: cz,
        sx: sz * 1.35, sy: sz * 0.62, sz: sz * 1.25,
        color: kit.chance(0.45) ? theme.leafB : theme.leafA,
        mat: 'wood',
      });
      // 冠层顶上的发光点
      if (kit.chance(0.5)) {
        kit.geo(new THREE.IcosahedronGeometry(1, 0), {
          x: cx + kit.rand(-1, 1) * sz * 0.6,
          y: cy + sz * 0.55,
          z: cz + kit.rand(-1, 1) * sz * 0.6,
          sx: 0.5 * s, sy: 0.5 * s, sz: 0.5 * s,
          color: theme.glow, mat: 'glow', shade: false,
        });
      }
    }
  }

  // ================================================================ 5. 顶端主冠（保证总高 > 200m）
  const crownBase = trunkPoint(1);
  let crownP = crownBase.clone();
  const CROWN_SEGS = 5;
  for (let i = 0; i < CROWN_SEGS; i++) {
    const u = (i + 1) / CROWN_SEGS;
    const nxt = new THREE.Vector3(
      crownBase.x + Math.sin(u * 4.0) * 1.4 * s,
      crownBase.y + (crownTop - 22 * s - crownBase.y) * u,
      crownBase.z + Math.cos(u * 3.4) * 1.2 * s,
    );
    limb(kit, crownP, nxt, (3.0 - 2.1 * u) * s, (3.0 - 2.1 * (u + 0.2)) * s, 10, theme.bark, 'wood');
    crownP = nxt;
  }
  // 顶端枝与叶团
  for (let i = 0; i < 7; i++) {
    const a = (TAU * i) / 7;
    const base = crownP.clone();
    const dir = new THREE.Vector3(Math.cos(a), 1.1, Math.sin(a)).normalize();
    growBranch(base, dir, (12 + kit.rand(0, 8)) * s, kit.rand(0.5, 0.9) * s, 0);
  }
  leafCluster(new THREE.Vector3(crownP.x, crownTop - 14 * s, crownP.z), 13 * s, 1.4);
  leafCluster(new THREE.Vector3(crownP.x, crownTop - 4 * s, crownP.z), 8 * s, 1.2);

  // 顶端"圣光"——全地图可见的地标光核
  kit.geo(new THREE.IcosahedronGeometry(1, 1), {
    x: crownP.x, y: crownTop + 1.5 * s, z: crownP.z,
    sx: 3.2 * s, sy: 3.2 * s, sz: 3.2 * s,
    color: theme.glow, mat: 'glow', shade: false,
  });
  kit.glowBlob(crownP.x, crownTop + 1.5 * s, crownP.z, 13 * s, theme.glow);
  kit.glowBlob(crownP.x, crownTop + 4 * s, crownP.z, 22 * s, theme.accent);

  // 树冠内的光雾（廉价的体积感）
  for (let i = 0; i < 26; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(18, 62) * s;
    const y = kit.rand(140, 205) * s;
    kit.glowBlob(Math.cos(a) * R, y, Math.sin(a) * R, kit.rand(3, 7) * s, theme.glow);
  }

  // ================================================================ 6. 树干符文（三层环形符文带）
  const runeRings = [0.075, 0.16, 0.25, 0.35];
  for (const ty of runeRings) {
    const t = tOfY(ty * trunkH);
    const c = trunkPoint(t);
    const r = trunkR(t);
    const panels = 12;
    const circ = TAU * r;
    for (let p = 0; p < panels; p++) {
      const a = (TAU * p) / panels;
      const px = c.x + Math.cos(a) * (r + 0.05 * s);
      const pz = c.z + Math.sin(a) * (r + 0.05 * s);
      kit.runeBand(px, c.y + kit.rand(-1.5, 1.5) * s, pz, {
        w: (circ / panels) * 0.92,
        h: (1.1 + kit.rand(0, 0.7)) * s,
        rotY: Math.PI / 2 - a,
        color: theme.glow,
        count: 4,
      });
    }
  }
  // 树干上的大型发光符印（面向正面的几个"眼"）
  const sigilYs = [0.1, 0.2, 0.3, 0.42];
  for (let i = 0; i < sigilYs.length; i++) {
    const t = tOfY(sigilYs[i] * trunkH);
    const c = trunkPoint(t);
    const r = trunkR(t);
    const a = -Math.PI / 2 + (i % 2 === 0 ? 0.22 : -0.22);
    kit.geo(new THREE.BoxGeometry(1.5 * s, 5.2 * s, 0.12 * s), {
      x: c.x + Math.cos(a) * (r + 0.08 * s),
      y: c.y + 1.2 * s,
      z: c.z + Math.sin(a) * (r + 0.08 * s),
      ry: Math.PI / 2 - a,
      color: theme.glow, mat: 'glow', shade: false,
    });
    kit.glowBlob(c.x + Math.cos(a) * (r + 0.5 * s), c.y + 1.2 * s, c.z + Math.sin(a) * (r + 0.5 * s), 5 * s, theme.glow);
  }

  // ================================================================ 7. 树下石台
  // 设计：两层石台（外层 tierH、内层 2×tierH）+ 四向台阶。
  // 同时把石台写成 group.userData.platforms（可行走矩形），玩家可以真正走上石台；
  // 圆盘用 8 个旋转矩形逼近，角部外露 < 1%，视觉上完全贴合。
  const tierH = 0.45 * s;
  const platR = 46 * s;
  const tierInR = platR * 0.87;
  kit.cyl(platR, platR * 1.02, tierH, 56, 0, tierH / 2, 0, { color: COL.stoneDark, mat: 'stone' });
  kit.cyl(tierInR, tierInR * 1.035, tierH, 52, 0, tierH * 1.5, 0, { color: COL.stone, mat: 'stone' });
  const platTop = tierH * 2;

  /** 可行走平台列表（局部坐标，y 为顶面高度） */
  const platforms = [];
  /** 用 8 个旋转矩形逼近一个圆盘 */
  const addDisc = (radius, y, cx = 0, cz = 0) => {
    for (let k = 0; k < 8; k++) {
      platforms.push({ x: cx, z: cz, hw: radius * 0.985, hd: radius * 0.2, rotY: (Math.PI * k) / 8, y });
    }
  };
  addDisc(platR, tierH);
  addDisc(tierInR, platTop);

  // 7.1 台阶（三方小台阶 + -Z 方向的大献祭台阶），同时登记可行走矩形
  const addStairs = (a, w, steps, rise, run) => {
    const rotY = Math.PI / 2 - a;
    const ox = Math.cos(a) * platR * 0.98;
    const oz = Math.sin(a) * platR * 0.98;
    kit.stairs(ox, oz, { w, steps, rise, run, rotY, color: COL.stone, mat: 'stone' });
    for (let i = 0; i < steps; i++) {
      const zc = (i + 0.5) * run;
      platforms.push({
        x: ox + Math.sin(rotY) * zc,
        z: oz + Math.cos(rotY) * zc,
        hw: w / 2,
        hd: run / 2,
        rotY,
        y: rise * (steps - i),
      });
    }
  };
  for (const a of [0, Math.PI / 2, Math.PI]) {
    addStairs(a, 11 * s, 3, tierH / 3, 0.62 * s);
  }
  // 献祭台阶：正 -Z 方向，更宽，两侧立石与火盆
  addStairs(-Math.PI / 2, 18 * s, 3, tierH / 3, 0.82 * s);
  // 台阶两侧的守门立石
  for (const sx of [-1, 1]) {
    const bx = sx * 12.5 * s;
    const bz = -platR * 0.98 - 3.2 * s;
    kit.place(new THREE.BoxGeometry(1.9 * s, 8.5 * s, 1.9 * s), trs(bx, 4.2 * s, bz, 0, sx * 0.12, sx * 0.03), COL.stoneCold, 'stone');
    kit.box(2.9 * s, 0.5 * s, 2.9 * s, bx, 0.25 * s, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.box(2.2 * s, 0.45 * s, 2.2 * s, bx, 8.6 * s, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.runeBand(bx, 4.6 * s, bz + 1.0 * s, { w: 1.2 * s, h: 1.4 * s, rotY: 0, color: theme.glow, count: 3 });
    kit.collider(bx, bz, 1.5 * s);
  }

  // 7.2 石台上的符文圆环
  kit.torus(31 * s, 0.16 * s, 5, 72, 0, platTop + 0.02 * s, 0, {
    rx: Math.PI / 2, color: theme.glow, mat: 'glow', shade: false,
  });
  for (let i = 0; i < 28; i++) {
    const a = (TAU * i) / 28;
    const R = (i % 2 ? 31 : 34) * s;
    kit.geo(new THREE.BoxGeometry((i % 2 ? 1.6 : 0.8) * s, 0.05 * s, (i % 2 ? 0.5 : 1.4) * s), {
      x: Math.cos(a) * R, y: platTop + 0.03 * s, z: Math.sin(a) * R,
      ry: -a, color: i % 2 ? theme.glow : theme.accent, mat: 'glow', shade: false,
    });
  }

  // ================================================================ 8. 祭坛（献祭台阶尽头）
  const altZ = -29 * s;
  kit.cyl(6.6 * s, 7.2 * s, 0.5 * s, 12, 0, platTop + 0.25 * s, altZ, { color: COL.stoneDark, mat: 'stone' });
  kit.cyl(4.8 * s, 5.2 * s, 0.5 * s, 12, 0, platTop + 0.75 * s, altZ, { color: COL.stone, mat: 'stone' });
  const altY = platTop + 1.0 * s;
  // 祭坛台基两级同样可行走
  addDisc(6.6 * s, platTop + 0.5 * s, 0, altZ);
  addDisc(4.8 * s, altY, 0, altZ);
  // 祭坛主体
  kit.box(5.4 * s, 1.1 * s, 3.2 * s, 0, altY + 0.55 * s, altZ, { color: COL.stoneLight, mat: 'stone' });
  kit.box(6.2 * s, 0.34 * s, 3.9 * s, 0, altY + 1.24 * s, altZ, { color: COL.stone, mat: 'stone' });
  kit.box(5.0 * s, 0.9 * s, 2.8 * s, 0, altY + 0.45 * s, altZ, { color: COL.stoneDark, mat: 'stone' });
  // 祭坛两侧的立柱
  for (const sx of [-1, 1]) {
    kit.column(sx * 3.6 * s, altZ, { h: 5.2 * s, r: 0.52 * s, color: COL.stoneCold, mat: 'stone' });
    kit.runeBand(sx * 3.6 * s, altY + 2.6 * s, altZ + 0.62 * s, { w: 1.0 * s, h: 1.8 * s, rotY: 0, color: theme.glow, count: 3 });
    kit.geo(new THREE.IcosahedronGeometry(0.28 * s, 1), {
      x: sx * 3.6 * s, y: altY + 5.35 * s, z: altZ, color: theme.accent, mat: 'glow', shade: false,
    });
  }
  // 祭坛火盆与辉光
  kit.cyl(1.5 * s, 0.9 * s, 0.75 * s, 10, 0, altY + 1.78 * s, altZ, { color: COL.iron, mat: 'iron' });
  kit.cyl(1.35 * s, 1.35 * s, 0.08 * s, 10, 0, altY + 2.14 * s, altZ, { color: theme.glow, mat: 'glow', shade: false });
  kit.glowBlob(0, altY + 2.4 * s, altZ, 5.5 * s, theme.glow);
  kit.glowBlob(0, altY + 6.2 * s, altZ, 8 * s, theme.accent);
  kit.runeBand(0, altY + 1.35 * s, altZ + 1.98 * s, {
    w: 4.2 * s, h: 0.55 * s, rotY: 0, color: theme.glow, count: 8,
  });
  kit.boxCollider(0, altZ, 3.4 * s, 2.2 * s, 0);

  // ================================================================ 9. 石台外环的立石与火盆
  const STONE_COUNT = 10;
  for (let i = 0; i < STONE_COUNT; i++) {
    // 同样在 -Z 献祭方向上留空
    const a = -Math.PI / 2 + 0.36 + (TAU * i) / STONE_COUNT;
    const R = kit.rand(55, 58) * s;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const h = kit.rand(7, 9.6) * s;
    const w = kit.rand(2.4, 3.2) * s;
    const d = kit.rand(1.6, 2.1) * s;
    const tilt = kit.rand(-0.05, 0.05);
    // 立石主体：向圆心一侧略倾；底部多埋 1.6m，保证地形起伏时不悬空
    const bury = 1.6 * s;
    kit.place(new THREE.BoxGeometry(w, h + bury, d), trs(
      x, h / 2 - bury / 2, z,
      Math.sin(a) * tilt, Math.PI / 2 - a, Math.cos(a) * tilt,
    ), COL.stoneCold, 'stone');
    // 基座
    kit.box(w * 1.5, 0.6 * s, d * 1.5, x, 0.3 * s, z, { color: COL.stoneDark, mat: 'stone', ry: Math.PI / 2 - a });
    // 顶部横石
    kit.box(w * 1.15, 0.5 * s, d * 1.2, x, h + 0.2 * s, z, { color: COL.stone, mat: 'stone', ry: Math.PI / 2 - a });
    // 面向圆心的符文
    const inward = a + Math.PI;
    kit.runeBand(
      x + Math.cos(inward) * (d / 2 + 0.03 * s), h * 0.56, z + Math.sin(inward) * (d / 2 + 0.03 * s),
      { w: w * 0.72, h: 0.8 * s, rotY: Math.PI / 2 - inward, color: theme.glow, count: 4 },
    );
    // 石缝里的苔藓
    if (kit.chance(0.6)) {
      kit.geo(new THREE.IcosahedronGeometry(1, 0), {
        x: x + kit.rand(-1, 1) * w * 0.4, y: h * kit.rand(0.1, 0.3), z: z + kit.rand(-1, 1) * d * 0.4,
        sx: kit.rand(0.4, 0.9) * s, sy: 0.25 * s, sz: kit.rand(0.4, 0.9) * s,
        color: COL.mossDark, mat: 'wood',
      });
    }
    kit.collider(x, z, Math.max(w, d) * 0.75);
  }

  // 火盆（献祭台阶两侧 + 石台外环四个方向）
  const braziers = [
    [-8.5 * s, -36 * s], [8.5 * s, -36 * s],
    [38 * s, 8 * s], [-38 * s, 8 * s],
    [20 * s, 34 * s], [-20 * s, 34 * s],
  ];
  for (const [bx, bz] of braziers) {
    kit.cyl(0.55 * s, 0.9 * s, 2.4 * s, 8, bx, 1.2 * s, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.cyl(1.15 * s, 0.72 * s, 0.85 * s, 10, bx, 2.7 * s, bz, { color: COL.iron, mat: 'iron' });
    kit.cyl(1.02 * s, 1.02 * s, 0.1 * s, 10, bx, 3.14 * s, bz, { color: theme.glow, mat: 'glow', shade: false });
    kit.cone(0.75 * s, 1.5 * s, 7, bx, 3.85 * s, bz, { color: theme.glow, mat: 'glow', shade: false });
    kit.glowBlob(bx, 4.4 * s, bz, 3.6 * s, theme.glow);
    kit.collider(bx, bz, 1.2 * s);
  }

  // ================================================================ 10. 散落碎石与地面苔痕
  for (let i = 0; i < 22; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(40, 62) * s;
    const sz = kit.rand(0.4, 1.7) * s;
    kit.geo(new THREE.IcosahedronGeometry(sz, 0), {
      x: Math.cos(a) * R, y: sz * 0.42, z: Math.sin(a) * R,
      sx: kit.rand(1, 1.8), sy: kit.rand(0.5, 0.85), sz: kit.rand(1, 1.8),
      ry: kit.rand(0, TAU),
      color: kit.chance(0.5) ? COL.rock : COL.stoneDark, mat: 'stone',
    });
  }
  for (let i = 0; i < 16; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(20, 63) * s;
    kit.geo(new THREE.IcosahedronGeometry(1, 0), {
      x: Math.cos(a) * R, y: 0.06 * s, z: Math.sin(a) * R,
      sx: kit.rand(1.2, 3.4) * s, sy: 0.12 * s, sz: kit.rand(1.2, 3.4) * s,
      ry: kit.rand(0, TAU), color: kit.chance(0.5) ? COL.mossDark : COL.moss, mat: 'wood',
    });
  }

  // ================================================================ 11. 碰撞体
  // 说明：只给树干一层圆柱碰撞。根系/石台不做 2D 碰撞，
  // 否则会在可通行的石台上形成大片"隐形墙"。
  kit.collider(0, 0, rBase * 1.14);

  // ================================================================ 12. 组装
  const group = kit.build({ name: 'worldTree' });
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  group.userData.theme = variant;
  group.userData.height = crownTop;
  return group;
}

/** 供 World / Map 使用的地标元信息（scale = 1 时的设计尺寸） */
export const meta = {
  id: 'worldTree',
  label: '世界树 · 尤克特拉希尔',
  radius: 66,
  height: 216,
};
