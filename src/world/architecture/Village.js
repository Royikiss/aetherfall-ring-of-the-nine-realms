/**
 * Village.js — 长屋村 · 阿斯克（Ask's Stead）
 *
 * 模块职责：
 *   北欧长屋聚落：8 栋人字草顶长屋（木骨石基、烟囱、门前火把、门廊），
 *   外圈木栅栏与木门，以及水井、晒鱼架、篝火坑、中央议事石、木柴堆等生活道具。
 *
 * 对外 API：
 *   buildVillage(opts) -> THREE.Group
 *     opts = { scale = 1, seed = 1, variant = 0 }
 *       variant 0：草黄屋顶（默认）
 *       variant 1：苔绿屋顶（更靠北的聚落）
 *   meta = { id, label, radius, height }
 *
 * 坐标约定：
 *   - 以村中央（议事石）为原点，y=0 为地面；
 *   - 房屋的门一律朝向村中心；村庄入口（木门）位于局部 +Z 方向；
 *   - 房屋墙体有 boxCollider（局部坐标），门洞留空可通行。
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** 主题：0 草黄屋顶 / 1 苔绿屋顶 */
const THEMES = [
  {
    thatch: COL.sand, thatchDark: COL.sand, ridge: COL.clothCream,
    flame: COL.glowEmber, rune: COL.glowGold, flag: COL.clothRed,
  },
  {
    thatch: COL.moss, thatchDark: COL.mossDark, ridge: COL.mossDark,
    flame: COL.glowEmber, rune: COL.glowGreen, flag: COL.clothBlue,
  },
];

/* ============================================================================
 * 小工具
 * ==========================================================================*/

/**
 * 局部坐标系辅助：把 (lx, ly, lz) 的"房屋局部坐标"换算成世界坐标。
 * 与 THREE 绕 Y 旋转一致：x' = x·cosθ + z·sinθ，z' = -x·sinθ + z·cosθ
 */
function makeFrame(cx, cz, rotY) {
  const c = Math.cos(rotY);
  const sn = Math.sin(rotY);
  return {
    rotY,
    x(lx, lz) { return cx + lx * c + lz * sn; },
    z(lx, lz) { return cz - lx * sn + lz * c; },
    p(lx, lz) { return { x: this.x(lx, lz), z: this.z(lx, lz) }; },
    /** 局部坐标盒子（自动叠加朝向） */
    box(kit, w, h, d, lx, ly, lz, o = {}) {
      return kit.box(w, h, d, this.x(lx, lz), ly, this.z(lx, lz), { ...o, ry: (o.ry || 0) + rotY });
    },
    /** 局部坐标圆柱 */
    cyl(kit, rt, rb, h, seg, lx, ly, lz, o = {}) {
      return kit.cyl(rt, rb, h, seg, this.x(lx, lz), ly, this.z(lx, lz), { ...o, ry: (o.ry || 0) + rotY });
    },
  };
}

/** 角度差（0..π） */
function angDist(a, b) {
  const d = Math.abs(a - b) % TAU;
  return Math.min(d, TAU - d);
}

/** 在两点之间放一段圆台（斜撑、横杆、圆木通用） */
function limb(kit, a, b, r0, r1, seg, color, mat = 'wood') {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.001) return;
  dir.divideScalar(len);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const mat4 = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  kit.place(new THREE.CylinderGeometry(r1, r0, len, seg, 1, false), mat4, color, mat, true);
}

/** 世界坐标版圆台（给定两端点） */
function limbXZ(kit, x1, z1, y1, x2, z2, y2, r0, r1, seg, color, mat = 'wood') {
  limb(kit, new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), r0, r1, seg, color, mat);
}

/* ============================================================================
 * 长屋
 * ==========================================================================*/

/**
 * 一栋北欧长屋。
 * 局部坐标：长轴沿 X，门开在 +Z 侧正中。
 * @param {Kit} kit
 * @param {number} cx 世界 X
 * @param {number} cz 世界 Z
 * @param {number} rotY 朝向（局部 +Z 指向村中心）
 */
