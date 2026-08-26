# Dashboard kontak WhatsApp

Dashboard front-end sederhana untuk menyimpan kontak berizin, mengimpor nomor dari CSV, menulis pesan, menambahkan gambar ke draf, dan membuka percakapan WhatsApp melalui `wa.me`.

## Menjalankan

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Lalu buka `http://localhost:4173`.

Data kontak dan aktivitas disimpan di `localStorage` browser. WhatsApp tetap dibuka dan dikirim secara manual; aplikasi ini tidak mengotomatisasi pengiriman massal. Pastikan semua nomor sudah opt-in dan patuhi kebijakan WhatsApp serta peraturan privasi yang berlaku.
