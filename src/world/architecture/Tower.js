/**
 * Tower.js — 圣火灯塔 / 瞭望塔（BEACON OF THE ...）
 *
 * 模块职责：
 *   八角形多层收分石塔：每层有窗与发光符文带，一条螺旋上升的符文带缠绕塔身，
 *   顶部为垛口（opts.beacon=false）或三足青铜火盆（opts.beacon=true）。
 *   火盆内部刻意留成暗色 —— 火焰由引擎的粒子/光晕系统动态添加。
 *
 * 对外 API：
 *   buildTower(opts) -> THREE.Group
 *   meta -> { id, label, radius, height }（设计尺度 = scale 1 时）
 *
 * opts：{ scale=1, seed=1, variant=0, beacon=false }
 *   builder 内部已烘焙 scale，World 只设置 position / rotation。
 *
 * userData：
 *   userData.beaconPoint = { x, y, z }  顶部火盆/塔尖的火源锚点（已按 scale 换算）
 *   userData.colliders / boxColliders / height / radius / scaledBy / meta
 *   userData.platforms = [{x,z,hw,hd,y,rotY}]  四向台阶 + 台基顶面（可行走）
 *
 * 依赖：three / ./Kit.js / ../../render/Materials.js
 *
 * 尺度：设计高度约 60.5m；data/world.js 中 scale=1.15 → 约 69m。
 */

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { COL } from '../../render/Materials.js';

export const meta = {
  id: 'tower',
  label: '圣火灯塔',
  radius: 12.5,
  height: 60.5,
};

const FL = 1.2;                    // 台基高度
const OCT = Math.PI / 8;           // 八边形的半面心角
const COS22 = Math.cos(OCT);       // 0.9239：外接半径 → 面心距
const TOP_Y = 50;                  // 塔身砌体顶
const BEACON_Y = 56.6;             // 火盆火焰中心（设计尺度）

