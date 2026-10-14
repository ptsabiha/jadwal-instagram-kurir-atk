// Dijalankan pemilik lewat "Pasang Token Instagram.bat".
// Token ditempel di jendela ini dan tidak pernah ditampilkan. Token dienkripsi ke
// rahasia/token-ig.json, dan kuncinya dikirim ke GitHub Secrets (KUNCI_TOKEN) lewat gh.
import fs from 'node:fs';
import readline from 'node:readline';
import { buatKlien, jelaskanGalat } from './ig.mjs';
import { buatKunci, tulisBerkasToken, JALUR_TOKEN } from './rahasia.mjs';
import { bacaPengaturan, tulisPengaturan, isoZona, formatWIB, jalankan, tarikTerbaru, commitDanPush, repoGitHub } from './umum.mjs';

let antreanPipa = null; // untuk pengujian: masukan lewat pipa, satu jawaban per baris

async function tanya(teks, { sembunyi = false } = {}) {
  process.stdout.write(teks);
  if (!process.stdin.isTTY) {
    antreanPipa ??= fs.readFileSync(0, 'utf8').split(/\r?\n/);
    const jawab = (antreanPipa.shift() || '').trim();
    process.stdout.write(sembunyi ? `[${jawab.length} karakter]\n` : `${jawab}\n`);
    return jawab;
  }
  if (!sembunyi) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return new Promise((r) => rl.question('', (j) => { rl.close(); r(j.trim()); }));
  }
  return new Promise((selesai) => {
    let isi = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const dengar = (potong) => {
      for (const ch of potong) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', dengar);
          process.stdout.write('\n');
          return selesai(isi.trim());
        }
        if (ch === '\u0003') { process.stdout.write('\nDibatalkan.\n'); process.exit(1); }
        if (ch === '\b' || ch === '\u007f') isi = isi.slice(0, -1);
        else if (ch >= ' ') isi += ch;
      }
      process.stdout.write(`\r${teks}[${isi.length} karakter diterima]   `);
    };
    stdin.on('data', dengar);
  });
}

async function utama() {
  console.log('==============================================');
  console.log('  Pasang Token Instagram untuk penjadwal Kurir ATK');
  console.log('==============================================\n');

  const repo = repoGitHub();
  if (!repo) throw new Error('Folder ini belum tersambung ke repo GitHub. Minta Claude menyiapkannya dulu.');
  const lewatiGh = Boolean(process.env.PASANG_KUNCI_KE_BERKAS); // hanya untuk pengujian
  if (!lewatiGh && jalankan('gh', ['auth', 'status'], { bolehGagal: true }).status !== 0) {
    throw new Error('GitHub CLI belum login. Jalankan "gh auth login" dulu, atau minta bantuan Claude.');
  }
  tarikTerbaru();

  console.log('Salin token dari halaman Meta for Developers (tombol "Generate token"),');
  console.log('lalu tempel di sini dengan klik kanan atau Ctrl+V. Isinya tidak akan terlihat.\n');
  const token = (await tanya('Token: ', { sembunyi: true })).replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  if (token.length < 40) throw new Error('Token terlalu pendek. Pastikan seluruh token tersalin.');

  console.log('\nMemeriksa token ke Instagram...');
  const ig = buatKlien(token);
  let saya;
  try {
    saya = await ig.get('/me', { fields: 'user_id,username' });
  } catch (e) {
    throw new Error(`Instagram menolak token ini: ${jelaskanGalat(e)}`);
  }
  const igId = String(saya.user_id || saya.id);
  try {
    await ig.get(`/${igId}/content_publishing_limit`, { fields: 'quota_usage' });
  } catch (e) {
    throw new Error(`Token bisa membaca akun @${saya.username}, tapi tidak boleh memposting: ${jelaskanGalat(e)}\n`
      + 'Saat membuat token, pastikan izin instagram_business_content_publish ikut dicentang.');
  }
  console.log(`Token valid untuk akun Instagram @${saya.username}.`);

  const pengaturan = bacaPengaturan();
  if (pengaturan.akun && pengaturan.akun.toLowerCase() !== String(saya.username).toLowerCase()) {
    const j = await tanya(`\nPERHATIAN: penjadwal ini sebelumnya memakai @${pengaturan.akun}, bukan @${saya.username}.\nKetik GANTI untuk memakai @${saya.username}, atau tekan Enter untuk batal: `);
    if (j !== 'GANTI') throw new Error('Dibatalkan. Tidak ada yang diubah.');
  } else {
    const j = await tanya(`\nPostingan terjadwal akan tayang di @${saya.username}. Lanjutkan? (y/n): `);
    if (!/^(y|ya)$/i.test(j)) throw new Error('Dibatalkan. Tidak ada yang diubah.');
  }

  const kunci = buatKunci();
  if (lewatiGh) {
    fs.writeFileSync(process.env.PASANG_KUNCI_KE_BERKAS, kunci);
  } else {
    console.log('\nMenyimpan kunci ke GitHub Secrets...');
    jalankan('gh', ['secret', 'set', 'KUNCI_TOKEN', '-R', repo], { input: kunci });
  }

  const kini = new Date();
  tulisBerkasToken(token, kunci, {
    akun: saya.username,
    user_id: igId,
    diperbarui: isoZona(kini),
    kedaluwarsa: isoZona(new Date(kini.getTime() + 60 * 86400000)),
    kedaluwarsa_perkiraan: true,
  });
  tulisPengaturan({ ...pengaturan, akun: saya.username });
  commitDanPush(`🔑 Token Instagram dipasang (@${saya.username})`, [JALUR_TOKEN, 'pengaturan.json']);

  console.log(`\nSelesai. Token tersimpan terenkripsi dan berlaku sekitar 60 hari (sampai ${formatWIB(isoZona(new Date(kini.getTime() + 60 * 86400000)))}).`);
  console.log('Penjadwal akan memperpanjangnya sendiri setiap minggu.');
  console.log('Kembali ke Claude dan katakan: "token Instagram sudah dipasang".');
}

utama().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exitCode = 1;
});
