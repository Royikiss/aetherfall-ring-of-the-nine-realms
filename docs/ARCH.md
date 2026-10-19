# 《英灵纪元 · 九界之环》 — 架构与协作契约

> 第三人称开放世界 / 西欧（北欧）神话 / Three.js r160 / 纯前端 ES Modules / 零外部运行时依赖。
> 本文件是全体成员的**唯一契约来源**。任何跨模块调用都以本文件为准。

---

## 1. 工程结构

```
index.html                 入口（importmap + DOM 骨架 + CSS 引用）
server.mjs                 零依赖静态服务器（node server.mjs [port]）
vendor/                    three.module.js / BufferGeometryUtils.js（本地化，离线可用）
assets/fonts/              Cinzel 显示字体
src/
  main.js                  组装 Game（唯一组装点，Lead 所有）
  core/                    EventBus / Input / Engine / Rng / MathUtils / Perf
  render/                  Materials（共享材质调色板）/ Sky / Water / Atmosphere
  world/                   Terrain / World / Vegetation / Weather / Landmarks
  world/architecture/      Kit.js（几何构建套件）+ 各大型建筑生成器
  entities/                Player / ThirdPersonCamera / Enemy / Npc
  systems/                 Stats / Inventory / Map / Quest / Interaction / Combat / Save / Audio
  ui/                      UIManager / HUD / TitleScreen / 各面板
  ui/styles/               theme.css（设计系统）/ hud.css / inventory.css / mapquest.css
  data/                    items.js / quests.js（纯数据）
docs/                      架构文档
```

**约定**

- 全部使用 ESM：`import * as THREE from 'three'`（importmap 已映射到 `vendor/three.module.js`）。
- 坐标：Y 轴向上，单位 *米*。角色身高约 1.85。世界范围 `[-1200, 1200]²`。
- 不要引入任何 npm 依赖、外部图片、网络资源。纹理一律程序化生成（Canvas / 顶点色 / GLSL）。
- 不要修改不属于自己负责的文件。共享文件（index.html / main.js / theme.css / Kit.js / Materials.js）由 Lead 独占。
- 代码风格：`camelCase` 变量/方法，`PascalCase` 类，常量 `UPPER_SNAKE`。注释使用中文，面向"后续维护者"。
- 每个模块都要有文件头注释：模块职责、对外 API、依赖。
- 禁止 `console.log` 噪音，调试信息走 `Perf` / `game.debug`。

---

## 2. 运行时组装（Game）

`src/main.js` 创建唯一实例 `window.game`：

```js
game = {
  engine,        // 渲染与主循环
  scene, camera, renderer,
  events,        // EventBus
  input,         // Input
  world,         // World（地形、建筑、植被、POI、碰撞）
  player,        // Player（含 transform / stats 引用）
  camera3p,      // ThirdPersonCamera
  systems,       // { stats, inventory, map, quest, interaction, combat, save, audio }
  ui,            // UIManager
  quality,       // 'low' | 'medium' | 'high'
  get time()     // 世界时间（0..1 一天）
  save(), load(), newGame()
}
```

主循环顺序（固定，勿改动）：

1. `input.update()` → 2. `player.update(dt)` → 3. `camera3p.update(dt)` → 4. `world.update(dt)`
→ 5. `systems.*.update(dt)`（stats → inventory → map → quest → combat → interaction）
→ 6. `ui.update(dt)` → 7. `engine.render()`

`dt` 已做上限钳制（≤ 1/20s）。

---

## 3. EventBus（`core/EventBus.js`）

```js
bus.on(type, fn) -> off   // 返回取消订阅函数
bus.once(type, fn)
bus.off(type, fn)
bus.emit(type, payload)
bus.has(type)
```

**跨系统事件表（必须严格遵守）**

| 事件 | payload | 发出者 → 监听者 |
|---|---|---|
| `player:spawn` | `{position}` | main → map/quest |
| `player:moved` | `{x,z,chunk}` | player → map |
| `player:damaged` | `{amount, source}` | combat → stats/hud |
| `player:died` | `{}` | stats → main/quest |
| `stat:changed` | `{id, value, max}` | stats → hud/statusPanel |
| `status:applied` / `status:removed` | `{id,name,duration}` | stats → hud/statusPanel |
| `inventory:changed` | `{item, count, action}` | inventory → ui |
| `item:used` | `{id, def}` | inventory → stats/quest |
| `item:collected` | `{id, count}` | interaction → inventory/quest |
| `poi:discovered` | `{id,name,type,x,z}` | map → quest/audio/ui |
| `shrine:lit` | `{id,name}` | interaction → quest/audio |
| `npc:talked` | `{id,name}` | interaction → quest |
| `enemy:killed` | `{id,type}` | combat → quest/stats |
| `quest:started` / `quest:objective` / `quest:completed` | `{...}` | quest → ui/audio |
| `interaction:focus` | `{label, key} \| null` | interaction → hud |
| `ui:toggle` | `{panel}` | input → ui |
| `game:saved` / `game:loaded` | `{}` | save → ui |
| `audio:sfx` | `{name, volume}` | 任意 → audio |

---

