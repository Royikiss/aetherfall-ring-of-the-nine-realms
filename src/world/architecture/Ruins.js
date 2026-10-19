/**
 * Ruins.js — 低语石环（Whispering Circle）/ 锻炉废址
 *
 * 模块职责：
 *   北欧神话的"远古遗迹"：12 块高 6–9m 的立石围成直径 40m 的环、石面刻发光符文，
 *   中央是半塌的祭坛与发光晶核，四周散落 4–6 根断裂石柱、倒伏石块与碎石。
 *   variant 1 会额外生成矮人锻炉遗构（倒塌烟囱、铁砧、炭坑、炉渣），
 *   因此同一生成器也能用于「锻炉废址」。
 *
 * 对外 API：
 *   buildRuins(opts) -> THREE.Group
 *     opts = { scale = 1, seed = 1, variant = 0 }
 *       variant 0：低语石环（青蓝符文）
 *       variant 1：锻炉废址（余烬符文 + 锻炉遗构）
 *   meta = { id, label, radius, height }
 *
 * 坐标约定：
 *   以祭坛中心为原点，y=0 为地面；碰撞体（kit.collider）为局部坐标。
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** 主题：0 低语石环（青） / 1 锻炉废址（余烬） */
const THEMES = [
  {
    rune: COL.glowCyan, accent: COL.glowGold, stone: COL.stoneCold,
    mist: COL.glowCyan, forge: false,
  },
  {
    rune: COL.glowEmber, accent: COL.glowBlood, stone: COL.rock,
    mist: COL.glowEmber, forge: true,
  },
];

/* ============================================================================
 * 小工具（不依赖 Kit 内部实现）
 * ==========================================================================*/

/**
 * 位置哈希：同一坐标的多份顶点得到相同扰动，保证顶面不开裂。
 * 完全确定性，不依赖 Math.random()。
 */
function hash3(x, y, z, seed) {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d);
  h ^= Math.imul(Math.round(y * 64) | 0, 0x165667b1);
  h ^= Math.imul(Math.round(z * 64) | 0, 0x9e3779b1);
  h ^= Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * 把长方体的顶点做确定性扰动，得到粗粝的"手工凿石"外观。
 * @param {number} w 宽（局部 X）
 * @param {number} h 高（局部 Y）
 * @param {number} d 厚（局部 Z）
 * @param {number} seed 随机种子
 * @param {number} amp 扰动幅度
 */
