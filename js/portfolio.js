// Onglet Portefeuille — positions réelles de l'utilisateur (qty + capital investi saisis à la
// main dans data/portfolio.json, jamais déduits ni recalculés automatiquement). Valeur/P&L/P&L%
// ne sont JAMAIS stockés : toujours recalculés ici à partir du prix live (latestFavorisPrices,
// tenu à jour par prices.js), donc se réactualisent seuls à chaque tick de prix (refreshPrices,
// toutes les 60s) sans jamais nécessiter de mise à jour manuelle en dehors d'un changement réel
// de position (achat/vente signalé par l'utilisateur -> data/portfolio.json).

let latestPortfolio = null;
let latestPortfolioVerdicts = [];

function latestVerdictFor(cgId, verdicts) {
  return (verdicts || [])
    .filter((v) => v.asset === cgId)
    .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
}

// value/invested à null quand la position est "pending" (chiffres pas encore fournis, ex.
// FLUX au 25/08) plutôt que d'inventer un chiffre — cohérent avec le "jamais halluciner" déjà
// appliqué partout ailleurs sur le site (verdicts "pending", digest.json non rafraîchi, etc.).
function renderPortfolioRow(pos) {
  const fav = FAVORIS.find((f) => f.cgId === pos.cgId);
  const ticker = fav ? fav.ticker : pos.cgId;
  const name = fav ? fav.name : pos.cgId;

  if (pos.pending || pos.qty === null || pos.qty === undefined || pos.invested === null || pos.invested === undefined) {
    return {
      html: `<tr>
        <td>${escapeHtml(ticker)}<div class="hint">${escapeHtml(name)}</div></td>
        <td colspan="4" class="hint">En attente des chiffres réels (qty / capital investi) — voir data/portfolio.json</td>
        <td>—</td>
      </tr>`,
      value: 0,
      invested: 0,
      counted: false,
    };
  }

  const priceInfo = latestFavorisPrices[pos.cgId];
  const price = priceInfo ? priceInfo.eur : null;
  const value = price !== null && price !== undefined ? pos.qty * price : null;
  const pnl = value !== null ? value - pos.invested : null;
  const pnlPct = value !== null && pos.invested ? (pnl / pos.invested) * 100 : null;
  const pnlClass = pnl === null ? "" : pnl >= 0 ? "positive" : "negative";
  const pnlSign = pnl === null ? "" : pnl >= 0 ? "+" : "-";

  const latest = latestVerdictFor(pos.cgId, latestPortfolioVerdicts);
  const adviceHtml = latest
    ? `<span class="badge badge-${latest.verdict.toLowerCase()}" title="${escapeHtml(latest.reasoning || "")}">${escapeHtml(latest.verdict)}</span>`
    : `<span class="hint">—</span>`;

  return {
    html: `<tr>
        <td>${escapeHtml(ticker)}<div class="hint">${escapeHtml(name)}</div></td>
        <td>${value !== null ? formatPrice(value, "EUR") : "—"}</td>
        <td>${formatPrice(pos.invested, "EUR")}</td>
        <td class="${pnlClass}">${pnl !== null ? pnlSign + formatPrice(Math.abs(pnl), "EUR") : "—"}</td>
        <td class="${pnlClass}">${pnlPct !== null ? formatChangePct(pnlPct) : "—"}</td>
        <td>${adviceHtml}</td>
      </tr>`,
    value: value || 0,
    invested: pos.invested,
    counted: value !== null,
  };
}

function renderPortfolioTotals(totalValue, totalInvested) {
  const el = document.getElementById("portfolio-totals");
  if (!el) return;
  const totalPnl = totalValue - totalInvested;
  const totalPnlPct = totalInvested ? (totalPnl / totalInvested) * 100 : null;
  const pnlClass = totalPnl >= 0 ? "positive" : "negative";
  const pnlSign = totalPnl >= 0 ? "+" : "-";
  el.innerHTML = `
    <div class="hero-stats">
      <div><div class="hero-stat-value">${formatPrice(totalValue, "EUR")}</div><div class="hero-stat-label">Valeur totale</div></div>
      <div><div class="hero-stat-value">${formatPrice(totalInvested, "EUR")}</div><div class="hero-stat-label">Investi</div></div>
      <div><div class="hero-stat-value ${pnlClass}">${pnlSign}${formatPrice(Math.abs(totalPnl), "EUR")}</div><div class="hero-stat-label">Latent</div></div>
      <div><div class="hero-stat-value ${pnlClass}">${totalPnlPct !== null ? formatChangePct(totalPnlPct) : "—"}</div><div class="hero-stat-label">Perf. globale</div></div>
    </div>`;
}

