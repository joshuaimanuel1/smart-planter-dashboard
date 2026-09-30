# Smart Indoor Planter Dashboard

Dashboard monitoring dan kontrol tanaman indoor berbasis **ESP32**. Data sensor dikirim ke backend, disimpan di **MySQL**, lalu ditampilkan realtime di dashboard web bergaya Apple (mode terang dan gelap).

| Lapisan   | Teknologi                                                                               |
| --------- | --------------------------------------------------------------------------------------- |
| Perangkat | ESP32 (PlatformIO, Arduino), DHT11, Soil Moisture, LDR, UV GUVA-S12SD, 2 relay, LCD I2C |
| Backend   | Node.js, Express, TypeScript, Zod, Prisma ORM                                           |
| Database  | MySQL 8 (dikelola lewat MySQL Workbench)                                                |
| Frontend  | Next.js 14 (App Router), Tailwind CSS, Recharts, Lucide                                 |

```
ESP32 ──HTTP POST──▶ Backend (Express :4000) ──Prisma──▶ MySQL
                          │  ▲
                SSE + REST│  │ POST /api/control
                          ▼  │
                    Dashboard (Next.js :3000)
```

## Daftar isi

1. [Kebutuhan](#1-kebutuhan)
2. [Struktur folder](#2-struktur-folder)
3. [Langkah 1: Buat database di MySQL Workbench](#3-langkah-1-buat-database-di-mysql-workbench)
4. [Langkah 2: Setup backend](#4-langkah-2-setup-backend)
5. [Langkah 3: Setup frontend](#5-langkah-3-setup-frontend)
6. [Langkah 4: Hubungkan ESP32](#6-langkah-4-hubungkan-esp32)
7. [Langkah 5: Uji seluruh sistem](#7-langkah-5-uji-seluruh-sistem)
8. [Variabel environment](#8-variabel-environment)
9. [Referensi API](#9-referensi-api)
10. [Menjalankan dengan Docker](#10-menjalankan-dengan-docker-opsional)
11. [Perintah yang sering dipakai](#11-perintah-yang-sering-dipakai)
12. [Troubleshooting](#12-troubleshooting)
13. [Catatan keamanan](#13-catatan-keamanan)

---

## 1. Kebutuhan

- **Node.js 20 LTS** (cek dengan `node -v`)
- **MySQL Server 8** dan **MySQL Workbench**
- **VS Code** dengan ekstensi **PlatformIO IDE** (untuk firmware ESP32)
- ESP32 (NodeMCU-32S) yang sudah dirakit sesuai tabel pinout di firmware

Laptop dan ESP32 harus berada di **jaringan Wi-Fi yang sama**.

## 2. Struktur folder

```
smart-planter-dashboard/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # definisi tabel
│   │   └── migrations/            # migrasi SQL
│   ├── src/server.ts              # API, SSE, MQTT, export CSV
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── app/                       # page.tsx, layout.tsx, globals.css
│   ├── lib/api.ts                 # helper pemanggil API
│   ├── .env.example
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## 3. Langkah 1: Buat database di MySQL Workbench

Database dibuat **lebih dulu**, sebelum menjalankan backend. Prisma hanya membuat tabel, bukan databasenya.

1. Buka **MySQL Workbench**.
2. Klik koneksi lokal Anda (biasanya **Local instance MySQL80**), lalu masukkan password root.
3. Buka tab query baru dengan `Ctrl + T`.
4. Tempel perintah berikut:

   ```sql
   CREATE DATABASE IF NOT EXISTS smart_indoor_planter
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;
   ```

5. Jalankan dengan ikon petir atau `Ctrl + Enter`.
6. Di panel **SCHEMAS** sebelah kiri, klik ikon refresh (dua panah melingkar). Database `smart_indoor_planter` akan muncul.

> Nama database harus sama persis dengan yang Anda tulis di `DATABASE_URL` pada langkah berikutnya. Kalau memilih nama lain (misalnya `smart_planter_db`), pakai nama itu di semua tempat.

**Opsional, untuk produksi:** buat user khusus supaya tidak memakai root.

```sql
CREATE USER 'planter'@'localhost' IDENTIFIED BY 'GantiPasswordIni';
GRANT ALL PRIVILEGES ON smart_indoor_planter.* TO 'planter'@'localhost';
FLUSH PRIVILEGES;
```

---

## 4. Langkah 2: Setup backend

Buka terminal (Command Prompt, PowerShell, atau terminal VS Code), lalu jalankan satu per satu.

### 4.1 Masuk ke folder backend

```bash
cd smart-planter-dashboard/backend
```

### 4.2 Buat file `.env`

Windows:

```bash
copy .env.example .env
```

macOS / Linux:

```bash
cp .env.example .env
```

### 4.3 Isi `DATABASE_URL`

Buka `backend/.env` di VS Code, ubah baris `DATABASE_URL`, lalu tekan `Ctrl + S`.

```env
DATABASE_URL="mysql://root:PASSWORD_ANDA@localhost:3306/smart_indoor_planter"
```

Format umum: `mysql://USER:PASSWORD@HOST:PORT/NAMA_DATABASE`.

> Kalau password mengandung karakter khusus, ubah menjadi kode URL: `@` menjadi `%40`, `#` menjadi `%23`, `/` menjadi `%2F`, `:` menjadi `%3A`. Password `Pa@ss#1` ditulis `Pa%40ss%231`.

### 4.4 Install dependensi

```bash
npm install
```

### 4.5 Generate Prisma Client

```bash
npx prisma generate
```

### 4.6 Buat tabel lewat migrasi

Pilih **salah satu**:

**Opsi A, disarankan** (memakai migrasi yang sudah ada di `prisma/migrations`):

```bash
npx prisma migrate deploy
```

**Opsi B, untuk pengembangan** (membuat migrasi baru jika `schema.prisma` Anda ubah):

```bash
npx prisma migrate dev --name init_smart_planter
```

> `migrate dev` butuh hak membuat database sementara (shadow database). User `root` sudah cukup. Kalau memakai user khusus, pakai Opsi A.

### 4.7 Cek tabel di MySQL Workbench

Kembali ke Workbench, refresh panel SCHEMAS, lalu buka **smart_indoor_planter → Tables**. Atau jalankan:

```sql
USE smart_indoor_planter;
SHOW TABLES;
```

Hasil yang benar berisi tiga tabel:

| Tabel                | Fungsi                                                         |
| -------------------- | -------------------------------------------------------------- |
| `TelemetryLog`       | Riwayat semua pembacaan sensor (sumber grafik dan dataset CSV) |
| `DeviceState`        | Mode dan status terakhir pompa dan lampu                       |
| `_prisma_migrations` | Catatan migrasi yang sudah dijalankan Prisma                   |

> Di Windows, MySQL bisa menampilkan nama tabel dalam huruf kecil (`telemetrylog`). Itu normal dan tidak mempengaruhi aplikasi.

### 4.8 Jalankan backend

```bash
npm run dev
```

Terminal harus menampilkan:

```
Backend ready on :4000
[MQTT] connected
```

Uji di browser: buka <http://localhost:4000/api/health>. Responsnya:

```json
{ "status": "ok", "mqtt": true, "deviceOnline": false }
```

`deviceOnline: false` wajar selama ESP32 belum mengirim data. **Biarkan terminal ini tetap berjalan**, lalu buka terminal baru untuk frontend.

---

## 5. Langkah 3: Setup frontend

Di terminal **baru**:

```bash
cd smart-planter-dashboard/frontend
copy .env.example .env.local
npm install
npm run dev
```

Isi `.env.local` sudah benar untuk penggunaan lokal:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Buka <http://localhost:3000>. Sebelum ESP32 menyala, dashboard menampilkan **Perangkat offline** dan grafik kosong. Itu normal.

> Setiap kali `.env.local`, `tailwind.config.js`, atau `tsconfig.json` diubah, hentikan server dengan `Ctrl + C`, hapus folder `.next`, lalu jalankan `npm run dev` lagi.

---

## 6. Langkah 4: Hubungkan ESP32

### 6.1 Cari IP laptop

```bash
ipconfig
```

Cari **IPv4 Address** pada adapter Wi-Fi yang aktif, misalnya `192.168.0.100`.

### 6.2 Atur Wi-Fi dan alamat server di `main.cpp`

```cpp
const char* ssid      = "NAMA_WIFI_ANDA";
const char* password  = "PASSWORD_WIFI_ANDA";
const char* serverUrl = "http://192.168.0.100:4000/api/telemetry";   // IP laptop + port 4000
```

Setiap kali laptop berpindah jaringan atau IP-nya berubah, alamat ini harus diperbarui.

### 6.3 Izinkan port 4000 di Windows Firewall

Kalau ESP32 tidak bisa mengirim data padahal Wi-Fi terhubung, biasanya firewall yang memblokir. Buka Command Prompt **sebagai Administrator**:

```bash
netsh advfirewall firewall add rule name="Smart Planter API" dir=in action=allow protocol=TCP localport=4000
```

### 6.4 Upload firmware

Di PlatformIO klik **Upload and Monitor**. Kalau muncul _Wrong boot mode detected_, tahan tombol **BOOT** di ESP32 saat terminal menampilkan `Connecting....`, lalu lepas setelah upload dimulai.

---

## 7. Langkah 5: Uji seluruh sistem

- [ ] Serial Monitor menampilkan `Telemetri terkirim! HTTP Response code: 200`
- [ ] Dashboard berubah menjadi **Perangkat online** dalam beberapa detik
- [ ] Kartu sensor dan grafik bergerak mengikuti pembacaan
- [ ] Tabel `TelemetryLog` terisi:

  ```sql
  SELECT * FROM smart_indoor_planter.TelemetryLog ORDER BY id DESC LIMIT 10;
  ```

- [ ] Tombol **Ekspor dataset** mengunduh file CSV

Kode `400` berarti backend menolak format data. Kode `-1` atau `connection refused` berarti alamat IP atau firewall bermasalah.

---

## 8. Variabel environment

### `backend/.env`

| Variabel                 | Default                         | Keterangan                                                                                     |
| ------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | (wajib)                         | URL koneksi MySQL                                                                              |
| `PORT`                   | `4000`                          | Port backend                                                                                   |
| `CORS_ORIGIN`            | `http://localhost:3000`         | Alamat dashboard yang diizinkan. Pisahkan dengan koma untuk beberapa alamat                    |
| `MQTT_BROKER`            | `mqtt://broker.hivemq.com:1883` | Broker MQTT (jalur perintah)                                                                   |
| `SAVE_INTERVAL_MS`       | `5000`                          | Jarak minimal antar penyimpanan ke database                                                    |
| `DEVICE_API_KEY`         | (kosong)                        | Jika diisi, `POST /api/telemetry` wajib membawa header `x-api-key`. Firmware harus ikut diubah |
| `RETENTION_DAYS`         | `0`                             | `0` menyimpan data selamanya. Isi angka untuk menghapus log lama otomatis                      |
| `PUMP_ON` / `PUMP_OFF`   | `30` / `70`                     | Ambang pompa yang ditampilkan dashboard                                                        |
| `LIGHT_ON` / `LIGHT_OFF` | `60` / `80`                     | Ambang lampu yang ditampilkan dashboard                                                        |

> `RETENTION_DAYS` dan ambang otomasi hanya berlaku jika `server.ts` Anda memakai versi yang membaca variabel tersebut. Kalau tidak, dashboard memakai nilai bawaan 30/70 dan 60/80 yang sudah sesuai firmware.
>
> Ambang yang **sebenarnya** menggerakkan relay ada di firmware (`BATAS_POMPA_ON`, `BATAS_POMPA_OFF`, `BATAS_LDR_ON`, `BATAS_LDR_OFF`). Jika Anda mengubahnya, samakan angka di dashboard.

### `frontend/.env.local`

| Variabel              | Default                 | Keterangan                            |
| --------------------- | ----------------------- | ------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Alamat backend yang dipanggil browser |

---

## 9. Referensi API

| Method | Endpoint                               | Fungsi                                                                                        |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                          | Cek status backend, database, MQTT, dan perangkat                                             |
| `POST` | `/api/telemetry`                       | Menerima data dari ESP32                                                                      |
| `GET`  | `/api/stream`                          | Siaran realtime (Server-Sent Events) ke dashboard                                             |
| `GET`  | `/api/dashboard?range=1h\|6h\|24h\|7d` | Data grafik, statistik, dan riwayat aktuator                                                  |
| `POST` | `/api/control`                         | Kirim perintah mode, pompa, atau lampu                                                        |
| `GET`  | `/api/export-csv?from=ISO&to=ISO`      | Unduh dataset CSV. `from` dan `to` opsional. Tambahkan `count=1` untuk hanya menghitung baris |

Contoh payload dari ESP32:

```json
{
  "deviceId": "esp32-planter-01",
  "temperature": 25.3,
  "humidity": 64,
  "soilMoisture": 54,
  "soilStatus": "LEMBAB",
  "ldrLight": 62,
  "uvIndex": 0.0,
  "pumpOn": true,
  "growlightOn": false
}
```

Backend juga menerima nama field snake_case (`soil_moisture`, dst.) dan menganggap mode `AUTO` jika field `mode` tidak dikirim.

---

## 10. Menjalankan dengan Docker (opsional)

Pasang **Docker Desktop**, lalu dari folder root proyek:

```bash
docker compose up --build
```

- Dashboard: <http://localhost:3000>
- API: <http://localhost:4000>

Docker menjalankan **MySQL sendiri di dalam container** (user `planter`, password `planter`, database `smart_indoor_planter`), terpisah dari MySQL di laptop Anda. Migrasi dijalankan otomatis saat backend start.

Agar MySQL container bisa dibuka di Workbench, tambahkan pemetaan port pada service `db` di `docker-compose.yml`:

```yaml
ports: ["3307:3306"]
```

Lalu sambungkan Workbench ke `127.0.0.1`, port `3307`, user `planter`. Jangan menjalankan Docker dan `npm run dev` bersamaan, karena port 3000 dan 4000 akan bentrok.

Menghentikan: `docker compose down`. Untuk ikut menghapus data database: `docker compose down -v`.

---

## 11. Perintah yang sering dipakai

```bash
# Backend (dari folder backend)
npm run dev                    # mode pengembangan, restart otomatis
npm run build && npm start     # build dan jalankan versi produksi
npx prisma studio              # lihat dan edit data lewat browser
npx prisma migrate deploy      # terapkan migrasi yang sudah ada
npx prisma migrate reset       # HAPUS semua data lalu buat ulang tabel

# Frontend (dari folder frontend)
npm run dev                    # mode pengembangan
npm run build && npm start     # versi produksi
```

---

## 12. Troubleshooting

| Gejala                                               | Penyebab dan solusi                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `P1000: Authentication failed`                       | Username atau password di `DATABASE_URL` salah. Pastikan karakter khusus sudah dikodekan (`@` jadi `%40`)      |
| `P1001: Can't reach database server`                 | MySQL belum berjalan atau port salah. Cek service MySQL80 di Windows dan port di `DATABASE_URL` (default 3306) |
| `P1003` atau `Unknown database`                      | Database belum dibuat. Ulangi [Langkah 1](#3-langkah-1-buat-database-di-mysql-workbench) dan cek ejaan nama    |
| `EPERM` saat `prisma generate` di Windows            | Server backend masih berjalan dan mengunci file. Hentikan dengan `Ctrl + C`, lalu jalankan ulang perintahnya   |
| `EADDRINUSE ... :4000`                               | Port 4000 dipakai proses lain (backend yang belum tertutup, atau Docker). Hentikan prosesnya atau ubah `PORT`  |
| ESP32 menerima respons `400`                         | Format data ditolak validasi. Lihat pesan error di terminal backend, detail field yang salah tertulis di sana  |
| ESP32 gagal mengirim (`-1`, `connection refused`)    | IP laptop di `serverUrl` salah, beda jaringan Wi-Fi, atau firewall memblokir port 4000 (lihat 6.3)             |
| Dashboard tetap **offline** padahal ESP32 mengirim   | Periksa `NEXT_PUBLIC_API_URL`, dan pastikan `CORS_ORIGIN` sama dengan alamat dashboard yang Anda buka          |
| Error CORS di console browser                        | Dashboard dibuka dari alamat selain `CORS_ORIGIN` (misalnya IP jaringan). Tambahkan alamat itu, dipisah koma   |
| Banner merah "Gagal memuat data"                     | Backend belum berjalan atau tidak terhubung ke database. Cek terminal backend dan `/api/health`                |
| Suhu dan kelembapan `0`                              | Sensor DHT11 tidak terbaca. Periksa kabel data di GPIO 4 dan catu dayanya                                      |
| `Wrong boot mode detected` saat upload               | Tahan tombol **BOOT** di ESP32 saat muncul `Connecting....`                                                    |
| File `.json` atau `.js` penuh garis merah di VS Code | Isi file tertukar. `tsconfig.json` hanya boleh berisi JSON, kode Tailwind ada di `tailwind.config.js`          |
| Tampilan aneh setelah edit konfigurasi               | Hentikan `npm run dev`, hapus folder `.next`, jalankan lagi                                                    |

---

## 13. Catatan keamanan

- Jangan meng-commit `.env`, `.env.local`, atau password Wi-Fi ke GitHub. `.gitignore` sudah mengecualikan file `.env`, tetapi password Wi-Fi di `main.cpp` perlu Anda jaga sendiri.
- Gunakan password MySQL yang kuat, dan untuk produksi pakai user khusus (bukan `root`).
- Dashboard ini belum memiliki login. Jangan membukanya langsung ke internet tanpa autentikasi dan HTTPS.
- `DEVICE_API_KEY` melindungi endpoint penerimaan data. Jika diaktifkan, tambahkan header berikut di firmware sebelum `http.POST(...)`:

  ```cpp
  http.addHeader("x-api-key", "ISI_DENGAN_KEY_ANDA");
  ```
