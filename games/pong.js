// Pong - vs AI
(function () {
  "use strict";
  const W = 600, H = 360, PW = 10, PH = 70, BALL = 8;
  let canvas, ctx, p1y, p2y, bx, by, bvx, bvy, p1s, p2s, up, down, running, raf, infoEl, scoreEl, mount;

  function init(m) {
    mount = m;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>PONG</h2>
      <div class="hud">
        <span>YOU<strong id="pong-p1">0</strong></span>
        <span>CPU<strong id="pong-p2">0</strong></span>
      </div>
      <canvas id="pong-canvas" width="${W}" height="${H}" tabindex="0"></canvas>
      <div class="mg-info" id="pong-info">Click canvas then W/S or Arrow keys. First to 7 wins.</div>
      <div class="mg-controls-help">W/S · ↑/↓ · Mouse drag on canvas</div>
      <button class="mg-btn" id="pong-restart">Restart</button>
    `;
    mount.appendChild(wrap);
    canvas = document.getElementById("pong-canvas");
    ctx = canvas.getContext("2d");
    infoEl = document.getElementById("pong-info");
    document.getElementById("pong-restart").addEventListener("click", reset);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("touchmove", onTouch, {passive: false});
    p1s = 0; p2s = 0;
    reset();
    running = true;
    loop();
  }

  function reset() {
    p1y = H/2 - PH/2; p2y = H/2 - PH/2;
    bx = W/2; by = H/2;
    const ang = (Math.random() - 0.5) * 0.6;
    const dir = Math.random() < 0.5 ? -1 : 1;
    bvx = dir * 4.5 * Math.cos(ang);
    bvy = 4.5 * Math.sin(ang);
    if (p1s >= 7 || p2s >= 7) { p1s = 0; p2s = 0; updateScore(); }
    infoEl.textContent = "First to 7 wins!";
  }

  function updateScore() {
    document.getElementById("pong-p1").textContent = p1s;
    document.getElementById("pong-p2").textContent = p2s;
  }

  function onKeyDown(e) {
    if (!document.body.contains(canvas)) return;
    if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") { up = true; e.preventDefault(); }
    if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") { down = true; e.preventDefault(); }
  }
  function onKeyUp(e) {
    if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") up = false;
    if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") down = false;
  }
  function onMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (H / rect.height);
    p1y = Math.max(0, Math.min(H - PH, y - PH/2));
  }
  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0]; if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const y = (t.clientY - rect.top) * (H / rect.height);
    p1y = Math.max(0, Math.min(H - PH, y - PH/2));
  }

  function loop() {
    if (!running) return;
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update() {
    // player input
    if (up) p1y -= 6;
    if (down) p1y += 6;
    p1y = Math.max(0, Math.min(H - PH, p1y));

    // AI: move toward ball with small delay
    const target = by - PH/2;
    const diff = target - p2y;
    p2y += Math.max(-5, Math.min(5, diff * 0.12));
    p2y = Math.max(0, Math.min(H - PH, p2y));

    // ball
    bx += bvx; by += bvy;
    if (by <= BALL/2 || by >= H - BALL/2) bvy = -bvy;

    // paddle collisions
    if (bx - BALL/2 <= PW && by >= p1y && by <= p1y + PH && bvx < 0) {
      bvx = Math.abs(bvx) * 1.06;
      bvy += ((by - (p1y + PH/2)) / (PH/2)) * 2;
    }
    if (bx + BALL/2 >= W - PW && by >= p2y && by <= p2y + PH && bvx > 0) {
      bvx = -Math.abs(bvx) * 1.06;
      bvy += ((by - (p2y + PH/2)) / (PH/2)) * 2;
    }
    // clamp speed
    bvx = Math.max(-11, Math.min(11, bvx));
    bvy = Math.max(-11, Math.min(11, bvy));

    if (bx < 0) { p2s++; updateScore(); if (p2s >= 7) { infoEl.textContent = "CPU WINS"; } reset(); }
    else if (bx > W) { p1s++; updateScore(); if (p1s >= 7) { infoEl.textContent = "YOU WIN!"; } reset(); }
  }

  function draw() {
    ctx.fillStyle = "#0a0a18";
    ctx.fillRect(0, 0, W, H);
    // center net
    ctx.strokeStyle = "rgba(0,240,255,0.4)";
    ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
    ctx.setLineDash([]);
    // paddles
    ctx.fillStyle = "#00f0ff";
    ctx.shadowColor = "#00f0ff"; ctx.shadowBlur = 10;
    ctx.fillRect(0, p1y, PW, PH);
    ctx.fillStyle = "#ff3b6b";
    ctx.shadowColor = "#ff3b6b";
    ctx.fillRect(W - PW, p2y, PW, PH);
    // ball
    ctx.fillStyle = "#ffd641";
    ctx.shadowColor = "#ffd641";
    ctx.beginPath(); ctx.arc(bx, by, BALL, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function onHide() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  }

  Arcade.register({
    id: "pong",
    name: "Pong",
    icon: "🏓",
    color: "#ffd641",
    tag: "SPORT",
    order: 6,
    init,
    onHide
  });
})();
