// 2048 - arrow keys / WASD / swipe
(function () {
  "use strict";
  const N = 4;
  let grid, score, best = 0, infoEl, scoreEl, bestEl, gridEl, won, dead, mount;

  function init(m) {
    mount = m;
    best = parseInt(localStorage.getItem("arcade-2048-best") || "0", 10) || 0;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>2048</h2>
      <div class="hud">
        <span>SCORE<strong id="t2048-score">0</strong></span>
        <span>BEST<strong id="t2048-best">${best}</strong></span>
      </div>
      <div id="t2048-grid" style="
        display:grid;grid-template-columns:repeat(${N},72px);gap:8px;
        padding:10px;background:#1a1510;border:3px solid #ffc107;border-radius:8px;
        box-shadow:0 0 20px rgba(255,193,7,0.35);"></div>
      <div class="mg-info" id="t2048-info">Arrow keys / WASD · reach 2048!</div>
      <div class="mg-controls-help">Arrow keys / WASD · Swipe on touch</div>
      <button class="mg-btn" id="t2048-restart">New Game</button>
    `;
    mount.appendChild(wrap);
    gridEl = document.getElementById("t2048-grid");
    infoEl = document.getElementById("t2048-info");
    scoreEl = document.getElementById("t2048-score");
    bestEl = document.getElementById("t2048-best");
    for (let i = 0; i < N*N; i++) {
      const tile = document.createElement("div");
      tile.className = "t2048-cell";
      tile.style.cssText = "width:72px;height:72px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:1rem;transition:background 0.15s;";
      gridEl.appendChild(tile);
    }
    document.getElementById("t2048-restart").addEventListener("click", reset);
    window.addEventListener("keydown", onKey);
    attachTouch();
    reset();
  }

  function reset() {
    grid = Array.from({length: N}, () => new Array(N).fill(0));
    score = 0;
    won = false; dead = false;
    spawn(); spawn();
    render();
    infoEl.textContent = "Arrow keys / WASD · reach 2048!";
  }

  function spawn() {
    const empties = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empties.push([r,c]);
    if (!empties.length) return false;
    const [r,c] = empties[Math.floor(Math.random()*empties.length)];
    grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    return true;
  }

  const COLORS = {
    0:["#2a2015","#888"],2:["#ede0cc","#3a2a10"],4:["#ede0bb","#3a2a10"],
    8:["#f2b179","#fff"],16:["#f59563","#fff"],32:["#f67c5f","#fff"],
    64:["#f65e3b","#fff"],128:["#edcf72","#fff"],256:["#edcc61","#fff"],
    512:["#edc850","#fff"],1024:["#edc53f","#fff"],2048:["#edc22e","#fff"],
  };

  function render() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = grid[r][c];
      const el = gridEl.children[r*N + c];
      const [bg, fg] = COLORS[v] || ["#3c3a32","#fff"];
      el.style.background = bg;
      el.style.color = fg;
      el.textContent = v ? v : "";
      el.style.fontSize = v >= 1024 ? "0.8rem" : v >= 128 ? "0.95rem" : "1.1rem";
      el.style.boxShadow = v >= 8 ? `0 0 12px ${bg}` : "none";
    }
    scoreEl.textContent = score;
    if (score > best) { best = score; bestEl.textContent = best; localStorage.setItem("arcade-2048-best", String(best)); }
  }

  function slide(row) {
    const r = row.filter(v => v);
    for (let i = 0; i < r.length - 1; i++) {
      if (r[i] === r[i+1]) { r[i] *= 2; score += r[i]; if (r[i] === 2048) won = true; r.splice(i+1, 1); }
    }
    while (r.length < N) r.push(0);
    return r;
  }

  function move(dir) {
    if (dead) return false;
    const before = JSON.stringify(grid);
    if (dir === "L") {
      for (let r = 0; r < N; r++) grid[r] = slide(grid[r]);
    } else if (dir === "R") {
      for (let r = 0; r < N; r++) grid[r] = slide(grid[r].slice().reverse()).reverse();
    } else if (dir === "U") {
      for (let c = 0; c < N; c++) {
        const col = slide([0,1,2,3].map(r => grid[r][c]));
        for (let r = 0; r < N; r++) grid[r][c] = col[r];
      }
    } else if (dir === "D") {
      for (let c = 0; c < N; c++) {
        const col = slide([0,1,2,3].map(r => grid[r][c]).reverse()).reverse();
        for (let r = 0; r < N; r++) grid[r][c] = col[r];
      }
    }
    const changed = JSON.stringify(grid) !== before;
    if (changed) spawn();
    render();
    if (won) infoEl.textContent = "YOU WIN! Keep going or restart.";
    if (!canMove()) { dead = true; infoEl.textContent = "GAME OVER — " + score + " points"; }
    return changed;
  }

  function canMove() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!grid[r][c]) return true;
      if (c + 1 < N && grid[r][c] === grid[r][c+1]) return true;
      if (r + 1 < N && grid[r][c] === grid[r+1][c]) return true;
    }
    return false;
  }

  function onKey(e) {
    if (!document.body.contains(gridEl)) return;
    let d;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") d = "L";
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") d = "R";
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") d = "U";
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") d = "D";
    else return;
    e.preventDefault();
    move(d);
  }

  let touchStart = null;
  function attachTouch() {
    gridEl.addEventListener("touchstart", e => {
      const t = e.changedTouches[0];
      touchStart = {x: t.clientX, y: t.clientY};
    }, {passive: true});
    gridEl.addEventListener("touchend", e => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
      if (Math.abs(dx) + Math.abs(dy) < 25) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "R" : "L");
      else move(dy > 0 ? "D" : "U");
    });
  }

  function onHide() {
    window.removeEventListener("keydown", onKey);
  }

  Arcade.register({
    id: "2048",
    name: "2048",
    icon: "🧮",
    color: "#ffc107",
    tag: "PUZZLE",
    order: 4,
    init,
    onHide
  });
})();
