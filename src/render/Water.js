/**
 * Water.js — 河谷与镜湖的水面（单平面 + 解析波法线 + 菲涅耳 + 太阳高光）。
 *
 * 使用自定义 ShaderMaterial 并接入 three 的雾系统，保证与场景氛围一致。
 * 注意：水面透明但不写深度，水下地形可见。
 */
import * as THREE from 'three';

const VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  #include <fog_pars_vertex>

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    // 极轻微的顶点起伏（远景更稳定）
    worldPos.y += sin(worldPos.x * 0.08 + uTime * 0.9) * 0.06
                + sin(worldPos.z * 0.11 - uTime * 0.7) * 0.05;
    vWorldPos = worldPos.xyz;
    vViewDir = cameraPosition - worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uOpacity;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  #include <fog_pars_fragment>

  void main() {
    vec3 viewDir = normalize(vViewDir);
    vec2 p = vWorldPos.xz;
    float t = uTime;

    // ---- 解析波浪导数（多方向正弦叠加）----
    float dx = cos(p.x * 0.15 + t * 0.8) * 0.075
             + cos((p.x + p.y) * 0.09 + t * 0.5) * 0.032
             + cos(p.x * 0.43 - t * 1.4) * 0.012;
    float dz = cos(p.y * 0.19 - t * 0.6) * 0.095
             + cos((p.x + p.y) * 0.09 + t * 0.5) * 0.032
             + cos(p.y * 0.51 + t * 1.7) * 0.010;
    vec3 n = normalize(vec3(-dx * 2.4, 1.0, -dz * 2.4));

    // ---- 菲涅耳 + 天空反射 ----
    float fres = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 3.0);
    float depthMix = smoothstep(-0.4, 0.9, n.y);
    vec3 col = mix(uDeep, uShallow, depthMix);
    col = mix(col, uSkyColor, fres * 0.58 + 0.1);

    // ---- 太阳镜面高光 ----
    vec3 refl = reflect(-viewDir, n);
    vec3 sunDir = normalize(uSunDir);
    float spec = pow(max(dot(refl, sunDir), 0.0), 220.0);
    float sparkle = pow(max(dot(refl, sunDir), 0.0), 900.0);
    col += uSunColor * (spec * 2.1 + sparkle * 3.6);

    // ---- 水缘泛白 ----
    float edge = smoothstep(0.0, 0.35, abs(n.y));
    float alpha = mix(0.9, 0.98, fres) * uOpacity;
    col = mix(col, uDeep, 0.24);
    gl_FragColor = vec4(col, alpha * edge);
    #include <fog_fragment>
  }
`;

export class Water {
  /**
   * @param {number} level 水面高度
   * @param {number} size 平面边长
   */
  constructor(level, size = 2800) {
    this.level = level;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x0c2430) },
        uShallow: { value: new THREE.Color(0x2c5c68) },
        uSkyColor: { value: new THREE.Color(0x8fa8b8) },
        uSunColor: { value: new THREE.Color(0xffd9a0) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.4) },
        uOpacity: { value: 1.0 },
      },
    ]);

    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = level;
    this.mesh.name = 'water';
    this.mesh.renderOrder = 4;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = true;
    this.time = 0;
  }

  addTo(scene) {
    scene.add(this.mesh);
    return this;
  }

  /**
   * @param {number} dt
   * @param {object} palette Atmosphere 调色板
   * @param {THREE.Vector3} sunDir
   */
  update(dt, palette, sunDir) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (palette) {
      this.uniforms.uSkyColor.value.copy(palette.horizon).lerp(_blue, 0.58);
      this.uniforms.uSunColor.value.copy(palette.sun);
      this.uniforms.uDeep.value.setHex(0x061219).lerp(palette.fog, 0.10);
      this.uniforms.uShallow.value.setHex(0x4a8c96).lerp(palette.horizon, 0.12);
      this.uniforms.uOpacity.value = 0.94 + 0.06 * (palette.stars || 0);
    }
    if (sunDir) this.uniforms.uSunDir.value.copy(sunDir);
  }
}

const _blue = new THREE.Color(0x1b4a63);
