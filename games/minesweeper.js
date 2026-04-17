// Minesweeper - click to reveal, right-click to flag
(function () {
  "use strict";
  const ROWS = 10, COLS = 10, MINES = 15;
  let grid, revealed, flagged, started, dead, won, remaining, timer, elapsed;
  let gridEl, flagEl, timeEl, infoEl;

  function init(mount) {
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>MINESWEEPER</h2>
      <div class="hud">
        <span>MINES<strong id="ms-flag">${MINES}</strong></span>
        <span>TIME<strong id="ms-time">0</strong></span>
      </div>
      <div id="ms-grid" style="
        display:grid;grid-template-columns:repeat(${COLS},30px);gap:2px;
        padding:8px;background:#222;border:3px solid #9aa;border-radius:4px;"></div>
      <div class="mg-info" id="ms-info">Click to reveal · Right-click / long-press to flag</div>
      <button class="mg-btn" id="ms-restart">New Game</button>
    `;
    mount.appendChild(wrap);
    gridEl = document.getElementById("ms-grid");
    flagEl = document.getElementById("ms-flag");
    timeEl = document.getElementById("ms-time");
    infoEl = document.getElementById("ms-info");
    document.getElementById("ms-restart").addEventListener("click", reset);
    gridEl.addEventListener("contextmenu", e => e.preventDefault());
    reset();
  }

  function reset() {
    if (timer) { clearInterval(timer); timer = null; }
    grid = Array.from({length: ROWS}, () => new Array(COLS).fill(0));
    revealed = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
    flagged = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
    started = false; dead = false; won = false;
    remaining = MINES;
    elapsed = 0;
    flagEl.textContent = remaining;
    timeEl.textContent = "0";
    infoEl.textContent = "Click to reveal · Right-click to flag";
    buildGrid();
  }

  function buildGrid() {
    gridEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "ms-cell";
      cell.style.cssText = "width:30px;height:30px;background:linear-gradient(180deg,#bbb,#888);border:2px outset #ccc;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:0.7rem;cursor:pointer;user-select:none;color:#000;";
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
      timer = setInterval(() => { elapsed++; timeEl.textContent = elapsed; }, 1000);
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
    let unrevealed = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (!revealed[r][c]) unrevealed++;
    if (unrevealed === MINES) {
      won = true;
      clearInterval(timer);
      infoEl.textContent = `🏆 YOU WIN in ${elapsed}s!`;
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
