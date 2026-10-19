/**
 * main.js — 唯一组装点。
 *
 * 启动顺序：
 *  1) 引擎 / 输入 / UI 管理器
 *  2) 大气（天空、光照、雾）
 *  3) 世界（地形 → 水域 → 地标 → 植被）
 *  4) 系统实例化（动态加载，允许模块缺失时优雅降级）
 *  5) 玩家 / 相机 / HUD
 *  6) 系统初始化 → 标题界面 → 主循环
 *
 * 调试：URL 加 ?q=low|medium|high 可切换画质。
 */
import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { EventBus } from './core/EventBus.js';
import { UIManager } from './ui/UIManager.js';
import { HUD } from './ui/HUD.js';
import { Atmosphere } from './render/Atmosphere.js';
import { Motes } from './render/Motes.js';
import { World } from './world/World.js';
import { Player } from './entities/Player.js';
import { ThirdPersonCamera } from './entities/ThirdPersonCamera.js';
import { CombatSystem } from './systems/CombatSystem.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { SaveSystem } from './systems/SaveSystem.js';
import { WORLD } from './data/world.js';

const BUILD_STAMP = '1.0.0';

const LOADING_TIPS = [
  '「诸神黄昏不是终结，而是一次漫长的呼吸。」—— 沃吕斯帕预言',
  '按 I 打开行囊，C 查看状态，M 展开九界舆图，L 阅读任务纪事。',
  '点燃四座圣火灯塔，九界之环才会重新闭合。',
  '尸鬼惧怕火焰与晨光。在夜里，它们的眼睛会先亮起来。',
  '世界树尤克特拉希尔在世界的中心。迷路时，抬头看它。',
  'Shift 疾跑会消耗耐力；耐力耗尽时，你只能走。',
  '宝箱散落在重要的地标附近。它们不会自己打开。',
  '按 F5 铭刻旅程，按 F9 展开符文记录。',
];

class Game {
  constructor() {
    this.started = false;
    this.quality = 'high';
    this.systems = {};
    this.buildStamp = BUILD_STAMP;
    this._lastToastLock = 0;
  }

  // ------------------------------------------------------------ 重生
  respawnPlayer() {
    const spawn = this.world?.spawnPoint || new THREE.Vector3(WORLD.spawn.x, 0, WORLD.spawn.z);
    this.player?.spawnAt(spawn);
    this.camera3p?.snapBehind?.();
    this.events.emit('player:respawn', {});
  }

  get time() {
    return this.atmosphere?.timeOfDay ?? 0;
  }

  save() { return this.systems?.save?.save?.(); }
  load() { return this.systems?.save?.load?.(); }
}

/** 系统动态加载表（顺序即初始化顺序） */
const SYSTEM_TABLE = [
  ['stats', './systems/StatsSystem.js', 'StatsSystem'],
  ['inventory', './systems/InventorySystem.js', 'InventorySystem'],
  ['map', './systems/MapSystem.js', 'MapSystem'],
  ['quest', './systems/QuestSystem.js', 'QuestSystem'],
  ['audio', './systems/AudioSystem.js', 'AudioSystem'],
];

/** 降级桩：模块缺失时保证游戏仍可运行 */
function fallbackStats() {
  return {
    health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
    mana: 60, maxMana: 60, level: 1, xp: 0, statuses: [], isDead: false,
    damage() {}, heal() {}, consumeStamina() { return true; }, addXp() {},
    setEquipmentBonuses() {}, applyStatus() {}, removeStatus() {}, toJSON() { return {}; }, fromJSON() {},
  };
}
function fallbackInventory() {
  return {
    items: [], capacity: 24,
    add() { return true; }, remove() { return true; }, count() { return 0; },
    use() { return false; }, equip() { return false; }, unequip() { return false; },
    toJSON() { return {}; }, fromJSON() {},
  };
}
function fallbackNoop() {
  return { init() {}, update() {}, toJSON() { return {}; }, fromJSON() {}, play() {}, setAmbience() {} };
}

async function loadSystems(game) {
  for (const [id, path, cls] of SYSTEM_TABLE) {
    try {
      const mod = await import(path);
      const Ctor = mod[cls];
      if (typeof Ctor !== 'function') throw new Error(`${cls} not exported`);
      game.systems[id] = new Ctor(game);
      game.systems[id].constructor.id = id;
    } catch (err) {
      console.warn(`[main] 系统 "${id}" 加载失败，使用降级桩：`, err.message);
      game.systems[id] = id === 'stats' ? fallbackStats()
        : id === 'inventory' ? fallbackInventory()
          : fallbackNoop();
    }
  }
}

