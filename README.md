# Pac-Man AI HTML / JavaScript / CSS Port — Pac-Man + Ghost Behavior Trees

This project ports the supplied Unity Pac-Man assignment base into a browser implementation and adds the score-maximizing AI architecture designed for the assignment.

## Run it

Open `index.html` in a browser, or serve the folder locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Player control

Pac-Man is **AI-only**. Press **Start AI** to begin. Keyboard input does not control Pac-Man. The remaining buttons are meta-controls only: Pause, Restart, and Sound.

## AI architecture

The controller is implemented in `ai.js`:

1. **Finite State Machine** — chooses `COLLECT`, `THREATENED`, `SETUP`, `POWERED`, `BONUS`, or `SCORE_ENDGAME` from the current context. All valid states can transition to any other valid state.
2. **Behavior Tree** — Emergency Safety is checked first, then the branch for the active FSM state runs.
3. **Ghost clustering** — handled in the `SETUP` branch. Pac-Man can wait/lure ghosts near a power pellet and consume it once the cluster is worthwhile, or consume early if waiting becomes unsafe.
4. **Hybrid Reward Architecture utility** — valid goals are ranked using normalized score reward, safety reward, future-opportunity reward, and movement cost. The weights vary by FSM state.
5. **A* pathfinding** — converts the selected goal into the next `UP`, `DOWN`, `LEFT`, or `RIGHT` action.

Normal collection routes deliberately avoid power pellets so they are not consumed accidentally before the `SETUP`, safety, or endgame logic decides to use them.

The current professor base game has no fruit object. The `BONUS` FSM/Behavior Tree branch is implemented as a future-ready hook and activates automatically if a later version exposes `game.bonus` with position/value information.

## AI status panel

The sidebar shows the current FSM state, active behavior-tree behavior, selected target, and utility score while the AI plays.

## Unity-to-web mapping

| Unity source | Browser equivalent |
|---|---|
| `GameMgr.cs` | `PacManGame` lifecycle, score, lives, rounds |
| `GridMgr.cs` | `MazeGrid` and the supplied text maze |
| `Pacman.cs` | `PacmanActor` |
| `Movement.cs` | `Actor.updateMovement()` and buffered turning |
| `Pellet.cs` | `MazeGrid.pellets` + `tryEatPellet()` |
| `PowerPellet.cs` | Power-pellet handling / frightened state |
| `Teleporter.cs` | Tunnel warp at world `y = 1` |
| `GhostNew.cs` | `GhostActor` timing/state modes + `GhostBehaviorTree` |
| `GhostPhysics.cs` | Ghost grid movement and collisions |
| `CmdHome.cs` | Explicit home wait / respawn / house exit |
| `CmdScatter.cs` | Per-ghost corner scatter branch |
| `CmdChaser.cs` | Four unique chase subtrees |
| `CmdFrightened.cs` | Shared frightened flee branch |
| `SfxMgr.cs` | `SoundBank` |

## Professor rules preserved

- Pac-Man speed: `8`.
- Pac-Man remains faster than the enhanced ghosts: Pac-Man `8`, ghosts `6.2` (Blinky uses a small late-level pressure bias rather than a major speed increase).
- Normal pellet: `10` points.
- Power pellet: `50` points.
- Ghost scoring uses the professor's linear multiplier: `200, 400, 600, 800` for four consecutive captures.
- Frightened remains `8 s`. In v16 the ghost team uses a shared strategic FSM: `12 s` Scatter / `14 s` Chase, paused during frightened mode.
- Home delays: Blinky 0 s, Pinky 2 s, Inky 8 s, Clyde 16 s.
- Clearing the maze begins the next round while keeping score/lives.
- Tunnel teleport behavior is retained.

## Ghost AI behavior trees

Every ghost uses the same high-level Behavior Tree priority:

1. **HOME / EXIT** — wait for the release timer or respawn timer, then use the dedicated ghost-house exit path.
2. **FRIGHTENED** — flee Pac-Man while avoiding unnecessary reversals.
3. **SCATTER** — move toward that ghost's own corner.
4. **CHASE** — execute the ghost-specific chase subtree.

The chase mechanics are intentionally different:

- **Blinky — Direct Hunter / Elroy Pressure:** directly pressures Pac-Man; late in the level its movement utility becomes more aggressive as pellets run low.
- **Pinky — Junction Ambusher:** predicts Pac-Man's next real junction/decision point instead of blindly aiming at a fixed four-tile offset.
- **Inky — Escape-Lane Cutter:** predicts the next junction and selects a different exit lane from Blinky, improving map coverage without using a perfect mathematical pincer.
- **Clyde — Power Guard / Shy Chaser:** can guard a nearby unused power pellet when Pac-Man approaches it, chases from long range, and retreats when too close.

