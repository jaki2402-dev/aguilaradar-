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

// Palette + disposition des nébuleuses, inspirées des photos JWST "Piliers de la Création"
// envoyées par l'utilisateur : une brume bleue profonde et étendue en arrière-plan, puis des
// piliers de gaz plus chauds (or/rouille, rose/crème, cyan) devant — même composition que la
// vraie nébuleuse de l'Aigle. `core`/`mid`/`edge` sont les 3 arrêts de couleur (RGB 0-255) du
// dégradé procédural de chaque nuage, voir makeNebulaTexture.
// Échelles volontairement contenues malgré l'envie de "grand fond spatial" : le fill-rate (le
// nombre de pixels à ombrer) dépend de la surface écran des sprites, pas du détail de leur
// texture (celui-ci est déjà cuit une fois pour toutes dans le <canvas> procédural, gratuit au
// rendu) — mesuré ici avant/après via un vrai test de FPS, pas supposé : une première version
// avec un halo de fond à l'échelle 2000 faisait chuter le FPS SwiftShader de ~12 à ~5.5.
// `pillar: true` étire le sprite verticalement (voir `aspect` plus bas) et le garde debout —
// contrairement à une brume ronde, une pointe pivotée à l'horizontale ne ressemblerait plus à
// une colonne de gaz, donc ces deux-là dérivent en position mais ne tournent pas sur eux-mêmes.
const NEBULA_CONFIGS = [
  { core: [110, 150, 235], mid: [46, 58, 130], edge: [8, 11, 34], scale: 1500, pos: [-80, 30, -1150], opacity: 0.3 },
  { core: [255, 178, 96], mid: [205, 92, 56], edge: [36, 24, 56], scale: 1050, pos: [230, -60, -820], opacity: 0.52, pillar: true, aspect: 0.58 },
  { core: [255, 214, 176], mid: [198, 110, 150], edge: [28, 22, 66], scale: 1100, pos: [-260, 120, -960], opacity: 0.44, pillar: true, aspect: 0.62 },
  { core: [190, 255, 232], mid: [70, 170, 190], edge: [10, 38, 52], scale: 900, pos: [70, -190, -700], opacity: 0.4 },
];

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

// Bruit de valeur 2D (grille aléatoire + interpolation smoothstep) — la brique de base pour des
// textures de nébuleuse qui ont une vraie structure interne (colonnes de gaz, filaments) plutôt
// qu'un simple dégradé plat. Fait main (quelques dizaines de lignes) plutôt qu'une dépendance
// externe : cohérent avec le reste du fichier, tout y est procédural/local.
function makeValueNoise2D(gridSize) {
  const g = gridSize;
  const cells = new Float32Array((g + 1) * (g + 1));
  for (let i = 0; i < cells.length; i++) cells[i] = Math.random();
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
    const fx = (((x % 1) + 1) % 1) * g;
    const fy = (((y % 1) + 1) % 1) * g;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, g), y1 = Math.min(y0 + 1, g);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const v00 = cells[y0 * (g + 1) + x0];
    const v10 = cells[y0 * (g + 1) + x1];
    const v01 = cells[y1 * (g + 1) + x0];
    const v11 = cells[y1 * (g + 1) + x1];
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return a + (b - a) * ty;
  };
}

// Bruit fractal (somme de plusieurs octaves de bruit de valeur, amplitude décroissante) : donne
// l'aspect "nuage de gaz" avec du détail à plusieurs échelles au lieu d'un bruit uniforme.
function makeFbm(baseGrid, octaves) {
  const layers = [];
  let amp = 1, ampSum = 0;
  for (let i = 0; i < octaves; i++) {
    layers.push({ noise: makeValueNoise2D(Math.round(baseGrid * 2 ** i)), amp });
    ampSum += amp;
    amp *= 0.5;
  }
  return function (x, y) {
    let sum = 0;
    for (const l of layers) sum += l.noise(x, y) * l.amp;
    return sum / ampSum;
  };
}

function mixRgb(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

// Texture de nébuleuse procédurale : dégradé radial doux (pour rester un nuage isolé, pas un
// pavage) modulé par du bruit fractal à deux échelles (grandes colonnes de gaz + filaments fins
// et lumineux) et coloré par un dégradé à 3 arrêts (bord froid → milieu → coeur chaud) — comme
// les photos JWST envoyées par l'utilisateur. Toujours un <canvas> local, jamais une image.
function makeNebulaTexture(config, size = 384) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  // La structure (grandes colonnes) domine largement la couleur/densité ; le filament n'est
  // qu'un accent clairsemé (seuil élevé) — les faire contribuer à parts égales donnait deux
  // motifs de bruit concurrents, un aspect "statique TV" plutôt qu'un vrai nuage de gaz cohérent.
  const fbmStructure = makeFbm(4, 4);
  const fbmFilament = makeFbm(16, 2);
  const cx = size / 2, cy = size / 2, maxR = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
      const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const structure = fbmStructure(nx, ny);
      const filament = Math.max(0, fbmFilament(nx * 2.2, ny * 2.2) - 0.66) / 0.34;
      const heat = Math.min(1, structure * 0.9 + filament * 0.35);
      const rgb = heat < 0.5
        ? mixRgb(config.edge, config.mid, heat / 0.5)
        : mixRgb(config.mid, config.core, (heat - 0.5) / 0.5);
      const density = Math.pow(falloff, 1.5) * (0.32 + 0.68 * structure);
      const alpha = Math.min(1, density + filament * 0.3 * falloff);
      const idx = (y * size + x) * 4;
      img.data[idx] = rgb[0];
      img.data[idx + 1] = rgb[1];
      img.data[idx + 2] = rgb[2];
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  // Lissage (moyenne 3x3) : le bruit de valeur brut donne des blocs assez nets vus de près —
  // ce flou léger les fond en volutes plus organiques, comme un vrai nuage plutôt qu'un motif
  // de bruit reconnaissable comme tel.
  const src = img.data.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const sy = y + oy;
        if (sy < 0 || sy >= size) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const sx = x + ox;
          if (sx < 0 || sx >= size) continue;
          const i = (sy * size + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
          n++;
        }
      }
      const idx = (y * size + x) * 4;
      img.data[idx] = r / n;
      img.data[idx + 1] = g / n;
      img.data[idx + 2] = b / n;
      img.data[idx + 3] = a / n;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Texture d'étoile à pointes de diffraction (croix à 8 branches façon JWST, miroir segmenté) :
