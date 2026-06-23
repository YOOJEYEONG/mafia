const socket = io();
const $ = (id) => document.getElementById(id);
const screens = ['home', 'lobby', 'role', 'game', 'end', 'spectate'];
function show(name) {
  screens.forEach((s) => $(`screen-${s}`).classList.toggle('hidden', s !== name));
}
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 4000);
}

let me = { playerId: null, code: null };
let state = null;
let histories = { public: [], mafia: [], lovers: [] };
let activeTab = 'public';
let roleShownForGame = false;
let timerInterval = null;
let isSpectator = false;
let spState = null;
let spTab = 'public';

// ---------- 입장 ----------
$('btnCreate').onclick = () => {
  const name = $('nameInput').value.trim();
  if (!name) return ($('homeError').textContent = '닉네임을 입력하세요.');
  socket.emit('createRoom', { name }, handleJoin);
};
$('btnJoin').onclick = () => {
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim();
  if (!name) return ($('homeError').textContent = '닉네임을 입력하세요.');
  if (!code) return ($('homeError').textContent = '방 코드를 입력하세요.');
  socket.emit('joinRoom', { name, code }, handleJoin);
};
function handleJoin(res) {
  if (res && res.error) { $('homeError').textContent = res.error; return; }
  if (res && res.ok) {
    me.playerId = res.playerId;
    me.code = res.code;
    sessionStorage.setItem('mafiaSession', JSON.stringify(me));
  }
}
socket.on('joined', (d) => { me.playerId = d.playerId; me.code = d.code; });

// 봇 데모 관전
$('btnDemo').onclick = () => {
  socket.emit('createDemo', {}, (res) => {
    if (res && res.error) return toast(res.error);
    isSpectator = true;
    histories = { public: [], mafia: [], lovers: [] };
    spTab = 'public';
  });
};
$('btnSpectateHome').onclick = () => { location.reload(); };

$('btnLeave').onclick = () => {
  socket.emit('leaveRoom');
  sessionStorage.removeItem('mafiaSession');
  location.reload();
};

// 재접속 복구
window.addEventListener('load', () => {
  const saved = sessionStorage.getItem('mafiaSession');
  if (saved) {
    const s = JSON.parse(saved);
    socket.emit('rejoin', { code: s.code, playerId: s.playerId }, (res) => {
      if (res && res.ok) { me = s; }
      else { sessionStorage.removeItem('mafiaSession'); show('home'); }
    });
  }
});

// ---------- 채팅 수신 ----------
socket.on('chatHistory', (h) => {
  histories = { public: h.public || [], mafia: h.mafia || [], lovers: h.lovers || [] };
  if (isSpectator) renderSpectatorChat(); else renderChat();
});

// 관전 상태 수신
socket.on('spectatorState', (s) => {
  isSpectator = true;
  spState = s;
  renderSpectate();
  show('spectate');
});
socket.on('chat', (msg) => {
  if (!histories[msg.channel]) histories[msg.channel] = [];
  histories[msg.channel].push(msg);
  if (isSpectator) renderSpectatorChat(); else renderChat();
});
socket.on('private', (msg) => {
  histories.public.push({ private: true, text: msg.text, ts: msg.ts });
  renderChat();
  toast(msg.text);
});

// ---------- 상태 수신 ----------
socket.on('state', (s) => {
  state = s;
  render();
});

function render() {
  if (!state) return;
  if (state.phase === 'lobby') { roleShownForGame = false; renderLobby(); show('lobby'); return; }
  if (state.phase === 'ended') { renderEnd(); show('end'); return; }

  // 게임 중: 첫 진입 시 역할 공개
  if (!roleShownForGame && state.you.role) {
    renderRole();
    show('role');
    return;
  }
  renderGame();
  show('game');
}

