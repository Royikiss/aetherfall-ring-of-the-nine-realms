/**
 * GeomUtil.js — 角色/植被等"非建筑"几何体的顶点色合并工具。
 *
 * 建筑使用 Kit（带材质分组），角色需要按"身体部件"合并：
 * 每个部件（躯干、上臂…）是一个独立 Mesh 以便骨骼式动画，
 * 但每个部件内部的所有小构件合并为 1 个几何体，保持低 draw call。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * 给几何体写入统一顶点色（可带垂直明暗）。
 */
export function bakeColor(geometry, colorHex, { shade = 0.22, jitter = 0.04 } = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of ['uv', 'uv1', 'uv2', 'tangent', 'color']) {
    if (g.getAttribute(name)) g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  const minY = g.boundingBox.min.y;
  const span = Math.max(1e-4, g.boundingBox.max.y - minY);
  const base = new THREE.Color(colorHex);
  const tint = 1 + (Math.random() * 2 - 1) * jitter;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    const f = (1 - shade * 0.5) + shade * t;
    colors[i * 3] = base.r * f * tint;
    colors[i * 3 + 1] = base.g * f * tint;
    colors[i * 3 + 2] = base.b * f * tint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * 合并一组带变换与颜色的几何体。
 * part: { geo, color, x,y,z, rx,ry,rz, sx,sy,sz, shade }
 */
export function mergeColored(parts) {
  const geos = [];
  for (const p of parts) {
    const g = p.geo;
    _e.set(p.rx || 0, p.ry || 0, p.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(p.x || 0, p.y || 0, p.z || 0);
    _s.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    _m4.compose(_v, _q, _s);
    g.applyMatrix4(_m4);
    geos.push(bakeColor(g, p.color ?? 0xffffff, { shade: p.shade ?? 0.22 }));
    g.dispose && g.dispose();
  }
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** 标准网格材质（顶点色）。所有角色共用，避免材质爆炸。 */
export const CHARACTER_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.78,
  metalness: 0.18,
});

/** 布料材质（斗篷等双面） */
export const CLOTH_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.92,
  metalness: 0.02,
  side: THREE.DoubleSide,
});

/** 自发光材质（眼睛、符文） */
export const GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  vertexColors: true,
  toneMapped: false,
});
