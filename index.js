require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { initSheets, doc } = require('./config/sheets');
const { 
  setStagingData, getStagingData, clearStagingData,
  setUndoData, getUndoData, clearUndoData 
} = require('./services/cache');
const { extractDataFromImage } = require('./services/ai');
// Variabel untuk mengingat status user (contoh: sedang edit nominal)
const userState = {};

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const cron = require('node-cron');

const express = require('express');
const app = express();

//untuk menerima request JSON dari webhook Telegram
//yang memiliki fungsi untuk memproses data yang dikirimkan oleh Telegram ke server kita. Dengan menggunakan express.json(), kita dapat mengakses data yang dikirimkan dalam format JSON melalui req.body di route handler Express.
app.use(express.json());


// --- FUNGSI PEMBANTU UNTUK TAMPILAN PREVIEW ---
function kirimPreviewStaging(ctx, chatId, data) {
  const teksPreview = `
*📋 PREVIEW TRANSAKSI (STAGING)*
Tipe: ${data.Tipe}
Kategori: ${data.Kategori || '⚠️ Belum Dipilih'}
Nominal: Rp ${data.Nominal}
Keterangan: ${data.Keterangan}

Data ini *BELUM TERSIMPAN*. Silakan periksa kembali.
  `;

  // Membuat tombol (Inline Keyboard)
  const tombol = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Simpan ke Sheets', 'SIMPAN_DATA')],
    [
      Markup.button.callback('✏️ Edit Nominal', 'EDIT_NOMINAL'),
      Markup.button.callback('✏️ Edit Kategori', 'EDIT_KATEGORI')
    ],
    [Markup.button.callback('❌ Batal', 'BATAL_SIMPAN')]
  ]);

  ctx.replyWithMarkdown(teksPreview, tombol);
}

// --- 1. JALUR INPUT: PERINTAH MANUAL (/pengeluaran) ---
bot.command('pengeluaran', (ctx) => {
  const teks = ctx.message.text.replace('/pengeluaran ', '');
  const [kategori, nominal, ...ketArr] = teks.split(' ');
  const keterangan = ketArr.join(' ');

  if (!kategori || !nominal || isNaN(nominal)) {
    return ctx.reply('⚠️ Format salah!\nContoh: /pengeluaran Makanan 50000 Makan siang');
  }

  const chatId = ctx.chat.id;
  const dataStaging = {
    Tipe: 'Pengeluaran',
    Kategori: kategori,
    Nominal: parseInt(nominal),
    Keterangan: keterangan || '-',
    Sumber: 'Manual'
  };

  // Simpan ke Cache (Memori sementara 15 menit)
  setStagingData(chatId, dataStaging);
  kirimPreviewStaging(ctx, chatId, dataStaging);
});

// --- 1B. JALUR INPUT: PEMASUKAN MANUAL ---
bot.command('pemasukan', (ctx) => {
  const teks = ctx.message.text.replace('/pemasukan ', '').trim();
  const [nominal, ...ketArr] = teks.split(' ');
  const keterangan = ketArr.join(' ');

  if (!nominal || isNaN(nominal)) {
    return ctx.reply('⚠️ Format salah!\nContoh: /pemasukan 5000000 Gaji Bulan Agustus');
  }

  const chatId = ctx.chat.id;
  const dataStaging = {
    Tipe: 'Pemasukan',
    Kategori: 'Pendapatan', // Pemasukan biasanya tidak butuh banyak kategori pengeluaran
    Nominal: parseInt(nominal),
    Keterangan: keterangan || '-',
    Sumber: 'Manual'
  };

  setStagingData(chatId, dataStaging);
  kirimPreviewStaging(ctx, chatId, dataStaging);
});

