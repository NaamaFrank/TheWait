/**
 * Real-earth geometry for the globe: a TopoJSON decoder and an orthographic
 * projector, both written against the canvas 2D context directly.
 *
 * Every ring is decoded once into a flat `Float64Array` of unit-sphere xyz
 * triples. Longitude and latitude never change, so the per-frame cost is one
 * rotation per point rather than a trigonometric conversion.
 */

const DEG = Math.PI / 180;

/* --- TopoJSON ------------------------------------------------------------ */

/**
 * Quantised delta decoding. Arc positions are stored as integer deltas from
 * the previous point and mapped back through the topology's transform.
 */
function decodeArc(arc, transform) {
  const [scaleX, scaleY] = transform.scale;
  const [translateX, translateY] = transform.translate;

  const points = new Array(arc.length);
  let x = 0;
  let y = 0;

  for (let i = 0; i < arc.length; i += 1) {
    x += arc[i][0];
    y += arc[i][1];
    points[i] = [x * scaleX + translateX, y * scaleY + translateY];
  }

  return points;
}

/** Stitches a ring's arc indices into one point list. `~i` means arc `i` reversed. */
function stitch(arcIndices, arcs) {
  const points = [];

  for (const index of arcIndices) {
    const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
    // Consecutive arcs share their join, so drop the repeat.
    points.push(...(points.length ? arc.slice(1) : arc));
  }

  return points;
}

/**
 * A bounding cap for a ring: the unit vector at its middle, and how far the
 * furthest point strays from it.
 *
 * With this, a ring can be rejected before a single point is transformed - the
 * 50m atlas is 80,000 points and at high zoom almost none of them are on
 * screen, so culling whole countries by cap is what makes it affordable.
 */
export function ringCap(xyz) {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let i = 0; i < xyz.length; i += 3) {
    x += xyz[i];
    y += xyz[i + 1];
    z += xyz[i + 2];
  }

  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;

  // The smallest cosine is the furthest point, so the widest angle.
  let cosRadius = 1;
  for (let i = 0; i < xyz.length; i += 3) {
    const dot = x * xyz[i] + y * xyz[i + 1] + z * xyz[i + 2];
    if (dot < cosRadius) cosRadius = dot;
  }

  return { x, y, z, cosRadius, sinRadius: Math.sqrt(Math.max(0, 1 - cosRadius * cosRadius)) };
}

/**
 * Whether a ring's cap reaches into the visible cap of the globe.
 *
 * `dot` is the cosine of the angle between the ring's middle and the camera
 * axis. The ring is in view when that angle, less its own radius, is inside the
 * visible angle - expanded here with the cosine subtraction rule so nothing has
 * to call `acos` per ring per frame.
 */
export function capVisible(cap, dot, cosVisible) {
  const sin = Math.sqrt(Math.max(0, 1 - dot * dot));
  const cosNearest = dot * cap.cosRadius + sin * cap.sinRadius;

  return cosNearest > cosVisible;
}

/** `[lon, lat]` degrees -> a flat `[x, y, z, x, y, z, ...]` unit-sphere buffer. */
function toCartesian(points) {
  const buffer = new Float64Array(points.length * 3);

  for (let i = 0; i < points.length; i += 1) {
    const lon = points[i][0] * DEG;
    const lat = points[i][1] * DEG;
    const cosLat = Math.cos(lat);

    buffer[i * 3] = cosLat * Math.cos(lon);
    buffer[i * 3 + 1] = cosLat * Math.sin(lon);
    buffer[i * 3 + 2] = Math.sin(lat);
  }

  return buffer;
}

/** Every ring in a Polygon or MultiPolygon geometry, as arrays of arc indices. */
function geometryRings(geometry) {
  if (geometry.type === 'Polygon') return geometry.arcs;
  if (geometry.type === 'MultiPolygon') return geometry.arcs.flat();
  return [];
}

/**
 * Decodes the countries topology into what the renderer draws:
 * filled land rings, and the interior borders between neighbours.
 *
 * An arc used by exactly one country is a coastline (already drawn as the land
 * outline); an arc shared by two is a land border, which gets its own hairline.
 */
export function decodeCountries(topology) {
  const arcs = topology.arcs.map((arc) => decodeArc(arc, topology.transform));
  const geometries = topology.objects.countries.geometries;

  const land = [];
  const usage = new Map();

  for (const geometry of geometries) {
    for (const ring of geometryRings(geometry)) {
      const points = toCartesian(stitch(ring, arcs));
      points.cap = ringCap(points);
      land.push(points);

      for (const index of ring) {
        const key = index < 0 ? ~index : index;
        usage.set(key, (usage.get(key) ?? 0) + 1);
      }
    }
  }

  const borders = [];
  for (const [index, count] of usage) {
    if (count > 1) {
      const points = toCartesian(arcs[index]);
      points.cap = ringCap(points);
      borders.push(points);
    }
  }

  return { land, borders };
}

/** Meridians and parallels every `step` degrees, sampled fine enough to look curved. */
export function buildGraticule(step = 10, sample = 2) {
  const lines = [];

  const add = (points) => {
    const buffer = toCartesian(points);
    buffer.cap = ringCap(buffer);
    lines.push(buffer);
  };

  for (let lon = -180; lon < 180; lon += step) {
    const points = [];
    for (let lat = -80; lat <= 80; lat += sample) points.push([lon, lat]);
    add(points);
  }

  for (let lat = -80; lat <= 80; lat += step) {
    const points = [];
    for (let lon = -180; lon <= 180; lon += sample) points.push([lon, lat]);
    add(points);
  }

  return lines;
}

