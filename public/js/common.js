/* 공통 스크립트 — 헤더/푸터 렌더링, 설정 로드, 유틸 */
(function () {
  'use strict';

  window.LAITY = {
    config: null,

    async loadConfig() {
      if (this.config) return this.config;
      const r = await fetch('/api/config');
      const j = await r.json();
      this.config = j.config;
      return this.config;
    },

    header(active) {
      const menu = [
        ['/', '대회 안내'],
        ['/apply', '참가 신청'],
        ['/check', '접수 확인'],
        ['/qna', 'Q&A'],
      ];
      return `
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/">
      <img src="/img/logo-symbol.png" alt="광주대학교">
      <span class="bar"></span>
      <span class="txt">L<em>'AI'</em>TY 경진대회<small>대학 행정의 새로운 빛을 밝히다</small></span>
    </a>
    <button class="nav-toggle" type="button" aria-label="메뉴" onclick="document.querySelector('.nav').classList.toggle('open')">☰</button>
    <nav class="nav">
      ${menu.map(([h, t]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${t}</a>`).join('')}
    </nav>
  </div>
</header>`;
    },

    footer(c) {
      const k = c.contact || {};
      return `
<footer class="site-footer">
  <div class="wrap">
    <div class="cols">
      <div>
        <h4>${c.contest.round} ${c.contest.title}</h4>
        <p>${c.contest.slogan}</p>
        <p>주제 · ${c.contest.subject}</p>
      </div>
      <div>
        <h4>문의</h4>
        <p>${k.dept || ''} ${k.person || ''}</p>
        <p>${k.tel || ''}</p>
        <p><a href="mailto:${k.email || ''}">${k.email || ''}</a></p>
        <p>${k.hours || ''}</p>
      </div>
      <div>
        <h4>바로가기</h4>
        <p><a href="/apply">참가 신청하기</a></p>
        <p><a href="/check">접수 확인 · 수정</a></p>
        <p><a href="/qna">자주 묻는 질문</a></p>
        <p><a href="/admin">관리자</a></p>
      </div>
      <div>
        <img class="emblem" src="/img/emblem-beige.png" alt="광주대학교 엠블럼">
      </div>
    </div>
    <div class="bottom">
      <span>© ${new Date().getFullYear()} 광주대학교. 교내 구성원 전용 사이트입니다.</span>
      <span>제출 자료는 심사 목적으로만 사용됩니다.</span>
    </div>
  </div>
</footer>`;
    },

    async mount(active) {
      const c = await this.loadConfig();
      const h = document.getElementById('header');
      const f = document.getElementById('footer');
      if (h) h.outerHTML = this.header(active);
      if (f) f.outerHTML = this.footer(c);
      return c;
    },

    fmtSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    },

    fmtDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    dday(closeDate) {
      const end = new Date(closeDate + 'T23:59:59');
      const diff = Math.ceil((end - new Date()) / 86400000);
      if (diff > 0) return `D-${diff}`;
      if (diff === 0) return '오늘 마감';
      return '접수 마감';
    },

    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    msg(el, type, text) {
      el.className = 'msg show ' + type;
      el.textContent = text;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    hideMsg(el) { el.className = 'msg'; },
  };

  // 이전 이름 호환
  window.LAIGHT = window.LAITY;
})();
