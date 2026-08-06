// Graphiques chandelier — widget officiel gratuit TradingView (aucune clé requise).

function mountTradingViewChart(containerId, symbol) {
  if (!window.TradingView) return;
  new TradingView.widget({
    autosize: true,
    symbol,
    interval: "D",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "fr",
    toolbar_bg: "#141C28",
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_legend: false,
    save_image: false,
    container_id: containerId,
  });
}
