'use strict';
/**
 * 아주 작은 ZIP 작성기 (외부 라이브러리 없이 Node 기본 모듈만 사용)
 * - 한글 파일명이 깨지지 않도록 UTF-8 플래그(bit 11)를 설정합니다.
 * - 스트림으로 바로 내보낼 수 있어 큰 첨부파일도 메모리를 적게 씁니다.
 */
const zlib = require('zlib');
const fs = require('fs');

/* CRC32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

class ZipWriter {
  /** @param {NodeJS.WritableStream} out */
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    this.now = new Date();
  }

  _write(buf) {
    this.out.write(buf);
    this.offset += buf.length;
  }

  /** 버퍼 하나를 항목으로 추가 */
  addBuffer(name, data, { store = false } = {}) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const crc = crc32(raw);
    const body = store ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const method = store ? 0 : 8;
    const { time, date } = dosDateTime(this.now);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 파일명
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const entryOffset = this.offset;
    this._write(local);
    this._write(nameBuf);
    this._write(body);

    this.entries.push({ nameBuf, crc, csize: body.length, usize: raw.length, method, time, date, offset: entryOffset });
  }

  /** 디스크의 파일을 항목으로 추가 */
  addFile(name, filePath) {
    this.addBuffer(name, fs.readFileSync(filePath));
  }

  /** 중앙 디렉터리 기록 후 종료 */
  finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(e.method, 10);
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.csize, 20);
      cd.writeUInt32LE(e.usize, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);
      cd.writeUInt16LE(0, 32);
      cd.writeUInt16LE(0, 34);
      cd.writeUInt16LE(0, 36);
      cd.writeUInt32LE(0, 38);
      cd.writeUInt32LE(e.offset, 42);
      this._write(cd);
      this._write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    this._write(eocd);
    this.out.end();
  }
}

/** 메모리에서 ZIP 버퍼를 만듭니다. files = [{name, data}] */
function zipToBuffer(files) {
  const chunks = [];
  const fake = { write: (b) => chunks.push(Buffer.from(b)), end: () => {} };
  const z = new ZipWriter(fake);
  for (const f of files) z.addBuffer(f.name, f.data);
  z.finish();
  return Buffer.concat(chunks);
}

module.exports = { ZipWriter, zipToBuffer, crc32 };
