#!/usr/bin/env python3
"""
Dev runner — launches run.py and auto-restarts it whenever a backend .py file
changes. Backend Python code is loaded into memory once at startup, so without
this you'd have to kill + relaunch the bot manually after every edit.

Usage:
    python dev_runner.py           # watch + auto-reload
    python dev_runner.py --force   # pass-through flags go to run.py

The frontend (Vite) already hot-reloads on its own; this is the backend equivalent.
"""

import os
import sys

from watchfiles import run_process

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")


def _start():
    """Entry the watcher (re)spawns in a fresh subprocess on each change."""
    import runpy
    # Forward any CLI flags (e.g. --force) to run.py
    sys.argv = ["run.py"] + sys.argv[1:]
    runpy.run_path(os.path.join(ROOT, "run.py"), run_name="__main__")


if __name__ == "__main__":
    print(f"[dev] watching {BACKEND_DIR} for changes — bot auto-restarts on save")
    print("[dev] press Ctrl+C to stop\n")
    # Restart whenever any .py under backend/ changes.
    run_process(
        BACKEND_DIR,
        target=_start,
        watch_filter=lambda change, path: path.endswith(".py"),
    )
