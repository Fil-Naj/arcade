// Tron Light Cycles - local 2 player
(function () {
  "use strict";

  const SIZES = [
    { label: "Small",  cols: 40, rows: 25 },
    { label: "Medium", cols: 60, rows: 38 },
    { label: "Large",  cols: 80, rows: 50 },
    { label: "Huge",   cols: 100, rows: 60 }
  ];
  const CELL = 10;
  const SPEEDS = [
    { label: "Slow",   ms: 90 },
    { label: "Normal", ms: 55 },
    { label: "Fast",   ms: 35 },
    { label: "Insane", ms: 20 }
  ];
  let tickMs = SPEEDS[1].ms;
  let cols = SIZES[2].cols, rows = SIZES[2].rows;
  let randomSpawn = false;

  const P1_COLOR = "#00d4ff";
  const P1_HEAD  = "#ffffff";
  const P2_COLOR = "#ff4040";
  const P2_HEAD  = "#ffe050";

  let canvas, ctx, infoEl, mount;
  let p1, p2, running, countdown, timer, countTimer;
  let score1 = 0, score2 = 0;

  function init(m) {
    mount = m;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>TRON</h2>
      <div class="hud" style="display:flex;gap:1.2rem;justify-content:center;margin-bottom:.5rem;align-items:center;flex-wrap:wrap">
        <span style="color:${P1_COLOR}">■ P1 (WASD): <strong id="tron-s1">0</strong></span>
        <span>
          <label for="tron-speed" style="font-size:.85em;margin-right:.3em">SPEED</label>
          <select id="tron-speed" style="font-size:.85em;padding:2px 4px;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px">
            ${SPEEDS.map((s, i) => `<option value="${i}"${i === 1 ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </span>
        <span>
          <label for="tron-size" style="font-size:.85em;margin-right:.3em">BOARD</label>
          <select id="tron-size" style="font-size:.85em;padding:2px 4px;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px">
            ${SIZES.map((s, i) => `<option value="${i}"${i === 2 ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </span>
        <span>
          <label style="font-size:.85em;cursor:pointer">
            <input type="checkbox" id="tron-random" style="vertical-align:middle;margin-right:.2em">
            Random spawn
          </label>
        </span>
        <span style="color:${P2_COLOR}">■ P2 (Arrows): <strong id="tron-s2">0</strong></span>
      </div>
      <canvas id="tron-canvas" width="${cols * CELL}" height="${rows * CELL}"></canvas>
      <div class="mg-info" id="tron-info">Press Space to start</div>
      <div class="mg-controls-help">P1: WASD · P2: Arrow keys · Space: start / restart</div>
      <button class="mg-btn" id="tron-restart">Restart</button>
    `;
    mount.appendChild(wrap);
    canvas = document.getElementById("tron-canvas");
    ctx = canvas.getContext("2d");
    infoEl = document.getElementById("tron-info");
    document.getElementById("tron-restart").addEventListener("click", reset);
    document.getElementById("tron-speed").addEventListener("change", function () {
      tickMs = SPEEDS[parseInt(this.value)].ms;
    });
    document.getElementById("tron-size").addEventListener("change", function () {
      const s = SIZES[parseInt(this.value)];
      cols = s.cols; rows = s.rows;
      canvas.width = cols * CELL; canvas.height = rows * CELL;
      reset();
    });
    document.getElementById("tron-random").addEventListener("change", function () {
      randomSpawn = this.checked;
    });
    window.addEventListener("keydown", onKey);
    score1 = 0; score2 = 0;
    reset();
  }

  function makePlayer(x, y, dx, dy, color, headColor) {
    return {
      trail: [{ x, y }],
      dx, dy,
      pendingDx: dx, pendingDy: dy,
      color, headColor,
      alive: true
    };
  }

  function dirAwayFromEdge(x, y) {
    const dL = x, dR = cols - 1 - x, dT = y, dB = rows - 1 - y;
    const min = Math.min(dL, dR, dT, dB);
    if (min === dL) return { dx: 1, dy: 0 };
    if (min === dR) return { dx: -1, dy: 0 };
    if (min === dT) return { dx: 0, dy: 1 };
    return { dx: 0, dy: -1 };
  }

  function randPos(margin) {
    return {
      x: margin + Math.floor(Math.random() * (cols - margin * 2)),
      y: margin + Math.floor(Math.random() * (rows - margin * 2))
    };
  }

  function reset() {
    stopLoop();
    if (randomSpawn) {
      const margin = 3;
      let pos1, pos2;
      // ensure min distance between spawns
      do {
        pos1 = randPos(margin);
        pos2 = randPos(margin);
      } while (Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y) < 15);
      const d1 = dirAwayFromEdge(pos1.x, pos1.y);
      const d2 = dirAwayFromEdge(pos2.x, pos2.y);
      p1 = makePlayer(pos1.x, pos1.y, d1.dx, d1.dy, P1_COLOR, P1_HEAD);
      p2 = makePlayer(pos2.x, pos2.y, d2.dx, d2.dy, P2_COLOR, P2_HEAD);
    } else {
      p1 = makePlayer(Math.floor(cols * 0.25), Math.floor(rows / 2), 1, 0, P1_COLOR, P1_HEAD);
      p2 = makePlayer(Math.floor(cols * 0.75), Math.floor(rows / 2), -1, 0, P2_COLOR, P2_HEAD);
    }
    running = false;
    countdown = 0;
    infoEl.textContent = "Press Space to start";
    infoEl.style.display = "";
    draw();
  }

  function onKey(e) {
    if (!mount || !document.body.contains(canvas)) return;
    const k = e.key;

    if (k === " ") {
      e.preventDefault();
      if (!running && countdown === 0) { reset(); startCountdown(); }
      return;
    }

    // P1 - WASD
    if (k === "w" || k === "W") setDir(p1, 0, -1);
    else if (k === "s" || k === "S") setDir(p1, 0, 1);
    else if (k === "a" || k === "A") setDir(p1, -1, 0);
    else if (k === "d" || k === "D") setDir(p1, 1, 0);

    // P2 - Arrows
    else if (k === "ArrowUp") setDir(p2, 0, -1);
    else if (k === "ArrowDown") setDir(p2, 0, 1);
    else if (k === "ArrowLeft") setDir(p2, -1, 0);
    else if (k === "ArrowRight") setDir(p2, 1, 0);
    else return;

    e.preventDefault();
  }

  function setDir(p, dx, dy) {
    if (!running || !p.alive) return;
    // check against pending direction to allow fast input between ticks
    if (p.pendingDx === -dx && p.pendingDy === -dy) return;
    p.pendingDx = dx;
    p.pendingDy = dy;
  }

  function startCountdown() {
    countdown = 3;
    infoEl.textContent = countdown;
    countTimer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        infoEl.textContent = countdown;
      } else {
        clearInterval(countTimer);
        countTimer = null;
        infoEl.style.display = "none";
        running = true;
        startLoop();
      }
    }, 700);
  }

  function startLoop() {
    if (!timer) {
      lastTick = performance.now();
      timer = requestAnimationFrame(gameLoop);
    }
  }
  function stopLoop() {
    if (timer) { cancelAnimationFrame(timer); timer = null; }
    if (countTimer) { clearInterval(countTimer); countTimer = null; }
  }

  let lastTick = 0;
  function gameLoop(now) {
    timer = requestAnimationFrame(gameLoop);
    if (now - lastTick < tickMs) return;
    lastTick = now;
    tick();
  }

  // Build occupied set from both trails
  function buildOccupied() {
    const set = new Set();
    for (const t of p1.trail) set.add(t.x + "," + t.y);
    for (const t of p2.trail) set.add(t.x + "," + t.y);
    return set;
  }

  function tick() {
    // Apply pending directions
    p1.dx = p1.pendingDx; p1.dy = p1.pendingDy;
    p2.dx = p2.pendingDx; p2.dy = p2.pendingDy;

    // Compute next heads
    const h1 = head(p1);
    const h2 = head(p2);
    const n1 = { x: h1.x + p1.dx, y: h1.y + p1.dy };
    const n2 = { x: h2.x + p2.dx, y: h2.y + p2.dy };

    const occupied = buildOccupied();

    // Check collisions
    const c1 = isCollision(n1, occupied);
    const c2 = isCollision(n2, occupied);
    // Head-on: both moving into the same cell
    const headOn = n1.x === n2.x && n1.y === n2.y;

    if (headOn) {
      p1.alive = false;
      p2.alive = false;
    } else {
      if (c1) p1.alive = false;
      if (c2) p2.alive = false;
    }

    // Advance survivors (trail never trims — old segments still collide)
    if (p1.alive) p1.trail.push(n1);
    if (p2.alive) p2.trail.push(n2);

    draw();

    if (!p1.alive || !p2.alive) {
      stopLoop();
      running = false;
      if (!p1.alive && !p2.alive) { /* draw, no points */ }
      else if (!p1.alive) score2++;
      else score1++;
      updateScoreDisplay();
      infoEl.style.display = "";
      if (!p1.alive && !p2.alive) infoEl.textContent = "Draw! Space to restart";
      else if (!p1.alive) infoEl.textContent = "P2 wins! Space to restart";
      else infoEl.textContent = "P1 wins! Space to restart";
    }
  }

  function head(p) { return p.trail[p.trail.length - 1]; }

  function updateScoreDisplay() {
    const s1 = document.getElementById("tron-s1");
    const s2 = document.getElementById("tron-s2");
    if (s1) s1.textContent = score1;
    if (s2) s2.textContent = score2;
  }

  function isCollision(pos, occupied) {
    if (pos.x < 0 || pos.x >= cols || pos.y < 0 || pos.y >= rows) return true;
    return occupied.has(pos.x + "," + pos.y);
  }

  function draw() {
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, rows * CELL); ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(cols * CELL, y * CELL); ctx.stroke();
    }

    drawPlayer(p1);
    drawPlayer(p2);
  }

  function drawPlayer(p) {
    const len = p.trail.length;
    // Trail with fade: older segments are more transparent
    for (let i = 0; i < len - 1; i++) {
      const t = p.trail[i];
      const alpha = 0.15 + 0.85 * (i / len);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = alpha > 0.6 ? 6 : 2;
      ctx.fillRect(t.x * CELL + 1, t.y * CELL + 1, CELL - 2, CELL - 2);
    }
    ctx.globalAlpha = 1;

    // Head (brighter)
    if (len > 0) {
      const h = p.trail[len - 1];
      ctx.fillStyle = p.headColor;
      ctx.shadowColor = p.headColor;
      ctx.shadowBlur = 10;
      ctx.fillRect(h.x * CELL, h.y * CELL, CELL, CELL);
    }
    ctx.shadowBlur = 0;
  }

  function onHide() {
    stopLoop();
    window.removeEventListener("keydown", onKey);
  }

  Arcade.register({
    id: "tron",
    name: "Tron",
    icon: "🏍️",
    color: "#00d4ff",
    tag: "2 PLAYER",
    order: 8,
    init,
    onHide
  });
})();
