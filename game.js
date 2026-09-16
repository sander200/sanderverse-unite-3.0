/**
 * SANDERVERSE UNITE 3.0
 * Solo (1v3+Omega) ou Eu+2 bots (3v3+Omega)
 * Gol na base contrária · Omega neutro no Frenesí
 */
(function () {
  "use strict";

  const WORLD_W = 1400;
  const WORLD_H = 2100;
  const MATCH_SECONDS = 300;
  const FRENZY_AT = 90;
  const GOAL_SCORE = 100;
  const CELL = 256;

  const FACTION_SOUTH = ["sander", "cristian", "babalu"];
  const FACTION_NORTH = ["polo", "lupe", "topete"];

  const HEROES = {
    sander:  { name: "SANDER",  color: "#00f2fe", skills: ["Tornados", "Diamante", "Aura"],     sheet: "sheet_sander",  portrait: "sander" },
    cristian:{ name: "CRISTIAN",color: "#ff6a00", skills: ["Lança", "Mergulho", "Descarga"],    sheet: "sheet_cristian",portrait: "cristian" },
    babalu:  { name: "BABALU",  color: "#4ea8ff", skills: ["Blaster", "Granada", "Barragem"],   sheet: "sheet_babalu",  portrait: "babalu" },
    polo:    { name: "POLO",    color: "#7cf0ff", skills: ["Orbe", "Circuito", "Yin-Yang"],     sheet: "sheet_polo",    portrait: "polo" },
    lupe:    { name: "LUPE",    color: "#c8f7c5", skills: ["Corte", "Asas", "Círculo"],         sheet: "sheet_lupe",    portrait: "lupe" },
    topete:  { name: "TOPETE",  color: "#ff4fd8", skills: ["Adaga", "Estocada", "Crista"],      sheet: "sheet_topete",  portrait: "topete" },
    omega:   { name: "OMEGA",   color: "#b14cff", skills: ["Garras", "Vórtice", "Apocalipse"],  sheet: "sheet_nemesis_omega", portrait: "nemesis_omega" }
  };

  const SOUTH_GOAL = { x: 700, y: 1960, r: 88 };
  const NORTH_GOAL = { x: 700, y: 140, r: 88 };
  const CENTER     = { x: 700, y: 1050 };

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimapCanvas");
  const mctx = mini.getContext("2d");

  const images = {};
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  let maskData = null;

  const input = { x: 0, y: 0, keys: {}, joy: { active: false, dx: 0, dy: 0 } };
  const particles = [];

  let state = "boot";
  let mode = "solo";
  let heroId = "sander";
  let playerTeam = "south";
  let player = null;
  let units = [];
  let orbs = [];
  let pills = [];
  let projectiles = [];
  let score = { south: 0, north: 0 };
  let timeLeft = MATCH_SECONDS;
  let lastTs = 0;
  let cam = { x: 0, y: 0 };
  let frenzy = false;
  let announceT = 0;
  let countdown = 0;
  let canScore = false;

  class SFX {
    constructor() { this.ac = null; this.t0 = 0; this.bpm = 88; }
    init() {
      if (this.ac) { if (this.ac.state === "suspended") this.ac.resume(); return; }
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.t0 = this.ac.currentTime;
      this.loop();
    }
    tone(f, type, d, v, when) {
      if (!this.ac) return;
      const t = this.ac.currentTime + (when || 0);
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(this.ac.destination);
      o.start(t); o.stop(t + d);
    }
    loop() {
      if (!this.ac) return;
      const beat = 60 / this.bpm;
      this.tone(frenzy ? 110 : 82, "triangle", 0.08, 0.03);
      this.tone(frenzy ? 220 : 164, "sine", 0.05, 0.02, beat * 0.5);
      setTimeout(() => this.loop(), beat * 1000);
    }
    aura() { [523, 659, 784, 1046].forEach((n, i) => this.tone(n, "sine", 0.22, 0.12, i * 0.09)); }
    attack() { this.tone(420, "triangle", 0.1, 0.14); }
    hit() { this.tone(170, "sawtooth", 0.07, 0.1); }
    score() { this.aura(); this.tone(196, "sawtooth", 0.4, 0.05); }
    collect() { this.tone(880, "sine", 0.12, 0.12); }
    skill(f) { this.tone(f || 360, "square", 0.14, 0.1); }
    explode() { this.tone(80, "sawtooth", 0.25, 0.16); }
  }
  const sfx = new SFX();

  function $(id) { return document.getElementById(id); }

  function loadImage(key, src) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => { images[key] = img; res(img); };
      img.onerror = () => { images[key] = null; res(null); };
      img.src = src;
    });
  }

  async function boot() {
    const jobs = [
      loadImage("map", "assets/map_arena.jpg"),
      loadImage("mask", "assets/walk_mask.png"),
      loadImage("aura", "assets/aura_energy.png")
    ];
    Object.keys(HEROES).forEach((id) => {
      jobs.push(loadImage(HEROES[id].sheet, "assets/" + HEROES[id].sheet + ".png"));
      jobs.push(loadImage(HEROES[id].portrait, "assets/" + HEROES[id].portrait + ".png"));
    });
    await Promise.all(jobs);
    if (images.mask) {
      maskCanvas.width = images.mask.width;
      maskCanvas.height = images.mask.height;
      maskCtx.drawImage(images.mask, 0, 0);
      maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    }
    resize();
    loop(0);
  }

  function walkable(x, y) {
    if (x < 40 || y < 40 || x > WORLD_W - 40 || y > WORLD_H - 40) return false;
    if (!maskData) return true;
    const mx = Math.max(0, Math.min(maskCanvas.width - 1, (x / WORLD_W) * maskCanvas.width | 0));
    const my = Math.max(0, Math.min(maskCanvas.height - 1, (y / WORLD_H) * maskCanvas.height | 0));
    return maskData[(my * maskCanvas.width + mx) * 4] > 110;
  }

  function tryMove(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (walkable(nx, ny)) { u.x = nx; u.y = ny; return true; }
    if (walkable(nx, u.y)) { u.x = nx; return true; }
    if (walkable(u.x, ny)) { u.y = ny; return true; }
    return false;
  }

  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
  function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }

  function spawnBurst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (speed || 80) * (0.4 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45 + Math.random() * 0.35, max: 0.7, color, size: 2 + Math.random() * 3 });
    }
  }

  function makeUnit(id, team, x, y, isPlayer, isBoss) {
    const h = HEROES[id];
    return {
      id, team, name: h.name, color: h.color,
      x, y, vx: 0, vy: 0, facing: 1,
      hp: isBoss ? 8200 : 1100,
      maxHp: isBoss ? 8200 : 1100,
      dmg: isBoss ? 140 : 42,
      speed: isBoss ? 95 : 165,
      carry: 0, carryMax: isBoss ? 40 : 18,
      state: "idle", frame: 0, anim: 0,
      cd: { q: 0, w: 0, e: 0, atk: 0 },
      ai: isBoss ? "vigia" : "farm",
      aiT: 0, target: null, stolen: 0, stolenFrom: null,
      isPlayer: !!isPlayer, isBoss: !!isBoss, dead: false, respawn: 0,
      sheet: h.sheet
    };
  }

  function nearestWalk(x, y) {
    if (walkable(x, y)) return { x, y };
    for (let r = 12; r < 220; r += 12) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const py = y + Math.sin((a / 16) * Math.PI * 2) * r;
        if (walkable(px, py)) return { x: px, y: py };
      }
    }
    return { x: CENTER.x, y: CENTER.y + 200 };
  }

  function setupMatch() {
    units = []; orbs = []; pills = []; projectiles = []; particles.length = 0;
    score = { south: 0, north: 0 };
    timeLeft = MATCH_SECONDS;
    frenzy = false;
    playerTeam = FACTION_SOUTH.indexOf(heroId) >= 0 ? "south" : "north";
    const myFaction = playerTeam === "south" ? FACTION_SOUTH : FACTION_NORTH;
    const enFaction = playerTeam === "south" ? FACTION_NORTH : FACTION_SOUTH;
    const myBase = playerTeam === "south" ? SOUTH_GOAL : NORTH_GOAL;
    const enBase = playerTeam === "south" ? NORTH_GOAL : SOUTH_GOAL;

    const pPos = nearestWalk(myBase.x, myBase.y - (playerTeam === "south" ? 70 : -70));
    player = makeUnit(heroId, playerTeam, pPos.x, pPos.y, true, false);
    units.push(player);

    if (mode === "squad") {
      myFaction.filter((id) => id !== heroId).forEach((id, i) => {
        const p = nearestWalk(myBase.x + (i ? 50 : -50), myBase.y + (playerTeam === "south" ? -110 : 110));
        units.push(makeUnit(id, playerTeam, p.x, p.y, false, false));
      });
    }

    enFaction.forEach((id, i) => {
      const p = nearestWalk(enBase.x + (i - 1) * 55, enBase.y + (playerTeam === "south" ? 90 : -90));
      const u = makeUnit(id, playerTeam === "south" ? "north" : "south", p.x, p.y, false, false);
      u.hp = 1250; u.maxHp = 1250; u.dmg = 48;
      units.push(u);
    });

    const op = nearestWalk(CENTER.x, CENTER.y + 20);
    const omega = makeUnit("omega", "neutral", op.x, op.y, false, true);
    omega.ai = "vigia";
    units.push(omega);

    for (let i = 0; i < 28; i++) {
      const x = 220 + Math.random() * 960;
      const y = 220 + Math.random() * 1660;
      const p = nearestWalk(x, y);
      orbs.push({ x: p.x, y: p.y, v: 3 + (i % 3), alive: true });
    }
    for (let i = 0; i < 8; i++) {
      const p = nearestWalk(300 + Math.random() * 800, 300 + Math.random() * 1500);
      pills.push({ x: p.x, y: p.y, alive: true });
    }

    cam.x = player.x; cam.y = player.y;
    $("hud-face").src = "assets/" + HEROES[heroId].portrait + ".png";
    $("hud-hero-label").textContent = HEROES[heroId].name;
    $("btn-skill-q").querySelector(".skill-name").textContent = HEROES[heroId].skills[0];
    $("btn-skill-w").querySelector(".skill-name").textContent = HEROES[heroId].skills[1];
    $("btn-skill-e").querySelector(".skill-name").textContent = HEROES[heroId].skills[2];
    $("boss-hud").classList.remove("hidden");
  }

  function enemyGoalFor(team) { return team === "south" ? NORTH_GOAL : SOUTH_GOAL; }
  function homeGoalFor(team) { return team === "south" ? SOUTH_GOAL : NORTH_GOAL; }

  function deposit(u) {
    if (u.carry <= 0 || u.team === "neutral") return;
    const g = enemyGoalFor(u.team);
    if (dist(u, g) > g.r + 12) return;
    const add = u.carry;
    score[u.team] += add;
    u.carry = 0;
    sfx.score();
    spawnBurst(g.x, g.y, "#ffe566", 28, 140);
    showFx("+" + add + " AURA", u === player);
    if (score[u.team] >= GOAL_SCORE) endMatch();
  }

  function showFx(text) {
    const el = $("score-fx");
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 900);
  }

  function announce(text) {
    const el = $("announcement");
    el.textContent = text;
    el.classList.remove("hidden");
    announceT = 2.2;
  }

  function damage(src, tgt, amt, color) {
    if (!tgt || tgt.dead) return;
    tgt.hp -= amt;
    sfx.hit();
    spawnBurst(tgt.x, tgt.y - 20, color || src.color, 10, 90);
    if (tgt.hp <= 0) kill(src, tgt);
  }

  function kill(src, tgt) {
    tgt.dead = true;
    tgt.hp = 0;
    tgt.respawn = tgt.isBoss ? (frenzy ? 12 : 20) : 6;
    spawnBurst(tgt.x, tgt.y, tgt.color, 24, 160);
    sfx.explode();
    if (src && src.isBoss && tgt.team !== "neutral") {
      src.stolen = tgt.carry;
      src.stolenFrom = tgt.team;
      tgt.carry = 0;
      src.ai = "descida";
      src.aiT = 0;
      announce("OMEGA ROUBOU A AURA");
    } else if (tgt.carry > 0) {
      orbs.push({ x: tgt.x, y: tgt.y, v: Math.max(2, tgt.carry), alive: true });
      tgt.carry = 0;
    }
    if (tgt.isBoss) {
      const drop = nearestWalk(tgt.x, tgt.y);
      orbs.push({ x: drop.x, y: drop.y, v: 18, alive: true });
      pills.push({ x: drop.x + 20, y: drop.y, alive: true });
      announce("OMEGA CAIU");
    }
  }

  function pickTarget(u, enemies) {
    let best = null, scoreB = -1e9;
    enemies.forEach((e) => {
      if (e.dead) return;
      const d = dist(u, e);
      let s = 400 - d;
      if (e.carry > 0) s += e.carry * 14;
      if (e.hp / e.maxHp < 0.4) s += 80;
      if (s > scoreB) { scoreB = s; best = e; }
    });
    return best;
  }

  function stepAI(u, dt) {
    if (u.isPlayer || u.dead) return;
    u.aiT -= dt;
    const enemies = units.filter((o) => !o.dead && o.team !== "neutral" && o.team !== u.team);
    const alliesNeed = units.filter((o) => !o.dead && o.team === u.team && o !== u);

    if (u.isBoss) {
      stepOmega(u, dt);
      return;
    }

    const goal = enemyGoalFor(u.team);
    if (u.carry >= 10 || (u.carry > 0 && u.hp < u.maxHp * 0.35)) {
      moveToward(u, goal.x, goal.y, dt);
      if (dist(u, goal) < goal.r) deposit(u);
      return;
    }
    const t = pickTarget(u, enemies);
    if (t && dist(u, t) < 280 && u.hp > u.maxHp * 0.3) {
      moveToward(u, t.x, t.y, dt);
      if (dist(u, t) < 78 && u.cd.atk <= 0) doAttack(u);
      return;
    }
    let nearest = null, nd = 1e9;
    orbs.forEach((o) => { if (!o.alive) return; const d = dist(u, o); if (d < nd) { nd = d; nearest = o; } });
    if (nearest) moveToward(u, nearest.x, nearest.y, dt);
    else moveToward(u, CENTER.x + (u.team === "south" ? 40 : -40), CENTER.y + (u.team === "south" ? 160 : -160), dt);
  }

  function stepOmega(u, dt) {
    const living = units.filter((o) => !o.dead && !o.isBoss && o.team !== "neutral");
    const frenzyMul = frenzy ? 1.28 : 1;
    u.speed = 95 * frenzyMul;

    if (u.ai === "descida" && u.stolenFrom) {
      const g = homeGoalFor(u.stolenFrom);
      moveToward(u, g.x, g.y, dt);
      if (dist(u, g) < g.r) {
        const other = u.stolenFrom === "south" ? "north" : "south";
        const add = Math.max(4, u.stolen);
        score[other] += add;
        u.stolen = 0; u.stolenFrom = null;
        u.ai = "volta";
        sfx.score();
        announce("OMEGA PONTUOU +" + add);
        spawnBurst(g.x, g.y, "#b14cff", 30, 150);
        if (score[other] >= GOAL_SCORE) endMatch();
      }
      if (u.hp < u.maxHp * 0.55 && u.aiT <= 0) {
        const half = Math.floor(u.stolen / 2);
        if (half > 0) orbs.push({ x: u.x, y: u.y, v: half, alive: true });
        u.stolen = 0; u.stolenFrom = null; u.ai = "volta";
      }
      return;
    }
    if (u.ai === "volta") {
      moveToward(u, CENTER.x, CENTER.y, dt);
      if (dist(u, CENTER) < 40) u.ai = "vigia";
      return;
    }

    let prey = null, best = -1e9;
    living.forEach((e) => {
      const d = dist(u, e);
      let s = (e.carry * 18) - d * 0.35;
      if (d < 260) s += 50;
      if (e.hp / e.maxHp < 0.4) s += 40;
      if (s > best) { best = s; prey = e; }
    });
    u.target = prey;

    if (!prey) { u.ai = "vigia"; wander(u, CENTER.x, CENTER.y, 70, dt); return; }

    const d = dist(u, prey);
    if (d > 90) {
      u.ai = "caca";
      moveToward(u, prey.x, prey.y, dt);
    } else {
      u.ai = "golpe";
      if (u.cd.atk <= 0) {
        if (frenzy || u.hp < u.maxHp * 0.4) {
          if (u.cd.e <= 0) { omegaApocalypse(u); u.cd.e = 7; }
          else if (u.cd.w <= 0) { omegaVortex(u); u.cd.w = 4.2; }
          else doAttack(u);
        } else if (living.filter((o) => dist(u, o) < 160).length >= 2 && u.cd.w <= 0) {
          omegaVortex(u); u.cd.w = 4.5;
        } else doAttack(u);
      }
    }
  }

  function omegaVortex(u) {
    sfx.skill(180);
    spawnBurst(u.x, u.y, "#7b2cff", 36, 160);
    units.forEach((o) => {
      if (o.dead || o.isBoss) return;
      if (dist(u, o) < 170) {
        damage(u, o, 160, "#b14cff");
        const a = ang(u, o);
        tryMove(o, Math.cos(a) * 28, Math.sin(a) * 28);
      }
    });
    u.state = "skill"; u.anim = 0.45;
  }

  function omegaApocalypse(u) {
    sfx.explode();
    spawnBurst(u.x, u.y, "#ff9a2a", 48, 200);
    units.forEach((o) => {
      if (o.dead || o.isBoss) return;
      if (dist(u, o) < 210) damage(u, o, 260, "#ff6a00");
    });
    u.state = "skill"; u.anim = 0.55;
  }

  function wander(u, cx, cy, r, dt) {
    if (u.aiT <= 0) {
      const a = Math.random() * Math.PI * 2;
      u._wx = cx + Math.cos(a) * r;
      u._wy = cy + Math.sin(a) * r;
      u.aiT = 1.4;
    }
    moveToward(u, u._wx || cx, u._wy || cy, dt);
  }

  function moveToward(u, x, y, dt) {
    const dx = x - u.x, dy = y - u.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = u.speed * dt;
    const mx = (dx / d) * sp, my = (dy / d) * sp;
    if (tryMove(u, mx, my)) {
      u.state = u.anim > 0 ? u.state : "walk";
      if (mx < -0.2) u.facing = -1;
      if (mx > 0.2) u.facing = 1;
    } else {
      tryMove(u, mx, 0) || tryMove(u, 0, my) || tryMove(u, Math.sign(mx) * sp, Math.sign(my) * -sp * 0.6);
    }
  }

  function doAttack(u) {
    u.cd.atk = u.isBoss ? 0.85 : 0.55;
    u.state = "attack";
    u.anim = 0.32;
    sfx.attack();
    const reach = u.isBoss ? 96 : 70;
    units.forEach((o) => {
      if (o.dead || o === u) return;
      if (u.team !== "neutral" && o.team === u.team) return;
      if (dist(u, o) < reach) damage(u, o, u.dmg + (u.isBoss ? 40 : 0), u.color);
    });
  }

  function castSkill(u, slot) {
    if (u.dead || u.cd[slot] > 0) return;
    const map = { q: 3.2, w: 5.0, e: 7.5 };
    u.cd[slot] = map[slot];
    u.state = "skill";
    u.anim = 0.4;
    sfx.skill(slot === "e" ? 240 : 380);
    spawnBurst(u.x, u.y - 10, u.color, 18, 120);
    const reach = slot === "e" ? 150 : slot === "w" ? 120 : 95;
    const dmg = slot === "e" ? u.dmg * 2.1 : slot === "w" ? u.dmg * 1.6 : u.dmg * 1.25;
    units.forEach((o) => {
      if (o.dead || o === u) return;
      if (o.team === u.team) return;
      if (dist(u, o) < reach) damage(u, o, dmg, u.color);
    });
  }

  function stepPlayer(dt) {
    if (!player || player.dead) return;
    let ix = input.x + input.joy.dx;
    let iy = input.y + input.joy.dy;
    if (input.keys.ArrowUp || input.keys.w || input.keys.W) iy -= 1;
    if (input.keys.ArrowDown || input.keys.s || input.keys.S) iy += 1;
    if (input.keys.ArrowLeft || input.keys.a || input.keys.A) ix -= 1;
    if (input.keys.ArrowRight || input.keys.d || input.keys.D) ix += 1;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }
    if (mag > 0.08) {
      tryMove(player, ix * player.speed * dt, iy * player.speed * dt);
      player.state = player.anim > 0 ? player.state : "walk";
      if (ix < -0.15) player.facing = -1;
      if (ix > 0.15) player.facing = 1;
    } else if (player.anim <= 0) player.state = "idle";

    const g = enemyGoalFor(player.team);
    canScore = player.carry > 0 && dist(player, g) < g.r + 8;
    $("btn-score").disabled = !canScore;
  }

  function pickups(u) {
    if (u.dead) return;
    orbs.forEach((o) => {
      if (!o.alive) return;
      if (dist(u, o) < 34) {
        o.alive = false;
        u.carry = Math.min(u.carryMax, u.carry + o.v);
        if (u.isPlayer) sfx.collect();
        spawnBurst(o.x, o.y, "#7cf0ff", 8, 70);
      }
    });
    pills.forEach((p) => {
      if (!p.alive) return;
      if (dist(u, p) < 32) {
        p.alive = false;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.28);
        if (u.isPlayer) sfx.collect();
        spawnBurst(p.x, p.y, "#5dff9a", 10, 80);
      }
    });
  }

  function update(dt) {
    if (state !== "play") return;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endMatch(); return; }
    if (!frenzy && timeLeft <= FRENZY_AT) {
      frenzy = true;
      sfx.bpm = 128;
      announce("FRENESÍ DE ENERGIA");
    }
    if (announceT > 0) {
      announceT -= dt;
      if (announceT <= 0) $("announcement").classList.add("hidden");
    }

    units.forEach((u) => {
      ["q", "w", "e", "atk"].forEach((k) => { if (u.cd[k] > 0) u.cd[k] -= dt; });
      if (u.anim > 0) { u.anim -= dt; if (u.anim <= 0 && !u.dead) u.state = "idle"; }
      u.frame += dt * (u.state === "walk" ? 8 : 5);
      if (u.dead) {
        u.respawn -= dt;
        if (u.respawn <= 0) {
          u.dead = false;
          u.hp = u.maxHp * (u.isBoss ? 1 : 0.7);
          const base = u.isBoss ? CENTER : homeGoalFor(u.team);
          const p = nearestWalk(base.x, base.y + (u.isBoss ? 20 : 0));
          u.x = p.x; u.y = p.y;
          if (u.isBoss) u.ai = "vigia";
        }
        return;
      }
      pickups(u);
      if (u.isPlayer) stepPlayer(dt);
      else stepAI(u, dt);
    });

    projectiles.forEach((p) => {
      p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    });
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      if (p.life <= 0) particles.splice(i, 1);
    }

    cam.x += (player.x - cam.x) * Math.min(1, dt * 4.2);
    cam.y += (player.y - cam.y) * Math.min(1, dt * 4.2);

    $("score-player").textContent = score[playerTeam] | 0;
    $("score-enemy").textContent = score[playerTeam === "south" ? "north" : "south"] | 0;
    const m = Math.floor(timeLeft / 60), s = Math.floor(timeLeft % 60);
    $("match-timer").textContent = m + ":" + String(s).padStart(2, "0");
    $("carry-label").textContent = "AURA " + (player ? player.carry : 0);
    $("aura-multiplier").textContent = frenzy ? "x2" : "x1";
    const omega = units.find((u) => u.isBoss);
    if (omega) {
      $("boss-fill").style.width = Math.max(0, 100 * omega.hp / omega.maxHp) + "%";
      $("boss-state").textContent = (omega.ai || "VIGIA").toUpperCase();
    }
  }

  function view() {
    const vw = canvas.width, vh = canvas.height;
    const zoom = Math.max(vw / 820, vh / 620);
    return { vw, vh, zoom, x: cam.x - vw / (2 * zoom), y: cam.y - vh / (2 * zoom) };
  }

  function draw() {
    const vw = canvas.width, vh = canvas.height;
    ctx.fillStyle = "#05050b";
    ctx.fillRect(0, 0, vw, vh);
    const v = view();
    ctx.save();
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.x, -v.y);

    if (images.map) ctx.drawImage(images.map, 0, 0, WORLD_W, WORLD_H);
    else { ctx.fillStyle = "#123"; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }

    drawGoal(SOUTH_GOAL, "#3cf0ff");
    drawGoal(NORTH_GOAL, "#c06bff");

    orbs.forEach((o) => {
      if (!o.alive) return;
      ctx.fillStyle = "rgba(80,240,255,0.85)";
      ctx.beginPath(); ctx.arc(o.x, o.y, 7, 0, Math.PI * 2); ctx.fill();
    });
    pills.forEach((p) => {
      if (!p.alive) return;
      ctx.fillStyle = "rgba(80,255,140,0.9)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    });

    const drawList = units.slice().sort((a, b) => a.y - b.y);
    drawList.forEach(drawUnit);

    ctx.globalCompositeOperation = "lighter";
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    drawMinimap();
  }

  function drawGoal(g, color) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function sheetRow(state) {
    if (state === "walk") return 1;
    if (state === "attack") return 2;
    if (state === "skill") return 3;
    return 0;
  }

  function drawUnit(u) {
    if (u.dead) {
      ctx.globalAlpha = 0.25;
    }
    const img = images[u.sheet];
    const w = u.isBoss ? 132 : 86;
    const h = u.isBoss ? 168 : 118;
    const col = (u.frame | 0) % 4;
    const row = sheetRow(u.state);
    ctx.save();
    ctx.translate(u.x, u.y);
    if (u.facing < 0) ctx.scale(-1, 1);
    if (img) {
      ctx.drawImage(img, col * CELL, row * CELL, CELL, CELL, -w / 2, -h + 8, w, h);
    } else {
      ctx.fillStyle = u.color;
      ctx.fillRect(-w / 2, -h + 8, w, h);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    const bw = u.isBoss ? 86 : 54;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(u.x - bw / 2, u.y - h - 6, bw, 6);
    ctx.fillStyle = u.hp / u.maxHp > 0.4 ? "#3dff8a" : "#ff3355";
    ctx.fillRect(u.x - bw / 2, u.y - h - 6, bw * Math.max(0, u.hp / u.maxHp), 6);
    ctx.fillStyle = "#fff";
    ctx.font = u.isBoss ? "11px sans-serif" : "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(u.name + (u.carry ? " +" + u.carry : ""), u.x, u.y - h - 10);
  }

  function drawMinimap() {
    mctx.fillStyle = "#081018";
    mctx.fillRect(0, 0, mini.width, mini.height);
    if (images.map) mctx.drawImage(images.map, 0, 0, mini.width, mini.height);
    const sx = mini.width / WORLD_W, sy = mini.height / WORLD_H;
    units.forEach((u) => {
      if (u.dead) return;
      mctx.beginPath();
      mctx.fillStyle = u.isBoss ? "#c06bff" : (u.isPlayer ? "#00f2fe" : (u.team === playerTeam ? "#3dff8a" : "#ff3355"));
      mctx.arc(u.x * sx, u.y * sy, u.isBoss ? 4.5 : 3, 0, Math.PI * 2);
      mctx.fill();
    });
    mctx.strokeStyle = "rgba(0,242,254,0.8)";
    mctx.strokeRect((cam.x - 200) * sx, (cam.y - 150) * sy, 400 * sx, 300 * sy);
  }

  function endMatch() {
    if (state === "end") return;
    state = "end";
    const mine = score[playerTeam];
    const theirs = score[playerTeam === "south" ? "north" : "south"];
    const res = $("end-result");
    if (mine > theirs) { res.textContent = "VITÓRIA"; res.className = "end-result win"; }
    else if (mine < theirs) { res.textContent = "DERROTA"; res.className = "end-result lose"; }
    else { res.textContent = "EMPATE"; res.className = "end-result draw"; }
    $("end-hero-img").src = "assets/" + HEROES[heroId].portrait + ".png";
    $("end-hero-name").textContent = HEROES[heroId].name;
    $("end-score-player").textContent = mine;
    $("end-score-enemy").textContent = theirs;
    $("end-diff").textContent = "Diferença: " + Math.abs(mine - theirs);
    const tot = Math.max(1, mine + theirs);
    $("bar-player").style.width = (100 * mine / tot) + "%";
    $("bar-enemy").style.width = (100 * theirs / tot) + "%";
    $("end-overlay").classList.remove("hidden");
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function loop(ts) {
    const dt = Math.min(0.033, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    if (state === "play") update(dt);
    if (state === "play" || state === "end") draw();
    requestAnimationFrame(loop);
  }

  function bind() {
    $("btn-start").onclick = () => {
      sfx.init();
      $("start-overlay").classList.add("hidden");
      $("mode-overlay").classList.remove("hidden");
    };
    document.querySelectorAll(".mode-card").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".mode-card").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        mode = b.dataset.mode;
      };
    });
    $("btn-mode").onclick = () => {
      $("mode-overlay").classList.add("hidden");
      $("select-overlay").classList.remove("hidden");
    };
    document.querySelectorAll(".hero-card").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".hero-card").forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        heroId = b.dataset.hero;
      };
    });
    $("btn-confirm-hero").onclick = () => {
      $("select-overlay").classList.add("hidden");
      setupMatch();
      state = "play";
      sfx.aura();
      announce(mode === "solo" ? "MODO SOLO" : "EU + 2 BOTS");
      try { document.documentElement.requestFullscreen(); } catch (e) {}
    };
    $("btn-restart").onclick = () => {
      $("end-overlay").classList.add("hidden");
      $("mode-overlay").classList.remove("hidden");
      state = "menu";
    };

    $("btn-attack").onclick = () => { if (player) doAttack(player); };
    $("btn-skill-q").onclick = () => { if (player) castSkill(player, "q"); };
    $("btn-skill-w").onclick = () => { if (player) castSkill(player, "w"); };
    $("btn-skill-e").onclick = () => { if (player) castSkill(player, "e"); };
    $("btn-score").onclick = () => { if (player) deposit(player); };

    window.addEventListener("keydown", (e) => {
      input.keys[e.key] = true;
      if (e.key === " " || e.key === "j" || e.key === "J") { e.preventDefault(); if (player) doAttack(player); }
      if (e.key === "1" || e.key === "q") castSkill(player, "q");
      if (e.key === "2") castSkill(player, "w");
      if (e.key === "3" || e.key === "e") castSkill(player, "e");
      if (e.key === "g" || e.key === "G" || e.key === "Enter") deposit(player);
    });
    window.addEventListener("keyup", (e) => { input.keys[e.key] = false; });

    document.querySelectorAll(".dpad-btn").forEach((b) => {
      const apply = (on) => {
        const d = b.dataset.dir;
        if (d === "up") input.y = on ? -1 : (input.y < 0 ? 0 : input.y);
        if (d === "down") input.y = on ? 1 : (input.y > 0 ? 0 : input.y);
        if (d === "left") input.x = on ? -1 : (input.x < 0 ? 0 : input.x);
        if (d === "right") input.x = on ? 1 : (input.x > 0 ? 0 : input.x);
      };
      b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); apply(true); });
      b.addEventListener("pointerup", () => apply(false));
      b.addEventListener("pointerleave", () => apply(false));
    });

    const base = $("joystick-base");
    const stick = $("joystick-stick");
    const joySet = (ev) => {
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = ev.clientX - cx, dy = ev.clientY - cy;
      const m = Math.hypot(dx, dy), max = r.width * 0.42;
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      stick.style.transform = "translate(" + dx + "px," + dy + "px)";
      input.joy.dx = dx / max; input.joy.dy = dy / max;
    };
    base.addEventListener("pointerdown", (e) => { input.joy.active = true; base.setPointerCapture(e.pointerId); joySet(e); });
    base.addEventListener("pointermove", (e) => { if (input.joy.active) joySet(e); });
    const joyEnd = () => { input.joy.active = false; input.joy.dx = 0; input.joy.dy = 0; stick.style.transform = "translate(0,0)"; };
    base.addEventListener("pointerup", joyEnd);
    base.addEventListener("pointercancel", joyEnd);

    window.addEventListener("resize", resize);
  }

  bind();
  boot();
})();
