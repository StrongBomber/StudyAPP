import { WorkspaceStore, mapLegacyWorkspace } from './storage.js';
import { PdfRenderer } from './renderer.js';
import { createAnnotatedPdf, downloadBytes, safeFilename } from './export.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  appShell: $('#appShell'), sidebar: $('#sidebar'), mobileMenu: $('#mobileMenuButton'), mobileScrim: $('#mobileScrim'),
  openButtons: [$('#openPdfButton'), $('#welcomeOpenButton')], sampleButtons: [$('#openSampleButton'), $('#welcomeSampleButton')],
  pdfInput: $('#pdfFileInput'), documentTitle: $('#documentTitle'), documentLibrary: $('#documentLibrary'), documentCount: $('#documentCountPill'),
  pageList: $('#pageList'), pageCountPill: $('#pageCountPill'), pageInput: $('#pageNumberInput'), totalPages: $('#totalPageCount'),
  previousPage: $('#previousPageButton'), nextPage: $('#nextPageButton'), zoomOut: $('#zoomOutButton'), zoomIn: $('#zoomInButton'),
  zoomReadout: $('#zoomReadout'), documentPageLabel: $('#workspacePageLabel'), viewer: $('#viewer'), viewerScroll: $('#viewerScroll'),
  paper: $('#paper'), pdfCanvas: $('#pdfCanvas'), inkCanvas: $('#inkCanvas'), liveCanvas: $('#liveCanvas'), predictedCanvas: $('#predictedCanvas'),
  imageOverlay: $('#imageOverlay'), brushCursor: $('#brushCursor'), imageInput: $('#imageFileInput'), imageInsertButton: $('#insertImageButton'), imageDeleteButton: $('#deleteImageButton'), imageResizeHandle: $('#imageResizeHandle'), welcome: $('#welcomePanel'),
  loading: $('#loadingOverlay'), loadingText: $('#loadingText'), viewerHint: $('#viewerHint'), exportButton: $('#exportButton'),
  saveStatus: $('#saveStatus'), saveStatusText: $('#saveStatusText'), panelToggle: $('#panelToggleButton'), panelClose: $('#panelCloseButton'),
  notesPanel: $('#notesPanel'), note: $('#pageNote'), notesDocumentName: $('#notesDocumentName'), notesPageContext: $('#notesPageContext'),
  aiToggle: $('#aiToggleButton'), aiPanel: $('#aiPanel'), aiScrim: $('#aiScrim'), aiClose: $('#aiCloseButton'),
  aiMessages: $('#aiMessages'), aiWelcome: $('#aiWelcome'), aiForm: $('#aiForm'), aiInput: $('#aiInput'), aiSend: $('#aiSendButton'),
  aiSharePageText: $('#aiSharePageText'), aiShareStatus: $('#aiShareStatus'),
  completionButton: $('#completionButton'), completionTitle: $('#completionTitle'), completionSubtitle: $('#completionSubtitle'),
  completionCount: $('#completionCount'), completionMeter: $('#completionMeterFill'), undoButton: $('#undoButton'), redoButton: $('#redoButton'),
  toolButtons: [...document.querySelectorAll('[data-tool]')], brushTypeControl: $('#brushTypeControl'), brushType: $('#brushType'), shapePicker: $('#shapePicker'), shapeKind: $('#shapeKind'),
  colorButtons: [...document.querySelectorAll('[data-color]')], customColor: $('#customColorInput'), sizeRange: $('#sizeRange'), sizeValue: $('#sizeValue'), brushPreview: $('#brushPreview'), opacityRange: $('#opacityRange'), opacityValue: $('#opacityValue'),
  stabilizationRange: $('#stabilizationRange'), stabilizationValue: $('#stabilizationValue'),
  pressureRange: $('#pressureRange'), pressureValue: $('#pressureValue'),
  toastRegion: $('#toastRegion'),
};

const store = new WorkspaceStore();
const renderer = new PdfRenderer({
  viewport: elements.viewerScroll,
  paper: elements.paper,
  pdfCanvas: elements.pdfCanvas,
  inkCanvas: elements.inkCanvas,
  liveCanvas: elements.liveCanvas,
  predictedCanvas: elements.predictedCanvas,
});

const state = {
  document: null,
  bytes: null,
  pageNumber: 1,
  pageData: null,
  tool: 'pen',
  brushType: 'ink',
  color: '#3449d8',
  penColor: '#3449d8',
  highlighterColor: '#ffd54a',
  size: 2,
  opacity: 1,
  stabilization: .18,
  pressureSensitivity: .58,
  shapeType: 'line',
  zoom: 1,
  undo: [],
  redo: [],
  activePointerId: null,
  pointerTool: null,
  pointerRect: null,
  activeStroke: null,
  activePan: null,
  predictedPoints: [],
  pendingErasePoint: null,
  erasedIds: new Set(),
  touchPoints: new Map(),
  suppressedPointers: new Set(),
  selectedImage: null,
  imageGesture: null,
  pinch: null,
  saveTimer: null,
  saveQueue: Promise.resolve(),
  metaQueue: Promise.resolve(),
  pageLoadToken: 0,
  aiConversation: [],
  aiBusy: false,
  aiCloseTimer: 0,
  aiRequestToken: 0,
  aiAbortController: null,
  liveFrame: 0,
  inkFrame: 0,
  eraseFrame: 0,
  resizeTimer: null,
  storageReady: false,
};

renderer.onImageLoaded = () => { if (state.pageData) scheduleInkRedraw(); };

const MAX_HISTORY = 160;
const ROW_HEIGHT = 40;
const BRUSH_SETTINGS_KEY = 'cozum-study-brush-settings';
let pageListTrack = null;

function restoreBrushSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(BRUSH_SETTINGS_KEY) || '{}') || {};
    if (typeof saved !== 'object') return;
    const brushTypes = ['ink', 'fountain', 'brush', 'pencil', 'marker'];
    if (brushTypes.includes(saved.brushType)) {
      state.brushType = saved.brushType;
      elements.brushType.value = saved.brushType;
    }
    if (/^#[0-9a-f]{6}$/i.test(saved.penColor || '')) state.penColor = saved.penColor;
    if (/^#[0-9a-f]{6}$/i.test(saved.highlighterColor || '')) state.highlighterColor = saved.highlighterColor;
    state.color = state.penColor;
    if (Number.isFinite(saved.size) && saved.size >= .5 && saved.size <= 24) elements.sizeRange.value = String(Math.round(saved.size * 2) / 2);
    if (Number.isFinite(saved.opacity) && saved.opacity >= .1 && saved.opacity <= 1) elements.opacityRange.value = String(Math.round(saved.opacity * 100 / 5) * 5);
    if (Number.isFinite(saved.stabilization) && saved.stabilization >= 0 && saved.stabilization <= .5) elements.stabilizationRange.value = String(Math.round(saved.stabilization * 50) * 2);
    if (Number.isFinite(saved.pressureSensitivity) && saved.pressureSensitivity >= 0 && saved.pressureSensitivity <= 1) elements.pressureRange.value = String(Math.round(saved.pressureSensitivity * 50) * 2);
  } catch (_) { /* preferences are optional in private or storage-restricted browsing */ }
}

