// D-040: files are hashed in the browser before upload; the gateway re-hashes and rejects any mismatch.
export async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
