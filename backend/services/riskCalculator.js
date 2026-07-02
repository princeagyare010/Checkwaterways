import fetch from 'node-fetch';
import * as turf from '@turf/turf';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function getElevation(lat, lng) {
  try {
    const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [{ lat, lng }] })
    });
    if (response.ok) {
      const data = await response.json();
      return data.results?.[0]?.elevation || null;
    }
  } catch (err) {
    console.warn('Elevation lookup failed:', err);
  }
  return null;
}

async function findNearbyWaterways(lat, lng, radiusMeters = 500) {
  const query = `
    [out:json][timeout:25];
    (
      way["waterway"](around:${radiusMeters},${lat},${lng});
      way["natural"="water"](around:${radiusMeters},${lat},${lng});
      relation["natural"="water"](around:${radiusMeters},${lat},${lng});
    );
    out geom;
  `;

  const response = await fetch(OVERPASS_URL, { method: 'POST', body: query });
  if (!response.ok) throw new Error('Overpass API request failed: ' + response.status);
  const data = await response.json();
  return data.elements || [];
}

function scoreRisk(distanceMeters, waterwayName) {
  let risk, colorClass, message;

  if (distanceMeters <= 10) {
    risk = 'CRITICAL';
    colorClass = 'risk-critical';
    message = `Within ${Math.round(distanceMeters)}m of ${waterwayName}. This is likely inside the legal riparian buffer zone — high risk of encroachment findings or a future demolition order.`;
  } else if (distanceMeters <= 50) {
    risk = 'HIGH';
    colorClass = 'risk-high';
    message = `${Math.round(distanceMeters)}m from ${waterwayName}. This falls within commonly enforced buffer zones. Verify the exact setback with the Water Resources Commission before proceeding.`;
  } else if (distanceMeters <= 100) {
    risk = 'MODERATE';
    colorClass = 'risk-moderate';
    message = `${Math.round(distanceMeters)}m from ${waterwayName}. This may fall within the buffer for larger rivers. Recommend official verification before purchase or construction.`;
  } else {
    risk = 'LOW';
    colorClass = 'risk-low';
    message = `${Math.round(distanceMeters)}m from the nearest mapped waterway (${waterwayName}). Outside typical buffer zones based on available data.`;
  }

  return { risk, colorClass, message };
}

export async function calculateWaterwayRisk(lat, lng) {
  const [waterways, elevation] = await Promise.all([
    findNearbyWaterways(lat, lng, 500),
    getElevation(lat, lng)
  ]);

  if (!waterways || waterways.length === 0) {
    const floodNote = elevation !== null && elevation < 10
      ? ' Very low elevation area — may have flood susceptibility.'
      : '';

    return {
      risk: 'LOW',
      colorClass: 'risk-low',
      nearestDistance: null,
      nearestWaterwayName: null,
      elevation: elevation,
      message: 'No mapped waterways found within 500m of this location. Low apparent risk based on available OpenStreetMap data' + floodNote + ' — note that small seasonal streams or drainage channels are not always fully mapped.',
      waterwaysFound: 0
    };
  }

  let nearestDistance = Infinity;
  let nearestWaterwayName = 'an unnamed waterway';

  for (const way of waterways) {
    if (!way.geometry || !Array.isArray(way.geometry) || way.geometry.length === 0) continue;
    const coords = way.geometry.map(g => [g.lon, g.lat]);
    try {
      const line = turf.lineString(coords);
      const pt = turf.point([lng, lat]);
      const dist = turf.pointToLineDistance(pt, line, { units: 'meters' });
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestWaterwayName = (way.tags && (way.tags.name || way.tags.waterway)) || 'an unnamed waterway';
      }
    } catch (err) {
      // fall back to sampling-based distance if turf fails for a way
      const approx = (() => {
        let minD = Infinity;
        for (let i = 0; i < way.geometry.length - 1; i++) {
          const p1 = way.geometry[i];
          const p2 = way.geometry[i + 1];
          const midLat = (p1.lat + p2.lat) / 2;
          const midLon = (p1.lon + p2.lon) / 2;
          const d1 = turf.distance(turf.point([lng, lat]), turf.point([p1.lon, p1.lat]), { units: 'meters' });
          const d2 = turf.distance(turf.point([lng, lat]), turf.point([p2.lon, p2.lat]), { units: 'meters' });
          const dMid = turf.distance(turf.point([lng, lat]), turf.point([midLon, midLat]), { units: 'meters' });
          minD = Math.min(minD, d1, d2, dMid);
        }
        return minD;
      })();
      if (approx < nearestDistance) {
        nearestDistance = approx;
        nearestWaterwayName = (way.tags && (way.tags.name || way.tags.waterway)) || 'an unnamed waterway';
      }
    }
  }

  const scored = scoreRisk(nearestDistance, nearestWaterwayName);

  return {
    risk: scored.risk,
    colorClass: scored.colorClass,
    nearestDistance: Math.round(nearestDistance),
    nearestWaterwayName,
    elevation,
    message: scored.message,
    waterwaysFound: waterways.length
  };
}

export default { calculateWaterwayRisk };