At each ghost decision point, a small **utility function** ranks legal directions using target progress, local junction quality, spacing from teammates, and personality-specific terms. A crowding penalty discourages several ghosts from stacking on the same corridor, producing better coverage instead of unfair dogpiles.

All active ghosts also share a **team FSM** for CHASE/SCATTER timing. This keeps their strategic phase synchronized while preserving their separate Behavior Trees inside CHASE.

The sidebar displays each ghost's current state and active Behavior Tree behavior while the game runs.

## Ghost-house fixes

- Pac-Man treats the center ghost-house region as forbidden and cannot enter through the pink door.
- Ghosts use their own house-compatible movement rules, so their exit corridor remains valid.
- A ghost eaten during frightened mode now enters a short explicit `HOME_RESPAWN` phase and then exits again; it no longer keeps frightened movement while inside the house.
- Frightened mode returns an outside ghost to its previous chase/scatter mode rather than incorrectly sending it to `HOME`.
- A power pellet eaten while a ghost is waiting/exiting does not free that ghost into the center. If frightened time is still active when it exits, it becomes frightened then.
- Pac-Man's AI ignores ghosts that are still HOME, exiting, or physically inside the protected house region, so they do not distort threat/utility calculations.

## Experiment interface

The game remains accessible through `window.pacmanGame`.

```js
const state = pacmanGame.getState();
```

The state snapshot includes the game state plus an `ai` object containing the current FSM state, behavior, target, utility value, and ghost-clustering value. `setAgent(fn)` can still be used later by the project code to replace the built-in controller for controlled experiments, but the web page itself provides no human Pac-Man controls.

## AI movement stability update

The AI movement controller uses tile-center commitment to prevent rapid direction thrashing. Normal planning occurs when Pac-Man reaches a new tile center; an emergency may interrupt once during a movement segment, after which the escape direction is held until the next center. If Pac-Man is stopped or its committed direction is blocked at a tile center, the controller immediately replans. AI `stop` commands are ignored by the game loop so a transient planning failure cannot intentionally freeze Pac-Man.

## Safety controller update (v3)
The emergency controller now compares each legal next tile against every dangerous ghost using both maze-path distance and the actors' real sub-tile positions. If another safe route exists, Pac-Man will not choose a move that decreases its separation from a nearby ghost, and it will not reverse directly toward a pursuing ghost. Nearby power-pellet routes are subject to the same opening-move safety check. A dangerous reversal is retained only when no safer legal direction exists (for example, at a dead end).

## Pac-Man AI v5: movement stability + power-pellet planning

This revision improves two behaviors that were causing avoidable deaths and wasted power pellets.

### Movement stability
- Pac-Man now commits to multi-tile goals instead of selecting a brand-new goal at every tile.
- Mid-tile AI U-turns are queued until the next tile center rather than happening instantly.
- Non-emergency U-turns have a three-tile cooldown unless Pac-Man reaches a dead end.
- Emergency logic can still interrupt a plan when a collision threat is critical.

### Power-pellet planning
- SETUP now uses a conservative predicted-capture count rather than only a broad ghost-clustering radius.
- Normal power-pellet use requires at least two realistically clustered ghosts: generally two ghosts within six path tiles, with at least one within four tiles and a sufficiently tight average cluster.
- A power pellet may still be used early if it is within two tiles during a genuine immediate danger situation.
- If the cluster is not ready, Pac-Man preserves the power pellet and continues luring/repositioning.
- During POWERED mode Pac-Man locks onto one edible ghost at a time, aims slightly ahead of the fleeing ghost, and ignores targets estimated to be unreachable before frightened mode ends.

## Pac-Man AI v6 stability / power-pellet changes
- Pac-Man now keeps its current direction through straight corridors; replanning is limited to meaningful junctions/corners/dead ends or emergencies.
- Non-emergency U-turns are blocked whenever a safe non-reversing legal move exists. A reversal is still allowed if every forward/side option is unsafe or the maze forces a dead-end turn.
- FSM hysteresis was increased so small score fluctuations do not constantly cancel a multi-tile plan.
- Power-pellet consumption now goes through one centralized permission gate used by every Behavior Tree branch.
- A normal scoring power pellet can only be entered from the adjacent tile after the ghost cluster is re-evaluated immediately before consumption.
- The scoring gate requires at least two ghosts in a close capture window (two within 4 path tiles, closest within 3, second within 5, average reliable-capture distance <= 4.25).
- Emergency power-pellet use is limited to an adjacent pellet with an immediate near-collision threat.
- If a good cluster exists while Pac-Man is farther away, the AI moves to a safe staging tile adjacent to the pellet, then rechecks the ghosts before taking the final step.
- If only protected power pellets remain, Pac-Man patrols/lures instead of treating a power pellet as a required cleanup dot.

