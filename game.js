"use strict";

/*
  Browser port of the supplied Unity Pac-Man project.

  Unity source mapping:
    GameMgr.cs       -> PacManGame scoring/lives/round lifecycle
    GridMgr.cs       -> Maze grid + pellet/navigation data
    Pacman.cs        -> PacmanActor input/state
    Movement.cs      -> Actor grid movement + buffered turns
    Pellet.cs        -> pellet consumption
    PowerPellet.cs   -> frightened mode (8 s)
    Teleporter.cs    -> side tunnel warp at world y = 1
    GhostNew.cs      -> ghost timing/state modes + browser Behavior Trees
    GhostPhysics.cs  -> grid navigation/collision handling
    CmdHome.cs       -> HOME / explicit house-exit branch
    CmdScatter.cs    -> per-ghost corner scatter branch
    CmdChaser.cs     -> four unique chase subtrees
    CmdFrightened.cs -> shared frightened flee branch
    SfxMgr.cs        -> browser Audio objects
*/

const TILE = 24;
const MAZE_LEFT = -14;
const MAZE_TOP = 18;
const WALLS = new Set(["=", "|", "/", "\\", "L", "R"]);
const DIRECTIONS = Object.freeze({
  up:    Object.freeze({ x: 0, y: 1, name: "up" }),
  down:  Object.freeze({ x: 0, y: -1, name: "down" }),
  left:  Object.freeze({ x: -1, y: 0, name: "left" }),
  right: Object.freeze({ x: 1, y: 0, name: "right" }),
  stop:  Object.freeze({ x: 0, y: 0, name: "stop" })
});

const LEVEL_1_MAZE = [
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "/============\\/============\\",
  "|............||............|",
  "|./==\\./===\\.||./===\\./==\\.|",
  "|o|XX|.|XXX|.||.|XXX|.|XX|o|",
  "|.L==R.L===R.LR.L===R.L==R.|",
  "|..........................|",
  "|./==\\./\\./======\\./\\./==\\.|",
  "|.L==R.||.L==\\/==R.||.L==R.|",
  "|......||....||....||......|",
  "L====\\.|L==\\ || /==R|./====R",
  "XXXXX|.|/==R LR L==\\|.|XXXXX",
  "XXXXX|.||XXXXXXXXXX||.|XXXXX",
  "XXXXX|.||X/==--==\\X||.|XXXXX",
  "=====R.LRX|XXXXXX|XLR.L=====",
  "XXXXXX.XXX|XXXXXX|XXX.XXXXXX",
  "=====\\./\\X|XXXXXX|X/\\./=====",
  "XXXXX|.||XL======RX||.|XXXXX",
  "XXXXX|.||XXXXXXXXXX||.|XXXXX",
  "XXXXX|.||X/======\\X||.|XXXXX",
  "/====R.LRXL==\\/==RXLR.L====\\",
  "|............||............|",
  "|./==\\./===\\.||./===\\./==\\.|",
  "|.L=\\|.L===R.LR.L===R.|/=R.|",
  "|o..||................||..o|",
  "L=\\.||./\\./======\\./\\.||./=R",
  "/=R.LR.||.L==\\/==R.||.LR.L=\\",
  "|......||....||....||......|",
  "|./====RL==\\.||./==RL====\\.|",
  "|.L========R.LR.L========R.|",
  "|..........................|",
  "L==========================R",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
];

const LEVEL_2_MAZE = [
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "/============\\/============\\",
  "|............||............|",
  "|./_=\\./=_=\\.||./=_=\\./=_\\.|",
  "|o|_X|.|X_X|.||.|X_X|.|X_|o|",
  "|.L_=R.L=_=R.LR.L=_=R.L=_R.|",
  "|..........................|",
  "|./_=\\./\\./=_==_=\\./\\./=_\\.|",
  "|.L_=R.||.L=_\\/_=R.||.L=_R.|",
  "|......__....||....__......|",
  "L====\\.|L==\\ || /==R|./====R",
  "XXXXX|.|/==R LR L==\\|.|XXXXX",
  "XXXXX|.||XXXXXXXXXX||.|XXXXX",
  "XXXXX|.||X/==--==\\X||.|XXXXX",
  "=====R.LRX|XXXXXX|XLR.L=====",
  "XXXXXX.XXX|XXXXXX|XXX.XXXXXX",
  "=====\\./\\X|XXXXXX|X/\\./=====",
  "XXXXX|.||XL======RX||.|XXXXX",
  "XXXXX|.||XXXXXXXXXX||.|XXXXX",
  "XXXXX|.||X/======\\X||.|XXXXX",
  "/====R.LRXL==\\/==RXLR.L====\\",
  "|............__............|",
  "|./_=\\./=_=\\.||./=_=\\./=_\\.|",
  "|.L_\\|.L=_=R.LR.L=_=R.|/_R.|",
  "|o..__................__..o|",
  "L=\\.||./\\./======\\./\\.||./=R",
  "/=R.LR.||.L==\\/==R.||.LR.L=\\",
  "|......__....||....__......|",
  "|./==_=RL==_.||._==RL=_==\\.|",
  "|.L==_=====_.LR._=====_==R.|",
  "|..........................|",
  "L==========================R",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
];

const LEVELS = Object.freeze([
  Object.freeze({ name: "Classic", maze: LEVEL_1_MAZE }),
  Object.freeze({ name: "Crossroads", maze: LEVEL_2_MAZE })
]);

function levelDefinition(level) {
  const index = Math.min(Math.max(1, Math.floor(level || 1)) - 1, LEVELS.length - 1);
  return LEVELS[index];
}


const ASSET_PATHS = {
  walls: {
    "=": "assets/sprites/HorizontalTIle.png",
    "|": "assets/sprites/VerticalTile.png",
    "/": "assets/sprites/TopLeftTile.png",
    "\\": "assets/sprites/TopRightTile.png",
    "L": "assets/sprites/BottomLeftTile.png",
    "R": "assets/sprites/BottomRightTile.png"
  },
  pacman: [
    "assets/sprites/Pacman_01.png",
    "assets/sprites/Pacman_02.png",
    "assets/sprites/Pacman_03.png"
  ],
  pellet: "assets/sprites/Pellet_Small.png",
  powerPellet: "assets/sprites/Pellet_Large.png",
  ghostBody: [
    "assets/sprites/Ghost_Body_01.png",
    "assets/sprites/Ghost_Body_02.png"
  ],
  ghostVulnerableBlue: [
    "assets/sprites/Ghost_Vulnerable_Blue_01.png",
    "assets/sprites/Ghost_Vulnerable_Blue_02.png"
  ],
  ghostVulnerableWhite: [
    "assets/sprites/Ghost_Vulnerable_White_01.png",
    "assets/sprites/Ghost_Vulnerable_White_02.png"
  ],
  eyes: {
    up: "assets/sprites/Ghost_Eyes_Up.png",
    down: "assets/sprites/Ghost_Eyes_Down.png",
    left: "assets/sprites/Ghost_Eyes_Left.png",
    right: "assets/sprites/Ghost_Eyes_Right.png"
  },
  sounds: {
    eatPellet: "assets/sounds/eat_dot_0.wav",
    eatPower: "assets/sounds/eat_dot_1.wav",
    eatGhost: "assets/sounds/eat_ghost.wav",
    frightened: "assets/sounds/fright.wav",
    chase: "assets/sounds/siren1.wav",
    gameOver: "assets/sounds/death_0.wav",
    ready: "assets/sounds/start.wav"
  }
};

function sameDir(a, b) { return a.x === b.x && a.y === b.y; }
function opposite(a, b) { return a.x === -b.x && a.y === -b.y; }
function cloneDir(d) { return { x: d.x, y: d.y, name: d.name || "" }; }
function sqr(v) { return v * v; }
function distSq(a, b) { return sqr(a.x - b.x) + sqr(a.y - b.y); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function padScore(score) { return String(Math.max(0, Math.floor(score))).padStart(5, "0"); }

class AssetBank {
  constructor() {
    this.images = new Map();
  }

  async load() {
    const imagePaths = [
      ...Object.values(ASSET_PATHS.walls),
      ...ASSET_PATHS.pacman,
      ASSET_PATHS.pellet,
      ASSET_PATHS.powerPellet,
      ...ASSET_PATHS.ghostBody,
      ...ASSET_PATHS.ghostVulnerableBlue,
      ...ASSET_PATHS.ghostVulnerableWhite,
      ...Object.values(ASSET_PATHS.eyes)
    ];
    await Promise.all([...new Set(imagePaths)].map(path => this.loadImage(path)));
  }

  loadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.images.set(path, img); resolve(img); };
      img.onerror = () => reject(new Error(`Could not load ${path}`));
      img.src = path;
    });
  }

  image(path) { return this.images.get(path); }
}

