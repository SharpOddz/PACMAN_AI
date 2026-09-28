/* Deterministic two-level regression benchmark.
   Run from this folder with: node benchmark_two_levels.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let nowMs = 0;
global.window = global;
global.addEventListener = () => {};
global.performance = { now: () => nowMs };
global.localStorage = { d:new Map(), getItem(k){return this.d.get(k)||null;}, setItem(k,v){this.d.set(k,String(v));} };
global.Audio = class { cloneNode(){return new Audio();} play(){return Promise.resolve();} set preload(v){} set currentTime(v){} };
global.Image = class {};
global.requestAnimationFrame = () => {};
global.setInterval = () => 0;
global.clearInterval = () => {};
class El { constructor(){this.textContent='';this.classList={add(){},remove(){}};this.children=[];} addEventListener(){} replaceChildren(){this.children=[];} appendChild(x){this.children.push(x);} }
const elements = new Map();
global.document = { getElementById(id){ if(!elements.has(id)) elements.set(id,new El()); return elements.get(id); }, createElement(){return new El();} };
const ctx = new Proxy({imageSmoothingEnabled:false},{get(t,p){if(!(p in t))t[p]=()=>{};return t[p];},set(t,p,v){t[p]=v;return true;}});
const canvas = new El(); canvas.width=672; canvas.height=864; canvas.getContext=()=>ctx;
const base = __dirname;
let gameSrc = fs.readFileSync(path.join(base,'game.js'),'utf8');
gameSrc = gameSrc.slice(0,gameSrc.indexOf('(async function boot()')) + '\n;globalThis.__gameExports={PacManGame};';
vm.runInThisContext(gameSrc,{filename:'game.js'});
vm.runInThisContext(fs.readFileSync(path.join(base,'ai.js'),'utf8'),{filename:'ai.js'});
const {PacManGame} = global.__gameExports;
const {PacManAI} = global.__pacmanAIInternals;
const game = new PacManGame(canvas,{image(){return null;}});
global.pacmanGame = game;
const ai = new PacManAI(game);
game.aiController=ai; game.builtInAgent=()=>ai.decide(); game.setAgent(game.builtInAgent);
game.clearAgent=function(){this.setAgent(this.builtInAgent);return this;};
let deaths=0;
const oldDeath=game.pacmanEaten.bind(game); game.pacmanEaten=()=>{deaths++;oldDeath();};
game.start();
const levelScores={}; let lastLevel=game.level, scoreAtLevelStart=game.score;
const dt=1/60;
for(let i=0;i<600/dt;i++){
  nowMs += dt*1000;
  game.update(dt,nowMs);
  if(game.waitUntil && game.waitUntil-nowMs>100){const cb=game.waitAction;game.waitUntil=0;game.waitAction=null;if(cb)cb();}
  if(game.level!==lastLevel){levelScores[lastLevel]=game.score-scoreAtLevelStart;scoreAtLevelStart=game.score;lastLevel=game.level;}
  if(game.level>2 || game.gameOver) break;
}
if(lastLevel<=2) levelScores[lastLevel]=game.score-scoreAtLevelStart;
console.log(JSON.stringify({twoLevelsCleared:game.level>2,score:game.score,levelScores,livesRemaining:game.lives,deaths,timeSeconds:+(nowMs/1000).toFixed(2)},null,2));
