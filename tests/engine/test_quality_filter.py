from backend.engine.quality_filter import QualityFilter


def test_passes_when_under_limits():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=2, daily_pnl=-10, balance=500, confidence=70) is True


def test_rejects_when_daily_loss_hit():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=0, daily_pnl=-100, balance=500, confidence=80) is False


def test_rejects_when_too_many_open_trades():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=3, daily_pnl=0, balance=500, confidence=80) is False


def test_rejects_low_confidence():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=0, daily_pnl=0, balance=500, confidence=55) is False


def test_rejects_when_balance_less_than_position_margin():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(
        open_trades_count=0, daily_pnl=0, balance=50.0, confidence=80.0,
        position_margin=100.0,
    ) is False


def test_accepts_when_balance_equals_position_margin():
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(
        open_trades_count=0, daily_pnl=0, balance=100.0, confidence=80.0,
        position_margin=100.0,
    ) is True


def test_existing_tests_still_pass_with_default_margin():
    """position_margin defaults to 0 — existing callers need no change."""
    qf = QualityFilter(daily_loss_limit_pct=0.15, max_open_trades=3, min_confidence_pct=60.0)
    assert qf.accept(open_trades_count=2, daily_pnl=-10, balance=500, confidence=70) is True
