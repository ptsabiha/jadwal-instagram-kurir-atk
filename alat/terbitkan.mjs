// Penerbit Instagram. Dijalankan penjaga (jaga.mjs) tiap 5 menit di GitHub Actions, atau manual dari jadwal.mjs.
//   MODE=terbit          terbitkan postingan berstatus "menunggu" yang sudah jatuh tempo (baku)
//   MODE=uji POST=a,b    buat wadah media di Instagram TANPA menerbitkan (cek gambar & rasio)
//   MODE=cek             tampilkan akun, kuota publikasi, dan masa berlaku token
//   MODE=segarkan-token  paksa perpanjang token (token harus berumur ≥ 24 jam)
// Token diperpanjang otomatis kalau sudah berumur ≥ 6 hari.
import fs from 'node:fs';
import { buatKlien, GalatIG, jenisGalat, jelaskanGalat } from './ig.mjs';
import { bacaBerkasToken, tulisBerkasToken, kunciPrivatDariEnv, bacaKunciPublik, bukaSandi, JALUR_TOKEN } from './rahasia.mjs';
import {
  bacaSemua, simpanPost, jalurPost, penghalangGrup, bacaPengaturan, commitDanPush,
  isoZona, formatWIB, repoGitHub, git,
} from './umum.mjs';

const MODE = String(process.env.MODE || 'terbit').trim();
const HARI = 86400000;
const JEDA_CEK_MS = Number(process.env.JEDA_CEK_MS || 4000);
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const ringkasan = [];
function catat(baris) {
  console.log(baris);
  ringkasan.push(baris);
}

utama().then((kode) => selesai(kode), (e) => {
  catat(`❌ ${e.message}`);
  selesai(1);
});

