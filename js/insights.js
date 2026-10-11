// Analyses transversales : diversification sectorielle, historique de confiance,
// résumé hebdomadaire, et mode "revoir un jour passé". Tout est recalculé en direct à
// partir des fichiers déjà chargés (verdicts.json, opportunities.json, alerts.json),
// jamais une donnée séparée à synchroniser.

// Tendance PROVISOIRE d'un verdict en cours, calculée en direct depuis le prix actuel —
// jamais un résultat final, jamais compté dans le backtest officiel (qui attend toujours
// le vrai horizon). Sert juste à montrer que le moteur travaille avec ce qu'il a déjà,
// pas à remplacer la vérification honnête qui vient plus tard.
// Devise de price_at_issue : le champ `currency` s'il existe ; sinon la table établie le 04/10/2026
// sur l'historique CoinGecko réel (le symbole écrit dans reasoning n'est pas fiable) — émis avant le
// 20/09/2026 en EUR, à partir du 20/09 en USD, sauf CTSI resté en EUR. Même règle que
// scripts/price-alerts.mjs et docs/routines/cycle-2h-verdict.md §5. Sans elle, un verdict émis en $
// comparé au prix actuel en € paraissait ~13 % plus bas qu'en réalité.
function verdictCurrency(verdict) {
  if (verdict.currency === "USD" || verdict.currency === "EUR") return verdict.currency.toLowerCase();
  if (verdict.issued_at && verdict.issued_at >= "2026-09-20" && verdict.asset !== "cartesi") return "usd";
  return "eur";
}

function computeProvisionalStanding(verdict) {
  const current = latestFavorisPrices[verdict.asset];
  const cur = verdictCurrency(verdict);
  if (!current || typeof current[cur] !== "number") return null;
  const currentPrice = current[cur];
  const interimMovePct = ((currentPrice - verdict.price_at_issue) / verdict.price_at_issue) * 100;
  const threshold = verdict.threshold_pct || THRESHOLDS.directionalMovePct;
  let onTrack;
  if (verdict.verdict === "ACHAT") onTrack = interimMovePct > 0;
  else if (verdict.verdict === "VENTE") onTrack = interimMovePct < 0;
  else onTrack = Math.abs(interimMovePct) < threshold;
  const progressPct = Math.min((Math.abs(interimMovePct) / threshold) * 100, 100);
  return { currentPrice, interimMovePct, onTrack, progressPct, threshold };
}

function renderProvisionalBadge(verdict) {
  const standing = computeProvisionalStanding(verdict);
  if (!standing) return "";
  const cls = standing.onTrack ? "positive" : "negative";
  const label = standing.onTrack ? "provisoirement dans le bon sens" : "provisoirement contredit";
  return `<p class="hint" style="margin-top:4px;">Tendance provisoire (pas le résultat final) : <span class="${cls}">${formatChangePct(standing.interimMovePct)} depuis l'émission — ${label}</span>, ${standing.progressPct.toFixed(0)}% du chemin vers son seuil de ±${standing.threshold}%.</p>`;
}

function renderProvisionalOverview(verdicts) {
  const el = document.getElementById("provisional-overview");
  if (!el) return;
  const pending = (verdicts || []).filter((v) => v.status === "pending");
  const withStanding = pending.map((v) => ({ v, s: computeProvisionalStanding(v) })).filter((x) => x.s);

  if (withStanding.length === 0) {
    el.innerHTML = `<p class="empty-state">Pas encore de prix en direct disponible pour évaluer la tendance provisoire des verdicts en cours.</p>`;
    return;
  }
  const onTrackCount = withStanding.filter((x) => x.s.onTrack).length;
  el.innerHTML = `
    <p class="hint">Ceci utilise les prix d'aujourd'hui pour voir où en sont les verdicts en cours — <strong>ce n'est pas le backtest officiel</strong>, qui attend toujours le vrai horizon avant de compter quoi que ce soit. Un verdict "provisoirement contredit" peut très bien se retourner avant son échéance.</p>
    <div class="stat-row" style="margin-top:10px;">
      <div class="stat-card accent-teal"><div class="stat-label">Actuellement dans le bon sens</div><div class="stat-value">${onTrackCount} / ${withStanding.length}</div></div>
    </div>
    ${withStanding
      .sort((a, b) => a.s.onTrack - b.s.onTrack)
      .map(
        ({ v, s }) => `<div class="journal-entry">
          <div class="log-header"><span><strong>${v.ticker}</strong></span><span class="badge badge-${v.verdict.toLowerCase()}">${v.verdict}</span></div>
          ${renderProvisionalBadge(v)}
        </div>`
      )
      .join("")}`;
}

