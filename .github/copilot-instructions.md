# Copilot Workspace Instructions

Use `CLAUDE.md` at the repository root as the primary project context document.

## Project Context Source

- Always read and follow architecture, status, and conventions in `CLAUDE.md`.
- Treat `CLAUDE.md` as the source of truth when there is ambiguity.
- Keep new code and docs aligned with:
  - Trading defaults (`GC=F`, `5m`, paper balance `500`)
  - Core architecture (Python bot -> PocketBase <- React dashboard)
  - Current project phase and module responsibilities

## Backend Conventions

- Configuration lives in `backend/config/settings.py`.
- Data access to PocketBase goes through `backend/pocketbase_client.py`.
- Strategies inherit from `backend/strategy/base.py`.
- Brokers implement `backend/broker/base.py`.

## Frontend Conventions

- Frontend is Vite + React in `frontend/`.
- Keep pages and API usage consistent with PocketBase collections:
  `candles`, `trades`, `signals`, `strategy_configs`, `bot_state`.

## Maintenance

- If architecture or conventions evolve, update `CLAUDE.md` first.
- Keep README files and implementation in sync with `CLAUDE.md`.
