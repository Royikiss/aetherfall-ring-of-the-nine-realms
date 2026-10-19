/**
 * data/world.js — 世界布局数据（纯数据）。
 *
 * 世界坐标范围 [-1200, 1200]，Y 轴向上，单位米。
 * 所有地标以「原点在建筑中心 / 底部贴地」的方式摆放；
 * Landmarks.js 会调用对应 builder 生成几何，并注册 POI 与碰撞体。
 */
export const WORLD = {
  seed: 20261019,
  size: 2400,          // 世界边长
  half: 1200,
  waterLevel: -7.2,    // 水面高度
  seaLevel: 0,
  fogFar: 980,
  /** 玩家出生点 */
  spawn: { x: 24, z: 322, heading: Math.PI },
  /** 地形起伏参数 */
  terrain: {
    amplitude: 62,
    mountainStart: 0.52, // 距离中心的归一化半径，之外开始隆起山脉
    river: { x: -300, width: 46, depth: 34 },
  },
};

/**
 * 区域（用于地图标注、任务区域、氛围）。
 * angle/halfAngle 为地图扇形标注用（弧度）。
 */
export const REGIONS = [
  { id: 'yggdrasil', name: '尤克特拉希尔', latin: 'YGGDRASIL', cx: 0, cz: 0, color: '#c9a45c' },
  { id: 'asgard', name: '阿斯加德 · 金宫环', latin: 'ASGARD', cx: -20, cz: -520, color: '#f0dca0' },
  { id: 'jotunheim', name: '约顿海姆 · 霜崖', latin: 'JOTUNHEIM', cx: 700, cz: -180, color: '#9fd6e8' },
  { id: 'midgard', name: '米德加尔特 · 长屋原野', latin: 'MIDGARD', cx: 60, cz: 520, color: '#9fb27a' },
  { id: 'nidavellir', name: '尼达维利尔 · 锻炉深谷', latin: 'NIDAVELLIR', cx: -700, cz: 120, color: '#e8916a' },
];

/**
 * 主要地标。
 * builder 对应 world/architecture/index.js 中 BUILDERS 的键。
 * flatten: 地形压平半径（让建筑不会陷进山坡）。
 * poi: 地图兴趣点信息（type: shrine|hall|village|ruin|gate|tree|boss）。
 */