// gold/fed_policy (or spot, taux Fed cible, tendance bilan QE/QT, rendement Trésor 10 ans) :
// mêmes règles que stablecoins/employment_us/etf_flows juste au-dessus — champs optionnels,
// jamais inventés ici (rendu pur), alimentés par une routine qui les recherche pour de vrai
// (WebSearch/HTTP direct) ou les laisse à null plutôt que de deviner. "—" tant qu'absents,
// jamais un chiffre par défaut qui pourrait passer pour une vraie donnée.
// Or : valeur de la routine si elle en a trouvé une, sinon relevé du robot market-gauges (deux
// jetons adossés à l'or, scripts/market-gauges.mjs) — toujours présenté comme une approximation
// datée, jamais comme le cours officiel.
function goldSpotView(ctx, gauges) {
  const gold = (ctx && ctx.gold) || {};
  if (gold.spot_usd_per_oz !== null && gold.spot_usd_per_oz !== undefined) return { usd: gold.spot_usd_per_oz, approx: false, asOf: null };
  const g = gauges && gauges.gold;
  if (g && Number.isFinite(g.usd_per_oz)) return { usd: g.usd_per_oz, approx: true, asOf: g.as_of || null };
  return null;
}

// Montants du contexte macro (flux/encours ETF, positions ouvertes) : en DOLLARS. formatMarketCap
// (cards.js) affiche "Md€" et ignore le signe, faux pour un flux ETF en USD (souvent négatif).
function formatUsdAmount(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const fmt = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9)} Md$`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)} M$`;
  return `${sign}${Math.round(abs).toLocaleString("fr-FR")} $`;
}

