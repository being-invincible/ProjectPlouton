"""One-shot smoke test: fetch real OHLCV for each configured coin and print latest candle."""

import sys
sys.path.insert(0, ".")

from backend.config import settings
from backend.data.hyperliquid_fetcher import HyperliquidFetcher


def main() -> None:
    f = HyperliquidFetcher()
    for coin in settings.coins:
        try:
            df = f.fetch_ohlcv(coin, "5m", limit=3)
            last = df.iloc[-1]
            max_lev = f.get_max_leverage(coin)
            print(f"{coin:6s}  close=${last['Close']:>12,.4f}  vol={last['Volume']:>12,.2f}  max_lev={max_lev}x")
        except Exception as e:
            print(f"{coin:6s}  FAIL: {e}")


if __name__ == "__main__":
    main()
