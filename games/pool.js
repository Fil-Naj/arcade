// 8-Ball Pool - heads-up vs CPU with real(-ish) 2D ball physics.
(function () {
  "use strict";

  // ============================================================
  //                        CONSTANTS
  // ============================================================
  const CANVAS_W = 720, CANVAS_H = 380;
  const CUSHION = 22;                       // inset from canvas edge to playing surface
  const FELT = { x0: CUSHION, y0: CUSHION, x1: CANVAS_W - CUSHION, y1: CANVAS_H - CUSHION };
  const BALL_R = 9.5;
  const POCKET_R = 17;
  // Physics tuned for a smoother roll-out and bouncier cushions.
  const FRICTION = 0.992;                   // per-frame velocity multiplier — gentler decay
  const CUSHION_DAMPING = 0.86;             // bouncier than felt would be IRL — feels nicer
  const MIN_SPEED = 0.025;                  // lower threshold = balls roll longer before snapping to rest
  const MAX_IMPULSE = 22;
  const SUBSTEPS = 12;                      // more substeps = less jitter on close contacts and faster shots
  const FRICTION_PER_SUBSTEP = Math.pow(FRICTION, 1 / SUBSTEPS); // applied each substep for smoother decay

  // Six pockets: 4 corners + 2 middle (top/bottom mid-line)
  const POCKETS = [
    { x: FELT.x0, y: FELT.y0 },
    { x: FELT.x1, y: FELT.y0 },
    { x: FELT.x0, y: FELT.y1 },
    { x: FELT.x1, y: FELT.y1 },
    { x: (FELT.x0 + FELT.x1) / 2, y: FELT.y0 - 2 },
    { x: (FELT.x0 + FELT.x1) / 2, y: FELT.y1 + 2 },
  ];

  const KITCHEN_X = FELT.x0 + (FELT.x1 - FELT.x0) * 0.25; // kitchen-line x
  const HEAD_SPOT = { x: KITCHEN_X * 0.55 + FELT.x0 * 0.45, y: (FELT.y0 + FELT.y1) / 2 };
  const FOOT_SPOT = { x: FELT.x0 + (FELT.x1 - FELT.x0) * 0.72, y: (FELT.y0 + FELT.y1) / 2 };

  // Ball colors (solids 1-7, then 8, then stripes 9-15)
  const BALL_COLORS = {
    0: "#fafafa", // cue
    1: "#f1c40f", // yellow solid
    2: "#2980b9", // blue solid
    3: "#c0392b", // red solid
    4: "#8e44ad", // purple solid
    5: "#e67e22", // orange solid
    6: "#27ae60", // green solid
    7: "#7b1f1f", // maroon solid
    8: "#111111", // black
    9: "#f1c40f",
    10: "#2980b9",
    11: "#c0392b",
    12: "#8e44ad",
    13: "#e67e22",
    14: "#27ae60",
    15: "#7b1f1f",
  };

  // ============================================================
  //                        STATE
  // ============================================================
  let G;
  let mountRef = null;
  let canvas, ctx, controlsDiv;
  let rafId = null;
  let gameVersion = 0;

  function newState() {
    return {
      balls: [],            // [{ num, x, y, vx, vy, r, pocketed, sunkThisShot }]
      groups: { player: null, cpu: null }, // "solids" | "stripes" | null (open)
      turn: "player",       // "player" | "cpu"
      phase: "aiming",      // "aiming" | "shooting" | "placing" | "ended"
      ballInHand: false,
      kitchenOnly: true,    // true on break or after some scratch rules (we use it after scratch too)
      message: "Break!",
      shotFirstHit: null,   // ball number of first non-cue ball touched this shot
      pocketEvents: [],     // [{num, t}] chronological list of balls pocketed this shot
      winner: null,
      // Aim state
      aimX: 0, aimY: 0,
      power: 50,
      mouseInCanvas: false,
      // Animation timing
      stoppedFrames: 0,
    };
  }

  function rackBalls() {
    const balls = [];
    // Cue ball at head spot
    balls.push({ num: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, vx: 0, vy: 0, r: BALL_R, pocketed: false, sunkThisShot: false });

    // Rack triangle at foot spot. 5 rows: 1, 2, 3, 4, 5 balls. 8-ball in center of 3rd row.
    // Apex points toward the player (kitchen side).
    // Standard 8-ball rack: corners must be one solid and one stripe; 8 in middle.
    const rackOrder = [
      1,                    // apex (row 0)
      14, 2,                // row 1
      3, 8, 11,             // row 2 (middle = 8)
      4, 13, 7, 12,         // row 3
      6, 10, 5, 15, 9,      // row 4 (back row; corners 6 and 9 — one solid, one stripe)
    ];
    const dx = BALL_R * Math.sqrt(3) + 0.4;
    const dy = BALL_R + 0.4;
    let idx = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        const x = FOOT_SPOT.x + row * dx;
        const y = FOOT_SPOT.y + (col - row / 2) * 2 * dy;
        balls.push({ num: rackOrder[idx++], x, y, vx: 0, vy: 0, r: BALL_R, pocketed: false, sunkThisShot: false });
      }
    }
    return balls;
  }

  function startNewGame() {
    gameVersion++;
    G = newState();
    G.balls = rackBalls();
    G.turn = "player";
    G.phase = "aiming";
    G.kitchenOnly = true;
    G.message = "Your break — drag in the kitchen to aim, then SHOOT.";
    G.ballInHand = true;
    render();
  }

  // ============================================================
  //                        PHYSICS
  // ============================================================
  function stepPhysics() {
    // Substep loop
    for (let s = 0; s < SUBSTEPS; s++) {
      // 1. Integrate positions
      for (const b of G.balls) {
        if (b.pocketed) continue;
        b.x += b.vx / SUBSTEPS;
        b.y += b.vy / SUBSTEPS;
      }
      // 2. Pocket detection (before cushion to avoid bouncing off a near-pocket cushion)
      for (const b of G.balls) {
        if (b.pocketed) continue;
        for (const p of POCKETS) {
          const dx = b.x - p.x, dy = b.y - p.y;
          if (dx * dx + dy * dy <= POCKET_R * POCKET_R) {
            b.pocketed = true;
            b.sunkThisShot = true;
            b.vx = 0; b.vy = 0;
            G.pocketEvents.push({ num: b.num, t: performance.now() });
            break;
          }
        }
      }
      // 3. Cushion reflection — only when moving INTO the wall
      for (const b of G.balls) {
        if (b.pocketed) continue;
        // Skip cushion near pocket mouths (within POCKET_R of any pocket on the wall line)
        const nearPocket = POCKETS.some(p => {
          const dx = b.x - p.x, dy = b.y - p.y;
          return dx * dx + dy * dy < (POCKET_R + b.r) * (POCKET_R + b.r);
        });
        if (nearPocket) continue;
        if (b.x - b.r < FELT.x0 && b.vx < 0) {
          b.x = FELT.x0 + b.r;
          b.vx = -b.vx * CUSHION_DAMPING;
        } else if (b.x + b.r > FELT.x1 && b.vx > 0) {
          b.x = FELT.x1 - b.r;
          b.vx = -b.vx * CUSHION_DAMPING;
        }
        if (b.y - b.r < FELT.y0 && b.vy < 0) {
          b.y = FELT.y0 + b.r;
          b.vy = -b.vy * CUSHION_DAMPING;
        } else if (b.y + b.r > FELT.y1 && b.vy > 0) {
          b.y = FELT.y1 - b.r;
          b.vy = -b.vy * CUSHION_DAMPING;
        }
      }
      // 4. Ball-ball collisions
      for (let i = 0; i < G.balls.length; i++) {
        const a = G.balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < G.balls.length; j++) {
          const b = G.balls[j];
          if (b.pocketed) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const minDist = a.r + b.r;
          let distSq = dx * dx + dy * dy;
          if (distSq < minDist * minDist) {
            let dist = Math.sqrt(distSq);
            // Zero-distance guard
            if (dist < 0.0001) {
              dx = 1; dy = 0; dist = 1;
            }
            const nx = dx / dist;
            const ny = dy / dist;
            // Position correction: split overlap equally
            const overlap = (minDist - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            // Relative velocity along normal (a→b direction)
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const relNorm = rvx * nx + rvy * ny;
            // Only resolve if approaching (relNorm < 0 means b moving toward a)
            if (relNorm < 0) {
              // Equal mass, elastic: swap normal components
              const impulse = -relNorm; // magnitude transferred
              a.vx -= impulse * nx;
              a.vy -= impulse * ny;
              b.vx += impulse * nx;
              b.vy += impulse * ny;
              // First-ball-hit tracking
              if (G.shotFirstHit === null) {
                if (a.num === 0 && b.num !== 0) G.shotFirstHit = b.num;
                else if (b.num === 0 && a.num !== 0) G.shotFirstHit = a.num;
              }
            }
          }
        }
      }
      // 5. Friction — applied per substep (12 small decays per frame ≈ smoother
      // motion than one big multiplication at frame end).
      for (const b of G.balls) {
        if (b.pocketed) continue;
        b.vx *= FRICTION_PER_SUBSTEP;
        b.vy *= FRICTION_PER_SUBSTEP;
      }
    }
    // 6. Snap to rest below threshold (post-substeps so the slow tail looks smooth)
    for (const b of G.balls) {
      if (b.pocketed) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < MIN_SPEED) {
        b.vx = 0; b.vy = 0;
      }
    }
  }

  function allBallsStopped() {
    for (const b of G.balls) {
      if (b.pocketed) continue;
      if (b.vx !== 0 || b.vy !== 0) return false;
    }
    return true;
  }

  // ============================================================
  //                        TURN LOGIC
  // ============================================================
  function endShot() {
    // Evaluate the shot that just completed.
    const cue = G.balls[0];
    const scratched = cue.pocketed;
    const sunkThisShot = G.pocketEvents.slice(); // chronological
    const sunkNonCue = sunkThisShot.filter(e => e.num !== 0);

    // Did anyone sink the 8-ball?
    const sunk8 = sunkNonCue.some(e => e.num === 8);

    const me = G.turn;
    const opp = me === "player" ? "cpu" : "player";

    // Determine if first-ball-hit was legal
    let firstHitLegal = false;
    let foulReason = null;
    if (G.shotFirstHit === null) {
      foulReason = "no ball was hit";
    } else if (scratched) {
      foulReason = "cue ball scratched";
    } else {
      const firstBall = G.shotFirstHit;
      const myGroup = G.groups[me];
      const myGroupCleared = myGroup ? !ballsOnTable(myGroup === "solids" ? solidNums() : stripeNums()).length : false;
      if (firstBall === 8) {
        // 8 first is legal only if my group is cleared
        if (myGroup && myGroupCleared) firstHitLegal = true;
        else foulReason = "hit the 8-ball before clearing your group";
      } else {
        if (myGroup === null) {
          firstHitLegal = true; // open table; any non-8 ball is legal
        } else {
          const firstIsMine = (myGroup === "solids" && firstBall >= 1 && firstBall <= 7) ||
                              (myGroup === "stripes" && firstBall >= 9 && firstBall <= 15);
          if (firstIsMine) firstHitLegal = true;
          else foulReason = `hit opponent's ball first (${labelGroup(myGroup === "solids" ? "stripes" : "solids")})`;
        }
      }
    }

    // 8-ball game-ending evaluation
    if (sunk8) {
      const myGroup = G.groups[me];
      // Recompute "group cleared" using pre-shot state? In casual mode, check after the shot:
      // legal 8-ball pocket requires no own group balls remain on the table AFTER this shot.
      const myCleared = myGroup
        ? !ballsOnTable(myGroup === "solids" ? solidNums() : stripeNums()).length
        : false;
      const legalWin = !scratched && firstHitLegal && myGroup !== null && myCleared;
      if (legalWin) {
        G.winner = me;
        G.phase = "ended";
        G.message = me === "player"
          ? "🎱 You sank the 8-ball legally — YOU WIN!"
          : "🎱 CPU sank the 8-ball legally — CPU WINS.";
        render();
        return;
      } else {
        // Loss
        G.winner = opp;
        G.phase = "ended";
        if (myGroup === null) G.message = `${labelP(me)} sank the 8-ball on the break/open table — ${labelP(opp)} WINS.`;
        else if (scratched) G.message = `${labelP(me)} scratched while sinking the 8-ball — ${labelP(opp)} WINS.`;
        else G.message = `${labelP(me)} sank the 8-ball early — ${labelP(opp)} WINS.`;
        render();
        return;
      }
    }

    // Group assignment on open table (only if first hit was legal AND a non-8 ball was sunk this shot)
    if (G.groups[me] === null && firstHitLegal && sunkNonCue.length > 0 && !scratched) {
      // Use FIRST pocketed non-8 to assign
      const firstSunk = sunkNonCue.find(e => e.num !== 8);
      if (firstSunk) {
        const group = (firstSunk.num >= 1 && firstSunk.num <= 7) ? "solids" : "stripes";
        G.groups[me] = group;
        G.groups[opp] = group === "solids" ? "stripes" : "solids";
      }
    }

    // Foul handling: cue scratch OR illegal first hit
    if (scratched || foulReason) {
      G.message = `${labelP(me)}: foul — ${foulReason || "scratch"}. ${labelP(opp)} gets ball-in-hand.`;
      // Reset cue ball if scratched
      if (scratched) {
        cue.pocketed = false;
        cue.sunkThisShot = false;
        // Place safely; opponent will reposition
        cue.x = HEAD_SPOT.x;
        cue.y = HEAD_SPOT.y;
        cue.vx = 0; cue.vy = 0;
      }
      G.turn = opp;
      G.ballInHand = true;
      G.kitchenOnly = false; // ball-in-hand mid-game can be anywhere; only break starts in kitchen
      // Clear sunkThisShot flags
      for (const b of G.balls) b.sunkThisShot = false;
      G.pocketEvents = [];
      G.shotFirstHit = null;
      G.phase = "aiming";
      render();
      if (G.turn === "cpu") scheduleCpuTurn();
      return;
    }

    // No foul: did the shooter pocket one of their own?
    let pocketedOwn = false;
    const myGroup = G.groups[me];
    if (myGroup !== null) {
      const myNums = myGroup === "solids" ? solidNums() : stripeNums();
      pocketedOwn = sunkNonCue.some(e => myNums.includes(e.num));
    } else {
      // open table: any non-8 pocket continues turn
      pocketedOwn = sunkNonCue.some(e => e.num !== 8);
    }

    // Clear shot flags
    for (const b of G.balls) b.sunkThisShot = false;
    G.pocketEvents = [];
    G.shotFirstHit = null;
    G.kitchenOnly = false; // after first legal shot, no kitchen restriction

    if (pocketedOwn) {
      G.message = `${labelP(me)} pocketed a ball — continue.`;
    } else {
      G.turn = opp;
      G.message = `${labelP(me)} missed. ${labelP(opp)}'s turn.`;
    }
    G.phase = "aiming";
    render();
    if (G.turn === "cpu" && G.phase !== "ended") scheduleCpuTurn();
  }

  function labelP(who) { return who === "player" ? "You" : "CPU"; }
  function labelGroup(g) { return g === "solids" ? "Solids" : "Stripes"; }
  function solidNums() { return [1, 2, 3, 4, 5, 6, 7]; }
  function stripeNums() { return [9, 10, 11, 12, 13, 14, 15]; }
  function ballsOnTable(nums) {
    return G.balls.filter(b => !b.pocketed && nums.includes(b.num));
  }
  function ballByNum(n) { return G.balls.find(b => b.num === n); }

  // ============================================================
  //                        SHOOTING
  // ============================================================
  function shoot() {
    if (G.phase !== "aiming") return;
    if (G.turn !== "player") return;
    if (G.ballInHand) return; // must place cue first

    const cue = G.balls[0];
    if (cue.pocketed) return;
    const dx = G.aimX - cue.x;
    const dy = G.aimY - cue.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const speed = MAX_IMPULSE * (G.power / 100);
    cue.vx = (dx / d) * speed;
    cue.vy = (dy / d) * speed;
    G.shotFirstHit = null;
    G.pocketEvents = [];
    G.phase = "shooting";
    G.stoppedFrames = 0;
    G.message = `${labelP(G.turn)} shot at ${G.power}% power.`;
    startAnimation();
  }

  function startAnimation() {
    const my = gameVersion;
    if (rafId) cancelAnimationFrame(rafId);
    function loop() {
      if (my !== gameVersion) return;
      if (!mountRef || !document.body.contains(mountRef)) return;
      stepPhysics();
      if (allBallsStopped()) {
        G.stoppedFrames++;
        if (G.stoppedFrames >= 2) {
          // Re-check; ensure no late chain reactions
          rafId = null;
          endShot();
          return;
        }
      } else {
        G.stoppedFrames = 0;
      }
      render();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  // ============================================================
  //                        AI
  // ============================================================
  function scheduleCpuTurn() {
    const my = gameVersion;
    setTimeout(() => {
      if (my !== gameVersion) return;
      if (!mountRef || !document.body.contains(mountRef)) return;
      if (G.phase !== "aiming" || G.turn !== "cpu") return;
      cpuTakeShot();
    }, 700);
  }

  function cpuTakeShot() {
    // If ball-in-hand, place cue ball at best location
    if (G.ballInHand) {
      const best = findBestShot(true);
      if (best && best.cuePos) {
        G.balls[0].x = best.cuePos.x;
        G.balls[0].y = best.cuePos.y;
      }
      G.ballInHand = false;
    }
    const cue = G.balls[0];
    const best = findBestShot(false);
    let aim, power;
    if (best) {
      aim = best.aimAngle;
      power = best.power;
    } else {
      // No legal shot — gentle nudge at nearest own ball
      const fallback = fallbackShot();
      aim = fallback.angle;
      power = fallback.power;
    }
    // Small noise
    aim += (Math.random() - 0.5) * 0.05;
    G.aimX = cue.x + Math.cos(aim) * 100;
    G.aimY = cue.y + Math.sin(aim) * 100;
    G.power = Math.max(15, Math.min(100, power));
    // Fire after brief delay so player sees the aim line
    render();
    setTimeout(() => {
      if (G.turn !== "cpu" || G.phase !== "aiming") return;
      // Trigger CPU shoot directly (player guard bypassed)
      cpuFire();
    }, 400);
  }

  function cpuFire() {
    const cue = G.balls[0];
    if (cue.pocketed) return;
    const dx = G.aimX - cue.x;
    const dy = G.aimY - cue.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const speed = MAX_IMPULSE * (G.power / 100);
    cue.vx = (dx / d) * speed;
    cue.vy = (dy / d) * speed;
    G.shotFirstHit = null;
    G.pocketEvents = [];
    G.phase = "shooting";
    G.stoppedFrames = 0;
    startAnimation();
  }

  function findBestShot(placingCueBall) {
    const cue = G.balls[0];
    const myGroup = G.groups.cpu;
    let candidates;
    if (myGroup === null) {
      // Open table: any non-8
      candidates = G.balls.filter(b => !b.pocketed && b.num !== 0 && b.num !== 8);
    } else {
      const nums = myGroup === "solids" ? solidNums() : stripeNums();
      candidates = G.balls.filter(b => !b.pocketed && nums.includes(b.num));
      // If all own balls are pocketed, target the 8-ball
      if (candidates.length === 0) {
        const eight = ballByNum(8);
        if (eight && !eight.pocketed) candidates = [eight];
      }
    }

    let best = null;
    for (const target of candidates) {
      for (const pocket of POCKETS) {
        // Aim such that cue ball contacts target on the side opposite the pocket
        const pBallDx = pocket.x - target.x;
        const pBallDy = pocket.y - target.y;
        const pBallD = Math.hypot(pBallDx, pBallDy);
        if (pBallD < 1) continue;
        const ux = pBallDx / pBallD;
        const uy = pBallDy / pBallD;
        const contactX = target.x - ux * (target.r * 2);
        const contactY = target.y - uy * (target.r * 2);

        // Cue start position
        const cueX = placingCueBall ? best?.cuePos?.x ?? cue.x : cue.x;
        const cueY = placingCueBall ? best?.cuePos?.y ?? cue.y : cue.y;
        const usedCueX = placingCueBall ? contactX - ux * 80 : cueX;
        const usedCueY = placingCueBall ? contactY - uy * 80 : cueY;
        // Sanitize cue position to table bounds
        const validCue = clampToTable(usedCueX, usedCueY, cue.r);
        if (!validCue) continue;
        if (placingCueBall && overlapsAnyBall(validCue.x, validCue.y, cue.r, [target])) continue;

        const cueToContactDx = contactX - validCue.x;
        const cueToContactDy = contactY - validCue.y;
        const cueToContactD = Math.hypot(cueToContactDx, cueToContactDy);
        if (cueToContactD < 1) continue;

        // Cut angle: dot product of (cue→contact) and (ball→pocket), both normalized
        const cutDot = (cueToContactDx * ux + cueToContactDy * uy) / cueToContactD;
        if (cutDot <= 0.05) continue; // impossible: cue would need to push ball away from pocket

        // Line of sight: cue→contact, must not pass through other balls
        if (segmentBlocked(validCue.x, validCue.y, contactX, contactY, [G.balls[0], target])) continue;
        // Line of sight: target→pocket, must not pass through other balls (excluding target)
        if (segmentBlocked(target.x, target.y, pocket.x, pocket.y, [target])) continue;

        // Score: higher = better
        const distScore = 200 / (1 + cueToContactD + pBallD);
        const angleScore = cutDot * 1.5; // straighter shots better
        const pocketBias = (pocket === POCKETS[4] || pocket === POCKETS[5]) ? 0.9 : 1.0; // side pockets slightly harder
        const score = distScore * angleScore * pocketBias + Math.random() * 0.1;

        // Aim direction (from cue to contact)
        const aimAngle = Math.atan2(cueToContactDy, cueToContactDx);
        // Power scales with combined distance
        const power = Math.min(95, 30 + (cueToContactD + pBallD) * 0.18);

        if (!best || score > best.score) {
          best = {
            score, aimAngle, power,
            target: target.num, pocket,
            cuePos: placingCueBall ? validCue : null,
          };
        }
      }
    }
    return best;
  }

  function fallbackShot() {
    // No legal shot found; aim softly toward any own ball to minimize foul severity
    const cue = G.balls[0];
    const myGroup = G.groups.cpu;
    let targets;
    if (myGroup === null) {
      targets = G.balls.filter(b => !b.pocketed && b.num !== 0 && b.num !== 8);
    } else {
      const nums = myGroup === "solids" ? solidNums() : stripeNums();
      targets = G.balls.filter(b => !b.pocketed && nums.includes(b.num));
      if (targets.length === 0) targets = [ballByNum(8)].filter(Boolean);
    }
    if (targets.length === 0) {
      return { angle: 0, power: 20 };
    }
    let nearest = targets[0], nearD = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - cue.x, t.y - cue.y);
      if (d < nearD) { nearD = d; nearest = t; }
    }
    return { angle: Math.atan2(nearest.y - cue.y, nearest.x - cue.x), power: 30 };
  }

  function clampToTable(x, y, r) {
    const cx = Math.max(FELT.x0 + r + 2, Math.min(FELT.x1 - r - 2, x));
    const cy = Math.max(FELT.y0 + r + 2, Math.min(FELT.y1 - r - 2, y));
    // Avoid pockets
    for (const p of POCKETS) {
      const dx = cx - p.x, dy = cy - p.y;
      if (dx * dx + dy * dy < (POCKET_R + r) * (POCKET_R + r)) return null;
    }
    return { x: cx, y: cy };
  }

  function overlapsAnyBall(x, y, r, excludeList) {
    for (const b of G.balls) {
      if (b.pocketed) continue;
      if (excludeList && excludeList.includes(b)) continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < (b.r + r) * (b.r + r)) return true;
    }
    return false;
  }

  function segmentBlocked(x1, y1, x2, y2, exclude) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) return false;
    const ux = dx / len, uy = dy / len;
    for (const b of G.balls) {
      if (b.pocketed) continue;
      if (exclude && exclude.includes(b)) continue;
      // Project ball onto segment
      const tx = b.x - x1;
      const ty = b.y - y1;
      const t = Math.max(0, Math.min(len, tx * ux + ty * uy));
      const closestX = x1 + ux * t;
      const closestY = y1 + uy * t;
      const ddx = b.x - closestX, ddy = b.y - closestY;
      if (ddx * ddx + ddy * ddy < (b.r * 2) * (b.r * 2)) return true;
    }
    return false;
  }

  // ============================================================
  //                        UI / RENDER
  // ============================================================
  function init(mount) {
    mountRef = mount;
    gameVersion++;
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>8-BALL POOL</h2>
      <div class="hud" id="pool-hud"></div>
      <canvas id="pool-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
      <div class="mg-info" id="pool-info">Loading…</div>
      <div id="pool-controls" class="pool-controls"></div>
      <button class="mg-btn" id="pool-newgame">New Game</button>
      <div class="mg-controls-help">Move mouse to aim · drag power slider · click SHOOT (or canvas) to fire</div>
    `;
    mount.appendChild(wrap);
    injectStyles();
    canvas = document.getElementById("pool-canvas");
    ctx = canvas.getContext("2d");
    controlsDiv = document.getElementById("pool-controls");

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseenter", () => { G.mouseInCanvas = true; render(); });
    canvas.addEventListener("mouseleave", () => { G.mouseInCanvas = false; render(); });
    canvas.addEventListener("click", onCanvasClick);
    document.getElementById("pool-newgame").addEventListener("click", startNewGame);

    startNewGame();
  }

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function onMouseMove(e) {
    const p = getMousePos(e);
    G.aimX = p.x;
    G.aimY = p.y;
    G.mouseInCanvas = true;
    if (G.phase === "aiming" && G.turn === "player") render();
  }

  function onCanvasClick(e) {
    if (G.phase === "ended") return;
    if (G.turn !== "player") return;
    const p = getMousePos(e);
    if (G.ballInHand) {
      const cue = G.balls[0];
      // Validate placement: in-bounds, no overlap, kitchen if break
      let px = p.x, py = p.y;
      if (G.kitchenOnly && px > KITCHEN_X) {
        G.message = "On the break, place the cue ball in the kitchen (left quarter).";
        render(); return;
      }
      // Clamp + check
      px = Math.max(FELT.x0 + cue.r + 2, Math.min(FELT.x1 - cue.r - 2, px));
      py = Math.max(FELT.y0 + cue.r + 2, Math.min(FELT.y1 - cue.r - 2, py));
      if (overlapsAnyBall(px, py, cue.r, [cue])) {
        G.message = "Can't place cue ball overlapping another ball.";
        render(); return;
      }
      cue.x = px; cue.y = py;
      G.ballInHand = false;
      G.message = "Cue placed. Aim and shoot.";
      render();
      return;
    }
    // Otherwise, treat canvas click as "shoot" (mouse position is the aim)
    G.aimX = p.x; G.aimY = p.y;
    shoot();
  }

  function render() {
    if (!G || !ctx) return;
    renderTable();
    renderHud();
    renderControls();
    renderInfo();
  }

  function renderTable() {
    // Table felt
    ctx.fillStyle = "#0e7a3a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Subtle felt texture
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(Math.random() * CANVAS_W, Math.random() * CANVAS_H, 1, 1);
    }
    // Cushions
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(0, 0, CANVAS_W, FELT.y0);
    ctx.fillRect(0, FELT.y1, CANVAS_W, CANVAS_H - FELT.y1);
    ctx.fillRect(0, 0, FELT.x0, CANVAS_H);
    ctx.fillRect(FELT.x1, 0, CANVAS_W - FELT.x1, CANVAS_H);
    // Cushion highlight
    ctx.strokeStyle = "#3a2510";
    ctx.lineWidth = 2;
    ctx.strokeRect(FELT.x0, FELT.y0, FELT.x1 - FELT.x0, FELT.y1 - FELT.y0);

    // Pockets
    for (const p of POCKETS) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Kitchen line (only show during break or ball-in-hand placement on break)
    if (G.kitchenOnly && G.ballInHand) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(KITCHEN_X, FELT.y0);
      ctx.lineTo(KITCHEN_X, FELT.y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Balls
    for (const b of G.balls) {
      if (b.pocketed) continue;
      drawBall(b);
    }

    // Aim line (during player turn, aiming, not ball-in-hand)
    if (G.phase === "aiming" && G.turn === "player" && !G.ballInHand && G.mouseInCanvas) {
      const cue = G.balls[0];
      if (!cue.pocketed) {
        const dx = G.aimX - cue.x, dy = G.aimY - cue.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          const ux = dx / d, uy = dy / d;
          drawAimProjection(cue, ux, uy);
          // Cue stick on the back side, pulled back proportional to power
          const stickLen = 60 + G.power * 0.9;
          const stickGap = 10 + G.power * 0.18;
          ctx.strokeStyle = "#c89860";
          ctx.lineWidth = 5;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(cue.x - ux * stickGap, cue.y - uy * stickGap);
          ctx.lineTo(cue.x - ux * (stickGap + stickLen), cue.y - uy * (stickGap + stickLen));
          ctx.stroke();
          // Cue tip highlight
          ctx.strokeStyle = "#3a2510";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cue.x - ux * stickGap, cue.y - uy * stickGap);
          ctx.lineTo(cue.x - ux * (stickGap + 6), cue.y - uy * (stickGap + 6));
          ctx.stroke();
          ctx.lineCap = "butt";
        }
      }
    }

    // Ball-in-hand cursor preview
    if (G.ballInHand && G.turn === "player" && G.mouseInCanvas) {
      const cue = G.balls[0];
      const px = G.aimX, py = G.aimY;
      const inKitchen = !G.kitchenOnly || px <= KITCHEN_X;
      const ok = inKitchen && !overlapsAnyBall(px, py, cue.r, [cue]) &&
                 px > FELT.x0 + cue.r && px < FELT.x1 - cue.r &&
                 py > FELT.y0 + cue.r && py < FELT.y1 - cue.r;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ok ? "#fff" : "#c11818";
      ctx.beginPath();
      ctx.arc(px, py, cue.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Cast a ray from the cue ball in (ux, uy) and find the first contact: another
  // ball, a cushion, or nothing (off table). Draws the aim line up to that point
  // plus a ghost-ball preview and target trajectory hint when hitting a ball.
  function drawAimProjection(cue, ux, uy) {
    const cueR = cue.r;
    let tMin = Infinity;
    let hit = null; // { type: 'ball'|'cushion', target?, side? }

    // --- Cushions: treat as infinite lines at FELT.x0/x1/y0/y1, offset inward by cueR
    if (ux < 0) {
      const t = (FELT.x0 + cueR - cue.x) / ux;
      if (t > 0 && t < tMin) {
        const y = cue.y + t * uy;
        if (y > FELT.y0 + cueR && y < FELT.y1 - cueR) { tMin = t; hit = { type: "cushion" }; }
      }
    } else if (ux > 0) {
      const t = (FELT.x1 - cueR - cue.x) / ux;
      if (t > 0 && t < tMin) {
        const y = cue.y + t * uy;
        if (y > FELT.y0 + cueR && y < FELT.y1 - cueR) { tMin = t; hit = { type: "cushion" }; }
      }
    }
    if (uy < 0) {
      const t = (FELT.y0 + cueR - cue.y) / uy;
      if (t > 0 && t < tMin) {
        const x = cue.x + t * ux;
        if (x > FELT.x0 + cueR && x < FELT.x1 - cueR) { tMin = t; hit = { type: "cushion" }; }
      }
    } else if (uy > 0) {
      const t = (FELT.y1 - cueR - cue.y) / uy;
      if (t > 0 && t < tMin) {
        const x = cue.x + t * ux;
        if (x > FELT.x0 + cueR && x < FELT.x1 - cueR) { tMin = t; hit = { type: "cushion" }; }
      }
    }

    // --- Balls: solve ray-vs-expanded-circle (radius cueR + targetR) for each
    for (const b of G.balls) {
      if (b.num === 0 || b.pocketed) continue;
      const dx = b.x - cue.x;
      const dy = b.y - cue.y;
      const rSum = cueR + b.r;
      const dDotDir = dx * ux + dy * uy;
      if (dDotDir <= 0) continue; // ball is behind the cue
      const dSq = dx * dx + dy * dy;
      const perpSq = dSq - dDotDir * dDotDir;
      if (perpSq > rSum * rSum) continue; // ray misses
      const back = Math.sqrt(rSum * rSum - perpSq);
      const t = dDotDir - back;
      if (t > 0 && t < tMin) { tMin = t; hit = { type: "ball", target: b }; }
    }

    if (!isFinite(tMin)) {
      // Ray goes off table without hitting anything — just draw a short hint
      tMin = 80;
    }

    const endX = cue.x + tMin * ux;
    const endY = cue.y + tMin * uy;

    // Aim line (dashed yellow)
    ctx.strokeStyle = "#ffd641";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (hit && hit.type === "ball") {
      // Ghost cue ball at the contact position
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(endX, endY, cueR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Predicted target direction: along (target - contact) normalized
      const t = hit.target;
      const tdx = t.x - endX, tdy = t.y - endY;
      const td = Math.hypot(tdx, tdy);
      if (td > 0.0001) {
        const tux = tdx / td, tuy = tdy / td;
        ctx.strokeStyle = "rgba(160,255,160,0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + tux * 90, t.y + tuy * 90);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrowhead
        const ah = 6;
        const px = t.x + tux * 90, py = t.y + tuy * 90;
        ctx.fillStyle = "rgba(160,255,160,0.8)";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - tux * ah - tuy * ah * 0.6, py - tuy * ah + tux * ah * 0.6);
        ctx.lineTo(px - tux * ah + tuy * ah * 0.6, py - tuy * ah - tux * ah * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    } else if (hit && hit.type === "cushion") {
      // Small marker dot at cushion contact
      ctx.fillStyle = "rgba(255, 214, 65, 0.5)";
      ctx.beginPath();
      ctx.arc(endX, endY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBall(b) {
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(b.x + 1, b.y + 2, b.r, 0, Math.PI * 2);
    ctx.fill();
    // Stripe band (for 9-15)
    const isStripe = b.num >= 9 && b.num <= 15;
    const baseColor = BALL_COLORS[b.num];
    // Base ball
    const grad = ctx.createRadialGradient(b.x - b.r / 3, b.y - b.r / 3, b.r / 6, b.x, b.y, b.r);
    if (b.num === 0) {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#bbb");
    } else if (isStripe) {
      grad.addColorStop(0, "#fff");
      grad.addColorStop(1, "#eee");
    } else {
      grad.addColorStop(0, lighten(baseColor, 0.3));
      grad.addColorStop(1, baseColor);
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    if (isStripe) {
      // Draw the stripe band horizontally
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = baseColor;
      ctx.fillRect(b.x - b.r, b.y - b.r * 0.55, b.r * 2, b.r * 1.1);
      ctx.restore();
    }
    // Number circle
    if (b.num !== 0) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = `bold ${Math.max(8, b.r * 0.7)}px 'VT323', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(b.num), b.x, b.y + 1);
    }
    // Outline
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function lighten(hex, amount) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lr = Math.min(255, Math.round(r + (255 - r) * amount));
    const lg = Math.min(255, Math.round(g + (255 - g) * amount));
    const lb = Math.min(255, Math.round(b + (255 - b) * amount));
    return `rgb(${lr},${lg},${lb})`;
  }

  function renderHud() {
    const hud = document.getElementById("pool-hud");
    if (!hud) return;
    const playerGroup = G.groups.player;
    const cpuGroup = G.groups.cpu;
    const sunkPlayer = playerGroup ? 7 - ballsOnTable(playerGroup === "solids" ? solidNums() : stripeNums()).length : 0;
    const sunkCpu = cpuGroup ? 7 - ballsOnTable(cpuGroup === "solids" ? solidNums() : stripeNums()).length : 0;
    hud.innerHTML = `
      <span class="pool-side ${G.turn === "player" ? "active" : ""}">
        YOU <strong>${playerGroup ? `${labelGroup(playerGroup)} ${sunkPlayer}/7` : "Open"}</strong>
      </span>
      <span>TURN <strong>${labelP(G.turn)}</strong></span>
      <span class="pool-side ${G.turn === "cpu" ? "active" : ""}">
        CPU <strong>${cpuGroup ? `${labelGroup(cpuGroup)} ${sunkCpu}/7` : "Open"}</strong>
      </span>
    `;
  }

  function renderControls() {
    if (!controlsDiv) return;
    const isPlayerTurn = G.turn === "player" && G.phase === "aiming";
    if (!isPlayerTurn) {
      controlsDiv.innerHTML = G.phase === "shooting"
        ? `<div class="pool-status">Balls in motion…</div>`
        : G.phase === "ended"
          ? `<div class="pool-status">Game over.</div>`
          : `<div class="pool-status">CPU is thinking…</div>`;
      return;
    }
    if (G.ballInHand) {
      controlsDiv.innerHTML = `<div class="pool-status">Click in${G.kitchenOnly ? " the kitchen" : " the felt"} to place the cue ball.</div>`;
      return;
    }
    controlsDiv.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;">
        POWER
        <input type="range" id="pool-power" min="5" max="100" value="${G.power}" style="width:160px;">
        <span id="pool-power-val" style="font-family:'Press Start 2P',monospace;font-size:.7rem;color:#ffd641;min-width:48px;">${G.power}%</span>
      </label>
      <button class="mg-btn" id="pool-shoot">SHOOT</button>
    `;
    const slider = document.getElementById("pool-power");
    const val = document.getElementById("pool-power-val");
    slider.addEventListener("input", () => {
      G.power = parseInt(slider.value, 10);
      val.textContent = `${G.power}%`;
      render();
    });
    document.getElementById("pool-shoot").addEventListener("click", shoot);
  }

  function renderInfo() {
    const el = document.getElementById("pool-info");
    if (el) el.textContent = G.message;
  }

  function onHide() {
    gameVersion++;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    mountRef = null;
  }

  // ----- Styles -----
  function injectStyles() {
    if (document.getElementById("pool-styles")) return;
    const s = document.createElement("style");
    s.id = "pool-styles";
    s.textContent = `
      .mini-game #pool-canvas {
        background: #0a3a1a;
        border: 3px solid #5a3a1a;
        border-radius: 14px;
        box-shadow: 0 0 24px rgba(0,0,0,0.55), inset 0 0 30px rgba(0,0,0,0.4);
        max-width: 100%;
        height: auto;
        cursor: crosshair;
      }
      .mini-game #pool-hud {
        display: flex; gap: 24px; align-items: center; justify-content: center;
        font-family: 'Press Start 2P', monospace; font-size: 0.65rem;
        color: #c8e8c8; padding: 4px 0;
      }
      .mini-game .pool-side {
        padding: 4px 10px; border-radius: 4px; background: rgba(0,0,0,0.3);
      }
      .mini-game .pool-side.active {
        background: #ffd641; color: #3a0505; box-shadow: 0 0 12px rgba(255,214,65,0.6);
      }
      .mini-game .pool-side strong { margin-left: 6px; color: inherit; }
      .mini-game .pool-controls {
        display: flex; gap: 12px; align-items: center; justify-content: center;
        margin-top: 6px; min-height: 30px; flex-wrap: wrap;
      }
      .mini-game .pool-status {
        color: #c8d8ff; font-family: 'VT323', monospace; font-size: 1rem;
      }
    `;
    document.head.appendChild(s);
  }

  Arcade.register({
    id: "pool",
    name: "8-Ball Pool",
    icon: "🎱",
    color: "#0e7a3a",
    tag: "SPORTS",
    order: 10,
    init,
    onHide,
  });
})();
