// Thin client for gateway-v2. The bearer token lives in sessionStorage (cleared when the tab closes).
const KEY = 'custodychain.session';

export function session() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s) {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.details = body?.details; }
}

async function request(method, url, body, isForm) {
  const s = session();
  const headers = {};
  if (s?.token) headers.Authorization = `Bearer ${s.token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.blob();
  if (r.status === 401 && url !== '/api/login') { setSession(null); location.hash = '#/login'; }
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export const api = {
  login: (username, password) => request('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout'),
  me: () => request('GET', '/api/me'),
  meta: () => request('GET', '/api/meta'),
  users: () => request('GET', '/api/users'),
  list: (scope, extra = {}) => request('GET', `/api/evidence?${new URLSearchParams({ scope, ...extra })}`),
  inbox: () => request('GET', '/api/inbox'),
  get: (id) => request('GET', `/api/evidence/${encodeURIComponent(id)}`),
  manifest: (id) => request('GET', `/api/evidence/${encodeURIComponent(id)}/manifest`),
  register: (form) => request('POST', '/api/evidence', form, true),
  transfer: (id, body) => request('POST', `/api/evidence/${encodeURIComponent(id)}/transfer`, body),
  accept: (id, body) => request('POST', `/api/evidence/${encodeURIComponent(id)}/accept`, body),
  reject: (id, body) => request('POST', `/api/evidence/${encodeURIComponent(id)}/reject`, body),
  cancel: (id, body) => request('POST', `/api/evidence/${encodeURIComponent(id)}/cancel`, body),
  event: (id, body) => request('POST', `/api/evidence/${encodeURIComponent(id)}/events`, body),
  verify: (id, form) => request('POST', `/api/evidence/${encodeURIComponent(id)}/verify`, form, true),
  proof: (id, aid) => request('GET', `/api/evidence/${encodeURIComponent(id)}/proof/${aid}`),
  download: (id, aid, reason) => request('GET', `/api/evidence/${encodeURIComponent(id)}/artefacts/${aid}?reason=${encodeURIComponent(reason)}`),
};
