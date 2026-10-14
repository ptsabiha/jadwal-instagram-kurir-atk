// Token Instagram disimpan terenkripsi (AES-256-GCM) di rahasia/token-ig.json.
// Kuncinya hanya ada di GitHub Secrets (KUNCI_TOKEN), jadi repo boleh publik.
// Dengan cara ini penerbit di GitHub bisa memperpanjang token sendiri tiap minggu.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AKAR } from './umum.mjs';

export const BERKAS_TOKEN = path.join(AKAR, 'rahasia', 'token-ig.json');
export const JALUR_TOKEN = 'rahasia/token-ig.json';

export function buatKunci() {
  return crypto.randomBytes(32).toString('hex');
}

export function kunciDariEnv() {
  const hex = String(process.env.KUNCI_TOKEN || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('KUNCI_TOKEN belum ada di GitHub Secrets atau formatnya salah. Jalankan "Pasang Token Instagram.bat" lagi.');
  }
  return hex;
}

export function sandikan(token, kunciHex) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(kunciHex, 'hex'), iv);
  const data = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function bukaSandi(berkas, kunciHex) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(kunciHex, 'hex'), Buffer.from(berkas.iv, 'base64'));
    d.setAuthTag(Buffer.from(berkas.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(berkas.data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new Error('Token tidak bisa dibuka dengan KUNCI_TOKEN yang ada. Jalankan "Pasang Token Instagram.bat" lagi.');
  }
}

export function bacaBerkasToken() {
  if (!fs.existsSync(BERKAS_TOKEN)) return null;
  return JSON.parse(fs.readFileSync(BERKAS_TOKEN, 'utf8'));
}

// meta: { akun, user_id, diperbarui, kedaluwarsa, kedaluwarsa_perkiraan }
export function tulisBerkasToken(token, kunciHex, meta) {
  fs.mkdirSync(path.dirname(BERKAS_TOKEN), { recursive: true });
  const isi = { ...meta, ...sandikan(token, kunciHex) };
  fs.writeFileSync(BERKAS_TOKEN, JSON.stringify(isi, null, 2) + '\n');
}
