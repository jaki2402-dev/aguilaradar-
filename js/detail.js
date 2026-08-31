// Fiche d'analyse détaillée par actif — ouverte au clic sur une carte. Tous les indicateurs
// sont calculés en direct à partir de données réelles (historique CoinGecko, carnet d'ordres
// Binance) — rien n'est précalculé ni inventé.

function computeRSI(closes, period) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses += -delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeRSIAt(closes, period, endIndex) {
  const slice = closes.slice(0, endIndex + 1);
  return computeRSI(slice, period);
}

// Correlation de Pearson sur les rendements quotidiens (pas les prix bruts, qui donneraient
// une corrélation trompeuse à cause de la tendance commune) — mesure réelle, pas un avis.
function computeCorrelation(closesA, closesB) {
  const n = Math.min(closesA.length, closesB.length);
  if (n < 10) return null;
  const retA = [];
  const retB = [];
  for (let i = closesA.length - n + 1; i < closesA.length; i++) retA.push((closesA[i] - closesA[i - 1]) / closesA[i - 1]);
  for (let i = closesB.length - n + 1; i < closesB.length; i++) retB.push((closesB[i] - closesB[i - 1]) / closesB[i - 1]);
  const meanA = retA.reduce((a, b) => a + b, 0) / retA.length;
  const meanB = retB.reduce((a, b) => a + b, 0) / retB.length;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < retA.length; i++) {
    cov += (retA[i] - meanA) * (retB[i] - meanB);
    varA += (retA[i] - meanA) ** 2;
    varB += (retB[i] - meanB) ** 2;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

// Divergence prix/RSI simplifiée et honnête : si le prix est proche de son plus haut sur la
// fenêtre ET que le RSI actuel est plus bas que le RSI d'il y a ~20 jours, c'est un signe
// classique (mais pas infaillible) que la dynamique s'essouffle malgré le nouveau sommet.
function detectDivergence(closes) {
  if (closes.length < 35) return null;
  const currentPrice = closes[closes.length - 1];
  const windowMax = Math.max(...closes.slice(-30));
  const nearHigh = currentPrice >= windowMax * 0.95;
  const rsiNow = computeRSI(closes, 14);
  const rsiPast = computeRSIAt(closes, 14, closes.length - 21);
  if (rsiNow === null || rsiPast === null) return null;
  if (nearHigh && rsiNow < rsiPast - 5) {
    return { type: "bearish", rsiNow, rsiPast };
  }
  return null;
}

// Sans timeout, une requete qui reste en attente (serveur lent, pas forcement une erreur
// franche) laisse la fiche bloquee sur "Calcul en cours..." indefiniment - fermer/rouvrir ne
// suffit alors pas a relancer, puisque le fetch precedent n'a jamais echoue pour de bon.
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchHistoricalCloses(cgId, days) {
  const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=eur&days=${days}&interval=daily`, 12000);
  if (!res.ok) throw new Error(`history ${res.status}`);
  const data = await res.json();
  return (data.prices || []).map((p) => p[1]);
}

async function fetchOrderBookImbalance(tvSymbol) {
  if (!tvSymbol || !tvSymbol.startsWith("BINANCE:")) return null;
  const symbol = tvSymbol.replace("BINANCE:", "");
  try {
    const res = await fetchWithTimeout(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=50`, 12000);
    if (!res.ok) return null;
    const data = await res.json();
    const bidVol = (data.bids || []).reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
    const askVol = (data.asks || []).reduce((sum, [, qty]) => sum + parseFloat(qty), 0);
    const total = bidVol + askVol;
    if (total === 0) return null;
    return { bidPct: (bidVol / total) * 100, askPct: (askVol / total) * 100 };
  } catch (e) {
    return null;
  }
}

