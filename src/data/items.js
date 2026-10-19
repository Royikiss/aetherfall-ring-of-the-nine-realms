/**
 * data/items.js — 物品定义表（纯数据，无副作用）。
 *
 * rarity: common | fine | rare | epic | mythic
 * type:   consumable | material | relic | weapon | armor
 * glyph:  使用北欧卢恩符文作为图标（UI 中以黄金衬线字体呈现）
 *
 * use 字段由 InventorySystem 解释：
 *   heal / stamina / mana       立即恢复
 *   status: { id, name, icon, duration, kind, tick }  施加状态
 *   xp                           直接获得经验
 */
export const ITEMS = {
  // ---------------------------------------------------------------- 消耗品
  mead_horn: {
    id: 'mead_horn', name: '蜜酒角杯', latin: 'HORN OF MEAD',
    type: 'consumable', rarity: 'common', glyph: 'ᚢ',
    desc: '以古橡木与青铜箍成的角杯，盛着英灵殿的蜂蜜酒。饮下便觉暖意自胸腔升起。',
    stack: 9, weight: 0.6, value: 12,
    use: { heal: 22, stamina: 18 },
  },
  apple_idunn: {
    id: 'apple_idunn', name: '伊登的苹果', latin: 'APPLE OF IDUNN',
    type: 'consumable', rarity: 'rare', glyph: 'ᛁ',
    desc: '青春女神的金苹果。咬一口，伤口与疲惫一同消退。',
    stack: 5, weight: 0.3, value: 60,
    use: {
      heal: 45,
      status: { id: 'blessing_idunn', name: '青春祝福', icon: 'ᛁ', duration: 45, kind: 'buff' },
    },
  },
  frost_tonic: {
    id: 'frost_tonic', name: '霜寒药剂', latin: 'FROST TONIC',
    type: 'consumable', rarity: 'fine', glyph: 'ᛊ',
    desc: '矮人以冰湖之水蒸馏的药剂，饮下后血液如霜，不惧约顿海姆的寒风。',
    stack: 9, weight: 0.4, value: 35,
    use: {
      mana: 25,
      status: { id: 'warm_blood', name: '霜血', icon: 'ᛊ', duration: 60, kind: 'buff' },
    },
  },
  rune_draught: {
    id: 'rune_draught', name: '符文灵药', latin: 'RUNE DRAUGHT',
    type: 'consumable', rarity: 'rare', glyph: 'ᚨ',
    desc: '瓶中悬浮着细小的发光符文，饮下时它们在喉间低语。',
    stack: 5, weight: 0.4, value: 55,
    use: { mana: 50, heal: 10 },
  },
  wolf_jerky: {
    id: 'wolf_jerky', name: '狼肉干', latin: 'WOLF JERKY',
    type: 'consumable', rarity: 'common', glyph: 'ᚹ',
    desc: '猎人随身的口粮，咸得发苦，但足以撑过一场风雪。',
    stack: 12, weight: 0.2, value: 8,
    use: { stamina: 30, heal: 6 },
  },

  // ---------------------------------------------------------------- 材料
  sage_herb: {
    id: 'sage_herb', name: '贤者草', latin: 'SAGE OF THE GROVE',
    type: 'material', rarity: 'common', glyph: 'ᚷ',
    desc: '生长在华纳海姆圣林边缘的银叶草，祭司用它熏净祭坛。',
    stack: 20, weight: 0.1, value: 6,
  },
  iron_ore: {
    id: 'iron_ore', name: '陨铁矿石', latin: 'STARFORGED IRON',
    type: 'material', rarity: 'fine', glyph: 'ᛏ',
    desc: '尼达维利尔的矿脉中开采的金属，敲击时会发出清越的鸣响。',
    stack: 20, weight: 0.5, value: 14,
  },
  wolf_pelt: {
    id: 'wolf_pelt', name: '霜狼之皮', latin: 'PELT OF THE FROST WOLF',
    type: 'material', rarity: 'fine', glyph: 'ᚦ',
    desc: '完整的白色狼皮，毛尖凝结着细小的冰晶。',
    stack: 10, weight: 0.8, value: 22,
  },
  draugr_bone: {
    id: 'draugr_bone', name: '尸鬼骨片', latin: 'DRAUGR OSSUARY',
    type: 'material', rarity: 'fine', glyph: 'ᚾ',
    desc: '仍然残留着阴冷气息的骨片，触碰时指尖会发麻。',
    stack: 20, weight: 0.3, value: 18,
  },
  rune_fragment: {
    id: 'rune_fragment', name: '符文碎片', latin: 'RUNE FRAGMENT',
    type: 'relic', rarity: 'rare', glyph: 'ᛟ',
    desc: '从远古石碑上崩落的碎片，边缘仍在缓慢流动着金色的光。',
    stack: 12, weight: 0.2, value: 0,
  },
  rune_stone: {
    id: 'rune_stone', name: '符文石', latin: 'RUNE STONE',
    type: 'relic', rarity: 'mythic', glyph: 'ᛞ',
    desc: '点亮圣火所需的引信。石中封存着一缕世界树的火光，握在手中时会微微发烫。',
    stack: 9, weight: 0.3, value: 0,
  },
  horn_heimdall: {
    id: 'horn_heimdall', name: '海姆达尔之角', latin: 'GJALLARHORN',
    type: 'relic', rarity: 'mythic', glyph: 'ᚺ',
    desc: '守望者的号角，据说它的声音能穿过九界。号角本身已经黯淡，等待被火重新唤醒。',
    stack: 1, weight: 1.2, value: 0,
  },

  // ---------------------------------------------------------------- 装备
  sword_einherjar: {
    id: 'sword_einherjar', name: '英灵之剑', latin: 'EINHERJAR BLADE',
    type: 'weapon', rarity: 'fine', glyph: 'ᛇ',
    desc: '断过一次又重铸的剑。剑脊上有十二道刻痕，每一道都是一次死亡。',
    stack: 1, weight: 3.2, value: 180,
    equip: { slot: 'weapon', damage: 26, attackSpeed: 1.0 },
  },
  shield_ash: {
    id: 'shield_ash', name: '梣木圆盾', latin: 'ASHEN ROUNDSHIELD',
    type: 'armor', rarity: 'fine', glyph: 'ᛒ',
    desc: '以世界树的枝干削成，盾面绘着缠绕的符文蛇。',
    stack: 1, weight: 2.4, value: 90,
    equip: { slot: 'shield', armor: 6, staminaRegen: 0.15 },
  },
  cloak_raven: {
    id: 'cloak_raven', name: '渡鸦斗篷', latin: 'RAVEN CLOAK',
    type: 'armor', rarity: 'rare', glyph: 'ᚱ',
    desc: '奥丁的渡鸦在夜里飞过时落下的羽毛织成的斗篷。穿上它，风会为你让路。',
    stack: 1, weight: 1.6, value: 210,
    equip: { slot: 'cloak', armor: 4, moveSpeed: 0.12 },
  },
  amulet_yggdrasil: {
    id: 'amulet_yggdrasil', name: '世界树护符', latin: 'YGGDRASIL AMULET',
    type: 'relic', rarity: 'epic', glyph: 'ᛉ',
    desc: '一枚小小的木质护符，刻着九条枝干。贴近耳边能听见极远处的风声。',
    stack: 1, weight: 0.2, value: 320,
    equip: { slot: 'amulet', maxHealth: 20, manaRegen: 0.2 },
  },
  gauntlet_forge: {
    id: 'gauntlet_forge', name: '锻炉护手', latin: 'FORGE GAUNTLETS',
    type: 'armor', rarity: 'epic', glyph: 'ᛗ',
    desc: '矮人匠人的遗物，指节处嵌着尚未冷却的赤红矿石。',
    stack: 1, weight: 2.0, value: 260,
    equip: { slot: 'hands', armor: 8, damage: 6 },
  },
};

/** 按 id 取定义，未知 id 返回占位定义（防止存档损坏导致崩溃） */
export function getItem(id) {
  return ITEMS[id] || {
    id, name: id, latin: 'UNKNOWN', type: 'material', rarity: 'common',
    glyph: '?', desc: '来历不明的物品。', stack: 1, weight: 0, value: 0,
  };
}

/** 稀有度展示信息 */
export const RARITY = {
  common: { name: '普通', color: '#b9b2a2' },
  fine: { name: '精良', color: '#7fb4c9' },
  rare: { name: '稀有', color: '#8fd8ef' },
  epic: { name: '史诗', color: '#e8c76a' },
  mythic: { name: '神话', color: '#e88a6f' },
};

export const ITEM_CATEGORIES = [
  { id: 'all', name: '全部', glyph: 'ᛟ' },
  { id: 'consumable', name: '消耗', glyph: 'ᚢ' },
  { id: 'material', name: '材料', glyph: 'ᚷ' },
  { id: 'relic', name: '遗物', glyph: 'ᛞ' },
  { id: 'weapon', name: '武器', glyph: 'ᛇ' },
  { id: 'armor', name: '护甲', glyph: 'ᛒ' },
];