function persistBrushSettings() {
  try {
    window.localStorage.setItem(BRUSH_SETTINGS_KEY, JSON.stringify({
      brushType: state.brushType, penColor: state.penColor, highlighterColor: state.highlighterColor,
      size: state.size, opacity: state.opacity, stabilization: state.stabilization,
      pressureSensitivity: state.pressureSensitivity,
    }));
  } catch (_) { /* the drawing workspace remains usable when preferences cannot be stored */ }
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'PDF';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function relativeDate(timestamp) {
  if (!timestamp) return 'Henüz açılmadı';
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} gün önce`;
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(timestamp));
}

function showToast(message, type = 'default', duration = 3400) {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`;
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = type === 'error' ? '!' : type === 'success' ? '✓' : 'i';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function updateAIShareStatus() {
  if (!state.document) {
    elements.aiShareStatus.textContent = 'Önce bir PDF aç. Seçim yalnızca metni paylaşır.';
  } else if (elements.aiSharePageText.checked) {
    elements.aiShareStatus.textContent = `Bu gönderimde yalnızca açık sayfa (${state.pageNumber}) metin olarak paylaşılacak.`;
  } else {
    elements.aiShareStatus.textContent = 'Kapalı: PDF metni AI ile paylaşılmaz.';
  }
}

function appendAIMessage(role, content, { error = false } = {}) {
  elements.aiWelcome.hidden = true;
  const row = document.createElement('div');
  row.className = `ai-message-row is-${role}${error ? ' is-error' : ''}`;
  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  bubble.textContent = content;
  row.append(bubble);
  elements.aiMessages.append(row);
  elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
}

function setAIChatBusy(busy) {
  state.aiBusy = busy;
  elements.aiPanel.setAttribute('aria-busy', String(busy));
  elements.aiSend.disabled = busy;
  elements.aiSend.classList.toggle('is-loading', busy);
  elements.aiInput.disabled = busy;
  elements.aiSharePageText.disabled = busy || !state.document;
}

function clearAIConversation(resetConsent = false) {
  state.aiRequestToken += 1;
  state.aiAbortController?.abort();
  state.aiAbortController = null;
  setAIChatBusy(false);
  state.aiConversation = [];
  elements.aiMessages.replaceChildren(elements.aiWelcome);
  elements.aiWelcome.hidden = false;
  if (resetConsent) elements.aiSharePageText.checked = false;
  updateAIShareStatus();
}

function setAIPanelOpen(open) {
  window.clearTimeout(state.aiCloseTimer);
  if (open) {
    closeMobileOverlays();
    elements.aiPanel.hidden = false;
    elements.aiScrim.hidden = false;
    elements.aiToggle.setAttribute('aria-expanded', 'true');
    elements.aiToggle.setAttribute('aria-label', 'AI çalışma asistanını kapat');
    requestAnimationFrame(() => {
      if (elements.aiToggle.getAttribute('aria-expanded') === 'true') elements.aiPanel.classList.add('is-open');
    });
    window.setTimeout(() => {
      if (elements.aiToggle.getAttribute('aria-expanded') === 'true') elements.aiInput.focus();
    }, 180);
    return;
  }
  elements.aiPanel.classList.remove('is-open');
  elements.aiScrim.hidden = true;
  elements.aiToggle.setAttribute('aria-expanded', 'false');
  elements.aiToggle.setAttribute('aria-label', 'AI çalışma asistanını aç');
  state.aiCloseTimer = window.setTimeout(() => { elements.aiPanel.hidden = true; }, 260);
  elements.aiToggle.focus();
}

async function sendAIMessage(event) {
  event.preventDefault();
  if (state.aiBusy) return;
  const prompt = elements.aiInput.value.trim();
  if (!prompt) return;

  const optedIntoPageText = elements.aiSharePageText.checked && Boolean(state.document);
  const selectedDocumentId = state.document?.id || null;
  const selectedPage = state.pageNumber;
  const requestToken = ++state.aiRequestToken;
  state.aiConversation.push({ role: 'user', content: prompt });
  state.aiConversation = state.aiConversation.slice(-12);
  appendAIMessage('user', prompt);
  elements.aiInput.value = '';
  setAIChatBusy(true);

  try {
    let pageText = '';
    if (optedIntoPageText) {
      pageText = await renderer.extractPageText(selectedPage, 10_000);
      if (requestToken !== state.aiRequestToken) return;
      if (state.document?.id !== selectedDocumentId || state.pageNumber !== selectedPage) {
        throw new Error('PDF sayfası değişti. İsteğini yeni sayfada tekrar gönder.');
      }
      if (!pageText) {
        throw new Error('Bu sayfada seçilebilir metin bulunamadı. Taranmış sayfayı kendin yazabilir veya paylaşımı kapatıp genel bir soru sorabilirsin.');
      }
    }

    const controller = new AbortController();
    state.aiAbortController = controller;
    const requestBody = {
      messages: state.aiConversation.slice(-12),
      includePageText: optedIntoPageText,
    };
    if (optedIntoPageText) requestBody.pageText = `Sayfa ${selectedPage}:\n${pageText}`;

    const response = await fetch(new URL('../api/chat.php', import.meta.url), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (requestToken !== state.aiRequestToken) return;
    if (!response.ok) throw new Error(result.error || 'AI yanıt veremedi. Sunucu ayarlarını veya internet bağlantını kontrol et.');
    const answer = typeof result.reply === 'string' ? result.reply.trim() : '';
    if (!answer) throw new Error('AI boş yanıt verdi. Biraz sonra tekrar dene.');

    state.aiConversation.push({ role: 'assistant', content: answer });
    state.aiConversation = state.aiConversation.slice(-12);
    appendAIMessage('assistant', answer);
  } catch (error) {
    if (requestToken !== state.aiRequestToken || error?.name === 'AbortError') return;
    appendAIMessage('assistant', error?.message || 'AI yanıtı alınamadı. Lütfen tekrar dene.', { error: true });
  } finally {
    if (requestToken === state.aiRequestToken) {
      state.aiAbortController = null;
      setAIChatBusy(false);
      if (elements.aiToggle.getAttribute('aria-expanded') === 'true') elements.aiInput.focus();
    }
  }
}

function setSaveState(mode) {
  elements.saveStatus.classList.toggle('is-saving', mode === 'saving');
  elements.saveStatus.classList.toggle('is-error', mode === 'error');
  elements.saveStatusText.textContent = mode === 'saving' ? 'Kaydediliyor…' : mode === 'error' ? 'Kaydedilemedi' : state.document ? 'Kaydedildi' : 'Dosyaların cihazında kalır';
  elements.saveStatus.setAttribute('aria-label', elements.saveStatusText.textContent);
}

function setLoading(visible, message = 'PDF hazırlanıyor…') {
  elements.loading.hidden = !visible;
  elements.loadingText.textContent = message;
}

function blankPageData(documentId = '', pageNumber = 1) {
  return { documentId, pageNumber, strokes: [], note: '', completed: false };
}

function cloneStroke(stroke) {
  return {
    ...stroke,
    points: stroke.points?.map((point) => ({ ...point })),
    shape: stroke.shape ? { ...stroke.shape, start: { ...stroke.shape.start }, end: { ...stroke.shape.end } } : undefined,
    bounds: stroke.bounds ? { ...stroke.bounds } : undefined,
  };
}

function clonePageData(page) {
  return { ...page, strokes: (page.strokes || []).map(cloneStroke) };
}

function queuePageSave() {
  if (!state.document || !state.pageData) return;
  window.clearTimeout(state.saveTimer);
  setSaveState('saving');
  state.saveTimer = window.setTimeout(() => { void persistPage(); }, 420);
}

async function persistPage() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.document || !state.pageData) return;
  const pageSnapshot = clonePageData(state.pageData);
  const docId = state.document.id;
  const task = state.saveQueue.catch(() => {}).then(() => store.savePage(pageSnapshot));
  state.saveQueue = task;
  try {
    await task;
    if (state.document?.id === docId) setSaveState('saved');
  } catch (error) {
    console.error('Page save failed:', error);
    if (state.document?.id === docId) setSaveState('error');
  }
}

async function flushPageSave() {
  if (state.saveTimer) await persistPage();
  else {
    try { await state.saveQueue; } catch (_) { /* error was already announced */ }
  }
}

function queueDocumentSave(patch = {}) {
  if (!state.document) return Promise.resolve();
  const next = { ...state.document, ...patch, updatedAt: Date.now() };
  state.document = next;
  const snapshot = { ...next, completedPages: [...(next.completedPages || [])] };
  const task = state.metaQueue.catch(() => {}).then(() => store.saveDocument(snapshot));
  state.metaQueue = task;
  return task.then(() => {
    if (state.document?.id === snapshot.id) setSaveState('saved');
  }).catch((error) => {
    console.error('Document metadata save failed:', error);
    if (state.document?.id === snapshot.id) setSaveState('error');
  });
}

function renderDocumentLibrary(documents) {
  elements.documentLibrary.replaceChildren();
  elements.documentCount.textContent = String(documents.length);
  if (!documents.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.innerHTML = 'Açtığın belgeler<br>burada saklanır.';
    elements.documentLibrary.append(empty);
    return;
  }
  for (const doc of documents.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = `document-list-row${state.document?.id === doc.id ? ' is-current' : ''}`;
    const open = document.createElement('button');
    open.className = 'document-list-item';
    open.type = 'button';
    open.dataset.documentId = doc.id;
    open.title = doc.title || 'Adsız PDF';
    open.setAttribute('aria-current', state.document?.id === doc.id ? 'page' : 'false');
    const icon = document.createElement('span');
    icon.className = 'document-list-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.75h7l5 5v11.5h-12V3.75Z"/><path d="M13.5 4v5h5M9 14h6M9 17h4"/></svg>';
    const copy = document.createElement('span');
    copy.className = 'document-list-copy';
    const title = document.createElement('strong');
    title.textContent = doc.title || 'Adsız PDF';
    const meta = document.createElement('small');
    meta.textContent = `${doc.pageCount || 0} sayfa · ${relativeDate(doc.updatedAt)}`;
    copy.append(title, meta);
    const dot = document.createElement('span');
    dot.className = 'document-current-dot';
    dot.setAttribute('aria-hidden', 'true');
    open.append(icon, copy, dot);
    const remove = document.createElement('button');
    remove.className = 'document-remove-button';
    remove.type = 'button';
    remove.dataset.removeDocument = doc.id;
    remove.setAttribute('aria-label', `${doc.title || 'PDF'} belgesini kaldır`);
    remove.title = 'Belgeyi kaldır';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l.7 13h11.6l.7-13M9 7V4h6v3"/></svg>';
    row.append(open, remove);
    elements.documentLibrary.append(row);
  }
}

async function refreshDocumentLibrary() {
  if (!state.storageReady) return;
  try {
    renderDocumentLibrary(await store.listDocuments());
  } catch (error) {
    console.error('Document list failed:', error);
  }
}

function renderVisiblePages() {
  if (!pageListTrack || !state.document) return;
  const total = state.document.pageCount;
  const height = elements.pageList.clientHeight || 220;
  const start = Math.max(1, Math.floor(elements.pageList.scrollTop / ROW_HEIGHT) - 2);
  const end = Math.min(total, Math.ceil((elements.pageList.scrollTop + height) / ROW_HEIGHT) + 3);
  const fragment = document.createDocumentFragment();
  for (let number = start; number <= end; number += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `page-list-item${number === state.pageNumber ? ' is-active' : ''}`;
    button.dataset.pageNumber = String(number);
    button.style.top = `${(number - 1) * ROW_HEIGHT + 1}px`;
    button.setAttribute('aria-current', number === state.pageNumber ? 'page' : 'false');
    const pageNumber = document.createElement('span');
    pageNumber.className = 'page-list-number';
    pageNumber.textContent = String(number).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'page-list-name';
    label.textContent = `Sayfa ${number}`;
    button.append(pageNumber, label);
    if (state.document.completedPages?.includes(number)) {
      const mark = document.createElement('span');
      mark.className = 'page-list-mark';
      mark.title = 'Tamamlandı';
      mark.setAttribute('aria-label', 'Tamamlandı');
      button.append(mark);
    }
    fragment.append(button);
  }
  pageListTrack.replaceChildren(fragment);
}

