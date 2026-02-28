# Route Optimizer — OR-Tools Server

## Setup (one time)

```bash
pip install ortools
```

## Run

```bash
python optimizer_server.py
```

Keep the terminal open while using the extension.
The extension shows a **green dot** when the server is detected, and
falls back to the built-in 2-opt solver automatically if it's not running.

## How it works

```
Extension popup
    │
    ├─ GET  localhost:5748/ping        ← detect server
    └─ POST localhost:5748/optimize    ← send stops, get optimized order back
            │
            └─ OR-Tools TSP solver
                 • Haversine distance matrix (real great-circle distances)
                 • PATH_CHEAPEST_ARC first solution
                 • GUIDED_LOCAL_SEARCH meta-heuristic (up to 5 s)
```

## Why better than 2-opt

| Feature | Built-in 2-opt | OR-Tools |
|---|---|---|
| Distance metric | Manhattan (approx) | Haversine (accurate) |
| Algorithm | 2-opt local search | GLS + multiple restarts |
| Optimality | Local minimum | Near-global minimum |
| Result shown | Relative % | Actual km saved |
| Speed | Instant | ~1–3 s for 20 stops |
