/**
 * Materials.js — 全局材质调色板与程序化纹理。
 *
 * 设计要点：
 * 1) 所有建筑使用顶点色 + 少量共享材质（每种材质 1 个 draw call）；
 * 2) 金属需要环境反射才有"史诗感"，因此用程序化天空生成 PMREM 环境贴图；
 * 3) 不加载任何外部图片资源。
 */
import * as THREE from 'three';

/** 世界配色（十六进制）。建筑/植被/特效统一从这里取色。 */
export const COL = {
  // 石材家族
  stone: 0x8d8779,
  stoneLight: 0xb3ab9a,
  stoneDark: 0x5c5a54,
  stoneCold: 0x77808a,
  basalt: 0x3c4046,
  marble: 0xd8d1c0,
  marbleWarm: 0xc9bfa8,
  // 金属
  gold: 0xc9a45c,
  goldBright: 0xf4e0a3,
  goldDeep: 0x8a6a2f,
  bronze: 0x8a6a3b,
  copper: 0x9c5f3c,
  iron: 0x4b4f57,
  // 木与织物
  wood: 0x4a3626,
  woodDark: 0x2c2016,
  woodWarm: 0x6a4b30,
  clothRed: 0x6e2323,
  clothBlue: 0x24345c,
  clothCream: 0xb8a986,
  // 自然
  ice: 0x9fd6e8,
  iceDeep: 0x5f97ab,
  snow: 0xe9eff3,
  moss: 0x46543a,
  mossDark: 0x2e3a26,
  grass: 0x5b6b40,
  rock: 0x6b6a63,
  sand: 0x9b8f74,
  water: 0x22414f,
  // 发光
  glowGold: 0xffd98a,
  glowCyan: 0x8fe8ff,
  glowEmber: 0xffa25a,
  glowBlood: 0xd4574a,
  glowGreen: 0x9fe8b0,
  // 其它
  bone: 0xcfc6ae,
  dark: 0x181a1e,
  black: 0x0a0b0d,
};

/**
 * 共享材质表。
 * 注意：全部开启 vertexColors，颜色来自几何体的 color attribute。
 */
export const MATERIALS = {
  stone: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0.02,
  }),
  marble: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, metalness: 0.04, envMapIntensity: 0.7,
  }),
  gold: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.28, metalness: 0.96, envMapIntensity: 1.35,
  }),
  bronze: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.46, metalness: 0.82, envMapIntensity: 1.0,
  }),
  iron: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.58, metalness: 0.7, envMapIntensity: 0.8,
  }),
  wood: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0,
  }),
  cloth: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide,
  }),
  ice: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.14, metalness: 0.05,
    transparent: true, opacity: 0.86, envMapIntensity: 1.6,
  }),
  glass: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.55, envMapIntensity: 1.2,
  }),
  glow: new THREE.MeshBasicMaterial({
    vertexColors: true, toneMapped: false,
  }),
  /** 半透明附加光晕（旗帜后光、符文雾） */
  haze: new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.34,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }),
  /** 水面由 Water.js 单独创建，这里只保留占位 */
};

/** 所有共享材质（便于统一设置环境贴图 / 释放） */
export const MATERIAL_LIST = Object.values(MATERIALS).filter((m) => m.isMaterial);

/**
 * 程序化颗粒纹理：给地形/岩石增加细节，避免大面积纯色。
 * @param {number} size 纹理尺寸
 * @param {number} contrast 0..1
 */
export function makeNoiseTexture(size = 256, contrast = 0.1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  // 两层伪随机 + 一层平滑插值，得到接近岩石的细节
  const rnd = new Float32Array(size * size);
  for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const a = rnd[i];
      const b = rnd[(y * size + ((x + 1) % size))];
      const c = rnd[(((y + 1) % size) * size) + x];
      const smooth = (a * 2 + b + c) / 4;
      let v = 0.5 + (smooth - 0.5) * (0.6 + contrast * 2.2) + (a - 0.5) * contrast;
      v = Math.max(0, Math.min(1, v));
      const g = 228 + (v - 0.5) * 58;
      const p = i * 4;
      img.data[p] = g;
      img.data[p + 1] = g * 0.995;
      img.data[p + 2] = g * 0.985;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 生成一张"黄昏极光"等距柱状天空图，用于 PMREM 环境反射。
 * 金属、冰面有了它才不会死黑。
 */
export function createEnvironment(renderer) {
  const w = 512, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, '#0a1524');
  sky.addColorStop(0.34, '#1a3350');
  sky.addColorStop(0.5, '#7a6a52');
  sky.addColorStop(0.56, '#c79a58');
  sky.addColorStop(0.62, '#3b3a34');
  sky.addColorStop(1.0, '#0b0d10');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 极光带
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const y = 54 + i * 9 + Math.random() * 8;
    const g = ctx.createLinearGradient(0, y, w, y + 16);
    g.addColorStop(0, 'rgba(90,255,200,0)');
    g.addColorStop(0.4, `rgba(${90 + i * 8},255,${200 - i * 8},${0.12 + Math.random() * 0.08})`);
    g.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, w, 22);
  }
  // 太阳光斑
  const sun = ctx.createRadialGradient(w * 0.72, h * 0.52, 2, w * 0.72, h * 0.52, 90);
  sun.addColorStop(0, 'rgba(255,228,170,1)');
  sun.addColorStop(0.25, 'rgba(255,196,120,0.55)');
  sun.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(w * 0.6, h * 0.35, w * 0.24, h * 0.34);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envRT = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return envRT.texture;
}

/**
 * 把环境贴图套到所有共享材质上。
 */
export function applyEnvironment(envTex) {
  for (const m of MATERIAL_LIST) {
    if ('envMap' in m) {
      m.envMap = envTex;
      m.needsUpdate = true;
    }
  }
}
