/**
 * DuckDB API client for the React dashboard.
 * Replaces PocketBase SDK — fetches data from FastAPI server.
 */

const API_BASE = 'http://127.0.0.1:8090/api';

const api = {
  /** Fetch bot state */
  async getBotState() {
    const res = await fetch(`${API_BASE}/bot_state`);
    return res.json();
  },

  /** Fetch runtime diagnostics (alive heartbeat, effective market state) */
  async getRuntime() {
    const res = await fetch(`${API_BASE}/runtime`);
    return res.json();
  },

  /** Fetch settings state */
  async getSettings() {
    const res = await fetch(`${API_BASE}/settings`);
    return res.json();
  },

  /** Persist settings */
  async updateSettings(payload) {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  /** Fetch trades */
  async getTrades(limit = 50, status = null, sort = '-timestamp') {
    const params = new URLSearchParams({ limit, sort });
    if (status) params.set('status', status);
    const res = await fetch(`${API_BASE}/trades?${params}`);
    return res.json();
  },

  /** Fetch a single trade */
  async getTrade(id) {
    const res = await fetch(`${API_BASE}/trades/${id}`);
    if (!res.ok) return null;
    return res.json();
  },

  /** Fetch lifecycle events for a trade */
  async getTradeEvents(tradeId) {
    const res = await fetch(`${API_BASE}/trades/${tradeId}/events`);
    if (!res.ok) return [];
    return res.json();
  },

  /** Fetch candles for a given timeframe */
  async getCandles(instrument = 'BTC', timeframe = '5m', limit = 500) {
    const params = new URLSearchParams({ instrument, timeframe, limit });
    const res = await fetch(`${API_BASE}/candles?${params}`);
    return res.json();
  },

  /** Fetch signals */
  async getSignals(limit = 50) {
    const res = await fetch(`${API_BASE}/signals?limit=${limit}`);
    return res.json();
  },

  /** Fetch strategy configs */
  async getStrategyConfigs() {
    const res = await fetch(`${API_BASE}/strategy_configs`);
    return res.json();
  },

  /** Fetch active strategy */
  async getActiveStrategy() {
    const res = await fetch(`${API_BASE}/strategy_configs/active`);
    return res.json();
  },

  /** Fetch MTF trend analysis */
  async getMtfTrend(instrument = 'BTC') {
    const res = await fetch(`${API_BASE}/mtf_trend?instrument=${instrument}`);
    return res.json();
  },

  /** Fetch dashboard stats */
  async getStats() {
    const res = await fetch(`${API_BASE}/stats`);
    return res.json();
  },

  /** Per-coin monitoring status */
  async getMonitor() {
    const res = await fetch(`${API_BASE}/monitor`);
    return res.json();
  },

  /** Live tick price from the Hyperliquid WebSocket buffer */
  async getLivePrice(instrument = 'BTC') {
    const res = await fetch(`${API_BASE}/live_price?instrument=${instrument}`);
    return res.json();
  },

  /** ZigZag pivots for an instrument/timeframe (ATR-drawdown rule) */
  async getZigZag(instrument = 'BTC', timeframe = '5m', { periods = 500, atrPeriod = 14, atrMult = 2.0 } = {}) {
    const params = new URLSearchParams({ instrument, timeframe, periods, atr_period: atrPeriod, atr_mult: atrMult });
    const res = await fetch(`${API_BASE}/zigzag?${params}`);
    return res.json();
  },

  /** Fair Value Gaps for an instrument/timeframe */
  async getFvg(instrument = 'BTC', timeframe = '5m', { periods = 500, minSizeAtr = 0.25, unfilledOnly = false } = {}) {
    const params = new URLSearchParams({ instrument, timeframe, periods, min_size_atr: minSizeAtr, unfilled_only: unfilledOnly });
    const res = await fetch(`${API_BASE}/fvg?${params}`);
    return res.json();
  },

  /** Market-structure events (BOS / CHoCH) from confirmed ZigZag pivots */
  async getStructure(instrument = 'BTC', timeframe = '5m', { periods = 500, atrMult = 2.0 } = {}) {
    const params = new URLSearchParams({ instrument, timeframe, periods, atr_mult: atrMult });
    const res = await fetch(`${API_BASE}/structure?${params}`);
    return res.json();
  },

  /** RSI(14) + overbought/oversold zone ranges */
  async getRsiCloud(instrument = 'BTC', timeframe = '5m', { periods = 500, rsiPeriod = 14, upper = 70, lower = 30 } = {}) {
    const params = new URLSearchParams({ instrument, timeframe, periods, rsi_period: rsiPeriod, upper, lower });
    const res = await fetch(`${API_BASE}/rsi_cloud?${params}`);
    return res.json();
  },

  /** 5-wave Fibonacci extension setup */
  async getFibExtensions(instrument = 'BTC', timeframe = '5m', { periods = 500, atrMult = 2.0 } = {}) {
    const params = new URLSearchParams({ instrument, timeframe, periods, atr_mult: atrMult });
    const res = await fetch(`${API_BASE}/fib_extensions?${params}`);
    return res.json();
  },

  /** Health check */
  async health() {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },

  /** Start the bot subprocess */
  async startBot() {
    const res = await fetch(`${API_BASE}/bot/start`, { method: 'POST' });
    return res.json();
  },

  /** Stop the bot subprocess */
  async stopBot() {
    const res = await fetch(`${API_BASE}/bot/stop`, { method: 'POST' });
    return res.json();
  },

  tradeChartUrl(id, type = 'final') {
    return `${API_BASE}/trades/${id}/chart?type=${type}`;
  },
};

export default api;
