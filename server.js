const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { randomBytes } = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();

function randomId() {
  return randomBytes(4).toString('hex');
}

function randomRoomCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room, payload) {
  room.players.forEach((player) => send(player.ws, payload));
}

function buildPublicRoomState(room) {
  const { state, players } = room;
  const publicPlayers = players.map((player) => ({
    name: player.name,
    team: player.team,
    connected: player.ws.readyState === WebSocket.OPEN,
  }));
  return {
    roomId: state.roomId,
    status: state.status,
    teamNames: state.teamNames,
    scores: state.scores,
    turn: state.turn,
    boardCats: state.boardCats,
    currentQuestion: state.currentQuestion,
    players: publicPlayers,
  };
}

function createRoom(ws, name) {
  const roomId = randomRoomCode();
  const playerId = randomId();
  const room = {
    id: roomId,
    state: {
      roomId,
      status: 'waitingForOpponent',
      teamNames: [name || 'الفريق الأول', 'الفريق الثاني'],
      scores: [0, 0],
      turn: 0,
      boardCats: [],
      currentQuestion: null,
      selected: [],
      selectedSessions: {},
    },
    players: [
      {
        ws,
        id: playerId,
        name: name || 'الفريق الأول',
        team: 'A',
      },
    ],
  };

  ws.playerId = playerId;
  ws.roomId = roomId;
  ws.team = 'A';
  rooms.set(roomId, room);
  send(ws, { type: 'roomCreated', roomState: buildPublicRoomState(room) });
}

function joinRoom(ws, roomId, name) {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, { type: 'error', message: 'رمز الغرفة غير صالح أو لا يوجد غرفة بهذا الرمز.' });
    return;
  }
  if (room.players.length >= 2) {
    send(ws, { type: 'error', message: 'الرجاء اختيار غرفة أخرى، هذه الغرفة ممتلئة.' });
    return;
  }

  const playerId = randomId();
  room.players.push({ ws, id: playerId, name: name || 'الفريق الثاني', team: 'B' });
  ws.playerId = playerId;
  ws.roomId = roomId;
  ws.team = 'B';

  room.state.status = 'setup';
  room.state.teamNames = [
    room.players[0].name,
    room.players[1].name,
  ];

  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function handleStartGame(room, payload) {
  if (!payload || !Array.isArray(payload.boardCats)) {
    return;
  }

  room.state.boardCats = payload.boardCats;
  room.state.teamNames = payload.teamNames || room.state.teamNames;
  room.state.scores = [0, 0];
  room.state.turn = 0;
  room.state.currentQuestion = null;
  room.state.status = 'playing';
  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function handlePickCell(room, payload) {
  const { colIdx, qIdx, playerTeam } = payload || {};
  const state = room.state;
  if (!state.boardCats[colIdx] || !state.boardCats[colIdx].questions[qIdx]) return;
  if (state.status !== 'playing' || state.turn !== playerTeam) return;

  const question = state.boardCats[colIdx].questions[qIdx];
  if (question.used) return;

  state.currentQuestion = {
    colIdx,
    qIdx,
    question: question.q,
    answer: question.a,
    diff: question.d,
    points: question.points,
    categoryName: state.boardCats[colIdx].name,
    categoryIcon: state.boardCats[colIdx].icon,
    sessionNum: state.boardCats[colIdx].sessionNum,
    revealed: false,
    stealActive: false,
    juryTeam: playerTeam,
  };
  state.status = 'questionOpen';
  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function handleRevealAnswer(room) {
  if (!room.state.currentQuestion) return;
  room.state.currentQuestion.revealed = true;
  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function closeQuestion(room) {
  const state = room.state;
  if (!state.currentQuestion) return;
  const { colIdx, qIdx } = state.currentQuestion;
  state.boardCats[colIdx].questions[qIdx].used = true;
  state.currentQuestion = null;
  state.turn = 1 - state.turn;
  state.status = 'playing';
}

function handleJudge(room, payload) {
  const { isCorrect } = payload || {};
  const state = room.state;
  if (!state.currentQuestion) return;

  const currentTurn = state.turn;
  if (isCorrect) {
    state.scores[currentTurn] += state.currentQuestion.points;
    closeQuestion(room);
  } else {
    state.currentQuestion.stealActive = true;
  }
  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function handleSteal(room, payload) {
  const { isCorrect } = payload || {};
  const state = room.state;
  if (!state.currentQuestion || !state.currentQuestion.stealActive) return;

  const otherTeam = 1 - state.turn;
  if (isCorrect) {
    state.scores[otherTeam] += state.currentQuestion.points;
  }
  closeQuestion(room);
  broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
}

function checkGameOver(room) {
  const finished = room.state.boardCats.length > 0 && room.state.boardCats.every((col) => col.questions.every((q) => q.used));
  if (finished) {
    room.state.status = 'finished';
    broadcastRoom(room, { type: 'stateUpdate', roomState: buildPublicRoomState(room) });
    return true;
  }
  return false;
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      send(ws, { type: 'error', message: 'بيانات غير صالحة' });
      return;
    }

    const { type } = data;
    if (type === 'createRoom') {
      createRoom(ws, data.name);
      return;
    }
    if (type === 'joinRoom') {
      joinRoom(ws, data.roomId, data.name);
      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) {
      send(ws, { type: 'error', message: 'لم يتم العثور على الغرفة. أعد المحاولة.' });
      return;
    }

    if (type === 'startGame') {
      handleStartGame(room, data);
      return;
    }
    if (type === 'pickCell') {
      handlePickCell(room, { colIdx: data.colIdx, qIdx: data.qIdx, playerTeam: ws.team === 'A' ? 0 : 1 });
      return;
    }
    if (type === 'revealAnswer') {
      handleRevealAnswer(room);
      return;
    }
    if (type === 'judge') {
      handleJudge(room, { isCorrect: data.isCorrect });
      checkGameOver(room);
      return;
    }
    if (type === 'stealJudge') {
      handleSteal(room, { isCorrect: data.isCorrect });
      checkGameOver(room);
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room.players = room.players.filter((player) => player.ws !== ws);
    if (room.players.length === 0) {
      rooms.delete(ws.roomId);
      return;
    }
    room.state.status = 'waitingForOpponent';
    broadcastRoom(room, { type: 'error', message: 'انقطع أحد اللاعبين، انتظر انضمام لاعب جديد.' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quiz Game matchmaking server is running on port ${PORT}`);
});