## AI v7 — structural stability and predictive safety

This revision replaces several reactive/short-horizon behaviors that could create corridor oscillation or eventual ghost collisions.

- **Real multi-tile plan memory:** a selected pellet/lure/positioning goal is followed across multiple tile centers instead of being freely replaced at every intersection.
- **Loop detection:** recent Pac-Man cells are remembered; ABAB-style and short cyclic movement is detected and penalized/broken.
- **Global U-turn guard:** outside a true emergency or powered ghost chase, Pac-Man cannot repeatedly reverse unless the reversal has a substantially better predicted safety margin than all forward/side choices.
- **Time-to-intercept route safety:** routes are evaluated by comparing Pac-Man's arrival time at upcoming tiles (speed 8) with each dangerous ghost's shortest possible arrival time (speed 7), rather than using only static distance.
- **Predictive emergency escape:** emergency routing evaluates several tiles ahead to the next junction/corner and rejects corridors a ghost can plausibly intercept.
- **SETUP eligibility tightened:** SETUP is only considered when Pac-Man and at least two dangerous ghosts are already within a reasonable staging range of a power pellet. Pac-Man no longer camps around a pellet simply because two ghosts exist somewhere on the board.
- **Power-pellet gate tightened:** ordinary power-pellet use still requires at least two realistically catchable ghosts; increased pressure now aborts the setup instead of automatically consuming the pellet. Emergency use remains limited to an adjacent pellet during genuine immediate danger.
- **Better luring:** lure points are selected on the opposite side of the power pellet from the ghost centroid, must have safe predicted routes, and are heavily penalized if recently revisited.
- **Frightened-ghost target lock:** after eating a power pellet, Pac-Man keeps pursuing the same reachable frightened ghost instead of switching targets at every tile center.

## Packaging fix (v7.1)

The v7 ZIP accidentally omitted the `assets/` directory. v7.1 restores every sprite and sound referenced by `game.js` under `assets/sprites/` and `assets/sounds/`. No AI logic was changed by this packaging-only fix.

## Pac-Man AI v8 stability changes

This revision addresses the remaining target-switching/stutter behavior at the planning level rather than by adding another movement penalty.

- Pac-Man only performs full planning at meaningful maze decision points (junctions/corners/dead ends), not repeatedly in straight corridors.
- Ordinary goals now have multi-junction target commitment. A pellet region, lure waypoint, staging square, bonus, or patrol target remains active until reached, invalidated, unsafe, or its plan lifetime expires.
- FSM transitions use a stronger switching margin so near-tied strategic states do not alternate rapidly.
- Powered mode locks the **ghost identity**. Pac-Man continues pursuing the same frightened ghost until it is eaten, ceases to be frightened, or can no longer be caught before the timer expires.
- Powered pursuit also avoids unnecessary U-turns; if a forward/side route can still catch the locked ghost, Pac-Man keeps that route instead of reversing.
- AI 180-degree turns are queued until the next tile center in `game.js`, preventing mid-corridor visual reversals.
- Predictive route safety compares Pac-Man ETA with ghost ETA over the next several route cells. Routes with likely interception are strongly downgraded or abandoned.
- Repeated `A-B-A-B` cell loops are detected. The current plan is cleared and recently visited targets are temporarily avoided.
- Power pellets have one centralized consumption gate. Normal scoring consumption is allowed only from an adjacent square when at least two dangerous ghosts are sufficiently close to the pellet. Emergency consumption is also adjacent-only.
- `SETUP` activates only when Pac-Man and at least two ghosts are already within a local staging range of the same power pellet.
- When a cluster is ready but Pac-Man is not adjacent, the AI chooses a safe **power staging square** rather than routing directly across the pellet.
- Reaching a locked waypoint explicitly completes that plan, preventing the controller from continuing to “hold” an already-finished target.

## Pac-Man AI v9 stability/safety fixes

v9 addresses the recurring corridor oscillation and collision failure structurally rather than with another utility-weight tweak:

- Repeated undirected corridor edges become temporarily **tabu**. Ordinary COLLECT/SETUP/PATROL/BONUS planning will not immediately reuse an A<->B edge when another safe route exists.
- `THREATENED` has exit hysteresis: Pac-Man must remain clearly safe for multiple decision centers before returning to a scoring state.
- Ordinary candidate routes now have a hard predictive-safety floor; unsafe routes are rejected instead of merely receiving a lower utility score.
- Ghost interception safety uses a larger timing margin.
- A head-on corridor detector uses real sub-tile positions and actor directions to identify closing collisions earlier.
- Ordinary AI planning remains junction/tile-center committed, but **emergency safety may interrupt mid-tile**. A one-segment emergency lock prevents that safety override from stuttering.
- The game checks the AI at 30 Hz for faster danger detection, while normal strategic replanning remains center/junction limited.
- Frightened-ghost pursuit still locks ghost identity, and now uses a short-lived stable target anchor rather than a two-tile projection that changes every time the ghost changes direction.

