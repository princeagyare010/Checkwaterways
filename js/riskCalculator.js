// riskCalculator.js
// Queries OpenStreetMap's Overpass API for waterways near a point,
// then scores flood/riparian-buffer risk based on proximity.
// Exposed globally as `RiskCalculator` (no build step / bundler needed).

const RiskCalculator = (function () {

  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

  // Get elevation data using OpenElevation API (SRTM-based)
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

  async function findNearbyWaterways(lat, lng, radiusMeters) {
    radiusMeters = radiusMeters || 500;

    const query = `
      [out:json][timeout:25];
      (
        way["waterway"](around:${radiusMeters},${lat},${lng});
        way["natural"="water"](around:${radiusMeters},${lat},${lng});
        relation["natural"="water"](around:${radiusMeters},${lat},${lng});
      );
      out geom;
    `;

    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: query
    });

    if (!response.ok) {
      throw new Error('Overpass API request failed: ' + response.status);
    }

    const data = await response.json();
    return data.elements || [];
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => deg * Math.PI / 180;

    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dPhi = toRad(lat2 - lat1);
    const dLambda = toRad(lon2 - lon1);

    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Approximate nearest-distance-to-line by sampling endpoints + midpoints
  // of each segment. Good enough for screening; swap in Turf.js's
  // pointToLineDistance() for production-grade geometric accuracy.
  function distanceToWayGeometry(pointLat, pointLng, geometry) {
    let minDistance = Infinity;

    if (!geometry || geometry.length === 0) return minDistance;

    if (geometry.length === 1) {
      return haversineDistance(pointLat, pointLng, geometry[0].lat, geometry[0].lon);
    }

    for (let i = 0; i < geometry.length - 1; i++) {
      const p1 = geometry[i];
      const p2 = geometry[i + 1];

      const d1 = haversineDistance(pointLat, pointLng, p1.lat, p1.lon);
      const d2 = haversineDistance(pointLat, pointLng, p2.lat, p2.lon);
      const midLat = (p1.lat + p2.lat) / 2;
      const midLon = (p1.lon + p2.lon) / 2;
      const dMid = haversineDistance(pointLat, pointLng, midLat, midLon);

      minDistance = Math.min(minDistance, d1, d2, dMid);
    }

    return minDistance;
  }

  // Tiers follow Ghana's typical riparian buffer guidance (10-100m+,
  // depending on watercourse size). See README for sources/caveats.
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

  async function calculateWaterwayRisk(lat, lng) {
    const [waterways, elevation] = await Promise.all([
      findNearbyWaterways(lat, lng, 500),
      getElevation(lat, lng)
    ]);

    if (waterways.length === 0) {
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

    waterways.forEach(function (way) {
      if (way.geometry) {
        const dist = distanceToWayGeometry(lat, lng, way.geometry);
        if (dist < nearestDistance) {
          nearestDistance = dist;
          nearestWaterwayName = (way.tags && (way.tags.name || way.tags.waterway)) || 'an unnamed waterway';
        }
      }
    });

    const scored = scoreRisk(nearestDistance, nearestWaterwayName);

    return {
      risk: scored.risk,
      colorClass: scored.colorClass,
      nearestDistance: Math.round(nearestDistance),
      nearestWaterwayName: nearestWaterwayName,
      elevation: elevation,
      message: scored.message,
      waterwaysFound: waterways.length
    };
  }

  return {
    calculateWaterwayRisk: calculateWaterwayRisk
  };

})();
