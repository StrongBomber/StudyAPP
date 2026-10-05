const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function pressureScale(stroke, pressure) {
  const value = clamp(Number.isFinite(pressure) ? pressure : .5, .08, 1);
  if (stroke.mode === 'pencil') return .38 + value * .88;
  if (stroke.mode === 'fountain') return .3 + value * 1.42;
  if (stroke.mode === 'ink') return .55 + value * .9;
  return .48 + value * 1.04;
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    pressure: (a.pressure + b.pressure) / 2,
    altitudeAngle: (a.altitudeAngle + b.altitudeAngle) / 2,
    tiltX: (a.tiltX + b.tiltX) / 2, tiltY: (a.tiltY + b.tiltY) / 2,
  };
}

function quadratic(a, control, b, t) {
  const inverse = 1 - t;
  const mix = (start, middle, end) => inverse * inverse * start + 2 * inverse * t * middle + t * t * end;
  return {
    x: mix(a.x, control.x, b.x), y: mix(a.y, control.y, b.y),
    pressure: mix(a.pressure, control.pressure, b.pressure),
    altitudeAngle: mix(a.altitudeAngle, control.altitudeAngle, b.altitudeAngle),
    tiltX: mix(a.tiltX, control.tiltX, b.tiltX), tiltY: mix(a.tiltY, control.tiltY, b.tiltY),
  };
}

function curveSamples(points, width, height) {
  const raw = points
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: point.x * width,
      y: point.y * height,
      pressure: clamp(Number.isFinite(point.pressure) ? point.pressure : .5, .08, 1),
      altitudeAngle: Number.isFinite(point.altitudeAngle) ? point.altitudeAngle : Math.PI / 2,
      tiltX: Number.isFinite(point.tiltX) ? point.tiltX : 0,
      tiltY: Number.isFinite(point.tiltY) ? point.tiltY : 0,
    }));
  if (raw.length < 2) return raw;

  const samples = [raw[0]];
  if (raw.length === 2) {
    const start = raw[0];
    const end = raw[1];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = clamp(Math.ceil(distance / 2.4), 1, 48);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        pressure: start.pressure + (end.pressure - start.pressure) * t,
        altitudeAngle: start.altitudeAngle + (end.altitudeAngle - start.altitudeAngle) * t,
        tiltX: start.tiltX + (end.tiltX - start.tiltX) * t,
        tiltY: start.tiltY + (end.tiltY - start.tiltY) * t,
      });
    }
    return samples;
  }

  let start = raw[0];
  for (let index = 0; index < raw.length - 1; index += 1) {
    const control = raw[index];
    const end = index === raw.length - 2 ? raw[index + 1] : midpoint(raw[index], raw[index + 1]);
    const estimatedLength = Math.hypot(control.x - start.x, control.y - start.y)
      + Math.hypot(end.x - control.x, end.y - control.y);
    const steps = clamp(Math.ceil(estimatedLength / 2.4), 2, 32);
    for (let step = 1; step <= steps; step += 1) samples.push(quadratic(start, control, end, step / steps));
    start = end;
  }
  return samples;
}

function tangentAt(samples, index) {
  const current = samples[index];
  let before = index - 1;
  while (before >= 0 && Math.hypot(current.x - samples[before].x, current.y - samples[before].y) < .01) before -= 1;
  let after = index + 1;
  while (after < samples.length && Math.hypot(current.x - samples[after].x, current.y - samples[after].y) < .01) after += 1;
  const a = samples[before >= 0 ? before : index];
  const b = samples[after < samples.length ? after : index];
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let length = Math.hypot(dx, dy);
  if (length < .01) {
    dx = 1;
    dy = 0;
    length = 1;
  }
  return { x: dx / length, y: dy / length };
}

function appendArc(points, center, radius, startAngle, endAngle, steps = 10) {
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + (endAngle - startAngle) * index / steps;
    points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  }
}

/** Return a single, smoothed, pressure-sensitive closed outline in page pixels. */
export function createStrokeOutline(stroke, width, height, scale = 1) {
  const points = stroke?.points || [];
  const samples = curveSamples(points, width, height);
  if (!samples.length) return [];

  const highlighter = stroke.tool === 'highlighter';
  const mode = stroke.mode || 'ink';
  const baseWidth = Math.max(.55, (Number(stroke.size) || 2) * scale * (highlighter ? 3.4 : mode === 'marker' ? 1.35 : 1));
  const radiusAt = (point, tangent = { x: 1, y: 0 }) => {
    let weight = highlighter ? 1 : mode === 'marker' ? .78 + point.pressure * .44 : pressureScale(stroke, point.pressure);
    const tiltAmount = clamp(1 - point.altitudeAngle / (Math.PI / 2), 0, 1);
    if (mode === 'fountain') {
      const tiltMagnitude = Math.hypot(point.tiltX, point.tiltY);
      const nibAngle = tiltMagnitude > 5 ? Math.atan2(point.tiltY, point.tiltX) : Math.PI / 4;
      const direction = Math.abs(Math.sin(Math.atan2(tangent.y, tangent.x) - nibAngle));
      weight *= (.36 + .94 * direction) * (1 + tiltAmount * .16);
    } else if (mode === 'pencil') {
      weight *= 1 + tiltAmount * .58;
    }
    return Math.max(.28, baseWidth * weight / 2);
  };
  if (samples.length === 1) {
    const radius = radiusAt(samples[0]);
    return Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2;
      return { x: samples[0].x + Math.cos(angle) * radius, y: samples[0].y + Math.sin(angle) * radius };
    });
  }

  let length = 0;
  for (let index = 1; index < samples.length; index += 1) length += Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y);
  if (length < .08) {
    const radius = radiusAt(samples[0]);
    return Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2;
      return { x: samples[0].x + Math.cos(angle) * radius, y: samples[0].y + Math.sin(angle) * radius };
    });
  }

  const tangents = samples.map((_, index) => tangentAt(samples, index));
  const normals = tangents.map((tangent) => ({ x: -tangent.y, y: tangent.x }));
  const left = [];
  const right = [];
  for (let index = 0; index < samples.length; index += 1) {
    const point = samples[index];
    const normal = normals[index];
    const radius = radiusAt(point, tangents[index]);
    left.push({ x: point.x + normal.x * radius, y: point.y + normal.y * radius });
    right.push({ x: point.x - normal.x * radius, y: point.y - normal.y * radius });
  }

  const outline = [...left];
  const end = samples[samples.length - 1];
  const endNormal = normals[normals.length - 1];
  const endRadius = radiusAt(end, tangents[tangents.length - 1]);
  const endAngle = Math.atan2(endNormal.y, endNormal.x);
  appendArc(outline, end, endRadius, endAngle, endAngle - Math.PI, 10);
  for (let index = right.length - 2; index >= 0; index -= 1) outline.push(right[index]);
  const start = samples[0];
  const startNormal = normals[0];
  const startRadius = radiusAt(start, tangents[0]);
  const startAngle = Math.atan2(startNormal.y, startNormal.x);
  appendArc(outline, start, startRadius, startAngle + Math.PI, startAngle + 2 * Math.PI, 10);
  return outline;
}