class SoundBank {
  constructor() {
    this.muted = false;
    this.sounds = {};
    for (const [key, path] of Object.entries(ASSET_PATHS.sounds)) {
      const audio = new Audio(path);
      audio.preload = "auto";
      this.sounds[key] = audio;
    }
  }

  play(name, restart = true) {
    if (this.muted) return;
    const base = this.sounds[name];
    if (!base) return;
    try {
      const audio = base.cloneNode();
      if (restart) audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }

  setMuted(value) { this.muted = Boolean(value); }
}

class SilentSoundBank {
  constructor() { this.muted = true; }
  play() {}
  setMuted(value) { this.muted = Boolean(value); }
}

class MazeGrid {
  constructor(lines) {
    this.lines = lines;
    this.height = lines.length;
    this.width = Math.max(...lines.map(line => line.length));
    this.pellets = new Map();
    this.resetPellets();
  }

  key(x, y) { return `${Math.round(x)},${Math.round(y)}`; }

  worldToCell(x, y) {
    return { col: Math.round(x) - MAZE_LEFT, row: MAZE_TOP - Math.round(y) };
  }

  cellToWorld(col, row) {
    return { x: col + MAZE_LEFT, y: MAZE_TOP - row };
  }

  charAtWorld(x, y) {
    const { col, row } = this.worldToCell(x, y);
    if (row < 0 || row >= this.height || col < 0 || col >= this.lines[row].length) return null;
    return this.lines[row][col];
  }

  isGhostHouseCell(x, y) {
    const cx = Math.round(x), cy = Math.round(y);
    // Interior/door region reserved for ghosts. Pac-Man may move through other
    // X cells (such as tunnel/blank corridors) but never through the house.
    return cx >= -3 && cx <= 2 && cy >= 0 && cy <= 4;
  }

  isWall(x, y, actorType = "pacman") {
    const ch = this.charAtWorld(x, y);
    if (ch === null || WALLS.has(ch)) return true;

    if (actorType !== "ghost") {
      // Pac-Man should use the playable corridor graph, not the black filler/ghost
      // spaces. Every collectible corridor cell is '.' or 'o'. The only required
      // pellet-free Pac-Man cells are the black side-tunnel cells at world y=1.
      // This keeps all 246 pellets reachable while eliminating ghost-house
      // shortcuts that caused the AI to enter lethal central spaces.
      const cx = Math.round(x), cy = Math.round(y);
      const tunnelFloor = cy === 1 && ch === "X";
      if (ch !== "." && ch !== "o" && ch !== "_" && !tunnelFloor) return true;
      if (this.isGhostHouseCell(cx, cy)) return true;
    }
    return false;
  }

  canMoveFrom(x, y, dir, actorType = "pacman") {
    if (!dir || (dir.x === 0 && dir.y === 0)) return true;
    const cx = Math.round(x);
    const cy = Math.round(y);

    // Unity teleporters sit outside the normal 28-column maze at y = 1.
    if (cy === 1 && cx === 13 && dir.x === 1) return true;
    if (cy === 1 && cx === -14 && dir.x === -1) return true;

    return !this.isWall(cx + dir.x, cy + dir.y, actorType);
  }

  availableDirections(x, y, actorType = "pacman") {
    const dirs = [DIRECTIONS.up, DIRECTIONS.down, DIRECTIONS.left, DIRECTIONS.right];
    return dirs.filter(d => this.canMoveFrom(x, y, d, actorType));
  }

  isDecisionCell(x, y, actorType = "pacman") {
    const dirs = this.availableDirections(x, y, actorType);
    if (dirs.length > 2) return true;
    if (dirs.length === 2) return !opposite(dirs[0], dirs[1]);
    return dirs.length <= 1;
  }

  resetPellets() {
    this.pellets.clear();
    for (let row = 0; row < this.lines.length; row++) {
      const line = this.lines[row];
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        if (ch !== "." && ch !== "o") continue;
        const p = this.cellToWorld(col, row);
        this.pellets.set(this.key(p.x, p.y), {
          x: p.x,
          y: p.y,
          type: ch === "o" ? "power" : "small",
          points: ch === "o" ? 50 : 10,
          eaten: false
        });
      }
    }
  }

  activePelletCount() {
    let count = 0;
    for (const pellet of this.pellets.values()) if (!pellet.eaten) count++;
    return count;
  }

  pelletAt(x, y) {
    return this.pellets.get(this.key(x, y)) || null;
  }
}

class Actor {
  constructor(game, x, y, speed, actorType = "pacman") {
    this.game = game;
    this.actorType = actorType;
    this.x = x;
    this.y = y;
    this.speed = speed;
    this.direction = cloneDir(DIRECTIONS.stop);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
    this.lastCenterKey = "";
    this.enabled = true;
    this.prevX = x;
    this.prevY = y;
    this.teleportedThisFrame = false;
    // True only when the actor changes heading at a tile center during this
    // simulation step. Swept collision is disabled for that actor on the step
    // because a single straight segment would cut diagonally through the corner.
    this.turnedThisFrame = false;
  }

  setDirection(dir, forced = false) {
    if (!dir) return;
    const cx = Math.round(this.x);
    const cy = Math.round(this.y);
    const centered = Math.abs(this.x - cx) < 0.08 && Math.abs(this.y - cy) < 0.08;
    const reversing = opposite(dir, this.direction);
    if (forced || reversing || (centered && this.game.grid.canMoveFrom(cx, cy, dir, this.actorType))) {
      this.direction = cloneDir(dir);
      this.nextDirection = cloneDir(DIRECTIONS.stop);
    } else {
      this.nextDirection = cloneDir(dir);
    }
  }

  nearCenter(step) {
    return Math.abs(this.x - Math.round(this.x)) <= step + 0.035 &&
           Math.abs(this.y - Math.round(this.y)) <= step + 0.035;
  }

  snapCenter() {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
  }

  updateMovement(dt, beforeMoveAtCenter = null) {
    if (!this.enabled) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.teleportedThisFrame = false;
    this.turnedThisFrame = false;
    const step = this.speed * dt;

    if (this.nearCenter(step)) {
      const cx = Math.round(this.x);
      const cy = Math.round(this.y);
      const centerKey = `${cx},${cy}`;
      if (centerKey !== this.lastCenterKey) {
        this.x = cx;
        this.y = cy;
        this.lastCenterKey = centerKey;

        const dirBeforeCenter = cloneDir(this.direction);
        if (beforeMoveAtCenter) beforeMoveAtCenter(cx, cy);

        if ((this.nextDirection.x !== 0 || this.nextDirection.y !== 0) &&
            this.game.grid.canMoveFrom(cx, cy, this.nextDirection, this.actorType)) {
          this.direction = cloneDir(this.nextDirection);
          this.nextDirection = cloneDir(DIRECTIONS.stop);
        }

        if (!this.game.grid.canMoveFrom(cx, cy, this.direction, this.actorType)) {
          this.direction = cloneDir(DIRECTIONS.stop);
        }

        if (this.direction.x !== dirBeforeCenter.x || this.direction.y !== dirBeforeCenter.y) {
          this.turnedThisFrame = true;
        }

        // Strategic power pellets are never entered accidentally. The game still
        // activates a pellet unconditionally on physical contact, but before Pac-Man
        // leaves a tile center we ask the AI whether the *next* power-pellet tile is
        // explicitly authorized. If not, Pac-Man waits at the center for a new plan.
        if (this.actorType === "pacman" && this.game.shouldBlockPowerStep(cx, cy, this.direction)) {
          this.direction = cloneDir(DIRECTIONS.stop);
        }
      }
    }

    this.x += this.direction.x * step;
    this.y += this.direction.y * step;
    this.handleTunnel();
  }

  handleTunnel() {
    // Matches Teleporter.cs: trigger centers x=-15 and x=14, target x=13 and x=-14.
    if (Math.abs(this.y - 1) < 0.55) {
      if (this.x <= -15) { this.x = 13; this.lastCenterKey = ""; this.teleportedThisFrame = true; }
      else if (this.x >= 14) { this.x = -14; this.lastCenterKey = ""; this.teleportedThisFrame = true; }
    }
  }
}

class PacmanActor extends Actor {
  constructor(game) {
    super(game, -1, -8, 8); // Scene value: Movement.speed = 8
    this.startX = -1;
    this.startY = -8;
    this.state = "Idle";
    this.direction = cloneDir(DIRECTIONS.right);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
  }

  reset() {
    this.x = this.startX;
    this.y = this.startY;
    this.direction = cloneDir(DIRECTIONS.right);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
    this.lastCenterKey = "";
    this.enabled = true;
    this.prevX = this.x;
    this.prevY = this.y;
    this.teleportedThisFrame = false;
    this.turnedThisFrame = false;
    this.state = "Idle";
  }

