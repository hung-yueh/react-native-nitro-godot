/* react-native-nitro-godot — site interactions
   cyan lane = JS thread (120 Hz) · magenta lane = Godot thread (60 Hz) */
(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Storage throws (not just returns null) when site data is blocked —
     Safari "Block all cookies", Chrome per-origin blocks, sandboxed iframes.
     An uncaught throw here would abort this IIFE and strand the boot overlay. */
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* non-fatal */ } },
  };

  /* ── boot overlay ─────────────────────────────────────── */
  const boot = document.getElementById("boot");
  if (boot && !reducedMotion && !store.get("booted")) {
    const fill = document.getElementById("bootFill");
    const log = document.getElementById("bootLog");
    const lines = [
      "libgodot_create_godot_instance()",
      "attachSurface(CAMetalLayer*)",
      "register_main_loop_callbacks()",
      "SPSC queues online — 0 locks",
    ];
    let step = 0;
    const tick = () => {
      step++;
      fill.style.width = Math.min(step * 25, 100) + "%";
      if (log && lines[step]) log.textContent = lines[step];
      if (step < 4) setTimeout(tick, 260);
      else setTimeout(() => { boot.classList.add("done"); store.set("booted", "1"); }, 340);
    };
    setTimeout(tick, 220);
  } else if (boot) {
    boot.classList.add("done");
  }

  /* ── nav scroll state ─────────────────────────────────── */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── scroll reveals (staggered per section) ───────────── */
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
        /* Drop the stagger delay once the entrance has played — .reveal is
           declared after .card, so a lingering --rd would delay card hover
           by up to 450ms and suppress its border/shadow transition. */
        e.target.addEventListener(
          "transitionend",
          () => e.target.style.removeProperty("--rd"),
          { once: true }
        );
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    // stagger siblings that reveal within the same parent
    const seen = new Map();
    revealEls.forEach((el) => {
      const p = el.parentElement;
      const i = seen.get(p) || 0;
      seen.set(p, i + 1);
      el.style.setProperty("--rd", Math.min(i * 0.09, 0.45) + "s");
      io.observe(el);
    });
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  /* ── stat counters ────────────────────────────────────── */
  const stats = document.querySelectorAll(".stat-n[data-count]");
  const runCounter = (el) => {
    const target = +el.dataset.count;
    if (reducedMotion || target === 0) { el.textContent = target; return; }
    const t0 = performance.now();
    const dur = 1200;
    const frame = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if ("IntersectionObserver" in window) {
    const sio = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { runCounter(e.target); sio.unobserve(e.target); } });
    }, { threshold: 0.5 });
    stats.forEach((s) => sio.observe(s));
  } else {
    stats.forEach((s) => (s.textContent = s.dataset.count));
  }

  /* ── magnetic buttons + card cursor glow ──────────────── */
  if (!reducedMotion && matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".magnetic").forEach((btn) => {
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
      });
      btn.addEventListener("mouseleave", () => (btn.style.transform = ""));
    });
    document.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
    /* hero cursor glow */
    const glow = document.getElementById("heroGlow");
    const hero = document.getElementById("hero");
    if (glow && hero) {
      hero.addEventListener("mousemove", (e) => {
        const r = hero.getBoundingClientRect();
        glow.style.transform = `translate(${e.clientX - r.left - 280}px, ${e.clientY - r.top - 280}px)`;
        glow.style.left = "0"; glow.style.top = "0";
      });
    }
  }

  /* ── hero canvas: two threads, two clocks ─────────────── */
  const canvas = document.getElementById("threadCanvas");
  if (canvas && !reducedMotion) {
    const ctx = canvas.getContext("2d");
    const CYAN = "0,240,255";
    const MAGENTA = "255,45,149";
    const PURPLE = "139,92,246";
    let w = 0, h = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    /* ambient particles */
    const P = Math.min(70, Math.floor(w / 18));
    const particles = Array.from({ length: P }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.4 + 0.4,
      vx: (Math.random() - 0.5) * 0.00016,
      vy: (Math.random() - 0.5) * 0.0001,
      c: Math.random() < 0.5 ? CYAN : (Math.random() < 0.7 ? PURPLE : MAGENTA),
      a: Math.random() * 0.35 + 0.08,
      ph: Math.random() * Math.PI * 2,
    }));

    /* packets crossing between the two thread lanes */
    const packets = [];
    const spawnPacket = (down) => {
      packets.push({
        t: 0,
        x: 0.18 + Math.random() * 0.64,
        down,                       // true: JS→Godot (cyan), false: Godot→JS (magenta)
        speed: 0.008 + Math.random() * 0.006,
      });
    };

    /* the two lanes pulse at different rates — 120Hz lane ticks twice
       as often as the 60Hz lane (scaled down for legibility) */
    let last = 0, accJS = 0, accGD = 0;
    const JS_TICK = 240;   // ms between JS-lane pulses
    const GD_TICK = 480;   // ms between Godot-lane pulses (half rate)
    const pulses = [];     // {lane: 'js'|'gd', x, born}

    const laneY = () => ({ js: h * 0.22, gd: h * 0.8 });

    let running = true;
    const vis = new IntersectionObserver((es) => { running = es[0].isIntersecting; }, {});
    vis.observe(canvas);

    const draw = (now) => {
      requestAnimationFrame(draw);
      if (!running) { last = now; return; }
      const dt = Math.min(now - last || 16, 50);
      last = now;
      ctx.clearRect(0, 0, w, h);
      const { js: jsY, gd: gdY } = laneY();

      /* faint grid */
      ctx.strokeStyle = "rgba(120,130,200,0.04)";
      ctx.lineWidth = 1;
      const grid = 72;
      ctx.beginPath();
      for (let gx = (w / 2) % grid; gx < w; gx += grid) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0; gy < h; gy += grid) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      /* thread lanes */
      const lane = (y, rgb) => {
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(0.5, `rgba(${rgb},0.35)`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      };
      lane(jsY, CYAN);
      lane(gdY, MAGENTA);

      /* lane pulses — each lane ticks at its own clock */
      accJS += dt; accGD += dt;
      if (accJS > JS_TICK) { accJS = 0; pulses.push({ lane: "js", born: now }); }
      if (accGD > GD_TICK) { accGD = 0; pulses.push({ lane: "gd", born: now }); }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const age = (now - p.born) / 1600;
        if (age > 1) { pulses.splice(i, 1); continue; }
        const rgb = p.lane === "js" ? CYAN : MAGENTA;
        const y = p.lane === "js" ? jsY : gdY;
        const x = w * 0.5 + (age * w * 0.55) * (p.lane === "js" ? 1 : -1);
        ctx.fillStyle = `rgba(${rgb},${0.5 * (1 - age)})`;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        // mirror
        const x2 = w * 0.5 - (x - w * 0.5);
        ctx.beginPath(); ctx.arc(x2, y, 2.2, 0, Math.PI * 2); ctx.fill();
      }

      /* spawn crossing packets */
      if (Math.random() < dt / 900) spawnPacket(true);
      if (Math.random() < dt / 1400) spawnPacket(false);

      /* draw packets travelling between lanes (SPSC traffic) */
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        p.t += p.speed * (dt / 16);
        if (p.t >= 1) { packets.splice(i, 1); continue; }
        const rgb = p.down ? CYAN : MAGENTA;
        const y0 = p.down ? jsY : gdY;
        const y1 = p.down ? gdY : jsY;
        const y = y0 + (y1 - y0) * p.t;
        const x = p.x * w;
        /* trail */
        const tg = ctx.createLinearGradient(x, y - (y1 - y0) * 0.12, x, y);
        tg.addColorStop(0, `rgba(${rgb},0)`);
        tg.addColorStop(1, `rgba(${rgb},0.5)`);
        ctx.strokeStyle = tg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - (y1 - y0) * 0.12);
        ctx.lineTo(x, y);
        ctx.stroke();
        /* head */
        ctx.fillStyle = `rgba(${rgb},0.9)`;
        ctx.shadowColor = `rgb(${rgb})`;
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      /* ambient particles */
      for (const pt of particles) {
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        if (pt.x < 0) pt.x = 1; if (pt.x > 1) pt.x = 0;
        if (pt.y < 0) pt.y = 1; if (pt.y > 1) pt.y = 0;
        const tw = 0.6 + 0.4 * Math.sin(now / 900 + pt.ph);
        ctx.fillStyle = `rgba(${pt.c},${pt.a * tw})`;
        ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, pt.r, 0, Math.PI * 2); ctx.fill();
      }
    };
    requestAnimationFrame(draw);
  }

  /* ── gentle parallax on hero content ──────────────────── */
  if (!reducedMotion) {
    const heroContent = document.querySelector(".hero-content");
    if (heroContent) {
      window.addEventListener("scroll", () => {
        const y = window.scrollY;
        if (y < window.innerHeight) {
          heroContent.style.transform = `translateY(${y * 0.18}px)`;
          heroContent.style.opacity = 1 - (y / window.innerHeight) * 0.9;
        }
      }, { passive: true });
    }
  }
})();
