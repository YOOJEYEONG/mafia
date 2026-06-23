// 게임 진행 로직 (진행자 자동화)
import { ROLES, assignRoles, getComposition, compositionSummary } from './roles.js';

const DEFAULT_SETTINGS = {
  nightTime: 70,       // 밤 (초)
  discussionTime: 100, // 낮 토론 (초)
  voteTime: 35,        // 투표 (초)
};

function now() { return Date.now(); }

export class GameRoom {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.players = new Map(); // playerId -> player
    this.hostId = null;
    this.phase = 'lobby';     // lobby | night | dayDiscuss | dayVote | ended
    this.day = 0;
    this.settings = { ...DEFAULT_SETTINGS };
    this.timer = null;
    this.timerEndsAt = null;
    this.nightActions = {};
    this.votes = new Map();   // voterId -> targetId ('skip' 가능)
    this.blocked = new Set(); // 마담에게 봉쇄된 playerId (이번 낮 투표 불가)
    this.lastDead = [];       // 직전 라운드 사망자 (영매용)
    this.pendingReveals = []; // 기자 공개 예약 [{name, roleName}]
    this.chat = { public: [], mafia: [], lovers: [] };
    this.result = null;
    this.spectators = new Set(); // 관전자 socketId
    this.isDemo = false;
    this.phaseToken = 0;         // 단계 전환 토큰 (봇 타이머 무효화용)
  }

  // ---------- 관전자 ----------
  addSpectator(socketId) { this.spectators.add(socketId); }
  removeSpectator(socketId) { this.spectators.delete(socketId); }
  hasBots() { return this.list().some((p) => p.isBot); }
  allChatHistory() { return { public: this.chat.public, mafia: this.chat.mafia, lovers: this.chat.lovers }; }
  pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

  spectatorState() {
    return {
      code: this.code, phase: this.phase, day: this.day,
      timerEndsAt: this.timerEndsAt, isDemo: this.isDemo,
      players: this.list().map((p) => ({
        name: p.name, alive: p.alive, isBot: p.isBot,
        roleName: p.role ? ROLES[p.role].name : '대기',
        roleEmoji: p.role ? ROLES[p.role].emoji : '❓',
        team: p.team,
      })),
      result: this.result,
    };
  }

  // ---------- 봇 데모 ----------
  addBot(name) {
    const id = 'bot_' + Math.random().toString(36).slice(2, 8);
    const p = {
      id, name, socketId: null, connected: true, isBot: true,
      role: null, team: null, alive: true,
      partnerId: null, soldierShield: false, abilityUsed: false,
    };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    return p;
  }

  startDemo() {
    this.isDemo = true;
    const names = ['민준', '서연', '도윤', '지우', '하준', '수아', '지호', '윤서'];
    names.forEach((n) => this.addBot(n));
    this.settings = { nightTime: 16, discussionTime: 13, voteTime: 9 };
    return this.start();
  }

  botTimer(token, ms, fn) {
    setTimeout(() => { if (this.phaseToken === token) { try { fn(); } catch (e) {} } }, ms);
  }

  scheduleNightBots() {
    if (!this.hasBots() || this.phase !== 'night') return;
    const token = this.phaseToken;
    const alive = this.alivePlayers();
    const bots = alive.filter((p) => p.isBot);
    const citizens = alive.filter((p) => p.team === 'citizen');

    // 마피아: 채팅 + 제거 대상 합의
    const mafiaBots = bots.filter((p) => p.team === 'mafia');
    const killPool = citizens.length ? citizens : alive.filter((p) => p.team !== 'mafia');
    const killTarget = this.pick(killPool);
    mafiaBots.forEach((b, i) => {
      const lines = [`${killTarget ? killTarget.name : '누구'} 처리하자`, `오늘은 ${killTarget ? killTarget.name : '쟤'} 어때?`, '조용히 가자', '경찰부터 찾아야 하는데'];
      this.botTimer(token, 900 + i * 1100, () => this.postChat(b.id, 'mafia', this.pick(lines)));
    });
    if (mafiaBots[0] && killTarget) {
      this.botTimer(token, 1400 + mafiaBots.length * 1100, () => this.submitNightAction(mafiaBots[0].id, killTarget.id));
    }

    // 나머지 능력자 봇
    bots.forEach((b) => {
      const r = ROLES[b.role];
      if (!r.nightAction || r.nightAction === 'kill') return;
      if (r.oneShot && b.abilityUsed) return;
      const others = alive.filter((p) => p.id !== b.id);
      let target = r.nightAction === 'protect' ? this.pick(alive) : this.pick(others);
      if (target) this.botTimer(token, 1500 + Math.random() * 3500, () => this.submitNightAction(b.id, target.id));
    });

    // 연인 봇 채팅
    const loverBots = bots.filter((p) => p.role === 'lover');
    if (loverBots.length === 2) {
      const lines = ['우리 둘은 끝까지 살아남자 ❤️', '낮에는 서로 모른 척 하자', '믿을 사람은 너뿐이야'];
      loverBots.forEach((b, i) => this.botTimer(token, 1000 + i * 1800, () => this.postChat(b.id, 'lovers', this.pick(lines))));
    }
  }

  scheduleDayBots() {
    if (!this.hasBots() || this.phase !== 'dayDiscuss') return;
    const token = this.phaseToken;
    const bots = this.alivePlayers().filter((p) => p.isBot);
    const lines = ['누가 제일 수상하지?', '난 진짜 시민이야', '아까 그 사람 행동이 이상했어', '투표 신중하게 하자', '난 잘 모르겠어...', '경찰 나와줬으면', '조용한 사람이 더 의심돼'];
    bots.forEach((b, i) => this.botTimer(token, 1200 + i * 1900, () => this.postChat(b.id, 'public', this.pick(lines))));
  }

  scheduleVoteBots() {
    if (!this.hasBots() || this.phase !== 'dayVote') return;
    const token = this.phaseToken;
    const bots = this.alivePlayers().filter((p) => p.isBot && !this.blocked.has(p.id));
    bots.forEach((b, i) => {
      this.botTimer(token, 700 + i * 650, () => {
        const cands = this.alivePlayers().filter((p) => p.id !== b.id);
        const pool = b.team === 'mafia' ? cands.filter((p) => p.team !== 'mafia') : cands;
        const t = this.pick(pool.length ? pool : cands);
        this.submitVote(b.id, t ? t.id : 'skip');
      });
    });
  }

  // ---------- 플레이어 관리 ----------
  addPlayer(playerId, name, socketId) {
    const player = {
      id: playerId, name, socketId, connected: true,
      role: null, team: null, alive: true,
      partnerId: null, soldierShield: false, abilityUsed: false,
    };
    this.players.set(playerId, player);
    if (!this.hostId) this.hostId = playerId;
    return player;
  }

  attachSocket(playerId, socketId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    p.socketId = socketId;
    p.connected = true;
    return p;
  }

  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    if (this.phase === 'lobby') {
      // 로비에서는 나간 사람 제거
      this.players.delete(playerId);
      if (this.hostId === playerId) this.reassignHost();
    } else if (this.hostId === playerId) {
      this.reassignHost();
    }
  }

  reassignHost() {
    const next = [...this.players.values()].find((p) => p.connected);
    this.hostId = next ? next.id : null;
  }

  alivePlayers() { return [...this.players.values()].filter((p) => p.alive); }
  list() { return [...this.players.values()]; }

  // ---------- 게임 시작 ----------
  start() {
    const ps = this.list();
    if (ps.length < 8 || ps.length > 12) {
      return { error: '8~12인일 때만 시작할 수 있습니다.' };
    }
    if (!getComposition(ps.length)) {
      return { error: '지원하지 않는 인원수입니다.' };
    }
    assignRoles(ps);
    this.phase = 'night';
    this.day = 1;
    this.result = null;
    this.chat = { public: [], mafia: [], lovers: [] };
    this.system('public', `🎮 게임을 시작합니다! 총 ${ps.length}명이 참가했습니다. 각자 자신의 직업을 확인하세요.`);
    this.beginNight();
    return { ok: true };
  }

  // ---------- 밤 ----------
  beginNight() {
    this.phase = 'night';
    this.phaseToken++;
    this.nightActions = {};
    this.votes.clear();

    // 영매: 직전 사망자들의 진영 알림
    const medium = this.alivePlayers().find((p) => p.role === 'medium');
    if (medium && this.lastDead.length) {
      const info = this.lastDead
        .map((d) => `${d.name} → ${d.team === 'mafia' ? '🔴 마피아 진영' : '🔵 시민 진영'}`)
        .join(', ');
      this.toPlayer(medium.id, 'private', `🔮 전날 사망자의 정체: ${info}`);
    }

    this.setTimer(this.settings.nightTime, () => this.resolveNight());
    this.broadcast();
    this.scheduleNightBots();
  }

  submitNightAction(playerId, targetId) {
    if (this.phase !== 'night') return;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    const role = ROLES[p.role];
    if (!role.nightAction) return;
    if (role.oneShot && p.abilityUsed) return;

    switch (role.nightAction) {
      case 'kill':
        this.nightActions.killBy = playerId;
        this.nightActions.kill = targetId;
        this.system('mafia', `🔪 ${p.name}님이 ${this.nameOf(targetId)}님을 제거 대상으로 지목했습니다.`);
        break;
      case 'investigate':
        this.nightActions.investigate = { by: playerId, target: targetId };
        break;
      case 'protect':
        this.nightActions.protect = targetId;
        break;
      case 'report':
        this.nightActions.report = { by: playerId, target: targetId };
        break;
      case 'seduce':
        this.nightActions.seduce = { by: playerId, target: targetId };
        break;
    }
    this.broadcast();
  }

  resolveNight() {
    this.clearTimer();
    this.phaseToken++;
    this.blocked = new Set();
    this.lastDead = [];
    const na = this.nightActions;

    // 1) 마담 유혹 → 대상 능력 무효 + 다음 낮 투표 봉쇄
    let seducedId = null;
    if (na.seduce && this.isAlive(na.seduce.target)) {
      seducedId = na.seduce.target;
      this.blocked.add(seducedId);
      this.toPlayer(seducedId, 'private', '💋 당신은 간밤에 유혹당했습니다. 이번 밤 능력이 무효화되고, 오늘 낮 투표를 할 수 없습니다.');
    }

    // 2) 경찰 조사 (유혹당했으면 무효)
    if (na.investigate && na.investigate.by !== seducedId && this.isAlive(na.investigate.target)) {
      const t = this.players.get(na.investigate.target);
      // 스파이는 시민으로 보임
      const shown = t.role === 'spy' ? 'citizen' : t.team;
      this.toPlayer(na.investigate.by, 'private',
        `👮 조사 결과: ${t.name}님은 ${shown === 'mafia' ? '🔴 마피아 진영입니다!' : '🔵 시민 진영입니다.'}`);
    }

    // 3) 기자 취재 → 다음 날 공개 예약 (유혹당했으면 무효)
    if (na.report && na.report.by !== seducedId && this.isAlive(na.report.target)) {
      const reporter = this.players.get(na.report.by);
      const t = this.players.get(na.report.target);
      reporter.abilityUsed = true;
      this.pendingReveals.push({ name: t.name, roleName: ROLES[t.role].name, emoji: ROLES[t.role].emoji });
    }

    // 4) 마피아 공격 처리
    const deaths = [];
    if (na.kill && this.isAlive(na.kill)) {
      const target = this.players.get(na.kill);
      const protectedById = na.protect === na.kill;
      if (protectedById) {
        // 의사가 살림
        this.toPlayer(na.kill, 'private', '💉 간밤에 마피아의 공격을 받았지만 의사의 치료로 살아남았습니다!');
      } else if (target.role === 'soldier' && target.soldierShield) {
        target.soldierShield = false;
        this.toPlayer(na.kill, 'private', '🪖 마피아의 공격을 받았지만 군인의 방어로 버텨냈습니다! (다음엔 위험합니다)');
      } else {
        target.alive = false;
        deaths.push(target);
      }
    }

    // 5) 연인 상사병 (사망자의 연인도 사망)
    this.applyHeartbreak(deaths);

    // 사망자 기록 (영매용)
    this.lastDead = deaths.map((d) => ({ name: d.name, team: d.team }));

    // 새벽 발표는 beginDay 에서
    this.nightDeaths = deaths;
    this.nightActions = {};

    const win = this.checkWin();
    if (win) return this.endGame(win);
    this.beginDay();
  }

  // ---------- 낮 ----------
  beginDay() {
    this.phase = 'dayDiscuss';
    this.phaseToken++;

    if (this.nightDeaths && this.nightDeaths.length) {
      const names = this.nightDeaths.map((d) => `💀 ${d.name}`).join(', ');
      this.system('public', `🌅 ${this.day}일차 아침. 간밤에 ${names}님이 사망했습니다.`);
    } else {
      this.system('public', `🌅 ${this.day}일차 아침. 간밤에 아무도 죽지 않았습니다!`);
    }
    // 기자 공개
    for (const r of this.pendingReveals) {
      this.system('public', `📰 [특종] ${r.name}님의 직업은 "${r.emoji} ${r.roleName}" 입니다!`);
    }
    this.pendingReveals = [];
    this.nightDeaths = [];

    this.setTimer(this.settings.discussionTime, () => this.beginVote());
    this.broadcast();
    this.scheduleDayBots();
  }

  beginVote() {
    this.clearTimer();
    this.phase = 'dayVote';
    this.phaseToken++;
    this.votes.clear();
    this.system('public', '🗳️ 투표 시간입니다. 마피아로 의심되는 사람을 지목하세요.');
    this.setTimer(this.settings.voteTime, () => this.resolveVote());
    this.broadcast();
    this.scheduleVoteBots();
  }

  submitVote(playerId, targetId) {
    if (this.phase !== 'dayVote') return;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    if (this.blocked.has(playerId)) {
      this.toPlayer(playerId, 'private', '💋 유혹당해 오늘은 투표할 수 없습니다.');
      return;
    }
    this.votes.set(playerId, targetId);
    // 전원 투표 완료 시 조기 종료
    const voters = this.alivePlayers().filter((pl) => !this.blocked.has(pl.id));
    if (this.votes.size >= voters.length) {
      this.resolveVote();
    } else {
      this.broadcast();
    }
  }

  resolveVote() {
    this.clearTimer();
    this.phaseToken++;
    const tally = new Map();
    for (const [voterId, targetId] of this.votes) {
      if (targetId === 'skip') continue;
      const voter = this.players.get(voterId);
      const weight = voter && voter.role === 'politician' ? 2 : 1;
      tally.set(targetId, (tally.get(targetId) || 0) + weight);
    }

    let executedId = null;
    let max = 0;
    let tie = false;
    for (const [tid, count] of tally) {
      if (count > max) { max = count; executedId = tid; tie = false; }
      else if (count === max) { tie = true; }
    }

    const deaths = [];
    if (executedId && !tie && max > 0) {
      const t = this.players.get(executedId);
      t.alive = false;
      deaths.push(t);
      this.system('public', `⚖️ 투표 결과 ${t.name}님이 처형되었습니다. (직업은 비공개)`);
      this.applyHeartbreak(deaths);
    } else {
      this.system('public', '⚖️ 투표가 동률이거나 무효표로 끝나 아무도 처형되지 않았습니다.');
    }

    this.lastDead = deaths.map((d) => ({ name: d.name, team: d.team }));
    this.blocked = new Set();

    const win = this.checkWin();
    if (win) return this.endGame(win);

    this.day += 1;
    this.beginNight();
  }

  // ---------- 공통 ----------
  applyHeartbreak(deaths) {
    // deaths 배열을 직접 확장 (연인 동반 사망)
    let added = true;
    while (added) {
      added = false;
      for (const d of [...deaths]) {
        if (d.partnerId) {
          const partner = this.players.get(d.partnerId);
          if (partner && partner.alive) {
            partner.alive = false;
            deaths.push(partner);
            this.system('public', `💔 ${partner.name}님이 연인 ${d.name}님을 잃고 상사병으로 사망했습니다.`);
            added = true;
          }
        }
      }
    }
  }

  checkWin() {
    const alive = this.alivePlayers();
    const mafia = alive.filter((p) => p.team === 'mafia').length;
    const citizen = alive.length - mafia;

    if (mafia === 0) return 'citizen';
    if (mafia >= citizen) return 'mafia';

    // 연인 단독 생존 (둘만 남음) → 연인 승리 연출
    if (alive.length === 2 && alive.every((p) => p.role === 'lover')) return 'lover';
    return null;
  }

  endGame(winner) {
    this.clearTimer();
    this.phaseToken++;
    this.phase = 'ended';
    const fullRoles = this.list().map((p) => ({
      name: p.name,
      roleName: ROLES[p.role].name,
      emoji: ROLES[p.role].emoji,
      team: p.team,
      alive: p.alive,
    }));
    const label = winner === 'mafia' ? '🔴 마피아 진영 승리!'
      : winner === 'lover' ? '💞 연인의 승리! 끝까지 함께 살아남았습니다.'
      : '🔵 시민 진영 승리!';
    this.result = { winner, label, fullRoles };
    this.system('public', `🏁 게임 종료 — ${label}`);
    this.broadcast();
  }

  restart() {
    this.phase = 'lobby';
    this.day = 0;
    this.result = null;
    this.nightActions = {};
    this.votes.clear();
    this.blocked = new Set();
    this.lastDead = [];
    this.pendingReveals = [];
    this.nightDeaths = [];
    this.chat = { public: [], mafia: [], lovers: [] };
    this.clearTimer();
    for (const p of this.list()) {
      p.role = null; p.team = null; p.alive = true;
      p.partnerId = null; p.soldierShield = false; p.abilityUsed = false;
    }
    this.broadcast();
  }

  // ---------- 채팅 ----------
  // 채널 권한: public(낮), mafia(밤·마피아진영), lovers(밤·연인)
  canUseChannel(player, channel) {
    if (!player) return false;
    if (channel === 'public') {
      return (this.phase === 'dayDiscuss' || this.phase === 'dayVote') && player.alive;
    }
    if (channel === 'mafia') {
      return this.phase === 'night' && player.alive && player.team === 'mafia';
    }
    if (channel === 'lovers') {
      if (this.phase !== 'night' || !player.alive || player.role !== 'lover') return false;
      const partner = player.partnerId && this.players.get(player.partnerId);
      return partner && partner.alive; // 둘 다 살아있어야 채팅 가능
    }
    return false;
  }

  postChat(playerId, channel, text) {
    const p = this.players.get(playerId);
    if (!this.canUseChannel(p, channel)) return;
    const clean = String(text).slice(0, 300).trim();
    if (!clean) return;
    const msg = { fromName: p.name, text: clean, ts: now() };
    this.chat[channel].push(msg);
    this.emitChat(channel, msg);
  }

  system(channel, text) {
    const msg = { system: true, text, ts: now() };
    if (this.chat[channel]) this.chat[channel].push(msg);
    this.emitChat(channel, msg);
  }

  emitChat(channel, msg) {
    for (const p of this.list()) {
      if (!p.socketId) continue;
      if (this.canReadChannel(p, channel)) {
        this.io.to(p.socketId).emit('chat', { channel, ...msg });
      }
    }
    // 관전자는 모든 채널(마피아·연인 비밀채팅 포함)을 본다
    for (const sid of this.spectators) this.io.to(sid).emit('chat', { channel, ...msg });
  }

  // 읽기 권한: 죽은 사람도 public 은 관전 가능. 마피아/연인 채널은 멤버만.
  canReadChannel(player, channel) {
    if (channel === 'public') return true;
    if (channel === 'mafia') return player.team === 'mafia';
    if (channel === 'lovers') return player.role === 'lover';
    return false;
  }

  // 개인 메시지 (조사결과 등) — public 채널에 본인에게만
  toPlayer(playerId, _channel, text) {
    const p = this.players.get(playerId);
    if (p && p.socketId) {
      this.io.to(p.socketId).emit('private', { text, ts: now() });
    }
  }

  nameOf(id) { const p = this.players.get(id); return p ? p.name : '???'; }
  isAlive(id) { const p = this.players.get(id); return p && p.alive; }

  // ---------- 타이머 ----------
  setTimer(seconds, fn) {
    this.clearTimer();
    this.timerEndsAt = now() + seconds * 1000;
    this.timer = setTimeout(() => { this.timer = null; fn(); }, seconds * 1000);
  }
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerEndsAt = null;
  }
  skipPhase() {
    if (this.phase === 'night') this.resolveNight();
    else if (this.phase === 'dayDiscuss') this.beginVote();
    else if (this.phase === 'dayVote') this.resolveVote();
  }

  // ---------- 상태 전송 ----------
  broadcast() {
    for (const p of this.list()) {
      if (p.socketId) this.io.to(p.socketId).emit('state', this.stateFor(p));
    }
    if (this.spectators.size) {
      const sp = this.spectatorState();
      for (const sid of this.spectators) this.io.to(sid).emit('spectatorState', sp);
    }
  }

  voteTally() {
    const t = {};
    for (const [, targetId] of this.votes) {
      t[targetId] = (t[targetId] || 0) + 1;
    }
    return t;
  }

  stateFor(p) {
    const isHost = p.id === this.hostId;
    const publicPlayers = this.list().map((x) => ({
      id: x.id, name: x.name, alive: x.alive, connected: x.connected,
      isHost: x.id === this.hostId,
    }));

    const base = {
      code: this.code,
      phase: this.phase,
      day: this.day,
      hostId: this.hostId,
      isHost,
      players: publicPlayers,
      settings: this.settings,
      timerEndsAt: this.timerEndsAt,
      you: { id: p.id, name: p.name },
    };

    if (this.phase === 'lobby') {
      base.composition = compositionSummary(this.list().length);
      base.canStart = this.list().length >= 8 && this.list().length <= 12;
      return base;
    }

    // 게임 중/종료: 본인 역할 정보
    const role = ROLES[p.role];
    base.you.role = p.role;
    base.you.roleName = role.name;
    base.you.roleEmoji = role.emoji;
    base.you.roleDesc = role.desc;
    base.you.team = p.team;
    base.you.alive = p.alive;

    // 마피아 팀원 공개 (마피아 진영끼리)
    if (p.team === 'mafia') {
      base.you.teammates = this.list()
        .filter((x) => x.team === 'mafia' && x.id !== p.id)
        .map((x) => ({ name: x.name, roleName: ROLES[x.role].name, alive: x.alive }));
    }
    // 연인 파트너 공개
    if (p.role === 'lover' && p.partnerId) {
      const partner = this.players.get(p.partnerId);
      if (partner) base.you.partner = { name: partner.name, alive: partner.alive };
    }

    // 사용 가능한 채팅 채널
    base.channels = ['public', 'mafia', 'lovers']
      .filter((c) => this.canReadChannel(p, c))
      .map((c) => ({
        key: c,
        label: c === 'public' ? '전체' : c === 'mafia' ? '마피아' : '연인',
        canSend: this.canUseChannel(p, c),
      }));

    // 밤 능력 UI
    if (this.phase === 'night' && p.alive && role.nightAction && !(role.oneShot && p.abilityUsed)) {
      const excludeSelf = role.nightAction !== 'protect';
      const targets = this.alivePlayers()
        .filter((x) => !(excludeSelf && x.id === p.id))
        // 마피아는 동료를 대상에서 제외
        .filter((x) => !(role.nightAction === 'kill' && x.team === 'mafia'))
        .map((x) => ({ id: x.id, name: x.name }));
      base.action = {
        type: role.nightAction,
        label: this.actionLabel(role.nightAction),
        targets,
        selected: this.currentSelection(p, role.nightAction),
      };
    }

    // 투표 UI
    if (this.phase === 'dayVote' && p.alive) {
      base.vote = {
        canVote: !this.blocked.has(p.id),
        myVote: this.votes.get(p.id) || null,
        targets: this.alivePlayers().map((x) => ({ id: x.id, name: x.name })),
        tally: this.voteTally(),
        votedCount: this.votes.size,
      };
    }

    if (this.phase === 'ended') base.result = this.result;
    return base;
  }

  actionLabel(type) {
    return {
      kill: '제거할 대상', investigate: '조사할 대상', protect: '보호할 대상',
      report: '취재할 대상 (1회)', seduce: '유혹할 대상',
    }[type] || '대상 선택';
  }
  currentSelection(p, type) {
    const na = this.nightActions;
    if (type === 'kill') return na.kill || null;
    if (type === 'protect') return na.protect || null;
    if (type === 'investigate') return na.investigate && na.investigate.by === p.id ? na.investigate.target : null;
    if (type === 'report') return na.report && na.report.by === p.id ? na.report.target : null;
    if (type === 'seduce') return na.seduce && na.seduce.by === p.id ? na.seduce.target : null;
    return null;
  }

  chatHistoryFor(p) {
    const out = {};
    for (const c of ['public', 'mafia', 'lovers']) {
      if (this.canReadChannel(p, c)) out[c] = this.chat[c];
    }
    return out;
  }
}