  stop() {
    this.direction = cloneDir(DIRECTIONS.stop);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
    this.state = "Idle";
  }

  update(dt) {
    if (!this.enabled) return;
    this.state = (this.direction.x || this.direction.y) ? "Moving" : "Idle";
    this.updateMovement(dt, () => this.game.tryEatPellet());
    this.game.tryEatPellet();
  }
}

const GHOST_STATES = Object.freeze({
  CHASING: "Chasing",
  SCATTER: "Scatter",
  FRIGHTENED: "Frightened",
  HOME: "Home"
});

/*
  Ghost behavior trees
  --------------------
  Every ghost uses the same top-level Behavior Tree structure:

    ROOT SELECTOR
      1. HOME / EXIT HOUSE
      2. FRIGHTENED -> flee Pac-Man
      3. SCATTER -> move toward the ghost's personal corner
      4. CHASE -> run the ghost-specific chase subtree

  The chase subtree is different for each ghost:
    Blinky: direct shortest-path hunter.
    Pinky:  ambushes a point four tiles ahead of Pac-Man.
    Inky:   pincer/flank target using Blinky + Pac-Man's heading.
    Clyde:  chases from far away, retreats to his corner when close.
*/
class GhostBehaviorTree {
  constructor(ghost) {
    this.ghost = ghost;
  }

  tick(cx, cy) {
    const g = this.ghost;
    const pac = g.game.pacman;

    // Branch 1: Home is handled by GhostActor's explicit house timer/exit path.
    if (g.state === GHOST_STATES.HOME) {
      return { behavior: g.respawning ? "HOME_RESPAWN" : "HOME_WAIT", mode: "stop", target: null };
    }

    // Branch 2: Frightened overrides all personality behavior.
    if (g.state === GHOST_STATES.FRIGHTENED) {
      return {
        behavior: "FRIGHTENED_FLEE",
        mode: "flee",
        target: { x: Math.round(pac.x), y: Math.round(pac.y) }
      };
    }

    // Branch 3: Scatter sends each ghost to a distinct home corner.
    if (g.state === GHOST_STATES.SCATTER) {
      return {
        behavior: `${g.name.toUpperCase()}_SCATTER`,
        mode: "target",
        target: g.scatterTarget()
      };
    }

    // Branch 4: unique chase behavior.
    return this.chase(cx, cy);
  }

  chase(cx, cy) {
    const g = this.ghost;
    const pac = g.game.pacman;
    const pacCell = { x: Math.round(pac.x), y: Math.round(pac.y) };
    const remaining = Math.max(0, g.game.maxPellets || 0);

    if (g.name === "Blinky") {
      const elroy = remaining > 0 && remaining <= 48;
      return {
        behavior: elroy ? "BLINKY_ELROY_PRESSURE" : "BLINKY_DIRECT_HUNT",
        mode: "target",
        target: pacCell
      };
    }

    if (g.name === "Pinky") {
      const junction = this.projectToNextDecision(pacCell, pac.direction, 7);
      return {
        behavior: "PINKY_JUNCTION_AMBUSH",
        mode: "target",
        target: g.nearestWalkable(junction)
      };
    }

    if (g.name === "Inky") {
      const junction = this.projectToNextDecision(pacCell, pac.direction, 6);
      const exits = g.game.grid.availableDirections(junction.x, junction.y, "ghost");
      const blinky = g.game.ghosts.find(x => x.name === "Blinky");
      let target = junction;
      let best = -Infinity;
      for (const d of exits) {
        const n = g.stepCell(junction.x, junction.y, d);
        const bdist = blinky ? Math.hypot(n.x - blinky.x, n.y - blinky.y) : 4;
        const pdist = Math.hypot(n.x - pacCell.x, n.y - pacCell.y);
        const exitsThere = g.game.grid.availableDirections(n.x, n.y, "ghost").length;
        const value = 0.65 * bdist - 0.18 * pdist + 0.20 * exitsThere;
        if (value > best) { best = value; target = n; }
      }
      return {
        behavior: "INKY_ESCAPE_CUTTER",
        mode: "target",
        target: g.nearestWalkable(target)
      };
    }

    const pacDistance = g.pathDistance({ x: cx, y: cy }, pacCell);
    const powerPellets = [...g.game.grid.pellets.values()].filter(p => !p.eaten && p.type === "power");
    let guard = null, guardValue = Infinity;
    for (const p of powerPellets) {
      const pp = { x: p.x, y: p.y };
      const pacToPower = g.pathDistance(pacCell, pp, 40);
      const clydeToPower = g.pathDistance({ x: cx, y: cy }, pp, 40);
      if (pacToPower <= 9 && clydeToPower <= 12 && pacDistance > 5) {
        const value = pacToPower + 0.35 * clydeToPower;
        if (value < guardValue) { guardValue = value; guard = pp; }
      }
    }
    if (guard) {
      return { behavior: "CLYDE_POWER_GUARD", mode: "target", target: g.nearestWalkable(guard) };
    }
    if (Number.isFinite(pacDistance) && pacDistance <= 7) {
      return {
        behavior: "CLYDE_SHY_RETREAT",
        mode: "target",
        target: g.scatterTarget()
      };
    }
    return {
      behavior: "CLYDE_LONG_RANGE_CHASE",
      mode: "target",
      target: pacCell
    };
  }

  projectToNextDecision(origin, direction, maxTiles = 7) {
    const g = this.ghost;
    let cur = { x: Math.round(origin.x), y: Math.round(origin.y) };
    const d = direction && (direction.x || direction.y) ? direction : DIRECTIONS.right;
    for (let i = 0; i < maxTiles; i++) {
      if (i > 0 && g.game.grid.isDecisionCell(cur.x, cur.y, "pacman")) return cur;
      if (!g.game.grid.canMoveFrom(cur.x, cur.y, d, "pacman")) break;
      cur = g.stepCell(cur.x, cur.y, d);
    }
    return cur;
  }

  projectAhead(origin, direction, tiles) {
    const d = direction && (direction.x || direction.y) ? direction : DIRECTIONS.right;
    return { x: origin.x + d.x * tiles, y: origin.y + d.y * tiles };
  }
}

class GhostActor extends Actor {
  constructor(game, opts) {
    super(game, opts.x, opts.y, 6.2, "ghost"); // Unique BT ghosts are more strategic than the professor baseline; keep Pac-Man's speed advantage.
    this.name = opts.name;
    this.color = opts.color;
    this.startX = opts.x;
    this.startY = opts.y;
    this.houseX = opts.houseX ?? -1;
    this.houseY = opts.houseY ?? 1;
    this.homeDuration = opts.homeDuration;
    this.chaseDuration = 20;
    this.scatterDuration = 7;
    this.frightenedDuration = 8;
    this.points = 200;
    this.state = GHOST_STATES.HOME;
    this.stateTimer = this.homeDuration;
    this.direction = cloneDir(opts.startDirection || DIRECTIONS.left);
    this.lastDecisionCell = "";
    this.eatenEyes = false;
    this.leavingHome = null;
    this.pendingFrightened = false;
    this.resumeState = GHOST_STATES.CHASING;
    this.respawning = false;
    this.currentBehavior = "HOME_WAIT";
    this.currentTarget = null;
    this.behaviorTree = new GhostBehaviorTree(this);
  }

  reset() {
    this.x = this.startX;
    this.y = this.startY;
    this.speed = 6.2;
    this.direction = cloneDir(this.name === "Blinky" ? DIRECTIONS.left : DIRECTIONS.stop);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
    this.lastCenterKey = "";
    this.lastDecisionCell = "";
    this.eatenEyes = false;
    this.leavingHome = null;
    this.pendingFrightened = false;
    this.resumeState = GHOST_STATES.CHASING;
    this.respawning = false;
    this.currentBehavior = "HOME_WAIT";
    this.currentTarget = null;
    this.prevX = this.x;
    this.prevY = this.y;
    this.teleportedThisFrame = false;
    this.turnedThisFrame = false;
    this.setState(GHOST_STATES.HOME, true);
    this.enabled = true;
  }

  stateDuration(state) {
    switch (state) {
      case GHOST_STATES.CHASING: return this.chaseDuration;
      case GHOST_STATES.SCATTER: return this.scatterDuration;
      case GHOST_STATES.FRIGHTENED: return Math.max(0.05, this.game.frightenedTimeRemaining());
      case GHOST_STATES.HOME: return this.homeDuration;
      default: return 0;
    }
  }

