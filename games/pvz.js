// Plants vs Zombies (lite) - 5x9 lawn, 5 plant types, 3 zombie types, 5 waves.
(function () {
  "use strict";

  // ============================================================
  //                        CONSTANTS
  // ============================================================
  const CANVAS_W = 720, CANVAS_H = 440;
  const HUD_H = 70;
  const LAWN_X = 50, LAWN_Y = HUD_H + 8;
  const CELL_W = 70, CELL_H = 60;
  const COLS = 9, ROWS = 5;
  const LAWN_W = COLS * CELL_W, LAWN_H = ROWS * CELL_H;
  const MOWER_X = LAWN_X - 24;
  const ZOMBIE_SPAWN_X = LAWN_X + LAWN_W + 24;
  const STARTING_SUN = 50;
  const TOTAL_WAVES = 5;

  // Plant definitions
  const PLANTS = {
    sunflower:  { name: "Sunflower",   cost: 50,  hp: 30,  cool: 7.0,  color: "#f1c40f", produce: 22.0, action: null },
    peashooter: { name: "Peashooter",  cost: 100, hp: 30,  cool: 7.0,  color: "#27ae60", produce: null, action: 1.4 },
    wallnut:    { name: "Wall-nut",    cost: 50,  hp: 250, cool: 30.0, color: "#a0522d", produce: null, action: null },
    cherry:     { name: "Cherry Bomb", cost: 150, hp: 9999, cool: 50.0, color: "#c0392b", produce: null, action: 1.2, oneShot: true },
    snowpea:    { name: "Snow Pea",    cost: 175, hp: 30,  cool: 7.0,  color: "#3498db", produce: null, action: 1.4 },
  };
  const PLANT_KEYS = ["sunflower", "peashooter", "wallnut", "cherry", "snowpea"];

  // Zombie definitions
  const ZOMBIES = {
    basic:  { name: "Basic",   hp: 100, speed: 22, damage: 30, color: "#7a8770" },
    cone:   { name: "Cone",    hp: 220, speed: 22, damage: 30, color: "#7a8770", hat: "cone" },
    bucket: { name: "Bucket",  hp: 380, speed: 20, damage: 30, color: "#7a8770", hat: "bucket" },
  };

  // ============================================================
  //                        STATE
  // ============================================================
  let G;
  let mountRef = null;
  let canvas, ctx, hudEl, msgEl;
  let rafId = null;
  let gameVersion = 0;
  let lastTime = 0;

  function newState() {
    return {
      sun: STARTING_SUN,
      plants: [],           // {type, row, col, x, y, hp, actionTimer, produceTimer, explodeTimer, exploded?, invulnerable}
      zombies: [],          // {type, row, x, y, hp, speed, chilled, biteTimer}
      peas: [],             // {row, x, y, prevX, damage, slow, vx}
      suns: [],             // {x, y, targetY, vy, value, lifetime, fromSky}
      mowers: Array.from({length: ROWS}, () => ({alive: true, triggered: false, x: MOWER_X})),
      selected: null,       // plant type key
      cooldowns: {},        // {type: remaining seconds}
      shovel: false,
      wave: 0,              // current wave (0 = pre-game)
      waveSpawnQueue: [],   // [{at: seconds, type, row}]
      waveSpawningDone: true,
      nextWaveAt: 6.0,      // start first wave after 6s grace period
      nextSunAt: 8.0,
      elapsed: 0,
      phase: "playing",     // "playing" | "won" | "lost"
      message: "",
      // Cursor for placement preview
      mouseX: 0, mouseY: 0, mouseIn: false,
    };
  }

  function startNewGame() {
    gameVersion++;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    G = newState();
    G.message = `Wave 1 in 6 seconds — plant some sunflowers!`;
    lastTime = 0;
    startLoop();
  }

  // ============================================================
  //                        GAME LOOP
  // ============================================================
  function startLoop() {
    const my = gameVersion;
    function loop(now) {
      if (my !== gameVersion) return;
      if (!mountRef || !document.body.contains(mountRef)) return;
      if (!lastTime) lastTime = now;
      const dt = Math.min(0.066, (now - lastTime) / 1000); // clamp dt at ~15fps min
      lastTime = now;
      if (G.phase === "playing") update(dt);
      render();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function update(dt) {
    G.elapsed += dt;

    // Cooldown tick
    for (const k of Object.keys(G.cooldowns)) {
      G.cooldowns[k] -= dt;
      if (G.cooldowns[k] <= 0) delete G.cooldowns[k];
    }

    // Wave progression
    if (G.waveSpawningDone && G.wave < TOTAL_WAVES && G.elapsed >= G.nextWaveAt) {
      startWave(G.wave + 1);
    }
    // Spawn zombies from queue
    while (G.waveSpawnQueue.length > 0 && G.waveSpawnQueue[0].at <= G.elapsed) {
      const s = G.waveSpawnQueue.shift();
      spawnZombie(s.type, s.row);
      if (G.waveSpawnQueue.length === 0) G.waveSpawningDone = true;
    }

    // Sky sun spawner
    if (G.elapsed >= G.nextSunAt) {
      G.nextSunAt = G.elapsed + 8 + Math.random() * 4;
      spawnSkySun();
    }

    // Plants
    for (const p of G.plants) {
      const def = PLANTS[p.type];
      if (def.produce && p.produceTimer != null) {
        p.produceTimer -= dt;
        if (p.produceTimer <= 0) {
          p.produceTimer = def.produce;
          spawnPlantSun(p.x, p.y);
        }
      }
      if (def.action && p.actionTimer != null) {
        p.actionTimer -= dt;
        if (p.actionTimer <= 0) {
          if (p.type === "cherry") {
            // Explode
            cherryExplode(p);
            p.exploded = true;
          } else if (p.type === "peashooter" || p.type === "snowpea") {
            // Only shoot if there is a zombie in this row ahead of the plant
            const ahead = G.zombies.find(z => z.row === p.row && (z.x - 14) > p.x);
            if (ahead) {
              shootPea(p);
              p.actionTimer = def.action;
            } else {
              // Idle: short re-check
              p.actionTimer = 0.3;
            }
          }
        }
      }
    }
    G.plants = G.plants.filter(p => !p.exploded && p.hp > 0);

    // Peas: swept collision
    const peaSpeed = 230;
    for (const pea of G.peas) {
      pea.prevX = pea.x;
      pea.x += peaSpeed * dt;
      // Hit detection: find zombies in row whose hitbox is crossed
      let hit = null;
      for (const z of G.zombies) {
        if (z.row !== pea.row || z.hp <= 0) continue;
        const zLeft = z.x - 14, zRight = z.x + 14;
        if (pea.prevX < zRight && pea.x >= zLeft) {
          // Take leftmost first
          if (!hit || zLeft < hit.zLeft) hit = { z, zLeft };
        }
      }
      if (hit) {
        hit.z.hp -= pea.damage;
        if (pea.slow) {
          hit.z.chilled = Math.max(hit.z.chilled, 5.0);
        }
        pea.x = 9999; // mark for removal
      }
    }
    G.peas = G.peas.filter(p => p.x < CANVAS_W + 20 && p.x < 9999);

    // Zombies
    for (const z of G.zombies) {
      const def = ZOMBIES[z.type];
      if (z.chilled > 0) z.chilled -= dt;
      const speed = z.chilled > 0 ? def.speed * 0.5 : def.speed;
      // Check eating
      const plant = plantAtZombie(z);
      if (plant && !plant.invulnerable) {
        // Eat: bite damage every 1s
        z.biteTimer -= dt;
        if (z.biteTimer <= 0) {
          plant.hp -= def.damage;
          z.biteTimer = 1.0;
        }
        z.eating = true;
      } else {
        // Move
        z.x -= speed * dt;
        z.eating = false;
        z.biteTimer = 0.4; // initial bite delay when reaching next plant
      }
    }
    G.zombies = G.zombies.filter(z => z.hp > 0);

    // Mower triggers: any zombie whose left edge crosses the lawn edge
    for (let r = 0; r < ROWS; r++) {
      const mower = G.mowers[r];
      const triggerLine = LAWN_X + 4;
      const breachers = G.zombies.filter(z => z.row === r && (z.x - 14) <= triggerLine);
      if (breachers.length === 0) continue;
      if (mower.alive && !mower.triggered) {
        mower.triggered = true;
      } else if (!mower.alive) {
        // Game over!
        G.phase = "lost";
        G.message = "💀 A zombie ate your brain! Click NEW GAME.";
      }
    }
    // Animate triggered mowers
    for (let r = 0; r < ROWS; r++) {
      const mower = G.mowers[r];
      if (!mower.triggered || !mower.alive) continue;
      mower.x += 380 * dt;
      // Kill any zombie whose center it crosses
      for (const z of G.zombies) {
        if (z.row === r && Math.abs(z.x - mower.x) < 24) z.hp = 0;
      }
      if (mower.x > CANVAS_W + 20) mower.alive = false;
    }

    // Suns
    for (const s of G.suns) {
      if (s.fromSky && s.y < s.targetY) {
        s.y += s.vy * dt;
      }
      s.lifetime -= dt;
    }
    G.suns = G.suns.filter(s => s.lifetime > 0);

    // Win check
    if (G.wave >= TOTAL_WAVES && G.waveSpawningDone && G.zombies.length === 0) {
      G.phase = "won";
      G.message = "🌻 You held the line! VICTORY!";
    }

    // Status message (only if still playing)
    if (G.phase === "playing") {
      if (G.wave === 0) {
        const wait = Math.max(0, Math.ceil(G.nextWaveAt - G.elapsed));
        G.message = `Wave 1 in ${wait}s — plant sunflowers!`;
      } else if (!G.waveSpawningDone) {
        G.message = `Wave ${G.wave} of ${TOTAL_WAVES} — incoming!`;
      } else if (G.zombies.length > 0) {
        G.message = `Wave ${G.wave} of ${TOTAL_WAVES} — clear remaining zombies.`;
      } else if (G.wave < TOTAL_WAVES) {
        const wait = Math.max(0, Math.ceil(G.nextWaveAt - G.elapsed));
        G.message = `Wave ${G.wave + 1} in ${wait}s.`;
      }
    }
  }

  // ============================================================
  //                        ENTITIES
  // ============================================================
  function startWave(n) {
    G.wave = n;
    G.waveSpawningDone = false;
    G.waveSpawnQueue = [];
    const start = G.elapsed + 1.0; // small lead-in
    const duration = 24 + n * 4;
    const count = 2 + n * 2 + (n === TOTAL_WAVES ? 4 : 0); // wave 1=4, 2=6, 3=8, 4=10, 5=16
    for (let i = 0; i < count; i++) {
      const at = start + (i / Math.max(1, count - 1)) * duration;
      const row = Math.floor(Math.random() * ROWS);
      // Type mix by wave
      let type = "basic";
      const r = Math.random();
      if (n >= 4) {
        type = r < 0.34 ? "basic" : r < 0.7 ? "cone" : "bucket";
      } else if (n >= 3) {
        type = r < 0.4 ? "basic" : r < 0.85 ? "cone" : "bucket";
      } else if (n >= 2) {
        type = r < 0.65 ? "basic" : "cone";
      }
      G.waveSpawnQueue.push({ at, type, row });
    }
    // Set next wave to start ~8s after this wave's last spawn (only used after waveSpawningDone)
    G.nextWaveAt = start + duration + 8;
  }

  function spawnZombie(type, row) {
    const def = ZOMBIES[type];
    G.zombies.push({
      type, row,
      x: ZOMBIE_SPAWN_X,
      y: LAWN_Y + row * CELL_H + CELL_H / 2,
      hp: def.hp,
      chilled: 0,
      biteTimer: 0.4,
      eating: false,
    });
  }

  function spawnSkySun() {
    const x = LAWN_X + Math.random() * LAWN_W;
    const targetY = LAWN_Y + 40 + Math.random() * (LAWN_H - 60);
    G.suns.push({
      x, y: HUD_H + 4, targetY,
      vy: 38, value: 25, lifetime: 9, fromSky: true,
    });
  }

  function spawnPlantSun(x, y) {
    G.suns.push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 12,
      targetY: y,
      vy: 0, value: 25, lifetime: 11, fromSky: false,
    });
  }

  function shootPea(plant) {
    G.peas.push({
      row: plant.row,
      x: plant.x + 16,
      y: plant.y - 6,
      prevX: plant.x + 16,
      damage: 20,
      slow: plant.type === "snowpea",
    });
  }

  function cherryExplode(p) {
    // Damage all zombies in 3x3 around plant (cells)
    const r0 = Math.max(0, p.row - 1), r1 = Math.min(ROWS - 1, p.row + 1);
    const c0 = Math.max(0, p.col - 1), c1 = Math.min(COLS - 1, p.col + 1);
    const x0 = LAWN_X + c0 * CELL_W, x1 = LAWN_X + (c1 + 1) * CELL_W;
    for (const z of G.zombies) {
      if (z.row < r0 || z.row > r1) continue;
      if (z.x < x0 || z.x > x1) continue;
      z.hp -= 1800;
    }
    // Visual fx: store an explosion entry for one frame
    G._fx = G._fx || [];
    G._fx.push({ type: "boom", x: p.x, y: p.y, t: 0.4, r0, r1, c0, c1 });
  }

  function plantAtZombie(z) {
    // Plant in same row whose cell the zombie's left edge overlaps
    const zLeft = z.x - 12;
    for (const p of G.plants) {
      if (p.row !== z.row) continue;
      const pLeft = LAWN_X + p.col * CELL_W;
      const pRight = pLeft + CELL_W;
      if (zLeft < pRight && z.x > pLeft) return p;
    }
    return null;
  }

  // ============================================================
  //                        INPUT
  // ============================================================
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function onMouseMove(e) {
    const p = getMousePos(e);
    G.mouseX = p.x; G.mouseY = p.y;
    G.mouseIn = true;
  }

  function onMouseLeave() { G.mouseIn = false; }

  function onCanvasClick(e) {
    if (G.phase !== "playing") return;
    const p = getMousePos(e);

    // 1. HUD interactions (top bar)
    if (p.y < HUD_H) {
      // Sun counter — no action
      // Seed packets
      const packetX0 = 90;
      for (let i = 0; i < PLANT_KEYS.length; i++) {
        const px = packetX0 + i * 64;
        const py = 6;
        if (p.x >= px && p.x < px + 58 && p.y >= py && p.y < py + 58) {
          selectSeed(PLANT_KEYS[i]);
          return;
        }
      }
      // Shovel
      const shovelX = packetX0 + PLANT_KEYS.length * 64 + 12;
      if (p.x >= shovelX && p.x < shovelX + 50 && p.y >= 6 && p.y < 64) {
        G.shovel = !G.shovel;
        G.selected = null;
        return;
      }
      return;
    }

    // 2. Sun collection (priority inside playfield)
    for (let i = G.suns.length - 1; i >= 0; i--) {
      const s = G.suns[i];
      const dx = p.x - s.x, dy = p.y - s.y;
      if (dx * dx + dy * dy < 19 * 19) {
        G.sun += s.value;
        G.suns.splice(i, 1);
        return;
      }
    }

    // 3. Lawn cell interactions
    if (p.x < LAWN_X || p.x >= LAWN_X + LAWN_W || p.y < LAWN_Y || p.y >= LAWN_Y + LAWN_H) return;
    const col = Math.floor((p.x - LAWN_X) / CELL_W);
    const row = Math.floor((p.y - LAWN_Y) / CELL_H);

    if (G.shovel) {
      const existing = G.plants.find(pp => pp.row === row && pp.col === col);
      if (existing) {
        existing.hp = 0;
      }
      G.shovel = false;
      return;
    }

    if (!G.selected) return;
    const def = PLANTS[G.selected];
    if (G.cooldowns[G.selected] && G.cooldowns[G.selected] > 0) return;
    if (G.sun < def.cost) return;
    const exists = G.plants.find(pp => pp.row === row && pp.col === col);
    if (exists) return;

    placePlant(G.selected, row, col);
    G.sun -= def.cost;
    G.cooldowns[G.selected] = def.cool;
    G.selected = null;
  }

  function selectSeed(type) {
    G.shovel = false;
    const def = PLANTS[type];
    if (G.cooldowns[type] && G.cooldowns[type] > 0) return;
    if (G.sun < def.cost) return;
    G.selected = G.selected === type ? null : type;
  }

  function placePlant(type, row, col) {
    const def = PLANTS[type];
    const x = LAWN_X + col * CELL_W + CELL_W / 2;
    const y = LAWN_Y + row * CELL_H + CELL_H / 2;
    const p = {
      type, row, col, x, y,
      hp: def.hp,
      actionTimer: def.action,
      produceTimer: def.produce ? def.produce : null,
      invulnerable: type === "cherry", // cherry can't be eaten before exploding
    };
    if (type === "cherry") {
      p.actionTimer = def.action; // explosion delay
    }
    G.plants.push(p);
  }

  // ============================================================
  //                        RENDER
  // ============================================================
  function render() {
    if (!ctx) return;
    // Sky
    ctx.fillStyle = "#8bbd5a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // HUD background
    ctx.fillStyle = "#3a2510";
    ctx.fillRect(0, 0, CANVAS_W, HUD_H);

    // Sun counter
    drawSunIcon(28, HUD_H / 2, 14);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px 'Press Start 2P', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(G.sun), 50, HUD_H / 2);

    // Seed packets
    const packetX0 = 90;
    for (let i = 0; i < PLANT_KEYS.length; i++) {
      const key = PLANT_KEYS[i];
      drawSeedPacket(packetX0 + i * 64, 6, 58, 58, key);
    }
    // Shovel
    const shovelX = packetX0 + PLANT_KEYS.length * 64 + 12;
    drawShovelIcon(shovelX, 6, 50, 58);

    // Status message
    ctx.fillStyle = "#ffd641";
    ctx.font = "12px 'VT323', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(G.message, CANVAS_W - 8, HUD_H - 12);

    // Lawn cells (alternating greens)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = LAWN_X + c * CELL_W;
        const y = LAWN_Y + r * CELL_H;
        ctx.fillStyle = (r + c) % 2 === 0 ? "#6ea64a" : "#5a9036";
        ctx.fillRect(x, y, CELL_W, CELL_H);
      }
    }
    // Lawn border
    ctx.strokeStyle = "#3a2510";
    ctx.lineWidth = 2;
    ctx.strokeRect(LAWN_X, LAWN_Y, LAWN_W, LAWN_H);

    // Mowers
    for (let r = 0; r < ROWS; r++) {
      const m = G.mowers[r];
      if (!m.alive) continue;
      const y = LAWN_Y + r * CELL_H + CELL_H / 2;
      drawMower(m.x, y);
    }

    // Plants
    for (const p of G.plants) drawPlant(p);

    // Zombies
    for (const z of G.zombies) drawZombie(z);

    // Peas
    for (const pea of G.peas) {
      ctx.fillStyle = pea.slow ? "#9fdcff" : "#aaf082";
      ctx.beginPath();
      ctx.arc(pea.x, pea.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // Suns
    for (const s of G.suns) drawSun(s);

    // Explosion FX
    if (G._fx && G._fx.length > 0) {
      const next = [];
      for (const fx of G._fx) {
        if (fx.type === "boom") {
          const alpha = Math.max(0, fx.t / 0.4);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#ff4020";
          const gx = LAWN_X + fx.c0 * CELL_W;
          const gy = LAWN_Y + fx.r0 * CELL_H;
          const gw = (fx.c1 - fx.c0 + 1) * CELL_W;
          const gh = (fx.r1 - fx.r0 + 1) * CELL_H;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, Math.max(gw, gh) * 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          fx.t -= 1 / 60;
          if (fx.t > 0) next.push(fx);
        }
      }
      G._fx = next;
    }

    // Mouse-hover placement preview (ghost plant)
    if (G.selected && G.mouseIn && G.mouseY >= LAWN_Y && G.mouseY < LAWN_Y + LAWN_H &&
        G.mouseX >= LAWN_X && G.mouseX < LAWN_X + LAWN_W) {
      const col = Math.floor((G.mouseX - LAWN_X) / CELL_W);
      const row = Math.floor((G.mouseY - LAWN_Y) / CELL_H);
      const x = LAWN_X + col * CELL_W + CELL_W / 2;
      const y = LAWN_Y + row * CELL_H + CELL_H / 2;
      const occupied = G.plants.find(pp => pp.row === row && pp.col === col);
      ctx.globalAlpha = 0.45;
      const fake = { type: G.selected, x, y, row, col, hp: PLANTS[G.selected].hp };
      drawPlant(fake);
      ctx.globalAlpha = 1;
      // Cell highlight
      ctx.strokeStyle = occupied ? "#c11818" : "#ffd641";
      ctx.lineWidth = 2;
      ctx.strokeRect(LAWN_X + col * CELL_W + 1, LAWN_Y + row * CELL_H + 1, CELL_W - 2, CELL_H - 2);
    }
    // Shovel hover
    if (G.shovel && G.mouseIn && G.mouseY >= LAWN_Y && G.mouseY < LAWN_Y + LAWN_H &&
        G.mouseX >= LAWN_X && G.mouseX < LAWN_X + LAWN_W) {
      const col = Math.floor((G.mouseX - LAWN_X) / CELL_W);
      const row = Math.floor((G.mouseY - LAWN_Y) / CELL_H);
      ctx.strokeStyle = "#ff9020";
      ctx.lineWidth = 2;
      ctx.strokeRect(LAWN_X + col * CELL_W + 1, LAWN_Y + row * CELL_H + 1, CELL_W - 2, CELL_H - 2);
    }

    // End-of-game overlay
    if (G.phase !== "playing") {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, HUD_H, CANVAS_W, CANVAS_H - HUD_H);
      ctx.fillStyle = G.phase === "won" ? "#ffd641" : "#ff5040";
      ctx.font = "bold 32px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(G.phase === "won" ? "VICTORY!" : "GAME OVER", CANVAS_W / 2, CANVAS_H / 2 - 16);
      ctx.font = "16px 'VT323', monospace";
      ctx.fillStyle = "#fff";
      ctx.fillText("Click NEW GAME to play again", CANVAS_W / 2, CANVAS_H / 2 + 22);
    }
  }

  function drawSeedPacket(x, y, w, h, key) {
    const def = PLANTS[key];
    const cd = G.cooldowns[key] || 0;
    const affordable = G.sun >= def.cost;
    const selected = G.selected === key;
    // Packet body
    ctx.fillStyle = affordable && cd === 0 ? "#caa67a" : "#7a6045";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = selected ? "#ffd641" : "#3a2510";
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeRect(x, y, w, h);
    // Plant icon
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 - 6);
    ctx.scale(0.55, 0.55);
    const fake = { type: key, x: 0, y: 0, row: 0, col: 0, hp: def.hp };
    drawPlant(fake, true);
    ctx.restore();
    // Cost
    ctx.fillStyle = affordable ? "#fff" : "#c11818";
    ctx.font = "bold 11px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(def.cost), x + w / 2, y + h - 9);
    // Cooldown overlay
    if (cd > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const ch = h * (cd / def.cool);
      ctx.fillRect(x, y + h - ch, w, ch);
    }
  }

  function drawShovelIcon(x, y, w, h) {
    ctx.fillStyle = G.shovel ? "#caa67a" : "#7a6045";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = G.shovel ? "#ffd641" : "#3a2510";
    ctx.lineWidth = G.shovel ? 3 : 1.5;
    ctx.strokeRect(x, y, w, h);
    // Shovel glyph
    ctx.fillStyle = "#dcdcdc";
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 8, y + h - 12);
    ctx.lineTo(x + w / 2 + 8, y + h - 12);
    ctx.lineTo(x + w / 2 + 6, y + h - 4);
    ctx.lineTo(x + w / 2 - 6, y + h - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "#bb8855";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h - 12);
    ctx.lineTo(x + w / 2, y + 10);
    ctx.stroke();
  }

  function drawSunIcon(x, y, r) {
    ctx.fillStyle = "#ffd641";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Rays
    ctx.strokeStyle = "#ffb000";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
      ctx.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
      ctx.stroke();
    }
  }

  function drawSun(s) {
    const alpha = Math.min(1, s.lifetime / 2);
    ctx.globalAlpha = alpha;
    drawSunIcon(s.x, s.y, 14);
    ctx.globalAlpha = 1;
  }

  function drawPlant(p, isIcon) {
    const x = p.x, y = p.y;
    if (p.type === "sunflower") {
      // Petals
      ctx.fillStyle = "#f1c40f";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 8, 5, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // Center
      ctx.fillStyle = "#8a5a1a";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      // Stem
      if (!isIcon) {
        ctx.strokeStyle = "#3a7020";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x, y + 22);
        ctx.stroke();
      }
    } else if (p.type === "peashooter" || p.type === "snowpea") {
      const isSnow = p.type === "snowpea";
      const headColor = isSnow ? "#3498db" : "#27ae60";
      const lightColor = isSnow ? "#85d6ff" : "#52d678";
      // Stem
      if (!isIcon) {
        ctx.strokeStyle = "#3a7020";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 3, y + 20);
        ctx.lineTo(x - 3, y - 2);
        ctx.stroke();
        // Leaves
        ctx.fillStyle = "#3a7020";
        ctx.beginPath();
        ctx.ellipse(x - 12, y + 8, 7, 4, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Head
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(x + 2, y - 4, 14, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.arc(x - 2, y - 8, 4, 0, Math.PI * 2);
      ctx.fill();
      // Mouth / barrel
      ctx.fillStyle = "#1a4a18";
      ctx.fillRect(x + 14, y - 6, 6, 5);
      // Eye
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x + 5, y - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(x + 6, y - 5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "wallnut") {
      ctx.fillStyle = "#a0522d";
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6e3618";
      ctx.beginPath();
      ctx.arc(x - 5, y - 5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 5, y - 5, 4, 0, Math.PI * 2);
      ctx.fill();
      // Mouth (smile)
      ctx.strokeStyle = "#6e3618";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y + 3, 5, 0, Math.PI);
      ctx.stroke();
      // HP overlay
      if (p.hp < PLANTS.wallnut.hp * 0.66) {
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 12, y - 8);
        ctx.lineTo(x - 4, y + 4);
        ctx.moveTo(x + 6, y - 10);
        ctx.lineTo(x + 14, y + 2);
        ctx.stroke();
      }
    } else if (p.type === "cherry") {
      // Two cherries
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.arc(x - 7, y + 2, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 7, y + 2, 11, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = "#ff7060";
      ctx.beginPath();
      ctx.arc(x - 10, y - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 4, y - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      // Stem
      ctx.strokeStyle = "#3a7020";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 6);
      ctx.lineTo(x, y - 16);
      ctx.lineTo(x + 5, y - 6);
      ctx.stroke();
      // Eyes (angry)
      if (!isIcon) {
        ctx.fillStyle = "#000";
        ctx.fillRect(x - 9, y - 1, 2, 4);
        ctx.fillRect(x + 6, y - 1, 2, 4);
      }
    }
  }

  function drawZombie(z) {
    const x = z.x, y = z.y;
    const isChilled = z.chilled > 0;
    // Body
    ctx.fillStyle = isChilled ? "#95a5b5" : "#7a8770";
    ctx.fillRect(x - 10, y - 4, 20, 22);
    // Head
    ctx.fillStyle = isChilled ? "#a5b5c5" : "#94a386";
    ctx.beginPath();
    ctx.arc(x, y - 14, 11, 0, Math.PI * 2);
    ctx.fill();
    // Eyes (red)
    ctx.fillStyle = "#c11818";
    ctx.fillRect(x - 5, y - 15, 3, 3);
    ctx.fillRect(x + 2, y - 15, 3, 3);
    // Mouth
    ctx.fillStyle = "#3a0505";
    ctx.fillRect(x - 6, y - 10, 12, 3);
    // Eating animation: open mouth
    if (z.eating) {
      ctx.fillStyle = "#000";
      ctx.fillRect(x - 5, y - 11, 10, 5);
    }
    // Arms
    ctx.strokeStyle = isChilled ? "#a5b5c5" : "#94a386";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 2);
    ctx.lineTo(x - 18, y + 4);
    ctx.moveTo(x + 10, y + 2);
    ctx.lineTo(x + 18, y + 4);
    ctx.stroke();
    // Hat
    if (z.type === "cone") {
      ctx.fillStyle = "#e67e22";
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 22);
      ctx.lineTo(x + 9, y - 22);
      ctx.lineTo(x, y - 36);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#3a2510";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (z.type === "bucket") {
      ctx.fillStyle = "#aaa";
      ctx.fillRect(x - 10, y - 30, 20, 12);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 10, y - 30, 20, 12);
      ctx.beginPath();
      ctx.arc(x - 13, y - 24, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 13, y - 24, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // HP bar
    const def = ZOMBIES[z.type];
    if (z.hp < def.hp) {
      const w = 24;
      ctx.fillStyle = "#3a0505";
      ctx.fillRect(x - w/2, y - 30, w, 3);
      ctx.fillStyle = "#27ae60";
      ctx.fillRect(x - w/2, y - 30, w * (z.hp / def.hp), 3);
    }
  }

  function drawMower(x, y) {
    ctx.fillStyle = "#c11818";
    ctx.fillRect(x - 12, y - 8, 24, 16);
    ctx.strokeStyle = "#3a0505";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 12, y - 8, 24, 16);
    // Blade
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(x + 8, y, 5, 0, Math.PI * 2);
    ctx.fill();
    // Wheels
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(x - 8, y + 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 8, y + 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ============================================================
  //                        WIRING
  // ============================================================
  function init(mount) {
    mountRef = mount;
    gameVersion++;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>PLANTS vs ZOMBIES</h2>
      <canvas id="pvz-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
        <button class="mg-btn" id="pvz-new">New Game</button>
      </div>
      <div class="mg-controls-help">Click a seed packet, then click a lawn cell to plant · Click suns to collect · Shovel removes plants · Survive 5 waves</div>
    `;
    mount.appendChild(wrap);
    injectStyles();
    canvas = document.getElementById("pvz-canvas");
    ctx = canvas.getContext("2d");
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("click", onCanvasClick);
    document.getElementById("pvz-new").addEventListener("click", startNewGame);
    startNewGame();
  }

  function onHide() {
    gameVersion++;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    mountRef = null;
  }

  function injectStyles() {
    if (document.getElementById("pvz-styles")) return;
    const s = document.createElement("style");
    s.id = "pvz-styles";
    s.textContent = `
      .mini-game #pvz-canvas {
        background: #8bbd5a;
        border: 3px solid #5a3a1a;
        border-radius: 8px;
        box-shadow: 0 0 24px rgba(0,0,0,0.5), inset 0 0 30px rgba(0,0,0,0.2);
        max-width: 100%;
        height: auto;
        cursor: pointer;
        image-rendering: auto;
      }
    `;
    document.head.appendChild(s);
  }

  Arcade.register({
    id: "pvz",
    name: "Plants vs Zombies",
    icon: "🌻🧟",
    color: "#27ae60",
    tag: "TOWER",
    order: 11,
    init,
    onHide,
  });
})();
