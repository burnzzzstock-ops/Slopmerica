// "X, formerly Chirper": the in-game social feed. Rate-limited so it reads
// like a timeline, not a firehose (playtest: "too many posts, it's wild"): at
// most one post every 14 s, the same kind of news once a minute or two, big
// news first, and small talk only after a quiet spell.
import type { FeedContext, FeedEventKind, FeedPost } from '../contracts';
import { ambientPost, postFor } from '../content/feed';
import type { FeedSink, Game } from '../game';
import { MERCH_URL } from '../art/brands';

/** real seconds between posts, and between small-talk posts (after at least QUIET s without one) */
const POST_GAP = 14, CHATTER = [50, 90], QUIET = 40;
/** news that jumps the line (and may repeat sooner) */
const BIG = new Set<FeedEventKind>(['gameStart', 'populationMilestone', 'bankrupt', 'blackout', 'waterOutage', 'sewageBackup', 'landfillFull', 'buildingBurned', 'communeForever', 'communeLawsuitLost', 'communeBribed', 'maxLevelReached']);
/** everyday news: once every two minutes at most */
const ROUTINE = new Set<FeedEventKind>(['roadBuilt', 'stroadBuilt', 'zoned', 'buildingOpened', 'buildingLeveled', 'buildingDemolished', 'crash', 'drunkCrash', 'trafficJam', 'treesCut', 'communeProtest', 'nightfall', 'weatherChange', 'serviceBuilt', 'laneAdded', 'roadBulldozed']);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmt(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function linkify(t: string) {
  return esc(t)
    .replace(/(imaginesupply\.co[^\s]*)/g, `<a href="${MERCH_URL}" target="_blank" rel="noopener">$1</a>`)
    .replace(/(^|\s)(@\w+)/g, '$1<span class="x-at">$2</span>')
    .replace(/(^|\s)(#\w+)/g, '$1<span class="x-at">$2</span>');
}

export class FeedPanel implements FeedSink {
  el: HTMLElement;
  private list: HTMLElement;
  private queue: FeedPost[] = [];
  private cooldown = 0;
  private ambientT = 20;
  /** seconds since the last post */
  private since = 0;
  unread = 0;
  collapsed: boolean;
  onUnread?: (n: number) => void;
  private lastKind = new Map<FeedEventKind, number>();

  constructor(private game: Game, parent: HTMLElement, collapsed: boolean) {
    this.collapsed = collapsed;
    this.el = document.createElement('section');
    // open, it peeks: the newest post in two lines, so the opening map isn't
    // a third feed; click it (or ⤢) for the whole timeline
    this.el.className = 'xfeed peek' + (collapsed ? ' collapsed' : '');
    this.el.innerHTML = `
      <header class="xfeed-head">
        <span class="xlogo">𝕏</span>
        <span class="xtitle">formerly Chirper</span>
        <button class="xfeed-toggle xfeed-expand" id="xfeed-expand" aria-label="Show the whole feed" title="Show the whole feed">⤢</button>
        <button class="xfeed-toggle" id="xfeed-toggle" aria-label="Toggle feed">–</button>
      </header>
      <div class="xfeed-list"></div>`;
    parent.appendChild(this.el);
    this.list = this.el.querySelector('.xfeed-list')!;
    this.el.querySelector('#xfeed-toggle')!.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.el.querySelector('#xfeed-expand')!.addEventListener('click', () => this.setExpanded(!this.expanded));
    this.list.addEventListener('click', (e) => { if (!this.expanded && !(e.target as HTMLElement).closest('a')) this.setExpanded(true); });
    this.el.querySelector('.xfeed-head')!.addEventListener('dblclick', () => this.setCollapsed(!this.collapsed));
  }

  expanded = false;
  setExpanded(x: boolean) {
    this.expanded = x;
    this.el.classList.toggle('peek', !x);
    const b = this.el.querySelector('#xfeed-expand') as HTMLElement;
    b.textContent = x ? '⤡' : '⤢';
    b.title = b.ariaLabel = x ? 'Just the newest post' : 'Show the whole feed';
  }

  setCollapsed(c: boolean) {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    if (!c) { this.unread = 0; this.onUnread?.(0); }
  }

  push(kind: FeedEventKind, extra: Partial<FeedContext> = {}) {
    // don't repeat the same kind of news
    const now = performance.now();
    const last = this.lastKind.get(kind) ?? -1e9;
    const big = BIG.has(kind);
    const gap = big ? 20000 : ROUTINE.has(kind) ? 120000 : 60000;
    if (now - last < gap) return;
    const post = postFor(kind, this.game.ctx(extra), Math.random);
    if (!post) return;
    this.lastKind.set(kind, now);
    // two waiting at most: big news first, and later everyday news waits its turn or is dropped
    if (big) this.queue.unshift(post); else this.queue.push(post);
    if (this.queue.length > 2) this.queue.length = 2;
  }

  update(dt: number) {
    this.cooldown -= dt;
    this.ambientT -= dt;
    this.since += dt;
    if (this.ambientT <= 0) {
      this.ambientT = CHATTER[0] + Math.random() * (CHATTER[1] - CHATTER[0]);
      if (!this.queue.length && this.since > QUIET) this.queue.push(ambientPost(this.game.ctx(), Math.random));
    }
    if (this.cooldown <= 0 && this.queue.length) {
      this.cooldown = POST_GAP;
      this.since = 0;
      this.render(this.queue.shift()!);
    }
  }

  private render(p: FeedPost) {
    const li = document.createElement('article');
    li.className = 'xpost';
    const badge = p.badge ? `<span class="xbadge ${p.badge}" title="${p.badge} check">✓</span>` : '';
    const img = p.image
      ? `<div class="ximg ${p.image.kind}"><span>${esc(p.image.caption)}</span>${p.image.kind === 'aiSlop' ? '<em>AI generated</em>' : ''}${p.image.kind === 'merch' ? `<a href="${MERCH_URL}" target="_blank" rel="noopener">Shop imaginesupply.co →</a>` : ''}</div>`
      : '';
    const note = p.note ? `<div class="xnote"><b>Readers added context</b>${esc(p.note)}</div>` : '';
    const replies = p.replies?.length ? `<div class="xreplies">${p.replies.slice(0, 2).map((r) => `<div><span class="x-at">@${esc(r.handle)}</span> ${linkify(r.text)}</div>`).join('')}</div>` : '';
    li.innerHTML = `
      <div class="xav" style="background:${esc(p.avatar.bg)}">${esc(p.avatar.emoji ?? p.name[0] ?? '?')}</div>
      <div class="xbody">
        <div class="xmeta"><b>${esc(p.name)}</b>${badge}<span class="xhandle">@${esc(p.handle)} · now</span></div>
        <div class="xtext">${linkify(p.text)}</div>
        ${img}${note}${replies}
        <div class="xstats"><span>💬 ${fmt(Math.round(p.reposts * 0.6))}</span><span>🔁 ${fmt(p.reposts)}</span><span>♥ ${fmt(p.likes)}</span><span>📊 ${fmt(p.views)}</span></div>
      </div>`;
    this.list.prepend(li);
    while (this.list.children.length > 30) this.list.lastChild?.remove();
    if (this.collapsed) { this.unread++; this.onUnread?.(this.unread); }
    this.game.audio.play('notify', 0.25);
  }
}