function formatUtcStamp(iso) {
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function signedPct(value, digits) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

// data/crypto-global.json (routine dédiée coinmarketcap-quotidien, connecteur CoinMarketCap — voir
// docs/coinmarketcap.md) : rien n'est affiché tant que la routine ne l'a pas écrit.
function renderCryptoGlobalRow(cg) {
  if (!cg || !cg.as_of) return "";
  const num = (v) => Number.isFinite(v);
  const oi = num(cg.open_interest_usd)
    ? `${formatUsdAmount(cg.open_interest_usd)}${num(cg.open_interest_change_7d_pct) ? `<div class="hint">${signedPct(cg.open_interest_change_7d_pct, 1)} sur 7 j</div>` : ""}`
    : "—";
  return `
    <div class="stat-row">
      <div class="stat-card accent-gold"><div class="stat-label">Saison des altcoins${glossaryTipHtml("Saison des altcoins")}</div><div class="stat-value">${num(cg.altcoin_season_index) ? `${cg.altcoin_season_index}/100` : "—"}</div></div>
      <div class="stat-card accent-indigo"><div class="stat-label">Positions ouvertes${glossaryTipHtml("Positions ouvertes")}</div><div class="stat-value">${oi}</div></div>
      <div class="stat-card accent-violet"><div class="stat-label">Financement moyen${glossaryTipHtml("Taux de financement")}</div><div class="stat-value">${num(cg.funding_rate_avg_pct) ? signedPct(cg.funding_rate_avg_pct, 4) : "—"}</div></div>
      <div class="stat-card accent-teal"><div class="stat-label">Encours ETF BTC</div><div class="stat-value">${formatUsdAmount(cg.btc_etf_aum_usd)}</div></div>
    </div>
    <p class="hint">Levier et rotation : CoinMarketCap, relevé le ${formatUtcStamp(cg.as_of)} UTC${num(cg.btc_liquidations_24h_usd) ? ` — liquidations BTC sur 24 h : ${formatUsdAmount(cg.btc_liquidations_24h_usd)}` : ""}.${cg.note ? ` ${highlightKeyInfo(cg.note)}` : ""}</p>`;
}

function renderMarketContext(ctx, gauges, cryptoGlobal) {
  const el = document.getElementById("market-context-body");
  if (!el) return;
  if (!ctx || !ctx.last_computed_at) {
    el.innerHTML = `<p class="empty-state">Pas encore calculé — stablecoins, emploi américain, flux ETF, or, politique Fed. Alimenté au premier cycle profond qui inclut ces signaux.</p>`;
    return;
  }
  const sc = ctx.stablecoins || {};
  const emp = ctx.employment_us || {};
  const etf = ctx.etf_flows || {};
  const gold = ctx.gold || {};
  const goldView = goldSpotView(ctx, gauges);
  const fed = ctx.fed_policy || {};
  const conf = ctx.site_confidence || {};
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-indigo"><div class="stat-label">Dominance stablecoins</div><div class="stat-value">${sc.dominance_pct !== null && sc.dominance_pct !== undefined ? sc.dominance_pct.toFixed(1) + " %" : "—"}</div></div>
      <div class="stat-card accent-gold"><div class="stat-label">Chômage US</div><div class="stat-value">${emp.unemployment_rate_pct !== null && emp.unemployment_rate_pct !== undefined ? emp.unemployment_rate_pct.toFixed(1) + " %" : "—"}</div></div>
      <div class="stat-card accent-teal"><div class="stat-label">Flux ETF BTC</div><div class="stat-value">${formatUsdAmount(etf.btc_etf_net_flow_usd)}</div></div>
      <div class="stat-card accent-gray"><div class="stat-label">Or (once, USD)${glossaryTipHtml("Or (once, USD)")}</div><div class="stat-value">${goldView ? (goldView.approx ? "≈ " : "") + "$" + Math.round(goldView.usd).toLocaleString("fr-FR") : "—"}</div></div>
      <div class="stat-card accent-violet"><div class="stat-label">Taux Fed (cible)${glossaryTipHtml("Taux Fed (cible)")}</div><div class="stat-value">${fed.funds_rate_range ? escapeHtml(fed.funds_rate_range) : "—"}</div></div>
      <div class="stat-card accent-indigo"><div class="stat-label">Trésor US 10 ans${glossaryTipHtml("Trésor US 10 ans")}</div><div class="stat-value">${fed.treasury_yield_10y_pct !== null && fed.treasury_yield_10y_pct !== undefined ? fed.treasury_yield_10y_pct.toFixed(2) + " %" : "—"}</div></div>
    </div>
    ${renderCryptoGlobalRow(cryptoGlobal)}
    ${contextNote("Stablecoins", sc.note, sc.resume)}
    ${contextNote("Emploi", emp.market_reaction_note, emp.resume)}
    ${contextNote("ETF", etf.note, etf.resume)}
    ${goldView && goldView.approx ? `<p class="hint">Or : cours approché à partir de deux jetons adossés à l'or (PAX Gold, Tether Gold)${goldView.asOf ? `, relevé le ${formatUtcStamp(goldView.asOf)} UTC` : ""} — la routine n'a pas trouvé de cours officiel daté.</p>` : contextNote("Or", gold.note, gold.resume)}
    ${contextNote("Fed (taux, bilan QE/QT, prochaine réunion)", fed.note, fed.resume)}
    ${conf.level ? `<div class="hint context-note" style="margin-top:8px;"><strong>Confiance globale du site : ${escapeHtml(conf.level)}</strong>${renderSummaryFirst(conf.resume, conf.note || "")}</div>` : ""}`;
  wireClampToggles(el);
}

// Notes du contexte macro : souvent 400-1 100 caractères — résumé de la routine en tête s'il
// existe, sinon aperçu de 3 lignes ; texte complet derrière « Lire plus ».
function contextNote(label, note, resume) {
  return note ? `<div class="hint context-note"><strong>${escapeHtml(label)}</strong>${renderSummaryFirst(resume, note)}</div>` : "";
}

function renderHealthStatus(healthLog, favorisContext, verdicts) {
  const el = document.getElementById("site-health-body");
  if (!el) return;
  const checks = (healthLog && healthLog.checks) || [];
  if (checks.length === 0) {
    el.innerHTML = `<p class="empty-state">Pas encore de vérification technique enregistrée — s'alimente à chaque cycle profond.</p>`;
    return;
  }
  const last = checks[checks.length - 1];
  // site_reachable reflète l'accès sortant de l'environnement de la routine (bloqué par son proxy
  // réseau vers ce domaine, constaté systématiquement), pas la disponibilité réelle du site pour un
  // visiteur — seul files_broken reflète un vrai problème de données, donc seul lui determine le badge.
  const ok = !last.files_broken || last.files_broken.length === 0;
  // counts existe déjà dans health-log.json depuis le 12/08 (voir CLAUDE.md/README) mais n'était
  // jamais rendu — la routine le calculait pour rien du point de vue de l'utilisateur.
  const counts = last.counts;
  const integrity = typeof summarizeDataIntegrity === "function" ? summarizeDataIntegrity(favorisContext, verdicts) : null;
  el.innerHTML = `
    <div class="journal-entry">
      <div class="log-header"><span><strong>Dernière vérification</strong> · ${new Date(last.checked_at).toLocaleString("fr-FR")}</span><span class="badge badge-${ok ? "achat" : "vente"}">${ok ? "OK" : "Problème détecté"}</span></div>
      <p class="hint">Fichiers vérifiés : ${(last.files_ok || []).length}. ${last.files_broken && last.files_broken.length ? "Problèmes : " + escapeHtml(last.files_broken.join(", ")) : "Aucun problème."}</p>
      <p class="hint">Accessibilité du site depuis l'environnement de la routine : ${last.site_reachable ? "oui" : "non testable (restriction réseau de l'environnement d'exécution, pas un indicateur de panne réelle du site)"}.</p>
      ${last.note ? `<p class="hint">${highlightKeyInfo(last.note)}</p>` : ""}
    </div>
    ${
      counts
        ? `<div class="stat-row" style="margin-top:10px;">
      <div class="stat-card accent-teal"><div class="stat-label">Verdicts</div><div class="stat-value">${counts.verdicts ?? "—"}</div></div>
      <div class="stat-card accent-indigo"><div class="stat-label">Alertes</div><div class="stat-value">${counts.alerts ?? "—"}</div></div>
      <div class="stat-card accent-gold"><div class="stat-label">Opportunités</div><div class="stat-value">${counts.opportunities ?? "—"}</div></div>
      <div class="stat-card accent-violet"><div class="stat-label">Actus</div><div class="stat-value">${counts.news ?? "—"}</div></div>
      <div class="stat-card accent-gray"><div class="stat-label">Favoris avec contexte</div><div class="stat-value">${counts.favoris_context_populated ?? "—"}/15</div></div>
    </div>`
        : ""
    }
    <p class="hint" style="margin-top:8px;">${checks.length} vérification(s) enregistrée(s) au total, historique permanent.</p>
    ${integrity ? renderDataIntegritySummary(integrity) : ""}`;
}

