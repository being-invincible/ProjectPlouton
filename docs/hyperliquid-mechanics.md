# Hyperliquid Perpetuals — Mechanics Cheat Sheet

Plain-English reference for the perp concepts the bot uses. Every concept here is also available as a `?` tooltip in the app.

## What is a Perpetual?

A perpetual ("perp") is a futures contract with no expiry date. You can hold it forever, but you pay or receive a **funding rate** every hour to keep its price tethered to the spot price.

## Margin

**Collateral:** USDC. All trades on Hyperliquid are margined in USDC.

**Notional value:** the total trade size. If you long 0.5 ETH at $3000, notional = $1500. This is what moves with price, not what you put up.

**Initial margin:** cash locked up to open the trade. With 10× leverage, you put up 1/10 of notional ($150 for the example above).

**Maintenance margin:** the minimum equity Hyperliquid requires to keep the trade open. ~1.25% of notional. If your equity falls below this, you get liquidated.

**Cross vs Isolated:**
- **Cross** (default on HL): all your USDC backs every open trade. One liquidation can drain everything.
- **Isolated:** each trade has its own margin pool. A liquidation only loses that trade's margin. **Hermes paper-trading simulates isolated.**

## Leverage

The bot suggests a leverage value but Hyperliquid lets you set it manually. Higher leverage = same trade size with less margin, but:
- closer liquidation price
- bigger funding cost (funding is paid on notional, not margin)

**Per-asset max leverage** (published by HL, fetched live by the bot):
- BTC/ETH: 50×
- SOL/XRP/LINK/ADA: 20×
- BNB/SUI/HYPE: 10×
- TAO: 5×

These can change — bot reads live from `exchange.load_markets()` at startup.

## Liquidation Price

Formula (approx): `liquidation = entry ∓ (initial_margin − maintenance_margin) / quantity`

(`−` for LONG, `+` for SHORT). The bot displays this in every alert and on the Trade Detail page so you know how much room the trade has.

## Funding Rate

Hourly. Paid by longs to shorts (or vice versa) to keep perp price close to spot. Annualised by ×24×365.

- Typical: 0.01%/hr → 87.6%/year if held
- Positive funding: longs pay shorts (price > spot, market is bullish)
- Negative funding: shorts pay longs (price < spot, market is bearish)

For paper trades this is informational only.

## The Golden Pocket

The 50%–61.8% Fibonacci retracement zone. Most reactions in trending crypto happen here. Hermes only trades this zone — no 38.2% entries.

**Why this zone**: combines the 50% psychological midpoint with the 61.8% Fibonacci ratio, creating a tight high-probability area for reversal. Above 50% = shallow retrace (less reliable); below 61.8% = trend potentially broken.

## ATR (Average True Range)

The average distance between high and low over the last 14 candles. Used by Hermes to size stop losses that respect each coin's volatility — HYPE moves much more than BTC per candle, so SL is set wider for HYPE.

## R:R (Risk to Reward)

Ratio of dollars risked to dollars potentially gained. 1:2 means risk $1 to make $2. A 40% win rate at 1:2 R:R is still profitable; 50% win rate at 1:1 is break-even.

Hermes uses two TPs:
- **TP1 at 1:1.5 R:R** — partial close (50% of position), SL moves to break-even
- **TP2 at 1.618 Fib extension** — runner

## Confidence Score

0–95%. Heuristic v1 sums weighted factors: MTF alignment + slope strength + candle pattern at level + volume + EMA confluence + ATR sanity. Cap at 95% — never "certain". After ≥50 closed paper trades, v2 replaces the heuristic with actual historical win rate of similar setups.