function buildPageList(scrollToCurrent = true) {
  elements.pageList.replaceChildren();
  pageListTrack = null;
  if (!state.document?.pageCount) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.innerHTML = 'PDF açınca sayfaların<br>burada görünür.';
    elements.pageList.append(empty);
    return;
  }
  pageListTrack = document.createElement('div');
  pageListTrack.className = 'page-list-track';
  pageListTrack.style.height = `${state.document.pageCount * ROW_HEIGHT}px`;
  elements.pageList.append(pageListTrack);
  if (scrollToCurrent) elements.pageList.scrollTop = Math.max(0, (state.pageNumber - 1) * ROW_HEIGHT - 80);
  renderVisiblePages();
}

function updatePageList() {
  if (pageListTrack && state.document) {
    const firstVisible = Math.floor(elements.pageList.scrollTop / ROW_HEIGHT) + 1;
    const visibleRows = Math.max(1, Math.ceil(elements.pageList.clientHeight / ROW_HEIGHT));
    if (state.pageNumber < firstVisible || state.pageNumber >= firstVisible + visibleRows) {
      elements.pageList.scrollTop = Math.max(0, (state.pageNumber - 2) * ROW_HEIGHT);
    }
  }
  renderVisiblePages();
}

function updateCompletionUI() {
  const doc = state.document;
  const total = doc?.pageCount || 0;
  const completed = doc?.completedPages?.length || 0;
  const isComplete = Boolean(state.pageData?.completed);
  elements.completionCount.textContent = `${completed} / ${total}`;
  elements.completionMeter.style.width = `${total ? Math.round(completed / total * 100) : 0}%`;
  elements.completionButton.disabled = !doc;
  elements.completionButton.classList.toggle('is-complete', isComplete);
  elements.completionButton.setAttribute('aria-pressed', String(isComplete));
  elements.completionTitle.textContent = isComplete ? 'Bu sayfa tamamlandı' : 'Bu sayfayı tamamlandı işaretle';
  elements.completionSubtitle.textContent = isComplete ? 'İlerlemen bu cihazda saklandı' : 'İlerlemen kaydedilir';
}

function updatePageUI() {
  const doc = state.document;
  const enabled = Boolean(doc);
  const total = doc?.pageCount || 0;
  elements.pageInput.disabled = !enabled;
  elements.pageInput.max = String(Math.max(1, total));
  elements.pageInput.value = String(enabled ? state.pageNumber : 1);
  elements.totalPages.textContent = enabled ? String(total) : '—';
  elements.pageCountPill.textContent = enabled ? String(total) : '—';
  elements.previousPage.disabled = !enabled || state.pageNumber <= 1;
  elements.nextPage.disabled = !enabled || state.pageNumber >= total;
  elements.zoomIn.disabled = !enabled;
  elements.zoomOut.disabled = !enabled;
  elements.exportButton.disabled = !enabled;
  elements.aiSharePageText.disabled = !enabled;
  if (!enabled) elements.aiSharePageText.checked = false;
  updateAIShareStatus();
  elements.documentPageLabel.textContent = enabled ? `Sayfa ${state.pageNumber} / ${total}` : 'Bir PDF açarak başla';
  elements.viewerHint.hidden = !enabled;
  elements.welcome.hidden = enabled;
  elements.paper.hidden = !enabled;
  elements.notesDocumentName.textContent = doc?.title || 'Henüz PDF yok';
  elements.notesPageContext.textContent = enabled ? `Sayfa ${state.pageNumber} · notların burada` : 'Sayfa notları burada';
  elements.note.disabled = !enabled;
  if (enabled) elements.note.value = state.pageData?.note || '';
  else elements.note.value = '';
  if (!state.pageData?.strokes.includes(state.selectedImage)) state.selectedImage = null;
  updateImageOverlay();
  updateCompletionUI();
  updateHistoryButtons();
  updatePageList();
}

function updateHistoryButtons() {
  elements.undoButton.disabled = !state.undo.length || !state.document;
  elements.redoButton.disabled = !state.redo.length || !state.document;
}

function updateZoomUI() {
  elements.zoomReadout.textContent = Math.abs(state.zoom - 1) < .015 ? 'Sığdır' : `${Math.round(state.zoom * 100)}%`;
}

async function renderCurrentPage({ showSpinner = false } = {}) {
  if (!state.document || !state.pageData) return;
  const docId = state.document.id;
  const pageNumber = state.pageNumber;
  const token = ++state.pageLoadToken;
  if (showSpinner) setLoading(true, 'Sayfa çiziliyor…');
  try {
    await renderer.renderPage(pageNumber, state.pageData.strokes);
  } catch (error) {
    if (token === state.pageLoadToken) {
      console.error('PDF page render failed:', error);
      showToast('Bu PDF sayfası çizilemedi. Belge bozuk veya desteklenmeyen bir biçimde olabilir.', 'error', 5200);
    }
  } finally {
    if (token === state.pageLoadToken && state.document?.id === docId) setLoading(false);
  }
  updateImageOverlay();
  updateZoomUI();
}

async function navigateToPage(requestedPage, { updateDocument = true } = {}) {
  if (!state.document) return;
  const total = state.document.pageCount;
  const nextPage = Math.min(total, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  if (nextPage === state.pageNumber && state.pageData) {
    elements.pageInput.value = String(nextPage);
    return;
  }
  await flushPageSave();
  const docId = state.document.id;
  const token = ++state.pageLoadToken;
  state.activeStroke = null;
  state.activePan = null;
  state.activePointerId = null;
  state.pointerTool = null;
  state.pointerRect = null;
  state.selectedImage = null;
  elements.imageOverlay.hidden = true;
  renderer.clearLive();
  setLoading(true, 'Sayfa açılıyor…');
  try {
    const pageData = await store.getPage(docId, nextPage);
    if (token !== state.pageLoadToken || state.document?.id !== docId) return;
    state.pageNumber = nextPage;
    state.pageData = pageData;
    state.undo = [];
    state.redo = [];
    updatePageUI();
    await renderer.renderPage(nextPage, pageData.strokes);
    if (token !== state.pageLoadToken || state.document?.id !== docId) return;
    setLoading(false);
    updateZoomUI();
    if (updateDocument) {
      await queueDocumentSave({ lastPage: nextPage });
      void refreshDocumentLibrary();
    }
  } catch (error) {
    console.error('Page open failed:', error);
    if (token === state.pageLoadToken) {
      setLoading(false);
      showToast('Sayfa bilgisi açılamadı. Yeniden deneyin.', 'error');
    }
  }
}

async function activateDocument(doc, bytes, { rendererAlreadyOpen = false, quiet = false } = {}) {
  await flushPageSave();
  clearAIConversation(true);
  state.pageLoadToken += 1;
  state.document = { ...doc, completedPages: [...(doc.completedPages || [])] };
  state.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  state.pageNumber = Math.min(Math.max(1, doc.lastPage || 1), doc.pageCount || 1);
  state.zoom = 1;
  state.undo = [];
  state.redo = [];
  state.pageData = null;
  elements.documentTitle.textContent = doc.title || 'Adsız PDF';
  if (!rendererAlreadyOpen) {
    setLoading(true, 'PDF açılıyor…');
    const info = await renderer.open(state.bytes);
    state.document.pageCount = info.pageCount;
    state.document.title = doc.title || info.title || 'Adsız PDF';
  }
  try {
    state.pageData = await store.getPage(doc.id, state.pageNumber);
  } catch (error) {
    console.error('Page data could not be read:', error);
    state.pageData = blankPageData(doc.id, state.pageNumber);
    if (!quiet) showToast('Bu sayfanın eski notları okunamadı; yeni çizimler yine çalışır.', 'error');
  }
  elements.documentTitle.textContent = state.document.title;
  updatePageUI();
  buildPageList(true);
  await renderCurrentPage({ showSpinner: true });
  setLoading(false);
  await queueDocumentSave({ lastPage: state.pageNumber });
  void refreshDocumentLibrary();
  if (!quiet) showToast(`“${state.document.title}” hazır. Çalışman otomatik kaydedilir.`, 'success', 2800);
}

async function openStoredDocument(id, { quiet = false } = {}) {
  if (!state.storageReady) {
    showToast('Kayıtlı belgeleri açmak için bu tarayıcıda yerel depolama açık olmalı.', 'error');
    return;
  }
  if (state.document?.id === id) return;
  setLoading(true, 'Belge geri yükleniyor…');
  try {
    await flushPageSave();
    const doc = await store.getDocument(id);
    if (!doc) throw new Error('Bu belge çalışma listesinden kaldırılmış.');
    const bytes = await store.getFile(id);
    if (!bytes) throw new Error('PDF dosyası bulunamadı. Dosya kaydı tarayıcı tarafından temizlenmiş olabilir.');
    const info = await renderer.open(bytes);
    if (!info) return;
    await activateDocument({ ...doc, pageCount: info.pageCount }, bytes, { rendererAlreadyOpen: true, quiet });
  } catch (error) {
    console.error('Stored PDF could not be opened:', error);
    setLoading(false);
    showToast(error?.message || 'Kayıtlı PDF açılamadı.', 'error', 5200);
  }
}

async function createDocumentFromBytes(title, bytes, { isSample = false } = {}) {
  setLoading(true, 'PDF doğrulanıyor…');
  try {
    const header = new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5));
    if (!header.startsWith('%PDF-')) throw new Error('Seçtiğin dosya geçerli bir PDF gibi görünmüyor.');
    await flushPageSave();
    const info = await renderer.open(bytes);
    if (!info) return;
    const now = Date.now();
    const doc = {
      id: randomId(), title: title || 'Adsız PDF', pageCount: info.pageCount,
      byteLength: bytes.byteLength, createdAt: now, updatedAt: now, lastPage: 1,
      completedPages: [], isSample,
    };
    let legacyMigration = null;
    if (isSample && state.storageReady) {
      try {
        const oldWorkspace = await store.getLegacyDemoWork();
        if (oldWorkspace) {
          legacyMigration = mapLegacyWorkspace(oldWorkspace, doc.id, info.pageCount, true);
          doc.completedPages = legacyMigration.completedPages;
        }
      } catch (error) { console.warn('Örnek çalışma notları içe aktarılamadı:', error); }
    }
    state.document = { ...doc };
    state.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    state.pageNumber = 1;
    state.pageData = legacyMigration?.pages.find((page) => page.pageNumber === 1) || blankPageData(doc.id, 1);
    state.zoom = 1;
    state.undo = [];
    state.redo = [];
    let stored = false;
    if (state.storageReady) {
      try {
        await store.saveNewDocument(doc, bytes);
        stored = true;
      } catch (error) {
        console.error('New document could not be persisted:', error);
      }
      if (stored && legacyMigration) {
        try {
          for (const page of legacyMigration.pages) await store.savePage(page);
          await store.clearLegacyDemoWork();
        } catch (error) { console.warn('Örnek belge eski notlarla açıldı ancak bir sayfa kaydı tamamlanamadı:', error); }
      }
    }
    elements.documentTitle.textContent = doc.title;
    updatePageUI();
    buildPageList(true);
    await renderCurrentPage({ showSpinner: true });
    setLoading(false);
    if (stored) {
      setSaveState('saved');
      void refreshDocumentLibrary();
      showToast(`“${doc.title}” çalışma alanına eklendi.`, 'success', 2800);
    } else {
      setSaveState('error');
      showToast('PDF açıldı; ancak tarayıcı depolama alanına kaydedilemedi. Çizim yapmadan önce yer açıp sayfayı yenileme.', 'error', 6000);
    }
  } catch (error) {
    console.error('PDF import failed:', error);
    setLoading(false);
    showToast(error?.message || 'PDF açılamadı. Dosyanın sağlam olduğundan emin ol.', 'error', 5200);
  }
}

