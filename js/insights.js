// Analyses transversales : diversification sectorielle, historique de confiance,
// résumé hebdomadaire, et mode "revoir un jour passé". Tout est recalculé en direct à
// partir des fichiers déjà chargés (verdicts.json, opportunities.json, alerts.json),
// jamais une donnée séparée à synchroniser.

// Tendance PROVISOIRE d'un verdict en cours, calculée en direct depuis le prix actuel —
// jamais un résultat final, jamais compté dans le backtest officiel (qui attend toujours
// le vrai horizon). Sert juste à montrer que le moteur travaille avec ce qu'il a déjà,
// pas à remplacer la vérification honnête qui vient plus tard.
function computeProvisionalStanding(verdict) {
  const current = latestFavorisPrices[verdict.asset];
  if (!current || current.eur === undefined) return null;
  const currentPrice = current.eur;
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

function renderMarketContext(ctx) {
  const el = document.getElementById("market-context-body");
  if (!el) return;
  if (!ctx || !ctx.last_computed_at) {
    el.innerHTML = `<p class="empty-state">Pas encore calculé — stablecoins, emploi américain, flux ETF. Alimenté au premier cycle profond qui inclut ces signaux.</p>`;
    return;
  }
  const sc = ctx.stablecoins || {};
  const emp = ctx.employment_us || {};
  const etf = ctx.etf_flows || {};
  const conf = ctx.site_confidence || {};
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-indigo"><div class="stat-label">Dominance stablecoins</div><div class="stat-value">${sc.dominance_pct !== null && sc.dominance_pct !== undefined ? sc.dominance_pct.toFixed(1) + " %" : "—"}</div></div>
      <div class="stat-card accent-gold"><div class="stat-label">Chômage US</div><div class="stat-value">${emp.unemployment_rate_pct !== null && emp.unemployment_rate_pct !== undefined ? emp.unemployment_rate_pct.toFixed(1) + " %" : "—"}</div></div>
      <div class="stat-card accent-teal"><div class="stat-label">Flux ETF BTC</div><div class="stat-value">${etf.btc_etf_net_flow_usd !== null && etf.btc_etf_net_flow_usd !== undefined ? formatMarketCap(etf.btc_etf_net_flow_usd) : "—"}</div></div>
    </div>
    ${sc.note ? `<p class="hint">Stablecoins : ${escapeHtml(sc.note)}</p>` : ""}
    ${emp.market_reaction_note ? `<p class="hint">Emploi : ${escapeHtml(emp.market_reaction_note)}</p>` : ""}
    ${etf.note ? `<p class="hint">ETF : ${escapeHtml(etf.note)}</p>` : ""}
    ${conf.level ? `<p class="hint" style="margin-top:8px;"><strong>Confiance globale du site : ${escapeHtml(conf.level)}</strong> — ${escapeHtml(conf.note || "")}</p>` : ""}`;
}

function renderHealthStatus(healthLog) {
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
  el.innerHTML = `
    <div class="journal-entry">
      <div class="log-header"><span><strong>Dernière vérification</strong> · ${new Date(last.checked_at).toLocaleString("fr-FR")}</span><span class="badge badge-${ok ? "achat" : "vente"}">${ok ? "OK" : "Problème détecté"}</span></div>
      <p class="hint">Fichiers vérifiés : ${(last.files_ok || []).length}. ${last.files_broken && last.files_broken.length ? "Problèmes : " + escapeHtml(last.files_broken.join(", ")) : "Aucun problème."}</p>
      <p class="hint">Accessibilité du site depuis l'environnement de la routine : ${last.site_reachable ? "oui" : "non testable (restriction réseau de l'environnement d'exécution, pas un indicateur de panne réelle du site)"}.</p>
      ${last.note ? `<p class="hint">${escapeHtml(last.note)}</p>` : ""}
    </div>
    <p class="hint" style="margin-top:8px;">${checks.length} vérification(s) enregistrée(s) au total, historique permanent.</p>`;
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
  const maxShare = Math.max(...rows.map(([, n]) => n)) / total;

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
      maxShare > 0.3
        ? `<p class="hint" style="margin-top:10px; color: var(--warning);">Concentration notable : plus de 30% de tes favoris partagent le même secteur — si son thème tourne mal, plusieurs positions peuvent en pâtir en même temps, même si chacune a l'air correcte isolément.</p>`
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
