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
    if (!geometry || geometry.length === 0) return Infinity;

    // Use Turf.js if available
    if (typeof turf !== 'undefined' && turf.lineString && turf.point && turf.pointToLineDistance) {
      try {
        if (geometry.length >= 2) {
          const coords = geometry.map(g => [g.lon, g.lat]);
          const line = turf.lineString(coords);
          const pt = turf.point([pointLng, pointLat]);
          return turf.pointToLineDistance(pt, line, { units: 'meters' });
        } else if (geometry.length === 1) {
          const pt1 = turf.point([pointLng, pointLat]);
          const pt2 = turf.point([geometry[0].lon, geometry[0].lat]);
          return turf.distance(pt1, pt2, { units: 'meters' });
        }
      } catch (err) {
        console.warn('Turf.js calculation failed, falling back to sampling method:', err);
      }
    }

    // Fallback: sampling-based distance
    let minDistance = Infinity;

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

    waterways.forEach(function (way) {
      if (way.geometry) {
        const dist = distanceToWayGeometry(lat, lng, way.geometry);
        if (dist !== Infinity) {
          const name = (way.tags && (way.tags.name || way.tags.waterway)) || 'an unnamed waterway';
          const type = getWaterwayType(way);
          
          allWaterways.push({
            id: way.id,
            name: name,
            type: type,
            distance: Math.round(dist),
            tags: way.tags || {}
          });

          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestWaterwayName = name;
            nearestWaterwayType = type;
          }
        }
      }
    });

    // Sort by distance
    allWaterways.sort((a, b) => a.distance - b.distance);

    const scored = scoreRisk(nearestDistance, nearestWaterwayName, nearestWaterwayType);

    return {
      risk: scored.risk,
      colorClass: scored.colorClass,
      nearestDistance: Math.round(nearestDistance),
      nearestWaterwayName: nearestWaterwayName,
      nearestWaterwayType: nearestWaterwayType,
      elevation: elevation,
      message: scored.message,
      waterwaysFound: allWaterways.length,
      waterways: allWaterways
    };
  }

  return {
    calculateWaterwayRisk: calculateWaterwayRisk
  };

})();
