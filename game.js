/* ======================= CONSTANTS ======================= */
const POINTS = { easy:100, medium:200, hard:300 };
const DIFF_LABEL = { easy:"سهل", medium:"متوسط", hard:"صعب" };

/* ======================= STATE ======================= */
let selected = [];          // selected category indices (max 6)
let selectedSessions = {};  // {catIdx: sessionNumber} (1-6)
let boardCats = [];         // the 6 chosen category objects with chosen session
let teamNames = ["الفريق الأول", "الفريق الثاني"];
let scores = [0,0];
let turn = 0;                // 0 = team A, 1 = team B
let currentCell = null;      // {colIndex, qIndex}
let answered = false;
let stealActive = false;

let onlineMode = false;
let onlineState = null;
let ws = null;
let myTeamIndex = 0;
let pendingOnlineRequest = null;

function resetLocalState(){
  selected = [];
  selectedSessions = {};
  boardCats = [];
  scores = [0,0];
  turn = 0;
  currentCell = null;
  answered = false;
  stealActive = false;
  document.getElementById('teamAName').value = '';
  document.getElementById('teamBName').value = '';
  renderCatGrid();
}

function resetOnlineState(){
  if(ws){
    ws.close();
    ws = null;
  }
  onlineState = null;
  myTeamIndex = 0;
  pendingOnlineRequest = null;
  document.getElementById('onlineError').textContent = '';
  document.getElementById('onlineStatus').textContent = 'أدخل اسمك ثم أنشئ غرفة أو انضم إلى غرفة موجودة.';
  document.getElementById('roomCodeLabel').textContent = '-';
  document.getElementById('onlinePlayersList').innerHTML = '';
  document.getElementById('onlinePlayerName').value = '';
  document.getElementById('onlineRoomCode').value = '';
}

function startLocalMode(){
  onlineMode = false;
  resetLocalState();
  goTo('picker');
}

function startOnlineMode(){
  onlineMode = true;
  resetOnlineState();
  goTo('online');
}

function leaveOnlineRoom(){
  resetOnlineState();
  goTo('home');
}

function setOnlineError(message){
  document.getElementById('onlineError').textContent = message;
}

