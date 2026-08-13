'use strict';
/**
 * 아주 작은 웹 서버 도우미 (Node 기본 모듈만 사용, express 불필요)
 * - 라우팅, 정적파일 서빙, JSON/폼/파일업로드(multipart) 처리
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

class App {
  constructor() {
    this.routes = [];      // { method, path, handler }
    this.statics = [];     // { prefix, dir }
    this.notFound = null;
  }

  get(p, h) { this.routes.push({ method: 'GET', path: p, handler: h }); }
  post(p, h) { this.routes.push({ method: 'POST', path: p, handler: h }); }
  static(prefix, dir) { this.statics.push({ prefix, dir }); }

  listen(port, cb) {
    const server = http.createServer((req, res) => this._handle(req, res));
    server.on('clientError', (e, socket) => { try { socket.destroy(); } catch (_) {} });
    server.listen(port, process.env.HOST || '0.0.0.0', cb);
    return server;
  }

  async _handle(req, res) {
    decorate(res);
    const parsed = url.parse(req.url, true);
    let pathname;
    try { pathname = decodeURIComponent(parsed.pathname); } catch (e) { pathname = parsed.pathname; }
    req.query = parsed.query;
    req.pathname = pathname;

    try {
      // 1) 라우트 (:param 지원)
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = matchPath(r.path, pathname);
        if (!m) continue;
        req.params = m;
        if (req.method === 'POST') await parseBody(req);
        await r.handler(req, res);
        return;
      }
      // 2) 정적 파일
      if (req.method === 'GET') {
        for (const s of this.statics) {
          if (!pathname.startsWith(s.prefix)) continue;
          const rel = pathname.slice(s.prefix.length).replace(/^\/+/, '');
          if (rel.includes('..')) break;
          const file = path.join(s.dir, rel);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            return sendFile(res, file);
          }
        }
      }
      if (this.notFound) return this.notFound(req, res);
      res.status(404).end('Not Found');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message || '서버 오류가 발생했습니다.' });
      else res.end();
    }
  }
}

function matchPath(pattern, pathname) {
  if (!pattern.includes(':')) return pattern === pathname ? {} : null;
  const pp = pattern.split('/');
  const xp = pathname.split('/');
  if (pp.length !== xp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(xp[i]);
    else if (pp[i] !== xp[i]) return null;
  }
  return params;
}

function decorate(res) {
  res.status = function (c) { this.statusCode = c; return this; };
  res.json = function (o) {
    const b = Buffer.from(JSON.stringify(o), 'utf8');
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.setHeader('Content-Length', b.length);
    this.end(b);
  };
  res.send = function (s, type) {
    const b = Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8');
    this.setHeader('Content-Type', type || 'text/html; charset=utf-8');
    this.setHeader('Content-Length', b.length);
    this.end(b);
  };
  res.sendFile = function (p) { sendFile(this, p); };
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
}

/* ---------------- 요청 본문 파싱 ---------------- */
const MAX_BODY = 300 * 1024 * 1024; // 300MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('업로드 용량이 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const ctRaw = req.headers['content-type'] || '';
  const ct = ctRaw.toLowerCase();
  req.body = {};
  req.files = {};

  if (ct.startsWith('application/json')) {
    const raw = await readBody(req);
    try { req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch (e) { req.body = {}; }
    return;
  }
  if (ct.startsWith('application/x-www-form-urlencoded')) {
    const raw = await readBody(req);
    const q = new URLSearchParams(raw.toString('utf8'));
    for (const [k, v] of q) req.body[k] = v;
    return;
  }
  if (ct.startsWith('multipart/form-data')) {
    // 구분자(boundary)는 대소문자를 구분하므로 원본 헤더에서 읽습니다.
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctRaw);
    if (!m) throw new Error('업로드 형식을 해석할 수 없습니다.');
    const boundary = (m[1] || m[2]).trim();
    const raw = await readBody(req);
    parseMultipart(raw, boundary, req);
    return;
  }
  // 그 외
  await readBody(req);
}

function parseMultipart(buf, boundary, req) {
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let idx = buf.indexOf(delim);
  while (idx !== -1) {
    const start = idx + delim.length;
    // 종료 구분자
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    // 앞의 CRLF, 뒤의 CRLF 제거
    let s = start;
    if (buf[s] === 0x0d && buf[s + 1] === 0x0a) s += 2;
    let e = next;
    if (buf[e - 2] === 0x0d && buf[e - 1] === 0x0a) e -= 2;
    parts.push(buf.slice(s, e));
    idx = next;
  }

  for (const part of parts) {
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd === -1) continue;
    const head = part.slice(0, headEnd).toString('utf8');
    const body = part.slice(headEnd + 4);

    const nameM = /name="([^"]*)"/i.exec(head);
    if (!nameM) continue;
    const name = nameM[1];
    const fileM = /filename="([^"]*)"/i.exec(head);

    if (fileM !== null) {
      const original = fixKoreanName(fileM[1]);
      if (!original) continue; // 빈 파일 입력칸
      const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
      const file = { originalname: original, buffer: body, size: body.length, mimetype: typeM ? typeM[1].trim() : '' };
      if (!req.files[name]) req.files[name] = [];
      req.files[name].push(file);
    } else {
      const value = body.toString('utf8');
      if (req.body[name] === undefined) req.body[name] = value;
      else if (Array.isArray(req.body[name])) req.body[name].push(value);
      else req.body[name] = [req.body[name], value];
    }
  }
}

/** 일부 브라우저가 한글 파일명을 latin1 로 보내는 경우 복원 */
function fixKoreanName(name) {
  if (!name) return '';
  if (/[-ÿ]/.test(name) && !/[가-힣]/.test(name)) {
    try {
      const fixed = Buffer.from(name, 'latin1').toString('utf8');
      if (!fixed.includes('�')) return fixed;
    } catch (e) { /* noop */ }
  }
  return name;
}

module.exports = { App, MIME };
