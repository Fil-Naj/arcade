// Breakout - paddle, ball, bricks
(function () {
  "use strict";
  const W = 560, H = 420, PW = 84, PH = 12;
  let canvas, ctx, px, bx, by, bvx, bvy, bricks, left, right, running, raf, score, lives, infoEl, scoreEl, livesEl, gameState;

  const ROWS = 5, COLS = 10, BW = 50, BH = 16, BPAD = 4, BTOP = 40;
  const BRICK_COLORS = ["#ff3b6b", "#ff9a3b", "#ffd641", "#7cff4f", "#00f0ff"];
  let best = 0, bestEl;

  function init(mount) {
    best = parseInt(localStorage.getItem("arcade-breakout-best") || "0", 10) || 0;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>BREAKOUT</h2>
      <div class="hud">
        <span>SCORE<strong id="bo-score">0</strong></span>
        <span>BEST<strong id="bo-best">${best}</strong></span>
        <span>LIVES<strong id="bo-lives">3</strong></span>
      </div>
      <canvas id="bo-canvas" width="${W}" height="${H}"></canvas>
      <div class="mg-info" id="bo-info">Arrow keys / A-D / Mouse to move. Space to launch.</div>
      <div class="mg-controls-help">←→ or A/D or mouse · Space launches</div>
      <button class="mg-btn" id="bo-restart">New Game</button>
    `;
    mount.appendChild(wrap);
    canvas = document.getElementById("bo-canvas");
    ctx = canvas.getContext("2d");
    infoEl = document.getElementById("bo-info");
    scoreEl = document.getElementById("bo-score");
    bestEl = document.getElementById("bo-best");
    livesEl = document.getElementById("bo-lives");
    document.getElementById("bo-restart").addEventListener("click", reset);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("click", () => { if (gameState === "ready") launch(); });
    canvas.addEventListener("touchmove", onTouch, {passive: false});
    canvas.addEventListener("touchstart", () => { if (gameState === "ready") launch(); });
    score = 0; lives = 3;
    reset();
    running = true;
    loop();
  }

  function reset() {
    px = W/2 - PW/2;
    stickBall();
    bricks = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      bricks.push({x: c*(BW+BPAD) + (W - COLS*(BW+BPAD) + BPAD)/2, y: BTOP + r*(BH+BPAD), alive: true, row: r});
    }
    score = 0; lives = 3;
    updateHud();
    infoEl.textContent = "Space / click to launch";
    gameState = "ready";
  }

  function stickBall() {
    bx = px + PW/2; by = H - PH - 10; bvx = 0; bvy = 0;
    gameState = "ready";
  }

  function launch() {
    bvx = (Math.random() < 0.5 ? -1 : 1) * 3.5;
    bvy = -4.5;
    gameState = "playing";
    infoEl.textContent = "";
  }

  function updateHud() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
    if (score > best) { best = score; bestEl.textContent = best; localStorage.setItem("arcade-breakout-best", String(best)); }
  }

  function onKey(e) {
    if (!document.body.contains(canvas)) return;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { left = true; e.preventDefault(); }
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { right = true; e.preventDefault(); }
    if (e.key === " " && gameState === "ready") { e.preventDefault(); launch(); }
    if (e.key === " " && gameState === "over") { e.preventDefault(); reset(); }
  }
  function onKeyUp(e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") right = false;
  }
  function onMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    px = Math.max(0, Math.min(W - PW, x - PW/2));
  }
  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0]; if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const x = (t.clientX - rect.left) * (W / rect.width);
    px = Math.max(0, Math.min(W - PW, x - PW/2));
  }

  function loop() {
    if (!running) return;
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update() {
    if (left) px -= 7;
    if (right) px += 7;
    px = Math.max(0, Math.min(W - PW, px));

    if (gameState === "ready") { bx = px + PW/2; return; }
    if (gameState !== "playing") return;

    bx += bvx; by += bvy;
    if (bx < 6) { bx = 6; bvx = -bvx; }
    if (bx > W - 6) { bx = W - 6; bvx = -bvx; }
    if (by < 6) { by = 6; bvy = -bvy; }

    // paddle
    if (by >= H - PH - 10 && by <= H - 6 && bx >= px && bx <= px + PW && bvy > 0) {
      bvy = -Math.abs(bvy);
      const offset = (bx - (px + PW/2)) / (PW/2);
      bvx = offset * 5;
    }

    if (by > H) {
      lives--;
      updateHud();
      if (lives <= 0) {
        gameState = "over";
        infoEl.textContent = "GAME OVER — " + score + " pts. Space to restart.";
        return;
      }
      stickBall();
      return;
    }

    // bricks
    for (const br of bricks) {
      if (!br.alive) continue;
      if (bx + 6 >= br.x && bx - 6 <= br.x + BW && by + 6 >= br.y && by - 6 <= br.y + BH) {
        br.alive = false;
        score += (ROWS - br.row) * 10;
        updateHud();
        // reflect
        const prevX = bx - bvx, prevY = by - bvy;
        const hitX = prevX + 6 < br.x || prevX - 6 > br.x + BW;
        if (hitX) bvx = -bvx; else bvy = -bvy;
        break;
      }
    }
    if (bricks.every(b => !b.alive)) {
      gameState = "won";
      infoEl.textContent = "🏆 CLEARED! " + score + " pts. Space for new game.";
    }
  }

  function draw() {
    ctx.fillStyle = "#0a0a18";
    ctx.fillRect(0, 0, W, H);
    // bricks
    bricks.forEach(b => {
      if (!b.alive) return;
      const col = BRICK_COLORS[b.row];
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.fillRect(b.x, b.y, BW, BH);
    });
    ctx.shadowBlur = 0;
    // paddle
    ctx.fillStyle = "#00f0ff";
    ctx.shadowColor = "#00f0ff"; ctx.shadowBlur = 12;
    ctx.fillRect(px, H - PH - 2, PW, PH);
    // ball
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#fff";
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function onHide() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKeyUp);
  }

  Arcade.register({
    id: "breakout",
    name: "Breakout",
    icon: "🧱",
    color: "#ff9a3b",
    tag: "ARCADE",
    order: 7,
    init,
    onHide
  });
})();
