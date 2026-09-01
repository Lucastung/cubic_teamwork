/** 共用：密碼雜湊（PBKDF2）與電子簽章鏈 */

const ITER = 100_000;

export async function hashPassword(pw: string, saltHex?: string): Promise<string> {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  const hex = (buf: ArrayBuffer | Uint8Array) =>
    [...new Uint8Array(buf as ArrayBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(bits)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(':');
  return (await hashPassword(pw, salt)) === stored;
}

export const sha256hex = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** 簽章鏈：chain_hash = sha256(前一筆 chain_hash + content_hash + action + signer + 時間) */
export async function addSignature(db: D1Database, entityType: string, entityId: number, action: string, signerId: number, note: string | null, content: object) {
  const content_hash = await sha256hex(JSON.stringify(content));
  const prev = await db.prepare('SELECT chain_hash FROM signatures ORDER BY id DESC LIMIT 1').first<{ chain_hash: string }>();
  const prev_hash = prev?.chain_hash ?? 'GENESIS';
  const now = new Date().toISOString();
  const chain_hash = await sha256hex(prev_hash + content_hash + action + signerId + now);
  await db.prepare(
    'INSERT INTO signatures (entity_type, entity_id, action, signer_id, note, content_hash, prev_hash, chain_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(entityType, entityId, action, signerId, note, content_hash, prev_hash, chain_hash).run();
}