function renderFavorisContextSection(ticker) {
  // typeof ... "undefined" (pas juste !latestFavorisContext) : ce `let` est déclaré dans
  // app.js, pas ici — le référencer avant que app.js ait chargé (ex: portfolio.js appelant
  // cette fonction dans une page qui ne charge pas app.js) lèverait un ReferenceError plutôt
  // que de simplement rendre "" comme prévu. Même précaution que typeof FAVORIS/SECTOR_COLORS
  // ailleurs dans ce fichier.
  if (!ticker || typeof latestFavorisContext === "undefined" || !latestFavorisContext || !latestFavorisContext.assets) return "";
  const ctx = latestFavorisContext.assets[ticker];
  if (!ctx || !ctx.last_computed_at) {
    return `<div class="detail-context"><p class="hint">Contexte élargi (concurrent, thèse long terme, dérivés, TVL) pas encore calculé pour ${ticker} — la routine couvre les favoris par rotation, quelques cycles à attendre.</p></div>`;
  }
  const comp = ctx.competitor || {};
  const thesis = ctx.long_term_thesis || {};
  const oi = ctx.open_interest || {};
  const tvl = ctx.defi_tvl || {};
  const onchain = ctx.onchain_signal || {};
  const onchainSourceUrl = onchain.source_url ? safeUrl(onchain.source_url) : null;
  return `<div class="detail-context">
    <strong>Contexte élargi</strong>
    ${comp.name ? `<p class="hint"><strong>Concurrent (${escapeHtml(comp.ticker || "?")}) :</strong> ${escapeHtml(comp.comparison_note || "—")}</p>` : `<p class="hint">Comparaison concurrent : pas encore calculée.</p>`}
    ${thesis.assumptions_note ? `<p class="hint"><strong>Thèse long terme</strong> — Bull : ${escapeHtml(thesis.bull || "—")} · Base : ${escapeHtml(thesis.base || "—")} · Bear : ${escapeHtml(thesis.bear || "—")} <br/><em>${escapeHtml(thesis.assumptions_note)}</em></p>` : `<p class="hint">Thèse long terme : pas encore rédigée.</p>`}
    <p class="hint"><strong>Open interest :</strong> ${oi.value_usd ? formatMarketCap(oi.value_usd) + (oi.funding_rate_pct !== null && oi.funding_rate_pct !== undefined ? ` · funding ${oi.funding_rate_pct.toFixed(3)}%` : "") : escapeHtml(oi.note || "—")}</p>
    <p class="hint"><strong>TVL DeFi :</strong> ${tvl.value_usd ? formatMarketCap(tvl.value_usd) : escapeHtml(tvl.note || "—")}</p>
    <p class="hint"><strong>Signal on-chain (opportuniste, pas systématique) :</strong> ${onchain.available ? `${escapeHtml(onchain.note)} ${onchainSourceUrl ? `<a href="${escapeHtml(onchainSourceUrl)}" target="_blank" rel="noopener">source</a>` : ""}` : escapeHtml(onchain.note || "aucun signal cette fois")}</p>
  </div>`;
}

const HORIZON_LABELS = { j1: "1 jour", j3: "3 jours", j7: "7 jours", j14: "14 jours", m6: "6 mois" };
const HORIZON_ORDER = ["j1", "j3", "j7", "j14", "m6"];

function renderOpportunityHorizonsSection(horizons) {
  if (!horizons) return "";
  const chips = HORIZON_ORDER.map((key) => {
    const h = horizons[key];
    if (!h) return "";
    let cls = "badge-neutral";
    let text = "en attente";
    if (h.status === "resolved" && h.outcome && h.outcome.validated !== null) {
      const pct = h.outcome.move_pct;
      const pctText = (pct >= 0 ? "+" : "") + pct.toFixed(1) + " %";
      cls = h.outcome.validated ? "badge-achat" : "badge-vente";
      text = pctText;
    }
    return `<div class="horizon-chip"><span class="hint">${HORIZON_LABELS[key]}</span><span class="badge ${cls}">${text}</span></div>`;
  }).join("");
  return `<div class="detail-horizons">
    <strong>Vérification par horizon</strong>
    <p class="hint">Chaque opportunité est revérifiée à 5 échéances indépendantes plutôt qu'un seul verdict final — vert si le mouvement a dépassé le seuil directionnel dans le bon sens, rouge sinon.</p>
    <div class="horizons-row">${chips}</div>
  </div>`;
}

