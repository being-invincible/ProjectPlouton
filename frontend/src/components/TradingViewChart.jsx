import { useEffect, useRef } from 'react';

// Maps our timeframe buttons to TradingView interval codes
const TV_INTERVAL = { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };

// The bot trades Hyperliquid perps; Binance USDT-perps track them within a few
// bps and are always available on TradingView. allow_symbol_change lets the user
// switch to a Hyperliquid feed manually if they prefer an exact match.
const SYMBOL_OVERRIDES = {
  // e.g. HYPE isn't a Binance perp — fall back to a venue that lists it
  HYPE: 'BYBIT:HYPEUSDT.P',
};

function tvSymbol(coin) {
  return SYMBOL_OVERRIDES[coin] || `BINANCE:${coin}USDT.P`;
}

export default function TradingViewChart({ coin = 'BTC', timeframe = '4h', height = 620 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    container.appendChild(widget);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    // Explicit width/height (not autosize) — autosize collapses when the parent
    // height can't be measured, which squished the chart to a thin strip.
    script.innerHTML = JSON.stringify({
      width: '100%',
      height: height,
      symbol: tvSymbol(coin),
      interval: TV_INTERVAL[timeframe] || '240',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      backgroundColor: 'rgba(15, 23, 42, 0)',
      gridColor: 'rgba(255, 255, 255, 0.04)',
      // RSI(14) pane below the price chart — matches the SMC strategy's RSI gate.
      studies: ['RSI@tv-basicstudies'],
      support_host: 'https://www.tradingview.com',
    });
    container.appendChild(script);

    return () => { container.innerHTML = ''; };
  }, [coin, timeframe, height]);

  return (
    <div
      className="tradingview-widget-container"
      ref={containerRef}
      style={{ height, width: '100%' }}
    />
  );
}
