#!/bin/bash
# Keeps laptop awake (display/idle/disk/system sleep) while bot runs.
# Lid-close on battery still forces sleep — use launchd for true 24/7.
set -e
cd "$(dirname "$0")"
exec caffeinate -dims python run.py
