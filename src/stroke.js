const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const TAU = Math.PI * 2;

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function mixAngle(from, to, amount) {
  return from + angleDelta(from, to) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Pressure response tuned separately for each tip, rather than one generic width curve. */
export function pressureScale(stroke, pressure) {
  const value = clamp(Number.isFinite(pressure) ? pressure : .5, .035, 1);
  const sensitivity = clamp(Number.isFinite(stroke?.pressureSensitivity) ? stroke.pressureSensitivity : .5, 0, 1);
  const curve = (base) => value ** Math.max(.2, base + (sensitivity - .5) * .75);
  switch (stroke?.mode) {
    case 'fountain': return .17 + 1.68 * curve(1.12);
    case 'brush': return .10 + 1.72 * curve(.92);
    case 'pencil': return .22 + 1.2 * curve(1.08);
    case 'marker': return .68 + .46 * curve(.82);
    case 'highlighter': return .9 + .12 * curve(.8);
    // The fine-line tip stays visibly connected even at the light touch pressure reported by Pencil.
    default: return .48 + .86 * curve(.92);
  }
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    pressure: (a.pressure + b.pressure) / 2,
    altitudeAngle: (a.altitudeAngle + b.altitudeAngle) / 2,
    tiltX: (a.tiltX + b.tiltX) / 2,
    tiltY: (a.tiltY + b.tiltY) / 2,
    azimuthAngle: mixAngle(a.azimuthAngle, b.azimuthAngle, .5),
    time: (a.time + b.time) / 2,
  };
}

function quadratic(a, control, b, t) {
  const inverse = 1 - t;
  const mix = (start, middle, end) => inverse * inverse * start + 2 * inverse * t * middle + t * t * end;
  return {
    x: mix(a.x, control.x, b.x),
    y: mix(a.y, control.y, b.y),
    pressure: mix(a.pressure, control.pressure, b.pressure),
    altitudeAngle: mix(a.altitudeAngle, control.altitudeAngle, b.altitudeAngle),
    tiltX: mix(a.tiltX, control.tiltX, b.tiltX),
    tiltY: mix(a.tiltY, control.tiltY, b.tiltY),
    azimuthAngle: mixAngle(mixAngle(a.azimuthAngle, control.azimuthAngle, t), mixAngle(control.azimuthAngle, b.azimuthAngle, t), t),
    time: mix(a.time, control.time, b.time),
  };
}

function normalizePoints(points, width, height, stroke) {
  const raw = [];
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const tiltX = Number.isFinite(point.tiltX) ? point.tiltX : 0;
    const tiltY = Number.isFinite(point.tiltY) ? point.tiltY : 0;
    const tiltMagnitude = Math.min(90, Math.hypot(tiltX, tiltY));
    const altitudeAngle = Number.isFinite(point.altitudeAngle)
      ? clamp(point.altitudeAngle, 0, Math.PI / 2)
      : (90 - tiltMagnitude) * Math.PI / 180;
    const azimuthAngle = Number.isFinite(point.azimuthAngle)
      ? point.azimuthAngle
      : tiltMagnitude > 3 ? Math.atan2(tiltY, tiltX) : Number.isFinite(stroke.nibAngle) ? stroke.nibAngle : -Math.PI / 4;
    const next = {
      x: point.x * width,
      y: point.y * height,
      pressure: clamp(Number.isFinite(point.pressure) ? point.pressure : .5, .035, 1),
      altitudeAngle,
      tiltX,
      tiltY,
      azimuthAngle,
      time: Number.isFinite(point.time) ? point.time : raw.length * 16,
    };
    const previous = raw[raw.length - 1];
    if (previous && Math.hypot(next.x - previous.x, next.y - previous.y) < .025) {
      // Keep the newest device metadata without manufacturing zero-length geometry.
      raw[raw.length - 1] = { ...previous, pressure: next.pressure, altitudeAngle: next.altitudeAngle, tiltX, tiltY, azimuthAngle, time: next.time };
    } else raw.push(next);
  }

  // A light, zero-lag pressure filter removes Pencil sensor chatter without dulling deliberate presses.
  if (raw.length > 2) {
    const pressure = raw.map((point) => point.pressure);
    for (let index = 1; index < raw.length - 1; index += 1) {
      raw[index].pressure = pressure[index - 1] * .16 + pressure[index] * .68 + pressure[index + 1] * .16;
    }
  }

  // Streamline is an adjustable spatial stabilizer. It only nudges the path; it never adds input latency.
  const stabilization = clamp(Number(stroke.stabilization) || 0, 0, .5);
  const blend = stabilization * .68;
  if (blend > .001 && raw.length > 2) {
    const smoothed = raw.map((point) => ({ ...point }));
    for (let index = 1; index < raw.length - 1; index += 1) {
      smoothed[index].x = raw[index].x * (1 - blend) + (raw[index - 1].x + raw[index + 1].x) * blend * .5;
      smoothed[index].y = raw[index].y * (1 - blend) + (raw[index - 1].y + raw[index + 1].y) * blend * .5;
    }
    return smoothed;
  }
  return raw;
}

