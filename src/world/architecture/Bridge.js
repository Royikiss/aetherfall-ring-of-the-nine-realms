/**
 * Bridge.js — 霜河石桥（Bifrost 石桥）
 *
 * 模块职责：
 *   跨越裂谷的多拱石桥：3–5 个半圆拱、深插谷底的桥墩、可行走桥面、
 *   两侧石栏与雕像柱、桥头双塔与发光符文。
 *
 * 对外 API：
 *   buildBridge(opts) -> THREE.Group
 *     opts = { scale = 1, seed = 1, variant = 0,
 *              length = 96, width = 9, height = 14 }
 *       variant 0：4 拱（默认） / 1：3 拱 / 2：5 拱
 *
 * 可行走数据（关键约定，引擎据此让玩家站在桥面上）：
 *   group.userData.platforms = [
 *     { x, z, hw, hd, rotY, y }   // 局部坐标；x/z 为矩形中心，hw/hd 为 X/Z 半尺寸，
 *                                 // rotY 为矩形绕 Y 的旋转（桥体本身为 0），y 为甲板**顶面**高度
 *   ]
 *   顺序：先主甲板，再两端台阶（由高到低）。桥沿局部 X 轴延伸，长度 = length。
 *   甲板顶面高度 = height（即 opts.height）。
 *
 * 坐标约定：
 *   - 以桥体中心为原点，y=0 为"地面/谷口"标高，甲板顶面位于 y = height；
 *   - 碰撞体（kit.collider / boxCollider）为局部坐标（World 摆放时统一变换）。
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

const TAU = Math.PI * 2;

/** 不同 variant 的发光色（0 金 / 1 青 / 2 余烬） */
const GLOWS = [COL.glowGold, COL.glowCyan, COL.glowEmber];

/**
 * 构建石桥。
 * @param {{scale?:number,seed?:number,variant?:number,length?:number,width?:number,height?:number}} opts
 * @returns {THREE.Group}
 */
