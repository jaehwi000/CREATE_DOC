/* 문서 양식 분석 · 프롬프트 조립 · 결과 점검 (브라우저/Node 공용, 외부 의존성 없음) */
(function (root) {
  'use strict';

  const DAY = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 문서 유형 정의 ----------
  const DOC_TYPES = {
    bokmyeong: {
      label: '출장복명서',
      defaultSections: ['출장 개요', '주요 내용', '시사점 및 향후 조치'],
      fields: [
        { id: 'traveler', label: '출장자 (소속·직급·성명)', type: 'text', required: true, ph: '기획처 기획평가팀 주무관 홍길동, 주무관 최OO' },
        { id: 'dateFrom', label: '출장 시작일', type: 'date', required: true },
        { id: 'dateTo', label: '출장 종료일', type: 'date', required: true },
        { id: 'place', label: '출장지', type: 'text', required: true, ph: '세종 한국교육개발원 세미나실' },
        { id: 'purpose', label: '출장 목적', type: 'text', required: true, ph: '2027 대학정보공시 개편 설명회 참석' },
        { id: 'outcome', label: '시사점·향후 조치 (메모 수준)', type: 'textarea', required: false, ph: '내부 설명회 11월 개최 검토 등' },
        { id: 'attach', label: '붙임', type: 'text', required: false, ph: '설명회 자료집 1부' }
      ]
    },
    jichul: {
      label: '지출결의서',
      defaultSections: ['관련', '지출 개요', '지출내역', '지급방법', '붙임'],
      fields: [
        { id: 'related', label: '관련 문서·근거 규정', type: 'textarea', required: true, ph: '기획처-2045(2026. 9. 30.) 출장 신청\n여비규정 제8조' },
        { id: 'title', label: '건명', type: 'text', required: true, ph: '정보공시 개편 설명회 출장 여비 지급' },
        { id: 'project', label: '사업명', type: 'text', required: false, ph: '대학혁신지원사업' },
        { id: 'budget', label: '예산과목', type: 'text', required: true, ph: '운영비 > 여비 > 국내여비' },
        { id: 'items', label: '지출내역', type: 'items', required: true },
        { id: 'payMethod', label: '지급방법', type: 'text', required: false, ph: '출장자 개인계좌 입금' },
        { id: 'attach', label: '붙임', type: 'text', required: false, ph: '출장복명서 1부, 영수증 1부' }
      ]
    }
  };

  // ---------- 날짜·금액 유틸 ----------
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function fmtDate(iso, style) {
    const d = parseISO(iso);
    if (!d) return iso || '';
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate(), w = DAY[d.getUTCDay()];
    if (style === 'korean') return `${y}년 ${mo}월 ${da}일(${w})`;
    if (style === 'dash') return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}(${w})`;
    return `${y}. ${mo}. ${da}.(${w})`;
  }
  function won(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function hangulAmount(n) {
    n = Math.floor(Number(n) || 0);
    if (n === 0) return '영';
    const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const small = ['', '십', '백', '천'];
    const big = ['', '만', '억', '조'];
    let out = '', g = 0;
    while (n > 0) {
      const chunk = n % 10000;
      if (chunk) {
        let s = '', c = chunk, i = 0;
        while (c > 0) {
          const d = c % 10;
          if (d) s = (d === 1 && i === 1 ? '' : digits[d]) + small[i] + s;
          c = Math.floor(c / 10); i++;
        }
        out = s + big[g] + out;
      }
      n = Math.floor(n / 10000); g++;
    }
    return out;
  }

  // ---------- 양식 분석 (규칙 기반) ----------
  const MARKERS = [
    { key: '1.', re: /^\d{1,2}\.\s/ },
    { key: '가.', re: /^[가-하]\.\s/ },
    { key: '1)', re: /^\d{1,2}\)\s/ },
    { key: '가)', re: /^[가-하]\)\s/ },
    { key: '(1)', re: /^\(\d{1,2}\)\s/ },
    { key: '(가)', re: /^\([가-하]\)\s/ },
    { key: '①', re: /^[①-⑳]\s?/ },
    { key: '○', re: /^[○◦]\s?/ },
    { key: '-', re: /^[-–·•]\s/ },
    { key: '□', re: /^[□■]\s?/ }
  ];

  function lineEnding(t) {
    t = t.replace(/\s+$/, '').replace(/[.。]$/, '').replace(/\)$/, '');
    if (/(습니다|합니다|됩니다|입니다)$/.test(t)) return '합니다체';
    if (/다$/.test(t)) return '서술형(~다)';
    if (/(함|음|임|됨|있음|없음|바람|예정|필요|검토|추진|완료|실시|중)$/.test(t)) return '개조식(~함/~음)';
    return null;
  }

  function analyzeSamples(texts) {
    const markerFirst = {}; const markerIndent = {}; const markerCount = {};
    const endings = {}; const dateStyles = {}; const moneyStyles = {};
    const headingCounter = {}; const labelCounter = {};
    let keut = 0, attachLabel = null, openings = [], titleLines = [];

    texts.forEach((raw, si) => {
      const lines = raw.replace(/\r/g, '').split('\n');
      const nonEmpty = lines.filter(l => l.trim());
      if (nonEmpty[0] && nonEmpty[0].trim().length <= 20 && !MARKERS.some(m => m.re.test(nonEmpty[0].trim()))) {
        titleLines.push(nonEmpty[0].trim());
      }
      let order = 0, inAttach = false;
      lines.forEach(line => {
        const t = line.trim();
        if (!t) return;
        if (/^(붙\s*임|첨\s*부)/.test(t)) inAttach = true;
        const isOpening = /다음과 같이|아래와 같이|보고합니다|지출하고자|보고드립니다/.test(t);
        if (isOpening && openings.length < 4) openings.push(t.replace(/^\d{1,2}\.\s/, '').slice(0, 80));
        const indent = line.length - line.replace(/^[\s　]+/, '').length;
        const mk = inAttach ? null : MARKERS.find(m => m.re.test(t));
        if (mk && !isOpening) {
          markerCount[mk.key] = (markerCount[mk.key] || 0) + 1;
          if (markerFirst[mk.key] === undefined) markerFirst[mk.key] = si * 10000 + order++;
          (markerIndent[mk.key] = markerIndent[mk.key] || []).push(indent);
          const body = t.replace(mk.re, '').trim();
          if (mk.key === '1.' && body.length <= 18 && !/[.:：]$/.test(body) && !/다\.?$/.test(body)) {
            headingCounter[body] = (headingCounter[body] || 0) + 1;
          }
          const lab = /^([가-힣\s]{2,10})[:：](?!\s*\d)/.exec(body);
          if (lab) { const k = lab[1].replace(/\s+/g, ''); labelCounter[k] = labelCounter[k] || { n: 0, raw: lab[1] }; labelCounter[k].n++; }
          const e = lineEnding(body.replace(/^[가-힣\s]{2,10}[:：]/, ''));
          if (e && !lab) endings[e] = (endings[e] || 0) + 1;
        } else {
          const e = isOpening ? null : lineEnding(t);
          if (e && !inAttach) endings[e] = (endings[e] || 0) + 1;
        }
        if (/끝\.\s*$/.test(t)) keut++;
        const at = /^(붙\s*임|첨\s*부)/.exec(t);
        if (at && !attachLabel) attachLabel = at[1].replace(/\s/g, '') === '붙임' ? '붙임' : '첨부';
        if (/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/.test(t)) dateStyles['2026. 10. 16.'] = (dateStyles['2026. 10. 16.'] || 0) + 1;
        if (/\d{4}년\s?\d{1,2}월\s?\d{1,2}일/.test(t)) dateStyles['2026년 10월 16일'] = (dateStyles['2026년 10월 16일'] || 0) + 1;
        if (/\d{4}-\d{2}-\d{2}/.test(t)) dateStyles['2026-10-16'] = (dateStyles['2026-10-16'] || 0) + 1;
        if (/\(\s?[월화수목금토일]\s?\)/.test(t)) dateStyles['요일표기'] = (dateStyles['요일표기'] || 0) + 1;
        if (/금\s?[\d,]+원\s?\(금[가-힣]+원(정)?\)/.test(t)) moneyStyles['금 1,000원(금일천원)'] = (moneyStyles['금 1,000원(금일천원)'] || 0) + 1;
        else if (/[\d,]{4,}원/.test(t)) moneyStyles['1,000원'] = (moneyStyles['1,000원'] || 0) + 1;
        if (/[₩\\][\d,]+/.test(t)) moneyStyles['₩1,000'] = (moneyStyles['₩1,000'] || 0) + 1;
      });
    });

    const numbering = Object.keys(markerFirst)
      .map(k => ({ k, ind: Math.min(...markerIndent[k]), first: markerFirst[k], n: markerCount[k] }))
      .sort((a, b) => a.ind - b.ind || a.first - b.first)
      .map(x => x.k);

    const minShare = Math.max(1, Math.ceil(texts.length / 2));
    const sections = Object.entries(headingCounter).filter(([, n]) => n >= minShare).map(([h]) => h);
    const labels = Object.values(labelCounter).filter(x => x.n >= minShare).map(x => x.raw.trim());
    const topEnding = Object.entries(endings).sort((a, b) => b[1] - a[1])[0];
    const dateFormat = ['2026. 10. 16.', '2026년 10월 16일', '2026-10-16'].sort((a, b) => (dateStyles[b] || 0) - (dateStyles[a] || 0))[0];
    const moneyFormat = Object.entries(moneyStyles).sort((a, b) => b[1] - a[1])[0];

    return {
      title: mode(titleLines) || '',
      numbering,
      sections,
      labels,
      ending: topEnding ? topEnding[0] : '개조식(~함/~음)',
      endingStats: endings,
      dateFormat: (dateStyles[dateFormat] ? dateFormat : '2026. 10. 16.'),
      weekday: !!dateStyles['요일표기'],
      moneyFormat: moneyStyles['금 1,000원(금일천원)'] ? '총액은 "금 1,350,000원(금일백삼십오만원)" 형식, 세부 항목은 "1,000원" 형식' : (moneyFormat ? moneyFormat[0] : '1,000원'),
      useKeut: keut >= minShare,
      attachLabel: attachLabel || '붙임',
      openings: [...new Set(openings)],
      notes: ''
    };
  }
  function avg(a) { return a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function mode(a) {
    const c = {}; a.forEach(x => c[x] = (c[x] || 0) + 1);
    const e = Object.entries(c).sort((x, y) => y[1] - x[1])[0];
    return e && e[1] >= 1 ? e[0] : '';
  }

  function dateStyleKey(fmt) {
    if (fmt === '2026년 10월 16일') return 'korean';
    if (fmt === '2026-10-16') return 'dash';
    return 'dot';
  }

  // ---------- 프롬프트 조립 ----------
  function profileToRules(p) {
    const r = [];
    if (p.title) r.push(`- 문서 첫 줄 제목: "${p.title}"`);
    if (p.sections.length) r.push(`- 대항목(1단계) 순서: ${p.sections.map((s, i) => `${i + 1}. ${s}`).join(' / ')}`);
    if (p.numbering.length) r.push(`- 번호 체계(상위→하위): ${p.numbering.join(' → ')}. 하위 단계는 두 칸씩 들여쓴다.`);
    if (p.labels.length) r.push(`- 개요 항목은 "라벨: 값" 형식으로 쓴다. 사용 라벨: ${p.labels.join(', ')}`);
    r.push(`- 문체: ${p.ending}. ${p.ending.startsWith('개조식') ? '항목 문장은 "~함, ~음, ~임, ~예정" 등 명사형으로 끝내고 "~다."로 끝내지 않는다. 단, 본문 도입 문장(예: "다음과 같이 ~하고자 합니다.")은 예시 문서의 방식을 따른다.' : ''}`);
    r.push(`- 날짜 표기: ${p.dateFormat} 형식${p.weekday ? ', 괄호 안에 요일 표기 예: 2026. 10. 16.(금)' : ''}`);
    r.push(`- 금액 표기: ${p.moneyFormat}`);
    r.push(`- 첨부 표기 라벨: "${p.attachLabel}"`);
    if (p.useKeut) r.push('- 문서 마지막 줄은 두 칸 띄우고 "끝."으로 맺는다.');
    if (p.openings.length) r.push(`- 참고 도입 문장: ${p.openings.map(o => `"${o}"`).join(' / ')}`);
    if (p.notes) r.push(`- 추가 지침: ${p.notes}`);
    return r.join('\n');
  }

  function factsBlock(typeKey, f) {
    const p = f._profile || {};
    const ds = dateStyleKey(p.dateFormat);
    const L = [];
    if (typeKey === 'bokmyeong') {
      L.push(`출장자: ${f.traveler || ''}`);
      if (f.dateFrom) {
        const same = !f.dateTo || f.dateTo === f.dateFrom;
        const nights = same ? 0 : Math.round((parseISO(f.dateTo) - parseISO(f.dateFrom)) / 86400000);
        L.push(`출장기간: ${fmtDate(f.dateFrom, ds)}${same ? ', 당일' : ` ~ ${fmtDate(f.dateTo, ds)}, ${nights}박 ${nights + 1}일`}  ← 이 표기를 그대로 사용`);
      }
      L.push(`출장지: ${f.place || ''}`);
      L.push(`출장목적: ${f.purpose || ''}`);
      if (f.outcome) L.push(`시사점·향후 조치 메모: ${f.outcome}`);
      if (f.attach) L.push(`붙임: ${f.attach}`);
    } else {
      if (f.related) L.push(`관련 문서·근거:\n${f.related}`);
      L.push(`건명: ${f.title || ''}`);
      if (f.project) L.push(`사업명: ${f.project}`);
      L.push(`예산과목: ${f.budget || ''}`);
      const items = (f.items || []).filter(i => i.name || i.amount);
      if (items.length) {
        L.push('지출내역 (계산 완료값 — 숫자를 바꾸지 말 것):');
        items.forEach((i, k) => L.push(`  ${k + 1}) ${i.name}${i.calc ? ` (${i.calc})` : ''}: ${won(i.amount)}원`));
        const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        L.push(`총액: ${won(total)}원 (한글: 금${hangulAmount(total)}원)`);
      }
      if (f.payMethod) L.push(`지급방법: ${f.payMethod}`);
      if (f.attach) L.push(`붙임: ${f.attach}`);
    }
    return L.join('\n');
  }

  function buildPrompt({ typeKey, profile, samples, fields, material }) {
    const type = DOC_TYPES[typeKey];
    const system = [
      `당신은 한국 대학 행정부서의 ${type.label} 작성 보조자입니다.`,
      '아래 "양식 규칙"과 "예시 문서"의 형식·문체·번호 체계를 그대로 따르고, 내용은 "사실 정보"와 "참고 자료"에서만 가져옵니다.',
      '',
      '[반드시 지킬 것]',
      '1. 사실 정보에 없는 숫자·날짜·인명·기관명·규정 조항을 지어내지 않는다. 필요한데 없으면 [확인 필요: 무엇] 으로 표시한다.',
      '2. 사실 정보에 계산된 금액·기간 표기가 있으면 그대로 옮긴다.',
      '3. 참고 자료의 구어체·메모체는 공문 문체로 다듬되, 의미를 바꾸거나 과장하지 않는다.',
      '4. 출력은 문서 본문만. 머리말·설명·마크다운 기호(**, #, ```)를 쓰지 않는다.',
      '',
      '[양식 규칙]',
      profileToRules(profile)
    ].join('\n');

    const ex = samples.slice(0, 3).map((s, i) => `<예시${i + 1}>\n${s.text.slice(0, 2500)}\n</예시${i + 1}>`).join('\n\n');
    const user = [
      `다음 예시 문서와 같은 양식으로 새 ${type.label}를 작성해 주세요.`,
      '', '[예시 문서]', ex,
      '', '[사실 정보]', factsBlock(typeKey, Object.assign({ _profile: profile }, fields)),
      '', '[참고 자료]', (material || '(없음)').slice(0, 8000)
    ].join('\n');
    return { system, user };
  }

  // ---------- 결과 점검 ----------
  function checkOutput({ typeKey, profile, fields, output }) {
    const res = [];
    const add = (level, msg) => res.push({ level, msg });
    const text = output || '';
    if (!text.trim()) return [{ level: 'err', msg: '결과가 비어 있습니다.' }];

    // 필수 입력
    DOC_TYPES[typeKey].fields.filter(f => f.required).forEach(f => {
      const v = fields[f.id];
      const empty = f.type === 'items' ? !(v || []).some(i => Number(i.amount)) : !String(v || '').trim();
      if (empty) add('warn', `입력값 비어 있음: ${f.label}`);
    });

    // 날짜-요일
    const reDot = /(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?\s?\(\s?([월화수목금토일])\s?\)/g;
    const reKo = /(\d{4})년\s?(\d{1,2})월\s?(\d{1,2})일\s?\(\s?([월화수목금토일])\s?\)/g;
    let bad = 0, seen = 0;
    [reDot, reKo].forEach(re => {
      let m; while ((m = re.exec(text))) {
        seen++;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (DAY[d.getUTCDay()] !== m[4]) { bad++; add('err', `요일 불일치: "${m[0]}" → 실제 ${DAY[d.getUTCDay()]}요일`); }
      }
    });
    if (seen && !bad) add('ok', `날짜·요일 ${seen}건 일치`);

    // 금액
    if (typeKey === 'jichul') {
      const items = (fields.items || []).filter(i => Number(i.amount));
      const total = items.reduce((s, i) => s + Number(i.amount), 0);
      if (total) {
        if (text.includes(won(total))) add('ok', `총액 ${won(total)}원 표기 확인`);
        else add('err', `총액 ${won(total)}원이 본문에 없습니다.`);
        const missing = items.filter(i => !text.includes(won(i.amount)));
        if (missing.length) add('warn', `본문에 없는 항목 금액: ${missing.map(i => won(i.amount) + '원').join(', ')}`);
        const hg = /\(금([가-힣]+)원정?\)/.exec(text);
        if (hg) {
          if (hg[1] === hangulAmount(total)) add('ok', '한글 금액 일치');
          else add('err', `한글 금액 불일치: 금${hg[1]}원 → 금${hangulAmount(total)}원`);
        }
      }
      // 본문의 "A × B = C" 계산 검증
      const reMul = /([\d,]+)\s?원?\s?[×xX*]\s?(\d+)\s?[가-힣]*\s?=\s?([\d,]+)/g; let m;
      while ((m = reMul.exec(text))) {
        const a = +m[1].replace(/,/g, ''), b = +m[2], c = +m[3].replace(/,/g, '');
        if (a * b !== c) add('err', `계산 오류: ${m[0]} (정답 ${won(a * b)})`);
      }
    }

    // 문체
    if (profile.ending.startsWith('개조식')) {
      const lines = text.split('\n').map(l => l.trim()).filter(l => MARKERS.some(mk => mk.re.test(l)));
      const off = lines.filter(l => !/다음과 같이|아래와 같이|하고자|보고(합|드립)니다/.test(l) && /(다|니다)\.?\s*$/.test(l.replace(/\s*끝\.\s*$/, '')));
      if (off.length) add('warn', `개조식이 아닌 항목 ${off.length}줄: "${off[0].slice(0, 40)}…"`);
      else if (lines.length) add('ok', '항목 문체(개조식) 일관');
    }
    if (profile.useKeut) {
      if (/끝\.\s*$/.test(text.trim())) add('ok', '"끝." 표기 확인'); else add('warn', '마지막 "끝." 표기 없음');
    }
    if (/\*\*|^#{1,3}\s|```/m.test(text)) add('warn', '마크다운 기호(**, #)가 섞여 있습니다.');

    // 확인 필요 표시
    const todo = text.match(/\[확인 필요[^\]]*\]/g) || [];
    if (todo.length) add('warn', `[확인 필요] ${todo.length}곳: ${todo.slice(0, 3).join(' ')}`);

    // 사실 정보에 없는 숫자 탐지(간단)
    const itemTotal = (fields.items || []).reduce((t, i) => t + (Number(i.amount) || 0), 0);
    const factText = JSON.stringify(fields) + ' ' + (fields._material || '') + ' ' + itemTotal;
    const nums = (text.match(/\d{1,3}(,\d{3})+|\d{5,}/g) || []).filter(n => !factText.includes(n) && !factText.includes(n.replace(/,/g, '')));
    const uniq = [...new Set(nums)].filter(n => !/^20\d\d$/.test(n));
    if (uniq.length) add('warn', `입력·자료에 없는 숫자: ${uniq.slice(0, 5).join(', ')} — 계산값인지 확인하세요.`);

    return res;
  }

  const api = { DOC_TYPES, analyzeSamples, buildPrompt, checkOutput, profileToRules, fmtDate, hangulAmount, won };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DocCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
