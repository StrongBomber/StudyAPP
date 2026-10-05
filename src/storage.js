const DATABASE_NAME = 'cozum-study-workspace';
const DATABASE_VERSION = 2;
const LEGACY_DATABASE_NAME = 'cozum-workspace';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Yerel depolama isteği başarısız oldu.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Yerel kayıt tamamlanamadı.'));
  });
}

function openLegacyDatabase() {
  return new Promise((resolve) => {
    let created = false;
    let request;
    try { request = indexedDB.open(LEGACY_DATABASE_NAME); }
    catch (_) { resolve(null); return; }
    request.onupgradeneeded = () => { created = true; };
    request.onsuccess = () => {
      const db = request.result;
      if (created || !db.objectStoreNames.contains('files') || !db.objectStoreNames.contains('work')) {
        db.close();
        if (created) {
          try { indexedDB.deleteDatabase(LEGACY_DATABASE_NAME); } catch (_) { /* empty probe DB cleanup */ }
        }
        resolve(null);
        return;
      }
      resolve(db);
    };
    request.onerror = request.onblocked = () => resolve(null);
  });
}

function legacyStroke(stroke, documentId, pageNumber, index) {
  if (!stroke || typeof stroke !== 'object') return null;
  const id = stroke.id || `legacy-${documentId}-${pageNumber}-${index}`;
  if (stroke.kind === 'image') {
    if (typeof stroke.src !== 'string' || !/^data:image\/(?:png|jpe?g|webp|gif|bmp)(?:[;,])/i.test(stroke.src)) return null;
    return { ...stroke, id, kind: 'image' };
  }
  const points = Array.isArray(stroke.points) ? stroke.points
    .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map((point) => ({
      x: Math.max(0, Math.min(1, Number(point.x))),
      y: Math.max(0, Math.min(1, Number(point.y))),
      pressure: Math.max(.08, Math.min(1, Number.isFinite(Number(point.pressure ?? point.p)) ? Number(point.pressure ?? point.p) : .5)),
      time: Number(point.time) || 0,
    })) : [];
  const sizeSource = Number(stroke.width);
  if (stroke.tool === 'shape' && stroke.geom && typeof stroke.shape === 'string') {
    const { ax, ay, bx, by } = stroke.geom;
    if (![ax, ay, bx, by].every((value) => Number.isFinite(Number(value)))) return null;
    return {
      id, tool: 'pen', mode: stroke.mode || 'ink', color: stroke.color || '#3449d8',
      size: Math.max(.4, Number.isFinite(sizeSource) ? sizeSource * 612 : 2),
      legacyShape: true,
      shape: { type: stroke.shape, start: { x: Number(ax), y: Number(ay) }, end: { x: Number(bx), y: Number(by) } },
    };
  }
  if (!points.length) return null;
  const mode = ['ink', 'pencil', 'highlighter', 'fountain'].includes(stroke.mode) ? stroke.mode : 'ink';
  const size = Number.isFinite(sizeSource) ? sizeSource * 612 * (mode === 'highlighter' ? 2.35 / 3.25 : 1) : 2;
  return {
    id, tool: mode === 'highlighter' || stroke.tool === 'highlighter' ? 'highlighter' : 'pen', mode,
    color: stroke.color || '#3449d8', size: Math.max(.35, size), opacity: Number.isFinite(Number(stroke.opacity)) ? Number(stroke.opacity) : (mode === 'highlighter' ? .28 : mode === 'pencil' ? .56 : 1),
    points,
  };
}

