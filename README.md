# Jadwal Instagram Kurir ATK

Penjadwal postingan Instagram Kurir ATK by SABIHA (Divisi SABIHA Pengadaan).
Setiap 15 menit, GitHub Actions memeriksa folder `antrian/` dan menerbitkan postingan
yang waktunya sudah tiba lewat Instagram API resmi.

Repo ini dikelola Claude lewat skill `kurir-atk-instagram-scheduler`. Jangan mengubah berkasnya
dengan tangan. Minta Claude untuk menambah, mengubah, atau membatalkan jadwal.

## Untuk pemilik

| Berkas | Fungsi |
|---|---|
| `Lihat Jadwal Instagram.bat` | Melihat antrean dan hasil penerbitan terakhir |
| `Pasang Token Instagram.bat` | Memasang token Instagram baru (pertama kali, atau kalau token mati) |

Kalau ada postingan yang gagal terbit, GitHub mengirim email ke akun GitHub pemilik repo.

## Isi repo

| Jalur | Isi |
|---|---|
| `antrian/<id>/post.json` | Jadwal, caption, dan status satu postingan (draf, menunggu, terbit, gagal, batal) |
| `antrian/<id>/1.jpg ...` | Slide carousel. Repo ini publik supaya Instagram bisa mengambil gambarnya. |
| `rahasia/token-ig.json` | Token Instagram **terenkripsi**. Hanya penerbit di GitHub yang bisa membukanya (`KUNCI_PRIVAT` di GitHub Secrets). |
| `rahasia/kunci-publik.pem` | Gembok publik untuk mengunci token. Aman untuk publik, karena gembok ini hanya bisa mengunci, tidak bisa membuka. |
| `pengaturan.json` | Akun tujuan, zona waktu, dan batas keterlambatan |
| `alat/` | Skrip penerbit (`terbitkan.mjs`) dan alat antrean (`jadwal.mjs`) |
