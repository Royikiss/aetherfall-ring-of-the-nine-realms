/**
 * Kit.js — 建筑几何构建套件（整套美术语言的基石）。
 *
 * 目标：
 *  - 用最少的代码拼出哥特/北欧混合风格的宏大建筑；
 *  - 同一建筑内所有部件按材质合并（每种材质 1 个 draw call），保证性能；
 *  - 顶点色 + 垂直明暗烘焙，产生"手工雕刻"的厚重感；
 *  - 所有坐标使用「以建筑原点为中心」的局部坐标，由 World 负责摆放。
 *
 * 依赖：three、BufferGeometryUtils、render/Materials.js
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COL, MATERIALS } from '../../render/Materials.js';

const _v3 = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();

/** 归一化几何体：非索引化、只保留 position/normal/color，并写入顶点色 */
function normalizeGeometry(geometry, colorHex, shade = true, jitter = 0.06) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  // 统一属性集合，保证 mergeGeometries 不失败
  for (const name of ['uv', 'uv1', 'uv2', 'tangent', 'skinIndex', 'skinWeight', 'color']) {
    if (g.getAttribute(name)) g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();

  g.computeBoundingBox();
  const bb = g.boundingBox;
  const minY = bb.min.y;
  const spanY = Math.max(0.0001, bb.max.y - minY);
  const base = new THREE.Color(colorHex);
  const pos = g.getAttribute('position');
  const count = pos.count;
  const colors = new Float32Array(count * 3);

  // 每个部件一个整体明暗抖动，避免"塑料感"
  const partTint = 1 + (Math.random() * 2 - 1) * jitter;

  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    // 垂直渐变：底部压暗（模拟环境光遮蔽），顶部略亮
    const t = (y - minY) / spanY;
    const shadeF = shade ? 0.78 + 0.3 * Math.pow(t, 0.72) : 1;
    colors[i * 3] = base.r * shadeF * partTint;
    colors[i * 3 + 1] = base.g * shadeF * partTint;
    colors[i * 3 + 2] = base.b * shadeF * partTint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g;
}

export class Kit {
  /**
   * @param {{seed?:number}} opts
   */
  constructor({ seed = 1 } = {}) {
    /** @type {Map<string, THREE.BufferGeometry[]>} */
    this._bucket = new Map();
    this._seed = seed;
    this._rngState = seed >>> 0 || 1;
    /** 圆形碰撞体 [{x,z,r}] */
    this.colliders = [];
    /** 矩形碰撞体 [{x,z,hw,hd,rotY}] */
    this.boxColliders = [];
    /** 需要额外挂到组上的对象（粒子、灯、动画体） */
    this.extras = [];
    this.triangles = 0;
    this.partCount = 0;
  }

