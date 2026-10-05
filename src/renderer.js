import * as pdfjs from '../vendor/pdf.min.mjs';
import { createStrokeOutline } from './stroke.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const imageCache = new Map();

function pointOf(point, width, height) {
  return { x: point.x * width, y: point.y * height };
}

function isCancellation(error) {
  return error?.name === 'RenderingCancelledException' || /cancelled/i.test(error?.message || '');
}

function drawPencilGrain(ctx, outline, stroke) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const area = Math.max(1, (maxX - minX) * (maxY - minY));
  const count = Math.max(18, Math.min(700, Math.round(area * .09)));
  let seed = 2166136261;
  for (const character of String(stroke.id || 'pencil')) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let index = 1; index < outline.length; index += 1) ctx.lineTo(outline[index].x, outline[index].y);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = .13;
  ctx.fillStyle = stroke.color || '#20283b';
  for (let index = 0; index < count; index += 1) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    const size = .35 + random() * .8;
    ctx.fillRect(x, y, size, size * (.6 + random() * .8));
  }
  ctx.restore();
}

function drawArrowHead(ctx, from, to, size) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(8, size * 3.5);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - length * Math.cos(angle - spread), to.y - length * Math.sin(angle - spread));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - length * Math.cos(angle + spread), to.y - length * Math.sin(angle + spread));
  ctx.stroke();
}

export class PdfRenderer {
  constructor({ viewport, paper, pdfCanvas, inkCanvas, liveCanvas, predictedCanvas }) {
    this.viewportElement = viewport;
    this.paper = paper;
    this.pdfCanvas = pdfCanvas;
    this.inkCanvas = inkCanvas;
    this.liveCanvas = liveCanvas;
    this.predictedCanvas = predictedCanvas;
    this.imageCache = imageCache;
    this.onImageLoaded = null;
    this.pdfDocument = null;
    this.loadingTask = null;
    this.openToken = 0;
    this.renderTask = null;
    this.renderToken = 0;
    this.pageNumber = 1;
    this.zoom = 1;
    this.pageViewport = null;
    this.baseViewport = null;
    this.page = null;
  }

