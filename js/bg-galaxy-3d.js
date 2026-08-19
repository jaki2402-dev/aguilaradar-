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
  // Plafonné à 1.5 plutôt que 2 : sur un écran haute densité réel (ex. 3x sur iPhone), le
  // coût est au nombre de PIXELS ombrés (fill-rate), pas au nombre de sommets — c'est là que
  // le rendu logiciel utilisé pour tester ce fichier dans cet environnement s'est révélé lent
  // (mesuré : réduire les étoiles/segments de sphère n'a presque rien changé, réduire la
  // résolution effective si). Différence invisible à l'oeil pour un fond, gain réel de fill-rate.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  // Caméra distante (520 unités, resserrée depuis les 620 initiaux — voir la formule des
  // rayons de planète juste plus bas pour la nouvelle marge de sécurité) avec des orbites
  // resserrées : un tout premier essai avec la caméra plus proche ET des planètes plus
  // grandes laissait les planètes traverser le champ tout près de la caméra à certaines
  // phases d'orbite, les faisant passer pour d'énormes boules envahissant l'écran plutôt
  // qu'un fond discret derrière les données — vérifié par capture d'écran réelle, pas
  // supposé. Le cadrage ci-dessous a été recalculé pour garantir la même marge de sécurité
  // (distance minimale ~375 unités au pire moment de l'orbite, pour un rayon de planète
  // maximal ~11.4 → taille apparente encore modeste, mais nettement plus présente qu'avant).
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 1, 4000);
  camera.position.set(0, 45, 520);

  // Nombre d'étoiles généreux : la mesure faite lors du réglage précédent (~12 FPS sous
  // SwiftShader, rendu logiciel pur sans vrai GPU, seul WebGL disponible dans cet
  // environnement bac à sable de test) a montré qu'ajuster le nombre d'étoiles ne changeait
  // presque rien au FPS mesuré — le plafond venait d'ailleurs (fill-rate du rendu logiciel),
  // pas du nombre de points. Sur un vrai GPU, quelques milliers de points supplémentaires
  // sont gratuits ; pas de raison de rester chiche ici pour le rendu visuel.
  const starsFar = new THREE.Points(
    buildStarfield(6000, 1600, 0x22b8e0),
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })
  );
  const starsNear = new THREE.Points(
    buildStarfield(1600, 750, 0x2fd3b0),
    new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })
  );
  scene.add(starsFar, starsNear);

  // Étoiles "vedettes" : contrairement aux deux nuages de points ci-dessus (un seul matériau
  // partagé, ne peut pas scintiller individuellement sans shader personnalisé), ce sont de
  // vrais sprites indépendants — peu nombreux, donc bon marché même sur un GPU modeste — dont
  // la taille/opacité respire à son propre rythme déphasé pour un vrai scintillement étoile
  // par étoile, l'un des signes visuels les plus reconnaissables d'un ciel étoilé réaliste.
  const heroStars = [];
  for (let i = 0; i < 50; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(i % 7 === 0 ? 0xf0b429 : 0xffffff, 1),
      transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const dist = 260 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    sprite.position.set(dist * Math.sin(phi) * Math.cos(theta), dist * Math.sin(phi) * Math.sin(theta), dist * Math.cos(phi));
    const baseScale = 4 + Math.random() * 5;
    sprite.scale.set(baseScale, baseScale, 1);
    scene.add(sprite);
    heroStars.push({ sprite, baseScale, phase: Math.random() * Math.PI * 2, speed: 0.0016 + Math.random() * 0.0022 });
  }

  const nebulae = [0x2fd3b0, 0x7c9eff, 0xb48cf2].map((hex, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(hex, 0.9), transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false }));
    const scale = 950 + i * 240;
    sprite.scale.set(scale, scale, 1);
    sprite.position.set(Math.cos(i * 2.4) * 500, Math.sin(i * 1.7) * 250, -800 - i * 150);
    scene.add(sprite);
    return sprite;
  });

  scene.add(new THREE.AmbientLight(0x8899bb, 1.1));
  // Position vérifiée pour tomber DANS le champ de la caméra (52° de champ vertical, visée
  // vers l'origine depuis (0,45,520)) — un premier essai à (380,220,260) était à ~60° de
  // l'axe de vue, donc en dehors du cône visible malgré le calcul d'intensité correct : la
  // lumière existait bien mais son sprite ne s'affichait tout simplement jamais à l'écran.
  // Vérifié par capture d'écran réelle après correction, pas seulement recalculé sur papier.
  const sun = new THREE.PointLight(0xfff2d6, 480, 3000, 1.4);
  // Décalé vers le bord du champ plutôt que le centre : à (160,110,-180) le halo tombait
  // presque pile derrière un chiffre-clé de l'onglet Accueil (dominance BTC) — repoussé vers
  // la périphérie pour ne jamais gêner la lecture, vérifié à l'écran après coup.
  sun.position.set(300, 150, -160);
  scene.add(sun);
  const fill = new THREE.PointLight(0x2fd3b0, 260, 3000, 1.4);
  fill.position.set(-300, -150, -200);
  scene.add(fill);

  // Le soleil : un vrai objet VISIBLE à la position de la lumière chaude ci-dessus. Une
  // lumière seule éclaire les planètes mais ne se voit elle-même nulle part — l'erreur
  // classique d'une scène spatiale qui du coup ne ressemble pas vraiment à de l'espace.
  // Deux sprites superposés (halo large + coeur petit et dense) pour un effet crédible sans
  // shader personnalisé : le coeur donne le point brillant, le halo donne le rayonnement.
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(0xfff2d6, 1), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunHalo.scale.set(150, 150, 1);
  sunHalo.position.copy(sun.position);
  scene.add(sunHalo);
  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(0xffffff, 1), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunCore.scale.set(40, 40, 1);
  sunCore.position.copy(sun.position);
  scene.add(sunCore);

  // Rayons de sphère et d'orbite calculés pour rester sous la marge de sécurité expliquée au
  // niveau de la caméra plus haut (distance minimale ~375 unités au pire moment de l'orbite
  // pour un rayon max ~11.4) — plus présentes qu'avant, mais toujours loin de la taille qui
  // avait posé problème lors du tout premier réglage.
  const planets = PLANET_COLORS.map((hex, i) => {
    const radius = 5 + i * 1.6 + (i === 0 ? 2.5 : 0);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      // Lambert plutôt que Standard (PBR) : éclairage par sommet, beaucoup moins coûteux par
      // pixel — à la taille où ces planètes s'affichent (voir le cadrage caméra plus haut), la
      // nuance PBR roughness/metalness ne se voyait de toute façon pas.
      new THREE.MeshLambertMaterial({ map: makePlanetTexture(hex) })
    );
    scene.add(mesh);
    // Halo d'atmosphère : un sprite enfant (toujours face caméra, suit la planète
    // automatiquement) légèrement plus grand que la sphère, dans sa propre couleur — donne
    // une impression de luminosité/atmosphère plutôt qu'une simple bille texturée mate.
    const atmosphere = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(hex, 0.7), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glowScale = radius * 4.4;
    atmosphere.scale.set(glowScale, glowScale, 1);
    mesh.add(atmosphere);
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
      heroStars.forEach((h) => {
        const s = h.baseScale * (0.75 + 0.35 * Math.sin(t * h.speed + h.phase));
        h.sprite.scale.set(s, s, 1);
        h.sprite.material.opacity = 0.5 + 0.5 * Math.sin(t * h.speed * 1.3 + h.phase);
      });
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
      // Volontairement PAS de WEBGL_lose_context.loseContext() ici : testé (24 allers-retours
      // rapides via Playwright), et forcer la perte de contexte cassait le remontage suivant
      // sur le même <canvas> (le navigateur ne restaure pas le contexte assez vite pour un
      // nouveau WebGLRenderer immédiat, qui plante alors en lisant .precision sur un contexte
      // encore perdu). renderer.dispose() seul, laissant le ramasse-miettes reprendre le
      // reste, s'est révélé fiable même sur 24 allers-retours en quelques secondes — un usage
      // réel (clics humains) ne s'en approche jamais.
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