// --- 2. JALUR INPUT: FOTO (Kirim Struk) ---
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const pesanLoading = await ctx.reply('⏳ Sedang memproses gambar menggunakan AI...');

  try {
    // Ambil file foto dengan resolusi tertinggi (index array terakhir)
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    
    // Minta URL gambar dari server API Telegram
    const fileLink = await ctx.telegram.getFileLink(photoId);
    
    // Kirim URL ke fungsi Gemini AI
    const hasilAI = await extractDataFromImage(fileLink.href);

    const dataStaging = {
      Tipe: 'Pengeluaran',
      Kategori: hasilAI.Kategori || '',
      Nominal: hasilAI.Nominal || 0,
      Keterangan: hasilAI.Keterangan || 'Dari foto',
      Sumber: 'Foto/AI'
    };

    // Hapus pesan loading
    await ctx.telegram.deleteMessage(chatId, pesanLoading.message_id);

    // Simpan ke Staging Cache
    setStagingData(chatId, dataStaging);
    kirimPreviewStaging(ctx, chatId, dataStaging);

  } catch (error) {
    ctx.reply('❌ AI gagal memproses gambar. Silakan input manual.');
  }
});

// --- 3. JALUR AKSI: TOMBOL INLINE (Simpan / Batal) ---
bot.action('BATAL_SIMPAN', (ctx) => {
  const chatId = ctx.chat.id;
  clearStagingData(chatId); // Hapus memori cache
  ctx.editMessageText('❌ Transaksi dibatalkan dan dihapus dari memori.');
});

bot.action('SIMPAN_DATA', async (ctx) => {
  const chatId = ctx.chat.id;
  const data = getStagingData(chatId);

  if (!data) {
    return ctx.editMessageText('⚠️ Data kedaluwarsa atau sudah tidak ada di memori. Silakan input ulang.');
  }

  try {
    // 1. Ubah pesan jadi loading agar user tahu sedang proses
    await ctx.editMessageText('⏳ Sedang menyimpan data ke Google Sheets...');

    // 2. Ambil Sheet bernama "Transaksi"
    const sheet = doc.sheetsByTitle['Transaksi'];
    if (!sheet) {
      throw new Error('Sheet dengan nama "Transaksi" tidak ditemukan!');
    }

    // 3. Siapkan data waktu dan ID Unik
    const now = new Date();
    // Memaksa format waktu ke Waktu Indonesia Barat (WIB)
    const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); 
    const bulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const idTransaksi = Date.now().toString(); // Angka unik dari waktu saat ini

    // 4. Susun objek data sesuai nama Header di Google Sheets
    const barisBaru = {
      'ID': idTransaksi,
      'Timestamp': timestamp,
      'Bulan': `'${bulan}`,
      'Tipe': data.Tipe,
      'Kategori': data.Kategori,
      'Nominal': data.Nominal,
      'Keterangan': data.Keterangan,
      'Sumber Input': data.Sumber,
      'Chat ID': chatId.toString()
    };

    // 5. Eksekusi penambahan baris ke Google Sheets
    const addedRow = await sheet.addRow(barisBaru);
    
    // Simpan objek baris ini ke cache Undo (berlaku 5 menit)
    setUndoData(chatId, addedRow);

    // 6. Hapus data dari memori Staging karena sudah aman di Sheets
    clearStagingData(chatId);

    // 7. Berikan pesan sukses
    ctx.editMessageText(`✅ Data berhasil disimpan secara permanen ke Google Sheets!\n\nKategori: ${data.Kategori}\nNominal: Rp ${data.Nominal}\nKeterangan: ${data.Keterangan}`);
    
  } catch (error) {
    console.error('Gagal saat menyimpan ke Sheets:', error);
    ctx.editMessageText('❌ Terjadi kesalahan saat mencoba menyimpan ke Google Sheets. Cek terminal untuk detailnya.');
  }
});

// --- FITUR: UNDO (Batalkan Transaksi Terakhir) ---
bot.command('undo', async (ctx) => {
  const chatId = ctx.chat.id;
  const rowToUndo = getUndoData(chatId);

  if (!rowToUndo) {
    return ctx.reply('⚠️ Tidak ada transaksi yang bisa dibatalkan, atau batas waktu (5 menit) sudah habis.');
  }

  try {
    await ctx.reply('⏳ Sedang membatalkan transaksi...');
    
    // Menghapus baris langsung dari Google Sheets
    await rowToUndo.delete();
    
    // Menghapus data dari memori undo agar tidak bisa di-undo dua kali
    clearUndoData(chatId);
    
    ctx.reply('✅ Transaksi terakhir berhasil dihapus dari Google Sheets!');
  } catch (error) {
    console.error('Gagal saat undo:', error);
    ctx.reply('❌ Terjadi kesalahan saat membatalkan transaksi.');
  }
});