## 4. 世界与地形（`world/World.js`）

```js
world.group                     // 场景根（THREE.Group）
world.terrain                   // Terrain 实例
world.sampleHeight(x, z) -> number
world.sampleNormal(x, z) -> THREE.Vector3
world.addCollider({x,z,r})      // 圆柱碰撞（俯视）
world.addBoxCollider({x,z,hw,hd,rotY})
world.resolveCollisions(pos, radius) // 将位置推出碰撞体
world.pois                      // [{id, name, type, x, z, radius, discovered}]
world.getPoi(id)
world.nearestPoi(x, z, maxDist)
world.landmarks                 // [{id, name, object, x, z}]
```

POI 类型：`shrine`（圣火灯塔）/ `ruin` / `village` / `gate` / `tree` / `boss`。
建筑生成器通过 `world.addLandmark()` 注册，自动生成 POI 与碰撞体。

---

## 5. 构建套件 Kit（`world/architecture/Kit.js`）

所有建筑生成器**必须**使用 `Kit`，以获得统一的美术语言与极低的 draw call（每个材质合并为 1 次绘制）。

```js
import { Kit } from './Kit.js';

const kit = new Kit({ seed: 1234 });
kit.box(0.8, 6, 0.8, x, y, z, { color: COL.stone, mat: 'stone', rotY: 0.2 });
kit.cyl(0.5, 0.7, 3, 12, x, y, z, { color });
kit.cone(1.2, 3, 8, x, y, z, opts);
kit.sphere(0.6, 12, x, y, z, opts);
kit.geo(customGeometry, { color, mat, x, y, z, rx, ry, rz, sx, sy, sz });
kit.column(x, z, { h: 8, r: 0.6, color, mat, cap: true });
kit.archway(x, z, { w: 6, h: 9, t: 1.2, color, mat, rotY });
kit.window(x, y, z, { w: 1.2, h: 3, glow: true, rotY, mat });
kit.stairs(x, z, { w: 6, steps: 8, h: 0.3, d: 0.5, rotY, color });
kit.roofGable(x, z, { w: 12, d: 20, h: 6, color, mat, rotY });   // 人字屋顶
kit.spire(x, z, { h: 14, r: 3, color, mat });                       // 尖塔
kit.banner(x, y, z, { w: 1.2, h: 4, color, rotY });                 // 旗帜
kit.runeBand(x, y, z, { w: 5, h: 0.6, rotY, color });               // 发光符文带
kit.collider(x, z, r)                                               // 注册圆形碰撞
const obj = kit.build();   // THREE.Group，userData.bounds/colliders
```

- `mat` 取值：`stone` / `gold` / `bronze` / `wood` / `cloth` / `glass` / `ice` / `glow` / `marble`。
- `color` 取 `COL.*`（见 `Kit.js` 导出），不要用纯饱和色。
- 一次 `build()` 内所有部件世界坐标即为最终坐标（生成器返回的物体应**以原点为中心**，由 World 负责摆放）。
- 三角形预算：单个地标 ≤ 60k tris；重要地标（大教堂/世界树）≤ 150k tris。

---

## 6. 系统接口

所有系统是普通类，**不继承**基类，需实现以下方法（可选方法标注）：

```js
class XSystem {
  static id = 'x';
  constructor(game) {}
  init() {}            // 加入场景/订阅事件/构建 UI
  update(dt) {}        // 每帧
  toJSON() {}          // 存档（可省略）
  fromJSON(data) {}    // 读档（可省略）
  dispose() {}         // 可选
}
```

### 6.1 StatsSystem（`systems/StatsSystem.js`）

```js
stats.health, stats.maxHealth
stats.stamina, stats.maxStamina
stats.mana, stats.maxMana
stats.level, stats.xp
stats.statuses -> [{id,name,icon,remaining,duration,kind:'buff'|'debuff'}]
stats.damage(amount, source)
stats.heal(amount)
stats.consumeStamina(n) -> boolean   // 不足返回 false
stats.applyStatus({id,name,icon,duration,kind,tick})
stats.removeStatus(id)
stats.addXp(n)
```

### 6.2 InventorySystem（`systems/InventorySystem.js`）

```js
inventory.items  -> [{ id, count, def }]
inventory.add(id, count=1) -> boolean（背包已满返回 false）
inventory.remove(id, count=1) -> boolean
inventory.count(id) -> number
inventory.use(id) -> boolean
inventory.equip(id) / unequip(slot)
inventory.capacity = 24
```

物品定义 `data/items.js`：`{ id, name, latin, type:'consumable'|'material'|'relic'|'weapon'|'armor', rarity:'common'|'fine'|'rare'|'epic'|'mythic', glyph, desc, stack, weight, value, use:{...} }`

### 6.3 MapSystem（`systems/MapSystem.js`）

```js
map.reveal(x, z, radius)             // 战争迷雾，网格 8m
map.isRevealed(x, z) -> boolean
map.exploredRatio() -> 0..1
map.markers -> [{id,x,z,type,label,discovered}]
map.addMarker(marker) / removeMarker(id)
map.playerAngle() -> rad
map.renderMinimap(ctx, size, opts)   // 供 HUD 每帧调用
map.renderWorldMap(ctx, size, opts)  // 供大地图面板调用
map.toJSON() / fromJSON()
```