  async open(bytes) {
    const token = ++this.openToken;
    if (this.loadingTask) {
      try { await this.loadingTask.destroy(); } catch (_) { /* a superseded load may already be closed */ }
    }
    const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
    const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false });
    this.loadingTask = loadingTask;
    let nextDocument;
    try {
      nextDocument = await loadingTask.promise;
    } catch (error) {
      if (token !== this.openToken) return null;
      throw error;
    } finally {
      if (this.loadingTask === loadingTask) this.loadingTask = null;
    }
    if (token !== this.openToken) {
      try { await nextDocument.destroy(); } catch (_) { /* stale load cleanup */ }
      return null;
    }
    const previousDocument = this.pdfDocument;
    this.renderToken += 1;
    this.renderTask?.cancel();
    this.renderTask = null;
    this.pdfDocument = nextDocument;
    this.page = null;
    this.pageViewport = null;
    this.baseViewport = null;
    this.pageNumber = 1;
    this.zoom = 1;
    if (previousDocument) {
      try { await previousDocument.destroy(); } catch (_) { /* old worker may already be gone */ }
    }
    return { pageCount: nextDocument.numPages, title: nextDocument.title || '' };
  }

  get pageCount() {
    return this.pdfDocument?.numPages || 0;
  }

  setZoom(zoom) {
    this.zoom = clamp(zoom, 0.55, 2.6);
    return this.zoom;
  }

  async renderPage(pageNumber, strokes = []) {
    if (!this.pdfDocument) return null;
    const token = ++this.renderToken;
    this.renderTask?.cancel();
    this.renderTask = null;
    this.pageNumber = clamp(Math.floor(pageNumber), 1, this.pdfDocument.numPages);
    let page;
    try {
      page = await this.pdfDocument.getPage(this.pageNumber);
    } catch (error) {
      if (token !== this.renderToken) return null;
      throw error;
    }
    if (token !== this.renderToken) return null;

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, this.viewportElement.clientWidth - 72);
    const fitScale = Math.min(1.42, availableWidth / baseViewport.width);
    const scale = clamp(fitScale * this.zoom, 0.18, 3.0);
    const pageViewport = page.getViewport({ scale });
    const cssWidth = Math.ceil(pageViewport.width);
    const cssHeight = Math.ceil(pageViewport.height);
    const area = cssWidth * cssHeight;
    const deviceRatio = window.devicePixelRatio || 1;
    const pdfRatio = Math.max(1, Math.min(deviceRatio, 2, Math.sqrt(12_000_000 / Math.max(1, area))));
    const inkRatio = Math.max(1, Math.min(deviceRatio, 2.5, Math.sqrt(9_000_000 / Math.max(1, area))));

    this.page = page;
    this.baseViewport = baseViewport;
    this.pageViewport = pageViewport;
    this.paper.hidden = false;
    this.paper.dataset.page = String(this.pageNumber);
    this.paper.style.width = `${cssWidth}px`;
    this.paper.style.height = `${cssHeight}px`;
    this.configureCanvas(this.pdfCanvas, cssWidth, cssHeight, pdfRatio);
    this.configureCanvas(this.inkCanvas, cssWidth, cssHeight, inkRatio);
    this.configureCanvas(this.liveCanvas, cssWidth, cssHeight, inkRatio);
    this.configureCanvas(this.predictedCanvas, cssWidth, cssHeight, inkRatio);
    this.clearLive();

    const context = this.pdfCanvas.getContext('2d', { alpha: false });
    context.setTransform(pdfRatio, 0, 0, pdfRatio, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, cssWidth, cssHeight);
    const task = page.render({
      canvasContext: context,
      viewport: pageViewport,
      transform: [pdfRatio, 0, 0, pdfRatio, 0, 0],
      background: 'rgb(255,255,255)',
      intent: 'display',
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (error) {
      if (!isCancellation(error) && token === this.renderToken) throw error;
      return null;
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
    if (token !== this.renderToken) return null;
    this.drawAnnotations(strokes);
    return {
      pageNumber: this.pageNumber,
      pageCount: this.pageCount,
      width: cssWidth,
      height: cssHeight,
      zoom: this.zoom,
    };
  }

  configureCanvas(canvas, cssWidth, cssHeight, ratio) {
    const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  normalizedPoint(event, rect = this.liveCanvas.getBoundingClientRect()) {
    const tiltX = Number.isFinite(event.tiltX) ? event.tiltX : 0;
    const tiltY = Number.isFinite(event.tiltY) ? event.tiltY : 0;
    const tiltMagnitude = Math.min(90, Math.hypot(tiltX, tiltY));
    const altitudeAngle = Number.isFinite(event.altitudeAngle)
      ? event.altitudeAngle
      : (90 - tiltMagnitude) * Math.PI / 180;
    const azimuthAngle = Number.isFinite(event.azimuthAngle)
      ? event.azimuthAngle
      : Math.atan2(tiltY, tiltX);
    const pressure = Number.isFinite(event.pressure) && event.pressure > 0
      ? event.pressure
      : event.pointerType === 'mouse' ? .5 : event.buttons ? .28 : .45;
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      pressure: clamp(pressure, .08, 1),
      tiltX, tiltY, altitudeAngle, azimuthAngle,
      time: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
    };
  }

  drawAnnotations(strokes) {
    const ctx = this.inkCanvas.getContext('2d');
    const width = this.pageViewport?.width || 0;
    const height = this.pageViewport?.height || 0;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes || []) this.drawStroke(ctx, stroke, width, height);
  }

  drawLive(stroke) {
    const ctx = this.liveCanvas.getContext('2d');
    const width = this.pageViewport?.width || 0;
    const height = this.pageViewport?.height || 0;
    ctx.clearRect(0, 0, width, height);
    if (!stroke || !width || !height) return;
    this.drawStroke(ctx, stroke, width, height);
  }

  drawPredicted(stroke, predictedPoints = []) {
    const ctx = this.predictedCanvas.getContext('2d');
    const width = this.pageViewport?.width || 0;
    const height = this.pageViewport?.height || 0;
    ctx.clearRect(0, 0, width, height);
    if (!stroke || stroke.shape || !predictedPoints.length || !stroke.points?.length) return;
    const previous = stroke.points[stroke.points.length - 1];
    this.drawStroke(ctx, { ...stroke, points: [previous, ...predictedPoints] }, width, height);
  }

  clearLive() {
    const width = this.pageViewport?.width || 0;
    const height = this.pageViewport?.height || 0;
    this.liveCanvas.getContext('2d').clearRect(0, 0, width, height);
    this.predictedCanvas.getContext('2d').clearRect(0, 0, width, height);
  }

  drawStroke(ctx, stroke, width, height) {
    if (!stroke || !width || !height) return;
    if (stroke.kind === 'image') {
      if (typeof stroke.src !== 'string' || !stroke.src.startsWith('data:image/')) return;
      let image = this.imageCache.get(stroke.src);
      if (!image) {
        image = new Image();
        image.onload = () => this.onImageLoaded?.();
        image.src = stroke.src;
        this.imageCache.set(stroke.src, image);
        if (this.imageCache.size > 40) this.imageCache.delete(this.imageCache.keys().next().value);
      }
      if (image.complete && image.naturalWidth) {
        ctx.save();
        ctx.globalAlpha = Number.isFinite(stroke.opacity) ? stroke.opacity : 1;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, stroke.x * width, stroke.y * height, stroke.w * width, stroke.h * height);
        ctx.restore();
      }
      return;
    }

    const scale = this.pageViewport?.scale || 1;
    const highlighter = stroke.tool === 'highlighter';
    ctx.save();
    ctx.globalAlpha = Number.isFinite(stroke.opacity)
      ? stroke.opacity
      : highlighter ? .3 : stroke.mode === 'pencil' ? .62 : stroke.mode === 'marker' ? .88 : 1;
    ctx.globalCompositeOperation = highlighter || stroke.mode === 'pencil' ? 'multiply' : 'source-over';
    ctx.fillStyle = stroke.color || '#20283b';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.shape) {
      ctx.lineWidth = Math.max(.65, (Number(stroke.size) || 2) * scale);
      this.drawShape(ctx, stroke.shape, width, height);
    } else {
      const outline = createStrokeOutline(stroke, width, height, scale);
      if (outline.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);
        for (let index = 1; index < outline.length; index += 1) ctx.lineTo(outline[index].x, outline[index].y);
        ctx.closePath();
        ctx.fill();
        if (stroke.mode === 'pencil') drawPencilGrain(ctx, outline, stroke);
      }
    }
    ctx.restore();
  }

  drawShape(ctx, shape, width, height) {
    const a = pointOf(shape.start, width, height);
    const b = pointOf(shape.end, width, height);
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.beginPath();
    switch (shape.type) {
      case 'rect':
        ctx.rect(left, top, w, h);
        break;
      case 'ellipse':
        ctx.ellipse(left + w / 2, top + h / 2, Math.max(.5, w / 2), Math.max(.5, h / 2), 0, 0, Math.PI * 2);
        break;
      case 'triangle':
        ctx.moveTo(a.x, b.y);
        ctx.lineTo(left + w / 2, top);
        ctx.lineTo(b.x, b.y);
        ctx.closePath();
        break;
      case 'arrow':
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        drawArrowHead(ctx, a, b, ctx.lineWidth);
        return;
      case 'line':
      default:
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        break;
    }
    ctx.stroke();
  }

  async renderForExport(pageNumber, canvas, maxWidth = 460) {
    if (!this.pdfDocument) throw new Error('PDF açık değil.');
    const page = await this.pdfDocument.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / base.width, 1);
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    await page.render({ canvasContext: ctx, viewport, transform: [ratio, 0, 0, ratio, 0, 0], background: 'rgb(255,255,255)' }).promise;
    return { width: viewport.width, height: viewport.height };
  }

  async close() {
    this.openToken += 1;
    this.renderToken += 1;
    this.renderTask?.cancel();
    this.renderTask = null;
    if (this.loadingTask) {
      try { await this.loadingTask.destroy(); } catch (_) { /* load teardown is best effort */ }
      this.loadingTask = null;
    }
    if (this.pdfDocument) {
      try { await this.pdfDocument.destroy(); } catch (_) { /* teardown is best effort */ }
    }
    this.pdfDocument = null;
    this.page = null;
    this.pageViewport = null;
    this.baseViewport = null;
    this.imageCache.clear();
    this.paper.hidden = true;
    for (const canvas of [this.pdfCanvas, this.inkCanvas, this.liveCanvas, this.predictedCanvas]) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}
