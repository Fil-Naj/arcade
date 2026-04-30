// Snake - arrow keys / WASD / touch
(function () {
  "use strict";

  const SIZE = 20;    // grid cells
  const CELL = 18;    // px per cell
  const TICK = 110;   // ms between moves

  let canvas, ctx, infoEl, scoreEl, bestEl, snake, dir, pendingDir, food, alive, score, best, timer, mount;

  function init(m) {
    mount = m;
    best = parseInt(localStorage.getItem("arcade-snake-best") || "0", 10) || 0;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>SNAKE</h2>
      <div class="hud">
        <span>SCORE<strong id="snake-score">0</strong></span>
        <span>BEST<strong id="snake-best">${best}</strong></span>
      </div>
      <canvas id="snake-canvas" width="${SIZE*CELL}" height="${SIZE*CELL}"></canvas>
      <div class="mg-info" id="snake-info">Press any arrow key to start</div>
      <div class="mg-controls-help">Arrow keys / WASD to steer · Space to restart</div>
      <button class="mg-btn" id="snake-restart">Restart</button>
    `;
    mount.appendChild(wrap);
    canvas = document.getElementById("snake-canvas");
    ctx = canvas.getContext("2d");
    infoEl = document.getElementById("snake-info");
    scoreEl = document.getElementById("snake-score");
    bestEl = document.getElementById("snake-best");
    document.getElementById("snake-restart").addEventListener("click", reset);
    window.addEventListener("keydown", onKey);
    attachTouch();
    reset();
  }

  function reset() {
    snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}];
    dir = {x: 1, y: 0};
    pendingDir = dir;
    alive = true;
    score = 0;
    scoreEl.textContent = "0";
    infoEl.textContent = "Press any arrow key to start";
    placeFood();
    stopLoop();
    draw();
  }

  function placeFood() {
    while (true) {
      const f = {x: Math.floor(Math.random()*SIZE), y: Math.floor(Math.random()*SIZE)};
      if (!snake.some(s => s.x === f.x && s.y === f.y)) { food = f; return; }
    }
  }

  function onKey(e) {
    if (!mount || !document.body.contains(canvas)) return;
    const k = e.key;
    let nd = null;
    if (k === "ArrowUp" || k === "w" || k === "W") nd = {x: 0, y: -1};
    else if (k === "ArrowDown" || k === "s" || k === "S") nd = {x: 0, y: 1};
    else if (k === "ArrowLeft" || k === "a" || k === "A") nd = {x: -1, y: 0};
    else if (k === "ArrowRight" || k === "d" || k === "D") nd = {x: 1, y: 0};
    else if (k === " ") { e.preventDefault(); reset(); return; }
    if (!nd) return;
    e.preventDefault();
    if (!alive) return;
    if (nd.x === -dir.x && nd.y === -dir.y) return; // no 180
    pendingDir = nd;
    if (!timer) startLoop();
  }

  let touchStart = null;
  function attachTouch() {
    canvas.addEventListener("touchstart", e => {
      const t = e.changedTouches[0];
      touchStart = {x: t.clientX, y: t.clientY};
    }, {passive: true});
    canvas.addEventListener("touchend", e => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (Math.abs(dx) + Math.abs(dy) < 20) return;
      let nd;
      if (Math.abs(dx) > Math.abs(dy)) nd = {x: dx > 0 ? 1 : -1, y: 0};
      else nd = {x: 0, y: dy > 0 ? 1 : -1};
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      pendingDir = nd;
      if (!timer && alive) startLoop();
    });
  }

  function startLoop() {
    if (timer) return;
    timer = setInterval(tick, TICK);
    infoEl.textContent = "";
  }
  function stopLoop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function tick() {
    if (!alive) { stopLoop(); return; }
    dir = pendingDir;
    const head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};
    if (head.x < 0 || head.x >= SIZE || head.y < 0 || head.y >= SIZE) return die();
    if (snake.some((s, i) => i < snake.length - 1 && s.x === head.x && s.y === head.y)) return die();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = String(score);
      if (score > best) { best = score; bestEl.textContent = best; localStorage.setItem("arcade-snake-best", String(best)); }
      placeFood();
    } else {
      snake.pop();
    }
    draw();
  }

  function die() {
    alive = false;
    stopLoop();
    infoEl.textContent = `GAME OVER — ${score} points. Space to restart.`;
    draw(true);
  }

  function draw(flash) {
    ctx.fillStyle = "#0a0a18";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // grid
    ctx.strokeStyle = "rgba(0,240,255,0.06)";
    for (let i = 1; i < SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i*CELL, 0); ctx.lineTo(i*CELL, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*CELL); ctx.lineTo(canvas.width, i*CELL); ctx.stroke();
    }
    // food
    ctx.fillStyle = "#ff3b6b";
    ctx.shadowColor = "#ff3b6b";
    ctx.shadowBlur = 10;
    ctx.fillRect(food.x*CELL + 2, food.y*CELL + 2, CELL - 4, CELL - 4);
    ctx.shadowBlur = 0;
    // snake
    snake.forEach((s, i) => {
      const isHead = i === 0;
      ctx.fillStyle = isHead ? "#7cff4f" : (i % 2 ? "#4fc83e" : "#6ad44a");
      if (flash) ctx.fillStyle = "#ff3b6b";
      ctx.shadowColor = "#7cff4f";
      ctx.shadowBlur = isHead ? 12 : 4;
      ctx.fillRect(s.x*CELL + 1, s.y*CELL + 1, CELL - 2, CELL - 2);
    });
    ctx.shadowBlur = 0;
  }

  function onHide() {
    stopLoop();
    window.removeEventListener("keydown", onKey);
  }

  Arcade.register({
    id: "snake",
    name: "Snake",
    icon: "🐍",
    color: "#7cff4f",
    tag: "ARCADE",
    order: 2,
    init,
    onHide
  });
})();
