/**
 * ui/QuestPanel.js — 「任务纪事」面板。
 *
 * 布局：左侧任务列表（进行中 / 可接取 / 已完成）· 右侧详情（标题、拉丁名、区域、
 * 描述、目标进度、奖赏）· 底部「追踪」按钮。
 *
 * 面板注册信息：id 'quest'，title '任务纪事'，latin 'SAGA'，hotkey 'l'
 * 只读展示 + 两个动作（追踪 / 接受），所有状态变更都通过 QuestSystem。
 */
import { REGIONS } from '../data/world.js';
import { getItem, RARITY } from '../data/items.js';

const STATE_LABEL = {
  active: '进行中',
  available: '可接取',
  completed: '已完成',
  locked: '未解锁',
  failed: '已失败',
};

export class QuestPanel {
  constructor(game, questSystem) {
    this.game = game;
    this.qs = questSystem;
    this.ui = game?.ui;
    this._selId = null;
    this._sig = '';
    this.root = null;
    this._nodes = null;
  }

  // ================================================================ 注册
  definition() {
    return {
      id: 'quest',
      title: '任务纪事',
      latin: 'SAGA',
      hotkey: 'l',
      build: (body) => this.build(body),
      refresh: () => this.refresh(),
      onOpen: () => this.refresh(),
    };
  }

  build(body) {
    body.innerHTML = `
      <div class="mq-quest">
        <aside class="mq-quest__list">
          <div class="mq-qgroup" data-group="active">
            <div class="mq-qgroup__head"><span>进行中</span><i class="mq-qgroup__line"></i><b>0</b></div>
            <div class="mq-qgroup__body"></div>
          </div>
          <div class="mq-qgroup" data-group="available">
            <div class="mq-qgroup__head"><span>可接取</span><i class="mq-qgroup__line"></i><b>0</b></div>
            <div class="mq-qgroup__body"></div>
          </div>
          <div class="mq-qgroup" data-group="completed">
            <div class="mq-qgroup__head"><span>已完成</span><i class="mq-qgroup__line"></i><b>0</b></div>
            <div class="mq-qgroup__body"></div>
          </div>
        </aside>

        <section class="mq-qdetail">
          <header class="mq-qdetail__head">
            <div class="mq-qdetail__titles">
              <h3 class="mq-qdetail__title">—</h3>
              <div class="mq-qdetail__latin latin">—</div>
            </div>
            <div class="mq-qdetail__tags">
              <span class="tag" data-tag="region">—</span>
              <span class="tag" data-tag="level">—</span>
              <span class="tag tag--quest" data-tag="state">—</span>
            </div>
          </header>
          <div class="rune-divider"></div>
          <div class="mq-qdetail__scroll scroll">
            <p class="mq-qdetail__summary"></p>
            <div class="mq-qsection">
              <div class="mq-subtitle">目 标<i class="latin">OBJECTIVES</i></div>
              <div class="mq-stagepips"></div>
              <div class="mq-qstage"></div>
              <ul class="mq-objlist"></ul>
            </div>
            <div class="mq-qsection">
              <div class="mq-subtitle">奖 赏<i class="latin">REWARDS</i></div>
              <div class="mq-rewards"></div>
            </div>
          </div>
          <footer class="mq-qdetail__foot">
            <span class="mq-qdetail__hint latin">SAGA OF THE NINE REALMS</span>
            <button class="btn btn--gold btn--sm" data-act="track">追 踪</button>
          </footer>
        </section>
      </div>`;

    this.root = body;
    this._nodes = {
      groups: {},
      title: body.querySelector('.mq-qdetail__title'),
      latin: body.querySelector('.mq-qdetail__latin'),
      region: body.querySelector('[data-tag="region"]'),
      level: body.querySelector('[data-tag="level"]'),
      state: body.querySelector('[data-tag="state"]'),
      summary: body.querySelector('.mq-qdetail__summary'),
      pips: body.querySelector('.mq-stagepips'),
      objectives: body.querySelector('.mq-objlist'),
      stageLine: body.querySelector('.mq-qstage'),
      rewards: body.querySelector('.mq-rewards'),
      trackBtn: body.querySelector('[data-act="track"]'),
    };
    for (const group of body.querySelectorAll('.mq-qgroup')) {
      this._nodes.groups[group.dataset.group] = {
        body: group.querySelector('.mq-qgroup__body'),
        count: group.querySelector('.mq-qgroup__head b'),
      };
    }

    // 事件委托：任务行选择 + 追踪/接受
    body.addEventListener('click', (e) => {
      const trackBtn = e.target.closest?.('[data-act="track"]');
      if (trackBtn) { this._onTrackClick(); return; }
      const row = e.target.closest?.('[data-quest-id]');
      if (row) {
        this._selId = row.dataset.questId;
        this._renderDetail();
        this._syncActiveRows();
        this.game?.systems?.audio?.play?.('ui_click', { volume: 0.35 });
      }
    });

    this._sig = '';
    this.refresh();
  }