async function handlePdfFile(file) {
  if (!file) return;
  if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
    showToast('Lütfen bir PDF dosyası seç.', 'error');
    return;
  }
  if (file.size > 150 * 1024 * 1024) {
    showToast('Bu PDF çok büyük (150 MB üzeri). Daha küçük veya sıkıştırılmış bir kopya dene.', 'error', 5200);
    return;
  }
  setLoading(true, 'Dosya okunuyor…');
  try {
    const bytes = await file.arrayBuffer();
    await createDocumentFromBytes(file.name || 'Adsız PDF', bytes);
  } catch (error) {
    console.error('File read failed:', error);
    setLoading(false);
    showToast('PDF dosyası okunamadı.', 'error');
  }
}

async function insertImageFile(file) {
  if (!file || !state.document || !state.pageData) return;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  if (mime === 'image/svg+xml' || extension === 'svg') { showToast('Güvenlik için SVG yerine PNG, JPEG, WebP, GIF veya BMP kullan.', 'error'); return; }
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
  const allowedExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  if (!allowedTypes.includes(mime) && !allowedExtensions.includes(extension)) { showToast('PNG, JPEG, WebP, GIF veya BMP görseli seç.', 'error'); return; }
  if (file.size > 40 * 1024 * 1024) { showToast('Bu görsel çok büyük. 40 MB altında bir dosya dene.', 'error'); return; }
  const objectUrl = URL.createObjectURL(file);
  setLoading(true, 'Görsel hazırlanıyor…');
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Görsel okunamadı.'));
      image.src = objectUrl;
    });
    const scale = Math.min(1, 2560 / image.naturalWidth, 2560 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (file.type !== 'image/png') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const src = mime === 'image/png' ? canvas.toDataURL(mime) : canvas.toDataURL(mime, .91);
    const pageWidth = elements.liveCanvas.clientWidth;
    const pageHeight = elements.liveCanvas.clientHeight;
    let width = Math.min(pageWidth * .42, 360);
    let height = width * image.naturalHeight / image.naturalWidth;
    const maxHeight = pageHeight * .62;
    if (height > maxHeight) { height = maxHeight; width = height * image.naturalWidth / image.naturalHeight; }
    const item = {
      id: randomId(), kind: 'image', src, x: (pageWidth - width) / (2 * pageWidth),
      y: (pageHeight - height) / (2 * pageHeight), w: width / pageWidth, h: height / pageHeight, opacity: 1,
    };
    item.bounds = calculateBounds(item);
    addStroke(item);
    selectImage(item);
    showToast('Görsel eklendi. Çerçeveyi sürükle; köşeden boyutlandır.', 'success', 3000);
  } catch (error) {
    console.error('Image import failed:', error);
    showToast(error?.message || 'Görsel eklenemedi.', 'error');
  } finally {
    URL.revokeObjectURL(objectUrl);
    setLoading(false);
  }
}

async function openSample() {
  try {
    if (state.storageReady) {
      const docs = await store.listDocuments();
      const existing = docs.find((doc) => doc.isSample);
      if (existing) {
        await openStoredDocument(existing.id);
        return;
      }
    }
    setLoading(true, 'Örnek belge hazırlanıyor…');
    const response = await fetch(new URL('../assets/demo.pdf', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('Örnek belge yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.');
    const bytes = await response.arrayBuffer();
    await createDocumentFromBytes('Örnek çalışma.pdf', bytes, { isSample: true });
  } catch (error) {
    console.error('Sample PDF failed:', error);
    setLoading(false);
    showToast(error?.message || 'Örnek belge açılamadı.', 'error');
  }
}

function calculateBounds(stroke) {
  if (stroke.kind === 'image') return { minX: stroke.x, minY: stroke.y, maxX: stroke.x + stroke.w, maxY: stroke.y + stroke.h };
  if (stroke.shape) {
    const { start, end } = stroke.shape;
    return { minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y), maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y) };
  }
  const points = stroke.points || [];
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function shapeSegments(shape) {
  const { start: a, end: b } = shape;
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  if (shape.type === 'line' || shape.type === 'arrow') return [[a, b]];
  if (shape.type === 'rect') {
    const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }];
    return corners.slice(1).map((point, index) => [corners[index], point]);
  }
  if (shape.type === 'triangle') {
    const corners = [{ x: a.x, y: bottom }, { x: (left + right) / 2, y: top }, { x: b.x, y: bottom }, { x: a.x, y: bottom }];
    return corners.slice(1).map((point, index) => [corners[index], point]);
  }
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const segments = [];
  let previous = { x: cx + (right - left) / 2, y: cy };
  for (let index = 1; index <= 24; index += 1) {
    const angle = index / 24 * Math.PI * 2;
    const next = { x: cx + Math.cos(angle) * (right - left) / 2, y: cy + Math.sin(angle) * (bottom - top) / 2 };
    segments.push([previous, next]);
    previous = next;
  }
  return segments;
}

function distanceToSegment(point, start, end, width, height) {
  const px = point.x * width, py = point.y * height;
  const ax = start.x * width, ay = start.y * height;
  const bx = end.x * width, by = end.y * height;
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitTestStroke(stroke, point, radius, width, height) {
  if (stroke.kind === 'image') return point.x >= stroke.x - radius / width && point.x <= stroke.x + stroke.w + radius / width && point.y >= stroke.y - radius / height && point.y <= stroke.y + stroke.h + radius / height;
  const bounds = stroke.bounds || calculateBounds(stroke);
  const padX = (radius + 3) / width, padY = (radius + 3) / height;
  if (point.x < bounds.minX - padX || point.x > bounds.maxX + padX || point.y < bounds.minY - padY || point.y > bounds.maxY + padY) return false;
  const points = stroke.shape ? null : stroke.points || [];
  const segments = stroke.shape ? shapeSegments(stroke.shape) : points.slice(1).map((p, i) => [points[i], p]);
  if (!segments.length && points?.length === 1) return distanceToSegment(point, points[0], points[0], width, height) < radius + 4;
  return segments.some(([a, b]) => distanceToSegment(point, a, b, width, height) < radius + 4);
}

function processEraserPoint(point) {
  if (!state.pageData || !point) return;
  const list = state.pageData.strokes;
  const rect = elements.liveCanvas.getBoundingClientRect();
  const radius = Math.max(11, state.size * 1.4);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const stroke = list[index];
    if (state.erasedIds.has(stroke.id)) continue;
    if (!hitTestStroke(stroke, point, radius, rect.width, rect.height)) continue;
    state.erasedIds.add(stroke.id);
    list.splice(index, 1);
    state.undo.push({ type: 'remove', index, stroke });
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo.length = 0;
    scheduleInkRedraw();
    queuePageSave();
    updateHistoryButtons();
    break;
  }
}

