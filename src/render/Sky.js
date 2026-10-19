/**
 * Sky.js — 程序化天空穹顶（GLSL）与时间/氛围调色板。
 *
 * 这是"史诗感"的第一来源：黄昏金光、极光帷幕、星野、月轮、地平线雾带。
 * 全部实时计算，无贴图。
 */
import * as THREE from 'three';

/** 一天的关键帧（t: 0=午夜, 0.25=日出, 0.5=正午, 0.75=日落） */
const KEYFRAMES = [
  {
    t: 0.0,
    top: 0x03060f, horizon: 0x0a1220, bottom: 0x04060a,
    sun: 0x8fa8d8, ambient: 0x0c1626, fog: 0x0a111c,
    hemiSky: 0x121e30, hemiGround: 0x090b0e,
    sunIntensity: 0.12, ambientIntensity: 0.35, fogDensity: 0.0019,
    stars: 1.0, aurora: 1.0, exposure: 1.3,
  },
  {
    t: 0.2,
    top: 0x10203c, horizon: 0x6b4a52, bottom: 0x0c1018,
    sun: 0xff9e63, ambient: 0x2a2c3c, fog: 0x3a3542,
    hemiSky: 0x3c4460, hemiGround: 0x1a1512,
    sunIntensity: 0.9, ambientIntensity: 0.4, fogDensity: 0.0021,
    stars: 0.35, aurora: 0.65, exposure: 1.18,
  },
  {
    t: 0.32,
    top: 0x1c3f68, horizon: 0xa8876a, bottom: 0x1c2026,
    sun: 0xffd0a0, ambient: 0x4a4a58, fog: 0x6a6258,
    hemiSky: 0x5a7d9e, hemiGround: 0x2a241c,
    sunIntensity: 1.9, ambientIntensity: 0.35, fogDensity: 0.0017,
    stars: 0.0, aurora: 0.2, exposure: 1.1,
  },
  {
    t: 0.5,
    top: 0x2a6ea8, horizon: 0xa8c4d2, bottom: 0x2a3038,
    sun: 0xfff2d8, ambient: 0x6a7382, fog: 0x8a9aa6,
    hemiSky: 0x7aa8cc, hemiGround: 0x34302a,
    sunIntensity: 2.6, ambientIntensity: 0.3, fogDensity: 0.0014,
    stars: 0.0, aurora: 0.0, exposure: 1.05,
  },
  {
    t: 0.66,
    top: 0x1a3658, horizon: 0xcf8a52, bottom: 0x241a18,
    sun: 0xffb066, ambient: 0x4a3c3c, fog: 0x7a5f52,
    hemiSky: 0x5a6f8e, hemiGround: 0x2e2218,
    sunIntensity: 2.1, ambientIntensity: 0.32, fogDensity: 0.0016,
    stars: 0.0, aurora: 0.35, exposure: 1.08,
  },
  {
    t: 0.76,
    top: 0x0e1a30, horizon: 0x9a4f2e, bottom: 0x140f12,
    sun: 0xff7a3c, ambient: 0x2e2428, fog: 0x4a3230,
    hemiSky: 0x2e3a58, hemiGround: 0x1a120e,
    sunIntensity: 0.7, ambientIntensity: 0.36, fogDensity: 0.0019,
    stars: 0.35, aurora: 0.9, exposure: 1.2,
  },
  {
    t: 0.86,
    top: 0x04070f, horizon: 0x121a28, bottom: 0x040608,
    sun: 0x8fa8d8, ambient: 0x0c1422, fog: 0x0c121c,
    hemiSky: 0x141e30, hemiGround: 0x08090c,
    sunIntensity: 0.15, ambientIntensity: 0.34, fogDensity: 0.0019,
    stars: 0.85, aurora: 1.0, exposure: 1.28,
  },
  { t: 1.0, top: 0x03060f, horizon: 0x0a1220, bottom: 0x04060a,
    sun: 0x8fa8d8, ambient: 0x0c1626, fog: 0x0a111c,
    hemiSky: 0x121e30, hemiGround: 0x090b0e,
    sunIntensity: 0.12, ambientIntensity: 0.35, fogDensity: 0.0019,
    stars: 1.0, aurora: 1.0, exposure: 1.3 },
];