export const LANDMARKS = [
  {
    id: 'tree_yggdrasil', builder: 'worldTree', name: '世界树 · 尤克特拉希尔', latin: 'YGGDRASIL',
    x: 0, z: 0, rotY: 0, scale: 1,
    flatten: 88, flattenStrength: 0.92,
    poi: { type: 'tree', radius: 96, label: '世界树' },
  },
  {
    id: 'great_hall', builder: 'greatHall', name: '英灵殿 · 金宫', latin: 'VALHALLA',
    x: -20, z: -420, rotY: 0, scale: 1.15,
    flatten: 96, flattenStrength: 0.96,
    poi: { type: 'hall', radius: 86, label: '英灵殿' },
  },
  {
    id: 'cathedral', builder: 'cathedral', name: '圣白大教堂', latin: 'CATHEDRAL OF THE WHITE',
    x: -128, z: -604, rotY: 0.16, scale: 0.92,
    flatten: 88, flattenStrength: 0.96,
    poi: { type: 'ruin', radius: 72, label: '圣白大教堂' },
  },
  {
    id: 'colossus', builder: 'colossus', name: '守望者巨像', latin: 'THE WATCHER',
    x: 268, z: -486, rotY: -0.42, scale: 1,
    flatten: 46, flattenStrength: 0.95,
    poi: { type: 'ruin', radius: 54, label: '守望者巨像' },
  },
  {
    id: 'gate_asgard', builder: 'gate', name: '阿斯加德界门', latin: 'BIFROST GATE',
    x: 6, z: -712, rotY: 0, scale: 1.1,
    flatten: 54, flattenStrength: 0.94,
    poi: { type: 'gate', radius: 62, label: '界门' },
  },
  {
    id: 'shrine_north', builder: 'tower', name: '圣火灯塔 · 北', latin: 'BEACON OF THE NORTH',
    x: 92, z: -780, rotY: 0.2, scale: 1.15,
    flatten: 26, flattenStrength: 0.95,
    poi: { type: 'shrine', radius: 34, label: '北境圣火' },
    beacon: true,
  },
  {
    id: 'shrine_east', builder: 'tower', name: '圣火灯塔 · 东', latin: 'BEACON OF THE EAST',
    x: 780, z: -32, rotY: -0.4, scale: 1.15,
    flatten: 26, flattenStrength: 0.95,
    poi: { type: 'shrine', radius: 34, label: '东境圣火' },
    beacon: true,
  },
  {
    id: 'shrine_south', builder: 'tower', name: '圣火灯塔 · 南', latin: 'BEACON OF THE SOUTH',
    x: 132, z: 782, rotY: 0.7, scale: 1.15,
    flatten: 26, flattenStrength: 0.95,
    poi: { type: 'shrine', radius: 34, label: '南境圣火' },
    beacon: true,
  },
  {
    id: 'shrine_west', builder: 'tower', name: '圣火灯塔 · 西', latin: 'BEACON OF THE WEST',
    x: -812, z: 84, rotY: 0.1, scale: 1.15,
    flatten: 26, flattenStrength: 0.95,
    poi: { type: 'shrine', radius: 34, label: '西境圣火' },
    beacon: true,
  },
  {
    id: 'watch_tower', builder: 'tower', name: '霜崖瞭望塔', latin: 'FROSTWATCH SPIRE',
    x: 566, z: -262, rotY: 1.1, scale: 0.9,
    flatten: 24, flattenStrength: 0.9,
    poi: { type: 'ruin', radius: 30, label: '霜崖瞭望塔' },
  },
  {
    id: 'stone_circle', builder: 'ruins', name: '低语石环', latin: 'WHISPERING CIRCLE',
    x: 438, z: 246, rotY: 0.6, scale: 1.15,
    flatten: 34, flattenStrength: 0.9,
    poi: { type: 'ruin', radius: 42, label: '低语石环' },
  },
  {
    id: 'village_midgard', builder: 'village', name: '长屋村 · 阿斯克', latin: "ASK'S STEAD",
    x: 96, z: 486, rotY: -0.2, scale: 1,
    flatten: 66, flattenStrength: 0.96,
    poi: { type: 'village', radius: 66, label: '长屋村' },
  },
  {
    id: 'bridge_bifrost', builder: 'bridge', name: '霜河石桥', latin: 'FROST RIVER BRIDGE',
    x: -282, z: 168, rotY: 0, scale: 1,
    flatten: 60, flattenStrength: 0.8,
    poi: { type: 'gate', radius: 46, label: '霜河石桥' },
    bridge: { length: 96, width: 9, height: 34 },
  },
  {
    id: 'forge_ruins', builder: 'ruins', name: '锻炉废址', latin: 'FORGE OF THE DWARVES',
    x: -690, z: -210, rotY: -0.3, scale: 1.3, variant: 1,
    flatten: 54, flattenStrength: 0.92,
    poi: { type: 'ruin', radius: 52, label: '锻炉废址' },
  },
];

/** 额外的"无几何"发现点，用于填充探索感 */
export const EXTRA_POIS = [
  { id: 'poi_lake', name: '镜湖', latin: 'MIRROR LAKE', type: 'ruin', x: -640, z: 520, radius: 30 },
  { id: 'poi_ravine', name: '风语裂谷', latin: 'WINDCALL RAVINE', type: 'ruin', x: 620, z: 560, radius: 30 },
  { id: 'poi_barrow', name: '古坟岗', latin: 'THE BARROWS', type: 'boss', x: -520, z: -640, radius: 30 },
];

/** 圣火灯塔（任务核心） */
export const BEACONS = ['shrine_north', 'shrine_east', 'shrine_south', 'shrine_west'];

/** 地图上的道路（世界坐标折线，用于地图绘制与地形压平参考） */
export const ROADS = [
  { id: 'road_center_north', points: [[24, 322], [10, 160], [0, 40], [-6, -180], [-20, -300], [-20, -380]] },
  { id: 'road_village', points: [[10, 160], [60, 300], [96, 430], [96, 486]] },
  { id: 'road_west', points: [[-6, -180], [-120, -120], [-300, 20], [-300, 150], [-420, 0], [-690, -180]] },
  { id: 'road_east', points: [[-6, -180], [180, -220], [340, -160], [520, -240], [700, -120]] },
];