function roughBox(w, h, d, seed, amp = 0.22, segX = 2, segY = 4, segZ = 2) {
  const g = new THREE.BoxGeometry(w, h, d, segX, segY, segZ);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = hash3(x, y, z, seed) - 0.5;
    const ny = hash3(x, y, z, seed + 17) - 0.5;
    const nz = hash3(x, y, z, seed + 31) - 0.5;
    // 上下端面收缩小一点，保证与地面/上一层接触稳定
    const edge = Math.min(1, (Math.abs(y) / (h * 0.5)) * 1.3);
    pos.setX(i, x + nx * amp * w * 0.5 * (0.35 + 0.65 * edge));
    pos.setY(i, y + ny * amp * h * 0.2 * edge);
    pos.setZ(i, z + nz * amp * d * 0.5 * (0.35 + 0.65 * edge));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 组一个 TRS 矩阵（供 kit.place 使用） */
function trs(px, py, pz, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

/** 在 a→b 之间放一段圆台（断柱、倒伏柱鼓、木材通用） */
function limb(kit, a, b, r0, r1, seg, color, mat = 'stone') {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.001) return;
  dir.divideScalar(len);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const mat4 = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  kit.place(new THREE.CylinderGeometry(r1, r0, len, seg, 1, false), mat4, color, mat, true);
}

/* ============================================================================
 * 主生成器
 * ==========================================================================*/

/**
 * 构建废墟。
 * @param {{scale?:number,seed?:number,variant?:number}} opts
 * @returns {THREE.Group}
 */
export function buildRuins(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const s = Math.max(0.25, Number(scale) || 1);
  const v = Math.abs(Math.round(Number(variant) || 0)) % THEMES.length;
  const th = THEMES[v];
  const kit = new Kit({ seed: 4301 + (Number(seed) || 1) * 173 });
  const seedBase = ((Number(seed) || 1) * 997) | 0;

  const ringR = 20 * s;   // 石环半径 → 直径 40m

  // ================================================================ 1. 立石环（12 块）
  const STONES = 12;
  const stoneTops = [];
  for (let i = 0; i < STONES; i++) {
    const a = (TAU * i) / STONES + kit.rand(-0.05, 0.05);
    const rr = ringR * kit.rand(0.975, 1.025);
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;

    // 朝向圆心：局部 +Z 指向圆心，局部 +X 沿切向
    const theta = Math.atan2(-Math.cos(a), -Math.sin(a));
    const w = kit.rand(2.2, 3.2) * s;
    const d = kit.rand(1.35, 1.95) * s;
    const fullH = kit.rand(6, 9) * s;
    const broken = i === 3 || i === 8;   // 其中两块已经断裂
    const h = broken ? fullH * kit.rand(0.42, 0.6) : fullH;
    const lean = kit.rand(-0.05, 0.05);

    // 1.1 半埋在土里的基座
    kit.place(roughBox(w * 1.6, 0.95 * s, d * 1.72, seedBase + i * 13 + 1, 0.24),
      trs(x, 0.36 * s, z, 0, theta, 0), COL.stoneDark, 'stone');

    // 1.2 立石主体（底部多埋 2.8m：遗迹常位于起伏地形上，埋深可避免悬空）
    const bury = 2.8 * s;
    kit.place(roughBox(w, h + bury, d, seedBase + i * 13, 0.26),
      trs(x, h / 2 + 0.32 * s - bury / 2, z, lean, theta, kit.rand(-0.03, 0.03)), th.stone, 'stone');

    // 1.3 顶部：完整石加压顶，断石加锯齿状残块
    if (broken) {
      for (let k = 0; k < 3; k++) {
        const cw = w * kit.rand(0.35, 0.75);
        const chh = kit.rand(0.6, 1.5) * s;
        kit.place(roughBox(cw, chh, d * kit.rand(0.55, 0.95), seedBase + i * 13 + 40 + k, 0.3),
          trs(x + kit.rand(-w * 0.28, w * 0.28), h + 0.32 * s + chh * 0.3,
            z + kit.rand(-d * 0.28, d * 0.28),
            kit.rand(-0.25, 0.25), theta + kit.rand(-0.5, 0.5), kit.rand(-0.25, 0.25)),
          COL.stoneDark, 'stone');
      }
    } else {
      kit.place(roughBox(w * 1.12, 0.55 * s, d * 1.16, seedBase + i * 13 + 5, 0.2),
        trs(x, h + 0.5 * s, z, lean, theta, 0), COL.stoneDark, 'stone');
    }

    // 1.4 面向圆心的符文（发光）
    const inX = -Math.cos(a);
    const inZ = -Math.sin(a);
    kit.runeBand(
      x + inX * (d / 2 + 0.04 * s), h * kit.rand(0.44, 0.62), z + inZ * (d / 2 + 0.04 * s), {
        w: w * 0.66, h: 0.72 * s, rotY: theta, color: th.rune, count: 4,
      },
    );
    // 顶部"符文之眼"
    if (kit.chance(0.6)) {
      kit.box(0.42 * s, 0.95 * s, 0.07 * s,
        x + inX * (d / 2 + 0.055 * s), h * 0.82, z + inZ * (d / 2 + 0.055 * s),
        { ry: theta, color: th.accent, mat: 'glow', shade: false });
    }
    // 石缝里的苔藓
    if (kit.chance(0.65)) {
      kit.geo(new THREE.IcosahedronGeometry(1, 0), {
        x: x + inX * (d / 2) * 0.7 + kit.rand(-0.8, 0.8) * s,
        y: kit.rand(0.6, 2.4) * s,
        z: z + inZ * (d / 2) * 0.7 + kit.rand(-0.8, 0.8) * s,
        sx: kit.rand(0.5, 1.1) * s, sy: 0.18 * s, sz: kit.rand(0.5, 1.1) * s,
        ry: kit.rand(0, TAU), color: COL.mossDark, mat: 'wood',
      });
    }

    stoneTops.push({ x, z, h });
    kit.collider(x, z, Math.max(w, d) * 0.62);
  }

  // ================================================================ 2. 中央半塌祭坛
  const altR = 6.2 * s;
  kit.cyl(altR, altR * 1.05, 0.5 * s, 12, 0, 0.25 * s, 0, { color: COL.stoneDark, mat: 'stone' });
  kit.cyl(altR * 0.8, altR * 0.84, 0.5 * s, 12, 0, 0.75 * s, 0, { color: COL.stone, mat: 'stone' });
  kit.cyl(altR * 0.62, altR * 0.66, 0.55 * s, 12, 0, 1.27 * s, 0, { color: COL.stoneLight, mat: 'stone' });
  const altY = 1.52 * s;

  // 2.0 祭坛台基的可行走平台（三级，8 个旋转矩形逼近圆盘）
  const platforms = [];
  const addDisc = (radius, y) => {
    for (let k = 0; k < 8; k++) {
      platforms.push({ x: 0, z: 0, hw: radius * 0.985, hd: radius * 0.2, rotY: (Math.PI * k) / 8, y });
    }
  };
  addDisc(altR, 0.5 * s);
  addDisc(altR * 0.8, 1.0 * s);
  addDisc(altR * 0.62, 1.545 * s);

  // 2.1 祭台主体（一半还立着）
  kit.place(roughBox(3.4 * s, 2.0 * s, 2.6 * s, seedBase + 301, 0.2),
    trs(0, altY + 1.0 * s, 0, 0, 0.35, 0), COL.stone, 'stone');
  // 2.2 断成两截、错位倒下的另一半
  kit.place(roughBox(1.6 * s, 1.9 * s, 2.4 * s, seedBase + 307, 0.24),
    trs(2.15 * s, altY + 0.85 * s, 0.5 * s, 0.12, 0.95, 0.2), COL.stoneLight, 'stone');
  // 2.3 倒塌的祭坛顶板
  kit.place(roughBox(4.6 * s, 0.55 * s, 3.0 * s, seedBase + 313, 0.16),
    trs(-2.7 * s, 0.55 * s, -2.0 * s, 0.12, 0.72, 0.3), COL.stoneDark, 'stone');
  // 2.4 两根只剩半截的祭坛柱
  for (const sx of [-1, 1]) {
    const cx = sx * 3.1 * s;
    const cz = -1.6 * s;
    const hh = (sx < 0 ? 2.4 : 1.2) * s;
    kit.box(1.0 * s, 0.4 * s, 1.0 * s, cx, 0.2 * s, cz, { color: COL.stoneDark, mat: 'stone' });
    kit.cyl(0.42 * s, 0.46 * s, hh, 9, cx, 0.4 * s + hh / 2, cz, { color: COL.stoneCold, mat: 'stone' });
    if (sx < 0) {
      kit.runeBand(cx, 0.4 * s + hh * 0.62, cz + 0.5 * s, {
        w: 0.8 * s, h: 1.1 * s, rotY: 0, color: th.rune, count: 3,
      });
    }
  }
  // 2.5 祭坛中心的发光晶核
  kit.geo(new THREE.IcosahedronGeometry(0.78 * s, 1), {
    x: 0.15 * s, y: altY + 1.35 * s, z: 0,
    sx: 1, sy: 3.0, sz: 1, color: th.rune, mat: 'glow', shade: false,
  });
  kit.geo(new THREE.IcosahedronGeometry(0.3 * s, 0), {
    x: 0.9 * s, y: altY + 2.6 * s, z: 0.5 * s,
    sx: 1, sy: 2.4, sz: 1, ry: 0.6, color: th.accent, mat: 'glow', shade: false,
  });
  kit.glowBlob(0.15 * s, altY + 3.0 * s, 0, 4.0 * s, th.rune);
  kit.glowBlob(0.15 * s, altY + 5.8 * s, 0, 7.0 * s, th.accent);
  kit.collider(0, 0, altR * 0.7);

  // ================================================================ 3. 地面符文圆环
  kit.torus(11.5 * s, 0.14 * s, 5, 64, 0, 0.05 * s, 0, {
    rx: Math.PI / 2, color: th.rune, mat: 'glow', shade: false,
  });
  for (let i = 0; i < 24; i++) {
    const a = (TAU * i) / 24;
    const R = (i % 2 ? 11.5 : 12.6) * s;
    kit.geo(new THREE.BoxGeometry((i % 2 ? 1.4 : 0.7) * s, 0.04 * s, (i % 2 ? 0.45 : 1.2) * s), {
      x: Math.cos(a) * R, y: 0.06 * s, z: Math.sin(a) * R,
      ry: -a, color: i % 2 ? th.rune : th.accent, mat: 'glow', shade: false,
    });
  }

  // 中心通往石环的四条砾石小径（压平的地面石板）
  for (let k = 0; k < 4; k++) {
    const a = (TAU * k) / 4 + Math.PI / 4;
    for (let j = 0; j < 6; j++) {
      const R = (7.5 + j * 1.7) * s;
      kit.box(1.5 * s, 0.1 * s, 1.05 * s, Math.cos(a) * R, 0.05 * s, Math.sin(a) * R, {
        ry: -a + kit.rand(-0.2, 0.2),
        color: kit.chance(0.4) ? COL.stone : COL.stoneDark, mat: 'stone',
      });
    }
  }

  // ================================================================ 4. 断裂石柱（5 根）
  for (let i = 0; i < 5; i++) {
    const a = (TAU * i) / 5 + 0.62;
    const R = kit.rand(12.5, 15.5) * s;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const r = kit.rand(0.55, 0.82) * s;
    const hh = kit.rand(1.5, 4.6) * s;
    const tipLean = kit.rand(-0.08, 0.08);

    // 柱础（向下多埋 1.65m，防止地形起伏时悬空）
    kit.box(r * 3.4, 2.2 * s, r * 3.4, x, -0.55 * s, z, {
      ry: kit.rand(0, TAU), color: COL.stoneDark, mat: 'stone',
    });
    // 柱身
    kit.place(new THREE.CylinderGeometry(r * 0.9, r, hh, 10, 1, false),
      trs(x, 0.5 * s + hh / 2, z, tipLean, kit.rand(0, TAU), 0), th.stone, 'stone');
    // 断口碎块
    for (let k = 0; k < 3; k++) {
      const cw = r * kit.rand(0.5, 1.0);
      kit.place(roughBox(cw, cw * kit.rand(0.5, 0.9), cw, seedBase + 400 + i * 7 + k, 0.3),
        trs(x + kit.rand(-r, r), 0.5 * s + hh + cw * 0.3, z + kit.rand(-r, r),
          kit.rand(-0.4, 0.4), kit.rand(0, TAU), kit.rand(-0.4, 0.4)),
        COL.stoneDark, 'stone');
    }
    // 柱身符文（朝外）
    kit.runeBand(x + Math.cos(a) * (r + 0.05 * s), 0.5 * s + hh * 0.55, z + Math.sin(a) * (r + 0.05 * s), {
      w: r * 2.0, h: 0.55 * s, rotY: Math.PI / 2 - a, color: th.rune, count: 3,
    });
    kit.collider(x, z, r * 1.8);
  }

  // ================================================================ 5. 倒伏的柱鼓与横石
  for (let i = 0; i < 3; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(9, 14.5) * s;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const dir = kit.rand(0, TAU);
    const len = kit.rand(2.0, 3.4) * s;
    const r = kit.rand(0.5, 0.72) * s;
    limb(kit,
      new THREE.Vector3(x - Math.cos(dir) * len / 2, r, z - Math.sin(dir) * len / 2),
      new THREE.Vector3(x + Math.cos(dir) * len / 2, r, z + Math.sin(dir) * len / 2),
      r, r * 0.94, 9, th.stone);
    kit.collider(x, z, r * 1.6);
  }
  // 两块倒伏的横石（像倒塌的门楣）
  for (let i = 0; i < 2; i++) {
    const a = (TAU * (i + 0.5)) / 2 + 0.4;
    const R = kit.rand(15.5, 18) * s;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    kit.place(roughBox(kit.rand(3.6, 5.2) * s, 2.65 * s, 1.5 * s, seedBase + 500 + i, 0.24),
      trs(x, -0.25 * s, z, kit.rand(-0.12, 0.12), a + Math.PI / 2 + kit.rand(-0.3, 0.3), kit.rand(-0.1, 0.1)),
      COL.stone, 'stone');
    kit.collider(x, z, 1.8 * s);
  }

  // ================================================================ 6. 碎石、苔痕与雾气
  for (let i = 0; i < 34; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(4, 19) * s;
    const sz = kit.rand(0.3, 1.3) * s;
    kit.geo(new THREE.IcosahedronGeometry(sz, 0), {
      x: Math.cos(a) * R, y: sz * 0.42, z: Math.sin(a) * R,
      sx: kit.rand(1.1, 2.1), sy: kit.rand(0.45, 0.8), sz: kit.rand(1.1, 2.1),
      ry: kit.rand(0, TAU),
      color: kit.chance(0.45) ? COL.stoneDark : COL.rock, mat: 'stone',
    });
  }
  for (let i = 0; i < 14; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(6, 21) * s;
    kit.geo(new THREE.IcosahedronGeometry(1, 0), {
      x: Math.cos(a) * R, y: 0.05 * s, z: Math.sin(a) * R,
      sx: kit.rand(1, 3) * s, sy: 0.1 * s, sz: kit.rand(1, 3) * s,
      ry: kit.rand(0, TAU), color: kit.chance(0.5) ? COL.mossDark : COL.moss, mat: 'wood',
    });
  }
  // 贴地雾气（低语石环的"低语"）—— 抬到地面以上，避免光晕沉到地下
  for (let i = 0; i < 12; i++) {
    const a = kit.rand(0, TAU);
    const R = kit.rand(4, 20) * s;
    const rr = kit.rand(1.6, 3.8) * s;
    kit.glowBlob(Math.cos(a) * R, rr * 0.72 + kit.rand(0.1, 0.8) * s, Math.sin(a) * R, rr, th.mist);
  }

  // ================================================================ 7. variant 1：锻炉遗构
  if (th.forge) {
    // 7.1 倒塌的烟囱
    const chx = -3.4 * s;
    const chz = 9.2 * s;
    let chY = 0;
    for (let i = 0; i < 6; i++) {
      const hh = kit.rand(0.7, 1.15) * s;
      const ww = (1.7 - i * 0.14) * s;
      kit.place(roughBox(ww, hh, ww, seedBase + 600 + i, 0.2),
        trs(chx + kit.rand(-0.18, 0.18) * s, chY + hh / 2, chz + kit.rand(-0.18, 0.18) * s,
          kit.rand(-0.05, 0.05), kit.rand(0, 0.4), kit.rand(-0.05, 0.05)),
        COL.stoneDark, 'stone');
      chY += hh;
    }
    // 烟囱内的余烬
    kit.box(0.9 * s, 0.5 * s, 0.9 * s, chx, chY - 0.4 * s, chz, {
      color: th.rune, mat: 'glow', shade: false,
    });
    kit.glowBlob(chx, chY - 0.2 * s, chz, 3.2 * s, th.rune);
    kit.collider(chx, chz, 1.2 * s);

    // 7.2 铁砧与砧座
    const anx = 5.2 * s;
    const anz = -6.2 * s;
    kit.cyl(0.85 * s, 1.0 * s, 0.9 * s, 10, anx, 0.45 * s, anz, { color: COL.woodDark, mat: 'wood' });
    kit.box(1.5 * s, 0.35 * s, 0.7 * s, anx, 1.05 * s, anz, { color: COL.iron, mat: 'iron' });
    kit.box(0.7 * s, 0.35 * s, 0.55 * s, anx - 0.55 * s, 1.3 * s, anz, { color: COL.iron, mat: 'iron' });
    kit.cone(0.28 * s, 0.9 * s, 6, anx + 0.85 * s, 1.15 * s, anz, {
      rz: -Math.PI / 2, color: COL.iron, mat: 'iron',
    });
    kit.collider(anx, anz, 1.3 * s);

    // 7.3 炭坑
    const cx = 2.2 * s;
    const cz = 7.6 * s;
    kit.cyl(2.2 * s, 2.4 * s, 0.28 * s, 12, cx, 0.14 * s, cz, { color: COL.black, mat: 'stone' });
    for (let i = 0; i < 9; i++) {
      const a = (TAU * i) / 9;
      const rr = kit.rand(0.2, 1.5) * s;
      kit.geo(new THREE.IcosahedronGeometry(kit.rand(0.18, 0.42) * s, 0), {
        x: cx + Math.cos(a) * rr, y: kit.rand(0.2, 0.42) * s, z: cz + Math.sin(a) * rr,
        color: kit.chance(0.55) ? th.rune : COL.glowBlood, mat: 'glow', shade: false,
      });
    }
    kit.glowBlob(cx, 3.0 * s, cz, 2.8 * s, th.rune);
    kit.collider(cx, cz, 2.1 * s);

    // 7.4 炉渣堆与矮人刻石
    for (let i = 0; i < 8; i++) {
      const a = kit.rand(0, TAU);
      const R = kit.rand(8, 17) * s;
      const sz = kit.rand(0.4, 1.4) * s;
      kit.geo(new THREE.IcosahedronGeometry(sz, 0), {
        x: Math.cos(a) * R, y: sz * 0.4, z: Math.sin(a) * R,
        sx: kit.rand(1, 1.8), sy: kit.rand(0.5, 0.9), sz: kit.rand(1, 1.8),
        color: COL.basalt, mat: 'stone',
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = (TAU * i) / 3 + 1.1;
      const R = 9.5 * s;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      kit.place(roughBox(1.6 * s, 2.4 * s, 0.9 * s, seedBase + 700 + i, 0.16),
        trs(x, 1.2 * s, z, 0, Math.PI / 2 - a, 0), COL.basalt, 'stone');
      kit.runeBand(x + Math.cos(a) * 0.5 * s, 1.5 * s, z + Math.sin(a) * 0.5 * s, {
        w: 1.0 * s, h: 0.9 * s, rotY: Math.PI / 2 - a, color: th.rune, count: 3,
      });
    }
  }

  // ================================================================ 8. 组装
  const group = kit.build({ name: th.forge ? 'forgeRuins' : 'stoneCircle' });
  group.userData.meta = meta;
  group.userData.variant = v;
  group.userData.ringRadius = ringR;
  group.userData.platforms = platforms;
  return group;
}

/** 地标元信息（scale = 1 时的设计尺寸） */
export const meta = {
  id: 'ruins',
  label: '低语石环',
  radius: 30,
  height: 10,
};
