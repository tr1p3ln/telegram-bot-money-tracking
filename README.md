# telegram-bot-money-tracking

Bot Telegram berbasis AI untuk mencatat keuangan dan menyimpan datanya secara otomatis ke dalam file Excel.

## 🚀 Fitur Utama

- **Pencatatan Otomatis**: Membaca notifikasi transaksi dari email (seperti transaksi Bank Jago) secara otomatis menggunakan n8n.
- **Ekstraksi Data**: Memisahkan nominal dan keterangan transaksi (Tarik kantong, pindah kantong, pembayaran merchant) secara otomatis.
- **Webhook Integrasi**: Meneruskan data yang telah diekstrak dari email ke sistem backend (Node.js).
- **Penyimpanan Terpusat**: Menyimpan riwayat pengeluaran dan pemasukan dengan rapi ke dalam Excel / Spreadsheet.

## 🛠️ Teknologi yang Digunakan

- **JavaScript / Node.js** (100%)
- **n8n** - Workflow automation
- **Telegram Bot API**
- **Excel / Google Sheets API**

## 📁 Struktur Repositori

```text
.
├── config/                # Folder untuk file konfigurasi / environment
├── services/              # Logika dan fungsi utama untuk menangani bot dan spreadsheet
├── Bot Telegram.json      # File workflow export dari n8n
├── index.js               # Entry point aplikasi (Server/Webhook receiver)
├── package.json           # Daftar dependensi aplikasi Node.js
└── README.md              # Dokumentasi project
```

## ⚙️ Persiapan & Instalasi

1. **Clone Repository**
   ```bash
   git clone https://github.com/tr1p3ln/telegram-bot-money-tracking.git
   cd telegram-bot-money-tracking
   ```

2. **Install Dependensi**
   Pastikan Anda sudah menginstall Node.js, kemudian jalankan:
   ```bash
   npm install
   ```

3. **Konfigurasi Environment dan Kredensial**
   Project ini membutuhkan beberapa konfigurasi agar dapat terhubung dengan bot dan spreadsheet:

   - **Variabel Lingkungan (.env)**
     Duplikat file `.env.example` menjadi `.env` lalu isi nilainya:
     ```bash
     cp .env.example .env
     ```
     Buka file `.env` dan isi token bot Telegram, API Key Gemini, serta Spreadsheet ID.

   - **Kredensial Service Account (Google Sheets API)**
     Duplikat file `cosmic-signer.example` menjadi file JSON kredensial Anda (misal `cosmic-signer.json`):
     ```bash
     cp cosmic-signer.example cosmic-signer.json
     ```
     Buka `cosmic-signer.json` dan ganti teks *placeholder* (seperti `<MASUKKAN_ID_PROJECT_GOOGLE_CLOUD_ANDA>`) dengan kredensial asli yang Anda unduh dari Google Cloud Console.
   
   - Pastikan webhook server mengarah ke alamat yang benar. (Default: `http://localhost:3000/webhook-pengeluaran`)

4. **Jalankan Aplikasi**
   ```bash
   node index.js
   ```

## 🤖 Setup Workflow n8n

Project ini membutuhkan n8n untuk membaca email masuk dan memicu webhook.

1. Buka workspace **n8n** Anda.
2. Buat workflow baru.
3. Gunakan fitur import dan unggah file `Bot Telegram.json`.
4. Buka node **Email Trigger (IMAP)** dan hubungkan kredensial akun email Anda.
5. Pastikan node **HTTP Request** mengarah ke URL webhook lokal atau server Anda.
6. Aktifkan (Activate) workflow tersebut.

---
Dibuat oleh [Nadzwa Ray Muhammad (tr1p3ln)](https://github.com/tr1p3ln)