function curveSamples(points, width, height, stroke) {
  const raw = normalizePoints(points, width, height, stroke);
  if (raw.length < 2) return raw;

  const samples = [raw[0]];
  if (raw.length === 2) {
    const start = raw[0];
    const end = raw[1];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = clamp(Math.ceil(distance / 1.45), 1, 160);
    for (let step = 1; step <= steps; step += 1) samples.push(quadratic(start, midpoint(start, end), end, step / steps));
    return samples;
  }

  let start = raw[0];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const control = raw[index];
    const end = index === raw.length - 2 ? raw[index + 1] : midpoint(raw[index], raw[index + 1]);
    const estimatedLength = Math.hypot(control.x - start.x, control.y - start.y)
      + Math.hypot(end.x - control.x, end.y - control.y);
    const steps = clamp(Math.ceil(estimatedLength / 1.45), 2, 48);
    for (let step = 1; step <= steps; step += 1) samples.push(quadratic(start, control, end, step / steps));
    start = end;
  }
  return samples;
}

function tangentAt(samples, index) {
  const current = samples[index];
  const before = samples[Math.max(0, index - 1)];
  const after = samples[Math.min(samples.length - 1, index + 1)];
  let dx = after.x - before.x;
  let dy = after.y - before.y;
  let length = Math.hypot(dx, dy);
  if (length < .01) {
    dx = after.x - current.x;
    dy = after.y - current.y;
    length = Math.hypot(dx, dy);
  }
  if (length < .01) {
    dx = current.x - before.x;
    dy = current.y - before.y;
    length = Math.hypot(dx, dy);
  }
  if (length < .01) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

function appendArc(points, center, radius, startAngle, endAngle, steps = 12) {
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + (endAngle - startAngle) * index / steps;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
}

function effectiveNibAngle(point, stroke) {
  return Math.hypot(point.tiltX, point.tiltY) > 4
    ? point.azimuthAngle
    : Number.isFinite(stroke.nibAngle) ? stroke.nibAngle : -Math.PI / 4;
}

function ellipseSupport(normal, angle, majorRadius, minorRadius) {
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const alongMajor = normal.x * axisX + normal.y * axisY;
  const alongMinor = -normal.x * axisY + normal.y * axisX;
  return Math.hypot(majorRadius * alongMajor, minorRadius * alongMinor);
}

/** Return one smooth, pressure/tilt-aware closed outline in page pixels. */
export function createStrokeOutline(stroke, width, height, scale = 1) {
  const samples = curveSamples(stroke?.points || [], width, height, stroke || {});
  if (!samples.length) return [];

  const highlighter = stroke.tool === 'highlighter';
  const mode = stroke.mode || 'ink';
  const size = Math.max(.35, Number(stroke.size) || 2);
  const sizeFactor = highlighter ? 3.35 : mode === 'marker' ? 1.32 : 1;
  const baseWidth = Math.max(.55, size * scale * sizeFactor);
  const count = samples.length;
  const arcLength = new Float64Array(count);
  for (let index = 1; index < count; index += 1) {
    arcLength[index] = arcLength[index - 1] + Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y);
  }
  const totalLength = arcLength[count - 1];

  const radiusAt = (point, tangent, index) => {
    let weight = highlighter ? pressureScale({ mode: 'highlighter' }, point.pressure)
      : pressureScale(stroke, point.pressure);
    const tiltAmount = clamp(1 - point.altitudeAngle / (Math.PI / 2), 0, 1);
    const tangentAngle = Math.atan2(tangent.y, tangent.x);

    if (mode === 'fountain') {
      const nibAngle = effectiveNibAngle(point, stroke);
      // A broad-and-hairline contrast from a fixed calligraphy nib, modulated by Pencil pressure.
      const crossNib = Math.abs(Math.sin(tangentAngle - nibAngle));
      weight *= .19 + .92 * crossNib;
    } else if (mode === 'brush') {
      // A brush pen flexes under pressure and becomes a little finer on a fast upstroke.
      const previous = samples[Math.max(0, index - 1)];
      const next = samples[Math.min(count - 1, index + 1)];
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
      const elapsed = Math.max(6, next.time - previous.time);
      const speed = distance / elapsed;
      weight *= clamp(1.06 - speed * .22, .78, 1.06) * (1 + tiltAmount * .18);
    } else if (mode === 'pencil') {
      weight *= 1 + tiltAmount * .38;
    }

    if (mode !== 'marker' && !highlighter) {
      // Short, pressure-shaped entry and exit make pen and pencil marks feel less stamped.
      const taperLength = Math.min(Math.max(2, baseWidth * (mode === 'brush' ? 1.05 : .72)), totalLength * .22);
      if (totalLength > baseWidth * 1.35 && taperLength > .5) {
        const fadeIn = smoothstep(arcLength[index] / taperLength);
        const fadeOut = smoothstep((totalLength - arcLength[index]) / taperLength);
        weight *= .42 + .58 * Math.min(fadeIn, fadeOut);
      }
    }

    const radius = Math.max(.275, baseWidth * weight / 2);
    if (mode === 'marker' || highlighter) {
      const nibAngle = effectiveNibAngle(point, stroke);
      const aspect = highlighter ? .13 : .2;
      return ellipseSupport({ x: -tangent.y, y: tangent.x }, nibAngle, radius, radius * aspect);
    }
    if (mode === 'pencil' && tiltAmount > .08) {
      const nibAngle = effectiveNibAngle(point, stroke) + Math.PI / 2;
      const major = radius * (1 + tiltAmount * .62);
      const minor = radius * (1 - tiltAmount * .3);
      return ellipseSupport({ x: -tangent.y, y: tangent.x }, nibAngle, major, minor);
    }
    return radius;
  };

  if (count === 1 || totalLength < .08) {
    const radius = radiusAt(samples[0], { x: 1, y: 0 }, 0);
    return Array.from({ length: 28 }, (_, index) => {
      const angle = index / 28 * TAU;
      return { x: samples[0].x + Math.cos(angle) * radius, y: samples[0].y + Math.sin(angle) * radius };
    });
  }

  const tangents = samples.map((_, index) => tangentAt(samples, index));
  const normals = tangents.map((tangent) => ({ x: -tangent.y, y: tangent.x }));
  const left = [];
  const right = [];
  for (let index = 0; index < count; index += 1) {
    const point = samples[index];
    const normal = normals[index];
    const radius = radiusAt(point, tangents[index], index);
    left.push({ x: point.x + normal.x * radius, y: point.y + normal.y * radius });
    right.push({ x: point.x - normal.x * radius, y: point.y - normal.y * radius });
  }

  const outline = [...left];
  const end = samples[count - 1];
  const endNormal = normals[count - 1];
  const endRadius = radiusAt(end, tangents[count - 1], count - 1);
  const endAngle = Math.atan2(endNormal.y, endNormal.x);
  appendArc(outline, end, endRadius, endAngle, endAngle - Math.PI);
  for (let index = right.length - 2; index >= 0; index -= 1) outline.push(right[index]);
  const start = samples[0];
  const startNormal = normals[0];
  const startRadius = radiusAt(start, tangents[0], 0);
  const startAngle = Math.atan2(startNormal.y, startNormal.x);
  appendArc(outline, start, startRadius, startAngle + Math.PI, startAngle + TAU);
  return outline;
}
