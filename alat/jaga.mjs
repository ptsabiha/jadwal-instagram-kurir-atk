// Penjaga jadwal. Jalan di GitHub Actions (workflow jaga.yml) sampai ±5 jam 45 menit per run,
// dan menjalankan penerbit (terbitkan.mjs) tiap 5 menit, tepat di menit kelipatan 5.
//
// Kenapa: cron GitHub tidak bisa diandalkan. Pada 15 Okt 2026 cron "tiap 15 menit" hanya jalan
// 4 kali dalam 14 jam (jarak 2–5 jam), jadi postingan bisa telat berjam-jam.
//
// Supaya penjagaan tidak putus, run ini memesan run pengganti (workflow_dispatch) begitu mulai.
// Run pengganti menunggu di antrean concurrency "penjaga-jadwal" dan langsung jalan saat run ini
// selesai. Kalau antrean tidak punya postingan "menunggu", penjaga hanya jalan satu putaran
// (supaya token tetap diperpanjang) lalu berhenti tanpa memesan pengganti. Cron di jaga.yml dan
// "jadwal.mjs setujui" menyalakannya lagi.
//
//   JAGA_MENIT       lama satu run (baku 345)
//   JAGA_JEDA_DETIK  jarak antarputaran (baku 300)
//   JAGA_PESAN=0     jangan memesan run pengganti (dipakai uji tiruan)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { AKAR, bacaSemua, git, jalankan, repoGitHub, formatWIB, isoZona } from './umum.mjs';

const MENIT = Number(process.env.JAGA_MENIT || 345);
const JEDA = Number(process.env.JAGA_JEDA_DETIK || 300) * 1000;
const mulai = Date.now();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const adaMenunggu = () => bacaSemua().some((p) => p.status === 'menunggu');

function tarik() {
  const r = git(['pull', '--rebase', '--quiet'], { bolehGagal: true });
  if (r.status !== 0) console.log(`⚠️ Gagal menarik antrean terbaru: ${(r.stderr || r.stdout).trim()}`);
}

function pesanPengganti() {
  if (process.env.JAGA_PESAN === '0') return;
  const repo = repoGitHub();
  const r = jalankan('gh', ['workflow', 'run', 'jaga.yml', '-R', repo, '--ref', process.env.GITHUB_REF_NAME || 'main'], { bolehGagal: true });
  console.log(r.status === 0 ? '🔁 Run pengganti dipesan; jalan otomatis begitu run ini selesai.'
    : `⚠️ Run pengganti gagal dipesan (${(r.stderr || r.stdout).trim()}). Cron cadangan akan menyalakan penjaga lagi.`);
}

function putaran() {
  // GITHUB_SHA dikosongkan: alamat gambar harus memakai commit terbaru hasil tarik, bukan commit saat run mulai.
  const r = spawnSync(process.execPath, [path.join(AKAR, 'alat', 'terbitkan.mjs')], {
    cwd: AKAR, stdio: 'inherit', env: { ...process.env, MODE: 'terbit', GITHUB_SHA: '' },
  });
  return r.status ?? 1;
}

tarik();
let adaGagal = false;
if (adaMenunggu()) pesanPengganti();
else console.log('Tidak ada postingan menunggu. Satu putaran saja (perpanjangan token), lalu berhenti.');

for (let ke = 1; ; ke++) {
  console.log(`\n── Putaran ${ke} · ${formatWIB(isoZona(new Date()))}`);
  if (putaran() !== 0) adaGagal = true;
  tarik();
  if (!adaMenunggu()) { console.log('Antrean selesai; penjaga berhenti.'); break; }
  // Tidur sampai menit kelipatan 5 berikutnya (+15 detik), supaya jam tayang :00/:30 tepat tertangkap.
  const berikut = Math.floor(Date.now() / JEDA) * JEDA + JEDA + Math.min(15000, JEDA / 4);
  if (berikut - mulai > MENIT * 60000) { console.log('Batas waktu run tercapai; run pengganti melanjutkan.'); break; }
  await tidur(berikut - Date.now());
}
process.exitCode = adaGagal ? 1 : 0;