function buildLonghouse(kit, cx, cz, rotY, o) {
  const { len: L, wid: W, wallH, roofH, s, pal } = o;
  const f = makeFrame(cx, cz, rotY);
  const halfL = L / 2;
  const halfW = W / 2;
  const baseY = 0.62 * s;                 // 石基高度
  const wallT = 0.42 * s;                 // 墙厚
  const wallTop = baseY + wallH;          // 墙顶
  const doorW = 2.95 * s;
  const doorH = 3.1 * s;

  // ---------------------------------------------------------------- 石基
  // 向下多埋 2.5m：村落横跨的范围内地形有起伏，埋深可避免房子"悬空"
  const skirt = 2.5 * s;
  f.box(kit, L + 0.9 * s, baseY + skirt, W + 0.9 * s, 0, (baseY - skirt) / 2, 0,
    { color: COL.stoneDark, mat: 'stone' });
  const baseStones = Math.max(5, Math.round(L / (1.7 * s)));
  for (let i = 0; i < baseStones; i++) {
    const lx = -halfL + (L * (i + 0.5)) / baseStones;
    const col = i % 3 === 0 ? COL.stone : COL.stoneDark;
    f.box(kit, (L / baseStones) * 0.88, baseY * 0.75, 0.3 * s, lx, baseY * 0.4, halfW + 0.42 * s,
      { color: col, mat: 'stone' });
    f.box(kit, (L / baseStones) * 0.88, baseY * 0.75, 0.3 * s, lx, baseY * 0.4, -halfW - 0.42 * s,
      { color: col, mat: 'stone' });
  }

  // ---------------------------------------------------------------- 墙体
  // 后墙
  f.box(kit, L - 0.6 * s, wallH, wallT, 0, baseY + wallH / 2, -halfW,
    { color: COL.woodWarm, mat: 'wood' });
  // 前墙（门洞两侧）
  const segW = (L - doorW) / 2 - 0.35 * s;
  for (const sx of [-1, 1]) {
    f.box(kit, segW, wallH, wallT, sx * (doorW / 2 + segW / 2), baseY + wallH / 2, halfW,
      { color: COL.woodWarm, mat: 'wood' });
  }
  // 门楣以上的墙
  f.box(kit, doorW + 0.5 * s, wallH - doorH, wallT, 0, baseY + doorH + (wallH - doorH) / 2, halfW,
    { color: COL.woodWarm, mat: 'wood' });
  // 两端山墙（墙身部分）
  for (const sx of [-1, 1]) {
    f.box(kit, wallT, wallH, W - 0.7 * s, sx * halfL, baseY + wallH / 2, 0,
      { color: COL.woodWarm, mat: 'wood' });
  }

  // 外壁竖向木板（增加"木板拼成"的质感）
  const plankN = Math.max(6, Math.round(L / (1.35 * s)));
  for (let i = 0; i < plankN; i++) {
    const lx = -halfL + 0.55 * s + ((L - 1.1 * s) * (i + 0.5)) / plankN;
    const col = i % 2 ? COL.wood : COL.woodDark;
    f.box(kit, 0.26 * s, wallH * 0.94, 0.1 * s, lx, baseY + wallH * 0.5,
      -halfW - wallT * 0.5 - 0.03 * s, { color: col, mat: 'wood' });
    if (Math.abs(lx) > doorW / 2 + 0.5 * s) {
      f.box(kit, 0.26 * s, wallH * 0.94, 0.1 * s, lx, baseY + wallH * 0.5,
        halfW + wallT * 0.5 + 0.03 * s, { color: col, mat: 'wood' });
    }
  }

  // 转角立柱 & 顶梁
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      f.box(kit, 0.62 * s, wallH + 0.55 * s, 0.62 * s,
        sx * (halfL - 0.08 * s), baseY + (wallH + 0.55 * s) / 2, sz * (halfW - 0.08 * s),
        { color: COL.woodDark, mat: 'wood' });
    }
  }
  for (const sz of [-1, 1]) {
    f.box(kit, L + 0.8 * s, 0.4 * s, 0.46 * s, 0, wallTop + 0.12 * s, sz * halfW,
      { color: COL.woodDark, mat: 'wood' });
  }
  for (const sx of [-1, 1]) {
    f.box(kit, 0.46 * s, 0.4 * s, W + 0.6 * s, sx * halfL, wallTop + 0.12 * s, 0,
      { color: COL.woodDark, mat: 'wood' });
  }

  // ---------------------------------------------------------------- 山墙三角（逐层木板填充）
  const rows = 5;
  const gableW = W + 0.4 * s;
  for (const sx of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const t = r / rows;
      const hw = (gableW / 2) * (1 - t * 0.97);
      f.box(kit, 0.34 * s, (roofH / rows) * 1.06, hw * 2,
        sx * halfL, wallTop + roofH * (t + 0.5 / rows), 0,
        { color: r % 2 ? COL.wood : COL.woodWarm, mat: 'wood' });
    }
  }

  // ---------------------------------------------------------------- 人字草顶
  const roofY0 = wallTop + 0.18 * s;
  kit.roofGable(f.x(0, 0), f.z(0, 0), {
    w: W + 1.9 * s, d: L + 0.6 * s, h: roofH,
    rotY: rotY + Math.PI / 2,
    y0: roofY0,
    color: pal.thatch, mat: 'wood',
    thickness: 0.5 * s, overhang: 0.95 * s,
  });
  // 屋脊压条（草顶的脊背）
  f.box(kit, L + 1.4 * s, 0.3 * s, 0.5 * s, 0, roofY0 + roofH + 0.5 * s, 0,
    { color: pal.ridge, mat: 'wood' });
  // 屋顶上的苔藓斑块
  const halfRoof = (W + 1.9 * s) / 2;
  for (let i = 0; i < 6; i++) {
    const sz = kit.chance(0.5) ? 1 : -1;
    const zt = kit.rand(0.18, 0.78) * halfRoof;
    const yy = roofY0 + roofH * (1 - zt / halfRoof) + 0.3 * s;
    const lx = kit.rand(-halfL + 1.2 * s, halfL - 1.2 * s);
    kit.geo(new THREE.IcosahedronGeometry(1, 1), {
      x: f.x(lx, sz * zt), y: yy, z: f.z(lx, sz * zt),
      sx: kit.rand(0.7, 1.6) * s, sy: 0.2 * s, sz: kit.rand(0.7, 1.4) * s,
      ry: rotY, color: kit.chance(0.65) ? COL.moss : COL.mossDark, mat: 'wood',
    });
  }

  // 山墙顶端的交叉兽角（维京长屋的标志）
  for (const sx of [-1, 1]) {
    const p = f.p(sx * (halfL + 0.15 * s), 0);
    for (const hs of [-1, 1]) {
      kit.cyl(0.07 * s, 0.14 * s, 3.1 * s, 6, p.x, roofY0 + roofH + 1.0 * s, p.z, {
        rx: hs * 0.62, color: COL.bone, mat: 'stone',
      });
    }
  }

  // ---------------------------------------------------------------- 烟囱
  const chX = L * 0.26;
  const chBase = wallTop - 0.5 * s;
  const chTop = roofY0 + roofH + 1.8 * s;
  f.box(kit, 1.05 * s, chTop - chBase, 1.05 * s, chX, (chTop + chBase) / 2, 0,
    { color: COL.stoneDark, mat: 'stone' });
  f.box(kit, 1.35 * s, 0.28 * s, 1.35 * s, chX, chTop, 0, { color: COL.stone, mat: 'stone' });
  f.box(kit, 0.66 * s, 0.12 * s, 0.66 * s, chX, chTop + 0.16 * s, 0, { color: COL.black, mat: 'stone' });
  f.box(kit, 1.22 * s, 0.16 * s, 1.22 * s, chX, chBase + (chTop - chBase) * 0.55, 0,
    { color: COL.stone, mat: 'stone' });

  // ---------------------------------------------------------------- 门廊、门框、门板
  const doorZ = halfW + 0.12 * s;
  // 门廊小檐（屋脊垂直于主屋，罩住门口）
  kit.roofGable(f.x(0, halfW + 0.95 * s), f.z(0, halfW + 0.95 * s), {
    w: 5.2 * s, d: 1.9 * s, h: 1.35 * s,
    rotY, y0: baseY + doorH + 0.4 * s,
    color: pal.thatch, mat: 'wood', thickness: 0.3 * s, overhang: 0.45 * s,
  });
  // 门廊立柱
  for (const sx of [-1, 1]) {
    f.box(kit, 0.3 * s, doorH + 0.4 * s, 0.3 * s, sx * 2.15 * s,
      (baseY + doorH + 0.4 * s) / 2, halfW + 1.7 * s, { color: COL.woodDark, mat: 'wood' });
  }
  // 门框
  for (const sx of [-1, 1]) {
    f.box(kit, 0.38 * s, doorH + 0.45 * s, 0.5 * s, sx * (doorW / 2 + 0.2 * s),
      baseY + (doorH + 0.45 * s) / 2, doorZ, { color: COL.woodDark, mat: 'wood' });
  }
  f.box(kit, doorW + 1.0 * s, 0.45 * s, 0.55 * s, 0, baseY + doorH + 0.5 * s, doorZ,
    { color: COL.woodDark, mat: 'wood' });
  // 门楣上的符文（欢迎/守护）
  kit.runeBand(f.x(0, doorZ + 0.3 * s), baseY + doorH + 0.5 * s, f.z(0, doorZ + 0.3 * s), {
    w: doorW * 0.8, h: 0.32 * s, rotY, color: pal.rune, count: 4,
  });
  // 门板（半开，向内微敞）
  const leafW = doorW - 0.3 * s;
  const phi = 1.02;
  const vx = -leafW / 2;
  f.box(kit, leafW, doorH - 0.25 * s, 0.16 * s,
    doorW / 2 + vx * Math.cos(phi), baseY + (doorH - 0.25 * s) / 2,
    -vx * Math.sin(phi) + doorZ, { ry: phi, color: COL.woodDark, mat: 'wood' });
  // 门板铁箍
  for (const by of [1.0, 2.5]) {
    f.box(kit, leafW * 0.9, 0.14 * s, 0.2 * s,
      doorW / 2 + vx * Math.cos(phi), baseY + by * s,
      -vx * Math.sin(phi) + doorZ, { ry: phi, color: COL.iron, mat: 'iron' });
  }

  // 门两侧火把
  for (const sx of [-1, 1]) {
    const tx = sx * (doorW / 2 + 1.0 * s);
    f.cyl(kit, 0.09 * s, 0.12 * s, 2.1 * s, 6, tx, baseY + 1.5 * s, halfW + 0.55 * s,
      { color: COL.woodDark, mat: 'wood', rx: sx * 0.16 });
    f.cyl(kit, 0.3 * s, 0.2 * s, 0.38 * s, 8, tx, baseY + 2.62 * s, halfW + 0.72 * s,
      { color: COL.iron, mat: 'iron' });
    f.box(kit, 0.4 * s, 0.3 * s, 0.4 * s, tx, baseY + 2.9 * s, halfW + 0.72 * s,
      { color: pal.flame, mat: 'glow', shade: false });
    const wp = f.p(tx, halfW + 0.72 * s);
    kit.glowBlob(wp.x, baseY + 3.05 * s, wp.z, 2.3 * s, pal.flame);
  }

  // ---------------------------------------------------------------- 窗（发光小缝）
  for (const sz of [-1, 1]) {
    const n = kit.randInt(2, 3);
    for (let i = 0; i < n; i++) {
      const lx = -halfL + (L * (i + 1)) / (n + 1) + kit.rand(-0.5, 0.5) * s;
      if (sz > 0 && Math.abs(lx) < doorW / 2 + 0.9 * s) continue;
      f.box(kit, 1.1 * s, 1.15 * s, 0.14 * s, lx, baseY + wallH * 0.64,
        sz * (halfW + 0.02 * s), { color: COL.woodDark, mat: 'wood' });
      f.box(kit, 0.72 * s, 0.78 * s, 0.1 * s, lx, baseY + wallH * 0.64,
        sz * (halfW + 0.12 * s), { color: pal.flame, mat: 'glow', shade: false });
    }
  }

  // 前墙上的圆盾装饰
  for (const sx of [-1, 1]) {
    const lx = sx * L * 0.31;
    f.cyl(kit, 0.62 * s, 0.62 * s, 0.13 * s, 12, lx, baseY + wallH * 0.52, halfW + 0.3 * s,
      { rx: Math.PI / 2, color: sx < 0 ? COL.clothRed : COL.bronze, mat: 'cloth' });
    f.cyl(kit, 0.16 * s, 0.16 * s, 0.17 * s, 8, lx, baseY + wallH * 0.52, halfW + 0.38 * s,
      { rx: Math.PI / 2, color: COL.gold, mat: 'gold' });
  }

  // ---------------------------------------------------------------- 碰撞体（门洞留空）
  const wallHalf = 0.45 * s;
  // 后墙
  kit.boxCollider(f.x(0, -halfW), f.z(0, -halfW), (L + 0.6 * s) / 2, wallHalf, rotY);
  // 前墙两段
  for (const sx of [-1, 1]) {
    kit.boxCollider(
      f.x(sx * (doorW / 2 + segW / 2), halfW),
      f.z(sx * (doorW / 2 + segW / 2), halfW),
      segW / 2 + 0.25 * s, wallHalf, rotY,
    );
  }
  // 两端山墙
  for (const sx of [-1, 1]) {
    kit.boxCollider(f.x(sx * halfL, 0), f.z(sx * halfL, 0), wallHalf, W / 2, rotY);
  }
}

