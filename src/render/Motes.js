/**
 * Motes.js — 漂浮微尘 / 余烬粒子。
 *
 * 纯 GPU 计算：粒子在跟随玩家的立方体空间内循环漂移，CPU 每帧只更新一个 uniform。
 * 作用：给空气"体积感"，让宏大的静帧产生呼吸感（黄昏的金色尘埃）。
 */
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aPhase;
  attribute float aSize;
  attribute float aBright;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // 缓慢上升 + 横向漂移 + 个体摆动
    p.y += sin(uTime * 0.22 + aPhase * 6.2831) * 2.2 + uTime * 0.35;
    p.x += cos(uTime * 0.13 + aPhase * 12.0) * 2.6 + uTime * 0.55;
    p.z += sin(uTime * 0.11 + aPhase * 9.0) * 2.6;

    // 包围盒循环（围绕玩家）
    p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCenter + p;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = -mv.z;
    gl_PointSize = clamp(aSize * (260.0 / max(1.0, dist)), 1.0, 5.5);

    float twinkle = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase * 40.0);
    vAlpha = aBright * twinkle * smoothstep(90.0, 12.0, dist);
  }
`;

const FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.06, d) * vAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Motes {
  constructor(count = 900) {
    this.count = count;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    const brights = new Float32Array(count);
    const box = new THREE.Vector3(170, 48, 170);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * box.x;
      positions[i * 3 + 1] = (Math.random() - 0.5) * box.y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * box.z;
      phases[i] = Math.random();
      sizes[i] = 0.7 + Math.random() * 1.8;
      brights[i] = 0.25 + Math.random() * 0.6;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: box },
      uColor: { value: new THREE.Color(0xffce8a) },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.name = 'motes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.time = 0;
  }

  addTo(scene) {
    scene.add(this.points);
    return this;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} center 玩家位置
   * @param {object} palette 天空调色板（用于夜晚变色）
   */
  update(dt, center, palette) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCenter.value.set(center.x, center.y + 10, center.z);
    if (palette) {
      // 黄昏偏金，夜晚偏冷蓝
      const night = palette.stars || 0;
      this.uniforms.uColor.value.setHex(0xffce8a).lerp(_cool, night * 0.55);
    }
  }
}

const _cool = new THREE.Color(0x9fc8ff);
