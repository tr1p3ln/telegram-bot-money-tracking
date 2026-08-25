// Memanggil library dotenv untuk membaca file .env
require('dotenv').config();

// Memanggil modul yang dibutuhkan dari library google
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Membaca file credentials.json yang Anda taruh di folder utama
const creds = require('../credentials.json');

// Membuat autentikasi menggunakan email dan private key dari kredensial
const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Memberi izin untuk edit sheets
});

// Menghubungkan ke dokumen spreadsheet Anda berdasarkan ID dari file .env
const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);

// Fungsi untuk memastikan koneksi berhasil (akan dipanggil di index.js)
async function initSheets() {
  try {
    await doc.loadInfo(); // Mengunduh informasi dasar spreadsheet
    console.log(`Berhasil terhubung ke Spreadsheet: ${doc.title}`);
    return doc; // Mengembalikan objek dokumen agar bisa dipakai oleh fungsi lain
  } catch (error) {
    console.error("Gagal terhubung ke Google Sheets:", error);
  }
}

// Mengekspor fungsi dan objek agar bisa digunakan di file lain
module.exports = { initSheets, doc };