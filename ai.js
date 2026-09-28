"use strict";

/*
  Pac-Man AI
  ----------
  Decision pipeline:
    1) FSM: choose the broad strategic state.
    2) Behavior Tree: choose the behavior branch for that state.
    3) Hybrid Reward Architecture utility: rank valid goals.
    4) A*: convert the selected goal into UP/DOWN/LEFT/RIGHT.

  Ghost clustering is intentionally handled in the SETUP Behavior Tree branch,
  not as a term inside the utility equation.

  v24: validated power-pellet staging gets a short final-approach latch so the
  last move cannot oscillate when ghost positions shift slightly.
*/

(() => {
  const DIR = Object.freeze({
    up: Object.freeze({ x: 0, y: 1, name: "up" }),
    down: Object.freeze({ x: 0, y: -1, name: "down" }),
    left: Object.freeze({ x: -1, y: 0, name: "left" }),
    right: Object.freeze({ x: 1, y: 0, name: "right" })
  });
  const DIRS = [DIR.up, DIR.down, DIR.left, DIR.right];
  const GHOST = Object.freeze({ FRIGHTENED: "Frightened", HOME: "Home" });
  const FSM = Object.freeze({
    COLLECT: "COLLECT",
    THREATENED: "THREATENED",
    SETUP: "SETUP",
    POWERED: "POWERED",
    BONUS: "BONUS",
    SCORE_ENDGAME: "SCORE_ENDGAME"
  });

  const WEIGHTS = Object.freeze({
    [FSM.COLLECT]:       Object.freeze({ score: 0.35, safety: 0.30, future: 0.25, cost: 0.10 }),
    [FSM.THREATENED]:    Object.freeze({ score: 0.10, safety: 0.65, future: 0.15, cost: 0.10 }),
    [FSM.SETUP]:         Object.freeze({ score: 0.20, safety: 0.20, future: 0.55, cost: 0.05 }),
    [FSM.POWERED]:       Object.freeze({ score: 0.68, safety: 0.10, future: 0.17, cost: 0.05 }),
    [FSM.BONUS]:         Object.freeze({ score: 0.50, safety: 0.25, future: 0.15, cost: 0.10 }),
    [FSM.SCORE_ENDGAME]: Object.freeze({ score: 0.40, safety: 0.25, future: 0.25, cost: 0.10 })
  });

  const AI_CONFIG = Object.freeze({
    stateSwitchMargin: 0.18,
    targetSwitchMargin: 0.20,
    minPlanCenters: 2,
    minSetupPlanCenters: 2,
    predictiveHorizon: 12,
    interceptSafetyMargin: 0.78,
    hardRouteSafety: 0.36,
    setupPacRange: 11,
    setupGhostRange: 11,
    powerClosestGhost: 3,
    powerSecondGhost: 5,
    powerIdealCaptures: 3,
    powerThirdGhost: 7,
    setupMaxWaitCenters: 8,
    scoreEndgameSmallBuffer: 18,
    emergencyPowerRange: 12,
    criticalDistance: 1.45,
    criticalCollisionDistance: 0.84,
    edgeTabuCenters: 6,
    finalPelletThreshold: 12,
    conservativeProgress: 0.86,
    finalLifeProgress: 0.70,
    twoLifeProgress: 0.90,
    finalLifeRouteSafety: 0.52,
    twoLifeRouteSafety: 0.43,
    poweredBailTime: 2.35,
    stagedPowerCommitCenters: 4
  });

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const cell = p => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const key = p => `${Math.round(p.x)},${Math.round(p.y)}`;
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  // Shared shortest-distance cache. The mazes are static, so repeated AI
  // evaluations and Monte Carlo simulations can reuse BFS results instead of
  // recomputing the same distance map tens of thousands of times.
  const DISTANCE_CACHE = new Map();

  class Pathfinder {
    constructor(grid, actorType = "pacman") {
      this.grid = grid;
      this.actorType = actorType;
      this.cachePrefix = `${actorType}|${grid.lines.join("/")}`;
    }

    next(c, d) {
      const x = Math.round(c.x), y = Math.round(c.y);
      if (y === 1 && x === 13 && d.x === 1) return { x: -14, y: 1 };
      if (y === 1 && x === -14 && d.x === -1) return { x: 13, y: 1 };
      return { x: x + d.x, y: y + d.y };
    }

    neighbors(c, forbidden = null) {
      const out = [];
      for (const d of DIRS) {
        if (!this.grid.canMoveFrom(c.x, c.y, d, this.actorType)) continue;
        const n = this.next(c, d);
        if (forbidden && forbidden.has(key(n))) continue;
        out.push(n);
      }
      return out;
    }

    h(a, b) {
      const direct = manhattan(a, b);
      const rightTunnel = Math.abs(a.y - 1) + Math.abs(a.x - 13) + 1 + Math.abs(b.x + 14) + Math.abs(b.y - 1);
      const leftTunnel = Math.abs(a.y - 1) + Math.abs(a.x + 14) + 1 + Math.abs(b.x - 13) + Math.abs(b.y - 1);
      return Math.min(direct, rightTunnel, leftTunnel);
    }

    path(startLike, targetLike, forbiddenLike = null) {
      const start = cell(startLike), target = cell(targetLike);
      const sk = key(start), tk = key(target);
      if (sk === tk) return [start];

      const forbidden = new Set(forbiddenLike || []);
      forbidden.delete(sk);
      forbidden.delete(tk);
      const open = new Map([[sk, { c: start, f: this.h(start, target) }]]);
      const came = new Map();
      const g = new Map([[sk, 0]]);

      while (open.size) {
        let ck = null, node = null;
        for (const [k, v] of open) {
          if (!node || v.f < node.f) { ck = k; node = v; }
        }
        open.delete(ck);
        if (ck === tk) {
          const result = [target];
          let k = tk;
          while (came.has(k)) {
            k = came.get(k);
            const [x, y] = k.split(",").map(Number);
            result.push({ x, y });
          }
          return result.reverse();
        }
        const base = g.get(ck);
        for (const n of this.neighbors(node.c, forbidden)) {
          const nk = key(n), ng = base + 1;
          if (ng >= (g.get(nk) ?? Infinity)) continue;
          came.set(nk, ck);
          g.set(nk, ng);
          open.set(nk, { c: n, f: ng + this.h(n, target) });
        }
      }
      return null;
    }

    distances(startLike, maxDepth = Infinity, forbiddenLike = null) {
      const start = cell(startLike);
      const forbidden = new Set(forbiddenLike || []);
      forbidden.delete(key(start));
      const forbiddenSig = forbidden.size ? [...forbidden].sort().join(";") : "";
      const depthSig = Number.isFinite(maxDepth) ? String(maxDepth) : "I";
      const cacheKey = `${this.cachePrefix}|${key(start)}|${depthSig}|${forbiddenSig}`;
      const cached = DISTANCE_CACHE.get(cacheKey);
      if (cached) return cached;

      const dist = new Map([[key(start), 0]]);
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const cur = queue[i], d = dist.get(key(cur));
        if (d >= maxDepth) continue;
        for (const n of this.neighbors(cur, forbidden)) {
          const nk = key(n);
          if (dist.has(nk)) continue;
          dist.set(nk, d + 1);
          queue.push(n);
        }
      }
      DISTANCE_CACHE.set(cacheKey, dist);
      return dist;
    }
  }

  // ---------- 1. FINITE STATE MACHINE ----------
  class PacManFSM {
    constructor() { this.reset(); }
    reset() { this.state = FSM.COLLECT; this.scores = {}; }

    choose(f) {
      const scores = {
        [FSM.COLLECT]: 0.45 + 0.20 * (1 - f.threat) + (f.smallPellets.length ? 0.10 : 0),
        [FSM.THREATENED]: f.threat,
        [FSM.SETUP]: -Infinity,
        [FSM.POWERED]: -Infinity,
        [FSM.BONUS]: -Infinity,
        [FSM.SCORE_ENDGAME]: -Infinity
      };

      // Hard strategic states. These should not be lost to a tiny score change.
      if (f.immediateDanger) {
        this.state = FSM.THREATENED;
        scores[FSM.THREATENED] = 1.50;
        this.scores = scores;
        return this.state;
      }
      // POWERED is tied to the global frightened timer, not merely to whether an
      // edible ghost happens to be visible outside the house at this instant.
      // This makes the FSM transition atomic with power-pellet activation.
      if (f.frightenedTime > 0) {
        this.state = FSM.POWERED;
        scores[FSM.POWERED] = 1.25 + 0.05 * clamp(f.frightenedTime / 8);
        this.scores = scores;
        return this.state;
      }

      // Reliability mode: once the life budget is thin, clearing the level outranks
      // speculative score farming. POWERED and true emergencies still override this.
      if (f.reliabilityMode && f.pellets.length > 0) {
        this.state = FSM.SCORE_ENDGAME;
        scores[FSM.SCORE_ENDGAME] = 1.32;
        this.scores = scores;
        return this.state;
      }

      // No fruit + no power pellets + only a few dots means there is no strategic
      // reason to wait. Stay in SCORE_ENDGAME unless a true immediate emergency
      // (handled above) occurs. This prevents harmless threat-score fluctuations
      // from repeatedly pulling Pac-Man away from the only remaining objective.
      if (!f.powerPellets.length && !f.bonus && f.smallPellets.length > 0 &&
          f.smallPellets.length <= AI_CONFIG.finalPelletThreshold) {
        this.state = FSM.SCORE_ENDGAME;
        scores[FSM.SCORE_ENDGAME] = 1.20;
        this.scores = scores;
        return this.state;
      }

      if (f.bestSetup?.eligible) {
        const st = f.bestSetup;
        scores[FSM.SETUP] = 0.50 +
          0.20 * clamp(st.stagingGhosts / 4) +
          0.18 * st.clusterScore +
          0.12 * (1 - clamp(st.pacDistance / AI_CONFIG.setupPacRange));
      }

      if (f.bonus) scores[FSM.BONUS] = 0.75 + 0.20 * clamp(f.bonus.value / 1000);
      if (f.progress >= 0.88) scores[FSM.SCORE_ENDGAME] = 0.68 + 0.30 * clamp((f.progress - 0.88) / 0.12);

      // State hysteresis: switching requires a material advantage, not a tiny tie.
      let best = this.state;
      let bestValue = Number.isFinite(scores[this.state]) ? scores[this.state] : -Infinity;
      for (const st of Object.values(FSM)) {
        if (scores[st] > bestValue) { best = st; bestValue = scores[st]; }
      }
      const currentValue = Number.isFinite(scores[this.state]) ? scores[this.state] : -Infinity;
      if (best !== this.state && Number.isFinite(currentValue)) {
        const margin = (best === FSM.SETUP && this.state === FSM.COLLECT) ? 0.05 : AI_CONFIG.stateSwitchMargin;
        if (bestValue < currentValue + margin) best = this.state;
      }

      this.scores = scores;
      this.state = best;
      return best;
    }
  }

  // ---------- 2. HYBRID REWARD ARCHITECTURE UTILITY ----------
  class HRAUtility {
    choose(candidates, fsmState) {
      if (!candidates.length) return null;
      const w = WEIGHTS[fsmState] || WEIGHTS[FSM.COLLECT];
      const maxFuture = Math.max(1, ...candidates.map(c => Math.max(0, c.futureRaw)));
      for (const c of candidates) {
        const scoreReward = clamp(c.expectedScore / 2000);
        const safetyReward = clamp(c.safety);
        const futureReward = clamp(c.futureRaw / maxFuture);
        const movementCost = clamp(c.pathLength / 30);
        const reversalPenalty = fsmState === FSM.THREATENED ? 0 : (c.reversalPenalty || 0);
        c.components = { scoreReward, safetyReward, futureReward, movementCost, reversalPenalty };
        c.utility = w.score * scoreReward + w.safety * safetyReward + w.future * futureReward -
                    w.cost * movementCost - reversalPenalty;
      }
      candidates.sort((a, b) => b.utility - a.utility);
      return candidates[0];
    }
  }

  // ---------- 3. BEHAVIOR TREE ----------
  class BehaviorTree {
    constructor(ai) { this.ai = ai; }

    tick(f, state) {
      if (f.immediateDanger) {
        const c = this.ai.emergency(f, true);
        if (c) return { behavior: "EMERGENCY_SAFETY", candidate: c };
      }
      switch (state) {
        case FSM.THREATENED: return this.threatened(f);
        case FSM.POWERED: return this.powered(f);
        case FSM.SETUP: return this.setup(f);
        case FSM.BONUS: return this.bonus(f);
        case FSM.SCORE_ENDGAME: return this.endgame(f);
        default: return this.collect(f);
      }
    }

    threatened(f) {
      const power = this.ai.safePower(f);
      if (power) return { behavior: "THREATENED_SAFE_POWER", candidate: power };
      const escape = this.ai.emergency(f, false);
      if (escape) return { behavior: "THREATENED_ESCAPE", candidate: escape };
      return this.collect(f, "THREATENED_FALLBACK");
    }

    powered(f) {
      // Incremental v23 change: if a frightened ghost is still *provably catchable*,
      // finish that capture before bailing out. poweredGhostCandidate() already
      // requires enough time reserve to reach the target before frightened mode
      // expires, so this adds score without extending a hopeless chase.
      const c = this.ai.poweredGhostCandidate(f);
      if (c) return { behavior: "POWERED_HUNT_CHAIN", candidate: c };

      // If no frightened ghost is realistically catchable, preserve the existing
      // reliability behavior and reposition before frightened mode expires.
      const bailTime = f.reliabilityMode ? AI_CONFIG.poweredBailTime : 1.25;
      if (f.frightenedTime <= bailTime) {
        const finish = this.ai.completionPelletCandidate(f);
        if (finish) return { behavior: "POWERED_CLEAR_POSITION", candidate: finish };
        const safe = this.ai.emergency(f, false);
        if (safe) return { behavior: "POWERED_REPOSITION_SAFE", candidate: safe };
      }
      const safe = this.ai.emergency(f, false);
      if (safe && f.frightenedTime <= 1.25) return { behavior: "POWERED_REPOSITION_SAFE", candidate: safe };
      const reposition = this.ai.poweredRepositionCandidate(f);
      if (reposition) return { behavior: "POWERED_CHAIN_REPOSITION", candidate: reposition };
      return this.collect(f, "POWERED_COLLECT_FALLBACK");
    }

    setup(f) {
      // Once Pac-Man has reached a staging square for a validated power-pellet
      // trap, finish the final step instead of re-evaluating the whole setup and
      // stuttering if a ghost shifts by one tile. The latch is short-lived and
      // applies only to that exact pellet.
      const committed = this.ai.stagedPowerCandidate(f);
      if (committed) return { behavior: "SETUP_COMMIT_POWER", candidate: committed, cluster: f.bestSetup || null };

      const st = f.bestSetup;
      if (!st?.eligible) return this.collect(f, "SETUP_ABORT");
      if (f.reliabilityMode) {
        const defensive = this.ai.safePower(f);
        if (defensive) return { behavior: "SETUP_RELIABILITY_POWER", candidate: defensive, cluster: st };
        const finish = this.ai.completionPelletCandidate(f);
        if (finish) return { behavior: "SETUP_RELIABILITY_CLEAR", candidate: finish, cluster: st };
      }

      // If setup becomes dangerous, escape. Do not waste the pellet merely because
      // pressure increased. The power-pellet gate is checked again only when adjacent.
      if (f.threat >= 0.78 && !this.ai.canConsumePower(st.pellet, f, true)) {
        const escape = this.ai.emergency(f, false);
        if (escape) return { behavior: "SETUP_ABORT_UNSAFE", candidate: escape, cluster: st };
      }

      if (this.ai.canConsumePower(st.pellet, f, false)) {
        const power = this.ai.powerCandidate(st.pellet, f, "SETUP_EAT_POWER", true);
        if (power) return { behavior: "SETUP_EAT_POWER", candidate: power, cluster: st };
      }

      // If the ghosts are ready but Pac-Man is not yet adjacent, approach a safe
      // staging square next to the pellet. Never route directly across the pellet.
      if (st.ready) {
        const stage = this.ai.powerStagingCandidate(st, f);
        if (stage) return { behavior: "SETUP_APPROACH_POWER", candidate: stage, cluster: st };
      }

      const lure = this.ai.lureGhosts(st, f);
      if (lure) return { behavior: "SETUP_LURE_GHOSTS", candidate: lure, cluster: st };

      const patrol = this.ai.patrolCandidate(f, st.pellet);
      return { behavior: "SETUP_PATROL", candidate: patrol, cluster: st };
    }

    bonus(f) {
      if (!f.bonus) return this.collect(f, "BONUS_EXPIRED");
      const c = this.ai.candidate("BONUS", f.bonus, f, { expectedScore: f.bonus.value, futureRaw: f.bonus.value });
      return c ? { behavior: "BONUS_PURSUIT", candidate: c } : this.collect(f, "BONUS_UNREACHABLE");
    }

    endgame(f) {
      // In reliability mode, do not spend a remaining life waiting for a perfect
      // trap. Clear ordinary pellets along the safest route and use power pellets
      // defensively/when required.
      if (f.reliabilityMode) {
        if (f.smallPellets.length) {
          const finish = this.ai.completionPelletCandidate(f);
          if (finish) return { behavior: "ENDGAME_RELIABILITY_CLEAR", candidate: finish };
        }
        if (f.powerPellets.length) {
          const defensive = this.ai.safePower(f);
          if (defensive) return { behavior: "ENDGAME_RELIABILITY_POWER", candidate: defensive };
          const candidates = f.powerPellets
            .map(p => this.ai.powerCandidate(p, f, "ENDGAME_REQUIRED_POWER", false))
            .filter(Boolean);
          const c = this.ai.utility.choose(candidates, FSM.SCORE_ENDGAME);
          if (c) return { behavior: "ENDGAME_REQUIRED_POWER", candidate: c };
        }
      }

      // If no power pellets or fruit remain, there is no higher-value scoring
      // opportunity to wait for. Finish the board. Safety still has priority through
      // the Emergency branch above this node, but the endgame itself never patrols
      // or waits merely for a scatter phase.
      if (!f.powerPellets.length && !f.bonus && f.smallPellets.length <= AI_CONFIG.finalPelletThreshold) {
        const finish = this.ai.completionPelletCandidate(f);
        if (finish) return { behavior: "ENDGAME_FINISH_DOTS", candidate: finish };
      }

      // Once ordinary pellets are gone, power pellets are mandatory completion
      // goals. Prefer a good scoring setup, but never sacrifice all lives waiting
      // forever for a perfect cluster that may not develop.
      if (!f.smallPellets.length && f.powerPellets.length) {
        const candidates = f.powerPellets
          .map(p => this.ai.powerCandidate(p, f, "ENDGAME_REQUIRED_POWER", false))
          .filter(Boolean);
        const c = this.ai.utility.choose(candidates, FSM.SCORE_ENDGAME);
        if (c) return { behavior: "ENDGAME_REQUIRED_POWER", candidate: c };
      }
      if (f.bestSetup?.eligible) {
        const d = this.setup(f);
        if (d.candidate) return { ...d, behavior: `ENDGAME_${d.behavior}` };
      }

      // Score extraction rule: do not casually clear the last ordinary pellets while
      // unused power pellets remain. Keep a buffer of dots on the board and use the
      // time to draw ghosts toward a remaining power pellet. This prevents the final
      // power pellet from becoming the level-ending pellet before its ghost chain can
      // be harvested.
      if (f.powerPellets.length && f.smallPellets.length <= AI_CONFIG.scoreEndgameSmallBuffer) {
        const focus = f.setups.sort((a, b) => b.value - a.value)[0];
        if (focus) {
          const lure = this.ai.lureGhosts(focus, f);
          if (lure) return { behavior: "ENDGAME_SCORE_TRAP", candidate: lure, cluster: focus };
          const hold = this.ai.scoreHoldCandidate(f, focus.pellet);
          if (hold) return { behavior: "ENDGAME_SCORE_HOLD", candidate: hold, cluster: focus };
        }
      }
      if (f.bonus) {
        const d = this.bonus(f);
        if (d.candidate) return { ...d, behavior: `ENDGAME_${d.behavior}` };
      }
      const list = this.ai.pelletCandidates(f, 12);
      if (list.length) return { behavior: "SCORE_ENDGAME_COLLECT", candidate: this.ai.utility.choose(list, FSM.SCORE_ENDGAME) };
      return { behavior: "SCORE_ENDGAME_PATROL", candidate: this.ai.patrolCandidate(f, f.bestSetup?.pellet || null) };
    }

    collect(f, behavior = "COLLECT_REGION") {
      // Do not hoard every power pellet until the situation is already lethal.
      // If danger is building and a pellet is safely reachable, it is a valid
      // defensive/scoring goal even while the broad FSM remains COLLECT.
      const defensiveThreshold = f.reliabilityMode ? 0.38 : (f.lives <= 2 ? 0.46 : 0.50);
      if (f.threat >= defensiveThreshold) {
        const power = this.ai.safePower(f);
        if (power) return { behavior: "COLLECT_DEFENSIVE_POWER", candidate: power };
      }
      const list = this.ai.pelletCandidates(f, 10);
      let c = this.ai.utility.choose(list, FSM.COLLECT);
      if (!c) c = this.ai.patrolCandidate(f, null);
      if (!c) c = this.ai.emergency(f, false);
      return { behavior, candidate: c };
    }
  }

  class PacManAI {
    constructor(game) {
      this.game = game;
      this.path = new Pathfinder(game.grid, "pacman");
      this.ghostPath = new Pathfinder(game.grid, "ghost");
      this.fsm = new PacManFSM();
      this.utility = new HRAUtility();
      this.tree = new BehaviorTree(this);
      this.debug = {};
      this.reset();
    }

    onGridChanged(grid) {
      this.path = new Pathfinder(grid, "pacman");
      this.ghostPath = new Pathfinder(grid, "ghost");
      this.reset();
    }

    reset() {
      this.fsm.reset();
      this.lastDecisionCell = null;
      this.committedAction = "stop";
      this.lastBehavior = "WAITING";
      this.lastCandidate = null;
      this.plan = null;
      this.planCenters = 0;
      this.lockedGhostName = null;
      this.lockedGhostAnchor = null;
      this.lockedGhostAnchorCenter = -999;
      this.huntQueue = [];
      this.huntProjectedScore = 0;
      this.lastFrightenedTime = 0;
      this.setupFocusKey = null;
      this.setupWaitCenters = 0;
      this.emergencyPowerKey = null;
      this.emergencyPowerUntilCenter = 0;
      this.activePowerCommitKey = null;
      this.stagedPowerCommitKey = null;
      this.stagedPowerCommitUntilCenter = 0;
      this.threatRecoveryUntil = 0;
      this.recentCenters = [];
      this.edgeTabuUntil = new Map();
      this.escapePlan = null;
      this.criticalCommitAction = null;
      this.completionTargetKey = null;
      this.loopBreakUntil = 0;
      this.centerCounter = 0;
      this.debug = { fsmState: FSM.COLLECT, behavior: "WAITING", target: "—", utility: null, cluster: null };
      this.updatePanel();
    }

    decide() {
      this.game.aiEmergencyOverride = false;
      const f = this.features();
      let state = this.fsm.choose(f);

      // A newly consumed power pellet can refresh the frightened timer while Pac-Man
      // is already POWERED. Treat that as a new hunt episode and rebuild the chain
      // plan from the ghosts' current positions.
      if (f.frightenedTime > this.lastFrightenedTime + 1.0) {
        this.lockedGhostName = null;
        this.lockedGhostAnchor = null;
        this.huntQueue = [];
        this.huntProjectedScore = 0;
        this.stagedPowerCommitKey = null;
        this.stagedPowerCommitUntilCenter = 0;
      }
      this.lastFrightenedTime = f.frightenedTime;
      const centerKey = key(f.pac);
      const atCenter = this.isAtTileCenter();
      const enteredNewCenter = atCenter && centerKey !== this.lastDecisionCell;
      const currentAction = this.currentAction();

      // A critical mid-tile reversal is committed until the next tile center.
      // Without this latch, tiny frame-to-frame changes can produce LEFT/RIGHT/LEFT
      // oscillation while a ghost is closing, which is worse than either escape.
      if (atCenter) this.criticalCommitAction = null;
      if (!atCenter && this.criticalCommitAction) {
        const risk = f.dangerousGhosts.length
          ? Math.min(...f.dangerousGhosts.map(g => this.relativeMotionDistance(this.criticalCommitAction, g)))
          : 99;
        if (risk > 0.48) {
          this.committedAction = this.criticalCommitAction;
          this.game.aiEmergencyOverride = true;
          this.debug = {
            fsmState: FSM.THREATENED, behavior: "CRITICAL_EVASION_LOCK",
            target: `escape ${this.criticalCommitAction}`, utility: risk, cluster: null
          };
          this.updatePanel();
          return this.criticalCommitAction;
        }
        this.criticalCommitAction = null;
      }

      // Last-line safety shield: unlike the strategic planner, this runs on every
      // AI poll and reasons about continuous actor motion over the next fraction
      // of a second. It may interrupt between tile centers only for a real collision.
      const critical = this.criticalEvasion(f, currentAction);
      if (critical?.force) {
        this.clearPlan();
        this.fsm.state = FSM.THREATENED;
        state = FSM.THREATENED;
        this.committedAction = critical.action;
        if (!atCenter) this.criticalCommitAction = critical.action;
        this.game.aiEmergencyOverride = true;
        this.debug = {
          fsmState: FSM.THREATENED,
          behavior: "CRITICAL_EVASION",
          target: critical.target || critical.action.toUpperCase(),
          utility: critical.score,
          cluster: null
        };
        this.updatePanel();
        return critical.action;
      }
      const committedDir = DIR[this.committedAction];
      const committedBlocked = atCenter && committedDir && !this.game.grid.canMoveFrom(f.pac.x, f.pac.y, committedDir);
      const stalledAtCenter = atCenter && (currentAction === "stop" || committedBlocked);

      // Never replace a plan between tile centers. This is the strongest anti-stutter
      // rule: all strategic and target changes happen at discrete navigation points.
      if (!atCenter) {
        this.debug.fsmState = state;
        this.updatePanel();
        return this.committedAction !== "stop" ? this.committedAction : (currentAction !== "stop" ? currentAction : "right");
      }

      // The agent is polled faster than movement. Do not run the planner repeatedly
      // while Pac-Man is sitting on the same center unless he is blocked/stopped.
      if (!enteredNewCenter && !stalledAtCenter) {
        this.debug.fsmState = state;
        this.updatePanel();
        return this.committedAction !== "stop" ? this.committedAction : currentAction;
      }

      if (enteredNewCenter) {
        this.lastDecisionCell = centerKey;
        this.centerCounter += 1;
        if (this.plan) this.planCenters += 1;
        this.rememberCenter(centerKey);

        // Track how long Pac-Man has invested in a specific power-pellet setup.
        // We prefer a 3+ ghost opportunity, but do not wait forever if a strong
        // two-ghost chance is all that develops.
        const setupActive = (state === FSM.SETUP || state === FSM.SCORE_ENDGAME) && f.bestSetup?.eligible;
        const sk = setupActive ? key(f.bestSetup.pellet) : null;
        if (sk) {
          if (this.setupFocusKey === sk) this.setupWaitCenters += 1;
          else { this.setupFocusKey = sk; this.setupWaitCenters = 0; }
        } else {
          this.setupFocusKey = null;
          this.setupWaitCenters = 0;
        }
      }

      // In a straight corridor there is no meaningful choice. Keep moving instead
      // of invoking the FSM/BT/utility stack at every tile. Corners and junctions
      // remain decision points.
      const decisionCell = this.game.grid.isDecisionCell(f.pac.x, f.pac.y, "pacman");
      const currentDir = DIR[currentAction];
      const forwardLegal = currentDir && this.game.grid.canMoveFrom(f.pac.x, f.pac.y, currentDir, "pacman");
      if (!f.immediateDanger && !decisionCell && forwardLegal && !stalledAtCenter) {
        const nextCell = this.path.next(f.pac, currentDir);
        const nextPellet = this.game.grid.pelletAt(nextCell.x, nextCell.y);
        const enteringReservedPower = nextPellet && !nextPellet.eaten && nextPellet.type === "power" &&
                                      !this.powerEntryAuthorized(nextPellet, f, state, null);
        if (!enteringReservedPower) {
          this.committedAction = currentAction;
          this.debug.fsmState = state;
          this.updatePanel();
          return currentAction;
        }
      }

      let decision;
      if (f.immediateDanger) {
        // With only the final few ordinary dots left, allow a short, provably
        // winnable race to the locked completion target. Coarse threat detection
        // should not make Pac-Man abandon a dot one or two safe tiles away.
        const finishRace = this.completionRaceCandidate(f);
        if (finishRace) {
          state = FSM.SCORE_ENDGAME;
          this.fsm.state = state;
          decision = { behavior: "ENDGAME_FINISH_RACE", candidate: finishRace };
        } else {
          this.clearPlan();
          decision = { behavior: "EMERGENCY_SAFETY", candidate: this.stabilizeEscapeCandidate(this.emergency(f, true), f) };
        }
      } else {
        decision = this.tree.tick(f, state) || {};
        if (decision.candidate?.type === "SAFE_ESCAPE") {
          decision.candidate = this.stabilizeEscapeCandidate(decision.candidate, f);
        } else if (state !== FSM.THREATENED) {
          this.escapePlan = null;
        }
        decision = this.stabilizeDecision(decision, f, state);
      }

      const c = decision.candidate;
      const powerCommitTypes = new Set(["SETUP_EAT_POWER", "SETUP_COMMIT_POWER", "EMERGENCY_POWER_PELLET", "POWER_PELLET", "ENDGAME_REQUIRED_POWER"]);
      if (c && powerCommitTypes.has(c.type)) this.activePowerCommitKey = key(c.target);
      else this.activePowerCommitKey = null;

      let action = this.nextAction(c, f);
      if (!action || action === "stop") action = this.bestEscapeAction(f, false);
      if (!action || action === "stop") action = currentAction;
      if (!action || action === "stop") action = this.firstLegalAction(f);

      // A normal planner is not allowed to bounce back along the tile it just came
      // from when a legal non-reversing alternative exists. Emergency and powered
      // pursuit may deliberately reverse, but their targets are locked.
      const plannedAction = action;
      action = this.guardReversal(action, f, state);
      if (action !== plannedAction && state !== FSM.POWERED && !f.immediateDanger) this.clearPlan();

      const beforePowerGuard = action;
      action = this.guardPowerEntry(action, f, state, c);
      if (action !== beforePowerGuard) this.clearPlan();

      if (action && action !== "stop") this.committedAction = action;
      this.lastBehavior = decision.behavior || this.lastBehavior;
      this.lastCandidate = c || this.lastCandidate;

      this.debug = {
        fsmState: state,
        behavior: decision.behavior || "NO_BEHAVIOR",
        target: c ? `${c.type} @ (${c.target.x}, ${c.target.y})` : "—",
        utility: Number.isFinite(c?.utility) ? c.utility : null,
        cluster: decision.cluster?.clusterScore ?? f.bestSetup?.clusterScore ?? null
      };
      this.updatePanel();
      return action || "right";
    }

    rememberCenter(centerKey) {
      const previous = this.recentCenters.length ? this.recentCenters[this.recentCenters.length - 1] : null;
      this.recentCenters.push(centerKey);
      if (this.recentCenters.length > 12) this.recentCenters.shift();

      // Expire old edge tabus.
      for (const [ek, until] of this.edgeTabuUntil) {
        if (until <= this.centerCounter) this.edgeTabuUntil.delete(ek);
      }

      const r = this.recentCenters;
      const n = r.length;
      // A -> B -> A is enough evidence that the controller just undid its last
      // decision. Temporarily suppress that undirected edge for ordinary planning
      // so a new high-level goal cannot immediately recreate the same bounce.
      if (n >= 3 && r[n - 1] === r[n - 3] && r[n - 1] !== r[n - 2]) {
        const ek = this.edgeKeyFromKeys(r[n - 2], r[n - 1]);
        this.edgeTabuUntil.set(ek, this.centerCounter + AI_CONFIG.edgeTabuCenters);
        this.clearPlan();
        this.loopBreakUntil = Math.max(this.loopBreakUntil, this.centerCounter + 4);
      }

      if (n >= 6) {
        const abab = r[n - 1] === r[n - 3] && r[n - 3] === r[n - 5] &&
                     r[n - 2] === r[n - 4] && r[n - 4] === r[n - 6] &&
                     r[n - 1] !== r[n - 2];
        if (abab) {
          this.clearPlan();
          this.loopBreakUntil = Math.max(this.loopBreakUntil, this.centerCounter + 6);
        }
      }
    }

    edgeKey(a, b) {
      return this.edgeKeyFromKeys(key(a), key(b));
    }

    edgeKeyFromKeys(a, b) {
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    edgeIsTabu(a, b) {
      return (this.edgeTabuUntil.get(this.edgeKey(a, b)) || 0) > this.centerCounter;
    }

    clearPlan() {
      this.plan = null;
      this.planCenters = 0;
    }

    planMinimum(behavior) {
      if ((behavior || "").includes("SETUP")) return AI_CONFIG.minSetupPlanCenters;
      if ((behavior || "").includes("BONUS")) return 2;
      return AI_CONFIG.minPlanCenters;
    }

    safetyFloor(f) {
      if (f?.lives <= 1) return AI_CONFIG.finalLifeRouteSafety;
      if (f?.lives <= 2 && f?.progress >= AI_CONFIG.conservativeProgress) return AI_CONFIG.twoLifeRouteSafety;
      return AI_CONFIG.hardRouteSafety;
    }

    shouldPersistCandidate(c) {
      if (!c) return false;
      if (["SAFE_ESCAPE", "EDIBLE_GHOST", "EMERGENCY_POWER_PELLET", "SETUP_EAT_POWER", "POWER_PELLET"].includes(c.type)) return false;
      return true;
    }

    refreshPlan(f, state) {
      if (!this.plan || this.plan.state !== state) return null;
      const p = this.plan;
      if (Number.isFinite(p.maxCenters) && this.planCenters > p.maxCenters) return null;
      if (key(f.pac) === key(p.target)) return null;

      if (p.type === "PELLET_REGION") {
        const pellet = this.game.grid.pelletAt(p.target.x, p.target.y);
        if (!pellet || pellet.eaten || pellet.type === "power") return null;
      }
      if (p.type === "BONUS" && !f.bonus) return null;
      if (p.type === "LURE_GHOSTS" || p.type === "PATROL") {
        if (state === FSM.SETUP && !f.bestSetup?.eligible) return null;
      }

      const c = this.candidate(p.type, p.target, f, {
        expectedScore: p.expectedScore,
        futureRaw: p.futureRaw,
        metadata: p.metadata,
        allowReverse: false
      });
      if (!c) return null;
      if (this.predictiveRouteSafety(c.route, f) < this.safetyFloor(f)) return null;
      return c;
    }

    stabilizeDecision(decision, f, state) {
      const proposed = decision?.candidate || null;

      // POWERED uses a separate ghost identity lock. THREATENED is intentionally
      // reactive and does not preserve ordinary collection/setup plans.
      if (state === FSM.POWERED || state === FSM.THREATENED) {
        this.clearPlan();
        return decision;
      }

      const old = this.refreshPlan(f, state);
      if (old) {
        const same = proposed && proposed.type === old.type && key(proposed.target) === key(old.target);
        if (same) {
          this.plan.candidate = proposed;
          return decision;
        }

        const minCenters = this.planMinimum(this.plan.behavior);
        if (this.planCenters < minCenters) {
          return { behavior: `${this.plan.behavior}_LOCKED`, candidate: old, cluster: decision.cluster };
        }

        // After the minimum commitment, switch only for a materially better goal.
        // This is the target-level hysteresis that prevents near-ties from making
        // Pac-Man look indecisive at consecutive intersections.
        if (proposed) {
          this.utility.choose([old, proposed], state);
          const safetyGain = proposed.safety - old.safety;
          const utilityGain = proposed.utility - old.utility;
          const proposedFirst = this.routeFirstDirection(proposed.route);
          const oldFirst = this.routeFirstDirection(old.route);
          const proposedReverses = proposedFirst && this.isReverseAction(this.currentAction(), proposedFirst);
          const oldReverses = oldFirst && this.isReverseAction(this.currentAction(), oldFirst);
          const switchMargin = AI_CONFIG.targetSwitchMargin + (proposedReverses && !oldReverses ? 0.20 : 0);
          if (utilityGain < switchMargin && safetyGain < 0.24) {
            return { behavior: `${this.plan.behavior}_STABLE`, candidate: old, cluster: decision.cluster };
          }
        } else {
          return { behavior: `${this.plan.behavior}_STABLE`, candidate: old, cluster: decision.cluster };
        }
      } else if (this.plan) {
        this.clearPlan();
      }

      if (proposed && this.shouldPersistCandidate(proposed)) {
        const behavior = decision.behavior || "PLAN";
        const longLived = proposed.type === "PELLET_REGION" || behavior.includes("ENDGAME");
        this.plan = {
          state,
          behavior,
          type: proposed.type,
          target: { ...proposed.target },
          expectedScore: proposed.expectedScore,
          futureRaw: proposed.futureRaw,
          metadata: proposed.metadata,
          maxCenters: longLived ? 18 : (behavior.includes("SETUP") ? 7 : 8)
        };
        this.planCenters = 0;
      }
      return decision;
    }

    stabilizeEscapeCandidate(proposed, f) {
      if (!proposed || proposed.type !== "SAFE_ESCAPE") {
        this.escapePlan = null;
        return proposed;
      }

      if (this.escapePlan && this.centerCounter <= this.escapePlan.until &&
          key(f.pac) !== key(this.escapePlan.target)) {
        const old = this.candidate("SAFE_ESCAPE", this.escapePlan.target, f, {
          expectedScore: 0,
          futureRaw: this.escapePlan.futureRaw || 0,
          allowReverse: true,
          ignoreTabu: true
        });
        if (old && old.safety >= 0.24) {
          const gain = (proposed.safety || 0) - old.safety;
          // Keep the chosen escape corridor unless another route is clearly safer.
          if (gain < 0.22) return old;
        }
      }

      this.escapePlan = {
        target: { ...proposed.target },
        until: this.centerCounter + 4,
        futureRaw: proposed.futureRaw || 0
      };
      return proposed;
    }

    completionPelletCandidate(f) {
      if (f.powerPellets.length || f.bonus || !f.smallPellets.length) {
        this.completionTargetKey = null;
        return null;
      }

      // Continue toward the same last-dot target after temporary evasion whenever
      // it still exists. This avoids repeatedly choosing a different corner of the
      // maze after each threat-state fluctuation.
      let targetPellet = null;
      if (this.completionTargetKey) {
        targetPellet = f.smallPellets.find(p => key(p) === this.completionTargetKey) || null;
      }

      const candidates = [];
      for (const p of f.smallPellets) {
        const c = this.candidate("PELLET_REGION", p, f, {
          futureRaw: this.localValue(p, f) + 500,
          ignoreTabu: true
        });
        if (!c) continue;
        // Completion score emphasizes survivability first, then distance. With no
        // other scoring resources left, wandering/patrolling has zero value.
        c.completionScore = 3.2 * c.safety - 0.075 * c.pathLength;
        candidates.push(c);
      }
      if (!candidates.length) return null;

      let chosen = targetPellet ? candidates.find(c => key(c.target) === key(targetPellet)) : null;
      const best = candidates.sort((a, b) => b.completionScore - a.completionScore)[0];
      if (!chosen || chosen.safety < 0.18 || best.completionScore > chosen.completionScore + 0.55) chosen = best;
      this.completionTargetKey = key(chosen.target);
      return chosen;
    }

    completionRaceCandidate(f) {
      if (f.powerPellets.length || f.bonus || !f.smallPellets.length ||
          f.smallPellets.length > AI_CONFIG.finalPelletThreshold) return null;
      const c = this.completionPelletCandidate(f);
      if (!c || c.pathLength > 4 || !c.route) return null;

      // Use a much smaller margin than ordinary route planning, but still reject a
      // route if a dangerous ghost can reach any traversed tile at the same time.
      for (let i = 1; i < c.route.length; i++) {
        const rc = c.route[i];
        const pacETA = i / Math.max(0.1, this.game.pacman.speed);
        for (const g of f.dangerousGhosts) {
          const gd = f.ghostMaps.get(g.name).get(key(rc));
          if (gd === undefined) continue;
          const scatterDelay = g.state === "Scatter" && gd > 3 ? Math.min(1.0, Math.max(0, g.time || 0)) : 0;
          const ghostETA = scatterDelay + gd / Math.max(0.1, g.ghost.speed || 7);
          if (ghostETA - pacETA <= 0.10) return null;
        }
      }
      return c;
    }

    powerEntryAuthorized(pellet, f, state, candidate) {
      if (!pellet || pellet.eaten || pellet.type !== "power") return true;
      const k = key(pellet);
      const explicitTypes = new Set(["SETUP_EAT_POWER", "SETUP_COMMIT_POWER", "EMERGENCY_POWER_PELLET", "POWER_PELLET", "ENDGAME_REQUIRED_POWER"]);
      if (candidate && explicitTypes.has(candidate.type) && key(candidate.target) === k) return true;
      if (this.activePowerCommitKey === k) return true;
      if (this.stagedPowerCommitKey === k && this.centerCounter <= this.stagedPowerCommitUntilCenter) return true;
      if (state === FSM.SETUP && this.canConsumePower(pellet, f, false)) return true;
      if (state === FSM.SCORE_ENDGAME && !f.smallPellets.length) return true;
      return false;
    }

    guardPowerEntry(action, f, state, candidate) {
      const d = DIR[action];
      if (!d) return action;
      const n = this.path.next(f.pac, d);
      const pellet = this.game.grid.pelletAt(n.x, n.y);
      if (!pellet || pellet.eaten || pellet.type !== "power" || this.powerEntryAuthorized(pellet, f, state, candidate)) return action;

      // Choose the best legal non-power alternative. This prevents ordinary food
      // collection from burning a strategic power pellet by accident.
      let best = null;
      for (const alt of this.game.grid.availableDirections(f.pac.x, f.pac.y, "pacman")) {
        if (alt.name === action) continue;
        const nn = this.path.next(f.pac, alt);
        const pp = this.game.grid.pelletAt(nn.x, nn.y);
        if (pp && !pp.eaten && pp.type === "power") continue;
        const route = this.traceCorridor(f.pac, alt, 5);
        const safety = this.predictiveRouteSafety(route, f);
        const reversePenalty = this.isReverseAction(this.currentAction(), alt.name) ? 0.25 : 0;
        const score = 2.5 * safety - reversePenalty;
        if (!best || score > best.score) best = { action: alt.name, score };
      }
      return best?.action || action;
    }

    guardReversal(action, f, state) {
      const current = this.currentAction();
      if (!this.isReverseAction(current, action)) return action;
      if (f.immediateDanger) return action;

      const legal = this.game.grid.availableDirections(f.pac.x, f.pac.y);
      const alternatives = legal.filter(d => !this.isReverseAction(current, d.name));
      if (!alternatives.length) return action;

      // POWERED is a special scoring mode. The frightened-ghost identity is locked,
      // so allowing a U-turn here does not recreate ordinary target thrashing. A
      // reversal is often exactly what is needed after one capture to start the
      // next leg of a high-value ghost chain.
      if (state === FSM.POWERED && this.lockedGhostName) return action;

      let best = null;
      for (const d of alternatives) {
        const route = this.traceCorridor(f.pac, d, AI_CONFIG.predictiveHorizon);
        const safety = this.predictiveRouteSafety(route, f);
        const score = safety + (d.name === current ? 0.12 : 0);
        if (!best || score > best.score) best = { d, score };
      }
      return best?.d.name || action;
    }

    isAtTileCenter() {
      return Math.abs(this.game.pacman.x - Math.round(this.game.pacman.x)) < 0.10 &&
             Math.abs(this.game.pacman.y - Math.round(this.game.pacman.y)) < 0.10;
    }

    currentAction() {
      const d = this.game.pacman.direction;
      if (!d || (!d.x && !d.y)) return "stop";
      if (Math.abs(d.x) > Math.abs(d.y)) return d.x > 0 ? "right" : "left";
      return d.y > 0 ? "up" : "down";
    }

    firstLegalAction(f) {
      const dirs = this.game.grid.availableDirections(f.pac.x, f.pac.y);
      return dirs.length ? dirs[0].name : "stop";
    }

    isReverseAction(current, next) {
      return (current === "left" && next === "right") ||
             (current === "right" && next === "left") ||
             (current === "up" && next === "down") ||
             (current === "down" && next === "up");
    }

    stepThreat(f, d) {
      const n = this.path.next(f.pac, d);
      let minNow = Number.isFinite(f.nearest) ? f.nearest : 99;
      let minNext = 99;
      let severeApproach = false;
      let collisionRisk = false;
      let worstGain = 99;

      for (const g of f.dangerousGhosts) {
        const graphNow = Number.isFinite(g.pacDistance) ? g.pacDistance : 99;
        const graphNextRaw = f.ghostMaps.get(g.name).get(key(n));
        const graphNext = graphNextRaw === undefined ? 99 : graphNextRaw;

        // Use the actors' real sub-tile positions as a second signal. The graph
        // distance uses rounded ghost cells and can otherwise miss a ghost that
        // is directly following Pac-Man within the same corridor.
        const gx = g.ghost.x, gy = g.ghost.y;
        const px = this.game.pacman.x, py = this.game.pacman.y;
        const euclidNow = Math.hypot(gx - px, gy - py);
        const euclidNext = Math.hypot(gx - n.x, gy - n.y);

        minNext = Math.min(minNext, graphNext, euclidNext);
        minNow = Math.min(minNow, graphNow, euclidNow);

        const graphGain = graphNext - graphNow;   // positive = farther from ghost
        const euclidGain = euclidNext - euclidNow;
        const gain = Math.min(graphGain, euclidGain);
        worstGain = Math.min(worstGain, gain);

        const closeThreat = Math.min(graphNow, euclidNow) <= 6;
        if (closeThreat && (graphGain < 0 || euclidGain < -0.10)) severeApproach = true;
        if (graphNext <= 1 || euclidNext <= 1.05) collisionRisk = true;
      }

      if (!f.dangerousGhosts.length) {
        minNow = minNext = 99;
        worstGain = 0;
      }

      return {
        next: n,
        minNow,
        minNext,
        distanceGain: minNext - minNow,
        worstGain,
        severeApproach,
        collisionRisk
      };
    }

    relativeMotionDistance(action, g, horizon = 0.55) {
      const d = DIR[action];
      if (!d) return Infinity;
      const px = this.game.pacman.x, py = this.game.pacman.y;
      const gx = g.ghost.x, gy = g.ghost.y;
      const pvx = d.x * this.game.pacman.speed, pvy = d.y * this.game.pacman.speed;
      const gd = g.ghost.direction || { x: 0, y: 0 };
      const gvx = gd.x * (g.ghost.speed || 7), gvy = gd.y * (g.ghost.speed || 7);
      const rx = px - gx, ry = py - gy;
      const vx = pvx - gvx, vy = pvy - gvy;
      const vv = vx * vx + vy * vy;
      let t = vv > 1e-9 ? -(rx * vx + ry * vy) / vv : 0;
      t = Math.max(0, Math.min(horizon, t));
      return Math.hypot(rx + vx * t, ry + vy * t);
    }

    criticalEvasion(f, currentAction) {
      if (!f.dangerousGhosts.length) return null;
      let legal = this.game.grid.availableDirections(f.pac.x, f.pac.y, "pacman");
      if (!legal.length) return null;
      // Between centers Pac-Man can only continue or reverse along the current
      // corridor. Perpendicular choices are not physically executable until center.
      if (!this.isAtTileCenter() && currentAction && currentAction !== "stop") {
        const corridorOnly = legal.filter(d => d.name === currentAction || this.isReverseAction(currentAction, d.name));
        if (corridorOnly.length) legal = corridorOnly;
      }

      const currentRisk = currentAction !== "stop"
        ? Math.min(...f.dangerousGhosts.map(g => this.relativeMotionDistance(currentAction, g)))
        : 0;
      const physicallyClose = (f.nearestEuclid ?? Infinity) <= AI_CONFIG.criticalDistance;
      const collisionCourse = currentRisk <= AI_CONFIG.criticalCollisionDistance;
      // This layer is intentionally narrow. Broader danger is handled by the FSM
      // at tile centers; this shield exists only for an imminent physical collision.
      if (!collisionCourse && !physicallyClose) return null;

      let best = null;
      for (const d of legal) {
        const minMotion = Math.min(...f.dangerousGhosts.map(g => this.relativeMotionDistance(d.name, g)));
        const route = this.traceCorridor(f.pac, d, 4);
        const routeSafety = this.predictiveRouteSafety(route, f);
        const n = this.path.next(f.pac, d);
        let minGraph = 99;
        for (const g of f.dangerousGhosts) {
          const gd = f.ghostMaps.get(g.name).get(key(n));
          if (gd !== undefined) minGraph = Math.min(minGraph, gd);
        }
        const score = 2.7 * Math.min(minMotion, 3.0) + 3.2 * routeSafety + 0.18 * Math.min(minGraph, 8) +
                      (d.name === currentAction ? 0.18 : 0);
        if (!best || score > best.score) best = { action: d.name, score, minMotion, routeSafety, target: `escape ${d.name}` };
      }
      if (!best) return null;

      // Interrupt only when the current motion is genuinely dangerous or the best
      // alternative is materially safer; this prevents the safety shield itself
      // from becoming another source of stutter.
      const bestIsSafer = best.minMotion >= currentRisk + 0.18;
      const force = collisionCourse || (physicallyClose && currentRisk <= 1.05 && bestIsSafer);
      return { ...best, force };
    }

    escapeOptions(f, allowPower = false) {
      const current = this.currentAction();
      let options = [];
      for (const d of this.game.grid.availableDirections(f.pac.x, f.pac.y)) {
        const t = this.stepThreat(f, d);
        const route = this.traceCorridor(f.pac, d, AI_CONFIG.predictiveHorizon);
        if (!allowPower && route.some(c => f.powerKeys.has(key(c)))) continue;
        const end = route[route.length - 1];
        const exits = this.game.grid.availableDirections(end.x, end.y).length;
        const isCurrent = d.name === current;
        const isReverse = this.isReverseAction(current, d.name);
        const reverseTowardThreat = isReverse && t.severeApproach;
        const predictiveSafety = this.predictiveRouteSafety(route, f);
        const motionDistance = f.dangerousGhosts.length
          ? Math.min(...f.dangerousGhosts.map(g => this.relativeMotionDistance(d.name, g, 0.65)))
          : 99;
        const motionCollision = motionDistance <= AI_CONFIG.criticalCollisionDistance;
        options.push({ d, n: t.next, route, exits, isCurrent, isReverse, reverseTowardThreat, predictiveSafety, motionDistance, motionCollision, ...t });
      }

      let pool = options.filter(o => !o.collisionRisk && !o.motionCollision && o.predictiveSafety >= 0.24);
      if (pool.length) options = pool;
      pool = options.filter(o => !o.severeApproach);
      if (pool.length) options = pool;
      pool = options.filter(o => !o.reverseTowardThreat);
      if (pool.length) options = pool;

      for (const o of options) {
        o.value = 5.0 * o.predictiveSafety +
                  1.4 * Math.min(o.minNext, 10) / 10 +
                  1.2 * clamp((o.distanceGain + 2) / 4) +
                  0.35 * o.exits +
                  (o.isCurrent ? 0.35 : 0) -
                  (o.isReverse ? 0.45 : 0) -
                  (o.severeApproach ? 2.0 : 0) -
                  (o.collisionRisk ? 6.0 : 0) -
                  (o.motionCollision ? 8.0 : 0) +
                  0.35 * Math.min(o.motionDistance, 3.0);
      }
      return options.sort((a, b) => b.value - a.value);
    }

    bestEscapeAction(f, allowPower = false) {
      const best = this.escapeOptions(f, allowPower)[0];
      return best?.d.name || this.firstLegalAction(f);
    }

    features() {
      const pac = cell(this.game.pacman);
      const pacDist = this.path.distances(pac);
      const smallPellets = [], powerPellets = [], pellets = [];
      for (const p of this.game.grid.pellets.values()) {
        if (p.eaten) continue;
        pellets.push(p);
        (p.type === "power" ? powerPellets : smallPellets).push(p);
      }

      const dangerousGhosts = [], edibleGhosts = [], ghostMaps = new Map();
      for (const g of this.game.ghosts) {
        const gc = cell(g);
        const gmap = this.ghostPath.distances(gc);
        const info = {
          ghost: g, name: g.name, cell: gc, state: g.state,
          time: Math.max(0, g.stateTimer),
          pacDistance: gmap.get(key(pac)) ?? Infinity
        };
        const inHouse = g.state === GHOST.HOME || g.leavingHome || this.game.grid.isGhostHouseCell(g.x, g.y);
        if (!inHouse && g.state === GHOST.FRIGHTENED && !g.eatenEyes) edibleGhosts.push(info);
        else if (!inHouse && g.state !== GHOST.HOME && !g.eatenEyes) dangerousGhosts.push(info);
        ghostMaps.set(g.name, gmap);
      }

      const nearest = dangerousGhosts.length ? Math.min(...dangerousGhosts.map(g => g.pacDistance)) : Infinity;
      const nearestEuclid = dangerousGhosts.length
        ? Math.min(...dangerousGhosts.map(g => Math.hypot(g.ghost.x - this.game.pacman.x, g.ghost.y - this.game.pacman.y)))
        : Infinity;
      const exits = this.game.grid.availableDirections(pac.x, pac.y, "pacman");
      let safeExits = 0;
      for (const d of exits) {
        const route = this.traceCorridor(pac, d, 5);
        if (this.predictiveRouteSafety(route, { dangerousGhosts, ghostMaps }) >= 0.34) safeExits++;
      }
      const trap = exits.length ? 1 - safeExits / exits.length : 1;
      let threat = Number.isFinite(nearest) ? clamp((8 - nearest) / 7) : 0;
      const physicalThreat = Number.isFinite(nearestEuclid) ? clamp((3.0 - nearestEuclid) / 2.4) : 0;
      threat = clamp(0.62 * threat + 0.23 * trap + 0.15 * physicalThreat);
      // Enter defensive behavior before a corridor becomes a finished pincer.
      if (nearest <= 6 && safeExits <= 2) threat = Math.max(threat, 0.76);
      let immediateDanger = nearestEuclid <= 1.90 || nearest <= 4 || (nearest <= 7 && safeExits <= 1);
      const progress = this.game.grid.pellets.size ? 1 - pellets.length / this.game.grid.pellets.size : 1;
      const lifeCount = Math.max(0, Number(this.game.lives || 0));
      if (lifeCount <= 1) {
        if (nearest <= 6 && safeExits <= 2) threat = Math.max(threat, 0.82);
        if (nearest <= 5 || (nearest <= 8 && safeExits <= 1)) immediateDanger = true;
      } else if (lifeCount <= 2 && progress >= AI_CONFIG.conservativeProgress) {
        if (nearest <= 5 && safeExits <= 2) threat = Math.max(threat, 0.79);
      }
      const lives = Math.max(0, Number(this.game.lives || 0));
      const reliabilityMode = (lives <= 1 && progress >= 0.60) ||
        (lives <= 2 && progress >= AI_CONFIG.twoLifeProgress) ||
        progress >= 0.965;
      // Use the authoritative game-wide frightened timer. Individual ghosts may be
      // in HOME/exit states temporarily, but Pac-Man is still in the powered phase.
      const frightenedTime = Math.max(0, this.game.frightenedTimeRemaining());
      const f = {
        pac, pacDist, pellets, smallPellets, powerPellets,
        dangerousGhosts, edibleGhosts, ghostMaps,
        nearest, exits, safeExits, trap, threat, immediateDanger,
        progress, frightenedTime, nearestEuclid, lives, reliabilityMode, bonus: this.bonus(),
        powerKeys: new Set(powerPellets.map(key))
      };
      f.setups = powerPellets.map(p => this.analyzeSetup(p, f)).filter(Boolean);
      f.bestSetup = f.setups.sort((a, b) => b.value - a.value)[0] || null;
      return f;
    }

    bonus() {
      // Current professor base game has no fruit. This automatically activates
      // if a later modification adds game.bonus with x/y/value/timeRemaining.
      const b = this.game.bonus;
      if (!b || b.active === false) return null;
      return { x: Math.round(b.x), y: Math.round(b.y), value: Number(b.value || b.points || 0), timeRemaining: Number(b.timeRemaining || 0) };
    }

    analyzeSetup(pellet, f) {
      const pacDistance = f.pacDist.get(key(pellet)) ?? Infinity;
      if (!Number.isFinite(pacDistance)) return null;

      const active = f.dangerousGhosts;
      const distances = active
        .map(g => ({ name: g.name, d: f.ghostMaps.get(g.name).get(key(pellet)) ?? Infinity }))
        .filter(x => Number.isFinite(x.d))
        .sort((a, b) => a.d - b.d);
      const ds = distances.map(x => x.d);

      const stagingGhosts = ds.filter(d => d <= AI_CONFIG.setupGhostRange).length;
      const nearCount = ds.filter(d => d <= 8).length;
      const closest = ds[0] ?? Infinity;
      const second = ds[1] ?? Infinity;
      const third = ds[2] ?? Infinity;
      const fourth = ds[3] ?? Infinity;
      const avgTwo = ds.length >= 2 ? (closest + second) / 2 : Infinity;
      const avgThree = ds.length >= 3 ? (closest + second + third) / 3 : Infinity;
      const closeness = ds.length
        ? ds.reduce((sum, d) => sum + clamp(1 - d / AI_CONFIG.setupGhostRange), 0) / Math.max(1, active.length)
        : 0;
      const coverage = active.length ? stagingGhosts / active.length : 0;
      const clusterScore = clamp(0.60 * coverage + 0.40 * closeness);

      // Forecast how many ghosts are realistically harvestable after activation.
      // The thresholds get slightly looser for later captures because Pac-Man can
      // intercept fleeing ghosts rather than merely chase their starting cells.
      const captureThresholds = [3.5, 5.0, AI_CONFIG.powerThirdGhost, 8.5];
      let captureForecast = 0;
      for (let i = 0; i < Math.min(ds.length, 4); i++) {
        if (ds[i] <= captureThresholds[i]) captureForecast += 1;
      }

      const desiredCaptures = Math.min(active.length, active.length >= 3 ? AI_CONFIG.powerIdealCaptures : active.length);
      const idealReady = desiredCaptures > 0 && captureForecast >= desiredCaptures &&
                         (desiredCaptures < 3 || third <= AI_CONFIG.powerThirdGhost);
      const fallbackReady = captureForecast >= Math.min(2, Math.max(1, active.length)) &&
                            closest <= AI_CONFIG.powerClosestGhost && second <= AI_CONFIG.powerSecondGhost;

      // Setup may begin with two nearby ghosts, but activation aims for 3+ whenever
      // the board gives us enough active ghosts to make that possible.
      const earlyTrap = pacDistance <= 4 && closest <= 10 && second <= 18;
      const eligible = pacDistance <= AI_CONFIG.setupPacRange && (stagingGhosts >= 2 || earlyTrap);
      const waitedLongEnough = this.setupFocusKey === key(pellet) && this.setupWaitCenters >= AI_CONFIG.setupMaxWaitCenters;
      const ready = eligible && (idealReady || (waitedLongEnough && fallbackReady));
      const potentialGhostScore = this.chainScore(Math.max(0, captureForecast));
      const value = !eligible ? 0 :
        0.48 * clamp(potentialGhostScore / 2000) +
        0.32 * clusterScore +
        0.20 * (1 - clamp(pacDistance / AI_CONFIG.setupPacRange));

      return {
        pellet, activeGhosts: active.length, stagingGhosts, nearCount,
        closest, second, third, fourth, avgTwo, avgThree,
        clusterScore, captureForecast, desiredCaptures, idealReady,
        fallbackReady, waitedLongEnough, ready, eligible,
        potentialGhostScore, pacDistance, value
      };
    }

    chainScore(n) {
      let total = 0;
      const start = Math.max(1, this.game.ghostMultiplier || 1);
      for (let i = 0; i < n; i++) total += 200 * (start + i);
      return total;
    }

    reservedPowerZone(f, radius = 2) {
      const zone = new Set();
      for (const p of f.powerPellets || []) {
        const near = this.path.distances(p, radius);
        for (const [k, d] of near) if (d <= radius) zone.add(k);
      }
      return zone;
    }

    candidate(type, targetLike, f, opts = {}) {
      if (!targetLike) return null;
      const target = cell(targetLike);
      const forbidden = new Set(opts.forbidden || []);
      if (!opts.allowPower) for (const k of f.powerKeys) forbidden.add(k);
      else forbidden.delete(key(target));

      // Ordinary plans should not instantly go back onto the tile behind Pac-Man.
      // If blocking that one tile makes the target unreachable, we retry without
      // the restriction so dead ends remain solvable.
      let reverseKey = null;
      const current = this.currentAction();
      if (!opts.allowReverse && current !== "stop") {
        const revName = current === "left" ? "right" : current === "right" ? "left" : current === "up" ? "down" : "up";
        const revCell = this.path.next(f.pac, DIR[revName]);
        reverseKey = key(revCell);
        forbidden.add(reverseKey);
      }

      let route = this.path.path(f.pac, target, forbidden);
      if (!route && reverseKey) {
        forbidden.delete(reverseKey);
        route = this.path.path(f.pac, target, forbidden);
      }
      if (!route) return null;

      // Real A<->B suppression: if the shortest route immediately reuses an edge
      // that was just detected as a bounce, temporarily forbid that next cell and
      // ask A* for an alternate route. Emergencies/powered hunts bypass this because
      // a reversal may be tactically necessary.
      const tabuBypass = opts.ignoreTabu || type === "SAFE_ESCAPE" || type === "EDIBLE_GHOST" || type === "EMERGENCY_POWER_PELLET";
      if (!tabuBypass && route.length >= 2 && this.edgeIsTabu(route[0], route[1])) {
        const altForbidden = new Set(forbidden);
        altForbidden.add(key(route[1]));
        const alt = this.path.path(f.pac, target, altForbidden);
        if (alt) {
          route = alt;
          forbidden.clear();
          for (const k of altForbidden) forbidden.add(k);
        }
      }

      let reversalPenalty = 0;
      const first = this.routeFirstDirection(route);
      if (first && this.isReverseAction(current, first) && current !== "stop") reversalPenalty = 0.10;

      return {
        type, target, route, forbidden, reversalPenalty,
        pathLength: Math.max(0, route.length - 1),
        expectedScore: opts.expectedScore ?? this.pathScore(route, opts.allowPower),
        futureRaw: opts.futureRaw ?? this.localValue(target, f),
        safety: opts.safety ?? this.predictiveRouteSafety(route, f),
        utility: NaN,
        metadata: opts.metadata || null
      };
    }

    pathScore(route, allowPower) {
      let sum = 0;
      const seen = new Set();
      for (const c of route) {
        const k = key(c);
        if (seen.has(k)) continue;
        seen.add(k);
        const p = this.game.grid.pelletAt(c.x, c.y);
        if (!p || p.eaten || (p.type === "power" && !allowPower)) continue;
        sum += p.points;
      }
      return sum;
    }

    localValue(target, f) {
      const dist = this.path.distances(target, 6);
      let value = 0;
      for (const p of f.pellets) {
        const d = dist.get(key(p));
        if (d === undefined) continue;
        value += p.points * (0.4 + 0.6 * (1 - clamp(d / 7)));
      }
      return value;
    }

    traceCorridor(startLike, firstDir, maxTiles = 8) {
      const start = cell(startLike);
      const route = [start];
      let cur = start;
      let prevDir = firstDir;
      for (let i = 0; i < maxTiles; i++) {
        if (!this.game.grid.canMoveFrom(cur.x, cur.y, prevDir, "pacman")) break;
        cur = this.path.next(cur, prevDir);
        route.push(cur);
        if (this.game.grid.isDecisionCell(cur.x, cur.y, "pacman")) break;
        const dirs = this.game.grid.availableDirections(cur.x, cur.y, "pacman");
        const nextDirs = dirs.filter(d => !(d.x === -prevDir.x && d.y === -prevDir.y));
        if (!nextDirs.length) break;
        prevDir = nextDirs.find(d => d.x === prevDir.x && d.y === prevDir.y) || nextDirs[0];
      }
      return route;
    }

    predictiveRouteSafety(route, f) {
      if (!route || route.length < 2 || !f.dangerousGhosts.length) return 1;
      const horizon = Math.min(route.length - 1, AI_CONFIG.predictiveHorizon);
      let minMargin = Infinity;
      let hardIntercept = false;

      for (let i = 1; i <= horizon; i++) {
        const c = route[i];
        const pacETA = i / Math.max(0.1, this.game.pacman.speed);
        for (const g of f.dangerousGhosts) {
          const gd = f.ghostMaps.get(g.name).get(key(c));
          if (gd === undefined) continue;
          // A scattering ghost is still a physical hazard if nearby, but it is
          // not assumed to instantly abandon its corner and chase Pac-Man.
          const scatterDelay = g.state === "Scatter" && gd > 3 ? Math.min(1.5, Math.max(0, g.time || 0)) : 0;
          const ghostETA = scatterDelay + gd / Math.max(0.1, g.ghost.speed || 7);
          const margin = ghostETA - pacETA;
          minMargin = Math.min(minMargin, margin);
          if (margin <= AI_CONFIG.interceptSafetyMargin) hardIntercept = true;
        }
      }

      const end = route[Math.min(horizon, route.length - 1)];
      const exits = this.game.grid.availableDirections(end.x, end.y, "pacman").length;
      const exitFactor = exits <= 1 ? 0.55 : exits === 2 ? 0.82 : 1.0;
      if (!Number.isFinite(minMargin)) return exitFactor;
      const timing = clamp((minMargin + 0.35) / 2.2);
      return clamp((hardIntercept ? timing * 0.45 : timing) * exitFactor);
    }

    routeSafety(route, f) {
      return this.predictiveRouteSafety(route, f);
    }

    pelletCandidates(f, limit) {
      const nearest = f.smallPellets
        .map(p => ({ p, d: f.pacDist.get(key(p)) ?? Infinity }))
        .filter(x => Number.isFinite(x.d))
        .sort((a, b) => a.d - b.d)
        .slice(0, limit * 3);
      let list = nearest.map(({ p }) => {
        const c = this.candidate("PELLET_REGION", p, f, { futureRaw: this.localValue(p, f) });
        if (!c || c.safety < this.safetyFloor(f)) return null;
        if (this.recentCenters.includes(key(p))) c.futureRaw -= 220;
        return c;
      }).filter(Boolean);
      // If the strict floor removes every ordinary target, permit a conservative
      // fallback rather than freezing, but still avoid clearly losing routes.
      if (!list.length) {
        list = nearest.map(({ p }) => this.candidate("PELLET_REGION", p, f, { futureRaw: this.localValue(p, f) }))
          .filter(c => c && c.safety >= 0.18);
      }

      if (this.centerCounter < this.loopBreakUntil) {
        const fresh = list.filter(c => !this.recentCenters.includes(key(c.target)));
        if (fresh.length) list = fresh;
      }
      list.sort((a, b) => (b.futureRaw - b.pathLength * 5) - (a.futureRaw - a.pathLength * 5));
      return list.slice(0, limit);
    }

    canConsumePower(p, f, emergency = false) {
      const pellet = this.game.grid.pelletAt(p.x, p.y);
      if (!pellet || pellet.eaten || pellet.type !== "power") return false;
      const pd = f.pacDist.get(key(p)) ?? Infinity;
      if (pd > 1) return false; // final decision is always rechecked from an adjacent tile

      const setup = f.setups.find(x => key(x.pellet) === key(p));
      const distances = f.dangerousGhosts
        .map(g => f.ghostMaps.get(g.name).get(key(p)) ?? Infinity)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      if (emergency) {
        return f.threat >= 0.72 && distances.length >= 1 && distances[0] <= 5;
      }

      // Score-first activation: prefer a forecast of three captures whenever 3+
      // ghosts are active. A strong two-ghost setup is accepted only after Pac-Man
      // has invested time luring them or when the level is deep into endgame.
      if (setup?.idealReady) return true;
      if (setup?.fallbackReady && setup?.waitedLongEnough) return true;
      if (setup?.fallbackReady && f.progress >= 0.94) return true;
      return false;
    }

    powerCandidate(p, f, type = "POWER_PELLET", requireGate = false) {
      if (requireGate && !this.canConsumePower(p, f, false)) return null;
      const st = f.setups.find(x => key(x.pellet) === key(p));
      return this.candidate(type, p, f, {
        allowPower: true,
        allowReverse: true,
        expectedScore: 50,
        futureRaw: (st?.potentialGhostScore || 0) + this.localValue(p, f),
        metadata: st || null
      });
    }

    powerStagingCandidate(setup, f) {
      if (!setup?.pellet) return null;
      const around = this.path.neighbors(setup.pellet);
      const list = [];
      for (const t of around) {
        if (f.powerKeys.has(key(t))) continue;
        const c = this.candidate("POWER_STAGING", t, f, {
          expectedScore: 0,
          futureRaw: setup.potentialGhostScore + 900 * setup.clusterScore,
          metadata: { powerPellet: cell(setup.pellet) }
        });
        if (c && c.safety >= 0.35) list.push(c);
      }
      const best = this.utility.choose(list, FSM.SETUP);
      if (best) {
        this.stagedPowerCommitKey = key(setup.pellet);
        this.stagedPowerCommitUntilCenter = this.centerCounter + AI_CONFIG.stagedPowerCommitCenters;
      }
      return best;
    }

    stagedPowerCandidate(f) {
      const k = this.stagedPowerCommitKey;
      if (!k) return null;
      if (this.centerCounter > this.stagedPowerCommitUntilCenter) {
        this.stagedPowerCommitKey = null;
        return null;
      }
      const p = f.powerPellets.find(pp => key(pp) === k);
      if (!p) {
        this.stagedPowerCommitKey = null;
        return null;
      }
      const pd = f.pacDist.get(k) ?? Infinity;
      if (pd > 1) return null;
      const c = this.powerCandidate(p, f, "SETUP_COMMIT_POWER", false);
      if (!c) return null;
      c.utility = Math.max(Number.isFinite(c.utility) ? c.utility : 0, 50);
      c.metadata = { ...(c.metadata || {}), stagedCommit: true };
      return c;
    }

    adjacentEmergencyPower(f) {
      // Hard survival override: if Pac-Man is one legal move from a power pellet
      // and the alternatives are not genuinely safe, take the pellet immediately.
      // This prevents corner/dead-end stutter where score-preservation logic can
      // otherwise refuse the only move that turns nearby ghosts frightened.
      const pac = f.pac;
      const options = [];
      for (const d of this.game.grid.availableDirections(pac.x, pac.y, "pacman")) {
        const n = this.path.next(pac, d);
        const p = this.game.grid.pelletAt(n.x, n.y);
        if (!p || p.eaten || p.type !== "power") continue;

        let safeNonPower = 0;
        for (const alt of this.game.grid.availableDirections(pac.x, pac.y, "pacman")) {
          const nn = this.path.next(pac, alt);
          const pp = this.game.grid.pelletAt(nn.x, nn.y);
          if (pp && !pp.eaten && pp.type === "power") continue;
          const route = this.traceCorridor(pac, alt, 5);
          if (this.predictiveRouteSafety(route, f) >= 0.42) safeNonPower += 1;
        }

        const trapped = f.safeExits <= 1 || safeNonPower === 0;
        if (!(f.immediateDanger || f.threat >= 0.62 || trapped)) continue;

        const c = this.powerCandidate(p, f, "EMERGENCY_POWER_PELLET", false);
        if (!c) continue;
        c.utility = 100 - c.pathLength;
        c.safety = 1;
        c.metadata = { ...(c.metadata || {}), forcedEmergency: true, trapped, safeNonPower };
        options.push(c);
      }
      options.sort((a, b) => b.utility - a.utility);
      return options[0] || null;
    }

    safePower(f) {
      if (!f.immediateDanger && f.threat < 0.54) return null;
      const list = [];
      for (const p of f.powerPellets) {
        const pd = f.pacDist.get(key(p)) ?? Infinity;
        if (!Number.isFinite(pd) || pd > AI_CONFIG.emergencyPowerRange) continue;
        const c = this.powerCandidate(p, f, "EMERGENCY_POWER_PELLET", false);
        if (!c || c.pathLength > AI_CONFIG.emergencyPowerRange) continue;

        // Power pellets are special: the final tile becomes safe the instant Pac-Man
        // triggers it. Judge the approach separately, then compare arrival times at
        // the pellet instead of rejecting it because a ghost is also nearby.
        const prefix = c.route.length > 2 ? c.route.slice(0, -1) : c.route;
        const prefixSafety = prefix.length > 1 ? this.predictiveRouteSafety(prefix, f) : 1;
        if (prefixSafety < 0.12 && c.pathLength > 2) continue;

        const pacETA = Math.max(0, c.pathLength - 0.45) / Math.max(0.1, this.game.pacman.speed);
        let ghostETA = Infinity;
        for (const g of f.dangerousGhosts) {
          const gd = f.ghostMaps.get(g.name).get(key(p));
          if (gd === undefined) continue;
          const eta = gd / Math.max(0.1, g.ghost.speed || 6.4);
          ghostETA = Math.min(ghostETA, eta);
        }
        // Pac-Man needs to win or essentially tie the race; pickup happens before
        // the center because the pellet has a trigger radius.
        if (Number.isFinite(ghostETA) && pacETA > ghostETA + 0.05) continue;

        c.safety = Math.max(c.safety, prefixSafety);
        c.utility = 6.0 - 0.38 * c.pathLength + 1.8 * prefixSafety +
                    0.35 * Math.max(-1, Math.min(2, ghostETA - pacETA));
        list.push(c);
      }
      list.sort((a, b) => b.utility - a.utility);
      const best = list[0] || null;
      return best;
    }

    authorizePowerPellet(pellet) {
      if (!pellet || pellet.eaten || pellet.type !== "power") return false;
      const f = this.features();
      const k = key(pellet);

      // Survival override at the tile boundary. If this exact pellet is adjacent
      // and Pac-Man is trapped / under immediate pressure, never stop him at the
      // center waiting for another planner cycle.
      const pd = f.pacDist.get(k) ?? Infinity;
      if (pd <= 1) {
        let safeNonPower = 0;
        for (const d of this.game.grid.availableDirections(f.pac.x, f.pac.y, "pacman")) {
          const n = this.path.next(f.pac, d);
          const p = this.game.grid.pelletAt(n.x, n.y);
          if (p && !p.eaten && p.type === "power") continue;
          const route = this.traceCorridor(f.pac, d, 5);
          if (this.predictiveRouteSafety(route, f) >= 0.42) safeNonPower += 1;
        }
        if (f.immediateDanger || f.threat >= 0.62 || f.safeExits <= 1 || safeNonPower === 0) return true;
      }

      // Completion must remain possible. If no ordinary pellets remain, this power
      // pellet is a required endgame objective even without a perfect ghost cluster.
      if (!f.smallPellets.length) return true;

      // A life-saving commitment is latched long enough to prevent last-instant
      // indecision, but only for the exact pellet selected by the emergency branch.
      if (this.activePowerCommitKey === k) return true;
      if (this.stagedPowerCommitKey === k && this.centerCounter <= this.stagedPowerCommitUntilCenter) return true;

      return this.canConsumePower(pellet, f, false);
    }

    ghostInterceptTarget(g, f) {
      const ghostStart = cell(g.ghost);
      const pacCell = f.pac;
      const pacFrom = this.path.distances(pacCell);
      const ghostFromPac = this.ghostPath.distances(pacCell);
      const predicted = [ghostStart];
      let cur = ghostStart;
      let dir = g.ghost.direction && (g.ghost.direction.x || g.ghost.direction.y)
        ? g.ghost.direction : DIR.left;

      // Approximate the actual FRIGHTENED behavior: keep moving through corridors,
      // and at a decision choose a non-reversing branch that increases distance
      // from Pac-Man. This is much better than chasing the ghost's stale position.
      for (let step = 0; step < 3; step++) {
        let dirs = this.game.grid.availableDirections(cur.x, cur.y, "ghost");
        const nonReverse = dirs.filter(d => !(d.x === -dir.x && d.y === -dir.y));
        if (nonReverse.length) dirs = nonReverse;
        if (!dirs.length) break;
        let chosen = dirs.find(d => d.x === dir.x && d.y === dir.y);
        if (!chosen || this.game.grid.isDecisionCell(cur.x, cur.y, "ghost")) {
          let bestD = -Infinity;
          for (const d of dirs) {
            const n = this.ghostPath.next(cur, d);
            const away = ghostFromPac.get(key(n)) ?? manhattan(n, pacCell);
            if (away > bestD) { bestD = away; chosen = d; }
          }
        }
        if (!chosen) break;
        cur = this.ghostPath.next(cur, chosen);
        predicted.push(cur);
        dir = chosen;
      }

      let best = ghostStart, bestScore = Infinity;
      for (let i = 0; i < predicted.length; i++) {
        const c = predicted[i];
        const pd = pacFrom.get(key(c));
        if (pd === undefined) continue;
        const pacETA = pd / Math.max(0.1, this.game.pacman.speed);
        const ghostETA = i / Math.max(0.1, g.ghost.speed || 7);
        const timing = Math.abs(pacETA - ghostETA);
        const latePenalty = pacETA > ghostETA + 0.55 ? 1.5 : 0;
        const score = Math.max(pacETA, ghostETA) + 0.85 * timing + latePenalty + 0.08 * i;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      return best;
    }

    planGhostHuntSequence(f) {
      const ghosts = f.edibleGhosts.slice(0, 4);
      if (!ghosts.length) return { names: [], projectedScore: 0, captures: 0, time: 0 };

      const targets = new Map();
      for (const g of ghosts) targets.set(g.name, this.ghostInterceptTarget(g, f));
      const perms = [];
      const build = (prefix, rest) => {
        if (!rest.length) { perms.push(prefix); return; }
        for (let i = 0; i < rest.length; i++) build([...prefix, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
      };
      build([], ghosts);

      let best = { names: [], projectedScore: 0, captures: 0, time: Infinity, value: -Infinity };
      for (const perm of perms) {
        let pos = f.pac;
        let elapsed = 0;
        let score = 0;
        let captures = 0;
        let multiplier = Math.max(1, this.game.ghostMultiplier || 1);
        let firstLegTime = Infinity;
        const names = [];

        for (const g of perm) {
          const target = targets.get(g.name) || g.cell;
          const route = this.path.path(pos, target, f.powerKeys);
          if (!route) continue;
          const dist = Math.max(0, route.length - 1);
          // Inflate static path time because frightened ghosts continue to flee.
          const legTime = (dist / Math.max(0.1, this.game.pacman.speed)) * 1.18 + 0.10;
          if (!captures) firstLegTime = legTime;
          elapsed += legTime;
          if (elapsed + 0.42 >= f.frightenedTime) break;
          score += 200 * multiplier;
          multiplier += 1;
          captures += 1;
          names.push(g.name);
          pos = target;
        }

        // Number of captures is primary because each additional ghost grows the
        // chain multiplier. Projected score breaks ties, then faster chains win.
        const firstPenalty = Number.isFinite(firstLegTime) ? firstLegTime * 250 : 1000;
        const value = captures * 5000 + score * 4 - elapsed * 35 - firstPenalty;
        if (value > best.value) best = { names, projectedScore: score, captures, time: elapsed, value };
      }
      return best;
    }

    poweredGhostCandidate(f) {
      if (!f.edibleGhosts.length) {
        this.lockedGhostName = null;
        this.lockedGhostAnchor = null;
        this.huntQueue = [];
        this.huntProjectedScore = 0;
        return null;
      }

      const make = g => {
        const target = this.ghostInterceptTarget(g, f);
        const points = 200 * Math.max(1, this.game.ghostMultiplier || 1);
        const c = this.candidate("EDIBLE_GHOST", target, f, {
          allowReverse: true,
          expectedScore: points,
          futureRaw: Math.max(points, this.huntProjectedScore || this.chainScore(f.edibleGhosts.length)),
          metadata: { ghost: g.name, frightenedTime: g.time, huntQueue: [...this.huntQueue] }
        });
        if (!c) return null;
        const eta = c.pathLength / Math.max(0.1, this.game.pacman.speed);
        const reserve = g.time <= 2.5 ? 0.85 : 0.42;
        if (eta + reserve >= g.time) return null;
        return c;
      };

      // Keep the same ghost identity until captured/unavailable. The target point
      // can move, but the target ghost does not. This is essential for a clean chain.
      if (this.lockedGhostName) {
        const locked = f.edibleGhosts.find(g => g.name === this.lockedGhostName);
        const c = locked ? make(locked) : null;
        if (c) return c;
        if (this.huntQueue[0] === this.lockedGhostName) this.huntQueue.shift();
        else this.huntQueue = this.huntQueue.filter(n => n !== this.lockedGhostName);
        this.lockedGhostName = null;
        this.lockedGhostAnchor = null;
      }

      const edibleNames = new Set(f.edibleGhosts.map(g => g.name));
      this.huntQueue = this.huntQueue.filter(n => edibleNames.has(n));
      if (!this.huntQueue.length) {
        const plan = this.planGhostHuntSequence(f);
        this.huntQueue = [...plan.names];
        this.huntProjectedScore = plan.projectedScore;
      }

      while (this.huntQueue.length) {
        const name = this.huntQueue[0];
        const g = f.edibleGhosts.find(x => x.name === name);
        const c = g ? make(g) : null;
        if (c) {
          this.lockedGhostName = name;
          this.lockedGhostAnchor = c.target ? { ...c.target } : null;
          this.lockedGhostAnchorCenter = this.centerCounter;
          return c;
        }
        this.huntQueue.shift();
      }

      // If the planned chain became invalid because ghosts changed direction,
      // recompute once using the current positions rather than falling back to food.
      const replanned = this.planGhostHuntSequence(f);
      this.huntQueue = [...replanned.names];
      this.huntProjectedScore = replanned.projectedScore;
      if (this.huntQueue.length) {
        const g = f.edibleGhosts.find(x => x.name === this.huntQueue[0]);
        const c = g ? make(g) : null;
        if (c) {
          this.lockedGhostName = g.name;
          this.lockedGhostAnchor = c.target ? { ...c.target } : null;
          this.lockedGhostAnchorCenter = this.centerCounter;
          return c;
        }
      }
      return null;
    }

    edibleGhostCandidates(f) {
      const c = this.poweredGhostCandidate(f);
      return c ? [c] : [];
    }

    poweredRepositionCandidate(f) {
      if (!f.edibleGhosts.length || f.frightenedTime < 1.4) return null;
      const candidates = [];
      for (const g of f.edibleGhosts) {
        const target = this.ghostInterceptTarget(g, f);
        const c = this.candidate("POWERED_REPOSITION", target, f, {
          allowReverse: true,
          expectedScore: 0,
          futureRaw: this.chainScore(f.edibleGhosts.length)
        });
        if (!c) continue;
        const eta = c.pathLength / Math.max(0.1, this.game.pacman.speed);
        c.utility = -eta + 0.25 * c.safety;
        candidates.push(c);
      }
      candidates.sort((a, b) => b.utility - a.utility);
      return candidates[0] || null;
    }

    survivalSearchCandidate(f, allowPower = false, horizon = 10) {
      if (!f.dangerousGhosts.length) return null;
      const start = f.pac;
      const speed = Math.max(0.1, this.game.pacman.speed || 8);
      const current = this.currentAction();
      const powerKeys = f.powerKeys || new Set();
      let best = null;

      const ghostMarginAt = (c, step) => {
        const pacETA = step / speed;
        let minMargin = Infinity;
        let minGhostDist = Infinity;
        for (const g of f.dangerousGhosts) {
          const gd = f.ghostMaps.get(g.name).get(key(c));
          if (gd === undefined) continue;
          const ghostETA = gd / Math.max(0.1, g.ghost.speed || 6.2);
          minMargin = Math.min(minMargin, ghostETA - pacETA);
          minGhostDist = Math.min(minGhostDist, gd);
        }
        return { minMargin, minGhostDist };
      };

      const dfs = (c, prevDir, step, worstMargin, route, visited, firstAction) => {
        const gm = ghostMarginAt(c, step);
        const nextWorst = Math.min(worstMargin, gm.minMargin);
        if (nextWorst < -0.08) return;

        const exits = this.game.grid.availableDirections(c.x, c.y, "pacman");
        const leaf = step >= horizon || !exits.length;
        if (leaf) {
          const open = exits.length;
          const safetyScore = 5.5 * clamp((nextWorst + 0.25) / 1.65) +
                              0.30 * Math.min(gm.minGhostDist, 10) +
                              0.45 * Math.min(open, 3) -
                              0.10 * step;
          if (!best || safetyScore > best.score) {
            best = { score: safetyScore, route: [...route], action: firstAction, worstMargin: nextWorst };
          }
          return;
        }

        let dirs = exits;
        if (prevDir) {
          const nonReverse = dirs.filter(d => !(d.x === -prevDir.x && d.y === -prevDir.y));
          if (nonReverse.length) dirs = nonReverse;
        }

        for (const d of dirs) {
          const n = this.path.next(c, d);
          const nk = key(n);
          const p = this.game.grid.pelletAt(n.x, n.y);
          if (!allowPower && p && !p.eaten && p.type === "power") continue;
          // Avoid short cycles in the look-ahead unless every route is forced.
          const repeats = visited.has(nk);
          if (repeats && dirs.length > 1) continue;
          const nextVisited = new Set(visited);
          nextVisited.add(nk);
          dfs(n, d, step + 1, nextWorst, [...route, n], nextVisited, firstAction || d.name);
        }

        // If every legal continuation was pruned, still score the current prefix.
        if (step > 0 && (!best || best.route.length < route.length)) {
          const safetyScore = 5.0 * clamp((nextWorst + 0.25) / 1.65) +
                              0.25 * Math.min(gm.minGhostDist, 10) +
                              0.35 * Math.min(exits.length, 3) -
                              0.10 * step;
          if (!best || safetyScore > best.score) best = { score: safetyScore, route: [...route], action: firstAction, worstMargin: nextWorst };
        }
      };

      let initialDirs = this.game.grid.availableDirections(start.x, start.y, "pacman");
      if (current && current !== "stop") {
        // Prefer not to reverse unless the look-ahead proves it is the safer branch.
        initialDirs = [...initialDirs].sort((a, b) => {
          const ar = this.isReverseAction(current, a.name) ? 1 : 0;
          const br = this.isReverseAction(current, b.name) ? 1 : 0;
          return ar - br;
        });
      }
      for (const d of initialDirs) {
        const n = this.path.next(start, d);
        const p = this.game.grid.pelletAt(n.x, n.y);
        if (!allowPower && p && !p.eaten && p.type === "power") continue;
        dfs(n, d, 1, Infinity, [start, n], new Set([key(start), key(n)]), d.name);
      }

      if (!best || !best.route || best.route.length < 2) return null;
      return {
        type: "SAFE_ESCAPE",
        target: best.route[best.route.length - 1],
        route: best.route,
        forbidden: new Set(),
        pathLength: best.route.length - 1,
        expectedScore: 0,
        futureRaw: Math.max(0, best.score) * 120,
        safety: clamp((best.worstMargin + 0.30) / 1.7),
        utility: best.score,
        metadata: { survivalLookahead: true, worstMargin: best.worstMargin }
      };
    }

    emergency(f, allowPower) {
      if (allowPower) {
        const adjacent = this.adjacentEmergencyPower(f);
        if (adjacent) return adjacent;
        const p = this.safePower(f);
        if (p) return p;
      }

      // Search multiple junctions ahead before choosing an escape corridor. The
      // old one-corridor heuristic could select a route that became a pincer trap
      // immediately after the next junction.
      const useDeep = f.reliabilityMode || f.lives <= 2 || f.progress >= 0.82;
      if (useDeep) {
        const deep = this.survivalSearchCandidate(f, false, f.reliabilityMode ? 12 : 9);
        if (deep) return deep;
      }

      const options = this.escapeOptions(f, false);
      const best = options[0];
      if (!best) return null;
      return {
        type: "SAFE_ESCAPE",
        target: best.route[best.route.length - 1],
        route: best.route,
        forbidden: new Set(),
        pathLength: Math.max(1, best.route.length - 1),
        expectedScore: 0,
        futureRaw: best.value * 100,
        safety: best.predictiveSafety,
        utility: best.value,
        metadata: { exits: best.exits, distanceGain: best.distanceGain }
      };
    }

    patrolCandidate(f, aroundLike = null) {
      const origin = aroundLike ? cell(aroundLike) : f.pac;
      const dist = this.path.distances(origin, 10, f.powerKeys);
      const options = [];
      for (const [k, d] of dist) {
        if (d < 3 || d > 8 || f.powerKeys.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        if (!this.game.grid.isDecisionCell(x, y, "pacman")) continue;
        const c = this.candidate("PATROL", { x, y }, f, {
          expectedScore: 0,
          futureRaw: this.localValue({ x, y }, f) + 150,
          metadata: { patrol: true }
        });
        if (!c || c.safety < 0.45) continue;
        const recentPenalty = this.recentCenters.includes(k) ? 0.18 : 0;
        c.utility = c.safety + 0.02 * c.pathLength - recentPenalty;
        options.push(c);
      }
      options.sort((a, b) => b.utility - a.utility);
      return options[0] || null;
    }

    scoreHoldCandidate(f, powerPellet) {
      if (!powerPellet) return null;
      const smallKeys = new Set(f.smallPellets.map(key));
      const around = this.path.distances(powerPellet, 7, f.powerKeys);
      const options = [];
      for (const [k, d] of around) {
        if (d < 3 || d > 6 || f.powerKeys.has(k) || smallKeys.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        if (!this.game.grid.isDecisionCell(x, y, "pacman")) continue;
        let c = this.candidate("SCORE_HOLD", { x, y }, f, {
          forbidden: new Set([...f.powerKeys, ...smallKeys]),
          expectedScore: 0,
          futureRaw: 900
        });
        if (!c) {
          // If a completely pellet-free route does not exist, permit the target but
          // still prefer paths that consume as few remaining ordinary dots as possible.
          c = this.candidate("SCORE_HOLD", { x, y }, f, { expectedScore: 0, futureRaw: 650 });
        }
        if (!c || c.safety < 0.42) continue;
        const pelletLoss = c.route.filter(rc => smallKeys.has(key(rc))).length;
        c.utility = 2.8 * c.safety - 0.45 * pelletLoss - 0.04 * c.pathLength;
        options.push(c);
      }
      options.sort((a, b) => b.utility - a.utility);
      return options[0] || null;
    }

    lureGhosts(setup, f) {
      const around = this.path.distances(setup.pellet, 6, f.powerKeys);
      const options = [];
      const ghosts = f.dangerousGhosts.filter(g => {
        const d = f.ghostMaps.get(g.name).get(key(setup.pellet));
        return d !== undefined && d <= AI_CONFIG.setupGhostRange + 2;
      });
      const gx = ghosts.length ? ghosts.reduce((a, g) => a + g.cell.x, 0) / ghosts.length : setup.pellet.x;
      const gy = ghosts.length ? ghosts.reduce((a, g) => a + g.cell.y, 0) / ghosts.length : setup.pellet.y;
      const awayX = setup.pellet.x - gx, awayY = setup.pellet.y - gy;
      const awayNorm = Math.hypot(awayX, awayY) || 1;

      for (const [k, dp] of around) {
        if (dp < 2 || dp > 5 || f.powerKeys.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        const vx = x - setup.pellet.x, vy = y - setup.pellet.y;
        const vnorm = Math.hypot(vx, vy) || 1;
        const alignment = (vx * awayX + vy * awayY) / (vnorm * awayNorm);
        const exits = this.game.grid.availableDirections(x, y, "pacman").length;
        const c = this.candidate("LURE_GHOSTS", { x, y }, f, {
          forbidden: f.powerKeys,
          expectedScore: 0,
          futureRaw: setup.potentialGhostScore + 1200 * setup.clusterScore,
          metadata: { clusterScore: setup.clusterScore, powerPellet: cell(setup.pellet) }
        });
        if (!c || c.safety < 0.38) continue;

        // Funnel score: favor lure points whose ghost-to-Pac-Man routes pass close
        // to the power pellet. This creates an actual trap instead of merely waiting
        // on the opposite side of the pellet.
        let funnel = 0;
        for (const g of ghosts) {
          const gr = this.ghostPath.path(g.cell, { x, y });
          if (!gr) continue;
          let minPellet = Infinity;
          for (const rc of gr) minPellet = Math.min(minPellet, manhattan(rc, setup.pellet));
          if (minPellet === 0) funnel += 1.0;
          else if (minPellet === 1) funnel += 0.75;
          else if (minPellet === 2) funnel += 0.35;
        }
        const funnelNorm = ghosts.length ? funnel / ghosts.length : 0;
        const recentPenalty = this.recentCenters.includes(k) ? 2.0 : 0;
        const value = 3.0 * funnelNorm + 2.0 * alignment + 0.9 * exits +
                      2.0 * c.safety - 0.22 * dp - recentPenalty;
        options.push({ c, value });
      }
      options.sort((a, b) => b.value - a.value);
      return options[0]?.c || null;
    }

    routeFirstDirection(route) {
      if (!route || route.length < 2) return null;
      const a = route[0], b = route[1];
      if (a.y === 1 && a.x === 13 && b.x === -14) return "right";
      if (a.y === 1 && a.x === -14 && b.x === 13) return "left";
      if (b.x > a.x) return "right";
      if (b.x < a.x) return "left";
      if (b.y > a.y) return "up";
      if (b.y < a.y) return "down";
      return null;
    }

    nextAction(c, f) {
      if (!c) return "stop";
      const route = (c.route && key(c.route[0]) === key(f.pac)) ? c.route : this.path.path(f.pac, c.target, c.forbidden);
      if (!route || route.length < 2) return "stop";
      return this.routeFirstDirection(route) || "stop";
    }

    updatePanel() {
      if (this.game?.headless) return;
      const put = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      put("aiState", this.debug.fsmState);
      put("aiBehavior", this.debug.behavior);
      put("aiTarget", this.debug.target);
      put("aiUtility", this.debug.utility === null ? "—" : this.debug.utility.toFixed(3));
    }
  }

  function install(game) {
    if (game.__builtInAIInstalled) return;
    game.__builtInAIInstalled = true;
    const ai = new PacManAI(game);
    game.aiController = ai;
    game.builtInAgent = () => ai.decide();

    // Always keep the built-in AI attached. This page has no human Pac-Man mode.
    game.setAgent(game.builtInAgent);
    game.clearAgent = function clearAgentDisabled() {
      this.setAgent(this.builtInAgent);
      return this;
    };

    const wrapReset = methodName => {
      const original = game[methodName].bind(game);
      game[methodName] = (...args) => {
        ai.reset();
        game.setAgent(game.builtInAgent);
        return original(...args);
      };
    };
    wrapReset("start");
    wrapReset("restart");
    wrapReset("newRound");

    // Add AI state to the public state snapshot used for experiments/evaluation.
    const oldGetState = game.getState.bind(game);
    game.getState = () => ({
      ...oldGetState(),
      ai: {
        fsmState: ai.debug.fsmState,
        behavior: ai.debug.behavior,
        target: ai.debug.target,
        utility: ai.debug.utility,
        ghostCluster: ai.debug.cluster
      }
    });

    // Block every keyboard command before the Unity-port keyboard listener sees it.
    window.addEventListener("keydown", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    // The buttons remain meta-controls only: Start AI, Pause, Restart, Sound.
    const start = document.getElementById("startBtn");
    if (start) start.textContent = "Start AI";
  }

  // Exposed only for deterministic test harnesses and later assignment experiments.
  window.__pacmanAIInternals = { PacManAI, PacManFSM, BehaviorTree, HRAUtility, Pathfinder, FSM, DIR };

  const attachTimer = setInterval(() => {
    if (!window.pacmanGame) return;
    clearInterval(attachTimer);
    install(window.pacmanGame);
  }, 20);
})();
