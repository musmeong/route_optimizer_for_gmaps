#!/usr/bin/env python3
"""
Route Optimizer — OR-Tools Server
===================================
Runs behind Cloudflare Tunnel on http://localhost:5748

Install once:
    pip install ortools
        OR just use Docker:
    docker compose up -d

Then add a Public Hostname in Cloudflare Zero Trust:
    Subdomain : optimizer
    Domain    : muhamadmusta.in
    Service   : HTTP  localhost:5748
"""

import json
import math
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 5748


def _haversine_component(lat1, lon1, lat2, lon2):
    """Raw Haversine between two lat/lon points in metres."""
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(h))


def manhattan_haversine_m(a, b):
    """
    Manhattan-Haversine: geodetically accurate L1 distance.
    NS + EW legs each measured with Haversine — always >= straight-line distance.
    """
    ns = _haversine_component(a["lat"], a["lon"], b["lat"], a["lon"])
    ew = _haversine_component(a["lat"], a["lon"], a["lat"], b["lon"])
    return ns + ew


def build_distance_matrix(stops):
    n = len(stops)
    return [
        [round(manhattan_haversine_m(stops[i], stops[j])) for j in range(n)]
        for i in range(n)
    ]


def solve_with_ortools(stops, start_idx, end_idx):
    from ortools.constraint_solver import routing_enums_pb2, pywrapcp

    n = len(stops)
    dist_matrix = build_distance_matrix(stops)

    if start_idx < 0:
        start_idx = 0
    if end_idx < 0:
        end_idx = start_idx

    manager = pywrapcp.RoutingIndexManager(n, 1, [start_idx], [end_idx])
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        return dist_matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit_cb_idx = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = 5

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        return stops, False

    route_indices = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        route_indices.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    route_indices.append(manager.IndexToNode(index))

    if route_indices and route_indices[0] == route_indices[-1] and len(route_indices) > 1:
        route_indices = route_indices[:-1]

    return [stops[i] for i in route_indices], True


def total_distance_m(stops):
    return sum(manhattan_haversine_m(stops[i], stops[i+1]) for i in range(len(stops)-1))


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")

    def send_json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        # Cloudflare adds its own CORS but we include ours too for local use
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            self.send_json(200, {"status": "ok", "engine": "OR-Tools"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/optimize":
            self.send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as e:
            self.send_json(400, {"error": f"invalid JSON: {e}"}); return

        stops     = data.get("stops", [])
        start_idx = int(data.get("startIdx", -1))
        end_idx   = int(data.get("endIdx",   -1))

        if len(stops) < 2:
            self.send_json(400, {"error": "need at least 2 stops"}); return

        for i, s in enumerate(stops):
            if "lat" not in s or "lon" not in s:
                self.send_json(400, {"error": f"stop {i} missing lat/lon"}); return

        print(f"  Optimizing {len(stops)} stops  start={start_idx}  end={end_idx}")
        d_before = total_distance_m(stops)

        try:
            optimized, used_ortools = solve_with_ortools(stops, start_idx, end_idx)
        except Exception as e:
            print(f"  OR-Tools error: {e}")
            self.send_json(500, {"error": str(e)}); return

        d_after = total_distance_m(optimized)
        self.send_json(200, {
            "optimizedStops": optimized,
            "dBefore":        round(d_before),
            "dAfter":         round(d_after),
            "engine":         "OR-Tools" if used_ortools else "fallback",
            "savingPct":      round((d_before - d_after) / d_before * 100, 1) if d_before > 0 else 0,
        })


if __name__ == "__main__":
    try:
        from ortools.constraint_solver import routing_enums_pb2, pywrapcp
        print("✅ OR-Tools loaded successfully")
    except ImportError:
        print("❌ OR-Tools not found. Install with:  pip install ortools")
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"🚀 Optimizer running on port {PORT}")
    print(f"   Cloudflare Tunnel → https://optimizer.muhamadmusta.in\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
