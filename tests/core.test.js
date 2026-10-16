// 양식 분석·결과 점검 로직 회귀 테스트 (외부 의존성 없음)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../assets/core.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8');

// 1. 복명서 분석
const bp = C.analyzeSamples([read('복명서_예시1.txt'), read('복명서_예시2.txt')]);
assert.deepStrictEqual(bp.sections, ['출장 개요', '주요 내용', '시사점 및 향후 조치']);
assert.deepStrictEqual(bp.numbering, ['1.', '가.', '1)']);
assert.ok(bp.weekday && bp.useKeut);
assert.ok(bp.ending.startsWith('개조식'));

// 2. 지출결의서 분석
const jp = C.analyzeSamples([read('지출결의서_예시1.txt'), read('지출결의서_예시2.txt')]);
assert.ok(jp.labels.includes('예산과목'));
assert.ok(!jp.labels.some(l => l.includes('숙박비')), '금액 항목은 라벨로 잡히면 안 됨');
assert.ok(jp.moneyFormat.includes('금일백삼십오만원'));
assert.strictEqual(jp.openings.length, 2);

// 3. 한글 금액·날짜
assert.strictEqual(C.hangulAmount(1350000), '일백삼십오만');
assert.strictEqual(C.hangulAmount(286000), '이십팔만육천');
assert.strictEqual(C.hangulAmount(227200), '이십이만칠천이백');
assert.strictEqual(C.fmtDate('2026-10-08'), '2026. 10. 8.(목)');

// 4. 결과 점검
const fields = { title: 't', budget: 'b', related: 'r', items: [{ name: '일비', amount: 50000 }] };
const bad = '1. 관련\n  가. 지출금액: 금 50,000원(금오만원)\n    1) 일비: 25,000원 × 2명 = 55,000원\n  나. 일자: 2026. 10. 8.(금)\n붙임  1부.  끝.';
const r = C.checkOutput({ typeKey: 'jichul', profile: jp, fields, output: bad });
const errs = r.filter(x => x.level === 'err').map(x => x.msg).join('\n');
assert.ok(/요일 불일치/.test(errs), '요일 오류 감지');
assert.ok(/계산 오류/.test(errs), '계산 오류 감지');
assert.ok(r.some(x => x.level === 'ok' && /한글 금액 일치/.test(x.msg)));

console.log('모든 테스트 통과');