/* ============================================================================
 * 村落道具
 * ==========================================================================*/

/**
 * 木栅栏（环形，正对村口留出一个约 9m 宽的缺口）。
 * 做法：先算出所有立柱角度（缺口内跳过），再在缺口两侧补两根"边柱"，
 * 这样缺口宽度不受柱距影响，横杆也不会横穿入口。
 */
function buildFence(kit, R, gateAngle, s) {
  const posts = 34;
  const gapHalf = Math.asin(Math.min(0.9, (4.6 * s) / R));   // 入口半角（缺口约 9m 宽）

  const angles = [];
  for (let i = 0; i < posts; i++) {
    const a = (TAU * i) / posts;
    if (angDist(a, gateAngle) <= gapHalf + 0.02) continue;
    angles.push(a);
  }
  angles.push(gateAngle - gapHalf, gateAngle + gapHalf);
  angles.sort((p, q) => p - q);

  // 缺口两侧的边柱之间（索引 i 与 i+1）不连横杆
  const gapIndex = angles.findIndex((a) => Math.abs(a - (gateAngle - gapHalf)) < 1e-6);

  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    // 栅栏柱向下多埋 2.5m，地形起伏时仍然"插在地里"
    kit.cyl(0.15 * s, 0.22 * s, 4.25 * s, 6, x, -0.375 * s, z, { color: COL.woodDark, mat: 'wood' });
    kit.cone(0.19 * s, 0.55 * s, 6, x, 1.95 * s, z, { color: COL.woodDark, mat: 'wood' });
  }

  for (let i = 0; i < angles.length; i++) {
    if (i === gapIndex) continue;                       // 跨越入口，不连
    const a1 = angles[i];
    const a2 = angles[(i + 1) % angles.length];
    const x1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;
    const x2 = Math.cos(a2) * R;
    const z2 = Math.sin(a2) * R;
    // 横杆（两道）
    kit.wall(x1, z1, x2, z2, { h: 0.13 * s, t: 0.1 * s, y0: 0.55 * s, color: COL.wood, mat: 'wood' });
    kit.wall(x1, z1, x2, z2, { h: 0.13 * s, t: 0.1 * s, y0: 1.15 * s, color: COL.woodDark, mat: 'wood' });
    // 碰撞（沿弦段；弦中点略向内收，贴合弧线）
    const dx = x2 - x1;
    const dz = z2 - z1;
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    kit.boxCollider(mx, mz, Math.hypot(dx, dz) / 2 + 0.12 * s, 0.24 * s, Math.atan2(-dz, dx));
  }
}

