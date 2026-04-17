(() => {
  "use strict";

  const EMPTY = 0, BLACK = 1, WHITE = 2, WALL = 3;
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

  const WEIGHTS = [
    [100, -20,  10,   5,   5,  10, -20, 100],
    [-20, -50,  -2,  -2,  -2,  -2, -50, -20],
    [ 10,  -2,   8,   1,   1,   8,  -2,  10],
    [  5,  -2,   1,   0,   0,   1,  -2,   5],
    [  5,  -2,   1,   0,   0,   1,  -2,   5],
    [ 10,  -2,   8,   1,   1,   8,  -2,  10],
    [-20, -50,  -2,  -2,  -2,  -2, -50, -20],
    [100, -20,  10,   5,   5,  10, -20, 100],
  ];

  const POWERUP_TYPES = [
    { id: "explosion", emoji: "\uD83D\uDCA5", name: "Explosion",   desc: "Surrounding discs cleared!" },
    { id: "double",    emoji: "\u23E9",         name: "Double Turn", desc: "Extra turn granted!" },
    { id: "convert",   emoji: "\uD83D\uDD04", name: "Convert",     desc: "Adjacent enemies converted!" },
    { id: "snipe",     emoji: "\uD83C\uDFAF", name: "Snipe",       desc: "3 opponent discs removed!" },
    { id: "fortify",   emoji: "\uD83D\uDEE1\uFE0F", name: "Fortify", desc: "Bonus discs placed!" },
  ];

  const KOTH_CELLS = [[3,3],[3,4],[4,3],[4,4]];
  const KOTH_MOVE_LIMIT = 30;
  const BLITZ_TIME = 60;
  const SPEED_TIME = 5;
  const SHRINK_INTERVAL = 8;


  // === State ===
  let board, currentPlayer, gameOver, mode, aiDepth, lastMove, variant;
  let aiThinking = false;
  // Vanish
  let discAge, moveNumber, vanishMode, vanishLife;
  // Powerups
  let powerupMode, powerup, turnsSinceLastPowerup, nextPowerupIn, extraTurn;
  // Shrinking
  let shrinkLevel, totalMoves;
  // Timers
  let blackTime, whiteTime, timerInterval;
  let speedInterval, speedCountdown;
  // Plague
  let plagueInfo;
  // Cascade
  let cascadeFlips;
  // Online P2P
  let netRole = null;   // null | 'host' | 'guest'
  let myColor = BLACK;  // which color the local player controls in online mode
  let peer = null;
  let conn = null;
  let hostSettings = null; // guest holds settings received from host


  // === DOM Refs ===
  const boardEl = document.getElementById("board");
  const blackScoreEl = document.getElementById("black-score");
  const whiteScoreEl = document.getElementById("white-score");
  const turnDisc = document.getElementById("turn-disc");
  const turnText = document.getElementById("turn-text");
  const messageBar = document.getElementById("message-bar");
  const modeSelect = document.getElementById("mode-select");
  const difficultySelect = document.getElementById("difficulty-select");
  const difficultyGroup = document.getElementById("difficulty-group");
  const newGameBtn = document.getElementById("new-game-btn");
  const blackCard = document.getElementById("black-score-card");
  const whiteCard = document.getElementById("white-score-card");
  const themeSelect = document.getElementById("theme-select");
  const variantSelect = document.getElementById("variant-select");
  const lifespanGroup = document.getElementById("lifespan-group");
  const lifespanSelect = document.getElementById("lifespan-select");
  const blackTimerEl = document.getElementById("black-timer");
  const whiteTimerEl = document.getElementById("white-timer");

  const lobbyOverlay = document.getElementById("lobby-overlay");
  const lobbyIntro = document.getElementById("lobby-intro");
  const lobbyHost = document.getElementById("lobby-host");
  const lobbyJoin = document.getElementById("lobby-join");
  const lobbyHostBtn = document.getElementById("lobby-host-btn");
  const lobbyJoinBtn = document.getElementById("lobby-join-btn");
  const lobbyCancelBtn = document.getElementById("lobby-cancel-btn");
  const lobbyHostIdEl = document.getElementById("lobby-host-id");
  const lobbyHostStatus = document.getElementById("lobby-host-status");
  const lobbyHostBack = document.getElementById("lobby-host-back");
  const lobbyCopyBtn = document.getElementById("lobby-copy-btn");
  const lobbyJoinInput = document.getElementById("lobby-join-input");
  const lobbyJoinSubmit = document.getElementById("lobby-join-submit");
  const lobbyJoinStatus = document.getElementById("lobby-join-status");
  const lobbyJoinBack = document.getElementById("lobby-join-back");
  const netStatusEl = document.getElementById("net-status");

  // --- Theme ---
  function isOpponentTurn() {
    if (mode === "ai" && currentPlayer === WHITE) return true;
    if (mode === "online" && currentPlayer !== myColor) return true;
    return false;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("reversi-theme", theme);
  }
  function loadTheme() {
    const saved = localStorage.getItem("reversi-theme") || "classic";
    themeSelect.value = saved;
    applyTheme(saved);
  }
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));


  // === Board Logic ===

  function createBoard() {
    const b = Array.from({ length: 8 }, () => new Array(8).fill(EMPTY));
    b[3][3] = WHITE; b[3][4] = BLACK;
    b[4][3] = BLACK; b[4][4] = WHITE;
    return b;
  }

  function createAgeGrid() {
    const a = Array.from({ length: 8 }, () => new Array(8).fill(-1));
    a[3][3] = 0; a[3][4] = 0; a[4][3] = 0; a[4][4] = 0;
    return a;
  }

  function createObstaclesBoard() {
    const b = createBoard();
    const wallCount = 6 + Math.floor(Math.random() * 5);
    const empties = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c] === EMPTY) empties.push([r, c]);
    shuffle(empties);
    for (let i = 0; i < Math.min(wallCount, empties.length); i++)
      b[empties[i][0]][empties[i][1]] = WALL;
    if (getValidMoves(b, BLACK).length === 0) return createObstaclesBoard();
    return b;
  }

  function createBossBoard() {
    const b = Array.from({ length: 8 }, () => new Array(8).fill(EMPTY));
    const boss = [[2,3],[2,4],[3,2],[3,3],[3,4],[3,5],[4,2],[4,3],[4,4],[4,5],[5,3],[5,4]];
    for (const [r, c] of boss) b[r][c] = BLACK;
    b[6][3] = WHITE; b[6][4] = WHITE; b[5][2] = WHITE; b[5][5] = WHITE;
    if (getValidMoves(b, BLACK).length === 0 || getValidMoves(b, WHITE).length === 0)
      return createBoard();
    return b;
  }

  function createRandomBoard() {
    const b = Array.from({ length: 8 }, () => new Array(8).fill(EMPTY));
    const count = 8 + Math.floor(Math.random() * 5);
    const cells = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) cells.push([r, c]);
    shuffle(cells);
    for (let i = 0; i < count; i++)
      b[cells[i][0]][cells[i][1]] = Math.random() < 0.5 ? BLACK : WHITE;
    // Ensure at least 2 of each
    let bc = 0, wc = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        if (b[r][c] === BLACK) bc++;
        else if (b[r][c] === WHITE) wc++;
      }
    for (let i = 0; i < count && bc < 2; i++) {
      const [r,c] = cells[i];
      if (b[r][c] === WHITE) { b[r][c] = BLACK; bc++; wc--; }
    }
    for (let i = 0; i < count && wc < 2; i++) {
      const [r,c] = cells[i];
      if (b[r][c] === BLACK) { b[r][c] = WHITE; wc++; bc--; }
    }
    if (getValidMoves(b, BLACK).length === 0 && getValidMoves(b, WHITE).length === 0)
      return createRandomBoard();
    return b;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function opponent(player) { return player === BLACK ? WHITE : BLACK; }

  function getCellRing(r, c) { return Math.min(r, c, 7 - r, 7 - c); }

  function getFlips(b, r, c, player) {
    if (!inBounds(r, c) || b[r][c] !== EMPTY) return [];
    const opp = opponent(player);
    const allFlips = [];
    for (const [dr, dc] of DIRS) {
      const flips = [];
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc) && b[nr][nc] === opp) {
        flips.push([nr, nc]);
        nr += dr; nc += dc;
      }
      if (flips.length > 0 && inBounds(nr, nc) && b[nr][nc] === player) {
        allFlips.push(...flips);
      }
    }
    return allFlips;
  }

  function getValidMoves(b, player) {
    const moves = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (getFlips(b, r, c, player).length > 0) moves.push([r, c]);
    return moves;
  }

  function applyMove(b, r, c, player) {
    const nb = b.map(row => [...row]);
    const flips = getFlips(nb, r, c, player);
    nb[r][c] = player;
    for (const [fr, fc] of flips) nb[fr][fc] = player;
    return { board: nb, flips };
  }

  function applyMoveWithDecay(b, ages, r, c, player, moveNum, life) {
    const nb = b.map(row => [...row]);
    const na = ages.map(row => [...row]);
    const flips = getFlips(nb, r, c, player);
    nb[r][c] = player;
    na[r][c] = moveNum;
    for (const [fr, fc] of flips) { nb[fr][fc] = player; na[fr][fc] = moveNum; }
    const decayed = [];
    for (let dr = 0; dr < 8; dr++)
      for (let dc = 0; dc < 8; dc++)
        if (nb[dr][dc] !== EMPTY && nb[dr][dc] !== WALL && (moveNum - na[dr][dc]) >= life) {
          nb[dr][dc] = EMPTY; na[dr][dc] = -1; decayed.push([dr, dc]);
        }
    return { board: nb, ages: na, flips, decayed };
  }

  function applyCascadeFlips(b, initialFlips, player) {
    let pending = [...initialFlips];
    const all = [];
    const flippedSet = new Set(initialFlips.map(([r,c]) => `${r},${c}`));
    while (pending.length > 0) {
      const next = [];
      for (const [r, c] of pending) {
        const opp = opponent(player);
        for (const [dr, dc] of DIRS) {
          const flips = [];
          let nr = r + dr, nc = c + dc;
          while (inBounds(nr, nc) && b[nr][nc] === opp) {
            flips.push([nr, nc]); nr += dr; nc += dc;
          }
          if (flips.length > 0 && inBounds(nr, nc) && b[nr][nc] === player) {
            for (const [fr, fc] of flips) {
              const key = `${fr},${fc}`;
              if (!flippedSet.has(key)) {
                b[fr][fc] = player;
                flippedSet.add(key);
                next.push([fr, fc]);
                all.push([fr, fc]);
              }
            }
          }
        }
      }
      pending = next;
    }
    return all;
  }

  function countDiscs(b) {
    let black = 0, white = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        if (b[r][c] === BLACK) black++;
        else if (b[r][c] === WHITE) white++;
      }
    return { black, white };
  }

  function countKothScore(b) {
    let black = 0, white = 0;
    const centerSet = new Set(KOTH_CELLS.map(([r,c]) => `${r},${c}`));
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const mult = centerSet.has(`${r},${c}`) ? 3 : 1;
        if (b[r][c] === BLACK) black += mult;
        else if (b[r][c] === WHITE) white += mult;
      }
    return { black, white };
  }

  function getStealTargets(b, player) {
    const opp = opponent(player);
    const targets = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c] === opp) {
          for (const [dr, dc] of DIRS) {
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && b[nr][nc] === EMPTY) { targets.push([r, c]); break; }
          }
        }
    return targets;
  }

  function isVisible(r, c, player) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && board[nr][nc] === player) return true;
      }
    return false;
  }


  // === Powerup Logic ===

  function spawnPowerup() {
    const empties = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === EMPTY) empties.push([r, c]);
    if (empties.length === 0) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    powerup = { r, c, type };
  }

  function triggerPowerup(r, c, player) {
    if (!powerup || powerup.r !== r || powerup.c !== c) return null;
    const pw = powerup;
    powerup = null;
    turnsSinceLastPowerup = 0;
    nextPowerupIn = 3 + Math.floor(Math.random() * 3);
    const opp = opponent(player);
    switch (pw.type.id) {
      case "explosion":
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && board[nr][nc] !== EMPTY && board[nr][nc] !== WALL)
              board[nr][nc] = EMPTY;
          }
        break;
      case "double": extraTurn = true; break;
      case "convert":
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && board[nr][nc] === opp) board[nr][nc] = player;
          }
        break;
      case "snipe": {
        const targets = [];
        for (let sr = 0; sr < 8; sr++)
          for (let sc = 0; sc < 8; sc++)
            if (board[sr][sc] === opp) targets.push([sr, sc]);
        shuffle(targets);
        for (const [sr, sc] of targets.slice(0, 3)) board[sr][sc] = EMPTY;
        break;
      }
      case "fortify": {
        const spots = [];
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (inBounds(nr, nc) && board[nr][nc] === EMPTY) spots.push([nr, nc]);
          }
        shuffle(spots);
        for (const [nr, nc] of spots.slice(0, 2)) board[nr][nc] = player;
        break;
      }
    }
    return pw;
  }


  // === Plague Logic ===

  function applyPlague() {
    const occupied = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === BLACK || board[r][c] === WHITE) occupied.push([r, c]);
    shuffle(occupied);
    for (const [r, c] of occupied) {
      const color = board[r][c];
      const opp = opponent(color);
      const neighbors = [];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && board[nr][nc] === opp) neighbors.push([nr, nc]);
      }
      if (neighbors.length > 0) {
        const [nr, nc] = neighbors[Math.floor(Math.random() * neighbors.length)];
        board[nr][nc] = color;
        return { from: [r, c], to: [nr, nc], color };
      }
    }
    return null;
  }

  // === Shrink Logic ===

  function applyShrink() {
    const newLevel = Math.floor(totalMoves / SHRINK_INTERVAL);
    if (newLevel <= shrinkLevel || newLevel > 3) return [];
    const removed = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (getCellRing(r, c) < newLevel && board[r][c] !== WALL) {
          if (board[r][c] !== EMPTY) removed.push([r, c]);
          board[r][c] = WALL;
        }
    shrinkLevel = newLevel;
    if (powerup && board[powerup.r][powerup.c] === WALL) powerup = null;
    return removed;
  }


  // === Timer Logic ===

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function updateTimerDisplay() {
    blackTimerEl.textContent = formatTime(blackTime);
    whiteTimerEl.textContent = formatTime(whiteTime);
    blackTimerEl.classList.toggle("low-time", blackTime <= 10);
    whiteTimerEl.classList.toggle("low-time", whiteTime <= 10);
  }

  function startBlitzTimer() {
    stopAllTimers();
    timerInterval = setInterval(() => {
      if (gameOver || aiThinking) return;
      if (currentPlayer === BLACK) {
        blackTime--;
        if (blackTime <= 0) { blackTime = 0; updateTimerDisplay(); endGame("timeout"); return; }
      } else {
        whiteTime--;
        if (whiteTime <= 0) { whiteTime = 0; updateTimerDisplay(); endGame("timeout"); return; }
      }
      updateTimerDisplay();
      if (mode === "online" && netRole === "host") broadcastSnapshot();
    }, 1000);
  }

  function startSpeedTimer() {
    stopSpeedTimer();
    if (isOpponentTurn()) return;
    speedCountdown = SPEED_TIME;
    showMessage(speedCountdown + "...", "speed-warn");
    speedInterval = setInterval(() => {
      if (gameOver || aiThinking) return;
      speedCountdown--;
      if (speedCountdown <= 0) {
        stopSpeedTimer();
        const moves = getValidMoves(board, currentPlayer);
        if (moves.length > 0) {
          const m = moves[Math.floor(Math.random() * moves.length)];
          makeMove(m[0], m[1]);
        }
        return;
      }
      showMessage(speedCountdown + "...", "speed-warn");
    }, 1000);
  }

  function stopSpeedTimer() {
    if (speedInterval) { clearInterval(speedInterval); speedInterval = null; }
  }

  function stopAllTimers() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    stopSpeedTimer();
  }


  // === AI ===

  function evaluate(b, aiPlayer) {
    const opp = opponent(aiPlayer);
    let score = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        if (b[r][c] === aiPlayer) score += WEIGHTS[r][c];
        else if (b[r][c] === opp) score -= WEIGHTS[r][c];
      }
    score += (getValidMoves(b, aiPlayer).length - getValidMoves(b, opp).length) * 5;
    return score;
  }

  function minimax(b, depth, alpha, beta, maximizing, aiPlayer, movePlayer, ages, moveNum) {
    const moves = getValidMoves(b, movePlayer);
    if (depth === 0) return { score: evaluate(b, aiPlayer) };
    if (moves.length === 0) {
      const oppMoves = getValidMoves(b, opponent(movePlayer));
      if (oppMoves.length === 0) {
        const { black, white } = countDiscs(b);
        const my = aiPlayer === BLACK ? black : white;
        const op = aiPlayer === BLACK ? white : black;
        if (my > op) return { score: 10000 + my - op };
        if (op > my) return { score: -10000 - op + my };
        return { score: 0 };
      }
      return minimax(b, depth - 1, alpha, beta, !maximizing, aiPlayer, opponent(movePlayer), ages, moveNum);
    }
    let bestMove = moves[0];
    if (maximizing) {
      let maxEval = -Infinity;
      for (const [r, c] of moves) {
        let nb, na, nm;
        if (vanishMode) {
          const res = applyMoveWithDecay(b, ages, r, c, movePlayer, moveNum + 1, vanishLife);
          nb = res.board; na = res.ages; nm = moveNum + 1;
        } else {
          const res = applyMove(b, r, c, movePlayer);
          nb = res.board;
          if (variant === "cascade") applyCascadeFlips(nb, res.flips, movePlayer);
          na = ages; nm = moveNum;
        }
        const { score } = minimax(nb, depth - 1, alpha, beta, false, aiPlayer, opponent(movePlayer), na, nm);
        if (score > maxEval) { maxEval = score; bestMove = [r, c]; }
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return { score: maxEval, move: bestMove };
    } else {
      let minEval = Infinity;
      for (const [r, c] of moves) {
        let nb, na, nm;
        if (vanishMode) {
          const res = applyMoveWithDecay(b, ages, r, c, movePlayer, moveNum + 1, vanishLife);
          nb = res.board; na = res.ages; nm = moveNum + 1;
        } else {
          const res = applyMove(b, r, c, movePlayer);
          nb = res.board;
          if (variant === "cascade") applyCascadeFlips(nb, res.flips, movePlayer);
          na = ages; nm = moveNum;
        }
        const { score } = minimax(nb, depth - 1, alpha, beta, true, aiPlayer, opponent(movePlayer), na, nm);
        if (score < minEval) { minEval = score; bestMove = [r, c]; }
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      return { score: minEval, move: bestMove };
    }
  }

  function getAiMove(b, aiPlayer) {
    const totalDiscs = countDiscs(b);
    const filled = totalDiscs.black + totalDiscs.white;
    let depth = aiDepth;
    if (!vanishMode) {
      if (filled > 52) depth = Math.max(depth, 8);
      else if (filled > 44) depth += 2;
    }
    // Grab powerup if reachable
    if (powerupMode && powerup) {
      const valid = getValidMoves(b, aiPlayer);
      const pw = valid.find(([r, c]) => r === powerup.r && c === powerup.c);
      if (pw) return pw;
    }
    const { move } = minimax(b, depth, -Infinity, Infinity, true, aiPlayer, aiPlayer, discAge, moveNumber);
    return move;
  }

  function getAiThievesAction(b, aiPlayer) {
    const validMoves = getValidMoves(b, aiPlayer);
    const stealTargets = getStealTargets(b, aiPlayer);
    let bestPlace = null, bestPlaceScore = -Infinity;
    if (validMoves.length > 0) {
      const { move } = minimax(b, aiDepth, -Infinity, Infinity, true, aiPlayer, aiPlayer, discAge, moveNumber);
      bestPlace = move;
      if (bestPlace) {
        const pb = applyMove(b, bestPlace[0], bestPlace[1], aiPlayer).board;
        bestPlaceScore = evaluate(pb, aiPlayer);
      }
    }
    let bestSteal = null, bestStealScore = -Infinity;
    for (const [r, c] of stealTargets) {
      const nb = b.map(row => [...row]);
      nb[r][c] = aiPlayer;
      const s = evaluate(nb, aiPlayer);
      if (s > bestStealScore) { bestStealScore = s; bestSteal = [r, c]; }
    }
    if (bestSteal && bestStealScore > bestPlaceScore)
      return { type: "steal", move: bestSteal };
    if (bestPlace)
      return { type: "place", move: bestPlace };
    if (bestSteal)
      return { type: "steal", move: bestSteal };
    return { type: "place", move: null };
  }


  // === Rendering ===

  function buildBoardDOM() {
    boardEl.innerHTML = "";
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.addEventListener("click", () => onCellClick(r, c));
        boardEl.appendChild(cell);
      }
  }

  function render(flippedCells, placedCell, decayedCells, extraCells) {
    flippedCells = flippedCells || [];
    placedCell = placedCell || null;
    decayedCells = decayedCells || [];
    extraCells = extraCells || [];

    const validMoves = gameOver ? [] : getValidMoves(board, currentPlayer);
    const validSet = new Set(validMoves.map(([r, c]) => `${r},${c}`));
    const flippedSet = new Set(flippedCells.map(([r, c]) => `${r},${c}`));
    const decayedSet = new Set(decayedCells.map(([r, c]) => `${r},${c}`));
    const extraSet = new Set(extraCells.map(([r, c]) => `${r},${c}`));

    const fogPlayer = variant === "fogofwar"
      ? (mode === "ai" ? BLACK : (mode === "online" ? myColor : currentPlayer))
      : null;
    const showSteals = variant === "thieves" && !gameOver && !aiThinking &&
      !(isOpponentTurn());
    const stealSet = showSteals ? new Set(getStealTargets(board, currentPlayer).map(([r,c]) => `${r},${c}`)) : new Set();

    const cells = boardEl.querySelectorAll(".cell");
    cells.forEach(cell => {
      const r = +cell.dataset.row;
      const c = +cell.dataset.col;
      const val = board[r][c];
      const fogged = fogPlayer && !isVisible(r, c, fogPlayer);

      // Wall
      cell.classList.toggle("wall", val === WALL);
      // Fog
      cell.classList.toggle("fogged", fogged && val !== WALL);
      // KOTH center
      cell.classList.toggle("koth-center", variant === "kingofhill" &&
        KOTH_CELLS.some(([kr,kc]) => kr === r && kc === c) && val !== WALL);
      // Stealable
      cell.classList.toggle("stealable", stealSet.has(`${r},${c}`));

      // Valid hints (show even in fog for gameplay)
      const showHints = !gameOver && !aiThinking && !(isOpponentTurn());
      cell.classList.toggle("valid", showHints && validSet.has(`${r},${c}`) && !fogged);

      if (val === WALL) {
        const disc = cell.querySelector(".disc");
        if (disc) disc.remove();
        const pw = cell.querySelector(".powerup-icon");
        if (pw) pw.remove();
        return;
      }

      let disc = cell.querySelector(".disc");

      // Decayed
      if (decayedSet.has(`${r},${c}`)) {
        if (disc) {
          disc.classList.add("vanishing");
          disc.addEventListener("animationend", () => disc.remove(), { once: true });
        }
      } else if (val === EMPTY) {
        if (disc && !disc.classList.contains("vanishing")) disc.remove();
      } else if (!fogged || val === fogPlayer) {
        const color = val === BLACK ? "black" : "white";
        if (!disc) {
          disc = document.createElement("div");
          disc.className = "disc";
          cell.appendChild(disc);
        }
        const isLast = lastMove && lastMove[0] === r && lastMove[1] === c;
        disc.className = `disc ${color}`;
        if (placedCell && placedCell[0] === r && placedCell[1] === c) disc.classList.add("placed");
        if (flippedSet.has(`${r},${c}`)) disc.classList.add("flipping");
        if (extraSet.has(`${r},${c}`)) disc.classList.add("cascade-flip");
        if (isLast) disc.classList.add("last-move");
        if (plagueInfo && plagueInfo.to[0] === r && plagueInfo.to[1] === c) disc.classList.add("infected");

        if (vanishMode && discAge[r][c] >= 0) {
          const remaining = vanishLife - (moveNumber - discAge[r][c]);
          disc.style.opacity = 0.3 + 0.7 * Math.max(0, Math.min(1, remaining / vanishLife));
        } else {
          disc.style.opacity = "";
        }
      } else {
        // Fogged opponent disc — hide
        if (disc) disc.remove();
      }

      // Powerup icon
      let pwEl = cell.querySelector(".powerup-icon");
      const hasPw = powerupMode && powerup && powerup.r === r && powerup.c === c && val === EMPTY && !fogged;
      cell.classList.toggle("has-powerup", hasPw);
      if (hasPw) {
        if (!pwEl) {
          pwEl = document.createElement("span");
          pwEl.className = "powerup-icon";
          cell.appendChild(pwEl);
        }
        pwEl.textContent = powerup.type.emoji;
      } else if (pwEl && !pwEl.classList.contains("collected")) {
        pwEl.classList.add("collected");
        pwEl.addEventListener("animationend", () => {
          pwEl.remove();
          cell.classList.remove("has-powerup");
        }, { once: true });
      }
    });

    // Scores
    const useKoth = variant === "kingofhill";
    const scores = useKoth ? countKothScore(board) : countDiscs(board);
    blackScoreEl.textContent = scores.black;
    whiteScoreEl.textContent = scores.white;

    // Turn indicator
    turnDisc.className = `disc-icon small ${currentPlayer === BLACK ? "black" : "white"}`;
    const pn = currentPlayer === BLACK ? "Black" : "White";
    let tt = "";
    if (mode === "ai") tt = currentPlayer === BLACK ? "Your turn" : "Computer thinking\u2026";
    else tt = `${pn}'s turn`;
    if (useKoth) tt = `Move ${totalMoves}/${KOTH_MOVE_LIMIT} \u2022 ${tt}`;
    turnText.textContent = tt;

    blackCard.classList.toggle("active-turn", !gameOver && currentPlayer === BLACK);
    whiteCard.classList.toggle("active-turn", !gameOver && currentPlayer === WHITE);

    // Timer visibility
    const showTimers = variant === "blitz";
    blackTimerEl.classList.toggle("hidden", !showTimers);
    whiteTimerEl.classList.toggle("hidden", !showTimers);
    if (showTimers) updateTimerDisplay();
  }

  function showMessage(text, type) { messageBar.textContent = text; messageBar.className = type || ""; messageBar.classList.remove("hidden"); }
  function hideMessage() { messageBar.classList.add("hidden"); }


  // === Game Flow ===

  function startGame() {
    stopAllTimers();
    // Online guest: wait for settings from host
    if (mode === "online" && netRole === "guest") return;

    variant = variantSelect.value;
    vanishMode = variant === "vanish";
    powerupMode = variant === "powerups";

    switch (variant) {
      case "obstacles": board = createObstaclesBoard(); break;
      case "boss": board = createBossBoard(); break;
      case "randomstart": board = createRandomBoard(); break;
      default: board = createBoard(); break;
    }

    discAge = createAgeGrid();
    moveNumber = 0;
    totalMoves = 0;
    currentPlayer = BLACK;
    gameOver = false;
    lastMove = null;
    aiThinking = false;
    mode = modeSelect.value;
    aiDepth = parseInt(difficultySelect.value, 10);
    vanishLife = parseInt(lifespanSelect.value, 10);
    powerup = null;
    turnsSinceLastPowerup = 0;
    nextPowerupIn = 3 + Math.floor(Math.random() * 3);
    extraTurn = false;
    shrinkLevel = 0;
    plagueInfo = null;
    cascadeFlips = [];
    blackTime = BLITZ_TIME;
    whiteTime = BLITZ_TIME;
    speedCountdown = SPEED_TIME;
    hideMessage();
    buildBoardDOM();
    render();
    if (variant === "blitz") startBlitzTimer();
    if (variant === "speed") startSpeedTimer();

    if (mode === "online" && netRole === "host" && conn && conn.open) {
      netSend({
        type: "settings",
        variant,
        vanishLife,
      });
      broadcastSnapshot();
    }
  }

  function makeMove(r, c) {
    if (variant === "speed") stopSpeedTimer();
    let flips, decayed = [];
    cascadeFlips = [];
    plagueInfo = null;

    if (vanishMode) {
      moveNumber++;
      const result = applyMoveWithDecay(board, discAge, r, c, currentPlayer, moveNumber, vanishLife);
      board = result.board; discAge = result.ages; flips = result.flips; decayed = result.decayed;
    } else {
      const result = applyMove(board, r, c, currentPlayer);
      board = result.board; flips = result.flips;
    }

    // Cascade
    if (variant === "cascade") {
      cascadeFlips = applyCascadeFlips(board, flips, currentPlayer);
    }

    // Powerup
    let triggeredPw = null;
    if (powerupMode && powerup) {
      if (r === powerup.r && c === powerup.c) triggeredPw = triggerPowerup(r, c, currentPlayer);
      else if (board[powerup.r][powerup.c] !== EMPTY) powerup = null;
    }

    totalMoves++;
    lastMove = [r, c];
    render(flips, [r, c], decayed, cascadeFlips);

    if (triggeredPw) showMessage(`${triggeredPw.type.emoji} ${triggeredPw.type.name}! ${triggeredPw.type.desc}`, "powerup");

    // King of the Hill move limit
    if (variant === "kingofhill" && totalMoves >= KOTH_MOVE_LIMIT) {
      endGame("koth");
      return;
    }

    // Shrinking board
    if (variant === "shrinking") {
      const removed = applyShrink();
      if (removed.length > 0) {
        showMessage("\uD83D\uDCA2 Board shrinks! Ring collapsed!", "pass");
        render();
      }
    }

    // Plague
    if (variant === "plague") {
      plagueInfo = applyPlague();
      if (plagueInfo) render();
    }

    // Turn switching
    if (extraTurn) {
      extraTurn = false;
      if (getValidMoves(board, currentPlayer).length === 0) {
        currentPlayer = opponent(currentPlayer);
        if (getValidMoves(board, currentPlayer).length === 0) { endGame(); return; }
      }
    } else {
      currentPlayer = opponent(currentPlayer);
      if (getValidMoves(board, currentPlayer).length === 0) {
        const other = opponent(currentPlayer);
        const otherMoves = getValidMoves(board, other).length > 0;
        const otherSteals = variant === "thieves" && getStealTargets(board, other).length > 0;
        if (!otherMoves && !otherSteals) { endGame(); return; }
        const pp = currentPlayer === BLACK ? "Black" : "White";
        if (mode === "ai" && currentPlayer === WHITE) showMessage("Computer has no moves \u2014 skipped!", "pass");
        else if (mode === "ai" && currentPlayer === BLACK) showMessage("You have no moves \u2014 skipped!", "pass");
        else showMessage(`${pp} has no valid moves \u2014 skipped!`, "pass");
        currentPlayer = other;
      } else if (!triggeredPw) {
        hideMessage();
      }
    }

    render();

    // Powerup spawning
    if (powerupMode && !powerup && !gameOver) {
      turnsSinceLastPowerup++;
      if (turnsSinceLastPowerup >= nextPowerupIn) { spawnPowerup(); render(); }
    }

    // Speed timer restart
    if (variant === "speed" && !gameOver && !(isOpponentTurn())) {
      startSpeedTimer();
    }

    if (!gameOver && mode === "ai" && currentPlayer === WHITE) scheduleAiMove();
  }

  function makeSteal(r, c) {
    if (variant === "speed") stopSpeedTimer();
    plagueInfo = null;
    board[r][c] = currentPlayer;
    totalMoves++;
    lastMove = [r, c];
    render([], [r, c]);

    // Plague
    if (variant === "plague") {
      plagueInfo = applyPlague();
      if (plagueInfo) render();
    }

    currentPlayer = opponent(currentPlayer);
    const hasMoves = getValidMoves(board, currentPlayer).length > 0;
    const hasSteals = getStealTargets(board, currentPlayer).length > 0;
    if (!hasMoves && !hasSteals) {
      const other = opponent(currentPlayer);
      if (getValidMoves(board, other).length === 0 && getStealTargets(board, other).length === 0) {
        endGame(); return;
      }
      const pp = currentPlayer === BLACK ? "Black" : "White";
      if (mode === "ai" && currentPlayer === WHITE) showMessage("Computer has no moves \u2014 skipped!", "pass");
      else if (mode === "ai" && currentPlayer === BLACK) showMessage("You have no moves \u2014 skipped!", "pass");
      else showMessage(`${pp} has no valid moves \u2014 skipped!`, "pass");
      currentPlayer = other;
    } else {
      hideMessage();
    }

    render();

    if (variant === "speed" && !gameOver && !(isOpponentTurn())) startSpeedTimer();
    if (!gameOver && mode === "ai" && currentPlayer === WHITE) scheduleAiMove();
  }

  function scheduleAiMove() {
    aiThinking = true;
    render();
    setTimeout(() => {
      if (variant === "thieves") {
        const action = getAiThievesAction(board, WHITE);
        aiThinking = false;
        if (action.type === "steal" && action.move) makeSteal(action.move[0], action.move[1]);
        else if (action.move) makeMove(action.move[0], action.move[1]);
      } else {
        const move = getAiMove(board, WHITE);
        aiThinking = false;
        if (move) makeMove(move[0], move[1]);
      }
    }, 350);
  }

  function endGame(reason) {
    gameOver = true;
    stopAllTimers();
    let msg;

    if (reason === "timeout") {
      const loser = currentPlayer === BLACK ? (mode === "ai" ? "You" : "Black") : (mode === "ai" ? "Computer" : "White");
      const winner = currentPlayer !== BLACK ? (mode === "ai" ? "You" : "Black") : (mode === "ai" ? "Computer" : "White");
      msg = `\u23F1\uFE0F Time's up! ${winner} wins!`;
    } else {
      const useKoth = reason === "koth" || variant === "kingofhill";
      const scores = useKoth ? countKothScore(board) : countDiscs(board);
      const b = scores.black, w = scores.white;
      if (mode === "ai") {
        if (b > w) msg = `You win! ${b} \u2013 ${w} \uD83C\uDF89`;
        else if (w > b) msg = `Computer wins. ${w} \u2013 ${b}`;
        else msg = `It's a tie! ${b} \u2013 ${w}`;
      } else {
        if (b > w) msg = `Black wins! ${b} \u2013 ${w} \uD83C\uDF89`;
        else if (w > b) msg = `White wins! ${w} \u2013 ${b} \uD83C\uDF89`;
        else msg = `It's a tie! ${b} \u2013 ${w}`;
      }
    }
    showMessage(msg, "win");
    render();
    if (mode === "online" && netRole === "host") broadcastSnapshot();
  }

  function onCellClick(r, c) {
    if (gameOver || aiThinking) return;
    if (isOpponentTurn()) return;

    // Thieves steal
    if (variant === "thieves" && board[r][c] === opponent(currentPlayer)) {
      const targets = getStealTargets(board, currentPlayer);
      if (targets.some(([sr, sc]) => sr === r && sc === c)) {
        if (mode === "online" && netRole === "guest") {
          netSend({ type: "steal", r, c });
          return;
        }
        makeSteal(r, c);
        if (mode === "online" && netRole === "host") broadcastSnapshot();
        return;
      }
    }

    if (getFlips(board, r, c, currentPlayer).length === 0) return;
    if (mode === "online" && netRole === "guest") {
      netSend({ type: "move", r, c });
      return;
    }
    makeMove(r, c);
    if (mode === "online" && netRole === "host") broadcastSnapshot();
  }


  // === Online P2P Networking ===

  function genRoomCode() {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let s = "rv-";
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function netSend(msg) {
    if (conn && conn.open) {
      try { conn.send(msg); } catch (e) { console.error("send failed", e); }
    }
  }

  function netStatus(text, cls) {
    if (!netStatusEl) return;
    if (!text) { netStatusEl.classList.add("hidden"); return; }
    netStatusEl.textContent = text;
    netStatusEl.classList.remove("hidden", "disconnected");
    if (cls) netStatusEl.classList.add(cls);
  }

  function captureSnapshot() {
    return {
      board: board.map(row => row.slice()),
      currentPlayer, gameOver, lastMove,
      discAge: discAge ? discAge.map(row => row.slice()) : null,
      moveNumber, totalMoves,
      variant, vanishLife, vanishMode, powerupMode,
      powerup: powerup ? { ...powerup } : null,
      plagueInfo: plagueInfo ? { ...plagueInfo } : null,
      cascadeFlips: cascadeFlips ? cascadeFlips.slice() : [],
      blackTime, whiteTime,
      extraTurn, shrinkLevel,
      messageText: messageBar.classList.contains("hidden") ? null : messageBar.textContent,
      messageCls: messageBar.className,
    };
  }

  function applySnapshot(s) {
    board = s.board.map(row => row.slice());
    currentPlayer = s.currentPlayer;
    gameOver = s.gameOver;
    lastMove = s.lastMove;
    discAge = s.discAge ? s.discAge.map(row => row.slice()) : createAgeGrid();
    moveNumber = s.moveNumber;
    totalMoves = s.totalMoves;
    variant = s.variant;
    vanishLife = s.vanishLife;
    vanishMode = s.vanishMode;
    powerupMode = s.powerupMode;
    powerup = s.powerup ? { ...s.powerup } : null;
    plagueInfo = s.plagueInfo ? { ...s.plagueInfo } : null;
    cascadeFlips = s.cascadeFlips ? s.cascadeFlips.slice() : [];
    blackTime = s.blackTime;
    whiteTime = s.whiteTime;
    extraTurn = s.extraTurn;
    shrinkLevel = s.shrinkLevel;
    render();
    if (s.messageText) {
      messageBar.textContent = s.messageText;
      messageBar.className = s.messageCls;
    } else {
      hideMessage();
    }
    if (gameOver) {
      // Re-derive end-game message to respect local perspective
      showLocalEndgameMessage();
    }
  }

  function showLocalEndgameMessage() {
    const scores = variant === "kingofhill" ? countKothScore(board) : countDiscs(board);
    const b = scores.black, w = scores.white;
    const myName = myColor === BLACK ? "Black" : "White";
    const oppName = myColor === BLACK ? "White" : "Black";
    let msg;
    if (b === w) msg = `It's a tie! ${b} \u2013 ${w}`;
    else {
      const iWon = (myColor === BLACK && b > w) || (myColor === WHITE && w > b);
      const myScore = myColor === BLACK ? b : w;
      const oppScore = myColor === BLACK ? w : b;
      msg = iWon
        ? `You win! ${myScore} \u2013 ${oppScore} \uD83C\uDF89`
        : `${oppName} wins. ${oppScore} \u2013 ${myScore}`;
    }
    showMessage(msg, "win");
  }

  function broadcastSnapshot() {
    if (mode !== "online" || netRole !== "host") return;
    netSend({ type: "snapshot", state: captureSnapshot() });
  }

  function handlePeerData(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "hello":
        // Guest joined — send current settings + snapshot
        if (netRole === "host") {
          netSend({ type: "settings", variant, vanishLife });
          broadcastSnapshot();
        }
        break;
      case "settings":
        // Guest: receive settings from host
        if (netRole === "guest") {
          hostSettings = { variant: msg.variant, vanishLife: msg.vanishLife };
          variant = msg.variant;
          vanishLife = msg.vanishLife;
          // Sync control UIs for display
          variantSelect.value = variant;
          lifespanSelect.value = String(vanishLife);
          lifespanGroup.style.display = variant === "vanish" ? "" : "none";
          buildBoardDOM();
        }
        break;
      case "snapshot":
        if (netRole === "guest") applySnapshot(msg.state);
        break;
      case "move":
        if (netRole === "host" && !gameOver && currentPlayer !== myColor) {
          // Validate guest's move
          if (getFlips(board, msg.r, msg.c, currentPlayer).length > 0) {
            makeMove(msg.r, msg.c);
            broadcastSnapshot();
          }
        }
        break;
      case "steal":
        if (netRole === "host" && variant === "thieves" && !gameOver && currentPlayer !== myColor) {
          const targets = getStealTargets(board, currentPlayer);
          if (targets.some(([sr, sc]) => sr === msg.r && sc === msg.c)) {
            makeSteal(msg.r, msg.c);
            broadcastSnapshot();
          }
        }
        break;
      case "newgame-request":
        if (netRole === "host") startGame();
        break;
      case "chat":
        // Future use
        break;
    }
  }

  function setupConnection(c) {
    conn = c;
    conn.on("open", () => {
      netStatus("Connected to opponent", "");
      closeLobby();
      if (netRole === "guest") {
        netSend({ type: "hello" });
      } else {
        // Host: send settings and start
        mode = "online";
        startGame(); // will broadcast settings + snapshot
      }
    });
    conn.on("data", handlePeerData);
    conn.on("close", () => {
      netStatus("Opponent disconnected", "disconnected");
      gameOver = true;
      stopAllTimers();
      render();
    });
    conn.on("error", (err) => {
      console.error("conn error", err);
      netStatus("Connection error", "disconnected");
    });
  }

  function startHost() {
    if (typeof Peer === "undefined") {
      lobbyHostStatus.textContent = "PeerJS failed to load. Check your internet.";
      lobbyHostStatus.className = "lobby-status error";
      return;
    }
    const code = genRoomCode();
    lobbyHostIdEl.textContent = "connecting\u2026";
    lobbyHostStatus.textContent = "Registering room\u2026";
    lobbyHostStatus.className = "lobby-status";
    try {
      if (peer) { try { peer.destroy(); } catch(e){} }
      peer = new Peer(code);
    } catch (e) {
      lobbyHostStatus.textContent = "Failed to create peer: " + e.message;
      lobbyHostStatus.className = "lobby-status error";
      return;
    }
    peer.on("open", (id) => {
      lobbyHostIdEl.textContent = id;
      lobbyHostStatus.textContent = "Waiting for opponent to join\u2026";
      lobbyHostStatus.className = "lobby-status success";
    });
    peer.on("connection", (c) => {
      netRole = "host";
      myColor = BLACK;
      mode = "online";
      modeSelect.value = "online";
      setupConnection(c);
    });
    peer.on("error", (err) => {
      console.error("peer error", err);
      if (err.type === "unavailable-id") {
        lobbyHostStatus.textContent = "Room code taken. Retrying\u2026";
        lobbyHostStatus.className = "lobby-status";
        setTimeout(startHost, 300);
      } else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
        lobbyHostStatus.textContent = "Network error: " + (err.message || err.type);
        lobbyHostStatus.className = "lobby-status error";
      } else {
        lobbyHostStatus.textContent = "Error: " + (err.message || err.type);
        lobbyHostStatus.className = "lobby-status error";
      }
    });
  }

  function startJoin(roomCode) {
    if (typeof Peer === "undefined") {
      lobbyJoinStatus.textContent = "PeerJS failed to load. Check your internet.";
      lobbyJoinStatus.className = "lobby-status error";
      return;
    }
    lobbyJoinStatus.textContent = "Connecting\u2026";
    lobbyJoinStatus.className = "lobby-status";
    try {
      if (peer) { try { peer.destroy(); } catch(e){} }
      peer = new Peer();
    } catch (e) {
      lobbyJoinStatus.textContent = "Failed: " + e.message;
      lobbyJoinStatus.className = "lobby-status error";
      return;
    }
    peer.on("open", () => {
      const c = peer.connect(roomCode, { reliable: true });
      netRole = "guest";
      myColor = WHITE;
      mode = "online";
      modeSelect.value = "online";
      setupConnection(c);
    });
    peer.on("error", (err) => {
      console.error("peer error", err);
      let msg = err.message || err.type;
      if (err.type === "peer-unavailable") msg = "Room not found. Check the code.";
      lobbyJoinStatus.textContent = msg;
      lobbyJoinStatus.className = "lobby-status error";
    });
  }

  function tearDownNet() {
    if (conn) { try { conn.close(); } catch(e){} conn = null; }
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    netRole = null;
    myColor = BLACK;
    netStatus("", "");
  }

  function openLobby() {
    tearDownNet();
    lobbyOverlay.classList.remove("hidden");
    lobbyIntro.classList.remove("hidden");
    lobbyHost.classList.add("hidden");
    lobbyJoin.classList.add("hidden");
    lobbyHostStatus.textContent = "";
    lobbyJoinStatus.textContent = "";
    lobbyJoinInput.value = "";
  }
  function closeLobby() {
    lobbyOverlay.classList.add("hidden");
  }

  lobbyHostBtn.addEventListener("click", () => {
    lobbyIntro.classList.add("hidden");
    lobbyHost.classList.remove("hidden");
    startHost();
  });
  lobbyJoinBtn.addEventListener("click", () => {
    lobbyIntro.classList.add("hidden");
    lobbyJoin.classList.remove("hidden");
    setTimeout(() => lobbyJoinInput.focus(), 50);
  });
  lobbyCancelBtn.addEventListener("click", () => {
    closeLobby();
    modeSelect.value = "ai";
    mode = "ai";
    difficultyGroup.style.display = "";
    tearDownNet();
    startGame();
  });
  lobbyHostBack.addEventListener("click", () => {
    tearDownNet();
    openLobby();
  });
  lobbyJoinBack.addEventListener("click", () => {
    tearDownNet();
    openLobby();
  });
  lobbyJoinSubmit.addEventListener("click", () => {
    const code = lobbyJoinInput.value.trim();
    if (!code) return;
    startJoin(code);
  });
  lobbyJoinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lobbyJoinSubmit.click();
  });
  lobbyCopyBtn.addEventListener("click", () => {
    const txt = lobbyHostIdEl.textContent;
    if (!txt || txt === "connecting\u2026") return;
    navigator.clipboard?.writeText(txt).then(
      () => { lobbyCopyBtn.textContent = "Copied!"; setTimeout(() => lobbyCopyBtn.textContent = "Copy", 1200); },
      () => { lobbyCopyBtn.textContent = "Copy failed"; }
    );
  });


  // === Event Listeners ===

  function handleNewGameClick() {
    if (mode === "online") {
      if (netRole === "guest") {
        netSend({ type: "newgame-request" });
        showMessage("Requested new game from host\u2026", "pass");
      } else if (netRole === "host") {
        startGame();
      } else {
        openLobby();
      }
      return;
    }
    startGame();
  }

  newGameBtn.addEventListener("click", handleNewGameClick);
  modeSelect.addEventListener("change", () => {
    const v = modeSelect.value;
    difficultyGroup.style.display = v === "ai" ? "" : "none";
    if (v === "online") {
      openLobby();
    } else {
      tearDownNet();
      startGame();
    }
  });
  difficultySelect.addEventListener("change", () => {
    if (mode === "online") return;
    startGame();
  });
  variantSelect.addEventListener("change", () => {
    lifespanGroup.style.display = variantSelect.value === "vanish" ? "" : "none";
    if (mode === "online" && netRole === "guest") {
      // Guest can't change variant — revert
      variantSelect.value = variant;
      lifespanGroup.style.display = variant === "vanish" ? "" : "none";
      return;
    }
    startGame();
  });
  lifespanSelect.addEventListener("change", () => {
    if (mode === "online" && netRole === "guest") {
      lifespanSelect.value = String(vanishLife);
      return;
    }
    startGame();
  });

  // Init
  loadTheme();
  startGame();
})();