export function mapLegacyWorkspace(workspace, documentId, pageCount, isDemo = false) {
  const source = workspace || {};
  const pages = source.pages && typeof source.pages === 'object' ? source.pages : {};
  const notes = source.notes && typeof source.notes === 'object' ? source.notes : {};
  const tasks = source.tasks && typeof source.tasks === 'object' ? source.tasks : {};
  const pageNumbers = new Set([...Object.keys(pages), ...Object.keys(notes), ...Object.keys(tasks)].map(Number).filter((page) => Number.isInteger(page) && page > 0));
  const totalPages = Math.max(1, pageCount || 1, ...pageNumbers);
  const completedPages = [];
  if (isDemo) {
    for (let page = 1; page <= Math.min(totalPages, 4); page += 1) {
      const firstTask = (page - 1) * 3 + 1;
      const lastTask = Math.min(page * 3, 12);
      if (Array.from({ length: lastTask - firstTask + 1 }, (_, i) => String(firstTask + i)).every((id) => Boolean(tasks[id]))) completedPages.push(page);
    }
  } else {
    for (let page = 1; page <= totalPages; page += 1) if (Boolean(tasks[String(page)])) completedPages.push(page);
  }
  const mappedPages = [];
  for (const pageNumber of pageNumbers) {
    const oldStrokes = Array.isArray(pages[pageNumber]) ? pages[pageNumber] : [];
    const strokes = oldStrokes.map((stroke, index) => legacyStroke(stroke, documentId, pageNumber, index)).filter(Boolean);
    const note = typeof notes[pageNumber] === 'string' ? notes[pageNumber] : '';
    const completed = completedPages.includes(pageNumber);
    if (strokes.length || note || completed) mappedPages.push({ documentId, pageNumber, strokes, note, completed });
  }
  for (const pageNumber of completedPages) {
    if (!mappedPages.some((page) => page.pageNumber === pageNumber)) mappedPages.push({ documentId, pageNumber, strokes: [], note: '', completed: true });
  }
  return { pages: mappedPages, completedPages, pageCount: totalPages };
}

