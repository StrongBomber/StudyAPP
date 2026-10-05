import { createStrokeOutline } from './stroke.js';

function pdfColor(hex, rgb) {
  const value = String(hex || '#3449d8').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((x) => x + x).join('') : value;
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return rgb(52 / 255, 73 / 255, 216 / 255);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function pdfPoint(point, width, height) {
  return { x: point.x * width, y: (1 - point.y) * height };
}

function line(page, start, end, color, thickness, opacity, roundCap) {
  page.drawLine({ start, end, color, thickness: Math.max(.45, thickness), opacity, lineCap: roundCap });
}

function drawArrow(page, start, end, color, thickness, opacity, roundCap) {
  line(page, start, end, color, thickness, opacity, roundCap);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.max(7, thickness * 3.6);
  const spread = Math.PI / 7;
  line(page, end, { x: end.x - length * Math.cos(angle - spread), y: end.y - length * Math.sin(angle - spread) }, color, thickness, opacity, roundCap);
  line(page, end, { x: end.x - length * Math.cos(angle + spread), y: end.y - length * Math.sin(angle + spread) }, color, thickness, opacity, roundCap);
}

function drawShape(page, shape, width, height, color, thickness, opacity, roundCap) {
  const a = pdfPoint(shape.start, width, height);
  const b = pdfPoint(shape.end, width, height);
  const left = Math.min(a.x, b.x);
  const bottom = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  switch (shape.type) {
    case 'rect':
      page.drawRectangle({ x: left, y: bottom, width: w, height: h, borderColor: color, borderWidth: thickness, opacity });
      break;
    case 'ellipse':
      page.drawEllipse({ x: left + w / 2, y: bottom + h / 2, xScale: Math.max(.4, w / 2), yScale: Math.max(.4, h / 2), borderColor: color, borderWidth: thickness, opacity });
      break;
    case 'triangle': {
      const topY = Math.max(a.y, b.y);
      const bottomY = Math.min(a.y, b.y);
      const midX = left + w / 2;
      line(page, { x: a.x, y: bottomY }, { x: midX, y: topY }, color, thickness, opacity, roundCap);
      line(page, { x: midX, y: topY }, { x: b.x, y: bottomY }, color, thickness, opacity, roundCap);
      line(page, { x: b.x, y: bottomY }, { x: a.x, y: bottomY }, color, thickness, opacity, roundCap);
      break;
    }
    case 'arrow':
      drawArrow(page, a, b, color, thickness, opacity, roundCap);
      break;
    case 'line':
    default:
      line(page, a, b, color, thickness, opacity, roundCap);
  }
}

function imageBytesFromDataUrl(dataUrl) {
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Görsel verisi okunamadı.');
  const metadata = dataUrl.slice(0, separator);
  const payload = dataUrl.slice(separator + 1);
  if (!metadata.includes(';base64')) return new TextEncoder().encode(decodeURIComponent(payload));
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function embedDataImage(pdfDocument, dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp|gif|bmp)(?:[;,])/i.exec(dataUrl);
  if (!match) throw new Error('Güvenli olmayan veya desteklenmeyen görsel biçimi bulundu.');
  const mime = match[1].toLowerCase();
  const bytes = imageBytesFromDataUrl(dataUrl);
  if (mime === 'png') return pdfDocument.embedPng(bytes);
  if (mime === 'jpg' || mime === 'jpeg') return pdfDocument.embedJpg(bytes);

  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Eski görsel biçimi PDF’e dönüştürülemedi.'));
    image.src = dataUrl;
  });
  const scale = Math.min(1, 2560 / image.naturalWidth, 2560 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Görsel dönüştürücü başlatılamadı.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return pdfDocument.embedPng(imageBytesFromDataUrl(canvas.toDataURL('image/png')));
}

