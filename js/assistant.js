// Assistant : répond aux questions à partir des données déjà calculées par les routines
// (résumé, verdicts, opportunités, alertes, contexte marché) — aucun appel IA en direct,
// donc aucun coût ni configuration supplémentaire, mais les réponses ne couvrent que ce
// que le site a déjà analysé. Dit toujours clairement quand une question sort de ce cadre,
// plutôt que d'inventer une analyse qui n'existe pas.

let chatData = null;
let chatDataLoading = null;

async function ensureChatData() {
  if (window.aguilaradarData && window.aguilaradarData.verdicts !== undefined) {
    chatData = window.aguilaradarData;
    return chatData;
  }
  if (chatDataLoading) return chatDataLoading;
  chatDataLoading = Promise.all([
    loadJson(DATA_URLS.verdicts),
    loadJson(DATA_URLS.opportunities),
    loadJson(DATA_URLS.alerts),
    loadJson(DATA_URLS.news),
    loadJson(DATA_URLS.engineHistory),
    loadJson(DATA_URLS.marketContext),
    loadJson(DATA_URLS.digest),
  ]).then(([verdicts, opportunities, alerts, news, engineHistory, marketContext, digest]) => {
    chatData = { verdicts, opportunities, alerts, news, engineHistory, marketContext, digest };
    return chatData;
  });
  return chatDataLoading;
}

function findAssetMention(text) {
  const norm = text.toLowerCase();
  const fav = FAVORIS.find((f) => norm.includes(f.ticker.toLowerCase()) || norm.includes(f.name.toLowerCase()));
  if (fav) return { cgId: fav.cgId, ticker: fav.ticker, name: fav.name, tracked: "favori" };
  const opp = ((chatData.opportunities && chatData.opportunities.opportunities) || []).find(
    (o) => norm.includes(o.ticker.toLowerCase()) || norm.includes(o.name.toLowerCase())
  );
  if (opp) return { cgId: opp.cgId, ticker: opp.ticker, name: opp.name, tracked: "opportunite" };
  return null;
}

function answerAboutAsset(mention) {
  if (mention.tracked === "favori") {
    const verdict = (chatData.verdicts || [])
      .filter((v) => v.asset === mention.cgId)
      .sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
    if (!verdict) {
      return `${mention.name} (${mention.ticker}) fait partie des 15 favoris suivis, mais aucun verdict n'a encore été émis.`;
    }
    return `Sur ${mention.name} (${mention.ticker}), le dernier verdict est ${verdict.verdict} (confiance ${verdict.confidence_pct ?? "—"} %, horizon ${verdict.horizon_days} j, émis le ${new Date(verdict.issued_at).toLocaleDateString("fr-FR")}).\n\n${verdict.reasoning || ""}\n\nDétail complet dans l'onglet Favoris.`;
  }
  const opp = ((chatData.opportunities && chatData.opportunities.opportunities) || []).find((o) => o.cgId === mention.cgId);
  if (!opp) return `${mention.name} (${mention.ticker}) n'est pas suivi par le moteur pour l'instant — utilise la recherche de l'onglet Favoris pour un prix et une fiche d'identité en direct.`;
  return `${mention.name} (${mention.ticker}) fait partie des opportunités suivies (criblage Top 300) : ${opp.reason || "pas de détail disponible"}\n\nPrix actuel ${formatPrice(opp.price_eur, "EUR")}, ${formatChangePct(opp.change_7d_pct)} sur 7 jours. Détail complet dans l'onglet Opportunités.`;
}

function answerDigest() {
  const d = chatData.digest;
  if (!d || !d.generated_at) return "Le résumé périodique n'a pas encore été généré — reviens un peu plus tard.";
  const tips = (d.tips || []).map((t) => "• " + t).join("\n");
  return `${d.headline}\n\n${d.summary}${tips ? "\n\n" + tips : ""}\n\n(Résumé généré le ${new Date(d.generated_at).toLocaleString("fr-FR")}, ton du marché : ${d.market_tone}.)`;
}

function answerMarketWhy() {
  const regime = chatData.engineHistory && chatData.engineHistory.macro_regime;
  if (!regime || !regime.regime) return "Le régime de marché n'a pas encore été calculé — ça se fait au premier cycle profond.";
  const label = (typeof REGIME_LABELS !== "undefined" && REGIME_LABELS[regime.regime]) || regime.regime;
  const dominance = regime.btc_dominance_pct !== null && regime.btc_dominance_pct !== undefined ? regime.btc_dominance_pct.toFixed(1) + " %" : "—";
  let text = `Le régime de marché actuel est classé "${label}" (indice de peur et de cupidité ${regime.fear_greed_value ?? "—"}, dominance BTC ${dominance}).\n\n${regime.note || ""}`;
  const ctx = chatData.marketContext;
  if (ctx && ctx.employment_us && ctx.employment_us.market_reaction_note) {
    text += `\n\nContexte macro complémentaire : ${ctx.employment_us.market_reaction_note}`;
  }
  return text;
}

