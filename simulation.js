"use strict";

(() => {
  const openBtn = document.getElementById("simulationBtn");
  const panel = document.getElementById("simulationPanel");
  const closeBtn = document.getElementById("simulationCloseBtn");
  const runBtn = document.getElementById("simulationRunBtn");
  const cancelBtn = document.getElementById("simulationCancelBtn");
  const countSelect = document.getElementById("simulationCount");
  const progress = document.getElementById("simulationProgress");
  const progressText = document.getElementById("simulationProgressText");
  const resultsEl = document.getElementById("simulationResults");
  if (!openBtn || !panel || !runBtn) return;

  let running = false;
  let workers = [];
  let cancelRequested = false;

  const fmt = n => Math.round(n).toLocaleString();
  const nextPaint = () => new Promise(resolve => setTimeout(resolve, 0));

  function setPanelOpen(open) {
    panel.classList.toggle("hidden", !open);
    if (open) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  openBtn.addEventListener("click", () => setPanelOpen(true));
  closeBtn?.addEventListener("click", () => { if (!running) setPanelOpen(false); });
  cancelBtn?.addEventListener("click", () => {
    cancelRequested = true;
    for (const worker of workers) worker.terminate();
    workers = [];
  });

  function stats(values) {
    if (!values.length) return { avg: 0, low: 0, max: 0 };
    let total = 0, low = Infinity, max = -Infinity;
    for (const value of values) {
      total += value;
      low = Math.min(low, value);
      max = Math.max(max, value);
    }
    return { avg: total / values.length, low, max };
  }

  function drawHistogram(canvas, scores) {
    const ctx = canvas.getContext("2d");
    const cssWidth = Math.max(320, canvas.clientWidth || 720);
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(300 * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
    if (!scores.length) return;

    const min = Math.min(...scores), max = Math.max(...scores);
    const binCount = scores.length <= 100 ? 10 : scores.length <= 500 ? 14 : 18;
    const span = Math.max(1, max - min);
    const step = span / binCount;
    const bins = Array(binCount).fill(0);
    for (const score of scores) {
      let idx = Math.floor((score - min) / step);
      if (idx >= binCount) idx = binCount - 1;
      bins[Math.max(0, idx)] += 1;
    }
    const maxCount = Math.max(1, ...bins);
    const pad = { left: 48, right: 14, top: 16, bottom: 42 };
    const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;

    ctx.strokeStyle = "#555";
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    const barW = plotW / binCount;
    ctx.fillStyle = "#ffd800";
    bins.forEach((count, i) => {
      const h = count / maxCount * plotH;
      ctx.fillRect(pad.left + i * barW + 1, pad.top + plotH - h, Math.max(1, barW - 2), h);
    });

    ctx.font = "11px Courier New, monospace";
    ctx.fillStyle = "#bdbdbd";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
      const value = min + span * i / 4;
      ctx.fillText(fmt(value), pad.left + plotW * i / 4, H - 18);
    }
    ctx.textAlign = "right";
    ctx.fillText(String(maxCount), pad.left - 6, pad.top + 4);
    ctx.fillText("0", pad.left - 6, pad.top + plotH + 4);
    ctx.textAlign = "center";
    ctx.fillStyle = "#888";
    ctx.fillText("Score", pad.left + plotW / 2, H - 3);
  }

  function updateLevelResults(level, scores, clears) {
    const s = stats(scores);
    document.getElementById(`simL${level}Avg`).textContent = fmt(s.avg);
    document.getElementById(`simL${level}Low`).textContent = fmt(s.low);
    document.getElementById(`simL${level}Max`).textContent = fmt(s.max);
    document.getElementById(`simL${level}Clear`).textContent = `${clears}/${scores.length} (${scores.length ? Math.round(clears / scores.length * 100) : 0}%)`;
    drawHistogram(document.getElementById(`simL${level}Histogram`), scores);
  }

  function seedFor(level, index) {
    let x = (0x9e3779b9 ^ (level * 0x85ebca6b) ^ ((index + 1) * 0xc2b2ae35)) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  }

  async function runWithWorkers(runs, onResult) {
    const allTasks = [];
    for (const level of [1, 2]) {
      for (let i = 0; i < runs; i++) allTasks.push({ level, seed: seedFor(level, i) });
    }
    const desired = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1, allTasks.length));
    const groups = Array.from({ length: desired }, () => []);
    allTasks.forEach((task, i) => groups[i % desired].push(task));

    await Promise.all(groups.map(tasks => new Promise((resolve, reject) => {
      const worker = new Worker("simulation-worker.js");
      workers.push(worker);
      worker.onmessage = event => {
        const msg = event.data || {};
        if (msg.type === "batch") for (const result of msg.results || []) onResult(result);
        if (msg.type === "done") { worker.terminate(); resolve(); }
      };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message || "Simulation worker failed")); };
      worker.postMessage({ tasks });
    })));
    workers = [];
  }

  // Fallback for browsers that disable workers when the project is opened from
  // a local file. It is slower, but preserves the same simulation rules.
  function runOneFallback(level, seed) {
    const GameClass = window.__pacmanGameInternals?.PacManGame;
    const PacManAI = window.__pacmanAIInternals?.PacManAI;
    if (!GameClass || !PacManAI) throw new Error("Simulation engine is not ready.");
    const canvas = document.createElement("canvas");
    const game = new GameClass(canvas, { image() { return null; } }, { headless: true, simulationRandom: true, seed });
    const ai = new PacManAI(game);
    game.aiController = ai;
    game.builtInAgent = () => ai.decide();
    game.setAgent(game.builtInAgent);
    game.clearAgent = function () { this.setAgent(this.builtInAgent); return this; };
    game.started = true; game.gameOver = false; game.score = 0; game.lives = 3; game.level = level; game.simulationNowMs = 0;
    game.loadLevel(level); game.resetActors(); game.enableActors();
    const dt = 1 / 60; let now = 0;
    for (let step = 0; step < 300 / dt; step++) {
      now += dt * 1000; game.update(dt, now);
      if (game.waitUntil) { const cb = game.waitAction; game.waitUntil = 0; game.waitAction = null; if (cb) cb(); }
      if (game.level > level || game.gameOver) break;
    }
    return { level, score: Math.round(game.score), cleared: game.level > level };
  }

  async function runFallback(runs, onResult) {
    for (const level of [1, 2]) {
      for (let i = 0; i < runs; i++) {
        if (cancelRequested) return;
        onResult(runOneFallback(level, seedFor(level, i)));
        if ((i + 1) % 2 === 0) await nextPaint();
      }
    }
  }

  runBtn.addEventListener("click", async () => {
    if (running) return;
    const runs = Number(countSelect.value);
    if (![100, 500, 1000].includes(runs)) return;

    running = true;
    cancelRequested = false;
    workers = [];
    runBtn.disabled = true;
    countSelect.disabled = true;
    cancelBtn.disabled = false;
    closeBtn.disabled = true;
    resultsEl.classList.add("hidden");
    progress.max = runs * 2;
    progress.value = 0;

    const visibleGame = window.pacmanGame;
    const shouldResume = Boolean(visibleGame?.started && !visibleGame.paused && !visibleGame.gameOver);
    if (shouldResume) visibleGame.pause();

    const scores = { 1: [], 2: [] };
    const clears = { 1: 0, 2: 0 };
    let completed = 0;
    const onResult = result => {
      scores[result.level].push(result.score);
      if (result.cleared) clears[result.level] += 1;
      completed += 1;
      progress.value = completed;
      progressText.textContent = `Completed ${completed.toLocaleString()} of ${(runs * 2).toLocaleString()} level simulations…`;
    };

    try {
      progressText.textContent = `Starting ${runs.toLocaleString()} simulations per level…`;
      if (typeof Worker === "function") {
        try { await runWithWorkers(runs, onResult); }
        catch (workerError) {
          if (cancelRequested) throw workerError;
          progressText.textContent = "Workers unavailable; switching to local simulation…";
          // Restart cleanly rather than mixing partial worker results with fallback.
          scores[1] = []; scores[2] = []; clears[1] = 0; clears[2] = 0; completed = 0; progress.value = 0;
          await runFallback(runs, onResult);
        }
      } else {
        await runFallback(runs, onResult);
      }

      if (!cancelRequested) {
        updateLevelResults(1, scores[1], clears[1]);
        updateLevelResults(2, scores[2], clears[2]);
        resultsEl.classList.remove("hidden");
        progressText.textContent = `Complete: ${runs.toLocaleString()} simulations per level (${(runs * 2).toLocaleString()} total).`;
        await nextPaint();
        drawHistogram(document.getElementById("simL1Histogram"), scores[1]);
        drawHistogram(document.getElementById("simL2Histogram"), scores[2]);
      } else {
        progressText.textContent = "Simulation cancelled.";
      }
    } catch (err) {
      progressText.textContent = cancelRequested ? "Simulation cancelled." : `Simulation error: ${err.message}`;
    } finally {
      for (const worker of workers) worker.terminate();
      workers = [];
      running = false;
      runBtn.disabled = false;
      countSelect.disabled = false;
      cancelBtn.disabled = true;
      closeBtn.disabled = false;
      if (shouldResume && visibleGame && !visibleGame.gameOver) visibleGame.resume();
    }
  });
})();
