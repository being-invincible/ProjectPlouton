import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Settings,
  CandlestickChart,
  Puzzle,
  Clock,
  Radio,
} from 'lucide-react';
import { Badge } from './ui/Badge';
import api from '../lib/api';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/monitor', icon: Radio, label: 'Monitor' },
  { to: '/chart', icon: CandlestickChart, label: 'Market' },
  { to: '/trades', icon: ArrowLeftRight, label: 'Trades' },
  { to: '/strategy', icon: Puzzle, label: 'Strategy' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const statusMap = {
  RUNNING: { label: 'Active', variant: 'success', pulse: true },
  WAITING: { label: 'Waiting', variant: 'warning', pulse: false },
  ERROR:   { label: 'Error',  variant: 'danger',  pulse: false },
  STOPPED: { label: 'Idle',   variant: 'secondary', pulse: false },
};

export default function Layout() {
  const location = useLocation();
  const [botStatus, setBotStatus] = useState('STOPPED');
  const [instrument, setInstrument] = useState('BTC');
  const [activeStrategy, setActiveStrategy] = useState('Golden Pocket');
  const [marketDisplay, setMarketDisplay] = useState('Crypto perpetuals — 24/7');
  const [botAlive, setBotAlive] = useState(false);
  const [tradingMode, setTradingMode] = useState('paper');
  const [coinCount, setCoinCount] = useState(0);
  const [botToggling, setBotToggling] = useState(false);
  const [tradeType, setTradeType] = useState('paper');
  const [typeDropOpen, setTypeDropOpen] = useState(false);
  const typeDropRef = useRef(null);

  const TRADE_TYPES = [
    { value: 'paper',    label: 'Paper Trades',  color: '#60a5fa' },
    { value: 'live',     label: 'Live Trades',   color: '#10b981' },
    { value: 'backtest', label: 'Backtests',     color: '#fbbf24' },
  ];
  const activeType = TRADE_TYPES.find(t => t.value === tradeType) || TRADE_TYPES[0];

  useEffect(() => {
    function handleClickOutside(e) {
      if (typeDropRef.current && !typeDropRef.current.contains(e.target)) {
        setTypeDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    async function fetchState() {
      try {
        const [state, runtime] = await Promise.all([
          api.getBotState(),
          api.getRuntime(),
        ]);

        if (state && Object.keys(state).length > 0) {
          setBotStatus(state.status || 'STOPPED');
          setInstrument(state.instrument || 'BTC');
          setTradingMode((state.trading_mode || 'paper').toLowerCase());
        }

        if (runtime && Object.keys(runtime).length > 0) {
          setBotAlive(Boolean(runtime.bot_alive));
          setMarketDisplay(runtime.market_display || 'Crypto perpetuals — 24/7');
        }

        const config = await api.getActiveStrategy();
        if (config && (config.display_name || config.strategy_name)) {
          setActiveStrategy(config.display_name || config.strategy_name);
        }

        // Get coin count from monitor endpoint
        const monitorData = await api.getMonitor();
        if (Array.isArray(monitorData)) setCoinCount(monitorData.length);
      } catch { /* ignore */ }
    }
    fetchState();
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, []);

  async function toggleBot() {
    setBotToggling(true);
    try {
      // Fetch fresh state first — local state can be stale after laptop sleep.
      let currentlyAlive = botAlive;
      try {
        const runtime = await api.getRuntime();
        currentlyAlive = Boolean(runtime?.bot_alive);
        setBotAlive(currentlyAlive);
      } catch { /* use local state as fallback */ }

      if (currentlyAlive) {
        await api.stopBot();
        setBotAlive(false);
      } else {
        await api.startBot();
        // Poll twice: bot takes a few seconds to write its first heartbeat.
        const poll = async (attempts) => {
          try {
            const runtime = await api.getRuntime();
            if (runtime?.bot_alive) { setBotAlive(true); setBotToggling(false); return; }
          } catch { /* ignore */ }
          if (attempts > 1) setTimeout(() => poll(attempts - 1), 4000);
          else setBotToggling(false);
        };
        setTimeout(() => poll(2), 4000);
        return;
      }
    } catch { /* ignore */ }
    setBotToggling(false);
  }

  const status = statusMap[botStatus] || statusMap.STOPPED;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* ─── Sidebar ─── */}
      <aside
        className="sidebar-mesh"
        style={{
          position: 'fixed',
          left: 0, top: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '260px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid rgba(148, 163, 184, 0.06)',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '24px 24px 20px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '42px', height: '42px', borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.08))',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              overflow: 'hidden',
            }}>
              <img
                src="/hermes-logo.webp"
                alt="Plouton logo"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div>
              <h1 style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.025em', color: '#f8fafc' }}>
                Plouton
              </h1>
              <p style={{ fontSize: '11px', fontWeight: 500, color: '#475569', marginTop: '1px' }}>
                Automated trading bot
              </p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{
          margin: '0 20px', height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.06), transparent)',
          position: 'relative', zIndex: 1,
        }} />

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 14px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {navItems.map(({ to, icon: Icon, label }) => {
              const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
              return (
                <NavLink
                  key={to}
                  to={to}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '10px',
                    fontSize: '13px', fontWeight: isActive ? 600 : 500,
                    color: isActive ? '#e2e8f0' : '#64748b',
                    background: isActive ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                    transition: 'all 0.15s ease',
                    textDecoration: 'none', position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      e.currentTarget.style.color = '#cbd5e1';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#64748b';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* Active glow bar */}
                    {isActive && (
                      <span
                        className="animate-floating-glow"
                        style={{
                          position: 'absolute', left: '0px', top: '50%',
                          transform: 'translateY(-50%)',
                          width: '3px', height: '18px', borderRadius: '0 4px 4px 0',
                          background: '#3b82f6',
                        }}
                      />
                    )}
                    <Icon style={{
                      width: '16px', height: '16px',
                      color: isActive ? '#60a5fa' : 'inherit',
                      transition: 'color 0.15s',
                    }} />
                    {label}
                  </div>

                  {/* Monitor badge: coin count */}
                  {label === 'Monitor' && coinCount > 0 && (
                    <span style={{
                      fontSize: '10px', fontWeight: 700,
                      padding: '2px 6px', borderRadius: '5px',
                      background: isActive ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.06)',
                      color: isActive ? '#60a5fa' : '#64748b',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {coinCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Divider */}
        <div style={{
          margin: '0 20px', height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.06), transparent)',
          position: 'relative', zIndex: 1,
        }} />

        {/* Footer */}
        <div style={{ padding: '16px 20px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                background: status.variant === 'success' ? '#10b981' : '#475569',
                boxShadow: status.variant === 'success' ? '0 0 5px #10b98170' : 'none',
              }} />
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>
                {tradingMode === 'live' ? 'Live Mode' : 'Paper Mode'}
              </span>
            </div>
            <Badge variant={status.variant} dot pulse={status.pulse}>
              {status.label}
            </Badge>
          </div>
          <p style={{ fontSize: '10px', color: '#475569', marginTop: '8px', textAlign: 'center' }}>
            v2.0 · {activeStrategy}
          </p>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <div style={{ marginLeft: '260px', flex: 1, minHeight: '100vh' }}>
        {/* Top Bar */}
        <header
          className="glass-topbar"
          style={{
            position: 'sticky', top: 0, zIndex: 40,
            padding: '12px 40px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          {/* Left: market info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Market status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock style={{ width: '13px', height: '13px', color: '#475569' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 6px #10b98166',
                }} />
                <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                  Market Open
                </span>
              </div>
              <span style={{ fontSize: '10px', color: '#64748b' }}>{marketDisplay}</span>
            </div>

            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)' }} />

            {/* Bot alive + toggle button */}
            <button
              onClick={toggleBot}
              disabled={botToggling}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 10px', borderRadius: '7px',
                cursor: 'pointer',
                border: `1px solid ${botAlive ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                background: botAlive ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)',
                transition: 'opacity 0.15s',
                opacity: botToggling ? 0.5 : 1,
              }}
              onMouseEnter={e => { if (!botToggling) e.currentTarget.style.opacity = '0.7'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              <span style={{
                display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                background: botAlive ? '#10b981' : '#ef4444',
                boxShadow: botAlive ? '0 0 5px #10b98170' : 'none',
              }} />
              <span style={{ fontSize: '11px', color: botAlive ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {botToggling ? (botAlive ? 'Stopping…' : 'Starting…') : `Bot ${botAlive ? 'Alive' : 'Offline'}`}
              </span>
            </button>

            {/* Coin count pill */}
            {coinCount > 0 && (
              <>
                <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Radio style={{ width: '12px', height: '12px', color: '#3b82f6' }} />
                  <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 600 }}>
                    {coinCount} coins
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right: Trade type + Strategy + Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

            {/* Trade type dropdown */}
            <div ref={typeDropRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setTypeDropOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '5px 10px', borderRadius: '8px',
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid rgba(255,255,255,0.08)`,
                  fontSize: '12px', fontWeight: 600, color: activeType.color,
                  cursor: 'pointer', transition: 'all 0.15s',
                  letterSpacing: '-0.01em',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: activeType.color, flexShrink: 0 }} />
                {activeType.label}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: '1px', opacity: 0.5 }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {typeDropOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: 'rgba(15,23,42,0.98)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.09)', borderRadius: '10px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  padding: '4px', minWidth: '148px', zIndex: 100,
                }}>
                  {TRADE_TYPES.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setTradeType(opt.value); setTypeDropOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        width: '100%', padding: '8px 10px', borderRadius: '7px',
                        fontSize: '12px', fontWeight: tradeType === opt.value ? 700 : 500,
                        color: tradeType === opt.value ? opt.color : '#64748b',
                        background: tradeType === opt.value ? `rgba(255,255,255,0.05)` : 'transparent',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = tradeType === opt.value ? 'rgba(255,255,255,0.05)' : 'transparent'}
                    >
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <NavLink
              to="/strategy"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px', borderRadius: '8px',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                fontSize: '12px', fontWeight: 600, color: '#a78bfa',
                textDecoration: 'none', transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(139, 92, 246, 0.14)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.15)';
              }}
            >
              <Puzzle style={{ width: '12px', height: '12px' }} />
              {activeStrategy}
            </NavLink>
            <Badge variant={status.variant} dot pulse={status.pulse}>
              {status.label}
            </Badge>
          </div>
        </header>

        {/* Page content */}
        <main style={{ padding: '32px 40px', maxWidth: '1440px' }}>
          <Outlet context={{ tradeType, setTradeType }} />
        </main>
      </div>
    </div>
  );
}
