/**
 * Terrain.js — 分块高度场地形。
 *
 * 特性：
 *  - 确定性程序化地形：丘陵 + 山脉环 + 蜿蜒河谷 + 镜湖；
 *  - 地标压平（flatten）：保证宏大建筑不会陷进山坡；
 *  - 顶点色按高度/坡度/区域着色（雪线、岩石、草甸、河岸、霜原、灰烬）；
 *  - 分块流式加载：只构建玩家附近的区块，远区块延时构建，避免启动卡顿。
 *
 * 高度函数同时被世界、地图、植被、任务共用，必须保持稳定（同种子同世界）。
 */
import * as THREE from 'three';
import { WORLD, LANDMARKS } from '../data/world.js';
import { makeNoiseTexture } from '../render/Materials.js';

const CHUNK = 200;
const SEG = 40;
const VIEW_RADIUS = 4; // 区块半径

// ------------------------------------------------------------------ 噪声
function hash2(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = smooth(xf);
  const v = smooth(zf);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, z, seed, octaves = 5, lac = 2.02, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 97) * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/** 山脊噪声（1-|2n-1|）产生尖锐山脉 */
function ridge(x, z, seed, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(x * freq, z * freq, seed + i * 131);
    sum += (1 - Math.abs(n * 2 - 1)) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ 地形
export class Terrain {
  constructor({ seed = WORLD.seed } = {}) {
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = new Map();       // "cx,cz" -> Mesh
    this._queue = [];
    this._lastChunk = { cx: 9999, cz: 9999 };
    this.waterLevel = WORLD.waterLevel;
    this.half = WORLD.half;

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.0,
      map: makeNoiseTexture(256, 0.24),
    });
    this.material.map.repeat.set(1, 1);

    // 预先计算地标压平的目标高度
    this.flattenZones = LANDMARKS.filter((l) => l.flatten && !l.bridge).map((l) => ({
      x: l.x,
      z: l.z,
      radius: l.flatten,
      strength: l.flattenStrength ?? 0.9,
      targetY: 0,
    }));
    for (const zone of this.flattenZones) {
      // 压平目标不得低于水面：否则地标会被埋进河床/湖底
      zone.targetY = Math.max(
        this.baseHeight(zone.x, zone.z),
        WORLD.waterLevel + 3.0,
      );
    }
  }

  // ------------------------------------------------------------ 高度函数
  /** 未经地标压平的原始高度 */
  baseHeight(x, z) {
    const s = this.seed;
    const r = Math.hypot(x, z) / this.half;

    // 起伏丘陵
    let h = (fbm(x * 0.0018, z * 0.0018, s, 5) - 0.5) * 46;
    h += (fbm(x * 0.0075, z * 0.0075, s + 7, 4) - 0.5) * 13;
    h += (fbm(x * 0.021, z * 0.021, s + 19, 3) - 0.5) * 3.2;

    // 中心谷地：世界树周围平缓
    const centerFlat = 1 - THREE.MathUtils.smoothstep(r, 0.03, 0.24);
    h *= 1 - centerFlat * 0.55;

    // 山脉环（外圈隆起），北与东更高
    const mStart = WORLD.terrain.mountainStart;
    const mFactor = THREE.MathUtils.smoothstep(r, mStart, 1.02);
    if (mFactor > 0.001) {
      const directional =
        1
        + 0.55 * THREE.MathUtils.smoothstep(-z, 200, 1100)
        + 0.45 * THREE.MathUtils.smoothstep(x, 250, 1000);
      const ridgeH = ridge(x * 0.0026, z * 0.0026, s + 53, 5);
      h += mFactor * (34 + ridgeH * 168) * directional;
    }

    // 蜿蜒河谷（霜河）
    const riverX = WORLD.terrain.river.x + Math.sin(z * 0.0055) * 34 + Math.sin(z * 0.013 + 1.7) * 12;
    const dRiver = Math.abs(x - riverX);
    const riverW = WORLD.terrain.river.width;
    if (dRiver < riverW * 2.4) {
      const k = 1 - THREE.MathUtils.smoothstep(dRiver, riverW * 0.35, riverW * 1.7);
      h -= k * WORLD.terrain.river.depth * (1.0 + 0.6 * (1 - r));
    }

    // 镜湖（下挖足够深，确保湖心低于水面）
    const dLake = Math.hypot(x + 640, z - 520);
    if (dLake < 230) {
      const k = 1 - THREE.MathUtils.smoothstep(dLake, 40, 210);
      h -= k * 62;
    }

    // 出生点附近保证平地
    const dSpawn = Math.hypot(x - WORLD.spawn.x, z - WORLD.spawn.z);
    if (dSpawn < 90) h -= (1 - THREE.MathUtils.smoothstep(dSpawn, 10, 80)) * (h - 2.5);

    return h;
  }

  /** 最终高度：原始高度 + 地标压平 */
  sampleHeight(x, z) {
    let h = this.baseHeight(x, z);
    for (const zone of this.flattenZones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      const d = Math.hypot(dx, dz);
      if (d > zone.radius) continue;
      const k = 1 - THREE.MathUtils.smoothstep(d, zone.radius * 0.35, zone.radius);
      h += (zone.targetY - h) * k * zone.strength;
    }
    // 细微起伏：避免压平区变成"镜面平原"，同时让近景地表更有质感
    h += (fbm(x * 0.052, z * 0.052, this.seed + 401, 3) - 0.5) * 0.55;
    h += (fbm(x * 0.16, z * 0.16, this.seed + 733, 2) - 0.5) * 0.16;
    return h;
  }

  /** 法线（中心差分） */
  sampleNormal(x, z, out = new THREE.Vector3()) {
    const e = 1.4;
    const hL = this.sampleHeight(x - e, z);
    const hR = this.sampleHeight(x + e, z);
    const hD = this.sampleHeight(x, z - e);
    const hU = this.sampleHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** 坡度 0..1 */
  sampleSlope(x, z) {
    const n = this.sampleNormal(x, z, _tmpNormal);
    return 1 - n.y;
  }

  /** 是否在水下 */
  isUnderwater(x, z) {
    return this.sampleHeight(x, z) < this.waterLevel;
  }

  // ------------------------------------------------------------ 着色
  /**
   * 地表颜色。区域差异（霜原/灰烬/雪线）让世界不单调。
   */
  colorAt(x, z, h, slope, out = new THREE.Color()) {
    const s = this.seed;
    const n = fbm(x * 0.045, z * 0.045, s + 301, 3);
    const n2 = fbm(x * 0.012, z * 0.012, s + 511, 3);

    // 基础草甸（偏暖的苔绿，较饱和）
    out.setHex(0x5f6f41);
    out.offsetHSL((n - 0.5) * 0.06, (n2 - 0.5) * 0.2, (n - 0.5) * 0.13);
    // 大尺度色斑：草甸 / 苔藓交错
    out.lerp(_col.setHex(0x46543a), THREE.MathUtils.smoothstep(n2, 0.45, 0.75) * 0.55);

    // 北境草色偏冷
    const north = THREE.MathUtils.smoothstep(-z, 150, 900);
    if (north > 0) out.lerp(_col.setHex(0x4c5a52), north * 0.55);

    // 东境霜原
    const east = THREE.MathUtils.smoothstep(x, 360, 980);
    if (east > 0) out.lerp(_col.setHex(0x8fa8ae), east * 0.7);

    // 西境灰烬（锻炉）
    const west = THREE.MathUtils.smoothstep(-x, 420, 1000);
    if (west > 0) out.lerp(_col.setHex(0x6b5346), west * 0.6);

    // 河岸/湖岸沙地
    const shore = 1 - THREE.MathUtils.smoothstep(h - this.waterLevel, 0.2, 3.2);
    if (shore > 0) out.lerp(_col.setHex(0x8c8068), shore * 0.85);

    // 岩石（坡度）
    const rockK = THREE.MathUtils.smoothstep(slope, 0.24, 0.62);
    if (rockK > 0) out.lerp(_col.setHex(0x6d6a62).offsetHSL(0, 0, (n - 0.5) * 0.08), rockK);

    // 高山岩石
    const highRock = THREE.MathUtils.smoothstep(h, 52, 96);
    if (highRock > 0) out.lerp(_col.setHex(0x7a7770), highRock * 0.55);

    // 雪线
    const snowLine = 84 + n2 * 26 + north * 22 + east * 18;
    const snowK = THREE.MathUtils.smoothstep(h, snowLine, snowLine + 26);
    if (snowK > 0) out.lerp(_col.setHex(0xe2e9ec), snowK);

    // 极浅的水下淤泥
    if (h < this.waterLevel + 0.4) out.lerp(_col.setHex(0x46503f), 0.6);

    return out;
  }

  // ------------------------------------------------------------ 区块
  _key(cx, cz) { return `${cx},${cz}`; }

  _chunkIndexRange() {
    const n = Math.ceil(WORLD.size / CHUNK / 2);
    return { min: -n, max: n };
  }

  buildChunk(cx, cz) {
    const key = this._key(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);

    const step = CHUNK / SEG;
    const originX = cx * CHUNK - CHUNK / 2;
    const originZ = cz * CHUNK - CHUNK / 2;
    const count = (SEG + 1) * (SEG + 1);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const indices = [];
    const color = new THREE.Color();

    for (let iz = 0; iz <= SEG; iz++) {
      for (let ix = 0; ix <= SEG; ix++) {
        const i = iz * (SEG + 1) + ix;
        const x = originX + ix * step;
        const z = originZ + iz * step;
        const h = this.sampleHeight(x, z);
        positions[i * 3] = x;
        positions[i * 3 + 1] = h;
        positions[i * 3 + 2] = z;
        uvs[i * 2] = x / 17;
        uvs[i * 2 + 1] = z / 17;
        const slope = this.sampleSlope(x, z);
        this.colorAt(x, z, h, slope, color);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
    }
    for (let iz = 0; iz < SEG; iz++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iz * (SEG + 1) + ix;
        const b = a + 1;
        const c = a + SEG + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `terrain_${key}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.chunks.set(key, mesh);
    return mesh;
  }

  /** 构建玩家周围区块（队列式，避免一次性卡顿） */
  ensureAround(x, z, radius = VIEW_RADIUS) {
    const cx = Math.round(x / CHUNK);
    const cz = Math.round(z / CHUNK);
    const { min, max } = this._chunkIndexRange();
    const wanted = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < min || gx > max || gz < min || gz > max) continue;
        if (this.chunks.has(this._key(gx, gz))) continue;
        wanted.push([gx, gz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [gx, gz] of wanted) {
      if (this._queue.length > 60) break;
      this._queue.push([gx, gz]);
    }
    return wanted.length;
  }

  /** 启动时同步构建核心区域 */
  buildInitial(x, z, radius = 2) {
    this.ensureAround(x, z, radius);
    while (this._queue.length) {
      const [gx, gz] = this._queue.shift();
      this.buildChunk(gx, gz);
    }
  }

  update(playerPos, budget = 2) {
    const cx = Math.round(playerPos.x / CHUNK);
    const cz = Math.round(playerPos.z / CHUNK);
    if (cx !== this._lastChunk.cx || cz !== this._lastChunk.cz) {
      this._lastChunk.cx = cx;
      this._lastChunk.cz = cz;
      this.ensureAround(playerPos.x, playerPos.z, VIEW_RADIUS);
    }
    let built = 0;
    while (this._queue.length && built < budget) {
      const [gx, gz] = this._queue.shift();
      this.buildChunk(gx, gz);
      built++;
    }
  }

  /** 预构建全部区块（用于大地图/截图模式，谨慎调用） */
  buildAll() {
    const { min, max } = this._chunkIndexRange();
    for (let cz = min; cz <= max; cz++) {
      for (let cx = min; cx <= max; cx++) this.buildChunk(cx, cz);
    }
  }

  dispose() {
    for (const mesh of this.chunks.values()) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.chunks.clear();
    this.material.map?.dispose();
    this.material.dispose();
  }
}

const _col = new THREE.Color();
const _tmpNormal = new THREE.Vector3();