// --- FITUR: RINGKASAN BULANAN ---

// --- FITUR: RINGKASAN BULANAN (UPDATE DENGAN BUDGET) ---
// --- FITUR: RINGKASAN BULANAN (UPDATE & SINKRONISASI SHEET) ---
bot.command('ringkasan', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  try {
    await ctx.reply('⏳ Menghitung ringkasan dan memperbarui Sheet...');
    
    const sheetTransaksi = doc.sheetsByTitle['Transaksi'];
    const sheetRingkasan = doc.sheetsByTitle['Ringkasan Bulanan'];
    
    const rowsTransaksi = await sheetTransaksi.getRows();
    const rowsRingkasan = await sheetRingkasan.getRows();
    
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    let totalPemasukan = 0;
    let totalPengeluaran = 0;
    
    const rincianKategori = {
      'Makanan': 0, 'Transportasi': 0, 'Tagihan': 0, 'Belanja': 0, 'Lainnya': 0
    };

    // 1. Kalkulasi Data dari Sheet Transaksi
    rowsTransaksi.forEach(row => {
      const rowBulan = row.get('Bulan') || '';
      if (rowBulan.includes(currentMonth) && row.get('Chat ID') === chatId) {
        const nominal = parseInt(row.get('Nominal')) || 0;
        
        if (row.get('Tipe') === 'Pemasukan') {
          totalPemasukan += nominal;
        } else if (row.get('Tipe') === 'Pengeluaran') {
          totalPengeluaran += nominal;
          const katLower = (row.get('Kategori') || '').toLowerCase();
          
          if (katLower === 'makan' || katLower === 'makanan' || katLower === 'minum' || katLower === 'jajan') rincianKategori['Makanan'] += nominal;
          else if (katLower === 'transportasi' || katLower === 'bensin' || katLower === 'gojek' || katLower === 'parkir' || katLower === 'grab') rincianKategori['Transportasi'] += nominal;
          else if (katLower === 'tagihan' || katLower === 'listrik' || katLower === 'air' || katLower === 'wifi') rincianKategori['Tagihan'] += nominal;
          else if (katLower === 'belanja' || katLower === 'supermarket' || katLower === 'pasar') rincianKategori['Belanja'] += nominal;
          else if (rincianKategori[row.get('Kategori')] !== undefined) rincianKategori[row.get('Kategori')] += nominal;
          else rincianKategori['Lainnya'] += nominal;
        }
      }
    });

    const saldo = totalPemasukan - totalPengeluaran;

    // 2. SINKRONISASI HASIL KE SHEET "RINGKASAN BULANAN"
    let dataBudget = rowsRingkasan.find(row => row.get('Bulan') === currentMonth);
    
    if (dataBudget) {
      // Jika baris bulan ini sudah ada, perbarui nilainya
      dataBudget.assign({
        'Pemasukan': totalPemasukan,
        'Pengeluaran Makanan': rincianKategori['Makanan'],
        'Pengeluaran Transportasi': rincianKategori['Transportasi'],
        'Pengeluaran Tagihan': rincianKategori['Tagihan'],
        'Pengeluaran Belanja': rincianKategori['Belanja'],
        'Pengeluaran Lainnya': rincianKategori['Lainnya'],
        'Total Pengeluaran': totalPengeluaran,
        'Saldo': saldo
      });
      await dataBudget.save();
    } else {
      // Jika belum ada, buat baris baru
      const barisBaru = {
        'Bulan': currentMonth,
        'Pemasukan': totalPemasukan,
        'Pengeluaran Makanan': rincianKategori['Makanan'],
        'Pengeluaran Transportasi': rincianKategori['Transportasi'],
        'Pengeluaran Tagihan': rincianKategori['Tagihan'],
        'Pengeluaran Belanja': rincianKategori['Belanja'],
        'Pengeluaran Lainnya': rincianKategori['Lainnya'],
        'Total Pengeluaran': totalPengeluaran,
        'Saldo': saldo
      };
      await sheetRingkasan.addRow(barisBaru);
      
      // Ambil ulang row untuk mencetak pesan budget di bawah
      const updatedRows = await sheetRingkasan.getRows();
      dataBudget = updatedRows.find(row => row.get('Bulan') === currentMonth);
    }

    // 3. Menyusun pesan balasan Telegram
    let pesan = `*📊 RINGKASAN BULAN ${currentMonth}*\n\n`;
    pesan += `🟢 *Pemasukan:* Rp ${totalPemasukan.toLocaleString('id-ID')}\n`;
    pesan += `🔴 *Pengeluaran:* Rp ${totalPengeluaran.toLocaleString('id-ID')}\n`;
    pesan += `====================\n`;
    pesan += `💰 *SALDO SISA:* Rp ${saldo.toLocaleString('id-ID')}\n\n`;
    
    pesan += `*Rincian Pengeluaran & Budget:*\n`;
    
    for (const [kat, nom] of Object.entries(rincianKategori)) {
      let teksBudget = '';
      if (dataBudget) {
        const batasBudget = parseInt(dataBudget.get(`Budget ${kat}`)) || 0;
        if (batasBudget > 0) {
          const persen = Math.round((nom / batasBudget) * 100);
          let icon = '✅';
          if (persen >= 100) icon = '❌ OVER';
          else if (persen >= 80) icon = '⚠️ AWAS';
          
          teksBudget = ` / Rp ${batasBudget.toLocaleString('id-ID')} *( ${persen}% ${icon} )*`;
        }
      }
      pesan += `- ${kat}: Rp ${nom.toLocaleString('id-ID')}${teksBudget}\n`;
    }

    ctx.replyWithMarkdown(pesan);
  } catch (error) {
    console.error('Gagal mengambil ringkasan:', error);
    ctx.reply('❌ Terjadi kesalahan saat membaca data ringkasan.');
  }
});

