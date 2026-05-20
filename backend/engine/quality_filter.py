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
    ) -> bool:
        if confidence < self.min_confidence_pct:
            return False
        if open_trades_count >= self.max_open_trades:
            return False
        if balance > 0 and (daily_pnl / balance) <= -self.daily_loss_limit_pct:
            return False
        if balance < position_margin:
            return False
        return True
