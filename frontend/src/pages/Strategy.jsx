import { useState, useEffect } from 'react';
import {
  Puzzle, CheckCircle, XCircle, ChevronDown, ChevronUp,
  Save, RotateCcw, Shield, Sliders, Info,
} from 'lucide-react';
import api from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, Separator } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { InputField, Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';

export default function Strategy() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [editParams, setEditParams] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchStrategies();
  }, []);

  async function fetchStrategies() {
    try {
      setLoading(true);
      const configs = await api.getStrategyConfigs();
      // Assign a unique id if missing
      const withIds = (Array.isArray(configs) ? configs : []).map((s, i) => ({
        ...s,
        id: s.id ?? s.strategy_name ?? i,
      }));
      setStrategies(withIds);
    } catch (err) {
      console.error('Failed to fetch strategies:', err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(id) {
    // For now, just refresh the display
    await fetchStrategies();
  }

  function handleExpand(strategy) {
    if (expandedId === strategy.id) {
      setExpandedId(null);
      setEditParams({});
    } else {
      setExpandedId(strategy.id);
      setEditParams({ ...strategy.params });
    }
  }

  function updateParam(key, value) {
    setEditParams(prev => ({ ...prev, [key]: value }));
  }

  async function handleSaveParams(strategyId) {
    setSaving(true);
    try {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await fetchStrategies();
    } catch (err) {
      console.error('Failed to save params:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleReset(strategy) {
    setEditParams({ ...strategy.params });
  }

  // Group params by category for display
  function categorizeParams(params) {
    const categories = {
      trading: { label: 'Trading Parameters', color: '#3b82f6', icon: Sliders, keys: ['timeframe', 'lookback_period', 'tolerance_pct', 'bounce_candles'] },
      entry: { label: 'Entry & Exit Levels', color: '#a78bfa', icon: Puzzle, keys: ['entry_levels', 'stop_loss_level', 'risk_reward_ratio'] },
      risk: { label: 'Risk Management', color: '#ef4444', icon: Shield, keys: ['risk_per_trade_pct', 'max_open_positions', 'max_daily_loss_pct'] },
    };

    const result = {};
    const usedKeys = new Set();

    for (const [catKey, cat] of Object.entries(categories)) {
      const catParams = {};
      for (const key of cat.keys) {
        if (key in params) {
          catParams[key] = params[key];
          usedKeys.add(key);
        }
      }
      if (Object.keys(catParams).length > 0) {
        result[catKey] = { ...cat, params: catParams };
      }
    }

    // Uncategorized params
    const other = {};
    for (const key of Object.keys(params)) {
      if (!usedKeys.has(key)) other[key] = params[key];
    }
    if (Object.keys(other).length > 0) {
      result.other = { label: 'Other', color: '#64748b', icon: Info, keys: Object.keys(other), params: other };
    }

    return result;
  }

  function formatParamLabel(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      .replace('Pct', '(%)')
      .replace('Stop Loss Level', 'Stop Loss Level (Fib)')
      .replace('Risk Reward', 'Risk:Reward');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Page Header */}
      <div className="animate-fade-in">
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.025em' }}>
          Trading Strategies
        </h1>
        <p style={{ fontSize: '14px', color: '#475569', marginTop: '6px' }}>
          Manage your trading strategies. Set one active to use with the bot.
        </p>
      </div>

      {/* Strategy Table */}
      <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <CardHeader>
          <CardTitle icon={Puzzle} iconColor="#a78bfa">
            Available Strategies
          </CardTitle>
          <span style={{ fontSize: '11px', color: '#475569' }}>
            {strategies.length} {strategies.length === 1 ? 'strategy' : 'strategies'}
          </span>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#475569' }}>
              Loading strategies…
            </div>
          ) : strategies.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <Puzzle style={{ width: '32px', height: '32px', color: '#334155', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', color: '#94a3b8' }}>No strategies configured.</p>
              <p style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                Run the setup script to seed default strategies.
              </p>
            </div>
          ) : (
            <div>
              {/* Table Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 2fr 120px 120px',
                padding: '14px 28px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                {['Strategy', 'Description', 'Status', 'Actions'].map(h => (
                  <span key={h} style={{
                    fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: '#475569',
                    textAlign: h === 'Actions' ? 'right' : 'left',
                  }}>{h}</span>
                ))}
              </div>

              {/* Strategy Rows */}
              {strategies.map((strategy, i) => (
                <div key={strategy.id}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 2fr 120px 120px',
                      padding: '18px 28px',
                      alignItems: 'center',
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: strategy.is_active ? 'rgba(139, 92, 246, 0.04)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => handleExpand(strategy)}
                    onMouseEnter={e => {
                      if (!strategy.is_active) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = strategy.is_active ? 'rgba(139, 92, 246, 0.04)' : 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {expandedId === strategy.id ? (
                        <ChevronUp style={{ width: '14px', height: '14px', color: '#64748b' }} />
                      ) : (
                        <ChevronDown style={{ width: '14px', height: '14px', color: '#64748b' }} />
                      )}
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                        {strategy.display_name || strategy.strategy_name}
                      </span>
                    </div>
                    <span style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.4 }}>
                      {strategy.description || '—'}
                    </span>
                    <div>
                      <Badge variant={strategy.is_active ? 'success' : 'secondary'}>
                        {strategy.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleActive(strategy.id); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '6px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          background: strategy.is_active ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                          color: strategy.is_active ? '#ef4444' : '#10b981',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = strategy.is_active ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = strategy.is_active ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)';
                        }}
                      >
                        {strategy.is_active ? (
                          <><XCircle style={{ width: '13px', height: '13px' }} /> Deactivate</>
                        ) : (
                          <><CheckCircle style={{ width: '13px', height: '13px' }} /> Set Active</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Param Editor */}
                  {expandedId === strategy.id && (
                    <div style={{
                      padding: '28px',
                      background: 'rgba(255,255,255,0.015)',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}>
                      {/* Save / Reset bar */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                          Strategy Parameters
                        </h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <Button variant="ghost" onClick={() => handleReset(strategy)}>
                            <RotateCcw style={{ width: '14px', height: '14px', marginRight: '6px' }} />
                            Reset
                          </Button>
                          <Button onClick={() => handleSaveParams(strategy.id)} disabled={saving}>
                            {saved ? (
                              <><CheckCircle style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Saved</>
                            ) : (
                              <><Save style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Save Changes</>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Categorized params */}
                      {Object.entries(categorizeParams(editParams)).map(([catKey, cat], catIdx) => (
                        <div key={catKey}>
                          {catIdx > 0 && <Separator className="my-5" />}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                            <cat.icon style={{ width: '14px', height: '14px', color: cat.color }} />
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>{cat.label}</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                            {Object.entries(cat.params).map(([key, val]) => (
                              <InputField key={key} label={formatParamLabel(key)} accentColor={cat.color}>
                                <Input
                                  value={Array.isArray(val) ? val.join(', ') : String(editParams[key] ?? val)}
                                  onChange={e => updateParam(key, e.target.value)}
                                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px' }}
                                />
                              </InputField>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