// "Cohérence des données" — distinct de la santé technique ci-dessus (fichiers/pipeline) :
// ceci vérifie le CONTENU déjà chargé (fraîcheur par favori, plausibilité des verdicts, voir
// data-integrity.js), pas le pipeline qui les écrit. Ne corrige jamais rien, ne fait que
// compter et lister pour investigation manuelle.
function renderDataIntegritySummary(integrity) {
  if (integrity.totalIssues === 0) {
    return `<div class="journal-entry" style="margin-top:10px;">
      <div class="log-header"><span><strong>Cohérence des données</strong></span><span class="badge badge-success">Aucune anomalie</span></div>
      <p class="hint">Fraîcheur du contexte par favori, plausibilité et conformité des verdicts à la règle de sélection vérifiées, rien à signaler.</p>
    </div>`;
  }
  const staleList = integrity.staleFavoris
    .map((f) => `<span class="freshness-chip freshness-${f.status}">${escapeHtml(f.ticker)} · ${Math.round(f.ageDays)} j</span>`)
    .join(" ");
  const plausList = integrity.plausibilityIssues
    .map((p) => `<li class="hint">${escapeHtml(p.ticker || p.id)} — ${escapeHtml(p.field)} : ${escapeHtml(p.issue)} (valeur ${escapeHtml(String(p.value))})</li>`)
    .join("");
  const selectionList = (integrity.selectionViolations || [])
    .map(
      (s) =>
        `<li class="hint">${escapeHtml(s.ticker || s.id)} (${s.issued_at ? new Date(s.issued_at).toLocaleDateString("fr-FR") : "?"}) — technique ${escapeHtml(s.technique || "?")}, accord_count=${s.accord_count}, verdict émis ${escapeHtml(s.verdict)} au lieu de ${escapeHtml(s.expected)} attendu</li>`
    )
    .join("");
  return `<div class="journal-entry" style="margin-top:10px;">
    <div class="log-header"><span><strong>Cohérence des données</strong></span><span class="badge badge-warning">${integrity.totalIssues} point${integrity.totalIssues > 1 ? "s" : ""} à vérifier</span></div>
    ${staleList ? `<p class="hint">Contexte favori pas mis à jour récemment : ${staleList}</p>` : ""}
    ${plausList ? `<ul class="hint" style="margin:4px 0 0 16px;">${plausList}</ul>` : ""}
    ${selectionList ? `<p class="hint" style="margin-top:6px;">Verdicts qui ne suivent pas la règle de sélection ACHAT/ATTENTE/VENTE (docs/routines/cycle-2h-verdict.md §2) :</p><ul class="hint" style="margin:4px 0 0 16px;">${selectionList}</ul>` : ""}
  </div>`;
}