### 6.4 QuestSystem（`systems/QuestSystem.js`）

```js
quest.start(id) -> boolean
quest.state(id) -> 'locked'|'available'|'active'|'completed'|'failed'
quest.active -> [questInstance]
quest.tracked -> questInstance | null
quest.track(id)
quest.notify(eventType, payload)   // 内部订阅事件总线
quest.toJSON() / fromJSON()
```

任务定义 `data/quests.js`：
```js
{ id, title, latin, summary, level, region, giver, autoStart,
  stages: [{ id, text, objectives: [{ id, text, type:'collect'|'kill'|'reach'|'interact'|'light', target, count }] }],
  rewards: { xp, items:[{id,count}], gold } }
```

### 6.5 InteractionSystem（`systems/InteractionSystem.js`）

扫描 `game.world.interactables`（`{ id, position, radius, label, onInteract, once }`），
每帧找出最近可交互目标 → `bus.emit('interaction:focus', {label, key:'E'})`；按 F 触发。

### 6.6 AudioSystem（`systems/AudioSystem.js`）

```js
audio.init()               // 首次用户手势后调用
audio.play(name, {volume}) // 'ui_click'|'ui_open'|'ui_close'|'pickup'|'quest'|'shrine'|'hit'|'swing'|'jump'|'footstep'|'levelup'
audio.setAmbience(intensity)  // 0..1
audio.muted
```

纯 WebAudio 程序化合成（无音频文件）：Drone 和声 + 风噪 + 打击合成音。

---

## 7. UI 契约（`ui/UIManager.js`）

```js
ui.registerPanel({
  id: 'inventory',
  title: '行囊',
  latin: 'INVENTORY',
  hotkey: 'i',                 // 单字符，由 UIManager 统一绑定
  build(root, api) {},         // 首次打开时构建 DOM（root 是 .panel 内的内容容器）
  refresh(root, api) {},       // 每次打开 / 收到相关事件
  onClose() {}
});
ui.open(id) / close(id) / toggle(id) / closeAll() / isOpen(id)
ui.toast(text, { kind:'info'|'quest'|'item'|'danger', latin })   // 右下角提示
ui.banner(title, subtitle, { duration })                          // 屏幕中央史诗横幅
ui.slot('minimap'|'compass'|'questTracker'|'statusbar') -> HTMLElement   // HUD 预留插槽
ui.setHudVisible(bool)
```

打开面板时自动释放鼠标锁定、暂停玩家输入；关闭后恢复。

**HUD 预留插槽**（HUD.js 中）：
`#hud-minimap`、`#hud-compass`、`#hud-questtracker`、`#hud-statusbar`。

---

## 8. 视觉规范（`ui/styles/theme.css`）

史诗北欧-哥特风：黑曜石底 + 古金描边 + 极光青 + 血色点缀 + 衬线字体。

设计令牌（`theme.css` 的 `:root`）：

```
--ink / --ink-2 / --ink-3        背景层次
--gold / --gold-bright / --gold-dim
--frost（极光青） / --blood / --parchment
--text / --text-dim / --text-mute
--font-display（Cinzel + 中文衬线） / --font-body
--panel-bg / --panel-border / --shadow-panel
--dur-fast / --dur / --dur-slow / --ease-out
```

复用组件类：

| 类名 | 用途 |
|---|---|
| `.panel` + `.panel-frame` + `.panel-head` + `.panel-title` + `.panel-body` | 面板外框（切角+双金线） |
| `.rune-divider` | 标题下的符文分隔线 |
| `.stat-bar` + `.stat-bar__fill` + `.stat-bar--health/stamina/mana/xp` | 资源条 |
| `.slot` `.slot--rare` `.slot--epic` `.slot--mythic` `.slot__glyph` `.slot__count` | 物品格 |
| `.btn` `.btn--gold` `.btn--ghost` | 按钮 |
| `.tabs` `.tab` `.tab--active` | 页签 |
| `.rows` `.row` `.row--active` | 列表行 |
| `.kv` `.k` `.v` | 键值行 |
| `.tag` `.tag--buff` `.tag--debuff` | 状态标签 |
| `.scroll` | 细金滚动条容器 |
| `.glow-text` `.latin` | 发光标题 / 拉丁副标题 |

不允许：圆角大于 4px（切角为主）、亮蓝描边、emoji 作为主要图标（用符文/几何符号）。
面板打开动画：`scale(.96) + opacity` 200ms `--ease-out`。

---

## 9. 性能红线

- draw call 目标：≤ 220；三角形 ≤ 900k。
- 建筑必须合并几何（Kit.build），植被用 `InstancedMesh`。
- 阴影：仅太阳投影，`2048²`，紧凑 shadow camera 跟随玩家；远处关闭。
- 每帧不得进行 `new THREE.*` 的大量分配（复用临时向量）。
- 纹理按需生成，最大 1024²。
- UI 动画只用 `transform` / `opacity`；不使用 `filter: blur` 做大面积动画。
