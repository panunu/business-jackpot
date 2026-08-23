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

  const lever = document.getElementById("lever");
  const resultEl = document.getElementById("result");
  const sentenceEl = document.getElementById("resultSentence");
  const copyBtn = document.getElementById("copyBtn");
  const spinAgainBtn = document.getElementById("spinAgainBtn");
  const soundBtn = document.getElementById("soundBtn");
  const soundIcon = document.getElementById("soundIcon");

  const IDLE_TEXT = "Vedä vivusta ja katso, millainen idea syntyy.";

  let spinning = false;
  let soundOn = localStorage.getItem("slot-sound") !== "off";

  /* Per-reel runtime state, built from the markup. */
  const reels = REELS.map(function (def) {
    const root = document.querySelector('.reel[data-reel="' + def.key + '"]');
    return {
      def: def,
      root: root,
      window: root.querySelector(".reel-window"),
      strip: root.querySelector(".reel-strip"),
      lockBtn: root.querySelector(".lock-btn"),
      lockText: root.querySelector(".lock-text"),
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
    if (spinning) return;

    const active = reels.filter(function (r) { return !r.locked; });
    if (!active.length) {
      /* Everything is locked — nothing to roll, just nudge the lever. */
      pullLever();
      return;
    }

    spinning = true;
    lever.disabled = true;
    clearResult();
    pullLever();
    sound.whirr();

    const spins = active.map(function (reel, i) {
      return spinReel(reel, SPIN_BASE_MS + i * SPIN_STEP_MS);
    });

    Promise.all(spins).then(function () {
      spinning = false;
      lever.disabled = false;
      showResult();
      sound.chime();
    });
  }

  function pullLever() {
    lever.classList.add("is-pulled");
    window.setTimeout(function () { lever.classList.remove("is-pulled"); }, 170);
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
    reel.locked = !reel.locked;
    reel.root.classList.toggle("is-locked", reel.locked);
    reel.lockBtn.setAttribute("aria-pressed", String(reel.locked));
    reel.lockText.textContent = reel.locked ? "Lukittu" : "Lukitse";
    sound.tick();
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
      chime: function () {
        [660, 880, 1320].forEach(function (f, i) {
          window.setTimeout(function () { blip(f, 0.28, "sine", 0.07); }, i * 90);
        });
      }
    };
  })();

  /* ---------------- Wiring ---------------- */

  reels.forEach(function (reel, i) {
    settle(reel, pick(reel.def.items));
    reel.lockBtn.addEventListener("click", function () { toggleLock(reel); });
  });

  lever.classList.add("is-idle");
  lever.addEventListener("click", spin);
  spinAgainBtn.addEventListener("click", spin);

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