/* --- Orthographic projection --------------------------------------------- */

/**
 * Rotates the sphere so `(lon, lat)` faces the camera and projects onto the
 * screen plane. The camera looks down +x, so a point is on the near side
 * exactly when its rotated x is positive.
 */
export function createProjector() {
  let cosLon = 1;
  let sinLon = 0;
  let cosLat = 1;
  let sinLat = 0;
  let cx = 0;
  let cy = 0;
  let radius = 1;

  // Scratch for the rotated point, reused so the render loop never allocates.
  let rx = 0;
  let ry = 0;
  let rz = 0;

  function rotate(x, y, z) {
    const x1 = x * cosLon + y * sinLon;
    ry = y * cosLon - x * sinLon;
    rx = x1 * cosLat + z * sinLat;
    rz = z * cosLat - x1 * sinLat;
  }

  /**
   * Where the great-circle segment between two points crosses the horizon.
   * Interpolating the chord and renormalising is exact enough at this
   * resolution and avoids a slerp per crossing.
   */
  function horizonCrossing(a, b, aDepth, bDepth) {
    const t = aDepth / (aDepth - bDepth);
    const ix = a[0] + (b[0] - a[0]) * t;
    const iy = a[1] + (b[1] - a[1]) * t;
    const iz = a[2] + (b[2] - a[2]) * t;

    rotate(ix, iy, iz);
    const norm = Math.hypot(ry, rz) || 1;

    return { x: cx + (radius * ry) / norm, y: cy - (radius * rz) / norm };
  }

  return {
    /** The unit vector the camera looks at - the point at the centre of the disc. */
    axis() {
      return { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat };
    },

    set(lonDeg, latDeg, centerX, centerY, r) {
      const lon = lonDeg * DEG;
      const lat = latDeg * DEG;
      cosLon = Math.cos(lon);
      sinLon = Math.sin(lon);
      cosLat = Math.cos(lat);
      sinLat = Math.sin(lat);
      cx = centerX;
      cy = centerY;
      radius = r;
    },

    /** Screen position of one `[lon, lat]`, or null when it is behind the globe. */
    project(lonDeg, latDeg) {
      const lon = lonDeg * DEG;
      const lat = latDeg * DEG;
      const cl = Math.cos(lat);

      rotate(cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat));
      if (rx <= 0) return null;

      return { x: cx + radius * ry, y: cy - radius * rz, depth: rx };
    },

    /**
     * Traces a filled ring.
     *
     * Points behind the horizon are pushed out onto the limb instead of being
     * clipped away. Their azimuth is already correct, so the path follows the
     * rim exactly where the hidden part of the ring sits and the fill closes
     * the way a true spherical clip would - without any winding bookkeeping.
     */
    tracePolygon(ctx, xyz) {
      let anyVisible = false;
      let started = false;

      for (let i = 0; i < xyz.length; i += 3) {
        rotate(xyz[i], xyz[i + 1], xyz[i + 2]);

        let px;
        let py;

        if (rx > 0) {
          anyVisible = true;
          px = cx + radius * ry;
          py = cy - radius * rz;
        } else {
          const norm = Math.hypot(ry, rz);
          if (norm < 1e-9) continue;
          px = cx + (radius * ry) / norm;
          py = cy - (radius * rz) / norm;
        }

        if (started) ctx.lineTo(px, py);
        else {
          ctx.moveTo(px, py);
          started = true;
        }
      }

      if (started) ctx.closePath();
      return anyVisible;
    },

    /**
     * Traces a stroked line, broken at the horizon. Unlike a fill, a stroke
     * must not run along the limb, so each visible run is its own subpath and
     * the crossing point is solved on the sphere.
     */
    traceLine(ctx, xyz) {
      const previous = [0, 0, 0];
      let previousDepth = 0;
      let previousVisible = false;
      let open = false;

      for (let i = 0; i < xyz.length; i += 3) {
        const current = [xyz[i], xyz[i + 1], xyz[i + 2]];

        rotate(current[0], current[1], current[2]);
        const depth = rx;
        const visible = depth > 0;
        const screenX = cx + radius * ry;
        const screenY = cy - radius * rz;

        if (visible && previousVisible) {
          if (open) ctx.lineTo(screenX, screenY);
          else {
            ctx.moveTo(screenX, screenY);
            open = true;
          }
        } else if (visible) {
          // Entering view: start at the horizon so the line does not pop in.
          if (i > 0) {
            const edge = horizonCrossing(previous, current, previousDepth, depth);
            ctx.moveTo(edge.x, edge.y);
            ctx.lineTo(screenX, screenY);
          } else {
            ctx.moveTo(screenX, screenY);
          }
          open = true;
        } else if (previousVisible) {
          const edge = horizonCrossing(previous, current, previousDepth, depth);
          ctx.lineTo(edge.x, edge.y);
          open = false;
        } else {
          open = false;
        }

        previous[0] = current[0];
        previous[1] = current[1];
        previous[2] = current[2];
        previousDepth = depth;
        previousVisible = visible;
      }
    }
  };
}
