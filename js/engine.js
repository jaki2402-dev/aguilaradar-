// Onglet "Performance du moteur" — matrice de confusion et métriques calculées EN DIRECT
// à partir des verdicts bruts (jamais une valeur juste affirmée dans un JSON opaque).
// Seule la comparaison "buy & hold BTC" vient d'engine-history.json (calculée par le
// cycle profond, qui a accès à l'historique de prix nécessaire).

const CLASSES = ["ACHAT", "ATTENTE", "VENTE"];

function classifyActualMove(pctChange, thresholdPct) {
  if (pctChange === null || pctChange === undefined) return null;
  if (pctChange > thresholdPct) return "ACHAT";
  if (pctChange < -thresholdPct) return "VENTE";
  return "ATTENTE";
}

function computeConfusionMatrix(resolvedVerdicts) {
  const matrix = {};
  CLASSES.forEach((p) => {
    matrix[p] = {};
    CLASSES.forEach((a) => (matrix[p][a] = 0));
  });
  resolvedVerdicts.forEach((v) => {
    const predicted = v.verdict;
    const actual = v.outcome && v.outcome.actual_direction;
    if (CLASSES.includes(predicted) && CLASSES.includes(actual)) {
      matrix[predicted][actual] += 1;
    }
  });
  return matrix;
}

function computeClassMetrics(matrix) {
  const metrics = {};
  CLASSES.forEach((c) => {
    const truePos = matrix[c][c];
    const predictedTotal = CLASSES.reduce((sum, a) => sum + matrix[c][a], 0);
    const actualTotal = CLASSES.reduce((sum, p) => sum + matrix[p][c], 0);
    const precision = predictedTotal > 0 ? truePos / predictedTotal : null;
    const recall = actualTotal > 0 ? truePos / actualTotal : null;
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    metrics[c] = { precision, recall, f1, predictedTotal, actualTotal };
  });
  return metrics;
}

function computeEngineStats(resolvedVerdicts) {
  if (resolvedVerdicts.length === 0) return null;

  const matrix = computeConfusionMatrix(resolvedVerdicts);
  const perClass = computeClassMetrics(matrix);

  const total = resolvedVerdicts.length;
  const correct = CLASSES.reduce((sum, c) => sum + matrix[c][c], 0);
  const accuracyPct = (correct / total) * 100;

  const nonAttenteCalls = resolvedVerdicts.filter((v) => v.verdict !== "ATTENTE").length;
  const coveragePct = (nonAttenteCalls / total) * 100;

  const actualCounts = { ACHAT: 0, ATTENTE: 0, VENTE: 0 };
  resolvedVerdicts.forEach((v) => {
    const actual = v.outcome && v.outcome.actual_direction;
    if (actual in actualCounts) actualCounts[actual] += 1;
  });
  const majorityClassCount = Math.max(...Object.values(actualCounts));
  const baselineMajorityPct = (majorityClassCount / total) * 100;

  const f1Values = CLASSES.map((c) => perClass[c].f1).filter((v) => v !== null);
  const f1Macro = f1Values.length ? (f1Values.reduce((a, b) => a + b, 0) / f1Values.length) * 100 : null;

  return { matrix, perClass, total, correct, accuracyPct, coveragePct, baselineMajorityPct, f1Macro };
}

const CALIBRATION_BUCKETS = [
  { label: "40-50 %", min: 40, max: 50 },
  { label: "50-60 %", min: 50, max: 60 },
  { label: "60-70 %", min: 60, max: 70 },
  { label: "70-80 %", min: 70, max: 80 },
  { label: "80-100 %", min: 80, max: 101 },
];

function computeCalibrationBuckets(resolvedVerdicts) {
  return CALIBRATION_BUCKETS.map((b) => {
    const inBucket = resolvedVerdicts.filter((v) => v.confidence_pct >= b.min && v.confidence_pct < b.max);
    if (inBucket.length === 0) return null;
    const correct = inBucket.filter((v) => v.outcome && v.outcome.verdict_correct).length;
    return { label: b.label, count: inBucket.length, correct, accuracyPct: (correct / inBucket.length) * 100 };
  }).filter(Boolean);
}