Validation: four simultaneous 30-second Chromium simulations completed with 0 A<->B corridor loops and 0 deaths in the final test batch.

## v10 AI refinements

- Power pellets now have a true engine-level authorization gate. The game checks the AI **before** marking a power pellet eaten, so a planner or movement-timing mistake cannot consume one accidentally.
- Normal power-pellet use is stricter: Pac-Man must be immediately adjacent, at least two active ghosts must be in a tight capture window, and the condition is rechecked using the ghosts' current positions on the exact consumption frame.
- Pac-Man also refuses to step onto an unauthorized power-pellet tile during ordinary movement; the game-level gate remains as a second fail-safe.
- Powered ghost hunting keeps a ghost **identity lock**, but no longer chases a stale position. It predicts that frightened ghost's likely flee path and aims for a future interception tile.
- A predicted target is only treated as a true interception when Pac-Man can arrive before or almost simultaneously with the ghost. Otherwise the fallback target is still projected ahead rather than behind the fleeing ghost.
- The AI status panel now includes the locked frightened ghost's name while hunting.

## v11 safety and power-pellet fixes

- Emergency Safety now checks an adjacent life-saving power pellet **before** ordinary escape routing.
- Normal power-pellet scoring remains cluster-aware, but the usable window is slightly less conservative (roughly closest ghost <= 3 path tiles and second ghost <= 5) so Pac-Man does not preserve pellets until death.
- Emergency power-pellet use is survival-driven: imminent danger plus a nearby threatening ghost can authorize the pellet even without an ideal two-ghost scoring cluster.
- Power-pellet activation is now enforced atomically. When a pellet is consumed, the global 8-second frightened timer is set first and every active ghost outside the house is guaranteed to enter `FRIGHTENED` with the correct remaining timer.
- Collision detection now uses both a more sprite-consistent 0.76-tile contact radius and swept collision testing between previous/current actor positions, preventing marginal overlaps and fast crossings from being missed.

## AI v12 — protected emergency power-pellet commitment

v12 fixes a remaining hesitation/death failure near power pellets.

- Emergency power-pellet planning now starts up to 4 path tiles away instead of only when Pac-Man is already adjacent.
- Once a survival power pellet is selected, it becomes a protected commitment for the final approach.
- FSM switching, HRA utility changes, loop/tabu rules, and normal reversal guards cannot replace that protected action while it remains valid.
- While crossing an intermediate tile, Pac-Man holds the same committed direction instead of replanning several times per tile.
- The approach route is checked for predicted ghost interception before commitment.
- The final pellet authorization is latched for the emergency commitment, preventing a last-frame threshold change from making Pac-Man hesitate directly on/next to the pellet.
- The ordinary score-optimization power-pellet rules remain unchanged; this protected behavior is specifically a survival override.

## v13 survival/level-clear review

This revision was produced after tracing complete game simulations rather than only tuning individual thresholds.

Key fixes:

- **Separate navigation graphs:** Pac-Man pathfinding uses the playable pellet/tunnel corridors; ghosts keep their broader ghost navigation graph. This prevents Pac-Man A* from routing through black/ghost-house filler spaces.
- **True ghost-distance estimates:** safety/interception calculations use the routes ghosts can actually take rather than reusing Pac-Man's graph.
- **Critical-evasion shield:** near-collision relative-motion checks run at the AI poll rate. Only a true emergency 180-degree reversal can occur mid-tile; perpendicular turns still wait for a legal center.
- **Hard route safety:** ordinary pellet plans are rejected when predicted ghost interception is too likely instead of merely receiving a small utility penalty.
- **Shorter plan locks:** normal goals are retained long enough to avoid stutter but are revalidated frequently so the AI does not blindly follow stale routes.
- **Power-pellet race logic:** during rising danger, Pac-Man can commit to a reachable power pellet when it can win the race to the trigger. The final pellet tile is not incorrectly treated as unsafe simply because ghosts are nearby.
- **Endgame completion rule:** if only power pellets remain, they become mandatory completion goals rather than resources the AI waits forever to use.
- **Power activation ordering:** AI authorization is checked before a power pellet is marked eaten; once eaten, frightened mode is applied atomically to all active outside ghosts.
- **Unity-like pellet trigger timing:** pickup happens by overlap radius rather than waiting for Pac-Man's center to be almost exactly on the pellet center.
- **Swept collisions:** collisions catch actors crossing between frames, while teleporter jumps are excluded from sweep tests to avoid false cross-map deaths.
- **AI reset on life loss:** plans, target locks, emergency commitments and loop memory are cleared whenever actors reset.
- **Ghost BT balance:** all four ghosts keep unique Behavior Tree targets, but movement selection now matches the professor's local one-step heuristic rather than omniscient shortest-path BFS. Inky is an independent flanker rather than a mathematically coordinated Blinky pincer.
- **Ghost speed reset bug fixed:** the reset path no longer silently restores the old stronger speed after every life.