export function buildTower(opts = {}) {
  const { scale = 1, seed = 1, variant = 0, beacon = false } = opts;
  const kit = new Kit({ seed: seed + variant * 421 + (beacon ? 17 : 0) });

  // 三段收分的半径插值（螺旋符文带贴合塔身用）
  const rAt = (y) => {
    if (y <= 21) return 9.4 + (8.2 - 9.4) * (y / 21);
    if (y <= 38) return 7.9 + (6.9 - 7.9) * ((y - 22) / 16);
    if (y <= TOP_Y) return 6.4 + (5.6 - 6.4) * ((y - 39) / 11);
    return 5.6;
  };
  // 八角形表面上某角度处的真实半径（面心距 / cos(与面心夹角)）
  const surfaceRadius = (y, ang) => {
    const m = ((ang % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4);
    const delta = Math.min(m, Math.PI / 4 - m);
    return (rAt(y) * COS22) / Math.cos(delta);
  };
  // 在第 i 个立面上放东西：面心角 = i * 45°
  const faceAngle = (i) => (Math.PI * 2 * i) / 8;

  // ================================================================
  // 1. 台基与四向台阶
  // ================================================================
  kit.box(23, FL, 23, 0, -FL / 2, 0, { color: COL.stoneDark, mat: 'stone' });
  kit.box(23.8, 0.35, 23.8, 0, -0.18, 0, { color: COL.stoneLight, mat: 'stone' });
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    kit.stairs(Math.sin(a) * 11.5, Math.cos(a) * 11.5, {
      w: 7, steps: 4, rise: FL / 4, run: 0.6, y0: -FL, rotY: a, color: COL.stone,
    });
  }
  // 台基四角的小型石灯（远景也能看见基座的轮廓）
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (Math.PI / 2) * i;
    const px = Math.sin(a) * 10.4;
    const pz = Math.cos(a) * 10.4;
    kit.box(1.5, 2.6, 1.5, px, 1.3, pz, { color: COL.stoneLight, mat: 'stone' });
    kit.cyl(1.0, 0.7, 0.7, 6, px, 3.0, pz, { color: COL.bronze, mat: 'bronze' });
    kit.glowBlob(px, 3.5, pz, 0.9, COL.glowEmber, 0.26);
  }

  // ================================================================
  // 2. 塔身：三段八角形收分 + 层间线脚
  // ================================================================
  // 基座外撇（像一棵扎根的树）
  kit.cyl(9.4, 10.8, 3.4, 8, 0, 1.7, 0, { ry: -OCT, color: COL.stoneDark, mat: 'stone' });

  const tiers = [
    { y0: 0, h: 21, rb: 9.4, rt: 8.2 },
    { y0: 22, h: 16, rb: 7.9, rt: 6.9 },
    { y0: 39, h: 11, rb: 6.4, rt: 5.6 },
  ];
  for (const t of tiers) {
    kit.cyl(t.rt, t.rb, t.h, 8, 0, t.y0 + t.h / 2, 0, {
      ry: -OCT, color: COL.stone, mat: 'stone',
    });
    // 每层底部加一圈深色踢脚，强化"层叠"的读感
    kit.cyl(t.rb + 0.25, t.rb + 0.25, 0.55, 8, 0, t.y0 + 0.3, 0, {
      ry: -OCT, color: COL.stoneDark, mat: 'stone',
    });
  }
  // 层间挑檐线脚（三层）
  kit.cyl(9.9, 9.7, 1.0, 8, 0, 21.6, 0, { ry: -OCT, color: COL.stoneLight, mat: 'stone' });
  kit.cyl(8.3, 8.1, 0.9, 8, 0, 38.5, 0, { ry: -OCT, color: COL.stoneLight, mat: 'stone' });
  kit.cyl(6.9, 6.6, 1.2, 8, 0, 50.6, 0, { ry: -OCT, color: COL.stoneLight, mat: 'stone' });

  // ================================================================
  // 3. 竖向扶壁（四个斜向）
  // ================================================================
  for (let i = 0; i < 4; i++) {
    const a = OCT + (Math.PI / 2) * i;
    const px = Math.sin(a) * 8.6;
    const pz = Math.cos(a) * 8.6;
    kit.box(2.5, 12, 3.1, px, 6.2, pz, { color: COL.stoneLight, mat: 'stone', ry: a });
    kit.box(2.0, 8, 2.7, px * 0.88, 16.2, pz * 0.88, { color: COL.stoneLight, mat: 'stone', ry: a });
    kit.box(1.7, 5, 2.3, px * 0.74, 22.6, pz * 0.74, { color: COL.stoneLight, mat: 'stone', ry: a });
    kit.collider(px, pz, 2.0);
  }

  // ================================================================
  // 4. 八个立面的门 / 窗 / 壁龛 / 符文带
  // ================================================================
  for (let i = 0; i < 8; i++) {
    const a = faceAngle(i);
    const sa = Math.sin(a);
    const ca = Math.cos(a);

    // —— 第一层 ——
    if (i === 0) {
      // 正面拱门（朝向 +Z）
      kit.archway(sa * 8.5, ca * 8.5, {
        w: 5.2, h: 8.5, t: 1.3, depth: 1.8, rotY: a,
        color: COL.stoneLight, glow: true, glowColor: COL.glowGold,
      });
    } else {
      // 其余七面：底层发光长窗
      const rad = rAt(8) * COS22 + 0.12;
      kit.window(sa * rad, 5.5, ca * rad, {
        w: 2.0, h: 6.0, rotY: a, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
      });
    }
    // 底层壁龛（盲拱，用 window 去掉发光即可）
    const nicheRad = rAt(14) * COS22 + 0.1;
    kit.window(sa * nicheRad, 13.2, ca * nicheRad, {
      w: 1.6, h: 3.2, rotY: a, glow: false, color: COL.stone, arch: true,
    });

    // —— 第二层：发光高窗 + 金色符文带 ——
    const rad2 = rAt(28) * COS22 + 0.12;
    kit.window(sa * rad2, 24.5, ca * rad2, {
      w: 1.9, h: 7.5, rotY: a, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
    });
    // 窗上的小圆棂
    kit.torus(0.95, 0.18, 4, 12, sa * rad2, 33.0, ca * rad2, { color: COL.stoneLight, mat: 'stone', ry: a });
    // 符文带（贴在立面外侧）
    const bandRad = rAt(34.5) * COS22 + 0.14;
    kit.runeBand(sa * bandRad, 34.8, ca * bandRad, {
      w: 5.0, h: 0.7, rotY: a, color: COL.glowGold, count: 9,
    });
    // 金色盾徽
    const shieldRad = rAt(30) * COS22 + 0.2;
    kit.cyl(1.25, 1.25, 0.32, 10, sa * shieldRad, 30.0, ca * shieldRad, {
      rx: Math.PI / 2, ry: a, color: COL.gold, mat: 'gold',
    });

    // —— 第三层：钟窗 + 符文带 ——
    const rad3 = rAt(44) * COS22 + 0.12;
    kit.window(sa * rad3, 40.0, ca * rad3, {
      w: 1.8, h: 6.8, rotY: a, glow: true, glowColor: COL.glowGold, color: COL.stoneDark,
    });
    const bandRad3 = rAt(48.2) * COS22 + 0.14;
    kit.runeBand(sa * bandRad3, 48.4, ca * bandRad3, {
      w: 4.0, h: 0.6, rotY: a, color: COL.glowCyan, count: 7,
    });
  }

  // ================================================================
  // 5. 螺旋上升的发光符文带（本塔的"视觉主角"）
  //    沿塔身缠绕约 2.4 圈，半径逐层收分，像一道上升的星火。
  // ================================================================
  const SPIRAL_N = 88;
  for (let i = 0; i < SPIRAL_N; i++) {
    const t = i / (SPIRAL_N - 1);
    const y = 4.2 + t * 44.5;
    const ang = t * Math.PI * 2 * 2.4;             // 2.4 圈
    const rad = surfaceRadius(y, ang) + 0.1;
    const isCyan = i % 9 === 0;
    kit.box(0.5, 0.78, 0.12,
      Math.sin(ang) * rad, y, Math.cos(ang) * rad, {
        ry: ang, rz: ((i % 5) - 2) * 0.11,
        color: isCyan ? COL.glowCyan : COL.glowGold, mat: 'glow', shade: false,
      });
    // 每 11 枚符文补一个小的金属底座，让符文"嵌"在石面上
    if (i % 11 === 0) {
      kit.box(0.9, 1.1, 0.2,
        Math.sin(ang) * (rad - 0.08), y, Math.cos(ang) * (rad - 0.08), {
          ry: ang, color: COL.bronze, mat: 'bronze',
        });
    }
  }

  // ================================================================
  // 6. 顶部：垛口（或金属火盆）
  // ================================================================
  if (beacon) {
    // —— 三足青铜火盆 ——
    // 三条腿从塔顶斜插到火盆，形成"支架"
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      kit.cyl(0.3, 0.42, 4.2, 6, sa * 2.9, 52.4, ca * 2.9, {
        rx: -0.24, ry: a, color: COL.bronze, mat: 'bronze',
      });
      // 腿部加强翼
      kit.box(0.5, 2.6, 0.16, sa * 3.0, 51.6, ca * 3.0, { ry: a, color: COL.bronze, mat: 'bronze' });
    }
    // 石盆（上宽下窄）
    kit.cyl(3.7, 2.4, 1.5, 8, 0, 55.1, 0, { ry: -OCT, color: COL.stoneDark, mat: 'stone' });
    // 青铜盆沿
    kit.torus(3.65, 0.3, 5, 28, 0, 55.85, 0, { color: COL.bronze, mat: 'bronze', rx: Math.PI / 2 });
    kit.torus(2.9, 0.16, 4, 22, 0, 55.0, 0, { color: COL.bronze, mat: 'bronze', rx: Math.PI / 2 });
    // 盆内暗色（火焰由引擎添加）
    kit.cyl(3.2, 3.2, 0.35, 10, 0, 55.7, 0, { color: COL.black, mat: 'glow', shade: false });
    // 盆沿的金色尖饰
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI * 2 * i) / 4 + OCT;
      kit.cone(0.32, 2.2, 5, Math.sin(a) * 3.4, 57.1, Math.cos(a) * 3.4,
        { color: COL.goldBright, mat: 'gold' });
    }
    // 微弱的余烬光（真正的火由引擎加，这里只给一点点体积光）
    kit.glowBlob(0, BEACON_Y, 0, 2.4, COL.glowEmber, 0.24);
  } else {
    // —— 垛口 + 小尖顶 ——
    for (let i = 0; i < 8; i++) {
      const a = faceAngle(i);
      for (const off of [-1.9, 1.9]) {
        // 沿立面切向偏移
        const px = Math.sin(a) * (5.9 * COS22) + Math.cos(a) * off;
        const pz = Math.cos(a) * (5.9 * COS22) - Math.sin(a) * off;
        kit.box(1.7, 3.0, 1.2, px, 51.9, pz, { color: COL.stoneLight, mat: 'stone', ry: a });
        kit.box(2.0, 0.3, 1.5, px, 53.5, pz, { color: COL.stoneDark, mat: 'stone', ry: a });
      }
    }
    // 四角小尖塔
    for (let i = 0; i < 4; i++) {
      const a = OCT + (Math.PI / 2) * i;
      kit.spire(Math.sin(a) * 4.7, Math.cos(a) * 4.7, {
        h: 6.2, r: 1.5, y0: 50.9, seg: 6, tiers: 2, glowTip: false, color: COL.stoneCold,
      });
    }
    // 中央小尖顶 + 金色顶饰
    kit.spire(0, 0, {
      h: 6.4, r: 4.3, y0: 50.9, seg: 8, tiers: 2, glowTip: false, color: COL.stoneCold,
    });
    kit.box(0.5, 3.2, 0.5, 0, 58.2, 0, { color: COL.gold, mat: 'gold' });
    kit.glowBlob(0, 58.2, 0, 1.2, COL.glowGold, 0.2);
  }

  // ================================================================
  // 7. 长旗与基座火盆
  // ================================================================
  kit.banner(-2.6, 21.0, rAt(26) * COS22 + 0.9, {
    w: 1.9, h: 8.5, color: variant % 2 ? COL.clothBlue : COL.clothRed, rotY: 0,
  });
  kit.banner(2.6, 21.0, rAt(26) * COS22 + 0.9, {
    w: 1.9, h: 8.5, color: variant % 2 ? COL.clothRed : COL.clothBlue, rotY: 0,
  });
  // 门前两侧的小火盆
  for (const sx of [-1, 1]) {
    const px = sx * 6.8;
    const pz = 9.6;
    kit.cyl(0.18, 0.26, 2.2, 5, px, 1.1, pz, { color: COL.bronze, mat: 'bronze' });
    kit.cyl(1.1, 0.7, 0.6, 8, px, 2.5, pz, { color: COL.stoneDark, mat: 'stone' });
    kit.glowBlob(px, 3.1, pz, 1.0, COL.glowEmber, 0.28);
  }

  // ================================================================
  // 8. 装饰细节：挑台、望哨、基座盲拱、檐口兽头
  // ================================================================
  // —— 二层挑台：一圈石檐 + 16 个托架（让塔身有"可守"的平台感）——
  kit.cyl(8.7, 8.4, 0.7, 8, 0, 22.4, 0, { ry: -OCT, color: COL.stoneLight, mat: 'stone' });
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    kit.box(0.9, 1.4, 1.8,
      Math.sin(a) * 8.6, 21.4, Math.cos(a) * 8.6, { ry: a, color: COL.stoneDark, mat: 'stone' });
  }
  // 挑台上的四个望哨（小雕像，远处看是塔身的节奏点）
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI * 2 * i) / 4;
    const px = Math.sin(a) * 8.0;
    const pz = Math.cos(a) * 8.0;
    kit.box(1.2, 2.2, 1.2, px, 23.9, pz, { color: COL.stoneLight, mat: 'stone', ry: a });
    kit.box(0.9, 2.0, 0.9, px, 25.8, pz, { color: COL.stone, mat: 'stone', ry: a });
    kit.cyl(0.42, 0.5, 0.8, 6, px, 27.2, pz, { color: COL.stoneLight, mat: 'stone' });
    kit.cone(0.45, 0.9, 5, px, 28.0, pz, { color: COL.gold, mat: 'gold' });
  }
  // —— 基座八面：盲拱龛（两圈）+ 束带 ——
  for (let i = 0; i < 8; i++) {
    const a = faceAngle(i);
    for (const yy of [4.2, 9.0]) {
      const rad = rAt(yy) * COS22 + 0.12;
      kit.window(Math.sin(a) * rad, yy, Math.cos(a) * rad, {
        w: 1.5, h: 2.4, rotY: a, glow: false, color: COL.stoneLight, mullion: false,
      });
    }
    // 基座金色束带
    const bandRad = rAt(17.5) * COS22 + 0.14;
    kit.runeBand(Math.sin(a) * bandRad, 17.8, Math.cos(a) * bandRad, {
      w: 3.6, h: 0.5, rotY: a, color: COL.glowGold, count: 6,
    });
  }
  // —— 檐口兽头（每面两个）——
  for (let i = 0; i < 8; i++) {
    const a = faceAngle(i);
    for (const off of [-1.8, 1.8]) {
      const px = Math.sin(a) * (6.5 * COS22) + Math.cos(a) * off;
      const pz = Math.cos(a) * (6.5 * COS22) - Math.sin(a) * off;
      kit.box(1.0, 0.9, 1.8, px, 49.4, pz, { color: COL.stoneDark, mat: 'stone', ry: a });
      kit.cone(0.45, 1.2, 5, px + Math.sin(a) * 0.7, 49.4, pz + Math.cos(a) * 0.7, {
        color: COL.stoneDark, mat: 'stone', rx: Math.PI / 2, ry: a,
      });
    }
  }

  // ================================================================
  // 9. 可行走平台 + 碰撞体
  // ================================================================
  const platforms = [];
  const plat = (x, z, hw, hd, yTop, rotY = 0) => platforms.push({
    x: x * scale, z: z * scale, hw: hw * scale, hd: hd * scale, y: yTop * scale, rotY,
  });
  // 四个方向各 4 级台阶（逐级 0.3m）
  for (let f = 0; f < 4; f++) {
    const a = (Math.PI / 2) * f;
    for (let i = 0; i < 4; i++) {
      const r = 11.5 + (i + 0.5) * 0.6;
      plat(Math.sin(a) * r, Math.cos(a) * r, 3.5, 0.3, (FL / 4) * (4 - i), a);
    }
  }
  // 台基顶面（1.2m；只作为门前落脚点；台基很矮，外圈不做碰撞墙）
  plat(0, 0, 11.5, 11.5, FL);

  kit.collider(0, 0, 9.6);           // 塔身整体（略小于台基，留出环形走道）
  // 台基外缘：四个方向各留 7m 宽的台阶缺口，其余用薄墙封住，角色不会从侧面钻进台基
  for (const sx of [-1, 1]) {
    kit.boxCollider(sx * 7.25, 11.3, 3.75, 0.7, 0);
    kit.boxCollider(sx * 7.25, -11.3, 3.75, 0.7, 0);
    kit.boxCollider(11.3, sx * 7.25, 0.7, 3.75, 0);
    kit.boxCollider(-11.3, sx * 7.25, 0.7, 3.75, 0);
  }

  // ================================================================
  // 10. 组装 + 尺度烘焙
  // ================================================================
  const group = kit.build({ name: 'tower' });
  finalize(group, kit, scale, FL);
  group.userData.platforms = platforms;
  group.userData.meta = meta;
  // 火源锚点：火盆火焰中心 / 塔尖（供圣火系统与粒子使用）
  // 注意：整座塔最终被 finalize 抬升了 FL（台基高度），锚点也要一起抬
  const beaconY = beacon ? BEACON_Y : 58.2;
  group.userData.beaconPoint = { x: 0, y: (beaconY + FL) * scale, z: 0 };
  group.userData.beacon = !!beacon;
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
