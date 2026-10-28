import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiHandler from './api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.ics': 'text/calendar; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${host}`);
  let pathname = parsedUrl.pathname;

  // Delegate API & Calendar feed requests to Vercel-ready handler
  if (pathname.startsWith('/api/') || pathname === '/api' || pathname === '/feed.ics') {
    return apiHandler(req, res);
  }

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // Handle static assets regardless of subpath prefix
  const baseName = path.basename(pathname);
  if (baseName === 'index.css' || baseName === 'app.js' || baseName === 'favicon.ico') {
    pathname = '/' + baseName;
  } else if (
    !path.extname(pathname) && (
      pathname === '/' ||
      pathname === '' ||
      pathname === '/login' ||
      pathname.startsWith('/app/scheduling') ||
      pathname.startsWith('/booking/') ||
      pathname.startsWith('/user/')
    )
  ) {
    pathname = '/index.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT' && (!ext || ext === '.html')) {
        const indexPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(indexPath)) {
          fs.readFile(indexPath, (indexErr, indexContent) => {
            if (indexErr) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Error interno del servidor');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(indexContent);
            }
          });
          return;
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Archivo no encontrado: 404 (${pathname})`);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    }
  });
});

// In local Node.js environments, listen on port.
if (!process.env.VERCEL) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 Servidor de Reuniones activo en: http://127.0.0.1:${PORT}`);
    console.log(`🔗 Calendly Meeting Types: http://127.0.0.1:${PORT}/app/scheduling/meeting_types/user/me`);
    console.log(`🔐 Google Login Endpoint: http://127.0.0.1:${PORT}/api/auth/google`);
    console.log(`📅 Google Calendar Feed: http://127.0.0.1:${PORT}/api/calendar/feed.ics`);
    console.log(`☁️  Preparado para deploy en Vercel con api/index.js`);
  });
}

