// Memanggil library node-cache
const NodeCache = require("node-cache");

/* 
  1. Setup Cache Staging (Sebelum Simpan)
  - stdTTL: 900 detik (15 Menit). Setelah 15 menit, data otomatis hilang.
  - checkperiod: 120 detik. Sistem mengecek data kadaluarsa setiap 2 menit.
*/

const stagingCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

/* 
  2. Setup Cache Undo (Setelah Simpan)
  - stdTTL: 300 detik (5 Menit). Kesempatan undo hanya 5 menit.
*/
const undoCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// --- FUNGSI UNTUK STAGING (Input & Edit) ---

function setStagingData(chatId, data) {
  // Menyimpan data transaksi ke memori dengan kunci (key) berupa chatId
  stagingCache.set(chatId, data);
}

function getStagingData(chatId) {
  // Mengambil data staging milik user tertentu
  return stagingCache.get(chatId);
}

function clearStagingData(chatId) {
  // Menghapus data staging (Dipanggil jika user klik Batal atau Selesai Simpan)
  stagingCache.del(chatId);
}

// --- FUNGSI UNTUK UNDO ---

function setUndoData(chatId, rowObject) {
  // Menyimpan objek baris (row) dari Google Sheets agar nanti bisa dihapus langsung
  undoCache.set(chatId, rowObject);
}

function getUndoData(chatId) {
  return undoCache.get(chatId);
}

function clearUndoData(chatId) {
  undoCache.del(chatId);
}

// Mengekspor semua fungsi agar bisa dipanggil dari index.js
module.exports = {
  setStagingData,
  getStagingData,
  clearStagingData,
  setUndoData,
  getUndoData,
  clearUndoData
};