function updateImageOverlay() {
  const image = state.selectedImage;
  if (!image || !state.pageData?.strokes.includes(image) || !renderer.pageViewport) {
    elements.imageOverlay.hidden = true;
    state.selectedImage = null;
    return;
  }
  const width = renderer.pageViewport.width;
  const height = renderer.pageViewport.height;
  elements.imageOverlay.hidden = false;
  elements.imageOverlay.style.left = `${image.x * width}px`;
  elements.imageOverlay.style.top = `${image.y * height}px`;
  elements.imageOverlay.style.width = `${image.w * width}px`;
  elements.imageOverlay.style.height = `${image.h * height}px`;
}

function selectImage(image) {
  state.selectedImage = image || null;
  updateImageOverlay();
}

function findImageAt(point) {
  const strokes = state.pageData?.strokes || [];
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const image = strokes[index];
    if (image.kind === 'image' && point.x >= image.x && point.x <= image.x + image.w && point.y >= image.y && point.y <= image.y + image.h) return image;
  }
  return null;
}

function deselectImage() {
  selectImage(null);
}

function startImageGesture(event, mode, rect = elements.liveCanvas.getBoundingClientRect()) {
  const image = state.selectedImage;
  if (!image || !state.pageData) return;
  event.preventDefault();
  event.stopPropagation();
  state.activePointerId = null;
  state.pointerTool = null;
  state.pointerRect = null;
  state.imageGesture = {
    pointerId: event.pointerId,
    mode,
    image,
    rect,
    start: renderer.normalizedPoint(event, rect),
    before: { x: image.x, y: image.y, w: image.w, h: image.h },
  };
  try { elements.imageOverlay.setPointerCapture(event.pointerId); } catch (_) { /* optional capture */ }
}

function moveImageGesture(event) {
  const gesture = state.imageGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = renderer.normalizedPoint(event, gesture.rect);
  const dx = point.x - gesture.start.x;
  const dy = point.y - gesture.start.y;
  const image = gesture.image;
  const before = gesture.before;
  if (gesture.mode === 'resize') {
    const pageWidth = gesture.rect.width;
    const pageHeight = gesture.rect.height;
    const aspect = Math.max(.05, before.w * pageWidth / Math.max(1, before.h * pageHeight));
    let width = Math.max(38, before.w * pageWidth + dx * pageWidth);
    width = Math.min(width, pageWidth * (1 - before.x));
    let height = width / aspect;
    if (height > pageHeight * (1 - before.y)) {
      height = pageHeight * (1 - before.y);
      width = height * aspect;
    }
    image.w = Math.max(.02, width / pageWidth);
    image.h = Math.max(.02, height / pageHeight);
  } else {
    image.x = Math.max(0, Math.min(1 - image.w, before.x + dx));
    image.y = Math.max(0, Math.min(1 - image.h, before.y + dy));
  }
  image.bounds = calculateBounds(image);
  updateImageOverlay();
  scheduleInkRedraw();
}

function finishImageGesture(event, cancelled = false) {
  if (event.pointerType === 'touch') state.touchPoints.delete(event.pointerId);
  const gesture = state.imageGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const { image, before } = gesture;
  state.imageGesture = null;
  if (cancelled) {
    Object.assign(image, before);
    image.bounds = calculateBounds(image);
    updateImageOverlay();
    scheduleInkRedraw();
    return;
  }
  const index = state.pageData.strokes.indexOf(image);
  const after = { x: image.x, y: image.y, w: image.w, h: image.h };
  if (index >= 0 && Object.keys(before).some((key) => Math.abs(before[key] - after[key]) > .0001)) {
    pushHistory({ type: 'transform', index, before, after });
    queuePageSave();
  }
}

function removeSelectedImage() {
  if (!state.selectedImage || !state.pageData) return;
  const index = state.pageData.strokes.indexOf(state.selectedImage);
  if (index < 0) return;
  const [stroke] = state.pageData.strokes.splice(index, 1);
  pushHistory({ type: 'remove', index, stroke });
  state.selectedImage = null;
  updateImageOverlay();
  scheduleInkRedraw();
  queuePageSave();
}

function scheduleEraser(point) {
  state.pendingErasePoint = point;
  if (state.eraseFrame) return;
  state.eraseFrame = requestAnimationFrame(() => {
    state.eraseFrame = 0;
    processEraserPoint(state.pendingErasePoint);
  });
}

function scheduleInkRedraw() {
  if (state.inkFrame) return;
  state.inkFrame = requestAnimationFrame(() => {
    state.inkFrame = 0;
    if (state.pageData) renderer.drawAnnotations(state.pageData.strokes);
    updateImageOverlay();
  });
}

function scheduleLiveDraw() {
  if (state.liveFrame) return;
  state.liveFrame = requestAnimationFrame(() => {
    state.liveFrame = 0;
    if (state.activeStroke) {
      renderer.drawLive(state.activeStroke);
      renderer.drawPredicted(state.activeStroke, state.predictedPoints);
    }
  });
}

function setTool(tool) {
  if (!['pen', 'highlighter', 'eraser', 'shape', 'hand'].includes(tool)) return;
  const previousTool = state.tool;
  if (tool !== 'hand') deselectImage();
  state.tool = tool;
  if (tool === 'highlighter' && previousTool !== 'highlighter') setColor(state.highlighterColor);
  else if (tool !== 'highlighter' && previousTool === 'highlighter') setColor(state.penColor);
  for (const button of elements.toolButtons) {
    const active = button.dataset.tool === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.shapePicker.hidden = tool !== 'shape';
  elements.brushTypeControl.hidden = tool !== 'pen';
  elements.paper.dataset.tool = tool;
  elements.paper.classList.remove('is-panning');
  if (!['pen', 'highlighter'].includes(tool)) elements.brushCursor.hidden = true;
  updateBrushPreview();
}

function setColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  state.color = color;
  if (state.tool === 'highlighter') state.highlighterColor = color;
  else state.penColor = color;
  for (const button of elements.colorButtons) {
    const active = button.dataset.color?.toLowerCase() === color.toLowerCase();
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.customColor.value = color;
  updateBrushPreview();
  persistBrushSettings();
}

function updateBrushCursor(event) {
  if (!state.document || !renderer.pageViewport || !['pen', 'highlighter'].includes(state.tool)) {
    elements.brushCursor.hidden = true;
    return;
  }
  const rect = elements.paper.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) { elements.brushCursor.hidden = true; return; }
  const mode = state.tool === 'highlighter' ? 'highlighter' : state.brushType;
  const factor = mode === 'highlighter' ? 3.35 : mode === 'marker' ? 1.32 : 1;
  let width = Math.max(5, Math.min(90, state.size * renderer.pageViewport.scale * factor));
  let height = width;
  const tilt = Math.min(1, Math.hypot(event.tiltX || 0, event.tiltY || 0) / 70);
  const azimuth = Number.isFinite(event.azimuthAngle) && tilt > .04
    ? event.azimuthAngle
    : Math.atan2(event.tiltY || -1, event.tiltX || 1);
  let angle = azimuth;
  if (mode === 'marker' || mode === 'highlighter') height = width * (mode === 'highlighter' ? .14 : .2);
  else if (mode === 'fountain') height = width * .34;
  else if (mode === 'brush') height = width * .68;
  else if (mode === 'pencil') {
    width *= .72 + tilt * .55;
    height = width * (.78 - tilt * .3);
    angle += Math.PI / 2;
  }
  elements.brushCursor.style.left = `${x}px`;
  elements.brushCursor.style.top = `${y}px`;
  elements.brushCursor.style.width = `${width}px`;
  elements.brushCursor.style.height = `${height}px`;
  elements.brushCursor.style.setProperty('--cursor-color', state.color);
  elements.brushCursor.style.opacity = String(Math.max(.25, brushOpacity()));
  elements.brushCursor.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
  elements.brushCursor.classList.toggle('is-flat', mode === 'marker' || mode === 'highlighter');
  elements.brushCursor.classList.toggle('is-pencil', mode === 'pencil');
  elements.brushCursor.hidden = false;
}

function brushOpacity(tool = state.tool, mode = state.brushType) {
  const baseOpacity = tool === 'highlighter' ? .3 : mode === 'pencil' ? .72 : mode === 'marker' ? .9 : mode === 'brush' ? .96 : 1;
  return baseOpacity * state.opacity;
}

function updateOpacityUI() {
  elements.opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
}

function updateStabilizationUI() {
  elements.stabilizationValue.textContent = `${Math.round(state.stabilization * 100)}%`;
}

function updatePressureUI() {
  elements.pressureValue.textContent = `${Math.round(state.pressureSensitivity * 100)}%`;
}

function updateBrushPreview() {
  const mode = state.tool === 'highlighter' ? 'highlighter' : state.brushType;
  const diameter = Math.max(3, Math.min(18, state.size * 1.25));
  let width = diameter, height = diameter, angle = 0;
  if (mode === 'highlighter' || mode === 'marker') { width = 16; height = 5; angle = -28; }
  else if (mode === 'fountain') { width = diameter * 1.45; height = diameter * .38; angle = -25; }
  else if (mode === 'brush') { width = diameter * 1.3; height = diameter * .66; angle = -18; }
  else if (mode === 'pencil') { width = diameter * .82; height = diameter * .68; angle = 32; }
  elements.brushPreview.style.width = `${width}px`;
  elements.brushPreview.style.height = `${height}px`;
  elements.brushPreview.style.transform = `rotate(${angle}deg)`;
  elements.brushPreview.style.backgroundColor = state.color;
  elements.brushPreview.style.opacity = String(brushOpacity());
  elements.brushPreview.classList.toggle('is-flat', mode === 'marker' || mode === 'highlighter');
  elements.brushPreview.classList.toggle('is-calligraphy', mode === 'fountain' || mode === 'brush');
}

