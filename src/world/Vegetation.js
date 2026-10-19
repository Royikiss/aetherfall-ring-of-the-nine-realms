/**
 * Vegetation.js — 植被与散石（InstancedMesh，全部世界共用 4 个 draw call）。
 *
 * 设计：
 *  - 每种植物烘焙成"顶点色几何体"，实例只带变换与颜色，材质共享；
 *  - 布局由确定性随机 + 地形规则决定：避开水面、陡坡、地标；
 *  - 不同区域有不同植被密度（北境枯木、东境雪松、谷地灌木）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COL } from '../render/Materials.js';
import { WORLD, LANDMARKS } from '../data/world.js';
import { Rng } from '../core/Rng.js';

/** 将几何体烘焙为带顶点色的非索引几何体（与 Kit 的合并策略一致） */
function bake(geometry, colorHex, jitter = 0.06) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of ['uv', 'uv1', 'uv2', 'normal']) {
    if (g.getAttribute(name) && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const base = new THREE.Color(colorHex);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const tint = 1 + (Math.random() * 2 - 1) * jitter;
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = base.r * tint;
    colors[i * 3 + 1] = base.g * tint;
    colors[i * 3 + 2] = base.b * tint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function mergeBaked(parts, color, jitter) {
  const geos = parts.map((p) => {
    const g = p.geo;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)),
      new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1),
    );
    g.applyMatrix4(m);
    return bake(g, p.color ?? color, jitter);
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function makePineGeometry() {
  const parts = [
    { geo: new THREE.CylinderGeometry(0.14, 0.32, 3.4, 5), y: 1.7, color: 0x3a2b1e },
    { geo: new THREE.ConeGeometry(1.95, 2.7, 8), y: 4.1, color: 0x263b28 },
    { geo: new THREE.ConeGeometry(1.7, 2.5, 8), y: 5.4, color: 0x2b422c },
    { geo: new THREE.ConeGeometry(1.42, 2.3, 8), y: 6.7, color: 0x304a30 },
    { geo: new THREE.ConeGeometry(1.12, 2.1, 8), y: 7.9, color: 0x355234 },
    { geo: new THREE.ConeGeometry(0.82, 1.9, 7), y: 9.0, color: 0x3a5a38 },
    { geo: new THREE.ConeGeometry(0.5, 1.6, 6), y: 10.0, color: 0x40603c },
  ];
  return mergeBaked(parts, 0x2f4529, 0.1);
}

function makeDeadTreeGeometry() {
  const parts = [
    { geo: new THREE.CylinderGeometry(0.12, 0.38, 4.6, 5), y: 2.3, color: 0x342a20 },
    { geo: new THREE.BoxGeometry(0.18, 2.8, 0.18), x: 0.9, y: 4.2, rz: -0.9, color: 0x3a2e22 },
    { geo: new THREE.BoxGeometry(0.16, 2.2, 0.16), x: -0.8, y: 4.6, rz: 1.0, color: 0x352a20 },
    { geo: new THREE.BoxGeometry(0.14, 1.8, 0.14), x: 1.5, y: 3.4, rz: -1.25, color: 0x322820 },
    { geo: new THREE.BoxGeometry(0.12, 1.5, 0.12), x: -0.2, y: 5.8, rz: 0.35, color: 0x382c21 },
  ];
  return mergeBaked(parts, 0x352a20, 0.08);
}

function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  // 扰动顶点，避免正球感
  for (let i = 0; i < pos.count; i++) {
    const s = 0.72 + Math.random() * 0.5;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.72, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return bake(geo, 0x6a675f, 0.1);
}

function makeShrubGeometry() {
  const parts = [
    { geo: new THREE.ConeGeometry(0.55, 0.9, 5), y: 0.45, color: 0x4a5a34 },
    { geo: new THREE.ConeGeometry(0.42, 0.8, 5), x: 0.4, y: 0.4, color: 0x556738 },
    { geo: new THREE.ConeGeometry(0.38, 0.7, 5), x: -0.35, y: 0.35, z: 0.2, color: 0x40502e },
  ];
  return mergeBaked(parts, 0x4a5a34, 0.12);
}

export class Vegetation {
  constructor(terrain, { seed = WORLD.seed, quality = 'high' } = {}) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.seed = seed;
    this.quality = quality;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.meshes = [];
    this._exclusions = LANDMARKS.map((l) => ({
      x: l.x, z: l.z, r: (l.flatten || 30) + 12,
    }));
  }

  /** 是否适合生长 */
  _valid(x, z) {
    const h = this.terrain.sampleHeight(x, z);
    if (h < WORLD.waterLevel + 0.8) return false;
    if (h > 120) return false;
    for (const ex of this._exclusions) {
      const dx = x - ex.x;
      const dz = z - ex.z;
      if (dx * dx + dz * dz < ex.r * ex.r) return false;
    }
    const slope = this.terrain.sampleSlope(x, z);
    if (slope > 0.42) return false;
    return true;
  }

  _scatter(count, geometry, material, opts = {}) {
    const {
      minH = 0, maxH = 200, scaleRange = [0.8, 1.3], colorFn = null,
      slopeMax = 1, regionFn = null, radius = 1180,
    } = opts;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = opts.name || 'instances';
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;
    let guard = count * 40;

    while (placed < count && guard-- > 0) {
      const angle = this.rng.next() * Math.PI * 2;
      const dist = Math.sqrt(this.rng.next()) * radius;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const h = this.terrain.sampleHeight(x, z);
      if (!this._valid(x, z)) continue;
      if (h < minH || h > maxH) continue;
      if (this.terrain.sampleSlope(x, z) > slopeMax) continue;
      if (regionFn && !regionFn(x, z, h)) continue;

      const s = scaleRange[0] + this.rng.next() * (scaleRange[1] - scaleRange[0]);
      dummy.position.set(x, h - 0.12, z);
      dummy.rotation.set(0, this.rng.next() * Math.PI * 2, 0);
      dummy.scale.set(s * (0.9 + this.rng.next() * 0.2), s, s * (0.9 + this.rng.next() * 0.2));
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      if (colorFn) {
        colorFn(color, x, z, h, this.rng);
        mesh.setColorAt(placed, color);
      }
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  build(quality = this.quality) {
    const q = quality === 'low' ? 0.45 : quality === 'medium' ? 0.72 : 1;
    const vegMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.0,
    });
    const rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.98, metalness: 0.02,
    });

    const pine = makePineGeometry();
    const dead = makeDeadTreeGeometry();
    const rock = makeRockGeometry();
    const shrub = makeShrubGeometry();

    // 雪松 / 黑松：中南部谷地与山脚
    this._scatter(Math.round(2200 * q), pine, vegMat, {
      name: 'pines', minH: 4, maxH: 96, scaleRange: [0.75, 1.5], slopeMax: 0.4,
      regionFn: (x, z, h) => {
        // 北境与东境少一些，中心谷地多一些
        const north = z < -520 ? 0.45 : 1;
        const east = x > 520 ? 0.3 : 1;
        return this.rng.next() < north * east * (h > 40 ? 0.5 : 1);
      },
      colorFn: (c, x, z, h) => {
        const snowH = THREE.MathUtils.smoothstep(h, 52, 92);
        const north = THREE.MathUtils.smoothstep(-z, 360, 780);
        const east = THREE.MathUtils.smoothstep(x, 420, 820);
        const frost = Math.max(snowH, Math.max(north, east) * 0.85);
        c.setRGB(1, 1, 1);
        c.lerp(_snowTint, frost * 0.62);
      },
    });

    // 枯树：北部与西部更常见
    this._scatter(Math.round(1050 * q), dead, vegMat, {
      name: 'deadTrees', minH: 2, maxH: 110, scaleRange: [0.8, 1.6], slopeMax: 0.55,
      regionFn: (x, z) => this.rng.next() < (z < -200 || x < -300 ? 1 : 0.35),
    });

    // 散石
    this._scatter(Math.round(1050 * q), rock, rockMat, {
      name: 'rocks', minH: -6, maxH: 200, scaleRange: [0.5, 2.4], slopeMax: 0.9,
      castShadow: true,
      colorFn: (c, x, z, h) => {
        c.setRGB(1, 1, 1);
        const snowH = THREE.MathUtils.smoothstep(h, 70, 120);
        const north = THREE.MathUtils.smoothstep(-z, 420, 820);
        c.lerp(_snowTint, Math.max(snowH, north * 0.6) * 0.55);
      },
    });

    // 灌木与草丛
    this._scatter(Math.round(3300 * q), shrub, vegMat, {
      name: 'shrubs', minH: 1, maxH: 74, scaleRange: [0.6, 1.5], slopeMax: 0.4,
      castShadow: false,
    });

    // 几何体由 InstancedMesh 持有，不能释放
    return this.group;
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes.length = 0;
  }
}

const _snowTint = new THREE.Color(0xbfd2da);