function pointInOutline(x, y, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    const crosses = (a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y || 1e-9) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function drawPencilTexture(page, outline, stroke, color, pageHeight, blendModes, roundCap) {
  if (outline.length < 3) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const count = Math.max(16, Math.min(460, Math.round(boundsWidth * boundsHeight * .052)));
  let seed = 2166136261;
  for (const character of String(stroke.id || 'pencil')) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let grainAngle = -Math.PI / 4;
  let tiltedPoints = 0;
  for (const point of stroke.points || []) {
    if (Math.hypot(point.tiltX || 0, point.tiltY || 0) > 4 && Number.isFinite(point.azimuthAngle)) {
      grainAngle += point.azimuthAngle;
      tiltedPoints += 1;
    }
  }
  if (tiltedPoints) grainAngle /= tiltedPoints + 1;
  const common = { color, opacity: .12, blendMode: blendModes?.Multiply, lineCap: roundCap };
  const thickness = Math.max(.28, Math.min(.65, (Number(stroke.size) || 2) * .12));
  for (let index = 0; index < count; index += 1) {
    const x = minX + random() * boundsWidth;
    const y = minY + random() * boundsHeight;
    const length = .8 + random() * 2.8;
    const angle = grainAngle + (random() - .5) * .72;
    if (!pointInOutline(x, y, outline)) continue;
    page.drawLine({
      ...common, thickness,
      start: { x, y: pageHeight - y },
      end: { x: x + Math.cos(angle) * length, y: pageHeight - (y + Math.sin(angle) * length) },
    });
  }
  const flecks = Math.round(count * .22);
  for (let index = 0; index < flecks; index += 1) {
    const size = .25 + random() * .55;
    const x = minX + random() * boundsWidth;
    const y = minY + random() * boundsHeight;
    if (!pointInOutline(x, y, outline)) continue;
    page.drawRectangle({ x, y: pageHeight - y - size, width: size, height: size, color, opacity: .075, blendMode: blendModes?.Multiply });
  }
}

async function drawStroke(page, stroke, width, height, rgb, roundCap, imageEmbeds, pdfDocument, blendModes) {
  if (stroke.kind === 'image') {
    if (typeof stroke.src !== 'string' || !stroke.src.startsWith('data:image/')) return;
    let embedded = imageEmbeds.get(stroke.src);
    if (!embedded) {
      embedded = await embedDataImage(pdfDocument, stroke.src);
      imageEmbeds.set(stroke.src, embedded);
    }
    page.drawImage(embedded, {
      x: stroke.x * width,
      y: (1 - stroke.y - stroke.h) * height,
      width: stroke.w * width,
      height: stroke.h * height,
      opacity: Number.isFinite(stroke.opacity) ? stroke.opacity : 1,
    });
    return;
  }
  const color = pdfColor(stroke.color, rgb);
  const highlighter = stroke.tool === 'highlighter';
  const opacity = Number.isFinite(stroke.opacity)
    ? stroke.opacity
    : highlighter ? .3 : stroke.mode === 'pencil' ? .72 : stroke.mode === 'marker' ? .9 : stroke.mode === 'brush' ? .96 : 1;
  const blendMode = highlighter || stroke.mode === 'pencil' ? blendModes?.Multiply : blendModes?.Normal;
  if (stroke.shape) {
    const thickness = Math.max(.65, (Number(stroke.size) || 2) * (highlighter ? 3.4 : 1));
    drawShape(page, stroke.shape, width, height, color, thickness, opacity, roundCap);
    return;
  }

  const outline = createStrokeOutline(stroke, width, height, 1);
  if (outline.length < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  for (const point of outline) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); }
  const svgNumber = (value) => Number(value.toFixed(3));
  const commands = [`M ${svgNumber(outline[0].x - minX)} ${svgNumber(outline[0].y - minY)}`];
  for (let index = 1; index < outline.length; index += 1) {
    commands.push(`L ${svgNumber(outline[index].x - minX)} ${svgNumber(outline[index].y - minY)}`);
  }
  const path = `${commands.join(' ')} Z`;
  page.drawSvgPath(path, {
    x: minX,
    y: height - minY,
    color,
    opacity,
    blendMode,
  });
  if (stroke.mode === 'pencil') drawPencilTexture(page, outline, stroke, color, height, blendModes, roundCap);
}

export async function createAnnotatedPdf(pdfBytes, pageData, title) {
  const PDFLib = window.PDFLib;
  if (!PDFLib?.PDFDocument) throw new Error('PDF dışa aktarma bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
  const { PDFDocument, rgb, LineCapStyle, BlendMode } = PDFLib;
  const document = await PDFDocument.load(pdfBytes, { updateMetadata: true });
  const pages = document.getPages();
  const imageEmbeds = new Map();
  const roundCap = LineCapStyle?.Round;
  for (const [pageNumber, data] of pageData) {
    const page = pages[pageNumber - 1];
    if (!page || !data?.strokes?.length) continue;
    const { width, height } = page.getSize();
    for (const stroke of data.strokes) await drawStroke(page, stroke, width, height, rgb, roundCap, imageEmbeds, document, BlendMode);
  }
  if (title) document.setTitle(`${title.replace(/\.pdf$/i, '')} — Çözüm`);
  document.setProducer('Çözüm PDF çalışma alanı');
  return document.save({ useObjectStreams: true, addDefaultPage: false });
}

export function downloadBytes(bytes, filename, mime = 'application/pdf') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function safeFilename(name) {
  const base = String(name || 'calisma').replace(/\.pdf$/i, '').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ').trim().slice(0, 90) || 'calisma';
  return `${base}-cozum.pdf`;
}