// portfolio/verdicts omis (appel sans argument) -> réutilise le dernier jeu déjà connu : c'est
// ce que fait refreshPrices() à chaque tick (60s) pour ne recalculer que valeur/P&L depuis le
// nouveau prix, sans avoir à repasser par loadAllData() qui re-fetch tout le reste du site.
function renderPortfolio(portfolio, verdicts) {
  if (portfolio !== undefined) latestPortfolio = portfolio;
  if (verdicts !== undefined) latestPortfolioVerdicts = verdicts || [];

  const el = document.getElementById("portfolio-body");
  if (!el) return;

  const positions = (latestPortfolio && latestPortfolio.positions) || [];
  if (positions.length === 0) {
    el.innerHTML = `<p class="empty-state">Portefeuille pas encore configuré (data/portfolio.json vide).</p>`;
    return;
  }

  let totalValue = 0;
  let totalInvested = 0;
  const rows = positions.map((pos) => {
    const r = renderPortfolioRow(pos);
    if (r.counted) {
      totalValue += r.value;
      totalInvested += r.invested;
    }
    return r.html;
  });

  el.innerHTML = `<table class="data-table portfolio-table">
      <thead><tr><th>Actif</th><th>Valeur</th><th>Investi</th><th>P&amp;L</th><th>P&amp;L %</th><th>Conseil</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;

  renderPortfolioTotals(totalValue, totalInvested);
}

// Calculette achat/vente — coût moyen pondéré (même méthode que "coût net moyen" affiché par
// l'app de suivi de l'utilisateur, voir CLAUDE.md). N'écrit JAMAIS data/portfolio.json : une
// vraie écriture publique demanderait sa propre protection dédiée (pas le portail cosmétique),
// donc ceci reste un calcul affiché à copier soi-même — décision explicite de l'utilisateur.
function computeTransactionResult(currentQty, currentInvested, type, price, qty) {
  const curQty = currentQty || 0;
  const curInvested = currentInvested || 0;
  if (!(price > 0) || !(qty > 0)) {
    return { error: "Indique un prix et une quantité strictement positifs." };
  }
  if (type === "achat") {
    return { newQty: curQty + qty, newInvested: curInvested + qty * price };
  }
  if (curQty <= 0) {
    return { error: "Aucune position actuelle pour cet actif — impossible de calculer une vente." };
  }
  if (qty > curQty) {
    return { error: `Tu ne peux pas vendre plus que ta position actuelle (${curQty}).` };
  }
  const costPerUnit = curInvested / curQty;
  return { newQty: curQty - qty, newInvested: curInvested - qty * costPerUnit };
}

function roundQty(n) {
  return Math.round(n * 1e8) / 1e8;
}
function roundEuro(n) {
  return Math.round(n * 100) / 100;
}

function renderTransactionCalculator() {
  const select = document.getElementById("tx-asset");
  const typeSelect = document.getElementById("tx-type");
  const priceInput = document.getElementById("tx-price");
  const qtyInput = document.getElementById("tx-qty");
  const btn = document.getElementById("tx-calc-btn");
  const resultEl = document.getElementById("tx-result");
  if (!select || !typeSelect || !priceInput || !qtyInput || !btn || !resultEl) return;

  select.innerHTML = FAVORIS.map((f) => `<option value="${f.cgId}">${escapeHtml(f.ticker)} — ${escapeHtml(f.name)}</option>`).join("");

  btn.addEventListener("click", () => {
    const cgId = select.value;
    const type = typeSelect.value;
    const price = parseFloat(priceInput.value);
    const qty = parseFloat(qtyInput.value);

    const positions = (latestPortfolio && latestPortfolio.positions) || [];
    const pos = positions.find((p) => p.cgId === cgId);
    const currentQty = pos && pos.qty !== null && pos.qty !== undefined ? pos.qty : 0;
    const currentInvested = pos && pos.invested !== null && pos.invested !== undefined ? pos.invested : 0;

    const result = computeTransactionResult(currentQty, currentInvested, type, price, qty);
    if (result.error) {
      resultEl.innerHTML = `<p class="hint" style="color:var(--loss)">${escapeHtml(result.error)}</p>`;
      return;
    }
    const fav = FAVORIS.find((f) => f.cgId === cgId);
    const ticker = fav ? fav.ticker : cgId;
    const newQty = roundQty(result.newQty);
    const newInvested = roundEuro(result.newInvested);
    resultEl.innerHTML = `
      <p class="hint">Actuel : ${currentQty} ${escapeHtml(ticker)} — ${formatPrice(currentInvested, "EUR")} investi</p>
      <p><strong>Nouveau : ${newQty} ${escapeHtml(ticker)} — ${formatPrice(newInvested, "EUR")} investi</strong></p>
      <p class="hint">À coller dans data/portfolio.json à la place de la ligne "${escapeHtml(cgId)}" :</p>
      <pre style="background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-dim); font-family:var(--font-mono); font-size:0.72rem; padding:10px 12px; white-space:pre-wrap; word-break:break-all;">{ "cgId": "${escapeHtml(cgId)}", "qty": ${newQty}, "invested": ${newInvested} }</pre>
    `;
  });
}
