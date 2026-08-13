'use strict';
/**
 * 제1회 광주대학교 L'AI'TY 경진대회 참가신청 사이트
 *
 * 외부 라이브러리를 전혀 사용하지 않습니다. (npm install 불필요)
 * Node.js 만 설치되어 있으면  node server.js  로 바로 실행됩니다.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { App } = require('./lib/http');
const { Table } = require('./lib/store');
const { ZipWriter } = require('./lib/zip');
const { buildXlsx } = require('./lib/xlsx');
const cloud = require('./lib/cloud');
const U = require('./lib/util');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
let CONFIG = loadConfig();

const apps = new Table('applications');
const qnas = new Table('questions');
const app = new App();

/* ---------------------------------------------------------------
 * 업로드 저장
 * ------------------------------------------------------------- */
function allowedExt() {
  return (CONFIG.upload.allowedExt || []).map((e) => e.toLowerCase());
}

function checkFiles(files) {
  const max = (CONFIG.upload.maxFileSizeMB || 50) * 1024 * 1024;
  const allow = allowedExt();
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (allow.length && !allow.includes(ext)) {
      throw new Error(`허용되지 않는 파일 형식입니다 (${ext}). 허용: ${allow.join(', ')}`);
    }
    if (f.size > max) {
      throw new Error(`파일이 너무 큽니다 (${f.originalname}). 최대 ${CONFIG.upload.maxFileSizeMB}MB 까지 올릴 수 있습니다.`);
    }
  }
}

const remotePath = (stored) => `uploads/${stored}`;

async function saveFile(f) {
  const ext = path.extname(f.originalname).toLowerCase();
  const stored = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  if (cloud.enabled) {
    await cloud.put(remotePath(stored), f.buffer, f.mimetype || 'application/octet-stream');
  } else {
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.buffer);
  }
  return {
    id: U.randomId(),
    stored,
    original: f.originalname,
    size: f.size,
    uploadedAt: new Date().toISOString(),
  };
}

async function saveFiles(list) {
  const out = [];
  for (const f of list) out.push(await saveFile(f));
  return out;
}

async function removeStored(meta) {
  if (!meta || !meta.stored) return;
  if (cloud.enabled) return cloud.del(remotePath(meta.stored));
  const p = path.join(UPLOAD_DIR, path.basename(meta.stored));
  if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) { /* noop */ } }
}

