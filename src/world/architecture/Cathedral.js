/**
 * Cathedral.js — 「圣白大教堂」（CATHEDRAL OF THE WHITE）
 *
 * 模块职责：
 *   用 Kit 拼出一座北欧-哥特盛期混合风格的巨型主教座堂：拉丁十字平面、
 *   中殿 + 双侧廊、飞扶壁、双塔尖塔、三座大门、巨型玫瑰窗、门前大台阶。
 *
 * 对外 API：
 *   buildCathedral(opts) -> THREE.Group   建筑组（原点在建筑中心，y=0 贴地）
 *   meta -> { id, label, radius, height } 静态元信息（设计尺度 = scale 1 时）
 *
 * opts：
 *   scale   目标尺度（默认 1）。builder 内部已把 scale 烘焙进几何，
 *           World 只需设置 position / rotation，**不要**再二次乘 scale。
 *   seed    确定性随机种子（默认 1）
 *   variant 参数化变体（默认 0）：小幅改变旗帜配色与屋脊饰密度
 *   beacon  本建筑不使用，忽略
 *
 * userData（供 World / 系统读取）：
 *   userData.colliders / boxColliders  已按最终尺度换算的碰撞体（建筑局部坐标）
 *   userData.platforms                 可行走平台（台阶 + 台基顶面，已换算成最终尺度）
 *   userData.height / radius           最终高度 / 占地半径（米）
 *   userData.scaledBy / meta           已烘焙的 scale / 静态元信息
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 *
 * 尺度：设计高度约 116.5m（含双塔尖塔）；data/world.js 中 scale=0.92 → 约 107m。
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

/** 静态元信息（设计尺度：height/radius 均为 scale=1 时的米数） */
export const meta = {
  id: 'cathedral',
  label: '圣白大教堂',
  radius: 50,
  height: 116.5,
};

// —— 构图常量（设计尺度，楼面 y=0）——
const FL = 2.4;            // 台基高度：整座教堂被抬到 8 级台阶之上
const NAVE_HALF = 8.6;     // 中殿拱廊轴线（半宽）
const AISLE_OUT = 16.2;    // 侧廊外缘
const WALL_H = 38;         // 中殿檐口高
const FACADE_Z = 24;       // 正立面位置
const TRANS_Z = -22;       // 袖廊中心
const TOWER_X = 22.2;      // 双塔中心 X
const TOWER_Z = 16;        // 双塔中心 Z
const TOWER_H = 66;        // 塔身砌体高度（之上接尖塔）
const ROSE_Y = 38.5;       // 玫瑰窗圆心高度
const ROSE_R = 8.4;        // 玫瑰窗半径