  setState(state, silent = false) {
    // Remember the mode to resume after frightened mode; frightened should not
    // send a ghost back HOME when the timer ends.
    if (state === GHOST_STATES.FRIGHTENED && this.state !== GHOST_STATES.FRIGHTENED && this.state !== GHOST_STATES.HOME) {
      this.resumeState = this.state === GHOST_STATES.SCATTER ? GHOST_STATES.SCATTER : GHOST_STATES.CHASING;
    }

    this.state = state;
    this.stateTimer = this.stateDuration(state);
    this.lastDecisionCell = "";

    if (state === GHOST_STATES.CHASING && !silent) this.game.audio.play("chase");
    if (state !== GHOST_STATES.HOME) this.respawning = false;
  }

  nextState() {
    switch (this.state) {
      case GHOST_STATES.CHASING: return GHOST_STATES.SCATTER;
      case GHOST_STATES.SCATTER: return GHOST_STATES.CHASING;
      case GHOST_STATES.FRIGHTENED: return this.game.globalGhostMode || this.resumeState || GHOST_STATES.CHASING;
      case GHOST_STATES.HOME:
        return this.pendingFrightened && this.game.frightenedTimeRemaining() > 0
          ? GHOST_STATES.FRIGHTENED
          : (this.game.globalGhostMode || GHOST_STATES.SCATTER);
      default: return GHOST_STATES.CHASING;
    }
  }

  scatterTarget() {
    switch (this.name) {
      case "Blinky": return { x: 12, y: 14 };   // upper-right
      case "Pinky":  return { x: -13, y: 14 };  // upper-left
      case "Inky":   return { x: 12, y: -14 };  // lower-right
      case "Clyde":  return { x: -13, y: -14 }; // lower-left
      default: return { x: 12, y: 14 };
    }
  }

  beginLeaveHome() {
    // Blinky begins a round already outside the house. Eaten Blinky respawns
    // inside, so only skip the animation when the actor is already at the exit.
    if (this.y >= 3.5 && Math.abs(this.x + 1) < 0.75) return;
    this.leavingHome = {
      elapsed: 0,
      duration: 0.9,
      from: { x: this.x, y: this.y },
      mid: { x: -1, y: 3 },
      to: { x: -1, y: 4 }
    };
    this.currentBehavior = "EXIT_GHOST_HOUSE";
    this.currentTarget = { x: -1, y: 4 };
  }

  updateLeaveHome(dt) {
    if (!this.leavingHome) return false;
    // House-exit animation is real movement too. Keep previous-position data in
    // sync so the first collision-active frame after leaving the house cannot
    // sweep from a stale position deep inside the house.
    this.prevX = this.x;
    this.prevY = this.y;
    this.teleportedThisFrame = false;
    this.turnedThisFrame = false;
    const m = this.leavingHome;
    m.elapsed += dt;
    const t = clamp(m.elapsed / m.duration, 0, 1);
    if (t < 0.5) {
      const u = t / 0.5;
      this.x = m.from.x + (m.mid.x - m.from.x) * u;
      this.y = m.from.y + (m.mid.y - m.from.y) * u;
    } else {
      const u = (t - 0.5) / 0.5;
      this.x = m.mid.x + (m.to.x - m.mid.x) * u;
      this.y = m.mid.y + (m.to.y - m.mid.y) * u;
    }
    if (t >= 1) {
      this.x = m.to.x;
      this.y = m.to.y;
      this.leavingHome = null;
      this.direction = cloneDir(DIRECTIONS.left);
      this.nextDirection = cloneDir(DIRECTIONS.stop);
      this.lastCenterKey = "";
      this.lastDecisionCell = "";
      this.respawning = false;
      if (this.pendingFrightened && this.game.frightenedTimeRemaining() > 0) {
        this.pendingFrightened = false;
        this.setState(GHOST_STATES.FRIGHTENED, true);
      }
    }
    return true;
  }

  onPowerPellet() {
    // Ghosts waiting inside the house remain in HOME so they cannot wander into
    // blocked house cells. They inherit frightened mode only if it is still
    // active when they finish exiting.
    if (this.state === GHOST_STATES.HOME || this.leavingHome) {
      this.pendingFrightened = true;
      return;
    }
    this.setState(GHOST_STATES.FRIGHTENED, true);
    this.stateTimer = Math.max(0.05, this.game.frightenedTimeRemaining());
  }

  eaten() {
    // Explicit respawn prevents an eaten ghost from keeping FRIGHTENED logic
    // inside the house and becoming permanently stuck there.
    this.x = this.houseX;
    this.y = this.houseY;
    this.direction = cloneDir(DIRECTIONS.stop);
    this.nextDirection = cloneDir(DIRECTIONS.stop);
    this.lastCenterKey = "";
    this.lastDecisionCell = "";
    this.leavingHome = null;
    this.eatenEyes = false;
    this.pendingFrightened = this.game.frightenedTimeRemaining() > 0;
    this.respawning = true;
    this.setState(GHOST_STATES.HOME, true);
    this.stateTimer = 1.25;
    this.currentBehavior = "HOME_RESPAWN";
    this.currentTarget = { x: -1, y: 4 };
  }

