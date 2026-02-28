// ─────────────────────────────────────────────
//  optimizer.js — Manhattan distance + 2-opt
//  No external API needed. Pure math.
// ─────────────────────────────────────────────

/**
 * Convert degrees to kilometers (rough approximation)
 * Tokyo area: 1° lat ≈ 111 km, 1° lon ≈ 91 km
 */
function toKm(lat, lon) {
  return {
    x: lon * 91.0,   // longitude → km (Tokyo-adjusted)
    y: lat * 111.0   // latitude  → km
  };
}

/**
 * Manhattan distance between two (lat, lon) points
 * Returns distance in km
 *
 * Why Manhattan and not Euclidean?
 * Cities have grid roads — you can't cut diagonally through buildings.
 * Manhattan distance (|Δx| + |Δy|) better represents real urban travel.
 */
function manhattanDistance(pointA, pointB) {
  const a = toKm(pointA.lat, pointA.lon);
  const b = toKm(pointB.lat, pointB.lon);
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

/**
 * Build an N×N distance matrix from a list of points
 * Each entry matrix[i][j] = Manhattan distance from stop i to stop j
 */
function buildDistanceMatrix(stops) {
  const n = stops.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = manhattanDistance(stops[i], stops[j]);
      }
    }
  }
  return matrix;
}

/**
 * Total route distance given a route (array of indices) and distance matrix
 */
function totalDistance(route, matrix) {
  let dist = 0;
  for (let i = 0; i < route.length - 1; i++) {
    dist += matrix[route[i]][route[i + 1]];
  }
  return dist;
}

/**
 * 2-opt algorithm
 *
 * How it works:
 * 1. Start with any route
 * 2. Try every pair of stops — swap their order (reverse the segment between them)
 * 3. If the new route is shorter → keep it
 * 4. Repeat until no swap improves the route
 *
 * @param {number[]} route       - Array of stop indices, e.g. [0, 1, 2, 3, 4]
 * @param {number[][]} matrix    - Distance matrix
 * @param {boolean} lockStart    - If true, stop[0] stays fixed
 * @param {boolean} lockEnd      - If true, stop[last] stays fixed
 * @returns {number[]} Optimized route (array of indices)
 */
function twoOpt(route, matrix, lockStart = true, lockEnd = true) {
  let best = [...route];
  let improved = true;

  // Determine which indices are allowed to move
  // If lockStart → index 0 stays, so inner loop starts at 1
  // If lockEnd   → last index stays, so inner loop ends before last
  const startIdx = lockStart ? 1 : 0;
  const endIdx   = lockEnd   ? best.length - 1 : best.length;

  while (improved) {
    improved = false;

    for (let i = startIdx; i < endIdx - 1; i++) {
      for (let j = i + 1; j < endIdx; j++) {

        // Reverse the segment between i and j
        const newRoute = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1)
        ];

        // Keep the swap if it's shorter
        if (totalDistance(newRoute, matrix) < totalDistance(best, matrix)) {
          best = newRoute;
          improved = true;
        }
      }
    }
  }

  return best;
}

/**
 * Main optimize function
 *
 * @param {Array<{name: string, lat: number, lon: number}>} stops
 * @param {boolean} lockStart
 * @param {boolean} lockEnd
 * @returns {{ optimizedStops: Array, distanceBefore: number, distanceAfter: number }}
 */
function optimizeRoute(stops, lockStart = true, lockEnd = true) {
  if (stops.length < 3) {
    return {
      optimizedStops: stops,
      distanceBefore: 0,
      distanceAfter: 0
    };
  }

  const matrix = buildDistanceMatrix(stops);

  // Initial route: [0, 1, 2, ..., n-1]
  const initialRoute = stops.map((_, i) => i);

  const distanceBefore = totalDistance(initialRoute, matrix);

  // Run 2-opt
  const optimizedRoute = twoOpt(initialRoute, matrix, lockStart, lockEnd);

  const distanceAfter = totalDistance(optimizedRoute, matrix);

  // Map indices back to stop objects
  const optimizedStops = optimizedRoute.map(i => stops[i]);

  return { optimizedStops, distanceBefore, distanceAfter };
}
