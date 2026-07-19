'use strict';

const RETRIEVAL_META_PATTERNS = [
  /(?:무슨|어떤|뭐(?:였|였지|였더라)?|무엇).{0,30}(?:이야기|얘기|대화|논의|질문).{0,24}(?:했|했더라|했지|나눴|물었|물어봤)/u,
  /(?:물어봤|말했|얘기했|이야기했|논의했).{0,8}(?:었)?잖아/u,
];

const RETRIEVAL_UNCERTAINTY_PATTERNS = [
  /(?:노트|기록|컨텍스트|검색\s*결과).{0,50}(?:잘린|누락|보이지\s*않|찾지\s*못|확인되지\s*않).{0,30}(?:것\s*같|듯|수\s*없)/u,
  /(?:노트|기록|컨텍스트|검색\s*결과).{0,30}(?:전부|전체|뒷부분).{0,30}(?:확인할|볼)\s*수\s*없/u,
];

function classifyAutoSaveExclusion(question, answer) {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();

  if (RETRIEVAL_META_PATTERNS.some(pattern => pattern.test(q))) {
    return 'retrieval_meta';
  }
  if (RETRIEVAL_UNCERTAINTY_PATTERNS.some(pattern => pattern.test(a))) {
    return 'retrieval_uncertain';
  }
  return null;
}

module.exports = { classifyAutoSaveExclusion };
