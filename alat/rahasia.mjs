// Token Instagram disimpan terenkripsi di rahasia/token-ig.json memakai "gembok publik"
// rahasia/kunci-publik.pem (RSA-OAEP-SHA256 membungkus kunci AES-256-GCM).
// Kunci pembukanya (KUNCI_PRIVAT) hanya ada di GitHub Secrets. Akibatnya:
// - repo boleh publik;
// - PC pemilik tidak perlu login GitHub untuk memasang token (cukup gembok publik);
// - penerbit di GitHub bisa membuka token, memperpanjangnya, lalu menguncinya lagi sendiri.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AKAR } from './umum.mjs';

export const BERKAS_TOKEN = path.join(AKAR, 'rahasia', 'token-ig.json');
export const JALUR_TOKEN = 'rahasia/token-ig.json';
export const BERKAS_KUNCI_PUBLIK = path.join(AKAR, 'rahasia', 'kunci-publik.pem');
export const JALUR_KUNCI_PUBLIK = 'rahasia/kunci-publik.pem';

const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

export function buatPasanganKunci() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function bacaKunciPublik() {
  if (!fs.existsSync(BERKAS_KUNCI_PUBLIK)) {
    throw new Error('Gembok publik (rahasia/kunci-publik.pem) belum ada. Minta Claude menjalankan alat/buat-kunci.mjs dulu.');
  }
  return fs.readFileSync(BERKAS_KUNCI_PUBLIK, 'utf8');
}

export function kunciPrivatDariEnv() {
  const pem = String(process.env.KUNCI_PRIVAT || '').trim();
  if (!pem.includes('PRIVATE KEY')) {
    throw new Error('KUNCI_PRIVAT belum ada di GitHub Secrets. Minta Claude menjalankan alat/buat-kunci.mjs.');
  }
  return pem;
}

export function sandikan(token, kunciPublikPem) {
  const kunciAes = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kunciAes, iv);
  const data = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return {
    versi: 2,
    kunci: crypto.publicEncrypt({ key: kunciPublikPem, ...OAEP }, kunciAes).toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function bukaSandi(berkas, kunciPrivatPem) {
  try {
    const kunciAes = crypto.privateDecrypt({ key: kunciPrivatPem, ...OAEP }, Buffer.from(berkas.kunci, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', kunciAes, Buffer.from(berkas.iv, 'base64'));
    d.setAuthTag(Buffer.from(berkas.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(berkas.data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new Error('Token tidak bisa dibuka dengan KUNCI_PRIVAT yang ada (mungkin dikunci dengan gembok lama). Jalankan "Pasang Token Instagram.bat" lagi.');
  }
}

export function bacaBerkasToken() {
  if (!fs.existsSync(BERKAS_TOKEN)) return null;
  return JSON.parse(fs.readFileSync(BERKAS_TOKEN, 'utf8'));
}

// meta: { akun, user_id, diperbarui, kedaluwarsa, kedaluwarsa_perkiraan }
export function tulisBerkasToken(token, kunciPublikPem, meta) {
  fs.mkdirSync(path.dirname(BERKAS_TOKEN), { recursive: true });
  fs.writeFileSync(BERKAS_TOKEN, JSON.stringify({ ...meta, ...sandikan(token, kunciPublikPem) }, null, 2) + '\n');
}