function updateSizeUI() {
  elements.sizeValue.textContent = `${Number.isInteger(state.size) ? state.size : state.size.toFixed(1)} pt`;
  updateBrushPreview();
}

function pushHistory(action) {
  state.undo.push(action);
  if (state.undo.length > MAX_HISTORY) state.undo.shift();
  state.redo.length = 0;
  updateHistoryButtons();
}

function undo() {
  const action = state.undo.pop();
  if (!action || !state.pageData) return;
  if (action.type === 'add') {
    state.pageData.strokes.splice(action.index, 1);
    if (state.selectedImage === action.stroke) state.selectedImage = null;
  } else if (action.type === 'remove') {
    state.pageData.strokes.splice(action.index, 0, action.stroke);
    if (action.stroke.kind === 'image') state.selectedImage = action.stroke;
  } else if (action.type === 'transform') {
    const image = state.pageData.strokes[action.index];
    if (image) { Object.assign(image, action.before); image.bounds = calculateBounds(image); state.selectedImage = image; }
  }
  state.redo.push(action);
  state.erasedIds.delete(action.stroke?.id);
  renderer.clearLive();
  scheduleInkRedraw();
  queuePageSave();
  updateHistoryButtons();
}

function redo() {
  const action = state.redo.pop();
  if (!action || !state.pageData) return;
  if (action.type === 'add') {
    state.pageData.strokes.splice(action.index, 0, action.stroke);
    if (action.stroke.kind === 'image') state.selectedImage = action.stroke;
  } else if (action.type === 'remove') {
    const [removed] = state.pageData.strokes.splice(action.index, 1);
    if (state.selectedImage === removed) state.selectedImage = null;
  } else if (action.type === 'transform') {
    const image = state.pageData.strokes[action.index];
    if (image) { Object.assign(image, action.after); image.bounds = calculateBounds(image); state.selectedImage = image; }
  }
  state.undo.push(action);
  if (action.type === 'remove' && action.stroke?.id) state.erasedIds.add(action.stroke.id);
  scheduleInkRedraw();
  queuePageSave();
  updateHistoryButtons();
}

function addStroke(stroke) {
  if (!state.pageData || (!stroke.shape && !stroke.points?.length && stroke.kind !== 'image')) return;
  stroke.bounds = calculateBounds(stroke);
  const index = state.pageData.strokes.length;
  state.pageData.strokes.push(stroke);
  pushHistory({ type: 'add', index, stroke });
  renderer.clearLive();
  renderer.drawCommittedStroke(stroke);
  updateImageOverlay();
  queuePageSave();
}

function snapShapeEnd(start, end, type, force, width, height) {
  let next = { ...end };
  if (type === 'line' || type === 'arrow') {
    const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height;
    const length = Math.hypot(dx, dy);
    if (length > 10) {
      const angle = Math.atan2(dy, dx);
      const step = Math.PI / 12;
      const snapped = Math.round(angle / step) * step;
      const diff = Math.abs(Math.atan2(Math.sin(angle - snapped), Math.cos(angle - snapped)));
      if (force || diff < Math.PI / 72) {
        next.x = start.x + Math.cos(snapped) * length / width;
        next.y = start.y + Math.sin(snapped) * length / height;
      }
    }
  } else {
    const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height;
    const w = Math.abs(dx), h = Math.abs(dy);
    if (force || (w > 14 && h > 14 && Math.min(w, h) / Math.max(w, h) > .96)) {
      const side = Math.max(w, h);
      next.x = start.x + Math.sign(dx || 1) * side / width;
      next.y = start.y + Math.sign(dy || 1) * side / height;
    }
  }
  return { x: Math.max(0, Math.min(1, next.x)), y: Math.max(0, Math.min(1, next.y)) };
}

function addPoint(stroke, point, force = false) {
  const points = stroke.points;
  const previous = points[points.length - 1];
  const next = {
    x: point.x, y: point.y, pressure: point.pressure,
    tiltX: point.tiltX, tiltY: point.tiltY,
    altitudeAngle: point.altitudeAngle, azimuthAngle: point.azimuthAngle,
    time: point.time,
  };
  if (previous) {
    const rect = state.pointerRect || elements.liveCanvas.getBoundingClientRect();
    const distance = Math.hypot((point.x - previous.x) * rect.width, (point.y - previous.y) * rect.height);
    if (distance < .24) {
      previous.pressure = previous.pressure * .72 + point.pressure * .28;
      previous.tiltX = point.tiltX;
      previous.tiltY = point.tiltY;
      previous.altitudeAngle = point.altitudeAngle;
      previous.azimuthAngle = point.azimuthAngle;
      previous.time = point.time;
      if (!force || distance < .16) return;
    }
  }
  points.push(next);
}

function cancelCurrentStroke() {
  state.activeStroke = null;
  state.activePan = null;
  state.activePointerId = null;
  state.pointerTool = null;
  state.pointerRect = null;
  state.predictedPoints = [];
  renderer.clearLive();
  elements.paper.classList.remove('is-panning');
}

function beginPinch() {
  if (state.touchPoints.size < 2) return;
  cancelCurrentStroke();
  const points = [...state.touchPoints.values()].slice(0, 2);
  const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  state.pinch = { distance: Math.max(1, distance), zoom: state.zoom };
  state.suppressedPointers = new Set(state.touchPoints.keys());
  elements.paper.style.transformOrigin = 'center center';
}

function updatePinch() {
  if (!state.pinch || state.touchPoints.size < 2) return;
  const points = [...state.touchPoints.values()].slice(0, 2);
  const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const factor = Math.max(.55, Math.min(2.6, distance / state.pinch.distance * state.pinch.zoom));
  elements.paper.style.transform = `scale(${factor / Math.max(.01, state.zoom)})`;
}

async function endPinch() {
  if (!state.pinch) return;
  const points = [...state.touchPoints.keys()];
  for (const id of points) state.suppressedPointers.add(id);
  const paper = elements.paper;
  const currentTransform = paper.style.transform;
  const factor = Number(currentTransform.match(/scale\(([^)]+)\)/)?.[1]) || 1;
  state.zoom = renderer.setZoom(state.zoom * factor);
  paper.style.transform = '';
  paper.style.transformOrigin = '';
  state.pinch = null;
  await renderCurrentPage();
}

function handlePointerDown(event) {
  if (!state.document || !renderer.pageViewport || state.imageGesture) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (event.pointerType === 'touch' && state.activePointerId !== null && state.pointerTool !== 'hand') return;
  if (event.pointerType === 'touch') {
    state.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { elements.liveCanvas.setPointerCapture(event.pointerId); } catch (_) { /* optional capture */ }
    if (state.touchPoints.size >= 2) {
      event.preventDefault();
      beginPinch();
      return;
    }
    event.preventDefault();
    state.activePointerId = event.pointerId;
    state.pointerTool = 'hand';
    state.pointerRect = elements.liveCanvas.getBoundingClientRect();
    state.activePan = { x: event.clientX, y: event.clientY, left: elements.viewerScroll.scrollLeft, top: elements.viewerScroll.scrollTop };
    elements.paper.classList.add('is-panning');
    return;
  }
  if (state.pinch || state.suppressedPointers.has(event.pointerId)) return;
  event.preventDefault();
  elements.brushCursor.hidden = true;
  state.activePointerId = event.pointerId;
  state.pointerTool = state.tool;
  try { elements.liveCanvas.setPointerCapture(event.pointerId); } catch (_) { /* capture is optional on older browsers */ }
  state.pointerRect = elements.liveCanvas.getBoundingClientRect();
  const point = renderer.normalizedPoint(event, state.pointerRect);
  if (state.tool === 'hand') {
    const image = findImageAt(point);
    if (image) {
      selectImage(image);
      startImageGesture(event, 'move', state.pointerRect);
      return;
    }
    deselectImage();
    state.activePan = { x: event.clientX, y: event.clientY, left: elements.viewerScroll.scrollLeft, top: elements.viewerScroll.scrollTop };
    elements.paper.classList.add('is-panning');
    return;
  }
  if (state.selectedImage) deselectImage();
  if (state.tool === 'eraser') {
    state.erasedIds = new Set();
    scheduleEraser(point);
    return;
  }
  if (state.tool === 'shape') {
    state.activeStroke = {
      id: randomId(), tool: 'pen', mode: 'ink', color: state.color, size: state.size, opacity: state.opacity,
      shape: { type: state.shapeType, start: { x: point.x, y: point.y }, end: { x: point.x, y: point.y } },
    };
  } else {
    const mode = state.tool === 'pen' ? state.brushType : state.tool;
    const nibAngle = Math.hypot(point.tiltX || 0, point.tiltY || 0) > 4 ? point.azimuthAngle : -Math.PI / 4;
    state.activeStroke = {
      id: randomId(), tool: state.tool, mode, color: state.color, size: state.size,
      opacity: brushOpacity(state.tool, mode), stabilization: state.stabilization,
      pressureSensitivity: state.pressureSensitivity, nibAngle, points: [],
    };
    addPoint(state.activeStroke, point, true);
  }
  state.predictedPoints = [];
  scheduleLiveDraw();
}

