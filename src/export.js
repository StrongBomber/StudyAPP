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

function pressureScale(stroke, pressure) {
  const value = Number.isFinite(pressure) ? pressure : .5;
  if (stroke.mode === 'pencil') return .42 + value * .82;
  if (stroke.mode === 'fountain') return .28 + value * 1.52;
  if (stroke.mode === 'ink') return .48 + value * .88;
  return .35 + value * 1.3;
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

async function drawStroke(page, stroke, width, height, rgb, roundCap, imageEmbeds, pdfDocument) {
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
  const isHighlighter = stroke.tool === 'highlighter';
  const opacity = Number.isFinite(stroke.opacity) ? stroke.opacity : (isHighlighter ? .29 : 1);
  const baseThickness = Math.max(.65, (Number(stroke.size) || 2) * (isHighlighter ? 3.2 : 1));
  if (stroke.shape) {
    drawShape(page, stroke.shape, width, height, color, baseThickness * (stroke.legacyShape ? 1.36 : 1), opacity, roundCap);
    return;
  }
  const points = stroke.points || [];
  if (points.length === 1) {
    const p = pdfPoint(points[0], width, height);
    const pressureWidth = stroke.tool === 'highlighter' ? 1 : pressureScale(stroke, points[0].pressure);
    page.drawCircle({ x: p.x, y: p.y, size: baseThickness * pressureWidth / 2, color, opacity });
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const pressure = ((points[index - 1].pressure || .5) + (points[index].pressure || .5)) / 2;
    const thickness = baseThickness * (stroke.tool === 'highlighter' ? 1 : pressureScale(stroke, pressure));
    line(page, pdfPoint(points[index - 1], width, height), pdfPoint(points[index], width, height), color, thickness, opacity, roundCap);
  }
}

export async function createAnnotatedPdf(pdfBytes, pageData, title) {
  const PDFLib = window.PDFLib;
  if (!PDFLib?.PDFDocument) throw new Error('PDF dışa aktarma bileşeni yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
  const { PDFDocument, rgb, LineCapStyle } = PDFLib;
  const document = await PDFDocument.load(pdfBytes, { updateMetadata: true });
  const pages = document.getPages();
  const imageEmbeds = new Map();
  const roundCap = LineCapStyle?.Round;
  for (const [pageNumber, data] of pageData) {
    const page = pages[pageNumber - 1];
    if (!page || !data?.strokes?.length) continue;
    const { width, height } = page.getSize();
    for (const stroke of data.strokes) await drawStroke(page, stroke, width, height, rgb, roundCap, imageEmbeds, document);
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
