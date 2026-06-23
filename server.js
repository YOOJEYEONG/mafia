import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { GameRoom } from './game.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map(); // code -> GameRoom

function makeRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}
function makePlayerId() {
  return randomBytes(8).toString('hex');
}

function sendInit(socket, room, playerId) {
  const p = room.players.get(playerId);
  socket.emit('joined', { code: room.code, playerId, name: p.name });
  socket.emit('chatHistory', room.chatHistoryFor(p));
  socket.emit('state', room.stateFor(p));
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.on('createRoom', ({ name }, cb) => {
    const cleanName = String(name || '').trim().slice(0, 16);
    if (!cleanName) return cb && cb({ error: '이름을 입력하세요.' });
    const code = makeRoomCode();
    const room = new GameRoom(io, code);
    rooms.set(code, room);
    const playerId = makePlayerId();
    room.addPlayer(playerId, cleanName, socket.id);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    cb && cb({ ok: true, code, playerId });
    sendInit(socket, room, playerId);
    room.broadcast();
  });

  // 봇 8명과 함께 자동 진행되는 게임을 신(神) 관전 모드로 구경
  socket.on('createDemo', (_, cb) => {
    const code = makeRoomCode();
    const room = new GameRoom(io, code);
    rooms.set(code, room);
    room.addSpectator(socket.id);
    socket.data.roomCode = code;
    socket.data.spectator = true;
    const res = room.startDemo();
    if (res.error) { rooms.delete(code); return cb && cb(res); }
    cb && cb({ ok: true, code });
    socket.emit('chatHistory', room.allChatHistory());
    socket.emit('spectatorState', room.spectatorState());
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    const cleanName = String(name || '').trim().slice(0, 16);
    const room = rooms.get(String(code || '').trim());
    if (!room) return cb && cb({ error: '방을 찾을 수 없습니다.' });
    if (!cleanName) return cb && cb({ error: '이름을 입력하세요.' });
    if (room.phase !== 'lobby') return cb && cb({ error: '이미 게임이 진행 중입니다.' });
    if (room.list().length >= 12) return cb && cb({ error: '방이 가득 찼습니다 (최대 12인).' });
    if (room.list().some((p) => p.name === cleanName)) return cb && cb({ error: '이미 사용 중인 이름입니다.' });

    const playerId = makePlayerId();
    room.addPlayer(playerId, cleanName, socket.id);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    cb && cb({ ok: true, code, playerId });
    sendInit(socket, room, playerId);
    room.broadcast();
  });

  // 새로고침/재접속 복구
  socket.on('rejoin', ({ code, playerId }, cb) => {
    const room = rooms.get(String(code || '').trim());
    if (!room || !room.players.has(playerId)) {
      return cb && cb({ error: '세션을 복구할 수 없습니다.' });
    }
    room.attachSocket(playerId, socket.id);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    cb && cb({ ok: true, code, playerId });
    sendInit(socket, room, playerId);
    room.broadcast();
  });

  function ctx() {
    const room = rooms.get(socket.data.roomCode);
    return { room, playerId: socket.data.playerId };
  }

  socket.on('updateSettings', (settings) => {
    const { room, playerId } = ctx();
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
    const s = room.settings;
    if (Number.isFinite(settings.nightTime)) s.nightTime = Math.max(20, Math.min(180, settings.nightTime));
    if (Number.isFinite(settings.discussionTime)) s.discussionTime = Math.max(20, Math.min(300, settings.discussionTime));
    if (Number.isFinite(settings.voteTime)) s.voteTime = Math.max(15, Math.min(120, settings.voteTime));
    room.broadcast();
  });

  socket.on('startGame', (_, cb) => {
    const { room, playerId } = ctx();
    if (!room || room.hostId !== playerId) return;
    const res = room.start();
    cb && cb(res);
  });

  socket.on('nightAction', ({ targetId }) => {
    const { room, playerId } = ctx();
    if (room) room.submitNightAction(playerId, targetId);
  });

  socket.on('vote', ({ targetId }) => {
    const { room, playerId } = ctx();
    if (room) room.submitVote(playerId, targetId);
  });

  socket.on('chat', ({ channel, text }) => {
    const { room, playerId } = ctx();
    if (room) room.postChat(playerId, channel, text);
  });

  socket.on('skipPhase', () => {
    const { room, playerId } = ctx();
    if (room && room.hostId === playerId) room.skipPhase();
  });

  socket.on('restart', () => {
    const { room, playerId } = ctx();
    if (room && room.hostId === playerId) room.restart();
  });

  socket.on('leaveRoom', () => {
    const { room, playerId } = ctx();
    if (room) {
      room.handleDisconnect(playerId);
      cleanupRoom(room);
      room.broadcast();
    }
    socket.data.roomCode = null;
    socket.data.playerId = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.data.spectator) room.removeSpectator(socket.id);
    else room.handleDisconnect(socket.data.playerId);
    cleanupRoom(room);
    room.broadcast();
  });
});

function cleanupRoom(room) {
  const noHumans = !room.list().some((p) => !p.isBot);
  // 사람이 아무도 없고(또는 봇만 남고) 관전자도 없으면 방 제거
  if (room.spectators.size === 0 && (room.list().length === 0 || (room.isDemo && noHumans))) {
    room.clearTimer();
    room.phaseToken++; // 남은 봇 타이머 무효화
    rooms.delete(room.code);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎭 마피아 게임 서버 실행 중: http://localhost:${PORT}`);
});
