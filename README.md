# Waterway Risk Checker — Ghana

A public screening tool: click a location (or search an address) to see how close it is to a mapped river, stream, or water body in Ghana — useful as a first pass before buying or developing land.

## What it does

- Click anywhere on the map, or search an address, to check that location
- Enter a GhanaPost GPS address (e.g., `GS-0988-0986`) to check a specific plot
- Queries OpenStreetMap's live waterway data via the Overpass API
- Gets elevation data (SRTM) for flood susceptibility context
- Calculates distance to the nearest mapped waterway
- Shows a color-coded risk tier (Low / Moderate / High / Critical) based on Ghana's typical riparian buffer ranges (10–100m+, depending on watercourse size)
- Export results as a text report or share via link

No backend, database, or build step — plain HTML/CSS/JS using CDN-hosted Leaflet.

## Project structure

```
checkwaterways/
├── index.html              # Page structure: header, buffer-zone legend, map, results panel
├── css/
│   └── style.css           # All styling
├── js/
│   ├── riskCalculator.js   # Overpass API queries + distance/risk scoring + elevation
│   └── app.js              # Map setup, click/search handlers, rendering results
└── README.md
```

## How the risk scoring works

1. User clicks a point (or searches an address, geocoded via Nominatim, or enters GhanaPost GPS)
2. `riskCalculator.js` queries the Overpass API for all waterways/water bodies within 500m
3. Elevation data is fetched via OpenElevation API (SRTM)
4. For each waterway found, it estimates the distance from the clicked point to the nearest point along that waterway's line
5. The closest distance sets the risk tier:
   - **≤10m** → Critical (likely inside the legal buffer)
   - **≤50m** → High
   - **≤100m** → Moderate
   - **>100m** → Low
6. Low elevation areas (<10m) are flagged for potential flood risk

These thresholds follow Ghana's general riparian buffer guidance and are approximate — always confirm the exact setback for a specific watercourse with the Water Resources Commission.

## Known limitations

- **Not all waterways are mapped.** OpenStreetMap coverage is incomplete for small seasonal streams and drainage channels in less-surveyed areas.
- **Distance is approximate** — uses sampling method, not precise geometric calculation.
- **Overpass API is a shared public resource** — it can be slow or rate-limited under heavy use.
- **Elevation data may be cached** from the public API — accuracy varies.

## Disclaimer

This is a screening tool only. It is not a substitute for official verification. Always confirm with the Ghana Lands Commission, Water Resources Commission (WRC), Environmental Protection Agency (EPA), or a licensed surveyor before any purchase or construction decision.

built by Prince Agyare. @roddy6001 on x 