// ---------- 로비 ----------
function renderLobby() {
  $('lobbyCode').textContent = state.code;
  $('playerCount').textContent = `(${state.players.length}/12)`;
  const ul = $('lobbyPlayers');
  ul.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot ${p.connected ? '' : 'off'}"></span>
      ${p.isHost ? '<span class="crown">👑</span>' : ''}
      <span>${esc(p.name)}</span>
      ${p.id === me.playerId ? '<span class="badge-me">나</span>' : ''}`;
    ul.appendChild(li);
  });

  // 직업 구성
  const comp = $('compList');
  comp.innerHTML = '';
  if (state.composition) {
    state.composition.forEach((c) => {
      const d = document.createElement('div');
      d.className = `comp-item ${c.team}`;
      d.textContent = `${c.emoji} ${c.name}${c.count > 1 ? ' ×' + c.count : ''}`;
      comp.appendChild(d);
    });
    $('compCard').classList.remove('hidden');
  } else {
    $('compCard').classList.add('hidden');
    comp.innerHTML = '<span class="muted">8~12인일 때 직업이 배정됩니다.</span>';
    $('compCard').classList.remove('hidden');
  }

  // 방장 설정 + 시작 버튼
  $('hostSettings').classList.toggle('hidden', !state.isHost);
  $('btnStart').classList.toggle('hidden', !state.isHost);
  if (state.isHost) {
    syncSetting('setNight', 'setNightV', state.settings.nightTime);
    syncSetting('setDiscuss', 'setDiscussV', state.settings.discussionTime);
    syncSetting('setVote', 'setVoteV', state.settings.voteTime);
    $('btnStart').disabled = !state.canStart;
    $('lobbyHint').textContent = state.canStart ? '' : '최소 8명이 모여야 시작할 수 있어요.';
  } else {
    $('lobbyHint').textContent = '방장이 게임을 시작할 때까지 기다려주세요.';
  }
}
function syncSetting(input, label, val) {
  $(input).value = val;
  $(label).textContent = val;
}
['setNight', 'setDiscuss', 'setVote'].forEach((id) => {
  $(id).oninput = () => {
    $(id + 'V').textContent = $(id).value;
    socket.emit('updateSettings', {
      nightTime: +$('setNight').value,
      discussionTime: +$('setDiscuss').value,
      voteTime: +$('setVote').value,
    });
  };
});
$('btnStart').onclick = () => socket.emit('startGame', {}, (res) => { if (res && res.error) toast(res.error); });

// ---------- 역할 공개 ----------
function renderRole() {
  const y = state.you;
  const card = $('roleCard');
  card.className = `role-card ${y.team}`;
  $('roleEmoji').textContent = y.roleEmoji;
  $('roleName').textContent = y.roleName;
  const tb = $('roleTeam');
  tb.className = `team-badge ${y.team}`;
  tb.textContent = y.team === 'mafia' ? '🔴 마피아 진영' : '🔵 시민 진영';
  $('roleDesc').textContent = y.roleDesc;

  const extra = $('roleExtra');
  extra.innerHTML = '';
  if (y.teammates && y.teammates.length) {
    extra.innerHTML += '<div class="muted">함께하는 마피아 동료</div>';
    y.teammates.forEach((t) => {
      extra.innerHTML += `<span class="pill mafia">${esc(t.name)} (${t.roleName})</span>`;
    });
  }
  if (y.partner) {
    extra.innerHTML += '<div class="muted">당신의 연인</div>';
    extra.innerHTML += `<span class="pill lover">💞 ${esc(y.partner.name)}</span>`;
  }
}
$('btnRoleOk').onclick = () => { roleShownForGame = true; render(); };

// ---------- 게임 ----------
function renderGame() {
  const isNight = state.phase === 'night';
  const lbl = $('phaseLabel');
  lbl.className = 'phase ' + (isNight ? 'night' : 'day');
  lbl.textContent = isNight ? `🌙 ${state.day}일차 밤`
    : state.phase === 'dayVote' ? `🗳️ ${state.day}일차 투표`
    : `☀️ ${state.day}일차 낮`;

  $('myStatus').textContent = state.you.alive
    ? `${state.you.roleEmoji} ${state.you.roleName}`
    : '💀 사망 (관전)';

  startTimer();

  // 플레이어 목록
  const ul = $('gamePlayers');
  ul.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = (p.alive ? '' : 'dead') + (p.connected ? '' : ' off');
    li.innerHTML = `${p.isHost ? '<span class="crown">👑</span>' : ''}
      <span>${p.alive ? '' : '💀 '}${esc(p.name)}</span>
      ${p.id === me.playerId ? '<span class="badge-me">나</span>' : ''}`;
    ul.appendChild(li);
  });

  renderAction();
  renderVote();
  renderChatTabs();
  renderChat();

  $('hostControls').classList.toggle('hidden', !state.isHost);
}

function renderAction() {
  const panel = $('actionPanel');
  if (state.phase === 'night' && state.action) {
    const a = state.action;
    panel.classList.remove('hidden');
    let html = `<h3>${state.you.roleEmoji} ${a.label}</h3><div class="target-grid">`;
    a.targets.forEach((t) => {
      const sel = a.selected === t.id ? 'selected' : '';
      html += `<button class="target-btn ${sel}" data-act="${t.id}">${esc(t.name)}</button>`;
    });
    html += '</div>';
    if (a.selected) html += `<p class="muted center">지목됨: ${esc(nameById(a.selected))}</p>`;
    panel.innerHTML = html;
    panel.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => socket.emit('nightAction', { targetId: b.dataset.act });
    });
  } else if (state.phase === 'night' && state.you.alive && !state.action) {
    panel.classList.remove('hidden');
    panel.innerHTML = '<h3>🌙 밤</h3><p class="muted">조용히 아침을 기다립니다... (당신은 밤에 할 일이 없습니다)</p>';
  } else {
    panel.classList.add('hidden');
  }
}

function renderVote() {
  const panel = $('votePanel');
  if (state.phase === 'dayVote' && state.vote) {
    const v = state.vote;
    panel.classList.remove('hidden');
    if (!v.canVote) {
      panel.innerHTML = '<h3>🗳️ 투표</h3><p class="muted">당신은 이번 투표에 참여할 수 없습니다.</p>';
      return;
    }
    let html = `<h3>🗳️ 처형할 사람 (${v.votedCount}명 투표함)</h3><div class="target-grid">`;
    v.targets.forEach((t) => {
      const sel = v.myVote === t.id ? 'selected' : '';
      const cnt = v.tally[t.id] ? `<span class="v">${v.tally[t.id]}표</span>` : '';
      html += `<button class="target-btn ${sel}" data-vote="${t.id}">${esc(t.name)}${cnt}</button>`;
    });
    html += '</div>';
    const skipSel = v.myVote === 'skip' ? 'selected' : '';
    html += `<button class="target-btn ${skipSel}" data-vote="skip" style="margin-top:8px">기권</button>`;
    panel.innerHTML = html;
    panel.querySelectorAll('[data-vote]').forEach((b) => {
      b.onclick = () => socket.emit('vote', { targetId: b.dataset.vote });
    });
  } else {
    panel.classList.add('hidden');
  }
}

// ---------- 채팅 ----------
function renderChatTabs() {
  const tabs = $('chatTabs');
  tabs.innerHTML = '';
  const channels = state.channels || [{ key: 'public', label: '전체', canSend: false }];
  if (!channels.some((c) => c.key === activeTab)) activeTab = channels[0].key;
  channels.forEach((c) => {
    const b = document.createElement('button');
    b.className = c.key + (c.key === activeTab ? ' active' : '');
    b.textContent = c.label;
    b.onclick = () => { activeTab = c.key; renderChatTabs(); renderChat(); };
    tabs.appendChild(b);
  });
  const cur = channels.find((c) => c.key === activeTab);
  const canSend = cur && cur.canSend;
  $('chatInput').disabled = !canSend;
  $('chatSend').disabled = !canSend;
  $('chatInputWrap').classList.toggle('disabled', !canSend);
  $('chatInput').placeholder = canSend
    ? (activeTab === 'mafia' ? '마피아 동료와 대화...' : activeTab === 'lovers' ? '연인과 대화...' : '메시지...')
    : '지금은 이 채널에 쓸 수 없습니다';
}

function renderChat() {
  const log = $('chatLog');
  const msgs = histories[activeTab] || [];
  log.innerHTML = '';
  msgs.forEach((m) => {
    const d = document.createElement('div');
    if (m.system) { d.className = 'msg system'; d.textContent = m.text; }
    else if (m.private) { d.className = 'msg private'; d.textContent = '🔒 ' + m.text; }
    else {
      const mine = state && m.fromName === state.you.name;
      d.className = 'msg' + (mine ? ' mine' : '');
      d.innerHTML = `<span class="who">${esc(m.fromName)}</span>${esc(m.text)}`;
    }
    log.appendChild(d);
  });
  log.scrollTop = log.scrollHeight;
}

function sendChat() {
  const inp = $('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  socket.emit('chat', { channel: activeTab, text });
  inp.value = '';
}
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---------- 타이머 ----------
function startTimer() {
  clearInterval(timerInterval);
  const update = () => {
    if (!state || !state.timerEndsAt) { $('timer').textContent = ''; return; }
    const left = Math.max(0, Math.round((state.timerEndsAt - Date.now()) / 1000));
    $('timer').textContent = `⏱ ${left}s`;
  };
  update();
  timerInterval = setInterval(update, 500);
}

// ---------- 호스트 컨트롤 ----------
$('btnSkip').onclick = () => socket.emit('skipPhase');
$('btnRestart').onclick = () => socket.emit('restart');

// ---------- 결과 ----------
function renderEnd() {
  clearInterval(timerInterval);
  $('resultLabel').textContent = state.result.label;
  const ul = $('resultRoles');
  ul.innerHTML = '';
  state.result.fullRoles.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.alive ? '' : 'dead';
    li.innerHTML = `<span>${r.emoji}</span><span>${esc(r.name)}</span>
      <span class="rname t-${r.team}">${r.roleName}</span>`;
    ul.appendChild(li);
  });
  $('btnRestart').classList.toggle('hidden', !state.isHost);
  $('endHint').classList.toggle('hidden', state.isHost);
}

// ---------- 관전 모드 ----------
const TEAM_KO = { mafia: '🔴마피아', citizen: '🔵시민' };
function renderSpectate() {
  if (!spState) return;
  const s = spState;
  const isNight = s.phase === 'night';
  const lbl = $('spPhase');
  lbl.className = 'phase ' + (isNight ? 'night' : 'day');
  lbl.textContent = s.phase === 'lobby' ? '대기 중'
    : s.phase === 'ended' ? '🏁 게임 종료'
    : isNight ? `🌙 ${s.day}일차 밤`
    : s.phase === 'dayVote' ? `🗳️ ${s.day}일차 투표`
    : `☀️ ${s.day}일차 낮`;

  // 타이머
  clearInterval(timerInterval);
  const upd = () => {
    if (!spState || !spState.timerEndsAt || spState.phase === 'ended') { $('spTimer').textContent = ''; return; }
    const left = Math.max(0, Math.round((spState.timerEndsAt - Date.now()) / 1000));
    $('spTimer').textContent = `⏱ ${left}s`;
  };
  upd(); timerInterval = setInterval(upd, 500);

  // 플레이어 (역할 공개)
  const ul = $('spPlayers');
  ul.innerHTML = '';
  s.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = p.alive ? '' : 'dead';
    li.innerHTML = `<span>${p.roleEmoji}</span>
      <span>${esc(p.name)}</span>
      <span class="rname t-${p.team}">${p.roleName}</span>`;
    ul.appendChild(li);
  });

  // 결과
  const rc = $('spResult');
  if (s.phase === 'ended' && s.result) {
    rc.classList.remove('hidden');
    rc.innerHTML = `<h2>${s.result.label}</h2><p class="muted">위 명단에서 각자의 직업을 확인하세요.</p>`;
  } else {
    rc.classList.add('hidden');
  }

  renderSpectatorTabs();
  renderSpectatorChat();
}

function renderSpectatorTabs() {
  const tabs = $('spTabs');
  tabs.innerHTML = '';
  [['public', '전체'], ['mafia', '마피아'], ['lovers', '연인']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = key + (key === spTab ? ' active' : '');
    const n = (histories[key] || []).length;
    b.textContent = `${label}${n ? ' (' + n + ')' : ''}`;
    b.onclick = () => { spTab = key; renderSpectatorTabs(); renderSpectatorChat(); };
    tabs.appendChild(b);
  });
}

function renderSpectatorChat() {
  const log = $('spLog');
  if (!log) return;
  const msgs = histories[spTab] || [];
  log.innerHTML = '';
  msgs.forEach((m) => {
    const d = document.createElement('div');
    if (m.system) { d.className = 'msg system'; d.textContent = m.text; }
    else { d.className = 'msg'; d.innerHTML = `<span class="who">${esc(m.fromName)}</span>${esc(m.text)}`; }
    log.appendChild(d);
  });
  log.scrollTop = log.scrollHeight;
}

// ---------- 유틸 ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nameById(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : '???';
}
