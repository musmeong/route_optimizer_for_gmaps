const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const ORTOOLS_BASE = 'https://optimizer.(YOUR DOMAIN)';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── OR-Tools server detection ────────────────────────────────────────────
let ortoolsAvailable = false;

async function checkOrtoolsServer() {
  try {
    const res = await fetch(`${ORTOOLS_BASE}/ping`, { signal: AbortSignal.timeout(600) });
    const data = await res.json();
    ortoolsAvailable = data.status === 'ok';
  } catch {
    ortoolsAvailable = false;
  }
  updateEngineBadge();
  return ortoolsAvailable;
}

function updateEngineBadge() {
  const dot = document.querySelector('.algo-dot');
  const text = document.querySelector('.algo-text');
  if (ortoolsAvailable) {
    dot.style.background = '#27ae60';
    text.textContent = 'OR-Tools · Manhattan-Haversine · GLS meta';
  } else {
    dot.style.background = '#c0392b';
    text.textContent = '3-opt · Manhattan-Haversine  (server offline)';
  }
}

// ─── Debug panel ─────────────────────────────────────────────────────────
let debugVisible = false;
function dbg(msg) {
  const el = $('debugPanel');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}
function dbgClear() { $('debugPanel').textContent = ''; }

$('debugToggle').addEventListener('click', () => {
  debugVisible = !debugVisible;
  $('debugPanel').style.display = debugVisible ? 'block' : 'none';
  $('debugToggle').textContent = debugVisible ? 'Hide Debug' : 'Show Debug';
});