function renderSectorBreakdown(verdicts) {
  const el = document.getElementById("sector-breakdown");
  if (!el) return;
  const counts = {};
  // Couleur du secteur = celle du premier favori de ce secteur trouvé — même palette à 5
  // familles que le liseré des lignes Favoris, pour que "IA" ait la même teinte partout.
  const colorBySector = {};
  FAVORIS.forEach((f) => {
    const sector = SECTORS[f.cgId] || "Autre";
    counts[sector] = (counts[sector] || 0) + 1;
    if (!colorBySector[sector] && SECTOR_COLORS[f.cgId]) colorBySector[sector] = SECTOR_COLORS[f.cgId];
  });
  const total = FAVORIS.length;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  // En pourcentage (pas une fraction) pour se comparer directement à
  // THRESHOLDS.concentrationWarningPct (config.js) — même seuil que renderPortfolioConcentration
  // (portfolio.js), jamais un chiffre recodé en dur ici qui pourrait diverger de l'autre vue.
  const maxSharePct = (Math.max(...rows.map(([, n]) => n)) / total) * 100;

  el.innerHTML = `
    <div class="sector-bars">
      ${rows
        .map(([sector, n]) => {
          const pct = ((n / total) * 100).toFixed(0);
          const color = colorBySector[sector] || "var(--accent)";
          return `<div class="sector-row" style="--sector-color:${color}">
            <span class="sector-label">${sector}</span>
            <div class="sector-track"><div class="sector-fill" style="width:${pct}%"></div></div>
            <span class="sector-pct">${n} · ${pct}%</span>
          </div>`;
        })
        .join("")}
    </div>
    ${
      maxSharePct > THRESHOLDS.concentrationWarningPct
        ? `<p class="hint" style="margin-top:10px; color: var(--warning);">Concentration notable : plus de ${THRESHOLDS.concentrationWarningPct}% de tes favoris partagent le même secteur — si son thème tourne mal, plusieurs positions peuvent en pâtir en même temps, même si chacune a l'air correcte isolément.</p>`
        : `<p class="hint" style="margin-top:10px;">Répartition raisonnablement diversifiée entre secteurs.</p>`
    }`;
}

function renderConfidenceHistory(verdicts) {
  const el = document.getElementById("confidence-history");
  if (!el) return;
  const byAsset = {};
  (verdicts || []).forEach((v) => {
    if (!byAsset[v.asset]) byAsset[v.asset] = [];
    byAsset[v.asset].push(v);
  });
  const withHistory = Object.entries(byAsset).filter(([, list]) => list.length >= 2);

  if (withHistory.length === 0) {
    el.innerHTML = `<p class="empty-state">Pas encore d'historique — un seul verdict existe par actif pour l'instant. Cette section se remplit dès qu'un actif a eu au moins deux verdicts successifs.</p>`;
    return;
  }
  el.innerHTML = withHistory
    .map(([asset, list]) => {
      const sorted = list.slice().sort((a, b) => new Date(a.issued_at) - new Date(b.issued_at));
      const first = sorted[0].confidence_pct;
      const last = sorted[sorted.length - 1].confidence_pct;
      const trend = last > first ? "▲ en hausse" : last < first ? "▼ en baisse" : "= stable";
      const ticker = sorted[sorted.length - 1].ticker;
      return `<div class="journal-entry">
        <div class="log-header"><span><strong>${ticker}</strong></span><span class="hint">${trend}</span></div>
        <p class="hint">${sorted.map((v) => v.confidence_pct + "%").join(" → ")}</p>
      </div>`;
    })
    .join("");
}

function renderWeeklyDigest(verdicts, opportunities, alerts) {
  const el = document.getElementById("weekly-digest");
  if (!el) return;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recentVerdicts = (verdicts || []).filter((v) => new Date(v.issued_at).getTime() >= weekAgo);
  const recentResolved = (verdicts || []).filter((v) => v.outcome && v.outcome.resolved_at && new Date(v.outcome.resolved_at).getTime() >= weekAgo);
  const recentOpp = ((opportunities && opportunities.opportunities) || []).filter((o) => new Date(o.flagged_at).getTime() >= weekAgo);
  const recentAlerts = (alerts || []).filter((a) => new Date(a.triggered_at).getTime() >= weekAgo);
  const correctCount = recentResolved.filter((v) => v.outcome.verdict_correct).length;

  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-teal"><div class="stat-label">Verdicts émis (7j)</div><div class="stat-value">${recentVerdicts.length}</div></div>
      <div class="stat-card accent-indigo"><div class="stat-label">Vérifiés (7j)</div><div class="stat-value">${recentResolved.length}${recentResolved.length ? " (" + correctCount + " juste)" : ""}</div></div>
      <div class="stat-card accent-gold"><div class="stat-label">Opportunités (7j)</div><div class="stat-value">${recentOpp.length}</div></div>
      <div class="stat-card accent-violet"><div class="stat-label">Alertes (7j)</div><div class="stat-value">${recentAlerts.length}</div></div>
    </div>`;
}

function renderDayReplay(dateStr, allData) {
  const el = document.getElementById("replay-result");
  if (!dateStr) {
    el.innerHTML = "";
    return;
  }
  const cutoff = new Date(dateStr + "T23:59:59Z").getTime();
  const verdictsAsOf = (allData.verdicts || [])
    .filter((v) => new Date(v.issued_at).getTime() <= cutoff)
    .map((v) => {
      const wasResolved = v.outcome && v.outcome.resolved_at && new Date(v.outcome.resolved_at).getTime() <= cutoff;
      return Object.assign({}, v, { status: wasResolved ? "resolved" : "pending" });
    });

  if (verdictsAsOf.length === 0) {
    el.innerHTML = `<p class="empty-state">Aucun verdict n'existait encore à cette date.</p>`;
    return;
  }
  el.innerHTML = `
    <p class="hint">État du radar tel qu'il aurait été vu le ${new Date(dateStr).toLocaleDateString("fr-FR")} — reconstruit depuis l'historique permanent, rien n'est modifié.</p>
    ${verdictsAsOf
      .map(
        (v) => `<div class="journal-entry">
        <div class="log-header"><span><strong>${v.ticker}</strong> · ${new Date(v.issued_at).toLocaleDateString("fr-FR")}</span><span class="badge badge-${v.verdict.toLowerCase()}">${v.verdict}</span></div>
        <p class="hint">Statut à cette date : ${v.status === "resolved" ? "résolu" : "en cours"}</p>
      </div>`
      )
      .join("")}`;
}