/** 저장된 파일의 내용을 버퍼로 읽어옵니다. 없으면 null */
async function readStored(meta) {
  if (!meta || !meta.stored) return null;
  if (cloud.enabled) return cloud.get(remotePath(meta.stored));
  const p = path.join(UPLOAD_DIR, path.basename(meta.stored));
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function sendDownload(res, meta) {
  const buf = await readStored(meta);
  if (!buf) return res.status(404).send('파일이 존재하지 않습니다.');
  res.setHeader('Content-Disposition', U.contentDisposition(meta.original));
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

/* ---------------------------------------------------------------
 * 관리자 인증
 * ------------------------------------------------------------- */
const SECRET = crypto.randomBytes(32).toString('hex');

function issueToken() {
  const payload = `admin.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function validToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  return Date.now() - Number(payload.split('.')[1]) < 1000 * 60 * 60 * 12;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAdmin(req) { return validToken(readCookie(req, 'laity_admin')); }
function denyAdmin(res) { res.status(401).json({ ok: false, error: '관리자 로그인이 필요합니다.' }); }

/* ---------------------------------------------------------------
 * 공개 API
 * ------------------------------------------------------------- */
app.get('/healthz', (req, res) => res.send('ok', 'text/plain; charset=utf-8'));

app.get('/api/config', (req, res) => {
  CONFIG = loadConfig();
  const { adminPassword, ...safe } = CONFIG;
  res.json({ ok: true, config: safe });
});

const CATEGORY_NAME = (key) => {
  const c = (CONFIG.categories || []).find((x) => x.key === key);
  return c ? c.name : key || '';
};

function publicView(row) {
  const { pwSalt, pwHash, ...rest } = row;
  return rest;
}

const one = (v) => (Array.isArray(v) ? v[0] : v);
const txt = (v) => String(one(v) == null ? '' : one(v)).trim();

app.post('/api/applications', async (req, res) => {
  const b = req.body;
  const required = ['teamName', 'leaderName', 'leaderDept', 'leaderPhone', 'leaderEmail',
    'category', 'caseName', 'aiTools', 'targetTask', 'summary', 'password'];
  for (const k of required) {
    if (!txt(b[k])) return res.status(400).json({ ok: false, error: '필수 항목이 비어 있습니다: ' + k });
  }
  if (!/^\d{4,12}$/.test(txt(b.password))) {
    return res.status(400).json({ ok: false, error: '수정용 비밀번호는 숫자 4~12자리로 입력해 주세요.' });
  }
  let agreements = [];
  try { agreements = JSON.parse(txt(b.agreements) || '[]'); } catch (e) { agreements = []; }
  if (agreements.length < 5 || agreements.some((x) => x !== true) || txt(b.agreePrivacy) !== 'true') {
    return res.status(400).json({ ok: false, error: '확인 및 서약 사항과 개인정보 수집·이용에 모두 동의해 주세요.' });
  }
  if (txt(b.summary).length > 300) {
    return res.status(400).json({ ok: false, error: '사례 요약은 300자 이내로 작성해 주세요.' });
  }

  const proposalFiles = req.files.proposal || [];
  const extraFiles = req.files.extras || [];
  try { checkFiles([...proposalFiles, ...extraFiles]); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  let members = [];
  try { members = JSON.parse(txt(b.members) || '[]'); } catch (e) { members = []; }
  members = members.filter((m) => m && m.name && String(m.name).trim()).slice(0, 2);

  const seq = apps.nextSeq();
  const { salt, hash } = U.hashPassword(txt(b.password));
  const cat = txt(b.category);
  const row = {
    id: U.randomId(),
    no: U.makeNo((CONFIG.brand && CONFIG.brand.prefix) || 'LAITY', seq, new Date().getFullYear()),
    seq,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entryType: txt(b.entryType) === 'team' ? 'team' : 'individual',
    teamName: txt(b.teamName),
    leader: {
      name: txt(b.leaderName), dept: txt(b.leaderDept),
      phone: txt(b.leaderPhone), email: txt(b.leaderEmail),
    },
    members,
    category: cat,
    categoryName: cat === 'etc' && txt(b.categoryEtc) ? `기타 (${txt(b.categoryEtc)})` : CATEGORY_NAME(cat),
    categoryEtc: txt(b.categoryEtc),
    caseName: txt(b.caseName),
    aiTools: txt(b.aiTools),
    targetTask: txt(b.targetTask),
    summary: txt(b.summary),
    agreements,
    agreePrivacy: true,
    files: {
      proposal: proposalFiles[0] ? await saveFile(proposalFiles[0]) : null,
      extras: await saveFiles(extraFiles),
    },
    pwSalt: salt,
    pwHash: hash,
  };
  await apps.insert(row);
  res.json({ ok: true, no: row.no });
});

app.post('/api/applications/lookup', (req, res) => {
  const row = apps.find((r) => r.no === txt(req.body.no).toUpperCase());
  if (!row || !U.verifyPassword(txt(req.body.password), row.pwSalt, row.pwHash)) {
    return res.status(404).json({ ok: false, error: '접수번호 또는 비밀번호가 일치하지 않습니다.' });
  }
  res.json({ ok: true, application: publicView(row) });
});

app.post('/api/applications/update', async (req, res) => {
  const b = req.body;
  const row = apps.find((r) => r.no === txt(b.no).toUpperCase());
  if (!row || !U.verifyPassword(txt(b.password), row.pwSalt, row.pwHash)) {
    return res.status(404).json({ ok: false, error: '접수번호 또는 비밀번호가 일치하지 않습니다.' });
  }

  const proposalFiles = req.files.proposal || [];
  const extraFiles = req.files.extras || [];
  try { checkFiles([...proposalFiles, ...extraFiles]); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  const patch = {};
  const fields = ['entryType', 'teamName', 'category', 'categoryEtc', 'caseName', 'aiTools', 'targetTask', 'summary'];
  for (const f of fields) if (b[f] !== undefined) patch[f] = txt(b[f]);
  if (b.category !== undefined) {
    const cat = txt(b.category);
    patch.categoryName = cat === 'etc' && txt(b.categoryEtc) ? `기타 (${txt(b.categoryEtc)})` : CATEGORY_NAME(cat);
  }
  if (b.members !== undefined) {
    try { patch.members = JSON.parse(txt(b.members)).filter((m) => m && m.name && String(m.name).trim()); } catch (e) { /* noop */ }
  }
  if (b.leaderName !== undefined) {
    patch.leader = {
      name: txt(b.leaderName), dept: txt(b.leaderDept),
      phone: txt(b.leaderPhone), email: txt(b.leaderEmail),
    };
  }

  const files = { proposal: row.files.proposal, extras: (row.files.extras || []).slice() };
  if (proposalFiles[0]) {
    await removeStored(files.proposal);
    files.proposal = await saveFile(proposalFiles[0]);
  }
  if (b.removeExtras) {
    let ids = [];
    try { ids = JSON.parse(txt(b.removeExtras)); } catch (e) { ids = []; }
    const keep = [];
    for (const f of files.extras) {
      if (ids.includes(f.id)) await removeStored(f);
      else keep.push(f);
    }
    files.extras = keep;
  }
  files.extras = files.extras.concat(await saveFiles(extraFiles));
  patch.files = files;

  await apps.update(row.id, patch);
  res.json({ ok: true, application: publicView(apps.find((r) => r.id === row.id)) });
});

app.post('/api/applications/file', async (req, res) => {
  const row = apps.find((r) => r.no === txt(req.body.no).toUpperCase());
  if (!row || !U.verifyPassword(txt(req.body.password), row.pwSalt, row.pwHash)) {
    return res.status(404).json({ ok: false, error: '인증에 실패했습니다.' });
  }
  const all = [row.files.proposal, ...(row.files.extras || [])].filter(Boolean);
  const meta = all.find((f) => f.id === req.body.fileId);
  if (!meta) return res.status(404).json({ ok: false, error: '파일을 찾을 수 없습니다.' });
  await sendDownload(res, meta);
});

/* ---------------------------------------------------------------
 * Q&A
 * ------------------------------------------------------------- */
function maskName(name) {
  const s = String(name || '');
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
}

app.get('/api/questions', (req, res) => {
  const rows = qnas.all().sort((a, b) => b.seq - a.seq).map((r) => ({
    id: r.id, no: r.no, seq: r.seq, createdAt: r.createdAt,
    name: maskName(r.name), dept: r.dept, secret: !!r.secret,
    title: r.secret ? '비밀글입니다.' : r.title,
    body: r.secret ? null : r.body,
    answer: r.secret ? (r.answer ? { answeredAt: r.answer.answeredAt } : null) : (r.answer || null),
    answered: !!r.answer,
  }));
  res.json({ ok: true, questions: rows });
});

app.post('/api/questions', async (req, res) => {
  const b = req.body;
  if (!txt(b.name) || !txt(b.title) || !txt(b.body) || !txt(b.password)) {
    return res.status(400).json({ ok: false, error: '이름, 제목, 내용, 비밀번호는 필수입니다.' });
  }
  if (!/^\d{4,12}$/.test(txt(b.password))) {
    return res.status(400).json({ ok: false, error: '비밀번호는 숫자 4~12자리로 입력해 주세요.' });
  }
  const seq = qnas.nextSeq();
  const { salt, hash } = U.hashPassword(txt(b.password));
  const row = {
    id: U.randomId(),
    no: U.makeNo('Q', seq, new Date().getFullYear()),
    seq,
    createdAt: new Date().toISOString(),
    name: txt(b.name), dept: txt(b.dept), email: txt(b.email),
    secret: b.secret === true || txt(b.secret) === 'true',
    title: txt(b.title), body: txt(b.body),
    answer: null, pwSalt: salt, pwHash: hash,
  };
  await qnas.insert(row);
  res.json({ ok: true, no: row.no });
});

app.post('/api/questions/open', (req, res) => {
  const row = qnas.find((r) => r.id === req.body.id);
  if (!row) return res.status(404).json({ ok: false, error: '글을 찾을 수 없습니다.' });
  if (!U.verifyPassword(txt(req.body.password), row.pwSalt, row.pwHash)) {
    return res.status(403).json({ ok: false, error: '비밀번호가 일치하지 않습니다.' });
  }
  res.json({ ok: true, question: { title: row.title, body: row.body, answer: row.answer || null } });
});

/* ---------------------------------------------------------------
 * 관리자
 * ------------------------------------------------------------- */
app.post('/api/admin/login', (req, res) => {
  CONFIG = loadConfig();
  if (txt(req.body.password) !== String(CONFIG.adminPassword)) {
    return res.status(403).json({ ok: false, error: '비밀번호가 일치하지 않습니다.' });
  }
  res.setHeader('Set-Cookie', `laity_admin=${issueToken()}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'laity_admin=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => res.json({ ok: isAdmin(req) }));

app.get('/api/admin/applications', (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  res.json({ ok: true, applications: apps.all().sort((a, b) => a.seq - b.seq).map(publicView) });
});

app.get('/api/admin/questions', (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  res.json({ ok: true, questions: qnas.all().sort((a, b) => b.seq - a.seq).map(publicView) });
});

app.post('/api/admin/questions/answer', async (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  const row = qnas.find((r) => r.id === req.body.id);
  if (!row) return res.status(404).json({ ok: false, error: '글을 찾을 수 없습니다.' });
  const body = txt(req.body.body);
  await qnas.update(row.id, { answer: body ? { body, answeredAt: new Date().toISOString() } : null });
  res.json({ ok: true });
});

app.post('/api/admin/applications/delete', async (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  const row = apps.find((r) => r.id === req.body.id);
  if (!row) return res.status(404).json({ ok: false, error: '신청서를 찾을 수 없습니다.' });
  await removeStored(row.files && row.files.proposal);
  for (const f of ((row.files && row.files.extras) || [])) await removeStored(f);
  await apps.remove(row.id);
  res.json({ ok: true });
});

app.get('/api/admin/file/:fileId', async (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  for (const row of apps.all()) {
    const all = [row.files && row.files.proposal, ...((row.files && row.files.extras) || [])].filter(Boolean);
    const meta = all.find((f) => f.id === req.params.fileId);
    if (meta) return sendDownload(res, meta);
  }
  res.status(404).send('파일을 찾을 수 없습니다.');
});

app.get('/api/admin/files.zip', async (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', U.contentDisposition(`LAITY_첨부파일_${U.todayISO()}.zip`));
  const zip = new ZipWriter(res);
  for (const row of apps.all().sort((a, b) => a.seq - b.seq)) {
    const folder = U.safeName(`${row.no}_${row.leader.name}_${row.caseName}`);
    const list = [];
    if (row.files && row.files.proposal) list.push(['제안서_' + row.files.proposal.original, row.files.proposal]);
    ((row.files && row.files.extras) || []).forEach((f, i) => list.push([`증빙${i + 1}_` + f.original, f]));
    for (const [name, meta] of list) {
      const buf = await readStored(meta);
      if (buf) zip.addBuffer(`${folder}/${U.safeName(name)}`, buf);
    }
  }
  zip.finish();
});

app.get('/api/admin/applications.xlsx', (req, res) => {
  if (!isAdmin(req)) return denyAdmin(res);

  const columns = [
    ['접수번호', 16], ['접수일시', 18], ['참가구분', 10], ['팀명', 18], ['대표자', 10],
    ['소속(부서)', 20], ['연락처', 16], ['이메일', 26], ['팀원', 30],
    ['응모분야', 20], ['사례명', 30], ['활용 AI 도구', 26], ['적용 업무', 24],
    ['사례 요약', 60], ['제안서', 28], ['증빙자료 수', 12], ['증빙자료 목록', 40], ['최종수정', 18],
  ].map(([header, width]) => ({ header, width }));

  const rows = apps.all().sort((a, b) => a.seq - b.seq).map((r) => [
    r.no, U.fmtDateTime(r.createdAt), r.entryType === 'team' ? '팀' : '개인', r.teamName,
    r.leader.name, r.leader.dept, r.leader.phone, r.leader.email,
    (r.members || []).map((m) => `${m.name}(${m.dept || ''})`).join(', '),
    r.categoryName || r.category, r.caseName, r.aiTools, r.targetTask, r.summary,
    r.files && r.files.proposal ? r.files.proposal.original : '(미제출)',
    (r.files && r.files.extras ? r.files.extras.length : 0),
    (r.files && r.files.extras ? r.files.extras : []).map((f) => f.original).join(', '),
    U.fmtDateTime(r.updatedAt),
  ]);

  const qCols = [['번호', 14], ['등록일시', 18], ['작성자', 12], ['소속', 18], ['비밀글', 8],
    ['제목', 30], ['내용', 60], ['답변', 60], ['답변일시', 18]].map(([header, width]) => ({ header, width }));
  const qRows = qnas.all().sort((a, b) => a.seq - b.seq).map((q) => [
    q.no, U.fmtDateTime(q.createdAt), q.name, q.dept, q.secret ? 'O' : '',
    q.title, q.body, q.answer ? q.answer.body : '', q.answer ? U.fmtDateTime(q.answer.answeredAt) : '',
  ]);

  const buf = buildXlsx([
    { name: '참가신청 목록', columns, rows, freezeHeader: true, autoFilter: true },
    { name: '질의응답', columns: qCols, rows: qRows, freezeHeader: true },
  ]);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', U.contentDisposition(`LAITY_참가신청목록_${U.todayISO()}.xlsx`));
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

/* ---------------------------------------------------------------
 * 페이지 & 정적 파일
 * ------------------------------------------------------------- */
const page = (name) => (req, res) => res.sendFile(path.join(ROOT, 'public', name));
app.get('/', page('index.html'));
app.get('/apply', page('apply.html'));
app.get('/check', page('check.html'));
app.get('/qna', page('qna.html'));
app.get('/admin', page('admin.html'));

app.static('/forms', path.join(ROOT, 'forms'));
app.static('/', path.join(ROOT, 'public'));

app.notFound = (req, res) => {
  res.statusCode = 404;
  res.sendFile(path.join(ROOT, 'public', '404.html'));
};

/* ---------------------------------------------------------------
 * 서버 시작
 * ------------------------------------------------------------- */
const PORT = Number(process.env.PORT || CONFIG.port || 3000);
async function boot() {
  if (cloud.enabled) {
    try {
      const info = await cloud.check();
      console.log(`  [storage] Supabase 연결 OK  (bucket: ${info.bucket})`);
    } catch (e) {
      console.error('  [storage] Supabase 연결 실패:', e.message);
      console.error('  SUPABASE_URL / SUPABASE_KEY / SUPABASE_BUCKET 설정을 확인해 주세요.');
      process.exit(1);
    }
  } else {
    console.log('  [storage] 이 컴퓨터의 data/ · uploads/ 폴더에 저장합니다.');
  }
  await apps.load();
  await qnas.load();
  console.log(`  [storage] 신청 ${apps.all().length}건 · 질문 ${qnas.all().length}건 불러옴`);
  start();
}

function start() {
const server = app.listen(PORT, () => {
  console.log('');
  console.log("  L'AI'TY Contest server is running.");
  console.log(`    Site  :  http://localhost:${PORT}`);
  console.log(`    Admin :  http://localhost:${PORT}/admin`);
  console.log('');
  console.log('  [ 이 창을 닫으면 사이트가 중지됩니다 ]');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  [!] Port ${PORT} is already in use.`);
    console.log('      이미 실행 중인 창이 있는지 확인하거나, config.json 의 port 값을 3001 로 바꿔 주세요.');
    console.log('');
  } else {
    console.error(e);
  }
  process.exit(1);
});
}

boot().catch((e) => { console.error(e); process.exit(1); });