function technicalSignalSentences(price, sma20, sma50, rsi, athChangePct) {
  const lines = [];
  if (sma20 !== null && sma50 !== null) {
    if (price > sma20 && sma20 > sma50) lines.push({ label: "Alignement haussier des moyennes", text: "Prix > MM20 > MM50 : structure de fond acheteuse." });
    else if (price < sma20 && sma20 < sma50) lines.push({ label: "Alignement baissier des moyennes", text: "Prix < MM20 < MM50 : structure de fond vendeuse." });
    else lines.push({ label: "Moyennes mêlées", text: "Prix, MM20 et MM50 ne sont pas alignés — phase de transition ou de range." });
  }
  if (rsi !== null) {
    if (rsi >= 70) lines.push({ label: `RSI élevé (${rsi.toFixed(0)})`, text: "Zone de surachat technique — risque de reprise de souffle à court terme." });
    else if (rsi <= 30) lines.push({ label: `RSI bas (${rsi.toFixed(0)})`, text: "Zone de survente technique — rebond possible mais peut aussi rester bas longtemps." });
    else lines.push({ label: `RSI neutre (${rsi.toFixed(0)})`, text: "Ni surachat ni survente, pas de signal extrême de ce côté." });
  }
  if (athChangePct !== null && athChangePct !== undefined) {
    if (athChangePct > -10) lines.push({ label: "Proche de son plus haut historique", text: "Peu de résistance au-dessus, mais aucune marge de sécurité si le marché se retourne." });
    else if (athChangePct < -85) lines.push({ label: "Très loin de son plus haut historique", text: `À ${athChangePct.toFixed(0)}% de son ATH — potentiel de rattrapage mais aussi possible que ce niveau ne revienne jamais.` });
  }
  return lines;
}

async function fetchMarketChartData(cgId, days) {
  const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=eur&days=${days}&interval=daily`, 12000);
  if (!res.ok) throw new Error(`market_chart ${res.status}`);
  const data = await res.json();
  return {
    closes: (data.prices || []).map((p) => p[1]),
    volumes: (data.total_volumes || []).map((v) => v[1]),
  };
}

// Profil de volume, gamme fixe (l'indicateur TradingView du même nom) : où le volume s'est
// concentré par NIVEAU DE PRIX sur une periode fixe et explicite (pas un histogramme dans le
// temps, pas une fenetre qui suit le defilement du graphique) — construit a partir des
// clotures/volumes quotidiens deja recuperes pour RSI/MM (aucun appel reseau de plus).
// Gamme fixe = les VOLUME_PROFILE_DAYS derniers jours, toujours la meme regle a chaque
// calcul. Version quotidienne, pas intra-journaliere : moins fine qu'un vrai profil tick par
// tick, mais reelle, pas inventee, et suffisante pour reperer le point de controle et la
// zone de valeur sur cette gamme.
const VOLUME_PROFILE_DAYS = 60;

function computeVolumeProfile(closes, volumes, binCount) {
  if (!closes || !volumes || closes.length < 10 || closes.length !== volumes.length) return null;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  if (min === max) return null;
  const binSize = (max - min) / binCount;
  const bins = new Array(binCount).fill(0);
  for (let i = 0; i < closes.length; i++) {
    let idx = Math.floor((closes[i] - min) / binSize);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx] += volumes[i] || 0;
  }
  const totalVolume = bins.reduce((a, b) => a + b, 0);
  if (totalVolume === 0) return null;

  let pocIdx = 0;
  for (let i = 1; i < binCount; i++) if (bins[i] > bins[pocIdx]) pocIdx = i;

  // Zone de valeur : étend depuis le point de contrôle jusqu'à couvrir ~70% du volume total,
  // en ajoutant à chaque étape le côté (au-dessus ou en dessous) le plus charge en volume.
  let lo = pocIdx, hi = pocIdx;
  let included = bins[pocIdx];
  while (included / totalVolume < 0.7 && (lo > 0 || hi < binCount - 1)) {
    const volBelow = lo > 0 ? bins[lo - 1] : -1;
    const volAbove = hi < binCount - 1 ? bins[hi + 1] : -1;
    if (volAbove >= volBelow) { hi++; included += bins[hi]; }
    else { lo--; included += bins[lo]; }
  }

  return {
    poc: min + (pocIdx + 0.5) * binSize,
    val: min + lo * binSize,
    vah: min + (hi + 1) * binSize,
  };
}

function volumeProfileSignal(price, vp) {
  if (!vp || price === undefined || price === null) return null;
  const pocText = formatPrice(vp.poc, "EUR");
  const valText = formatPrice(vp.val, "EUR");
  const vahText = formatPrice(vp.vah, "EUR");
  const inValueArea = price >= vp.val && price <= vp.vah;

  const prefix = `Profil de volume, gamme fixe (${VOLUME_PROFILE_DAYS}j)`;
  if (inValueArea) {
    const nearPoc = Math.abs(price - vp.poc) <= (vp.vah - vp.val) * 0.15;
    return {
      label: nearPoc ? `${prefix} : proche du point de contrôle (${pocText})` : `${prefix} : dans la zone de valeur (${valText} – ${vahText})`,
      text: nearPoc
        ? `C'est le niveau de prix où s'est échangé le plus de volume sur les ${VOLUME_PROFILE_DAYS} derniers jours — zone d'équilibre entre acheteurs et vendeurs, souvent peu directionnelle tant que le prix y reste.`
        : `Le prix évolue dans la zone où s'est concentré l'essentiel du volume (~70%) sur les ${VOLUME_PROFILE_DAYS} derniers jours — terrain plutôt équilibré, sans forte pression dans un sens.`,
    };
  }
  const above = price > vp.vah;
  return {
    label: above ? `${prefix} : au-dessus de la zone de valeur (> ${vahText})` : `${prefix} : en dessous de la zone de valeur (< ${valText})`,
    text: above
      ? `Le prix s'est éloigné vers le haut de la zone où s'est concentré le volume sur les ${VOLUME_PROFILE_DAYS} derniers jours (point de contrôle à ${pocText}) — soit un vrai mouvement en cours, soit une extension qui peut revenir se combler vers ce niveau.`
      : `Le prix s'est éloigné vers le bas de la zone où s'est concentré le volume sur les ${VOLUME_PROFILE_DAYS} derniers jours (point de contrôle à ${pocText}) — soit une vraie pression vendeuse, soit une extension qui peut revenir se combler vers ce niveau.`,
  };
}

