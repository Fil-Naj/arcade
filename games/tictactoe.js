// Tic-Tac-Toe - vs minimax AI
(function () {
  "use strict";
  const X = "X", O = "O", E = "";
  let board, current, human, aiPlayer, mode, gridEl, infoEl, scoreEl, wins = {X:0, O:0, draw:0};

  function init(mount) {
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>TIC-TAC-TOE</h2>
      <div class="hud">
        <span>YOU (X)<strong id="ttt-x">0</strong></span>
        <span>CPU (O)<strong id="ttt-o">0</strong></span>
        <span>DRAWS<strong id="ttt-d">0</strong></span>
      </div>
      <div id="ttt-grid" style="
        display:grid;grid-template-columns:repeat(3,80px);gap:6px;
        padding:10px;background:#000;border:3px solid #00f0ff;border-radius:6px;
        box-shadow:0 0 18px rgba(0,240,255,0.4);"></div>
      <div class="mg-info" id="ttt-info">You are X. Click a square.</div>
      <div class="mg-controls-help">Click any square · X goes first</div>
      <button class="mg-btn" id="ttt-restart">New Round</button>
    `;
    mount.appendChild(wrap);
    gridEl = document.getElementById("ttt-grid");
    infoEl = document.getElementById("ttt-info");
    for (let i = 0; i < 9; i++) {
      const c = document.createElement("div");
      c.className = "ttt-cell";
      c.style.cssText = "width:80px;height:80px;background:#0a0a18;border:2px solid #00f0ff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P',monospace;font-size:2rem;cursor:pointer;color:#fff;box-shadow:inset 0 0 12px rgba(0,240,255,0.15);";
      c.dataset.idx = i;
      c.addEventListener("click", () => onClick(i));
      gridEl.appendChild(c);
    }
    document.getElementById("ttt-restart").addEventListener("click", reset);
    human = X; aiPlayer = O;
    reset();
  }

  function reset() {
    board = [E,E,E,E,E,E,E,E,E];
    current = X;
    render();
    infoEl.textContent = "Your move (X)";
  }

  function render() {
    [...gridEl.children].forEach((c, i) => {
      c.textContent = board[i];
      c.style.color = board[i] === X ? "#00f0ff" : "#ff3b6b";
      c.style.textShadow = board[i] ? `0 0 10px ${c.style.color}` : "";
    });
    document.getElementById("ttt-x").textContent = wins.X;
    document.getElementById("ttt-o").textContent = wins.O;
    document.getElementById("ttt-d").textContent = wins.draw;
  }

  function onClick(i) {
    if (board[i] !== E || current !== human) return;
    board[i] = human;
    const r = result(board);
    render();
    if (r) return finish(r);
    current = aiPlayer;
    infoEl.textContent = "CPU thinking…";
    setTimeout(aiMove, 350);
  }

  function aiMove() {
    const best = minimax(board, aiPlayer);
    board[best.idx] = aiPlayer;
    render();
    const r = result(board);
    if (r) return finish(r);
    current = human;
    infoEl.textContent = "Your move (X)";
  }

  function finish(r) {
    if (r === "draw") { wins.draw++; infoEl.textContent = "DRAW!"; }
    else if (r === human) { wins.X++; infoEl.textContent = "YOU WIN!"; }
    else { wins.O++; infoEl.textContent = "CPU WINS"; }
    render();
    current = null;
  }

  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  function winner(b) {
    for (const [a,c,d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
    return null;
  }
  function result(b) {
    const w = winner(b);
    if (w) return w;
    if (b.every(x => x !== E)) return "draw";
    return null;
  }

  function minimax(b, player) {
    const r = result(b);
    if (r === aiPlayer) return {score: 10};
    if (r === human) return {score: -10};
    if (r === "draw") return {score: 0};
    const moves = [];
    for (let i = 0; i < 9; i++) {
      if (b[i] !== E) continue;
      b[i] = player;
      const res = minimax(b, player === X ? O : X);
      moves.push({idx: i, score: res.score});
      b[i] = E;
    }
    if (player === aiPlayer) {
      let best = moves[0];
      for (const m of moves) if (m.score > best.score) best = m;
      return best;
    } else {
      let best = moves[0];
      for (const m of moves) if (m.score < best.score) best = m;
      return best;
    }
  }

  Arcade.register({
    id: "tictactoe",
    name: "Tic-Tac-Toe",
    icon: "❌⭕",
    color: "#ff3b6b",
    tag: "CLASSIC",
    order: 3,
    init
  });
})();