/** 村口木门（双柱 + 横梁 + 半开的两扇门 + 兽骨雕饰） */
function buildGate(kit, cx, cz, rotY, s, pal) {
  const f = makeFrame(cx, cz, rotY);
  for (const sx of [-1, 1]) {
    f.cyl(kit, 0.34 * s, 0.44 * s, 9.2 * s, 8, sx * 3.7 * s, 1.6 * s, 0,
      { color: COL.woodDark, mat: 'wood' });
    f.cyl(kit, 0.58 * s, 0.68 * s, 0.6 * s, 8, sx * 3.7 * s, 0.3 * s, 0,
      { color: COL.stoneDark, mat: 'stone' });
    f.cyl(kit, 0.5 * s, 0.42 * s, 0.5 * s, 8, sx * 3.7 * s, 6.4 * s, 0,
      { color: COL.wood, mat: 'wood' });
    // 柱身上的绑绳/铁箍
    f.cyl(kit, 0.44 * s, 0.44 * s, 0.16 * s, 8, sx * 3.7 * s, 4.6 * s, 0,
      { color: COL.iron, mat: 'iron' });
  }
  // 横梁
  f.box(kit, 8.8 * s, 0.62 * s, 0.7 * s, 0, 6.0 * s, 0, { color: COL.woodDark, mat: 'wood' });
  f.box(kit, 9.2 * s, 0.2 * s, 0.9 * s, 0, 6.38 * s, 0, { color: COL.wood, mat: 'wood' });
  // 横梁上的符文（朝向村外）
  kit.runeBand(f.x(0, -0.36 * s), 6.0 * s, f.z(0, -0.36 * s), {
    w: 5.6 * s, h: 0.34 * s, rotY: rotY + Math.PI, color: pal.rune, count: 9,
  });
  // 梁顶的兽头与交叉角
  const topP = f.p(0, 0);
  kit.geo(new THREE.IcosahedronGeometry(0.55 * s, 1), {
    x: topP.x, y: 6.95 * s, z: topP.z,
    sx: 1.2, sy: 1.0, sz: 1.2, ry: rotY, color: COL.bone, mat: 'stone',
  });
  for (const hs of [-1, 1]) {
    kit.cone(0.16 * s, 1.5 * s, 6, topP.x, 7.35 * s, topP.z, {
      rx: hs * 0.9, ry: rotY, color: COL.bone, mat: 'stone',
    });
  }
  // 两扇半开的门
  for (const sx of [-1, 1]) {
    const hingeX = sx * 3.4 * s;
    const phi = sx * 0.95;
    const leafW = 3.2 * s;
    const vx = -sx * leafW / 2;
    const lx = hingeX + vx * Math.cos(phi);
    const lz = -vx * Math.sin(phi);
    f.box(kit, leafW, 3.7 * s, 0.18 * s, lx, 1.95 * s, lz,
      { ry: phi, color: COL.woodDark, mat: 'wood' });
    for (const by of [1.1, 3.0]) {
      f.box(kit, leafW * 0.92, 0.14 * s, 0.22 * s, lx, by * s, lz,
        { ry: phi, color: COL.iron, mat: 'iron' });
    }
  }
  // 门柱内侧的火把
  for (const sx of [-1, 1]) {
    const p = f.p(sx * 3.75 * s, 0.2 * s);
    kit.cyl(0.1 * s, 0.13 * s, 1.9 * s, 6, p.x, 4.9 * s, p.z, { color: COL.woodDark, mat: 'wood' });
    kit.box(0.42 * s, 0.32 * s, 0.42 * s, p.x, 5.9 * s, p.z, { color: pal.flame, mat: 'glow', shade: false });
    kit.glowBlob(p.x, 6.05 * s, p.z, 2.4 * s, pal.flame);
  }
  // 碰撞
  for (const sx of [-1, 1]) kit.collider(f.x(sx * 3.7 * s, 0), f.z(sx * 3.7 * s, 0), 0.75 * s);
}