function connectWebSocket(){
  if(ws && ws.readyState === WebSocket.OPEN){
    return;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let host = window.location.host;
  if(!host){
    host = 'localhost:3000';
  }
  ws = new WebSocket(`${protocol}://${host}`);
  ws.onopen = ()=>{
    if(pendingOnlineRequest){
      ws.send(JSON.stringify(pendingOnlineRequest));
      pendingOnlineRequest = null;
    }
  };
  ws.onmessage = (event)=>{
    const data = JSON.parse(event.data);
    handleWsMessage(data);
  };
  ws.onclose = ()=>{
    if(onlineMode){
      document.getElementById('onlineStatus').textContent = 'انقطع اتصال الخادم. أعد المحاولة.';
    }
  };
  ws.onerror = ()=>{
    setOnlineError('فشل الاتصال بخادم اللعبة.');
  };
}

function handleWsMessage(data){
  if(data.type === 'roomCreated'){
    onlineState = data.roomState;
    document.getElementById('roomCodeLabel').textContent = onlineState.roomId;
    document.getElementById('onlineStatus').textContent = 'تم إنشاء الغرفة. شارك الرمز مع خصمك.';
    document.getElementById('onlinePlayersList').innerHTML = `<div class="session-row"><strong>أنت:</strong> ${document.getElementById('onlinePlayerName').value || 'أنت'}</div>`;
    goTo('online-waiting');
    return;
  }
  if(data.type === 'stateUpdate'){
    applyRoomState(data.roomState);
    return;
  }
  if(data.type === 'answerFeedback'){
    handleOnlineAnswerFeedback(data.feedback);
    return;
  }
  if(data.type === 'error'){
    setOnlineError(data.message || 'حدث خطأ');
    return;
  }
}

function createOnlineRoom(){
  const name = document.getElementById('onlinePlayerName').value.trim();
  if(!name){
    setOnlineError('أدخل اسم فريقك أولاً.');
    return;
  }
  myTeamIndex = 0;
  connectWebSocket();
  pendingOnlineRequest = { type:'createRoom', name };
}

function joinOnlineRoom(){
  const name = document.getElementById('onlinePlayerName').value.trim();
  const roomId = document.getElementById('onlineRoomCode').value.trim().toUpperCase();
  if(!name || !roomId){
    setOnlineError('ادخل اسمك ورمز الغرفة للانضمام.');
    return;
  }
  myTeamIndex = 1;
  connectWebSocket();
  pendingOnlineRequest = { type:'joinRoom', roomId, name };
}

function applyRoomState(state){
  onlineState = state;
  document.getElementById('roomCodeLabel').textContent = state.roomId;
  document.getElementById('onlinePlayersList').innerHTML = state.players.map(p => {
    const label = p.team === 'A' ? 'الفريق المضيف' : 'الفريق الضيف';
    return `<div class="session-row"><strong>${label}:</strong> ${p.name}${p.connected ? ' ✅' : ' ❌'}</div>`;
  }).join('');

  if(state.status === 'waitingForOpponent'){
    document.getElementById('onlineStatus').textContent = 'في انتظار لاعب آخر للانضمام...';
    goTo('online-waiting');
    return;
  }

  if(state.status === 'setup'){
    document.getElementById('onlineStatus').textContent = myTeamIndex === 0 ? 'أنت المضيف. اختر الفئات ثم ابدأ اللعبة.' : 'في انتظار المضيف لاختيار الفئات.';
    document.getElementById('teamAName').value = state.teamNames[0];
    document.getElementById('teamBName').value = state.teamNames[1];
    renderCatGrid();
    if(myTeamIndex === 0){
      goTo('picker');
    } else {
      goTo('online-waiting');
    }
    return;
  }

  if(state.status === 'questionOpen'){
    teamNames = state.teamNames;
    scores = state.scores;
    turn = state.turn;
    boardCats = state.boardCats;
    renderScoreboard();
    renderBoard();
    goTo('board');
    openOnlineQuestionModal(state.currentQuestion);
    return;
  }

  if(state.status === 'playing' || state.status === 'finished'){
      teamNames = state.teamNames;
      scores = state.scores;
      turn = state.turn;
      boardCats = state.boardCats;
      renderScoreboard();
      renderBoard();
      goTo('board');
      document.getElementById('qModal').classList.add('hidden');
      if(state.status === 'finished'){
        showResults();
      }
      return;
    }
}

function openOnlineQuestionModal(questionState){
  if(!questionState) return;
  document.getElementById('qIcon').textContent = questionState.categoryIcon;
  document.getElementById('qCatName').textContent = `${questionState.categoryName} • ${DIFF_LABEL[questionState.diff]} (جلسة ${questionState.sessionNum})`;
  document.getElementById('qPoints').textContent = questionState.points;
  document.getElementById('qText').textContent = questionState.question;
  document.getElementById('qAnswer').textContent = questionState.answer;
  document.getElementById('qTurn').textContent = 'دور ' + teamNames[turn];
  document.getElementById('qTurn').className = 'q-turn ' + (turn===0 ? 'teamA' : 'teamB');
  document.getElementById('answerInput').value = '';
  document.getElementById('answerFeedback').textContent = '';
  document.getElementById('answerBox').classList.add('hidden');
  document.getElementById('waitingForAnswer').classList.add('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  document.getElementById('judgeWrap').classList.add('hidden');
  const isMyTurn = (myTeamIndex === turn && !questionState.stealActive) || (myTeamIndex !== turn && questionState.stealActive);
  if(isMyTurn){
    document.getElementById('answerInput').disabled = false;
    document.getElementById('submitAnswerBtn').disabled = false;
    document.getElementById('answerInput').style.opacity = '1';
    document.getElementById('submitAnswerBtn').style.opacity = '1';
  } else {
    document.getElementById('answerInput').disabled = true;
    document.getElementById('submitAnswerBtn').disabled = true;
    document.getElementById('answerInput').style.opacity = '0.5';
    document.getElementById('submitAnswerBtn').style.opacity = '0.5';
    document.getElementById('waitingForAnswer').classList.remove('hidden');
  }
  document.getElementById('stealWrap').classList.toggle('hidden', !questionState.stealActive);
  if(questionState.stealActive){
    const otherTeam = 1 - turn;
    document.getElementById('stealTag').textContent = `فرصة سرقة لفريق: ${teamNames[otherTeam]} 🎯`;
  }
  document.getElementById('qModal').classList.remove('hidden');
}

function handleOnlineAnswerFeedback(feedback){
  if(!feedback) return;
  const feedbackEl = document.getElementById('answerFeedback');
  feedbackEl.textContent = feedback.message || '';
  
  // Always show the answer in online mode (system judges, not players)
  document.getElementById('answerBox').classList.remove('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  
  if(feedback.answer){
    document.getElementById('qAnswer').textContent = feedback.answer;
  }
  
  // Disable input after answer is revealed
  document.getElementById('answerInput').disabled = true;
  document.getElementById('submitAnswerBtn').disabled = true;
  document.getElementById('answerInput').style.opacity = '0.5';
  document.getElementById('submitAnswerBtn').style.opacity = '0.5';
  document.getElementById('waitingForAnswer').classList.add('hidden');
  
  // Hide judge buttons - system auto-judges in online mode, no manual judging
  document.getElementById('judgeWrap').classList.add('hidden');
}

function sendWs(payload){
  if(!ws || ws.readyState !== WebSocket.OPEN){
    setOnlineError('الاتصال لم يكتمل. أعد المحاولة.');
    return;
  }
  ws.send(JSON.stringify(payload));
}

function makeBoardCatsForOnline(){
  return selected.map(idx=>{
    const c = CATEGORIES[idx];
    const sessionNum = selectedSessions[idx] || 1;
    const session = c.sessions[sessionNum - 1];
    const easies = session.filter(x => x.d === 'easy');
    const meds = session.filter(x => x.d === 'medium');
    const hards = session.filter(x => x.d === 'hard');
    const ordered = [...easies, ...meds, ...hards].map(q => ({ ...q, used:false, points: POINTS[q.d] }));
    return { name:c.name, icon:c.icon, sessionNum, questions:ordered };
  });
}

function openQuestionOnline(colIdx, qIdx){
  if(!onlineMode || myTeamIndex !== turn) return;
  sendWs({ type:'pickCell', colIdx, qIdx });
}

/* ======================= SCREEN NAV ======================= */
function goTo(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById('screen-'+id).classList.remove('hidden');
}

/* ======================= CATEGORY PICKER ======================= */
function renderCatGrid(){
  const grid = document.getElementById('catGrid');
  grid.innerHTML = '';
  const canEdit = !onlineMode || myTeamIndex === 0;
  CATEGORIES.forEach((c, idx)=>{
    const card = document.createElement('div');
    card.className = 'cat-card' + (selected.includes(idx) ? ' selected' : '');
    card.innerHTML = `<div class="badge">${selected.indexOf(idx)>-1 ? (selected.indexOf(idx)+1) : ''}</div>
                       <div class="icon">${c.icon}</div><div class="name">${c.name}</div>`;
    if(canEdit){
      card.onclick = ()=> toggleCat(idx);
    } else {
      card.style.opacity = '0.55';
      card.style.cursor = 'not-allowed';
    }
    grid.appendChild(card);
  });
  document.getElementById('pickCount').textContent = selected.length;
  document.getElementById('toSessions').disabled = (!canEdit) || selected.length !== 6;
}

function toggleCat(idx){
  if(onlineMode && myTeamIndex !== 0) return;
  const pos = selected.indexOf(idx);
  if(pos > -1){ selected.splice(pos,1); delete selectedSessions[idx]; }
  else{
    if(selected.length >= 6) return;
    selected.push(idx);
    selectedSessions[idx] = 1; // default to session 1
  }
  renderCatGrid();
}

document.getElementById('toSessions').onclick = ()=>{
  if(selected.length === 6){
    renderSessionGrid();
    goTo('sessions');
  }
};

/* ======================= SESSION PICKER ======================= */
function renderSessionGrid(){
  const grid = document.getElementById('sessionGrid');
  grid.innerHTML = '';
  selected.forEach((catIdx, orderIdx) =>{
    const c = CATEGORIES[catIdx];
    const row = document.createElement('div');
    row.className = 'session-row' + (selectedSessions[catIdx] ? ' done' : '');

    let btnsHtml = '';
    for(let s=1; s<=6; s++){
      const isSel = selectedSessions[catIdx] === s;
      btnsHtml += `<button class="btn session-btn ${isSel?'selected':''}" onclick="pickSession(${catIdx},${s})" ${!selectedSessions[catIdx] || isSel ? '' : ''}>${s}</button>`;
    }

    row.innerHTML = `
      <div class="cat-info">
        <div class="cat-icon">${c.icon}</div>
        <div class="cat-name">${c.name}</div>
      </div>
      <div class="session-btns">${btnsHtml}</div>
    `;
    grid.appendChild(row);
  });
  checkAllSessionsPicked();
}

function pickSession(catIdx, sessionNum){
  if(onlineMode && myTeamIndex !== 0) return;
  selectedSessions[catIdx] = sessionNum;
  renderSessionGrid();
}

function checkAllSessionsPicked(){
  const allPicked = selected.every(idx => selectedSessions[idx] >= 1 && selectedSessions[idx] <= 6);
  const canEdit = !onlineMode || myTeamIndex === 0;
  document.getElementById('toTeams').disabled = !canEdit || !allPicked;
}

document.getElementById('toTeams').onclick = ()=>{
  if(selected.every(idx => selectedSessions[idx] >= 1)){
    if(onlineMode && myTeamIndex !== 0) return;
    goTo('teams');
  }
};

/* ======================= TEAM SETUP ======================= */
document.getElementById('startGame').onclick = ()=>{
  if(onlineMode){
    if(myTeamIndex !== 0){
      setOnlineError('فقط المضيف يمكنه بدء اللعبة عبر الإنترنت.');
      return;
    }
    const a = document.getElementById('teamAName').value.trim() || onlineState.teamNames[0];
    const b = document.getElementById('teamBName').value.trim() || onlineState.teamNames[1];
    teamNames = [ a, b ];
    const board = makeBoardCatsForOnline();
    sendWs({ type:'startGame', boardCats: board, teamNames });
    return;
  }
  const a = document.getElementById('teamAName').value.trim();
  const b = document.getElementById('teamBName').value.trim();
  teamNames = [ a || "الفريق الأول", b || "الفريق الثاني" ];
  buildBoard();
  goTo('board');
};

/* ======================= BUILD BOARD ======================= */
function buildBoard(){
  scores = [0,0];
  turn = 0;
  boardCats = selected.map(idx=>{
    const c = CATEGORIES[idx];
    const sessionNum = selectedSessions[idx] || 1;
    const session = c.sessions[sessionNum - 1]; // 0-indexed
    const easies = session.filter(x=>x.d==='easy');
    const meds   = session.filter(x=>x.d==='medium');
    const hards  = session.filter(x=>x.d==='hard');
    const ordered = [...easies, ...meds, ...hards].map(q=>({...q, used:false}));
    return { name:c.name, icon:c.icon, sessionNum:sessionNum, questions:ordered };
  });
  renderScoreboard();
  renderBoard();
}

function renderScoreboard(){
  document.getElementById('nameA').textContent = teamNames[0];
  document.getElementById('nameB').textContent = teamNames[1];
  document.getElementById('scoreA').textContent = scores[0];
  document.getElementById('scoreB').textContent = scores[1];
  document.getElementById('cardA').classList.toggle('active', turn===0);
  document.getElementById('cardB').classList.toggle('active', turn===1);
}

function renderBoard(){
  const board = document.getElementById('board');
  board.innerHTML = '';
  boardCats.forEach((cat, colIdx)=>{
    const col = document.createElement('div');
    col.className = 'board-col';
    const head = document.createElement('div');
    head.className = 'col-head';
    head.innerHTML = `<div class="icon">${cat.icon}</div><div class="name">${cat.name}</div><div style="font-size:9px;color:var(--ink-dim);margin-top:2px;">جلسة ${cat.sessionNum}</div>`;
    col.appendChild(head);
    cat.questions.forEach((q, qIdx)=>{
      const cell = document.createElement('div');
      cell.className = 'cell ' + q.d + (q.used ? ' used' : '');
      cell.textContent = q.used ? '✓' : POINTS[q.d];
      if(!q.used){
        const canPick = !onlineMode || (myTeamIndex === turn && onlineState && onlineState.status === 'playing');
        if(canPick){
          cell.onclick = ()=> openQuestion(colIdx, qIdx);
        } else {
          cell.style.cursor = 'not-allowed';
          cell.style.opacity = '0.7';
        }
      }
      col.appendChild(cell);
    });
    board.appendChild(col);
  });
}

/* ======================= QUESTION FLOW ======================= */

function openQuestion(colIdx, qIdx){
  if(onlineMode){
    openQuestionOnline(colIdx, qIdx);
    return;
  }
  currentCell = {colIdx, qIdx};
  answered = false;
  stealActive = false;
  const cat = boardCats[colIdx];
  const q = cat.questions[qIdx];
  document.getElementById('qIcon').textContent = cat.icon;
  document.getElementById('qCatName').textContent = cat.name + ' • ' + DIFF_LABEL[q.d] + ' (جلسة ' + cat.sessionNum + ')';
  document.getElementById('qPoints').textContent = POINTS[q.d];
  document.getElementById('qText').textContent = q.q;
  document.getElementById('qAnswer').textContent = q.a;
  document.getElementById('qTurn').textContent = 'دور ' + teamNames[turn];
  document.getElementById('qTurn').className = 'q-turn ' + (turn===0 ? 'teamA' : 'teamB');
  document.getElementById('answerInput').value = '';
  document.getElementById('answerFeedback').textContent = '';
  document.getElementById('answerBox').classList.add('hidden');
  document.getElementById('showAnswerBtn').classList.remove('hidden');
  document.getElementById('judgeWrap').classList.add('hidden');
  document.getElementById('stealWrap').classList.add('hidden');
  document.getElementById('qModal').classList.remove('hidden');
}

function normalizeText(text){
  if(!text) return '';
  const stripped = text.replace(/[ -]/g, ' ');
  const noDiacritics = stripped.replace(/[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g, '');
  const clean = noDiacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return clean;
}function isAnswerApproximate(guess, answer){
  const cleanGuess = normalizeText(guess);
  const cleanAnswer = normalizeText(answer);
  if(!cleanGuess || !cleanAnswer) return false;
  if(cleanGuess === cleanAnswer) return true;
  if(cleanAnswer.includes(cleanGuess) || cleanGuess.includes(cleanAnswer)) return true;
  const guessWords = cleanGuess.split(' ');
  const answerWords = cleanAnswer.split(' ');
  const shared = answerWords.filter(word=> word && guessWords.includes(word)).length;
  if(shared >= Math.max(1, Math.ceil(answerWords.length * 0.6))) return true;
  if(answerWords.length >= 2 && shared >= Math.max(1, Math.ceil(answerWords.length * 0.5))) return true;
  const guessNumber = (guess.match(/\d+/g) || []).join('');
  const answerNumber = (answer.match(/\d+/g) || []).join('');
  if(guessNumber && answerNumber && guessNumber === answerNumber) return true;
  return false;
}

function submitAnswer(){
  const guess = document.getElementById('answerInput').value.trim();
  if(!guess){
    document.getElementById('answerFeedback').textContent = 'اكتب إجابتك أولاً.';
    return;
  }
  if(onlineMode){
    sendWs({ type:'submitAnswer', answer: guess });
    document.getElementById('answerFeedback').textContent = 'جاري التحقق...';
    document.getElementById('answerInput').disabled = true;
    document.getElementById('submitAnswerBtn').disabled = true;
    document.getElementById('answerInput').style.opacity = '0.5';
    document.getElementById('submitAnswerBtn').style.opacity = '0.5';
    return;
  }
  const {colIdx, qIdx} = currentCell;
  const q = boardCats[colIdx].questions[qIdx];
  const otherTeam = 1 - turn;
  const correct = isAnswerApproximate(guess, q.a);
  if(!stealActive){
    if(correct){
      scores[turn] += POINTS[q.d];
      document.getElementById('answerFeedback').textContent = `إجابة صحيحة! حصل ${teamNames[turn]} على ${POINTS[q.d]} نقطة.`;
      document.getElementById('answerBox').classList.remove('hidden');
      document.getElementById('showAnswerBtn').classList.add('hidden');
      setTimeout(()=> closeCell(), 1300);
      return;
    }
    stealActive = true;
    document.getElementById('answerFeedback').textContent = `إجابة خاطئة. الآن دور ${teamNames[otherTeam]} للسرقة.`;
    document.getElementById('qTurn').textContent = 'دور ' + teamNames[otherTeam];
    document.getElementById('qTurn').className = 'q-turn ' + (otherTeam===0 ? 'teamA' : 'teamB');
    document.getElementById('answerInput').value = '';
    return;
  }
  // steal attempt
  if(correct){
    scores[otherTeam] += POINTS[q.d];
    document.getElementById('answerFeedback').textContent = `إجابة السرقة صحيحة! حصل ${teamNames[otherTeam]} على ${POINTS[q.d]} نقطة.`;
  } else {
    document.getElementById('answerFeedback').textContent = `إجابة السرقة خاطئة. الإجابة الصحيحة: ${q.a}`;
  }
  document.getElementById('answerBox').classList.remove('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  setTimeout(()=> closeCell(), 1700);
}

function revealAnswer(){
  if(onlineMode){
    sendWs({ type:'revealAnswer' });
    return;
  }
  document.getElementById('answerBox').classList.remove('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
}

function closeCell(){
  if(onlineMode) return;
  const {colIdx, qIdx} = currentCell;
  const q = boardCats[colIdx].questions[qIdx];
  q.used = true;
  document.getElementById('qModal').classList.add('hidden');
  document.getElementById('answerInput').value = '';
  document.getElementById('answerFeedback').textContent = '';
  turn = 1 - turn;
  renderScoreboard();
  renderBoard();
  checkGameOver();
}

function judge(isCorrect){
  if(onlineMode){
    sendWs({ type:'judge', isCorrect });
    return;
  }
  if(answered) return;
  const {colIdx, qIdx} = currentCell;
  const q = boardCats[colIdx].questions[qIdx];
  if(isCorrect){
    answered = true;
    scores[turn] += POINTS[q.d];
    closeCell();
    return;
  }
  // wrong answer -> offer the other team a steal
  const otherTeam = 1 - turn;
  document.getElementById('judgeWrap').classList.add('hidden');
  document.getElementById('stealWrap').classList.remove('hidden');
  document.getElementById('stealTag').textContent = `فرصة سرقة لفريق: ${teamNames[otherTeam]} 🎯`;
  stealActive = true;
}

function stealJudge(isCorrect){
  if(onlineMode){
    sendWs({ type:'stealJudge', isCorrect });
    return;
  }
  if(answered) return;
  answered = true;
  const {colIdx, qIdx} = currentCell;
  const q = boardCats[colIdx].questions[qIdx];
  const otherTeam = 1 - turn;
  if(isCorrect){ scores[otherTeam] += POINTS[q.d]; }
  closeCell();
}

function checkGameOver(){
  const allUsed = boardCats.every(c => c.questions.every(q=>q.used));
  if(allUsed){
    setTimeout(showResults, 350);
  }
}

/* ======================= RESULTS ======================= */
function showResults(){
  document.getElementById('resNameA').textContent = teamNames[0];
  document.getElementById('resNameB').textContent = teamNames[1];
  document.getElementById('resScoreA').textContent = scores[0];
  document.getElementById('resScoreB').textContent = scores[1];
  let title;
  if(scores[0] === scores[1]) title = 'تعادل مثير! 🤝';
  else{
    const winner = scores[0] > scores[1] ? teamNames[0] : teamNames[1];
    title = `الفريق الفائز: ${winner} 🎉`;
  }
  document.getElementById('resultTitle').textContent = title;
  goTo('results');
}

/* ======================= RESTART ======================= */
function confirmRestart(){
  if(confirm('هل تريدون بدء لعبة جديدة؟ سيتم فقدان النتيجة الحالية.')){
    selected = [];
    selectedSessions = {};
    document.getElementById('teamAName').value = '';
    document.getElementById('teamBName').value = '';
    document.getElementById('qModal').classList.add('hidden');
    renderCatGrid();
    goTo('picker');
  }
}

/* ======================= INIT ======================= */
document.addEventListener('DOMContentLoaded', ()=>{
  renderCatGrid();
  goTo('home');
});