// --- FITUR: SET BUDGET BULANAN ---
bot.command('setbudget', async (ctx) => {
  // 1. Membersihkan teks dan memisahkan input
  const teks = ctx.message.text.replace('/setbudget ', '').trim();
  const [inputKategori, nominal] = teks.split(' ');

  // 2. Validasi input
  if (!inputKategori || !nominal || isNaN(nominal)) {
    return ctx.reply('⚠️ Format salah!\nContoh: /setbudget Makanan 1500000');
  }

  // 3. Mapping Kategori agar lebih fleksibel (mirip seperti di ringkasan)
  const katLower = inputKategori.toLowerCase();
  let kategoriValid = '';
  
  if (katLower === 'makan' || katLower === 'makanan') kategoriValid = 'Makanan';
  else if (katLower === 'transportasi' || katLower === 'transport') kategoriValid = 'Transportasi';
  else if (katLower === 'tagihan') kategoriValid = 'Tagihan';
  else if (katLower === 'belanja') kategoriValid = 'Belanja';
  else if (katLower === 'lainnya' || katLower === 'lain') kategoriValid = 'Lainnya';

  if (!kategoriValid) {
    return ctx.reply('⚠️ Kategori tidak dikenali. Pilih dari: Makanan, Transportasi, Tagihan, Belanja, atau Lainnya.');
  }

  const nominalAngka = parseInt(nominal);

  try {
    await ctx.reply(`⏳ Sedang mengatur budget untuk ${kategoriValid}...`);

    // 4. Buka sheet "Ringkasan Bulanan"
    const sheet = doc.sheetsByTitle['Ringkasan Bulanan'];
    if (!sheet) throw new Error('Sheet Ringkasan Bulanan tidak ditemukan');

    const rows = await sheet.getRows();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 5. Cek apakah baris untuk bulan ini sudah ada
    let rowBulanIni = rows.find(row => row.get('Bulan') === currentMonth);
    const namaKolomBudget = `Budget ${kategoriValid}`; // Contoh: "Budget Makanan"

    if (rowBulanIni) {
      // Jika baris bulan ini sudah ada, perbarui sel budget-nya
      rowBulanIni.assign({ [namaKolomBudget]: nominalAngka });
      await rowBulanIni.save();
    } else {
      // Jika belum ada, buat baris baru khusus untuk bulan ini
      const barisBaru = {
        'Bulan': currentMonth,
        [namaKolomBudget]: nominalAngka
      };
      await sheet.addRow(barisBaru);
    }

    ctx.reply(`✅ Target Budget *${kategoriValid}* bulan ini berhasil diatur menjadi Rp ${nominalAngka.toLocaleString('id-ID')}`, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Gagal set budget:', error);
    ctx.reply('❌ Terjadi kesalahan saat menyimpan budget ke Sheets.');
  }
});



// --- JALUR EDIT: KATEGORI ---
bot.action('EDIT_KATEGORI', (ctx) => {
  // Munculkan pilihan kategori baru
  const tombolKategori = Markup.inlineKeyboard([
    [Markup.button.callback('🍔 Makanan', 'SET_KAT_Makanan'), Markup.button.callback('🚗 Transportasi', 'SET_KAT_Transportasi')],
    [Markup.button.callback('💡 Tagihan', 'SET_KAT_Tagihan'), Markup.button.callback('🛒 Belanja', 'SET_KAT_Belanja')],
    [Markup.button.callback('📦 Lainnya', 'SET_KAT_Lainnya')]
  ]);
  ctx.reply('Silakan pilih Kategori baru:', tombolKategori);
});

// Menangkap pilihan kategori dari tombol di atas
bot.action(/^SET_KAT_(.+)$/, (ctx) => {
  const kategoriBaru = ctx.match[1]; // Mengambil kata setelah "SET_KAT_"
  const chatId = ctx.chat.id;
  const data = getStagingData(chatId);
  
  if (data) {
    data.Kategori = kategoriBaru; // Update kategori
    setStagingData(chatId, data); // Simpan kembali ke memori
    
    ctx.deleteMessage(); // Hapus pesan pilihan kategori agar chat tetap bersih
    kirimPreviewStaging(ctx, chatId, data); // Munculkan preview yang sudah diupdate
  } else {
    ctx.reply('⚠️ Sesi edit berakhir atau data tidak ditemukan.');
  }
});

// --- JALUR EDIT: NOMINAL ---
bot.action('EDIT_NOMINAL', (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = 'MENUNGGU_NOMINAL'; // Set status user
  ctx.reply('✏️ Silakan ketik nominal angka yang baru (contoh: 150000):');
});

// Listener untuk menangkap teks balasan dari user (seperti ketikan nominal)
bot.on('text', (ctx, next) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  
  // Jika user sedang dalam state mengedit nominal
  if (state === 'MENUNGGU_NOMINAL') {
    const nominalBaru = parseInt(ctx.message.text);
    
    if (isNaN(nominalBaru)) {
      return ctx.reply('⚠️ Harus berupa angka tanpa titik/koma. Silakan ketik nominal baru:');
    }
    
    const data = getStagingData(chatId);
    if (data) {
      data.Nominal = nominalBaru; // Update nominal
      setStagingData(chatId, data);
      
      userState[chatId] = null; // Hapus status user
      kirimPreviewStaging(ctx, chatId, data); // Munculkan preview yang sudah diupdate
    } else {
      userState[chatId] = null;
      ctx.reply('⚠️ Sesi edit berakhir atau data hilang.');
    }
    return; // Berhenti di sini, tidak perlu lanjut ke bawah
  }
  
  return next(); // Jika bukan state edit, biarkan telegraf memproses perintah lain
});