function renderCalibrationByBucket(resolved) {
  const el = document.getElementById("engine-calibration");
  if (!el) return;
  const buckets = computeCalibrationBuckets(resolved);
  if (buckets.length === 0) {
    el.innerHTML = `<p class="empty-state">Pas encore assez de verdicts vérifiés pour évaluer la calibration — se remplit dès que plusieurs verdicts auront atteint leur horizon, aucun chiffre inventé avant ça.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="classes-table">
      <thead><tr><th>Confiance annoncée</th><th>Verdicts</th><th>Corrects</th><th>Exactitude réelle</th></tr></thead>
      <tbody>
        ${buckets
          .map(
            (b) => `<tr><td>${b.label}</td><td>${b.count}</td><td>${b.correct}</td><td>${b.accuracyPct.toFixed(0)} %</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p class="hint">Une tranche bien calibrée affiche une exactitude réelle proche de la confiance annoncée. Si "70-80 %" n'est correct que 30% du temps, la confiance est surestimée pour ces cas — un signal pour ajuster, pas juste une statistique.</p>`;
}

function computeAccuracyByRegime(resolvedVerdicts) {
  const byRegime = {};
  resolvedVerdicts.forEach((v) => {
    const regime = v.regime_at_issue;
    if (!regime) return;
    if (!byRegime[regime]) byRegime[regime] = [];
    byRegime[regime].push(v);
  });
  const trackedCount = Object.values(byRegime).reduce((sum, list) => sum + list.length, 0);
  const withoutRegime = resolvedVerdicts.length - trackedCount;
  const rows = Object.entries(byRegime).map(([regime, list]) => {
    const correct = list.filter((v) => v.outcome && v.outcome.verdict_correct).length;
    return { regime, count: list.length, correct, accuracyPct: (correct / list.length) * 100 };
  });
  return { rows, withoutRegime };
}

function renderAccuracyByRegime(resolved) {
  const el = document.getElementById("engine-regime-accuracy");
  if (!el) return;
  const { rows, withoutRegime } = computeAccuracyByRegime(resolved);
  if (rows.length === 0) {
    el.innerHTML = `<p class="empty-state">Pas encore de verdict vérifié avec un régime enregistré à l'émission — ce suivi a démarré le 11/08, se remplit avec les nouveaux verdicts au fil du temps.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="classes-table">
      <thead><tr><th>Régime à l'émission</th><th>Verdicts</th><th>Exactitude</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr><td>${(typeof REGIME_LABELS !== "undefined" && REGIME_LABELS[r.regime]) || r.regime}</td><td>${r.count}</td><td>${r.accuracyPct.toFixed(0)} %</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
    ${withoutRegime > 0 ? `<p class="hint">${withoutRegime} verdict(s) vérifié(s) sans régime enregistré (émis avant le 11/08) — exclu(s) de ce tableau, jamais estimé rétroactivement.</p>` : ""}`;
}

function computeOpportunitiesStats(opportunities) {
  const resolved = (opportunities || []).filter((o) => o.status === "resolved");
  if (resolved.length === 0) return null;
  const validatedCount = resolved.filter((o) => o.outcome && o.outcome.validated).length;
  const moves = resolved.map((o) => o.outcome.move_pct).filter((m) => m !== null && m !== undefined);
  const avgMove = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null;
  return {
    total: resolved.length,
    validatedPct: (validatedCount / resolved.length) * 100,
    avgMovePct: avgMove,
  };
}

function renderOpportunitiesEngineSection(opportunitiesData) {
  const el = document.getElementById("engine-opportunities");
  if (!el) return;
  const items = (opportunitiesData && opportunitiesData.opportunities) || [];
  const pending = items.filter((o) => o.status === "pending").length;
  const stats = computeOpportunitiesStats(items);

  let html = `<p>${items.length} opportunité(s) signalée(s) au total — ${items.length - pending} vérifiée(s), ${pending} en attente de leur échéance.</p>`;

  if (!stats) {
    html += `<p class="empty-state">Aucune opportunité vérifiée pour l'instant — chaque pépite signalée est revérifiée 14 jours après (seuil ±${THRESHOLDS.directionalMovePct} %), aucun taux de réussite avant ça.</p>`;
  } else {
    html += `
      <div class="stat-row">
        <div class="stat-card accent-gold"><div class="stat-label">Taux de validation</div><div class="stat-value">${stats.validatedPct.toFixed(0)} %</div></div>
        <div class="stat-card accent-teal"><div class="stat-label">Mouvement moyen</div><div class="stat-value">${stats.avgMovePct !== null ? (stats.avgMovePct >= 0 ? "+" : "") + stats.avgMovePct.toFixed(1) + " %" : "—"}</div></div>
      </div>
      <p class="hint">Une opportunité est "validée" si son prix a progressé de plus de ${THRESHOLDS.directionalMovePct} % dans les 14 jours suivant le signalement — même seuil que partout ailleurs sur le site.</p>`;
  }
  el.innerHTML = html;
}

function renderControlGroupComparison(opportunitiesData, controlGroup) {
  const el = document.getElementById("engine-control-group");
  if (!el) return;
  const oppStats = computeOpportunitiesStats((opportunitiesData && opportunitiesData.opportunities) || []);
  const cgStats = controlGroup && controlGroup.stats;
  const cgItems = (controlGroup && controlGroup.items) || [];

  if (!oppStats || !cgStats || cgStats.validated_pct === null || cgStats.validated_pct === undefined) {
    if (cgItems.length > 0) {
      const pending = cgItems.filter((i) => i.status === "pending");
      const nextResolveDate = pending
        .map((i) => i.resolves_at)
        .filter(Boolean)
        .sort()[0];
      el.innerHTML = `<p class="empty-state">${cgItems.length} actif(s) échantillonné(s) au hasard pour le groupe témoin${
        pending.length ? `, ${pending.length} en attente de leur échéance` : ""
      }${
        nextResolveDate ? ` (premier résultat le ${new Date(nextResolveDate).toLocaleDateString("fr-FR")})` : ""
      } — la comparaison chiffrée s'affichera dès la première résolution, jamais un pourcentage inventé avant ça.</p>`;
    } else {
      el.innerHTML = `<p class="empty-state">Pas encore assez de données pour comparer le criblage à un échantillon aléatoire — se remplit avec le temps, des deux côtés à la fois.</p>`;
    }
    return;
  }
  const edge = oppStats.validatedPct - cgStats.validated_pct;
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-teal"><div class="stat-label">Mes pépites (validées)</div><div class="stat-value">${oppStats.validatedPct.toFixed(0)} %</div></div>
      <div class="stat-card accent-gray"><div class="stat-label">Échantillon aléatoire</div><div class="stat-value">${cgStats.validated_pct.toFixed(0)} %</div></div>
      <div class="stat-card ${edge >= 0 ? "accent-teal" : "accent-gray"}"><div class="stat-label">Écart réel</div><div class="stat-value ${edge >= 0 ? "positive" : "negative"}">${edge >= 0 ? "+" : ""}${edge.toFixed(0)} pts</div></div>
    </div>
    <p class="hint">${escapeHtml(cgStats.note)}</p>`;
}

// Bandeau fixe (piste "priorité") : les 3 chiffres qui comptent le plus, visibles sans
// défiler ni ouvrir un panneau — le détail complet reste dans l'accordéon en dessous.
function renderEnginePin(stats) {
  const el = document.getElementById("engine-pin");
  if (!el) return;
  if (!stats) {
    el.innerHTML = `
      <div class="pin-card"><span class="pin-val">—</span><span class="pin-label">Exactitude</span></div>
      <div class="pin-card"><span class="pin-val">—</span><span class="pin-label">Couverture</span></div>
      <div class="pin-card"><span class="pin-val">—</span><span class="pin-label">Vs référence</span></div>`;
    return;
  }
  const edge = stats.accuracyPct - stats.baselineMajorityPct;
  el.innerHTML = `
    <div class="pin-card"><span class="pin-val">${stats.accuracyPct.toFixed(0)} %</span><span class="pin-label">Exactitude</span></div>
    <div class="pin-card"><span class="pin-val">${stats.coveragePct.toFixed(0)} %</span><span class="pin-label">Couverture</span></div>
    <div class="pin-card"><span class="pin-val ${edge >= 0 ? "positive" : "negative"}">${edge >= 0 ? "+" : ""}${edge.toFixed(0)} pts</span><span class="pin-label">Vs référence</span></div>`;
}

function renderEngineTab(verdicts, engineHistory, opportunitiesData, controlGroup) {
  const resolved = verdicts.filter((v) => v.status === "resolved");
  const pending = verdicts.filter((v) => v.status === "pending");
  const stats = computeEngineStats(resolved);
  renderEnginePin(stats);

  const summaryEl = document.getElementById("engine-summary");
  const matrixEl = document.getElementById("engine-matrix");
  const classesEl = document.getElementById("engine-classes");
  const logEl = document.getElementById("engine-log");

  summaryEl.innerHTML = `<p>${verdicts.length} verdict(s) émis au total — ${resolved.length} vérifié(s), ${pending.length} en attente de leur horizon.</p>`;

  if (!stats) {
    matrixEl.innerHTML = `<p class="empty-state">Aucun verdict vérifié pour l'instant. La matrice de confusion et les scores d'exactitude apparaîtront dès que les premiers verdicts auront atteint leur horizon annoncé — aucun chiffre n'est inventé avant ça.</p>`;
    classesEl.innerHTML = "";
  } else {
    const buyHoldBtc = engineHistory && engineHistory.global_stats && engineHistory.global_stats.baseline_buy_hold_btc_pct;
    const edge = stats.accuracyPct - stats.baselineMajorityPct;
    const selfAssessment =
      edge > 15
        ? `Le moteur bat nettement la référence (${edge.toFixed(0)} points d'avance) — avantage réel sur cet échantillon, à confirmer dans la durée.`
        : edge > 3
        ? `Le moteur bat la référence de ${edge.toFixed(0)} points — un avantage réel mais modeste, qui se joue sur la répétition, jamais sur un seul verdict.`
        : edge > -3
        ? `Le moteur ne fait pas mieux qu'une supposition naïve pour l'instant (écart de ${edge.toFixed(0)} points). Ses verdicts ne doivent pas être suivis mécaniquement tant que ça reste vrai.`
        : `Le moteur fait actuellement moins bien que le hasard (${edge.toFixed(0)} points) — un vrai problème que la correction automatique doit adresser en priorité, pas un détail.`;
    matrixEl.innerHTML = `
      <div class="detail-opinion" style="margin-bottom:16px;">
        <strong>Verdict du moteur sur lui-même</strong>
        <p>${selfAssessment}</p>
      </div>
      <div class="stat-row">
        <div class="stat-card accent-teal"><div class="stat-label">Exactitude stricte</div><div class="stat-value">${stats.accuracyPct.toFixed(0)} %</div></div>
        <div class="stat-card accent-gray"><div class="stat-label">Baseline "classe majoritaire"</div><div class="stat-value">${stats.baselineMajorityPct.toFixed(0)} %</div></div>
        <div class="stat-card accent-gold"><div class="stat-label">Baseline buy&amp;hold BTC</div><div class="stat-value">${buyHoldBtc !== undefined && buyHoldBtc !== null ? buyHoldBtc.toFixed(0) + " %" : "—"}</div></div>
        <div class="stat-card accent-indigo"><div class="stat-label">Taux de couverture</div><div class="stat-value">${stats.coveragePct.toFixed(0)} %</div></div>
        <div class="stat-card accent-violet"><div class="stat-label">F1 macro</div><div class="stat-value">${stats.f1Macro !== null ? stats.f1Macro.toFixed(0) : "—"}</div></div>
      </div>
      <p class="hint">Couverture = part des verdicts où le moteur a vraiment tranché (Achat/Vente) plutôt que de s'abriter derrière Attente. Seuil de mouvement directionnel : calibré par actif selon sa volatilité réelle depuis fin août (avant cette date, ±${THRESHOLDS.directionalMovePct} % fixe a été utilisé pour tous — chaque verdict affiche le seuil qui a réellement servi à le juger, jamais rétroactif).</p>
      <table class="matrix-table">
        <thead><tr><th>Prédit \\ Réel</th>${CLASSES.map((c) => `<th>${c}</th>`).join("")}<th>Total</th></tr></thead>
        <tbody>
          ${CLASSES.map((p) => {
            const rowTotal = CLASSES.reduce((sum, a) => sum + stats.matrix[p][a], 0);
            return `<tr><th>${p}</th>${CLASSES.map((a) => {
              const n = stats.matrix[p][a];
              const pct = rowTotal > 0 ? Math.round((n / rowTotal) * 100) : 0;
              const cls = p === a ? "cell-correct" : "cell-wrong";
              return `<td class="${cls}">${n} <span class="cell-pct">${pct}%</span></td>`;
            }).join("")}<td>${rowTotal}</td></tr>`;
          }).join("")}
        </tbody>
      </table>`;

    classesEl.innerHTML = `
      <table class="classes-table">
        <thead><tr><th>Classe</th><th>Précision</th><th>Rappel</th><th>F1</th><th>Cas réels</th><th>Prédits</th></tr></thead>
        <tbody>
          ${CLASSES.map((c) => {
            const m = stats.perClass[c];
            return `<tr>
              <td>${c}</td>
              <td>${m.precision !== null ? (m.precision * 100).toFixed(0) + " %" : "—"}</td>
              <td>${m.recall !== null ? (m.recall * 100).toFixed(0) + " %" : "—"}</td>
              <td>${m.f1 !== null ? (m.f1 * 100).toFixed(0) : "—"}</td>
              <td>${m.actualTotal}</td>
              <td>${m.predictedTotal}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <p class="hint">Précision = fiabilité d'un verdict quand il est émis. Rappel = capacité à ne pas rater les vrais mouvements. F1 = équilibre entre les deux (0 à 100).</p>`;
  }

  const log = (engineHistory && engineHistory.correction_log) || [];
  if (log.length === 0) {
    logEl.innerHTML = `<p class="empty-state">Aucune correction tentée pour l'instant — le moteur a besoin de plusieurs verdicts vérifiés avant sa première auto-évaluation.</p>`;
  } else {
    logEl.innerHTML = log
      .slice()
      .reverse()
      .map(
        (entry) => `
        <div class="log-entry">
          <div class="log-header">
            <span>${escapeHtml(entry.version)} · ${escapeHtml(entry.attempted_at)}</span>
            <span class="badge ${entry.status === "appliquée" ? "badge-success" : "badge-neutral"}">${escapeHtml(entry.status)}</span>
          </div>
          <p>${escapeHtml(entry.change_description)}</p>
          <p class="hint">${escapeHtml(entry.note || "")}</p>
        </div>`
      )
      .join("");
  }

  renderCalibrationByBucket(resolved);
  renderAccuracyByRegime(resolved);
  renderOpportunitiesEngineSection(opportunitiesData);
  renderPaperPortfolio(engineHistory && engineHistory.paper_portfolio_stats);
  renderControlGroupComparison(opportunitiesData, controlGroup);
}

function renderPaperPortfolio(stats) {
  const el = document.getElementById("engine-paper-portfolio");
  if (!el) return;
  if (!stats || stats.cumulative_return_pct === null || stats.cumulative_return_pct === undefined) {
    const need = stats ? stats.min_resolved_required : 10;
    el.innerHTML = `<p class="empty-state">Pas encore assez de verdicts résolus pour simuler un portefeuille fictif (minimum ${need}) — se remplit avec le temps, jamais un chiffre inventé avant ça.</p>`;
    return;
  }
  const edge = stats.edge_pct;
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-card accent-teal"><div class="stat-label">Portefeuille fictif (suit mes verdicts)</div><div class="stat-value">${stats.cumulative_return_pct >= 0 ? "+" : ""}${stats.cumulative_return_pct.toFixed(1)} %</div></div>
      <div class="stat-card accent-gold"><div class="stat-label">Juste garder du BTC</div><div class="stat-value">${stats.btc_buy_hold_return_pct >= 0 ? "+" : ""}${stats.btc_buy_hold_return_pct.toFixed(1)} %</div></div>
      <div class="stat-card ${edge >= 0 ? "accent-teal" : "accent-gray"}"><div class="stat-label">Écart</div><div class="stat-value ${edge >= 0 ? "positive" : "negative"}">${edge >= 0 ? "+" : ""}${edge.toFixed(1)} pts</div></div>
    </div>
    <p class="hint">${escapeHtml(stats.method)}</p>`;
}
