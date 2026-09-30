<!-- # Smart Planter Dashboard

## Backend

<!-- cd backend && cp .env.example .env && npm i && npx prisma migrate deploy && npm run dev

## Frontend

cd frontend && cp .env.example .env.local && npm i && npm run dev # http://localhost:3000
Catatan: buat database `smart_indoor_planter` di MySQL dulu. Firmware tidak perlu diubah (API_URL tetap /api/telemetry).

## Docker (1 perintah)

docker compose up --build # dashboard: http://localhost:3000, API: http://localhost:4000

## Ambang otomasi

Di `backend/.env`: PUMP_ON/PUMP_OFF (30/70) dan LIGHT_ON/LIGHT_OFF (60/80). Samakan dengan konstanta di firmware.
`RETENTION_DAYS=0` menyimpan data selamanya; isi angka untuk menghapus log lama otomatis.
 --> -->

````markdown
# Smart Indoor Planter Dashboard 🌱

Dashboard Full-Stack IoT untuk memonitor dan mengontrol sistem penyiraman serta pencahayaan tanaman cerdas (**Smart Indoor Planter**) berbasis ESP32 secara _real-time_.

---

## 🚀 Fitur Utama

- **Real-Time Telemetry**  
  Memantau kelembapan tanah, suhu ruangan, kelembapan udara, persentase cahaya LDR, dan Indeks UV.

- **Rule-Based Automation**  
  Aktuator otomatis berupa Pompa Air dan Grow Light dengan sistem _Hysteresis_ yang diproses langsung pada ESP32.

- **Manual Control**  
  _Override_ kontrol pompa dan lampu melalui antarmuka web menggunakan protokol MQTT.

- **Historical Data & Charts**  
  Visualisasi data historis sensor menggunakan Recharts.

- **Data Export**  
  Mengunduh dataset sensor dalam format CSV.

---

## 🛠️ Tech Stack

### IoT Hardware

- ESP32
- DHT11
- Soil Moisture Sensor
- LDR
- UV Sensor
- Relay
- C++ / PlatformIO

### Frontend

- Next.js
- React
- Tailwind CSS
- Recharts
- Lucide Icons

### Backend

- Node.js
- Express.js
- Server-Sent Events (SSE)

### Database & ORM

- MySQL
- Prisma ORM

### Messaging

- MQTT
- HiveMQ Public Broker

---

# ⚙️ Panduan Instalasi Lokal

## 1. Prasyarat

Pastikan beberapa software berikut sudah terinstal pada komputer:

