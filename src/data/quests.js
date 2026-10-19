/**
 * data/quests.js — 任务定义表（纯数据，无副作用）。
 *
 * 结构（严格对应 docs/ARCH.md §6.4）：
 *   {
 *     id, title, latin, summary, level, region, giver, autoStart,
 *     stages: [{ id, text, objectives: [{ id, text, type, target, count }] }],
 *     rewards: { xp, items: [{ id, count }], gold }
 *   }
 *   type: 'collect' | 'kill' | 'reach' | 'interact' | 'light'
 *   target:
 *     collect  → items.js 中的物品 id
 *     kill     → 敌人类型 / id 前缀（如 frost_wolf）
 *     reach    → 世界 POI id（如 poi_great_hall；两侧都会做 poi_ 前缀归一化）
 *     interact → NPC id（如 npc_warden）
 *     light    → 圣火灯塔 id（BEACONS / LANDMARKS 的 id，如 shrine_north）
 *
 * 任务链：QUEST_CHAIN 中的任务按顺序自动接续（前一条完成后 start 下一条）。
 * 支线通过 NPC 对话开启：QUEST_TRIGGERS 建立「NPC id → 任务 id」的映射。
 */

/** 主线顺序（1→2→3→4） */
export const QUEST_CHAIN = ['main_awaken', 'main_runes', 'main_frost', 'main_ring'];

/** 全部任务的展示顺序（先主线，后支线） */
export const QUEST_ORDER = [...QUEST_CHAIN, 'side_sage', 'side_barrow'];

/**
 * 对话触发的任务：npc:talked 时，若该任务尚未开始则自动接取。
 * （主线交给 QUEST_CHAIN 自动接续，支线由所在 NPC 开启。）
 */
export const QUEST_TRIGGERS = {
  // Landmarks 的 npc:talked 事件携带的是 npc 配置 id（warden / herbalist / smith）
  warden: 'main_awaken',
  npc_warden: 'main_awaken',
  herbalist: 'side_sage',
  npc_herbalist: 'side_sage',
  gravekeeper: 'side_barrow',
  npc_gravekeeper: 'side_barrow',
};

/** 任务类型 → 中文标签（面板与追踪器共用） */
export const OBJECTIVE_KIND = {
  collect: '收集',
  kill: '讨伐',
  reach: '抵达',
  interact: '交谈',
  light: '点亮',
};

