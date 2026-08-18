// Fond "Galaxie 3D" — alternative en vrai WebGL au fond radar 2D historique (voir
// background-fx.js, conservé intact sous le thème "Classique"). Three.js est vendorisé en
// local (js/vendor/three.module.min.js), jamais chargé depuis un CDN externe : même logique
// que le reste du site (voir CLAUDE.md — ne jamais dépendre d'un service tiers qui peut être
// indisponible), et ça permet de le tester hors-ligne.
//
// Chargé en <script type="module">, donc dans SA PROPRE portée — contrairement aux autres
// fichiers js/*.js qui partagent la portée lexicale globale classique des balises <script>
// (voir la note en tête de test/helpers/loadPage.js). On expose donc volontairement une petite
// API sur window.AguilaBackgrounds.galaxy pour que theme.js (script classique) puisse la
// piloter. Les scripts "module" s'exécutent après tous les scripts classiques mais toujours
// avant DOMContentLoaded (spec HTML) : à condition que theme.js soit appelé depuis un
// gestionnaire DOMContentLoaded (c'est le cas, via auth.js), cette API est déjà prête. Filet de
// sécurité quand même côté theme.js : si jamais elle ne l'est pas (échec réseau improbable vu
// que le fichier est vendorisé, futur refactor), on retombe simplement sur le thème Classique
// plutôt que d'afficher un fond vide.

import * as THREE from "./vendor/three.module.min.js";