  nearestWalkable(target) {
    const tx = Math.round(target.x), ty = Math.round(target.y);
    if (!this.game.grid.isWall(tx, ty, "ghost")) return { x: tx, y: ty };
    for (let r = 1; r <= 10; r++) {
      let best = null, bestD = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const x = tx + dx, y = ty + dy;
          if (this.game.grid.isWall(x, y, "ghost")) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestD) { best = { x, y }; bestD = d; }
        }
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        for (const dx of [-r, r]) {
          const x = tx + dx, y = ty + dy;
          if (this.game.grid.isWall(x, y, "ghost")) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestD) { best = { x, y }; bestD = d; }
        }
      }
      if (best) return best;
    }
    return { x: tx, y: ty };
  }

  stepCell(cx, cy, dir) {
    if (cy === 1 && cx === 13 && dir.x === 1) return { x: -14, y: 1 };
    if (cy === 1 && cx === -14 && dir.x === -1) return { x: 13, y: 1 };
    return { x: cx + dir.x, y: cy + dir.y };
  }

  pathDistance(startLike, targetLike, maxDepth = 120) {
    const start = { x: Math.round(startLike.x), y: Math.round(startLike.y) };
    const target = this.nearestWalkable(targetLike);
    const sk = `${start.x},${start.y}`, tk = `${target.x},${target.y}`;
    if (sk === tk) return 0;
    const q = [start];
    const dist = new Map([[sk, 0]]);
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const base = dist.get(`${cur.x},${cur.y}`);
      if (base >= maxDepth) continue;
      for (const dir of this.game.grid.availableDirections(cur.x, cur.y, "ghost")) {
        const n = this.stepCell(cur.x, cur.y, dir);
        const nk = `${n.x},${n.y}`;
        if (dist.has(nk)) continue;
        if (nk === tk) return base + 1;
        dist.set(nk, base + 1);
        q.push(n);
      }
    }
    return Infinity;
  }

  legalDirections(cx, cy) {
    let available = this.game.grid.availableDirections(cx, cy, "ghost");
    if (!available.length) return [];

    // Normal ghosts avoid instant 180-degree reversals unless it is the only
    // legal route. This reduces jitter and gives each personality time to work.
    if (this.direction.x || this.direction.y) {
      const nonReverse = available.filter(d => !opposite(d, this.direction));
      if (nonReverse.length) available = nonReverse;
    }
    return available;
  }

  chooseUtilityDirection(cx, cy, result, dirs) {
    const target = result.target || this.game.pacman;
    const pac = this.game.pacman;
    const others = this.game.ghosts.filter(g => g !== this && g.enabled && g.state !== GHOST_STATES.HOME && !g.leavingHome);
    let best = dirs[0], bestValue = -Infinity;

    for (const dir of dirs) {
      const n = this.stepCell(cx, cy, dir);
      const before = Math.hypot(cx - target.x, cy - target.y);
      const after = Math.hypot(n.x - target.x, n.y - target.y);
      const targetProgress = before - after;
      const pacDist = Math.hypot(n.x - pac.x, n.y - pac.y);
      const exits = this.game.grid.availableDirections(n.x, n.y, "ghost").length;
      let spacing = 5;
      for (const other of others) spacing = Math.min(spacing, Math.hypot(n.x - other.x, n.y - other.y));
      spacing = clamp(spacing / 5, 0, 1);

      let value = 2.2 * targetProgress + 0.08 * exits + 0.10 * spacing;
      // Team-coverage utility: intelligent ghosts should cover different lanes,
      // not stack on the same corridor tile. This improves coordination while
      // avoiding unfair three-ghost dogpiles that leave no meaningful decision.
      let crowdPenalty = 0;
      for (const other of others) {
        const d = Math.hypot(n.x - other.x, n.y - other.y);
        if (d < 1.5) crowdPenalty += 1.15;
        else if (d < 2.5) crowdPenalty += 0.55;
        const sameLane = (Math.abs(n.x - other.x) < 0.35 || Math.abs(n.y - other.y) < 0.35);
        if (sameLane && d < 4) crowdPenalty += 0.25;
      }
      value -= crowdPenalty;
      if (result.behavior.startsWith("BLINKY")) {
        value += 0.10 * clamp((8 - pacDist) / 8, 0, 1);
        if (result.behavior.includes("ELROY")) value += 0.12 * clamp((10 - pacDist) / 10, 0, 1);
      } else if (result.behavior.startsWith("PINKY")) {
        value += 0.18 * exits + 0.05 * spacing;
      } else if (result.behavior.startsWith("INKY")) {
        value += 0.28 * spacing + 0.12 * exits;
      } else if (result.behavior === "CLYDE_POWER_GUARD") {
        value += 0.16 * exits;
      }

      if (this.game.simulationRandom) value += (this.game.random() - 0.5) * 0.22;
      if (value > bestValue) { bestValue = value; best = dir; }
    }
    return best;
  }

  chooseToward(cx, cy, target, dirs) {
    // Match the professor's CmdChaser: each ghost only compares the next legal
    // tile to its BT-selected target. The personality decides *where* to aim;
    // movement itself is deliberately local rather than omniscient BFS routing.
    let best = dirs[0], bestDistance = Infinity;
    for (const dir of dirs) {
      const n = this.stepCell(cx, cy, dir);
      const dx = n.x - target.x, dy = n.y - target.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistance) { bestDistance = d2; best = dir; }
    }
    return best;
  }

  chooseFlee(cx, cy, dirs) {
    // Match the professor's CmdFrightened: choose the next tile farthest from
    // Pac-Man using a local squared-distance comparison. Deterministic fleeing
    // also makes Pac-Man's frightened-ghost interception model much more useful.
    const pac = this.game.pacman;
    let best = dirs[0], bestDistance = -Infinity;
    for (const dir of dirs) {
      const n = this.stepCell(cx, cy, dir);
      const dx = n.x - pac.x, dy = n.y - pac.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestDistance) { bestDistance = d2; best = dir; }
    }
    return best;
  }

  chooseDirection(cx, cy) {
    const dirs = this.legalDirections(cx, cy);
    if (!dirs.length) return DIRECTIONS.stop;

    const result = this.behaviorTree.tick(cx, cy);
    this.currentBehavior = result.behavior;
    this.currentTarget = result.target ? { x: Math.round(result.target.x), y: Math.round(result.target.y) } : null;

    if (result.mode === "stop") return DIRECTIONS.stop;
    if (result.mode === "flee") return this.chooseFlee(cx, cy, dirs);
    return this.chooseUtilityDirection(cx, cy, result, dirs);
  }

  handleCenter(cx, cy) {
    const key = `${cx},${cy}`;
    const blocked = !this.game.grid.canMoveFrom(cx, cy, this.direction, this.actorType);
    const decision = this.game.grid.isDecisionCell(cx, cy, "ghost");
    if ((decision || blocked) && (this.lastDecisionCell !== key || blocked)) {
      this.direction = cloneDir(this.chooseDirection(cx, cy));
      this.lastDecisionCell = key;
    }
    if (!decision && !blocked) this.lastDecisionCell = "";
  }

  update(dt) {
    if (!this.enabled) return;

    // HOME and FRIGHTENED retain local timers. Normal CHASE/SCATTER timing is
    // controlled by the shared PacManGame ghost-team FSM.
    if (this.state === GHOST_STATES.HOME || this.state === GHOST_STATES.FRIGHTENED) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        const oldState = this.state;
        const next = this.nextState();
        if (oldState === GHOST_STATES.HOME) this.beginLeaveHome();
        this.pendingFrightened = oldState === GHOST_STATES.HOME && next === GHOST_STATES.FRIGHTENED;
        this.setState(next, oldState === GHOST_STATES.HOME);
        if (next === GHOST_STATES.FRIGHTENED) this.stateTimer = Math.max(0.05, this.game.frightenedTimeRemaining());
      }
    } else if (this.state !== this.game.globalGhostMode) {
      this.setState(this.game.globalGhostMode, true);
    }

    if (this.updateLeaveHome(dt)) return;

    if (this.state === GHOST_STATES.HOME) {
      this.currentBehavior = this.respawning ? "HOME_RESPAWN" : "HOME_WAIT";
      this.currentTarget = { x: -1, y: 4 };
      this.direction = cloneDir(DIRECTIONS.stop);
      return;
    }

    // Blinky receives a small late-level "Elroy" pressure boost. It is deliberately
    // mild because the ghost personalities are already strategically stronger.
    if (this.name === "Blinky" && this.state === GHOST_STATES.CHASING && this.game.maxPellets > 0 && this.game.maxPellets <= 48) this.speed = 6.2;
    else this.speed = 6.2;

    this.updateMovement(dt, (cx, cy) => this.handleCenter(cx, cy));
  }
}

class PacManGame {
  constructor(canvas, assets, options = {}) {
    this.headless = Boolean(options.headless);
    this.simulationRandom = Boolean(options.simulationRandom);
    this.rngState = (Number(options.seed) >>> 0) || 0x9e3779b9;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.assets = assets;
    this.audio = this.headless ? new SilentSoundBank() : new SoundBank();
    this.currentLevelName = levelDefinition(1).name;
    this.grid = new MazeGrid(levelDefinition(1).maze);

    this.scoreEl = this.headless ? null : document.getElementById("score");
    this.highScoreEl = this.headless ? null : document.getElementById("highScore");
    this.levelEl = this.headless ? null : document.getElementById("level");
    this.levelNameEl = this.headless ? null : document.getElementById("levelName");
    this.livesEl = this.headless ? null : document.getElementById("lives");
    this.overlay = this.headless ? null : document.getElementById("overlay");
    this.overlayText = this.headless ? null : document.getElementById("overlayText");

    this.canvas.width = this.grid.width * TILE;
    this.canvas.height = this.grid.height * TILE;

    this.pacman = new PacmanActor(this);
    this.ghosts = [
      // Scene home delays and start locations from PacMan.unity.
      new GhostActor(this, { name: "Blinky", x: -1,   y: 4, color: "#ff2525", homeDuration: 0,  houseX: -1,   houseY: 1, startDirection: DIRECTIONS.left }),
      new GhostActor(this, { name: "Pinky",  x: -0.5, y: 1, color: "#ff9fca", homeDuration: 2,  houseX: -0.5, houseY: 1 }),
      new GhostActor(this, { name: "Inky",   x: -2.5, y: 1, color: "#23e7e7", homeDuration: 8,  houseX: -2.5, houseY: 1 }),
      new GhostActor(this, { name: "Clyde",  x: 1.5,  y: 1, color: "#ff9d28", homeDuration: 16, houseX: 1.5,  houseY: 1 })
    ];

    this.score = 0;
    this.lives = 3;
    this.level = 1;
    // UI-only starting-level preference. This does not change Pac-Man or ghost AI.
    this.startLevel = Math.min(2, Math.max(1, Math.floor(Number(options.startLevel) || 1)));
    this.maxPellets = this.grid.activePelletCount();
    this.ghostMultiplier = 1;
    this.ghostMultiplierResetAt = 0;
    this.frightenedUntil = 0;
    // Shared ghost-team FSM: all active ghosts use the same CHASE/SCATTER phase.
    // Their individual Behavior Trees remain unique inside each phase.
    this.globalGhostMode = GHOST_STATES.SCATTER;
    this.globalGhostModeTimer = 12;
    this.highScore = this.headless ? 0 : Number(localStorage.getItem("pacman-web-high-score") || 0);

    this.started = false;
    this.paused = false;
    this.gameOver = false;
    this.waitUntil = 0;
    this.waitAction = null;
    this.lastFrame = performance.now();
    this.animationTime = 0;
    this.agent = null;
    this.agentAccumulator = 0;
    // Poll the AI every physics frame. Normal planning is still junction/center locked,
    // so this higher rate only improves the near-collision safety layer.
    this.agentInterval = 1 / 60;

    // Visual playback rate. Gameplay rules still run on a fixed simulation step,
    // so changing this only changes how quickly the user watches the same game-time
    // dynamics rather than changing movement ratios, frightened duration, or AI cadence.
    this.playSpeedSteps = [0.5, 0.75, 1, 1.5, 2, 3, 4];
    this.playSpeedIndex = 2;
    this.playSpeed = this.playSpeedSteps[this.playSpeedIndex];
    this.fixedStep = 1 / 120;
    this.simAccumulator = 0;
    this.simulationNowMs = performance.now();

    this.tintCache = new Map();
    if (!this.headless) {
      this.bindControls();
      this.updateHUD();
      this.render();
    }
  }