async function boot() {
  const canvas = document.getElementById('stage');
  const params = new URLSearchParams(location.search);
  const quality = ['low', 'medium', 'high'].includes(params.get('q')) ? params.get('q') : 'high';
  document.getElementById('build-stamp').textContent = BUILD_STAMP;

  // ---------------------------------------------------------- 基础
  const events = new EventBus();
  const engine = new Engine(canvas, quality).init();
  engine.setAutoQuality(true);

  const game = new Game();
  game.events = events;
  game.engine = engine;
  game.scene = engine.scene;
  game.renderer = engine.renderer;
  game.quality = quality;
  window.game = game;

  const ui = new UIManager(game);
  game.ui = ui;
  ui.init();

  const input = new Input(game, canvas).init();
  game.input = input;

  events.on('ui:modal', ({ open }) => {
    input.setEnabled(!open);
    if (!open && game.started) {
      // 关闭面板后重新锁定鼠标（浏览器要求用户手势，这里尽力而为）
      setTimeout(() => { if (game.started && !ui.isOpen()) input.requestLock(); }, 30);
    }
  });
  events.on('input:lock', ({ locked }) => {
    if (game.started && !locked && !ui.isOpen() && !ui.isDialogueOpen?.()) {
      const now = performance.now();
      if (now - game._lastToastLock > 8000) {
        game._lastToastLock = now;
        ui.toast('点击画面以锁定视角。', { kind: 'info', latin: 'CLICK TO LOOK', glyph: 'ᛉ' });
      }
    }
  });

  // 载入屏文案
  ui.setLoading(2, '唤醒英灵……');
  ui.setLoadingTip(LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);

  // ---------------------------------------------------------- 大气
  const atmosphere = new Atmosphere(engine.scene, engine.renderer, {
    shadows: quality !== 'low',
  });
  atmosphere.timeOfDay = 0.655; // 金色午后 —— 最史诗的时刻
  game.atmosphere = atmosphere;

  // 空气里的微尘与余烬（体积感）
  const motes = new Motes(900).addTo(engine.scene);
  game.motes = motes;
  engine.scene.background = new THREE.Color(0x0a0f16);

  // ---------------------------------------------------------- 世界
  ui.setLoading(4, '推演九界的地脉……');
  const world = new World(game);
  game.world = world;
  await world.init((pct, text) => ui.setLoading(4 + pct * 0.62, text));

  // 出生点
  const spawnX = WORLD.spawn.x;
  const spawnZ = WORLD.spawn.z;
  const spawnY = world.sampleHeight(spawnX, spawnZ);
  world.spawnPoint = new THREE.Vector3(spawnX, spawnY, spawnZ);

  // ---------------------------------------------------------- 系统
  ui.setLoading(70, '唤醒古老的法则……');
  await loadSystems(game);

  game.systems.combat = new CombatSystem(game);
  game.systems.interaction = new InteractionSystem(game);
  game.systems.save = new SaveSystem(game);

  // ---------------------------------------------------------- 玩家 / 相机
  ui.setLoading(78, '铸造英灵之躯……');
  const player = new Player(game);
  game.player = player;
  player.spawnAt(world.spawnPoint);
  player.object.position.copy(player.position);
  engine.scene.add(player.object);

  const camera3p = new ThirdPersonCamera(engine.camera, game);
  game.camera3p = camera3p;
  camera3p.yaw = player.heading + Math.PI;
  camera3p.pitch = 0.22;
  engine.camera.position.set(player.position.x, player.position.y + 3, player.position.z + 8);

  // ---------------------------------------------------------- HUD
  const hud = new HUD(game);
  game.hud = hud;
  hud.init();
  ui.setHudVisible(false);

  // ---------------------------------------------------------- 系统初始化
  ui.setLoading(84, '让世界开始呼吸……');
  const initOrder = ['stats', 'inventory', 'map', 'quest', 'audio', 'combat', 'interaction', 'save'];
  for (const id of initOrder) {
    const sys = game.systems[id];
    if (!sys) continue;
    try {
      sys.init?.();
    } catch (err) {
      console.error(`[main] system "${id}" init failed`, err);
    }
  }

  // 标题界面的音乐情绪
  game.systems.audio?.setMusicMood?.('menu');
  game.systems.audio?.setAmbience?.(0.22);

  // 事件：存档提示
  events.on('game:saved', () => { /* toast 由 SaveSystem 处理 */ });

  // ---------------------------------------------------------- 标题镜头
  const hallLandmark = world.landmarks?.instances?.find((i) => i.def.id === 'great_hall');
  const cinematicCenter = hallLandmark
    ? new THREE.Vector3(hallLandmark.def.x, hallLandmark.baseY + 6, hallLandmark.def.z)
    : new THREE.Vector3(0, 30, 0);
  camera3p.setCinematic({
    center: cinematicCenter,
    radius: 138,
    height: 10,
    speed: 0.012,
    startAngle: Math.PI * 0.5,     // 从南侧看向金宫，侧逆光
    lookAt: new THREE.Vector3(cinematicCenter.x, cinematicCenter.y + 28, cinematicCenter.z),
  });

  // 额外预构建几块地形，保证标题镜头下没有空洞
  world.terrain.buildInitial(0, 120, 4);

  // ---------------------------------------------------------- 主循环
  let elapsedTitle = 0;
  let audioMoodTimer = 0;
  const update = (dt, elapsed) => {
    const modal = ui.isOpen() || ui.isDialogueOpen();
    if (!modal) input.setEnabled(true);

    if (game.started) {
      player.update(dt);
      camera3p.update(dt, elapsed);
      atmosphere.update(dt, engine.camera, player.position);
    } else {
      elapsedTitle += dt;
      camera3p.update(dt, elapsed);
      atmosphere.update(dt, engine.camera, cinematicCenter);
    }

    world.update(dt, elapsed);
    motes.update(dt, game.started ? player.position : cinematicCenter, atmosphere.palette);

    if (game.started) {
      // 音频情绪：附近有敌人追击 → combat；点亮圣火/遗迹 → sacred；平时 explore
      audioMoodTimer += dt;
      if (audioMoodTimer > 1.2) {
        audioMoodTimer = 0;
        const audio = game.systems.audio;
        if (audio?.setMusicMood) {
          const chasing = game.systems.combat?.enemies?.some?.((e) => e.alive && e.state === 'chase');
          audio.setMusicMood(chasing ? 'combat' : 'explore');
        }
      }
      game.systems.combat?.update(dt);
      game.systems.interaction?.update(dt);
      game.systems.map?.update?.(dt);
      game.systems.quest?.update?.(dt);
      game.systems.stats?.update?.(dt);
      game.systems.inventory?.update?.(dt);
      game.systems.audio?.update?.(dt);
      game.systems.save?.update?.(dt);
      hud.update(dt);
    } else {
      // 标题界面也让音频/时间继续（氛围）
      game.systems.audio?.update?.(dt);
      hud.update(dt);
    }

    input.postUpdate();
  };

  engine.setUpdate(update);
  engine.start();

  // 等待第一帧完成
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ---------------------------------------------------------- 进入游戏
  const startGame = (continueSave = false) => {
    if (game.started) return;
    if (continueSave) {
      const ok = game.systems.save?.loadSilent?.();
      if (!ok) ui.toast('读取失败，开始新的旅程。', { kind: 'danger' });
    }
    game.started = true;
    ui.hideTitle();
    ui.setHudVisible(true);
    camera3p.clearCinematic();
    camera3p.snapBehind();
    camera3p._initialized = false;
    game.systems.audio?.init?.();
    game.systems.audio?.setMusicMood?.('explore');
    game.systems.audio?.setAmbience?.(0.35);
    events.emit('player:spawn', { position: player.position.clone() });
    hud.announceRegion();
    setTimeout(() => {
      ui.banner('英灵纪元', '九界之环 · 第一缕火', { latin: 'AETHERFALL', duration: 3400 });
      ui.toast('按 F5 铭刻旅程，F3 查看性能。', { kind: 'info', latin: 'TIP', glyph: 'ᛁ' });
    }, 900);
    // 用户点击按钮属于手势，可请求指针锁定
    input.requestLock();
  };

  document.getElementById('btn-start')?.addEventListener('click', () => startGame(false));
  document.getElementById('btn-continue')?.addEventListener('click', () => startGame(true));
  window.addEventListener('keydown', (e) => {
    if (!game.started && e.code === 'Enter' && !ui.helpScreen.classList.contains('hidden')) return;
    if (!game.started && e.code === 'Enter') startGame(false);
  });

  // 载入完成 → 标题
  ui.setLoading(100, '世界已就绪');
  ui.finishLoading();
  setTimeout(() => {
    const hasSave = game.systems.save?.hasSave?.();
    ui.showTitle(hasSave);
    ui.setHudVisible(false);
  }, 300);
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const box = document.getElementById('boot-error');
  const msg = document.getElementById('boot-error-msg');
  if (box && msg) {
    msg.textContent = err.stack || String(err);
    box.classList.remove('hidden');
  }
});