/** 中央议事石（大石桌 + 席位石） */
function buildAssemblyStone(kit, cx, cz, s, pal) {
  // 三层圆台
  kit.cyl(6.4 * s, 6.9 * s, 0.42 * s, 14, cx, 0.21 * s, cz, { color: COL.stoneDark, mat: 'stone' });
  kit.cyl(5.0 * s, 5.4 * s, 0.45 * s, 14, cx, 0.65 * s, cz, { color: COL.stone, mat: 'stone' });
  kit.cyl(3.9 * s, 4.2 * s, 0.5 * s, 14, cx, 1.12 * s, cz, { color: COL.stoneLight, mat: 'stone' });
  const y0 = 1.37 * s;
  // 两块支撑石 + 巨大石板
  for (const sx of [-1, 1]) {
    kit.box(1.0 * s, 0.85 * s, 2.6 * s, cx + sx * 1.5 * s, y0 + 0.42 * s, cz,
      { color: COL.stoneDark, mat: 'stone' });
  }
  kit.box(5.6 * s, 1.0 * s, 3.2 * s, cx, y0 + 1.05 * s, cz, { color: COL.stoneLight, mat: 'stone' });
  kit.box(5.9 * s, 0.24 * s, 3.5 * s, cx, y0 + 1.62 * s, cz, { color: COL.stone, mat: 'stone' });
  // 石桌上的符文
  kit.runeBand(cx, y0 + 1.74 * s, cz + 1.62 * s, { w: 4.2 * s, h: 0.3 * s, rotY: 0, color: pal.rune, count: 7 });
  kit.runeBand(cx, y0 + 1.74 * s, cz - 1.62 * s, { w: 4.2 * s, h: 0.3 * s, rotY: Math.PI, color: pal.rune, count: 7 });
  // 一圈席位石
  for (let i = 0; i < 9; i++) {
    const a = (TAU * i) / 9 + 0.2;
    const R = kit.rand(8.2, 8.9) * s;
    kit.geo(new THREE.IcosahedronGeometry(1, 0), {
      x: cx + Math.cos(a) * R, y: 0.28 * s, z: cz + Math.sin(a) * R,
      sx: kit.rand(0.85, 1.2) * s, sy: 0.55 * s, sz: kit.rand(0.85, 1.2) * s,
      ry: kit.rand(0, TAU), color: COL.stone, mat: 'stone',
    });
  }
  kit.collider(cx, cz, 3.6 * s);
}