// Appelee a chaque rafraichissement (loadAllData) avec des donnees fraiches — sans retirer
// l'ecouteur precedent d'abord, ils s'accumulent sur ce champ statique (jamais recree via
// innerHTML) et un seul changement de date finit par relancer le rendu N fois.
let dayReplayHandler = null;
function initDayReplay(allData) {
  const input = document.getElementById("replay-date");
  if (!input) return;
  if (dayReplayHandler) input.removeEventListener("change", dayReplayHandler);
  dayReplayHandler = () => renderDayReplay(input.value, allData);
  input.addEventListener("change", dayReplayHandler);
}

// ---------------------------------------------------------------------------
// Analyse technique quotidienne (data/technical-favoris.json, robot technical-daily, aucun quota).
// Mesures et constats chiffrés uniquement, jamais un verdict : le moteur reste seul à en émettre.

// Espace insécable avant « % » : sur un écran de téléphone, le symbole ne part jamais seul à la ligne.
const techSignedPct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}\u00a0%`;
const techDate = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : null);

// Comparatif des 15 favoris, tendance de fond la plus forte en premier, avec une phrase de synthèse
// lisible sans rien déplier. Rien du tout si le fichier du robot n'existe pas encore.
function renderFavorisTechnical(technicalFavoris) {
  const el = document.getElementById("favoris-technical");
  if (!el) return;
  const rows = FAVORIS.map((f) => ({ ticker: f.ticker, t: technicalViewFor(f.ticker, technicalFavoris, null) })).filter((r) => r.t);
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  const withTrend = rows.filter((r) => r.t.sma200GapPct !== null);
  const above = withTrend.filter((r) => r.t.sma200GapPct >= 0).length;
  const hot = rows.filter((r) => r.t.rsi14 !== null && r.t.rsi14 >= 70).map((r) => r.ticker);
  const cold = rows.filter((r) => r.t.rsi14 !== null && r.t.rsi14 <= 30).map((r) => r.ticker);
  // Synthèse dans l'ordre des favoris ; tableau ensuite trié par tendance de fond.
  rows.sort((a, b) => (b.t.sma200GapPct ?? -Infinity) - (a.t.sma200GapPct ?? -Infinity));
  const proposed = rows.filter((r) => r.t.proposed);
  const sells = proposed.filter((r) => r.t.proposed.verdict === "VENTE").map((r) => r.ticker);
  const buys = proposed.filter((r) => r.t.proposed.verdict === "ACHAT").length;
  const summary = [
    proposed.length ? `règle du moteur : ${buys} ACHAT${sells.length ? `, VENTE ${sells.join(", ")}` : ""}` : null,
    withTrend.length ? `${above}/${withTrend.length} au-dessus de leur moyenne 200 j` : null,
    hot.length ? `surachat : ${hot.join(", ")}` : null,
    cold.length ? `survente : ${cold.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  const cls = (v) => (v === null ? "" : v >= 0 ? "tech-pos" : "tech-neg");
  const cell = (v, text) => `<td class="${cls(v)}">${v === null ? "—" : text}</td>`;
  const body = rows
    .map(({ ticker, t }) => {
      const change30 = (t.change.find(([l]) => l === "30 j") || [])[1] ?? null;
      const rsiCls = t.rsi14 !== null && (t.rsi14 >= 70 || t.rsi14 <= 30) ? "tech-flag" : "";
      const rsiText = t.rsi14 === null ? "—" : `${t.rsi14.toFixed(0)}${t.rsi14 >= 70 ? " surachat" : t.rsi14 <= 30 ? " survente" : ""}`;
      const macd = t.macdHistogram === null || t.macdHistogram === 0 ? null : t.macdHistogram;
      return `<tr><th scope="row">${escapeHtml(ticker)}</th>${cell(t.sma200GapPct, t.sma200GapPct !== null ? techSignedPct(t.sma200GapPct) : "")}<td class="${rsiCls}">${rsiText}</td>${cell(macd, macd !== null ? (macd > 0 ? "haussier" : "baissier") : "")}${cell(change30, change30 !== null ? techSignedPct(change30) : "")}<td>${t.volatilityPct === null ? "—" : `${t.volatilityPct.toFixed(0)}\u00a0%`}</td></tr>`;
    })
    .join("");
  const asOf = techDate(technicalFavoris.updated_at);
  el.innerHTML = `<details class="tech-compare">
    <summary><strong>Comparatif technique des 15 favoris</strong>${summary ? `<span class="hint">${escapeHtml(summary)}</span>` : ""}</summary>
    <p class="hint">Calcul quotidien${asOf ? ` du ${escapeHtml(asOf)}` : ""} sur 1 an d'historique (CoinGecko), mêmes formules que la fiche de chaque actif : des mesures, pas des verdicts. Tri : tendance de fond la plus forte en premier. Surachat (RSI ≥ 70) = mouvement déjà étiré ; survente (RSI ≤ 30) = rebond possible, sans garantie.</p>
    <div class="tech-table-wrap"><table class="tech-table">
      <thead><tr><th scope="col">Actif</th><th scope="col">vs MM200</th><th scope="col">RSI 14 j</th><th scope="col">Élan</th><th scope="col">30 j</th><th scope="col">Volat.</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="hint">vs MM200 : écart du cours à sa moyenne 200 jours (tendance de fond). Élan : MACD. Volat. : volatilité sur 30 jours, ramenée à l'année. Détail et définitions dans la fiche de chaque actif.</p>
  </details>`;
}

