# Pac-Man AI HTML / JavaScript / CSS Port

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
| `GhostNew.cs` | `GhostActor` ghost-state controller |
| `GhostPhysics.cs` | Ghost grid movement and collisions |
| `CmdHome.cs` | Ghost `HOME` behavior |
| `CmdScatter.cs` | Random ghost navigation |
| `CmdChaser.cs` | One-step greedy ghost chase |
| `CmdFrightened.cs` | One-step ghost flee |
| `SfxMgr.cs` | `SoundBank` |

## Professor rules preserved

- Pac-Man speed: `8`.
- Ghost speed: `7`.
- Normal pellet: `10` points.
- Power pellet: `50` points.
- Ghost scoring uses the professor's linear multiplier: `200, 400, 600, 800` for four consecutive captures.
- Chase: 20 s; Scatter: 7 s; Frightened: 8 s.
- Home delays: Blinky 0 s, Pinky 2 s, Inky 8 s, Clyde 16 s.
- The professor's same chase rule is retained for all four ghosts.
- Clearing the maze begins the next round while keeping score/lives.
- Tunnel teleport behavior is retained.

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