  // ================================================================ 刷新
  refresh() {
    if (!this.root) return;
    const sig = this._signature();
    if (sig !== this._sig) {
      this._sig = sig;
      this._renderGroups();
      this._renderDetail();
    }
  }

  _signature() {
    const parts = [];
    for (const inst of this.qs?.quests || []) {
      parts.push(`${inst.def.id}:${inst.state}:${inst.stageIndex}:`
        + (inst.objectives || []).map((o) => `${o.progress}${o.done ? 'd' : ''}`).join('.'));
    }
    return `${this._selId || ''}#${this.qs?.tracked?.def?.id || ''}#${parts.join('|')}`;
  }

  /** 当前选中的任务实例（未选择时回落到追踪/进行中的第一条） */
  _selected() {
    const all = this.qs?.quests || [];
    if (this._selId) {
      const found = all.find((q) => q.def.id === this._selId);
      if (found) return found;
    }
    const tracked = this.qs?.tracked;
    if (tracked) return tracked;
    const active = this.qs?.active || [];
    if (active.length) return active[0];
    return this._firstOf('available') || this._firstOf('completed');
  }

  _firstOf(state) {
    for (const q of this.qs?.quests || []) {
      if (q.state === state) return q;
    }
    return null;
  }

  _renderGroups() {
    const groups = { active: [], available: [], completed: [] };
    for (const inst of this.qs?.quests || []) {
      if (groups[inst.state]) groups[inst.state].push(inst);
    }
    // 进行中：追踪中的排在最前
    const trackedId = this.qs?.tracked?.def?.id;
    groups.active.sort((a, b) => (b.def.id === trackedId ? 1 : 0) - (a.def.id === trackedId ? 1 : 0));

    const selected = this._selected();
    for (const key of Object.keys(groups)) {
      const node = this._nodes.groups[key];
      if (!node) continue;
      const list = groups[key];
      node.count.textContent = String(list.length);
      node.body.innerHTML = '';
      if (!list.length) {
        const hint = document.createElement('div');
        hint.className = 'mq-qgroup__empty';
        hint.textContent = key === 'active' ? '尚无进行中的使命' : key === 'available' ? '暂无可接取的使命' : '尚未完成任何使命';
        node.body.appendChild(hint);
        continue;
      }
      const frag = document.createDocumentFragment();
      for (const inst of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mq-qrow' + (selected === inst ? ' is-active' : '');
        btn.dataset.questId = inst.def.id;
        const isTracked = inst.def.id === trackedId;
        btn.innerHTML = `
          <span class="mq-qrow__mark">${isTracked ? '◆' : inst.state === 'completed' ? '✓' : '◇'}</span>
          <span class="mq-qrow__body">
            <span class="mq-qrow__title">${this._esc(inst.def.title)}</span>
            <span class="mq-qrow__latin latin">${this._esc(inst.def.latin)}</span>
          </span>
          <span class="mq-qrow__level">Lv.${inst.def.level}</span>`;
        frag.appendChild(btn);
      }
      node.body.appendChild(frag);
    }
  }

  _syncActiveRows() {
    const selected = this._selected();
    for (const row of this.root.querySelectorAll('.mq-qrow')) {
      const on = selected && row.dataset.questId === selected.def.id;
      row.classList.toggle('is-active', !!on);
    }
  }