// Règles candidates pour corriger le moteur, figées par le robot AVANT de connaître les issues :
// « Test réel » = verdicts vérifiés après cette date, seule colonne qui décidera (P14).
function renderCandidateRules(rules) {
  if (!rules || !rules.definitions || !rules.retrospective || !rules.prospective) return "";
  const keys = Object.keys(rules.definitions);
  const fmt = (part, k) => {
    const r = part.results && part.results[k];
    return r && part.n && r.pct !== null ? `${String(r.pct).replace(".", ",")}\u00a0%` : "—";
  };
  const name = (k) => escapeHtml((rules.definitions[k] && rules.definitions[k].name) || k);
  const since = techDate(rules.registered_at);
  return `<p class="text-resume">Pistes de correction, fixées${since ? ` le ${escapeHtml(since)}` : ""} avant de connaître les issues :</p>
    <div class="tech-table-wrap"><table class="tech-table">
      <thead><tr><th scope="col">Règle</th><th scope="col">Passé (${rules.retrospective.n})</th><th scope="col">Test réel (${rules.prospective.n})</th></tr></thead>
      <tbody>${keys.map((k) => `<tr><th scope="row">${name(k)}</th><td>${fmt(rules.retrospective, k)}</td><td>${fmt(rules.prospective, k)}</td></tr>`).join("")}</tbody>
    </table></div>
    <details class="info-toggle"><summary>ⓘ Définition des règles</summary>
      <ul class="hint">${keys.map((k) => `<li><strong>${name(k)}</strong> : ${escapeHtml((rules.definitions[k] && rules.definitions[k].rule) || "")}</li>`).join("")}</ul>
    </details>
    <p class="hint">% de verdicts justes. Une règle ne remplacera le moteur que si, sur au moins 15 verdicts du test réel, elle fait mieux que lui ET que la référence « toujours ACHAT ».</p>`;
}