- [Node.js](https://nodejs.org/) — Versi 18 LTS atau terbaru
- [MySQL Server](https://dev.mysql.com/downloads/mysql/) — Berjalan pada port `3306`
- [Git](https://git-scm.com/)
- PlatformIO — Untuk development ESP32

---

## 2. Setup Database MySQL

Buka MySQL Terminal atau aplikasi GUI seperti phpMyAdmin / DBeaver.

Buat database baru dengan perintah berikut:

```sql
CREATE DATABASE smart_planter_db;
```
````

Pastikan database berhasil dibuat sebelum melanjutkan ke konfigurasi backend.

---

# 🔧 3. Setup Backend

Buka terminal baru dan masuk ke folder backend:

```bash
cd backend
```

Install seluruh dependency:

```bash
npm install
```

### Konfigurasi Environment Variable

Buat file `.env` di dalam folder `backend`.

Contoh konfigurasi:

```env
PORT=4000
DATABASE_URL="mysql://root:@localhost:3306/smart_planter_db"
MQTT_BROKER="mqtt://broker.hivemq.com:1883"
CORS_ORIGIN="http://localhost:3000"
```

> **Catatan:**
> Jika MySQL kamu menggunakan password, ubah bagian `root:@` menjadi:
>
> ```text
> root:PASSWORD@
> ```
>
> Contoh:
>
> ```env
> DATABASE_URL="mysql://root:password123@localhost:3306/smart_planter_db"
> ```

### Sinkronisasi Database dengan Prisma

Jalankan migration:

```bash
npx prisma migrate dev --name init_smart_planter
```

Jika berhasil, Prisma akan membuat tabel-tabel yang dibutuhkan oleh aplikasi.

### Jalankan Backend

```bash
npm run dev
```

Backend akan berjalan pada:

```text
http://localhost:4000
```

---

# 🎨 4. Setup Frontend

Buka terminal baru dan masuk ke folder frontend:

```bash
cd frontend
```

Install dependency:

```bash
npm install
```

### Konfigurasi Environment Variable

Buat file `.env` di dalam folder `frontend`.

Isi dengan:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### Jalankan Frontend

```bash
npm run dev
```

Setelah berhasil dijalankan, buka browser:

```text
http://localhost:3000
```

Dashboard Smart Indoor Planter akan tersedia pada alamat tersebut.

---

# 📡 5. Koneksi Perangkat Keras ESP32

ESP32 harus terhubung ke jaringan Wi-Fi yang sama dengan komputer yang menjalankan backend.

Gunakan jaringan Wi-Fi **2.4 GHz** jika diperlukan oleh modul ESP32.

Jika backend dijalankan pada komputer lokal, ESP32 tidak dapat menggunakan:

```text
localhost
```

karena `localhost` dari sisi ESP32 berarti ESP32 itu sendiri.

Gunakan alamat IPv4 komputer yang menjalankan backend.

Contoh konfigurasi pada `main.cpp`:

```cpp
const char* serverUrl = "http://<IP_KOMPUTER_ANDA>:4000/api/telemetry";
```

Contoh jika alamat IPv4 komputer adalah `192.168.1.10`:

```cpp
const char* serverUrl = "http://192.168.1.10:4000/api/telemetry";
```

### Mengetahui IPv4 Komputer

Pada Windows, buka CMD:

```bash
ipconfig
```

Cari bagian:

```text
Wireless LAN adapter Wi-Fi
```

Kemudian cari:

```text
IPv4 Address
```

Contoh:

```text
IPv4 Address. . . . . . . . . . . : 192.168.1.10
```

Gunakan alamat tersebut pada konfigurasi ESP32.

---

# 🔄 Arsitektur Sistem

Secara umum, sistem bekerja dengan alur:

```text
┌─────────────────────┐
│       ESP32         │
│                     │
│  DHT11              │
│  Soil Moisture      │
│  LDR                │
│  UV Sensor          │
└──────────┬──────────┘
           │
           │ Sensor Data
           ▼
┌─────────────────────┐
│   Backend Express   │
│                     │
│  REST API           │
│  MQTT               │
│  SSE                │
└──────────┬──────────┘
           │
           ├──────────────► MySQL
           │
           │ Real-Time Data
           ▼
┌─────────────────────┐
│   Next.js Dashboard │
│                     │
│  Sensor Monitoring  │
│  Charts             │
│  Manual Control     │
│  CSV Export         │
└─────────────────────┘
```

---

# 🤖 Sistem Automation

Sistem automation dijalankan pada ESP32 menggunakan pendekatan **Rule-Based Automation**.

Aktuator yang dikontrol:

- 💧 Water Pump
- 💡 Grow Light

Sistem menggunakan konsep **Hysteresis** untuk mencegah aktuator terlalu sering melakukan ON/OFF ketika nilai sensor berada di sekitar batas threshold.

Contoh konsep:

```text
Soil Moisture
      │
      ▼
┌───────────────┐
│ Check Sensor  │
└───────┬───────┘
        │
        ▼
 Moisture < Lower Threshold?
        │
   ┌────┴────┐
  YES       NO
   │          │
   ▼          ▼
Pump ON    Pump OFF
```

---

# 📊 Monitoring Dashboard

Dashboard menyediakan informasi sensor secara _real-time_, antara lain:

| Sensor           | Data                         |
| ---------------- | ---------------------------- |
| 🌱 Soil Moisture | Kelembapan tanah             |
| 🌡️ DHT11         | Suhu ruangan                 |
| 💧 DHT11         | Kelembapan udara             |
| ☀️ LDR           | Persentase intensitas cahaya |
| 🔆 UV Sensor     | Indeks UV                    |

Data sensor kemudian ditampilkan dalam bentuk:

- Real-time cards
- Historical charts
- Status actuator
- Sensor trends
- Data table

---

# 📥 Data Export

Dashboard menyediakan fitur export data sensor dalam format:

```text
CSV
```

Data CSV dapat digunakan untuk:

- Analisis data
- Dokumentasi
- Visualisasi tambahan
- Machine learning
- Evaluasi performa sistem

---

# 📁 Struktur Project

Struktur project secara umum:

```text
smart-planter-dashboard/
│
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   │
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   └── index.js
│   │
│   ├── .env
│   ├── package.json
│   └── ...
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── public/
│   ├── .env
│   ├── package.json
│   └── ...
│
├── esp32/
│   ├── src/
│   │   └── main.cpp
│   ├── platformio.ini
│   └── ...
│
├── .gitignore
└── README.md
```

---

# 🔐 Environment Variables

## Backend

File:

```text
backend/.env
```

Contoh:

```env
PORT=4000
DATABASE_URL="mysql://root:@localhost:3306/smart_planter_db"
MQTT_BROKER="mqtt://broker.hivemq.com:1883"
CORS_ORIGIN="http://localhost:3000"
```

## Frontend

File:

```text
frontend/.env
```

Contoh:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

> Jangan upload file `.env` ke GitHub karena dapat berisi credential atau konfigurasi sensitif.

---

# 🚫 Git Ignore

Pastikan terdapat `.gitignore` pada project.

Contoh:

```gitignore
# Dependencies
node_modules/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Next.js
.next/
out/

# Build
dist/
build/

# Logs
*.log

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Prisma
*.db
```

---

# 🐙 Cara Push ke GitHub

Pastikan kamu sudah membuat repository GitHub:

```text
https://github.com/joshuaimanuel1/smart-planter-dashboard
```

Kemudian buka CMD pada folder utama project:

```text
C:\CollageFastTrack 1\Intelligent Internet of Things\smart-planter-dashboard
```

---

## 1. Inisialisasi Git

```bash
git init
```

Tambahkan seluruh file:

```bash
git add .
```

Untuk mengecek file yang akan di-commit:

```bash
git status
```

Pastikan file seperti `.env` dan `node_modules` **tidak muncul** dalam daftar file yang akan di-upload.

---

## 2. Buat Commit Pertama

```bash
git commit -m "Initial commit: Fullstack Smart Planter Dashboard with ESP32 integration"
```

---

## 3. Ubah Branch Menjadi `main`

```bash
git branch -M main
```

---

## 4. Hubungkan dengan Repository GitHub

```bash
git remote add origin https://github.com/joshuaimanuel1/smart-planter-dashboard.git
```

Untuk memastikan remote sudah benar:

```bash
git remote -v
```

Output kurang lebih:

```text
origin  https://github.com/joshuaimanuel1/smart-planter-dashboard.git (fetch)
origin  https://github.com/joshuaimanuel1/smart-planter-dashboard.git (push)
```

---

## 5. Push ke GitHub

```bash
git push -u origin main
```

Jika GitHub meminta autentikasi, ikuti proses login yang muncul.

Setelah proses selesai, refresh repository GitHub dan seluruh source code akan tersedia di repository.

---

# 🔄 Perintah Git untuk Update Project

Setelah melakukan perubahan pada source code, gunakan:

```bash
git add .
```

Kemudian:

```bash
git commit -m "Update smart planter dashboard"
```

Lalu:

```bash
git push
```

---

# 🧪 Menjalankan Project Setelah Clone

Jika project di-clone dari GitHub ke komputer lain, jalankan:

### Backend

```bash
cd backend
npm install
```

Buat file:

```text
.env
```

Kemudian konfigurasi database dan MQTT.

Jalankan Prisma:

```bash
npx prisma migrate dev
```

Kemudian:

```bash
npm run dev
```

### Frontend

Buka terminal baru:

```bash
cd frontend
npm install
```

Buat:

```text
.env
```

Isi:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Kemudian:

```bash
npm run dev
```

Buka:

```text
http://localhost:3000
```

---

# 🌱 Smart Indoor Planter

Smart Indoor Planter Dashboard mengintegrasikan **IoT, real-time monitoring, automation, MQTT, REST API, database, dan web dashboard** dalam satu sistem.

```text
Sensors
   │
   ▼
ESP32
   │
   ├── Automation
   │
   ├── MQTT
   │
   ▼
Backend API
   │
   ├── MySQL
   │
   ├── SSE
   │
   ▼
Next.js Dashboard
   │
   ├── Monitoring
   ├── Charts
   ├── Manual Control
   └── CSV Export
```

---

## 👨‍💻 Author

**Joshua Imanuel**

GitHub:
[https://github.com/joshuaimanuel1](https://github.com/joshuaimanuel1)

Repository:
[https://github.com/joshuaimanuel1/smart-planter-dashboard](https://github.com/joshuaimanuel1/smart-planter-dashboard)

````

**Catatan kecil bro:** di README final di atas, bagian link GitHub/Node/MySQL masih berupa Markdown link karena ini adalah **isi file `README.md` yang memang akan kamu copy ke GitHub**. Jadi tinggal simpan sebagai:

```text
README.md
````

di root:

```text
smart-planter-dashboard/
└── README.md
```

Lalu jalankan `git add .` → `git commit` → `git push`.
