"""Final gate before paper-executing a signal."""

from dataclasses import dataclass


@dataclass
class QualityFilter:
    daily_loss_limit_pct: float
    max_open_trades: int
    min_confidence_pct: float

    def accept(
        self,
        *,
        open_trades_count: int,
        daily_pnl: float,
        balance: float,
        confidence: float,
        position_margin: float = 0.0,
        min_confidence_override: float | None = None,
        max_open_trades_override: int | None = None,
    ) -> bool:
        min_conf  = min_confidence_override  if min_confidence_override  is not None else self.min_confidence_pct
        max_open  = max_open_trades_override if max_open_trades_override is not None else self.max_open_trades
        if confidence < min_conf:
            return False
        if open_trades_count >= max_open:
            return False
        if balance > 0 and (daily_pnl / balance) <= -self.daily_loss_limit_pct:
            return False
        if balance < position_margin:
            return False
        return True
