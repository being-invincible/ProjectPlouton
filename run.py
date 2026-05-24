#!/usr/bin/env python3
"""
TradingBot — Top-level runner.

Starts:
1. FastAPI server (serves DuckDB data to the frontend on port 8090)
2. Trading bot (async main loop)

Usage:
    python run.py
    python run.py --force           # Bypass market hours check
"""

import asyncio
import atexit
import shutil
import subprocess
import sys
import os
import time
import argparse
import threading

import uvicorn


_caffeinate_proc: subprocess.Popen | None = None


def start_caffeinate() -> None:
    """Prevent macOS from sleeping while bot runs.

    `caffeinate -i` blocks IDLE sleep (display can still dim). Process dies
    with the bot — atexit cleanup is a belt-and-braces fallback.
    """
    global _caffeinate_proc
    if sys.platform != "darwin":
        return
    if shutil.which("caffeinate") is None:
        return
    if _caffeinate_proc is not None and _caffeinate_proc.poll() is None:
        return
    try:
        _caffeinate_proc = subprocess.Popen(
            ["caffeinate", "-i", "-w", str(os.getpid())],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"[OK] caffeinate active (PID {_caffeinate_proc.pid}) — Mac won't idle-sleep while bot runs")
        atexit.register(stop_caffeinate)
    except Exception as exc:
        print(f"[WARN] could not start caffeinate: {exc}")


def stop_caffeinate() -> None:
    global _caffeinate_proc
    if _caffeinate_proc is not None and _caffeinate_proc.poll() is None:
        try:
            _caffeinate_proc.terminate()
            _caffeinate_proc.wait(timeout=3)
        except Exception:
            try:
                _caffeinate_proc.kill()
            except Exception:
                pass
    _caffeinate_proc = None

# Add backend to path
BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
sys.path.insert(0, BACKEND_DIR)


def start_api_server_in_thread() -> tuple[uvicorn.Server, threading.Thread]:
    """Start FastAPI in a background thread with its own read-only DuckDB connection.
    Must NOT share the bot's write connection — concurrent access to the same DuckDB
    connection object across threads causes C++ null-deref crashes."""
    from api_server import app
    # API server opens its own read-only DuckDB connection via get_store()
    # DuckDB 1.x supports one write + multiple read-only connections per process.
    config = uvicorn.Config(app, host="0.0.0.0", port=8090, log_level="info")
    server = uvicorn.Server(config)

    thread = threading.Thread(
        target=lambda: asyncio.run(server.serve()),
        daemon=True,
        name="tradingbot-api-server",
    )
    thread.start()
    time.sleep(1)

    print("[OK] FastAPI server running at http://127.0.0.1:8090")
    print("   API docs: http://127.0.0.1:8090/docs")
    return server, thread


async def async_main(args):
    from bot import TradingBot

    bot = TradingBot()
    api_server = None
    api_thread = None

    start_caffeinate()
    await bot.initialize()

    if not args.no_api:
        print("[INFO] Starting FastAPI server on port 8090...")
        api_server, api_thread = start_api_server_in_thread()
        # Share the bot's DuckDB connection with the API so both use the same
        # write-mode connection (avoids the macOS exclusive-lock conflict where
        # a read-only connection in the same process cannot acquire the lock).
        from api_server import set_bot_running_in_process, set_store, set_ws_client
        set_bot_running_in_process(True)
        set_store(bot._duckdb_store)
        set_ws_client(bot._ws)

    print("\n[INFO] Starting Trading Bot...\n")

    try:
        await bot.run()
    finally:
        if not args.no_api:
            from api_server import set_bot_running_in_process
            set_bot_running_in_process(False)
        if api_server is not None:
            print("[INFO] Stopping FastAPI server...")
            api_server.should_exit = True
            if api_thread is not None:
                api_thread.join(timeout=5)
            print("[OK] FastAPI server stopped")
        stop_caffeinate()


def main():
    parser = argparse.ArgumentParser(description="Run the TradingBot")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force market to be treated as open (for paper trading testing)",
    )
    parser.add_argument(
        "--no-api",
        action="store_true",
        help="Don't start the API server (if running separately)",
    )
    args = parser.parse_args()

    # Set force market open before importing settings
    if args.force:
        os.environ["FORCE_MARKET_OPEN"] = "true"
        print("[INFO] --force flag set: market hours check bypassed")

    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        print("\n[INFO] Shutting down...")


if __name__ == "__main__":
    main()