// ─── Geocoding fallback ───────────────────────────────────────────────────
async function nominatimQuery(query) {
  try {
    const res = await fetch(`${NOMINATIM_BASE}?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data?.length > 0) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch (e) { dbg('Nominatim error: ' + e.message); }
  return null;
}

async function geocodeStop(name) {
  const place = name.split(',')[0].trim();
  const city = name.match(/\b(Jakarta|Surabaya|Bandung|Tangerang|Bekasi|Depok|Bogor|Bali|Tokyo|Osaka|Singapore)\b/i);
  const candidates = [...new Set([name, place, city && `${place}, ${city[1]}`, `${place}, Indonesia`].filter(Boolean))];
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await sleep(1100);
    dbg(`  geocoding: "${candidates[i]}"`);
    const r = await nominatimQuery(candidates[i]);
    if (r) { dbg(`  ✅ found: ${r.lat}, ${r.lon}`); return r; }
  }
  return null;
}

async function resolveCoords(stops) {
  const out = []; let n = 0;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].hasCoords) { out.push(stops[i]); continue; }
    n++;
    setStatus(`Geocoding ${i + 1}/${stops.length}: ${stops[i].name.split(',')[0]}…`, 'info');
    if (n > 1) await sleep(1100);
    const coords = await geocodeStop(stops[i].name);
    if (!coords) throw new Error(`Could not locate: "${stops[i].name.split(',')[0]}"`);
    out.push({ ...stops[i], ...coords, hasCoords: true });
  }
  return out;
}

// ─── Distance: Manhattan-Haversine ───────────────────────────────────────
// Pure Haversine gives straight-line (L2) distance.
// Manhattan-Haversine gives L1 distance with geodetically accurate components:
//   NS component = haversine moving only in latitude  (same longitude)
//   EW component = haversine moving only in longitude (same latitude)
// This better models real grid-like road travel, and is always >= Haversine.

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dist(a, b) {
  const ns = haversineM(a.lat, a.lon, b.lat, a.lon); // north-south leg
  const ew = haversineM(a.lat, a.lon, a.lat, b.lon); // east-west leg
  return ns + ew;
}

function routeTotalDist(stops) {
  let d = 0;
  for (let i = 0; i < stops.length - 1; i++) d += dist(stops[i], stops[i + 1]);
  return d;
}

// ─── 3-opt local search ──────────────────────────────────────────────────
// Removes 3 edges and tries all 7 reconnections.
// Types 1-2 are pure 2-opt moves; types 3-7 are true 3-opt moves.
//
// P0=[0..i], P1=[i+1..j], P2=[j+1..k], P3=[k+1..n-1]
// A=route[i], B=route[i+1], C=route[j], D=route[j+1], E=route[k], F=route[k+1]
//
// Type | Arrangement               | New edges
//  1   | P0 + rP1 + P2  + P3      | A→C, B→D, E→F
//  2   | P0 + P1  + rP2 + P3      | A→B, C→E, D→F
//  3   | P0 + rP1 + rP2 + P3      | A→C, B→E, D→F
//  4   | P0 + P2  + P1  + P3      | A→D, E→B, C→F  ← true 3-opt
//  5   | P0 + P2  + rP1 + P3      | A→D, E→C, B→F  ← true 3-opt
//  6   | P0 + rP2 + P1  + P3      | A→E, D→B, C→F  ← true 3-opt
//  7   | P0 + rP2 + rP1 + P3      | A→E, D→C, B→F  ← true 3-opt

function applyThreeOpt(route, i, j, k, type) {
  const P0 = route.slice(0, i + 1);
  const P1 = route.slice(i + 1, j + 1);
  const P2 = route.slice(j + 1, k + 1);
  const P3 = route.slice(k + 1);
  const rP1 = [...P1].reverse();
  const rP2 = [...P2].reverse();
  switch (type) {
    case 1: return [...P0, ...rP1, ...P2, ...P3];
    case 2: return [...P0, ...P1, ...rP2, ...P3];
    case 3: return [...P0, ...rP1, ...rP2, ...P3];
    case 4: return [...P0, ...P2, ...P1, ...P3];
    case 5: return [...P0, ...P2, ...rP1, ...P3];
    case 6: return [...P0, ...rP2, ...P1, ...P3];
    case 7: return [...P0, ...rP2, ...rP1, ...P3];
  }
}

function threeOpt(route) {
  // route[0] and route[n-1] are ALWAYS fixed:
  //   - route[0] is in P0 (always first)
  //   - k is capped at n-2 so route[n-1] is always in P3 (always last)
  // The caller pre-moves selected start/end stops to positions 0 and n-1.

  const n = route.length;
  if (n < 4) return route.slice(); // need at least 4 stops for 3-opt

  let curr = route.slice();
  let improved = true;

  while (improved) {
    improved = false;
    let bestGain = 1e-9;
    let bestMove = null;

    for (let i = 0; i < n - 3; i++) {
      const A = curr[i], B = curr[i + 1];
      for (let j = i + 1; j < n - 2; j++) {
        const C = curr[j], D = curr[j + 1];
        for (let k = j + 1; k < n - 1; k++) {   // k < n-1 so F = curr[k+1] always valid
          const E = curr[k], F = curr[k + 1];
          const d0 = dist(A, B) + dist(C, D) + dist(E, F);

          const moves = [
            [dist(A, C) + dist(B, D) + dist(E, F), 1],
            [dist(A, B) + dist(C, E) + dist(D, F), 2],
            [dist(A, C) + dist(B, E) + dist(D, F), 3],
            [dist(A, D) + dist(E, B) + dist(C, F), 4],
            [dist(A, D) + dist(E, C) + dist(B, F), 5],
            [dist(A, E) + dist(D, B) + dist(C, F), 6],
            [dist(A, E) + dist(D, C) + dist(B, F), 7],
          ];

          for (const [newCost, type] of moves) {
            const gain = d0 - newCost;
            if (gain > bestGain) {
              bestGain = gain;
              bestMove = { i, j, k, type };
            }
          }
        }
      }
    }

    if (bestMove) {
      curr = applyThreeOpt(curr, bestMove.i, bestMove.j, bestMove.k, bestMove.type);
      improved = true;
    }
  }

  return curr;
}

function optimizeLocal(stops, startIdx, endIdx) {
  if (stops.length < 3) return { optimizedStops: stops, dBefore: 0, dAfter: 0, engine: '3-opt' };

  // Pre-move selected start/end to positions 0 and n-1 so threeOpt() locks them naturally
  let working = stops.slice();

  if (startIdx >= 0 && startIdx !== 0) {
    const [s] = working.splice(startIdx, 1);
    working.unshift(s);
    if (endIdx > 0 && endIdx < startIdx) endIdx++;
  }

  if (endIdx >= 0) {
    const endStop = stops[endIdx];
    const pos = working.indexOf(endStop);
    if (pos >= 0 && pos !== working.length - 1) {
      working.splice(pos, 1);
      working.push(endStop);
    }
  }

  const dBefore = routeTotalDist(working);
  const optimized = threeOpt(working);
  const dAfter = routeTotalDist(optimized);

  return {
    optimizedStops: optimized,
    dBefore,
    dAfter,
    engine: '3-opt',
    savingPct: dBefore > 0 ? +((dBefore - dAfter) / dBefore * 100).toFixed(1) : 0,
  };
}

// ─── OR-Tools optimizer (via local server) ────────────────────────────────
async function optimizeWithServer(stops, startIdx, endIdx) {
  const res = await fetch(`${ORTOOLS_BASE}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stops, startIdx, endIdx }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ─── UI helpers ───────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') { $('status').textContent = msg; $('status').className = type; }
function setLoading(on) { $('optimizeBtn').disabled = on; $('optimizeBtn').classList.toggle('loading', on); }

function showSteps(stops, startIdx, endIdx) {
  const hasStart = startIdx >= 0, hasEnd = endIdx >= 0;
  $('stepsList').innerHTML = stops.map((s, i) => {
    const label = s.name.split(',')[0];
    const isStart = i === 0 && hasStart;
    const isEnd = i === stops.length - 1 && hasEnd;
    const tag = isStart ? '<span class="step-tag">START</span>'
      : isEnd ? '<span class="step-tag">END</span>' : '';
    return `<div class="step-item">
      <span class="step-num">${String(i + 1).padStart(2, '0')}</span>
      ${tag}<span>${label}</span>
    </div>`;
  }).join('');
  $('steps').classList.add('visible');
}

async function ensureContentScript(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { action: 'PING' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(500);
  }
}

// ─── Populate dropdowns ───────────────────────────────────────────────────
let cachedStops = null;

function populateDropdowns(stops) {
  const selStart = $('selectStart'), selEnd = $('selectEnd');
  const prevS = selStart.value, prevE = selEnd.value;

  selStart.innerHTML = '<option value="auto">— Auto (best start) —</option>';
  selEnd.innerHTML = '<option value="auto">— Auto (best end) —</option>';

  stops.forEach((stop, i) => {
    const label = `${i + 1}. ${stop.name.split(',')[0].trim()}`;
    selStart.add(new Option(label, i));
    selEnd.add(new Option(label, i));
  });

  selStart.value = (prevS !== 'auto' && stops[parseInt(prevS)]) ? prevS : '0';
  selEnd.value = (prevE !== 'auto' && stops[parseInt(prevE)]) ? prevE : String(stops.length - 1);

  selStart.addEventListener('change', guardSelections);
  selEnd.addEventListener('change', guardSelections);
}

function guardSelections() {
  const selStart = $('selectStart'), selEnd = $('selectEnd');
  if (selStart.value !== 'auto' && selStart.value === selEnd.value) {
    const next = [...selEnd.options].map(o => o.value).find(v => v !== selStart.value);
    if (next) selEnd.value = next;
  }
}

async function loadStops() {
  const selStart = $('selectStart'), selEnd = $('selectEnd');
  selStart.classList.add('loading-select');
  selEnd.classList.add('loading-select');
  selStart.options[0].text = 'Loading stops…';
  selEnd.options[0].text = 'Loading stops…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url?.includes('google.com/maps')) return;
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STOPS' });
    if (response?.stops?.length >= 2) {
      cachedStops = response.stops;
      populateDropdowns(cachedStops);
    } else {
      selStart.options[0].text = '— Auto —';
      selEnd.options[0].text = '— Auto —';
    }
  } catch {
    selStart.options[0].text = '— Auto —';
    selEnd.options[0].text = '— Auto —';
  } finally {
    selStart.classList.remove('loading-select');
    selEnd.classList.remove('loading-select');
  }
}

// ─── Main optimize handler ────────────────────────────────────────────────
$('optimizeBtn').addEventListener('click', async () => {
  const startVal = $('selectStart').value;
  const endVal = $('selectEnd').value;
  const startIdx = startVal === 'auto' ? -1 : parseInt(startVal);
  const endIdx = endVal === 'auto' ? -1 : parseInt(endVal);

  $('status').textContent = ''; $('status').className = '';
  $('steps').classList.remove('visible');
  dbgClear();
  setLoading(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url?.includes('google.com/maps')) {
      setStatus('⚠️ Please open Google Maps directions first.', 'warning'); return;
    }

    setStatus('Connecting…', 'info');
    await ensureContentScript(tab.id);

    setStatus('Reading stops…', 'info');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STOPS' });

    dbg('=== RESPONSE ===');
    dbg(`stops: ${response.stops?.length ?? 0}  method: ${response.debug?.method}`);
    response.stops?.forEach((s, i) => {
      const coord = s.hasCoords ? `${s.lat?.toFixed(4)}, ${s.lon?.toFixed(4)}` : 'no coords';
      dbg(`${i + 1}. ${s.name.split(',')[0]}  [${coord}]`);
    });

    if (!response?.stops || response.stops.length < 2) {
      setStatus('⚠️ No stops found. Add stops in Google Maps directions first.', 'warning'); return;
    }

    const raw = response.stops;
    if (raw.length < 3) { setStatus('ℹ️ Need at least 3 stops to optimize.', 'info'); return; }

    const withCoords = raw.filter(s => s.hasCoords).length;
    if (withCoords < raw.length) setStatus(`Geocoding ${raw.length - withCoords} stop(s)…`, 'info');

    const resolved = await resolveCoords(raw);

    // ── Optimize ──
    let result;
    const serverUp = await checkOrtoolsServer();

    if (serverUp) {
      setStatus('Optimizing with OR-Tools…', 'info');
      dbg('\n=== OR-TOOLS SERVER ===');
      result = await optimizeWithServer(resolved, startIdx, endIdx);
      dbg(`engine: ${result.engine}  saving: ${result.savingPct}%  dist: ${result.dBefore}→${result.dAfter}m`);
    } else {
      setStatus('Optimizing with 3-opt…', 'info');
      dbg('\n=== 3-OPT LOCAL ===');
      result = optimizeLocal(resolved, startIdx, endIdx);
      dbg(`engine: ${result.engine}  saving: ${result.savingPct}%`);
    }

    showSteps(result.optimizedStops, startIdx, endIdx);

    const { dBefore: dB, dAfter: dA, savingPct } = result;
    if (dA < dB) {
      const distStr = serverUp ? `${(dA / 1000).toFixed(1)} km · ` : '';
      setStatus(`✅ ${distStr}~${savingPct}% shorter — Applying…`, 'success');
    } else {
      setStatus('✅ Already optimal — Applying…', 'success');
    }

    await sleep(900);
    await chrome.tabs.sendMessage(tab.id, { action: 'APPLY_ROUTE', optimizedStops: result.optimizedStops });

  } catch (err) {
    setStatus(`❌ ${err.message}`, 'error');
    dbg('ERROR: ' + err.message + '\n' + (err.stack || ''));
  } finally {
    setLoading(false);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────
checkOrtoolsServer();
loadStops();