/** 篝火坑 */
function buildBonfire(kit, cx, cz, s, pal) {
  // 石圈
  for (let i = 0; i < 12; i++) {
    const a = (TAU * i) / 12;
    kit.geo(new THREE.IcosahedronGeometry(kit.rand(0.45, 0.68) * s, 0), {
      x: cx + Math.cos(a) * 2.6 * s, y: 0.3 * s, z: cz + Math.sin(a) * 2.6 * s,
      sx: kit.rand(1.0, 1.5), sy: kit.rand(0.6, 1.0), sz: kit.rand(1.0, 1.5),
      color: i % 2 ? COL.stone : COL.stoneDark, mat: 'stone',
    });
  }
  // 灰坑
  kit.cyl(2.25 * s, 2.4 * s, 0.24 * s, 12, cx, 0.1 * s, cz, { color: COL.dark, mat: 'stone' });
  // 交叉的木柴
  for (let i = 0; i < 7; i++) {
    const a = (TAU * i) / 7;
    limbXZ(kit, cx + Math.cos(a) * 1.8 * s, cz + Math.sin(a) * 1.8 * s, 0.18 * s,
      cx + Math.cos(a) * 0.25 * s, cz + Math.sin(a) * 0.25 * s, 1.5 * s,
      0.16 * s, 0.1 * s, 5, i % 2 ? COL.woodDark : COL.wood);
  }
  // 火焰（发光的锥体叠起来）
  kit.cone(1.15 * s, 2.0 * s, 7, cx, 1.15 * s, cz, { color: pal.flame, mat: 'glow', shade: false });
  kit.cone(0.72 * s, 1.5 * s, 6, cx, 1.9 * s, cz, { color: COL.glowGold, mat: 'glow', shade: false });
  kit.cone(0.36 * s, 0.9 * s, 5, cx, 2.4 * s, cz, { color: COL.glowCyan, mat: 'glow', shade: false });
  kit.glowBlob(cx, 2.4 * s, cz, 3.0 * s, pal.flame);
  kit.glowBlob(cx, 5.2 * s, cz, 4.6 * s, COL.glowGold);
  // 三角吊架
  for (let i = 0; i < 3; i++) {
    const a = (TAU * i) / 3 + 0.5;
    limbXZ(kit, cx + Math.cos(a) * 2.5 * s, cz + Math.sin(a) * 2.5 * s, 0,
      cx + Math.cos(a) * 0.35 * s, cz + Math.sin(a) * 0.35 * s, 4.6 * s,
      0.09 * s, 0.06 * s, 5, COL.woodDark);
  }
  kit.collider(cx, cz, 2.5 * s);
}

/** 水井（石圈 + 木架 + 人字小顶 + 吊桶） */
function buildWell(kit, cx, cz, rotY, s) {
  const f = makeFrame(cx, cz, rotY);
  // 井圈
  kit.cyl(1.95 * s, 2.15 * s, 1.45 * s, 14, cx, 0.72 * s, cz, { color: COL.stoneDark, mat: 'stone' });
  kit.torus(1.9 * s, 0.22 * s, 5, 18, cx, 1.45 * s, cz, {
    rx: Math.PI / 2, color: COL.stoneLight, mat: 'stone',
  });
  // 井水
  kit.cyl(1.65 * s, 1.65 * s, 0.06 * s, 14, cx, 1.12 * s, cz, { color: COL.water, mat: 'glass' });
  // 两根立柱 + 横梁
  for (const sx of [-1, 1]) {
    f.box(kit, 0.26 * s, 3.0 * s, 0.26 * s, sx * 1.85 * s, 1.5 * s, 0,
      { color: COL.woodDark, mat: 'wood' });
  }
  f.cyl(kit, 0.12 * s, 0.12 * s, 3.7 * s, 6, 0, 2.95 * s, 0,
    { color: COL.woodDark, mat: 'wood', rz: Math.PI / 2 });
  // 吊绳 + 水桶
  f.cyl(kit, 0.03 * s, 0.03 * s, 1.5 * s, 4, 0.5 * s, 2.2 * s, 0, { color: COL.clothCream, mat: 'cloth' });
  f.cyl(kit, 0.26 * s, 0.22 * s, 0.45 * s, 8, 0.5 * s, 1.35 * s, 0,
    { color: COL.woodWarm, mat: 'wood' });
  // 小屋顶
  kit.roofGable(f.x(0, 0), f.z(0, 0), {
    w: 4.4 * s, d: 3.2 * s, h: 1.25 * s, rotY,
    y0: 3.05 * s, color: COL.woodDark, mat: 'wood',
    thickness: 0.22 * s, overhang: 0.35 * s,
  });
  kit.runeBand(cx, 0.95 * s, cz + 2.02 * s, { w: 1.4 * s, h: 0.32 * s, rotY: 0, color: COL.glowGold, count: 3 });
  kit.collider(cx, cz, 2.35 * s);
}