export function buildBridge(opts = {}) {
  const { scale = 1, seed = 1, variant = 0, length = 96, width = 9, height = 14 } = opts;
  const s = Math.max(0.25, Number(scale) || 1);
  const L = Math.max(30, (Number(length) || 96) * s);      // 桥体总长（沿 X）
  const W = Math.max(4.5, (Number(width) || 9) * s);       // 桥面宽（沿 Z）
  const H = Math.max(4, (Number(height) || 14) * s);       // 甲板顶面高度
  const v = Math.abs(Math.round(Number(variant) || 0));
  const glow = GLOWS[v % GLOWS.length];
  const kit = new Kit({ seed: 5101 + (Number(seed) || 1) * 197 });

  // ================================================================ 0. 基本尺寸
  const halfL = L / 2;
  const halfW = W / 2;
  const deckTop = H;                       // 甲板顶面（= 可行走高度）
  const paverT = 0.34 * s;                 // 铺装石板厚
  const slabT = 0.95 * s;                  // 桥面板厚
  const deckBottom = deckTop - paverT - slabT;
  const parapetT = 0.55 * s;
  const parapetH = 1.15 * s;
  const walkHW = halfW - parapetT * 0.9;   // 护栏内的可行走半宽
  const bottomY = -(H + 9 * s);            // 桥墩没入谷底的深度

  const platforms = [];

  // ================================================================ 1. 拱券排布
  const archCount = Math.min(5, Math.max(3, v === 1 ? 3 : v === 2 ? 5 : 4));
  const abut = Math.min(L * 0.14, 13 * s);           // 两端桥台进深
  const innerL = L - abut * 2;
  const pierW = Math.max(2.0 * s, innerL * 0.05);    // 桥墩宽
  const span = (innerL - pierW * (archCount - 1)) / archCount;
  const archR = span / 2;
  const springY = deckBottom - archR;                // 起拱线高度
  const tArch = 1.5 * s;                             // 拱券厚度

  /** 各拱的圆心 X 坐标 */
  const archCenters = [];
  {
    let cursor = -halfL + abut;
    for (let i = 0; i < archCount; i++) {
      archCenters.push(cursor + span / 2);
      cursor += span + pierW;
    }
  }

  // ================================================================ 2. 桥面（铺装 + 结构板）
  // 2.1 结构板
  kit.box(L, slabT, W * 1.02, 0, deckTop - paverT - slabT / 2, 0, {
    color: COL.stoneDark, mat: 'stone',
  });
  // 2.2 铺装石板（留缝，避免与结构板共面产生闪烁）
  const pavW = 2.15 * s;
  const pavD = 1.45 * s;
  const nx = Math.max(2, Math.round(L / pavW));
  const nz = Math.max(2, Math.round(W / pavD));
  const cellW = L / nx;
  const cellD = W / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -halfL + (i + 0.5) * cellW;
      const z = -halfW + (j + 0.5) * cellD;
      kit.box(cellW * 0.93, paverT, cellD * 0.9, x, deckTop - paverT / 2, z, {
        color: (i + j) % 3 === 0 ? COL.stoneLight : COL.stone,
        mat: 'stone',
      });
    }
  }
  // 2.3 桥面中轴发光引线（Bifrost 之光）
  kit.box(L * 0.94, 0.025 * s, 0.28 * s, 0, deckTop - 0.0125 * s, 0, {
    color: glow, mat: 'glow', shade: false,
  });

  // ================================================================ 3. 拱券（楔形拱石 + 拱脸线脚）
  for (let ai = 0; ai < archCenters.length; ai++) {
    const cx = archCenters[ai];
    const rMid = archR + tArch / 2;
    const blocks = Math.max(15, Math.round((Math.PI * rMid) / (0.78 * s)));
    const blockLen = ((Math.PI * rMid) / blocks) * 1.1;

    for (let b = 0; b < blocks; b++) {
      const phi = (Math.PI * (b + 0.5)) / blocks;
      const px = cx + Math.cos(phi) * rMid;
      const py = springY + Math.sin(phi) * rMid;
      kit.box(blockLen, tArch, W * 0.995, px, py, 0, {
        rz: phi + Math.PI / 2,
        color: b % 2 ? COL.stone : COL.stoneLight,
        mat: 'stone',
      });
    }
    // 拱心石（金色，发光符印）
    kit.box(tArch * 0.9, tArch * 1.6, W * 1.02, cx, springY + archR + tArch * 0.5, 0, {
      color: COL.gold, mat: 'gold',
    });
    kit.box(tArch * 0.42, tArch * 0.7, W * 0.36, cx, springY + archR + tArch * 0.5, 0, {
      color: glow, mat: 'glow', shade: false,
    });

    // 拱脸线脚（两侧外挑一圈，让拱圈有层次）
    const rr2 = archR + tArch + 0.12 * s;
    const n2 = blocks;
    for (const zs of [-1, 1]) {
      for (let b = 0; b < n2; b++) {
        const phi = (Math.PI * (b + 0.5)) / n2;
        kit.box(blockLen * 1.02, tArch * 0.55, 0.5 * s,
          cx + Math.cos(phi) * rr2, springY + Math.sin(phi) * rr2,
          zs * (halfW - 0.28 * s),
          { rz: phi + Math.PI / 2, color: COL.stoneDark, mat: 'stone' });
      }
    }

    // 拱下光晕（从谷底看也像彩虹）
    kit.glowBlob(cx, springY + archR + 1.2 * s, 0, 5.5 * s, glow);
    kit.glowBlob(cx, springY + archR * 0.55, 0, 3.2 * s, glow);
  }

  // ================================================================ 4. 拱上填充（拱肩 + 拱间实墙）
  // 用竖向薄片"雕刻"出半圆开口，成本低而且完全贴合拱形
  {
    const sliceW = 0.85 * s;
    const n = Math.max(8, Math.ceil(innerL / sliceW));
    const dx = innerL / n;
    for (let i = 0; i < n; i++) {
      const x = -halfL + abut + dx * (i + 0.5);
      let bottom = springY;
      for (const cx of archCenters) {
        const d = Math.abs(x - cx);
        const rr = archR + tArch;
        if (d < rr) {
          bottom = Math.max(bottom, springY + Math.sqrt(rr * rr - d * d));
        }
      }
      const hh = deckBottom - bottom;
      if (hh <= 0.06 * s) continue;
      kit.box(dx * 1.03, hh, W * 0.995, x, bottom + hh / 2, 0, {
        color: i % 3 === 0 ? COL.stoneLight : COL.stone,
        mat: 'stone',
      });
    }
  }

  // ================================================================ 5. 桥墩（深插谷底）
  for (let i = 0; i < archCenters.length - 1; i++) {
    const px = archCenters[i] + span / 2 + pierW / 2;
    const pierTop = springY + 0.35 * s;
    const hh = pierTop - bottomY;
    // 墩身
    kit.box(pierW, hh, W * 0.97, px, bottomY + hh / 2, 0, { color: COL.stone, mat: 'stone' });
    // 墩顶挑出的托石（承托拱券）
    kit.box(pierW * 1.18, 0.55 * s, W * 1.04, px, pierTop - 0.1 * s, 0, { color: COL.stoneDark, mat: 'stone' });
    // 墩底加宽（埋在谷底的基座）
    kit.box(pierW * 1.4, 2.4 * s, W * 1.1, px, bottomY + 1.2 * s, 0, { color: COL.stoneDark, mat: 'stone' });
    // 两侧分水尖（菱形截面）
    for (const zs of [-1, 1]) {
      kit.box(pierW * 1.05, hh, pierW * 1.05, px, bottomY + hh / 2, zs * (halfW - 0.15 * s), {
        ry: Math.PI / 4, color: COL.stoneCold, mat: 'stone',
      });
      kit.box(pierW * 1.2, 0.4 * s, pierW * 1.2, px, pierTop - 0.5 * s, zs * (halfW - 0.15 * s), {
        ry: Math.PI / 4, color: COL.stoneDark, mat: 'stone',
      });
    }
    // 墩身上的水位线苔痕
    kit.box(pierW * 1.02, 0.16 * s, W * 1.0, px, bottomY + 6.2 * s, 0, { color: COL.mossDark, mat: 'wood' });
  }

  // ================================================================ 6. 两端的桥台与桥头塔
  for (const endSign of [-1, 1]) {
    const ax = endSign * (halfL - abut / 2);
    const ah = deckBottom - bottomY;
    // 桥台主体（比桥面略宽，承托桥头塔）
    kit.box(abut, ah, W + 5.5 * s, ax, bottomY + ah / 2, 0, { color: COL.stone, mat: 'stone' });
    // 桥台外立面线脚
    kit.box(abut * 1.06, 0.6 * s, W + 5.9 * s, ax, deckBottom - 0.4 * s, 0, { color: COL.stoneDark, mat: 'stone' });
    kit.box(abut * 1.08, 0.5 * s, W + 6.1 * s, ax, deckBottom - 4.2 * s, 0, { color: COL.stoneDark, mat: 'stone' });
    // 桥台外侧的翼墙
    for (const zs of [-1, 1]) {
      kit.box(abut * 0.5, 4.5 * s, 1.6 * s, endSign * (halfL - abut * 0.25), bottomY + ah * 0.5, zs * (halfW + 3.4 * s), {
        color: COL.stoneDark, mat: 'stone',
      });
    }

    // 桥头双塔：分列桥面两侧，塔顶有尖顶与光球
    for (const zs of [-1, 1]) {
      const tx = endSign * (halfL - 3.1 * s);
      const tz = zs * (halfW + 2.6 * s);
      const towerH = H + 7.5 * s;
      kit.box(3.5 * s, towerH, 3.5 * s, tx, towerH / 2, tz, { color: COL.stoneCold, mat: 'stone' });
      kit.box(3.5 * s, 0.5 * s, 3.5 * s, tx, towerH * 0.42, tz, { color: COL.stoneDark, mat: 'stone' });
      kit.box(4.3 * s, 0.85 * s, 4.3 * s, tx, towerH - 0.42 * s, tz, { color: COL.stoneDark, mat: 'stone' });
      // 雉堞
      for (let c = 0; c < 4; c++) {
        const ca = (TAU * c) / 4 + Math.PI / 4;
        kit.box(1.05 * s, 0.95 * s, 1.05 * s, tx + Math.cos(ca) * 1.75 * s, towerH + 0.35 * s, tz + Math.sin(ca) * 1.75 * s, {
          color: COL.stone, mat: 'stone',
        });
      }
      // 尖顶
      kit.spire(tx, tz, {
        h: 6.5 * s, r: 2.0 * s, y0: towerH + 0.4 * s,
        color: COL.stoneCold, mat: 'stone', tiers: 2, seg: 8,
        glowTip: true, glowColor: glow,
      });
      // 塔身符文（朝桥外一侧）
      kit.runeBand(tx, H + 2.5 * s, tz + zs * (1.78 * s), {
        w: 2.4 * s, h: 1.0 * s, rotY: zs > 0 ? 0 : Math.PI, color: glow, count: 4,
      });
      // 旗
      kit.banner(tx, H + 5.0 * s, tz + zs * 1.9 * s, {
        w: 1.0 * s, h: 2.6 * s, rotY: zs > 0 ? 0 : Math.PI,
        color: zs > 0 ? COL.clothRed : COL.clothBlue, emblemColor: COL.goldBright,
      });
      kit.collider(tx, tz, 2.1 * s);
    }
  }

  // ================================================================ 7. 石栏（护栏 + 壁柱 + 符文 + 盾牌）
  const bayLen = 6.2 * s;
  const bays = Math.max(8, Math.round(L / bayLen));
  for (const zs of [-1, 1]) {
    const pz = zs * (halfW - parapetT * 0.5);
    // 栏墙
    kit.box(L, parapetH, parapetT, 0, deckTop + parapetH / 2, pz, { color: COL.stoneLight, mat: 'stone' });
    // 压顶
    kit.box(L, 0.2 * s, parapetT * 1.32, 0, deckTop + parapetH + 0.1 * s, pz, { color: COL.stoneDark, mat: 'stone' });
    // 壁柱 & 符文
    for (let b = 0; b <= bays; b++) {
      const x = -halfL + (L * b) / bays;
      kit.box(parapetT * 1.55, parapetH * 1.32, parapetT * 1.75, x, deckTop + parapetH * 0.66, pz, {
        color: COL.stone, mat: 'stone',
      });
      kit.box(parapetT * 1.95, 0.24 * s, parapetT * 2.05, x, deckTop + parapetH * 1.33 + 0.12 * s, pz, {
        color: COL.goldDeep, mat: 'bronze',
      });
      if (b % 2 === 0) {
        kit.runeBand(x, deckTop + parapetH * 0.52, pz + zs * (parapetT * 0.86), {
          w: (L / bays) * 0.62, h: 0.5 * s,
          rotY: zs > 0 ? 0 : Math.PI, color: glow, count: 5,
        });
      }
      // 盾牌（每 3 个壁柱挂一面）
      if (b % 3 === 1 && b > 0 && b < bays) {
        kit.cyl(0.52 * s, 0.52 * s, 0.12 * s, 12, x, deckTop + parapetH * 0.55, pz + zs * (parapetT * 0.75), {
          rx: Math.PI / 2, color: b % 2 ? COL.clothRed : COL.bronze, mat: 'cloth',
        });
        kit.cyl(0.14 * s, 0.14 * s, 0.16 * s, 8, x, deckTop + parapetH * 0.55, pz + zs * (parapetT * 0.82), {
          rx: Math.PI / 2, color: COL.gold, mat: 'gold',
        });
      }
    }
  }

  // ================================================================ 8. 雕像柱（桥墩上方与桥台端部的守卫者）
  const guardian = (gx, zs) => {
    const gz = zs * (halfW - parapetT * 0.5);
    const baseY = deckTop + parapetH * 1.45;
    // 基座
    kit.box(1.25 * s, 0.85 * s, 1.25 * s, gx, baseY + 0.42 * s, gz, { color: COL.stoneDark, mat: 'stone' });
    kit.box(1.45 * s, 0.18 * s, 1.45 * s, gx, baseY, gz, { color: COL.goldDeep, mat: 'bronze' });
    // 身躯（铠甲：上宽下窄）
    kit.box(0.9 * s, 1.7 * s, 0.72 * s, gx, baseY + 1.62 * s, gz, { color: COL.stoneLight, mat: 'stone' });
    kit.box(1.28 * s, 0.34 * s, 0.92 * s, gx, baseY + 2.38 * s, gz, { color: COL.stone, mat: 'stone' });
    // 头与盔角
    kit.geo(new THREE.IcosahedronGeometry(0.3 * s, 1), {
      x: gx, y: baseY + 2.78 * s, z: gz, color: COL.stoneLight, mat: 'stone',
    });
    for (const hs of [-1, 1]) {
      kit.cone(0.1 * s, 0.55 * s, 5, gx + hs * 0.24 * s, baseY + 3.02 * s, gz, {
        rz: hs * 0.5, color: COL.bone, mat: 'stone',
      });
    }
    // 长矛（斜指向天空）
    kit.cyl(0.055 * s, 0.075 * s, 3.6 * s, 6, gx + 0.62 * s, baseY + 2.1 * s, gz, {
      rz: zs * 0.22, color: COL.iron, mat: 'iron',
    });
    kit.cone(0.12 * s, 0.5 * s, 5, gx + 0.62 * s + zs * 0.36 * s, baseY + 3.92 * s, gz, {
      rz: zs * 0.22, color: COL.iron, mat: 'iron',
    });
    // 圆盾
    kit.cyl(0.5 * s, 0.5 * s, 0.13 * s, 12, gx - 0.42 * s, baseY + 1.8 * s, gz + zs * 0.5 * s, {
      rx: Math.PI / 2, color: COL.bronze, mat: 'bronze',
    });
    kit.cyl(0.13 * s, 0.13 * s, 0.16 * s, 8, gx - 0.42 * s, baseY + 1.8 * s, gz + zs * 0.58 * s, {
      rx: Math.PI / 2, color: COL.gold, mat: 'gold',
    });
    // 脚下的符文光
    kit.box(0.9 * s, 0.08 * s, 0.3 * s, gx, baseY + 0.9 * s, gz, {
      color: glow, mat: 'glow', shade: false,
    });
  };

  // 桥墩正上方的守卫者
  for (let i = 0; i < archCenters.length - 1; i++) {
    const gx = archCenters[i] + span / 2 + pierW / 2;
    guardian(gx, -1);
    guardian(gx, 1);
  }
  // 桥台端部的守卫者
  for (const endSign of [-1, 1]) {
    guardian(endSign * (halfL - abut * 0.45), -1);
    guardian(endSign * (halfL - abut * 0.45), 1);
  }

  // ================================================================ 9. 两端台阶（走出桥面到地面）
  // 关键：单级踏步高度必须 < 0.7（World.groundAt 的台阶上限），否则玩家上不去。
  // 台阶实体一直砌到谷底，与桥台连成"阶梯式挡墙"，地形再深也不会出现悬空踏步。
  const stepRiseMax = 0.6 * s;
  const stepCount = Math.max(10, Math.ceil(H / stepRiseMax));
  const rise = H / stepCount;
  const run = 0.82 * s;
  for (const endSign of [-1, 1]) {
    for (let i = 0; i < stepCount; i++) {
      const topY = H - (i + 1) * rise;
      if (topY <= 0.12 * s) break;
      const x = endSign * (halfL + (i + 0.5) * run);
      // 台阶实体：从谷底砌到踏面
      kit.box(run * 1.02, topY - bottomY, W * 0.98, x, (topY + bottomY) / 2, 0, {
        color: i % 2 ? COL.stone : COL.stoneLight, mat: 'stone',
      });
      // 台阶两侧的矮栏（顺坡而下）
      for (const zs of [-1, 1]) {
        kit.box(run * 1.02, 0.85 * s, 0.46 * s, x, topY + 0.42 * s, zs * (halfW - 0.28 * s), {
          color: COL.stoneLight, mat: 'stone',
        });
        kit.box(run * 1.02, 0.16 * s, 0.6 * s, x, topY + 0.9 * s, zs * (halfW - 0.28 * s), {
          color: COL.stoneDark, mat: 'stone',
        });
      }
      // 可行走矩形：hw = 半个踏面进深，hd = 护栏内半宽
      platforms.push({
        x, z: 0, hw: run / 2, hd: walkHW, rotY: 0, y: topY,
      });
    }
  }

  // ================================================================ 10. 主甲板可行走矩形（放在最前）
  platforms.unshift({ x: 0, z: 0, hw: halfL, hd: walkHW, rotY: 0, y: deckTop });

  // ================================================================ 11. 碰撞体（局部坐标）
  // 两侧护栏：防止玩家从桥上掉下去
  for (const zs of [-1, 1]) {
    kit.boxCollider(0, zs * (halfW - parapetT * 0.5), halfL, parapetT * 0.62, 0);
  }
  // 桥台端墙（台阶两侧留出通道）
  for (const endSign of [-1, 1]) {
    for (const zs of [-1, 1]) {
      kit.boxCollider(endSign * (halfL - 3.1 * s), zs * (halfW + 2.6 * s), 2.0 * s, 2.0 * s, 0);
    }
  }
  // 桥墩（在谷底，供谷底行走时使用）
  // 注意：碰撞体是俯视 2D 的，桥墩正上方的甲板必须留空，
  // 因此这里只为"墩脚"登记矮墩碰撞会误伤桥面，故不注册桥墩碰撞体。

  // ================================================================ 12. 组装
  const group = kit.build({ name: 'bridge' });
  group.userData.platforms = platforms;
  group.userData.bridge = {
    length: L,
    width: W,
    deckY: deckTop,
    halfLength: halfL,
    halfWidth: halfW,
    walkHalfWidth: walkHW,
    archCount,
    span,
    piers: archCenters.length - 1,
  };
  group.userData.meta = meta;
  return group;
}

/**
 * 地标元信息（scale = 1、length = 96 时的设计尺寸）。
 * radius 覆盖"桥体 + 两端台阶"的总足迹；height 为桥头塔尖高度。
 */
export const meta = {
  id: 'bridge',
  label: '霜河石桥',
  radius: 74,
  height: 34,
};
