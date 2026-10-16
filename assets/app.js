/* 화면 동작 */
(function () {
  'use strict';
  const C = window.DocCore;
  const $ = s => document.querySelector(s);
  const STORE = 'docform-poc-v1';

  // ---------- 상태 ----------
  const blank = () => ({ samples: [], profile: null, fields: {}, material: '', output: '' });
  let state = { type: 'bokmyeong', docs: { bokmyeong: blank(), jichul: blank() } };
  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.docs) state = s; } catch (e) { /* 저장소 사용 불가 */ }
  const doc = () => state.docs[state.type];
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { } }, 300);
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }

  // ---------- 파일 읽기 ----------
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }
  function xmlParagraphs(xml, pLocal, tLocal) {
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    const ps = [...dom.getElementsByTagNameNS('*', pLocal)];
    const out = [];
    ps.forEach(p => {
      let s = '';
      const walk = n => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (c.localName === pLocal) continue;           // 표 안의 하위 문단은 따로 처리
          if (c.localName === tLocal) s += c.textContent;
          else if (c.localName === 'tab') s += '\t';
          else walk(c);
        }
      };
      walk(p);
      out.push(s);
    });
    return out.join('\n');
  }
  async function readFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'txt' || ext === 'md') return readText(file);
    if (ext === 'hwp') throw new Error('.hwp는 한글에서 "다른 이름으로 저장 → HWPX"로 변환해 올려주세요.');
    if (ext === 'pdf') throw new Error('PDF는 POC에서 미지원입니다. 본문을 복사해 붙여넣어 주세요.');
    if (!window.JSZip) throw new Error('JSZip을 불러오지 못했습니다(인터넷 연결 확인).');
    const zip = await JSZip.loadAsync(file);
    if (ext === 'docx') {
      const x = await zip.file('word/document.xml').async('string');
      return xmlParagraphs(x, 'p', 't');
    }
    if (ext === 'hwpx') {
      const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort();
      if (!names.length) throw new Error('HWPX 본문(section)을 찾지 못했습니다.');
      const parts = [];
      for (const n of names) parts.push(xmlParagraphs(await zip.file(n).async('string'), 'p', 't'));
      return parts.join('\n');
    }
    throw new Error(`${ext} 형식은 지원하지 않습니다.`);
  }
  async function readFiles(files) {
    const out = [];
    for (const f of files) {
      try { out.push({ name: f.name, text: (await readFile(f)).replace(/\n{3,}/g, '\n\n').trim() }); }
      catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    return out;
  }

  // ---------- 1. 예시 ----------
  function renderSamples() {
    const ul = $('#sampleList'); ul.innerHTML = '';
    doc().samples.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span></span><span class="len">${s.text.length.toLocaleString()}자</span><button title="삭제" aria-label="삭제">×</button>`;
      li.firstChild.textContent = s.name;
      li.title = s.text.slice(0, 300);
      li.querySelector('button').onclick = () => { doc().samples.splice(i, 1); save(); renderSamples(); };
      ul.appendChild(li);
    });
    const n = doc().samples.length;
    $('#sampleHint').textContent = n === 0 ? '' : n < 2 ? '2건 이상이면 분석이 더 정확합니다.' : `${n}건 준비됨`;
    $('#s1').classList.toggle('done', n > 0);
  }
  async function addSampleFiles(files) {
    const got = await readFiles(files);
    doc().samples.push(...got.filter(g => g.text));
    save(); renderSamples();
    if (got.length) toast(`예시 ${got.length}건 추가`);
  }
  const drop = $('#sampleDrop');
  $('#sampleFile').onchange = e => { addSampleFiles([...e.target.files]); e.target.value = ''; };
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addSampleFiles([...e.dataTransfer.files]));
  $('#samplePasteAdd').onclick = () => {
    const t = $('#samplePaste').value.trim(); if (!t) return;
    doc().samples.push({ name: `붙여넣기 ${doc().samples.length + 1}`, text: t });
    $('#samplePaste').value = ''; save(); renderSamples();
  };
  $('#loadDemo').onclick = () => {
    const d = window.DOC_DEMO[state.type];
    state.docs[state.type] = { samples: d.samples.map(([name, text]) => ({ name, text })), profile: null, fields: JSON.parse(JSON.stringify(d.fields)), material: d.material, output: '' };
    save(); renderAll(); toast('가상 예시를 불러왔습니다. 2단계 "규칙 분석"을 누르세요.');
  };

  // ---------- 2. 프로필 ----------
  const pf = $('#profileForm');
  function renderProfile() {
    const p = doc().profile;
    pf.hidden = !p; $('#s2').classList.toggle('done', !!p);
    if (!p) return;
    pf.elements.title.value = p.title || '';
    pf.elements.numbering.value = (p.numbering || []).join(', ');
    pf.elements.sections.value = (p.sections || []).join('\n');
    pf.elements.labels.value = (p.labels || []).join(', ');
    pf.elements.ending.value = p.ending; pf.elements.dateFormat.value = p.dateFormat;
    pf.elements.moneyFormat.value = p.moneyFormat || ''; pf.elements.attachLabel.value = p.attachLabel || '';
    pf.elements.weekday.checked = !!p.weekday; pf.elements.useKeut.checked = !!p.useKeut;
    pf.elements.openings.value = (p.openings || []).join('\n'); pf.elements.notes.value = p.notes || '';
  }
  function readProfileForm() {
    const split = (s, re) => s.split(re).map(x => x.trim()).filter(Boolean);
    doc().profile = {
      title: pf.elements.title.value.trim(), numbering: split(pf.elements.numbering.value, /[,，]/), sections: split(pf.elements.sections.value, /\n/),
      labels: split(pf.elements.labels.value, /[,，]/), ending: pf.elements.ending.value, dateFormat: pf.elements.dateFormat.value,
      moneyFormat: pf.elements.moneyFormat.value.trim(), attachLabel: pf.elements.attachLabel.value.trim() || '붙임',
      weekday: pf.elements.weekday.checked, useKeut: pf.elements.useKeut.checked, openings: split(pf.elements.openings.value, /\n/), notes: pf.elements.notes.value.trim()
    };
    save(); refreshPrompt(); runChecks();
  }
  pf.addEventListener('input', readProfileForm);
  pf.addEventListener('submit', e => e.preventDefault());
  $('#analyze').onclick = () => {
    if (!doc().samples.length) return toast('먼저 양식 예시를 올려주세요.');
    const keepNotes = doc().profile && doc().profile.notes;
    doc().profile = C.analyzeSamples(doc().samples.map(s => s.text));
    if (!doc().profile.sections.length) doc().profile.sections = C.DOC_TYPES[state.type].defaultSections.slice();
    if (keepNotes) doc().profile.notes = keepNotes;
    save(); renderProfile(); refreshPrompt(); toast('분석 완료 — 결과를 확인하고 필요하면 고치세요.');
  };
  $('#aiAnalyze').onclick = async () => {
    if (!doc().samples.length) return toast('먼저 양식 예시를 올려주세요.');
    if (!doc().profile) $('#analyze').click();
    const btn = $('#aiAnalyze'); btn.disabled = true;
    try {
      const sys = '당신은 한국 대학 행정문서 양식 분석가입니다. 예시 문서들의 공통 형식 특징을 찾아, 이미 파악된 규칙에 없는 것만 짧은 지침으로 정리합니다. 내용(사실)이 아니라 형식·문체·표기 습관만 다룹니다.';
      const usr = `[이미 파악된 규칙]\n${C.profileToRules(doc().profile)}\n\n[예시 문서]\n${doc().samples.slice(0, 5).map((s, i) => `<예시${i + 1}>\n${s.text.slice(0, 3000)}\n</예시${i + 1}>`).join('\n')}\n\n추가로 지켜야 할 형식 규칙을 "- "로 시작하는 줄로 최대 8개만 출력하세요. 다른 말은 쓰지 마세요.`;
      const out = await callClaude(sys, usr, 800);
      doc().profile.notes = [doc().profile.notes, out.trim()].filter(Boolean).join('\n');
      save(); renderProfile(); refreshPrompt(); toast('AI 보완 지침을 "추가 지침"에 넣었습니다.');
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  };
  $('#exportProfile').onclick = () => {
    if (!doc().profile) return toast('내보낼 프로필이 없습니다.');
    download(`양식프로필_${C.DOC_TYPES[state.type].label}.json`, JSON.stringify({ type: state.type, profile: doc().profile, samples: doc().samples }, null, 2), 'application/json');
  };
  $('#importProfile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await readText(f));
      if (j.type && j.type !== state.type) switchType(j.type);
      doc().profile = j.profile; if (j.samples) doc().samples = j.samples;
      save(); renderAll(); toast('프로필을 가져왔습니다.');
    } catch (err) { toast('프로필 파일을 읽지 못했습니다.'); }
  };

  // ---------- 3. 내용 ----------
  function renderFields() {
    const box = $('#fields'); box.innerHTML = '';
    const f = doc().fields;
    C.DOC_TYPES[state.type].fields.forEach(def => {
      if (def.type === 'items') return box.appendChild(itemsEditor(def));
      const lab = document.createElement('label');
      if (def.type === 'textarea') lab.className = 'span2';
      const cap = document.createElement('span'); cap.textContent = def.label; if (def.required) cap.className = 'req';
      const inp = document.createElement(def.type === 'textarea' ? 'textarea' : 'input');
      if (def.type === 'date') inp.type = 'date';
      if (def.type === 'textarea') inp.rows = def.id === 'related' ? 2 : 3;
      inp.placeholder = def.ph || ''; inp.value = f[def.id] || '';
      inp.oninput = () => { f[def.id] = inp.value; save(); refreshPrompt(); runChecks(); };
      lab.append(cap, inp); box.appendChild(lab);
    });
    $('#material').value = doc().material || '';
  }
  function itemsEditor(def) {
    const f = doc().fields; if (!Array.isArray(f.items) || !f.items.length) f.items = [{ name: '', calc: '', amount: '' }];
    const wrap = document.createElement('div'); wrap.className = 'span2';
    const cap = document.createElement('label'); cap.innerHTML = `<span class="req">${def.label}</span>`;
    const tbl = document.createElement('table'); tbl.className = 'items';
    const draw = () => {
      const total = f.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      tbl.innerHTML = '<thead><tr><th>항목</th><th>산출 근거 (선택)</th><th style="width:150px">금액(원)</th><th></th></tr></thead><tbody></tbody>' +
        `<tfoot><tr><td colspan="2">합계 <span class="muted" style="font-weight:500">금${C.hangulAmount(total)}원</span></td><td style="text-align:right">${C.won(total)}원</td><td></td></tr></tfoot>`;
      const tb = tbl.querySelector('tbody');
      f.items.forEach((it, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><input data-k="name" placeholder="교통비(KTX 왕복)"></td><td><input data-k="calc" placeholder="47,600원 × 2명"></td><td class="amt"><input data-k="amount" inputmode="numeric" placeholder="95200"></td><td><button class="del" aria-label="행 삭제">×</button></td>';
        tr.querySelectorAll('input').forEach(inp => {
          inp.value = it[inp.dataset.k] ?? '';
          inp.oninput = () => {
            it[inp.dataset.k] = inp.dataset.k === 'amount' ? inp.value.replace(/[^\d]/g, '') : inp.value;
            // 산출근거가 "A × B" 형태면 금액 자동 계산
            if (inp.dataset.k === 'calc') {
              const m = /([\d,]+)\s*원?\s*[×xX*]\s*(\d+)/.exec(inp.value);
              if (m) { it.amount = String(+m[1].replace(/,/g, '') * +m[2]); tr.querySelector('[data-k=amount]').value = it.amount; }
            }
            save(); refreshPrompt(); runChecks();
            const tot = f.items.reduce((s, x) => s + (Number(x.amount) || 0), 0);
            tbl.querySelector('tfoot').innerHTML = `<tr><td colspan="2">합계 <span class="muted" style="font-weight:500">금${C.hangulAmount(tot)}원</span></td><td style="text-align:right">${C.won(tot)}원</td><td></td></tr>`;
          };
        });
        tr.querySelector('.del').onclick = () => { f.items.splice(i, 1); if (!f.items.length) f.items.push({ name: '', calc: '', amount: '' }); save(); draw(); refreshPrompt(); };
        tb.appendChild(tr);
      });
    };
    draw();
    const add = document.createElement('button'); add.className = 'btn ghost sm'; add.textContent = '+ 항목 추가'; add.type = 'button';
    add.onclick = () => { f.items.push({ name: '', calc: '', amount: '' }); save(); draw(); };
    wrap.append(cap, tbl, add);
    return wrap;
  }
  $('#material').oninput = e => { doc().material = e.target.value; save(); refreshPrompt(); };
  $('#materialFile').onchange = async e => {
    const got = await readFiles([...e.target.files]); e.target.value = '';
    doc().material = [doc().material, ...got.map(g => `[${g.name}]\n${g.text}`)].filter(Boolean).join('\n\n');
    $('#material').value = doc().material; save(); refreshPrompt();
  };

  // ---------- 4. 생성·점검 ----------
  function currentPrompt() {
    const d = doc();
    if (!d.profile) return null;
    return C.buildPrompt({ typeKey: state.type, profile: d.profile, samples: d.samples, fields: d.fields, material: d.material });
  }
  function refreshPrompt() {
    const p = currentPrompt();
    $('#promptPreview').textContent = p ? `=== 시스템 ===\n${p.system}\n\n=== 사용자 ===\n${p.user}` : '2단계 분석을 먼저 해주세요.';
  }
  function runChecks() {
    const d = doc(), ul = $('#checks');
    if (!d.output.trim() || !d.profile) { ul.innerHTML = '<li class="muted">결과가 생기면 날짜·요일, 금액 합계, 문체, 누락 항목을 확인합니다.</li>'; return; }
    const r = C.checkOutput({ typeKey: state.type, profile: d.profile, fields: Object.assign({ _material: d.material }, d.fields), output: d.output });
    ul.innerHTML = '';
    const order = { err: 0, warn: 1, ok: 2 };
    r.sort((a, b) => order[a.level] - order[b.level]).forEach(x => {
      const li = document.createElement('li'); li.className = x.level;
      li.textContent = (x.level === 'ok' ? '✓ ' : x.level === 'warn' ? '! ' : '✕ ') + x.msg; ul.appendChild(li);
    });
    $('#s4').classList.toggle('done', !r.some(x => x.level === 'err'));
  }
  $('#output').oninput = e => { doc().output = e.target.value; save(); clearTimeout(runChecks._t); runChecks._t = setTimeout(runChecks, 300); };

  // 모드·키
  const keyStore = () => ($('#rememberKey').checked ? localStorage : sessionStorage);
  try {
    const k = localStorage.getItem('docform-key'); if (k) { $('#apiKey').value = k; $('#rememberKey').checked = true; }
    else $('#apiKey').value = sessionStorage.getItem('docform-key') || '';
    $('#model').value = localStorage.getItem('docform-model') || $('#model').value;
    if (localStorage.getItem('docform-mode') === 'api') document.querySelector('input[name=mode][value=api]').checked = true;
  } catch (e) { }
  const mode = () => document.querySelector('input[name=mode]:checked').value;
  function syncMode() { $('#apiBox').hidden = mode() !== 'api'; $('#generate').textContent = mode() === 'api' ? '초안 만들기' : '프롬프트 복사하고 결과 붙여넣기'; try { localStorage.setItem('docform-mode', mode()); } catch (e) { } }
  document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = syncMode);
  $('#apiKey').oninput = () => { try { keyStore().setItem('docform-key', $('#apiKey').value.trim()); } catch (e) { } };
  $('#rememberKey').onchange = () => {
    try { localStorage.removeItem('docform-key'); sessionStorage.removeItem('docform-key'); keyStore().setItem('docform-key', $('#apiKey').value.trim()); } catch (e) { }
  };
  $('#model').oninput = () => { try { localStorage.setItem('docform-model', $('#model').value.trim()); } catch (e) { } };

  async function callClaude(system, user, maxTokens) {
    const key = $('#apiKey').value.trim();
    if (!key) { document.querySelector('input[name=mode][value=api]').checked = true; syncMode(); throw new Error('API 키를 입력해 주세요.'); }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: $('#model').value.trim(), max_tokens: maxTokens || 4000, system, messages: [{ role: 'user', content: user }] })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`API 오류 ${res.status}: ${(j.error && j.error.message) || res.statusText}`);
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
  }
  $('#copyPrompt').onclick = async () => {
    const p = currentPrompt(); if (!p) return toast('2단계 분석을 먼저 해주세요.');
    await copyText(`${p.system}\n\n---\n\n${p.user}`); toast('프롬프트를 복사했습니다. AI에 붙여넣고 결과를 "결과"란에 붙여넣으세요.');
  };
  $('#generate').onclick = async () => {
    const p = currentPrompt(); if (!p) return toast('2단계 분석을 먼저 해주세요.');
    if (mode() === 'copy') { $('#copyPrompt').click(); $('#output').focus(); return; }
    const btn = $('#generate'), st = $('#genStatus'); btn.disabled = true; st.textContent = '작성 중…';
    try {
      const t0 = Date.now();
      const out = (await callClaude(p.system, p.user)).trim();
      doc().output = out; $('#output').value = out; save(); runChecks();
      st.textContent = `완료 (${((Date.now() - t0) / 1000).toFixed(1)}초)`;
    } catch (e) { st.textContent = ''; toast(e.message); }
    btn.disabled = false;
  };
  $('#copyOut').onclick = async () => { if (doc().output) { await copyText(doc().output); toast('결과를 복사했습니다.'); } };
  $('#saveOut').onclick = () => { if (doc().output) download(`${C.DOC_TYPES[state.type].label}_초안.txt`, doc().output, 'text/plain'); };
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- 유형 전환 ----------
  function switchType(t) { state.type = t; save(); renderAll(); }
  document.querySelectorAll('.types button').forEach(b => b.onclick = () => switchType(b.dataset.type));
  function renderAll() {
    document.querySelectorAll('.types button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.type === state.type)));
    renderSamples(); renderProfile(); renderFields();
    $('#output').value = doc().output || '';
    refreshPrompt(); runChecks();
  }
  syncMode(); renderAll();
})();