function answerOpportunities() {
  const items = ((chatData.opportunities && chatData.opportunities.opportunities) || [])
    .slice()
    .sort((a, b) => computeConfidence(b) - computeConfidence(a))
    .slice(0, 3);
  if (items.length === 0) return "Aucune opportunité détectée pour l'instant — le criblage Top 300 se fait à chaque cycle profond.";
  const lines = items.map((o) => `• ${o.ticker} (${o.name}) — confiance ${computeConfidence(o)} % : ${o.reason}`);
  return `Les opportunités les plus solides en ce moment :\n\n${lines.join("\n")}\n\nListe complète dans l'onglet Opportunités.`;
}

function answerAlerts() {
  const recent = (chatData.alerts || []).slice(-5).reverse();
  if (recent.length === 0) return "Aucune alerte enregistrée pour l'instant.";
  const lines = recent.map((a) => `• [${new Date(a.triggered_at).toLocaleDateString("fr-FR")}] ${a.ticker_ou_theme || ""} — ${a.message}`);
  return `Dernières alertes :\n\n${lines.join("\n\n")}\n\nHistorique complet dans l'onglet Alertes.`;
}

function answerEngine() {
  const stats = chatData.engineHistory && chatData.engineHistory.global_stats;
  if (!stats) return "Pas encore de statistiques du moteur disponibles.";
  if (stats.accuracy_strict_pct === null || stats.accuracy_strict_pct === undefined) {
    return `Le moteur a émis ${stats.total_verdicts_issued} verdict(s) au total, mais aucun n'a encore atteint son échéance — impossible de mesurer un vrai taux de réussite avant ça (rien n'est inventé entre-temps). Détail dans l'onglet Moteur.`;
  }
  return `Le moteur a émis ${stats.total_verdicts_issued} verdicts, dont ${stats.total_verdicts_resolved} vérifiés, avec une exactitude de ${stats.accuracy_strict_pct.toFixed(1)} %. Détail complet dans l'onglet Moteur.`;
}

const CHAT_INTENTS = [
  { keywords: ["résume", "resume", "résumé", "briefing", "synthèse", "synthese"], handler: answerDigest },
  { keywords: ["opportunité", "opportunites", "opportunités", "pépite", "pepite"], handler: answerOpportunities },
  { keywords: ["alerte", "actualité", "actualites", "actualités", "news", "quoi de neuf"], handler: answerAlerts },
  { keywords: ["performance", "taux de réussite", "taux de reussite", "précision", "precision", "moteur", "backtest", "fiable"], handler: answerEngine },
  { keywords: ["pourquoi", "hausse", "baisse", "monte", "descend", "chute", "analyse du marché", "analyse le marché", "état du marché", "etat du marche", "régime", "regime"], handler: answerMarketWhy },
];

async function answerQuestion(question) {
  await ensureChatData();
  const norm = question.toLowerCase();

  const mention = findAssetMention(question);
  if (mention) return answerAboutAsset(mention);

  const intent = CHAT_INTENTS.find((i) => i.keywords.some((k) => norm.includes(k)));
  if (intent) return intent.handler();

  return `Je réponds à partir de ce que le radar a déjà analysé : le résumé du moment, un actif suivi (favori ou opportunité), les meilleures opportunités, les dernières alertes, ou la performance du moteur.\n\nEssaie par exemple : "résume-moi la semaine", "pourquoi le marché est neutre", ou "que penses-tu de Chainlink".`;
}

function appendChatMessage(role, text) {
  const log = document.getElementById("chat-log");
  if (!log) return null;
  const el = document.createElement("div");
  el.className = `chat-msg chat-msg--${role}`;
  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

const CHAT_SUGGESTIONS = [
  "Résume-moi la semaine",
  "Pourquoi le marché est-il neutre en ce moment ?",
  "Quelles sont les meilleures opportunités ?",
  "Que penses-tu de Bitcoin ?",
  "Quelles sont les dernières alertes ?",
];

function renderChatSuggestions() {
  const el = document.getElementById("chat-suggestions");
  if (!el) return;
  el.innerHTML = CHAT_SUGGESTIONS.map((s) => `<button type="button" class="chat-suggestion-chip">${escapeHtml(s)}</button>`).join("");
  el.querySelectorAll(".chat-suggestion-chip").forEach((btn) => {
    btn.addEventListener("click", () => submitChatQuestion(btn.textContent));
  });
}

let chatBusy = false;
async function submitChatQuestion(question) {
  if (!question || !question.trim() || chatBusy) return;
  chatBusy = true;
  appendChatMessage("user", question);
  const input = document.getElementById("chat-input");
  if (input) input.value = "";
  const typingEl = appendChatMessage("assistant", "…");
  if (typingEl) typingEl.classList.add("chat-msg--typing");
  try {
    const answer = await answerQuestion(question);
    if (typingEl) typingEl.remove();
    appendChatMessage("assistant", answer);
  } catch (err) {
    console.error("Erreur assistant :", err);
    if (typingEl) typingEl.remove();
    appendChatMessage("assistant", "Une erreur empêche de répondre pour l'instant — réessaie dans un instant.");
  } finally {
    chatBusy = false;
  }
}

let assistantInitDone = false;
function initAssistant() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  if (!form || assistantInitDone) return;
  assistantInitDone = true;
  renderChatSuggestions();
  appendChatMessage(
    "assistant",
    "Salut ! Je réponds à partir des dernières analyses calculées par le radar (mises à jour toutes les 2h) — pose une question sur le marché, un actif suivi, les opportunités ou les dernières alertes."
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitChatQuestion(input.value);
  });
}
