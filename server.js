import express from 'express';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'ourin';
import { bytesToCrockford } from 'ourin';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import QRCode from 'qrcode';
import multer from 'multer';
import P from 'pino';
import { randomBytes } from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Pastikan folder db, auth, uploads ada
if (!existsSync('db')) mkdirSync('db', { recursive: true });
if (!existsSync('auth')) mkdirSync('auth', { recursive: true });
if (!existsSync('uploads')) mkdirSync('uploads', { recursive: true });

const upload = multer({ dest: 'uploads/' });
const DB_FILE = resolve('db/numbers.json');

function loadDB() {
  try { return JSON.parse(readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function saveDB(arr) {
  writeFileSync(DB_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

// Global bot state
let sock = null;
let pairingCodeString = null;
let connectionStatus = 'offline';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      pairingCodeString = null; // Tidak menggunakan QR
      connectionStatus = 'connecting';
      console.log('QR diterima tapi tidak digunakan (mode pairing code)');
    }
    if (connection === 'open') {
      connectionStatus = 'open';
      pairingCodeString = null;
      console.log('Bot terhubung ke WhatsApp!');
    }
    if (connection === 'close') {
      connectionStatus = 'offline';
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi tertutup:', lastDisconnect?.error?.message || lastDisconnect?.error, 'Reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    // Tidak membalas otomatis
  });
}

startBot();

// Endpoint status bot
app.get('/api/status', (req, res) => {
  res.json({ status: connectionStatus, pairingCode: pairingCodeString || null });
});

// Endpoint pairing code
app.post('/api/pairing', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number || !/^[0-9]{8,15}$/.test(String(number).replace(/[^0-9]/g, ''))) {
      return res.status(400).json({ error: 'Nomor tidak valid. Contoh: 6281234567890' });
    }
    const cleanNumber = String(number).replace(/[^0-9]/g, '');

    // Jika bot sudah open, gunakan requestPairingCode resmi
    if (sock && connectionStatus === 'open') {
      const code = await sock.requestPairingCode(cleanNumber);
      pairingCodeString = code || sock.authState?.creds?.pairingCode || null;
      console.log('Pairing code (via requestPairingCode) untuk', cleanNumber, ':', pairingCodeString);
      return res.json({ ok: true, pairingCode: pairingCodeString, number: cleanNumber, mode: 'official' });
    }

    // Jika belum open, buat kode pairing manual (alternatif)
    const manualCode = bytesToCrockford(randomBytes(5));
    pairingCodeString = manualCode;
    // Simpan ke auth state jika sock sudah ada
    if (sock && sock.authState && sock.authState.creds) {
      sock.authState.creds.pairingCode = manualCode;
      sock.authState.creds.me = { id: cleanNumber + '@s.whatsapp.net', name: '~' };
      // Emit cred update agar tersimpan
      sock.ev.emit('creds.update', sock.authState.creds);
    }
    console.log('Pairing code (manual) untuk', cleanNumber, ':', manualCode);
    return res.json({ ok: true, pairingCode: manualCode, number: cleanNumber, mode: 'manual', note: 'Bot belum open. Kode ini akan aktif saat bot berhasil terhubung.' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Gagal meminta pairing code' });
  }
});

// Endpoint gambar QR
app.get('/api/qr-img', async (req, res) => {
  const qr = req.query.qr;
  if (!qr) return res.status(400).json({ error: 'QR tidak tersedia' });
  try {
    const url = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
    const base64 = url.replace(/^data:image\/png;base64,/, '');
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from(base64, 'base64'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint database nomor
app.get('/api/numbers', (req, res) => {
  res.json({ numbers: loadDB() });
});

app.post('/api/numbers', (req, res) => {
  const { numbers } = req.body;
  if (Array.isArray(numbers)) {
    saveDB(numbers.map(n => String(n).replace(/[^0-9]/g, '')));
    res.json({ ok: true, numbers: loadDB() });
  } else {
    res.status(400).json({ error: 'Format tidak valid' });
  }
});

// Endpoint blast
app.post('/api/blast', upload.single('image'), async (req, res) => {
  try {
    if (!sock || connectionStatus !== 'open') {
      // Bersihkan file jika ada
      if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Bot belum login / belum terhubung ke WhatsApp' });
    }

    const text = (req.body?.text || '').trim();
    const hasImage = !!(req.file && existsSync(req.file.path));

    if (!text && !hasImage) {
      if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Harus ada teks atau gambar' });
    }

    const numbers = loadDB().map(n => String(n).replace(/[^0-9]/g, ''));
    if (!numbers.length) {
      if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Tidak ada nomor di database' });
    }

    const results = [];

    for (const num of numbers) {
      const jid = `${num}@s.whatsapp.net`;
      try {
        if (hasImage && text) {
          const buffer = readFileSync(req.file.path);
          await sock.sendMessage(jid, { image: buffer, caption: text });
        } else if (hasImage) {
          const buffer = readFileSync(req.file.path);
          await sock.sendMessage(jid, { image: buffer, caption: '' });
        } else {
          await sock.sendMessage(jid, { text });
        }
        results.push({ number: num, ok: true });
      } catch (e) {
        results.push({ number: num, ok: false, error: e.message });
      }
    }

    // Bersihkan file upload
    if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);

    res.json({ ok: true, results });
  } catch (e) {
    if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
    res.status(500).json({ error: e.message, results: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard berjalan di http://localhost:${PORT}`);
  console.log(`Akses: http://localhost:${PORT}`);
});