A deterministic accelerated simulation using the same `game.js` and `ai.js` logic cleared Level 1 and entered Level 2 while retaining one life. The trace used all four power pellets and produced no JavaScript runtime errors.

## v14 power-pellet synchronization fix

- Restored Unity-faithful pickup semantics: if Pac-Man physically overlaps a power pellet, the game engine always consumes it and activates frightened mode. The AI can no longer veto a pellet after contact and leave it visibly on the board.
- Strategic preservation remains in the planner: normal A* routes treat every unapproved power-pellet tile as forbidden; only SETUP, emergency-power, defensive-power, or required-endgame power actions deliberately route onto one.
- Pac-Man's `POWERED` FSM state is now driven by the authoritative global frightened timer rather than the presence of an edible ghost in the current feature list.
- The feature extractor reads `game.frightenedTimeRemaining()` directly, so HOME/exiting/eaten ghosts cannot accidentally suppress the powered phase.
- Power-pellet activation remains atomic: pellet disappears, score is awarded, the 8-second timer starts, active outside ghosts are forced to FRIGHTENED, and home ghosts inherit frightened mode if it is still active when they exit.

## v15 - Score-maximizing ghost trapping / hunting

This revision changes the Pac-Man objective from primarily clearing the maze to extracting more score from each level while still surviving and completing it.

### Power-pellet setup / trapping
- SETUP now estimates how many ghosts are realistically capturable if a power pellet is triggered now.
- With 3-4 active ghosts, Pac-Man normally aims for a 3+ ghost opportunity rather than consuming the pellet as soon as two ghosts are nearby.
- A setup can fall back to a strong two-ghost opportunity after Pac-Man has invested enough time luring, or late in the level.
- Lure points now include a **funnel score**: they are preferred when predicted ghost routes toward Pac-Man pass close to the selected power pellet.
- SETUP gives more utility weight to future score and less to path cost.

### Powered ghost hunting
- POWERED mode now plans a **capture sequence** across all edible ghosts.
- The planner enumerates possible ghost orders (maximum four ghosts), estimates whether each sequence fits inside the remaining frightened window, and favors the sequence with the most captures / highest projected chain score.
- The current ghost identity remains locked until it is captured or becomes realistically unreachable.
- After a capture the remaining chain is replanned from the new game state.
- If no capture is immediately available but frightened time remains, Pac-Man repositions toward a future interception rather than instantly returning to pellet collection.

### Endgame score extraction
- When power pellets remain late in the level, Pac-Man tries to preserve enough ordinary dots to give itself time to use those power pellets for ghost points.
- The AI can enter a score-holding / lure pattern near a remaining power pellet instead of blindly clearing the final ordinary pellets.
- If only power pellets remain, they are still treated as mandatory completion goals so the AI cannot stall forever.

### Power-pellet control
- Strategic power-pellet entry is explicitly authorized. Ordinary collection cannot intentionally route onto a reserved power pellet.
- Physical contact still always activates the pellet, matching the Unity rule.
- Emergency power use remains available when survival requires it; score optimization never overrides a clearly life-saving use.

### Deterministic comparison
Using the included game/AI logic in the same deterministic test harness:
- v14 Level 1 score: ~3420
- v15 Level 1 score: ~4020
- v15 reached Level 2 and produced a three-ghost chain on one frightened window.

These numbers are not a guaranteed maximum; the purpose of v15 is to create a stronger score-oriented baseline for later tuning / search / learning experiments.


## v16 — Enhanced Ghost AI + Higher-Scoring Pac-Man

This revision improves both sides of the experiment.

### Ghost AI
- Added a shared ghost-team FSM with synchronized `SCATTER` and `CHASE` phases (`12 s` / `14 s`). Frightened mode pauses the team clock.
- Blinky gains a late-level **Elroy pressure** behavior.
- Pinky predicts the next meaningful Pac-Man junction for ambushes.
- Inky acts as an **escape-lane cutter**, choosing a complementary route rather than a perfect pincer.
- Clyde can **guard power-pellet zones**, while retaining its chase/retreat personality.
- Legal ghost moves are ranked with a lightweight **utility function** instead of target distance alone. The utility includes target progress, junction value, team spacing, and personality-specific preferences.
- A team-crowding penalty improves coverage and prevents several ghosts from blindly stacking in one corridor.

