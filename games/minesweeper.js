// Minesweeper - click to reveal, right-click to flag
(function () {
  "use strict";

  const PRESETS = {
    easy:   { rows: 9,  cols: 9,  mines: 10 },
    medium: { rows: 10, cols: 10, mines: 15 },
    hard:   { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };

  const SEL_STYLE = "margin-left:6px;font-family:'Press Start 2P',monospace;font-size:0.6rem;background:#111;color:#fff;border:1px solid #00f0ff;padding:3px;";
  const INP_STYLE = SEL_STYLE + "width:48px;";

  let ROWS, COLS, MINES;
  let grid, revealed, flagged, started, dead, won, remaining, timer, elapsed, timeLimit;
  let gridEl, flagEl, timeEl, timeLabelEl, infoEl, bestEl, diffEl, timeLimitEl, customEl, rowsEl, colsEl, minesEl;
  let bestTime = 0;

  function getBestKey() {
    const diff = diffEl ? diffEl.value : "medium";
    return "arcade-ms-best-" + diff;
  }

  function loadBest() {
    bestTime = parseInt(localStorage.getItem(getBestKey()) || "0", 10) || 0;
    if (bestEl) bestEl.textContent = bestTime ? bestTime + "s" : "--";
  }

  function init(mount) {
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>MINESWEEPER</h2>
      <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;font-family:'Press Start 2P',monospace;font-size:0.6rem;color:#00f0ff;margin-bottom:4px;">
        <label>DIFFICULTY
          <select id="ms-diff" style="${SEL_STYLE}">
            <option value="easy">Easy (9×9, 10💣)</option>
            <option value="medium" selected>Medium (10×10, 15💣)</option>
            <option value="hard">Hard (16×16, 40💣)</option>
            <option value="expert">Expert (16×30, 99💣)</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        <label>TIME LIMIT
          <select id="ms-timelimit" style="${SEL_STYLE}">
            <option value="0">None</option>
            <option value="60">60s</option>
            <option value="120">120s</option>
            <option value="300">300s</option>
          </select>
        </label>
      </div>
      <div id="ms-custom" style="display:none;flex-wrap:wrap;gap:10px;justify-content:center;font-family:'Press Start 2P',monospace;font-size:0.6rem;color:#00f0ff;margin-bottom:4px;">
        <label>ROWS<input type="number" id="ms-rows" min="5" max="24" value="10" style="${INP_STYLE}"></label>
        <label>COLS<input type="number" id="ms-cols" min="5" max="30" value="10" style="${INP_STYLE}"></label>
        <label>MINES<input type="number" id="ms-mines" min="1" max="500" value="15" style="${INP_STYLE}"></label>
      </div>
      <div class="hud">
        <span>💣<strong id="ms-flag">15</strong></span>
        <span><span id="ms-time-label">TIME</span><strong id="ms-time">0</strong></span>
        <span>BEST<strong id="ms-best">--</strong></span>
      </div>
      <div id="ms-grid" style="display:grid;gap:2px;padding:8px;background:#222;border:3px solid #9aa;border-radius:4px;overflow:auto;max-width:100%;"></div>
      <div class="mg-info" id="ms-info">Click to reveal · Right-click / long-press to flag</div>
      <button class="mg-btn" id="ms-restart">New Game</button>
    `;
    mount.appendChild(wrap);
    gridEl      = document.getElementById("ms-grid");
    flagEl      = document.getElementById("ms-flag");
    timeEl      = document.getElementById("ms-time");
    timeLabelEl = document.getElementById("ms-time-label");
    bestEl      = document.getElementById("ms-best");
    infoEl      = document.getElementById("ms-info");
    diffEl      = document.getElementById("ms-diff");
    timeLimitEl = document.getElementById("ms-timelimit");
    customEl    = document.getElementById("ms-custom");
    rowsEl      = document.getElementById("ms-rows");
    colsEl      = document.getElementById("ms-cols");
    minesEl     = document.getElementById("ms-mines");

    diffEl.addEventListener("change", () => {
      customEl.style.display = diffEl.value === "custom" ? "flex" : "none";
      loadBest();
    });

    document.getElementById("ms-restart").addEventListener("click", reset);
    gridEl.addEventListener("contextmenu", e => e.preventDefault());
    loadBest();
    reset();
  }

  function getSettings() {
    timeLimit = parseInt(timeLimitEl.value, 10);
    const diff = diffEl.value;
    if (diff === "custom") {
      const r = Math.max(5, Math.min(24, parseInt(rowsEl.value, 10) || 10));
      const c = Math.max(5, Math.min(30, parseInt(colsEl.value, 10) || 10));
      const maxMines = r * c - 9;
      const m = Math.max(1, Math.min(maxMines, parseInt(minesEl.value, 10) || 15));
      ROWS = r; COLS = c; MINES = m;
    } else {
      const p = PRESETS[diff] || PRESETS.medium;
      ROWS = p.rows; COLS = p.cols; MINES = p.mines;
    }
  }

  function reset() {
    if (timer) { clearInterval(timer); timer = null; }
    getSettings();
    grid     = Array.from({length: ROWS}, () => new Array(COLS).fill(0));
    revealed = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
    flagged  = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
    started = false; dead = false; won = false;
    remaining = MINES;
    elapsed = timeLimit > 0 ? timeLimit : 0;
    flagEl.textContent = remaining;
    timeEl.textContent = elapsed;
    timeLabelEl.textContent = timeLimit > 0 ? "⏱ " : "TIME";
    infoEl.textContent = "Click to reveal · Right-click to flag";
    buildGrid();
  }

  function buildGrid() {
    const cellSize = COLS <= 10 ? 30 : COLS <= 16 ? 28 : COLS <= 20 ? 24 : 20;
    const fontSize = cellSize >= 28 ? "0.7rem" : cellSize >= 24 ? "0.6rem" : "0.55rem";
    gridEl.style.gridTemplateColumns = `repeat(${COLS},${cellSize}px)`;
    gridEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "ms-cell";
      cell.style.cssText = `width:${cellSize}px;height:${cellSize}px;background:linear-gradient(180deg,#bbb,#888);border:2px outset #ccc;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:${fontSize};cursor:pointer;user-select:none;color:#000;`;
      cell.dataset.r = r; cell.dataset.c = c;
      cell.addEventListener("click", e => { if (e.button === 0) reveal(r, c); });
      cell.addEventListener("contextmenu", e => { e.preventDefault(); flag(r, c); });
      // long-press for mobile flag
      let t;
      cell.addEventListener("touchstart", e => {
        t = setTimeout(() => { flag(r, c); t = null; }, 400);
      }, {passive: true});
      cell.addEventListener("touchend", e => { if (t) { clearTimeout(t); } });
      gridEl.appendChild(cell);
    }
  }

  function placeMines(safeR, safeC) {
    let placed = 0;
    while (placed < MINES) {
      const r = Math.floor(Math.random()*ROWS), c = Math.floor(Math.random()*COLS);
      if (grid[r][c] === -1) continue;
      if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue; // safe area
      grid[r][c] = -1;
      placed++;
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === -1) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r+dr, nc = c+dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === -1) n++;
      }
      grid[r][c] = n;
    }
  }

  function reveal(r, c) {
    if (dead || won) return;
    if (revealed[r][c] || flagged[r][c]) return;
    if (!started) {
      placeMines(r, c);
      started = true;
      if (timeLimit > 0) {
        // countdown timer
        timer = setInterval(() => {
          elapsed--;
          timeEl.textContent = elapsed;
          if (elapsed <= 0) {
            clearInterval(timer); timer = null;
            dead = true;
            infoEl.textContent = "⏰ TIME'S UP! Game over.";
            for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) revealed[rr][cc] = true;
            render();
          }
        }, 1000);
      } else {
        timer = setInterval(() => { elapsed++; timeEl.textContent = elapsed; }, 1000);
      }
    }
    floodReveal(r, c);
    render();
    checkWin();
  }

  function floodReveal(r, c) {
    const stack = [[r,c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      if (cr < 0 || cr >= ROWS || cc < 0 || cc >= COLS) continue;
      if (revealed[cr][cc] || flagged[cr][cc]) continue;
      revealed[cr][cc] = true;
      if (grid[cr][cc] === -1) {
        dead = true;
        clearInterval(timer);
        infoEl.textContent = "💥 BOOM! Game over.";
        // reveal all
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) revealed[r][c] = true;
        return;
      }
      if (grid[cr][cc] === 0) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) stack.push([cr+dr, cc+dc]);
        }
      }
    }
  }

  function flag(r, c) {
    if (dead || won || revealed[r][c]) return;
    flagged[r][c] = !flagged[r][c];
    remaining += flagged[r][c] ? -1 : 1;
    flagEl.textContent = remaining;
    render();
  }

  function checkWin() {
    if (dead) return;
    let unrevealed = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (!revealed[r][c]) unrevealed++;
    if (unrevealed === MINES) {
      won = true;
      clearInterval(timer);
      const timeUsed = timeLimit > 0 ? (timeLimit - elapsed) : elapsed;
      if (!bestTime || timeUsed < bestTime) {
        bestTime = timeUsed;
        bestEl.textContent = bestTime + "s";
        localStorage.setItem(getBestKey(), String(bestTime));
      }
      infoEl.textContent = `🏆 YOU WIN in ${timeUsed}s!`;
    }
  }

  const NUM_COLORS = ["","#1b7ae6","#1ea82c","#d12020","#0c2ea8","#8a1b1b","#1c7a7a","#000","#555"];
  function render() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const el = gridEl.children[r*COLS + c];
      if (revealed[r][c]) {
        el.style.background = "#dcdcdc";
        el.style.border = "1px solid #888";
        if (grid[r][c] === -1) {
          el.textContent = "💣";
          el.style.background = dead ? "#ff5040" : "#dcdcdc";
        } else if (grid[r][c] > 0) {
          el.textContent = grid[r][c];
          el.style.color = NUM_COLORS[grid[r][c]];
        } else {
          el.textContent = "";
        }
      } else {
        el.style.background = "linear-gradient(180deg,#bbb,#888)";
        el.style.border = "2px outset #ccc";
        el.textContent = flagged[r][c] ? "🚩" : "";
      }
    }
  }

  function onHide() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  Arcade.register({
    id: "minesweeper",
    name: "Minesweeper",
    icon: "💣",
    color: "#ff5040",
    tag: "LOGIC",
    order: 5,
    init,
    onHide
  });
})();
