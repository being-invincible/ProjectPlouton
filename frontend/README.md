# TradingBot Frontend

React dashboard for monitoring the TradingBot paper-trading system.

## Purpose

The frontend reads data from PocketBase and provides pages for:
- Dashboard overview
- Trades list and trade detail
- Chart visualization
- Strategy settings

Source of truth for project architecture and conventions is the root `CLAUDE.md` file.

## Stack

- React + Vite
- PocketBase JS SDK
- Tailwind CSS + custom UI components

## Development

From the project root:

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173` by default.

## Backend Dependency

Frontend expects PocketBase and backend services to be running.

Start PocketBase from project root:

```bash
cd pocketbase
./pocketbase serve
```

## Key Pages

- `src/pages/Dashboard.jsx`
- `src/pages/Trades.jsx`
- `src/pages/TradeDetail.jsx`
- `src/pages/Chart.jsx`
- `src/pages/Settings.jsx`
- `src/pages/Strategy.jsx`

## Notes

- Keep UI and terminology aligned with strategy/risk defaults documented in `../CLAUDE.md`.
- If strategy fields or trade schema change in backend, update `src/lib/api.js` and dependent pages.
