# Smart Planter Dashboard

## Backend

cd backend && cp .env.example .env && npm i && npx prisma migrate deploy && npm run dev

## Frontend

cd frontend && cp .env.example .env.local && npm i && npm run dev # http://localhost:3000
Catatan: buat database `smart_indoor_planter` di MySQL dulu. Firmware tidak perlu diubah (API_URL tetap /api/telemetry).

## Docker (1 perintah)

docker compose up --build # dashboard: http://localhost:3000, API: http://localhost:4000

## Ambang otomasi

Di `backend/.env`: PUMP_ON/PUMP_OFF (30/70) dan LIGHT_ON/LIGHT_OFF (60/80). Samakan dengan konstanta di firmware.
`RETENTION_DAYS=0` menyimpan data selamanya; isi angka untuk menghapus log lama otomatis.
