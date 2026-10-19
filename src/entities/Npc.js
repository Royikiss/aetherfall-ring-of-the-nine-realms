/**
 * Npc.js — 非战斗角色（守门人、草药师、矮人匠）。
 *
 * 只负责外观与待机动画；对话与交互由 Landmarks / InteractionSystem 处理。
 */
import * as THREE from 'three';
import { createHumanoid } from './Humanoid.js';

const NPC_PALETTES = {
  warden: { cloth: 0x2b3346, cape: 0x1f2f57, fur: 0x8a7a5e, gold: 0xd8b25a },
  herbalist: { cloth: 0x4c5237, cape: 0x3a4028, leather: 0x5a4530, fur: 0x6b5a44 },
  smith: { cloth: 0x4a3326, leather: 0x3a2a1e, metal: 0x6a5a4a, fur: 0x3a2e24, cape: 0x2c2018 },
  default: { cloth: 0x3c3a34, cape: 0x2a2620 },
};

export class Npc {
  constructor({ name, latin, lines = [], position, heading = 0, palette = null }) {
    this.name = name;
    this.latin = latin;
    this.lines = lines;
    const key = palette
      ? 'default'
      : (name.includes('守门') ? 'warden' : name.includes('草药') ? 'herbalist' : name.includes('矮人') ? 'smith' : 'default');

    const humanoid = createHumanoid({
      palette: palette || NPC_PALETTES[key],
      height: key === 'smith' ? 1.62 : 1.8,
      cape: true,
      weapon: key === 'smith' ? 'none' : 'none',
      helmet: false,
      horns: false,
      bulk: key === 'smith' ? 1.12 : 1,
    });
    this.humanoid = humanoid;
    this.object = new THREE.Group();
    this.object.name = `npc_${name}`;
    this.object.add(humanoid.group);
    this.object.position.copy(position);
    this.object.rotation.y = heading;
    this.baseY = position.y;
    this.phase = Math.random() * Math.PI * 2;
    this._lookTarget = new THREE.Vector3();
    this._lookYaw = 0;
  }

  update(dt, elapsed) {
    const j = this.humanoid.joints;
    const t = elapsed + this.phase;
    // 呼吸与轻微摇摆
    j.torso.rotation.z = Math.sin(t * 0.9) * 0.02;
    j.torso.rotation.x = Math.sin(t * 1.3) * 0.015;
    j.head.rotation.y = Math.sin(t * 0.5) * 0.18;
    j.shoulderL.rotation.x = 0.08 + Math.sin(t * 0.8) * 0.03;
    j.shoulderR.rotation.x = 0.08 - Math.sin(t * 0.8) * 0.03;
    j.elbowL.rotation.x = -0.25;
    j.elbowR.rotation.x = -0.22;
    this.object.position.y = this.baseY + Math.sin(t * 0.9) * 0.012;

    // 玩家靠近时看向玩家
    const player = window.game?.player;
    if (player) {
      const dx = player.position.x - this.object.position.x;
      const dz = player.position.z - this.object.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 9) {
        const targetYaw = Math.atan2(dx, dz) - this.object.rotation.y;
        // 归一化到 [-π, π]
        let y = ((targetYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
        this._lookYaw += (y - this._lookYaw) * Math.min(1, dt * 4);
        j.head.rotation.y = THREE.MathUtils.clamp(this._lookYaw, -0.9, 0.9);
      } else {
        this._lookYaw += (0 - this._lookYaw) * Math.min(1, dt * 2);
      }
    }
    if (j.cape) j.cape.rotation.x = 0.04 + Math.sin(t * 0.7) * 0.02;
  }
}
