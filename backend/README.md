# CheckWaterways — Backend

This folder contains a Node.js + Express backend for the Waterway Risk Checker.

Quick start

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` if you want to enable saving checks.
2. Install dependencies:

```bash
cd backend
npm install
```

3. Run the server:

```bash
npm start
```

API
- `POST /api/risk` — body: `{ lat: number, lng: number }` — returns calculated risk summary.
- `POST /api/checks` — save a user check into Supabase (requires `SUPABASE_SERVICE_ROLE_KEY` with insert privileges and a `checks` table).

Notes
- The service queries the Overpass API for waterways and Open-Elevation for elevation.
- For production use, run behind a proper API key-managed proxy, add rate-limiting, and use a hosted PostGIS database (e.g., Supabase) for spatial queries.