function handlePointerMove(event) {
  if (event.pointerType === 'pen' && state.activePointerId === null) updateBrushCursor(event);
  if (event.pointerType === 'touch' && state.touchPoints.has(event.pointerId)) {
    state.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pinch) { event.preventDefault(); updatePinch(); return; }
  }
  if (state.suppressedPointers.has(event.pointerId)) return;
  if (event.pointerId !== state.activePointerId) return;
  if (state.activePan) {
    event.preventDefault();
    elements.viewerScroll.scrollLeft = state.activePan.left - (event.clientX - state.activePan.x);
    elements.viewerScroll.scrollTop = state.activePan.top - (event.clientY - state.activePan.y);
    return;
  }
  const point = renderer.normalizedPoint(event, state.pointerRect || undefined);
  if (state.pointerTool === 'eraser') {
    scheduleEraser(point);
    return;
  }
  if (!state.activeStroke) return;
  event.preventDefault();
  if (state.activeStroke.shape) {
    const shape = state.activeStroke.shape;
    const rect = state.pointerRect || elements.liveCanvas.getBoundingClientRect();
    shape.end = snapShapeEnd(shape.start, point, shape.type, event.shiftKey, rect.width, rect.height);
  } else {
    let coalesced = [];
    try { coalesced = event.getCoalescedEvents?.() || []; } catch (_) { /* older input APIs may not expose coalesced points */ }
    if (coalesced.length) {
      for (const sample of coalesced) addPoint(state.activeStroke, renderer.normalizedPoint(sample, state.pointerRect));
    }
    addPoint(state.activeStroke, point);
    state.predictedPoints = [];
    let predicted = [];
    try { predicted = event.getPredictedEvents?.() || []; } catch (_) { /* predicted samples are optional */ }
    for (const sample of predicted.slice(0, 2)) {
      try { state.predictedPoints.push(renderer.normalizedPoint(sample, state.pointerRect)); } catch (_) { /* ignore invalid predicted points */ }
    }
  }
  scheduleLiveDraw();
}

function finishPointer(event, cancelled = false) {
  if (event.pointerType === 'touch') state.touchPoints.delete(event.pointerId);
  if (state.pinch) {
    state.suppressedPointers.delete(event.pointerId);
    if (state.touchPoints.size < 2) void endPinch();
    return;
  }
  if (state.suppressedPointers.has(event.pointerId)) {
    state.suppressedPointers.delete(event.pointerId);
    return;
  }
  if (event.pointerId !== state.activePointerId) return;
  if (state.activePan) {
    cancelCurrentStroke();
    return;
  }
  if (state.pointerTool === 'eraser') {
    if (state.eraseFrame) {
      cancelAnimationFrame(state.eraseFrame);
      state.eraseFrame = 0;
      processEraserPoint(state.pendingErasePoint);
    }
    state.activePointerId = null;
    state.pointerTool = null;
    state.pointerRect = null;
    return;
  }
  const stroke = state.activeStroke;
  if (!stroke) { state.activePointerId = null; state.pointerTool = null; state.pointerRect = null; return; }
  if (!cancelled) {
    if (!stroke.shape) {
      let coalesced = [];
      try { coalesced = event.getCoalescedEvents?.() || []; } catch (_) { /* pointerup coalescing is optional */ }
      for (const sample of coalesced) {
        if (Number.isFinite(sample.pressure) && sample.pressure > 0) addPoint(stroke, renderer.normalizedPoint(sample, state.pointerRect));
      }
    }
    const point = renderer.normalizedPoint(event, state.pointerRect || undefined);
    if (!stroke.shape && event.pointerType === 'pen' && !(event.pressure > 0)) {
      const previous = stroke.points[stroke.points.length - 1];
      if (previous) {
        point.pressure = previous.pressure;
        point.tiltX = previous.tiltX;
        point.tiltY = previous.tiltY;
        point.altitudeAngle = previous.altitudeAngle;
        point.azimuthAngle = previous.azimuthAngle;
      }
    }
    if (stroke.shape) {
      const rect = state.pointerRect || elements.liveCanvas.getBoundingClientRect();
      stroke.shape.end = snapShapeEnd(stroke.shape.start, point, stroke.shape.type, event.shiftKey, rect.width, rect.height);
      const dx = (stroke.shape.end.x - stroke.shape.start.x) * rect.width;
      const dy = (stroke.shape.end.y - stroke.shape.start.y) * rect.height;
      if (Math.hypot(dx, dy) >= 4) addStroke(stroke);
      else renderer.clearLive();
    } else {
      addPoint(stroke, point);
      addStroke(stroke);
    }
  } else {
    renderer.clearLive();
  }
  state.activeStroke = null;
  state.activePointerId = null;
  state.pointerTool = null;
  state.pointerRect = null;
  state.predictedPoints = [];
}

async function changeZoom(factor) {
  if (!state.document) return;
  state.zoom = renderer.setZoom(state.zoom * factor);
  await renderCurrentPage();
}

function togglePanel(force) {
  const usesOverlay = window.matchMedia('(max-width: 1366px)').matches;
  if (usesOverlay) {
    const open = typeof force === 'boolean' ? force : !elements.notesPanel.classList.contains('is-open');
    elements.notesPanel.classList.toggle('is-open', open);
    elements.mobileScrim.hidden = !(open || elements.sidebar.classList.contains('is-open'));
  } else {
    const hidden = typeof force === 'boolean' ? !force : !elements.appShell.classList.contains('is-panel-hidden');
    elements.appShell.classList.toggle('is-panel-hidden', hidden);
  }
}

