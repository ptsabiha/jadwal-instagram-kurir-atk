// Klien kecil Instagram API (Instagram Login, host graph.instagram.com). Tanpa dependensi.
// IG_API_BASE bisa diganti untuk pengujian dengan server tiruan.

export class GalatIG extends Error {
  constructor(pesan, info = {}) {
    super(pesan);
    Object.assign(this, info);
  }
}

export function buatKlien(token) {
  const basis = (process.env.IG_API_BASE || 'https://graph.instagram.com').replace(/\/$/, '');
  const sembunyikan = (s) => String(s ?? '').split(token).join('***');

  async function panggil(metode, jalur, param = {}) {
    const url = new URL(basis + jalur);
    const isi = new URLSearchParams({ ...param, access_token: token });
    let res;
    try {
      if (metode === 'GET') {
        for (const [k, v] of isi) url.searchParams.set(k, v);
        res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      } else {
        res = await fetch(url, { method: metode, body: isi, signal: AbortSignal.timeout(120000) });
      }
    } catch (e) {
      throw new GalatIG(`Jaringan ke Instagram gagal (${sembunyikan(e.cause?.code || e.message)})`, { sementara: true });
    }
    const teks = await res.text();
    let json;
    try { json = JSON.parse(teks); } catch { json = { error: { message: teks.slice(0, 300) } }; }
    if (!res.ok || json.error) {
      const e = json.error || {};
      throw new GalatIG(sembunyikan(e.error_user_msg || e.message || `HTTP ${res.status}`), {
        kode: e.code, subkode: e.error_subcode, http: res.status, judul: sembunyikan(e.error_user_title || ''),
      });
    }
    return json;
  }

  return {
    get: (jalur, param) => panggil('GET', jalur, param),
    post: (jalur, param) => panggil('POST', jalur, param),
    sembunyikan,
  };
}

// Kode galat publikasi yang diketahui (subkode 2207xxx). Yang "sementara" dicoba lagi otomatis.
const SUBKODE = {
  2207001: ['Server Instagram sedang bermasalah.', true],
  2207003: ['Instagram terlalu lama mengambil gambar.', true],
  2207004: ['Gambar terlalu besar (maks. 8 MB).', false],
  2207005: ['Format gambar tidak didukung (harus JPEG).', false],
  2207009: ['Rasio gambar ditolak Instagram. Tambahkan ulang dengan --bingkai45.', false],
  2207020: ['Wadah media kedaluwarsa sebelum diterbitkan.', true],
  2207032: ['Instagram gagal membuat media.', true],
  2207042: ['Batas jumlah postingan API 24 jam sudah tercapai.', true],
  2207069: ['Batas pembuatan media Instagram (24 jam bergulir) sudah tercapai, biasanya karena terlalu banyak slide diuji sekaligus. Pulih sendiri saat jendela 24 jam bergeser.', true],
  2207050: ['Akun Instagram sedang dibatasi atau tidak aktif. Buka aplikasi Instagram dan cek pemberitahuan.', false],
  2207052: ['Instagram tidak bisa mengambil gambar dari GitHub.', false],
  2207053: ['Galat unggah tidak dikenal dari Instagram.', true],
};

// Kelompokkan galat: 'token' (hentikan semua), 'batas' (berhenti dulu, coba lagi nanti),
// 'sementara' (coba lagi), atau 'tetap' (perlu tindakan manusia).
export function jenisGalat(e) {
  if (e.kode === 190) return 'token';
  if ([2207042, 2207069].includes(e.subkode) || [4, 17, 32, 613].includes(e.kode)) return 'batas';
  if (e.sementara || e.http >= 500 || [1, 2].includes(e.kode)) return 'sementara';
  if (SUBKODE[e.subkode]) return SUBKODE[e.subkode][1] ? 'sementara' : 'tetap';
  return 'tetap';
}

export function jelaskanGalat(e) {
  const dikenal = SUBKODE[e.subkode]?.[0];
  if (e.kode === 190) return 'Token Instagram tidak berlaku lagi. Jalankan "Pasang Token Instagram.bat" dengan token baru.';
  if (e.kode === 10 || e.kode === 200) return `Izin token kurang (${e.message}). Buat token baru dengan izin instagram_business_content_publish.`;
  if (/aspect ratio/i.test(e.message || '') && !dikenal) return `${SUBKODE[2207009][0]} (${e.message})`;
  const kode = [e.kode, e.subkode].filter(Boolean).join('/');
  return dikenal ? `${dikenal} (${e.message}${kode ? `, kode ${kode}` : ''})` : `${e.message}${kode ? ` (kode ${kode})` : ''}`;
}
