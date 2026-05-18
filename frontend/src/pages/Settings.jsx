import { useState, useEffect } from 'react';
import { Save, RotateCcw, DollarSign, CheckCircle, Info, Coins, Bot, Activity } from 'lucide-react';
import api from '../lib/api';
import HelpTooltip from '../components/HelpTooltip';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { InputField, Input, Select } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';

export default function Settings() {
  const [balance, setBalance] = useState(500);
  const [instrument, setInstrument] = useState('BTC');
  const [tradingMode, setTradingMode] = useState('paper');
  const [forceMarketOpen, setForceMarketOpen] = useState(false);
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

      if (state && Object.keys(state).length > 0) {
        setBotState(state);
      }

      if (runtimeInfo && Object.keys(runtimeInfo).length > 0) {
        setRuntime(runtimeInfo);
      }

      if (settingsState && Object.keys(settingsState).length > 0) {
        setBalance(settingsState.balance ?? 500);
        setInstrument(settingsState.instrument || 'BTC');
        setTradingMode((settingsState.trading_mode || 'paper').toLowerCase());
        setForceMarketOpen(Boolean(settingsState.force_market_open));
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
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <Skeleton style={{ height: '40px', width: '260px' }} />
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
            General Settings
          </h1>
          <p style={{ fontSize: '14px', color: '#475569', marginTop: '6px' }}>
            Configure trading mode, instrument, paper balance, and bot runtime behavior.
          </p>
        </div>
        <div className="animate-fade-in" style={{ display: 'flex', gap: '10px', animationDelay: '0.15s' }}>
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw style={{ width: '14px', height: '14px', marginRight: '6px' }} />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saved ? (
              <><CheckCircle style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Saved</>
            ) : (
              <><Save style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Save Changes</>
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
                <Select
                  value={tradingMode}
                  onChange={e => setTradingMode(e.target.value)}
                >
                  <option value="paper">Paper</option>
                  <option value="live">Live (preview)</option>
                </Select>
              </InputField>

              <InputField label="Instrument" hint="Gold: GC=F, Silver: SI=F, Oil: CL=F" accentColor="#3b82f6">
                <Select
                  value={instrument}
                  onChange={e => setInstrument(e.target.value)}
                >
                  <option value="GC=F">Gold Futures (GC=F)</option>
                  <option value="SI=F">Silver Futures (SI=F)</option>
                  <option value="CL=F">Oil Futures (CL=F)</option>
                </Select>
              </InputField>
              <InputField label="Paper Trading Balance ($)" hint="Starting balance for paper trading" accentColor="#3b82f6">
                <Input
                  type="number"
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                />
              </InputField>

              <InputField label="Force Market Open" hint="Useful for testing bot cycles when exchange is closed" accentColor="#f59e0b">
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

        {/* Bot Info */}
        <Card hover={false} className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
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

        {/* Info Banner */}
        <div
          className="animate-fade-in"
          style={{
            animationDelay: '0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderRadius: '14px',
            background: 'rgba(59, 130, 246, 0.04)',
            border: '1px solid rgba(59, 130, 246, 0.08)',
          }}
        >
          <Info style={{ width: '16px', height: '16px', color: '#3b82f6', flexShrink: 0 }} />
          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
            Strategy parameters have moved to the{' '}
            <a href="/strategy" style={{ color: '#3b82f6', fontWeight: 600, textDecoration: 'none' }}>Strategy</a> page,
            where you can manage and configure individual strategies.
          </p>
        </div>
      </div>
    </div>
  );
}