/** 晒鱼架（A 字架 + 横杆 + 挂鱼） */
function buildFishRack(kit, cx, cz, rotY, s) {
  const f = makeFrame(cx, cz, rotY);
  const topY = 2.55 * s;
  // 两副 A 字架
  for (const sx of [-1, 1]) {
    const lx = sx * 2.5 * s;
    const top = f.p(lx, 0);
    for (const sz of [-1, 1]) {
      const base = f.p(lx, sz * 1.0 * s);
      limbXZ(kit, base.x, base.z, 0, top.x, top.z, topY, 0.1 * s, 0.065 * s, 5, COL.woodDark);
    }
    f.box(kit, 0.16 * s, 0.16 * s, 2.3 * s, lx, topY * 0.55, 0, { color: COL.wood, mat: 'wood' });
  }
  // 两根横杆
  for (const by of [topY, topY - 0.45 * s]) {
    const a = f.p(-2.5 * s, 0);
    const b = f.p(2.5 * s, 0);
    limbXZ(kit, a.x, a.z, by, b.x, b.z, by, 0.07 * s, 0.07 * s, 5, COL.wood);
  }
  // 挂着的鱼
  for (let i = 0; i < 7; i++) {
    const lx = -2.1 * s + (4.2 * s * i) / 6;
    const q = f.p(lx, kit.rand(-0.15, 0.15) * s);
    kit.geo(new THREE.IcosahedronGeometry(1, 1), {
      x: q.x, y: topY - kit.rand(0.4, 0.8) * s, z: q.z,
      sx: 0.13 * s, sy: 0.58 * s, sz: 0.24 * s,
      ry: rotY + kit.rand(-0.2, 0.2),
      color: i % 2 ? COL.bone : COL.snow, mat: 'stone',
    });
  }
  kit.collider(cx, cz, 1.9 * s);
}

/** 木柴堆（横放圆木 + 劈柴） */
function buildWoodpile(kit, cx, cz, rotY, s) {
  const f = makeFrame(cx, cz, rotY);
  for (let row = 0; row < 3; row++) {
    const n = 4 - row;
    for (let i = 0; i < n; i++) {
      const lz = (i - (n - 1) / 2) * 0.34 * s;
      const y = (0.17 + row * 0.31) * s;
      const a = f.p(-1.15 * s, lz);
      const b = f.p(1.15 * s, lz);
      limbXZ(kit, a.x, a.z, y, b.x, b.z, y, 0.17 * s, 0.16 * s, 6,
        row % 2 ? COL.wood : COL.woodDark);
    }
  }
  // 靠在旁边的劈柴
  for (let i = 0; i < 5; i++) {
    const lx = kit.rand(-1.4, 1.4) * s;
    const lz = kit.rand(-0.9, 0.9) * s;
    const a = f.p(lx, lz);
    limbXZ(kit, a.x, a.z, 0, a.x + kit.rand(-0.2, 0.2) * s, a.z + kit.rand(-0.2, 0.2) * s, kit.rand(0.6, 1.0) * s,
      0.1 * s, 0.06 * s, 5, COL.woodDark);
  }
  kit.collider(cx, cz, 1.5 * s);
}

/** 木桶 / 木箱 */
function buildBarrel(kit, x, z, s, kind) {
  if (kind === 0) {
    kit.cyl(0.4 * s, 0.35 * s, 1.0 * s, 10, x, 0.5 * s, z, { color: COL.wood, mat: 'wood' });
    for (const by of [0.22, 0.78]) {
      kit.cyl(0.43 * s, 0.43 * s, 0.09 * s, 10, x, by * s, z, { color: COL.iron, mat: 'iron' });
    }
  } else {
    kit.box(0.9 * s, 0.8 * s, 0.8 * s, x, 0.4 * s, z, { color: COL.woodWarm, mat: 'wood', ry: kit.rand(0, TAU) });
    kit.box(0.95 * s, 0.1 * s, 0.85 * s, x, 0.82 * s, z, { color: COL.woodDark, mat: 'wood' });
  }
}

/* ============================================================================
 * 主生成器
 * ==========================================================================*/

/**
 * 构建长屋村落。
 * @param {{scale?:number,seed?:number,variant?:number}} opts
 * @returns {THREE.Group}
 */