function selesai(kode) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Penerbit Instagram (${MODE})\n\n${ringkasan.map((b) => `- ${b}`).join('\n')}\n`);
  }
  process.exitCode = kode;
}

async function utama() {
  const pengaturan = bacaPengaturan();
  const sekarang = new Date();
  const berkas = bacaBerkasToken();
  const semua = bacaSemua();
  const jatuhTempo = semua.filter((p) => p.status === 'menunggu' && new Date(p.waktu) <= sekarang);
  const perluSegar = berkas && sekarang - new Date(berkas.diperbarui) >= 6 * HARI;

  // Jalan rutin tanpa pekerjaan: jangan sentuh API sama sekali.
  if (MODE === 'terbit' && !jatuhTempo.length && !perluSegar) {
    const berikut = semua.find((p) => p.status === 'menunggu');
    catat(berikut ? `Belum ada yang jatuh tempo. Berikutnya: "${berikut.judul}" ${formatWIB(berikut.waktu)}.` : 'Antrean kosong.');
    return peringatanToken(berkas, sekarang);
  }

  if (!berkas) throw new Error('Token Instagram belum dipasang. Jalankan "Pasang Token Instagram.bat".');
  let token = bukaSandi(berkas, kunciPrivatDariEnv());
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
  let ig = buatKlien(token);

  let saya;
  try {
    saya = await ig.get('/me', { fields: 'user_id,username' });
  } catch (e) {
    throw new Error(jelaskanGalat(e));
  }
  if (pengaturan.akun && String(saya.username).toLowerCase() !== pengaturan.akun.toLowerCase()) {
    throw new Error(`Token ini milik @${saya.username}, padahal pengaturan.json menyebut @${pengaturan.akun}. Dihentikan supaya tidak memposting ke akun yang salah.`);
  }
  const igId = saya.user_id || saya.id;
  catat(`Akun: @${saya.username}`);

  if (perluSegar || MODE === 'segarkan-token') {
    try {
      const baru = await ig.get('/refresh_access_token', { grant_type: 'ig_refresh_token' });
      const kini = new Date();
      tulisBerkasToken(baru.access_token, bacaKunciPublik(), {
        akun: saya.username,
        user_id: String(igId),
        diperbarui: isoZona(kini),
        kedaluwarsa: isoZona(new Date(kini.getTime() + Number(baru.expires_in) * 1000)),
        kedaluwarsa_perkiraan: false,
      });
      if (baru.access_token !== token) {
        token = baru.access_token;
        if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
        ig = buatKlien(token);
      }
      commitDanPush('🔑 Token Instagram diperpanjang', [JALUR_TOKEN]);
      catat(`🔑 Token diperpanjang sampai ${formatWIB(bacaBerkasToken().kedaluwarsa)}.`);
    } catch (e) {
      catat(`⚠️ Token gagal diperpanjang: ${jelaskanGalat(e)}`);
    }
  }

  let kode = peringatanToken(bacaBerkasToken(), sekarang);
  if (MODE === 'cek') return Math.max(kode, await cek(ig, igId, semua));
  if (MODE === 'uji') return Math.max(kode, await uji(ig, igId, pengaturan));
  if (MODE === 'terbit') return Math.max(kode, await terbitkanJatuhTempo(ig, igId, pengaturan, jatuhTempo));
  if (MODE !== 'segarkan-token') throw new Error(`MODE "${MODE}" tidak dikenal.`);
  return kode;
}

function peringatanToken(berkas, sekarang) {
  if (!berkas?.kedaluwarsa) return 0;
  const sisa = (new Date(berkas.kedaluwarsa) - sekarang) / HARI;
  // Putaran rutin hanya ditandai gagal (= email dari GitHub) sekitar pukul 08.00 WIB, supaya email tidak membanjir.
  const tandai = MODE !== 'terbit' || (sekarang.getUTCHours() === 1 && sekarang.getUTCMinutes() < 30) ? 1 : 0;
  if (sisa < 0) {
    catat('❌ Token Instagram sudah kedaluwarsa. Buat token baru lalu jalankan "Pasang Token Instagram.bat".');
    return tandai;
  }
  if (sisa < 10) {
    catat(`⚠️ Token Instagram tinggal ${Math.floor(sisa)} hari dan belum berhasil diperpanjang. Buat token baru lalu jalankan "Pasang Token Instagram.bat".`);
    return tandai;
  }
  return 0;
}

// ---------- Mode ----------

async function cek(ig, igId, semua) {
  try {
    const r = await ig.get(`/${igId}/content_publishing_limit`, { fields: 'config,quota_usage' });
    const d = r.data?.[0] || {};
    catat(`Kuota publikasi 24 jam: terpakai ${d.quota_usage ?? '?'} dari ${d.config?.quota_total ?? '?'}.`);
  } catch (e) {
    catat(`⚠️ Kuota publikasi tidak bisa dibaca: ${jelaskanGalat(e)}`);
    return 1;
  }
  const b = bacaBerkasToken();
  catat(`Token berlaku sampai ${formatWIB(b.kedaluwarsa)}${b.kedaluwarsa_perkiraan ? ' (perkiraan)' : ''}.`);
  const hitung = {};
  for (const p of semua) hitung[p.status] = (hitung[p.status] || 0) + 1;
  catat(`Antrean: ${Object.entries(hitung).map(([s, n]) => `${n} ${s}`).join(', ') || 'kosong'}.`);
  return 0;
}

async function uji(ig, igId, pengaturan) {
  const ids = String(process.env.POST || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('Mode uji butuh POST=<id postingan>.');
  const semua = bacaSemua();
  let kode = 0;
  for (const id of ids) {
    const p = semua.find((x) => x.id === id);
    if (!p) { catat(`❌ Postingan "${id}" tidak ada di antrean.`); kode = 1; continue; }
    try {
      await buatWadah(ig, igId, p, pengaturan);
      p.uji = { pada: isoZona(new Date()), hasil: 'lolos', pesan: 'Instagram menerima semua slide dan caption (belum diterbitkan).' };
      catat(`🧪 Lolos: ${p.judul}`);
    } catch (e) {
      if (jenisGalat(e) === 'batas') {
        p.uji = { pada: isoZona(new Date()), hasil: 'tertunda', pesan: `Belum diuji: ${jelaskanGalat(e)}` };
        catat(`⏳ ${p.judul}: ${p.uji.pesan} Uji sisanya dihentikan supaya kuota tidak makin terkuras.`);
        simpanPost(p);
        kode = 1;
        break;
      }
      p.uji = { pada: isoZona(new Date()), hasil: 'gagal', pesan: jelaskanGalat(e) };
      catat(`🧪 Gagal: ${p.judul}: ${p.uji.pesan}`);
      kode = 1;
    }
    simpanPost(p);
  }
  commitDanPush(`🧪 Uji: ${ids.join(', ')}`, ids.map(jalurPost));
  return kode;
}

async function terbitkanJatuhTempo(ig, igId, pengaturan, jatuhTempo) {
  let kode = 0;
  let mediaTerbaru = null;
  let sudahTerbit = 0;

  for (const awal of jatuhTempo) {
    const semua = bacaSemua(); // status terbaru, termasuk yang baru saja tayang
    const p = semua.find((x) => x.id === awal.id);
    if (!p || p.status !== 'menunggu') continue;

    const telatJam = (Date.now() - new Date(p.waktu)) / 3600000;
    if (telatJam > pengaturan.batas_terlambat_jam) {
      p.status = 'gagal';
      p.galat = `Terlambat ${Math.round(telatJam)} jam dari jadwal, jadi tidak diterbitkan otomatis. Jadwalkan ulang kalau masih ingin tayang.`;
      simpanPost(p);
      commitDanPush(`⚠️ Terlambat: ${p.judul}`, [jalurPost(p.id)]);
      catat(`❌ ${p.judul}: ${p.galat}`);
      kode = 1;
      continue;
    }

    const halang = penghalangGrup(p, semua);
    if (halang) {
      catat(`⏸️ ${p.judul}: menunggu "${halang.judul}" (${halang.status}) tayang lebih dulu supaya urutan grid tetap benar.`);
      continue;
    }

    try {
      // Pengaman dobel: kalau run sebelumnya sempat menerbitkan tapi gagal mencatat, jangan posting lagi.
      mediaTerbaru ??= await ambilMediaTerbaru(ig, igId);
      const kembar = cariKembar(p, mediaTerbaru);
      if (kembar) {
        tandaiTerbit(p, kembar, 'Ditemukan sudah tayang di akun; tidak diposting ulang.');
        catat(`✅ ${p.judul}: sudah tayang sebelumnya (${kembar.permalink}).`);
        continue;
      }

      if (sudahTerbit > 0) await tidur(pengaturan.jeda_antar_postingan_detik * 1000);
      const wadah = await buatWadah(ig, igId, p, pengaturan);
      const terbit = await ig.post(`/${igId}/media_publish`, { creation_id: wadah });
      let info = { id: terbit.id };
      try {
        info = { ...info, ...(await ig.get(`/${terbit.id}`, { fields: 'permalink,timestamp' })) };
      } catch { /* permalink boleh menyusul */ }
      tandaiTerbit(p, info);
      mediaTerbaru = null;
      sudahTerbit++;
      catat(`✅ Tayang: ${p.judul} ${info.permalink || ''}`.trim());
    } catch (e) {
      const jenis = jenisGalat(e);
      const pesan = jelaskanGalat(e);
      if (jenis === 'token') throw new Error(pesan);
      if (jenis === 'batas') {
        catat(`⏳ ${p.judul}: ${pesan} Dicoba lagi pada jalan berikutnya.`);
        break;
      }
      p.percobaan = (p.percobaan || 0) + 1;
      p.galat = pesan;
      if (jenis === 'tetap' || p.percobaan >= pengaturan.maks_percobaan) {
        p.status = 'gagal';
        kode = 1;
        catat(`❌ Gagal: ${p.judul}: ${pesan}`);
      } else {
        catat(`⚠️ ${p.judul}: ${pesan} Dicoba lagi (percobaan ${p.percobaan}/${pengaturan.maks_percobaan}).`);
      }
      simpanPost(p);
      commitDanPush(`${p.status === 'gagal' ? '❌ Gagal' : '⚠️ Coba lagi'}: ${p.judul}`, [jalurPost(p.id)]);
    }
  }
  return kode;
}

// ---------- Instagram ----------

function urlGambar(id, berkas, pengaturan) {
  const sha = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']).stdout.trim();
  const pola = process.env.URL_GAMBAR || pengaturan.url_gambar;
  return pola.replace('{repo}', repoGitHub()).replace('{sha}', sha)
    .replace('{id}', encodeURIComponent(id)).replace('{berkas}', encodeURIComponent(berkas));
}

async function pastikanGambarAda(url) {
  let res;
  try {
    res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new GalatIG(`Gambar tidak bisa dibuka (${e.cause?.code || e.message}): ${url}`, { sementara: true });
  }
  if (!res.ok) throw new GalatIG(`Gambar belum ada di GitHub (HTTP ${res.status}): ${url}. Sudah di-push?`, { http: res.status >= 500 ? res.status : 0 });
}

async function buatWadah(ig, igId, p, pengaturan) {
  if (!p.slide?.length || p.slide.length > 10) throw new GalatIG(`Jumlah slide ${p.slide?.length || 0}; harus 1–10.`);
  const urls = p.slide.map((b) => urlGambar(p.id, b, pengaturan));
  for (const u of urls) await pastikanGambarAda(u);

  if (urls.length === 1) {
    const w = await ig.post(`/${igId}/media`, { image_url: urls[0], caption: p.caption || '' });
    await tungguSiap(ig, w.id);
    return w.id;
  }
  const anak = [];
  for (const u of urls) anak.push((await ig.post(`/${igId}/media`, { image_url: u, is_carousel_item: 'true' })).id);
  for (const id of anak) await tungguSiap(ig, id);
  const induk = await ig.post(`/${igId}/media`, { media_type: 'CAROUSEL', children: anak.join(','), caption: p.caption || '' });
  await tungguSiap(ig, induk.id);
  return induk.id;
}

async function tungguSiap(ig, idWadah, batasMs = 300000) {
  const mulai = Date.now();
  for (;;) {
    const s = await ig.get(`/${idWadah}`, { fields: 'status_code' });
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED' || !s.status_code) return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      let rinci = '';
      try { rinci = (await ig.get(`/${idWadah}`, { fields: 'status' })).status || ''; } catch { /* abaikan */ }
      const sub = Number((String(rinci).match(/22070\d\d/) || [])[0]) || undefined;
      throw new GalatIG(`Wadah media ${s.status_code}${rinci ? `: ${rinci}` : ''}`, { subkode: sub, sementara: s.status_code === 'EXPIRED' });
    }
    if (Date.now() - mulai > batasMs) throw new GalatIG('Wadah media tidak kunjung siap dalam 5 menit.', { sementara: true });
    await tidur(JEDA_CEK_MS);
  }
}

async function ambilMediaTerbaru(ig, igId) {
  const r = await ig.get(`/${igId}/media`, { fields: 'id,caption,timestamp,permalink', limit: '25' });
  return r.data || [];
}

const rapikan = (s) => String(s || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

function cariKembar(p, media) {
  if (!rapikan(p.caption)) return null;
  const sejak = new Date(p.dibuat).getTime() - 60000;
  return media.find((m) => rapikan(m.caption) === rapikan(p.caption) && new Date(m.timestamp).getTime() >= sejak) || null;
}

function tandaiTerbit(p, info, catatan) {
  p.status = 'terbit';
  p.media_id = String(info.id);
  p.permalink = info.permalink || null;
  p.terbit_pada = info.timestamp ? isoZona(new Date(info.timestamp)) : isoZona(new Date());
  p.galat = null;
  if (catatan) p.catatan = catatan;
  simpanPost(p);
  commitDanPush(`✅ Tayang: ${p.judul}`, [jalurPost(p.id)]);
}
