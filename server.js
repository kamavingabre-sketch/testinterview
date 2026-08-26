const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { default: BAAILY } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');

const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public folder
app.use(express.static('public'));

// In-memory contacts list
let contacts = [];

let client = null;

// QR code endpoint - returns base64 PNG
app.get('/qr', async (req, res) => {
  try {
    if (!client) return res.json({ status: 'Menunggu koneksi Baileys...' });
    // Try to get qr from client object properties that baileys sets
    const qr = client?.qrCode ?? client?.ev?.lastQR;
    if (qr) {
      res.json({ qr });
    } else {
      res.json({ status: 'Menunggu QR...' });
    }
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Upload DB endpoint
app.post('/upload-db', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    let numbers = [];
    if (ext === '.csv') {
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csvParser())
          .on('data', row => {
            const num = (row.no || row.number || row.phone || '').trim();
            if (num) numbers.push(num);
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (ext === '.json') {
      const data = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
      numbers = Array.isArray(data) ? data : (data.numbers || data.phone || []);
    } else {
      // fallback: plain text, one number per line
      const text = fs.readFileSync(req.file.path, 'utf8');
      numbers = text.split('\n').map(l => l.trim()).filter(l => l);
    }
    // Normalize numbers: add 62 prefix if needed, remove leading 0
    const normalized = numbers.map(n => {
      let n2 = n.replace(/\D/g, '');
      if (!n2.startsWith('62') && n2.startsWith('0')) n2 = '62' + n2.slice(1);
      if (!n2.startsWith('62')) n2 = '62' + n2;
      return n2;
    });
    // cleanup temp file
    try { fs.unlinkSync(req.file.path); } catch {}
    contacts = normalized;
    res.json({ success: true, contacts });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Send messages endpoint
app.post('/send', async (req, res) => {
  try {
    const { message } = req.body;
    const imageFile = req.files?.image; // multer file when input name='image'

    // Check if Baileys client is initialized
    if (!client) return res.json({ error: 'Baileys not initialized - server started without WhatsApp connection' });

    // Node version compatibility check
    const nodeMajor = parseInt(process.version.split('.')[0]);
    if (nodeMajor < 16 || nodeMajor > 18) {
      console.warn(`⚠️  Node.js v${process.version} detected - Baileys may have compatibility issues.`);
    }

    if (!message) return res.json({ error: 'No message provided' });

    const results = [];
    for (const number of contacts) {
      let num = number.startsWith('+') ? number : '62' + number.replace(/^0/, '');
      num = num.replace(/\D/g, '');
      try {
        if (imageFile) {
          await client.sendImage(num, imageFile.path, { caption: message });
        } else {
          await client.sendText(num, message);
        }
        results.push({ number: num, status: 'sent' });
        await new Promise(r => setTimeout(r, 600)); // flood delay
      } catch (e) {
        results.push({ number: num, status: 'failed', error: e.message });
      }
    }
    // cleanup image temp file if provided
    if (imageFile && imageFile.path) {
      try { fs.unlinkSync(imageFile.path); } catch {}
    }
    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    res.json({ status: 'done', sent, failed, results });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Start Baileys client
async function startBaileys() {
  client = BAAILY({ version: 'al', browser: ['MyBlaster', 'Chrome', 100] });

  // Handle connection updates (qr appears when connection changes)
  client.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;
    if (connection === 'open') {
      console.log('WhatsApp terconnect!');
    }
    if (qr) {
      // QR code is available; it will be served via /qr endpoint
      console.log('QR code generated, ready for frontend');
    }
  });

  // Handle QR code event (emitted when QR is displayed)
  client.ev.on('qr', qr => {
    // qr is base64 string; frontend will fetch /qr to get it
    console.log('QR event', qr ? 'present' : 'none');
  });

  // Handle errors gracefully - prevent unhandled error crash
  client.ev.on('error', (err) => {
    console.error('Baileys error event:', err.message);
    // Don't throw; just log and continue
  });

  // Handle WebSocket close/disconnect
  client.on('close', () => {
    console.log('Baileys connection closed');
  });
}

// Check Node.js version compatibility
const minNode = '16.0.0';
const maxNode = '18.0.0';
const currentNode = process.version;

const semver = require('semver');
const nodeCompatible = semver.gte(currentNode, minNode) && semver.lte(currentNode, maxNode);

if (!nodeCompatible) {
  console.warn(`\n⚠️  WARNING: Node.js v${currentNode} detected.`);
  console.warn(`   This Baileys version (rc14) is optimized for Node.js ${minNode} - ${maxNode}.`);
  console.warn(`   Current version may cause: "Cannot destructure property 'creds' of 'authState'" error.`);
  console.warn(`   Consider upgrading/downgrading Node, or the send feature may not work.\n`);
} else {
  console.log(`✅ Node.js v${currentNode} - Baileys compatibility confirmed.\n`);
}

// Global error handlers to keep server running safely
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  // Prevent crash; keep server running
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

(async () => {
  try {
    await startBaileys();
  } catch (e) {
    console.error('Baileys init error (continuing without WhatsApp):', e.message);
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
})();