// Mêmes couleurs que les 5 familles de secteurs de config.js (SECTOR_COLORS) — pour que le
// fond reste dans l'identité visuelle du site plutôt qu'un décor spatial générique sans lien
// avec le reste de la page.
const PLANET_COLORS = [0xf0b429, 0x7c9eff, 0x22b8e0, 0xb48cf2, 0xfb8362];

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function canHoverPrecisely() {
  return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// Texture de planète procédurale (dégradé + bandes façon géante gazeuse) — jamais un fichier
// image à télécharger, dans le même esprit "aucune dépendance externe" que le reste du fichier.
function makePlanetTexture(hexColor) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const base = new THREE.Color(hexColor);
  const light = base.clone().offsetHSL(0, 0, 0.16);
  const dark = base.clone().offsetHSL(0, 0.05, -0.18);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, `#${light.getHexString()}`);
  grad.addColorStop(0.5, `#${base.getHexString()}`);
  grad.addColorStop(1, `#${dark.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) {
    const y = Math.random() * size;
    const h = 5 + Math.random() * 16;
    ctx.fillStyle = `rgba(255,255,255,${(0.03 + Math.random() * 0.06).toFixed(3)})`;
    ctx.fillRect(0, y, size, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Texture de sprite radiale (halo/nébuleuse/anneau) — même principe procédural.
function makeGlowTexture(hexColor, opacity) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(hexColor);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb},${opacity})`);
  grad.addColorStop(0.5, `rgba(${rgb},${(opacity * 0.35).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildStarfield(count, radius, tintHex) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Distribution uniforme sur une coquille sphérique (pas un cube) pour éviter des coins
    // visiblement plus denses en étoiles qu'ailleurs.
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.55 + Math.random() * 0.45);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    const roll = Math.random();
    if (roll > 0.93) tmp.setHex(0xf0b429);
    else if (roll > 0.8) tmp.setHex(tintHex);
    else tmp.setRGB(1, 1, 1);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}

function createScene(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: window.innerWidth > 900, powerPreference: "low-power" });
  } catch (err) {
    console.error("Fond Galaxie 3D indisponible (WebGL) :", err);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  // Caméra volontairement distante (620 unités) avec des orbites resserrées (voir plus bas) :
  // un premier essai avec la caméra plus proche laissait les planètes traverser le champ tout
  // près de la caméra à certaines phases d'orbite, les faisant passer pour d'énormes boules
  // envahissant l'écran plutôt qu'un fond discret derrière les données — vérifié par capture
  // d'écran réelle, pas supposé. Cadrage recalculé pour garantir une distance minimale
  // confortable à toutes les phases (voir les rayons d'orbite plus bas).
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 4000);
  camera.position.set(0, 40, 620);

  const starsFar = new THREE.Points(
    buildStarfield(5000, 1400, 0x22b8e0),
    new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })
  );
  const starsNear = new THREE.Points(
    buildStarfield(1200, 700, 0x2fd3b0),
    new THREE.PointsMaterial({ size: 2.3, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })
  );
  scene.add(starsFar, starsNear);

  const nebulae = [0x2fd3b0, 0x7c9eff, 0xb48cf2].map((hex, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(hex, 0.9), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
    const scale = 900 + i * 220;
    sprite.scale.set(scale, scale, 1);
    sprite.position.set(Math.cos(i * 2.4) * 500, Math.sin(i * 1.7) * 250, -800 - i * 150);
    scene.add(sprite);
    return sprite;
  });

  scene.add(new THREE.AmbientLight(0x8899bb, 1.1));
  const sun = new THREE.PointLight(0xfff2d6, 900, 3000, 1.4);
  sun.position.set(380, 220, 260);
  scene.add(sun);
  const fill = new THREE.PointLight(0x2fd3b0, 260, 3000, 1.4);
  fill.position.set(-300, -150, -200);
  scene.add(fill);

  // Rayons de sphère et d'orbite volontairement petits par rapport à la distance caméra
  // (620, voir plus haut) : au pire moment de leur orbite (phase la plus proche de la caméra),
  // la distance réelle reste d'au moins ~470 unités pour une planète de rayon max ~8 — donc
  // une taille apparente toujours discrète, jamais envahissante.
  const planets = PLANET_COLORS.map((hex, i) => {
    const radius = 3.6 + i * 1.15 + (i === 0 ? 2 : 0);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 32),
      new THREE.MeshStandardMaterial({ map: makePlanetTexture(hex), roughness: 0.85, metalness: 0.05 })
    );
    scene.add(mesh);
    if (i === 0) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.7, radius * 2.8, 64),
        new THREE.MeshBasicMaterial({ map: makeGlowTexture(hex, 0.8), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2.3;
      mesh.add(ring);
    }
    return {
      mesh,
      orbitX: 70 + i * 26,
      orbitZ: 55 + i * 22,
      inclination: i * 0.32 - 0.64,
      speed: 0.00006 + i * 0.000011,
      phase: Math.random() * Math.PI * 2,
      spin: 0.0018 + Math.random() * 0.0032,
    };
  });

  let disposed = false;
  let raf = null;
  let mouseX = 0, mouseY = 0;
  const wantsParallax = canHoverPrecisely();

  function onPointerMove(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  if (wantsParallax) window.addEventListener("pointermove", onPointerMove, { passive: true });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / (h || 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);

  function tick(t) {
    if (disposed) return;
    if (!document.hidden) {
      planets.forEach((p) => {
        const angle = t * p.speed + p.phase;
        p.mesh.position.set(
          Math.cos(angle) * p.orbitX,
          Math.sin(angle) * p.orbitX * Math.sin(p.inclination),
          Math.sin(angle) * p.orbitZ
        );
        p.mesh.rotation.y += p.spin;
      });
      starsFar.rotation.y += 0.00002;
      starsNear.rotation.y -= 0.00003;
      if (wantsParallax) {
        camera.position.x += (mouseX * 35 - camera.position.x) * 0.01;
        camera.position.y += (30 - mouseY * 22 - camera.position.y) * 0.01;
      }
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(tick);
  }

  resize();
  tick(0);

  return {
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (wantsParallax) window.removeEventListener("pointermove", onPointerMove);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
    },
  };
}

let active = null;

function mount(canvas) {
  if (active || !canvas || prefersReducedMotion()) return;
  if (!window.WebGLRenderingContext) return;
  active = createScene(canvas);
}

function unmount() {
  if (active) {
    active.dispose();
    active = null;
  }
}

function isActive() {
  return active !== null;
}

window.AguilaBackgrounds = window.AguilaBackgrounds || {};
window.AguilaBackgrounds.galaxy = { mount, unmount, isActive };
