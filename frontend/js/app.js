// app.js
// Initializes the Leaflet map with dark/light themes, handles clicks and searches,
// manages tab-switching, history logging, and renders detailed results.

(function () {

  // Theme-aware Leaflet Tile Configurations
  const lightTileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
  const darkTileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const map = L.map('map').setView([5.6037, -0.1870], 11); // Accra, Ghana

  let currentTileLayer = null;
  let currentMarker = null;
  let currentResult = null;
  let lastSearchName = null;
  let backendOnline = false;

  const resultContent = document.getElementById('result-content');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const ghanapostInput = document.getElementById('ghanapost-input');
  const ghanapostBtn = document.getElementById('ghanapost-btn');
  const connectionStatusEl = document.getElementById('connection-status');
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeBtnText = document.getElementById('theme-btn-text');
  const sunIcon = themeToggleBtn.querySelector('.sun-icon');
  const moonIcon = themeToggleBtn.querySelector('.moon-icon');

  // Detect API Endpoint base
  const API_BASE = window.location.origin.startsWith('http')
    ? ''
    : 'http://localhost:3000';

  // --- Theme toggling ---
  function getSavedTheme() {
    return localStorage.getItem('theme') || 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    if (currentTileLayer) {
      map.removeLayer(currentTileLayer);
    }
    const tileUrl = theme === 'dark' ? darkTileUrl : lightTileUrl;
    currentTileLayer = L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);

    if (theme === 'dark') {
      themeBtnText.textContent = 'Light Mode';
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    } else {
      themeBtnText.textContent = 'Dark Mode';
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  // Apply initial theme
  applyTheme(getSavedTheme());

  // --- Connection checking ---
  async function checkBackendConnection() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        backendOnline = true;
        connectionStatusEl.className = 'connection-badge connected';
        connectionStatusEl.querySelector('.status-text').textContent = 'Backend: Online';
      } else {
        throw new Error();
      }
    } catch (e) {
      backendOnline = false;
      connectionStatusEl.className = 'connection-badge offline';
      connectionStatusEl.querySelector('.status-text').textContent = 'Backend: Offline';
    }
  }

  checkBackendConnection();
  setInterval(checkBackendConnection, 20000);

  // --- Geocoding & screening logic ---
  async function geocodeGhanaPostAddress(address) {
    const cleanAddress = address.trim().toUpperCase();
    try {
      const response = await fetch('https://ghanapostgps.sperixlabs.org/get-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `address=${encodeURIComponent(cleanAddress)}`
      });

      if (!response.ok) throw new Error();
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
    resultContent.innerHTML = `
      <div class="loading-text">
        <div class="loading-spinner"></div>
        <span>Screening waterway buffer risk…</span>
      </div>
    `;
    document.getElementById('hydro-list').innerHTML = `
      <div class="loading-text">
        <div class="loading-spinner"></div>
        <span>Analyzing local hydrology datasets…</span>
      </div>
    `;
  }

  function renderError(msg) {
    resultContent.innerHTML = `<p class="loading-text" style="color:var(--risk-high);">${msg}</p>`;
    document.getElementById('hydro-list').innerHTML = `<p class="loading-text" style="color:var(--risk-high);">${msg}</p>`;
  }

  function getRiskScorePercentage(risk) {
    switch (risk) {
      case 'CRITICAL': return 100;
      case 'HIGH': return 80;
      case 'MODERATE': return 50;
      case 'LOW': return 20;
      default: return 0;
    }
  }

  function renderResult(result, lat, lng, ghanapostLocation = null) {
    const distanceLine = result.nearestDistance !== null
      ? `Nearest waterway: <strong>${result.nearestDistance}m</strong> (${result.nearestWaterwayName})`
      : 'No mapped waterway found within 500m';

    const elevationLine = result.elevation !== null
      ? `<br>Elevation: <strong>${Math.round(result.elevation)}m</strong> above sea level`
      : '';

    const locationLine = ghanapostLocation
      ? `Plot Address: <strong>${ghanapostLocation.area || ''} • ${ghanapostLocation.district || ''}</strong><br>`
      : '';

    const percentage = getRiskScorePercentage(result.risk);
    const riskClass = result.colorClass.replace('risk-', ''); // low, moderate, high, critical

    resultContent.innerHTML = `
      <div class="risk-card ${result.colorClass}">
        <div class="risk-header">
          <svg class="tier-icon" aria-hidden="true"><use href="#icon-rings"></use></svg>
          <span class="risk-label">${result.risk} RISK STATUS</span>
        </div>
        <p class="risk-message">${result.message}</p>
        
        <div class="risk-gauge-container">
          <div class="gauge-title">Riparian Buffer Risk Scale</div>
          <div class="gauge-track">
            <div class="gauge-bar ${riskClass}" style="width: ${percentage}%"></div>
          </div>
          <div class="gauge-labels">
            <span>Low</span>
            <span>Moderate</span>
            <span>High</span>
            <span>Critical</span>
          </div>
        </div>

        <div class="risk-meta">
          ${distanceLine}${elevationLine}<br>
          Waterways in 500m area: <strong>${result.waterwaysFound}</strong><br>
          ${locationLine}
          GPS Coords: <strong>${lat.toFixed(5)}, ${lng.toFixed(5)}</strong>
        </div>
        <div class="action-buttons">
          <button class="action-btn" onclick="shareResult(event)">Share Screening</button>
          <button class="action-btn" onclick="exportResult()">Download Report</button>
        </div>
      </div>
    `;

    currentResult = { result, lat, lng, ghanapostLocation };
  }

  function renderHydrology(result) {
    const hydroList = document.getElementById('hydro-list');
    const waterways = result.waterways || [];

    if (waterways.length === 0) {
      hydroList.innerHTML = '<p class="placeholder-text">No mapped waterways found within 500m of this location.</p>';
      return;
    }

    let html = '<div class="waterway-list">';
    waterways.forEach(way => {
      const typeClass = ['river', 'stream', 'drain'].includes(way.type) ? way.type : 'other';
      const typeLabel = way.type === 'river' ? 'River/Lake' : way.type === 'stream' ? 'Stream/Canal' : way.type === 'drain' ? 'Drain/Ditch' : 'Waterway';
      
      html += `
        <div class="waterway-item">
          <div class="waterway-info">
            <span class="waterway-name" title="${way.name}">${way.name}</span>
            <span class="waterway-type-tag ${typeClass}">${typeLabel}</span>
          </div>
          <span class="waterway-distance">${way.distance}m</span>
        </div>
      `;
    });
    html += '</div>';

    hydroList.innerHTML = html;
  }

  // --- History features ---
  function getLocalHistory() {
    try {
      return JSON.parse(localStorage.getItem('check_history')) || [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalHistory(item) {
    let history = getLocalHistory();
    // Dedup coordinates
    history = history.filter(h => Math.abs(h.lat - item.lat) > 0.00001 || Math.abs(h.lng - item.lng) > 0.00001);
    history.unshift(item);
    if (history.length > 20) history.pop();
    localStorage.setItem('check_history', JSON.stringify(history));
    renderHistory();
  }

  function renderHistoryItems(items) {
    const historyList = document.getElementById('history-list');

    if (!items || items.length === 0) {
      historyList.innerHTML = '<p class="placeholder-text">Your search history is empty.</p>';
      return;
    }

    let html = '<div class="history-list">';
    items.forEach((item, index) => {
      const result = item.result || {};
      const riskClass = (result.colorClass || 'risk-low').replace('risk-', '');
      const name = item.name || (item.lat != null && item.lng != null
        ? `Map Pin (${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lng).toFixed(4)})`
        : 'Unknown location');
      const ts = item.timestamp || item.created_at;
      const dateString = ts ? new Date(ts).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : '';
      const isRemote = !!item._remote;

      html += `
        <div class="history-item" onclick="loadHistoryItem(${index})" title="${isRemote ? 'From database' : 'From local storage'}">
          <div class="history-header">
            <span class="history-name" title="${name}">${name}</span>
            <span class="history-badge ${riskClass}">${result.risk || 'N/A'}</span>
          </div>
          <div class="history-meta">
            <span>Distance: ${result.nearestDistance != null ? result.nearestDistance + 'm' : 'N/A'}</span>
            <span>${isRemote ? '☁ ' : ''}${dateString}</span>
          </div>
        </div>
      `;
    });
    html += '</div>';

    historyList.innerHTML = html;
  }

  async function fetchAndRenderHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '<div class="loading-text"><div class="loading-spinner"></div><span>Loading history…</span></div>';

    // Always start with local entries
    let merged = [...getLocalHistory()];

    // Attempt to pull remote database history if backend is online
    if (backendOnline) {
      try {
        const res = await fetch(`${API_BASE}/api/history`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.data)) {
            const remote = data.data.map(row => ({
              lat: row.lat,
              lng: row.lng,
              name: (row.result && row.result.plotName) || null,
              result: row.result || {},
              timestamp: row.created_at,
              ghanapostLocation: null,
              _remote: true
            }));

            // Merge: skip remote entries already covered by a local one (within ~100m)
            remote.forEach(remoteItem => {
              const alreadyPresent = merged.some(
                h => Math.abs(h.lat - remoteItem.lat) < 0.001 && Math.abs(h.lng - remoteItem.lng) < 0.001
              );
              if (!alreadyPresent) merged.push(remoteItem);
            });

            // Sort newest first
            merged.sort((a, b) => {
              const ta = new Date(a.timestamp || a.created_at || 0).getTime();
              const tb = new Date(b.timestamp || b.created_at || 0).getTime();
              return tb - ta;
            });
          }
        }
      } catch (e) {
        console.warn('Failed to fetch remote history:', e);
      }
    }

    // Store for loadHistoryItem to access by index
    window._mergedHistory = merged;
    renderHistoryItems(merged);
  }

  function renderHistory() {
    fetchAndRenderHistory();
  }

  window.loadHistoryItem = function (index) {
    // Use merged history (remote + local) if available, fall back to local-only
    const history = window._mergedHistory || getLocalHistory();
    const item = history[index];
    if (item) {
      map.setView([item.lat, item.lng], 16);
      
      if (currentMarker) map.removeLayer(currentMarker);
      currentMarker = L.marker([item.lat, item.lng]).addTo(map);

      currentResult = {
        result: item.result,
        lat: item.lat,
        lng: item.lng,
        ghanapostLocation: item.ghanapostLocation || null
      };

      switchTab('risk');
      renderResult(item.result, item.lat, item.lng, item.ghanapostLocation);
      renderHydrology(item.result);
      
      const popupColor = {
        'risk-critical': 'var(--risk-high)',
        'risk-high': 'var(--risk-high)',
        'risk-moderate': 'var(--risk-moderate)',
        'risk-low': 'var(--risk-low)'
      };
      
      currentMarker.bindPopup(
        `<strong style="color:${popupColor[item.result.colorClass]}">${item.result.risk} RISK</strong><br>${item.result.message}`
      ).openPopup();
    }
  };

  async function saveCheckToDatabase(lat, lng, result, addressName) {
    if (!backendOnline) return;
    try {
      await fetch(`${API_BASE}/api/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'public-user',
          lat,
          lng,
          result: {
            risk: result.risk,
            colorClass: result.colorClass,
            nearestDistance: result.nearestDistance,
            nearestWaterwayName: result.nearestWaterwayName,
            nearestWaterwayType: result.nearestWaterwayType,
            elevation: result.elevation,
            message: result.message,
            waterwaysFound: result.waterwaysFound,
            plotName: addressName
          }
        })
      });
    } catch (e) {
      console.warn('Failed to sync check with backend database:', e);
    }
  }

  // --- Main coordinate screening flow ---
  async function checkLocation(lat, lng, ghanapostLocation = null) {
    if (currentMarker) {
      map.removeLayer(currentMarker);
    }
    currentMarker = L.marker([lat, lng]).addTo(map);
    map.panTo([lat, lng]);

    renderLoading();
    switchTab('risk');

    let result = null;
    let name = lastSearchName || `Map Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    lastSearchName = null; // reset

    try {
      // 1. Try querying backend route
      if (backendOnline) {
        try {
          const res = await fetch(`${API_BASE}/api/risk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, plotName: name })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              result = data;
            }
          }
        } catch (e) {
          console.warn('Backend screening failed, falling back to local calculation:', e);
        }
      }

      // 2. Fallback to client-side calculator
      if (!result) {
        result = await RiskCalculator.calculateWaterwayRisk(lat, lng);
      }

      // 3. Render results panels
      renderResult(result, lat, lng, ghanapostLocation);
      renderHydrology(result);

      // 4. Save to history
      saveLocalHistory({
        lat,
        lng,
        name,
        result,
        ghanapostLocation,
        timestamp: Date.now()
      });

      // 5. Async log to backend Supabase database
      saveCheckToDatabase(lat, lng, result, name);

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
      renderError('Proximity screening failed. The API server may be busy — please try again in a moment.');
    }
  }

  // --- Map Click Handlers ---
  map.on('click', function (e) {
    checkLocation(e.latlng.lat, e.latlng.lng);
  });

  // --- Address search (Nominatim) ---
  async function searchAddress() {
    const query = searchInput.value.trim();
    if (!query) return;

    renderLoading();

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Ghana')}&limit=1`;
      const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await response.json();

      if (results.length === 0) {
        renderError('Location not found. Try a different place name, or click the map directly.');
        return;
      }

      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      lastSearchName = results[0].display_name.split(',')[0];
      
      map.setView([lat, lng], 15);
      checkLocation(lat, lng);

    } catch (err) {
      console.error(err);
      renderError('Search failed. Please try again or drop a pin manually.');
    }
  }

  // --- GhanaPost GPS Lookup ---
  async function checkGhanaPostAddress() {
    const address = ghanapostInput.value.trim().toUpperCase();
    if (!address) return;

    renderLoading();

    const location = await geocodeGhanaPostAddress(address);
    if (!location) {
      renderError('GPS address not found. Verify format (e.g. GS-0988-0986) or try another.');
      return;
    }

    lastSearchName = address;
    map.setView([location.lat, location.lng], 16);
    checkLocation(location.lat, location.lng, location);
  }

  // --- Tab switching handler ---
  window.switchTab = function (tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.getElementById(`tab-btn-${tabName}`).classList.add('active');
    document.getElementById(`tab-content-${tabName}`).classList.add('active');

    // Refresh history when switching to that tab
    if (tabName === 'history') {
      renderHistory();
    }
  };

  // --- Clipboard helper with execCommand fallback ---
  function copyTextToClipboard(text) {
    // Modern Async Clipboard API (requires HTTPS / secure context)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback: temporary off-screen textarea + execCommand
    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        success ? resolve() : reject(new Error('execCommand copy failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
      }
    });
  }

  // --- Export and Share Actions ---
  window.shareResult = function (event) {
    if (!currentResult) return;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', currentResult.lat);
    url.searchParams.set('lng', currentResult.lng);
    const btn = event.target;
    const originalText = btn.textContent;

    copyTextToClipboard(url.toString())
      .then(() => {
        btn.textContent = 'Link Copied!';
        btn.style.background = 'var(--risk-low)';
        btn.style.borderColor = 'var(--risk-low)';
        btn.style.color = '#fff';
      })
      .catch(() => {
        btn.textContent = 'Copy failed — use address bar';
        btn.style.background = 'var(--risk-moderate)';
        btn.style.borderColor = 'var(--risk-moderate)';
        btn.style.color = '#fff';
      })
      .finally(() => {
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.borderColor = '';
          btn.style.color = '';
        }, 2500);
      });
  };

  window.exportResult = function () {
    if (!currentResult) return;
    const { result, lat, lng, ghanapostLocation } = currentResult;
    
    const elevationLine = result.elevation !== null
      ? `Elevation: ${Math.round(result.elevation)}m above sea level`
      : 'Elevation: Not available';
    
    const waterwaysFoundLine = `Waterways Found: ${result.waterwaysFound} within 500m`;
    const dateString = new Date().toLocaleString();

    let waterwaysSection = '';
    if (result.waterways && result.waterways.length > 0) {
      waterwaysSection = '\nNEARBY WATERWAYS DETAIL\n-----------------------\n';
      result.waterways.forEach((w, i) => {
        waterwaysSection += `${i + 1}. Name: ${w.name}\n   Type: ${w.type}\n   Proximity: ${w.distance}m\n\n`;
      });
    }

    const report = `
==================================================
        WATERWAY RISK SCREENING REPORT
==================================================
Date generated : ${dateString}
Coordinates    : ${lat.toFixed(6)}, ${lng.toFixed(6)}
${ghanapostLocation ? `GhanaPost GPS  : ${ghanapostLocation.region || ''} • ${ghanapostLocation.district || ''}
District       : ${ghanapostLocation.area || ''}` : ''}
--------------------------------------------------
RISK TIER      : [ ${result.risk} RISK ]
Nearest River  : ${result.nearestDistance ? result.nearestDistance + 'm (' + result.nearestWaterwayName + ')' : 'None found within 500m'}
${elevationLine}
${waterwaysFoundLine}
--------------------------------------------------
ASSESSMENT SUMMARY:
${result.message}

${waterwaysSection}
--------------------------------------------------
DISCLAIMER:
This screening report is provided for informational and preliminary
planning purposes only. It is based on crowd-sourced OpenStreetMap
records and public elevation models. This report does NOT constitute
official legal land clearance, survey, or environmental zoning approval.
Verify all buffer rules and title details with the Ghana Lands
Commission, Water Resources Commission (WRC), or a licensed surveyor
prior to executing transactions or starting physical construction.
==================================================
    `.trim();
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waterway-risk-report-${lat.toFixed(4)}-${lng.toFixed(4)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Startup ---
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

  renderHistory();
  checkUrlParams();

})();