export function buildVillage(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const s = Math.max(0.25, Number(scale) || 1);
  const v = Math.abs(Math.round(Number(variant) || 0)) % THEMES.length;
  const pal = THEMES[v];
  const kit = new Kit({ seed: 6201 + (Number(seed) || 1) * 149 });

  // ================================================================ 0. 村落骨架
  const FENCE_R = 45 * s;          // 栅栏半径
  const HOUSE_R = 32 * s;          // 房屋环绕半径
  const GATE_A = Math.PI / 2;      // 入口在局部 +Z 方向
  const GATE_R = FENCE_R;

  // ================================================================ 1. 八栋长屋
  const HOUSES = 8;
  for (let i = 0; i < HOUSES; i++) {
    const a = (TAU * i) / HOUSES + 0.38;
    const R = HOUSE_R + kit.rand(-1.3, 1.3) * s;
    const cx = Math.cos(a) * R;
    const cz = Math.sin(a) * R;
    // 门朝向村中心：局部 +Z 指向 (-cos a, -sin a)
    const rotY = Math.atan2(-Math.cos(a), -Math.sin(a));
    buildLonghouse(kit, cx, cz, rotY, {
      len: kit.rand(16, 19.5) * s,
      wid: kit.rand(8.2, 9.6) * s,
      wallH: kit.rand(4.3, 5.0) * s,
      roofH: kit.rand(3.4, 4.3) * s,
      s, pal,
    });
  }

  // ================================================================ 2. 栅栏与村口木门
  buildFence(kit, FENCE_R, GATE_A, s);
  buildGate(kit, 0, GATE_R, Math.PI, s, pal);

  // 从村口通往议事石的踏石小径
  for (let i = 0; i < 12; i++) {
    const z = FENCE_R - 1.5 * s - i * 2.7 * s;
    kit.box(2.3 * s, 0.1 * s, 1.5 * s, kit.rand(-0.35, 0.35) * s, 0.05 * s, z, {
      ry: kit.rand(-0.12, 0.12),
      color: i % 2 ? COL.stone : COL.stoneDark, mat: 'stone',
    });
  }

  // ================================================================ 3. 中央广场
  buildAssemblyStone(kit, 0, 0, s, pal);
  buildBonfire(kit, -10.5 * s, 8.5 * s, s, pal);
  // 水井：放在广场东侧，避开 Landmarks 在半径 14m 处生成的 NPC 位置
  buildWell(kit, 15.5 * s, 3.2 * s, -0.25, s);

  // 广场火把（四支）
  for (let i = 0; i < 4; i++) {
    const a = (TAU * i) / 4 + Math.PI / 4;
    const x = Math.cos(a) * 17 * s;
    const z = Math.sin(a) * 17 * s;
    kit.cyl(0.13 * s, 0.17 * s, 3.2 * s, 6, x, 1.6 * s, z, { color: COL.woodDark, mat: 'wood' });
    kit.box(0.5 * s, 0.34 * s, 0.5 * s, x, 3.35 * s, z, { color: pal.flame, mat: 'glow', shade: false });
    kit.glowBlob(x, 3.5 * s, z, 2.6 * s, pal.flame);
    kit.collider(x, z, 0.45 * s);
  }

  // ================================================================ 4. 生产/生活道具
  buildFishRack(kit, 16.5 * s, -9.5 * s, -0.9, s);
  buildFishRack(kit, 20.5 * s, -4.0 * s, -1.35, s);
  buildWoodpile(kit, -17.5 * s, -8.0 * s, 0.55, s);
  buildWoodpile(kit, 5.5 * s, -20.0 * s, -0.8, s);
  buildWoodpile(kit, -24.0 * s, 3.5 * s, 1.4, s);

  // 房屋之间的木桶与木箱
  const barrelSpots = [
    [12.0, 18.0, 0], [-14.5, 17.5, 1], [22.5, 8.5, 0],
    [-21.0, -11.0, 1], [8.0, -22.5, 0], [-6.5, 21.0, 1],
    [24.0, -14.0, 0], [-24.5, -2.0, 0],
  ];
  for (const [bx, bz, kind] of barrelSpots) {
    buildBarrel(kit, bx * s, bz * s, s, kind);
  }

  // 晾晒的兽皮（两根杆 + 布面）
  for (let i = 0; i < 2; i++) {
    const a = 2.35 + i * 0.7;
    const R = 25 * s;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const rotY = Math.PI / 2 - a;
    const f = makeFrame(x, z, rotY);
    for (const sx of [-1, 1]) {
      f.cyl(kit, 0.09 * s, 0.12 * s, 2.6 * s, 5, sx * 1.7 * s, 1.3 * s, 0,
        { color: COL.woodDark, mat: 'wood' });
    }
    f.box(kit, 3.6 * s, 0.08 * s, 0.08 * s, 0, 2.55 * s, 0, { color: COL.woodDark, mat: 'wood' });
    f.box(kit, 2.8 * s, 1.5 * s, 0.06 * s, 0, 1.75 * s, 0.04 * s,
      { color: i ? COL.clothCream : COL.clothBlue, mat: 'cloth' });
    kit.collider(x, z, 1.4 * s);
  }

  // ================================================================ 5. 组装
  const group = kit.build({ name: 'village' });
  group.userData.meta = meta;
  group.userData.variant = v;
  group.userData.fenceRadius = FENCE_R;
  group.userData.gate = { x: 0, z: GATE_R, rotY: Math.PI };
  return group;
}

/** 地标元信息（scale = 1 时的设计尺寸） */
export const meta = {
  id: 'village',
  label: '长屋村 · 阿斯克',
  radius: 48,
  height: 13,
};