// 4 grandes pointes + 4 plus courtes en diagonale, coeur brillant par-dessus. Réservée à une
// poignée d'étoiles seulement (voir heroStars) — sur les photos de référence, seules les étoiles
// les plus brillantes montrent cet effet, pas le ciel entier.
function makeStarSpikeTexture(hexColor) {
  const size = 200;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(hexColor);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const cx = size / 2, cy = size / 2;
  ctx.globalCompositeOperation = "lighter";
  function spike(len, width, angle, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -width / 2);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, width / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 4; i++) spike(size * 0.5, 3.2, (Math.PI / 2) * i, 0.85);
  for (let i = 0; i < 4; i++) spike(size * 0.28, 1.6, (Math.PI / 2) * i + Math.PI / 4, 0.45);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.16);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.4, `rgba(${rgb},0.9)`);
  core.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
  ctx.fill();
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
  // Trois textures à pointes partagées (pas une par étoile) pour ne pas alourdir le coût déjà
  // présent ci-dessous (une texture par étoile pour le halo simple, voir makeGlowTexture).
  const spikeTexWhite = makeStarSpikeTexture(0xffffff);
  const spikeTexGold = makeStarSpikeTexture(0xf0b429);
  const spikeTexCyan = makeStarSpikeTexture(0x8ad9ff);
  const heroStars = [];
  for (let i = 0; i < 50; i++) {
    // Une étoile sur 6 a des pointes de diffraction façon JWST — comme sur les photos de
    // référence, seules les plus brillantes montrent cet effet, pas le ciel entier.
    const isSpike = i % 6 === 0;
    const spikeTex = i % 18 === 0 ? spikeTexGold : i % 12 === 0 ? spikeTexCyan : spikeTexWhite;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: isSpike ? spikeTex : makeGlowTexture(i % 7 === 0 ? 0xf0b429 : 0xffffff, 1),
      transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const dist = 260 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    sprite.position.set(dist * Math.sin(phi) * Math.cos(theta), dist * Math.sin(phi) * Math.sin(theta), dist * Math.cos(phi));
    const baseScale = (isSpike ? 6 : 4) + Math.random() * (isSpike ? 4 : 5);
    sprite.scale.set(baseScale, baseScale, 1);
    scene.add(sprite);
    heroStars.push({ sprite, baseScale, phase: Math.random() * Math.PI * 2, speed: 0.0016 + Math.random() * 0.0022, isSpike });
  }

  // Nuages de gaz nébuleux : texture procédurale bruitée (voir makeNebulaTexture) au lieu d'un
  // simple halo radial — donne des colonnes/filaments qui se distinguent, comme les piliers de
  // gaz des photos JWST. Chaque nuage tourne lentement sur lui-même et dérive doucement (voir
  // tick ci-dessous) : animé et en mouvement en continu, pas un décor figé.
  const nebulae = NEBULA_CONFIGS.map((config) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNebulaTexture(config),
      transparent: true,
      opacity: config.opacity,
      // Fondu alpha normal, PAS additif : contrairement aux halos/étoiles ailleurs dans ce
      // fichier (qui doivent rayonner), un pilier de gaz doit pouvoir en RECOUVRIR un autre —
      // avec un mélange additif les nuages qui se chevauchent ne faisaient que s'éclaircir en
      // une bouillie brune/violette au lieu de se superposer comme des formes distinctes (photos
      // JWST : la brume bleue de fond, les piliers chauds nettement détachés devant).
      blending: THREE.NormalBlending,
      depthWrite: false,
    }));
    sprite.scale.set(config.scale * (config.aspect || 1), config.scale, 1);
    sprite.position.set(config.pos[0], config.pos[1], config.pos[2]);
    sprite.material.rotation = config.pillar ? (Math.random() - 0.5) * 0.3 : Math.random() * Math.PI * 2;
    scene.add(sprite);
    return {
      sprite,
      baseX: config.pos[0],
      baseY: config.pos[1],
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 0.00002 + Math.random() * 0.00003,
      rotSpeed: config.pillar ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.000012 + Math.random() * 0.00002),
    };
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
      nebulae.forEach((n) => {
        n.sprite.material.rotation += n.rotSpeed;
        n.sprite.position.x = n.baseX + Math.sin(t * n.driftSpeed + n.driftPhase) * 50;
        n.sprite.position.y = n.baseY + Math.cos(t * n.driftSpeed * 0.8 + n.driftPhase) * 32;
      });
      heroStars.forEach((h) => {
        const s = h.baseScale * (0.75 + 0.35 * Math.sin(t * h.speed + h.phase));
        h.sprite.scale.set(s, s, 1);
        h.sprite.material.opacity = 0.5 + 0.5 * Math.sin(t * h.speed * 1.3 + h.phase);
        if (h.isSpike) h.sprite.material.rotation += 0.00003;
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
