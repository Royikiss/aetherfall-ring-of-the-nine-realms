/**
 * GreatHall.js — 「英灵殿 · 金宫」（VALHALLA）
 *
 * 模块职责：
 *   用 Kit 拼出北欧神话式的镀金大厅：正面阶梯山墙、两排巨型柱廊、
 *   金色人字屋顶、屋脊交错的金色枪尖、悬挂长旗、门前火盆、两侧台阶与矮墙。
 *
 * 对外 API：
 *   buildGreatHall(opts) -> THREE.Group
 *   meta -> { id, label, radius, height }（设计尺度 = scale 1 时）
 *
 * opts：{ scale=1, seed=1, variant=0, beacon=false（忽略） }
 *   builder 内部已烘焙 scale，World 只设置 position / rotation。
 *
 * userData：
 *   userData.colliders / boxColliders  已按最终尺度换算的碰撞体（建筑局部坐标）
 *   userData.platforms                 可行走平台（三处台阶 + 台基顶面）
 *   userData.height / radius / scaledBy / meta
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 *
 * 尺度：设计高度约 56m；data/world.js 中 scale=1.15 → 约 64m（屋脊枪尖顶端）。
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

export const meta = {
  id: 'greatHall',
  label: '英灵殿 · 金宫',
  radius: 37,
  height: 56,
};

const FL = 2.2;          // 台基高度
const HALL_H = 30;       // 大厅墙身高度
const HALL_W = 40;       // 大厅宽度
const HALL_D = 64;       // 大厅进深
const HALL_Z = -6;       // 大厅中心 Z
const FRONT_Z = 26;      // 正立面位置
const ROOF_RISE = 15;    // 屋顶矢高
const GABLE_TOP = 48.9;  // 山墙顶（视觉主角）

export function buildGreatHall(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const kit = new Kit({ seed: seed + variant * 613 });

  // ================================================================
  // 1. 台基与两侧台阶
  // ================================================================
  kit.box(56, FL, 76, 0, -FL / 2, -5, { color: COL.stoneDark, mat: 'stone' });
  kit.box(56.8, 0.4, 76.8, 0, -0.2, -5, { color: COL.stoneLight, mat: 'stone' });
  // 正面台阶（6 级）
  kit.stairs(0, 33, { w: 34, steps: 6, rise: FL / 6, run: 0.72, y0: -FL, color: COL.stone });
  // 两翼台阶（沿 X 方向）
  kit.stairs(28, 20, { w: 16, steps: 6, rise: FL / 6, run: 0.72, y0: -FL, rotY: Math.PI / 2, color: COL.stone });
  kit.stairs(-28, 20, { w: 16, steps: 6, rise: FL / 6, run: 0.72, y0: -FL, rotY: -Math.PI / 2, color: COL.stone });

  // 台基边缘矮墙 + 垛口（北欧"木栅"意象的石化）
  for (const sx of [-1, 1]) {
    kit.box(2.0, 2.6, 26, sx * 27.2, 1.3, -3, { color: COL.stone, mat: 'stone' });
    for (let i = 0; i < 8; i++) {
      kit.box(2.4, 1.5, 2.0, sx * 27.2, 3.1, -14 + i * 3.4, { color: COL.stoneLight, mat: 'stone' });
    }
    // 矮墙端头望柱
    kit.box(2.8, 4.6, 2.8, sx * 27.2, 2.3, 30, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(1.5, 2.6, 6, sx * 27.2, 5.9, 30, { color: COL.gold, mat: 'gold' });
  }

  // ================================================================
  // 2. 大厅主体
  // ================================================================
  kit.box(HALL_W, HALL_H, HALL_D, 0, HALL_H / 2, HALL_Z, { color: COL.stone, mat: 'stone' });
  // 墙面横向石带（两条），把 30m 高的墙分成三段，避免"一面大白墙"
  for (const yy of [6.2, 22.5]) {
    kit.box(HALL_W + 0.8, 0.9, HALL_D + 0.8, 0, yy, HALL_Z, { color: COL.stoneLight, mat: 'stone' });
  }
  // 四角扶壁
  for (const sx of [-1, 1]) {
    for (const dz of [FRONT_Z - 2, -36]) {
      kit.box(3.2, HALL_H + 1, 3.2, sx * 19.2, (HALL_H + 1) / 2, dz, { color: COL.stoneLight, mat: 'stone' });
      kit.box(4.2, 1.2, 4.2, sx * 19.2, 0.6, dz, { color: COL.stoneDark, mat: 'stone' });
      kit.cone(1.8, 3.6, 6, sx * 19.2, HALL_H + 2.4, dz, { color: COL.gold, mat: 'gold' });
    }
  }

  // ================================================================
  // 3. 正面山墙（视觉主角：整面镀金阶梯山墙）
  // ================================================================
  // 阶梯状金色山墙：10 层，从 40m 宽收到 4m
  for (let i = 0; i < 10; i++) {
    const w = HALL_W * (1 - i / 10.4);
    kit.box(w, 1.85, 2.6, 0, HALL_H + 0.925 + i * 1.85, FRONT_Z + 0.6, {
      color: i % 2 ? COL.gold : COL.goldDeep, mat: 'gold',
    });
    // 每层边缘的金色线脚（亮色勾边）
    kit.box(w + 0.35, 0.22, 2.9, 0, HALL_H + i * 1.85, FRONT_Z + 0.6, { color: COL.goldBright, mat: 'gold' });
  }
  // 山墙顶的金色兽头/尖顶
  kit.box(3.4, 2.2, 3.0, 0, 48.6, FRONT_Z + 0.6, { color: COL.goldBright, mat: 'gold' });
  kit.cone(1.0, 4.4, 6, 0, 51.4, FRONT_Z + 0.6, { color: COL.goldBright, mat: 'gold' });

  // 山墙上的巨型金盾（英灵殿纹章）
  kit.cyl(4.4, 4.4, 0.9, 14, 0, 37.5, FRONT_Z + 2.95, { color: COL.goldBright, mat: 'gold', rx: Math.PI / 2 });
  kit.torus(3.1, 0.35, 4, 22, 0, 37.5, FRONT_Z + 3.55, { color: COL.bronze, mat: 'bronze' });
  kit.torus(1.7, 0.28, 4, 18, 0, 37.5, FRONT_Z + 3.65, { color: COL.goldBright, mat: 'gold' });
  // 盾后的交叉长矛
  for (const s of [-1, 1]) {
    kit.box(0.55, 21, 0.55, 0, 36.0, FRONT_Z + 2.55, { color: COL.goldDeep, mat: 'bronze', rz: s * 0.42 });
    kit.cone(0.75, 3.4, 5, s * 4.3, 44.6, FRONT_Z + 2.55, { color: COL.goldBright, mat: 'gold', rz: s * 0.42 });
  }

  // 山墙前的发光符文带 + 门楣
  kit.runeBand(0, 31.6, FRONT_Z + 2.0, { w: 30, h: 1.2, color: COL.glowGold, count: 34 });

  // 正面三座门（中央巨门 + 两侧小门）
  kit.archway(0, FRONT_Z + 1.4, {
    w: 13, h: 21, t: 3.0, depth: 3.2, color: COL.stoneLight, glow: false,
  });
  for (const sx of [-1, 1]) {
    kit.archway(sx * 14.4, FRONT_Z + 1.2, {
      w: 6.2, h: 10.5, t: 2.0, depth: 2.6, color: COL.stone, glow: false,
    });
  }
  // 青铜包边大门 + 发光门缝 + 门顶透光花窗（大厅内的火光从门缝里透出来）
  const putHallDoor = (cx, z, w, h) => {
    kit.box(w, h, 0.45, cx, h / 2, z, { color: COL.woodDark, mat: 'wood' });
    kit.box(0.24, h * 0.96, 0.2, cx, h / 2, z + 0.28, { color: COL.glowGold, mat: 'glow', shade: false });
    for (const s of [-1, 1]) {
      kit.box(0.5, h, 0.22, cx + s * (w / 2 - 0.25), h / 2, z + 0.24, { color: COL.bronze, mat: 'bronze' });
      // 门上的青铜竖条
      for (let i = 0; i < 3; i++) {
        kit.box(0.16, h * 0.92, 0.1, cx + s * (w * 0.18 + i * w * 0.12), h / 2, z + 0.26, {
          color: COL.gold, mat: 'gold',
        });
      }
      // 门环
      kit.torus(0.4, 0.09, 4, 10, cx + s * (w * 0.12), h * 0.45, z + 0.32, {
        color: COL.goldBright, mat: 'gold',
      });
    }
    kit.box(w + 0.7, 0.5, 0.8, cx, h - 0.05, z + 0.14, { color: COL.goldDeep, mat: 'bronze' });
  };
  putHallDoor(0, FRONT_Z + 0.75, 11.6, 12.5);
  putHallDoor(-14.4, FRONT_Z + 0.7, 5.4, 6.4);
  putHallDoor(14.4, FRONT_Z + 0.7, 5.4, 6.4);
  // 门顶花窗
  kit.window(0, 13.2, FRONT_Z + 0.82, {
    w: 6.4, h: 3.9, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
  });
  for (const sx of [-1, 1]) {
    kit.window(sx * 14.4, 6.8, FRONT_Z + 0.78, {
      w: 2.6, h: 1.6, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
    });
  }

  // ================================================================
  // 4. 两排巨型柱廊（前廊）
  //    外侧一排石柱 24m 高，形成"站在神殿脚下"的尺度感；
  //    柱子之间立英雄雕像，呼应"英灵"主题。
  // ================================================================
  const COL_X = [-17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5];
  for (const x of COL_X) {
    kit.column(x, 31.5, { h: 24, r: 1.55, color: COL.stone, mat: 'stone', cap: true, base: true });
    // 柱身上的金色箍环，与镀金山墙呼应
    kit.cyl(1.62, 1.62, 0.42, 10, x, 17.5, 31.5, { color: COL.gold, mat: 'gold' });
    kit.cyl(1.58, 1.58, 0.3, 10, x, 6.5, 31.5, { color: COL.gold, mat: 'gold' });
    kit.collider(x, 31.5, 1.65);
  }
  // 内排柱（更靠里、更粗，暗示大厅内部纵深）
  for (const x of [-13, -4.4, 4.4, 13]) {
    kit.column(x, 25.0, { h: 27, r: 1.35, color: COL.woodWarm, mat: 'wood', cap: true, base: true });
    kit.collider(x, 25.0, 1.8);
  }
  // 前廊檐部（石梁 + 金线 + 青铜椽头）
  kit.box(43, 3.4, 7.4, 0, 26.9, 30.5, { color: COL.stoneLight, mat: 'stone' });
  kit.box(43.6, 0.55, 7.8, 0, 28.9, 30.5, { color: COL.gold, mat: 'gold' });
  kit.box(42, 0.7, 7.6, 0, 24.9, 30.5, { color: COL.goldDeep, mat: 'bronze' });
  for (let i = 0; i < 14; i++) {
    kit.box(0.55, 0.55, 2.4, -19.5 + i * 3.0, 28.4, 33.6, { color: COL.woodDark, mat: 'wood' });
  }
  // 前廊顶（平缓的石板顶，被后面的金色人字屋顶"压"住）
  kit.box(43, 0.7, 8.0, 0, 29.1, 30.5, { color: COL.stoneCold, mat: 'stone', rx: -0.045 });

  // 英雄雕像（7 尊，立于柱间）
  const putHero = (x, z, h) => {
    // 基座
    kit.box(h * 0.52, h * 0.16, h * 0.52, x, h * 0.08, z, { color: COL.stoneDark, mat: 'stone' });
    const y0 = h * 0.16;
    // 长披风 / 长袍（下宽上窄）
    kit.cyl(h * 0.115, h * 0.21, h * 0.5, 7, x, y0 + h * 0.25, z, { color: COL.stone, mat: 'stone' });
    // 双肩
    kit.box(h * 0.36, h * 0.1, h * 0.21, x, y0 + h * 0.53, z, { color: COL.stoneLight, mat: 'stone' });
    // 头盔 + 金冠
    kit.cyl(h * 0.078, h * 0.09, h * 0.14, 7, x, y0 + h * 0.64, z, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(h * 0.095, h * 0.11, 7, x, y0 + h * 0.735, z, { color: COL.gold, mat: 'gold' });
    // 长矛
    kit.cyl(h * 0.014, h * 0.022, h * 0.82, 5, x + h * 0.21, y0 + h * 0.4, z + h * 0.06, {
      color: COL.goldDeep, mat: 'bronze', rz: -0.13,
    });
    kit.cone(h * 0.035, h * 0.1, 5, x + h * 0.16, y0 + h * 0.83, z + h * 0.06, {
      color: COL.goldBright, mat: 'gold', rz: -0.13,
    });
    // 圆盾
    kit.cyl(h * 0.12, h * 0.12, h * 0.045, 9, x - h * 0.15, y0 + h * 0.4, z + h * 0.13, {
      color: COL.gold, mat: 'gold', rx: Math.PI / 2,
    });
  };
  for (const x of [-15, -10, -5, 0, 5, 10, 15]) {
    putHero(x, 32.6, 7.0);
  }

  // ================================================================
  // 5. 金色人字屋顶 + 屋脊枪尖
  // ================================================================
  kit.roofGable(0, HALL_Z, {
    w: HALL_W + 2.4, d: HALL_D + 2.4, h: ROOF_RISE, y0: HALL_H,
    color: COL.gold, mat: 'gold', thickness: 0.8, overhang: 1.1,
  });
  // 屋脊梁
  kit.box(1.0, 1.2, HALL_D + 5, 0, HALL_H + ROOF_RISE + 0.3, HALL_Z, { color: COL.goldBright, mat: 'gold' });

  // 屋面的纵向金肋（18 条，强化"镀金"与体量感）
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const px = sx * (2.0 + k * 2.05);
      const py = HALL_H + ROOF_RISE - (Math.abs(px) / (HALL_W / 2 + 1.2)) * ROOF_RISE;
      kit.box(0.45, 0.45, HALL_D + 4, px, py + 0.35, HALL_Z, {
        color: COL.goldBright, mat: 'gold', rz: -sx * 0.62,
      });
    }
  }

  // 屋脊上交错的金色枪尖（英灵殿最标志性的天际线）
  for (let i = 0; i < 21; i++) {
    const z = -37 + i * 3.1;
    const tall = i % 2 === 0;
    const h = tall ? 7.2 : 4.4;
    const hx = (i % 4 < 2 ? 1 : -1) * 0.75;
    kit.box(0.62, 0.9, 0.62, hx * 0.4, HALL_H + ROOF_RISE + 0.95, z, { color: COL.goldDeep, mat: 'bronze' });
    kit.cone(0.55, h, 6, hx, HALL_H + ROOF_RISE + 1.4 + h / 2, z, {
      color: tall ? COL.goldBright : COL.gold, mat: 'gold', rz: hx * 0.06,
    });
    // 枪尖上的小旗（远处看去是跳动的金点）
    if (tall) {
      kit.box(1.1, 0.5, 0.08, hx + 0.55, HALL_H + ROOF_RISE + 1.4 + h * 0.78, z, {
        color: COL.clothRed, mat: 'cloth',
      });
    }
  }

  // ================================================================
  // 6. 悬挂长旗（8 面，正立面）
  // ================================================================
  const bannerX = [-16.5, -11.8, -7.1, -2.4, 2.4, 7.1, 11.8, 16.5];
  bannerX.forEach((x, i) => {
    kit.banner(x, 14, 34.2, {
      w: 2.5, h: 10.5,
      color: i % 2 === 0 ? COL.clothRed : COL.clothBlue,
      rotY: 0,
      side: 'single',
    });
  });
  // 侧墙长旗（每侧 3 面）
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      kit.banner(sx * (HALL_W / 2 + 1.0), 15, -26 + i * 14, {
        w: 2.2, h: 8.5, color: sx < 0 ? COL.clothBlue : COL.clothRed, rotY: sx * Math.PI / 2,
      });
    }
  }

  // ================================================================
  // 7. 侧墙窗 + 檐下符文带
  // ================================================================
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z = 21 - i * 7.4;
      kit.window(sx * (HALL_W / 2 + 0.22), 8, z, {
        w: 3.0, h: 12, rotY: sx * Math.PI / 2, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
      });
      // 窗上金色山花线脚
      kit.box(0.5, 0.8, 4.2, sx * (HALL_W / 2 + 0.18), 21.2, z, { color: COL.goldDeep, mat: 'bronze' });
    }
    // 檐下发光符文带（沿进深方向延伸）
    kit.runeBand(sx * (HALL_W / 2 + 0.2), 27.2, HALL_Z, {
      w: HALL_D - 8, h: 0.9, rotY: sx * Math.PI / 2, color: COL.glowGold, count: 40,
    });
  }

  // ================================================================
  // 8. 背面：后门 + 阶梯后山墙
  // ================================================================
  kit.archway(0, HALL_Z - HALL_D / 2 - 1.2, {
    w: 8, h: 12, t: 2.2, depth: 2.4, color: COL.stone, rotY: Math.PI, glow: true, glowColor: COL.gold,
  });
  for (let i = 0; i < 7; i++) {
    const w = HALL_W * (1 - i / 11);
    kit.box(w, 1.6, 2.0, 0, HALL_H + 0.8 + i * 1.6, HALL_Z - HALL_D / 2 - 0.8, {
      color: i % 2 ? COL.goldDeep : COL.stone, mat: i % 2 ? 'gold' : 'stone',
    });
  }

  // ================================================================
  // 9. 门前火盆（4 座）+ 祭坛火
  //    火盆 = 三足青铜架 + 石盆 + 暗色盆心；火焰由引擎动态添加。
  // ================================================================
  const putBrazier = (x, z, r, h, baseY = 0) => {
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      kit.cyl(0.13, 0.2, h, 5,
        x + Math.sin(a) * r * 0.65, baseY + h / 2, z + Math.cos(a) * r * 0.65,
        { color: COL.bronze, mat: 'bronze', rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2 });
    }
    kit.cyl(r, r * 0.6, 0.9, 8, x, baseY + h + 0.2, z, { color: COL.stoneDark, mat: 'stone' });
    kit.torus(r * 0.98, 0.12, 4, 16, x, baseY + h + 0.65, z, { color: COL.bronze, mat: 'bronze', rx: Math.PI / 2 });
    kit.cyl(r * 0.78, r * 0.78, 0.2, 8, x, baseY + h + 0.62, z, { color: COL.black, mat: 'glow', shade: false });
    kit.glowBlob(x, baseY + h + 1.5, z, r * 1.15, COL.glowEmber, 0.3);
    kit.collider(x, z, r * 0.85);
  };
  // 正面两座立在台基外（台阶两侧的地面上），侧阶两座在台基顶
  putBrazier(-20.5, 34.6, 1.5, 2.3, -FL);
  putBrazier(20.5, 34.6, 1.5, 2.3, -FL);
  putBrazier(-23.5, 29.5, 1.4, 2.2);
  putBrazier(23.5, 29.5, 1.4, 2.2);

  // ================================================================
  // 10. 装饰细节：屋面鳞板、盲拱廊、檐下盾列、门钉、山墙兽角
  //     这些"小构件"决定了金宫是"一块金属"还是"一座神殿"。
  // ================================================================
  // —— 屋面鳞板：每侧 4 排错缝的金瓦 ——
  for (const sx of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const t = 0.2 + row * 0.2;                        // 0=屋脊 → 1=檐口
      const px = sx * (t * (HALL_W / 2 + 1.2));
      const py = HALL_H + ROOF_RISE * (1 - t) + 0.55;
      for (let k = 0; k < 22; k++) {
        const pz = HALL_Z - HALL_D / 2 - 1 + 2.0 + k * ((HALL_D + 2) / 22);
        kit.box(1.05, 0.24, 2.2, px, py, pz, {
          color: row % 2 ? COL.goldDeep : COL.gold, mat: 'gold', rz: -sx * 0.62,
        });
      }
    }
  }
  // —— 两侧墙面：14 个盲拱龛 + 檐下 12 面金盾 ——
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const z = 23.6 - i * 4.55;
      kit.window(sx * (HALL_W / 2 + 0.2), 2.5, z, {
        w: 1.9, h: 3.2, rotY: sx * Math.PI / 2, glow: false,
        color: COL.stoneLight, arch: true, mullion: false,
      });
    }
    for (let i = 0; i < 12; i++) {
      const z = 20.5 - i * 5.0;
      kit.cyl(1.3, 1.3, 0.35, 8, sx * (HALL_W / 2 + 0.3), 25.4, z, {
        color: COL.gold, mat: 'gold', rx: Math.PI / 2, ry: sx * Math.PI / 2,
      });
      kit.torus(0.95, 0.16, 4, 12, sx * (HALL_W / 2 + 0.42), 25.4, z, {
        color: COL.bronze, mat: 'bronze', ry: sx * Math.PI / 2,
      });
    }
    // 檐下椽头（外挑的木梁端面）
    for (let i = 0; i < 12; i++) {
      kit.box(2.6, 0.45, 0.45, sx * (HALL_W / 2 + 1.35), HALL_H - 0.55, -33 + i * 5.6, {
        color: COL.woodDark, mat: 'wood',
      });
    }
  }
  // —— 中央门洞：青铜包边 + 门钉 ——
  for (const s of [-1, 1]) {
    kit.box(1.2, 21, 1.2, s * 7.0, 10.5, FRONT_Z + 3.0, { color: COL.bronze, mat: 'bronze' });
    for (let i = 0; i < 7; i++) {
      kit.cyl(0.28, 0.28, 0.32, 6, s * 8.2, 2.6 + i * 2.9, FRONT_Z + 3.1, {
        color: COL.gold, mat: 'gold', rx: Math.PI / 2,
      });
    }
  }
  // —— 山墙顶的青铜兽角（北欧长屋的"龙脊"意象）——
  for (const s of [-1, 1]) {
    kit.cyl(0.5, 1.6, 8, 6, s * 3.2, 50.4, FRONT_Z + 1.4, {
      color: COL.goldDeep, mat: 'bronze', rz: -s * 0.85,
    });
    kit.cyl(0.24, 0.6, 6.6, 6, s * 8.3, 53.8, FRONT_Z + 1.4, {
      color: COL.gold, mat: 'gold', rz: -s * 1.25,
    });
  }
  // —— 后门两侧的守门武士 ——
  putHero(-9, HALL_Z - HALL_D / 2 - 4.0, 6.4);
  putHero(9, HALL_Z - HALL_D / 2 - 4.0, 6.4);
  // —— 四角屋脊尖饰：把金色人字顶的四角"钉"在天空里 ——
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (HALL_W / 2 + 1.2);
      const pz = HALL_Z + sz * (HALL_D / 2 + 1.2);
      kit.spire(px, pz, { h: 7.5, r: 1.9, y0: HALL_H - 0.2, seg: 6, tiers: 2, glowTip: false, color: COL.goldDeep });
      kit.glowBlob(px, HALL_H + 7.4, pz, 0.85, COL.glowGold, 0.16);
    }
  }
  // —— 侧阶旁的守门武士（左右各一，站在台基上）——
  putHero(-25.4, 22.5, 6.6);
  putHero(25.4, 22.5, 6.6);

  // ================================================================
  // 11. 可行走平台 + 碰撞体
  // ================================================================
  const platforms = [];
  const plat = (x, z, hw, hd, yTop, rotY = 0) => platforms.push({
    x: x * scale, z: z * scale, hw: hw * scale, hd: hd * scale, y: yTop * scale, rotY,
  });
  const RISE = FL / 6;
  for (let i = 0; i < 6; i++) {
    plat(0, 33 + (i + 0.5) * 0.72, 17, 0.36, RISE * (6 - i));      // 正面台阶
    const dx = 28 + (i + 0.5) * 0.72;
    plat(dx, 20, 0.36, 8, RISE * (6 - i));                         // 两翼台阶
    plat(-dx, 20, 0.36, 8, RISE * (6 - i));
  }
  plat(0, -5, 28, 38, FL);                                         // 台基顶面

  kit.boxCollider(0, HALL_Z, HALL_W / 2 + 1.2, HALL_D / 2 + 1.2, 0);  // 大厅主体
  kit.boxCollider(-22.5, 32.3, 5.5, 0.8, 0);                          // 台基前缘（台阶两侧）
  kit.boxCollider(22.5, 32.3, 5.5, 0.8, 0);
  for (const sx of [-1, 1]) {
    kit.boxCollider(sx * 28.3, -15.5, 0.8, 27.5, 0);                  // 台基侧缘（侧阶之后）
    kit.boxCollider(sx * 28.3, 30.5, 0.8, 2.5, 0);                    // 台基侧缘（侧阶之前）
  }
  kit.boxCollider(0, -43.3, 28, 0.8, 0);                              // 台基后缘

  // ================================================================
  // 12. 组装 + 尺度烘焙
  // ================================================================
  const group = kit.build({ name: 'greatHall' });
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  return finalize(group, kit, scale, FL);
}

/** 收尾：烘焙尺度并换算包围盒 / 碰撞体（见文件头说明）。 */
function finalize(group, kit, scale, liftY) {
  const m = new THREE.Matrix4().makeScale(scale, scale, scale);
  m.setPosition(0, liftY * scale, 0);
  for (const child of group.children) {
    if (!child.isMesh || !child.geometry) continue;
    child.geometry.applyMatrix4(m);
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  }
  group.userData.bounds = new THREE.Box3().setFromObject(group);
  group.userData.colliders = kit.colliders.map((c) => ({ x: c.x * scale, z: c.z * scale, r: c.r * scale }));
  group.userData.boxColliders = kit.boxColliders.map((c) => ({
    x: c.x * scale, z: c.z * scale, hw: c.hw * scale, hd: c.hd * scale, rotY: c.rotY,
  }));
  group.userData.height = meta.height * scale;
  group.userData.radius = meta.radius * scale;
  group.userData.scaledBy = scale;
  return group;
}
