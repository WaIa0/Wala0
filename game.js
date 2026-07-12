/* ============================================================
   OFFICE RUN — endless runner (vanilla JS canvas)
   Sections: constants, assets, state, input, spawning,
             physics/update, rendering, main loop
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- constants ---------------- */

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  // Corridor geometry mapped onto office_bg.png
  const VP = { x: W * 0.5, y: H * 0.435 };         // vanishing point (bright window)
  const GROUND_Y = H * 0.93;                        // player's feet line
  const LANE_X = [W * 0.315, W * 0.5, W * 0.685];   // lane centers at player depth

  const LANE_SWITCH_TIME = 0.12;   // seconds (smooth lerp)
  const JUMP_TIME = 0.72;          // total airtime, seconds
  const JUMP_HEIGHT = H * 0.155;   // apex height in px at player depth
  const SLIDE_TIME = 0.6;          // seconds

  const BASE_SPEED = 0.42;         // progress units / second (world speed)
  const MAX_SPEED = 1.05;
  const SPEED_RAMP = 0.0088;       // speed gained per second
  const METERS_PER_PROGRESS = 26;  // distance bookkeeping

  const HIT_NEAR = 0.90, HIT_FAR = 1.03;   // progress window where collisions count
  const PICK_NEAR = 0.84, PICK_FAR = 1.02; // pickup window

  const OB = { CHAIR: 0, COPIER: 1, CABINET: 2 };
  const PU = { ESPRESSO: 0, HEADPHONES: 1, BADGE: 2 };

  const TITLES = [
    { d: 0, name: "Intern" },
    { d: 400, name: "Analyst" },
    { d: 1000, name: "Manager" },
    { d: 2200, name: "VP" },
    { d: 4500, name: "CEO" },
  ];

  /* ---------------- assets ---------------- */

  const IMAGES = {
    bg: "assets/office_bg.png",
    run0: "assets/runner_run_0.png",
    run1: "assets/runner_run_1.png",
    run2: "assets/runner_run_2.png",
    run3: "assets/runner_run_3.png",
    jump: "assets/runner_jump.png",
    slide: "assets/runner_slide.png",
    base: "assets/runner_base.png",
  };
  // Optional art — used only if present.
  const OPTIONAL_IMAGES = {
    obChair: "assets/obstacles/chair.png",
    obCopier: "assets/obstacles/copier.png",
    obCabinet: "assets/obstacles/cabinet.png",
    itemCoffee: "assets/items/coffee.png",
    itemStapler: "assets/items/stapler.png",
    itemEspresso: "assets/items/espresso.png",
    itemHeadphones: "assets/items/headphones.png",
    itemBadge: "assets/items/badge.png",
  };

  const img = {};
  function loadImages() {
    const required = Object.entries(IMAGES).map(([key, src]) =>
      new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => { img[key] = im; resolve(); };
        im.onerror = () => reject(new Error("failed to load " + src));
        im.src = src;
      })
    );
    const optional = Object.entries(OPTIONAL_IMAGES).map(([key, src]) =>
      new Promise((resolve) => {
        const im = new Image();
        im.onload = () => { img[key] = im; resolve(); };
        im.onerror = () => resolve(); // silently skip missing optional art
        im.src = src;
      })
    );
    return Promise.all(required.concat(optional));
  }

  /* ---------------- state ---------------- */

  const S = { LOADING: 0, MENU: 1, RUNNING: 2, PAUSED: 3, OVER: 4 };
  let state = S.LOADING;

  let bestDistance = 0; // in-memory only

  const player = {
    lane: 1,            // target lane index
    laneX: LANE_X[1],   // current interpolated x
    jumpT: -1,          // -1 = not jumping, else 0..JUMP_TIME
    slideT: -1,         // -1 = not sliding, else 0..SLIDE_TIME
    runFrame: 0,
    runClock: 0,
    shield: false,
  };

  const game = {
    speed: BASE_SPEED,
    distance: 0,
    coffees: 0,
    time: 0,
    titleIdx: 0,
    espressoT: 0,     // remaining seconds
    magnetT: 0,
    shake: 0,         // screen-shake intensity
    bannerT: 0,       // promotion banner timer
    bannerText: "",
  };

  let obstacles = [];   // {type, lane, p}
  let pickups = [];     // {kind:'coffee'|'stapler'|'power', pu?, lane, p, air}
  let particles = [];   // {x,y,vx,vy,life,color,size}
  let streaks = [];     // floor light streaks {lane, p}

  function resetRun() {
    player.lane = 1;
    player.laneX = LANE_X[1];
    player.jumpT = -1;
    player.slideT = -1;
    player.runFrame = 0;
    player.runClock = 0;
    player.shield = false;
    game.speed = BASE_SPEED;
    game.distance = 0;
    game.coffees = 0;
    game.time = 0;
    game.titleIdx = 0;
    game.espressoT = 0;
    game.magnetT = 0;
    game.shake = 0;
    game.bannerT = 0;
    obstacles = [];
    pickups = [];
    particles = [];
    spawnClock = 0;
    nextSpawnGap = 1.4;
    powerClock = 0;
    for (let i = 0; i < 6; i++) streaks.push({ lane: (Math.random() * 3) | 0, p: Math.random() });
  }

  /* ---------------- perspective helpers ---------------- */

  // p: 0 at vanishing point → 1 at player depth. Eased so motion
  // accelerates toward the camera like real perspective.
  function persp(p) { return Math.pow(Math.max(p, 0), 2.6); }

  function laneScreen(lane, p) {
    const e = persp(p);
    return {
      x: VP.x + (LANE_X[lane] - VP.x) * e,
      y: VP.y + (GROUND_Y - VP.y) * e,
      s: e, // scale factor 0..1
    };
  }

  /* ---------------- music (YouTube embed) ---------------- */

  // Streams the track through YouTube's official player (small visible
  // widget, bottom-right). Fails silently if YouTube is unreachable.
  const MUSIC_VIDEO_ID = "ko70cExuzZM";
  let ytPlayer = null;
  let ytReady = false;
  let musicMuted = false;

  (function initMusic() {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => { document.getElementById("music-box").style.display = "none"; };
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = function () {
      ytPlayer = new YT.Player("yt-player", {
        videoId: MUSIC_VIDEO_ID,
        playerVars: {
          loop: 1,
          playlist: MUSIC_VIDEO_ID, // required for loop to work
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => { ytReady = true; ytPlayer.setVolume(35); },
          onError: () => { document.getElementById("music-box").style.display = "none"; },
        },
      });
    };
  })();

  function musicPlay() {
    if (ytReady && !musicMuted) { try { ytPlayer.playVideo(); } catch (e) {} }
  }
  function musicPause() {
    if (ytReady) { try { ytPlayer.pauseVideo(); } catch (e) {} }
  }
  function musicToggleMute() {
    if (!ytReady) return;
    musicMuted = !musicMuted;
    try {
      if (musicMuted) { ytPlayer.mute(); }
      else { ytPlayer.unMute(); if (state === S.RUNNING) ytPlayer.playVideo(); }
    } catch (e) {}
  }

  /* ---------------- input ---------------- */

  function moveLane(dir) {
    if (state !== S.RUNNING) return;
    const next = Math.min(2, Math.max(0, player.lane + dir));
    player.lane = next;
  }
  function doJump() {
    if (state !== S.RUNNING) return;
    if (player.jumpT < 0 && player.slideT < 0) player.jumpT = 0;
  }
  function doSlide() {
    if (state !== S.RUNNING) return;
    if (player.slideT < 0 && player.jumpT < 0) player.slideT = 0;
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") moveLane(-1);
    else if (k === "ArrowRight" || k === "d" || k === "D") moveLane(1);
    else if (k === "ArrowUp" || k === "w" || k === "W" || k === " ") {
      if (state === S.MENU || state === S.OVER) startRun();
      else doJump();
      e.preventDefault();
    } else if (k === "ArrowDown" || k === "s" || k === "S") doSlide();
    else if (k === "Escape" || k === "p" || k === "P") togglePause();
    else if (k === "m" || k === "M") musicToggleMute();
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (state === S.MENU || state === S.OVER) { startRun(); return; }
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  let touchStart = null;
  canvas.addEventListener("pointerup", (e) => {
    if (!touchStart || state !== S.RUNNING) { touchStart = null; return; }
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) { doJump(); }        // tap = jump
    else if (adx > ady) moveLane(dx > 0 ? 1 : -1);    // horizontal swipe
    else if (dy < 0) doJump();
    else doSlide();
    touchStart = null;
  });

  function togglePause() {
    if (state === S.RUNNING) { state = S.PAUSED; musicPause(); }
    else if (state === S.PAUSED) { state = S.RUNNING; lastT = performance.now(); musicPlay(); }
  }

  function startRun() {
    resetRun();
    state = S.RUNNING;
    lastT = performance.now();
    musicPlay();
  }

  /* ---------------- spawning ---------------- */

  let spawnClock = 0;
  let nextSpawnGap = 1.4; // seconds until next obstacle wave
  let powerClock = 0;

  // Every wave is guaranteed survivable: we never block all three lanes,
  // and same-wave obstacles share one depth so a single action clears them.
  function spawnWave() {
    const lanes = [0, 1, 2];
    const nBlocked = Math.random() < 0.28 && game.speed > 0.55 ? 2 : 1;
    shuffle(lanes);
    const blocked = lanes.slice(0, nBlocked);
    const free = lanes.slice(nBlocked);

    for (const lane of blocked) {
      const r = Math.random();
      const type = r < 0.38 ? OB.CHAIR : r < 0.7 ? OB.CABINET : OB.COPIER;
      obstacles.push({ type, lane, p: 0 });
    }

    // Occasionally trail coffee down a guaranteed-free lane.
    if (Math.random() < 0.55) {
      const lane = free[(Math.random() * free.length) | 0];
      const n = 4 + ((Math.random() * 3) | 0);
      const arc = Math.random() < 0.3;
      for (let i = 0; i < n; i++) {
        pickups.push({
          kind: Math.random() < 0.012 ? "stapler" : "coffee",
          lane,
          p: -i * 0.055,
          air: arc ? Math.sin((i / (n - 1)) * Math.PI) : 0,
        });
      }
    }
  }

  function spawnPowerUp() {
    const lane = (Math.random() * 3) | 0;
    const r = Math.random();
    const pu = r < 0.4 ? PU.ESPRESSO : r < 0.75 ? PU.HEADPHONES : PU.BADGE;
    pickups.push({ kind: "power", pu, lane, p: 0, air: 0 });
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  /* ---------------- physics / update ---------------- */

  function jumpOffset() {
    if (player.jumpT < 0) return 0;
    const t = player.jumpT / JUMP_TIME; // 0..1
    return JUMP_HEIGHT * 4 * t * (1 - t); // parabola
  }

  function update(dt) {
    game.time += dt;

    // speed ramp (espresso adds a burst)
    game.speed = Math.min(MAX_SPEED, game.speed + SPEED_RAMP * dt);
    const speed = game.speed * (game.espressoT > 0 ? 1.35 : 1);
    game.distance += speed * dt * METERS_PER_PROGRESS;

    // timers
    if (game.espressoT > 0) game.espressoT = Math.max(0, game.espressoT - dt);
    if (game.magnetT > 0) game.magnetT = Math.max(0, game.magnetT - dt);
    if (game.bannerT > 0) game.bannerT -= dt;
    game.shake = Math.max(0, game.shake - dt * 3.2);

    // promotions
    const next = TITLES[game.titleIdx + 1];
    if (next && game.distance >= next.d) {
      game.titleIdx++;
      game.bannerText = "PROMOTED: " + next.name + "!";
      game.bannerT = 2.2;
      burst(W / 2, H * 0.3, 26, "#ffd76e");
    }

    // player lane lerp
    const targetX = LANE_X[player.lane];
    const k = Math.min(1, dt / LANE_SWITCH_TIME);
    player.laneX += (targetX - player.laneX) * k * 3.2;
    if (Math.abs(player.laneX - targetX) < 0.5) player.laneX = targetX;

    // jump / slide timers
    if (player.jumpT >= 0) {
      player.jumpT += dt;
      if (player.jumpT >= JUMP_TIME) player.jumpT = -1;
    }
    if (player.slideT >= 0) {
      player.slideT += dt;
      if (player.slideT >= SLIDE_TIME) player.slideT = -1;
    }

    // run animation: ~10fps, faster with speed
    player.runClock += dt * (10 + 6 * (speed - BASE_SPEED));
    player.runFrame = ((player.runClock | 0) % 4 + 4) % 4;

    // spawn obstacles: gap shrinks with speed but keeps reaction room
    spawnClock += dt;
    if (spawnClock >= nextSpawnGap) {
      spawnClock = 0;
      spawnWave();
      // time for an obstacle to travel VP→player is ~1/speed seconds of
      // progress; keep gaps comfortably above lane-switch + jump time.
      const minGap = Math.max(0.55, 1.05 - (speed - BASE_SPEED) * 0.55);
      nextSpawnGap = minGap + Math.random() * 0.75;
    }
    powerClock += dt;
    if (powerClock > 11 + Math.random() * 6) {
      powerClock = 0;
      spawnPowerUp();
    }

    // move obstacles & collide
    const playerLaneNow = nearestLane(player.laneX);
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.p += speed * dt;
      if (o.p > 1.12) { obstacles.splice(i, 1); continue; }
      if (o.p >= HIT_NEAR && o.p <= HIT_FAR && o.lane === playerLaneNow) {
        let hit = true;
        if (o.type === OB.CHAIR && jumpOffset() > JUMP_HEIGHT * 0.42) hit = false;
        if (o.type === OB.CABINET && player.slideT >= 0) hit = false;
        if (game.espressoT > 0) hit = false; // invincible
        if (hit) {
          obstacles.splice(i, 1);
          if (player.shield) {
            player.shield = false;
            game.shake = 1;
            burst(player.laneX, GROUND_Y - 60, 18, "#8ecdf7");
          } else {
            gameOver();
            return;
          }
        }
      }
    }

    // move pickups & collect
    for (let i = pickups.length - 1; i >= 0; i--) {
      const c = pickups[i];
      c.p += speed * dt;
      if (c.p > 1.1) { pickups.splice(i, 1); continue; }
      if (c.p < PICK_NEAR || c.p > PICK_FAR) continue;
      const laneOk =
        c.lane === playerLaneNow ||
        (game.magnetT > 0 && c.kind !== "power" && Math.abs(c.lane - playerLaneNow) === 1);
      if (!laneOk) continue;
      // airborne coffee needs a jump; grounded coffee needs feet near floor
      const jo = jumpOffset();
      if (c.kind !== "power") {
        const wantAir = c.air > 0.45;
        const inAir = jo > JUMP_HEIGHT * 0.35;
        if (wantAir !== inAir && game.magnetT <= 0) continue;
      }
      pickups.splice(i, 1);
      const pos = laneScreen(playerLaneNow, 1);
      if (c.kind === "coffee") {
        game.coffees += 1;
        burst(pos.x, GROUND_Y - 70 - c.air * JUMP_HEIGHT, 6, "#c58c53");
      } else if (c.kind === "stapler") {
        game.coffees += 50;
        burst(pos.x, GROUND_Y - 80, 24, "#ffd76e");
      } else {
        applyPower(c.pu);
        burst(pos.x, GROUND_Y - 80, 14, "#9be89b");
      }
    }

    // near-miss shake: obstacle passes adjacent lane at player depth
    for (const o of obstacles) {
      if (o.p > 0.99 && o.p < 1.01 && Math.abs(o.lane - playerLaneNow) === 1) {
        game.shake = Math.max(game.shake, 0.25);
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 380 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // floor light streaks (forward-motion illusion)
    for (const st of streaks) {
      st.p += speed * dt * 1.15;
      if (st.p > 1.05) { st.p = 0; st.lane = (Math.random() * 3) | 0; }
    }
  }

  function nearestLane(x) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(LANE_X[i] - x);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function applyPower(pu) {
    if (pu === PU.ESPRESSO) game.espressoT = 5;
    else if (pu === PU.HEADPHONES) game.magnetT = 8;
    else player.shield = true;
  }

  function gameOver() {
    state = S.OVER;
    musicPause();
    game.shake = 1.4;
    bestDistance = Math.max(bestDistance, game.distance);
    burst(player.laneX, GROUND_Y - 60, 30, "#e05c5c");
  }

  function burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 220;
      particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 120,
        life: 0.45 + Math.random() * 0.4,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  /* ---------------- rendering ---------------- */

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  function drawBackground() {
    // cover-fit office_bg.png
    const bg = img.bg;
    const scale = Math.max(W / bg.width, H / bg.height);
    const dw = bg.width * scale, dh = bg.height * scale;
    ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // light streaks pulsing toward camera along lanes
    ctx.save();
    for (const st of streaks) {
      const a = laneScreen(st.lane, st.p);
      const b = laneScreen(st.lane, Math.min(1.05, st.p + 0.06));
      ctx.strokeStyle = "rgba(255,255,255," + (0.28 * a.s).toFixed(3) + ")";
      ctx.lineWidth = 1 + 5 * a.s;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // day → evening tone shift with distance
    const evening = Math.min(0.5, game.distance / 6500);
    if (evening > 0.01) {
      ctx.fillStyle = "rgba(38, 48, 92," + evening.toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    // espresso tint
    if (game.espressoT > 0) {
      const a = Math.min(0.18, game.espressoT * 0.1);
      ctx.fillStyle = "rgba(255,150,40," + a.toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawShadow(x, y, w, alpha) {
    ctx.save();
    ctx.fillStyle = "rgba(20,25,40," + alpha.toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, w / 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const jo = jumpOffset();
    const sliding = player.slideT >= 0;
    let sprite;
    if (state === S.MENU) sprite = img.base;
    else if (player.jumpT >= 0) sprite = img.jump;
    else if (sliding) sprite = img.slide;
    else sprite = img["run" + player.runFrame];

    let h = H * 0.22;
    if (sliding) h *= 0.72;
    const w = h * (sprite.width / sprite.height);
    const x = player.laneX;
    const footY = GROUND_Y;

    // shadow shrinks with jump height
    const shAlpha = 0.34 * (1 - (jo / JUMP_HEIGHT) * 0.65);
    const shW = w * (0.9 - (jo / JUMP_HEIGHT) * 0.3);
    drawShadow(x, footY + 4, shW, Math.max(0.08, shAlpha));

    ctx.save();
    ctx.translate(x, footY - jo);
    ctx.rotate(-0.045); // slight lean into the corridor
    if (player.shield) {
      ctx.beginPath();
      ctx.arc(0, -h / 2, h * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(120,200,255,0.75)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.drawImage(sprite, -w / 2, -h, w, h);
    ctx.restore();
  }

  /* placeholder obstacle art (used when assets/obstacles/*.png absent) */
  function drawChair(x, y, s) {
    const u = 90 * s; // base unit
    ctx.fillStyle = "#3a3f4d";
    ctx.fillRect(x - u * 0.35, y - u * 0.55, u * 0.7, u * 0.12);            // seat
    ctx.fillRect(x - u * 0.33, y - u * 1.05, u * 0.14, u * 0.5);            // back
    ctx.fillStyle = "#23262f";
    ctx.fillRect(x - u * 0.05, y - u * 0.45, u * 0.1, u * 0.38);            // stem
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x, y - u * 0.1);
      ctx.lineTo(x + i * u * 0.16, y);
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = "#23262f";
      ctx.stroke();
    }
  }
  function drawCopier(x, y, s) {
    const u = 120 * s;
    ctx.fillStyle = "#cfd4dd";
    ctx.fillRect(x - u * 0.5, y - u * 1.15, u, u * 1.15);
    ctx.fillStyle = "#9aa1ad";
    ctx.fillRect(x - u * 0.5, y - u * 1.15, u, u * 0.16);
    ctx.fillStyle = "#4db06b";
    ctx.fillRect(x + u * 0.22, y - u * 1.08, u * 0.16, u * 0.06); // status light
    ctx.fillStyle = "#3a3f4d";
    ctx.fillRect(x - u * 0.36, y - u * 0.72, u * 0.72, u * 0.1);  // paper tray
  }
  function drawCabinet(x, y, s) {
    const u = 110 * s;
    // tall cabinet with OPEN TOP DRAWER — slide under it
    ctx.fillStyle = "#8f97a5";
    ctx.fillRect(x - u * 0.42, y - u * 1.35, u * 0.84, u * 1.35);
    ctx.fillStyle = "#6d7480";
    for (let i = 0; i < 3; i++)
      ctx.fillRect(x - u * 0.36, y - u * (1.22 - i * 0.4), u * 0.72, u * 0.3);
    // open drawer jutting toward camera at head height
    ctx.fillStyle = "#aeb6c4";
    ctx.fillRect(x - u * 0.5, y - u * 1.28, u, u * 0.34);
    ctx.fillStyle = "#59606c";
    ctx.fillRect(x - u * 0.14, y - u * 1.16, u * 0.28, u * 0.08);
  }

  function drawObstacle(o) {
    const pos = laneScreen(o.lane, o.p);
    if (pos.s < 0.02) return;
    const custom =
      o.type === OB.CHAIR ? img.obChair :
      o.type === OB.COPIER ? img.obCopier : img.obCabinet;
    drawShadow(pos.x, pos.y + 3 * pos.s, 90 * pos.s, 0.28 * pos.s);
    if (custom) {
      const h = (o.type === OB.COPIER ? 150 : o.type === OB.CABINET ? 160 : 110) * pos.s;
      const w = h * (custom.width / custom.height);
      ctx.drawImage(custom, pos.x - w / 2, pos.y - h, w, h);
      return;
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, pos.s * 4);
    if (o.type === OB.CHAIR) drawChair(pos.x, pos.y, pos.s);
    else if (o.type === OB.COPIER) drawCopier(pos.x, pos.y, pos.s);
    else drawCabinet(pos.x, pos.y, pos.s);
    ctx.restore();
  }

  function drawCoffeeCup(x, y, s, golden) {
    const u = 30 * s;
    ctx.save();
    ctx.globalAlpha = Math.min(1, s * 4);
    ctx.fillStyle = golden ? "#ffd76e" : "#f4f0ea";
    ctx.beginPath();
    ctx.moveTo(x - u * 0.4, y - u);
    ctx.lineTo(x + u * 0.4, y - u);
    ctx.lineTo(x + u * 0.3, y);
    ctx.lineTo(x - u * 0.3, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = golden ? "#c9a13a" : "#b0703f";
    ctx.fillRect(x - u * 0.42, y - u * 1.12, u * 0.84, u * 0.2);
    ctx.restore();
  }

  function drawPickup(c) {
    const pos = laneScreen(c.lane, c.p);
    if (pos.s < 0.03) return;
    const y = pos.y - c.air * JUMP_HEIGHT * pos.s;
    if (c.kind === "power") {
      const u = 34 * pos.s;
      ctx.save();
      ctx.globalAlpha = Math.min(1, pos.s * 4);
      const custom =
        c.pu === PU.ESPRESSO ? img.itemEspresso :
        c.pu === PU.HEADPHONES ? img.itemHeadphones : img.itemBadge;
      if (custom) {
        const h = 60 * pos.s, w = h * (custom.width / custom.height);
        ctx.drawImage(custom, pos.x - w / 2, y - h, w, h);
      } else {
        // drawn icons: espresso = orange bolt cup, headphones = arc, badge = tag
        ctx.translate(pos.x, y - u);
        const bob = Math.sin(game.time * 4) * 4 * pos.s;
        ctx.translate(0, bob);
        if (c.pu === PU.ESPRESSO) {
          ctx.fillStyle = "#ff9d3b";
          ctx.beginPath(); ctx.arc(0, 0, u * 0.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.moveTo(-u * 0.15, -u * 0.45); ctx.lineTo(u * 0.25, -u * 0.05);
          ctx.lineTo(0, -u * 0.05); ctx.lineTo(u * 0.15, u * 0.45);
          ctx.lineTo(-u * 0.25, 0); ctx.lineTo(0, 0);
          ctx.closePath(); ctx.fill();
        } else if (c.pu === PU.HEADPHONES) {
          ctx.strokeStyle = "#5ab0f2"; ctx.lineWidth = u * 0.22;
          ctx.beginPath(); ctx.arc(0, 0, u * 0.6, Math.PI, 2 * Math.PI); ctx.stroke();
          ctx.fillStyle = "#5ab0f2";
          ctx.fillRect(-u * 0.75, -u * 0.1, u * 0.3, u * 0.55);
          ctx.fillRect(u * 0.45, -u * 0.1, u * 0.3, u * 0.55);
        } else {
          ctx.fillStyle = "#9be89b";
          ctx.fillRect(-u * 0.6, -u * 0.45, u * 1.2, u * 0.9);
          ctx.fillStyle = "#2c6e3a";
          ctx.font = "bold " + (u * 0.55) + "px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("OOO", 0, u * 0.2);
        }
      }
      ctx.restore();
      return;
    }
    if (img.itemCoffee && c.kind === "coffee") {
      const h = 34 * pos.s, w = h * (img.itemCoffee.width / img.itemCoffee.height);
      ctx.globalAlpha = Math.min(1, pos.s * 4);
      ctx.drawImage(img.itemCoffee, pos.x - w / 2, y - h, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    drawCoffeeCup(pos.x, y, pos.s, c.kind === "stapler");
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    ctx.save();
    ctx.textBaseline = "top";
    // panel
    ctx.fillStyle = "rgba(20,24,34,0.55)";
    roundRect(14, 12, 250, 66, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(Math.floor(game.distance) + " m", 28, 22);
    ctx.fillStyle = "#f0c987";
    ctx.fillText("☕ " + game.coffees, 28, 48);
    ctx.fillStyle = "#9fd0ff";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(TITLES[game.titleIdx].name, 250, 26);
    if (player.shield) {
      ctx.fillStyle = "#8ecdf7";
      ctx.fillText("🛡 OOO", 250, 50);
    }
    ctx.restore();

    // power-up timers
    let ty = 90;
    if (game.espressoT > 0) { drawTimerBar("Espresso", game.espressoT / 5, "#ff9d3b", ty); ty += 26; }
    if (game.magnetT > 0) { drawTimerBar("Headphones", game.magnetT / 8, "#5ab0f2", ty); ty += 26; }

    // promotion banner
    if (game.bannerT > 0) {
      const a = Math.min(1, game.bannerT * 2, (2.2 - game.bannerT) * 3);
      const yOff = (1 - Math.min(1, (2.2 - game.bannerT) * 4)) * -40;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = "rgba(30,34,48,0.85)";
      roundRect(W / 2 - 190, H * 0.22 + yOff, 380, 54, 12);
      ctx.fill();
      ctx.fillStyle = "#ffd76e";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(game.bannerText, W / 2, H * 0.22 + 27 + yOff);
      ctx.restore();
    }
  }

  function drawTimerBar(label, frac, color, y) {
    ctx.save();
    ctx.fillStyle = "rgba(20,24,34,0.55)";
    roundRect(14, y, 160, 20, 6);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(17, y + 3, 154 * Math.max(0, frac), 14, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 22, y + 11);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCenterCard(lines) {
    ctx.save();
    ctx.fillStyle = "rgba(15,18,28,0.72)";
    roundRect(W / 2 - 260, H / 2 - 130, 520, 260, 18);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let y = H / 2 - 130 + 46;
    for (const ln of lines) {
      ctx.fillStyle = ln.color || "#fff";
      ctx.font = ln.font || "18px sans-serif";
      ctx.fillText(ln.text, W / 2, y);
      y += ln.gap || 34;
    }
    ctx.restore();
  }

  function drawMenu() {
    drawBackground();
    // idle pose front & center
    const sprite = img.base;
    const h = H * 0.34;
    const w = h * (sprite.width / sprite.height);
    drawShadow(W / 2, GROUND_Y, w, 0.3);
    ctx.drawImage(sprite, W / 2 - w / 2, GROUND_Y - h, w, h);
    drawCenterCard([
      { text: "OFFICE RUN", font: "bold 44px sans-serif", color: "#ffd76e", gap: 46 },
      { text: "Sprint the corridor. Dodge the furniture. Chase the promotion.", gap: 40 },
      { text: "← → / A D — change lane    ↑ / W / Space — jump    ↓ / S — slide", color: "#bcd3ee", gap: 30 },
      { text: "Swipe on mobile · Esc/P pauses · M mutes music", color: "#bcd3ee", gap: 44 },
      { text: "Press Space or tap to clock in", font: "bold 22px sans-serif", color: "#9be89b" },
    ]);
  }

  function drawOver() {
    drawWorld();
    drawCenterCard([
      { text: "You've been called into a meeting.", font: "bold 28px sans-serif", color: "#ff8d7a", gap: 48 },
      { text: "Distance: " + Math.floor(game.distance) + " m", font: "bold 22px sans-serif", gap: 34 },
      { text: "Coffees: " + game.coffees + "    Title: " + TITLES[game.titleIdx].name, gap: 34 },
      { text: "Best: " + Math.floor(bestDistance) + " m", color: "#ffd76e", gap: 46 },
      { text: "Press Space or tap to run it back", font: "bold 20px sans-serif", color: "#9be89b" },
    ]);
  }

  function drawWorld() {
    ctx.save();
    if (game.shake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * 14 * game.shake,
        (Math.random() - 0.5) * 10 * game.shake
      );
    }
    drawBackground();

    // painter's order: far → near
    const drawables = [];
    for (const o of obstacles) drawables.push({ p: o.p, fn: () => drawObstacle(o) });
    for (const c of pickups) drawables.push({ p: c.p, fn: () => drawPickup(c) });
    drawables.push({ p: 1, fn: drawPlayer });
    drawables.sort((a, b) => a.p - b.p);
    for (const d of drawables) d.fn();

    drawParticles();
    ctx.restore();
    drawHUD();
  }

  /* ---------------- main loop ---------------- */

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (state === S.RUNNING) {
      update(dt);
      if (state === S.RUNNING) drawWorld();
      else if (state === S.OVER) drawOver();
    } else if (state === S.MENU) {
      drawMenu();
    } else if (state === S.PAUSED) {
      drawWorld();
      drawCenterCard([
        { text: "PAUSED", font: "bold 40px sans-serif", color: "#ffd76e", gap: 60 },
        { text: "Press Esc or P to resume", color: "#bcd3ee" },
      ]);
    } else if (state === S.OVER) {
      drawOver();
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  loadImages()
    .then(() => {
      document.getElementById("loading").style.display = "none";
      state = S.MENU;
      requestAnimationFrame(frame);
    })
    .catch((err) => {
      document.getElementById("loading").textContent =
        "Failed to load assets: " + err.message;
    });
})();
