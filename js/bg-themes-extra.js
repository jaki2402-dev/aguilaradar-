// Trois thèmes de fond supplémentaires (voir js/theme.js pour l'orchestration, js/bg-galaxy-3d.js
// pour le modèle d'API suivi ici : window.AguilaBackgrounds.<id> = { mount(canvas), unmount(),
// isActive() }). Canvas 2D classique comme background-fx.js (dont ce fichier réutilise
// setupHiDPICanvas/prefersReducedMotion — mêmes fonctions globales, même portée partagée, voir
// l'ordre des <script> dans index.html) plutôt que WebGL : suffisant pour ces effets, pas besoin
// d'une scène 3D de plus.

// ---- Aurore : bandes de couleur douces façon aurore boréale / nébuleuse, esprit plus onirique
// que la Galaxie 3D (étoiles ponctuelles) — reprend la palette d'accent déjà utilisée ailleurs
// sur le site (teal/cyan/violet/rose/or, voir --c-favoris etc. dans style.css) pour rester
// cohérent avec l'identité visuelle plutôt que d'inventer de nouvelles couleurs. ----
(function () {
  const BLOB_COLORS = ["#2fd3b0", "#22b8e0", "#b48cf2", "#f277b3", "#f0b429"];
  let rafId = null, ctx = null, canvasEl = null, lastW = 0, lastH = 0, stars = [];

  function ensureSize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      ctx = setupHiDPICanvas(canvasEl, w, h);
      lastW = w;
      lastH = h;
    }
  }

  function buildBlobs() {
    return BLOB_COLORS.map((color, i) => ({
      color,
      x: 0.15 + Math.random() * 0.7,
      y: 0.1 + Math.random() * 0.6,
      baseR: 0.22 + Math.random() * 0.16,
      speed: 0.00002 + Math.random() * 0.00002,
      angle: (i / BLOB_COLORS.length) * Math.PI * 2,
      radius: 0.12 + Math.random() * 0.1,
      phase: Math.random() * Math.PI * 2,
    }));
  }
  let blobs = buildBlobs();

  function buildStars() {
    return Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    // ensureSize() DOIT être appelée avant tout usage de ctx : au premier appel, ctx est encore
    // null (rien à dessiner sans dimensions connues) — un garde-fou "if (!ctx) return" placé
    // avant ensureSize() la rendrait injoignable et bloquerait le canvas à sa taille par défaut
    // (300x150) pour toujours, bug réel constaté à l'écran (Playwright) avant ce correctif.
    ensureSize();
    if (!ctx) { rafId = requestAnimationFrame(draw); return; }
    const w = lastW, h = lastH;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.filter = "blur(70px)";
    ctx.globalCompositeOperation = "screen";
    blobs.forEach((b) => {
      const cx = (b.x + Math.cos(b.angle + t * b.speed) * b.radius) * w;
      const cy = (b.y + Math.sin(b.angle + t * b.speed) * b.radius * 0.7) * h;
      const pulse = 0.75 + 0.25 * Math.sin(t * 0.0006 + b.phase);
      const r = b.baseR * Math.max(w, h) * pulse;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, b.color + "55");
      grad.addColorStop(1, b.color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    stars.forEach((s) => {
      const twinkle = 0.4 + 0.6 * Math.max(0, Math.sin(t * 0.0011 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238, 242, 247, ${(0.5 * twinkle).toFixed(3)})`;
      ctx.fill();
    });

    rafId = requestAnimationFrame(draw);
  }

  window.AguilaBackgrounds = window.AguilaBackgrounds || {};
  window.AguilaBackgrounds.aurora = {
    mount(canvas) {
      if (rafId || !canvas || prefersReducedMotion()) return;
      canvasEl = canvas;
      blobs = buildBlobs();
      stars = buildStars();
      lastW = 0;
      lastH = 0;
      rafId = requestAnimationFrame(draw);
    },
    unmount() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      ctx = null;
    },
    isActive() {
      return rafId !== null;
    },
  };
})();

// ---- Grille Cyber : plancher en perspective façon "HUD"/synthwave, dans l'esprit instrument
// déjà présent ailleurs sur le site (coins en équerre, balayage hud-sweep en CSS) mais porté au
// fond d'écran entier — lignes qui défilent lentement vers l'avant, tons teal/cyan uniquement,
// jamais de couleur hors palette. ----
(function () {
  let rafId = null, ctx = null, canvasEl = null, lastW = 0, lastH = 0;

  function ensureSize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      ctx = setupHiDPICanvas(canvasEl, w, h);
      lastW = w;
      lastH = h;
    }
  }

  // Grille en perspective classique : lignes horizontales espacées de façon exponentielle
  // (proches du bas -> serrées vers l'horizon), lignes verticales convergeant vers un point de
  // fuite au centre de l'horizon — le tout dans le tiers inférieur de l'écran seulement, pour
  // ne jamais gêner la lecture du contenu au-dessus.
  function draw(t) {
    // Voir le même correctif et la même explication dans le thème Aurore ci-dessus.
    ensureSize();
    if (!ctx) { rafId = requestAnimationFrame(draw); return; }
    const w = lastW, h = lastH;
    ctx.clearRect(0, 0, w, h);

    const horizonY = h * 0.62;
    const vanishX = w * 0.5;
    const floorTop = horizonY, floorBottom = h;

    // Lueur d'horizon.
    const glow = ctx.createLinearGradient(0, horizonY - 40, 0, horizonY + 10);
    glow.addColorStop(0, "rgba(47, 211, 176, 0)");
    glow.addColorStop(1, "rgba(47, 211, 176, 0.14)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - 40, w, 50);

    // Lignes horizontales défilant lentement vers l'avant (progression cyclique 0..1).
    const scroll = (t * 0.00004) % 1;
    ctx.strokeStyle = "rgba(47, 211, 176, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const p = (i / 14 + scroll) % 1;
      const y = floorTop + Math.pow(p, 2.2) * (floorBottom - floorTop);
      const spread = 0.5 + p * 0.9;
      ctx.globalAlpha = 0.15 + p * 0.5;
      ctx.beginPath();
      ctx.moveTo(vanishX - w * spread, y);
      ctx.lineTo(vanishX + w * spread, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Lignes verticales convergentes.
    ctx.strokeStyle = "rgba(34, 184, 224, 0.14)";
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(vanishX, horizonY);
      ctx.lineTo(vanishX + i * w * 0.14, floorBottom);
      ctx.stroke();
    }

    rafId = requestAnimationFrame(draw);
  }

  window.AguilaBackgrounds = window.AguilaBackgrounds || {};
  window.AguilaBackgrounds.cyber = {
    mount(canvas) {
      if (rafId || !canvas || prefersReducedMotion()) return;
      canvasEl = canvas;
      lastW = 0;
      lastH = 0;
      rafId = requestAnimationFrame(draw);
    },
    unmount() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      ctx = null;
    },
    isActive() {
      return rafId !== null;
    },
  };
})();

// ---- Minimaliste : lueur unique, quasi statique, pour qui préfère un fond calme (lisibilité,
// batterie) sans renoncer à l'identité "instrument" du site (une seule teinte d'accent). Reste
// un vrai thème du même système (mount/unmount/isActive), pas un cas particulier "sans fond". ----
(function () {
  let rafId = null, ctx = null, canvasEl = null, lastW = 0, lastH = 0;

  function draw(t) {
    // Voir le même correctif et la même explication dans le thème Aurore plus haut : la taille
    // doit être (re)calculée avant tout usage de ctx, jamais après un "if (!ctx) return" précoce.
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      ctx = setupHiDPICanvas(canvasEl, w, h);
      lastW = w;
      lastH = h;
    }
    if (!ctx) { rafId = requestAnimationFrame(draw); return; }
    ctx.clearRect(0, 0, w, h);
    const pulse = 0.85 + 0.15 * Math.sin(t * 0.00008);
    const grad = ctx.createRadialGradient(w * 0.5, h * -0.05, 0, w * 0.5, h * -0.05, Math.max(w, h) * 0.65 * pulse);
    grad.addColorStop(0, "rgba(47, 211, 176, 0.09)");
    grad.addColorStop(1, "rgba(47, 211, 176, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    rafId = requestAnimationFrame(draw);
  }

  window.AguilaBackgrounds = window.AguilaBackgrounds || {};
  window.AguilaBackgrounds.minimal = {
    mount(canvas) {
      if (rafId || !canvas) return;
      canvasEl = canvas;
      lastW = 0;
      lastH = 0;
      // Toujours actif même si mouvement réduit demandé : l'animation est déjà si subtile
      // qu'il n'y a rien à couper, et ce thème est justement le repli "calme" du système.
      rafId = requestAnimationFrame(draw);
    },
    unmount() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      ctx = null;
    },
    isActive() {
      return rafId !== null;
    },
  };
})();
