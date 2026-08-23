/* ---------------------------------------------------------------
   Bisnesidea-hedelmäpeli — slot machine logic
   Plain script, no build step, works from file:// as well.
   --------------------------------------------------------------- */

(function () {
  "use strict";

  /* Reel definitions, left to right. `key` matches data-reel in the markup. */
  const REELS = [
    { key: "passion",  items: DATA.passions  },
    { key: "sector",   items: DATA.sectors   },
    { key: "scenario", items: DATA.scenarios }
  ];

  const SPIN_BASE_MS = 1500;   // duration of the first reel
  const SPIN_STEP_MS = 420;    // each following reel spins this much longer
  const STRIP_LENGTH = 26;     // filler items rolled through before the winner

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const spinBtn = document.getElementById("spinBtn");
  const spinCountEl = document.getElementById("spinCount");
  const holdCountEl = document.getElementById("holdCount");
  const comboCountEl = document.getElementById("comboCount");
  const resultEl = document.getElementById("result");
  const sentenceEl = document.getElementById("resultSentence");
  const copyBtn = document.getElementById("copyBtn");
  const soundBtn = document.getElementById("soundBtn");
  const soundIcon = document.getElementById("soundIcon");
  const coinSlot = document.getElementById("coinSlot");
  const coinEl = document.getElementById("coin");
  const machineEl = document.querySelector(".machine");

  const IDLE_TEXT = "Nyt jännittää...";

  let spinning = false;
  let powered = false;   // no coin in yet — the machine is dead
  let spinCount = 0;
  let soundOn = localStorage.getItem("slot-sound") !== "off";

  /* Per-reel runtime state, built from the markup. */
  const reels = REELS.map(function (def) {
    const root = document.querySelector('.reel[data-reel="' + def.key + '"]');
    const lockBtn = document.querySelector('.hold-btn[data-hold="' + def.key + '"]');
    return {
      def: def,
      root: root,
      window: root.querySelector(".reel-window"),
      strip: root.querySelector(".reel-strip"),
      lockBtn: lockBtn,
      lockText: lockBtn.querySelector(".lock-text"),
      locked: false,
      value: null
    };
  });

  /* ---------------- Geometry ---------------- */

  function itemHeight() {
    const css = getComputedStyle(document.documentElement);
    return parseFloat(css.getPropertyValue("--item-h"));
  }

  function windowHeight() {
    const css = getComputedStyle(document.documentElement);
    return itemHeight() * parseFloat(css.getPropertyValue("--window-mult"));
  }

  /* Vertical offset that centres item `index` of a strip in the window. */
  function offsetFor(index) {
    const h = itemHeight();
    return -(index * h) + (windowHeight() - h) / 2;
  }

  /* ---------------- Rendering ---------------- */

  function makeItem(text) {
    const el = document.createElement("div");
    el.className = "reel-item";
    el.textContent = text;
    return el;
  }

  function renderStrip(reel, values) {
    reel.strip.replaceChildren.apply(reel.strip, values.map(makeItem));
  }

  function setOffset(reel, index, ms) {
    reel.strip.style.transition = ms
      ? "transform " + ms + "ms cubic-bezier(0.08, 0.72, 0.12, 1)"
      : "none";
    reel.strip.style.transform = "translate3d(0, " + offsetFor(index) + "px, 0)";
  }

  /* Show a value with a dummy neighbour above and below, so the window never
     looks empty. Used for the initial state and after a spin. */
  function settle(reel, value) {
    reel.value = value;
    renderStrip(reel, [pick(reel.def.items, value), value, pick(reel.def.items, value)]);
    setOffset(reel, 1, 0);
  }

  function pick(items, avoid) {
    if (items.length < 2) return items[0];
    let value;
    do {
      value = items[Math.floor(Math.random() * items.length)];
    } while (value === avoid);
    return value;
  }

  /* ---------------- Spinning ---------------- */

  function spinReel(reel, duration) {
    return new Promise(function (resolve) {
      const target = pick(reel.def.items, reel.value);

      if (reduceMotion) {
        settle(reel, target);
        resolve();
        return;
      }

      /* Build a strip of fillers with the winner last, starting from the
         current value so the first frame matches what is on screen. */
      const values = [reel.value || pick(reel.def.items)];
      for (let i = 1; i < STRIP_LENGTH; i++) values.push(pick(reel.def.items));
      values.push(target);

      renderStrip(reel, values);
      setOffset(reel, 0, 0);
      reel.root.classList.add("is-spinning");

      /* Force a reflow so the browser animates from the top of the strip. */
      void reel.strip.offsetHeight;

      requestAnimationFrame(function () {
        setOffset(reel, values.length - 1, duration);
      });

      /* transitionend can be missed (backgrounded tab, interrupted spin),
         so a timer is the source of truth. */
      window.setTimeout(function () {
        reel.root.classList.remove("is-spinning");
        settle(reel, target);
        flash(reel);
        sound.clunk();
        resolve();
      }, duration + 30);
    });
  }

  function flash(reel) {
    reel.root.classList.remove("just-landed");
    void reel.root.offsetWidth;
    reel.root.classList.add("just-landed");
  }

  function spin() {
    if (spinning || !powered) return;

    const active = reels.filter(function (r) { return !r.locked; });
    if (!active.length) {
      /* Everything is locked — nothing to roll, so just shrug at the button. */
      nudgeSpinButton();
      return;
    }

    spinning = true;
    spinBtn.disabled = true;
    setSpinAttract(false);
    clearResult();
    sound.whirr();

    const spins = active.map(function (reel, i) {
      return spinReel(reel, SPIN_BASE_MS + i * SPIN_STEP_MS);
    });

    Promise.all(spins).then(function () {
      spinning = false;
      spinBtn.disabled = false;
      setSpinAttract(true);
      spinCount += 1;
      updateCounters();
      showResult();
      sound.chime();
    });
  }

  /* The spin button blinks whenever it is sitting there waiting to be pressed,
     and goes quiet while the reels are actually rolling. */
  function setSpinAttract(on) {
    spinBtn.classList.toggle("is-attracting", on);
  }

  function nudgeSpinButton() {
    spinBtn.classList.remove("is-nudging");
    void spinBtn.offsetWidth;
    spinBtn.classList.add("is-nudging");
  }

  /* ---------------- Result sentence ---------------- */

  /* Lower-cases the first letter so the value reads naturally mid-sentence,
     unless the value looks like an acronym or product name (e.g. "3D-tulostus"). */
  function inline(value) {
    if (value.length > 1 && value[1] === value[1].toUpperCase() && /\p{L}/u.test(value[1])) {
      return value;
    }
    return value.charAt(0).toLocaleLowerCase("fi") + value.slice(1);
  }

  function sentenceParts() {
    const byKey = {};
    reels.forEach(function (r) { byKey[r.def.key] = r.value; });
    return byKey;
  }

  function showResult() {
    const v = sentenceParts();
    sentenceEl.innerHTML =
      "Millainen yritys syntyy, kun intohimona on <b>" + escapeHtml(inline(v.passion)) +
      "</b> ja toimialana <b>" + escapeHtml(inline(v.sector)) +
      "</b> maailmassa, jossa <b>" + escapeHtml(v.scenario) + "</b>?";
    resultEl.classList.remove("is-empty");
    copyBtn.textContent = "Kopioi idea";
  }

  function clearResult() {
    resultEl.classList.add("is-empty");
    sentenceEl.textContent = IDLE_TEXT;
  }

  function plainSentence() {
    const v = sentenceParts();
    return "Millainen yritys syntyy, kun intohimona on " + inline(v.passion) +
           " ja toimialana " + inline(v.sector) +
           " maailmassa, jossa " + v.scenario + "?";
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  /* ---------------- Locks ---------------- */

  function toggleLock(reel) {
    if (!powered || spinning) return;
    reel.locked = !reel.locked;
    reel.root.classList.toggle("is-locked", reel.locked);
    reel.lockBtn.setAttribute("aria-pressed", String(reel.locked));
    reel.lockText.textContent = reel.locked ? "Lukittu" : "Lukitse";
    updateCounters();
    sound.tick();
  }

  /* ---------------- LED counters ---------------- */

  function updateCounters() {
    spinCountEl.textContent = String(spinCount);
    holdCountEl.textContent = String(reels.filter(function (r) { return r.locked; }).length);
  }

  function totalCombinations() {
    return REELS.reduce(function (acc, def) { return acc * def.items.length; }, 1);
  }

  /* ---------------- Sound (WebAudio, no asset files) ---------------- */

  const sound = (function () {
    let ctx = null;

    function context() {
      if (!soundOn) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function blip(freq, duration, type, gain) {
      const ac = context();
      if (!ac) return;
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = type || "triangle";
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      amp.gain.setValueAtTime(gain || 0.09, ac.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
      osc.connect(amp).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + duration);
    }

    return {
      tick: function () { blip(880, 0.05, "square", 0.04); },
      clunk: function () { blip(180, 0.16, "triangle", 0.12); },
      whirr: function () {
        const ac = context();
        if (!ac) return;
        const osc = ac.createOscillator();
        const amp = ac.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(120, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(420, ac.currentTime + 0.35);
        amp.gain.setValueAtTime(0.05, ac.currentTime);
        amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.4);
        osc.connect(amp).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.4);
      },
      coin: function () {
        /* Two quick metallic pings — a coin rattling down the chute. */
        blip(1650, 0.09, "square", 0.05);
        window.setTimeout(function () { blip(1180, 0.12, "square", 0.045); }, 70);
        window.setTimeout(function () { blip(820, 0.18, "triangle", 0.06); }, 150);
      },
      powerUp: function () {
        const ac = context();
        if (!ac) return;
        const osc = ac.createOscillator();
        const amp = ac.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(70, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.55);
        amp.gain.setValueAtTime(0.0001, ac.currentTime);
        amp.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + 0.3);
        amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.7);
        osc.connect(amp).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.7);
        [523, 659, 784, 1047].forEach(function (f, i) {
          window.setTimeout(function () { blip(f, 0.22, "sine", 0.06); }, 450 + i * 110);
        });
      },
      chime: function () {
        [660, 880, 1320].forEach(function (f, i) {
          window.setTimeout(function () { blip(f, 0.28, "sine", 0.07); }, i * 90);
        });
      }
    };
  })();

  /* ---------------- Power ---------------- */

  /* The whole cabinet is dead until a coin goes in: the deck is inert, the
     reels are dark, and the LED strip shows nothing but "Syötä kolikko". */
  function setControlsEnabled(on) {
    spinBtn.disabled = !on;
    reels.forEach(function (reel) { reel.lockBtn.disabled = !on; });
  }

  function insertCoin() {
    if (powered || coinEl.classList.contains("is-inserting")) return;

    sound.coin();
    coinEl.classList.add("is-inserting");

    /* Let the coin finish dropping through the slot before the lights come on. */
    window.setTimeout(powerUp, reduceMotion ? 0 : 620);
  }

  function powerUp() {
    if (powered) return;
    powered = true;

    document.body.classList.remove("power-off");
    setControlsEnabled(true);
    setSpinAttract(true);
    sound.powerUp();

    if (!reduceMotion) {
      machineEl.classList.add("is-powering-up");
      window.setTimeout(function () {
        machineEl.classList.remove("is-powering-up");
      }, 950);
    }

    spinBtn.focus({ preventScroll: true });
  }

  /* ---------------- Wiring ---------------- */

  reels.forEach(function (reel, i) {
    settle(reel, pick(reel.def.items));
    reel.lockBtn.addEventListener("click", function () { toggleLock(reel); });
  });

  spinBtn.addEventListener("click", spin);
  coinSlot.addEventListener("click", insertCoin);
  setControlsEnabled(false);

  /* Arm the power-up fade only after the first paint, so the cabinet does not
     flash its lit colours while the page is still loading. */
  requestAnimationFrame(function () {
    document.body.classList.add("power-ready");
  });

  comboCountEl.textContent = totalCombinations().toLocaleString("fi-FI");
  updateCounters();

  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(plainSentence()).then(function () {
      copyBtn.textContent = "Kopioitu!";
      window.setTimeout(function () { copyBtn.textContent = "Kopioi idea"; }, 1600);
    });
  });

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    localStorage.setItem("slot-sound", soundOn ? "on" : "off");
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundIcon.textContent = soundOn ? "🔊" : "🔇";
    if (soundOn) sound.tick();
  });

  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundIcon.textContent = soundOn ? "🔊" : "🔇";

  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "BUTTON" && e.key === " ") e.preventDefault();

    /* While the machine is off, the only thing any key does is feed it. */
    if (!powered) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        insertCoin();
      }
      return;
    }

    if (e.key === " " || e.key === "Enter" && e.target === document.body) {
      e.preventDefault();
      spin();
    } else if (e.key === "1" || e.key === "2" || e.key === "3") {
      toggleLock(reels[Number(e.key) - 1]);
    }
  });

  /* Keep the settled values centred when the reel geometry changes. */
  window.addEventListener("resize", function () {
    if (spinning) return;
    reels.forEach(function (reel) { setOffset(reel, 1, 0); });
  });
})();
