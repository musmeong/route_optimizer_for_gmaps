// ─────────────────────────────────────────────────────────────────────────────
//  content.js  —  Route Optimizer v8.1
//
//  COORDINATE SOURCES (in priority order):
//    1. data= parameter in URL  →  !1d<lon>!2d<lat> pairs  (most reliable)
//    2. @lat,lon segments in URL path
//    3. window.APP_INITIALIZATION_STATE via injected script
//    4. Fallback: names only → popup geocodes via Nominatim
// ─────────────────────────────────────────────────────────────────────────────

// ── Parse coords from the data= parameter (e.g. !1d106.64!2d-6.29) ──────────
// Google Maps encodes each waypoint as a pair: !1d<longitude>!2d<latitude>
// They appear in waypoint order inside the data= fragment.
function parseCoordsFromDataParam(url) {
  const dataMatch = url.match(/[\/&?]data=([^?]+)/);
  if (!dataMatch) return [];

  let data;
  try { data = decodeURIComponent(dataMatch[1]); }
  catch { data = dataMatch[1]; }

  // Find all !1d<lon> !2d<lat> pairs — they always appear together in order
  const lonMatches = [...data.matchAll(/!1d(-?\d+\.\d+)/g)].map(m => parseFloat(m[1]));
  const latMatches = [...data.matchAll(/!2d(-?\d+\.\d+)/g)].map(m => parseFloat(m[1]));

  const coords = [];
  const n = Math.min(lonMatches.length, latMatches.length);
  for (let i = 0; i < n; i++) {
    const lat = latMatches[i], lon = lonMatches[i];
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      coords.push({ lat, lon, source: 'data-param' });
    }
  }
  return coords;
}

// ── Parse the /maps/dir/ URL for stop names (and inline @lat,lon if present) ─
function getStopsFromURL() {
  const url = window.location.href;
  if (!url.includes('/maps/dir/')) return null;

  // Extract just the path part (before ? or data=)
  const pathPart = url.split('?')[0];
  const dirPart  = pathPart.split('/maps/dir/')[1] || '';
  const rawSegments = dirPart.split('/').filter(Boolean);

  const stops = [];
  let pendingName = null;

  for (const raw of rawSegments) {
    let decoded;
    try { decoded = decodeURIComponent(raw.replace(/\+/g, ' ')).trim(); }
    catch { decoded = raw.trim(); }

    if (/^\d+z$/.test(decoded)) continue;   // zoom level like "13z"
    if (decoded.startsWith('data=')) continue;

    // Viewport anchor "@lat,lon,zoom"
    if (decoded.startsWith('@')) {
      const m = decoded.match(/^@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (m && pendingName) {
        const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          stops.push({ name: pendingName, lat, lon, hasCoords: true, source: 'url-path' });
          pendingName = null;
          continue;
        }
      }
      // viewport anchor with no pending name = map view, not a stop
      pendingName = null;
      continue;
    }

    // Inline "PlaceName/@lat,lon,16z"
    const inlineCoord = decoded.match(/^(.+?)\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (inlineCoord) {
      const name = inlineCoord[1].trim();
      const lat  = parseFloat(inlineCoord[2]);
      const lon  = parseFloat(inlineCoord[3]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && name) {
        stops.push({ name, lat, lon, hasCoords: true, source: 'url-inline' });
        pendingName = null;
        continue;
      }
    }

    // Plain name segment
    if (decoded && decoded.length > 1) {
      if (pendingName) stops.push({ name: pendingName, hasCoords: false });
      pendingName = decoded;
    }
  }

  if (pendingName) stops.push({ name: pendingName, hasCoords: false });

  return stops.length >= 2 ? stops : null;
}

// ── Read page-world globals via injected <script> tag ────────────────────────
function readPageState() {
  return new Promise((resolve) => {
    const id = '__routeOpt_' + Date.now();

    const handler = (e) => {
      if (e.data?.type !== '__ROUTE_OPT_STATE_REPLY' || e.data?.id !== id) return;
      window.removeEventListener('message', handler);
      resolve(e.data.payload);
    };
    window.addEventListener('message', handler);
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 1000);

    const script = document.createElement('script');
    script.textContent = `(function(){
      var id = ${JSON.stringify(id)};
      var candidates = [];
      try { if (window.APP_INITIALIZATION_STATE) candidates.push(window.APP_INITIALIZATION_STATE); } catch(e){}
      try { if (window.__initData) candidates.push(window.__initData); } catch(e){}
      window.postMessage({ type: '__ROUTE_OPT_STATE_REPLY', id: id, payload: candidates }, '*');
    })();`;
    document.documentElement.appendChild(script);
    script.remove();
  });
}