### Pac-Man AI
- Frightened-ghost interception uses a shorter, more reliable prediction horizon rather than over-projecting a fleeing ghost many tiles into the future.
- During `POWERED`, Pac-Man may immediately U-turn toward its **locked ghost target**. Because the ghost identity remains locked, this improves chain captures without recreating ordinary target-switching stutter.
- Safety thresholds were strengthened to react earlier to the smarter ghost team.
- Endgame logic can wait for a synchronized scatter window before attempting the final few ordinary pellets.

### Deterministic Level-1 benchmark
Run:

```bash
node benchmark_level1.js
```

Current v16 result:

- **Level 1 cleared:** yes
- **Level 1 score:** **5,820**
- V15 reference score: **4,020**
- Improvement: **+1,800 points (+44.8%)**
- Ghost-capture points: **3,200**
- Power pellets used: **4 / 4**
- Lives remaining on entry to Level 2: **1**

The benchmark is deterministic and is included primarily as a regression test so future AI changes can be checked against the 4,020-point V15 baseline.


## V17 — Level 2: Crossroads

V17 adds a second playable maze while leaving the V16 Level 1 layout and AI behavior unchanged.

- **Level 1 — Classic:** original professor maze, 246 pellets (242 small + 4 power).
- **Level 2 — Crossroads:** new higher-intersection maze, also 246 pellets (242 small + 4 power).
- Level 2 contains **24 additional wall openings** and **24 empty walkable floor cells** so the total pellet count does not increase.
- The 24 empty corridor cells are represented internally by `_`; the editable source file `level2.txt` retains them as spaces.
- Pac-Man and ghost pathfinders are rebuilt whenever a new level layout loads, so no Level 1 routes are cached into Level 2.
- All 246 Level 2 pellets are reachable from Pac-Man's starting position.
- Level 1 has 26 3+-way intersections under the browser navigation graph; Level 2 has 48.
- Clearing Level 1 automatically loads Level 2. If play continues beyond Level 2, the Level 2 layout remains the active maze for later level numbers until more authored layouts are added.

Regression checks:

- V16/V17 Level 1 deterministic benchmark remains **5,820 points**, 3,200 ghost points, and a successful Level 1 clear.
- A 60-second Level 2 smoke test completed with no runtime errors, 3 lives remaining, and 53 pellets remaining.

## v18 — Endgame completion + movement stability

This revision addresses two observed problems:

1. Pac-Man could stall when only a few ordinary pellets remained and there were no power pellets or fruit left.
2. Near-equal goals could cause abrupt target changes and short A↔B backtracks.

### Endgame completion

When no power pellets or fruit remain and the board has at most 12 normal pellets left, `SCORE_ENDGAME` becomes the authoritative strategic state. Pac-Man now keeps a persistent completion target instead of waiting for a scatter phase or patrolling for a scoring opportunity that no longer exists. Emergency Safety can still interrupt for a real collision, after which the same completion target is resumed when possible.

For the last few pellets, a short "finish race" is also permitted when Pac-Man can reach the selected dot before any dangerous ghost can intercept the route. This prevents coarse threat thresholds from pulling Pac-Man away from a safely reachable final pellet.

### Target stability / stutter reduction

- Target switching now requires a material utility or safety improvement rather than a near tie.
- Long-lived pellet/endgame plans remain active until completed, unsafe, or genuinely outperformed.
- A detected `A → B → A` bounce temporarily marks that corridor edge as tabu for ordinary planning.
- A* automatically searches for an alternate first edge when a recently detected bounce edge would otherwise be reused.
- Reversing to a new target requires a larger improvement than switching to a forward/side target.

Emergency and frightened-ghost pursuit can still reverse when tactically necessary.

### Regression benchmarks

Previous v17 deterministic Level 1 benchmark:

- Level 1 score: **5,820**
- Lives after Level 1: **1**
- Deaths: **2**
- Ghost points: **3,200**
- Time: **158.68 s**

v18 deterministic Level 1 benchmark:

- Level 1 score: **9,220**
- Lives after Level 1: **2**
- Deaths: **1**
- Ghost points: **6,600**
- Time: **103.88 s**

The Level 1 A→B→A center-loop count fell from **50 to 40** in the regression trace while the level completed substantially faster.

Full continuous two-level comparison:

- **v17:** Level 1 = 5,820; Level 2 = 4,090 before game over; both levels were not completed.
- **v18:** Level 1 = 9,220; Level 2 = 4,820; **both levels cleared**, total score = **14,040**, with **1 life remaining**.

