// Effets d'ambiance purement décoratifs (fond radar, symboles flottants, réseau de tickers,
// relief 3D au survol) — n'affichent jamais de donnée, ne bloquent jamais un clic, se
// désactivent proprement si mouvement réduit demandé ou pas de souris précise (mobile/tactile).

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function canHoverPrecisely() {
  return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function setupHiDPICanvas(canvas, widthPx, heightPx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(widthPx, 1);
  const h = Math.max(heightPx, 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---- Piste A + B : icônes des favoris qui dérivent sur tout l'écran + balayage radar
// ambiant dans un coin — un seul canvas plein écran, toujours présent (gate comme app). ----
// Renvoie { stop() } pour permettre un démontage propre (voir theme.js, qui bascule entre ce
// fond et bg-galaxy-3d.js) — la boucle de dessin elle-même est inchangée.
function initRadarBackground() {
  const canvas = document.getElementById("bg-radar-canvas");
  if (!canvas || prefersReducedMotion()) return { stop() {} };
  // Ne jamais faire confiance à window.innerWidth/innerHeight au moment de l'appel : au
  // DOMContentLoaded, la mise en page (et parfois même le CSS, retardé par l'@import Google
  // Fonts) n'est pas forcément terminée, ce qui a déjà produit un canvas figé à 1x1px en
  // test. On remesure donc à chaque frame plutôt qu'une fois pour toutes.
  let ctx = null, lastW = 0, lastH = 0;
  function ensureSize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      ctx = setupHiDPICanvas(canvas, w, h);
      lastW = w;
      lastH = h;
    }
  }
  const blips = [
    [0.16, 0.22], [0.82, 0.14], [0.7, 0.68], [0.28, 0.78], [0.5, 0.46], [0.9, 0.85], [0.1, 0.6],
  ];

  // Icônes des favoris qui dérivent lentement sur tout l'écran (pas juste le radar dans un
  // coin) — mélange de symboles (BTC, ETH) et de petits badges ticker colorés.
  const icons = [
    { type: "glyph", glyph: "₿", size: 44 },
    { type: "glyph", glyph: "Ξ", size: 36 },
    { type: "badge", label: "LINK", color: "#7c9eff" },
    { type: "badge", label: "ARB", color: "#22b8e0" },
    { type: "badge", label: "ONDO", color: "#f0b429" },
    { type: "badge", label: "INJ", color: "#b48cf2" },
    { type: "badge", label: "TIA", color: "#fb8362" },
    { type: "badge", label: "JUP", color: "#2fd3b0" },
    { type: "badge", label: "GRT", color: "#7c9eff" },
    { type: "badge", label: "LPT", color: "#f0b429" },
    { type: "glyph", glyph: "◈", size: 28 },
    { type: "badge", label: "FET", color: "#22b8e0" },
    { type: "badge", label: "CTSI", color: "#fb8362" },
    { type: "badge", label: "PEAQ", color: "#b48cf2" },
    { type: "badge", label: "AIOZ", color: "#2fd3b0" },
    { type: "badge", label: "FLUX", color: "#f0b429" },
  ].map((icon) => ({
    ...icon,
    x: Math.random(),
    y: Math.random(),
    speed: 0.00003 + Math.random() * 0.00003,
    angle: Math.random() * Math.PI * 2,
    phase: Math.random() * Math.PI * 2,
  }));

  let frameCount = 0;
  let rafId = null;
  let stopped = false;
  function draw(t) {
    if (stopped) return;
    ensureSize();
    frameCount++;
    if (!ctx || frameCount % 2 === 0 || document.hidden) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    const w = lastW, h = lastH;
    ctx.clearRect(0, 0, w, h);

    icons.forEach((icon) => {
      const x = ((((icon.x + Math.cos(icon.angle) * t * icon.speed) % 1.15) + 1.15) % 1.15) * w - w * 0.075;
      const y = ((((icon.y + Math.sin(icon.angle) * t * icon.speed * 0.7) % 1.15) + 1.15) % 1.15) * h - h * 0.075;
      const twinkle = 0.6 + 0.4 * Math.sin(t * 0.0009 + icon.phase);
      if (icon.type === "glyph") {
        ctx.font = icon.size + "px Inter, sans-serif";
        ctx.fillStyle = `rgba(47, 211, 176, ${(0.22 * twinkle).toFixed(3)})`;
        ctx.fillText(icon.glyph, x, y);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.42 * twinkle;
        ctx.fillStyle = icon.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = "600 12px Inter, sans-serif";
        ctx.fillStyle = `rgba(238, 242, 247, ${(0.32 * twinkle).toFixed(3)})`;
        ctx.fillText(icon.label, x + 9, y + 4);
      }
    });

    const cx = w * 0.82, cy = h * 0.12;
    const maxR = Math.max(w, h) * 0.55;
    for (let r = maxR / 4; r <= maxR; r += maxR / 4) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(47, 211, 176, 0.035)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const angle = (t * 0.00018) % (Math.PI * 2);
    if (ctx.createConicGradient) {
      const grad = ctx.createConicGradient(angle - Math.PI / 2, cx, cy);
      grad.addColorStop(0, "rgba(47, 211, 176, 0)");
      grad.addColorStop(0.05, "rgba(47, 211, 176, 0.05)");
      grad.addColorStop(0.1, "rgba(47, 211, 176, 0)");
      grad.addColorStop(1, "rgba(47, 211, 176, 0)");
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }
    blips.forEach((b) => {
      const bx = cx + (b[0] - 0.5) * w * 0.9, by = cy + (b[1] - 0.5) * h * 0.9;
      if (bx < 0 || bx > w || by < 0 || by > h) return;
      const blipAngle = Math.atan2(by - cy, bx - cx);
      const diff = Math.abs((((blipAngle - (angle - Math.PI / 2) + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      const lit = diff > Math.PI - 0.3;
      ctx.beginPath();
      ctx.arc(bx, by, lit ? 2.2 : 1.2, 0, Math.PI * 2);
      ctx.fillStyle = lit ? "rgba(240, 180, 41, 0.4)" : "rgba(147, 160, 180, 0.12)";
      ctx.fill();
    });
    rafId = requestAnimationFrame(draw);
  }
  rafId = requestAnimationFrame(draw);
  return {
    stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}

// ---- Piste C : réseau de tickers en fond, seulement pendant que son onglet est actif ----
function createConstellationController(canvasId, getTickers) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return { start() {}, stop() {}, refresh() {} };
  const colors = ["#2fd3b0", "#22b8e0", "#f0b429", "#7c9eff", "#b48cf2", "#fb8362"];
  let ctx = null, nodes = [], rafId = null, lastT = 0, ro = null;

  function resize() {
    const host = canvas.parentElement;
    ctx = setupHiDPICanvas(canvas, host.clientWidth, host.clientHeight);
  }

  function buildNodes() {
    const tickers = getTickers() || [];
    nodes = tickers.map((ticker, i) => ({
      x: 0.08 + Math.random() * 0.84,
      y: 0.08 + Math.random() * 0.84,
      vx: (Math.random() - 0.5) * 0.00004,
      vy: (Math.random() - 0.5) * 0.00004,
      color: colors[i % colors.length],
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    if (!ctx) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    const dt = document.hidden ? 0 : t - lastT;
    lastT = t;
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    ctx.clearRect(0, 0, w, h);
    nodes.forEach((n) => {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < 0.04 || n.x > 0.96) n.vx *= -1;
      if (n.y < 0.04 || n.y > 0.96) n.vy *= -1;
    });
    const maxDist = w * 0.22;
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const dx = (nodes[a].x - nodes[b].x) * w, dy = (nodes[a].y - nodes[b].y) * h;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          ctx.beginPath();
          ctx.moveTo(nodes[a].x * w, nodes[a].y * h);
          ctx.lineTo(nodes[b].x * w, nodes[b].y * h);
          ctx.strokeStyle = `rgba(147, 160, 180, ${(0.08 * (1 - dist / maxDist)).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    nodes.forEach((n) => {
      const tw = 0.7 + 0.3 * Math.sin(t * 0.0012 + n.phase);
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, 2.6, 0, Math.PI * 2);
      ctx.globalAlpha = 0.4 * tw;
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    rafId = requestAnimationFrame(draw);
  }

  return {
    start() {
      if (rafId || prefersReducedMotion()) return;
      resize();
      if (nodes.length === 0) buildNodes();
      if (!ro) {
        ro = new ResizeObserver(resize);
        ro.observe(canvas.parentElement);
      }
      lastT = performance.now();
      rafId = requestAnimationFrame(draw);
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },
    refresh() {
      resize();
      buildNodes();
    },
  };
}

const constellationControllers = {};
function registerConstellation(key, controller) {
  constellationControllers[key] = controller;
}
function notifyTabActive(tabId) {
  Object.keys(constellationControllers).forEach((key) => {
    if (key === tabId) constellationControllers[key].start();
    else constellationControllers[key].stop();
  });
}

// ---- Enregistrement dans le même système que les autres thèmes (voir js/theme.js et
// js/bg-galaxy-3d.js pour le modèle d'API : mount/unmount/isActive) — le fond "Classique"
// existait avant ce système et gardait un cas particulier codé en dur dans theme.js ; cet
// adaptateur l'aligne sur les autres sans toucher à initRadarBackground() elle-même (déjà
// utilisée telle quelle, hors du périmètre des tests par choix, voir CLAUDE.md). ----
let classicHandle = null;
window.AguilaBackgrounds = window.AguilaBackgrounds || {};
window.AguilaBackgrounds.classic = {
  mount() {
    if (classicHandle) return;
    classicHandle = initRadarBackground();
  },
  unmount() {
    if (classicHandle) {
      classicHandle.stop();
      classicHandle = null;
    }
  },
  isActive() {
    return classicHandle !== null;
  },
};

// ---- Relief 3D au survol, délégué (fonctionne aussi sur les cartes réaffichées) ----
function initCardTilt() {
  if (!canHoverPrecisely() || prefersReducedMotion()) return;
  const selector = ".favori-card.clickable, .favori-tile.clickable, .opp-card.clickable, .opp-tile.clickable, .journal-entry.clickable, .gate-card";
  const maxTilt = 6;
  let activeCard = null;

  document.addEventListener("mousemove", (e) => {
    const card = e.target instanceof Element ? e.target.closest(selector) : null;
    if (!card) {
      if (activeCard) {
        activeCard.style.transform = "";
        activeCard = null;
      }
      return;
    }
    if (activeCard && activeCard !== card) activeCard.style.transform = "";
    activeCard = card;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) translateY(-3px) rotateX(${(-py * maxTilt).toFixed(2)}deg) rotateY(${(px * maxTilt).toFixed(2)}deg)`;
  });
  document.addEventListener("mouseleave", () => {
    if (activeCard) {
      activeCard.style.transform = "";
      activeCard = null;
    }
  });
}
