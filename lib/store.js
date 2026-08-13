'use strict';
/**
 * 데이터 저장소
 *
 * - Supabase 환경변수가 설정되어 있으면  Supabase Storage 에 저장합니다.
 *   (Render 무료 요금제처럼 서버가 재시작돼도 자료가 남습니다)
 * - 설정되어 있지 않으면 이 컴퓨터의 data/ 폴더에 저장합니다.
 *
 * 읽기는 메모리에서 즉시 처리하고, 쓰기는 순서를 지켜 한 번에 하나씩 올립니다.
 */
const fs = require('fs');
const path = require('path');
const cloud = require('./cloud');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

const EMPTY = () => ({ seq: 0, rows: [] });

class Table {
  constructor(name) {
    this.name = name;
    this.remotePath = `db/${name}.json`;
    this.db = EMPTY();
    this._queue = Promise.resolve();
    if (!cloud.enabled) {
      ensureDir();
      this.file = path.join(DATA_DIR, name + '.json');
    }
  }

  /** 서버 시작 시 1회 호출 */
  async load() {
    if (cloud.enabled) {
      const buf = await cloud.get(this.remotePath);
      this.db = buf ? this._parse(buf.toString('utf8')) : EMPTY();
    } else {
      if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify(EMPTY(), null, 2), 'utf8');
      this.db = this._parse(fs.readFileSync(this.file, 'utf8'));
    }
    return this;
  }

  _parse(text) {
    try {
      const d = JSON.parse(text);
      if (!Array.isArray(d.rows)) d.rows = [];
      if (typeof d.seq !== 'number') d.seq = d.rows.length;
      return d;
    } catch (e) {
      console.error(`[store] ${this.name} 데이터를 읽지 못해 빈 상태로 시작합니다.`, e.message);
      return EMPTY();
    }
  }

  /** 쓰기는 순서대로 한 건씩 (동시 저장으로 내용이 덮이는 것을 방지) */
  _save() {
    const snapshot = JSON.stringify(this.db, null, 2);
    this._queue = this._queue.then(async () => {
      if (cloud.enabled) {
        await cloud.put(this.remotePath, snapshot, 'application/json; charset=utf-8');
      } else {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, snapshot, 'utf8');
        fs.renameSync(tmp, this.file);
      }
    });
    return this._queue;
  }

  nextSeq() {
    this.db.seq += 1;
    return this.db.seq;
  }

  all() { return this.db.rows.slice(); }
  find(fn) { return this.db.rows.find(fn); }
  filter(fn) { return this.db.rows.filter(fn); }

  async insert(row) {
    this.db.rows.push(row);
    await this._save();
    return row;
  }

  async update(id, patch) {
    const row = this.db.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    await this._save();
    return row;
  }

  async remove(id) {
    const i = this.db.rows.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.db.rows.splice(i, 1);
    await this._save();
    return true;
  }
}

module.exports = { Table, DATA_DIR };
