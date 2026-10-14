// Bagian bersama: lokasi repo, pengaturan, antrean postingan, waktu WIB, dan git.
// Dipakai oleh terbitkan.mjs (di GitHub Actions) dan jadwal.mjs / pasang-token.mjs (di PC).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const AKAR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DIR_ANTRIAN = path.join(AKAR, 'antrian');
export const BERKAS_PENGATURAN = path.join(AKAR, 'pengaturan.json');

const PENGATURAN_BAKU = {
  akun: '',                 // username Instagram tanpa @, diisi oleh pasang-token
  zona_waktu: '+07:00',     // WIB
  batas_terlambat_jam: 12,  // lewat dari ini, postingan tidak diterbitkan otomatis
  maks_percobaan: 4,        // untuk galat sementara (server Instagram, jaringan)
  jeda_antar_postingan_detik: 20,
  url_gambar: 'https://raw.githubusercontent.com/{repo}/{sha}/antrian/{id}/{berkas}',
};

export function bacaPengaturan() {
  let isi = {};
  if (fs.existsSync(BERKAS_PENGATURAN)) isi = JSON.parse(fs.readFileSync(BERKAS_PENGATURAN, 'utf8'));
  return { ...PENGATURAN_BAKU, ...isi };
}

export function tulisPengaturan(p) {
  fs.writeFileSync(BERKAS_PENGATURAN, JSON.stringify(p, null, 2) + '\n');
}

// ---------- Antrean ----------
// Satu postingan = satu folder antrian/<id>/ berisi post.json dan slide JPEG.
// status: draf → menunggu → terbit, atau gagal / batal.

export function bacaSemua() {
  if (!fs.existsSync(DIR_ANTRIAN)) return [];
  return fs.readdirSync(DIR_ANTRIAN, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(DIR_ANTRIAN, d.name, 'post.json')))
    .map((d) => bacaPost(d.name))
    .sort(bandingkan);
}

export function bacaPost(id) {
  const isi = JSON.parse(fs.readFileSync(path.join(DIR_ANTRIAN, id, 'post.json'), 'utf8'));
  return { ...isi, id };
}

export function simpanPost(post) {
  const { id, ...isi } = post;
  fs.writeFileSync(path.join(DIR_ANTRIAN, id, 'post.json'), JSON.stringify(isi, null, 2) + '\n');
}

export function jalurPost(id) {
  return path.posix.join('antrian', id);
}

export function bandingkan(a, b) {
  return new Date(a.waktu) - new Date(b.waktu) || (a.urutan || 0) - (b.urutan || 0) || a.id.localeCompare(b.id);
}

// Postingan dalam satu grup (misalnya grid 9 kotak) harus tayang berurutan.
// Kembalikan postingan sebelumnya dalam grup yang belum tayang, atau null.
export function penghalangGrup(post, semua) {
  if (!post.grup) return null;
  return semua.find((p) => p.grup === post.grup && p.id !== post.id && bandingkan(p, post) < 0
    && !['terbit', 'batal'].includes(p.status)) || null;
}

// ---------- Waktu ----------

export function parseWaktu(teks, zona = PENGATURAN_BAKU.zona_waktu) {
  const t = String(teks).trim().toLowerCase();
  if (t === 'sekarang') return new Date().toISOString();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2})[:.](\d{2})$/);
  if (!m) throw new Error(`Format waktu "${teks}" tidak dikenal. Pakai "YYYY-MM-DD HH:MM" (WIB), mis. "2026-10-20 19:00".`);
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00${zona}`;
  if (isNaN(new Date(iso))) throw new Error(`Tanggal "${teks}" tidak valid.`);
  return iso;
}

export function geserMenit(iso, menit, zona = PENGATURAN_BAKU.zona_waktu) {
  return isoZona(new Date(new Date(iso).getTime() + menit * 60000), zona);
}

// Tulis Date sebagai ISO dengan zona tetap (mis. 2026-10-20T19:10:00+07:00), agar post.json mudah dibaca.
export function isoZona(tanggal, zona = PENGATURAN_BAKU.zona_waktu) {
  const [, tanda, jj, mm] = zona.match(/^([+-])(\d{2}):(\d{2})$/);
  const ofs = (tanda === '-' ? -1 : 1) * (Number(jj) * 60 + Number(mm));
  const lokal = new Date(tanggal.getTime() + ofs * 60000).toISOString().slice(0, 19);
  return lokal + zona;
}

export function formatWIB(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(/\./g, ':').replace(/:(?=\s)/g, '') + ' WIB';
}

// ---------- Teks ----------

export function slug(teks) {
  return String(teks).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'post';
}

// Batas caption Instagram: 2.200 karakter, 30 tagar, 20 sebutan (@).
export function periksaCaption(caption) {
  const masalah = [];
  const panjang = [...caption].length;
  if (panjang > 2200) masalah.push(`caption ${panjang} karakter (maks. 2.200)`);
  const tagar = (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
  if (tagar > 30) masalah.push(`${tagar} tagar (maks. 30)`);
  const sebutan = (caption.match(/(^|\s)@[\w.]+/g) || []).length;
  if (sebutan > 20) masalah.push(`${sebutan} sebutan @ (maks. 20)`);
  return { panjang, tagar, sebutan, masalah };
}

// ---------- Git ----------

export function jalankan(perintah, args, opsi = {}) {
  const { bolehGagal, ...lain } = opsi;
  const r = spawnSync(perintah, args, { cwd: AKAR, encoding: 'utf8', windowsHide: true, ...lain });
  if (r.error) throw new Error(`${perintah} tidak bisa dijalankan: ${r.error.message}`);
  if (r.status !== 0 && !bolehGagal) {
    throw new Error(`${perintah} ${args.join(' ')} gagal:\n${String(r.stderr || r.stdout || '').trim()}`);
  }
  return r;
}

export const git = (args, opsi) => jalankan('git', args, opsi);

export function tarikTerbaru() {
  const remote = git(['remote'], { bolehGagal: true }).stdout.trim();
  if (!remote) return;
  const r = git(['pull', '--rebase', '--autostash', '--quiet'], { bolehGagal: true });
  if (r.status !== 0) {
    git(['rebase', '--abort'], { bolehGagal: true });
    throw new Error(`Gagal mengambil perubahan terbaru dari GitHub:\n${(r.stderr || r.stdout).trim()}`);
  }
}

// Commit jalur tertentu lalu push. Kalau GitHub sudah berubah (mis. penerbit baru saja
// menulis status), tarik dulu lalu coba lagi.
export function commitDanPush(pesan, jalur, { push = true } = {}) {
  git(['add', '-A', '--', ...jalur]);
  if (git(['diff', '--cached', '--quiet'], { bolehGagal: true }).status === 0) return false;
  git(['commit', '--quiet', '-m', pesan]);
  if (!push) return true;
  const remote = git(['remote'], { bolehGagal: true }).stdout.trim();
  if (!remote) return true;
  for (let i = 0; i < 4; i++) {
    if (git(['push', '--quiet'], { bolehGagal: true }).status === 0) return true;
    tarikTerbaru();
  }
  throw new Error('git push gagal setelah 4 kali coba.');
}

export function repoGitHub() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = git(['remote', 'get-url', 'origin'], { bolehGagal: true }).stdout.trim();
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}
