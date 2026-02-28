# 🗺️ Route Optimizer for Google Maps

A Chrome extension that automatically reorders your Google Maps stops into the shortest possible route — no API key, no sign-up, no cost.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

- **No API key required** — reads coordinates directly from the Google Maps URL
- **Two optimization engines** — built-in 3-opt solver runs instantly in your browser; optional OR-Tools server delivers near-optimal results via Guided Local Search
- **Lock start & end stops** — pin your first and last stop, let the optimizer rearrange everything in between
- **Geocoding fallback** — stops without coordinates are resolved automatically via Nominatim (OpenStreetMap)
- **Applies instantly** — rewrites the Google Maps directions URL with the optimized order in one click

---

## 🚀 Quick Start

### 1. Install the extension

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `route-optimizer-extension/` folder
5. The extension icon will appear in your toolbar

### 2. Use it

1. Open [Google Maps](https://www.google.com/maps) and build a multi-stop route in **Directions** mode (add at least 3 stops)
2. Click the Route Optimizer extension icon
3. Choose a **start** and **end** stop (or leave on Auto)
4. Click **Optimize Route**
5. Google Maps will reload with the stops reordered in the shortest sequence

---

## ⚙️ Optimization Engines

The extension automatically selects the best available engine:

| | Built-in 3-opt | OR-Tools Server |
|---|---|---|
| **Setup** | None — works out of the box | Requires local server (see below) |
| **Algorithm** | 3-opt local search | Guided Local Search metaheuristic |
| **Distance metric** | Manhattan-Haversine | Manhattan-Haversine |
| **Result quality** | Local minimum | Near-global minimum |
| **Speed** | Instant | ~1–3 s for 20 stops |
| **Indicator** | 🔴 Red dot | 🟢 Green dot |

---

## 🖥️ OR-Tools Server (Optional)

For larger routes or better accuracy, run the optional Python server locally or on a VPS.

### Option A — Python (local)

```bash
pip install ortools
cd route-optimizer-extension/server/
python optimizer_server.py
```

The server starts on `http://localhost:5748`. Reload the extension — the dot turns **green** automatically.

### Option B — Docker

```bash
cd route-optimizer-extension/server/
docker compose up -d
```

### Option C — VPS + Cloudflare Tunnel

See [`server/DEPLOY.md`](route-optimizer-extension/server/DEPLOY.md) for full instructions on deploying to a VPS with a public HTTPS endpoint via Cloudflare Tunnel.

---

## 📐 How It Works

### Coordinate extraction (priority order)

The extension tries four methods to get stop coordinates without any external API:

1. **`data=` URL parameter** — decodes `!1d<lon>!2d<lat>` pairs embedded by Google Maps *(most reliable)*
2. **URL path segments** — parses `@lat,lon` anchors from the `/maps/dir/` path
3. **`APP_INITIALIZATION_STATE`** — extracts coordinates from the page's JavaScript globals via an injected script
4. **Nominatim geocoding** — falls back to OpenStreetMap's free geocoding API for unresolved stop names

### Route optimization

**3-opt (built-in)**

Removes three edges from the route and tests all seven possible reconnections. Repeats until no improvement is found. The start and end stops are always fixed.

**OR-Tools (server)**

Uses Google's [OR-Tools](https://developers.google.com/optimization) constraint solver with:
- `PATH_CHEAPEST_ARC` for the initial solution
- `GUIDED_LOCAL_SEARCH` metaheuristic with a 5-second time limit

**Distance metric**

Both engines use **Manhattan-Haversine**: the north-south and east-west legs are each measured with the geodetically accurate Haversine formula, then summed. This models real grid-road travel better than straight-line (Euclidean) distance.

```
Manhattan-Haversine(A, B) = haversine(A.lat, A.lon → B.lat, A.lon)   ← N/S leg
                           + haversine(A.lat, A.lon → A.lat, B.lon)   ← E/W leg
```

---

## 🗂️ Project Structure

```
route-optimizer-extension/
├── manifest.json          # Chrome extension manifest (V3)
├── popup.html             # Extension popup UI
├── popup.js               # UI logic, geocoding, engine selection, OR-Tools client
├── optimizer.js           # Legacy 2-opt (retained for reference)
├── content.js             # Injected into Google Maps: extracts stops, applies route
├── debug.html             # Debug panel (accessible from the popup)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── server/
    ├── optimizer_server.py   # OR-Tools HTTP server
    ├── Dockerfile
    ├── docker-compose.yml
    ├── start_server.sh       # Linux/macOS quick-start script
    ├── start_server.bat      # Windows quick-start script
    ├── README.md             # Server-specific docs
    └── DEPLOY.md             # VPS + Cloudflare Tunnel deployment guide
```

---

## 🔒 Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the current Google Maps tab URL |
| `scripting` | Inject `content.js` to extract stops and apply the optimized route |
| `tabs` | Query the active tab and send messages to `content.js` |
| `https://www.google.com/maps/*` | Operate on Google Maps pages |
| `https://nominatim.openstreetmap.org/*` | Geocode stop names when coordinates are unavailable |
| `https://optimizer.muhamadmusta.in/*` | Connect to the optional OR-Tools server endpoint |

No browsing history, no personal data, no tracking.

---

## 🛠️ Development

### Running locally

Load the unpacked extension from `route-optimizer-extension/` (see Quick Start above).  
Changes to `popup.js` or `content.js` take effect after clicking **Reload** on `chrome://extensions`.

### Debugging

Click **Show Debug** in the popup to see a live log of:
- Which coordinate extraction method was used
- Raw stop coordinates
- Geocoding attempts and results
- Optimizer engine selected and distance saved

---

## 🤝 Contributing

Pull requests are welcome! If you find a bug or have a feature request, please [open an issue](../../issues).

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

- [OR-Tools](https://developers.google.com/optimization) by Google for the server-side TSP solver
- [Nominatim](https://nominatim.openstreetmap.org/) / OpenStreetMap for free geocoding
