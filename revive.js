/* ============================================================
   OFFICE RUN — REVIVE SYSTEM (drop-in module)
   ------------------------------------------------------------
   What it does:
   - Shows a "Second Wind?" overlay when the player crashes
   - One revive allowed per run
   - 5-second countdown; if it expires, normal game over
   - Today: revive is free (validation phase)
   - Later: swap ONE function (showRewardedAd) for the
     CrazyGames SDK rewarded ad. Nothing else changes.

   How to integrate (2 lines in your game code):
   1) On a NEW RUN starting:      ReviveSystem.resetRun();
   2) Where you currently trigger game over, replace with:
        ReviveSystem.offer({
          onRevive: () => resumeRun(),   // your revive logic
          onGiveUp: () => showGameOver() // your existing game-over
        });
      If a revive was already used this run, it skips the
      overlay and calls onGiveUp immediately.

   Include in index.html BEFORE your game script:
     <script src="revive.js"></script>
   ============================================================ */

const ReviveSystem = (() => {
  const COUNTDOWN_SECONDS = 5;
  let usedThisRun = false;
  let timerId = null;

  /* ---------- FUTURE AD SLOT ----------------------------------
     Validation phase: succeeds instantly (free revive).
     CrazyGames phase: replace the body with:

       window.CrazyGames.SDK.ad.requestAd("rewarded", {
         adFinished: () => onSuccess(),
         adError:    () => onFail(),
         adStarted:  () => pauseAudio()   // optional
       });
  ------------------------------------------------------------- */
  function showRewardedAd(onSuccess, onFail) {
    onSuccess();
  }

  /* ---------- STYLES (injected once) ---------- */
  const css = `
    #rv-overlay {
      position: fixed; inset: 0; z-index: 9999;
      display: none; align-items: center; justify-content: center;
      background: rgba(26, 29, 38, 0.82);
      backdrop-filter: blur(3px);
      font-family: inherit;
    }
    #rv-overlay.rv-show { display: flex; }
    .rv-card {
      background: #232734; color: #f4f2ec;
      border: 1px solid #3a3f52; border-radius: 14px;
      padding: 28px 26px; width: min(320px, 86vw);
      text-align: center;
      box-shadow: 0 18px 50px rgba(0,0,0,.5);
    }
    .rv-title { font-size: 1.5rem; font-weight: 800; margin: 0 0 4px; }
    .rv-sub { font-size: .9rem; opacity: .75; margin: 0 0 18px; }
    .rv-count {
      font-size: 2.4rem; font-weight: 800; line-height: 1;
      color: #e8b64c; margin-bottom: 18px;
      font-variant-numeric: tabular-nums;
    }
    .rv-btn {
      display: block; width: 100%; border: 0; cursor: pointer;
      border-radius: 10px; padding: 14px 12px; font-size: 1rem;
      font-weight: 700; font-family: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .rv-btn:active { transform: scale(.97); }
    .rv-btn-revive {
      background: #e8b64c; color: #1a1d26; margin-bottom: 10px;
    }
    .rv-btn-quit {
      background: transparent; color: #f4f2ec;
      border: 1px solid #3a3f52; font-weight: 500;
    }
  `;

  /* ---------- OVERLAY MARKUP (injected once) ---------- */
  function ensureDom() {
    if (document.getElementById("rv-overlay")) return;

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "rv-overlay";
    overlay.innerHTML = `
      <div class="rv-card" role="dialog" aria-label="Continue run">
        <p class="rv-title">Second wind? ☕</p>
        <p class="rv-sub">Keep your streak — one revive per run</p>
        <div class="rv-count" id="rv-count">${COUNTDOWN_SECONDS}</div>
        <button class="rv-btn rv-btn-revive" id="rv-yes">Keep running</button>
        <button class="rv-btn rv-btn-quit" id="rv-no">Clock out</button>
      </div>`;
    document.body.appendChild(overlay);
  }

  function hide() {
    clearInterval(timerId);
    document.getElementById("rv-overlay").classList.remove("rv-show");
  }

  /* ---------- PUBLIC API ---------- */
  function resetRun() {
    usedThisRun = false;
  }

  function offer({ onRevive, onGiveUp }) {
    // Already revived this run → straight to game over
    if (usedThisRun) { onGiveUp(); return; }

    ensureDom();
    const overlay = document.getElementById("rv-overlay");
    const countEl = document.getElementById("rv-count");
    const yesBtn = document.getElementById("rv-yes");
    const noBtn = document.getElementById("rv-no");

    let remaining = COUNTDOWN_SECONDS;
    countEl.textContent = remaining;
    overlay.classList.add("rv-show");

    timerId = setInterval(() => {
      remaining -= 1;
      countEl.textContent = remaining;
      if (remaining <= 0) {
        hide();
        onGiveUp();
      }
    }, 1000);

    yesBtn.onclick = () => {
      hide();
      usedThisRun = true;
      showRewardedAd(
        () => onRevive(),   // ad watched (or free, for now)
        () => onGiveUp()    // ad failed to load → fair fallback
      );
    };

    noBtn.onclick = () => {
      hide();
      onGiveUp();
    };
  }

  return { offer, resetRun };
})();
