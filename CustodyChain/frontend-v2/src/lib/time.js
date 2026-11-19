// Manifests use RFC 3339 with an explicit offset; the prototype records Indian Standard Time (+05:30).
const IST = 5.5 * 3600e3;
export function istString(date = new Date()) {
  return new Date(date.getTime() + IST).toISOString().replace(/\.\d{3}Z$/, '+05:30');
}
export function istLocalInput(date = new Date()) {   // value for <input type="datetime-local">
  return new Date(date.getTime() + IST).toISOString().slice(0, 16);
}
export function fromLocalInput(v) {                  // "2026-11-19T10:42" -> "2026-11-19T10:42:00+05:30"
  return v ? `${v.length === 16 ? `${v}:00` : v}+05:30` : '';
}
export function human(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST';
}
