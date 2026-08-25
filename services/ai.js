require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inisialisasi Gemini API menggunakan kunci rahasia dari .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Fungsi untuk menganalisis gambar menggunakan Gemini AI
 * @param {string} imageUrl - URL gambar yang didapat dari server Telegram
 * @returns {object} - Mengembalikan data JSON yang berisi Kategori, Nominal, dan Keterangan
 */
async function extractDataFromImage(imageUrl) {
  try {
    // 1. Mengunduh gambar dari Telegram menggunakan built-in fetch Node.js
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    
    // 2. Mengubah gambar ke format Base64 (Syarat wajib untuk API Gemini)
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // 3. Memilih model Gemini (gemini-1.5-flash sangat cepat untuk vision)
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    // 4. Instruksi ketat (Prompt) untuk AI agar hanya mereturn JSON
    const prompt = `
      Anda adalah asisten pencatat keuangan. Analisis gambar struk/nota ini. 
      Kembalikan HANYA objek JSON valid tanpa markdown (tanpa \`\`\`json).
      Key yang wajib ada:
      - "Kategori": (Tebak dari: Makanan, Transportasi, Tagihan, Belanja, Lainnya. Kosongkan jika ragu)
      - "Nominal": (Total akhir/grand total, wajib format angka integer murni)
      - "Keterangan": (Nama toko atau ringkasan barang, misal: "Makan di McD" atau "Bensin Pertamina")
    `;

    // 5. Menyiapkan paket data untuk dikirim ke AI
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg",
      },
    };

    // 6. Eksekusi permintaan ke AI
    const result = await model.generateContent([prompt, imagePart]);
    let text = result.response.text();

    // 7. Parsing: Membersihkan sisa markdown jika Gemini mengabaikan instruksi, lalu mengubah teks ke Objek JS
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonResult = JSON.parse(text);

    return jsonResult;
  } catch (error) {
    console.error("Gagal memproses AI:", error);
    throw new Error("Gagal mengekstrak data dari gambar");
  }
}

module.exports = { extractDataFromImage };