function closeMobileOverlays() {
  elements.sidebar.classList.remove('is-open');
  elements.notesPanel.classList.remove('is-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  elements.mobileScrim.hidden = true;
}

async function removeDocument(id) {
  const doc = await store.getDocument(id);
  if (!doc) return;
  const name = doc.title || 'Bu PDF';
  if (!window.confirm(`“${name}” ve bu belgeye ait tüm çizim/notlar bu cihazdan kaldırılsın mı?`)) return;
  const isCurrent = state.document?.id === id;
  if (isCurrent) await flushPageSave();
  try {
    await store.deleteDocument(id);
    if (isCurrent) {
      clearAIConversation(true);
      await renderer.close();
      state.pageLoadToken += 1;
      state.document = null;
      state.bytes = null;
      state.pageData = null;
    }
    await refreshDocumentLibrary();
    const remaining = await store.listDocuments();
    if (!state.document && remaining.length) await openStoredDocument(remaining[0].id, { quiet: true });
    else if (!state.document) {
      elements.documentTitle.textContent = 'Yeni bir başlangıç';
      elements.viewerHint.hidden = true;
      elements.paper.hidden = true;
      elements.welcome.hidden = false;
      elements.notesDocumentName.textContent = 'Henüz PDF yok';
      elements.notesPageContext.textContent = 'Sayfa notları burada';
      elements.note.value = '';
      setSaveState('saved');
      updatePageUI();
      buildPageList(false);
    }
    showToast('Belge kaldırıldı.', 'success', 2300);
  } catch (error) {
    console.error('Document delete failed:', error);
    showToast('Belge kaldırılamadı. Tarayıcı depolama iznini kontrol et.', 'error');
  }
}

async function exportCurrentPdf() {
  if (!state.document || !state.bytes) return;
  elements.exportButton.disabled = true;
  elements.exportButton.dataset.busy = 'true';
  elements.exportButton.querySelector('span').textContent = 'Hazırlanıyor…';
  try {
    await flushPageSave();
    const savedPages = await store.getDocumentPages(state.document.id);
    const pageData = new Map(savedPages.map((page) => [page.pageNumber, page]));
    if (state.pageData) pageData.set(state.pageNumber, clonePageData(state.pageData));
    const result = await createAnnotatedPdf(state.bytes, pageData, state.document.title);
    downloadBytes(result, safeFilename(state.document.title));
    showToast('İşaretlemelerin PDF’e eklendi. İndirme başladı.', 'success');
  } catch (error) {
    console.error('PDF export failed:', error);
    showToast(error?.message || 'PDF dışa aktarılamadı. Dosyanın şifreli veya bozuk olmadığını kontrol et.', 'error', 5600);
  } finally {
    elements.exportButton.disabled = !state.document;
    elements.exportButton.dataset.busy = 'false';
    elements.exportButton.querySelector('span').textContent = 'PDF indir';
  }
}

function handlePageInput() {
  const value = Number(elements.pageInput.value);
  if (Number.isFinite(value)) void navigateToPage(value);
}

function isTextInput(element) {
  return element instanceof HTMLElement && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

function handleKeyDown(event) {
  if (isTextInput(event.target)) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'o') {
    event.preventDefault(); elements.pdfInput.click(); return;
  }
  if (command && event.key.toLowerCase() === 'z') {
    event.preventDefault(); if (event.shiftKey) redo(); else undo(); return;
  }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (event.key === 'Escape') { closeMobileOverlays(); deselectImage(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedImage) { event.preventDefault(); removeSelectedImage(); return; }
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault(); state.spaceTool = state.tool; setTool('hand'); return;
  }
  if (event.key === 'ArrowLeft' && state.document) { event.preventDefault(); void navigateToPage(state.pageNumber - 1); return; }
  if (event.key === 'ArrowRight' && state.document) { event.preventDefault(); void navigateToPage(state.pageNumber + 1); return; }
  if (command || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'p') setTool('pen');
  else if (key === 'h') setTool('highlighter');
  else if (key === 'e') setTool('eraser');
  else if (key === 's') setTool('shape');
  else if (key === 'o') elements.pdfInput.click();
}

function handleKeyUp(event) {
  if (event.code === 'Space' && state.spaceTool) {
    setTool(state.spaceTool);
    state.spaceTool = null;
  }
}

function addEventListeners() {
  for (const button of elements.openButtons) button.addEventListener('click', () => { closeMobileOverlays(); elements.pdfInput.click(); });
  for (const button of elements.sampleButtons) button.addEventListener('click', () => { closeMobileOverlays(); void openSample(); });
  elements.pdfInput.addEventListener('change', () => {
    const [file] = elements.pdfInput.files || [];
    void handlePdfFile(file);
    elements.pdfInput.value = '';
  });

  elements.documentLibrary.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-document]');
    if (removeButton) { void removeDocument(removeButton.dataset.removeDocument); return; }
    const openButton = event.target.closest('[data-document-id]');
    if (openButton) { closeMobileOverlays(); void openStoredDocument(openButton.dataset.documentId); }
  });
  elements.pageList.addEventListener('scroll', renderVisiblePages, { passive: true });
  elements.pageList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-number]');
    if (button) { void navigateToPage(Number(button.dataset.pageNumber)); closeMobileOverlays(); }
  });
  elements.previousPage.addEventListener('click', () => void navigateToPage(state.pageNumber - 1));
  elements.nextPage.addEventListener('click', () => void navigateToPage(state.pageNumber + 1));
  elements.pageInput.addEventListener('change', handlePageInput);
  elements.pageInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { handlePageInput(); elements.pageInput.blur(); } });
  elements.zoomIn.addEventListener('click', () => void changeZoom(1.2));
  elements.zoomOut.addEventListener('click', () => void changeZoom(1 / 1.2));
  elements.zoomReadout.addEventListener('click', () => { state.zoom = 1; void renderCurrentPage(); });
  elements.viewerScroll.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || !state.document) return;
    event.preventDefault();
    void changeZoom(event.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  for (const button of elements.toolButtons) button.addEventListener('click', () => setTool(button.dataset.tool));
  elements.brushType.addEventListener('change', () => { state.brushType = elements.brushType.value; updateBrushPreview(); persistBrushSettings(); });
  elements.shapeKind.addEventListener('change', () => { state.shapeType = elements.shapeKind.value; });
  for (const button of elements.colorButtons) button.addEventListener('click', () => setColor(button.dataset.color));
  elements.customColor.addEventListener('input', () => setColor(elements.customColor.value));
  elements.sizeRange.addEventListener('input', () => {
    state.size = Number(elements.sizeRange.value);
    updateSizeUI();
  });
  elements.opacityRange.addEventListener('input', () => {
    state.opacity = Number(elements.opacityRange.value) / 100;
    updateOpacityUI();
    updateBrushPreview();
  });
  elements.stabilizationRange.addEventListener('input', () => {
    state.stabilization = Number(elements.stabilizationRange.value) / 100;
    updateStabilizationUI();
  });
  elements.pressureRange.addEventListener('input', () => {
    state.pressureSensitivity = Number(elements.pressureRange.value) / 100;
    updatePressureUI();
  });
  for (const input of [elements.sizeRange, elements.opacityRange, elements.stabilizationRange, elements.pressureRange]) {
    input.addEventListener('change', persistBrushSettings);
  }
  elements.undoButton.addEventListener('click', undo);
  elements.redoButton.addEventListener('click', redo);

  elements.liveCanvas.addEventListener('pointerdown', handlePointerDown);
  elements.liveCanvas.addEventListener('pointermove', handlePointerMove);
  elements.liveCanvas.addEventListener('pointerup', (event) => {
    finishPointer(event);
    if (event.pointerType === 'pen') updateBrushCursor(event);
  });
  elements.liveCanvas.addEventListener('pointercancel', (event) => finishPointer(event, true));
  elements.liveCanvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'pen' && state.activePointerId === null) elements.brushCursor.hidden = true;
  });
  elements.liveCanvas.addEventListener('lostpointercapture', (event) => {
    if (state.activePointerId === event.pointerId) finishPointer(event, true);
  });
  elements.liveCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
  elements.imageInsertButton.addEventListener('click', () => {
    if (!state.document) { showToast('Önce bir PDF aç, sonra görsel ekleyebilirsin.', 'error'); return; }
    closeMobileOverlays();
    elements.imageInput.click();
  });
  elements.imageInput.addEventListener('change', () => {
    const [file] = elements.imageInput.files || [];
    void insertImageFile(file);
    elements.imageInput.value = '';
  });
  elements.imageOverlay.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#deleteImageButton')) return;
    const mode = event.target.closest('#imageResizeHandle') ? 'resize' : 'move';
    startImageGesture(event, mode);
  });
  elements.imageOverlay.addEventListener('pointermove', moveImageGesture);
  elements.imageOverlay.addEventListener('pointerup', (event) => finishImageGesture(event));
  elements.imageOverlay.addEventListener('pointercancel', (event) => finishImageGesture(event, true));
  elements.imageOverlay.addEventListener('lostpointercapture', (event) => {
    if (state.imageGesture?.pointerId === event.pointerId) finishImageGesture(event, true);
  });
  elements.imageDeleteButton.addEventListener('click', removeSelectedImage);

  elements.note.addEventListener('input', () => {
    if (!state.pageData) return;
    state.pageData.note = elements.note.value;
    queuePageSave();
  });
  elements.completionButton.addEventListener('click', async () => {
    if (!state.document || !state.pageData) return;
    state.pageData.completed = !state.pageData.completed;
    const completed = new Set(state.document.completedPages || []);
    if (state.pageData.completed) completed.add(state.pageNumber); else completed.delete(state.pageNumber);
    state.document.completedPages = [...completed].sort((a, b) => a - b);
    updateCompletionUI();
    updatePageList();
    queuePageSave();
    await queueDocumentSave({ completedPages: state.document.completedPages });
  });

  elements.exportButton.addEventListener('click', () => void exportCurrentPdf());
  elements.panelToggle.addEventListener('click', () => togglePanel());
  elements.panelClose.addEventListener('click', () => togglePanel(false));
  elements.aiToggle.addEventListener('click', () => setAIPanelOpen(elements.aiToggle.getAttribute('aria-expanded') !== 'true'));
  elements.aiClose.addEventListener('click', () => setAIPanelOpen(false));
  elements.aiScrim.addEventListener('click', () => setAIPanelOpen(false));
  elements.aiForm.addEventListener('submit', (event) => void sendAIMessage(event));
  elements.aiSharePageText.addEventListener('change', updateAIShareStatus);
  elements.aiInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      elements.aiForm.requestSubmit();
    }
  });
  elements.aiPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setAIPanelOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...elements.aiPanel.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  elements.mobileMenu.addEventListener('click', () => {
    const open = !elements.sidebar.classList.contains('is-open');
    elements.sidebar.classList.toggle('is-open', open);
    elements.mobileMenu.setAttribute('aria-expanded', String(open));
    elements.mobileScrim.hidden = !open;
  });
  elements.mobileScrim.addEventListener('click', closeMobileOverlays);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', () => {
    if (state.activeStroke) cancelCurrentStroke();
    state.touchPoints.clear();
    state.suppressedPointers.clear();
    state.pinch = null;
    elements.paper.style.transform = '';
  });

  for (const eventName of ['dragenter', 'dragover']) elements.viewer.addEventListener(eventName, (event) => {
    if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) {
      event.preventDefault();
      elements.viewer.classList.add('is-dragging');
    }
  });
  for (const eventName of ['dragleave', 'dragend']) elements.viewer.addEventListener(eventName, () => elements.viewer.classList.remove('is-dragging'));
  elements.viewer.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.viewer.classList.remove('is-dragging');
    const file = [...(event.dataTransfer?.files || [])].find((candidate) => candidate.type.includes('pdf') || candidate.name.toLowerCase().endsWith('.pdf'));
    if (file) void handlePdfFile(file);
    else showToast('Buraya bir PDF dosyası bırak.', 'error');
  });

  window.addEventListener('resize', () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => {
      if (state.document && !state.activeStroke && !state.pinch) void renderCurrentPage();
    }, 160);
  }, { passive: true });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(() => {
        if (state.document && !state.activeStroke && !state.pinch) void renderCurrentPage();
      }, 180);
    });
    observer.observe(elements.viewerScroll);
  }
}

async function initialize() {
  addEventListeners();
  restoreBrushSettings();
  state.size = Number(elements.sizeRange.value);
  state.opacity = Number(elements.opacityRange.value) / 100;
  state.stabilization = Number(elements.stabilizationRange.value) / 100;
  state.pressureSensitivity = Number(elements.pressureRange.value) / 100;
  setTool('pen');
  setColor(state.color);
  updateSizeUI();
  updateOpacityUI();
  updateStabilizationUI();
  updatePressureUI();
  updatePageUI();
  updateZoomUI();
  try {
    await store.open();
    state.storageReady = true;
    const documents = await store.listDocuments();
    renderDocumentLibrary(documents);
    if (documents.length) await openStoredDocument(documents[0].id, { quiet: true });
    else setSaveState('saved');
  } catch (error) {
    console.error('Workspace storage initialization failed:', error);
    state.storageReady = false;
    setSaveState('error');
    showToast('Yerel çalışma alanı açılamadı. Gizli mod yerine normal tarayıcı penceresinde deneyin.', 'error', 6000);
  }
}

void initialize();
