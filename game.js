/**
 * SANDERVERSE UNITE 3.1
 * Retratos 3D no campo · ataques distintos por herói
 * Jogador sempre no SUL · gol na base contrária · Omega neutro
 */
(function () {
  "use strict";

  const WORLD_W = 1400;
  const WORLD_H = 2100;
  const MATCH_SECONDS = 300;
  const FRENZY_AT = 90;
  const GOAL_SCORE = 100;

  const FACTION_A = ["sander", "cristian", "babalu"];
  const FACTION_B = ["polo", "lupe", "topete"];

  const KITS = {
    sander:  { name: "SANDER",  color: "#00f2fe", skills: ["Aura", "Stun", "Tornado"],     kind: ["bolt", "stun", "nova"] },
    cristian:{ name: "CRISTIAN",color: "#ff6a00", skills: ["Blaster", "Rajada", "Fogo"],    kind: ["bolt", "beam", "nova"] },
    babalu:  { name: "BABALU",  color: "#4ea8ff", skills: ["Canhão", "Granada", "Barragem"],kind: ["cannon", "grenade", "barrage"] },
    polo:    { name: "POLO",    color: "#7cf0ff", skills: ["Corte", "Tornado", "Anéis"],    kind: ["slash", "tornado", "rings"] },
    lupe:    { name: "LUPE",    color: "#c8f7c5", skills: ["Espada", "Pulso", "Arco"],      kind: ["slash", "pulse", "arc"] },
    topete:  { name: "TOPETE",  color: "#ff4fd8", skills: ["Cajado", "Orbe", "Fênix"],      kind: ["bolt", "orb", "phoenix"] },
    omega:   { name: "OMEGA",   color: "#b14cff", skills: ["Corte", "Raio", "Explosão"],    kind: ["slash", "beam", "nova"] }
  };

  const SOUTH_GOAL = { x: 700, y: 1840, r: 92 };
  const NORTH_GOAL = { x: 700, y: 260, r: 92 };
  const CENTER     = { x: 700, y: 1050 };

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimapCanvas");
  const mctx = mini.getContext("2d");

  const images = {};
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  let maskData = null;

  const input = { x: 0, y: 0, keys: {} };
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
  let cam = { x: 700, y: 1600 };
  let peek = { x: 0, y: 0, hold: 0 };
  let frenzy = false;
  let announceT = 0;
  let canScore = false;

  class SFX {
    constructor() { this.ac = null; this.bpm = 86; this._loop = null; }
    init() {
      if (this.ac) { if (this.ac.state === "suspended") this.ac.resume(); return; }
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
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
      this.tone(frenzy ? 118 : 78, "triangle", 0.07, 0.025);
      this.tone(frenzy ? 236 : 156, "sine", 0.05, 0.016, beat * 0.5);
      this._loop = setTimeout(() => this.loop(), beat * 1000);
    }
    aura() { [523, 659, 784, 1046].forEach((n, i) => this.tone(n, "sine", 0.22, 0.11, i * 0.09)); }
    attack() { this.tone(400, "triangle", 0.09, 0.12); }
    hit() { this.tone(160, "sawtooth", 0.06, 0.08); }
    score() { this.aura(); this.tone(196, "sawtooth", 0.35, 0.05); }
    collect() { this.tone(880, "sine", 0.1, 0.1); }
    skill(f) { this.tone(f || 360, "square", 0.13, 0.09); }
    explode() { this.tone(72, "sawtooth", 0.28, 0.14); }
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
    Object.keys(KITS).forEach((id) => jobs.push(loadImage(id, "assets/" + id + ".png")));
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

  function inCorridor(x, y) {
    const nearGoalS = Math.hypot(x - SOUTH_GOAL.x, y - SOUTH_GOAL.y) < SOUTH_GOAL.r + 30;
    const nearGoalN = Math.hypot(x - NORTH_GOAL.x, y - NORTH_GOAL.y) < NORTH_GOAL.r + 30;
    const stairs = Math.abs(x - 700) < 95 && y > 880 && y < 1220;
    const midLane = Math.abs(x - 700) < 48 && y > 240 && y < 1860;
    return nearGoalS || nearGoalN || stairs || midLane;
  }

  function walkable(x, y) {
    if (x < 36 || y < 36 || x > WORLD_W - 36 || y > WORLD_H - 36) return false;
    if (inCorridor(x, y)) return true;
    if (!maskData) return true;
    const mx = Math.max(0, Math.min(maskCanvas.width - 1, (x / WORLD_W) * maskCanvas.width | 0));
    const my = Math.max(0, Math.min(maskCanvas.height - 1, (y / WORLD_H) * maskCanvas.height | 0));
    return maskData[(my * maskCanvas.width + mx) * 4] > 96;
  }

  function tryMove(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (walkable(nx, ny)) { u.x = nx; u.y = ny; u._stuck = 0; return true; }
    if (walkable(nx, u.y)) { u.x = nx; u._stuck = 0; return true; }
    if (walkable(u.x, ny)) { u.y = ny; u._stuck = 0; return true; }
    u._stuck = (u._stuck || 0) + 1;
    return false;
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }

  function nearestWalk(x, y) {
    if (walkable(x, y)) return { x, y };
    for (let r = 10; r < 260; r += 10) {
      for (let a = 0; a < 18; a++) {
        const px = x + Math.cos((a / 18) * Math.PI * 2) * r;
        const py = y + Math.sin((a / 18) * Math.PI * 2) * r;
        if (walkable(px, py)) return { x: px, y: py };
      }
    }
    return { x: CENTER.x, y: CENTER.y + 180 };
  }

  function spawnBurst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (speed || 80) * (0.35 + Math.random());
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.4, max: 0.75, color,
        size: 2 + Math.random() * 3
      });
    }
  }

  function xpNeed(lv) { return 40 + lv * 28; }

  function makeUnit(id, team, x, y, isPlayer, isBoss) {
    const k = KITS[id];
    return {
      id, team, name: k.name, color: k.color, kit: k,
      x, y, facing: team === "south" ? -0 : 1,
      hp: isBoss ? 3200 : 1000,
      maxHp: isBoss ? 3200 : 1000,
      dmg: isBoss ? 210 : 48,
      speed: isBoss ? 88 : 172,
      carry: 0, carryMax: isBoss ? 36 : 16,
      state: "idle", frame: 0, anim: 0,
      cd: { q: 0, w: 0, e: 0, atk: 0, dash: 0 },
      ai: isBoss ? "vigia" : "farm",
      aiT: 0, target: null, stolen: 0, stolenFrom: null,
      isPlayer: !!isPlayer, isBoss: !!isBoss, dead: false, respawn: 0,
      lv: 1, xp: 0, _stuck: 0, _wx: x, _wy: y
    };
  }

  function gainXp(u, amt) {
    if (!u || u.isBoss || u.dead) return;
    u.xp += amt;
    while (u.xp >= xpNeed(u.lv) && u.lv < 8) {
      u.xp -= xpNeed(u.lv);
      u.lv += 1;
      u.maxHp += 90;
      u.hp = Math.min(u.maxHp, u.hp + 90);
      u.dmg += 7;
      if (u.isPlayer) announce("NÍVEL " + u.lv);
    }
  }

  function setupMatch() {
    units = []; orbs = []; pills = []; projectiles = []; particles.length = 0;
    score = { south: 0, north: 0 };
    timeLeft = MATCH_SECONDS;
    frenzy = false;
    peek.x = peek.y = peek.hold = 0;

    const myFaction = FACTION_A.indexOf(heroId) >= 0 ? FACTION_A : FACTION_B;
    const enFaction = myFaction === FACTION_A ? FACTION_B : FACTION_A;
    playerTeam = "south";

    const pPos = nearestWalk(SOUTH_GOAL.x, SOUTH_GOAL.y - 80);
    player = makeUnit(heroId, "south", pPos.x, pPos.y, true, false);
    units.push(player);

    if (mode === "squad") {
      myFaction.filter((id) => id !== heroId).forEach((id, i) => {
        const p = nearestWalk(SOUTH_GOAL.x + (i ? 70 : -70), SOUTH_GOAL.y - 120);
        units.push(makeUnit(id, "south", p.x, p.y, false, false));
      });
    }

    enFaction.forEach((id, i) => {
      const p = nearestWalk(NORTH_GOAL.x + (i - 1) * 70, NORTH_GOAL.y + 90);
      const u = makeUnit(id, "north", p.x, p.y, false, false);
      u.hp = 1080; u.maxHp = 1080; u.dmg = 46;
      units.push(u);
    });

    const op = nearestWalk(CENTER.x, CENTER.y);
    units.push(makeUnit("omega", "neutral", op.x, op.y, false, true));

    const spots = [
      [700, 700], [700, 1400], [420, 1050], [980, 1050],
      [500, 500], [900, 500], [500, 1600], [900, 1600],
      [360, 800], [1040, 800], [360, 1300], [1040, 1300]
    ];
    spots.forEach((s, i) => {
      const p = nearestWalk(s[0], s[1]);
      orbs.push({ x: p.x, y: p.y, v: i < 4 ? 8 : 4, alive: true });
    });
    for (let i = 0; i < 16; i++) {
      const p = nearestWalk(240 + Math.random() * 920, 280 + Math.random() * 1540);
      orbs.push({ x: p.x, y: p.y, v: 3, alive: true });
    }
    for (let i = 0; i < 8; i++) {
      const p = nearestWalk(320 + (i % 4) * 250, 420 + Math.floor(i / 4) * 1100);
      pills.push({ x: p.x, y: p.y, alive: true, t: 0 });
    }

    cam.x = player.x; cam.y = player.y;
    $("hud-face").src = "assets/" + heroId + ".png";
    $("hud-hero-label").textContent = KITS[heroId].name;
    $("btn-skill-q").querySelector(".skill-name").textContent = KITS[heroId].skills[0];
    $("btn-skill-w").querySelector(".skill-name").textContent = KITS[heroId].skills[1];
    $("btn-skill-e").querySelector(".skill-name").textContent = KITS[heroId].skills[2];
    $("boss-hud").classList.remove("hidden");
  }

  function enemyGoalFor(team) { return team === "south" ? NORTH_GOAL : SOUTH_GOAL; }
  function homeGoalFor(team) { return team === "south" ? SOUTH_GOAL : NORTH_GOAL; }

  function deposit(u) {
    if (!u || u.carry <= 0 || u.team === "neutral") return;
    const g = enemyGoalFor(u.team);
    if (dist(u, g) > g.r + 16) return;
    const add = u.carry * (frenzy ? 2 : 1);
    score[u.team] += add;
    u.carry = 0;
    sfx.score();
    spawnBurst(g.x, g.y, "#ffe566", 36, 160);
    showFx("+" + add + " AURA");
    gainXp(u, 12);
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
    announceT = 2.1;
  }

  function damage(src, tgt, amt, color) {
    if (!tgt || tgt.dead) return;
    let dmg = amt;
    if (tgt.isBoss) {
      const ratio = tgt.hp / tgt.maxHp;
      dmg *= ratio > 0.75 ? 0.72 : ratio > 0.5 ? 0.82 : 0.92;
    }
    tgt.hp -= dmg;
    sfx.hit();
    spawnBurst(tgt.x, tgt.y - 18, color || src.color, 9, 90);
    if (src && !src.isBoss) gainXp(src, Math.max(2, amt / 18));
    if (tgt.hp <= 0) kill(src, tgt);
  }

  function kill(src, tgt) {
    tgt.dead = true;
    tgt.hp = 0;
    tgt.respawn = tgt.isBoss ? (frenzy ? 38 : 46) : 6.5;
    spawnBurst(tgt.x, tgt.y, tgt.color, 28, 170);
    sfx.explode();
    if (src) gainXp(src, tgt.isBoss ? 80 : 22);

    if (src && src.isBoss && tgt.team !== "neutral") {
      const stolen = Math.max(8, tgt.carry + 12);
      tgt.carry = 0;
      const other = tgt.team === "south" ? "north" : "south";
      score[tgt.team] = Math.max(0, score[tgt.team] - stolen);
      score[other] += stolen;
      src.ai = "volta";
      announce("OMEGA DERRUBOU · +" + stolen + " PRO OUTRO TIME");
      spawnBurst(tgt.x, tgt.y, "#b14cff", 22, 140);
      if (score[other] >= GOAL_SCORE) endMatch();
    } else if (tgt.carry > 0) {
      orbs.push({ x: tgt.x, y: tgt.y, v: Math.max(2, tgt.carry), alive: true });
      tgt.carry = 0;
    }
    if (tgt.isBoss) {
      const drop = nearestWalk(tgt.x, tgt.y);
      orbs.push({ x: drop.x, y: drop.y, v: 20, alive: true });
      pills.push({ x: drop.x + 16, y: drop.y, alive: true, t: 0 });
      announce("OMEGA CAIU");
    }
  }

  function fireShot(u, kind, slot) {
    const a = u._aim || (u.facing < 0 ? Math.PI : 0);
    const aim = u.target ? ang(u, u.target) : (u.facing < 0 ? Math.PI : 0);
    const dir = u.isPlayer ? playerAim() : aim;
    const speed = kind === "grenade" ? 260 : kind === "tornado" ? 200 : 340;
    const life = kind === "beam" || kind === "barrage" ? 0.85 : 0.7;
    const dmgMul = slot === "e" ? 2.0 : slot === "w" ? 1.55 : 1.2;
    const count = kind === "barrage" || kind === "rings" ? 3 : kind === "phoenix" ? 5 : 1;
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 0.22;
      projectiles.push({
        x: u.x, y: u.y - 28,
        vx: Math.cos(dir + spread) * speed,
        vy: Math.sin(dir + spread) * speed,
        life, max: life, color: u.color, kind,
        dmg: (u.dmg * dmgMul) + (u.isBoss ? 40 : 0),
        owner: u, r: kind === "nova" || kind === "pulse" ? 22 : 10
      });
    }
    if (kind === "nova" || kind === "pulse" || kind === "phoenix") {
      units.forEach((o) => {
        if (o.dead || o === u) return;
        if (u.team !== "neutral" && o.team === u.team) return;
        if (dist(u, o) < (slot === "e" ? 170 : 120)) damage(u, o, u.dmg * dmgMul * 0.7, u.color);
      });
    }
  }

  function playerAim() {
    let ix = input.x, iy = input.y;
    if (input.keys.ArrowUp || input.keys.w || input.keys.W) iy -= 1;
    if (input.keys.ArrowDown || input.keys.s || input.keys.S) iy += 1;
    if (input.keys.ArrowLeft || input.keys.a || input.keys.A) ix -= 1;
    if (input.keys.ArrowRight || input.keys.d || input.keys.D) ix += 1;
    if (Math.hypot(ix, iy) < 0.15) return player.facing < 0 ? Math.PI : 0;
    return Math.atan2(iy, ix);
  }

  function doAttack(u) {
    if (!u || u.dead || u.cd.atk > 0) return;
    u.cd.atk = u.isBoss ? 0.95 : 0.48;
    u.state = "attack";
    u.anim = 0.28;
    sfx.attack();
    const kind = u.kit.kind[0];
    fireShot(u, kind, "atk");
    const reach = u.isBoss ? 92 : 62;
    units.forEach((o) => {
      if (o.dead || o === u) return;
      if (u.team !== "neutral" && o.team === u.team) return;
      if (dist(u, o) < reach) damage(u, o, u.dmg * (u.isBoss ? 1.15 : 0.85), u.color);
    });
  }

  function castSkill(u, slot) {
    if (!u || u.dead || u.cd[slot] > 0) return;
    u.cd[slot] = slot === "e" ? 8.5 : slot === "w" ? 5.2 : 3.4;
    u.state = "skill";
    u.anim = 0.4;
    sfx.skill(slot === "e" ? 220 : 360);
    spawnBurst(u.x, u.y - 12, u.color, 16, 130);
    const idx = slot === "q" ? 0 : slot === "w" ? 1 : 2;
    fireShot(u, u.kit.kind[idx], slot);
  }

  function doDash(u) {
    if (!u || u.dead || u.cd.dash > 0) return;
    u.cd.dash = 2.2;
    let dx = input.x, dy = input.y;
    if (input.keys.ArrowUp || input.keys.w || input.keys.W) dy -= 1;
    if (input.keys.ArrowDown || input.keys.s || input.keys.S) dy += 1;
    if (input.keys.ArrowLeft || input.keys.a || input.keys.A) dx -= 1;
    if (input.keys.ArrowRight || input.keys.d || input.keys.D) dx += 1;
    if (Math.hypot(dx, dy) < 0.1) { dx = u.facing || 1; dy = 0; }
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    for (let i = 0; i < 9; i++) tryMove(u, dx * 14, dy * 14);
    sfx.tone(240, "sawtooth", 0.09, 0.1);
    spawnBurst(u.x, u.y, u.color, 10, 100);
  }

  function pickTarget(u, enemies) {
    let best = null, sc = -1e9;
    enemies.forEach((e) => {
      if (e.dead) return;
      const d = dist(u, e);
      let s = 380 - d;
      if (e.carry > 0) s += e.carry * 12;
      if (e.hp / e.maxHp < 0.4) s += 70;
      if (s > sc) { sc = s; best = e; }
    });
    return best;
  }

  function unstick(u) {
    if ((u._stuck || 0) < 10) return;
    const p = nearestWalk(u.x + (Math.random() - 0.5) * 80, u.y + (Math.random() - 0.5) * 80);
    u.x = p.x; u.y = p.y; u._stuck = 0;
  }

  function stepAI(u, dt) {
    if (u.isPlayer || u.dead) return;
    unstick(u);
    if (u.isBoss) { stepOmega(u, dt); return; }

    const enemies = units.filter((o) => !o.dead && o.team !== "neutral" && o.team !== u.team);
    const goal = enemyGoalFor(u.team);

    if (u.carry >= 9 || (u.carry > 0 && u.hp < u.maxHp * 0.38)) {
      moveToward(u, goal.x, goal.y, dt);
      if (dist(u, goal) < goal.r) deposit(u);
      return;
    }
    const t = pickTarget(u, enemies);
    u.target = t;
    if (t && dist(u, t) < 300 && u.hp > u.maxHp * 0.32) {
      if (dist(u, t) > 120) moveToward(u, t.x, t.y, dt);
      else if (u.cd.q <= 0) castSkill(u, "q");
      else if (dist(u, t) < 70 && u.cd.atk <= 0) doAttack(u);
      else moveToward(u, t.x, t.y, dt);
      return;
    }
    let nearest = null, nd = 1e9;
    orbs.forEach((o) => { if (!o.alive) return; const d = dist(u, o); if (d < nd) { nd = d; nearest = o; } });
    if (nearest) moveToward(u, nearest.x, nearest.y, dt);
    else wander(u, CENTER.x + (u.team === "south" ? 50 : -50), CENTER.y + (u.team === "south" ? 180 : -180), 90, dt);
  }

  function stepOmega(u, dt) {
    unstick(u);
    const living = units.filter((o) => !o.dead && !o.isBoss);
    const ratio = u.hp / u.maxHp;
    const phase = ratio > 0.75 ? 1 : ratio > 0.5 ? 1.12 : ratio > 0.25 ? 1.22 : 1.32;
    u.speed = 86 * phase * (frenzy ? 1.2 : 1);
    u.dmg = 200 * phase;

    if (u.ai === "volta") {
      moveToward(u, CENTER.x, CENTER.y, dt);
      if (dist(u, CENTER) < 50) u.ai = "vigia";
      return;
    }

    let prey = null, best = -1e9;
    living.forEach((e) => {
      const d = dist(u, e);
      let s = e.carry * 16 - d * 0.32;
      if (d < 240) s += 55;
      if (Math.hypot(e.x - CENTER.x, e.y - CENTER.y) < 220) s += 40;
      if (e.hp / e.maxHp < 0.4) s += 35;
      if (s > best) { best = s; prey = e; }
    });
    u.target = prey;
    if (!prey) { u.ai = "vigia"; wander(u, CENTER.x, CENTER.y, 80, dt); return; }

    const d = dist(u, prey);
    if (d > 160) {
      u.ai = "caca";
      moveToward(u, prey.x, prey.y, dt);
      if (u.cd.w <= 0 && d < 340) { fireShot(u, "beam", "w"); u.cd.w = 4.4; u.state = "skill"; u.anim = 0.35; }
    } else {
      u.ai = "golpe";
      if (u.cd.e <= 0 && (ratio < 0.28 || frenzy)) {
        fireShot(u, "nova", "e");
        units.forEach((o) => {
          if (!o.dead && !o.isBoss && dist(u, o) < 190) damage(u, o, 360 * phase, "#b14cff");
        });
        u.cd.e = 8; u.state = "skill"; u.anim = 0.5; sfx.explode();
      } else if (u.cd.atk <= 0) doAttack(u);
      else moveToward(u, prey.x, prey.y, dt);
    }
  }

  function wander(u, cx, cy, r, dt) {
    u.aiT -= dt;
    if (u.aiT <= 0) {
      const a = Math.random() * Math.PI * 2;
      const p = nearestWalk(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      u._wx = p.x; u._wy = p.y; u.aiT = 1.6;
    }
    moveToward(u, u._wx || cx, u._wy || cy, dt);
  }

  function moveToward(u, x, y, dt) {
    const dx = x - u.x, dy = y - u.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 6) return;
    const sp = u.speed * dt;
    const mx = (dx / d) * sp, my = (dy / d) * sp;
    if (!tryMove(u, mx, my)) {
      tryMove(u, mx, 0) || tryMove(u, 0, my) || tryMove(u, -my * 0.7, mx * 0.7);
    }
    if (mx < -0.15) u.facing = -1;
    if (mx > 0.15) u.facing = 1;
    if (u.anim <= 0) u.state = "walk";
  }

  function stepPlayer(dt) {
    if (!player || player.dead) return;
    let ix = input.x, iy = input.y;
    if (input.keys.ArrowUp || input.keys.w || input.keys.W) iy -= 1;
    if (input.keys.ArrowDown || input.keys.s || input.keys.S) iy += 1;
    if (input.keys.ArrowLeft || input.keys.a || input.keys.A) ix -= 1;
    if (input.keys.ArrowRight || input.keys.d || input.keys.D) ix += 1;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }
    if (mag > 0.08) {
      tryMove(player, ix * player.speed * dt, iy * player.speed * dt);
      if (player.anim <= 0) player.state = "walk";
      if (ix < -0.15) player.facing = -1;
      if (ix > 0.15) player.facing = 1;
    } else if (player.anim <= 0) player.state = "idle";

    const g = enemyGoalFor(player.team);
    canScore = player.carry > 0 && dist(player, g) < g.r + 10;
    $("btn-score").disabled = !canScore;
    $("btn-score").classList.toggle("ready", canScore);
  }

  function pickups(u) {
    if (u.dead) return;
    orbs.forEach((o) => {
      if (!o.alive) return;
      if (dist(u, o) < 36) {
        o.alive = false;
        u.carry = Math.min(u.carryMax, u.carry + o.v);
        if (u.isPlayer) sfx.collect();
        gainXp(u, 3);
        spawnBurst(o.x, o.y, "#7cf0ff", 7, 70);
      }
    });
    pills.forEach((p) => {
      if (!p.alive) return;
      if (dist(u, p) < 34) {
        p.alive = false;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.32);
        if (u.isPlayer) sfx.collect();
        spawnBurst(p.x, p.y, "#5dff9a", 10, 80);
      }
    });
  }

  function stepProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "tornado") { p.vx += Math.sin(p.life * 12) * 8; }
      let hit = false;
      units.forEach((o) => {
        if (hit || o.dead || o === p.owner) return;
        if (p.owner.team !== "neutral" && o.team === p.owner.team) return;
        if (Math.hypot(o.x - p.x, o.y - p.y) < 28 + p.r) {
          damage(p.owner, o, p.dmg, p.color);
          spawnBurst(p.x, p.y, p.color, 8, 90);
          hit = true;
        }
      });
      if (hit || p.life <= 0) projectiles.splice(i, 1);
    }
  }

  function update(dt) {
    if (state !== "play") return;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endMatch(); return; }
    if (!frenzy && timeLeft <= FRENZY_AT) {
      frenzy = true; sfx.bpm = 126; announce("FRENESÍ DE ENERGIA");
    }
    if (announceT > 0) {
      announceT -= dt;
      if (announceT <= 0) $("announcement").classList.add("hidden");
    }
    if (peek.hold > 0) peek.hold -= dt;
    else { peek.x *= 0.9; peek.y *= 0.9; }

    units.forEach((u) => {
      ["q", "w", "e", "atk", "dash"].forEach((k) => { if (u.cd[k] > 0) u.cd[k] -= dt; });
      if (u.anim > 0) { u.anim -= dt; if (u.anim <= 0 && !u.dead) u.state = "idle"; }
      u.frame += dt * 6;
      if (u.dead) {
        u.respawn -= dt;
        if (u.respawn <= 0) {
          u.dead = false;
          u.hp = u.maxHp * (u.isBoss ? 1 : 0.75);
          const base = u.isBoss ? CENTER : homeGoalFor(u.team);
          const offY = u.isBoss ? 0 : (u.team === "south" ? -70 : 70);
          const p = nearestWalk(base.x, base.y + offY);
          u.x = p.x; u.y = p.y;
          if (u.isBoss) u.ai = "vigia";
        }
        return;
      }
      pickups(u);
      if (u.isPlayer) stepPlayer(dt);
      else stepAI(u, dt);
    });

    if (orbs.filter((o) => o.alive).length < 10) {
      const p = nearestWalk(300 + Math.random() * 800, 400 + Math.random() * 1300);
      orbs.push({ x: p.x, y: p.y, v: 3, alive: true });
    }
    if (pills.filter((p) => p.alive).length < 4) {
      const p = nearestWalk(350 + Math.random() * 700, 500 + Math.random() * 1100);
      pills.push({ x: p.x, y: p.y, alive: true, t: 0 });
    }

    stepProjectiles(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      if (p.life <= 0) particles.splice(i, 1);
    }

    const tx = player.x + peek.x;
    const ty = player.y + peek.y;
    cam.x += (tx - cam.x) * Math.min(1, dt * 4.4);
    cam.y += (ty - cam.y) * Math.min(1, dt * 4.4);

    $("score-player").textContent = score.south | 0;
    $("score-enemy").textContent = score.north | 0;
    const m = Math.floor(timeLeft / 60), s = Math.floor(timeLeft % 60);
    const clock = $("match-timer");
    clock.textContent = m + ":" + String(s).padStart(2, "0");
    clock.classList.toggle("danger", timeLeft <= 30);
    $("carry-label").textContent = "AURA " + (player ? player.carry : 0) + " · Nv " + (player ? player.lv : 1);
    $("aura-multiplier").textContent = frenzy ? "x2" : "x1";
    const omega = units.find((u) => u.isBoss);
    if (omega) {
      $("boss-fill").style.width = Math.max(0, 100 * omega.hp / omega.maxHp) + "%";
      $("boss-state").textContent = (omega.ai || "VIGIA").toUpperCase();
    }
    if ($("xp-fill") && player) {
      $("xp-fill").style.width = (100 * player.xp / xpNeed(player.lv)) + "%";
    }
  }

  function view() {
    const vw = canvas.width, vh = canvas.height;
    const zoom = Math.max(vw / 780, vh / 560);
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
      ctx.fillStyle = "rgba(80,240,255,0.9)";
      ctx.beginPath(); ctx.arc(o.x, o.y, 7, 0, Math.PI * 2); ctx.fill();
      if (images.aura) {
        ctx.globalAlpha = 0.55;
        ctx.drawImage(images.aura, o.x - 10, o.y - 10, 20, 20);
        ctx.globalAlpha = 1;
      }
    });
    pills.forEach((p) => {
      if (!p.alive) return;
      ctx.fillStyle = "rgba(80,255,140,0.95)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
    });

    units.slice().sort((a, b) => a.y - b.y).forEach(drawUnit);

    projectiles.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      if (p.kind === "slash" || p.kind === "arc") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, 16, -0.8, 0.8);
        ctx.stroke();
      } else if (p.kind === "tornado" || p.kind === "rings") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 12 + (1 - p.life / p.max) * 8, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });

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
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawUnit(u) {
    if (u.dead) ctx.globalAlpha = 0.22;
    const img = images[u.id];
    const w = u.isBoss ? 128 : 82;
    const h = u.isBoss ? 158 : 112;
    ctx.save();
    ctx.translate(u.x, u.y);
    if (u.facing < 0) ctx.scale(-1, 1);
    if (img) {
      ctx.drawImage(img, -w / 2, -h + 10, w, h);
    } else {
      ctx.fillStyle = u.color;
      ctx.beginPath(); ctx.ellipse(0, -h / 2 + 10, w / 2.4, h / 2.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    const bw = u.isBoss ? 90 : 56;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(u.x - bw / 2, u.y - h - 8, bw, 6);
    ctx.fillStyle = u.hp / u.maxHp > 0.35 ? "#3dff8a" : "#ff3355";
    ctx.fillRect(u.x - bw / 2, u.y - h - 8, bw * Math.max(0, u.hp / u.maxHp), 6);
    ctx.fillStyle = "#fff";
    ctx.font = u.isBoss ? "11px sans-serif" : "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(u.name + (u.isBoss ? "" : " Nv" + u.lv) + (u.carry ? " +" + u.carry : ""), u.x, u.y - h - 12);
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
      mctx.arc(u.x * sx, u.y * sy, u.isBoss ? 5 : 3.4, 0, Math.PI * 2);
      mctx.fill();
    });
    const v = view();
    mctx.strokeStyle = "rgba(0,242,254,0.9)";
    mctx.lineWidth = 1.5;
    mctx.strokeRect(v.x * sx, v.y * sy, (canvas.width / v.zoom) * sx, (canvas.height / v.zoom) * sy);
  }

  function peekFromMini(ev) {
    const r = mini.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * WORLD_W;
    const my = ((ev.clientY - r.top) / r.height) * WORLD_H;
    peek.x = mx - player.x;
    peek.y = my - player.y;
    peek.hold = 1.6;
  }

  function endMatch() {
    if (state === "end") return;
    state = "end";
    const mine = score.south;
    const theirs = score.north;
    const res = $("end-result");
    if (mine > theirs) { res.textContent = "VITÓRIA"; res.className = "end-result win"; }
    else if (mine < theirs) { res.textContent = "DERROTA"; res.className = "end-result lose"; }
    else { res.textContent = "EMPATE"; res.className = "end-result draw"; }
    $("end-hero-img").src = "assets/" + heroId + ".png";
    $("end-hero-name").textContent = KITS[heroId].name;
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
    $("btn-flee").onclick = () => { if (player) doDash(player); };
    $("btn-skill-q").onclick = () => { if (player) castSkill(player, "q"); };
    $("btn-skill-w").onclick = () => { if (player) castSkill(player, "w"); };
    $("btn-skill-e").onclick = () => { if (player) castSkill(player, "e"); };
    $("btn-score").onclick = () => { if (player) deposit(player); };

    window.addEventListener("keydown", (e) => {
      input.keys[e.key] = true;
      if (e.key === " " || e.key === "j" || e.key === "J") { e.preventDefault(); if (player) doAttack(player); }
      if (e.key === "f" || e.key === "F" || e.key === "Shift") { e.preventDefault(); if (player) doDash(player); }
      if (e.key === "1" || e.key === "q" || e.key === "Q") { if (player) castSkill(player, "q"); }
      if (e.key === "2" || e.key === "w" && !input.keys.ArrowUp) { if (e.key === "2") castSkill(player, "w"); }
      if (e.key === "3" || e.key === "e" || e.key === "E") { if (player) castSkill(player, "e"); }
      if (e.key === "g" || e.key === "G" || e.key === "Enter") { if (player) deposit(player); }
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
      b.addEventListener("pointercancel", () => apply(false));
      b.addEventListener("pointerleave", () => apply(false));
    });

    mini.addEventListener("pointerdown", (ev) => { ev.preventDefault(); peekFromMini(ev); });
    mini.addEventListener("pointermove", (ev) => {
      if (ev.buttons) peekFromMini(ev);
    });

    window.addEventListener("resize", resize);
  }

  bind();
  boot();
})();