export function buildCathedral(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const kit = new Kit({ seed: seed + variant * 977 });

  // ================================================================
  // 1. 台基与大台阶
  //    教堂整体坐在 2.4m 高的石台基上，正门 8 级台阶把视线向上抬，
  //    让人物（1.85m）站在门前时产生强烈的仰视压迫感。
  // ================================================================
  kit.box(62, FL, 76, 0, -FL / 2, -6, { color: COL.stoneDark, mat: 'stone' });
  kit.box(62.8, 0.45, 76.8, 0, -0.22, -6, { color: COL.stoneLight, mat: 'stone' });

  // 正门台阶：从台基顶（y=-FL+8*0.3=0）向 +Z 逐级下落
  kit.stairs(0, 32, { w: 30, steps: 8, rise: 0.3, run: 0.62, y0: -FL, color: COL.stone });
  // 两翼台阶（沿 X 方向展开）
  kit.stairs(31.4, -6, { w: 24, steps: 8, rise: 0.3, run: 0.62, y0: -FL, rotY: Math.PI / 2, color: COL.stone });
  kit.stairs(-31.4, -6, { w: 24, steps: 8, rise: 0.3, run: 0.62, y0: -FL, rotY: -Math.PI / 2, color: COL.stone });

  // 台阶两侧的望柱（立在地面上、随台阶逐级升高），呼应塔尖的垂直语言
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const bx = sx * 16.8;
      const bz = 33.4 + i * 2.7;
      const h = 2.8 + i * 0.6;
      kit.box(1.2, h, 1.2, bx, -FL + h / 2, bz, { color: COL.stoneLight, mat: 'stone' });
      kit.cone(0.95, 1.7, 6, bx, -FL + h + 0.85, bz, { color: COL.stone, mat: 'stone' });
    }
  }

  // ================================================================
  // 2. 正立面（西面）：三座大门 + 列王廊 + 巨型玫瑰窗 + 阶梯山花
  // ================================================================
  kit.box(32.4, 50, 2.8, 0, 25, FACADE_Z, { color: COL.stone, mat: 'stone' });
  // 立面竖向壁柱，制造"层层退进"的哥特线脚
  for (const x of [-15.6, 15.6]) {
    kit.box(1.3, 50, 1.3, x, 25, FACADE_Z + 1.35, { color: COL.stoneLight, mat: 'stone' });
  }
  // 立面水平束带（中段与上段）
  for (const yy of [23.2, 28.6, 48.7]) {
    kit.box(32.8, 0.7, 1.7, 0, yy, FACADE_Z + 1.2, { color: COL.stoneLight, mat: 'stone' });
  }

  // —— 三座大门 ——
  // 中央门：宽 10m、高 22m，是整个正立面的视觉重心
  kit.archway(0, FACADE_Z + 1.9, {
    w: 10, h: 22, t: 2.8, depth: 3.4,
    color: COL.stoneLight, glow: false,
  });
  // 两侧门：略小，形成"三门户"的仪式序列
  for (const sx of [-1, 1]) {
    kit.archway(sx * 11.6, FACADE_Z + 1.7, {
      w: 6.5, h: 14, t: 2.2, depth: 3.0,
      color: COL.stone, glow: false,
    });
  }

  // 门扇：深色木门 + 金钉 + 发光门缝；门顶是透光的尖拱花窗。
  // （比在门洞里放一块发光平面更"像建筑"）
  const putDoor = (cx, z, w, h) => {
    kit.box(w, h, 0.5, cx, h / 2, z, { color: COL.woodDark, mat: 'wood' });
    // 中缝与两侧门框（发光缝，模拟门内透出的光）
    kit.box(0.16, h * 0.94, 0.22, cx, h / 2, z + 0.32, { color: COL.glowGold, mat: 'glow', shade: false });
    for (const s of [-1, 1]) {
      kit.box(0.5, h, 0.22, cx + s * (w / 2 - 0.25), h / 2, z + 0.28, { color: COL.stoneDark, mat: 'stone' });
    }
    // 金钉（3 行 × 4 列）
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        kit.cyl(0.17, 0.17, 0.2, 6, cx - w * 0.3 + c * w * 0.2, h * 0.22 + r * h * 0.25, z + 0.3, {
          color: COL.gold, mat: 'gold', rx: Math.PI / 2,
        });
      }
    }
    // 门楣金饰
    kit.box(w + 0.7, 0.55, 0.8, cx, h - 0.1, z + 0.16, { color: COL.goldDeep, mat: 'bronze' });
  };
  putDoor(0, 25.55, 9.2, 13);
  putDoor(-11.6, 25.45, 5.9, 8.5);
  putDoor(11.6, 25.45, 5.9, 8.5);
  // 门顶的发光花窗（尖拱，占据门洞上半）
  kit.window(0, 13.6, 25.7, {
    w: 6.2, h: 5.2, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
  });
  for (const sx of [-1, 1]) {
    kit.window(sx * 11.6, 8.8, 25.6, {
      w: 3.6, h: 3.2, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
    });
  }
  // —— 巨型玫瑰窗：视觉主角之一 ——
  // 发光底盘（暖金光）→ 同心石雕圆环 → 12 根放射窗棂 → 12 瓣小圆花
  kit.geo(new THREE.CircleGeometry(ROSE_R - 0.4, 36), {
    x: 0, y: ROSE_Y, z: FACADE_Z + 1.62, color: COL.glowGold, mat: 'glow', shade: false,
  });
  kit.torus(ROSE_R, 0.8, 6, 40, 0, ROSE_Y, FACADE_Z + 1.95, { color: COL.stoneLight, mat: 'stone' });
  kit.torus(ROSE_R - 1.8, 0.42, 5, 32, 0, ROSE_Y, FACADE_Z + 2.05, { color: COL.stone, mat: 'stone' });
  kit.torus(ROSE_R - 3.8, 0.32, 4, 28, 0, ROSE_Y, FACADE_Z + 2.1, { color: COL.stoneLight, mat: 'stone' });
  // 放射窗棂
  for (let i = 0; i < 12; i++) {
    kit.box(0.42, ROSE_R * 2 - 0.9, 0.55, 0, ROSE_Y, FACADE_Z + 2.0, {
      color: COL.stone, mat: 'stone', rz: (Math.PI * i) / 12,
    });
  }
  // 花瓣小圆（石环 + 内部发光）
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    const px = Math.cos(a) * (ROSE_R - 2.8);
    const py = ROSE_Y + Math.sin(a) * (ROSE_R - 2.8);
    kit.torus(0.95, 0.22, 4, 12, px, py, FACADE_Z + 2.08, { color: COL.stoneLight, mat: 'stone' });
    kit.geo(new THREE.CircleGeometry(0.78, 12), {
      x: px, y: py, z: FACADE_Z + 1.98, color: COL.glowCyan, mat: 'glow', shade: false,
    });
  }
  // 窗心与外围金环（让玫瑰窗在远处也"跳"出来）
  kit.cyl(1.5, 1.5, 0.8, 10, 0, ROSE_Y, FACADE_Z + 2.1, { color: COL.goldBright, mat: 'gold', rx: Math.PI / 2 });
  kit.torus(ROSE_R + 1.3, 0.3, 5, 40, 0, ROSE_Y, FACADE_Z + 1.7, { color: COL.glowGold, mat: 'glow', shade: false });

  // —— 层叠拱券（archivolt）：在门洞外再套一层石圈，
  //    让三座大门有"一圈圈退进"的深度，这是哥特入口的标志性做法。——
  kit.archway(0, FACADE_Z + 2.45, { w: 14, h: 25.5, t: 1.2, depth: 1.0, color: COL.stoneLight, glow: false });
  kit.archway(0, FACADE_Z + 2.75, { w: 17, h: 28.5, t: 0.9, depth: 0.8, color: COL.stone, glow: false });
  for (const sx of [-1, 1]) {
    kit.archway(sx * 11.6, FACADE_Z + 2.2, { w: 8, h: 16.5, t: 1.0, depth: 0.9, color: COL.stoneLight, glow: false });
    // 拱券之上的发光符文（从广场看是两道细金线）
    kit.runeBand(sx * 11.6, 17.8, FACADE_Z + 1.55, { w: 6.6, h: 0.5, color: COL.glowGold, count: 10 });
  }

  // 玫瑰窗外的方形石框（哥特常用的"方中嵌圆"）
  for (const [w, h, dx, dy] of [[20, 1.5, 0, ROSE_R + 1.9], [20, 1.5, 0, -ROSE_R - 1.9], [1.5, 20, ROSE_R + 1.9, 0], [1.5, 20, -ROSE_R - 1.9, 0]]) {
    kit.box(w, h, 1.6, dx, ROSE_Y + dy, FACADE_Z + 1.5, { color: COL.stoneLight, mat: 'stone' });
  }

  // —— 列王廊：一排壁龛立像 ——
  // 抽象立像（底座 + 长袍 + 肩胸 + 头 + 金冠），9 尊横贯立面
  const putStatue = (x, y, z, h) => {
    kit.box(h * 0.44, h * 0.12, h * 0.4, x, y + h * 0.06, z, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(h * 0.15, h * 0.23, h * 0.52, 6, x, y + h * 0.12 + h * 0.26, z, { color: COL.stone, mat: 'stone' });
    kit.box(h * 0.34, h * 0.2, h * 0.22, x, y + h * 0.68, z, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(h * 0.085, h * 0.075, h * 0.13, 6, x, y + h * 0.86, z, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(h * 0.08, h * 0.13, 6, x, y + h * 0.97, z, { color: COL.gold, mat: 'gold' });
  };
  for (let i = 0; i < 9; i++) {
    const x = -13.6 + i * 3.4;
    // 壁龛背板与微拱
    kit.box(2.5, 4.2, 0.5, x, 26.2, FACADE_Z + 1.5, { color: COL.stoneDark, mat: 'stone' });
    putStatue(x, 24.2, FACADE_Z + 1.9, 3.6);
  }

  // —— 阶梯山花（crow-stepped gable）：北欧味的关键轮廓 ——
  for (let i = 0; i < 8; i++) {
    const w = 30 - i * 3.5;
    kit.box(w, 1.2, 2.6, 0, 50.6 + i * 1.2, FACADE_Z, {
      color: i % 2 ? COL.stoneLight : COL.stone, mat: 'stone',
    });
  }
  // 山花顶端的金色十字（远景剪影的收头）
  kit.box(0.55, 6, 0.55, 0, 62.2, FACADE_Z, { color: COL.gold, mat: 'gold' });
  kit.box(3.6, 0.55, 0.55, 0, 64.4, FACADE_Z, { color: COL.gold, mat: 'gold' });
  // 山花上的发光符文带
  kit.runeBand(0, 52.6, FACADE_Z + 1.4, { w: 24, h: 1.0, color: COL.glowGold, count: 30 });

  // ================================================================
  // 3. 双塔 + 尖塔（全教堂最高点：设计 114m，scale 0.92 后约 107m）
  // ================================================================
  for (const sx of [-1, 1]) {
    const TX = sx * TOWER_X;
    const TZ = TOWER_Z;

    // 塔心
    kit.box(14.2, TOWER_H, 14.2, TX, TOWER_H / 2, TZ, { color: COL.stone, mat: 'stone' });
    // 四角扶柱：把方形体量"锁"进地面
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        const bx = TX + ax * 6.4;
        const bz = TZ + az * 6.4;
        kit.box(3.0, TOWER_H + 0.6, 3.0, bx, (TOWER_H + 0.6) / 2, bz, { color: COL.stoneLight, mat: 'stone' });
        kit.box(3.8, 1.5, 3.8, bx, 0.75, bz, { color: COL.stoneDark, mat: 'stone' });
        kit.box(3.5, 1.0, 3.5, bx, TOWER_H + 0.5, bz, { color: COL.stoneDark, mat: 'stone' });
      }
    }
    // 束腰线脚（三层）
    for (const yy of [22, 44, 61.5]) {
      kit.box(15.6, 1.2, 15.6, TX, yy, TZ, { color: COL.stoneLight, mat: 'stone' });
      kit.box(16.2, 0.5, 16.2, TX, yy + 0.85, TZ, { color: COL.stoneDark, mat: 'stone' });
    }

    // 四个立面：窗 / 玫瑰小窗 / 符文带
    const faces = [
      { rot: 0, dx: 0, dz: 7.4 },
      { rot: Math.PI, dx: 0, dz: -7.4 },
      { rot: Math.PI / 2, dx: 7.4, dz: 0 },
      { rot: -Math.PI / 2, dx: -7.4, dz: 0 },
    ];
    for (const f of faces) {
      const cx = TX + f.dx;
      const cz = TZ + f.dz;
      // 钟楼层双联尖窗（发光，夜景时是两座"灯塔"）
      for (let i = -1; i <= 1; i += 2) {
        const ox = Math.cos(f.rot) * i * 2.0;
        const oz = -Math.sin(f.rot) * i * 2.0;
        kit.window(cx + ox, 46.5, cz + oz, {
          w: 2.3, h: 11.5, rotY: f.rot, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
        });
      }
      // 中层玫瑰小窗
      kit.torus(2.9, 0.45, 5, 22, cx, 34, cz, { color: COL.stoneLight, mat: 'stone', ry: f.rot });
      kit.geo(new THREE.CircleGeometry(2.5, 20), {
        x: cx + Math.sin(f.rot) * 0.12, y: 34, z: cz + Math.cos(f.rot) * 0.12,
        color: COL.glowGold, mat: 'glow', shade: false, ry: f.rot,
      });
      // 上层符文带（金）
      kit.runeBand(cx, 60.4, cz, { w: 10.5, h: 0.85, rotY: f.rot, color: COL.glowGold });
      // 滴水兽（每面 2 只，蹲在檐口）
      for (const i of [-1, 1]) {
        const ox = Math.cos(f.rot) * i * 4.6;
        const oz = -Math.sin(f.rot) * i * 4.6;
        kit.box(1.3, 1.1, 2.6, cx + ox + f.dx * 0.12, 59.0, cz + oz + f.dz * 0.12, {
          color: COL.stoneDark, mat: 'stone', ry: f.rot,
        });
        kit.cone(0.65, 1.6, 5, cx + ox + f.dx * 0.3, 59.0, cz + oz + f.dz * 0.3, {
          color: COL.stoneDark, mat: 'stone', rx: Math.PI / 2, ry: f.rot,
        });
      }
    }
    // 塔身下层长窗（正面 + 内侧）
    for (let i = -1; i <= 1; i++) {
      kit.window(TX + i * 3.3, 9, TZ + 7.4, {
        w: 2.0, h: 9.5, rotY: 0, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
      });
    }
    // 塔基盲拱龛（每个立面两个）：塔脚不再是光秃秃的大石块
    for (const f of faces) {
      for (const i of [-1, 1]) {
        const ox = Math.cos(f.rot) * i * 2.5;
        const oz = -Math.sin(f.rot) * i * 2.5;
        kit.window(TX + f.dx + ox, 3.2, TZ + f.dz + oz, {
          w: 1.4, h: 3.0, rotY: f.rot, glow: false, color: COL.stoneLight, mullion: false,
        });
      }
    }

    // 塔顶四角小尖塔
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        kit.spire(TX + ax * 6.4, TZ + az * 6.4, {
          h: 10, r: 2.2, y0: TOWER_H + 1.0, seg: 8, tiers: 2, glowTip: false, color: COL.stoneCold,
        });
      }
    }
    // 主尖塔（三层收分；顶端十字由下面的金件收头，不再加 Kit 的大光晕球）
    kit.spire(TX, TZ, {
      h: 44, r: 8.6, y0: TOWER_H + 1.0, seg: 8, tiers: 3, color: COL.stoneCold, glowTip: false,
    });
    // 塔尖金十字 + 一小团暖光（远景中两座塔尖会成为画面的最高点）
    kit.box(0.5, 5.6, 0.5, TX, 111.4, TZ, { color: COL.goldBright, mat: 'gold' });
    kit.box(3.0, 0.5, 0.5, TX, 113.2, TZ, { color: COL.goldBright, mat: 'gold' });
    kit.glowBlob(TX, 110.6, TZ, 2.4, COL.glowGold, 0.2);
    // 尖塔基部的八个金色小尖角，让"塔尖-塔身"的过渡不至于秃
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * i) / 4;
      kit.cone(0.75, 4.2, 5, TX + Math.sin(a) * 7.4, TOWER_H + 3.2, TZ + Math.cos(a) * 7.4, {
        color: COL.gold, mat: 'gold',
      });
    }
    // 塔前长旗
    kit.banner(TX, 30, TZ + 7.5, {
      w: 2.6, h: 13, color: sx < 0 ? COL.clothBlue : COL.clothRed, rotY: 0,
    });

    kit.collider(TX, TZ, 8.8);
  }

  // ================================================================
  // 4. 中殿 + 侧廊 + 飞扶壁
  //    中殿高墙（38m）+ 两侧低矮侧廊（24m）形成"主次分明"的体量，
  //    飞扶壁像肋骨一样把高墙"抱"住。
  // ================================================================
  const BAY_Z = [19, 13, 7, 1, -5, -11];   // 高侧窗 / 侧廊窗的六分柱距

  for (const sx of [-1, 1]) {
    // 侧廊外墙
    kit.box(1.8, 24, 40, sx * AISLE_OUT, 12, 4, { color: COL.stone, mat: 'stone' });
    // 侧廊外墙的水平石雕带
    kit.box(2.1, 0.75, 40, sx * AISLE_OUT, 17.2, 4, { color: COL.stoneLight, mat: 'stone' });
    kit.box(2.1, 0.6, 40, sx * AISLE_OUT, 23.0, 4, { color: COL.stoneLight, mat: 'stone' });

    // 外墙扶壁（7 道），顶部小锥
    for (let i = 0; i < 7; i++) {
      const z = 22 - i * 6.4;
      kit.box(2.4, 24.6, 2.4, sx * 17.3, 12.3, z, { color: COL.stoneLight, mat: 'stone' });
      kit.cone(1.2, 2.8, 6, sx * 17.3, 26.0, z, { color: COL.stone, mat: 'stone' });
    }

    // 侧廊窗（哥特尖窗 + 发光窗芯）
    for (const z of BAY_Z) {
      kit.window(sx * (AISLE_OUT + 1.1), 7.5, z, {
        w: 2.9, h: 9.5, rotY: sx * Math.PI / 2, glow: true, glowColor: COL.glowGold, color: COL.stoneLight,
      });
      // 窗上小圆窗（花窗棂）
      kit.torus(1.15, 0.24, 4, 12, sx * (AISLE_OUT + 1.1), 19.2, z, { color: COL.stoneLight, mat: 'stone', ry: sx * Math.PI / 2 });
    }

    // 高侧墙（中殿墙身）
    kit.box(1.5, WALL_H, 40, sx * NAVE_HALF, WALL_H / 2, 4, { color: COL.stone, mat: 'stone' });
    kit.box(1.9, 0.7, 40, sx * NAVE_HALF, 37.4, 4, { color: COL.stoneLight, mat: 'stone' });
    // 高侧窗：排成一列，向室内（和夜景）提供金光
    for (const z of BAY_Z) {
      kit.window(sx * (NAVE_HALF + 1.02), 29.5, z, {
        w: 2.6, h: 7.5, rotY: sx * Math.PI / 2, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
      });
      // 高侧窗之间的束柱
      kit.cyl(0.4, 0.45, WALL_H, 6, sx * (NAVE_HALF + 0.8), WALL_H / 2, z + 3.2, { color: COL.stoneLight, mat: 'stone' });
    }

    // 侧廊单坡屋顶（向内高、向外低）
    kit.box(10.5, 0.5, 40, sx * 12.4, 24.7, 4, {
      color: COL.stoneCold, mat: 'stone', rz: sx * -0.669,
    });

    // 飞扶壁：4 组，从外墩斜撑到高侧墙
    for (const z of [6, 0, -6, -12]) {
      const px = sx * 21.4;
      // 支撑墩
      kit.box(2.6, 30, 3.2, px, 15, z, { color: COL.stone, mat: 'stone' });
      kit.box(3.3, 1.4, 3.9, px, 0.7, z, { color: COL.stoneDark, mat: 'stone' });
      kit.box(3.0, 1.0, 3.6, px, 30, z, { color: COL.stoneLight, mat: 'stone' });
      // 墩顶小尖塔
      kit.spire(px, z, { h: 8.5, r: 1.7, y0: 30, seg: 8, tiers: 2, glowTip: false, color: COL.stoneCold });
      // 飞券：一段斜置的石梁，连接外墩顶与高侧墙
      const x1 = sx * 9.2;
      const y1 = 35.6;
      const len = Math.hypot(x1 - px, y1 - 29.4);
      const ang = Math.atan2(y1 - 29.4, x1 - px);
      kit.box(len, 0.9, 2.0, (px + x1) / 2, (29.4 + y1) / 2, z, {
        color: COL.stone, mat: 'stone', rz: ang,
      });
      // 飞券上的小竖墩（视觉上把力"传"回墙身）
      kit.box(1.5, 2.6, 1.7, sx * 11.2, 36.6, z, { color: COL.stoneLight, mat: 'stone' });
      // 飞券下方的斜撑：一段短柱 + 斗形托，让飞券不是"悬在空中"
      kit.box(0.7, 3.4, 1.6, sx * 15.4, 31.6, z, { color: COL.stoneDark, mat: 'stone', rz: sx * 0.42 });
      kit.box(1.1, 1.1, 1.8, sx * 13.8, 33.4, z, { color: COL.stoneLight, mat: 'stone' });
      kit.collider(px, z, 2.3);
    }
  }

  // 高侧墙顶的小尖饰（每边 6 座）：从中景看是一排齿状剪影
  for (const sx of [-1, 1]) {
    for (const z of BAY_Z) {
      kit.spire(sx * 9.6, z, {
        h: 6.2, r: 1.05, y0: 36.8, seg: 6, tiers: 2, glowTip: false, color: COL.stoneCold,
      });
    }
  }

  // 中殿大屋顶
  kit.roofGable(0, 4, {
    w: 17.9, d: 41, h: 13, y0: 37.4, color: COL.stoneCold, mat: 'stone', thickness: 0.55, overhang: 0.6,
  });

  // 屋脊饰：一排金色小十字，逆光时形成"锯齿状"天际线
  for (let i = 0; i < 18; i++) {
    const z = -15 + i * 2.2;
    kit.box(0.22, 1.6, 0.22, 0, 50.9, z, { color: COL.gold, mat: 'gold' });
    kit.box(0.95, 0.2, 0.2, 0, 51.4, z, { color: COL.gold, mat: 'gold' });
  }

  // ================================================================
  // 5. 袖廊（十字的横臂）与后殿
  // ================================================================
  // 横臂
  for (const sx of [-1, 1]) {
    kit.box(23, WALL_H, 13, sx * 11.5, WALL_H / 2, TRANS_Z, { color: COL.stone, mat: 'stone' });
  }
  // 交叉部填充
  kit.box(17.8, WALL_H, 13, 0, WALL_H / 2, TRANS_Z, { color: COL.stone, mat: 'stone' });
  // 袖廊屋顶（脊线沿 X，所以旋转 90°）
  kit.roofGable(0, TRANS_Z, {
    w: 13.2, d: 47, h: 9.5, y0: 37.4, rotY: Math.PI / 2,
    color: COL.stoneCold, mat: 'stone', thickness: 0.5,
  });
  // 袖廊屋脊饰
  for (let i = 0; i < 16; i++) {
    const x = -22 + i * 2.9;
    kit.box(0.22, 1.5, 0.22, x, 47.2, TRANS_Z, { color: COL.gold, mat: 'gold' });
  }

  // 横臂两端：巨型花窗 + 尖顶小山墙 + 端部扶壁
  for (const sx of [-1, 1]) {
    const EX = sx * 23.4;
    // 端墙大窗
    kit.window(EX, 11, TRANS_Z, {
      w: 6.5, h: 15, rotY: sx * Math.PI / 2, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
    });
    // 端墙玫瑰
    kit.torus(4.2, 0.6, 5, 26, EX, 32, TRANS_Z, { color: COL.stoneLight, mat: 'stone', ry: sx * Math.PI / 2 });
    kit.geo(new THREE.CircleGeometry(3.8, 24), {
      x: EX + Math.sin(sx * Math.PI / 2) * 0.15, y: 32, z: TRANS_Z,
      color: COL.glowGold, mat: 'glow', shade: false, ry: sx * Math.PI / 2,
    });
    // 端部阶梯山墙
    for (let i = 0; i < 6; i++) {
      kit.box(1.2, 1.0, 11 - i * 1.6, EX + sx * 0.8, 39 + i * 1.1, TRANS_Z, {
        color: i % 2 ? COL.stoneLight : COL.stone, mat: 'stone',
      });
    }
    // 端部扶壁（前后各一）
    for (const az of [-1, 1]) {
      const bz = TRANS_Z + az * 6.6;
      kit.box(2.8, 35, 2.8, EX + sx * 1.4, 17.5, bz, { color: COL.stoneLight, mat: 'stone' });
      kit.spire(EX + sx * 1.4, bz, { h: 6.5, r: 1.4, y0: 35, seg: 8, tiers: 2, glowTip: false, color: COL.stoneCold });
      kit.collider(EX + sx * 1.4, bz, 2.2);
    }
    // 横臂长旗
    kit.banner(EX + sx * 0.2, 22, TRANS_Z, {
      w: 2.2, h: 10, color: sx < 0 ? COL.clothRed : COL.clothBlue, rotY: sx * Math.PI / 2,
    });
  }

  // 后殿（半圆室）：主体后方的圆龛
  kit.cyl(8.6, 9.4, 34, 12, 0, 17, -30, { color: COL.stone, mat: 'stone' });
  kit.cyl(9.8, 9.8, 1.0, 12, 0, 34.2, -30, { color: COL.stoneLight, mat: 'stone' });
  kit.cone(9.6, 9.5, 12, 0, 39.4, -30, { color: COL.stoneCold, mat: 'stone' });
  // 后殿锥顶周围的小尖饰（把圆顶"钉"在天空里）
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i - 2.5) * 0.34;
    kit.cone(0.7, 3.2, 5, Math.sin(a) * 9.2, 35.6, -30 + Math.cos(a) * 9.2, {
      color: COL.stoneLight, mat: 'stone',
    });
  }
  // 后殿放射窗与放射扶壁
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i - 2) * 0.42;
    const wx = Math.sin(a) * 9.34;
    const wz = -30 + Math.cos(a) * 9.34;
    kit.window(wx, 9, wz, {
      w: 2.2, h: 8, rotY: a, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
    });
    // 扶壁（窗之间的放射墩）
    const ba = a + 0.21;
    kit.box(1.8, 30, 2.2, Math.sin(ba) * 10.1, 15, -30 + Math.cos(ba) * 10.1, {
      color: COL.stoneLight, mat: 'stone', ry: ba,
    });
  }
  kit.collider(0, -30, 10.0);

  // 交叉部的小尖塔（flèche）：把视线上引到 67m
  kit.spire(0, TRANS_Z, {
    h: 18, r: 2.7, y0: 47.5, seg: 8, tiers: 2, color: COL.stoneCold, glowColor: COL.glowGold,
  });

  // ================================================================
  // 6. 装饰细节：盲拱廊、四叶饰带、壁龛雕像、山花卷叶
  //    哥特建筑的信息量来自"密集小构件"：远景看是纹理，近景看是雕刻。
  // ================================================================
  for (const sx of [-1, 1]) {
    // 侧廊外墙：10 个盲拱龛，形成连续拱廊（无发光，纯石雕）
    for (let i = 0; i < 10; i++) {
      const z = 21.4 - i * 4.2;
      kit.window(sx * 17.35, 2.4, z, {
        w: 2.1, h: 3.2, rotY: sx * Math.PI / 2, glow: false,
        color: COL.stoneLight, arch: true, mullion: false,
      });
    }
    // 侧廊檐口下的四叶饰带（一排小圆环）
    for (let i = 0; i < 19; i++) {
      const z = 22.6 - i * 2.35;
      kit.torus(0.7, 0.16, 4, 10, sx * 17.25, 20.3, z, {
        color: COL.stoneLight, mat: 'stone', ry: sx * Math.PI / 2,
      });
    }
    // 高侧窗顶上的圆棂（窄窗变"尖拱花窗"）
    for (const z of BAY_Z) {
      kit.torus(1.05, 0.2, 4, 12, sx * 9.5, 37.0, z, {
        color: COL.stoneLight, mat: 'stone', ry: sx * Math.PI / 2,
      });
    }
  }

  // 玫瑰窗两侧的先知像（上下两组，站在壁龛托座上）
  for (const sx of [-1, 1]) {
    for (const yy of [30.2, 44.6]) {
      kit.box(3.0, 0.6, 1.6, sx * 11.6, yy - 0.3, FACADE_Z + 2.2, { color: COL.stoneLight, mat: 'stone' });
      putStatue(sx * 11.6, yy, FACADE_Z + 2.4, 3.4);
    }
  }
  // 山花阶梯边缘的卷叶饰（crockets）
  for (let i = 0; i < 8; i++) {
    const w = 30 - i * 3.5;
    for (const s of [-1, 1]) {
      kit.cone(0.34, 1.15, 4, s * (w / 2 - 0.2), 50.6 + i * 1.2 + 0.95, FACADE_Z + 1.4, {
        color: COL.stoneLight, mat: 'stone',
      });
    }
  }
  // 山花中央的小四叶窗（对景：从广场望去正好在玫瑰窗正上方）
  kit.torus(1.35, 0.28, 4, 16, 0, 48.4, FACADE_Z + 1.5, { color: COL.stoneLight, mat: 'stone' });
  kit.geo(new THREE.CircleGeometry(1.1, 14), {
    x: 0, y: 48.4, z: FACADE_Z + 1.56, color: COL.glowGold, mat: 'glow', shade: false,
  });
  // 袖廊端山墙的卷叶饰
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        kit.cone(0.3, 1.0, 4, sx * 23.4 + sx * 0.8, 39 + i * 1.1 + 0.85,
          TRANS_Z + s * (11 - i * 1.6) / 2, { color: COL.stoneLight, mat: 'stone' });
      }
    }
  }

  // ================================================================
  // 7. 可行走平台
  //    World 会把 userData.platforms 转成世界坐标的落脚面；坐标与碰撞体
  //    一样，都是"已乘 scale 的建筑局部坐标"。
  // ================================================================
  const platforms = [];
  const plat = (x, z, hw, hd, yTop, rotY = 0) => platforms.push({
    x: x * scale, z: z * scale, hw: hw * scale, hd: hd * scale, y: yTop * scale, rotY,
  });
  // 正面大台阶（8 级，逐级抬升 0.3m）
  for (let i = 0; i < 8; i++) {
    plat(0, 32 + (i + 0.5) * 0.62, 15, 0.31, 0.3 * (8 - i));
  }
  // 两翼台阶
  for (let i = 0; i < 8; i++) {
    const dx = 31.4 + (i + 0.5) * 0.62;
    plat(dx, -6, 0.31, 12, 0.3 * (8 - i));
    plat(-dx, -6, 0.31, 12, 0.3 * (8 - i));
  }
  // 台基顶面（2.4m）
  plat(0, -6, 31, 38, FL);

  // ================================================================
  // 8. 碰撞体（俯视圆 / 矩形）
  //    台基外圈是一圈"墙"，只在三处台阶开口留缺 —— 角色不能从侧面钻进
  //    台基体内，但可以从台阶走上去、站到大门前。
  // ================================================================
  kit.boxCollider(0, 4, 17.8, 20.6, 0);        // 中殿 + 双侧廊
  kit.boxCollider(0, TRANS_Z, 23.2, 6.8, 0);   // 袖廊
  kit.boxCollider(-23, 31.3, 8, 0.8, 0);       // 台基前缘（正面台阶两侧）
  kit.boxCollider(23, 31.3, 8, 0.8, 0);
  for (const sx of [-1, 1]) {
    kit.boxCollider(sx * 31.3, -31, 0.8, 13, 0);  // 台基侧缘（靠后）
    kit.boxCollider(sx * 31.3, 19, 0.8, 13, 0);   // 台基侧缘（靠前）
  }
  kit.boxCollider(0, -44.3, 31, 0.8, 0);       // 台基后缘

  // ================================================================
  // 9. 组装 + 尺度烘焙
  // ================================================================
  const group = kit.build({ name: 'cathedral' });
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  return finalize(group, kit, scale, FL);
}

/**
 * 收尾：把「设计尺度、楼面 y=0」的几何一次性烘焙成最终尺寸，
 * 并同步换算碰撞体 / 包围盒。
 */
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
