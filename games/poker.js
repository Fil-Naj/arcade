// Texas Hold'em Poker - vs CPU opponents with Monte Carlo decision-making and
// an optional "Sneak Peek" mode that reveals all hole cards plus live win equity.
(function () {
  "use strict";

  // ----- Cards / deck -----
  // r: 2..14 (11=J, 12=Q, 13=K, 14=A), s: 0..3 (0=♠ 1=♥ 2=♦ 3=♣)
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANK_LABEL = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };
  const RANK_WORD = { 2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven",8:"Eight",9:"Nine",10:"Ten",11:"Jack",12:"Queen",13:"King",14:"Ace" };
  const HAND_NAME = ["High Card","Pair","Two Pair","Three of a Kind","Straight","Flush","Full House","Four of a Kind","Straight Flush"];

  function makeDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
    return d;
  }
  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }
  const cardKey = c => c.r * 4 + c.s;

  // ----- Hand evaluator -----
  // evaluate5(cards[5]) -> [category, ...tiebreakers] (higher is better, lexicographic)
  function evaluate5(cards) {
    const ranks = cards.map(c => c.r).sort((a, b) => b - a);
    const suits = cards.map(c => c.s);
    const flush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];
    const straight = straightHigh(ranks);
    // counts: [[rank, count], ...] sorted by count desc then rank desc
    const cmap = {};
    for (const r of ranks) cmap[r] = (cmap[r] || 0) + 1;
    const counts = Object.entries(cmap).map(([r, c]) => [+r, c])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    if (flush && straight) return [8, straight];
    if (counts[0][1] === 4) return [7, counts[0][0], counts[1][0]];
    if (counts[0][1] === 3 && counts[1] && counts[1][1] === 2) return [6, counts[0][0], counts[1][0]];
    if (flush) return [5, ...ranks];
    if (straight) return [4, straight];
    if (counts[0][1] === 3) return [3, counts[0][0], counts[1][0], counts[2][0]];
    if (counts[0][1] === 2 && counts[1] && counts[1][1] === 2)
      return [2, counts[0][0], counts[1][0], counts[2][0]];
    if (counts[0][1] === 2) return [1, counts[0][0], counts[1][0], counts[2][0], counts[3][0]];
    return [0, ...ranks];
  }

  function straightHigh(rankList) {
    // rankList: 5 ranks, may have duplicates (from a 5-card subset they're unique only for straights)
    const uniq = [...new Set(rankList)].sort((a, b) => b - a);
    if (uniq.length < 5) return 0;
    if (uniq[0] - uniq[4] === 4) return uniq[0];
    // Wheel: A-2-3-4-5
    if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) return 5;
    return 0;
  }

  // evaluate up to 7 cards: enumerate C(n,5) subsets, return best score.
  function evaluateBest(cards) {
    const n = cards.length;
    if (n === 5) return evaluate5(cards);
    if (n < 5) return null;
    let best = null;
    const five = new Array(5);
    for (let a = 0; a < n - 4; a++) {
      five[0] = cards[a];
      for (let b = a + 1; b < n - 3; b++) {
        five[1] = cards[b];
        for (let c = b + 1; c < n - 2; c++) {
          five[2] = cards[c];
          for (let d = c + 1; d < n - 1; d++) {
            five[3] = cards[d];
            for (let e = d + 1; e < n; e++) {
              five[4] = cards[e];
              const s = evaluate5(five);
              if (!best || compareScore(s, best) > 0) best = s.slice();
            }
          }
        }
      }
    }
    return best;
  }

  function compareScore(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const av = a[i] || 0, bv = b[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function handDescription(score) {
    if (!score) return "—";
    switch (score[0]) {
      case 8: return score[1] === 14 ? "Royal Flush" : `Straight Flush, ${RANK_WORD[score[1]]}-high`;
      case 7: return `Four of a Kind, ${RANK_WORD[score[1]]}s`;
      case 6: return `Full House, ${RANK_WORD[score[1]]}s full of ${RANK_WORD[score[2]]}s`;
      case 5: return `Flush, ${RANK_WORD[score[1]]}-high`;
      case 4: return `Straight, ${RANK_WORD[score[1]]}-high`;
      case 3: return `Three ${RANK_WORD[score[1]]}s`;
      case 2: return `Two Pair, ${RANK_WORD[score[1]]}s and ${RANK_WORD[score[2]]}s`;
      case 1: return `Pair of ${RANK_WORD[score[1]]}s`;
      default: return `${RANK_WORD[score[1]]} High`;
    }
  }

  // ----- Monte Carlo equity -----
  // knownHoles: array of [card,card] for players whose hole cards we know
  // community: 0..5 community cards already on the board
  // unknownCount: number of additional players whose hole cards we sample
  // Returns: array of equities (knownHoles first, then unknown players), length = knownHoles.length + unknownCount
  function montecarlo(knownHoles, community, unknownCount, sims) {
    const used = new Set();
    for (const h of knownHoles) for (const c of h) used.add(cardKey(c));
    for (const c of community) used.add(cardKey(c));
    const pool = makeDeck().filter(c => !used.has(cardKey(c)));

    const N = knownHoles.length + unknownCount;
    const equity = new Array(N).fill(0);
    const needComm = 5 - community.length;
    const needUnk = unknownCount * 2;
    if (pool.length < needComm + needUnk) return equity;

    for (let s = 0; s < sims; s++) {
      // Partial Fisher–Yates: only shuffle the first (needComm + needUnk) positions.
      const k = needComm + needUnk;
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const drawnComm = pool.slice(0, needComm);
      const fullComm = community.concat(drawnComm);
      const scores = new Array(N);
      for (let p = 0; p < knownHoles.length; p++) {
        scores[p] = evaluateBest(knownHoles[p].concat(fullComm));
      }
      for (let u = 0; u < unknownCount; u++) {
        const hole = [pool[needComm + u * 2], pool[needComm + u * 2 + 1]];
        scores[knownHoles.length + u] = evaluateBest(hole.concat(fullComm));
      }
      // Determine winners
      let best = scores[0];
      let bestIdx = [0];
      for (let i = 1; i < N; i++) {
        const cmp = compareScore(scores[i], best);
        if (cmp > 0) { best = scores[i]; bestIdx = [i]; }
        else if (cmp === 0) bestIdx.push(i);
      }
      if (bestIdx.length === 1) equity[bestIdx[0]] += 1;
      else { const share = 1 / bestIdx.length; for (const i of bestIdx) equity[i] += share; }
    }
    return equity.map(e => e / sims);
  }

  // ============================================================
  //                       GAME STATE
  // ============================================================
  const PHASES = ["idle", "preflop", "flop", "turn", "river", "showdown", "ended"];
  let G; // current game state
  let mountRef = null;
  let gameVersion = 0;
  let pendingTimers = [];

  function clearTimers() {
    for (const t of pendingTimers) clearTimeout(t);
    pendingTimers = [];
  }
  function schedule(fn, ms) {
    const v = gameVersion;
    const t = setTimeout(() => {
      pendingTimers = pendingTimers.filter(x => x !== t);
      if (v !== gameVersion) return;
      if (!mountRef || !document.body.contains(mountRef)) return;
      fn();
    }, ms);
    pendingTimers.push(t);
    return t;
  }

  function newGameState(opts) {
    const numOpponents = opts.numOpponents;
    const players = [];
    players.push(makePlayer("You", true, opts.startingStack));
    const names = ["Riku", "Mira", "Cass", "Zane", "Bex", "Otto"];
    for (let i = 0; i < numOpponents; i++) {
      players.push(makePlayer(names[i] || `CPU${i+1}`, false, opts.startingStack));
    }
    return {
      players,
      dealer: Math.floor(Math.random() * players.length),
      smallBlind: opts.smallBlind,
      bigBlind: opts.bigBlind,
      pot: 0,
      community: [],
      phase: "idle",
      currentBet: 0,
      minRaise: opts.bigBlind,
      toAct: 0,
      deck: [],
      sneakPeek: false,
      winProbs: null,
      handsPlayed: 0,
      handResult: null,
      difficulty: opts.difficulty, // "easy" | "normal" | "hard"
      handLog: [],
    };
  }

  function makePlayer(name, isHuman, chips) {
    return {
      name, isHuman, chips,
      hole: [],
      bet: 0,
      contribution: 0,
      folded: false,
      allIn: false,
      acted: false,
      canRaise: true,
      handScore: null, // set at showdown
    };
  }

  // ----- Start a new hand -----
  function startHand() {
    // Bump version so any stale scheduleNextHand timers self-cancel
    gameVersion++;
    clearTimers();
    if (humanIsBust()) {
      G.phase = "ended";
      G.handResult = { gameOver: true, message: "You busted out. Game over." };
      render();
      return;
    }
    if (cpusAllBust()) {
      G.phase = "ended";
      G.handResult = { gameOver: true, message: "🏆 You eliminated every opponent. You win!" };
      render();
      return;
    }

    G.handsPlayed++;
    G.community = [];
    G.pot = 0;
    G.handResult = null;
    G.deck = shuffle(makeDeck());
    G.handLog = [];

    // Reset player state (skip bust players for this hand)
    for (const p of G.players) {
      p.hole = [];
      p.bet = 0;
      p.contribution = 0;
      p.folded = p.chips === 0; // 0-chip players sit out
      p.allIn = false;
      p.acted = false;
      p.canRaise = true;
      p.handScore = null;
    }

    // Rotate dealer to next non-bust player
    G.dealer = nextActiveSeat(G.dealer, true);

    // Deal hole cards (round-robin starting from dealer+1)
    let s = G.dealer;
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < G.players.length; n++) {
        s = (s + 1) % G.players.length;
        const p = G.players[s];
        if (!p.folded) p.hole.push(G.deck.pop());
      }
    }

    // Post blinds
    postBlinds();

    G.phase = "preflop";

    // Start action — preflop UTG is BB+1; heads-up dealer/SB acts first.
    const live = livePlayersInHand();
    if (live.length <= 1) { endHandShortCircuit(); return; }
    if (live.length === 2) {
      // Heads-up: dealer is SB; SB acts first preflop.
      G.toAct = sbSeat();
    } else {
      G.toAct = nextActiveBetterAfter(bbSeat());
    }
    recomputeSneakPeek();
    log(`Hand #${G.handsPlayed}. Dealer: ${G.players[G.dealer].name}.`);
    render();
    promptNext();
  }

  function postBlinds() {
    const live = livePlayersInHand();
    let sbIdx, bbIdx;
    if (live.length === 2) {
      sbIdx = G.dealer;
      bbIdx = nextActiveBetterAfter(G.dealer);
    } else {
      sbIdx = nextActiveBetterAfter(G.dealer);
      bbIdx = nextActiveBetterAfter(sbIdx);
    }
    const sbPaid = takeChips(G.players[sbIdx], G.smallBlind);
    const bbPaid = takeChips(G.players[bbIdx], G.bigBlind);
    G.players[sbIdx].bet = sbPaid;
    G.players[sbIdx].contribution = sbPaid;
    G.players[bbIdx].bet = bbPaid;
    G.players[bbIdx].contribution = bbPaid;
    // currentBet = actual posted BB (handles short BB)
    G.currentBet = Math.max(sbPaid, bbPaid);
    G.minRaise = G.bigBlind;
    log(`${G.players[sbIdx].name} posts SB $${sbPaid}. ${G.players[bbIdx].name} posts BB $${bbPaid}.`);
  }

  function sbSeat() {
    const live = livePlayersInHand();
    if (live.length === 2) return G.dealer;
    return nextActiveBetterAfter(G.dealer);
  }
  function bbSeat() {
    return nextActiveBetterAfter(sbSeat());
  }

  function nextActiveSeat(from, includeBust) {
    // Used for dealer rotation — only skip permanently-bust players unless includeBust.
    const n = G.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      if (includeBust && G.players[idx].chips > 0) return idx;
    }
    return from;
  }

  // Next seat that's in the hand (not folded, has chips or is in even if all-in for dealer/seat math)
  function nextActiveBetterAfter(from) {
    const n = G.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      const p = G.players[idx];
      if (!p.folded) return idx;
    }
    return from;
  }

  function livePlayersInHand() {
    return G.players.filter(p => !p.folded);
  }

  function takeChips(p, amount) {
    const paid = Math.min(p.chips, amount);
    p.chips -= paid;
    if (p.chips === 0) p.allIn = true;
    return paid;
  }

  function humanIsBust() {
    return G.players[0].chips === 0;
  }
  function cpusAllBust() {
    for (let i = 1; i < G.players.length; i++) {
      if (G.players[i].chips > 0) return false;
    }
    return true;
  }

  // ----- Betting flow -----
  function promptNext() {
    if (G.phase === "showdown" || G.phase === "ended" || G.phase === "idle") return;
    // If only one player remains non-folded, end the hand
    const live = livePlayersInHand();
    if (live.length === 1) { endHandShortCircuit(); return; }
    // If all remaining live players are all-in, run remaining streets without action.
    const actionable = live.filter(p => !p.allIn);
    if (actionable.length <= 1) {
      // If the lone actionable player still owes a call (currentBet > their bet),
      // let them decide. Otherwise no decisions remain; run the board out.
      if (actionable.length === 1 && actionable[0].bet < G.currentBet) {
        // fall through and let them act once
      } else {
        runToShowdown(); return;
      }
    }
    // Skip seats that are folded or all-in
    let safety = G.players.length * 2;
    while (safety-- > 0) {
      const p = G.players[G.toAct];
      if (!p.folded && !p.allIn) break;
      G.toAct = (G.toAct + 1) % G.players.length;
    }
    const p = G.players[G.toAct];
    render();
    if (bettingRoundIsOver()) { endBettingRound(); return; }
    if (p.isHuman) {
      // Wait for click; UI shows buttons.
    } else {
      schedule(() => doCpuAction(G.toAct), 600 + Math.floor(Math.random() * 500));
    }
  }

  function bettingRoundIsOver() {
    const inHand = G.players.filter(p => !p.folded);
    if (inHand.length <= 1) return true;
    for (const p of inHand) {
      if (p.allIn) continue;
      if (!p.acted) return false;
      if (p.bet !== G.currentBet) return false;
    }
    return true;
  }

  function endBettingRound() {
    refundUncalled();
    // Move all bets into the pot conceptually (contribution is the source of truth for showdown).
    for (const p of G.players) {
      G.pot += p.bet;
      p.bet = 0;
      p.acted = false;
      p.canRaise = true;
    }
    G.currentBet = 0;
    G.minRaise = G.bigBlind;

    // If only one player remains, award the pot
    const inHand = G.players.filter(p => !p.folded);
    if (inHand.length === 1) { endHandShortCircuit(); return; }

    advanceStreet();
  }

  function refundUncalled() {
    // Find max bet and second-max bet among ALL players (folded included — folded bets stay in pot).
    const bets = G.players.map(p => p.bet);
    const sorted = bets.slice().sort((a, b) => b - a);
    const top = sorted[0];
    const second = sorted[1] || 0;
    if (top > second) {
      const topPlayers = G.players.filter(p => p.bet === top);
      if (topPlayers.length === 1) {
        const refund = top - second;
        const p = topPlayers[0];
        p.chips += refund;
        p.bet -= refund;
        p.contribution -= refund;
        if (p.chips > 0) p.allIn = false; // Got chips back, not all-in anymore
        if (refund > 0) log(`${p.name} gets back $${refund} uncalled.`);
      }
    }
  }

  function advanceStreet() {
    // Burn one card (Hold'em tradition; mostly cosmetic for fairness)
    if (G.phase === "preflop") {
      G.deck.pop(); // burn
      G.community.push(G.deck.pop(), G.deck.pop(), G.deck.pop());
      G.phase = "flop";
    } else if (G.phase === "flop") {
      G.deck.pop();
      G.community.push(G.deck.pop());
      G.phase = "turn";
    } else if (G.phase === "turn") {
      G.deck.pop();
      G.community.push(G.deck.pop());
      G.phase = "river";
    } else if (G.phase === "river") {
      goToShowdown(); return;
    }
    // Start action at first active player after dealer
    G.toAct = nextActiveBetterAfter(G.dealer);
    recomputeSneakPeek();
    log(`— ${G.phase.toUpperCase()} —  Board: ${G.community.map(cardText).join(" ")}`);
    render();
    schedule(promptNext, 400);
  }

  function runToShowdown() {
    // All remaining players are all-in (or the lone actionable has matched);
    // deal remaining community cards and showdown. Lock further actions by
    // bumping gameVersion (cancels stale CPU/promptNext timers) and setting
    // the phase early so the UI hides the action controls.
    gameVersion++;
    clearTimers();
    refundUncalled();
    for (const p of G.players) { G.pot += p.bet; p.bet = 0; }
    G.currentBet = 0;
    G.phase = "showdown";
    while (G.community.length < 5) {
      G.deck.pop(); // burn
      G.community.push(G.deck.pop());
    }
    recomputeSneakPeek();
    render();
    schedule(goToShowdown, 700);
  }

  function endHandShortCircuit() {
    // One player remains — award them the pot. Lock further actions.
    gameVersion++;
    clearTimers();
    refundUncalled();
    for (const p of G.players) { G.pot += p.bet; p.bet = 0; }
    const winner = livePlayersInHand()[0];
    winner.chips += G.pot;
    G.handResult = {
      winners: [{ idx: G.players.indexOf(winner), amount: G.pot, hand: null }],
      message: `${winner.name} wins $${G.pot} (everyone else folded).`,
    };
    log(G.handResult.message);
    G.pot = 0;
    G.phase = "ended";
    render();
    scheduleNextHand();
  }

  function goToShowdown() {
    gameVersion++;
    clearTimers();
    G.phase = "showdown";
    // Evaluate every non-folded player
    for (const p of G.players) {
      if (p.folded) continue;
      p.handScore = evaluateBest(p.hole.concat(G.community));
    }
    // Distribute side pots
    const payouts = distributeSidePots();
    for (const pay of payouts) {
      G.players[pay.idx].chips += pay.amount;
    }
    // Build readable message
    G.handResult = { winners: payouts, message: buildShowdownMessage(payouts) };
    log(G.handResult.message);
    G.pot = 0;
    render();
    scheduleNextHand();
  }

  function distributeSidePots() {
    const active = G.players.map((p, i) => ({ p, i })).filter(x => !x.p.folded);
    // Caps = unique non-folded contribution levels, ascending
    const caps = [...new Set(active.map(x => x.p.contribution))].sort((a, b) => a - b);
    const payouts = [];
    let prev = 0;
    for (const cap of caps) {
      let potTier = 0;
      for (const p of G.players) {
        potTier += Math.min(p.contribution, cap) - Math.min(p.contribution, prev);
      }
      if (potTier === 0) { prev = cap; continue; }
      const eligible = active.filter(x => x.p.contribution >= cap);
      // Best hand among eligible
      let best = eligible[0].p.handScore;
      let winners = [eligible[0]];
      for (let i = 1; i < eligible.length; i++) {
        const cmp = compareScore(eligible[i].p.handScore, best);
        if (cmp > 0) { best = eligible[i].p.handScore; winners = [eligible[i]]; }
        else if (cmp === 0) winners.push(eligible[i]);
      }
      const share = Math.floor(potTier / winners.length);
      const remainder = potTier - share * winners.length;
      winners.forEach((w, k) => {
        payouts.push({
          idx: w.i, amount: share + (k < remainder ? 1 : 0),
          hand: handDescription(w.p.handScore),
          tier: caps.indexOf(cap),
        });
      });
      prev = cap;
    }
    return payouts;
  }

  function buildShowdownMessage(payouts) {
    // Group payouts by player
    const byIdx = {};
    for (const p of payouts) {
      if (!byIdx[p.idx]) byIdx[p.idx] = { amount: 0, hand: p.hand };
      byIdx[p.idx].amount += p.amount;
    }
    const parts = [];
    for (const idx in byIdx) {
      const w = byIdx[idx];
      parts.push(`${G.players[idx].name} wins $${w.amount} (${w.hand})`);
    }
    return parts.join(" · ");
  }

  function scheduleNextHand() {
    schedule(() => {
      if (humanIsBust() || cpusAllBust()) {
        G.phase = "ended";
        G.handResult = G.handResult || {};
        G.handResult.gameOver = true;
        if (humanIsBust()) G.handResult.message = "💀 You busted out. Game over.";
        else G.handResult.message = "🏆 You won the table!";
        render();
        return;
      }
      startHand();
    }, 3500);
  }

  // ----- Player action handling -----
  function applyAction(playerIdx, action) {
    const p = G.players[playerIdx];
    if (p.folded || p.allIn) return;
    if (G.toAct !== playerIdx) return;
    // Reject any action that fires after the betting phase has ended (race
    // protection against stale CPU timers and pre-showdown UI clicks).
    if (G.phase !== "preflop" && G.phase !== "flop" && G.phase !== "turn" && G.phase !== "river") return;

    if (action.type === "fold") {
      p.folded = true;
      p.acted = true;
      log(`${p.name} folds.`);
      recomputeSneakPeek();
    } else if (action.type === "check") {
      if (p.bet !== G.currentBet) { log(`${p.name} cannot check.`); return; }
      p.acted = true;
      log(`${p.name} checks.`);
    } else if (action.type === "call") {
      const need = G.currentBet - p.bet;
      const paid = takeChips(p, need);
      p.bet += paid;
      p.contribution += paid;
      p.acted = true;
      log(`${p.name} calls $${paid}${p.allIn ? " (all-in)" : ""}.`);
    } else if (action.type === "raise") {
      // amount = total bet (i.e. raise TO X)
      const target = action.amount;
      const need = target - p.bet;
      if (need > p.chips) {
        // Should have been clamped; treat as all-in for chips
        const paid = takeChips(p, p.chips);
        p.bet += paid;
        p.contribution += paid;
      } else {
        const paid = takeChips(p, need);
        p.bet += paid;
        p.contribution += paid;
      }
      const newBet = p.bet;
      const raiseIncrement = newBet - G.currentBet;
      const isFullRaise = raiseIncrement >= G.minRaise;
      if (isFullRaise) {
        // Reset others' acted (only those who were acted=true and not folded/all-in)
        for (const q of G.players) {
          if (q !== p && !q.folded && !q.allIn) q.acted = false;
        }
        G.minRaise = raiseIncrement;
      } else {
        // Incomplete all-in raise: don't reset others; revoke their canRaise (already acted ones).
        if (newBet > G.currentBet) {
          for (const q of G.players) {
            if (q !== p && !q.folded && !q.allIn && q.acted) q.canRaise = false;
          }
        }
      }
      if (newBet > G.currentBet) G.currentBet = newBet;
      p.acted = true;
      log(`${p.name} ${raiseIncrement === newBet ? "bets" : "raises to"} $${newBet}${p.allIn ? " (all-in)" : ""}.`);
    } else {
      return;
    }

    if (bettingRoundIsOver()) { endBettingRound(); return; }
    G.toAct = (G.toAct + 1) % G.players.length;
    promptNext();
  }

  // ----- CPU AI -----
  function doCpuAction(idx) {
    const p = G.players[idx];
    if (G.toAct !== idx || p.folded || p.allIn) return;
    const action = chooseCpuAction(idx);
    applyAction(idx, action);
  }

  function chooseCpuAction(idx) {
    const p = G.players[idx];
    const toCall = G.currentBet - p.bet;
    const opponents = G.players.filter((q, i) => i !== idx && !q.folded);
    const numOpp = opponents.length;
    if (numOpp === 0) return { type: "check" };

    // Equity estimate via MC
    const sims = G.community.length >= 4 ? 500 : G.community.length >= 3 ? 350 : 220;
    const eqArr = montecarlo([p.hole], G.community, numOpp, sims);
    const eq = eqArr[0];

    // Adjust equity for the fact that real opponents continue with stronger ranges than random.
    // Roughly: subtract a penalty proportional to opponent count.
    const rangePenalty = Math.min(0.18, 0.04 * numOpp);
    const adjEq = Math.max(0, eq - rangePenalty);

    // Pot odds slack by difficulty
    const slack = G.difficulty === "easy" ? 0.06 : G.difficulty === "hard" ? -0.02 : 0.01;
    const callThresh = G.difficulty === "easy" ? 0.55 : G.difficulty === "hard" ? 0.68 : 0.62;
    const raiseThresh = G.difficulty === "easy" ? 0.62 : G.difficulty === "hard" ? 0.72 : 0.68;
    const bluffFreq = G.difficulty === "easy" ? 0.02 : G.difficulty === "hard" ? 0.07 : 0.05;

    const pot = G.pot + sumStreetBets();
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const wantBluff = Math.random() < bluffFreq && (numOpp === 1 || (numOpp === 2 && Math.random() < 0.4));

    // No bet to call → check or bet
    if (toCall === 0) {
      if (adjEq > raiseThresh || (wantBluff && p.canRaise && canMakeMinRaise(p))) {
        const sizing = adjEq > 0.85 ? 1.0 : adjEq > 0.7 ? 0.7 : 0.5; // fraction of pot
        const betAmount = clampRaise(p, Math.max(G.bigBlind, Math.round(pot * sizing)));
        if (betAmount > 0) return { type: "raise", amount: betAmount };
      }
      return { type: "check" };
    }

    // Facing a bet
    if (adjEq < potOdds - slack) {
      // Sometimes bluff-raise instead of folding (semi-bluff)
      if (wantBluff && p.canRaise && canMakeMinRaise(p) && adjEq > 0.18) {
        const target = clampRaise(p, Math.round((pot + toCall) * 1.1) + G.currentBet);
        if (target > G.currentBet) return { type: "raise", amount: target };
      }
      return { type: "fold" };
    }

    if (adjEq > raiseThresh && p.canRaise && canMakeMinRaise(p)) {
      const sizing = adjEq > 0.85 ? 1.2 : adjEq > 0.75 ? 0.9 : 0.6;
      const target = clampRaise(p, Math.round((pot + toCall) * sizing) + G.currentBet);
      if (target > G.currentBet) return { type: "raise", amount: target };
    }
    if (adjEq > callThresh || adjEq > potOdds) {
      // Smooth-call value hands occasionally; call draws meeting pot odds
      return { type: "call" };
    }
    return { type: "fold" };
  }

  function sumStreetBets() {
    let s = 0;
    for (const p of G.players) s += p.bet;
    return s;
  }

  function canMakeMinRaise(p) {
    const need = (G.currentBet + G.minRaise) - p.bet;
    return p.chips >= need || p.chips > G.currentBet - p.bet; // can at least go all-in over current
  }

  function clampRaise(p, targetTotal) {
    // targetTotal is the desired p.bet after the raise
    const minTotal = G.currentBet + G.minRaise;
    const maxTotal = p.bet + p.chips;
    let t = Math.max(targetTotal, minTotal);
    t = Math.min(t, maxTotal);
    if (t <= G.currentBet) t = maxTotal; // forced all-in for less
    return Math.max(t, G.currentBet + 1, p.bet + 1); // strictly more than current bet/own bet
  }

  // ----- Sneak Peek -----
  function recomputeSneakPeek() {
    if (!G.sneakPeek) { G.winProbs = null; return; }
    const stillIn = G.players.map((p, i) => ({ p, i })).filter(x => !x.p.folded && x.p.hole.length === 2);
    if (stillIn.length < 2) { G.winProbs = null; return; }
    const holes = stillIn.map(x => x.p.hole);
    const eq = montecarlo(holes, G.community, 0, 600);
    const probs = new Array(G.players.length).fill(0);
    stillIn.forEach((x, k) => probs[x.i] = eq[k]);
    G.winProbs = probs;
  }

  function toggleSneakPeek() {
    G.sneakPeek = !G.sneakPeek;
    recomputeSneakPeek();
    render();
  }

  // ============================================================
  //                          UI
  // ============================================================
  function init(mount) {
    mountRef = mount;
    gameVersion++;
    clearTimers();
    const wrap = document.createElement("div");
    wrap.className = "mini-game";
    wrap.innerHTML = `
      <h2>POKER · TEXAS HOLD'EM</h2>
      <div class="poker-setup" id="pk-setup">
        <div class="hud" style="flex-wrap:wrap;justify-content:center;">
          <span>Opponents
            <select id="pk-opps" class="pk-sel">
              <option value="1">1</option><option value="2">2</option>
              <option value="3" selected>3</option><option value="4">4</option><option value="5">5</option>
            </select>
          </span>
          <span>Stack
            <select id="pk-stack" class="pk-sel">
              <option value="500">$500</option>
              <option value="1000" selected>$1000</option>
              <option value="2500">$2500</option>
            </select>
          </span>
          <span>Blinds
            <select id="pk-blinds" class="pk-sel">
              <option value="5,10" selected>5 / 10</option>
              <option value="10,20">10 / 20</option>
              <option value="25,50">25 / 50</option>
            </select>
          </span>
          <span>CPU
            <select id="pk-diff" class="pk-sel">
              <option value="easy">Easy</option>
              <option value="normal" selected>Normal</option>
              <option value="hard">Hard</option>
            </select>
          </span>
        </div>
        <div class="mg-info" style="margin-top:6px;">Sneak Peek reveals all hole cards and live win probabilities.</div>
      </div>
      <div id="pk-table"></div>
      <div id="pk-controls" class="pk-controls"></div>
      <div id="pk-log" class="pk-log" aria-live="polite"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
        <button class="mg-btn" id="pk-deal">Deal</button>
        <button class="mg-btn" id="pk-peek">👁 Sneak Peek: OFF</button>
        <button class="mg-btn" id="pk-restart">New Game</button>
      </div>
      <div class="mg-controls-help">Hold'em rules · 2 hole cards · 5 community · best 5-card hand wins</div>
    `;
    mount.appendChild(wrap);
    injectStyles();

    document.getElementById("pk-deal").addEventListener("click", onDeal);
    document.getElementById("pk-peek").addEventListener("click", () => { toggleSneakPeek(); updatePeekBtn(); });
    document.getElementById("pk-restart").addEventListener("click", resetGame);

    resetGame();
  }

  function resetGame() {
    gameVersion++;
    clearTimers();
    const opps = parseInt(document.getElementById("pk-opps").value, 10);
    const stack = parseInt(document.getElementById("pk-stack").value, 10);
    const [sb, bb] = document.getElementById("pk-blinds").value.split(",").map(n => parseInt(n, 10));
    const diff = document.getElementById("pk-diff").value;
    G = newGameState({ numOpponents: opps, startingStack: stack, smallBlind: sb, bigBlind: bb, difficulty: diff });
    updatePeekBtn();
    render();
  }

  function onDeal() {
    if (G.phase === "idle" || G.phase === "ended") {
      if (G.phase === "ended" && G.handResult && G.handResult.gameOver) {
        resetGame();
        return;
      }
      startHand();
    }
  }

  function updatePeekBtn() {
    const btn = document.getElementById("pk-peek");
    if (!btn) return;
    btn.textContent = `👁 Sneak Peek: ${G.sneakPeek ? "ON" : "OFF"}`;
    btn.style.background = G.sneakPeek ? "#ffe870" : "#ffd641";
  }

  function render() {
    if (!mountRef) return;
    renderTable();
    renderControls();
    renderLog();
  }

  function renderTable() {
    const t = document.getElementById("pk-table");
    if (!t) return;
    const human = G.players[0];
    const cpus = G.players.slice(1);

    const cpusHtml = cpus.map((p, i) => seatHtml(p, i + 1)).join("");

    const communityHtml = `
      <div class="pk-community-row">
        ${[0,1,2,3,4].map(i => {
          if (G.community[i]) return cardHtml(G.community[i]);
          return `<div class="pk-card empty"></div>`;
        }).join("")}
      </div>
    `;

    const potHtml = `
      <div class="pk-pot">
        <div class="pk-phase">${phaseLabel()}</div>
        <div class="pk-pot-amount">POT: $${G.pot + sumStreetBets()}</div>
        ${G.currentBet > 0 ? `<div class="pk-currbet">Bet to match: $${G.currentBet}</div>` : ""}
      </div>
    `;

    const humanHtml = seatHtml(human, 0);

    t.innerHTML = `
      <div class="pk-felt">
        <div class="pk-cpus">${cpusHtml}</div>
        ${communityHtml}
        ${potHtml}
        <div class="pk-human">${humanHtml}</div>
      </div>
    `;
  }

  function seatHtml(p, idx) {
    const showCards = (idx === 0) || G.sneakPeek || G.phase === "showdown" || G.phase === "ended";
    const cards = p.hole.length === 0
      ? `<div class="pk-card empty"></div><div class="pk-card empty"></div>`
      : (showCards
          ? p.hole.map(cardHtml).join("")
          : `<div class="pk-card back"></div><div class="pk-card back"></div>`);
    const tags = [];
    if (idx === G.dealer && G.phase !== "idle") tags.push(`<span class="pk-tag dealer">D</span>`);
    if (G.phase === "preflop" || G.phase === "flop" || G.phase === "turn" || G.phase === "river" || G.phase === "showdown") {
      if (idx === sbSeatSafe()) tags.push(`<span class="pk-tag">SB</span>`);
      if (idx === bbSeatSafe()) tags.push(`<span class="pk-tag">BB</span>`);
    }
    if (p.folded) tags.push(`<span class="pk-tag folded">FOLDED</span>`);
    if (p.allIn) tags.push(`<span class="pk-tag allin">ALL-IN</span>`);
    if (G.toAct === idx && !p.folded && !p.allIn && G.phase !== "showdown" && G.phase !== "ended" && G.phase !== "idle") {
      tags.push(`<span class="pk-tag acting">◀ TO ACT</span>`);
    }
    const winPct = (G.sneakPeek && G.winProbs && !p.folded)
      ? `<div class="pk-eq">${(G.winProbs[idx] * 100).toFixed(1)}% win</div>`
      : "";
    const handLine = (G.phase === "showdown" && !p.folded && p.handScore)
      ? `<div class="pk-hand">${handDescription(p.handScore)}</div>`
      : "";
    const betLine = p.bet > 0
      ? `<div class="pk-bet">bet $${p.bet}</div>`
      : "";

    return `
      <div class="pk-seat ${p.folded ? "is-folded" : ""} ${G.toAct === idx && !p.folded && !p.allIn ? "is-acting" : ""}">
        <div class="pk-seat-head">
          <span class="pk-name">${p.name}</span>
          <span class="pk-tags">${tags.join("")}</span>
        </div>
        <div class="pk-chips">$${p.chips}</div>
        <div class="pk-cards">${cards}</div>
        ${betLine}
        ${winPct}
        ${handLine}
      </div>
    `;
  }

  function sbSeatSafe() { try { return sbSeat(); } catch { return -1; } }
  function bbSeatSafe() { try { return bbSeat(); } catch { return -1; } }

  function phaseLabel() {
    switch (G.phase) {
      case "idle": return "PRESS DEAL TO START";
      case "preflop": return "PRE-FLOP";
      case "flop": return "FLOP";
      case "turn": return "TURN";
      case "river": return "RIVER";
      case "showdown": return "SHOWDOWN";
      case "ended": return G.handResult && G.handResult.gameOver ? "GAME OVER" : "HAND OVER";
    }
    return "";
  }

  function cardHtml(c) {
    const red = c.s === 1 || c.s === 2;
    return `<div class="pk-card ${red ? "red" : "black"}">
      <div class="pk-card-rank">${RANK_LABEL[c.r]}</div>
      <div class="pk-card-suit">${SUITS[c.s]}</div>
    </div>`;
  }

  function cardText(c) {
    return RANK_LABEL[c.r] + SUITS[c.s];
  }

  function renderControls() {
    const c = document.getElementById("pk-controls");
    if (!c) return;
    const human = G.players[0];
    const dealBtn = document.getElementById("pk-deal");

    // Deal-button label
    if (G.phase === "idle") {
      dealBtn.textContent = "Deal Hand";
      dealBtn.disabled = false;
    } else if (G.phase === "ended") {
      dealBtn.textContent = G.handResult && G.handResult.gameOver ? "Restart" : "Next Hand";
      dealBtn.disabled = false;
    } else {
      dealBtn.textContent = "Dealing…";
      dealBtn.disabled = true;
    }

    const showActions = G.toAct === 0 && !human.folded && !human.allIn &&
      (G.phase === "preflop" || G.phase === "flop" || G.phase === "turn" || G.phase === "river");

    if (!showActions) {
      let msg = "";
      if (G.phase === "showdown" || G.phase === "ended") {
        msg = G.handResult ? G.handResult.message : "";
      } else if (human.folded) msg = "You folded. Watching the hand play out…";
      else if (human.allIn) msg = "You're all-in. Watching the showdown…";
      else if (G.phase !== "idle") msg = `Waiting for ${G.players[G.toAct].name}…`;
      c.innerHTML = msg ? `<div class="pk-action-msg">${msg}</div>` : "";
      return;
    }

    const toCall = G.currentBet - human.bet;
    const canCheck = toCall === 0;
    const minRaiseTotal = G.currentBet + G.minRaise;
    const minRaiseAffordable = Math.min(minRaiseTotal, human.bet + human.chips);
    const maxRaise = human.bet + human.chips;
    const canRaise = human.canRaise && maxRaise > G.currentBet;
    const callLabel = toCall === 0 ? "Check" : (toCall >= human.chips ? `Call All-In $${human.chips}` : `Call $${toCall}`);

    c.innerHTML = `
      <button class="mg-btn" id="pk-fold">Fold</button>
      <button class="mg-btn" id="pk-call">${canCheck ? "Check" : callLabel}</button>
      ${canRaise ? `
        <div class="pk-raise-group">
          <input type="range" id="pk-raise-slider" min="${minRaiseAffordable}" max="${maxRaise}" value="${minRaiseAffordable}">
          <span id="pk-raise-amount">$${minRaiseAffordable}</span>
          <button class="mg-btn" id="pk-raise">${G.currentBet === 0 ? "Bet" : "Raise"}</button>
          <button class="mg-btn mini" id="pk-raise-min">MIN</button>
          <button class="mg-btn mini" id="pk-raise-pot">POT</button>
          <button class="mg-btn mini" id="pk-raise-all">ALL-IN</button>
        </div>` : ""}
    `;

    document.getElementById("pk-fold").addEventListener("click", () => {
      if (G.toAct === 0) applyAction(0, { type: "fold" });
    });
    document.getElementById("pk-call").addEventListener("click", () => {
      if (G.toAct !== 0) return;
      if (canCheck) applyAction(0, { type: "check" });
      else applyAction(0, { type: "call" });
    });
    if (canRaise) {
      const slider = document.getElementById("pk-raise-slider");
      const amt = document.getElementById("pk-raise-amount");
      slider.addEventListener("input", () => { amt.textContent = `$${slider.value}`; });
      document.getElementById("pk-raise").addEventListener("click", () => {
        if (G.toAct !== 0) return;
        applyAction(0, { type: "raise", amount: parseInt(slider.value, 10) });
      });
      document.getElementById("pk-raise-min").addEventListener("click", () => {
        slider.value = String(minRaiseAffordable);
        amt.textContent = `$${slider.value}`;
      });
      document.getElementById("pk-raise-pot").addEventListener("click", () => {
        const pot = G.pot + sumStreetBets();
        const target = Math.min(maxRaise, Math.max(minRaiseAffordable, G.currentBet + pot));
        slider.value = String(target);
        amt.textContent = `$${slider.value}`;
      });
      document.getElementById("pk-raise-all").addEventListener("click", () => {
        slider.value = String(maxRaise);
        amt.textContent = `$${slider.value}`;
      });
    }
  }

  function log(msg) {
    if (!G) return;
    G.handLog.push(msg);
    if (G.handLog.length > 60) G.handLog.shift();
    const el = document.getElementById("pk-log");
    if (el) {
      el.innerHTML = G.handLog.slice(-8).map(m => `<div>${m}</div>`).join("");
      el.scrollTop = el.scrollHeight;
    }
  }

  function renderLog() {
    if (!G) return;
    const el = document.getElementById("pk-log");
    if (el) el.innerHTML = G.handLog.slice(-8).map(m => `<div>${m}</div>`).join("");
  }

  function onHide() {
    gameVersion++;
    clearTimers();
    mountRef = null;
  }

  // ----- Styles (scoped via .mini-game prefix where possible) -----
  function injectStyles() {
    if (document.getElementById("pk-styles")) return;
    const s = document.createElement("style");
    s.id = "pk-styles";
    s.textContent = `
      .mini-game .pk-sel {
        font-family: 'VT323', monospace; font-size: 1rem;
        background: #1a1a2e; color: #eee; border: 1px solid #555;
        border-radius: 4px; padding: 2px 6px;
      }
      .mini-game #pk-table {
        width: 100%; max-width: 760px;
      }
      .mini-game .pk-felt {
        background: radial-gradient(ellipse at center, #1f7a48 0%, #0e3a23 80%, #062014 100%);
        border: 4px solid #5a3a1a;
        border-radius: 60px / 36px;
        padding: 14px 16px 18px;
        box-shadow: inset 0 0 30px rgba(0,0,0,0.55), 0 6px 22px rgba(0,0,0,0.5);
        position: relative;
      }
      .mini-game .pk-cpus {
        display: flex; flex-wrap: wrap; justify-content: space-around; gap: 8px;
        margin-bottom: 10px;
      }
      .mini-game .pk-seat {
        background: rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        padding: 6px 8px;
        min-width: 110px;
        color: #e8f4e8;
        font-family: 'VT323', monospace;
        text-align: center;
        transition: box-shadow 0.2s, border-color 0.2s;
      }
      .mini-game .pk-seat.is-acting {
        border-color: #ffd641;
        box-shadow: 0 0 16px rgba(255, 214, 65, 0.7);
      }
      .mini-game .pk-seat.is-folded {
        opacity: 0.5;
        filter: grayscale(0.6);
      }
      .mini-game .pk-seat-head {
        display: flex; justify-content: space-between; align-items: center;
        gap: 6px; font-size: 0.95rem;
      }
      .mini-game .pk-name { font-family: 'Press Start 2P', monospace; font-size: 0.55rem; color: #ffd641; }
      .mini-game .pk-tags { display: flex; gap: 3px; flex-wrap: wrap; }
      .mini-game .pk-tag {
        font-family: 'Press Start 2P', monospace; font-size: 0.42rem;
        padding: 1px 4px; border-radius: 3px;
        background: #444; color: #eee; letter-spacing: 0.05em;
      }
      .mini-game .pk-tag.dealer { background: #fff; color: #000; }
      .mini-game .pk-tag.acting { background: #ffd641; color: #3a0505; }
      .mini-game .pk-tag.folded { background: #555; color: #ccc; }
      .mini-game .pk-tag.allin { background: #c11818; color: #fff; }
      .mini-game .pk-chips { font-size: 1.1rem; color: #fff; margin: 2px 0; }
      .mini-game .pk-cards { display: flex; gap: 4px; justify-content: center; margin: 4px 0; }
      .mini-game .pk-bet { font-size: 0.95rem; color: #ffd641; }
      .mini-game .pk-eq { font-size: 0.95rem; color: #00f0ff; text-shadow: 0 0 6px rgba(0,240,255,0.5); }
      .mini-game .pk-hand { font-size: 0.85rem; color: #c8ffaa; margin-top: 2px; }
      .mini-game .pk-card {
        width: 34px; height: 48px; background: #fff;
        border: 1px solid #333; border-radius: 5px;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        font-family: 'Boogaloo', 'Press Start 2P', serif;
        padding: 2px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      }
      .mini-game .pk-card.red { color: #c11818; }
      .mini-game .pk-card.black { color: #111; }
      .mini-game .pk-card .pk-card-rank { font-size: 0.95rem; font-weight: bold; line-height: 1; }
      .mini-game .pk-card .pk-card-suit { font-size: 1rem; line-height: 1; }
      .mini-game .pk-card.back {
        background: repeating-linear-gradient(45deg, #8a0a0a 0 6px, #c11818 6px 12px);
        border-color: #3a0505;
      }
      .mini-game .pk-card.empty {
        background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.2);
        box-shadow: none;
      }
      .mini-game .pk-community-row {
        display: flex; gap: 6px; justify-content: center; margin: 10px 0;
      }
      .mini-game .pk-pot {
        text-align: center; color: #ffd641;
        font-family: 'Press Start 2P', monospace;
        margin: 4px 0 10px;
      }
      .mini-game .pk-phase { font-size: 0.6rem; color: #00f0ff; }
      .mini-game .pk-pot-amount { font-size: 0.9rem; margin-top: 4px; }
      .mini-game .pk-currbet { font-size: 0.55rem; color: #ffe870; margin-top: 4px; }
      .mini-game .pk-human { display: flex; justify-content: center; margin-top: 10px; }
      .mini-game .pk-human .pk-seat { min-width: 180px; }
      .mini-game .pk-controls {
        display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
        align-items: center; margin-top: 8px; min-height: 36px;
      }
      .mini-game .pk-raise-group {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center;
      }
      .mini-game .pk-raise-group input[type=range] {
        width: 140px;
      }
      .mini-game #pk-raise-amount {
        font-family: 'Press Start 2P', monospace; font-size: 0.7rem; color: #ffd641; min-width: 56px;
      }
      .mini-game .mg-btn.mini { padding: 4px 8px; font-size: 0.5rem; }
      .mini-game .pk-action-msg {
        color: #c8d8ff; font-size: 1.05rem; text-align: center;
        font-family: 'VT323', monospace;
      }
      .mini-game .pk-log {
        background: rgba(0,0,0,0.4); border: 1px solid #2a2a3a; border-radius: 4px;
        font-family: 'VT323', monospace; font-size: 0.85rem; color: #a8c8a8;
        padding: 6px 10px; width: 100%; max-width: 760px;
        max-height: 130px; overflow-y: auto;
        margin-top: 6px;
      }
      .mini-game .pk-log div { line-height: 1.3; }
    `;
    document.head.appendChild(s);
  }

  Arcade.register({
    id: "poker",
    name: "Poker",
    icon: "♠♥",
    color: "#1f7a48",
    tag: "CARDS",
    order: 9,
    init,
    onHide,
  });
})();
