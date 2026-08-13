'use strict';
/**
 * 아주 작은 JSON 파일 저장소.
 * 별도 DB 설치 없이 data/*.json 파일에 저장하며, 저장할 때마다 임시파일에
 * 먼저 쓰고 교체하는 방식(atomic write)이라 중간에 꺼져도 파일이 깨지지 않습니다.
 * 백업이 필요하면 data 폴더와 uploads 폴더만 복사하면 됩니다.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

class Table {
  constructor(name) {
    ensureDir();
    this.file = path.join(DATA_DIR, name + '.json');
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify({ seq: 0, rows: [] }, null, 2), 'utf8');
    }
    this._load();
  }

  _load() {
    try {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      this.db = { seq: 0, rows: [] };
    }
    if (!Array.isArray(this.db.rows)) this.db.rows = [];
    if (typeof this.db.seq !== 'number') this.db.seq = this.db.rows.length;
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  nextSeq() {
    this.db.seq += 1;
    return this.db.seq;
  }

  all() {
    return this.db.rows.slice();
  }

  find(fn) {
    return this.db.rows.find(fn);
  }

  filter(fn) {
    return this.db.rows.filter(fn);
  }

  insert(row) {
    this.db.rows.push(row);
    this._save();
    return row;
  }

  update(id, patch) {
    const row = this.db.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    this._save();
    return row;
  }

  remove(id) {
    const i = this.db.rows.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.db.rows.splice(i, 1);
    this._save();
    return true;
  }
}

module.exports = { Table, DATA_DIR };
