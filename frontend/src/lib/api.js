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

  /** Health check */
  async health() {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },

  tradeChartUrl(id, type = 'final') {
    return `${API_BASE}/trades/${id}/chart?type=${type}`;
  },
};

export default api;