// --- FITUR: PENGINGAT TERJADWAL (CRON JOBS) ---

// Fungsi pembantu untuk mengambil semua Chat ID unik dari Google Sheets
async function getAllUsers() {
  try {
    const sheet = doc.sheetsByTitle['Transaksi'];
    if (!sheet) return [];
    const rows = await sheet.getRows();
    // Mengambil nilai unik dari kolom "Chat ID"
    return [...new Set(rows.map(row => row.get('Chat ID')).filter(id => id))];
  } catch (error) {
    console.error('Gagal mengambil daftar user:', error);
    return [];
  }
}

// 1. CRON: Tanggal 1 setiap bulan, jam 08:00 pagi (Reminder Pemasukan)
cron.schedule('0 8 1 * *', async () => {
  const users = await getAllUsers();
  for (const chatId of users) {
    try {
      await bot.telegram.sendMessage(
        chatId, 
        '🔔 *Selamat Bulan Baru!*\nJangan lupa untuk mencatat /pemasukan kamu bulan ini ya, agar target budget bisa dihitung dengan akurat! 💸', 
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log(`Gagal kirim pesan ke ${chatId}`);
    }
  }
});

// 2. CRON: Tanggal 15 setiap bulan, jam 08:00 pagi (Progress Tengah Bulan)
cron.schedule('0 8 15 * *', async () => {
  const users = await getAllUsers();
  const sheet = doc.sheetsByTitle['Transaksi'];
  if (!sheet) return;

  const rows = await sheet.getRows();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const chatId of users) {
    let totalPemasukan = 0;
    let totalPengeluaran = 0;
    
    rows.forEach(row => {
      if (row.get('Bulan') === currentMonth && row.get('Chat ID') === chatId) {
        const nominal = parseInt(row.get('Nominal')) || 0;
        if (row.get('Tipe') === 'Pemasukan') totalPemasukan += nominal;
        else if (row.get('Tipe') === 'Pengeluaran') totalPengeluaran += nominal;
      }
    });

    // Hanya kirim jika user punya data transaksi bulan ini
    if (totalPemasukan > 0 || totalPengeluaran > 0) {
      const saldo = totalPemasukan - totalPengeluaran;
      const pesan = `🔔 *Progress Tengah Bulan!*\n\nSaat ini total pengeluaranmu mencapai *Rp ${totalPengeluaran.toLocaleString('id-ID')}*.\nSisa saldo: *Rp ${saldo.toLocaleString('id-ID')}*.\n\nKetik /ringkasan untuk melihat sisa budget di tiap kategorimu ya!`;
      
      try {
        await bot.telegram.sendMessage(chatId, pesan, { parse_mode: 'Markdown' });
      } catch (error) {
         console.log(`Gagal kirim pesan ke ${chatId}`);
      }
    }
  }
});