export class WorkspaceStore {
  constructor() {
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    const opening = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Bu tarayıcı yerel kayıt özelliğini desteklemiyor.'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('documents')) {
          const documents = db.createObjectStore('documents', { keyPath: 'id' });
          documents.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) {
          const pages = db.createObjectStore('pages', { keyPath: ['documentId', 'pageNumber'] });
          pages.createIndex('documentId', 'documentId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Yerel çalışma alanı açılamadı.'));
      request.onblocked = () => reject(new Error('Çalışma alanı başka bir sekmede güncelleniyor. Diğer sekmeyi kapatıp yeniden deneyin.'));
    });
    this.databasePromise = opening.then(async (db) => {
      try { await this.migrateLegacy(db); }
      catch (error) { console.warn('Eski Çözüm kayıtları yeni çalışma alanına aktarılamadı:', error); }
      return db;
    });
    return this.databasePromise;
  }

  async migrateLegacy(db) {
    const metaStore = db.transaction('meta', 'readonly').objectStore('meta');
    const migration = await requestResult(metaStore.get('legacy-v1'));
    if (migration?.done) return;
    const legacyDb = await openLegacyDatabase();
    if (!legacyDb) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: 'legacy-v1', done: true, migratedAt: Date.now() });
      await transactionDone(tx);
      return;
    }
    try {
      const tx = legacyDb.transaction(['files', 'work'], 'readonly');
      const fileRequest = tx.objectStore('files').getAll();
      const workStore = tx.objectStore('work');
      const keysRequest = workStore.getAllKeys();
      const workRequest = workStore.getAll();
      const [fileRecords, keys, works] = await Promise.all([requestResult(fileRequest), requestResult(keysRequest), requestResult(workRequest)]);
      const workById = new Map(keys.map((key, index) => [String(key), works[index]]));
      const lastDocumentId = (() => { try { return localStorage.getItem('cozum-last-doc'); } catch (_) { return null; } })();
      const destination = db.transaction(['documents', 'files', 'pages', 'meta'], 'readwrite');
      const documents = destination.objectStore('documents');
      const files = destination.objectStore('files');
      const pageStore = destination.objectStore('pages');
      const now = Date.now();
      for (let index = 0; index < fileRecords.length; index += 1) {
        const record = fileRecords[index];
        if (!record?.bytes || record.id == null) continue;
        const bytes = record.bytes;
        const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength)) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(5, bytes.byteLength)) : null;
        if (!view || new TextDecoder().decode(view).slice(0, 5) !== '%PDF-') continue;
        const oldId = String(record.id);
        const id = `legacy-${oldId}`;
        const oldWork = workById.get(oldId) || {};
        const mapped = mapLegacyWorkspace(oldWork, id, 1, false);
        const byteLength = bytes.byteLength || 0;
        const document = {
          id, title: record.name || 'Önceki PDF.pdf', pageCount: mapped.pageCount, byteLength,
          createdAt: Number(record.lastModified) || now, updatedAt: oldId === lastDocumentId ? now + 1 : now - index,
          lastPage: 1, completedPages: mapped.completedPages, isSample: false,
        };
        documents.put(document);
        files.put({ id, bytes: bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
        for (const page of mapped.pages) pageStore.put(page);
      }
      if (workById.has('demo')) destination.objectStore('meta').put({ key: 'legacy-demo-work', workspace: workById.get('demo') });
      destination.objectStore('meta').put({ key: 'legacy-v1', done: true, migratedAt: now });
      await transactionDone(destination);
    } finally {
      legacyDb.close();
    }
  }

  async getLegacyDemoWork() {
    const db = await this.open();
    const record = await requestResult(db.transaction('meta', 'readonly').objectStore('meta').get('legacy-demo-work'));
    return record?.workspace || null;
  }

  async clearLegacyDemoWork() {
    const db = await this.open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete('legacy-demo-work');
    await transactionDone(tx);
  }

  async listDocuments() {
    const db = await this.open();
    const documents = await requestResult(db.transaction('documents', 'readonly').objectStore('documents').getAll());
    return documents.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async getDocument(id) {
    const db = await this.open();
    return requestResult(db.transaction('documents', 'readonly').objectStore('documents').get(id));
  }

  async getMostRecentDocument() {
    const documents = await this.listDocuments();
    return documents[0] || null;
  }

  async saveDocument(document) {
    const db = await this.open();
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(document);
    await transactionDone(tx);
  }

  async saveNewDocument(document, bytes) {
    const db = await this.open();
    const tx = db.transaction(['documents', 'files'], 'readwrite');
    tx.objectStore('documents').put(document);
    tx.objectStore('files').put({ id: document.id, bytes });
    await transactionDone(tx);
  }

  async saveFile(id, bytes) {
    const db = await this.open();
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id, bytes });
    await transactionDone(tx);
  }

  async getFile(id) {
    const db = await this.open();
    const record = await requestResult(db.transaction('files', 'readonly').objectStore('files').get(id));
    return record?.bytes || null;
  }

  async getPage(documentId, pageNumber) {
    const db = await this.open();
    const page = await requestResult(db.transaction('pages', 'readonly').objectStore('pages').get([documentId, pageNumber]));
    return page || { documentId, pageNumber, strokes: [], note: '', completed: false };
  }

  async savePage(page) {
    const db = await this.open();
    const tx = db.transaction('pages', 'readwrite');
    tx.objectStore('pages').put(page);
    await transactionDone(tx);
  }

  async getDocumentPages(documentId) {
    const db = await this.open();
    return requestResult(db.transaction('pages', 'readonly').objectStore('pages').index('documentId').getAll(IDBKeyRange.only(documentId)));
  }

  async deleteDocument(id) {
    const db = await this.open();
    const tx = db.transaction(['documents', 'files', 'pages'], 'readwrite');
    tx.objectStore('documents').delete(id);
    tx.objectStore('files').delete(id);
    const index = tx.objectStore('pages').index('documentId');
    const cursorRequest = index.openCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    await transactionDone(tx);
  }
}