  _renderDetail() {
    const n = this._nodes;
    const inst = this._selected();
    if (!inst) {
      n.title.textContent = '暂无使命';
      n.latin.textContent = 'NO SAGA';
      n.region.textContent = '—';
      n.level.textContent = '—';
      n.state.textContent = '—';
      n.summary.textContent = '九界沉寂，尚无使命降临。';
      n.objectives.innerHTML = '';
      n.pips.innerHTML = '';
      n.rewards.innerHTML = '<div class="empty-hint">无</div>';
      n.trackBtn.disabled = true;
      n.trackBtn.textContent = '追 踪';
      return;
    }

    const def = inst.def;
    n.title.textContent = def.title;
    n.latin.textContent = def.latin;
    n.region.textContent = this._regionName(def.region);
    n.level.textContent = `建议等级 ${def.level}`;
    n.state.textContent = STATE_LABEL[inst.state] || inst.state;
    n.summary.textContent = def.summary;

    // 阶段指示：每幕一个小菱形
    n.pips.innerHTML = (def.stages || []).map((s, i) => {
      const cls = inst.state === 'completed' || i < inst.stageIndex ? 'is-done' : i === inst.stageIndex ? 'is-current' : '';
      return `<i class="mq-pip ${cls}" title="${this._esc(s.text)}"></i>`;
    }).join('');

    // 目标：进行中显示当前阶段，已完成显示最终阶段（全部打勾），可接取显示第一幕预告
    let objectives = [];
    let stageLabel = '';
    if (inst.state === 'active') {
      objectives = inst.objectives;
      stageLabel = `第 ${inst.stageIndex + 1} / ${def.stages.length} 幕 · ${inst.stage?.text || ''}`;
    } else if (inst.state === 'completed') {
      const last = def.stages[def.stages.length - 1];
      objectives = (last?.objectives || []).map((o) => ({ def: o, progress: o.count, done: true }));
      stageLabel = '使命已成';
    } else {
      const first = def.stages[0];
      objectives = (first?.objectives || []).map((o) => ({ def: o, progress: 0, done: false }));
      stageLabel = `第一幕 · ${first?.text || ''}`;
    }

    if (n.stageLine) n.stageLine.textContent = stageLabel;

    n.objectives.innerHTML = objectives.map((o) => {
      const count = o.def.count > 1 ? `${o.progress} / ${o.def.count}` : (o.done ? '✓' : '');
      const pct = Math.round((Math.min(o.progress, o.def.count) / Math.max(1, o.def.count)) * 100);
      return `<li class="mq-qobj${o.done ? ' is-done' : ''}">
        <span class="mq-qobj__mark">${o.done ? '✓' : '◇'}</span>
        <span class="mq-qobj__body">
          <span class="mq-qobj__text">${this._esc(o.def.text)}</span>
          <span class="stat-bar stat-bar--thin mq-qobj__bar"><span class="stat-bar__fill" style="width:${pct}%"></span></span>
        </span>
        <span class="mq-qobj__count">${count}</span>
      </li>`;
    }).join('') || '<li class="mq-qobj"><span class="mq-qobj__text">无目标</span></li>';

    // 奖赏
    const rewards = def.rewards || {};
    const chips = [];
    if (Number(rewards.xp) > 0) {
      chips.push(`<span class="mq-reward mq-reward--xp"><i>ᛉ</i>经验 <b>${rewards.xp}</b></span>`);
    }
    if (Number(rewards.gold) > 0) {
      chips.push(`<span class="mq-reward mq-reward--gold"><i>ᛞ</i>金 <b>${rewards.gold}</b></span>`);
    }
    for (const it of rewards.items || []) {
      const item = getItem(it.id);
      const rare = RARITY[item.rarity] || RARITY.common;
      chips.push(`<span class="mq-reward" style="border-color:${rare.color}55">`
        + `<i style="color:${rare.color}">${item.glyph}</i>${this._esc(item.name)}`
        + `<b>×${it.count || 1}</b></span>`);
    }
    n.rewards.innerHTML = chips.join('') || '<div class="empty-hint">无</div>';

    // 追踪按钮
    const tracked = this.qs?.tracked;
    n.trackBtn.disabled = false;
    if (inst.state === 'active') {
      const isTracked = tracked && tracked.def.id === def.id;
      n.trackBtn.textContent = isTracked ? '追 踪 中' : '追 踪';
      n.trackBtn.disabled = !!isTracked;
    } else if (inst.state === 'available') {
      n.trackBtn.textContent = '接 受';
    } else {
      n.trackBtn.textContent = '已 完 成';
      n.trackBtn.disabled = true;
    }
  }

  _onTrackClick() {
    const inst = this._selected();
    if (!inst) return;
    if (inst.state === 'active') {
      this.qs?.track?.(inst.def.id);
    } else if (inst.state === 'available') {
      this.qs?.start?.(inst.def.id);
      this._selId = inst.def.id;
    }
    this._sig = '';
    this.refresh();
    this.game?.systems?.audio?.play?.('ui_click', { volume: 0.4 });
  }

  _regionName(id) {
    const regions = this.game?.world?.regions || REGIONS;
    const region = regions.find?.((r) => r.id === id) || REGIONS.find((r) => r.id === id);
    return region ? region.name : '九界';
  }

  _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
}
