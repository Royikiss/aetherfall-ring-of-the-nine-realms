/**
 * Colossus.js — 「守望者巨像」（THE WATCHER）
 *
 * 模块职责：
 *   三层石台 + 祭坛 + 巨型守望者雕像。雕像用基础几何体抽象成一个可信的
 *   人形剪影：宽肩、长斗篷、角盔、右手持一柄折断的长矛。不做手指等微观细节。
 *
 * 对外 API：
 *   buildColossus(opts) -> THREE.Group
 *   meta -> { id, label, radius, height }（设计尺度 = scale 1 时）
 *
 * opts：{ scale=1, seed=1, variant=0, beacon=false（忽略） }
 *   builder 内部已烘焙 scale，World 只设置 position / rotation。
 *
 * userData：colliders / boxColliders / height / radius / scaledBy / meta
 *           platforms = [{x,z,hw,hd,y,rotY}]（正面大台阶，可走到 6m 高台）
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 *
 * 尺度：设计高度约 58m；data/world.js 中 scale=1 → 约 57m。
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

export const meta = {
  id: 'colossus',
  label: '守望者巨像',
  radius: 26,
  height: 58,
};

const PLAT = 6.0;    // 雕像站立的平台高度

export function buildColossus(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const kit = new Kit({ seed: seed + variant * 359 });

  // ================================================================
  // 1. 三层阶梯石台（Ziggurat 式收分）
  // ================================================================
  kit.box(46, 2.2, 38, 0, 1.1, 0, { color: COL.stoneDark, mat: 'stone' });
  kit.box(42, 2.0, 34, 0, 3.2, -0.5, { color: COL.stone, mat: 'stone' });
  kit.box(37, 1.8, 30, 0, 5.1, -1, { color: COL.stone, mat: 'stone' });
  // 平台面（浅色石板，让雕像的暗色剪影"跳"出来）
  kit.box(37.6, 0.4, 30.6, 0, PLAT - 0.2, -1, { color: COL.stoneLight, mat: 'stone' });
  // 各层压顶线脚
  kit.box(46.6, 0.35, 38.6, 0, 2.25, 0, { color: COL.stoneLight, mat: 'stone' });
  kit.box(42.6, 0.35, 34.6, 0, 4.25, -0.5, { color: COL.stoneLight, mat: 'stone' });

  // 正面大台阶（10 级，直通 6m 平台）
  kit.stairs(0, 14, { w: 22, steps: 10, rise: PLAT / 10, run: 1.0, y0: 0, color: COL.stone });
  // 台阶两侧的望柱：从地面立起，高度随台阶升高（而不是浮在半空）
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const bz = 15.5 + i * 1.9;
      const h = 0.6 * (24 - bz) + 1.1;
      kit.box(1.8, h, 1.8, sx * 11.9, h / 2, bz, { color: COL.stoneLight, mat: 'stone' });
      kit.box(2.2, 0.4, 2.2, sx * 11.9, h + 0.1, bz, { color: COL.stoneDark, mat: 'stone' });
    }
    // 顶端两根大望柱 + 锥顶
    kit.box(2.2, 7.0, 2.2, sx * 11.9, 3.5, 14.0, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(1.4, 2.4, 6, sx * 11.9, 8.2, 14.0, { color: COL.stoneDark, mat: 'stone' });
  }
  // 散落在台基四周的碎石（时间感 + 破败感）
  for (let i = 0; i < 9; i++) {
    const a = kit.rand(0, Math.PI * 2);
    const rr = kit.rand(22, 27);
    const rad = kit.rand(0.8, 1.9);
    kit.sphere(rad, kit.randInt(2, 3), Math.sin(a) * rr, rad * 0.6, Math.cos(a) * rr, {
      color: COL.stoneDark, mat: 'stone', sy: 0.6,
    });
  }
  // 台基立面的横向石缝（三层，用浅色细长石条"画"出来）
  for (const [halfW, halfD, yy] of [[23, 19, 2.15], [21, 17, 4.15], [18.5, 14.5, 5.95]]) {
    kit.box(halfW * 2 + 0.3, 0.22, 0.4, 0, yy, halfD, { color: COL.stoneLight, mat: 'stone' });
    kit.box(0.4, 0.22, halfD * 2, halfW, yy, -1, { color: COL.stoneLight, mat: 'stone' });
    kit.box(0.4, 0.22, halfD * 2, -halfW, yy, -1, { color: COL.stoneLight, mat: 'stone' });
  }
  // 第一层正面的发光符文带（给石台"神话属性"）
  kit.runeBand(0, 1.1, 19.15, { w: 32, h: 0.9, color: COL.glowGold, count: 40 });
  // 四角的隅石（quoin）：交替的浅色大石块，强化台基的"砌筑感"
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      kit.box(2.2, 0.62, 2.2, sx * 22.4, 0.55 + i * 0.62, 18.4, {
        color: i % 2 ? COL.stoneLight : COL.stone, mat: 'stone',
      });
    }
  }

  // ================================================================
  // 2. 祭坛 + 火盆（雕像脚下的仪式核心）
  // ================================================================
  kit.box(5, 2.2, 4, 0, PLAT + 1.1, 11.5, { color: COL.stoneLight, mat: 'stone' });
  kit.box(5.8, 0.4, 4.8, 0, PLAT + 2.4, 11.5, { color: COL.stoneDark, mat: 'stone' });
  kit.cyl(1.8, 1.1, 0.8, 8, 0, PLAT + 3.0, 11.5, { color: COL.bronze, mat: 'bronze' });
  kit.cyl(1.4, 1.4, 0.16, 8, 0, PLAT + 3.35, 11.5, { color: COL.black, mat: 'glow', shade: false });
  kit.glowBlob(0, PLAT + 4.2, 11.5, 1.8, COL.glowEmber, 0.3);
  kit.runeBand(0, PLAT + 1.2, 13.62, { w: 4.2, h: 0.8, color: COL.glowGold, count: 7 });
  kit.collider(0, 11.5, 2.3);

  // 两侧立旗
  for (const sx of [-1, 1]) {
    const px = sx * 16.6;
    kit.cyl(0.16, 0.2, 15, 6, px, PLAT + 7.5, 6, { color: COL.woodDark, mat: 'wood' });
    kit.banner(px, PLAT + 7, 6, {
      w: 2.6, h: 8.5, color: sx < 0 ? COL.clothBlue : COL.clothRed, rotY: 0, emblem: false,
    });
    kit.collider(px, 6, 0.8);
  }
  // 两侧火盆
  for (const sx of [-1, 1]) {
    const bx = sx * 13.5;
    const bz = 9.5;
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      kit.cyl(0.14, 0.2, 2.2, 5,
        bx + Math.sin(a) * 0.7, PLAT + 1.1, bz + Math.cos(a) * 0.7, {
          rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2, color: COL.bronze, mat: 'bronze',
        });
    }
    kit.cyl(1.3, 0.8, 0.7, 8, bx, PLAT + 2.5, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.glowBlob(bx, PLAT + 3.2, bz, 1.1, COL.glowEmber, 0.28);
    kit.collider(bx, bz, 1.4);
  }

  // ================================================================
  // 3. 巨像下半身：斗篷式石裙（把双腿藏在长袍里，更纪念碑化）
  // ================================================================
  // 平台上的基座裙边（把长袍与地面连起来）
  kit.cyl(13.6, 15.0, 1.0, 8, 0, PLAT + 0.5, -1.5, { color: COL.stoneDark, mat: 'stone' });
  // 长袍：下宽上窄的八棱锥台
  kit.cyl(8.4, 13.5, 25.5, 8, 0, PLAT + 13.25, -1.5, { color: COL.stone, mat: 'stone', sz: 0.92 });
  // 袍脚压边
  kit.cyl(13.9, 13.9, 1.3, 8, 0, PLAT + 1.2, -1.5, { color: COL.stoneLight, mat: 'stone', sz: 0.92 });
  // 袍身竖向褶皱（8 条，跟随收分放两段）
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + 0.2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // 下段（半径大）
    kit.box(1.2, 13, 1.5, sa * 12.4, PLAT + 6.5, -1.5 + ca * 11.4, {
      color: COL.stoneDark, mat: 'stone', ry: a,
    });
    // 上段（半径小）
    kit.box(1.0, 11, 1.3, sa * 9.6, PLAT + 17.5, -1.5 + ca * 8.8, {
      color: COL.stoneDark, mat: 'stone', ry: a,
    });
  }
  // 腰带（石质 + 金色扣）
  kit.cyl(8.9, 9.4, 1.9, 8, 0, PLAT + 26.3, -1.2, { color: COL.stoneDark, mat: 'stone', sz: 0.95 });
  kit.box(3.6, 3.0, 1.0, 0, PLAT + 26.3, 7.4, { color: COL.gold, mat: 'gold' });
  kit.runeBand(0, PLAT + 26.3, 7.8, { w: 9, h: 0.5, color: COL.glowGold, count: 14 });
  // 双腿（藏在袍下，但脚下要露出靴子与护腿）
  for (const sx of [-1, 1]) {
    // 靴子：从袍前伸出的巨石块
    kit.box(6.0, 3.2, 9.0, sx * 5.6, PLAT + 1.6, 10.0, { color: COL.stoneDark, mat: 'stone' });
    kit.box(6.6, 1.6, 4.2, sx * 5.6, PLAT + 1.0, 13.6, { color: COL.stoneLight, mat: 'stone' });
    // 护腿板（贴住袍前）
    kit.box(5.2, 7.5, 1.8, sx * 5.6, PLAT + 6.2, 11.6, { color: COL.stoneLight, mat: 'stone', rx: -0.12 });
    // 腿的碰撞（供角色被"巨像腿"挡住）
    kit.collider(sx * 5.6, 9.0, 4.2);
  }

  // ================================================================
  // 4. 躯干 / 肩 / 头 / 角盔
  // ================================================================
  // —— 背后长斗篷（从肩部倾泻而下）——
  kit.cyl(11.0, 17.0, 17, 8, 0, PLAT + 28.0, -6.5, { color: COL.stoneDark, mat: 'stone', sz: 0.62 });
  kit.cyl(17.4, 17.4, 1.0, 8, 0, PLAT + 19.8, -6.5, { color: COL.stoneLight, mat: 'stone', sz: 0.62 });

  // —— 躯干：上宽下窄的八棱柱，Z 向压扁成"胸背"——
  kit.cyl(9.6, 8.2, 13, 8, 0, PLAT + 32.5, -0.8, { color: COL.stone, mat: 'stone', sz: 0.72 });
  // 胸甲
  kit.box(13.0, 6.5, 2.6, 0, PLAT + 34.5, 5.5, { color: COL.stoneLight, mat: 'stone' });
  // 胸甲上的发光符文带
  kit.runeBand(0, PLAT + 35.6, 6.9, { w: 11.5, h: 1.4, color: COL.glowGold, count: 18 });
  // 肩甲（宽肩：全像最有力的横向线条）
  for (const sx of [-1, 1]) {
    kit.box(8.0, 5.0, 9.5, sx * 10.6, PLAT + 39.0, -0.6, { color: COL.stoneLight, mat: 'stone' });
    // 叠层肩甲片
    kit.cyl(4.6, 4.6, 1.0, 8, sx * 10.6, PLAT + 41.9, -0.6, { color: COL.stone, mat: 'stone' });
    kit.cyl(3.8, 3.8, 0.8, 8, sx * 10.6, PLAT + 42.8, -0.6, { color: COL.goldDeep, mat: 'bronze' });
    // 肩上的尖刺
    kit.cone(0.9, 2.6, 5, sx * 12.6, PLAT + 43.2, -0.6, { color: COL.gold, mat: 'gold', rz: sx * 0.25 });
  }
  // 毛领（石雕的兽毛领）
  kit.torus(11.4, 1.15, 5, 20, 0, PLAT + 38.6, -0.8, { color: COL.stoneLight, mat: 'stone', rx: Math.PI / 2 });

  // —— 脖子与头 ——
  kit.cyl(2.9, 3.3, 3.4, 8, 0, PLAT + 41.5, -0.5, { color: COL.stone, mat: 'stone' });
  kit.cyl(3.1, 2.8, 4.4, 8, 0, PLAT + 43.6, -0.4, { color: COL.stoneLight, mat: 'stone' });
  // 面部甲片（只有正面，避免"圆头"感）
  kit.box(4.4, 3.2, 1.5, 0, PLAT + 43.8, 2.8, { color: COL.stoneLight, mat: 'stone' });
  // 发光的双眼（唯一的高亮"活物"暗示）
  for (const sx of [-1, 1]) {
    kit.box(0.95, 0.5, 0.25, sx * 1.15, PLAT + 44.1, 3.6, { color: COL.glowCyan, mat: 'glow', shade: false });
  }
  // —— 角盔 ——
  kit.cyl(2.9, 4.3, 3.8, 8, 0, PLAT + 46.2, -0.4, { color: COL.stoneDark, mat: 'stone' });
  // 鼻梁护片
  kit.box(0.8, 3.4, 1.0, 0, PLAT + 44.8, 3.5, { color: COL.gold, mat: 'gold' });
  // 盔顶脊冠
  kit.box(1.1, 2.2, 5.6, 0, PLAT + 48.8, -0.4, { color: COL.goldDeep, mat: 'bronze' });
  // 双角：每一侧两段，向外后方弯出
  for (const sx of [-1, 1]) {
    kit.cyl(0.45, 1.25, 6.6, 6, sx * 5.3, PLAT + 47.4, -0.6, {
      color: COL.bone, mat: 'stone', rz: -sx * 0.58, rx: -0.12,
    });
    kit.cone(0.28, 3.6, 5, sx * 8.3, PLAT + 50.2, -1.4, {
      color: COL.bone, mat: 'stone', rz: -sx * 1.0, rx: -0.18,
    });
  }

  // ================================================================
  // 5. 手臂与断矛（视觉主角的动作）
  //    rz = atan2(-dx, dy) 把沿 Y 轴的圆柱摆到「从 A 指向 B」的方向。
  // ================================================================
  const limb = (x0, y0, x1, y1, rt, rb, color, mat = 'stone', z = 0) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    kit.cyl(rt, rb, len, 8, (x0 + x1) / 2, (y0 + y1) / 2, z, {
      rz: Math.atan2(-dx, dy), color, mat,
    });
    return len;
  };

  // —— 右臂：向外下方伸出，握住插在台上的断矛 ——
  limb(11.0, PLAT + 39.0, 15.0, PLAT + 30.5, 2.5, 3.1, COL.stoneLight, 'stone', -0.2);
  limb(15.0, PLAT + 30.5, 19.2, PLAT + 20.2, 2.0, 2.5, COL.stoneLight, 'stone', 0.4);
  // 护腕
  kit.cyl(2.5, 2.5, 1.4, 8, 19.1, PLAT + 20.4, 0.6, { color: COL.bronze, mat: 'bronze', rz: -0.42 });
  // 手掌（握拳，不做手指）
  kit.box(3.9, 3.7, 3.9, 19.4, PLAT + 19.6, 1.0, { color: COL.stoneLight, mat: 'stone', rz: -0.15 });

  // —— 左臂：自然垂下，拳心向下 ——
  limb(-11.0, PLAT + 39.0, -13.5, PLAT + 29.5, 2.5, 3.1, COL.stoneLight, 'stone', -0.2);
  limb(-13.5, PLAT + 29.5, -13.8, PLAT + 20.0, 2.0, 2.5, COL.stoneLight, 'stone', 0.4);
  kit.box(3.7, 3.5, 3.7, -13.9, PLAT + 19.4, 1.2, { color: COL.stoneLight, mat: 'stone' });
  kit.cyl(2.4, 2.4, 1.2, 8, -13.6, PLAT + 21.0, 0.9, { color: COL.bronze, mat: 'bronze' });

  // —— 断矛：从台面斜插向上，顶端是折断的裂口 ——
  // 矛杆
  kit.cyl(0.8, 1.05, 34, 6, 19.35, PLAT + 17.0, 1.4, {
    color: COL.woodDark, mat: 'wood', rz: -0.05,
  });
  // 金色矛箍
  kit.cyl(1.45, 1.45, 1.5, 8, 19.7, PLAT + 24.0, 1.4, { color: COL.gold, mat: 'gold', rz: -0.05 });
  kit.cyl(1.35, 1.35, 1.1, 8, 20.0, PLAT + 31.0, 1.4, { color: COL.bronze, mat: 'bronze', rz: -0.05 });
  // 矛尖折断：三根向外劈开的木刺
  kit.cone(0.20, 2.8, 4, 20.0, PLAT + 35.5, 1.4, { color: COL.woodDark, mat: 'wood', rz: 0.22 });
  kit.cone(0.18, 2.2, 4, 20.7, PLAT + 35.2, 1.4, { color: COL.woodDark, mat: 'wood', rz: -0.28 });
  kit.cone(0.16, 1.8, 4, 19.5, PLAT + 35.4, 1.4, { color: COL.woodDark, mat: 'wood', rz: 0.55 });
  // 撑地端（插在石台里）
  kit.cyl(1.3, 1.7, 1.2, 6, 18.7, PLAT + 0.4, 1.4, { color: COL.stoneDark, mat: 'stone' });

  // ================================================================
  // 6. 脚边的残盾与蛛网般的旧裂痕（细节点缀）
  // ================================================================
  kit.cyl(4.4, 4.4, 0.5, 12, -13.5, PLAT + 2.2, 8.0, {
    color: COL.stoneDark, mat: 'stone', rx: Math.PI / 2, rz: 0.32, ry: 0.4,
  });
  kit.cyl(1.5, 1.5, 0.35, 8, -13.5, PLAT + 2.2, 8.4, {
    color: COL.gold, mat: 'gold', rx: Math.PI / 2, rz: 0.32, ry: 0.4,
  });
  // 断裂的盾面：一道斜向缺口
  kit.box(0.5, 7.5, 0.6, -13.0, PLAT + 2.2, 8.3, { color: COL.black, mat: 'glow', shade: false, rz: 0.5 });

  // ================================================================
  // 7. 雕像表面细节：铆钉、甲片、袍褶、断矛残尖
  //    尺度很大，所以细节要"块状"：铆钉 = 15cm 的金点，近看才有，
  //    远景只是让石面不空。
  // ================================================================
  // 胸甲铆钉（两排）
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      kit.box(0.55, 0.55, 0.3, s * (1.2 + i * 1.2), PLAT + 36.9, 6.85, {
        color: COL.gold, mat: 'gold', shade: false,
      });
    }
  }
  // 肩甲边缘的铆钉（叠片由上面的圆盘肩甲负责，这里只补最外沿的一圈钉）
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      kit.box(0.6, 0.6, 0.4, sx * (10.6 + (i - 1.5) * 1.7), PLAT + 39.6, 4.25, {
        color: COL.gold, mat: 'gold', shade: false,
      });
    }
  }
  // 背后斗篷的 5 道垂褶：斗篷是上窄下宽的锥面，所以褶子要跟着倾斜（rx）
  for (let i = -2; i <= 2; i++) {
    const px = i * 3.2;
    const h = 16 - Math.abs(i) * 1.4;
    kit.box(1.1, h, 1.0, px, PLAT + 28.0 + Math.abs(i) * 0.4, -15.4, {
      color: COL.stoneDark, mat: 'stone', rx: 0.22,
    });
  }
  // 袍脚的发光符文（一圈星点，夜里像"守望者的誓约"）
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    kit.box(0.55, 0.9, 0.14,
      Math.sin(a) * 13.7, PLAT + 2.6, -1.5 + Math.cos(a) * 12.6, {
        ry: a, color: i % 5 === 0 ? COL.glowCyan : COL.glowGold, mat: 'glow', shade: false,
      });
  }
  // 台面上折断的半截矛尖（曾经完整的那柄）
  kit.cyl(0.55, 0.75, 7, 6, 11.5, PLAT + 0.9, 16.0, {
    color: COL.woodDark, mat: 'wood', rz: Math.PI / 2 - 0.12, ry: 0.5,
  });
  kit.cone(0.7, 1.8, 5, 14.6, PLAT + 1.0, 18.4, {
    color: COL.bronze, mat: 'bronze', rz: Math.PI / 2 - 0.2, ry: 0.5,
  });
  // 台上零散碎块
  for (let i = 0; i < 5; i++) {
    const a = kit.rand(0, Math.PI * 2);
    const rr = kit.rand(9, 15);
    kit.sphere(kit.rand(0.5, 1.1), 2, Math.sin(a) * rr, PLAT + 0.3, -1 + Math.cos(a) * rr, {
      color: COL.stoneDark, mat: 'stone', sy: 0.55,
    });
  }

  // ================================================================
  // 8. 台阶前的两尊守卫像：12m 高，刚好给出"巨像=5 倍人形"的尺度参照
  // ================================================================
  const putGuardian = (x, z, h) => {
    // 基座
    kit.box(h * 0.5, h * 0.16, h * 0.5, x, h * 0.08, z, { color: COL.stoneDark, mat: 'stone' });
    const y0 = h * 0.16;
    // 长袍 + 胸甲 + 肩
    kit.cyl(h * 0.12, h * 0.22, h * 0.5, 7, x, y0 + h * 0.25, z, { color: COL.stone, mat: 'stone' });
    kit.box(h * 0.38, h * 0.2, h * 0.26, x, y0 + h * 0.53, z, { color: COL.stoneLight, mat: 'stone' });
    kit.box(h * 0.46, h * 0.08, h * 0.2, x, y0 + h * 0.63, z, { color: COL.stoneLight, mat: 'stone' });
    // 角盔
    kit.cyl(h * 0.08, h * 0.09, h * 0.12, 7, x, y0 + h * 0.72, z, { color: COL.stoneLight, mat: 'stone' });
    for (const s of [-1, 1]) {
      kit.cone(h * 0.04, h * 0.13, 5, x + s * h * 0.1, y0 + h * 0.79, z, {
        color: COL.bone, mat: 'stone', rz: -s * 0.5,
      });
    }
    // 盾与矛
    kit.cyl(h * 0.15, h * 0.15, h * 0.05, 9, x - h * 0.2, y0 + h * 0.45, z + h * 0.14, {
      color: COL.gold, mat: 'gold', rx: Math.PI / 2,
    });
    kit.cyl(h * 0.012, h * 0.018, h * 1.0, 6, x + h * 0.24, y0 + h * 0.44, z + h * 0.1, {
      color: COL.bronze, mat: 'bronze', rz: -0.05,
    });
    kit.collider(x, z, h * 0.35);
  };
  putGuardian(-15.5, 21.5, 12);
  putGuardian(15.5, 21.5, 12);
  // 守卫身旁的火盆
  for (const sx of [-1, 1]) {
    const bx = sx * 20.5;
    const bz = 22.5;
    kit.cyl(0.3, 0.42, 3.0, 5, bx, 1.5, bz, { color: COL.bronze, mat: 'bronze' });
    kit.cyl(1.2, 0.8, 0.7, 8, bx, 3.3, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.glowBlob(bx, 4.1, bz, 1.1, COL.glowEmber, 0.26);
    kit.collider(bx, bz, 1.3);
  }

  // ================================================================
  // 9. 可行走平台 + 碰撞体
  // ================================================================
  const platforms = [];
  // 正面大台阶（10 级，每级 0.6m）→ 角色可以真的走上 6m 高台
  for (let i = 0; i < 10; i++) {
    platforms.push({
      x: 0,
      z: (14 + (i + 0.5) * 1.0) * scale,
      hw: 11 * scale,
      hd: 0.5 * scale,
      y: 0.6 * (10 - i) * scale,
      rotY: 0,
    });
  }
  // 台基主体：前端缩到 z=14，给台阶让路；两侧/前缘再补碰撞，防止侧向钻进石台
  kit.boxCollider(0, -2.2, 22, 16.2, 0);       // z -18.4 .. 14.0
  kit.boxCollider(-16.5, 18.8, 5.5, 0.9, 0);   // 台阶两侧的台基前缘
  kit.boxCollider(16.5, 18.8, 5.5, 0.9, 0);
  for (const sx of [-1, 1]) {
    kit.boxCollider(sx * 22.7, 0, 0.9, 19.2, 0);  // 台基侧缘
  }
  kit.collider(0, -1.5, 14.5);                 // 长袍底部

  // ================================================================
  // 10. 组装 + 尺度烘焙
  // ================================================================
  const group = kit.build({ name: 'colossus' });
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  return finalize(group, kit, scale, 0);
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
