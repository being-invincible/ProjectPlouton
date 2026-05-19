import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Settings,
  CandlestickChart,
  Puzzle,
  Circle,
  Clock,
} from 'lucide-react';
import { Badge } from './ui/Badge';
import api from '../lib/api';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
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

/* Instrument metadata — maps yfinance symbols to display info */
const INSTRUMENT_META = {
  'GC=F': { name: 'Gold Futures', icon: '🥇', hours: 'Sun 6:00 PM – Fri 5:00 PM', tz: 'ET', exchange: 'COMEX' },
  'SI=F': { name: 'Silver Futures', icon: '🥈', hours: 'Sun 6:00 PM – Fri 5:00 PM', tz: 'ET', exchange: 'COMEX' },
  'CL=F': { name: 'Oil Futures (WTI)', icon: '🛢️', hours: 'Sun 6:00 PM – Fri 5:00 PM', tz: 'ET', exchange: 'NYMEX' },
};

// Market status comes from bot_state via the DuckDB API.

export default function Layout() {
  const location = useLocation();
  const [botStatus, setBotStatus] = useState('STOPPED');
  const [instrument, setInstrument] = useState('BTC');
  const [activeStrategy, setActiveStrategy] = useState('Fibonacci Retracement');
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketDisplay, setMarketDisplay] = useState('Checking market hours...');
  const [botAlive, setBotAlive] = useState(false);
  const [tradingMode, setTradingMode] = useState('paper');
  const [forceOpen, setForceOpen] = useState(false);

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
          setMarketOpen(Boolean(runtime.market_actual_open));
          setForceOpen(Boolean(runtime.force_market_open));
          setMarketDisplay(runtime.market_display || 'Closed');
        }

        // Fetch active strategy name
        const config = await api.getActiveStrategy();
        if (config && config.display_name) {
          setActiveStrategy(config.display_name || config.strategy_name);
        }
      } catch { /* ignore */ }
    }
    fetchState();
    // Poll every 30s instead of PocketBase realtime
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, []);

  const status = statusMap[botStatus] || statusMap.STOPPED;
  const meta = INSTRUMENT_META[instrument] || { name: instrument, icon: '📈', hours: '—', tz: '', exchange: '' };
  
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* ─── Sidebar ─── */}
      <aside
        className="sidebar-mesh"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '42px',
              height: '42px',
              borderRadius: '14px',
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
          margin: '0 20px',
          height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.06), transparent)',
          position: 'relative',
          zIndex: 1,
        }} />

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 14px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {navItems.map(({ to, icon: Icon, label }) => {
              const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
              return (
                <NavLink
                  key={to}
                  to={to}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '11px 14px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? '#e2e8f0' : '#64748b',
                    background: isActive ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                    transition: 'all 0.2s ease',
                    textDecoration: 'none',
                    position: 'relative',
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
                  {/* Active glow bar */}
                  {isActive && (
                    <span
                      className="animate-floating-glow"
                      style={{
                        position: 'absolute',
                        left: '0px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: '3px',
                        height: '20px',
                        borderRadius: '0 4px 4px 0',
                        background: '#3b82f6',
                      }}
                    />
                  )}
                  <Icon style={{
                    width: '18px',
                    height: '18px',
                    color: isActive ? '#60a5fa' : 'inherit',
                    transition: 'color 0.2s',
                  }} />
                  {label}
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Divider */}
        <div style={{
          margin: '0 20px',
          height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.06), transparent)',
          position: 'relative',
          zIndex: 1,
        }} />

        {/* Footer */}
        <div style={{ padding: '16px 20px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Circle style={{
                width: '8px',
                height: '8px',
                fill: status.variant === 'success' ? '#10b981' : '#475569',
                color: status.variant === 'success' ? '#10b981' : '#475569',
              }} />
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>
                {tradingMode === 'live' ? 'Live Mode' : 'Paper Mode'}
              </span>
            </div>
            <Badge variant={status.variant} dot pulse={status.pulse}>
              {status.label}
            </Badge>
          </div>
          <p style={{ fontSize: '10px', color: '#334155', marginTop: '8px', textAlign: 'center' }}>
            v1.0 · {activeStrategy}
          </p>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <div style={{ marginLeft: '260px', flex: 1, minHeight: '100vh' }}>
        {/* Top Bar */}
        <header
          className="glass-topbar"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            padding: '14px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Left: Instrument info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px', lineHeight: 1 }}>{meta.icon}</span>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  {meta.name}
                </h2>
                <span style={{ fontSize: '11px', color: '#475569', fontWeight: 500 }}>
                  {instrument} · {meta.exchange}
                </span>
              </div>
            </div>

            {/* Separator */}
            <div style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,0.06)' }} />

            {/* Market hours */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock style={{ width: '13px', height: '13px', color: '#475569' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: marketOpen ? '#10b981' : '#64748b',
                    boxShadow: marketOpen ? '0 0 6px #10b98166' : 'none',
                  }} />
                  <span style={{ fontSize: '11px', color: marketOpen ? '#10b981' : '#64748b', fontWeight: 600 }}>
                    {marketOpen ? 'Market Open' : 'Market Closed'}
                  </span>
                  {forceOpen && (
                    <span style={{ fontSize: '10px', color: '#f59e0b', fontWeight: 600 }}>
                      (Forced For Bot)
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '10px', color: '#334155' }}>
                  {marketDisplay}
                </span>
              </div>
            </div>

            <div style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,0.06)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Circle style={{
                width: '8px',
                height: '8px',
                fill: botAlive ? '#10b981' : '#ef4444',
                color: botAlive ? '#10b981' : '#ef4444',
              }} />
              <span style={{ fontSize: '11px', color: botAlive ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                Bot {botAlive ? 'Alive' : 'Stale'}
              </span>
            </div>
          </div>

          {/* Right: Strategy + Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <NavLink
              to="/strategy"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '8px',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                fontSize: '12px',
                fontWeight: 600,
                color: '#a78bfa',
                textDecoration: 'none',
                transition: 'all 0.2s',
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
              <Puzzle style={{ width: '13px', height: '13px' }} />
              {activeStrategy}
            </NavLink>
            <Badge variant={status.variant} dot pulse={status.pulse}>
              {status.label}
            </Badge>
          </div>
        </header>

        {/* Page content */}
        <main style={{ padding: '32px 40px', maxWidth: '1440px' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
