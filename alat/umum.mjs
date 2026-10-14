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
  jarak_jadwal_jam: 3,          // jarak baku antarpostingan saat waktu dihitung otomatis (keputusan pemilik)
  jam_tenang: '22:00-07:00',    // slot otomatis yang jatuh di sini digeser ke akhir jam tenang; '' = mati
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
  const lokal = new Date(tanggal.getTime() + offsetMenit(zona) * 60000).toISOString().slice(0, 19);
  return lokal + zona;
}

function offsetMenit(zona) {
  const [, tanda, jj, mm] = zona.match(/^([+-])(\d{2}):(\d{2})$/);
  return (tanda === '-' ? -1 : 1) * (Number(jj) * 60 + Number(mm));
}

function bacaJamTenang(teks) {
  const m = String(teks || '').match(/^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})$/);
  return m ? { mulai: m[1] * 60 + Number(m[2]), selesai: m[3] * 60 + Number(m[4]) } : null;
}

function menitLokal(tanggal, zona) {
  const d = new Date(tanggal.getTime() + offsetMenit(zona) * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const tenangPadaMenit = (m, jt) => (jt.mulai <= jt.selesai ? m >= jt.mulai && m < jt.selesai : m >= jt.mulai || m < jt.selesai);

export function diJamTenang(iso, pengaturan) {
  const jt = bacaJamTenang(pengaturan.jam_tenang);
  return jt ? tenangPadaMenit(menitLokal(new Date(iso), pengaturan.zona_waktu), jt) : false;
}

// Jam tayang baku per hari: mulai akhir jam tenang (07.00), lalu tiap jarak_jadwal_jam selama
// di luar jam tenang. Dengan jarak 3 jam dan jam tenang 22.00–07.00: 07.00, 10.00, 13.00, 16.00, 19.00.
export function slotHarian(pengaturan) {
  const jt = bacaJamTenang(pengaturan.jam_tenang);
  const awal = jt ? jt.selesai : 7 * 60;
  const langkah = Math.max(15, Math.round(pengaturan.jarak_jadwal_jam * 60));
  const slot = [];
  for (let m = awal; m < awal + 1440; m += langkah) {
    if (!jt || !tenangPadaMenit(m % 1440, jt)) slot.push(m % 1440);
  }
  return slot.sort((a, b) => a - b);
}

// Slot baku pertama yang sama dengan atau setelah ms (epoch).
function slotBakuSejak(ms, pengaturan) {
  const slot = slotHarian(pengaturan);
  const ofs = offsetMenit(pengaturan.zona_waktu) * 60000;
  const lokal = new Date(ms + ofs);
  const tengahMalam = Date.UTC(lokal.getUTCFullYear(), lokal.getUTCMonth(), lokal.getUTCDate()) - ofs;
  for (let hari = 0; hari < 3; hari++) {
    for (const m of slot) {
      const t = tengahMalam + hari * 86400000 + m * 60000;
      if (t >= ms) return isoZona(new Date(t), pengaturan.zona_waktu);
    }
  }
  throw new Error('Tidak ada slot tayang; periksa jam_tenang dan jarak_jadwal_jam di pengaturan.json.');
}

// Slot baku berikutnya yang berjarak minimal jarak_jadwal_jam dari iso.
export function slotSetelah(iso, pengaturan) {
  return slotBakuSejak(new Date(iso).getTime() + pengaturan.jarak_jadwal_jam * 3600000, pengaturan);
}

// Kalau waktu jatuh di jam tenang, geser ke akhir jam tenang (mis. 01.00 → 07.00).
export function keluarJamTenang(iso, pengaturan) {
  if (!diJamTenang(iso, pengaturan)) return iso;
  const jt = bacaJamTenang(pengaturan.jam_tenang);
  const t = new Date(iso);
  t.setUTCSeconds(0, 0);
  const tambah = (jt.selesai - menitLokal(t, pengaturan.zona_waktu) + 1440) % 1440;
  return isoZona(new Date(t.getTime() + tambah * 60000), pengaturan.zona_waktu);
}

const SEPEREMPAT_JAM = 15 * 60000;
const AKTIF = ['draf', 'menunggu', 'terbit'];
const waktuEfektif = (p) => new Date(p.status === 'terbit' && p.terbit_pada ? p.terbit_pada : p.waktu).getTime();

// Slot otomatis berikutnya: slot baku (07.00/10.00/13.00/16.00/19.00) yang berjarak minimal jarak_jadwal_jam
// dari jadwal terakhir di antrean (draf, menunggu, atau sudah tayang), dan paling cepat 15 menit dari sekarang.
export function slotBerikut(semua, pengaturan, sekarang = new Date()) {
  const jarak = pengaturan.jarak_jadwal_jam * 3600000;
  const waktu = semua.filter((p) => AKTIF.includes(p.status)).map((p) => new Date(p.waktu).getTime());
  const terakhir = waktu.length ? Math.max(...waktu) : -Infinity;
  return slotBakuSejak(Math.max(terakhir + jarak, sekarang.getTime() + SEPEREMPAT_JAM), pengaturan);
}

// Peringatan (bukan larangan) kalau jadwal terlalu dekat dengan postingan lain atau di jam tenang.
export function peringatanJadwal(post, semua, pengaturan) {
  const pesan = [];
  let dekat = null;
  let selisih = Infinity;
  for (const p of semua) {
    if (p.id === post.id || !AKTIF.includes(p.status)) continue;
    const jam = Math.abs(waktuEfektif(p) - new Date(post.waktu).getTime()) / 3600000;
    if (jam < selisih) { selisih = jam; dekat = p; }
  }
  if (dekat && selisih < pengaturan.jarak_jadwal_jam - 0.01) {
    const teks = selisih < 1 ? `${Math.round(selisih * 60)} menit` : `${Math.round(selisih * 10) / 10} jam`;
    pesan.push(`hanya ${teks} dari "${dekat.judul}" (aturan jarak ${pengaturan.jarak_jadwal_jam} jam)`);
  }
  if (diJamTenang(post.waktu, pengaturan)) pesan.push(`jatuh di jam tenang ${pengaturan.jam_tenang} WIB`);
  return pesan;
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