// Règle du moteur en place (auto-sélection quotidienne du robot) : laquelle, depuis quand, son
// classement sur les derniers verdicts vérifiés et l'historique des changements automatiques.
function renderEngineRule(er, definitions) {
  if (!er || !er.id) return "";
  const nameOf = (k) => escapeHtml((definitions && definitions[k] && definitions[k].name) || k);
  const since = techDate(er.since);
  const sel = er.selection || {};
  const ranked = Object.entries(sel.scores || {}).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]);
  const cal = er.calibration || {};
  const calText = ["ACHAT", "VENTE"].filter((c) => cal[c] && cal[c].n).map((c) => `${c} juste ${cal[c].pct}\u00a0% du temps (${cal[c].n} cas)`).join(" · ");
  const history = (er.history || []).slice().reverse().slice(0, 3).map((h) => `${techDate(h.at)} : ${nameOf(h.from)} → ${nameOf(h.to)}`);
  return `<div class="engine-rule-box">
    <p class="text-resume">Règle du moteur en place : <strong>${escapeHtml(er.name || er.id)}</strong>${since ? ` (depuis le ${escapeHtml(since)})` : ""}.</p>
    <p class="hint">${escapeHtml(er.rule || "")}</p>
    ${calText ? `<p class="hint">Fiabilité mesurée : ${calText}. La confiance de chaque verdict est ensuite ajustée selon l'élan du bitcoin ce jour-là.</p>` : ""}
    ${ranked.length && sel.window_n ? `<p class="hint">Auto-correction : chaque soir, toutes les règles sont rejouées sur les ${sel.window_n} derniers verdicts vérifiés — ${ranked.map(([k, v]) => `${nameOf(k)} ${String(v).replace(".", ",")}\u00a0%`).join(" · ")}. Changement seulement avec ${sel.margin_pts || 5} points d'avance.</p>` : ""}
    ${history.length ? `<p class="hint">Derniers changements automatiques : ${history.join(" ; ")}.</p>` : ""}
  </div>`;
}

// Onglet Moteur : ce que disaient les indicateurs le jour de chaque verdict vérifié, comparé à
// l'issue réelle (backtest du robot, aucune donnée postérieure à l'émission). Constats calculés à
// partir des comptes du fichier — aucune conclusion écrite en dur.
function renderTechnicalBacktest(technicalFavoris) {
  const el = document.getElementById("engine-technical-backtest");
  if (!el) return;
  const b = technicalFavoris && technicalFavoris.backtest;
  const ruleBox = technicalFavoris ? renderEngineRule(technicalFavoris.engine_rule, b && b.rules && b.rules.definitions) : "";
  if (!b || !b.sample || !b.engine_calls || !b.actual) {
    el.innerHTML = `<p class="empty-state">Analyse rétrospective pas encore disponible : elle est calculée chaque soir par le robot technique.</p>`;
    return;
  }
  const share = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  const a = b.actual;
  const wait = b.engine_calls.ATTENTE;
  const since = techDate(b.first_issued_at);
  const lead = [
    `Sur ${b.sample} verdicts vérifiés${since ? ` (depuis le ${since})` : ""}, le moteur a vu juste dans ${String(b.engine_accuracy_pct).replace(".", ",")} % des cas.`,
    `Il a répondu ATTENTE ${wait.n} fois (${share(wait.n, b.sample)} %), alors que le cours est resté stable dans seulement ${a.ATTENTE} cas (${share(a.ATTENTE, b.sample)} %) : il a monté nettement dans ${a.ACHAT} cas et baissé dans ${a.VENTE}.`,
  ];
  const hot = b.by_rsi_zone && b.by_rsi_zone.surachat;
  const neutral = b.by_rsi_zone && b.by_rsi_zone.neutre;
  if (hot && hot.n >= 5 && neutral && neutral.n) {
    lead.push(
      `Quand le RSI 14 j dépassait 70 le jour du verdict (${hot.n} cas), le cours a ensuite monté nettement dans ${share(hot.actual.ACHAT, hot.n)} % des cas et baissé dans ${share(hot.actual.VENTE, hot.n)} %, contre ${share(neutral.actual.ACHAT, neutral.n)} % et ${share(neutral.actual.VENTE, neutral.n)} % avec un RSI neutre.`
    );
  }
  const groups = [
    ["RSI ≥ 70 (surachat)", b.by_rsi_zone && b.by_rsi_zone.surachat],
    ["RSI neutre", b.by_rsi_zone && b.by_rsi_zone.neutre],
    ["RSI ≤ 30 (survente)", b.by_rsi_zone && b.by_rsi_zone.survente],
    ["Cours au-dessus de la MM200", b.by_trend && b.by_trend.au_dessus_mm200],
    ["Cours sous la MM200", b.by_trend && b.by_trend.en_dessous_mm200],
    ["Tous les verdicts", { n: b.sample, actual: a }],
  ].filter(([, g]) => g && g.n);
  const cell = (n, total) => `<td>${n}<span class="hint tech-share">${share(n, total)}\u00a0%</span></td>`;
  const calls = ["ACHAT", "ATTENTE", "VENTE"].map((k) => `${k} ${b.engine_calls[k].n} (${b.engine_calls[k].correct} justes)`).join(" · ");
  el.innerHTML = `${ruleBox}${lead.map((s) => `<p class="text-resume">${highlightKeyInfo(s)}</p>`).join("")}
    <div class="tech-table-wrap"><table class="tech-table">
      <thead><tr><th scope="col">Le jour du verdict</th><th scope="col">Verdicts</th><th scope="col">Hausse</th><th scope="col">Stable</th><th scope="col">Baisse</th></tr></thead>
      <tbody>${groups.map(([label, g]) => `<tr><th scope="row">${label}</th><td>${g.n}</td>${cell(g.actual.ACHAT, g.n)}${cell(g.actual.ATTENTE, g.n)}${cell(g.actual.VENTE, g.n)}</tr>`).join("")}</tbody>
    </table></div>
    ${renderCandidateRules(b.rules)}
    <p class="hint">Choix du moteur : ${calls}. Hausse = +${THRESHOLDS.directionalMovePct} % ou plus à l'échéance du verdict, baisse = −${THRESHOLDS.directionalMovePct} % ou plus, stable entre les deux. Indicateurs recalculés avec les seuls cours connus le jour de chaque verdict.</p>
    ${b.note ? `<p class="hint">${escapeHtml(b.note)}</p>` : ""}`;
}
