// Minimal klient for GitHub sitt Contents-API. Alle data lagres som filer i et repo.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export class GitHubClient {
  constructor({ token, owner, repo, branch }) {
    Object.assign(this, { token, owner, repo, branch });
  }

  async request(url, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
        method,
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new GitHubError('Ingen nettverkstilkobling', 0);
    }
    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).message || message; } catch { /* ignorer */ }
      if (res.status === 401) message = 'Ugyldig eller utløpt token';
      throw new GitHubError(message, res.status);
    }
    return res;
  }

  contentsUrl(path) {
    return `/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`;
  }

  /** Henter repo-info og sjekker at tokenet har skrivetilgang. */
  async checkAccess() {
    const repo = await (await this.request(`/repos/${this.owner}/${this.repo}`)).json();
    if (!this.branch) this.branch = repo.default_branch || 'main';
    return {
      private: repo.private,
      canWrite: repo.permissions ? !!repo.permissions.push : true,
      defaultBranch: repo.default_branch,
    };
  }

  /** Returnerer {data, sha} eller null hvis filen ikke finnes. */
  async getJSON(path) {
    try {
      const res = await this.request(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
      const json = await res.json();
      let text;
      if (json.encoding === 'base64' && json.content) {
        text = new TextDecoder().decode(fromBase64(json.content));
      } else {
        // Filer over 1 MB kommer uten innhold – hent rådata.
        text = await (await this.getRaw(path)).text();
      }
      return { data: JSON.parse(text), sha: json.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async getRaw(path) {
    const res = await this.request(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`,
      { accept: 'application/vnd.github.raw+json' });
    return res.blob();
  }

  /** Lister mapper/filer i en katalog. Returnerer [] hvis den ikke finnes. */
  async list(path) {
    try {
      const res = await this.request(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  /** Lagrer en fil (én commit). `sha` kreves når en eksisterende fil oppdateres. */
  async put(path, bytes, message, sha) {
    const res = await this.request(this.contentsUrl(path), {
      method: 'PUT',
      body: { message, content: toBase64(bytes), branch: this.branch, ...(sha ? { sha } : {}) },
    });
    return (await res.json()).content.sha;
  }

  async putJSON(path, data, message, sha) {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n');
    return this.put(path, bytes, message, sha);
  }
}