// ── Recursively extract [lat, lon] pairs from a nested JS object ─────────────
function extractCoordsFromValue(val, found = [], depth = 0) {
  if (depth > 25 || !val || typeof val !== 'object') return found;
  if (Array.isArray(val)) {
    if (val.length === 2 &&
        typeof val[0] === 'number' && typeof val[1] === 'number' &&
        val[0] >= -90 && val[0] <= 90 && val[0] !== 0 &&
        val[1] >= -180 && val[1] <= 180 && val[1] !== 0) {
      found.push({ lat: val[0], lon: val[1] });
      return found;
    }
    for (const item of val) extractCoordsFromValue(item, found, depth + 1);
  } else {
    for (const v of Object.values(val)) extractCoordsFromValue(v, found, depth + 1);
  }
  return found;
}

function dedupeCoords(coords) {
  const out = [];
  for (const c of coords) {
    const near = out.some(d => {
      const dx = (c.lon - d.lon) * 91, dy = (c.lat - d.lat) * 111;
      return Math.sqrt(dx*dx + dy*dy) < 0.05;
    });
    if (!near) out.push(c);
  }
  return out;
}

// ── Build Google Maps directions URL from a list of stops ────────────────────
function buildMapsURL(stops) {
  const parts = stops.map(s => {
    const name = encodeURIComponent(s.name);
    return (s.lat && s.lon) ? `${name}/@${s.lat},${s.lon},16z` : name;
  });
  return `https://www.google.com/maps/dir/${parts.join('/')}/`;
}

// ── Main message handler ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'PING') {
    sendResponse({ alive: true });
    return true;
  }

  if (message.action === 'GET_STOPS') {
    (async () => {
      const url = window.location.href;
      const debugInfo = { url, method: 'unknown' };

      const urlStops = getStopsFromURL();
      debugInfo.urlStops = urlStops ? urlStops.length : 0;

      if (!urlStops) {
        sendResponse({ stops: null, captureCount: 0, debug: debugInfo });
        return;
      }

      // ── Priority 1: data= parameter (most complete and reliable) ────────
      const dataCoords = parseCoordsFromDataParam(url);
      debugInfo.dataCoordsFound = dataCoords.length;

      if (dataCoords.length >= urlStops.length) {
        const stops = urlStops.map((stop, i) => ({
          ...stop,
          lat: dataCoords[i].lat,
          lon: dataCoords[i].lon,
          hasCoords: true,
          source: 'data-param',
        }));
        debugInfo.method = 'data-param';
        sendResponse({ stops, captureCount: dataCoords.length, debug: debugInfo });
        return;
      }

      // ── Priority 2: URL path already has coords ──────────────────────────
      if (urlStops.every(s => s.hasCoords)) {
        debugInfo.method = 'url-path-coords';
        sendResponse({ stops: urlStops, captureCount: urlStops.length, debug: debugInfo });
        return;
      }

      // ── Priority 3: APP_INITIALIZATION_STATE ─────────────────────────────
      const candidates = await readPageState();
      let pageCoords = [];
      if (candidates && Array.isArray(candidates)) {
        for (const blob of candidates) {
          const found = dedupeCoords(extractCoordsFromValue(blob));
          if (found.length > pageCoords.length) pageCoords = found;
        }
      }
      debugInfo.pageCoordsFound = pageCoords.length;

      if (pageCoords.length >= urlStops.length) {
        const stops = urlStops.map((stop, i) => ({
          ...stop,
          lat: pageCoords[i].lat,
          lon: pageCoords[i].lon,
          hasCoords: true,
          source: 'page-state',
        }));
        debugInfo.method = 'page-state';
        sendResponse({ stops, captureCount: pageCoords.length, debug: debugInfo });
        return;
      }

      // ── Priority 4: fallback — names only, popup will geocode ────────────
      debugInfo.method = 'url-names-only';
      sendResponse({ stops: urlStops, captureCount: 0, debug: debugInfo });
    })();

    return true;
  }

  if (message.action === 'APPLY_ROUTE') {
    window.location.href = buildMapsURL(message.optimizedStops);
    sendResponse({ success: true });
    return true;
  }
});
