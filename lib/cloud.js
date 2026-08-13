'use strict';
/**
 * Supabase Storage 연동 (외부 라이브러리 없이 Node 기본 fetch 만 사용)
 *
 * 환경변수 3개가 설정되어 있으면 신청 데이터와 첨부파일을 Supabase 에 저장합니다.
 * 설정하지 않으면 기존처럼 이 컴퓨터의 data/ · uploads/ 폴더에 저장합니다.
 *
 *   SUPABASE_URL     예) https://abcdefgh.supabase.co
 *   SUPABASE_KEY     Settings > API > service_role 키
 *   SUPABASE_BUCKET  기본값 laity
 */

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'laity';

const enabled = !!(URL_BASE && KEY);

function endpoint(objectPath) {
  return `${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`;
}

function headers(extra) {
  return Object.assign({
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
  }, extra || {});
}

/** 객체 올리기 (있으면 덮어쓰기) */
async function put(objectPath, data, contentType) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const res = await fetch(endpoint(objectPath), {
    method: 'POST',
    headers: headers({
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
      'Cache-Control': 'no-cache',
    }),
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase 업로드 실패 (${res.status}) ${objectPath} ${t.slice(0, 200)}`);
  }
}

/** 객체 내려받기. 없으면 null */
async function get(objectPath) {
  const res = await fetch(endpoint(objectPath), { method: 'GET', headers: headers() });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase 다운로드 실패 (${res.status}) ${objectPath} ${t.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** 객체 삭제 */
async function del(objectPath) {
  try {
    await fetch(endpoint(objectPath), { method: 'DELETE', headers: headers() });
  } catch (e) { /* 삭제 실패는 무시 */ }
}

/** 연결 확인 — 서버 시작 시 1회 호출 */
async function check() {
  if (!enabled) return { enabled: false };
  const probe = '_healthcheck.txt';
  await put(probe, `ok ${new Date().toISOString()}`, 'text/plain; charset=utf-8');
  const back = await get(probe);
  if (!back) throw new Error('Supabase 저장소에서 파일을 다시 읽지 못했습니다.');
  return { enabled: true, url: URL_BASE, bucket: BUCKET };
}

module.exports = { enabled, put, get, del, check, BUCKET, URL_BASE };