Use `node benchmark_level1.js` for the Level 1 regression and `node benchmark_two_levels.js` for the complete Level 1 → Level 2 regression.


## v19 — Collision correctness + playback speed

This version fixes intermittent "phantom" life losses and adds viewer-only playback speed controls.

### Collision fixes

- Ghost house exit movement now updates `prevX/prevY` every frame. Previously, on the exact frame a ghost finished leaving the house, swept collision could use a stale position deep inside the house and create an imaginary long collision segment.
- Swept collision is disabled for any frame where Pac-Man or a ghost turns at a tile center. A turn is a piecewise path; treating it as one straight segment cuts diagonally through a corner and can create false contacts.
- Teleporter jumps remain excluded from swept collision.
- Endpoint/start overlap is still checked, so real close contact is preserved.
- `window.pacmanGame.lastCollisionEvent` records the most recent collision type/positions for debugging.

The same bug could also create false frightened-ghost captures. In the v18 deterministic benchmark, two ghost captures were registered at center distances of approximately 7.9 and 8.1 tiles. In v19 all registered frightened-ghost captures in the Level 1 regression are within approximately 0.75 tile.

### Playback speed

The game footer now has `−`, a current-speed label, and `+`. Available speeds are:

`0.5x, 0.75x, 1x, 1.5x, 2x, 3x, 4x`

0.5x is the minimum and 4x is the maximum; the corresponding button disables at the limit. The game uses a fixed simulation timestep, so playback speed changes how quickly the user watches the simulation without changing Pac-Man/ghost speed ratios, AI cadence in game-time, frightened duration, or collision rules.

### Corrected deterministic benchmarks

Because v18's swept-collision bug also awarded impossible ghost captures, its 9,220 Level 1 score is not a valid apples-to-apples scoring baseline. With the collision model corrected:

- Level 1: 7,020 points, 2 lives remaining, 1 death, 4 power pellets used, 4,400 valid ghost points.
- Full Level 1 -> Level 2 regression: both levels clear, 11,840 total points, Level 2 = 4,820 points, 1 life remaining.

These figures should be treated as the new collision-correct baseline for future AI comparisons.

## v20 fixes

- Corrected Level 2 wall openings: the 24 new openings are now empty walkable corridor cells (`_` internally / spaces in `level2.txt`), not pellet cells. The 24 displaced pellets were restored to ordinary corridor cells, preserving exactly 246 pellets (242 small + 4 power pellets).
- Level 2 still has 48 three-or-more-way intersections versus 26 on Level 1, and all 246 pellets remain reachable.
- Added a hard adjacent emergency power-pellet rule. If Pac-Man is one legal move from a power pellet and is in immediate danger, has at most one safe exit, or has no safe non-power escape, the power pellet is chosen immediately.
- The same emergency rule is enforced at the tile-boundary authorization layer so Pac-Man cannot stop/stutter in front of the life-saving pellet while waiting for another planning cycle.
- Added `test_emergency_power.js` regression test for the trapped-corner case.

### v20 deterministic regression

- Level 1: 7,020 points, cleared, 2 lives remaining.
- Two-level run: both levels cleared, 11,640 total points, 1 life remaining.
- Level 2 corrected-layout score in that deterministic run: 4,620 points.

## v21 — true Level 2 wall openings + simulation mode

### Level 2 wall correction
- The previous Level 2 removed only one visible wall character at several locations. Many Pac-Man wall islands are 2–3 grid cells thick, so another wall/interior cell still blocked the route.
- Level 2 is now rebuilt from Level 1 using complete multi-cell cuts through the wall blocks. The new `_` cells are true empty corridor cells: they draw no wall, contain no pellet, and are passable to Pac-Man/A*.
- Level 2 still contains exactly **246 pellets**: 242 normal + 4 power pellets.
- All 246 pellets remain reachable.
- The corrected Level 2 has **64 3+-way intersection cells** under the browser navigation graph.
- All 50 empty corridor cells used by the new openings lie on a real horizontal or vertical through-route rather than being cosmetic wall gaps.

### Simulation button
The footer now contains a **Simulation** button. It opens a results panel where you can choose **100, 500, or 1,000 runs per level**.

- Level 1 and Level 2 are simulated independently with 3 lives each, so their score distributions are directly comparable.
- Simulation runs are headless; they are not drawn to the game canvas.
- Results include a separate score histogram for each level plus **average, low, max, and level-clear rate**.
- Browser workers are used in parallel when available. If workers are blocked (common when opening an HTML file directly), the page falls back to local headless simulation. Serving the folder with `python3 -m http.server 8000` is recommended for large simulation batches.
- The visible game is paused during a simulation batch and automatically resumes afterward if it was previously running.
- Monte Carlo runs use a small seeded tie-break perturbation only when ghost movement choices are nearly equal. This creates a meaningful distribution while leaving the visible game AI unchanged.
- Shared distance-map caching substantially accelerates repeated simulations without changing game decisions.