// 3. CRON TESTING: Berjalan setiap 1 Menit (Untuk uji coba saat ini)
// cron.schedule('* * * * *', async () => {
//   console.log('Menjalankan cron testing 1 menit...');
//   const users = await getAllUsers();
//   for (const chatId of users) {
//     try {
//       await bot.telegram.sendMessage(
//         chatId, 
//         '🔔 *[TESTING]* Bot pengingat otomatis (Cron) kamu sudah berfungsi dengan baik!', 
//         { parse_mode: 'Markdown' }
//       );
//     } catch (e) {}
//   }
// });

// --- JALANKAN APLIKASI ---
// async function startApp() {
//   await initSheets();
//   bot.launch();
//   console.log('🤖 Bot Telegram berjalan, API siap!');
// }
// --- FITUR: LOKET WEBHOOK UNTUK N8N ---

// Membuka jendela loket spesifik bernama "/webhook-pengeluaran"
// (Diletakkan DI LUAR fungsi startApp)
app.post('/webhook-pengeluaran', async (req, res) => {
  
  // 1. Membongkar paket yang dibawa oleh kurir n8n (berada di req.body)
  const dataDariN8n = req.body;
  const nominal = dataDariN8n.nominal;
  const keterangan = dataDariN8n.keterangan;

  //consoleloge 
  console.log('[debug]📦 Paket diterima dari n8n:', dataDariN8n);

  // 2. Validasi: Memastikan kurir tidak membawa paket kosong
  if (!nominal || !keterangan) {
    // Jika paket cacat, tolak kurir dengan status 400 (Bad Request)
    return res.status(400).send({ error: 'Data nominal atau keterangan tidak ada!' });
  }

  try {
    // 3. Membuka Buku Besar (Google Sheets)
    const sheet = doc.sheetsByTitle['Transaksi'];
    
    // (BARIS VARIABEL GANDA DIHAPUS DARI SINI)
    
    const chatId = '1733545226'; // ID Telegram Anda
    
    // 4. Menyiapkan data persis seperti format yang biasa bot Anda pakai
    const now = new Date();
    const timestamp = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const bulan = `'${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const idTransaksi = Date.now().toString();

    // Mengubah keterangan menjadi huruf kecil semua agar mudah dideteksi
    const ket = keterangan.toLowerCase();
    
    // Setelan bawaan jika bot sama sekali tidak mengenali tokonya
    let kategoriOtomatis = 'Lainnya'; 

    // KAMUS PINTAR BOT
    if (ket.includes('grab food') || ket.includes('gofood') || ket.includes('makan') || ket.includes('resto') || ket.includes('kopi')) {
      kategoriOtomatis = 'Makanan';
    } 
    else if (ket.includes('yogya') || ket.includes('alfa') || ket.includes('indomaret') || ket.includes('mart') || ket.includes('belanja')) {
      kategoriOtomatis = 'Belanja';
    } 
    else if (ket.includes('gojek') || ket.includes('grab') || ket.includes('bensin') || ket.includes('parkir')) {
      kategoriOtomatis = 'Transportasi';
    } 
    else if (ket.includes('wifi') || ket.includes('listrik') || ket.includes('pln') || ket.includes('tagihan')) {
      kategoriOtomatis = 'Tagihan';
    }

    const barisBaru = {
      'ID': idTransaksi,
      'Timestamp': timestamp,
      'Bulan': bulan,
      'Tipe': 'Pengeluaran',
      'Kategori': kategoriOtomatis,
      'Nominal': nominal,
      'Keterangan': keterangan + ' (via Otomatisasi)',
      'Sumber Input': 'Webhook/n8n',
      'Chat ID': '1733545226'
    };

    // 5. Menyimpan data ke Sheets
    await sheet.addRow(barisBaru);

    // (BARIS RESPONSE GANDA DIHAPUS DARI SINI)

    // 6. Mengirim pesan notifikasi ke Telegram
    const pesanNotifikasi = 
      `🔔 *PENGELUARAN OTOMATIS (EMAIL)* 🔔\n\n` +
      `💸 *Nominal:* Rp ${Number(nominal).toLocaleString('id-ID')}\n` +
      `📝 *Keterangan:* ${keterangan}\n\n` +
      `✅ _Berhasil dicatat ke Google Sheets!_`;

    await bot.telegram.sendMessage(chatId, pesanNotifikasi, { parse_mode: 'Markdown' });
    console.log(`[DEBUG] Notifikasi terkirim ke Telegram untuk: ${keterangan}`);
    
    // 7. Mengirim nota konfirmasi (Response 200 OK) ke n8n cukup 1x saja di akhir
    res.status(200).send('Sukses disimpan ke Sheets dan Telegram!');

  } catch (error) {
    console.error('Webhook Error:', error);
    // Jika terjadi kebakaran di dalam kantor saat mencatat, beritahu n8n (Status 500 Internal Server Error)
    res.status(500).send({ error: 'Gagal mencatat di server.' });
  }
});


// --- JALANKAN APLIKASI ---
async function startApp() {
  await initSheets();
  bot.launch();
  
  // Menginstruksikan Express untuk berjaga di Port 3000
  app.listen(3000, () => {
    console.log('🚪 Loket Webhook terbuka dan berjaga di Port 3000');
  });

  console.log('🤖 Bot Telegram berjalan, API siap!');
}

startApp();


process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));