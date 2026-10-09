// Lokal lagring + synkronisering mot GitHub.
//
// Alt lagres først lokalt på telefonen (localStorage for data, IndexedDB for kvitteringer som
// ikke er lastet opp ennå), og synkroniseres deretter til GitHub. Mangler du dekning, ligger
// endringene i kø og lastes opp neste gang appen har nett. Endringer fra flere enheter
// slås sammen (se merge.js), så ingenting overskrives.

import { GitHubClient, GitHubError } from './github.js';
import { mergeData } from './merge.js';

const CONFIG_KEY = 'drivstoff:config';

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; } catch { return null; }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profil';
}

export const emptyData = (profile) => ({ version: 1, profile, cars: [], fillUps: [] });

// MARK: IndexedDB-kø for kvitteringer

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('drivstoff', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('pendingReceipts', { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingReceipts', mode);
    const request = fn(tx.objectStore('pendingReceipts'));
    // NB: request.result er undefined når get() ikke finner noe – det må returneres som det er.
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

// MARK: Store

export class Store extends EventTarget {
  constructor(config) {
    super();
    this.config = config;
    this.client = new GitHubClient(config);
    this.profileSlug = slugify(config.profile);
    this.basePath = `profiler/${this.profileSlug}`;
    this.dataPath = `${this.basePath}/data.json`;
    this.localKey = `drivstoff:data:${config.owner}/${config.repo}:${this.profileSlug}`;
    this.status = { state: 'idle', message: '', pending: 0 };
    this.syncing = null;

    const cached = this.readLocal();
    this.data = cached?.data ?? emptyData(config.profile);
    this.sha = cached?.sha ?? null;
    this.dirty = cached?.dirty ?? false;
  }

  readLocal() {
    try { return JSON.parse(localStorage.getItem(this.localKey)); } catch { return null; }
  }

  writeLocal() {
    localStorage.setItem(this.localKey, JSON.stringify({ data: this.data, sha: this.sha, dirty: this.dirty }));
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.dispatchEvent(new Event('status'));
  }

  get cars() { return this.data.cars.filter((c) => !c.deleted); }
  get fillUps() { return this.data.fillUps.filter((f) => !f.deleted); }

  // MARK: Endringer

  upsert(kind, item, message) {
    const list = this.data[kind];
    const now = Date.now();
    const next = { ...item, updatedAt: now, createdAt: item.createdAt ?? now };
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = next; else list.push(next);
    this.commitLocal(message);
    return next;
  }

  remove(kind, id, message) {
    const item = this.data[kind].find((x) => x.id === id);
    if (!item) return;
    Object.assign(item, { deleted: true, updatedAt: Date.now() });
    this.commitLocal(message);
  }

  commitLocal(message) {
    this.dirty = true;
    this.version = (this.version ?? 0) + 1;
    this.pendingMessage = message || 'Oppdater data';
    this.writeLocal();
    this.dispatchEvent(new Event('change'));
    this.sync();
  }

  receiptPath(fillUp) {
    const day = (fillUp.date || '').slice(0, 10) || 'ukjent-dato';
    return `${this.basePath}/kvitteringer/${day.slice(0, 4)}/${day}-${fillUp.id.slice(0, 8)}.pdf`;
  }

  async queueReceipt(path, blob, message) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await idb('readwrite', (s) => s.put({ path, bytes, message, createdAt: Date.now() }));
  }

  async pendingReceipts() {
    return idb('readonly', (s) => s.getAll());
  }

  /** Henter en kvittering – fra lokal kø hvis den ikke er lastet opp ennå, ellers fra GitHub. */
  async getReceipt(path) {
    const pending = await idb('readonly', (s) => s.get(path));
    if (pending?.bytes) return new Blob([pending.bytes], { type: 'application/pdf' });
    const blob = await this.client.getRaw(path);
    return new Blob([blob], { type: 'application/pdf' });
  }

  // MARK: Synkronisering

  sync() {
    if (this.syncing) {
      // Endret mens vi synkroniserer: kjør en ny runde etterpå.
      this.resyncRequested = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.resyncRequested = false;
        await this.runSync();
      } while (this.resyncRequested && this.status.state !== 'error');
    })().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async runSync() {
    this.setStatus({ state: 'syncing', message: 'Synkroniserer …' });
    try {
      // 1. Last opp kvitteringer som ligger i kø.
      const receipts = await this.pendingReceipts();
      this.setStatus({ pending: receipts.length });
      for (const r of receipts) {
        try {
          await this.client.put(r.path, r.bytes, r.message);
        } catch (e) {
          // 422 = filen finnes allerede (lastet opp tidligere) – da er den trygg.
          if (e.status !== 422) throw e;
        }
        await idb('readwrite', (s) => s.delete(r.path));
        this.setStatus({ pending: this.status.pending - 1 });
      }

      // 2. Slå sammen data med GitHub og lagre. Prøv på nytt hvis noen andre lagret samtidig.
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await this.client.getJSON(this.dataPath);
        const remoteChanged = (remote?.sha ?? null) !== this.sha;
        if (!this.dirty) {
          if (remote && remoteChanged) {
            this.data = mergeData(this.data, remote.data);
            this.sha = remote.sha;
            this.writeLocal();
            this.dispatchEvent(new Event('change'));
          }
          break;
        }
        const versionAtStart = this.version;
        const merged = { ...mergeData(this.data, remote?.data), profile: this.config.profile };
        try {
          const sha = await this.client.putJSON(this.dataPath, merged, this.pendingMessage || 'Synkroniser endringer', remote?.sha);
          // Ta vare på endringer gjort mens opplastingen pågikk.
          this.data = mergeData(this.data, merged);
          this.sha = sha;
          this.dirty = this.version !== versionAtStart;
          this.writeLocal();
          this.dispatchEvent(new Event('change'));
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 3) continue; // konflikt – prøv igjen
          throw e;
        }
      }
      this.setStatus({ state: 'ok', message: 'Lagret i GitHub', pending: 0 });
    } catch (e) {
      const offline = e instanceof GitHubError && e.status === 0;
      this.setStatus({
        state: 'error',
        message: offline ? 'Frakoblet – lagres når du er på nett igjen' : `Synkfeil: ${e.message}`,
      });
    }
  }

  get hasUnsyncedChanges() {
    return this.dirty || this.status.pending > 0;
  }
}

/** Lister profiler som finnes i repoet. */
export async function listProfiles(client) {
  const entries = await client.list('profiler');
  return entries.filter((e) => e.type === 'dir').map((e) => e.name);
}
