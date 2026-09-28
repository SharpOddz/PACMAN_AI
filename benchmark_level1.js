/* Deterministic Level-1 benchmark for the browser Pac-Man AI.
   Run from this folder with: node benchmark_level1.js */
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
game.started=true; game.gameOver=false; game.score=0; game.lives=3; game.level=1;
game.grid.resetPellets(); game.maxPellets=game.grid.activePelletCount(); game.resetActors(); game.enableActors();
let deaths=0, powers=0, ghostPoints=0;
const oldDeath=game.pacmanEaten.bind(game); game.pacmanEaten=()=>{deaths++;oldDeath();};
const oldGhost=game.ghostEaten.bind(game); game.ghostEaten=(g)=>{ghostPoints += g.points*game.ghostMultiplier;oldGhost(g);};
const oldPellet=game.tryEatPellet.bind(game); game.tryEatPellet=()=>{const b=[...game.grid.pellets.values()].filter(p=>!p.eaten&&p.type==='power').length;oldPellet();const a=[...game.grid.pellets.values()].filter(p=>!p.eaten&&p.type==='power').length;powers+=b-a;};
const dt=1/60;
for(let i=0;i<240/dt;i++){
  nowMs += dt*1000;
  game.update(dt,nowMs);
  if(game.waitUntil && game.waitUntil-nowMs>100){const cb=game.waitAction;game.waitUntil=0;game.waitAction=null;if(cb)cb();}
  if(game.level>1 || game.gameOver) break;
}
console.log(JSON.stringify({level1Cleared:game.level>1,score:game.score,livesRemaining:game.lives,deaths,powerPelletsUsed:powers,ghostPoints,timeSeconds:+(nowMs/1000).toFixed(2)},null,2));