  // ---------------------------------------------------------------- 随机数
  _rand() {
    let t = (this._rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  rand(a = 0, b = 1) { return a + this._rand() * (b - a); }
  randInt(a, b) { return Math.floor(this.rand(a, b + 1)); }
  chance(p) { return this._rand() < p; }

  // ---------------------------------------------------------------- 底层
  /**
   * 放置一个几何体。
   * @param {THREE.BufferGeometry} geometry 未变换的几何体
   * @param {object} o { x,y,z, rx,ry,rz, sx,sy,sz, color, mat, shade, jitter, matrix }
   */
  _place(geometry, o = {}) {
    const {
      x = 0, y = 0, z = 0,
      rx = 0, ry = 0, rz = 0,
      sx = 1, sy = 1, sz = 1,
      color = COL.stone,
      mat = 'stone',
      shade = true,
      jitter = 0.055,
    } = o;

    _euler.set(rx, ry, rz, 'YXZ');
    _quat.setFromEuler(_euler);
    _mat4.compose(_v3.set(x, y, z), _quat, new THREE.Vector3(sx, sy, sz));

    return this._placeMatrix(geometry, _mat4, color, mat, shade, jitter);
  }

  /**
   * 直接用矩阵放置（供复杂旋转的构件使用）。
   */
  _placeMatrix(geometry, matrix, color, mat = 'stone', shade = true, jitter = 0.055) {
    const g = normalizeGeometry(geometry, color, shade, jitter);
    g.applyMatrix4(matrix);
    geometry.dispose && geometry.dispose();

    let list = this._bucket.get(mat);
    if (!list) { list = []; this._bucket.set(mat, list); }
    list.push(g);
    this.partCount++;
    this.triangles += g.getAttribute('position').count / 3;
    return g;
  }

  /** 组合矩阵：T(px,py,pz) * Ry(yaw) * localTRS */
  _localMatrix(px, py, pz, yaw, lx, ly, lz, rx = 0, ry = 0, rz = 0) {
    const root = new THREE.Matrix4().makeRotationY(yaw);
    root.setPosition(px, py, pz);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(lx, ly, lz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    return root.multiply(local);
  }

  // ---------------------------------------------------------------- 基础体
  /** 长方体 */
  box(w, h, d, x = 0, y = 0, z = 0, o = {}) {
    return this._place(new THREE.BoxGeometry(w, h, d, o.segX || 1, o.segY || 1, o.segZ || 1), { ...o, x, y, z });
  }

  /** 圆柱 / 截锥 */
  cyl(rt, rb, h, seg, x = 0, y = 0, z = 0, o = {}) {
    return this._place(new THREE.CylinderGeometry(rt, rb, h, seg, o.hSeg || 1, o.open || false), { ...o, x, y, z });
  }

  /** 圆锥 */
  cone(r, h, seg, x = 0, y = 0, z = 0, o = {}) {
    return this._place(new THREE.ConeGeometry(r, h, seg, o.hSeg || 1), { ...o, x, y, z });
  }

  /** 球 */
  sphere(r, seg, x = 0, y = 0, z = 0, o = {}) {
    return this._place(new THREE.IcosahedronGeometry(r, Math.max(1, Math.round(Math.log2(seg || 8)))) , { ...o, x, y, z });
  }

  /** 圆环（符文环、光环） */
  torus(r, tube, radialSeg, tubularSeg, x = 0, y = 0, z = 0, o = {}) {
    return this._place(new THREE.TorusGeometry(r, tube, radialSeg || 8, tubularSeg || 32), { ...o, x, y, z });
  }

  /** 任意几何体 */
  geo(geometry, o = {}) {
    return this._place(geometry, o);
  }

  /**
   * 高级用法：用矩阵直接放置自定义几何体（供需要复杂旋转/变形的构件使用）。
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Matrix4} matrix
   * @param {number|string} color
   * @param {string} mat 材质键
   * @param {boolean} shade 是否烘焙垂直明暗
   */
  place(geometry, matrix, color = COL.stone, mat = 'stone', shade = true) {
    return this._placeMatrix(geometry, matrix, color, mat, shade);
  }

  // ---------------------------------------------------------------- 建筑构件
  /** 立柱：柱础 + 柱身 + 柱头 */
  column(x, z, o = {}) {
    const {
      h = 8, r = 0.55, color = COL.stone, mat = 'stone',
      rotY = 0, cap = true, base = true, y0 = 0, seg = 10,
    } = o;
    if (base) {
      this._place(new THREE.BoxGeometry(r * 2.9, h * 0.055, r * 2.9), { x, y: y0 + h * 0.0275, z, ry: rotY, color: COL.stoneDark, mat });
    }
    this._place(new THREE.CylinderGeometry(r * 0.86, r, h * 0.88, seg, 1), { x, y: y0 + h * 0.06 + h * 0.44, z, ry: rotY, color, mat });
    if (cap) {
      this._place(new THREE.BoxGeometry(r * 2.7, h * 0.06, r * 2.7), { x, y: y0 + h * 0.94, z, ry: rotY, color: COL.stoneLight, mat });
      this._place(new THREE.BoxGeometry(r * 3.1, h * 0.035, r * 3.1), { x, y: y0 + h * 0.985, z, ry: rotY, color: COL.stoneDark, mat });
    }
  }

  /**
   * 半圆拱门：双柱 + 楔形拱石。
   * 局部坐标系：门洞沿 X 轴展开，厚度沿 Z。
   */
  archway(x, z, o = {}) {
    const {
      w = 6, h = 9, t = 1.2, depth = 1.4, color = COL.stone, mat = 'stone',
      rotY = 0, y0 = 0, spandrel = true, glow = false, glowColor = COL.glowGold,
    } = o;
    const half = w / 2;
    const springY = Math.max(half * 0.9, h - half); // 起拱线高度
    const put = (lx, ly, lz, geo, opts = {}) => {
      const m = this._localMatrix(x, y0, z, rotY, lx, ly, lz, opts.rx || 0, opts.ry || 0, opts.rz || 0);
      return this._placeMatrix(geo, m, opts.color || color, opts.mat || mat, opts.shade !== false);
    };

    // 两侧门柱
    put(-(half + t / 2), springY / 2, 0, new THREE.BoxGeometry(t, springY, depth), { color: COL.stoneDark });
    put(half + t / 2, springY / 2, 0, new THREE.BoxGeometry(t, springY, depth), { color: COL.stoneDark });
    // 柱脚线脚
    put(-(half + t / 2), 0.25, 0, new THREE.BoxGeometry(t * 1.35, 0.5, depth * 1.1));
    put(half + t / 2, 0.25, 0, new THREE.BoxGeometry(t * 1.35, 0.5, depth * 1.1));

    // 楔形拱石
    const blocks = Math.max(9, Math.round((Math.PI * half) / 0.7));
    const blockLen = (Math.PI * half) / blocks * 1.12;
    for (let i = 0; i < blocks; i++) {
      const a = (Math.PI * i) / (blocks - 1);
      const lx = Math.cos(a) * half;
      const ly = springY + Math.sin(a) * half;
      put(lx, ly, 0, new THREE.BoxGeometry(blockLen, t, depth), {
        rz: a + Math.PI / 2,
        color: i % 2 === 0 ? color : COL.stoneLight,
      });
    }

    // 拱肩填充
    if (spandrel) {
      const sw = Math.max(0.0001, w * 0.16);
      put(-(half + t + sw / 2), springY + half * 0.78, 0, new THREE.BoxGeometry(sw, t * 1.6, depth * 0.96));
      put(half + t + sw / 2, springY + half * 0.78, 0, new THREE.BoxGeometry(sw, t * 1.6, depth * 0.96));
    }
    // 拱心石
    put(0, springY + half + t * 0.34, 0, new THREE.BoxGeometry(t * 0.9, t * 1.5, depth * 1.08), { color: COL.gold, mat: 'gold' });

    if (glow) {
      put(0, springY, depth * 0.35, new THREE.BoxGeometry(w * 0.96, half * 1.6, 0.06), {
        color: glowColor, mat: 'glow', shade: false,
      });
    }
  }

  /** 窗户（含发光窗芯） */
  window(x, y, z, o = {}) {
    const {
      w = 1.4, h = 3.4, color = COL.stoneDark, mat = 'stone',
      rotY = 0, glow = true, glowColor = COL.glowGold, arch = true, depth = 0.24, mullion = true,
    } = o;
    const put = (lx, ly, lz, geo, opts = {}) => {
      const m = this._localMatrix(x, 0, z, rotY, lx, ly, lz, opts.rx || 0, opts.ry || 0, opts.rz || 0);
      return this._placeMatrix(geo, m, opts.color || color, opts.mat || mat, opts.shade !== false);
    };
    const fw = w + 0.3;
    // 侧框
    put(-w / 2 - 0.15, y + h / 2, 0, new THREE.BoxGeometry(0.3, h, depth));
    put(w / 2 + 0.15, y + h / 2, 0, new THREE.BoxGeometry(0.3, h, depth));
    // 底框
    put(0, y, 0, new THREE.BoxGeometry(fw, 0.26, depth * 1.25), { color: COL.stoneLight });
    if (arch) {
      // 半圆窗顶
      const blocks = 7;
      for (let i = 0; i < blocks; i++) {
        const a = (Math.PI * i) / (blocks - 1);
        put(Math.cos(a) * (w / 2), y + h + Math.sin(a) * (w / 2), 0,
          new THREE.BoxGeometry((Math.PI * (w / 2)) / blocks * 1.25, 0.3, depth), { rz: a + Math.PI / 2 });
      }
    } else {
      put(0, y + h, 0, new THREE.BoxGeometry(fw, 0.3, depth), { color: COL.stoneLight });
    }
    if (mullion) {
      put(0, y + h / 2, 0, new THREE.BoxGeometry(0.14, h, depth * 1.1), { color: COL.iron, mat: 'iron' });
    }
    if (glow) {
      const gh = arch ? h + w * 0.4 : h;
      const gm = this._localMatrix(x, 0, z, rotY, 0, y + gh / 2, -0.06);
      this._placeMatrix(new THREE.PlaneGeometry(w * 0.94, gh), gm, glowColor, 'glow', false);
    }
  }

  /** 台阶 */
  stairs(x, z, o = {}) {
    const {
      w = 6, steps = 8, rise = 0.32, run = 0.52, color = COL.stone, mat = 'stone', rotY = 0, y0 = 0,
    } = o;
    for (let i = 0; i < steps; i++) {
      const hh = rise * (steps - i);
      const m = this._localMatrix(x, y0, z, rotY, 0, hh / 2, i * run);
      this._placeMatrix(new THREE.BoxGeometry(w, hh, run), m,
        i % 2 ? color : COL.stoneLight, mat, true);
    }
  }

  /** 人字形屋顶（两块倾斜石板 + 屋脊） */
  roofGable(x, z, o = {}) {
    const {
      w = 12, d = 20, h = 6, color = COL.woodDark, mat = 'wood',
      rotY = 0, y0 = 0, thickness = 0.4, overhang = 0.8,
    } = o;
    const halfW = w / 2;
    const angle = Math.atan2(h, halfW);
    const slabLen = Math.hypot(halfW, h) + overhang;
    const put = (lx, ly, lz, geo, opts = {}) => {
      const m = this._localMatrix(x, y0, z, rotY, lx, ly, lz, opts.rx || 0, opts.ry || 0, opts.rz || 0);
      return this._placeMatrix(geo, m, opts.color || color, opts.mat || mat, opts.shade !== false);
    };
    put(halfW / 2, h / 2, 0, new THREE.BoxGeometry(slabLen, thickness, d + overhang * 2), { rz: -angle, color });
    put(-halfW / 2, h / 2, 0, new THREE.BoxGeometry(slabLen, thickness, d + overhang * 2), { rz: angle, color });
    // 屋脊
    put(0, h + thickness * 0.4, 0, new THREE.BoxGeometry(0.5, 0.35, d + overhang * 2), { color: COL.goldDeep, mat: 'bronze' });
  }

  /** 尖塔（多层收分 + 发光尖顶） */
  spire(x, z, o = {}) {
    const {
      h = 14, r = 3, color = COL.stoneCold, mat = 'stone',
      rotY = 0, y0 = 0, seg = 8, tiers = 3, glowTip = true, glowColor = COL.glowGold,
    } = o;
    let curY = y0;
    let curR = r;
    for (let i = 0; i < tiers; i++) {
      const th = (h / tiers) * (1 + i * 0.06);
      this._place(new THREE.ConeGeometry(curR, th, seg, 1), {
        x, y: curY + th / 2, z, ry: rotY, color: i === tiers - 1 ? color : (i % 2 ? COL.stoneDark : color), mat,
      });
      curY += th * 0.86;
      curR *= 0.62;
    }
    // 塔尖金球与光晕
    this._place(new THREE.IcosahedronGeometry(Math.max(0.22, curR * 0.5), 1), {
      x, y: curY + 0.2, z, color: COL.goldBright, mat: 'gold', shade: false,
    });
    if (glowTip) {
      const s = Math.max(1.6, r * 0.9);
      this._place(new THREE.SphereGeometry(s, 10, 8), {
        x, y: curY + 0.2, z, color: glowColor, mat: 'haze', shade: false,
      });
    }
  }

  /** 悬挂旗帜 */
  banner(x, y, z, o = {}) {
    const {
      w = 1.2, h = 4, color = COL.clothRed, mat = 'cloth', rotY = 0,
      poleColor = COL.woodDark, emblem = true, emblemColor = COL.goldBright, side = 'single',
    } = o;
    // 横杆
    this._place(new THREE.CylinderGeometry(0.07, 0.07, side === 'double' ? w * 2.2 : w * 1.25, 6), {
      x, y: y + h, z, rz: Math.PI / 2, ry: rotY, color: poleColor, mat: 'wood',
    });
    // 旗面（略微前倾，像被风掀起）
    this._place(new THREE.PlaneGeometry(w, h), {
      x, y: y + h / 2, z: z + 0.03, ry: rotY, rx: -0.06, color, mat, shade: true,
    });
    if (emblem) {
      this._place(new THREE.IcosahedronGeometry(w * 0.16, 1), {
        x: x + Math.sin(rotY + Math.PI / 2) * 0.02, y: y + h * 0.62, z: z + Math.cos(rotY) * 0.06,
        ry: rotY, color: emblemColor, mat: 'glow', shade: false,
      });
    }
  }

  /** 发光符文带（北欧神秘感的关键） */
  runeBand(x, y, z, o = {}) {
    const {
      w = 5, h = 0.6, rotY = 0, color = COL.glowGold, mat = 'glow', count = 0, seed = 0,
    } = o;
    const n = count || Math.max(4, Math.round(w / 0.6));
    const step = w / n;
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + step * i + step / 2;
      const rw = step * this.rand(0.18, 0.42);
      const rh = h * this.rand(0.55, 1);
      const tilt = this.chance(0.3) ? this.rand(-0.5, 0.5) : 0;
      this._place(new THREE.BoxGeometry(rw, rh, 0.05), {
        x: x + Math.cos(rotY) * lx, y: y + this.rand(-h * 0.12, h * 0.12), z: z - Math.sin(rotY) * lx,
        ry: rotY, rz: tilt, color, mat, shade: false,
      });
    }
  }

  /** 墙体（给定两点，自动计算角度） */
  wall(x1, z1, x2, z2, o = {}) {
    const { h = 4, t = 0.6, color = COL.stone, mat = 'stone', y0 = 0 } = o;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const rotY = Math.atan2(-dz, dx);
    this._place(new THREE.BoxGeometry(len, h, t), {
      x: (x1 + x2) / 2, y: y0 + h / 2, z: (z1 + z2) / 2, ry: rotY, color, mat,
    });
  }

  /** 加法光晕球（廉价体积光，不产生 draw call 以外的开销） */
  glowBlob(x, y, z, r, color = COL.glowGold, opacity = 0.28) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const m = this._localMatrix(x, 0, z, 0, 0, y, 0);
    const normalized = normalizeGeometry(g, color, false, 0);
    normalized.applyMatrix4(m);
    // 光晕使用独立的半透明材质，单独合批
    let list = this._bucket.get('haze');
    if (!list) { list = []; this._bucket.set('haze', list); }
    list.push(normalized);
    this.partCount++;
  }

  // ---------------------------------------------------------------- 碰撞
  /** 注册圆形碰撞体（世界坐标） */
  collider(x, z, r) { this.colliders.push({ x, z, r }); return this; }
  /** 注册矩形碰撞体（世界坐标，rotY 为绕 Y 旋转） */
  boxCollider(x, z, hw, hd, rotY = 0) { this.boxColliders.push({ x, z, hw, hd, rotY }); return this; }

  /** 环形排列回调（柱廊、符文石阵） */
  ringOf(count, radius, fn, startAngle = 0, cx = 0, cz = 0) {
    for (let i = 0; i < count; i++) {
      const a = startAngle + (Math.PI * 2 * i) / count;
      fn(i, a, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius);
    }
  }

  // ---------------------------------------------------------------- 组装
  /**
   * 合并所有部件，返回 THREE.Group。
   * @param {{name?:string, castShadow?:boolean, receiveShadow?:boolean}} opts
   */
  build(opts = {}) {
    const { name = 'structure', castShadow = true, receiveShadow = true } = opts;
    const group = new THREE.Group();
    group.name = name;

    for (const [matKey, geos] of this._bucket) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      if (!merged) {
        console.warn('[Kit] mergeGeometries failed for', matKey);
        continue;
      }
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const material = MATERIALS[matKey] || MATERIALS.stone;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}:${matKey}`;
      mesh.castShadow = castShadow && matKey !== 'glow' && matKey !== 'haze' && matKey !== 'glass';
      mesh.receiveShadow = receiveShadow && matKey !== 'glow' && matKey !== 'haze';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      for (const g of geos) g.dispose();
    }

    for (const extra of this.extras) group.add(extra);

    // 包围盒（用于 LOD / 视锥裁剪）
    const box = new THREE.Box3().setFromObject(group);
    group.userData.bounds = box;
    group.userData.colliders = this.colliders;
    group.userData.boxColliders = this.boxColliders;
    group.userData.triangles = Math.round(this.triangles);
    group.userData.kit = this;
    return group;
  }
}
