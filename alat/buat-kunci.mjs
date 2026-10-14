// Membuat gembok publik (rahasia/kunci-publik.pem) dan kunci pembukanya (GitHub Secret KUNCI_PRIVAT)
// untuk token Instagram. Dijalankan Claude sekali saat pemasangan, dari lingkungan yang gh-nya login.
// Kunci privat langsung dikirim ke GitHub lewat gh dan tidak pernah ditulis ke disk atau layar.
//   node alat/buat-kunci.mjs [--ganti]   (--ganti: buat ulang; token harus dipasang ulang sesudahnya)
import fs from 'node:fs';
import { buatPasanganKunci, BERKAS_KUNCI_PUBLIK, JALUR_KUNCI_PUBLIK, BERKAS_TOKEN } from './rahasia.mjs';
import { jalankan, repoGitHub, commitDanPush, tarikTerbaru } from './umum.mjs';

try {
  const ganti = process.argv.includes('--ganti');
  if (fs.existsSync(BERKAS_KUNCI_PUBLIK) && !ganti) {
    throw new Error('Gembok publik sudah ada. Pakai --ganti hanya kalau memang perlu membuat ulang (token harus dipasang ulang).');
  }
  const repo = repoGitHub();
  if (!repo) throw new Error('Repo GitHub belum tersambung (git remote origin).');
  tarikTerbaru();

  const { publicKey, privateKey } = buatPasanganKunci();
  if (process.env.KUNCI_PRIVAT_KE_BERKAS) {
    fs.writeFileSync(process.env.KUNCI_PRIVAT_KE_BERKAS, privateKey); // hanya untuk uji tiruan
  } else {
    jalankan('gh', ['secret', 'set', 'KUNCI_PRIVAT', '-R', repo], { input: privateKey });
  }
  fs.mkdirSync(new URL('../rahasia/', import.meta.url), { recursive: true });
  fs.writeFileSync(BERKAS_KUNCI_PUBLIK, publicKey);
  commitDanPush('🔐 Gembok publik untuk token Instagram', [JALUR_KUNCI_PUBLIK]);
  console.log('🔐 Gembok publik tersimpan di repo, dan kunci pembukanya ada di GitHub Secrets (KUNCI_PRIVAT).');
  if (ganti && fs.existsSync(BERKAS_TOKEN)) console.log('⚠️ Token lama tidak bisa dibuka lagi. Pemilik perlu menjalankan "Pasang Token Instagram.bat".');
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
}
