"use strict";

self.window = self;
self.__PACMAN_SIM_WORKER__ = true;
self.setInterval = () => 0;
self.clearInterval = () => {};
self.performance = self.performance || { now: () => 0 };

importScripts("game.js", "ai.js");

const { PacManGame } = self.__pacmanGameInternals;
const { PacManAI } = self.__pacmanAIInternals;

function makeCanvas() {
  const ctx = new Proxy({ imageSmoothingEnabled: false }, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = () => {};
      return target[prop];
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return { width: 1, height: 1, getContext() { return ctx; } };
}

function runOneLevel(level, seed) {
  const canvas = makeCanvas();
  const game = new PacManGame(canvas, { image() { return null; } }, {
    headless: true,
    simulationRandom: true,
    seed
  });
  const ai = new PacManAI(game);
  game.aiController = ai;
  game.builtInAgent = () => ai.decide();
  game.setAgent(game.builtInAgent);
  game.clearAgent = function clearHeadlessAgent() {
    this.setAgent(this.builtInAgent);
    return this;
  };

  game.started = true;
  game.paused = false;
  game.gameOver = false;
  game.score = 0;
  game.lives = 3;
  game.level = level;
  game.simulationNowMs = 0;
  game.loadLevel(level);
  game.resetActors();
  game.enableActors();

  const dt = 1 / 60;
  const maxSteps = Math.ceil(300 / dt);
  let nowMs = 0;
  for (let step = 0; step < maxSteps; step++) {
    nowMs += dt * 1000;
    game.update(dt, nowMs);
    if (game.waitUntil) {
      const cb = game.waitAction;
      game.waitUntil = 0;
      game.waitAction = null;
      if (cb) cb();
    }
    if (game.level > level || game.gameOver) break;
  }
  return {
    level,
    score: Math.max(0, Math.round(game.score)),
    cleared: game.level > level
  };
}

self.onmessage = event => {
  const { tasks = [] } = event.data || {};
  const batch = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    batch.push(runOneLevel(task.level, task.seed));
    if (batch.length >= 5 || i === tasks.length - 1) {
      self.postMessage({ type: "batch", results: batch.splice(0) });
    }
  }
  self.postMessage({ type: "done" });
};