// Utilité du token (FAVORIS[].utility, config.js — recherche factuelle ponctuelle, voir le
// commentaire au-dessus de FAVORIS) : présentée comme un signal de plus dans la même grille,
// pour situer tout de suite "à quoi sert ce jeton" à côté des lectures techniques du moment.
// Aucun fetch ici (déjà en mémoire) — placé en premier dans la liste par renderTechnicalSection
// pour donner ce contexte avant les signaux du jour.
function utilitySignal(cgId) {
  const fav = typeof FAVORIS !== "undefined" ? FAVORIS.find((f) => f.cgId === cgId) : null;
  if (!fav || !fav.utility) return null;
  return { label: "Utilité du token", text: fav.utility };
}

// Volume 24h/7j/14j/30j : moyennes journalières glissantes construites depuis les volumes déjà
// récupérés pour le Profil de volume ci-dessus (aucun appel réseau de plus). Sert à distinguer
// un mouvement de prix confirmé par une vraie hausse de participation d'un mouvement sur volume
// faible, moins fiable — lecture classique d'analyse technique ("le volume confirme la
// tendance"), demandée explicitement pour mieux juger la pression achat/vente de chaque actif.
function computeVolumeWindows(volumes) {
  if (!volumes || volumes.length === 0) return null;
  const avgLastN = (n) => {
    const slice = volumes.slice(Math.max(0, volumes.length - n));
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  return {
    vol24h: volumes[volumes.length - 1],
    avg7d: volumes.length >= 7 ? avgLastN(7) : null,
    avg14d: volumes.length >= 14 ? avgLastN(14) : null,
    avg30d: volumes.length >= 30 ? avgLastN(30) : null,
  };
}

// Combine le ratio volume 24h / moyenne 7j avec la position du prix par rapport à sa MM20
// (déjà calculée juste au-dessus) : un volume en forte hausse confirme la direction du prix
// (accumulation ou distribution réelle) ; un volume faible affaiblit la fiabilité d'un
// mouvement de prix, quel que soit son sens. Toujours formulé en "cohérent avec"/"mérite
// prudence", jamais en certitude — un pattern, pas une prédiction.
function volumeTrendSignal(vw, price, sma20) {
  if (!vw || !vw.avg7d) return null;
  const ratio = vw.vol24h / vw.avg7d;
  const trendUp = price !== null && sma20 !== null ? price > sma20 : null;
  const ratioText = ratio >= 1 ? `×${ratio.toFixed(1)}` : `${(ratio * 100).toFixed(0)} %`;
  let text;
  if (ratio >= 1.5) {
    text = trendUp === true
      ? "Volume nettement au-dessus de sa moyenne des 7 derniers jours pendant que le prix évolue au-dessus de sa MM20 — cohérent avec de l'accumulation réelle plutôt que du bruit."
      : trendUp === false
        ? "Volume nettement au-dessus de sa moyenne des 7 derniers jours pendant que le prix évolue sous sa MM20 — cohérent avec une vraie pression vendeuse plutôt que du bruit."
        : "Volume nettement au-dessus de sa moyenne des 7 derniers jours — intérêt inhabituel sur cet actif en ce moment, à confirmer par la direction du prix.";
  } else if (ratio <= 0.5) {
    text = "Volume nettement en dessous de sa moyenne des 7 derniers jours — peu de conviction actuellement, un mouvement de prix sur un volume aussi faible mérite d'être pris avec prudence.";
  } else {
    text = "Volume dans sa fourchette normale des 7 derniers jours — rien d'inhabituel côté participation en ce moment.";
  }
  return { label: `Volume 24h : ${ratioText} de la moyenne 7j`, text };
}

// Section "indicateurs techniques" : seule partie qui dépend d'un fetch réseau (historique
// de prix pour RSI/MM/corrélation/Volume Profile + carnet d'ordres). Isolée dans sa propre
// fonction pour qu'un échec réseau (limite API, hors-ligne) ne fasse jamais disparaître le
// reste de la fiche (avis, horizons, contexte favori) qui sont déjà en mémoire, sans requête.
async function renderTechnicalSection(asset) {
  const isBtc = asset.cgId === "bitcoin";
  const [assetChart, btcCloses] = await Promise.all([
    fetchMarketChartData(asset.cgId, VOLUME_PROFILE_DAYS),
    isBtc ? Promise.resolve(null) : fetchHistoricalCloses("bitcoin", 60).catch(() => null),
  ]);
  const closes = assetChart.closes;
  const rsi = computeRSI(closes, 14);
  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, Math.min(50, closes.length));
  const price = closes[closes.length - 1];
  const signals = technicalSignalSentences(price, sma20, sma50, rsi, asset.athChangePct);

  const utility = utilitySignal(asset.cgId);
  if (utility) signals.unshift(utility);

  const volumeProfile = computeVolumeProfile(closes, assetChart.volumes, 24);
  const vpSignal = volumeProfileSignal(price, volumeProfile);
  if (vpSignal) signals.push(vpSignal);

  const volumeWindows = computeVolumeWindows(assetChart.volumes);
  const volSignal = volumeTrendSignal(volumeWindows, price, sma20);
  if (volSignal) signals.push(volSignal);

  const correlation = btcCloses ? computeCorrelation(closes, btcCloses) : null;
  if (correlation !== null) {
    const level = Math.abs(correlation) >= 0.7 ? "forte" : Math.abs(correlation) >= 0.4 ? "modérée" : "faible";
    signals.push({
      label: `Corrélation à BTC : ${level} (${correlation.toFixed(2)})`,
      text: Math.abs(correlation) >= 0.7
        ? "Cet actif suit largement les mouvements de BTC — un verdict propre positif compte moins si BTC casse un support."
        : "Cet actif se comporte assez indépendamment de BTC en ce moment — ses propres signaux pèsent davantage.",
    });
  }

  const divergence = detectDivergence(closes);
  if (divergence) {
    signals.push({
      label: "Divergence baissière prix/RSI détectée",
      text: `Prix proche de son plus haut récent mais RSI en baisse (${divergence.rsiNow.toFixed(0)} contre ${divergence.rsiPast.toFixed(0)} il y a ~3 semaines) — signal classique d'essoufflement, pas une certitude.`,
    });
  }

  const orderBook = await fetchOrderBookImbalance(asset.tvSymbol);
  const chartId = `tv-detail-${asset.ticker}`;

  const html = `
    ${asset.showChart && asset.tvSymbol ? `<div class="tv-chart" id="${chartId}"></div>` : ""}
    <div class="detail-grid">
      ${signals
        .map(
          (s) => `<div class="detail-signal">
            <strong>${s.label}</strong>
            <p class="hint">${s.text}</p>
          </div>`
        )
        .join("")}
    </div>
    <div class="detail-stats">
      <div class="detail-stat"><span class="hint">RSI (14)</span><strong>${rsi !== null ? rsi.toFixed(0) : "—"}</strong></div>
      <div class="detail-stat"><span class="hint">MM20</span><strong>${sma20 !== null ? formatPrice(sma20, "EUR") : "—"}</strong></div>
      <div class="detail-stat"><span class="hint">MM50</span><strong>${sma50 !== null ? formatPrice(sma50, "EUR") : "—"}</strong></div>
      <div class="detail-stat"><span class="hint">vs ATH</span><strong>${asset.athChangePct !== undefined && asset.athChangePct !== null ? asset.athChangePct.toFixed(1) + " %" : "—"}</strong></div>
    </div>
    ${
      volumeWindows
        ? `<div class="detail-stats-label"><span class="hint">Volume (moyennes journalières)</span></div>
    <div class="detail-stats">
      <div class="detail-stat"><span class="hint">24h</span><strong>${formatMarketCap(volumeWindows.vol24h)}</strong></div>
      <div class="detail-stat"><span class="hint">Moy. 7j</span><strong>${volumeWindows.avg7d !== null ? formatMarketCap(volumeWindows.avg7d) : "—"}</strong></div>
      <div class="detail-stat"><span class="hint">Moy. 14j</span><strong>${volumeWindows.avg14d !== null ? formatMarketCap(volumeWindows.avg14d) : "—"}</strong></div>
      <div class="detail-stat"><span class="hint">Moy. 30j</span><strong>${volumeWindows.avg30d !== null ? formatMarketCap(volumeWindows.avg30d) : "—"}</strong></div>
    </div>`
        : ""
    }
    ${
      orderBook
        ? `<div class="detail-orderbook">
            <span class="hint">Carnet d'ordres (Binance, temps réel)</span>
            <div class="orderbook-bar"><div class="orderbook-bid" style="width:${orderBook.bidPct.toFixed(1)}%"></div></div>
            <p class="hint">Achat ${orderBook.bidPct.toFixed(0)} % · Vente ${orderBook.askPct.toFixed(0)} % — un mur peut être retiré en une seconde, ne pas s'y fier seul.</p>
          </div>`
        : `<p class="hint">Carnet d'ordres non disponible pour cet actif (pas de paire Binance directe identifiée).</p>`
    }`;

  return { html, chartId: asset.showChart && asset.tvSymbol ? chartId : null };
}

async function renderDetailPanel(panelEl, asset) {
  panelEl.innerHTML = `<p class="empty-state">Calcul des indicateurs en cours…</p>`;

  let technicalHtml = "";
  let chartId = null;
  let technicalOk = true;
  try {
    const result = await renderTechnicalSection(asset);
    technicalHtml = result.html;
    chartId = result.chartId;
  } catch (err) {
    console.error("Erreur indicateurs techniques:", err);
    technicalOk = false;
    technicalHtml = `<p class="empty-state">Indicateurs techniques indisponibles pour l'instant (limite API probable) — referme et rouvre la fiche pour réessayer.</p>`;
  }

  // Le reste (avis, horizons, contexte favori) est déjà en mémoire (aucun fetch requis) :
  // s'affiche toujours, meme si la section technique ci-dessus a échoué.
  panelEl.innerHTML = `
    ${technicalHtml}
    <div class="detail-opinion">
      <strong>Mon avis</strong>
      <p>${escapeHtml(asset.reasoning || asset.reason || "Analyse pas encore disponible pour cet actif — en attente du prochain cycle.")}</p>
      ${asset.verdict ? `<p class="hint">Verdict actuel : <span class="badge badge-${asset.verdict.toLowerCase()}">${asset.verdict}</span> — vérifié automatiquement à son échéance, jamais avant.</p>` : ""}
    </div>
    ${asset.horizons ? renderOpportunityHorizonsSection(asset.horizons) : ""}
    ${renderFavorisContextSection(asset.ticker)}`;

  if (technicalOk && chartId) mountTradingViewChart(chartId, asset.tvSymbol);
  return technicalOk;
}

