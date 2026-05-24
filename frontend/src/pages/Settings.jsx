import { useState, useEffect } from 'react';
import { Save, RotateCcw, DollarSign, CheckCircle, Bot, Target } from 'lucide-react';
import api from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { InputField, Input, Select } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';

export default function Settings() {
  // Bot settings
  const [balance, setBalance] = useState(500);
  const [instrument, setInstrument] = useState('BTC');
  const [tradingMode, setTradingMode] = useState('paper');
  const [forceMarketOpen, setForceMarketOpen] = useState(false);

  // Strategy params (live-tunable, no restart needed)
  const [minConfidence, setMinConfidence] = useState(50);
  const [riskPct, setRiskPct] = useState(1.0);
  const [maxOpenTrades, setMaxOpenTrades] = useState(3);
  const [minSlopePct, setMinSlopePct] = useState(0.5);

  const [botState, setBotState] = useState({});
  const [runtime, setRuntime] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchSettings(); }, []);

  async function fetchSettings() {
    try {
      const [state, runtimeInfo, settingsState] = await Promise.all([
        api.getBotState(),
        api.getRuntime(),
        api.getSettings(),
      ]);

      if (state && Object.keys(state).length > 0) setBotState(state);
      if (runtimeInfo && Object.keys(runtimeInfo).length > 0) setRuntime(runtimeInfo);

      if (settingsState && Object.keys(settingsState).length > 0) {
        setBalance(settingsState.balance ?? 500);
        setInstrument(settingsState.instrument || 'BTC');
        setTradingMode((settingsState.trading_mode || 'paper').toLowerCase());
        setForceMarketOpen(Boolean(settingsState.force_market_open));
        setMinConfidence(settingsState.min_confidence_pct ?? 50);
        setRiskPct(settingsState.risk_per_trade_pct ?? 1.0);
        setMaxOpenTrades(settingsState.max_open_trades ?? 3);
        setMinSlopePct(settingsState.min_slope_pct ?? 0.5);
      }
    } catch (err) { console.error('Failed to fetch settings:', err); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateSettings({
        instrument,
        balance: Number(balance),
        trading_mode: tradingMode,
        force_market_open: forceMarketOpen,
        min_confidence_pct: Number(minConfidence),
        risk_per_trade_pct: Number(riskPct),
        max_open_trades: Number(maxOpenTrades),
        min_slope_pct: Number(minSlopePct),
      });
      await fetchSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error('Failed to save settings:', err); }
    finally { setSaving(false); }
  }

  function handleReset() {
    setInstrument('BTC');
    setBalance(500);
    setTradingMode('paper');
    setForceMarketOpen(false);
    setMinConfidence(50);
    setRiskPct(1.0);
    setMaxOpenTrades(3);
    setMinSlopePct(0.5);
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <Skeleton style={{ height: '40px', width: '260px' }} />
        <Skeleton style={{ height: '200px' }} />
        <Skeleton style={{ height: '200px' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Page Header */}
      <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.025em' }}>
            Settings
          </h1>
          <p style={{ fontSize: '14px', color: '#475569', marginTop: '6px' }}>
            Configure trading mode, instrument, balance, and live-tunable strategy parameters.
          </p>
        </div>
        <div className="animate-fade-in" style={{ display: 'flex', gap: '10px', animationDelay: '0.15s' }}>
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw style={{ width: '14px', height: '14px' }} />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saved ? (
              <><CheckCircle style={{ width: '14px', height: '14px' }} /> Saved</>
            ) : (
              <><Save style={{ width: '14px', height: '14px' }} /> Save Changes</>
            )}
          </Button>
        </div>
      </div>

      <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Trading Configuration */}
        <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <CardHeader>
            <div>
              <CardTitle icon={DollarSign} iconColor="#3b82f6">
                Trading Configuration
              </CardTitle>
              <CardDescription>Set your trading instrument and paper trading balance</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <InputField label="Trading Mode" hint="Paper mode is currently the supported execution mode" accentColor="#3b82f6">
                <Select value={tradingMode} onChange={e => setTradingMode(e.target.value)}>
                  <option value="paper">Paper</option>
                  <option value="live">Live (preview)</option>
                </Select>
              </InputField>

              <InputField label="Primary Instrument" hint="Used for chart display; bot scans all configured coins" accentColor="#3b82f6">
                <Select value={instrument} onChange={e => setInstrument(e.target.value)}>
                  <option value="BTC">Bitcoin (BTC)</option>
                  <option value="ETH">Ethereum (ETH)</option>
                  <option value="SOL">Solana (SOL)</option>
                  <option value="XRP">XRP</option>
                  <option value="BNB">BNB</option>
                  <option value="SUI">SUI</option>
                  <option value="TAO">TAO</option>
                  <option value="LINK">Chainlink (LINK)</option>
                  <option value="HYPE">HYPE</option>
                  <option value="ADA">Cardano (ADA)</option>
                </Select>
              </InputField>

              <InputField label="Paper Trading Balance ($)" hint="Current paper balance tracked by the bot" accentColor="#3b82f6">
                <Input
                  type="number"
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                />
              </InputField>

              <InputField label="Force Market Open" hint="Force the bot to trade regardless of market hours" accentColor="#f59e0b">
                <Select
                  value={forceMarketOpen ? 'true' : 'false'}
                  onChange={e => setForceMarketOpen(e.target.value === 'true')}
                >
                  <option value="false">Disabled</option>
                  <option value="true">Enabled</option>
                </Select>
              </InputField>
            </div>
          </CardContent>
        </Card>

        {/* Strategy Parameters */}
        <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.13s' }}>
          <CardHeader>
            <div>
              <CardTitle icon={Target} iconColor="#10b981">
                Strategy Parameters
              </CardTitle>
              <CardDescription>
                Live-tunable — changes take effect on the next scan cycle without restarting the bot
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <InputField
                label="Min Confidence (%)"
                hint="Signals below this threshold are rejected (default 50)"
                accentColor="#10b981"
              >
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={minConfidence}
                  onChange={e => setMinConfidence(e.target.value)}
                />
              </InputField>

              <InputField
                label="Risk per Trade (%)"
                hint="% of balance to risk on each trade (default 1.0)"
                accentColor="#10b981"
              >
                <Input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={riskPct}
                  onChange={e => setRiskPct(e.target.value)}
                />
              </InputField>

              <InputField
                label="Max Open Trades"
                hint="Maximum simultaneous open positions (default 3)"
                accentColor="#10b981"
              >
                <Input
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={maxOpenTrades}
                  onChange={e => setMaxOpenTrades(e.target.value)}
                />
              </InputField>

              <InputField
                label="Min 1h Slope (%)"
                hint="Minimum 1h trend slope to use 15m execution TF (default 0.5)"
                accentColor="#10b981"
              >
                <Input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={minSlopePct}
                  onChange={e => setMinSlopePct(e.target.value)}
                />
              </InputField>
            </div>

            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: 'rgba(16, 185, 129, 0.04)',
              border: '1px solid rgba(16, 185, 129, 0.12)',
              fontSize: '12px',
              color: '#64748b',
              lineHeight: 1.6,
            }}>
              <strong style={{ color: '#10b981' }}>Live reload:</strong> These values are written to the database and read by the scanner on every cycle.
              No bot restart required — the next scan will use the updated values.
            </div>
          </CardContent>
        </Card>

        {/* Bot Info */}
        <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.17s' }}>
          <CardHeader>
            <div>
              <CardTitle icon={Bot} iconColor="#a78bfa">
                Bot Information
              </CardTitle>
              <CardDescription>Live runtime state and heartbeat diagnostics</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
              <div>
                <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Bot Status</p>
                <Badge variant={botState.status === 'RUNNING' ? 'success' : botState.status === 'WAITING' ? 'warning' : 'secondary'} dot>
                  {botState.status || 'UNKNOWN'}
                </Badge>
              </div>

              <div>
                <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Bot Alive</p>
                <Badge variant={runtime.bot_alive ? 'success' : 'danger'} dot>
                  {runtime.bot_alive ? 'Alive' : 'Stale'}
                </Badge>
              </div>

              <div>
                <p style={{ fontSize: '11px', color: '#64748b' }}>Last Heartbeat</p>
                <p style={{ fontSize: '13px', color: '#e2e8f0', marginTop: '2px' }}>{runtime.last_heartbeat || '—'}</p>
              </div>

              <div>
                <p style={{ fontSize: '11px', color: '#64748b' }}>Heartbeat Age</p>
                <p style={{ fontSize: '13px', color: '#e2e8f0', marginTop: '2px' }}>
                  {runtime.heartbeat_age_sec != null ? `${runtime.heartbeat_age_sec}s` : '—'}
                </p>
              </div>

              <div>
                <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Market (Actual)</p>
                <Badge variant={runtime.market_actual_open ? 'success' : 'secondary'}>
                  {runtime.market_actual_open ? 'Open' : 'Closed'}
                </Badge>
              </div>

              <div>
                <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>Market (Bot Effective)</p>
                <Badge variant={runtime.market_effective_open ? 'success' : 'secondary'}>
                  {runtime.market_effective_open ? 'Open' : 'Closed'}
                </Badge>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '11px', color: '#64748b' }}>Market Note</p>
                <p style={{ fontSize: '13px', color: '#e2e8f0', marginTop: '2px' }}>{runtime.market_display || '—'}</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '11px', color: '#64748b' }}>Last Error</p>
                <p style={{ fontSize: '13px', color: botState.error_message ? '#f87171' : '#94a3b8', marginTop: '2px' }}>
                  {botState.error_message || 'None'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
