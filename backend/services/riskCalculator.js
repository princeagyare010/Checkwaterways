import fetch from 'node-fetch';
import * as turf from '@turf/turf';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// In-memory caches
const overpassCache = [];   // Array of { lat, lng, waterways, timestamp }
const elevationCache = [];  // Array of { lat, lng, elevation, timestamp }

const OVERPASS_TTL = 10 * 60 * 1000;    // 10 minutes
const ELEVATION_TTL = 30 * 60 * 1000;   // 30 minutes
const MAX_CACHE_SIZE = 500;

function getDistanceBetweenPoints(lat1, lng1, lat2, lng2) {
  const p1 = turf.point([lng1, lat1]);
  const p2 = turf.point([lng2, lat2]);
  return turf.distance(p1, p2, { units: 'meters' });
}

function getCachedWaterways(lat, lng) {
  const now = Date.now();
  // Evict expired entries
  for (let i = overpassCache.length - 1; i >= 0; i--) {
    if (now - overpassCache[i].timestamp > OVERPASS_TTL) {
      overpassCache.splice(i, 1);
    }
  }
  // Find cache entry within 250m
  for (const entry of overpassCache) {
    const dist = getDistanceBetweenPoints(lat, lng, entry.lat, entry.lng);
    if (dist <= 250) {
      return entry.waterways;
    }
  }
  return null;
}

function cacheWaterways(lat, lng, waterways) {
  if (overpassCache.length >= MAX_CACHE_SIZE) {
    overpassCache.shift(); // remove oldest
  }
  overpassCache.push({
    lat,
    lng,
    waterways,
    timestamp: Date.now()
  });
}

function getCachedElevation(lat, lng) {
  const now = Date.now();
  // Evict expired entries
  for (let i = elevationCache.length - 1; i >= 0; i--) {
    if (now - elevationCache[i].timestamp > ELEVATION_TTL) {
      elevationCache.splice(i, 1);
    }
  }
  // Find cache entry within 50m
  for (const entry of elevationCache) {
    const dist = getDistanceBetweenPoints(lat, lng, entry.lat, entry.lng);
    if (dist <= 50) {
      return entry.elevation;
    }
  }
  return null;
}

function cacheElevation(lat, lng, elevation) {
  if (elevationCache.length >= MAX_CACHE_SIZE) {
    elevationCache.shift(); // remove oldest
  }
  elevationCache.push({
    lat,
    lng,
    elevation,
    timestamp: Date.now()
  });
}

async function getElevation(lat, lng) {
  // Check cache first
  const cached = getCachedElevation(lat, lng);
  if (cached !== null) {
    return cached;
  }

  try {
    const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [{ lat, lng }] })
    });
    if (response.ok) {
      const data = await response.json();
      const elevation = data.results?.[0]?.elevation || null;
      if (elevation !== null) {
        cacheElevation(lat, lng, elevation);
      }
      return elevation;
    }
  } catch (err) {
    console.warn('Elevation lookup failed:', err);
  }
  return null;
}

async function findNearbyWaterways(lat, lng, radiusMeters = 500) {
  // Check cache first
  const cached = getCachedWaterways(lat, lng);
  if (cached !== null) {
    return cached;
  }

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
  const elements = data.elements || [];
  
  cacheWaterways(lat, lng, elements);
  return elements;
}

function getWaterwayType(way) {
  const tags = way.tags || {};
  const waterway = tags.waterway || '';
  const natural = tags.natural || '';

  if (waterway === 'river' || waterway === 'riverbank' || natural === 'water') {
    return 'river';
  } else if (waterway === 'stream' || waterway === 'canal') {
    return 'stream';
  } else if (waterway === 'drain' || waterway === 'ditch') {
    return 'drain';
  }
  return 'other';
}

const BUFFER_POLICIES = {
  river: {
    critical: 15,
    high: 50,
    moderate: 100,
    name: 'Major Waterway (River/Lake)'
  },
  stream: {
    critical: 10,
    high: 30,
    moderate: 50,
    name: 'Medium Waterway (Stream/Canal)'
  },
  drain: {
    critical: 5,
    high: 10,
    moderate: 20,
    name: 'Minor Waterway (Drain/Ditch)'
  },
  other: {
    critical: 10,
    high: 50,
    moderate: 100,
    name: 'Waterway'
  }
};

function scoreRisk(distanceMeters, waterwayName, type) {
  const policy = BUFFER_POLICIES[type] || BUFFER_POLICIES.other;
  let risk, colorClass, message;

  if (distanceMeters <= policy.critical) {
    risk = 'CRITICAL';
    colorClass = 'risk-critical';
    message = `Within ${Math.round(distanceMeters)}m of ${waterwayName} (${policy.name}). This is inside the legal buffer zone (setback: ${policy.critical}m) — high risk of encroachment or demolition order.`;
  } else if (distanceMeters <= policy.high) {
    risk = 'HIGH';
    colorClass = 'risk-high';
    message = `${Math.round(distanceMeters)}m from ${waterwayName} (${policy.name}). This falls within high-risk buffer zone (setback: ${policy.high}m). Verify setbacks with WRC.`;
  } else if (distanceMeters <= policy.moderate) {
    risk = 'MODERATE';
    colorClass = 'risk-moderate';
    message = `${Math.round(distanceMeters)}m from ${waterwayName} (${policy.name}). This is inside moderate-risk zone (setback: ${policy.moderate}m). Verify before purchase.`;
  } else {
    risk = 'LOW';
    colorClass = 'risk-low';
    message = `${Math.round(distanceMeters)}m from the nearest mapped waterway (${waterwayName}, ${policy.name}). Outside typical buffer zones.`;
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
      nearestWaterwayType: null,
      elevation: elevation,
      message: 'No mapped waterways found within 500m of this location. Low apparent risk based on available OpenStreetMap data' + floodNote + ' — note that small seasonal streams or drainage channels are not always fully mapped.',
      waterwaysFound: 0,
      waterways: []
    };
  }

  let nearestDistance = Infinity;
  let nearestWaterwayName = 'an unnamed waterway';
  let nearestWaterwayType = 'other';
  
  const allWaterways = [];

  for (const way of waterways) {
    if (!way.geometry || !Array.isArray(way.geometry) || way.geometry.length === 0) continue;
    const coords = way.geometry.map(g => [g.lon, g.lat]);
    const name = (way.tags && (way.tags.name || way.tags.waterway)) || 'an unnamed waterway';
    const type = getWaterwayType(way);
    
    let distance = Infinity;
    try {
      const line = turf.lineString(coords);
      const pt = turf.point([lng, lat]);
      distance = turf.pointToLineDistance(pt, line, { units: 'meters' });
    } catch (err) {
      // fall back to sampling-based distance if turf fails for a way
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
      distance = minD;
    }

    if (distance !== Infinity) {
      allWaterways.push({
        id: way.id,
        name,
        type,
        distance: Math.round(distance),
        tags: way.tags || {}
      });

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestWaterwayName = name;
        nearestWaterwayType = type;
      }
    }
  }

  // Sort nearby waterways by distance
  allWaterways.sort((a, b) => a.distance - b.distance);

  const scored = scoreRisk(nearestDistance, nearestWaterwayName, nearestWaterwayType);

  return {
    risk: scored.risk,
    colorClass: scored.colorClass,
    nearestDistance: Math.round(nearestDistance),
    nearestWaterwayName,
    nearestWaterwayType,
    elevation,
    message: scored.message,
    waterwaysFound: allWaterways.length,
    waterways: allWaterways
  };
}

export default { calculateWaterwayRisk };
