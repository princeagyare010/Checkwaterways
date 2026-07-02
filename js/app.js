// app.js
// Initializes the Leaflet map, handles clicks and search, and renders risk results.

(function () {

  const map = L.map('map').setView([5.6037, -0.1870], 11); // Accra, Ghana

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  let currentMarker = null;
  let currentResult = null;

  const resultContent = document.getElementById('result-content');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const ghanapostInput = document.getElementById('ghanapost-input');
  const ghanapostBtn = document.getElementById('ghanapost-btn');

  // GhanaPost GPS geocoding
  async function geocodeGhanaPostAddress(address) {
    const cleanAddress = address.trim().toUpperCase();
    try {
      const response = await fetch('https://ghanapostgps.sperixlabs.org/get-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `address=${encodeURIComponent(cleanAddress)}`
      });

      if (!response.ok) {
        throw new Error('GhanaPost API request failed: ' + response.status);
      }

      const data = await response.json();

      if (data.found && data.data && data.data.Table && data.data.Table.length > 0) {
        const location = data.data.Table[0];
        return {
          lat: parseFloat(location.NLat) || parseFloat(location.SLat),
          lng: parseFloat(location.WLong) || parseFloat(location.Elong),
          region: location.Region,
          district: location.District,
          area: location.Area
        };
      }
      return null;
    } catch (err) {
      console.error('GhanaPost geocoding error:', err);
      return null;
    }
  }

  function renderLoading() {
    resultContent.innerHTML = '<p class="loading-text">Checking nearby waterways…</p>';
  }

  function renderError(msg) {
    resultContent.innerHTML = `<p class="loading-text" style="color:#AE3A2E;">${msg}</p>`;
  }

  function renderResult(result, lat, lng, ghanapostLocation = null) {
    const distanceLine = result.nearestDistance !== null
      ? `Nearest waterway → ${result.nearestDistance}m`
      : 'No mapped waterway found nearby';

    const elevationLine = result.elevation !== null
      ? `<br>Elevation: ${Math.round(result.elevation)}m above sea level`
      : '';

    const locationLine = ghanapostLocation
      ? `${ghanapostLocation.area || ''} • ${ghanapostLocation.district || ''}<br>`
      : '';

    resultContent.innerHTML = `
      <div class="risk-card ${result.colorClass}">
        <div class="risk-header">
          <svg class="tier-icon" aria-hidden="true"><use href="#icon-rings"></use></svg>
          <span class="risk-label">${result.risk} RISK</span>
        </div>
        <p class="risk-message">${result.message}</p>
        <div class="risk-meta">
          ${distanceLine}<br>
          Waterways within 500m: ${result.waterwaysFound}${elevationLine}<br>
          ${locationLine}
          ${lat.toFixed(5)}, ${lng.toFixed(5)}
        </div>
        <div class="action-buttons">
          <button class="action-btn" onclick="shareResult()">Share</button>
          <button class="action-btn" onclick="exportResult()">Export PDF</button>
        </div>
      </div>
    `;

    currentResult = { result, lat, lng, ghanapostLocation };
  }

  async function checkLocation(lat, lng, ghanapostLocation = null) {
    if (currentMarker) {
      map.removeLayer(currentMarker);
    }
    currentMarker = L.marker([lat, lng]).addTo(map);
    map.panTo([lat, lng]);

    renderLoading();

    try {
      const result = await RiskCalculator.calculateWaterwayRisk(lat, lng);
      renderResult(result, lat, lng, ghanapostLocation);

      const popupColor = {
        'risk-critical': 'var(--risk-high)',
        'risk-high': 'var(--risk-high)',
        'risk-moderate': 'var(--risk-moderate)',
        'risk-low': 'var(--risk-low)'
      };

      currentMarker.bindPopup(
        `<strong style="color:${popupColor[result.colorClass]}">${result.risk} RISK</strong><br>${result.message}`
      ).openPopup();

    } catch (err) {
      console.error(err);
      renderError('Could not check this location right now. The data service may be busy — please try again in a moment.');
    }
  }

  map.on('click', function (e) {
    checkLocation(e.latlng.lat, e.latlng.lng);
  });

  // Address search using Nominatim (OpenStreetMap's free geocoder)
  async function searchAddress() {
    const query = searchInput.value.trim();
    if (!query) return;

    renderLoading();

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Ghana')}&limit=1`;
      const response = await fetch(url, {
        headers: { 'Accept-Language': 'en' }
      });
      const results = await response.json();

      if (results.length === 0) {
        renderError('Location not found. Try a more specific place name, or drop a pin on the map instead.');
        return;
      }

      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      map.setView([lat, lng], 15);
      checkLocation(lat, lng);

    } catch (err) {
      console.error(err);
      renderError('Search failed. Please try again or use the map directly.');
    }
  }

  // GhanaPost GPS address lookup
  async function checkGhanaPostAddress() {
    const address = ghanapostInput.value.trim().toUpperCase();
    if (!address) return;

    renderLoading();

    const location = await geocodeGhanaPostAddress(address);
    if (!location) {
      renderError('Address not found. Check format (e.g., GS-0988-0986) or try another location.');
      return;
    }

    map.setView([location.lat, location.lng], 16);
    checkLocation(location.lat, location.lng, location);
  }

  // Share and Export functions
  window.shareResult = function() {
    if (!currentResult) return;
    const url = new URL(window.location);
    url.searchParams.set('lat', currentResult.lat);
    url.searchParams.set('lng', currentResult.lng);
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = event.target;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Share', 2000);
    });
  };

  window.exportResult = function() {
    if (!currentResult) return;
    const { result, lat, lng, ghanapostLocation } = currentResult;
    
    const elevationLine = result.elevation !== null
      ? `Elevation: ${Math.round(result.elevation)}m above sea level\n`
      : '';
    
    // Create a simple text-based report
    const report = `
WATERWAY RISK REPORT
====================

Risk Level: ${result.risk}
Nearest Waterway: ${result.nearestDistance ? result.nearestDistance + 'm' : 'None found within 500m'}
Waterways in Area: ${result.waterwaysFound}
${elevationLine}
Location:
${ghanapostLocation ? `Area: ${ghanapostLocation.area}
District: ${ghanapostLocation.district}
Region: ${ghanapostLocation.region}
` : ''}
Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}

${result.message}

---
Generated by Waterway Risk Checker - Ghana
    `.trim();
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waterway-risk-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Check URL params on load
  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('lat');
    const lng = params.get('lng');
    if (lat && lng) {
      checkLocation(parseFloat(lat), parseFloat(lng));
    }
  }

  searchBtn.addEventListener('click', searchAddress);
  searchInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchAddress();
  });

  ghanapostBtn.addEventListener('click', checkGhanaPostAddress);
  ghanapostInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') checkGhanaPostAddress();
  });

  checkUrlParams();

})();
