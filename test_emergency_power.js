const fs = require('fs');
const vm = require('vm');
const ctx = {
  console,
  performance: { now: () => 0 },
  localStorage: { getItem(){return null;}, setItem(){} },
  Audio: class { cloneNode(){return new this.constructor();} play(){return Promise.resolve();} },
  Image: class {},
  requestAnimationFrame(){}, setInterval(){return 0;}, clearInterval(){},
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {};
class El { constructor(){this.textContent='';this.classList={add(){},remove(){}};this.children=[];} addEventListener(){} replaceChildren(){} appendChild(){} }
const elements = new Map();
ctx.document = { getElementById(id){ if(!elements.has(id)) elements.set(id,new El()); return elements.get(id); }, createElement(){ return new El(); } };
vm.createContext(ctx);
let src = fs.readFileSync(__dirname + '/game.js','utf8');
src = src.slice(0, src.indexOf('(async function boot()')) + '\n;globalThis.__gameExports={PacManGame};';
vm.runInContext(src, ctx, {filename:'game.js'});
vm.runInContext(fs.readFileSync(__dirname + '/ai.js','utf8'), ctx, {filename:'ai.js'});
const game = new ctx.__gameExports.PacManGame({width:672,height:864,getContext(){return new Proxy({imageSmoothingEnabled:false},{get(t,p){if(!(p in t))t[p]=()=>{};return t[p];},set(t,p,v){t[p]=v;return true;}});}}, {image(){return null;}});
ctx.pacmanGame = game;
const ai = new ctx.__pacmanAIInternals.PacManAI(game); game.aiController=ai; game.setAgent(()=>ai.decide());
// Lower-left power pellet is at (-13,-8); put Pac-Man adjacent at (-12,-8).
game.pacman.x=-12; game.pacman.y=-8; game.pacman.prevX=-12; game.pacman.prevY=-8; game.pacman.direction={x:-1,y:0,name:'left'}; game.pacman.nextDirection={x:0,y:0,name:'stop'};
// Put Blinky close on the only ordinary corridor side to create an immediate trap.
const b=game.ghosts[0]; b.x=-10.2; b.y=-8; b.prevX=b.x; b.prevY=b.y; b.enabled=true; b.leavingHome=false; b.eatenEyes=false; b.state='Chasing'; b.direction={x:-1,y:0,name:'left'};
for (let i=1;i<game.ghosts.length;i++){ game.ghosts[i].state='Home'; game.ghosts[i].leavingHome=false; game.ghosts[i].x=-1; game.ghosts[i].y=1; }
const f=ai.features(); const pellet=game.grid.pelletAt(-13,-8); const emergency=ai.emergency(f,true); const authorized=ai.authorizePowerPellet(pellet); const decision=ai.decide();
console.log(JSON.stringify({threat:f.threat, immediateDanger:f.immediateDanger, safeExits:f.safeExits, emergencyType:emergency?.type, emergencyTarget:emergency?.target, authorized, decision},null,2));
if (emergency?.type !== 'EMERGENCY_POWER_PELLET' || !authorized || decision !== 'left') process.exit(1);