function attachDetailToggle(cardEl, panelId, baseAsset) {
  let loaded = false;
  cardEl.setAttribute("tabindex", "0");
  cardEl.setAttribute("role", "button");
  cardEl.setAttribute("aria-expanded", "false");

  function toggle(e) {
    if (e.target.closest("a")) return;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isOpen = panel.classList.toggle("open");
    cardEl.classList.toggle("expanded", isOpen);
    cardEl.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !loaded) {
      loaded = true;
      // Relit les données réelles (verdict/raisonnement) au moment du clic, pas à l'attache
      // du gestionnaire — les verdicts arrivent souvent après le rendu initial des cartes.
      const asset = Object.assign({}, baseAsset, {
        reasoning: cardEl.dataset.reasoning || baseAsset.reasoning,
        verdict: cardEl.dataset.verdict || baseAsset.verdict,
      });
      // Si le fetch échoue (ex: limite API), on remet loaded à false pour qu'une prochaine
      // fermeture/réouverture retente réellement, au lieu de rester bloqué sur l'erreur.
      renderDetailPanel(panel, asset).then((success) => {
        if (!success) loaded = false;
      });
    }
  }

  cardEl.addEventListener("click", toggle);
  cardEl.addEventListener("keydown", (e) => {
    if (e.target.closest("a")) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle(e);
  });
}
