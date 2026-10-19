/**
 * Gate.js — 「阿斯加德界门」（BIFROST GATE）
 *
 * 模块职责：
 *   两座巨塔夹一座跨越 34m 的层叠拱门。拱上用发光符文带写满咒文，
 *   门洞里悬着巨大的金属符文环，环后是全黑的"虚空"——通往另一界。
 *
 * 对外 API：
 *   buildGate(opts) -> THREE.Group
 *   meta -> { id, label, radius, height }（设计尺度 = scale 1 时）
 *
 * opts：{ scale=1, seed=1, variant=0, beacon=false（界门常亮，忽略） }
 *   builder 内部已烘焙 scale，World 只设置 position / rotation。
 *
 * userData：
 *   userData.beaconPoint = { x, y, z }  符文环圆心（悬浮传送门的锚点）
 *   userData.colliders / boxColliders / height / radius / scaledBy / meta
 *   userData.platforms = [{x,z,hw,hd,y,rotY}]  门前台阶 + 门洞广场（可行走）
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 *
 * 尺度：设计高度约 75m；data/world.js 中 scale=1.1 → 约 82m（塔尖十字）。
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

export const meta = {
  id: 'gate',
  label: '阿斯加德界门',
  radius: 46,
  height: 75,
};

const FL = 2.4;          // 台基高度
const TOWER_X = 28.5;    // 双塔中心 X
const SPAN = 34;         // 门洞净跨（>30m）
const SPRING_Y = 25;     // 起拱线（三层拱券统一用同一高度）
const RING_Y = 21;       // 符文环圆心高度
const RING_R = 13.5;     // 符文环半径
const CROWN_Y = 64;      // 拱上墙体的顶面

export function buildGate(opts = {}) {
  const { scale = 1, seed = 1, variant = 0 } = opts;
  const kit = new Kit({ seed: seed + variant * 733 });

  // ================================================================
  // 1. 台基与引导台阶
  // ================================================================
  kit.box(88, FL, 44, 0, -FL / 2, 0, { color: COL.stoneDark, mat: 'stone' });
  kit.box(89, 0.45, 45, 0, -0.22, 0, { color: COL.stoneLight, mat: 'stone' });
  // 正面大台阶（64m 宽，人站在下面会显得极渺小）
  kit.stairs(0, 22, { w: 64, steps: 8, rise: FL / 8, run: 0.72, y0: -FL, color: COL.stone });
  // 台阶两侧的望柱与内侧矮墙
  for (const sx of [-1, 1]) {
    kit.box(2.4, 2.4, 8, sx * 33, -FL + 1.2, 25, { color: COL.stone, mat: 'stone' });
    for (let i = 0; i < 3; i++) {
      kit.box(1.4, 3.2, 1.4, sx * 33, -FL + 1.6, 22.4 + i * 2.6, { color: COL.stoneLight, mat: 'stone' });
      kit.cone(1.0, 1.8, 6, sx * 33, -FL + 3.9, 22.4 + i * 2.6, { color: COL.gold, mat: 'gold' });
    }
  }

  // ================================================================
  // 2. 双塔：方形、分层收进、带垛口与尖顶
  // ================================================================
  for (const sx of [-1, 1]) {
    const TX = sx * TOWER_X;

    // —— 三段体量 ——
    kit.box(23, 30, 21, TX, 15, 0, { color: COL.stone, mat: 'stone' });
    kit.box(20.5, 16, 18.5, TX, 38, 0, { color: COL.stone, mat: 'stone' });
    kit.box(17.5, 14, 16, TX, 53, 0, { color: COL.stone, mat: 'stone' });

    // —— 四角扶壁（只在底段与中段）——
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        kit.box(3.6, 30, 3.6, TX + ax * 9.7, 15, az * 8.9, { color: COL.stoneLight, mat: 'stone' });
        kit.box(3.0, 16, 3.0, TX + ax * 8.6, 38, az * 7.9, { color: COL.stoneLight, mat: 'stone' });
        kit.box(4.2, 1.2, 4.2, TX + ax * 9.7, 0.6, az * 8.9, { color: COL.stoneDark, mat: 'stone' });
      }
    }
    // —— 层间线脚 ——
    kit.box(24.2, 1.2, 22.2, TX, 30.4, 0, { color: COL.stoneLight, mat: 'stone' });
    kit.box(21.6, 1.0, 19.6, TX, 46.3, 0, { color: COL.stoneLight, mat: 'stone' });
    kit.box(18.6, 1.2, 17.1, TX, 60.2, 0, { color: COL.stoneLight, mat: 'stone' });

    // —— 正面（+Z）的窗与符文 ——
    for (const dx of [-6, 0, 6]) {
      kit.window(TX + dx, 8, 10.7, {
        w: 2.6, h: 14, glow: true, glowColor: COL.glowCyan, color: COL.stoneDark,
      });
    }
    for (const dx of [-4, 4]) {
      kit.window(TX + dx, 33, 9.4, {
        w: 2.2, h: 9, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
      });
      // 金色盾徽
      kit.cyl(1.8, 1.8, 0.45, 12, TX + dx, 39.5, 9.5, {
        rx: Math.PI / 2, color: COL.gold, mat: 'gold',
      });
      kit.torus(1.35, 0.2, 4, 16, TX + dx, 39.5, 9.8, { color: COL.goldBright, mat: 'gold' });
    }
    kit.window(TX, 49, 8.3, {
      w: 2.0, h: 8, glow: true, glowColor: COL.glowCyan, color: COL.stoneDark,
    });
    // 正面符文带（上下两条）
    kit.runeBand(TX, 45.2, 10.2, { w: 17.5, h: 0.9, rotY: 0, color: COL.glowGold, count: 26 });
    kit.runeBand(TX, 57.6, 9.0, { w: 15.0, h: 0.8, rotY: 0, color: COL.glowCyan, count: 22 });

    // —— 内侧立面（朝向门洞）：被拱门"夹"住的发光长窗 ——
    const innerX = TX - sx * 11.32;
    for (const z of [-4.5, 4.5]) {
      kit.window(innerX, 5, z, {
        w: 2.3, h: 13, rotY: -sx * Math.PI / 2, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
      });
    }
    // —— 外侧立面：纵向扶壁 + 符文带 ——
    const outerX = TX + sx * 11.55;
    for (const z of [-6, 0, 6]) {
      kit.box(2.2, 30, 2.6, TX + sx * 12.2, 15, z, { color: COL.stoneLight, mat: 'stone' });
    }
    kit.runeBand(outerX, 24.5, 0, {
      w: 17, h: 0.9, rotY: sx * Math.PI / 2, color: COL.glowGold, count: 26,
    });
    // —— 背面长窗 ——
    for (const dx of [-5, 0, 5]) {
      kit.window(TX + dx, 9, -10.7, {
        w: 2.4, h: 12, rotY: Math.PI, glow: true, glowColor: COL.glowCyan, color: COL.stoneDark,
      });
    }

    // —— 垛口（上段四面）——
    // 前后两面各 6 个；左右两面各 5 个
    for (let i = -2.5; i <= 2.5; i++) {
      kit.box(1.7, 3.0, 1.2, TX + i * 2.9, 62.0, 8.2, { color: COL.stoneLight, mat: 'stone' });
      kit.box(1.7, 3.0, 1.2, TX + i * 2.9, 62.0, -8.2, { color: COL.stoneLight, mat: 'stone' });
    }
    for (let i = -2; i <= 2; i++) {
      kit.box(1.2, 3.0, 1.7, TX + 8.2, 62.0, i * 2.9, { color: COL.stoneLight, mat: 'stone' });
      kit.box(1.2, 3.0, 1.7, TX - 8.2, 62.0, i * 2.9, { color: COL.stoneLight, mat: 'stone' });
    }

    // —— 塔顶四角尖塔 + 中央尖塔 ——
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        kit.spire(TX + ax * 7.6, az * 7.0, {
          h: 9, r: 1.9, y0: 60.8, seg: 6, tiers: 2, glowTip: false, color: COL.stoneCold,
        });
      }
    }
    kit.spire(TX, 0, {
      h: 8.5, r: 4.1, y0: 60.8, seg: 8, tiers: 2, glowTip: false, color: COL.stoneCold,
    });
    // 塔尖上的金色十字矛
    kit.box(0.55, 5.2, 0.55, TX, 70.0, 0, { color: COL.goldBright, mat: 'gold' });
    kit.box(3.0, 0.5, 0.5, TX, 71.8, 0, { color: COL.goldBright, mat: 'gold' });
    kit.glowBlob(TX, 69.4, 0, 1.5, COL.glowCyan, 0.18);

    // —— 塔身长旗 ——
    kit.banner(TX - 5.2, 20, 10.9, {
      w: 2.4, h: 13, color: sx < 0 ? COL.clothBlue : COL.clothRed, rotY: 0,
    });
    kit.banner(TX + 5.2, 20, 10.9, {
      w: 2.4, h: 13, color: sx < 0 ? COL.clothRed : COL.clothBlue, rotY: 0,
    });

    kit.boxCollider(TX, 0, 11.6, 10.6, 0);
  }

  // ================================================================
  // 3. 三层同心拱券（层叠线脚）
  //    三层起拱线都在 y=25，拱顶依次抬升到 42 / 45 / 48m。
  // ================================================================
  kit.archway(0, 3.6, {
    w: 46, h: 48, t: 2.4, depth: 2.6, color: COL.stoneLight, mat: 'stone',
  });
  kit.archway(0, 0, {
    w: 40, h: 45, t: 3.2, depth: 9.0, color: COL.stone, mat: 'stone',
  });
  kit.archway(0, -3.6, {
    w: SPAN, h: 42, t: 2.8, depth: 2.6, color: COL.stoneDark, mat: 'stone',
  });
  // 起拱线上的金色束带（把三层拱券"串"起来）
  for (const sx of [-1, 1]) {
    kit.box(3.0, 1.3, 9.4, sx * 20.2, SPRING_Y, 0, { color: COL.goldDeep, mat: 'bronze' });
  }
  // 拱肩上的符文（左右各一条）
  for (const sx of [-1, 1]) {
    kit.runeBand(sx * 15.0, 43.0, 5.0, { w: 12, h: 1.2, rotY: 0, color: COL.glowGold, count: 20 });
  }

  // ================================================================
  // 4. 拱上墙体：满墙发光符文 + 巨型符文圆
  // ================================================================
  kit.box(34, CROWN_Y - 43, 10, 0, (CROWN_Y + 43) / 2, 0, { color: COL.stone, mat: 'stone' });
  // 上沿金线
  kit.box(35, 1.1, 10.8, 0, CROWN_Y - 0.4, 0, { color: COL.gold, mat: 'gold' });
  kit.box(34, 0.8, 10.8, 0, 47.2, 0, { color: COL.stoneLight, mat: 'stone' });
  // 满墙符文带（两行，青金交错）
  kit.runeBand(0, 52.0, 5.2, { w: 30, h: 2.4, color: COL.glowCyan, count: 42 });
  kit.runeBand(0, 55.8, 5.2, { w: 26, h: 1.3, color: COL.glowGold, count: 36 });
  // 巨型符文圆（拱上焦点）
  kit.torus(4.5, 0.6, 6, 34, 0, 55.0, 5.4, { color: COL.bronze, mat: 'bronze' });
  kit.torus(3.9, 0.26, 5, 30, 0, 55.0, 5.55, { color: COL.glowCyan, mat: 'glow', shade: false });
  kit.torus(2.4, 0.2, 4, 24, 0, 55.0, 5.6, { color: COL.goldBright, mat: 'gold' });
  kit.geo(new THREE.CircleGeometry(2.2, 20), {
    x: 0, y: 55.0, z: 5.3, color: COL.glowCyan, mat: 'glow', shade: false,
  });
  // 符文圆放射刻痕
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    kit.box(0.34, 3.6, 0.24, Math.cos(a) * 3.4, 55.0 + Math.sin(a) * 3.4, 5.5, {
      rz: a, color: COL.stoneLight, mat: 'stone',
    });
  }
  // 拱顶上的金色尖冠（天际线的收头）
  for (let i = -3; i <= 3; i++) {
    kit.cone(0.5, 4.2 + (3 - Math.abs(i)) * 0.9, 5, i * 4.2, CROWN_Y + 2.4, 2.0, {
      color: i % 2 ? COL.gold : COL.goldBright, mat: 'gold',
    });
  }

  // ================================================================
  // 5. 门洞内的暗色虚空 + 悬浮符文环（视觉主角）
  // ================================================================
  // 虚空：一块纯黑的板（用 glow 材质的纯黑，不受光照影响）
  kit.box(34.4, 43, 0.6, 0, 21.5, -8.5, { color: COL.black, mat: 'glow', shade: false });
  // 虚空前的一层青色雾（加法混合，制造"深处有光"的错觉）
  kit.geo(new THREE.CircleGeometry(16.5, 32), {
    x: 0, y: 21, z: -6.4, color: COL.glowCyan, mat: 'haze', shade: false,
  });

  // 悬浮金属符文环
  kit.torus(RING_R, 0.85, 8, 48, 0, RING_Y, 0.6, { color: COL.bronze, mat: 'bronze' });
  kit.torus(RING_R, 0.30, 6, 48, 0, RING_Y, 0.85, { color: COL.glowCyan, mat: 'glow', shade: false });
  kit.torus(RING_R + 1.4, 0.13, 5, 48, 0, RING_Y, 0.3, { color: COL.glowCyan, mat: 'glow', shade: false });
  // 环上的 28 枚符文
  for (let i = 0; i < 28; i++) {
    const a = (Math.PI * 2 * i) / 28;
    kit.box(0.62, 1.65, 0.16,
      Math.cos(a) * RING_R, RING_Y + Math.sin(a) * RING_R, 1.05, {
        rz: a,
        color: i % 6 === 0 ? COL.glowCyan : COL.glowGold, mat: 'glow', shade: false,
      });
  }
  // 环上的 8 个金色节点（让金属环有"结构"）
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    kit.cyl(0.95, 0.95, 1.0, 6,
      Math.cos(a) * RING_R, RING_Y + Math.sin(a) * RING_R, 0.6, {
        rx: Math.PI / 2, rz: a, color: COL.goldBright, mat: 'gold',
      });
  }
  // 环心的一缕光晕（传送门能量）
  kit.glowBlob(0, RING_Y, -1.0, 4.2, COL.glowCyan, 0.2);
  // 环两侧的悬浮金屑（暗示"门在运转"）
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    kit.box(0.32, 0.32, 0.32,
      Math.cos(a) * (RING_R + 2.4), RING_Y + Math.sin(a) * (RING_R + 2.4), 0.9, {
        rz: a, color: COL.goldBright, mat: 'gold', shade: false,
      });
  }

  // ================================================================
  // 6. 门前的守望者雕像 + 火盆
  // ================================================================
  const putGuardian = (x, z, h) => {
    // 基座
    kit.box(5.2, 3.2, 5.2, x, 1.6, z, { color: COL.stoneDark, mat: 'stone' });
    kit.box(6.0, 0.5, 6.0, x, 3.5, z, { color: COL.stoneLight, mat: 'stone' });
    const y0 = 3.7;
    // 长袍
    kit.cyl(h * 0.11, h * 0.22, h * 0.5, 7, x, y0 + h * 0.25, z, { color: COL.stone, mat: 'stone' });
    // 胸甲 / 肩甲 / 头
    kit.box(h * 0.34, h * 0.2, h * 0.26, x, y0 + h * 0.53, z, { color: COL.stoneLight, mat: 'stone' });
    kit.box(h * 0.44, h * 0.08, h * 0.2, x, y0 + h * 0.63, z, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(h * 0.075, h * 0.085, h * 0.11, 7, x, y0 + h * 0.73, z, { color: COL.stoneLight, mat: 'stone' });
    // 角盔
    for (const s of [-1, 1]) {
      kit.cone(h * 0.035, h * 0.13, 5, x + s * h * 0.09, y0 + h * 0.8, z, {
        color: COL.bone, mat: 'stone', rz: -s * 0.5,
      });
    }
    // 长矛
    kit.cyl(h * 0.012, h * 0.016, h * 1.0, 6, x + h * 0.23, y0 + h * 0.45, z + h * 0.1, {
      color: COL.bronze, mat: 'bronze', rz: -0.06,
    });
    kit.cone(h * 0.035, h * 0.1, 5, x + h * 0.22, y0 + h * 0.97, z + h * 0.1, {
      color: COL.goldBright, mat: 'gold',
    });
    // 圆盾
    kit.cyl(h * 0.14, h * 0.14, h * 0.05, 9, x - h * 0.19, y0 + h * 0.45, z + h * 0.12, {
      color: COL.gold, mat: 'gold', rx: Math.PI / 2,
    });
    kit.collider(x, z, 2.8);
  };
  putGuardian(-21.5, 15.5, 9.0);
  putGuardian(21.5, 15.5, 9.0);

  // 门前火盆（青铜三足 + 石盆 + 暗色盆心）
  for (const sx of [-1, 1]) {
    const bx = sx * 13.5;
    const bz = 18.0;
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      kit.cyl(0.16, 0.24, 2.6, 5,
        bx + Math.sin(a) * 0.8, 1.3, bz + Math.cos(a) * 0.8, {
          rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2,
          color: COL.bronze, mat: 'bronze',
        });
    }
    kit.cyl(1.5, 0.9, 0.8, 8, bx, 2.8, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.torus(1.48, 0.12, 4, 16, bx, 3.2, bz, { color: COL.bronze, mat: 'bronze', rx: Math.PI / 2 });
    kit.cyl(1.15, 1.15, 0.18, 8, bx, 3.16, bz, { color: COL.black, mat: 'glow', shade: false });
    kit.glowBlob(bx, 3.9, bz, 1.3, COL.glowEmber, 0.3);
    kit.collider(bx, bz, 1.6);
  }

  // ================================================================
  // 7. 门洞上方的长旗（悬垂进拱洞，增强"门"的仪式感）
  // ================================================================
  for (const sx of [-1, 1]) {
    kit.banner(sx * 9.0, 30, 4.4, {
      w: 2.8, h: 14, color: sx < 0 ? COL.clothBlue : COL.clothRed, rotY: 0,
    });
    kit.banner(sx * 4.2, 34, 4.6, {
      w: 2.2, h: 9, color: sx < 0 ? COL.clothRed : COL.clothBlue, rotY: 0,
    });
  }

  // ================================================================
  // 8. 装饰细节：拱券金钉、门侧巨柱、壁龛守望者、垛口金冠、拱上火盆
  // ================================================================
  // —— 前拱圈上的金色楔石钉（沿拱背一圈，强化"多层线脚"）——
  for (let i = 0; i <= 16; i++) {
    const a = 0.1 * Math.PI + (Math.PI * 0.8 * i) / 16;
    kit.box(0.55, 0.75, 0.6,
      Math.cos(a) * 24.2, SPRING_Y + Math.sin(a) * 24.2, 5.15, {
        rz: a + Math.PI / 2, color: COL.gold, mat: 'gold',
      });
  }
  // —— 门洞两侧的巨型壁柱（从台基直抵起拱线）——
  for (const sx of [-1, 1]) {
    for (const px of [19.2, 23.8]) {
      kit.column(sx * px, 5.4, { h: 25, r: 1.35, color: COL.stoneLight, mat: 'stone' });
      kit.cyl(1.7, 1.7, 0.7, 8, sx * px, 24.4, 5.4, { color: COL.gold, mat: 'gold' });
      kit.runeBand(sx * px, 12.0, 6.9, { w: 2.2, h: 0.5, color: COL.glowGold, count: 4 });
    }
  }
  // —— 拱上墙体的壁龛守望者（4 尊，站在金钉之上）——
  const putSentinel = (x, y, h) => {
    kit.box(2.4, 0.5, 1.6, x, y - 0.25, 5.3, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(h * 0.13, h * 0.2, h * 0.46, 6, x, y + h * 0.23, 5.5, { color: COL.stone, mat: 'stone' });
    kit.box(h * 0.32, h * 0.16, h * 0.22, x, y + h * 0.53, 5.5, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(h * 0.08, h * 0.085, h * 0.12, 6, x, y + h * 0.69, 5.5, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(h * 0.09, h * 0.12, 6, x, y + h * 0.78, 5.5, { color: COL.gold, mat: 'gold' });
    // 斜持的长矛
    kit.cyl(0.06, 0.08, h * 1.05, 5, x + h * 0.2, y + h * 0.44, 5.7, {
      color: COL.bronze, mat: 'bronze', rz: -0.1,
    });
  };
  for (const sx of [-1, 1]) {
    putSentinel(sx * 8.5, 44.4, 4.2);
    putSentinel(sx * 14.5, 44.4, 4.2);
  }
  // —— 双塔垛口的金色压顶（只压正面一排，性价比最高）——
  for (const sx of [-1, 1]) {
    for (let i = -2.5; i <= 2.5; i++) {
      kit.box(1.95, 0.28, 1.45, sx * TOWER_X + i * 2.9, 63.6, 8.2, { color: COL.gold, mat: 'gold' });
      kit.box(1.95, 0.28, 1.45, sx * TOWER_X + i * 2.9, 63.6, -8.2, { color: COL.goldDeep, mat: 'gold' });
    }
  }
  // —— 拱上墙两侧的火盆（门前的"路标"）——
  for (const sx of [-1, 1]) {
    const bx = sx * 12.0;
    const bz = 5.6;
    const by = 44.6;
    // 壁挂石托（让火盆不是悬空的）
    kit.box(3.4, 1.1, 3.6, bx, by - 0.5, 4.6, { color: COL.stoneLight, mat: 'stone' });
    kit.box(2.2, 1.6, 1.2, bx, by - 1.5, 4.9, { color: COL.stoneDark, mat: 'stone' });
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      kit.cyl(0.14, 0.2, 2.0, 5, bx + Math.sin(a) * 0.7, by + 1.0, bz + Math.cos(a) * 0.7, {
        rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2, color: COL.bronze, mat: 'bronze',
      });
    }
    kit.cyl(1.25, 0.8, 0.7, 8, bx, by + 2.3, bz, { color: COL.stoneDark, mat: 'stone' });
    kit.torus(1.2, 0.11, 4, 14, bx, by + 2.7, bz, { color: COL.bronze, mat: 'bronze', rx: Math.PI / 2 });
    kit.cyl(0.95, 0.95, 0.16, 8, bx, by + 2.66, bz, { color: COL.black, mat: 'glow', shade: false });
    kit.glowBlob(bx, by + 3.4, bz, 1.2, COL.glowEmber, 0.28);
  }

  // ================================================================
  // 9. 可行走平台 + 碰撞体（门洞可走，但走到虚空前会被挡住）
  // ================================================================
  const platforms = [];
  const plat = (x, z, hw, hd, yTop, rotY = 0) => platforms.push({
    x: x * scale, z: z * scale, hw: hw * scale, hd: hd * scale, y: yTop * scale, rotY,
  });
  // 正面大台阶（8 级）→ 门洞广场
  for (let i = 0; i < 8; i++) {
    plat(0, 22 + (i + 0.5) * 0.72, 32, 0.36, (FL / 8) * (8 - i));
  }
  plat(0, 0, 44, 22, FL);

  kit.boxCollider(0, -9.2, 17.2, 1.2, 0);   // 虚空屏障
  kit.boxCollider(-38, 21.3, 6, 0.8, 0);    // 台基前缘（台阶两侧）
  kit.boxCollider(38, 21.3, 6, 0.8, 0);
  for (const sx of [-1, 1]) {
    kit.boxCollider(sx * 44.3, 0, 0.8, 22.2, 0);   // 台基侧缘
  }
  kit.boxCollider(0, -22.3, 44, 0.8, 0);    // 台基后缘

  // ================================================================
  // 10. 组装 + 尺度烘焙
  // ================================================================
  const group = kit.build({ name: 'gate' });
  finalize(group, kit, scale, FL);
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  // 传送锚点：符文环圆心
  group.userData.beaconPoint = { x: 0, y: (RING_Y + FL) * scale, z: 0 };
  return group;
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
