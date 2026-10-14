// Alat antrean di PC: menyiapkan, menguji, menyetujui, mengubah, dan membatalkan jadwal.
// Penerbitan sendiri dilakukan GitHub Actions (terbitkan.mjs).
//
// Tanpa --waktu/--mulai, waktu dihitung otomatis: jarak_jadwal_jam (baku 6 jam) setelah postingan
// terakhir di antrean, dan slot yang jatuh di jam tenang (22.00–07.00) digeser ke 07.00.
//
//   node alat/jadwal.mjs semua ["<folder Konten Instagram Kurir ATK>"] [--mulai ".."] [--bingkai45]
//        antrekan SEMUA konten yang belum masuk antrean, urut dari yang dibuat lebih dulu
//   node alat/jadwal.mjs seri "<folder grid-final>" [--mulai "2026-10-20 07:00"] [--jeda-jam 6 | --jeda 15] [--grup nama] [--bingkai45]
//   node alat/jadwal.mjs tambah "<folder Unggah N>" [--waktu "2026-10-20 19:00"] [--judul ..] [--grup ..] [--urutan N] [--bingkai45]
//   node alat/jadwal.mjs daftar [--semua] [--json]
//   node alat/jadwal.mjs uji <id..> | --grup nama | --draf          buat wadah di Instagram tanpa menerbitkan
//   node alat/jadwal.mjs setujui <id..> | --grup nama | --draf [--tanpa-uji]   draf → menunggu (lalu tayang otomatis)
//   node alat/jadwal.mjs ubah <id> [--waktu ..] [--caption berkas.txt]
//   node alat/jadwal.mjs geser --grup nama [--mulai ".."] [--jeda-jam 6 | --jeda 15]
//   node alat/jadwal.mjs batal <id..> | --grup nama | --draf
//   node alat/jadwal.mjs status | cek
import fs from 'node:fs';
import path from 'node:path';
import {
  DIR_ANTRIAN, bacaSemua, simpanPost, jalurPost, penghalangGrup, bacaPengaturan, parseWaktu,
  geserMenit, isoZona, formatWIB, slug, periksaCaption, jalankan, git, tarikTerbaru, commitDanPush, repoGitHub,
  slotBerikut, slotSetelah, keluarJamTenang, peringatanJadwal,
} from './umum.mjs';
import { bacaBerkasToken } from './rahasia.mjs';

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const LAMBANG = { draf: '📝', menunggu: '⏰', terbit: '✅', gagal: '❌', batal: '🚫' };

const [perintah, ...sisa] = process.argv.slice(2);
const { pos, opsi } = bacaArgumen(sisa);

try {
  const fungsi = {
    semua: semuaKonten, seri, tambah: (a, o) => tambah(a[0], o), daftar, uji, setujui, ubah, geser, batal, status, cek,
  }[perintah];
  if (!fungsi) {
    const kepala = [];
    for (const b of fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n')) {
      if (!b.startsWith('//')) break;
      kepala.push(b);
    }
    console.log(kepala.join('\n'));
    process.exit(perintah ? 1 : 0);
  }
  await fungsi(pos, opsi);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}

function bacaArgumen(args) {
  const pos = [];
  const opsi = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) opsi[k] = args[++i];
      else opsi[k] = true;
    } else pos.push(a);
  }
  return { pos, opsi };
}

// ---------- Menyiapkan draf ----------

function cariFfmpeg() {
  const kotak = process.env.KURIR_MEDIA || 'C:/Users/HEGARMANAH/gt/kurir-media';
  for (const k of [process.env.FFMPEG, path.join(kotak, 'node_modules/ffmpeg-static/ffmpeg.exe'),
    path.join(kotak, 'node_modules/ffmpeg-static/ffmpeg')]) {
    if (k && fs.existsSync(k)) return k;
  }
  return 'ffmpeg';
}

function ukuranGambar(berkas) {
  const b = fs.readFileSync(berkas);
  if (b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), jenis: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), jenis: 'jpg' };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error(`${berkas}: bukan PNG/JPEG yang dikenali.`);
}