  random() {
    // Xorshift32: deterministic per simulation seed, with no effect on the
    // visible game unless simulationRandom is explicitly enabled.
    let x = this.rngState >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState >>> 0) / 4294967296;
  }

  loadLevel(levelNumber) {
    const definition = levelDefinition(levelNumber);
    this.currentLevelName = definition.name;
    this.grid = new MazeGrid(definition.maze);
    this.canvas.width = this.grid.width * TILE;
    this.canvas.height = this.grid.height * TILE;
    this.maxPellets = this.grid.activePelletCount();
    if (!this.headless) {
      if (this.levelEl) this.levelEl.textContent = String(levelNumber);
      if (this.levelNameEl) this.levelNameEl.textContent = this.currentLevelName;
    }

    // Pathfinder objects hold the grid by reference, so rebuild their references
    // whenever a different level layout is loaded.
    if (this.aiController) {
      if (typeof this.aiController.onGridChanged === "function") this.aiController.onGridChanged(this.grid);
      else {
        if (this.aiController.path) this.aiController.path.grid = this.grid;
        if (this.aiController.ghostPath) this.aiController.ghostPath.grid = this.grid;
        if (typeof this.aiController.reset === "function") this.aiController.reset();
      }
    }
  }

  selectedStartLevel() {
    if (this.headless) return this.startLevel || 1;
    const select = document.getElementById("startLevelSelect");
    const value = select ? Number(select.value) : (this.startLevel || 1);
    return Math.min(2, Math.max(1, Math.floor(value || 1)));
  }

  syncStartLevelUI() {
    if (this.headless) return;
    const select = document.getElementById("startLevelSelect");
    if (select) select.value = String(this.startLevel || 1);
  }

  bindControls() {
    // Pac-Man is AI-only in this assignment. Keyboard input never controls him.
    window.addEventListener("keydown", (event) => {
      event.preventDefault();
    });

    const startLevelSelect = document.getElementById("startLevelSelect");
    if (startLevelSelect) {
      startLevelSelect.addEventListener("change", () => {
        this.startLevel = this.selectedStartLevel();
        if (!this.started || this.gameOver) {
          // Preview the selected maze before Start is pressed. This only changes
          // UI/game setup; the Pac-Man and ghost algorithms are untouched.
          this.level = this.startLevel;
          this.loadLevel(this.level);
          this.resetActors();
          this.updateHUD();
          this.render();
          if (this.overlayText) this.overlayText.textContent = `LEVEL ${this.level}: ${this.currentLevelName.toUpperCase()} — PRESS START`;
          if (this.overlay) this.overlay.classList.remove("hidden");
        }
      });
    }
    this.syncStartLevelUI();

    document.getElementById("startBtn").addEventListener("click", () => this.start());
    document.getElementById("pauseBtn").addEventListener("click", () => this.paused ? this.resume() : this.pause());
    document.getElementById("restartBtn").addEventListener("click", () => this.restart());
    document.getElementById("speedDownBtn").addEventListener("click", () => this.changePlaySpeed(-1));
    document.getElementById("speedUpBtn").addEventListener("click", () => this.changePlaySpeed(1));
    document.getElementById("muteBtn").addEventListener("click", (e) => {
      this.audio.setMuted(!this.audio.muted);
      e.currentTarget.textContent = `Sound: ${this.audio.muted ? "Off" : "On"}`;
    });
    this.updatePlaySpeedUI();
  }

  updatePlaySpeedUI() {
    const label = document.getElementById("speedLabel");
    const down = document.getElementById("speedDownBtn");
    const up = document.getElementById("speedUpBtn");
    if (label) label.textContent = `${Number(this.playSpeed.toFixed(2))}×`;
    if (down) down.disabled = this.playSpeedIndex <= 0;
    if (up) up.disabled = this.playSpeedIndex >= this.playSpeedSteps.length - 1;
  }

  changePlaySpeed(delta) {
    const next = Math.max(0, Math.min(this.playSpeedSteps.length - 1, this.playSpeedIndex + delta));
    if (next === this.playSpeedIndex) return;
    this.playSpeedIndex = next;
    this.playSpeed = this.playSpeedSteps[next];
    this.simAccumulator = 0;
    this.lastFrame = performance.now();
    this.updatePlaySpeedUI();
  }

  start() {
    if (this.started && !this.gameOver) {
      this.resume();
      return;
    }
    this.started = true;
    this.gameOver = false;
    this.score = 0;
    this.lives = 3;
    this.startLevel = this.selectedStartLevel();
    this.level = this.startLevel;
    this.simulationNowMs = performance.now();
    this.simAccumulator = 0;
    this.loadLevel(this.level);
    this.resetActors();
    this.audio.play("ready");
    this.showOverlay("READY!", 4, () => this.enableActors());
    this.updateHUD();
  }

  restart() {
    this.started = true;
    this.gameOver = false;
    this.paused = false;
    this.score = 0;
    this.lives = 3;
    // Restart the run from the level originally selected by the user.
    this.level = this.startLevel || this.selectedStartLevel();
    this.simulationNowMs = performance.now();
    this.simAccumulator = 0;
    this.loadLevel(this.level);
    this.resetActors();
    this.audio.play("ready");
    this.showOverlay("READY!", 4, () => this.enableActors());
    this.updateHUD();
  }

  resetActors() {
    this.resetGhostMultiplier();
    this.frightenedUntil = 0;
    this.globalGhostMode = GHOST_STATES.SCATTER;
    this.globalGhostModeTimer = 12;
    this.pacman.reset();
    for (const ghost of this.ghosts) ghost.reset();
    // A new life/round is a new planning episode. Never carry stale target locks,
    // tabu edges, emergency commitments, or previous directions across a reset.
    if (this.aiController && typeof this.aiController.reset === "function") this.aiController.reset();
    this.disableActors();
  }

  disableActors() {
    this.pacman.enabled = false;
    for (const ghost of this.ghosts) ghost.enabled = false;
  }

  enableActors() {
    if (this.gameOver) return;
    this.pacman.enabled = true;
    for (const ghost of this.ghosts) ghost.enabled = true;
    this.hideOverlay();
  }

  newRound() {
    this.level += 1;
    this.loadLevel(this.level);
    this.resetActors();
    this.enableActors();
    this.hideOverlay();
    this.updateHUD();
  }

  pacmanEaten() {
    if (!this.pacman.enabled || this.gameOver) return;
    this.lives -= 1;
    this.updateHighScore();
    this.updateHUD();
    this.disableActors();

    if (this.lives <= 0) {
      this.gameOver = true;
      this.audio.play("gameOver");
      this.showOverlay("GAME OVER!", 2, () => {
        if (!this.headless && this.overlayText && this.overlay) {
          this.overlayText.textContent = "PRESS RESTART";
          this.overlay.classList.remove("hidden");
        }
      });
      return;
    }

    this.showOverlay("READY!", 4, () => {
      this.resetActors();
      this.enableActors();
    });
  }

  ghostEaten(ghost) {
    this.addScore(ghost.points * this.ghostMultiplier);
    this.ghostMultiplier += 1; // Professor code increments linearly: 200, 400, 600, 800.
    ghost.eaten();
    this.audio.play("eatGhost");
  }

  shouldBlockPowerStep(cx, cy, dir) {
    if (!dir || (!dir.x && !dir.y) || !this.aiController || typeof this.aiController.authorizePowerPellet !== "function") return false;
    let nx = cx + dir.x, ny = cy + dir.y;
    if (cy === 1 && cx === 13 && dir.x === 1) { nx = -14; ny = 1; }
    else if (cy === 1 && cx === -14 && dir.x === -1) { nx = 13; ny = 1; }
    const pellet = this.grid.pelletAt(nx, ny);
    if (!pellet || pellet.eaten || pellet.type !== "power") return false;
    return !this.aiController.authorizePowerPellet(pellet);
  }

  tryEatPellet() {
    if (!this.pacman.enabled) return;
    const px = Math.round(this.pacman.x);
    const py = Math.round(this.pacman.y);

    const pellet = this.grid.pelletAt(px, py);
    if (!pellet || pellet.eaten) return;

    // Match Unity's trigger-overlap timing more closely. Waiting for Pac-Man's
    // center to be almost exactly on the tile made power pellets activate too late.
    const pickupRadius = pellet.type === "power" ? 0.66 : 0.58;
    if (Math.hypot(this.pacman.x - px, this.pacman.y - py) > pickupRadius) return;

    // Unity-faithful pickup rule: once Pac-Man physically overlaps a power pellet,
    // it ALWAYS activates. Strategic preservation belongs in the AI path planner;
    // the game engine must never allow Pac-Man to pass through a power pellet while
    // leaving it visible and inactive.

    pellet.eaten = true;
    this.maxPellets -= 1;

    if (pellet.type === "power") {
      this.audio.play("eatPower");
      this.audio.play("eatPellet");
      this.addScore(pellet.points);
      this.resetGhostMultiplierTimer(8);
      this.frightenedUntil = this.simulationNowMs + 8000;
      for (const ghost of this.ghosts) ghost.onPowerPellet();
      // Atomic fail-safe: if an active outside ghost missed the notification for
      // any reason, force it into frightened mode for the remaining duration.
      for (const ghost of this.ghosts) {
        if (!ghost.enabled || ghost.state === GHOST_STATES.HOME || ghost.leavingHome || ghost.eatenEyes) continue;
        if (ghost.state !== GHOST_STATES.FRIGHTENED) ghost.setState(GHOST_STATES.FRIGHTENED, true);
        ghost.stateTimer = Math.max(0.05, this.frightenedTimeRemaining());
      }
      this.audio.play("frightened");
    } else {
      this.audio.play("eatPellet");
      this.addScore(pellet.points);
    }

    if (this.maxPellets <= 0) {
      this.disableActors();
      this.audio.play("ready");
      this.showOverlay("READY!", 4, () => this.newRound());
    }
  }

  addScore(points) {
    this.score += points;
    this.updateHighScore();
    this.updateHUD();
  }

  updateHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      if (!this.headless) localStorage.setItem("pacman-web-high-score", String(this.highScore));
    }
  }

  frightenedTimeRemaining() {
    return Math.max(0, (this.frightenedUntil - this.simulationNowMs) / 1000);
  }

  resetGhostMultiplierTimer(seconds) {
    this.ghostMultiplierResetAt = this.simulationNowMs + seconds * 1000;
  }

  resetGhostMultiplier() {
    this.ghostMultiplier = 1;
    this.ghostMultiplierResetAt = 0;
  }

  updateGlobalGhostMode(dt) {
    // Frightened time pauses the chase/scatter clock. When frightened ends, all
    // active ghosts resume the same team phase instead of drifting out of sync.
    if (this.frightenedTimeRemaining() > 0) return;
    this.globalGhostModeTimer -= dt;
    if (this.globalGhostModeTimer <= 0) {
      this.globalGhostMode = this.globalGhostMode === GHOST_STATES.CHASING
        ? GHOST_STATES.SCATTER : GHOST_STATES.CHASING;
      this.globalGhostModeTimer = this.globalGhostMode === GHOST_STATES.CHASING ? 14 : 12;
      for (const ghost of this.ghosts) {
        if (!ghost.enabled || ghost.state === GHOST_STATES.HOME || ghost.leavingHome || ghost.eatenEyes) continue;
        ghost.setState(this.globalGhostMode, true);
      }
    }
  }

  checkActorCollisions() {
    if (!this.pacman.enabled) return;
    const HIT_RADIUS = 0.76;
    const HIT2 = HIT_RADIUS * HIT_RADIUS;

    const pointDistSq = (ax, ay, bx, by) => {
      const dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy;
    };

    const sweptDistanceSq = (a, b) => {
      // Teleports are discontinuities, and center turns are piecewise paths. A
      // single line segment in either case invents motion that never occurred
      // (most notably a diagonal corner-cut), which caused occasional false deaths.
      if (a.teleportedThisFrame || b.teleportedThisFrame || a.turnedThisFrame || b.turnedThisFrame) return Infinity;
      const r0x = (a.prevX ?? a.x) - (b.prevX ?? b.x);
      const r0y = (a.prevY ?? a.y) - (b.prevY ?? b.y);
      const rvx = (a.x - (a.prevX ?? a.x)) - (b.x - (b.prevX ?? b.x));
      const rvy = (a.y - (a.prevY ?? a.y)) - (b.y - (b.prevY ?? b.y));
      const vv = rvx * rvx + rvy * rvy;
      let t = vv > 1e-9 ? -(r0x * rvx + r0y * rvy) / vv : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = r0x + rvx * t, dy = r0y + rvy * t;
      return dx * dx + dy * dy;
    };

    for (const ghost of this.ghosts) {
      if (!ghost.enabled || ghost.state === GHOST_STATES.HOME || ghost.leavingHome) continue;

      const endpointD2 = distSq(this.pacman, ghost);
      const startD2 = pointDistSq(
        this.pacman.prevX ?? this.pacman.x, this.pacman.prevY ?? this.pacman.y,
        ghost.prevX ?? ghost.x, ghost.prevY ?? ghost.y
      );
      const sweptD2 = sweptDistanceSq(this.pacman, ghost);
      const endpointHit = endpointD2 <= HIT2;
      const startHit = startD2 <= HIT2;
      const sweptHit = sweptD2 <= HIT2;
      if (!endpointHit && !startHit && !sweptHit) continue;

      this.lastCollisionEvent = {
        ghost: ghost.name,
        kind: endpointHit ? "endpoint" : (startHit ? "start" : "swept"),
        pacman: { x: this.pacman.x, y: this.pacman.y },
        ghostPosition: { x: ghost.x, y: ghost.y },
        endpointDistance: Math.sqrt(endpointD2),
        startDistance: Math.sqrt(startD2),
        sweptDistance: Number.isFinite(sweptD2) ? Math.sqrt(sweptD2) : null,
        pacmanTurned: Boolean(this.pacman.turnedThisFrame),
        ghostTurned: Boolean(ghost.turnedThisFrame)
      };

      if (ghost.state === GHOST_STATES.FRIGHTENED && !ghost.eatenEyes) {
        this.ghostEaten(ghost);
      } else if (!ghost.eatenEyes) {
        this.pacmanEaten();
        return;
      }
    }
  }

  showOverlay(text, seconds = 0, callback = null) {
    if (!this.headless && this.overlayText && this.overlay) {
      this.overlayText.textContent = text;
      this.overlay.classList.remove("hidden");
    }
    if (seconds > 0) {
      this.waitUntil = (this.headless ? this.simulationNowMs : performance.now()) + seconds * 1000;
      this.waitAction = callback;
    } else {
      this.waitUntil = 0;
      this.waitAction = null;
    }
  }

  hideOverlay() {
    if (!this.headless && this.overlay) this.overlay.classList.add("hidden");
    this.waitUntil = 0;
    this.waitAction = null;
  }

  pause() {
    if (this.headless || !this.started || this.gameOver) return;
    this.paused = true;
    document.getElementById("pauseBtn").textContent = "Resume";
    this.showOverlay("PAUSED");
  }

  resume() {
    if (this.headless || !this.started || this.gameOver) return;
    this.paused = false;
    document.getElementById("pauseBtn").textContent = "Pause";
    if (!this.waitUntil) this.hideOverlay();
    this.lastFrame = performance.now();
  }

  applyAgent(dt) {
    if (!this.agent || !this.pacman.enabled) return;
    this.agentAccumulator += dt;
    if (this.agentAccumulator < this.agentInterval) return;
    this.agentAccumulator = 0;
    try {
      const action = this.agent(this.getState());
      this.applyAction(action);
    } catch (err) {
      console.error("Pac-Man agent error:", err);
      this.clearAgent();
    }
  }

  applyAction(action) {
    if (typeof action === "string") action = action.toLowerCase();
    const dir = typeof action === "string" ? DIRECTIONS[action] : action;
    if (!dir) return false;
    // AI-only Pac-Man should never be explicitly stopped by a transient planner
    // result. If an agent returns "stop", keep the current movement instead;
    // walls will still stop Pac-Man naturally when no forward move is possible.
    if (dir === DIRECTIONS.stop || (dir.x === 0 && dir.y === 0)) {
      if (this.agent) return false;
      this.pacman.stop();
    } else {
      // AI reversals are queued until the next tile center. Actor.setDirection()
      // normally permits an immediate 180-degree turn anywhere along a corridor,
      // which visually produces stutter when a planner changes its mind.
      const cx = Math.round(this.pacman.x);
      const cy = Math.round(this.pacman.y);
      const centered = Math.abs(this.pacman.x - cx) < 0.08 && Math.abs(this.pacman.y - cy) < 0.08;
      const isReverse = opposite(dir, this.pacman.direction);
      if (this.agent && !centered) {
        if (isReverse && this.aiEmergencyOverride) {
          // A true emergency may reverse immediately along the corridor. Never
          // force a perpendicular mid-tile turn; that would bypass maze walls.
          this.pacman.setDirection(dir, true);
        } else {
          this.pacman.nextDirection = cloneDir(dir);
        }
      } else {
        this.pacman.setDirection(dir, false);
      }
      this.aiEmergencyOverride = false;
    }
    return true;
  }

  setAgent(fn) {
    if (typeof fn !== "function") throw new TypeError("setAgent expects a function(state) => action");
    this.agent = fn;
    return this;
  }

  clearAgent() {
    this.agent = null;
    this.agentAccumulator = 0;
    return this;
  }

  getState() {
    const pellets = [];
    for (const p of this.grid.pellets.values()) {
      if (!p.eaten) pellets.push({ x: p.x, y: p.y, type: p.type, points: p.points });
    }
    return {
      score: this.score,
      lives: this.lives,
      level: this.level,
      levelName: this.currentLevelName,
      remainingPellets: this.maxPellets,
      maze: [...this.grid.lines],
      pacman: {
        x: this.pacman.x,
        y: this.pacman.y,
        direction: { x: this.pacman.direction.x, y: this.pacman.direction.y }
      },
      ghosts: this.ghosts.map(g => ({
        name: g.name,
        x: g.x,
        y: g.y,
        state: g.state,
        stateTimeRemaining: Math.max(0, g.stateTimer),
        eatenEyes: g.eatenEyes,
        direction: { x: g.direction.x, y: g.direction.y },
        behavior: g.currentBehavior,
        target: g.currentTarget ? { ...g.currentTarget } : null,
        leavingHome: Boolean(g.leavingHome)
      })),
      pellets
    };
  }

  updateGhostPanel() {
    if (this.headless) return;
    const ids = { Blinky: "ghostBlinky", Pinky: "ghostPinky", Inky: "ghostInky", Clyde: "ghostClyde" };
    for (const ghost of this.ghosts) {
      const el = document.getElementById(ids[ghost.name]);
      if (!el) continue;
      const state = ghost.leavingHome ? "EXIT" : ghost.state.toUpperCase();
      el.textContent = `${state} · ${ghost.currentBehavior}`;
    }
  }

  updateHUD() {
    if (this.headless) return;
    this.scoreEl.textContent = padScore(this.score);
    this.highScoreEl.textContent = padScore(this.highScore);
    this.levelEl.textContent = String(this.level);
    if (this.levelNameEl) this.levelNameEl.textContent = this.currentLevelName;
    this.livesEl.replaceChildren();
    for (let i = 0; i < this.lives; i++) {
      const img = document.createElement("img");
      img.src = ASSET_PATHS.pacman[1];
      img.className = "life-icon";
      img.alt = "life";
      this.livesEl.appendChild(img);
    }
  }

  update(dt, now) {
    if (!this.started) return;

    if (this.waitUntil) {
      if (now >= this.waitUntil) {
        const cb = this.waitAction;
        this.waitUntil = 0;
        this.waitAction = null;
        if (cb) cb();
      }
      return;
    }

    if (this.paused || this.gameOver) return;

    this.simulationNowMs = now;
    if (this.ghostMultiplierResetAt && now >= this.ghostMultiplierResetAt) this.resetGhostMultiplier();

    this.applyAgent(dt);
    this.pacman.update(dt);
    this.updateGlobalGhostMode(dt);
    for (const ghost of this.ghosts) ghost.update(dt);
    this.checkActorCollisions();
    this.animationTime += dt;
  }

  worldToCanvas(x, y) {
    return {
      x: (x - MAZE_LEFT + 0.5) * TILE,
      y: (MAZE_TOP - y + 0.5) * TILE
    };
  }

  renderMaze() {
    const ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let row = 0; row < this.grid.height; row++) {
      const line = this.grid.lines[row];
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        const x = col * TILE;
        const y = row * TILE;
        if (ASSET_PATHS.walls[ch]) {
          const img = this.assets.image(ASSET_PATHS.walls[ch]);
          if (img) ctx.drawImage(img, x, y, TILE, TILE);
        } else if (ch === "-") {
          ctx.fillStyle = "#f29fe1";
          ctx.fillRect(x, y + TILE * 0.44, TILE, Math.max(2, TILE * 0.12));
        }
      }
    }
  }

  renderPellets() {
    const ctx = this.ctx;
    for (const pellet of this.grid.pellets.values()) {
      if (pellet.eaten) continue;
      const p = this.worldToCanvas(pellet.x, pellet.y);
      const path = pellet.type === "power" ? ASSET_PATHS.powerPellet : ASSET_PATHS.pellet;
      const img = this.assets.image(path);
      if (!img) continue;
      const size = pellet.type === "power" ? TILE * 0.82 : TILE * 0.52;
      ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
    }
  }

  renderPacman() {
    if (!this.pacman.enabled && !this.gameOver && this.waitUntil) return;
    if (this.gameOver) return;
    const p = this.worldToCanvas(this.pacman.x, this.pacman.y);
    const frame = Math.floor(this.animationTime / 0.09) % ASSET_PATHS.pacman.length;
    const img = this.assets.image(ASSET_PATHS.pacman[frame]);
    if (!img) return;

    let angle = 0;
    if (this.pacman.direction.x < 0) angle = Math.PI;
    else if (this.pacman.direction.y > 0) angle = -Math.PI / 2;
    else if (this.pacman.direction.y < 0) angle = Math.PI / 2;

    ctxSave(this.ctx, () => {
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(angle);
      const size = TILE * 0.88;
      this.ctx.drawImage(img, -size / 2, -size / 2, size, size);
    });
  }

  tintedGhost(path, color) {
    const key = `${path}|${color}`;
    if (this.tintCache.has(key)) return this.tintCache.get(key);
    const src = this.assets.image(path);
    if (!src) return null;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
    this.tintCache.set(key, c);
    return c;
  }

  renderGhost(ghost) {
    if (!ghost.enabled && this.waitUntil) return;
    const p = this.worldToCanvas(ghost.x, ghost.y);
    const frame = Math.floor(this.animationTime / 0.18) % 2;
    const size = TILE * 0.95;

    if (ghost.state === GHOST_STATES.FRIGHTENED && !ghost.eatenEyes) {
      const flash = ghost.stateTimer < 2 && Math.floor(this.animationTime / 0.16) % 2 === 0;
      const set = flash ? ASSET_PATHS.ghostVulnerableWhite : ASSET_PATHS.ghostVulnerableBlue;
      const img = this.assets.image(set[frame]);
      if (img) this.ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
      return;
    }

    if (!ghost.eatenEyes) {
      const body = this.tintedGhost(ASSET_PATHS.ghostBody[frame], ghost.color);
      if (body) this.ctx.drawImage(body, p.x - size / 2, p.y - size / 2, size, size);
    }

    const eyeDir = ghost.direction.name && ASSET_PATHS.eyes[ghost.direction.name]
      ? ghost.direction.name
      : "left";
    const eyes = this.assets.image(ASSET_PATHS.eyes[eyeDir]);
    if (eyes) this.ctx.drawImage(eyes, p.x - size / 2, p.y - size / 2, size, size);
  }

  render() {
    if (this.headless) return;
    this.updateGhostPanel();
    this.renderMaze();
    this.renderPellets();
    this.renderPacman();
    for (const ghost of this.ghosts) this.renderGhost(ghost);
  }

  frame(now) {
    const rawDt = Math.min(0.10, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    // Fixed game-time stepping keeps AI, movement ratios, frightened duration, and
    // collision behavior identical at every viewing speed. Faster playback simply
    // executes more fixed simulation steps per real second.
    this.simAccumulator += rawDt * this.playSpeed;
    let subSteps = 0;
    const maxSubSteps = 64;
    while (this.simAccumulator >= this.fixedStep && subSteps < maxSubSteps) {
      this.simulationNowMs += this.fixedStep * 1000;
      this.update(this.fixedStep, this.simulationNowMs);
      this.simAccumulator -= this.fixedStep;
      subSteps += 1;
    }
    if (subSteps >= maxSubSteps) this.simAccumulator = 0;

    this.render();
    requestAnimationFrame(t => this.frame(t));
  }
}

function ctxSave(ctx, fn) {
  ctx.save();
  try { fn(); } finally { ctx.restore(); }
}

window.__pacmanGameInternals = { PacManGame, MazeGrid, LEVELS, levelDefinition, DIRECTIONS };

(async function boot() {
  if (window.__PACMAN_SIM_WORKER__) return;
  const canvas = document.getElementById("game");
  const overlayText = document.getElementById("overlayText");
  overlayText.textContent = "LOADING...";

  try {
    const assets = new AssetBank();
    await assets.load();
    const game = new PacManGame(canvas, assets);
    window.pacmanGame = game;
    window.PacManDirections = DIRECTIONS;
    overlayText.textContent = "PRESS START";
    requestAnimationFrame(t => {
      game.lastFrame = t;
      game.frame(t);
    });
  } catch (err) {
    console.error(err);
    overlayText.textContent = "FAILED TO LOAD ASSETS";
  }
})();