const COLOR_KEYS = ['top', 'horizon', 'bottom', 'sun', 'ambient', 'fog', 'hemiSky', 'hemiGround'];
const NUM_KEYS = ['sunIntensity', 'ambientIntensity', 'fogDensity', 'stars', 'aurora', 'exposure'];

const _cA = new THREE.Color();
const _cB = new THREE.Color();

/**
 * 采样某个时刻的天空调色板。
 * @param {number} t 0..1
 * @returns {object} 各颜色为 THREE.Color 实例
 */
export function sampleSkyPalette(t) {
  const time = ((t % 1) + 1) % 1;
  let a = KEYFRAMES[0];
  let b = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (time >= KEYFRAMES[i].t && time <= KEYFRAMES[i + 1].t) {
      a = KEYFRAMES[i];
      b = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const f = Math.min(1, Math.max(0, (time - a.t) / span));
  // 平滑插值，避免关键帧处颜色突变
  const s = f * f * (3 - 2 * f);
  const out = {};
  _cA.setHex(a.top); _cB.setHex(b.top);
  for (const key of COLOR_KEYS) {
    _cA.setHex(a[key]); _cB.setHex(b[key]);
    out[key] = _cA.clone().lerp(_cB, s);
  }
  for (const key of NUM_KEYS) {
    out[key] = a[key] + (b[key] - a[key]) * s;
  }
  return out;
}

/** 由一天中的时刻求太阳方向（东 = +X，南 = +Z，北 = -Z） */
export function sunDirectionAt(t, out = new THREE.Vector3()) {
  const theta = (t - 0.25) * Math.PI * 2;
  const elevation = Math.sin(theta); // -1..1
  const cosE = Math.cos(Math.max(-1.2, Math.min(1.2, elevation * 1.05)) * Math.PI * 0.5);
  const y = Math.sin(Math.max(-1.2, Math.min(1.2, elevation * 1.05)) * Math.PI * 0.5);
  return out.set(Math.cos(theta) * cosE, y, Math.sin(theta) * cosE).normalize();
}

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;

  uniform float uTime;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uAuroraColor;
  uniform float uStars;
  uniform float uAurora;
  uniform float uClouds;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += vnoise(p) * amp;
      p *= 2.03;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);

    // ---- 基础渐变 ----
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.03, 0.62, h));
    col = mix(uBottom, col, smoothstep(-0.32, 0.02, h));

    // ---- 太阳 ----
    float sd = max(dot(d, uSunDir), 0.0);
    float disc = smoothstep(0.9992, 0.99965, sd);
    float glow = pow(sd, 8.0) * 0.18 + pow(sd, 64.0) * 0.5 + pow(sd, 260.0) * 1.3;
    col += uSunColor * (disc * 1.15 + glow);

    // ---- 地平线暖带 ----
    float horizonBand = pow(1.0 - abs(h), 9.0);
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
    vec3 flatDir = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
    float toward = max(dot(flatDir, flatSun), 0.0);
    col += uSunColor * horizonBand * 0.16 * (0.25 + 0.75 * toward);

    // ---- 星星（两层） ----
    vec2 sph = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0)));
    float starFade = smoothstep(0.0, 0.22, h) * uStars;
    if (starFade > 0.001) {
      // 两个尺度的星层：每个网格至多一颗星，星点用径向衰减做成圆形
      vec2 c1 = sph * 150.0;
      vec2 g1 = floor(c1);
      vec2 f1 = fract(c1) - 0.5;
      float r1 = hash21(g1 + 7.13);
      float d1 = length(f1);
      float dot1 = smoothstep(0.32, 0.02, d1) * step(0.986, r1);
      float tw1 = 0.55 + 0.45 * sin(uTime * 1.7 + r1 * 40.0);

      vec2 c2 = sph * 330.0 + 13.7;
      vec2 g2 = floor(c2);
      vec2 f2 = fract(c2) - 0.5;
      float r2 = hash21(g2 + 3.7);
      float d2 = length(f2);
      float dot2 = smoothstep(0.3, 0.02, d2) * step(0.991, r2);
      float tw2 = 0.5 + 0.5 * sin(uTime * 2.3 + r2 * 90.0);

      col += vec3(0.82, 0.88, 1.0) * (dot1 * tw1 + dot2 * tw2 * 0.55) * starFade * 2.2;
    }

    // ---- 极光帷幕（北方天空） ----
    float az = atan(d.z, d.x);
    float northMask = smoothstep(-0.4, 0.9, -d.z) * 0.65 + 0.35;
    float a1 = sin(az * 2.1 + uTime * 0.07 + h * 5.0);
    float a2 = sin(az * 4.7 - uTime * 0.045 + 1.9 + h * 3.4);
    float a3 = sin(az * 9.3 + uTime * 0.11 + h * 7.0);
    float curtain = smoothstep(0.15, 0.95, a1 * 0.6 + a2 * 0.3 + a3 * 0.1);
    float band = smoothstep(0.04, 0.28, h) * (1.0 - smoothstep(0.55, 0.92, h));
    vec3 auroraColor = mix(uAuroraColor, vec3(0.45, 0.75, 1.0), 0.35 + 0.35 * sin(az * 3.0));
    col += auroraColor * curtain * band * uAurora * northMask * 0.8;

    // ---- 月轮 ----
    float md = max(dot(d, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.9990, 0.9996, md);
    col += vec3(0.78, 0.85, 1.0) * (moonDisc * 1.1 + pow(md, 300.0) * 0.35) * (1.0 - smoothstep(0.0, 0.5, -uSunDir.y));

    // ---- 高空薄云 ----
    float cloudMask = smoothstep(0.02, 0.22, h) * (1.0 - smoothstep(0.45, 0.85, h));
    if (cloudMask > 0.001) {
      vec2 cp = vec2(az * 2.2 + uTime * 0.004, h * 9.0 - uTime * 0.002);
      float cl = smoothstep(0.48, 0.86, fbm(cp * 1.4 + fbm(cp * 2.6) * 0.6));
      vec3 cloudCol = mix(uHorizon * 1.25, uSunColor * 1.05, 0.45);
      col = mix(col, cloudCol, cl * cloudMask * uClouds * 0.42);
    }

    // ---- 底部地平线尘雾 ----
    col = mix(col, uBottom, smoothstep(0.0, -0.35, h) * 0.6);

    // 轻微抖动：消除渐变天空的 8bit 色带
    float dither = (hash21(gl_FragCoord.xy) - 0.5) * 0.0025;
    col += dither;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor() {
    this.sunDir = new THREE.Vector3(0.3, 0.5, 0.8);
    this.moonDir = new THREE.Vector3(-0.3, -0.5, -0.8);
    this.palette = sampleSkyPalette(0.7);

    const geo = new THREE.SphereGeometry(1500, 40, 24);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: new THREE.Color(0x1a3658) },
        uHorizon: { value: new THREE.Color(0xcf8a52) },
        uBottom: { value: new THREE.Color(0x241a18) },
        uSunColor: { value: new THREE.Color(0xffb066) },
        uSunDir: { value: this.sunDir },
        uMoonDir: { value: this.moonDir },
        uAuroraColor: { value: new THREE.Color(0x46e0b0) },
        uStars: { value: 0 },
        uAurora: { value: 0.35 },
        uClouds: { value: 0.7 },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = true;
    this.time = 0;
  }

  /** 加入场景 */
  addTo(scene) {
    scene.add(this.mesh);
    return this;
  }

  /**
   * @param {number} dt
   * @param {number} timeOfDay 0..1
   * @param {THREE.Camera} camera
   */
  update(dt, timeOfDay, camera) {
    this.time += dt;
    this.palette = sampleSkyPalette(timeOfDay);
    sunDirectionAt(timeOfDay, this.sunDir);
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uTop.value.copy(this.palette.top);
    u.uHorizon.value.copy(this.palette.horizon);
    u.uBottom.value.copy(this.palette.bottom);
    u.uSunColor.value.copy(this.palette.sun);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uStars.value = this.palette.stars;
    u.uAurora.value = this.palette.aurora;
    u.uAuroraColor.value.setHex(0x46e0b0);

    // 穹顶跟随相机
    this.mesh.position.copy(camera.position);
  }
}