## v22 Reliability Update

The 100-run Simulation results in v21 showed that the score-seeking AI was clearing only about 70% of runs. The primary failure mode was not early navigation; most failed runs reached the final portion of a level and then lost all remaining lives in corridor traps.

v22 adds a life/risk budget and deeper survival planning:

- Pac-Man remains score-aggressive while it has a healthy life budget.
- With two or fewer lives, or late in the level, emergency routing uses a multi-junction survival look-ahead instead of evaluating only the next corridor.
- The survival search compares Pac-Man arrival time against adversarial ghost arrival time across several future tiles and junctions.
- With one life remaining, route-safety requirements become stricter and threat behavior activates earlier.
- In low-life/late-level situations, speculative power-pellet trapping is curtailed in favor of completing the board safely.
- Powered ghost hunting exits earlier near the end of frightened time when survival reliability is active, reducing the chance of finishing a chase inside a trap.
- Critical mid-tile evasion is corridor-constrained and has short action commitment to reduce frame-to-frame left/right oscillation.
- Normal high-score play is retained during the early part of the level; the deeper survival search is activated mainly after the risk budget is reduced.

### 100-run regression

Using the same seeded Monte Carlo batch for the revised controller:

| Metric | Level 1 | Level 2 |
| --- | ---: | ---: |
| Runs | 100 | 100 |
| Clears | 88 | 90 |
| Clear rate | 88% | 90% |
| Average score | 5,176.7 | 4,872.2 |
| Minimum score | 3,420 | 2,770 |
| Maximum score | 8,020 | 8,220 |
| Average deaths | 1.26 | 1.24 |

The user's v21 100-run Simulation screenshot showed 72% Level 1 clears and 71% Level 2 clears, so v22 improves completion reliability substantially while keeping the score distribution in a similar range.

## v23 Incremental Tuning Step 1

This revision intentionally makes only one Pac-Man AI change so its effect can be isolated:

- During `POWERED`, Pac-Man now checks for a frightened ghost that is still provably catchable before applying the normal late-frightened bail/reposition rule.
- The existing `poweredGhostCandidate()` catchability reserve still applies, so Pac-Man does not extend hopeless chases past the frightened timer.
- No FSM thresholds, power-pellet setup rules, ghost AI, survival search, or maze logic were otherwise changed.

Deterministic regression from the same build:

- Level 1: 6,020 points, cleared, 3 lives remaining, 3,400 ghost points.
- Continuous Level 1 -> Level 2: both levels cleared, 11,640 total points, 3 lives remaining.
- Per-level scores in that continuous regression: Level 1 = 6,020; Level 2 = 5,620.

This is an incremental checkpoint, not the final >90% / >=5,750 simulation target validation.

## v24 Incremental Tuning Step 2

This revision remains intentionally small. It adds one anti-stutter fix around power-pellet activation plus a minor chain-order bias:

- When `SETUP` reaches a validated power-pellet staging square, that exact pellet receives a short **final-approach latch**.
- The latch lasts only a few decision centers and only for that specific pellet. Small one-tile ghost movements can no longer revoke the final step and cause Pac-Man to reverse/stutter beside the pellet.
- True emergency collision handling still overrides the latch.
- The tile-boundary power authorization layer recognizes the same latch, so the planner and movement engine cannot disagree on the last move.
- The powered chain planner now places a slightly larger penalty on a slow first capture, favoring a quicker first ghost when two capture orders have similar total value.

Targeted regression:

- A staged pellet remained authorized even after the normal `canConsumePower()` gate became false.
- The AI returned `SETUP_COMMIT_POWER` for the latched pellet rather than changing direction.
- Deterministic Level 1 remained 6,020 points with 3 lives remaining.
- Deterministic Level 2 remained 5,620 points in the continuous two-level regression.

A 20-run stochastic smoke test was unchanged from v23 on the tested seeds, so this revision is primarily a correctness/stability fix rather than a claimed score increase. The next tuning step should target multi-ghost chain conversion efficiency.

## v25 UI-only update

No Pac-Man AI, ghost AI, FSM, Behavior Tree, utility, pathfinding, or simulation algorithms were changed in this version.

- Added a prominent **Start Level** selector with `Level 1 — Classic` and `Level 2 — Crossroads`.
- The chosen maze previews immediately before the run starts.
- **Start AI** begins directly on the selected level with 3 lives and a fresh score.
- Starting on Level 1 still advances normally to Level 2 after a clear.
- **Restart Run** returns to the level that was chosen at the beginning of the run.
- The HUD now displays both the level number and level name.
