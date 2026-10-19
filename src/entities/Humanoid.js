/**
 * Humanoid.js — 程序化人形角色（玩家 / NPC / 敌人共用）。
 *
 * 结构：髋 → 躯干 → 头 / 双臂（肩-肘-手）/ 双腿（髋-膝-脚）+ 斗篷 + 武器 + 盾。
 * 性能：每个身体部件内部所有小构件合并为 1 个几何体，全角色约 12 个 draw call。
 * 通过 palette 换色即可生成英灵、村民、尸鬼等不同阵营。
 */
import * as THREE from 'three';
import {
  mergeColored, CHARACTER_MATERIAL, CLOTH_MATERIAL, GLOW_MATERIAL,
} from '../core/GeomUtil.js';

const DEFAULT_PALETTE = {
  cloth: 0x2b3346,
  cloth2: 0x6e2323,
  leather: 0x4a3626,
  leatherDark: 0x2e2117,
  metal: 0x9aa0a6,
  gold: 0xc9a45c,
  goldBright: 0xf4e0a3,
  skin: 0xd8b090,
  fur: 0x6b5a44,
  cape: 0x6e2323,
  eye: 0x9fe8ff,
  blade: 0xb9c2c8,
};

function makeMesh(parts, material = CHARACTER_MATERIAL, { castShadow = true } = {}) {
  const geo = mergeColored(parts);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * @param {object} opts
 * @returns {{group:THREE.Group, joints:object, height:number}}
 */
export function createHumanoid(opts = {}) {
  const {
    palette = {},
    height = 1.85,
    cape = true,
    shield = false,
    weapon = 'sword',
    helmet = true,
    horns = false,
    bulk = 1,
    glowEyes = false,
  } = opts;
  const p = { ...DEFAULT_PALETTE, ...palette };

  const group = new THREE.Group();
  group.name = 'humanoid';

  const hips = new THREE.Group();
  hips.position.y = 0.95;
  group.add(hips);

  // ---------------------------------------------------------------- 骨盆
  const pelvis = makeMesh([
    { geo: new THREE.BoxGeometry(0.34 * bulk, 0.24, 0.27), color: p.leather, y: 0.0 },
    { geo: new THREE.BoxGeometry(0.36 * bulk, 0.07, 0.29), color: p.gold, y: 0.1 },
    { geo: new THREE.BoxGeometry(0.1, 0.09, 0.05), color: p.goldBright, y: 0.06, z: 0.15 },
    { geo: new THREE.BoxGeometry(0.1, 0.32, 0.05), color: p.leatherDark, y: -0.16, z: 0.12 },
  ]);
  hips.add(pelvis);

  // ---------------------------------------------------------------- 躯干
  const torso = new THREE.Group();
  torso.position.y = 0.12;
  hips.add(torso);

  const torsoMesh = makeMesh([
    { geo: new THREE.BoxGeometry(0.46 * bulk, 0.6, 0.3 * bulk), color: p.cloth, y: 0.32 },
    // 胸甲
    { geo: new THREE.BoxGeometry(0.4 * bulk, 0.4, 0.04), color: p.metal, y: 0.36, z: 0.16 },
    { geo: new THREE.BoxGeometry(0.44 * bulk, 0.05, 0.05), color: p.gold, y: 0.55, z: 0.16 },
    { geo: new THREE.BoxGeometry(0.06, 0.34, 0.05), color: p.gold, y: 0.36, z: 0.17 },
    // 腰带
    { geo: new THREE.BoxGeometry(0.48 * bulk, 0.1, 0.33), color: p.leatherDark, y: 0.03 },
    // 领口毛皮
    { geo: new THREE.TorusGeometry(0.19 * bulk, 0.055, 6, 12), color: p.fur, y: 0.63, rx: Math.PI / 2 },
    // 肩甲
    { geo: new THREE.BoxGeometry(0.2 * bulk, 0.14, 0.3), color: p.metal, x: 0.3 * bulk, y: 0.56 },
    { geo: new THREE.BoxGeometry(0.2 * bulk, 0.14, 0.3), color: p.metal, x: -0.3 * bulk, y: 0.56 },
    { geo: new THREE.BoxGeometry(0.21 * bulk, 0.03, 0.31), color: p.gold, x: 0.3 * bulk, y: 0.62 },
    { geo: new THREE.BoxGeometry(0.21 * bulk, 0.03, 0.31), color: p.gold, x: -0.3 * bulk, y: 0.62 },
  ]);
  torso.add(torsoMesh);

  // ---------------------------------------------------------------- 头
  const head = new THREE.Group();
  head.position.y = 0.72;
  torso.add(head);

  const headParts = [
    { geo: new THREE.CylinderGeometry(0.075, 0.085, 0.12, 8), color: p.skin, y: -0.02 },
    { geo: new THREE.BoxGeometry(0.22, 0.27, 0.23), color: p.skin, y: 0.16 },
    { geo: new THREE.BoxGeometry(0.2, 0.1, 0.1), color: p.fur, y: 0.07, z: 0.11 }, // 胡须
  ];
  if (helmet) {
    headParts.push(
      { geo: new THREE.BoxGeometry(0.25, 0.15, 0.26), color: p.metal, y: 0.27 },
      { geo: new THREE.BoxGeometry(0.26, 0.03, 0.27), color: p.gold, y: 0.35 },
      { geo: new THREE.BoxGeometry(0.035, 0.16, 0.03), color: p.gold, y: 0.26, z: 0.125 },
      { geo: new THREE.BoxGeometry(0.24, 0.03, 0.03), color: p.gold, y: 0.2, z: 0.125 },
    );
    if (horns) {
      headParts.push(
        { geo: new THREE.ConeGeometry(0.045, 0.26, 6), color: p.goldBright, x: 0.16, y: 0.38, rz: -0.6 },
        { geo: new THREE.ConeGeometry(0.045, 0.26, 6), color: p.goldBright, x: -0.16, y: 0.38, rz: 0.6 },
      );
    }
  } else {
    headParts.push(
      { geo: new THREE.BoxGeometry(0.23, 0.08, 0.24), color: p.fur, y: 0.3 },
    );
  }
  const headMesh = makeMesh(headParts);
  head.add(headMesh);

  if (glowEyes) {
    const eyeGeo = mergeColored([
      { geo: new THREE.BoxGeometry(0.035, 0.03, 0.02), color: p.eye, x: 0.06, y: 0.18, z: 0.118 },
      { geo: new THREE.BoxGeometry(0.035, 0.03, 0.02), color: p.eye, x: -0.06, y: 0.18, z: 0.118 },
    ]);
    const eyes = new THREE.Mesh(eyeGeo, GLOW_MATERIAL);
    head.add(eyes);
  }

  // ---------------------------------------------------------------- 手臂
  function buildArm(side) {
    const sx = side * 0.34 * bulk;
    const shoulder = new THREE.Group();
    shoulder.position.set(sx, 0.54, 0);
    torso.add(shoulder);

    const upper = makeMesh([
      { geo: new THREE.CylinderGeometry(0.075, 0.065, 0.34, 7), color: p.cloth, y: -0.17 },
      { geo: new THREE.CylinderGeometry(0.08, 0.08, 0.06, 7), color: p.gold, y: -0.02 },
    ]);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    shoulder.add(elbow);

    const lowerParts = [
      { geo: new THREE.CylinderGeometry(0.062, 0.055, 0.3, 7), color: p.leather, y: -0.15 },
      { geo: new THREE.BoxGeometry(0.1, 0.08, 0.1), color: p.skin, y: -0.32 },
      { geo: new THREE.CylinderGeometry(0.075, 0.07, 0.12, 7), color: p.metal, y: -0.08 },
    ];
    if (side < 0 && shield) {
      lowerParts.push(
        { geo: new THREE.CylinderGeometry(0.36, 0.36, 0.05, 14), color: p.wood || 0x6a4b30, y: -0.2, x: -0.14, rz: Math.PI / 2 },
        { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10), color: p.gold, y: -0.2, x: -0.17, rz: Math.PI / 2 },
      );
    }
    const lower = makeMesh(lowerParts);
    elbow.add(lower);

    const hand = new THREE.Group();
    hand.position.y = -0.36;
    elbow.add(hand);

    return { shoulder, elbow, lower, hand };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  // ---------------------------------------------------------------- 腿
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.15 * bulk, -0.03, 0);
    hips.add(hip);

    const thigh = makeMesh([
      { geo: new THREE.CylinderGeometry(0.095, 0.08, 0.44, 7), color: p.cloth, y: -0.22 },
      { geo: new THREE.BoxGeometry(0.15, 0.18, 0.06), color: p.metal, y: -0.16, z: 0.08 },
    ]);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);

    const shin = makeMesh([
      { geo: new THREE.CylinderGeometry(0.075, 0.06, 0.42, 7), color: p.leather, y: -0.21 },
      { geo: new THREE.BoxGeometry(0.16, 0.1, 0.28), color: p.leatherDark, y: -0.45, z: 0.05 },
      { geo: new THREE.BoxGeometry(0.17, 0.04, 0.29), color: p.gold, y: -0.4, z: 0.05 },
    ]);
    knee.add(shin);
    return { hip, knee, shin };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // ---------------------------------------------------------------- 斗篷
  let capeObj = null;
  if (cape) {
    const capePivot = new THREE.Group();
    capePivot.position.set(0, 0.6, -0.15);
    torso.add(capePivot);
    const segs = [];
    for (let i = 0; i < 4; i++) {
      const w = 0.52 + i * 0.05;
      segs.push({
        geo: new THREE.BoxGeometry(w, 0.3, 0.035),
        color: i === 3 ? p.gold : p.cape,
        y: -0.15 - i * 0.29,
        z: -i * 0.045,
        rx: 0.06 + i * 0.035,
      });
    }
    const capeMesh = makeMesh(segs, CLOTH_MATERIAL, { castShadow: false });
    capePivot.add(capeMesh);
    capeObj = capePivot;
  }

  // ---------------------------------------------------------------- 武器
  let weaponObj = null;
  if (weapon === 'sword') {
    const parts = [
      { geo: new THREE.BoxGeometry(0.055, 0.92, 0.018), color: p.blade, y: -0.55 },
      { geo: new THREE.BoxGeometry(0.06, 0.1, 0.02), color: p.goldBright, y: -0.05 },
      { geo: new THREE.BoxGeometry(0.24, 0.045, 0.055), color: p.gold, y: -0.02 },
      { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), color: p.leatherDark, y: 0.07 },
      { geo: new THREE.IcosahedronGeometry(0.05, 1), color: p.goldBright, y: 0.16 },
    ];
    weaponObj = makeMesh(parts, CHARACTER_MATERIAL, { castShadow: true });
    weaponObj.position.set(0, -0.36, 0.02);
    weaponObj.rotation.x = 0.15;
    armR.hand.add(weaponObj);
  } else if (weapon === 'axe') {
    const parts = [
      { geo: new THREE.CylinderGeometry(0.04, 0.045, 1.0, 6), color: p.leatherDark, y: -0.4 },
      { geo: new THREE.BoxGeometry(0.34, 0.26, 0.06), color: p.metal, y: 0.06, x: 0.15 },
      { geo: new THREE.BoxGeometry(0.06, 0.3, 0.08), color: p.gold, y: 0.06, x: 0.0 },
    ];
    weaponObj = makeMesh(parts, CHARACTER_MATERIAL, { castShadow: true });
    weaponObj.position.set(0, -0.36, 0.02);
    weaponObj.rotation.x = 0.2;
    armR.hand.add(weaponObj);
  } else if (weapon === 'staff') {
    const parts = [
      { geo: new THREE.CylinderGeometry(0.03, 0.035, 1.6, 6), color: p.leatherDark, y: 0 },
      { geo: new THREE.IcosahedronGeometry(0.1, 1), color: p.eye, y: 0.86 },
    ];
    weaponObj = makeMesh(parts, CHARACTER_MATERIAL);
    weaponObj.position.set(0.1, -0.4, 0.1);
    armR.hand.add(weaponObj);
  }

  // ---- 按目标身高统一缩放 ----
  const bbox = new THREE.Box3().setFromObject(group);
  const raw = Math.max(0.01, bbox.max.y - bbox.min.y);
  const k = height / raw;
  group.scale.setScalar(k);
  // 让脚底贴合 y=0
  group.position.y = -bbox.min.y * k;

  return {
    group,
    height,
    palette: p,
    joints: {
      hips, torso, head,
      shoulderL: armL.shoulder, shoulderR: armR.shoulder,
      elbowL: armL.elbow, elbowR: armR.elbow,
      handL: armL.hand, handR: armR.hand,
      hipL: legL.hip, hipR: legR.hip,
      kneeL: legL.knee, kneeR: legR.knee,
      cape: capeObj,
      weapon: weaponObj,
    },
  };
}