export const QUESTS = {
  // =============================================================== 主线 一
  main_awaken: {
    id: 'main_awaken',
    title: '灰烬中苏醒',
    latin: 'AWAKENING FROM ASH',
    summary:
      '长夜未止。你自灰烬中睁眼，胸腔里只剩一缕尚未熄灭的火。'
      + '英灵殿的金门在北方等候——那是所有亡者的归处，也是这场长冬真正的起点。'
      + '守门人仍站在那里，他的号角已经很久没有响过了。',
    level: 1,
    region: 'midgard',
    giver: '命运女神 · 乌尔德',
    autoStart: true,
    stages: [
      {
        id: 'journey',
        text: '沿古道向北，抵达英灵殿 · 金宫',
        objectives: [
          { id: 'reach_hall', text: '抵达英灵殿 · 金宫', type: 'reach', target: 'poi_great_hall', count: 1 },
        ],
      },
      {
        id: 'warden',
        text: '听守门人讲述九界的境况',
        objectives: [
          { id: 'talk_warden', text: '与守门人交谈', type: 'interact', target: 'npc_warden', count: 1 },
        ],
      },
    ],
    rewards: {
      xp: 120,
      gold: 40,
      items: [
        { id: 'mead_horn', count: 2 },
        { id: 'sword_einherjar', count: 1 },
      ],
    },
  },

  // =============================================================== 主线 二
  main_runes: {
    id: 'main_runes',
    title: '失落的符文',
    latin: 'THE LOST RUNES',
    summary:
      '九界的火种熄灭时，符文石碎作流萤，散落在苔原、废址与石环之间。'
      + '拾回三枚碎片，再以世界树的一缕火光为引，让北境的圣火重新睁眼。'
      + '风会替你记住走过的路——但风也会遗忘。',
    level: 2,
    region: 'asgard',
    giver: '守门人 · 海姆达尔',
    autoStart: false,
    stages: [
      {
        id: 'gather',
        text: '在九界各处的石环与废址间拾回符文碎片',
        objectives: [
          { id: 'collect_rune', text: '收集符文碎片', type: 'collect', target: 'rune_fragment', count: 3 },
        ],
      },
      {
        id: 'light_north',
        text: '登上北境灯塔，以符文石点亮圣火',
        objectives: [
          { id: 'light_north', text: '点亮北境圣火', type: 'light', target: 'shrine_north', count: 1 },
        ],
      },
    ],
    rewards: {
      xp: 260,
      gold: 80,
      items: [
        { id: 'rune_stone', count: 1 },
        { id: 'rune_draught', count: 1 },
      ],
    },
  },

  // =============================================================== 主线 三
  main_frost: {
    id: 'main_frost',
    title: '霜巨人的低语',
    latin: 'WHISPERS OF THE FROST GIANTS',
    summary:
      '霜崖之上，风用古老的语调数着日子，像在清点尚未归还的名字。'
      + '瞭望塔的残垣间，霜狼循着你的气味聚拢过来——它们的眼睛里映着约顿海姆的蓝。'
      + '塔顶的守望者说：霜巨人从不入睡，他们只是在低语。',
    level: 3,
    region: 'jotunheim',
    giver: '霜崖守望者 · 斯卡尔德',
    autoStart: false,
    stages: [
      {
        id: 'climb',
        text: '翻过霜脊，抵达瞭望塔旧址',
        objectives: [
          { id: 'reach_watch', text: '抵达霜崖瞭望塔', type: 'reach', target: 'poi_watch_tower', count: 1 },
        ],
      },
      {
        id: 'hunt',
        text: '清剿盘踞在塔下的霜狼',
        objectives: [
          { id: 'kill_wolves', text: '击杀霜狼', type: 'kill', target: 'frost_wolf', count: 3 },
        ],
      },
    ],
    rewards: {
      xp: 380,
      gold: 120,
      items: [
        { id: 'wolf_pelt', count: 2 },
        { id: 'frost_tonic', count: 2 },
      ],
    },
  },

  // =============================================================== 主线 四
  main_ring: {
    id: 'main_ring',
    title: '九界之环',
    latin: 'RING OF THE NINE REALMS',
    summary:
      '四座灯塔，四种风。北境的霜、东岸的雷、南原的雨、西谷的炉火——'
      + '当极光重新缠绕世界树的根系，命运之环才算重新扣合。'
      + '而阿斯加德的界门，只为最后一个英灵开启。',
    level: 5,
    region: 'asgard',
    giver: '命运女神 · 乌尔德',
    autoStart: false,
    stages: [
      {
        id: 'beacons',
        text: '点亮四境圣火，重燃九界之环',
        objectives: [
          { id: 'light_n', text: '点亮北境圣火', type: 'light', target: 'shrine_north', count: 1 },
          { id: 'light_e', text: '点亮东境圣火', type: 'light', target: 'shrine_east', count: 1 },
          { id: 'light_s', text: '点亮南境圣火', type: 'light', target: 'shrine_south', count: 1 },
          { id: 'light_w', text: '点亮西境圣火', type: 'light', target: 'shrine_west', count: 1 },
        ],
      },
      {
        id: 'gate',
        text: '穿过霜河石桥，走向彩虹桥的尽头',
        objectives: [
          { id: 'reach_gate', text: '抵达阿斯加德界门', type: 'reach', target: 'poi_gate_asgard', count: 1 },
        ],
      },
    ],
    rewards: {
      xp: 1200,
      gold: 400,
      items: [
        { id: 'amulet_yggdrasil', count: 1 },
        { id: 'horn_heimdall', count: 1 },
        { id: 'apple_idunn', count: 2 },
      ],
    },
  },

  // =============================================================== 支线 一
  side_sage: {
    id: 'side_sage',
    title: '贤者的请求',
    latin: "THE HERBALIST'S PLEA",
    summary:
      '南边长屋村的草药师守着最后一炉熏香。祭坛已冷，死者无人安魂。'
      + '她需要五株贤者草，为亡者点一炷烟——「烟升到哪一层，他们就在哪一层醒来。」',
    level: 2,
    region: 'midgard',
    giver: '草药师 · 西格恩',
    autoStart: false,
    stages: [
      {
        id: 'gather',
        text: '在圣林边缘采集贤者草',
        objectives: [
          { id: 'collect_herb', text: '采集贤者草', type: 'collect', target: 'sage_herb', count: 5 },
        ],
      },
      {
        id: 'return',
        text: '把贤者草交还给草药师',
        objectives: [
          { id: 'talk_herbalist', text: '与草药师 · 西格恩交谈', type: 'interact', target: 'npc_herbalist', count: 1 },
        ],
      },
    ],
    rewards: {
      xp: 180,
      gold: 60,
      items: [
        { id: 'apple_idunn', count: 1 },
        { id: 'wolf_jerky', count: 3 },
      ],
    },
  },

  // =============================================================== 支线 二
  side_barrow: {
    id: 'side_barrow',
    title: '古坟的低语',
    latin: 'WHISPERS OF THE BARROW',
    summary:
      '古坟岗的封土被从内侧推开。尸鬼在夜里列队行走，它们记得自己的名字，'
      + '也记得杀死自己的人。巡夜人只求你一件事：让它们重新躺下。',
    level: 3,
    region: 'asgard',
    giver: '巡夜人 · 霍尔',
    autoStart: false,
    stages: [
      {
        id: 'cleanse',
        text: '净化在坟岗游荡的尸鬼',
        objectives: [
          { id: 'kill_draugr', text: '击杀尸鬼', type: 'kill', target: 'draugr', count: 5 },
        ],
      },
      {
        id: 'barrow',
        text: '走近古坟岗，封上被推开的墓门',
        objectives: [
          { id: 'reach_barrow', text: '抵达古坟岗', type: 'reach', target: 'poi_barrow', count: 1 },
        ],
      },
    ],
    rewards: {
      xp: 340,
      gold: 110,
      items: [
        { id: 'draugr_bone', count: 3 },
        { id: 'iron_ore', count: 2 },
        { id: 'frost_tonic', count: 1 },
      ],
    },
  },
};

/** 按 id 取任务定义（未知 id 返回 null，便于调用方判断） */
export function getQuest(id) {
  return QUESTS[id] || null;
}

/** 任务链中的下一条 */
export function nextInChain(id) {
  const i = QUEST_CHAIN.indexOf(id);
  if (i < 0 || i >= QUEST_CHAIN.length - 1) return null;
  return QUEST_CHAIN[i + 1];
}
