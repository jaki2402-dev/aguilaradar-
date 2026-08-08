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

async function fetchHistoricalCloses(cgId, days) {
  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=eur&days=${days}&interval=daily`);
  if (!res.ok) throw new Error(`history ${res.status}`);
  const data = await res.json();
  return (data.prices || []).map((p) => p[1]);
}

async function fetchOrderBookImbalance(tvSymbol) {
  if (!tvSymbol || !tvSymbol.startsWith("BINANCE:")) return null;
  const symbol = tvSymbol.replace("BINANCE:", "");
  try {
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=50`);
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
  if (!ticker || !latestFavorisContext || !latestFavorisContext.assets) return "";
  const ctx = latestFavorisContext.assets[ticker];
  if (!ctx || !ctx.last_computed_at) {
    return `<div class="detail-context"><p class="hint">Contexte élargi (concurrent, thèse long terme, dérivés, TVL) pas encore calculé pour ${ticker} — la routine couvre les favoris par rotation, quelques cycles à attendre.</p></div>`;
  }
  const comp = ctx.competitor || {};
  const thesis = ctx.long_term_thesis || {};
  const oi = ctx.open_interest || {};
  const tvl = ctx.defi_tvl || {};
  const onchain = ctx.onchain_signal || {};
  return `<div class="detail-context">
    <strong>Contexte élargi</strong>
    ${comp.name ? `<p class="hint"><strong>Concurrent (${comp.ticker || "?"}) :</strong> ${comp.comparison_note || "—"}</p>` : `<p class="hint">Comparaison concurrent : pas encore calculée.</p>`}
    ${thesis.assumptions_note ? `<p class="hint"><strong>Thèse long terme</strong> — Bull : ${thesis.bull || "—"} · Base : ${thesis.base || "—"} · Bear : ${thesis.bear || "—"} <br/><em>${thesis.assumptions_note}</em></p>` : `<p class="hint">Thèse long terme : pas encore rédigée.</p>`}
    <p class="hint"><strong>Open interest :</strong> ${oi.value_usd ? formatMarketCap(oi.value_usd) + (oi.funding_rate_pct !== null && oi.funding_rate_pct !== undefined ? ` · funding ${oi.funding_rate_pct.toFixed(3)}%` : "") : (oi.note || "—")}</p>
    <p class="hint"><strong>TVL DeFi :</strong> ${tvl.value_usd ? formatMarketCap(tvl.value_usd) : (tvl.note || "—")}</p>
    <p class="hint"><strong>Signal on-chain (opportuniste, pas systématique) :</strong> ${onchain.available ? `${onchain.note} ${onchain.source_url ? `<a href="${onchain.source_url}" target="_blank" rel="noopener">source</a>` : ""}` : (onchain.note || "aucun signal cette fois")}</p>
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

async function renderDetailPanel(panelEl, asset) {
  panelEl.innerHTML = `<p class="empty-state">Calcul des indicateurs en cours…</p>`;
  try {
    const isBtc = asset.cgId === "bitcoin";
    const [closes, btcCloses] = await Promise.all([
      fetchHistoricalCloses(asset.cgId, 60),
      isBtc ? Promise.resolve(null) : fetchHistoricalCloses("bitcoin", 60).catch(() => null),
    ]);
    const rsi = computeRSI(closes, 14);
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, Math.min(50, closes.length));
    const price = closes[closes.length - 1];
    const signals = technicalSignalSentences(price, sma20, sma50, rsi, asset.athChangePct);

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

    panelEl.innerHTML = `
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
        orderBook
          ? `<div class="detail-orderbook">
              <span class="hint">Carnet d'ordres (Binance, temps réel)</span>
              <div class="orderbook-bar"><div class="orderbook-bid" style="width:${orderBook.bidPct.toFixed(1)}%"></div></div>
              <p class="hint">Achat ${orderBook.bidPct.toFixed(0)} % · Vente ${orderBook.askPct.toFixed(0)} % — un mur peut être retiré en une seconde, ne pas s'y fier seul.</p>
            </div>`
          : `<p class="hint">Carnet d'ordres non disponible pour cet actif (pas de paire Binance directe identifiée).</p>`
      }
      <div class="detail-opinion">
        <strong>Mon avis</strong>
        <p>${asset.reasoning || asset.reason || "Analyse pas encore disponible pour cet actif — en attente du prochain cycle."}</p>
        ${asset.verdict ? `<p class="hint">Verdict actuel : <span class="badge badge-${asset.verdict.toLowerCase()}">${asset.verdict}</span> — vérifié automatiquement à son échéance, jamais avant.</p>` : ""}
      </div>
      ${renderFavorisContextSection(asset.ticker)}`;
    return true;
  } catch (err) {
    console.error("Erreur fiche detaillee:", err);
    panelEl.innerHTML = `<p class="empty-state">Indicateurs indisponibles pour l'instant (limite API probable) — referme et rouvre la fiche pour réessayer.</p>`;
    return false;
  }
}

function attachDetailToggle(cardEl, panelId, baseAsset) {
  let loaded = false;
  cardEl.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isOpen = panel.classList.toggle("open");
    cardEl.classList.toggle("expanded", isOpen);
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
  });
}