function warnaTepi(ff, masuk) {
  const r = jalankan(ff, ['-v', 'error', '-i', masuk, '-vf', 'crop=1:1:0:ih/2,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', bolehGagal: true });
  const px = r.stdout;
  if (r.status !== 0 || !px || px.length < 3) return 'F7FAFF';
  return [...px.subarray(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Ubah slide ke JPEG (satu-satunya format yang diterima API). Latar transparan diratakan ke putih.
// --bingkai45: gambar 3:4 dikecilkan ke tengah kanvas 4:5 dengan pinggiran warna tepinya.
// Grid profil memotong postingan 4:5 menjadi 3:4 di tengah, jadi tampilan grid tetap sama.
function keJpeg(ff, masuk, keluar, { w, h }, bingkai45) {
  let W = w;
  let H = h;
  let saring = '[1][0]overlay=format=auto,format=yuvj420p';
  let latar = 'FFFFFF';
  if (bingkai45) {
    H = Math.round((w * 5) / 4);
    const sw = Math.round((H * w) / h);
    latar = warnaTepi(ff, masuk);
    saring = `[0]scale=${sw}:${H}:flags=lanczos[s];[1][s]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuvj420p`;
  }
  jalankan(ff, ['-y', '-v', 'error', '-i', masuk, '-f', 'lavfi', '-i', `color=c=0x${latar}:s=${W}x${H}`,
    '-filter_complex', saring, '-frames:v', '1', '-q:v', '2', keluar]);
  return { W, H };
}

function idUnik(dasar) {
  let id = dasar;
  for (let n = 2; fs.existsSync(path.join(DIR_ANTRIAN, id)); n++) id = `${dasar}-${n}`;
  return id;
}

function tambah(folder, o) {
  if (!folder) throw new Error('Sebutkan folder postingan (berisi 1.png, 2.png, ... dan caption.txt).');
  const pengaturan = bacaPengaturan();
  const sumber = path.resolve(folder);
  if (!fs.existsSync(sumber)) throw new Error(`Folder tidak ditemukan: ${sumber}`);

  const slide = fs.readdirSync(sumber).filter((f) => /^\d+\.(png|jpe?g)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  if (!slide.length) throw new Error(`Tidak ada slide bernama 1.png, 2.png, ... di ${sumber}`);
  if (slide.length > 10) throw new Error(`${slide.length} slide; API Instagram hanya menerima maks. 10 per carousel.`);

  const berkasCaption = path.join(sumber, 'caption.txt');
  const caption = fs.existsSync(berkasCaption) ? fs.readFileSync(berkasCaption, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() : '';
  const c = periksaCaption(caption);
  if (c.masalah.length) throw new Error(`Caption ${sumber}: ${c.masalah.join('; ')}.`);

  const ukuran = slide.map((f) => ({ f, ...ukuranGambar(path.join(sumber, f)) }));
  const r0 = ukuran[0].w / ukuran[0].h;
  for (const u of ukuran) {
    if (Math.abs(u.w / u.h - r0) > 0.01) throw new Error(`Slide ${u.f} (${u.w}×${u.h}) beda rasio dengan slide 1 (${ukuran[0].w}×${ukuran[0].h}). Instagram memotong semua slide mengikuti slide 1.`);
    if (u.w < 320) throw new Error(`Slide ${u.f} terlalu kecil (${u.w} px; min. 320 px).`);
  }
  if (r0 < 0.745 || r0 > 1.91) throw new Error(`Rasio ${ukuran[0].w}×${ukuran[0].h} di luar batas Instagram (3:4 sampai 1,91:1).`);
  const bingkai45 = Boolean(o.bingkai45) && r0 < 0.8;

  const semua = bacaSemua();
  const ganda = semua.find((p) => samaJalur(p.sumber, sumber) && p.status !== 'batal');
  if (ganda && !o.paksa) throw new Error(`Folder ini sudah ada di antrean sebagai "${ganda.id}" (${ganda.status}). Pakai --paksa kalau memang mau dua kali.`);

  const waktu = o.waktuIso || (o.waktu ? parseWaktu(o.waktu, pengaturan.zona_waktu) : slotBerikut(semua, pengaturan));
  const judul = String(o.judul || path.basename(sumber));
  const urutan = o.urutan ? Number(o.urutan) : 0;
  const dasar = o.grup ? `${slug(o.grup)}-${String(urutan).padStart(2, '0')}-${slug(judul)}` : `${waktu.slice(0, 10).replace(/-/g, '')}-${slug(judul)}`;
  const id = idUnik(dasar);
  const dir = path.join(DIR_ANTRIAN, id);
  fs.mkdirSync(dir, { recursive: true });

  const ff = cariFfmpeg();
  const keluar = [];
  let ukuranAkhir;
  try {
    ukuran.forEach((u, i) => {
      const nama = `${i + 1}.jpg`;
      ukuranAkhir = keJpeg(ff, path.join(sumber, u.f), path.join(dir, nama), u, bingkai45);
      const besar = fs.statSync(path.join(dir, nama)).size;
      if (besar > 8 * 1024 * 1024) throw new Error(`${nama} ${Math.round(besar / 1048576)} MB; maks. 8 MB.`);
      keluar.push(nama);
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }

  const post = {
    id, judul, waktu, grup: o.grup ? String(o.grup) : null, urutan, caption, slide: keluar,
    ukuran: `${ukuranAkhir.W}x${ukuranAkhir.H}`, bingkai45, sumber,
    status: 'draf', dibuat: isoZona(new Date(), pengaturan.zona_waktu), percobaan: 0, galat: null,
    uji: null, media_id: null, permalink: null, terbit_pada: null,
  };
  simpanPost(post);
  console.log(`📝 Draf: ${judul} · ${keluar.length} slide ${post.ukuran} · ${formatWIB(waktu)} · caption ${c.panjang} karakter, ${c.tagar} tagar  [${id}]`);
  if (!o.senyap) for (const p of peringatanJadwal(post, semua, pengaturan)) console.log(`   ⚠️ ${p}`);
  return post;
}

function samaJalur(a, b) {
  if (!a || !b) return false;
  const rapi = (s) => path.resolve(s).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? rapi(a).toLowerCase() === rapi(b).toLowerCase() : rapi(a) === rapi(b);
}

// Waktu postingan berikutnya dalam satu seri: dengan --jeda/--jeda-jam, tepat sejauh itu
// (digeser keluar jam tenang); tanpa itu, slot baku berikutnya (07.00/13.00/19.00).
function waktuBerikut(waktu, o, pengaturan) {
  const menit = o.jeda ? Number(o.jeda) : o['jeda-jam'] ? Number(o['jeda-jam']) * 60 : 0;
  if (!menit) return slotSetelah(waktu, pengaturan);
  return keluarJamTenang(geserMenit(waktu, menit, pengaturan.zona_waktu), pengaturan);
}

function judulDariFolder(nama) {
  return (nama.match(/\(([^)]+)\)\s*$/) || nama.match(/-\s*(.+)$/) || [, nama])[1].trim();
}

function anakUnggah(dirInduk) {
  return fs.readdirSync(dirInduk, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^unggah\s*\d+/i.test(d.name))
    .map((d) => ({ nama: d.name, n: Number(d.name.match(/\d+/)[0]) }))
    .sort((a, b) => a.n - b.n);
}

function seri([induk], o) {
  if (!induk) throw new Error('Pakai: seri "<folder>" [--mulai "YYYY-MM-DD HH:MM"] [--jeda-jam 6 | --jeda 15] [--grup nama]');
  const pengaturan = bacaPengaturan();
  const dirInduk = path.resolve(induk);
  const anak = anakUnggah(dirInduk);
  if (!anak.length) throw new Error(`Tidak ada subfolder "Unggah N ..." di ${dirInduk}`);
  const grup = String(o.grup || path.basename(dirInduk));
  let waktu = o.mulai ? parseWaktu(o.mulai, pengaturan.zona_waktu) : slotBerikut(bacaSemua(), pengaturan);
  anak.forEach((a, i) => {
    if (i > 0) waktu = waktuBerikut(waktu, o, pengaturan);
    tambah(path.join(dirInduk, a.nama), {
      ...o, waktuIso: waktu, judul: judulDariFolder(a.nama), grup, urutan: a.n, senyap: Boolean(o.jeda || o['jeda-jam']),
    });
  });
  console.log(`\n${anak.length} draf dalam grup "${grup}". Belum ada yang dijadwalkan; jalankan "uji" lalu "setujui" setelah pemilik setuju.`);
}

// Antrekan semua konten yang sudah dibuat tapi belum masuk antrean, tersusun rapi:
// satuan (grid "Unggah N" atau postingan tunggal) diurutkan dari yang dibuat lebih dulu,
// grid tetap urut Unggah 1 → N, lalu tiap postingan mendapat slot jarak_jadwal_jam berikutnya.
function semuaKonten([akar], o) {
  const pengaturan = bacaPengaturan();
  const dirAkar = path.resolve(akar || 'D:/PT SABIHA-Ammar/Website/Konten Instagram Kurir ATK');
  if (!fs.existsSync(dirAkar)) throw new Error(`Folder konten tidak ditemukan: ${dirAkar}`);
  const sudah = bacaSemua().filter((p) => p.status !== 'batal').map((p) => p.sumber);
  const belum = (dir) => !sudah.some((s) => samaJalur(s, dir));
  const adalahPost = (dir) => {
    const isi = fs.readdirSync(dir);
    return isi.includes('caption.txt') && isi.some((f) => /^1\.(png|jpe?g)$/i.test(f));
  };

  const satuan = [];
  (function telusur(dir, dalam) {
    const anak = anakUnggah(dir).filter((a) => adalahPost(path.join(dir, a.nama)));
    if (anak.length) {
      satuan.push({ jenis: 'grid', dir, grup: path.basename(dir), anak, lahir: fs.statSync(dir).birthtimeMs });
      return;
    }
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || /^[._]/.test(d.name)) continue;
      const p = path.join(dir, d.name);
      if (adalahPost(p)) satuan.push({ jenis: 'tunggal', dir: p, lahir: fs.statSync(p).birthtimeMs });
      else if (dalam < 3) telusur(p, dalam + 1);
    }
  })(dirAkar, 1);
  satuan.sort((a, b) => a.lahir - b.lahir);

  let jumlah = 0;
  let pertama = Boolean(o.mulai);
  const tambahBerikut = (folder, ekstra) => {
    const waktuIso = pertama ? parseWaktu(o.mulai, pengaturan.zona_waktu) : undefined;
    pertama = false;
    tambah(folder, { ...o, ...ekstra, waktuIso });
    jumlah++;
  };
  for (const s of satuan) {
    if (s.jenis === 'grid') {
      for (const a of s.anak) {
        const folder = path.join(s.dir, a.nama);
        if (belum(folder)) tambahBerikut(folder, { judul: judulDariFolder(a.nama), grup: s.grup, urutan: a.n });
      }
    } else if (belum(s.dir)) {
      tambahBerikut(s.dir, { judul: path.basename(s.dir) });
    }
  }
  if (!jumlah) return console.log(`Semua konten di ${dirAkar} sudah ada di antrean.`);
  const draf = bacaSemua().filter((p) => p.status === 'draf');
  console.log(`\n${jumlah} draf baru, tayang ${formatWIB(draf[0].waktu)} sampai ${formatWIB(draf.at(-1).waktu)}.`);
  console.log('Belum ada yang dijadwalkan; jalankan "uji --draf" lalu "setujui --draf" setelah pemilik setuju.');
}

// ---------- Melihat ----------

function pilih(pos, o, semua) {
  if (o.draf) {
    const hasil = semua.filter((p) => p.status === 'draf');
    if (!hasil.length) throw new Error('Tidak ada draf di antrean.');
    return hasil;
  }
  if (o.grup) {
    const hasil = semua.filter((p) => p.grup === o.grup);
    if (!hasil.length) throw new Error(`Grup "${o.grup}" tidak ada.`);
    return hasil;
  }
  if (!pos.length) throw new Error('Sebutkan id postingan atau --grup nama.');
  return pos.map((id) => semua.find((p) => p.id === id) || (() => { throw new Error(`Postingan "${id}" tidak ada.`); })());
}

function baris(p, i) {
  const ket = p.status === 'terbit' ? (p.permalink || `media ${p.media_id}`)
    : p.galat ? `galat: ${p.galat}`
      : p.uji ? `uji ${p.uji.hasil}${p.uji.hasil === 'gagal' ? `: ${p.uji.pesan}` : ''}` : '';
  const kapan = p.status === 'terbit' ? formatWIB(p.terbit_pada) : formatWIB(p.waktu);
  return `${String(i + 1).padStart(2)}. ${LAMBANG[p.status] || '?'} ${p.status.padEnd(8)} ${kapan.padEnd(28)} ${p.judul} (${p.slide.length} slide)${ket ? `\n      ${ket}` : ''}\n      id: ${p.id}`;
}

function daftar(pos, o) {
  try { tarikTerbaru(); } catch (e) { console.log(`⚠️ ${e.message}\n(menampilkan salinan lokal)`); }
  const semua = bacaSemua().filter((p) => o.semua || p.status !== 'batal');
  if (o.json) return console.log(JSON.stringify(semua.map(({ caption, ...p }) => ({ ...p, caption_awal: caption.split('\n')[0] })), null, 2));
  if (!semua.length) return console.log('Antrean kosong.');
  console.log(semua.map(baris).join('\n'));
}

// ---------- GitHub Actions ----------

async function jalankanPenerbit(mode, post) {
  const repo = repoGitHub();
  if (!repo) throw new Error('Repo GitHub belum tersambung (git remote origin).');
  const sejak = Date.now() - 5000;
  const args = ['workflow', 'run', 'terbitkan.yml', '-R', repo, '-f', `mode=${mode}`];
  if (post) args.push('-f', `post=${post}`);
  jalankan('gh', args);
  process.stdout.write(`Menjalankan penerbit (${mode}) di GitHub`);
  let run;
  for (let i = 0; i < 30 && !run; i++) {
    await tidur(4000);
    const daftarRun = JSON.parse(jalankan('gh', ['run', 'list', '-R', repo, '--workflow', 'terbitkan.yml', '--event', 'workflow_dispatch',
      '-L', '5', '--json', 'databaseId,createdAt']).stdout);
    run = daftarRun.find((r) => new Date(r.createdAt).getTime() >= sejak);
  }
  if (!run) throw new Error('Run GitHub Actions tidak muncul. Cek tab Actions di repo.');
  let info;
  for (let i = 0; i < 90; i++) {
    info = JSON.parse(jalankan('gh', ['run', 'view', String(run.databaseId), '-R', repo, '--json', 'status,conclusion,url']).stdout);
    if (info.status === 'completed') break;
    process.stdout.write('.');
    await tidur(8000);
  }
  console.log(` ${info.conclusion || info.status}`);
  const log = jalankan('gh', ['run', 'view', String(run.databaseId), '-R', repo, '--log'], { bolehGagal: true }).stdout || '';
  const pesan = log.split('\n').filter((b) => b.split('\t')[1] === 'Penerbit')
    .map((b) => b.split('\t').slice(2).join('\t').replace(/^\S+Z\s?/, ''))
    .filter((b) => b && !/^(##\[|Run |\s*node |\s*env:|\s*(MODE|POST|KUNCI_TOKEN|GIT_\w+):)/.test(b));
  if (pesan.length) console.log(pesan.map((b) => `  ${b}`).join('\n'));
  console.log(`  ${info.url}`);
  tarikTerbaru();
  return info;
}

async function uji(pos, o) {
  tarikTerbaru();
  const target = pilih(pos, o, bacaSemua());
  commitDanPush(`🧪 Kirim untuk uji: ${target.map((p) => p.judul).join(', ')}`, target.map((p) => jalurPost(p.id)));
  await jalankanPenerbit('uji', target.map((p) => p.id).join(','));
  const kini = bacaSemua();
  for (const p of target) {
    const q = kini.find((x) => x.id === p.id);
    console.log(`${q.uji?.hasil === 'lolos' ? '✅' : '❌'} ${q.judul}: ${q.uji ? q.uji.pesan : 'belum ada hasil uji'}`);
  }
}

// ---------- Mengubah antrean ----------

function setujui(pos, o) {
  tarikTerbaru();
  const semua = bacaSemua();
  const target = pilih(pos, o, semua);
  const sekarang = Date.now();
  for (const p of target) {
    if (p.status !== 'draf') throw new Error(`"${p.judul}" berstatus ${p.status}; hanya draf yang bisa disetujui.`);
    if (p.bingkai45 === false && p.ukuran && (() => { const [w, h] = p.ukuran.split('x').map(Number); return w / h < 0.8; })()
      && p.uji?.hasil !== 'lolos' && !o['tanpa-uji']) {
      throw new Error(`"${p.judul}" berasio 3:4 dan belum lolos uji. Jalankan "uji" dulu (atau --tanpa-uji kalau sudah yakin).`);
    }
    if (p.uji?.hasil === 'gagal') throw new Error(`"${p.judul}" gagal uji: ${p.uji.pesan}`);
  }
  for (const p of target) {
    p.status = 'menunggu';
    p.percobaan = 0;
    p.galat = null;
  }
  for (const p of target) {
    const halang = penghalangGrup(p, semua.map((x) => target.find((t) => t.id === x.id) || x));
    if (halang && halang.status !== 'menunggu') throw new Error(`"${p.judul}" harus tayang setelah "${halang.judul}" yang masih ${halang.status}. Setujui juga yang itu.`);
  }
  target.forEach(simpanPost);
  commitDanPush(`⏰ Dijadwalkan: ${target.map((p) => p.judul).join(', ')}`, target.map((p) => jalurPost(p.id)));
  const pengaturan = bacaPengaturan();
  const kini = bacaSemua();
  for (const p of target) {
    const lewat = new Date(p.waktu) < sekarang;
    console.log(`⏰ ${p.judul}: ${formatWIB(p.waktu)}${lewat ? ' (waktunya sudah lewat, tayang pada putaran penerbit berikutnya ≤ 15 menit)' : ''}`);
    for (const w of peringatanJadwal(p, kini, pengaturan)) console.log(`   ⚠️ ${w}`);
  }
  console.log('Penerbit di GitHub memeriksa antrean tiap 15 menit; GitHub kadang terlambat beberapa menit.');
}

function bisaDiubah(p) {
  if (['terbit', 'batal'].includes(p.status)) throw new Error(`"${p.judul}" sudah ${p.status}; tidak bisa diubah.`);
}

function ubah([id], o) {
  tarikTerbaru();
  const pengaturan = bacaPengaturan();
  const semua = bacaSemua();
  const [p] = pilih([id], {}, semua);
  bisaDiubah(p);
  if (o.waktu) p.waktu = parseWaktu(o.waktu, pengaturan.zona_waktu);
  if (o.caption) {
    const caption = fs.readFileSync(path.resolve(o.caption), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    const c = periksaCaption(caption);
    if (c.masalah.length) throw new Error(`Caption: ${c.masalah.join('; ')}.`);
    p.caption = caption;
  }
  if (o.judul) p.judul = String(o.judul);
  if (p.status === 'gagal') { p.status = 'menunggu'; p.percobaan = 0; p.galat = null; }
  simpanPost(p);
  if (p.status !== 'draf') commitDanPush(`✏️ Diubah: ${p.judul}`, [jalurPost(p.id)]);
  console.log(`✏️ ${p.judul}: ${p.status}, ${formatWIB(p.waktu)}`);
  for (const w of peringatanJadwal(p, semua, pengaturan)) console.log(`   ⚠️ ${w}`);
}

function geser(pos, o) {
  if (!o.grup) throw new Error('Pakai: geser --grup nama [--mulai "YYYY-MM-DD HH:MM"] [--jeda-jam 6 | --jeda 15]');
  tarikTerbaru();
  const pengaturan = bacaPengaturan();
  const semua = bacaSemua();
  const target = semua.filter((p) => p.grup === o.grup && !['terbit', 'batal'].includes(p.status));
  if (!target.length) throw new Error(`Tidak ada postingan grup "${o.grup}" yang bisa digeser.`);
  let waktu = o.mulai ? parseWaktu(o.mulai, pengaturan.zona_waktu) : slotBerikut(semua.filter((p) => !target.includes(p)), pengaturan);
  target.forEach((p, i) => {
    if (i > 0) waktu = waktuBerikut(waktu, o, pengaturan);
    p.waktu = waktu;
    if (p.status === 'gagal') { p.status = 'menunggu'; p.percobaan = 0; p.galat = null; }
    simpanPost(p);
    console.log(`↪️ ${p.judul}: ${formatWIB(p.waktu)} (${p.status})`);
  });
  const terkirim = target.filter((p) => p.status !== 'draf');
  if (terkirim.length) commitDanPush(`↪️ Digeser: grup ${o.grup}`, terkirim.map((p) => jalurPost(p.id)));
}

function batal(pos, o) {
  tarikTerbaru();
  const target = pilih(pos, o, bacaSemua()).filter((p) => p.status !== 'batal');
  const dilacak = new Set(git(['ls-files', '--', 'antrian']).stdout.split('\n').map((f) => f.split('/')[1]).filter(Boolean));
  const ubahan = [];
  for (const p of target) {
    if (p.status === 'terbit') {
      console.log(`⚠️ "${p.judul}" sudah tayang (${p.permalink}). API tidak bisa menghapus postingan; hapus dari aplikasi Instagram.`);
      continue;
    }
    if (!dilacak.has(p.id)) {
      fs.rmSync(path.join(DIR_ANTRIAN, p.id), { recursive: true, force: true });
      console.log(`🗑️ Draf lokal dihapus: ${p.judul}`);
      continue;
    }
    p.status = 'batal';
    simpanPost(p);
    ubahan.push(p);
    console.log(`🚫 Dibatalkan: ${p.judul}`);
  }
  if (ubahan.length) commitDanPush(`🚫 Dibatalkan: ${ubahan.map((p) => p.judul).join(', ')}`, ubahan.map((p) => jalurPost(p.id)));
}

function status() {
  try { tarikTerbaru(); } catch (e) { console.log(`⚠️ ${e.message}`); }
  const p = bacaPengaturan();
  const t = bacaBerkasToken();
  console.log(`Akun: ${p.akun ? `@${p.akun}` : '(belum dipasang)'}`);
  console.log(t ? `Token: berlaku sampai ${formatWIB(t.kedaluwarsa)}${t.kedaluwarsa_perkiraan ? ' (perkiraan)' : ''}, terakhir diperbarui ${formatWIB(t.diperbarui)}`
    : 'Token: belum dipasang (jalankan "Pasang Token Instagram.bat")');
  const semua = bacaSemua();
  const hitung = {};
  for (const x of semua) hitung[x.status] = (hitung[x.status] || 0) + 1;
  console.log(`Antrean: ${Object.entries(hitung).map(([s, n]) => `${n} ${s}`).join(', ') || 'kosong'}`);
  const berikut = semua.find((x) => x.status === 'menunggu');
  if (berikut) console.log(`Berikutnya: ${berikut.judul}, ${formatWIB(berikut.waktu)}`);
  const repo = repoGitHub();
  if (!repo) return;
  const r = jalankan('gh', ['run', 'list', '-R', repo, '--workflow', 'terbitkan.yml', '-L', '6', '--json', 'conclusion,status,createdAt,event,url'], { bolehGagal: true });
  if (r.status === 0) {
    console.log('Jalan penerbit terakhir:');
    for (const x of JSON.parse(r.stdout)) console.log(`  ${x.conclusion === 'success' ? '✅' : x.conclusion === 'failure' ? '❌' : '…'} ${formatWIB(x.createdAt)} ${x.event}${x.conclusion === 'failure' ? `  ${x.url}` : ''}`);
  }
}

async function cek() {
  await jalankanPenerbit('cek');
}

