'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAutoSaveExclusion } = require('../lib/assistant-auto-save');

test('retrieval questions are excluded from automatic durable saves', () => {
  assert.equal(
    classifyAutoSaveExclusion(
      '그 머냐 수면대행서비스 관련해서 가장 최근에 무슨 이야기를 했더라?',
      '이전에 저장된 내용을 요약한 답변이다.',
    ),
    'retrieval_meta',
  );
  assert.equal(
    classifyAutoSaveExclusion(
      '그게 가장 최근 아닌가? 내가 비슷한 결의 소설이 있냐고 물어봤었잖아',
      '이전에 저장된 내용을 다시 설명한다.',
    ),
    'retrieval_meta',
  );
});

test('retrieval-uncertain answers are excluded even when the question is not meta-shaped', () => {
  assert.equal(
    classifyAutoSaveExclusion(
      '숙면 대행 서비스의 최근 구상은 뭐야?',
      '현재 컨텍스트에서 노트 뒷부분이 잘린 것 같아서 전체 내용을 확인할 수 없어.',
    ),
    'retrieval_uncertain',
  );
});

test('new durable decisions and creative questions remain eligible', () => {
  assert.equal(
    classifyAutoSaveExclusion(
      '숙면 대행 서비스 결말을 주인공의 자발적 선택으로 바꾸자.',
      '좋아. 앞으로는 그 결말을 기준으로 구성하면 돼.',
    ),
    null,
  );
  assert.equal(
    classifyAutoSaveExclusion(
      '우리 소설에서 주인공이 무슨 이야기를 하게 할까?',
      '주인공이 잠을 타인에게 넘긴 대가를 고백하게 하면 좋아.',
    ),
    null,
  );
});
