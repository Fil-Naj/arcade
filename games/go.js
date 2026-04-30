// Go - the ancient board game (9x9 / 13x13) vs simple heuristic AI or local 2-player.
(function () {
  "use strict";

  const E = 0, B = 1, W = 2;
  const KOMI = { 9: 5.5, 13: 7.5 };

  let size, board, current, captures, koPoint, passes, gameOver;
  let mode, aiColor;
  let aiThinkingTimer, infoTimer;
  let gameVersion = 0; // bumps on reset / mode change to invalidate stale AI callbacks
  let mountRef;

  let canvas, ctx;
  let infoEl, turnEl, blackCapEl, whiteCapEl;
  let modeSelect, sizeSelect, colorSelect;
  let cellSize, padding;

  function init(mount) {
    mountRef = mount;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>GO</h2>
      <div class="hud">
        <span>BLACK ●<strong id="go-black-cap">0</strong></span>
        <span>TURN<strong id="go-turn">●</strong></span>
        <span>○ WHITE<strong id="go-white-cap">0</strong></span>
      </div>
      <canvas id="go-canvas" width="380" height="380"></canvas>
      <div class="mg-info" id="go-info">Black to move</div>
      <div class="go-controls" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;">
        <select id="go-mode" style="font-size:.85em;padding:3px 6px;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px;font-family:'VT323',monospace;">
          <option value="ai">vs Computer</option>
          <option value="local">2 Players</option>
        </select>
        <select id="go-size" style="font-size:.85em;padding:3px 6px;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px;font-family:'VT323',monospace;">
          <option value="9" selected>9 × 9</option>
          <option value="13">13 × 13</option>
        </select>
        <select id="go-color" style="font-size:.85em;padding:3px 6px;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px;font-family:'VT323',monospace;">
          <option value="1" selected>Play Black</option>
          <option value="2">Play White</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
        <button class="mg-btn" id="go-pass">Pass</button>
        <button class="mg-btn" id="go-resign">Resign</button>
        <button class="mg-btn" id="go-new">New Game</button>
      </div>
      <div class="mg-controls-help">Click an intersection to place a stone · Capture dead stones before passing · Two passes end the game</div>
    `;
    mount.appendChild(wrap);

    canvas = document.getElementById("go-canvas");
    ctx = canvas.getContext("2d");
    infoEl = document.getElementById("go-info");
    turnEl = document.getElementById("go-turn");
    blackCapEl = document.getElementById("go-black-cap");
    whiteCapEl = document.getElementById("go-white-cap");
    modeSelect = document.getElementById("go-mode");
    sizeSelect = document.getElementById("go-size");
    colorSelect = document.getElementById("go-color");

    canvas.addEventListener("click", onCanvasClick);
    document.getElementById("go-pass").addEventListener("click", onPass);
    document.getElementById("go-resign").addEventListener("click", onResign);
    document.getElementById("go-new").addEventListener("click", reset);
    modeSelect.addEventListener("change", () => { updateColorVisibility(); reset(); });
    sizeSelect.addEventListener("change", reset);
    colorSelect.addEventListener("change", reset);

    updateColorVisibility();
    reset();
  }

  function updateColorVisibility() {
    colorSelect.style.display = modeSelect.value === "ai" ? "" : "none";
  }

  function reset() {
    gameVersion++;
    if (aiThinkingTimer) { clearTimeout(aiThinkingTimer); aiThinkingTimer = null; }
    if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
    size = parseInt(sizeSelect.value, 10);
    mode = modeSelect.value;
    if (mode === "ai") {
      const playerColor = parseInt(colorSelect.value, 10);
      aiColor = playerColor === B ? W : B;
    } else {
      aiColor = null;
    }
    board = makeBoard(size);
    current = B;
    captures = { 1: 0, 2: 0 };
    koPoint = null;
    passes = 0;
    gameOver = false;
    setupCanvas();
    render();
    updateTurnUI();
    if (mode === "ai" && aiColor === current) scheduleAiMove();
  }

  function setupCanvas() {
    const target = 380;
    cellSize = Math.floor(target / (size + 1));
    padding = cellSize;
    const px = (size - 1) * cellSize + 2 * padding;
    canvas.width = px;
    canvas.height = px;
    canvas.style.background = "#deb887";
    canvas.style.border = "3px solid #5a3a1a";
    canvas.style.boxShadow = "0 0 20px rgba(140,100,50,0.4), inset 0 0 30px rgba(0,0,0,0.2)";
    canvas.style.imageRendering = "auto";
  }

  function makeBoard(n) {
    const b = [];
    for (let r = 0; r < n; r++) b.push(new Array(n).fill(E));
    return b;
  }

  function cloneBoard(b) {
    const n = b.length;
    const out = new Array(n);
    for (let r = 0; r < n; r++) out[r] = b[r].slice();
    return out;
  }

  function neighbors(r, c) {
    const out = [];
    if (r > 0) out.push([r - 1, c]);
    if (r < size - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < size - 1) out.push([r, c + 1]);
    return out;
  }

  // BFS over connected stones; returns { stones, liberties: [[r,c]...], libertyCount }.
  function findGroup(b, r, c) {
    const color = b[r][c];
    if (color === E) return null;
    const stones = [];
    const liberties = [];
    const libSet = new Set();
    const visited = new Set();
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const key = cr * size + cc;
      if (visited.has(key)) continue;
      visited.add(key);
      stones.push([cr, cc]);
      for (const [nr, nc] of neighbors(cr, cc)) {
        const nkey = nr * size + nc;
        const nv = b[nr][nc];
        if (nv === E) {
          if (!libSet.has(nkey)) {
            libSet.add(nkey);
            liberties.push([nr, nc]);
          }
        } else if (nv === color && !visited.has(nkey)) {
          stack.push([nr, nc]);
        }
      }
    }
    return { stones, liberties, libertyCount: liberties.length };
  }

  // Try a move; returns { legal, newBoard, captured, myGroup }. Does not check ko.
  function tryMove(b, r, c, color) {
    if (b[r][c] !== E) return { legal: false };
    const nb = cloneBoard(b);
    nb[r][c] = color;
    const opp = color === B ? W : B;
    const captured = [];
    for (const [nr, nc] of neighbors(r, c)) {
      if (nb[nr][nc] === opp) {
        const grp = findGroup(nb, nr, nc);
        if (grp && grp.libertyCount === 0) {
          for (const [sr, sc] of grp.stones) {
            nb[sr][sc] = E;
            captured.push([sr, sc]);
          }
        }
      }
    }
    const myGroup = findGroup(nb, r, c);
    if (!myGroup || myGroup.libertyCount === 0) {
      return { legal: false }; // suicide
    }
    return { legal: true, newBoard: nb, captured, myGroup };
  }

  function playMove(r, c) {
    if (gameOver) return false;
    if (koPoint && koPoint[0] === r && koPoint[1] === c) return false;
    const res = tryMove(board, r, c, current);
    if (!res.legal) return false;

    board = res.newBoard;
    captures[current] += res.captured.length;

    // Ko: one stone captured, placed stone is alone, has 1 liberty, and that liberty is the captured point.
    let newKo = null;
    if (res.captured.length === 1 &&
        res.myGroup.stones.length === 1 &&
        res.myGroup.libertyCount === 1) {
      const [lr, lc] = res.myGroup.liberties[0];
      const [cr, cc] = res.captured[0];
      if (lr === cr && lc === cc) newKo = [cr, cc];
    }
    koPoint = newKo;

    passes = 0;
    current = current === B ? W : B;
    return true;
  }

  function onCanvasClick(e) {
    if (gameOver) return;
    if (mode === "ai" && current === aiColor) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.round((x - padding) / cellSize);
    const r = Math.round((y - padding) / cellSize);
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    if (!playMove(r, c)) {
      flashIllegal();
      return;
    }
    render();
    updateTurnUI();
    if (passes >= 2) { endGame(); return; }
    if (mode === "ai" && current === aiColor) scheduleAiMove();
  }

  function flashIllegal() {
    if (infoTimer) clearTimeout(infoTimer);
    infoEl.textContent = "Illegal move (suicide / ko / occupied)";
    infoTimer = setTimeout(() => { infoTimer = null; updateTurnUI(); }, 900);
  }

  function onPass() {
    if (gameOver) return;
    if (mode === "ai" && current === aiColor) return;
    doPass();
  }

  function doPass() {
    passes++;
    koPoint = null;
    if (passes >= 2) { endGame(); return; }
    current = current === B ? W : B;
    updateTurnUI();
    if (!gameOver && mode === "ai" && current === aiColor) scheduleAiMove();
  }

  function onResign() {
    if (gameOver) return;
    gameOver = true;
    const loser = current === B ? "Black" : "White";
    const winner = current === B ? "White" : "Black";
    infoEl.textContent = `${loser} resigned. ${winner} wins!`;
  }

  function scheduleAiMove() {
    const myVersion = gameVersion;
    if (aiThinkingTimer) clearTimeout(aiThinkingTimer);
    aiThinkingTimer = setTimeout(() => {
      aiThinkingTimer = null;
      if (myVersion !== gameVersion) return;
      if (!mountRef || !document.body.contains(canvas)) return;
      if (gameOver) return;
      if (current !== aiColor) return;
      doAiMove();
    }, 420);
  }

  function doAiMove() {
    const move = chooseAiMove();
    if (move == null) {
      doPass();
      render();
      return;
    }
    playMove(move[0], move[1]);
    render();
    updateTurnUI();
    if (passes >= 2) { endGame(); return; }
    if (!gameOver && mode === "ai" && current === aiColor) scheduleAiMove();
  }

  function chooseAiMove() {
    const candidates = [];
    const opp = aiColor === B ? W : B;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== E) continue;
        if (koPoint && koPoint[0] === r && koPoint[1] === c) continue;
        const eyeShaped = isEyeLike(r, c, aiColor);
        const res = tryMove(board, r, c, aiColor);
        if (!res.legal) continue;
        // Don't fill own eye unless the move actually captures (defensive — usually
        // no captures are possible at an eye since all neighbors are own color).
        if (eyeShaped && res.captured.length === 0) continue;

        let s = 0;
        // Captures
        s += res.captured.length * 50;

        // Atari opponent groups (excluding ones we just captured)
        const seen = new Set();
        for (const [nr, nc] of neighbors(r, c)) {
          if (res.newBoard[nr][nc] !== opp) continue;
          const k = nr * size + nc;
          if (seen.has(k)) continue;
          const g = findGroup(res.newBoard, nr, nc);
          if (!g) continue;
          for (const [sr, sc] of g.stones) seen.add(sr * size + sc);
          if (g.libertyCount === 1) s += 8 * g.stones.length;
          else if (g.libertyCount === 2) s += 2 * g.stones.length;
        }

        // Defend: prefer moves that escape from atari for own groups
        // (placing here might extend a friendly group from 1 liberty to more)
        let nearOwn = 0, nearOpp = 0;
        for (const [nr, nc] of neighbors(r, c)) {
          if (board[nr][nc] === aiColor) {
            nearOwn++;
            const g = findGroup(board, nr, nc);
            if (g && g.libertyCount === 1) {
              // Saving a friendly stone from capture
              if (res.myGroup.libertyCount >= 2) s += 12 * g.stones.length;
            }
          } else if (board[nr][nc] === opp) {
            nearOpp++;
          }
        }
        s += nearOwn * 1.5 + nearOpp * 2.5;

        // Self-atari penalty: leaving placed group with 1 liberty is generally bad,
        // unless it captures or sets up ko.
        if (res.myGroup.libertyCount === 1 && res.captured.length === 0) {
          s -= 25;
        }

        // Slight opening preference: avoid first-line in early game.
        const totalStones = countStones() + 1;
        if (totalStones < size * 4) {
          const onFirstLine = (r === 0 || r === size - 1 || c === 0 || c === size - 1);
          if (onFirstLine) s -= 1.5;
          // Slight bonus for star / 4-4-ish points early
          const center = (size - 1) / 2;
          const dist = Math.abs(r - center) + Math.abs(c - center);
          if (dist <= Math.floor(center)) s += 0.5;
        }

        s += Math.random() * 0.9; // tiebreak

        candidates.push({ r, c, score: s });
      }
    }

    if (candidates.length === 0) return null; // forced pass
    candidates.sort((a, b) => b.score - a.score);

    // If opponent just passed and best move is low-value, also pass.
    // Threshold tuned so captures / ataris always keep playing,
    // but pure dame / territory-fill moves don't.
    if (passes === 1 && candidates[0].score < 4) return null;

    return [candidates[0].r, candidates[0].c];
  }

  function countStones() {
    let n = 0;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (board[r][c] !== E) n++;
    return n;
  }

  // Heuristic eye-like point for `color` — empty point where all orthogonal
  // neighbors are own color, plus the standard diagonal rule.
  function isEyeLike(r, c, color) {
    if (board[r][c] !== E) return false;
    const orth = neighbors(r, c);
    for (const [nr, nc] of orth) {
      if (board[nr][nc] !== color) return false;
    }
    // Diagonals
    const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let ownDiag = 0, oppDiag = 0, edgeDiag = 0;
    for (const [dr, dc] of diag) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) edgeDiag++;
      else if (board[nr][nc] === color) ownDiag++;
      else if (board[nr][nc] !== E) oppDiag++;
    }
    if (edgeDiag === 0) return ownDiag >= 3;
    return oppDiag === 0;
  }

  function endGame() {
    gameOver = true;
    const r = scoreBoard();
    const diff = Math.abs(r.black - r.white).toFixed(1);
    let msg;
    if (r.black > r.white) {
      msg = `BLACK WINS by ${diff} · B ${r.black.toFixed(1)} (${r.blackStones}+${r.blackTerritory}) – W ${r.white.toFixed(1)} (${r.whiteStones}+${r.whiteTerritory}+${r.komi})`;
    } else if (r.white > r.black) {
      msg = `WHITE WINS by ${diff} · W ${r.white.toFixed(1)} (${r.whiteStones}+${r.whiteTerritory}+${r.komi}) – B ${r.black.toFixed(1)} (${r.blackStones}+${r.blackTerritory})`;
    } else {
      msg = `TIE at ${r.black.toFixed(1)}`;
    }
    infoEl.textContent = msg;
  }

  // Area scoring: stones on board + empty regions touching only one color, plus komi for white.
  function scoreBoard() {
    let blackStones = 0, whiteStones = 0;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++) {
        if (board[r][c] === B) blackStones++;
        else if (board[r][c] === W) whiteStones++;
      }
    const visited = Array.from({ length: size }, () => new Array(size).fill(false));
    let blackTerritory = 0, whiteTerritory = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] !== E || visited[r][c]) continue;
        const region = [];
        const stack = [[r, c]];
        let touchesBlack = false, touchesWhite = false;
        while (stack.length) {
          const [cr, cc] = stack.pop();
          if (visited[cr][cc]) continue;
          visited[cr][cc] = true;
          region.push([cr, cc]);
          for (const [nr, nc] of neighbors(cr, cc)) {
            const v = board[nr][nc];
            if (v === E && !visited[nr][nc]) stack.push([nr, nc]);
            else if (v === B) touchesBlack = true;
            else if (v === W) touchesWhite = true;
          }
        }
        if (touchesBlack && !touchesWhite) blackTerritory += region.length;
        else if (touchesWhite && !touchesBlack) whiteTerritory += region.length;
      }
    }
    const komi = KOMI[size] || 6.5;
    return {
      black: blackStones + blackTerritory,
      white: whiteStones + whiteTerritory + komi,
      blackStones, whiteStones, blackTerritory, whiteTerritory, komi
    };
  }

  function updateTurnUI() {
    blackCapEl.textContent = captures[B];
    whiteCapEl.textContent = captures[W];
    if (gameOver) return;
    turnEl.textContent = current === B ? "●" : "○";
    turnEl.style.color = current === B ? "#111" : "#fff";
    turnEl.style.textShadow = current === B ? "0 0 4px #000" : "0 0 6px rgba(255,255,255,0.7)";
    let msg = (current === B ? "Black" : "White") + " to move";
    if (mode === "ai") msg += current === aiColor ? " (CPU)" : " (you)";
    if (passes === 1) msg += " · opponent passed";
    if (koPoint) msg += " · ko in effect";
    infoEl.textContent = msg;
  }

  function render() {
    if (!ctx) return;
    const px = canvas.width;
    ctx.clearRect(0, 0, px, px);
    // Wood
    ctx.fillStyle = "#deb887";
    ctx.fillRect(0, 0, px, px);

    // Subtle wood grain
    ctx.strokeStyle = "rgba(120, 80, 30, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const y = (i / 14) * px + Math.sin(i) * 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(px, y + Math.cos(i * 1.7) * 3);
      ctx.stroke();
    }

    // Grid
    ctx.strokeStyle = "#3a2510";
    ctx.lineWidth = 1;
    const last = padding + (size - 1) * cellSize;
    for (let i = 0; i < size; i++) {
      const p = padding + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(padding, p);
      ctx.lineTo(last, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, padding);
      ctx.lineTo(p, last);
      ctx.stroke();
    }

    // Star points
    ctx.fillStyle = "#3a2510";
    for (const [r, c] of starPoints(size)) {
      ctx.beginPath();
      ctx.arc(padding + c * cellSize, padding + r * cellSize, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stones
    const radius = cellSize * 0.46;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = board[r][c];
        if (v === E) continue;
        const x = padding + c * cellSize;
        const y = padding + r * cellSize;
        // Shadow
        ctx.beginPath();
        ctx.arc(x + 1, y + 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();
        // Stone gradient
        const grad = ctx.createRadialGradient(
          x - radius / 3, y - radius / 3, radius / 8,
          x, y, radius
        );
        if (v === B) {
          grad.addColorStop(0, "#5a5a5a");
          grad.addColorStop(1, "#080808");
        } else {
          grad.addColorStop(0, "#ffffff");
          grad.addColorStop(1, "#b8b8b8");
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    // Ko marker
    if (koPoint) {
      const [r, c] = koPoint;
      const x = padding + c * cellSize;
      const y = padding + r * cellSize;
      const s = Math.max(6, cellSize * 0.25);
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(x - s / 2, y - s / 2, s, s);
      ctx.stroke();
    }
  }

  function starPoints(n) {
    if (n === 9)  return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
    if (n === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
    if (n === 19) return [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
    return [];
  }

  function onHide() {
    gameVersion++;
    if (aiThinkingTimer) { clearTimeout(aiThinkingTimer); aiThinkingTimer = null; }
    if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
    mountRef = null;
  }

  Arcade.register({
    id: "go",
    name: "Go",
    icon: "●○",
    color: "#c08040",
    tag: "STRATEGY",
    order: 2,
    init,
    onHide
  });
})();
