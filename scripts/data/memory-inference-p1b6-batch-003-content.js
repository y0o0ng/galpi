'use strict';

// Authored source episodes for P1-B6 batch-003.
//
// One entry per candidate, in the frozen plan's slot order. `ev` selects evidence turns by
// index (a bare index selects the whole turn, `[index, 'text']` selects a sub-turn span) and
// `anchor` is `[turnIndex, 'text']`. Every byte offset is computed from this text by the
// materializer; none is written by hand.
//
// CLEAR entries are authored so one semantic status is the natural dominant reading of the
// visible evidence. ESCALATE entries are authored so the visible evidence itself positively
// licenses at least two materially different statuses — not bare logical compatibility, not
// merely missing context, and not an invented premise.

module.exports = [
  // --- p1b6-sk-000035b8df850b3e | TRAIN/CLEAR | FINALITY: action still being weighed ---
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '요즘 자전거로 출퇴근하는 걸 알아보고 있어.'],
      ['USER', '어제 비가 많이 와서 베란다 화분을 안쪽으로 들여놨어.'],
      ['USER', '거리랑 회사에 샤워 시설이 있는지까지는 확인해 봤어.'],
      ['USER', '화분 받침에 물이 고여서 그것도 비웠고.'],
      ['USER', '아직 정하진 않았고 계속 보는 중이야.'],
    ],
    ev: [0, 2, 4], anchor: [0, '자전거로 출퇴근하는 걸'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 이사 시기는 아직 정하지 못했어.'],
      ['USER', '전세 계약이 8월에 끝나서 그 앞뒤로 계속 저울질하고 있어.'],
      ['ASSISTANT', '지금은 후보 시기만 두고 계신 거네요.'],
    ],
    ev: [0, 2], anchor: [0, '이사 시기'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '팀에서 새 design system을 도입하자는 얘기가 나왔어.'],
      ['USER', '마침 오늘 사내 카페가 리뉴얼해서 줄이 엄청 길더라.'],
      ['USER', '컴포넌트 수가 꽤 되고 migration cost도 만만치 않아.'],
      ['USER', '커피는 그냥 텀블러에 받아 왔어.'],
      ['USER', '그래서 도입할지 말지 지금 계속 재 보는 중이야.'],
      ['USER', '텀블러 뚜껑을 책상에 두고 와서 한 번 더 갔다 왔고.'],
      ['ASSISTANT', '아직 저울질 단계로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '도입할지 말지'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '주말에 등산을 갈지 고민하고 있어.'],
      ['ASSISTANT', '날씨는 괜찮다고 나와 있어요.'],
      ['USER', '응, 그래서 아직 보는 중.'],
    ],
    ev: [0, 1, 2], anchor: [0, '등산을 갈지'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '고양이 자동급식기를 살까 말까 하고 있어.'],
      ['USER', '그리고 다음 주 화요일 치과 예약은 오후로 옮겼어.'],
      ['USER', '급식기는 용량이랑 청소가 편한지가 관건이더라.'],
      ['USER', '치과는 스케일링만 받을 거야.'],
      ['USER', '급식기는 아직 장바구니에만 넣어 뒀어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '자동급식기를 살까 말까'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'EN', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', 'I am thinking about switching our error tracker.'],
      ['USER', 'More precisely, I am comparing the two that support source maps.'],
      ['USER', 'A teammate asked me to hold off until the quarter closes anyway.'],
      ['USER', 'So it is still on my list to decide, and nothing is signed.'],
    ],
    ev: [0, 1, 3], anchor: [0, 'switching our error tracker'],
  },
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 말한 피아노 학원 등록 말인데, 계속 재고 있어.'],
      ['USER', '아, 먼저 택배 반품 접수부터 할게.'],
      ['USER', '송장번호는 메일함에서 찾았어.'],
      ['USER', '다시 학원 얘기로 오면 시간대가 애매해서 아직 결정을 못 했어.'],
      ['USER', '반품 수거는 목요일로 잡혔고.'],
      ['ASSISTANT', '고민 중인 상태로 적어 둘게요.'],
    ],
    ev: [0, 3, 5], anchor: [0, '피아노 학원 등록'],
  },

  // --- p1b6-sk-001178537fb93442 | HELD/CLEAR | recurring action with a stated frequency ---
  {
    sk: 'p1b6-sk-001178537fb93442', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '나는 아침마다 running을 하고 있어.'],
      ['USER', '오늘 아침엔 비가 와서 편의점에서 우산을 하나 샀어.'],
      ['USER', '아, 표현을 고칠게. weekday 아침마다 하고 있어.'],
      ['USER', '우산은 접이식이라 가방에 그냥 들어가더라.'],
      ['USER', '그러니까 월요일부터 금요일까지, 주 5회가 지금 내 pace야.'],
      ['USER', '영수증은 그 자리에서 버렸어.'],
      ['ASSISTANT', 'weekday 아침 주 5회 running으로 기록할게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '주 5회'],
  },
  {
    sk: 'p1b6-sk-001178537fb93442', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '화요일마다 아버지께 전화를 드려.'],
      ['USER', '벌써 3년째 그렇게 하고 있어.'],
    ],
    ev: [0, 1], anchor: [0, '화요일마다'],
  },
  {
    sk: 'p1b6-sk-001178537fb93442', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 지금 내 독서 습관은 하루 한 챕터야.'],
      ['USER', '오늘은 세탁기 필터를 청소했어.'],
      ['USER', '자기 전에 한 챕터씩, 하루도 건너뛰지 않고.'],
      ['USER', '필터에 먼지가 꽤 껴 있더라.'],
      ['USER', '작년 가을부터 그렇게 이어 오고 있어.'],
      ['USER', '세탁조 청소도 같이 돌렸어.'],
      ['USER', '이제는 그냥 습관이 된 것 같아.'],
      ['USER', '청소 세제는 다 써서 새로 주문해야 해.'],
      ['ASSISTANT', '매일 한 챕터로 기록해 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '하루 한 챕터'],
  },
  {
    sk: 'p1b6-sk-001178537fb93442', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '작년에 허리를 좀 다친 뒤로 물리치료를 받고 있어.'],
      ['USER', '지금은 2주에 한 번씩 가.'],
      ['USER', '병원 주차장이 좁아서 늘 근처에 대고 걸어가.'],
      ['ASSISTANT', '2주 간격으로 이어지는 걸로 적어 둘게요.'],
    ],
    ev: [0, 1, 3], anchor: [1, '2주에 한 번씩'],
  },
  {
    sk: 'p1b6-sk-001178537fb93442', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '집 화분은 열흘에 한 번 물을 줘.'],
      ['USER', '참, 어제 현관 등을 LED로 갈았어.'],
      ['ASSISTANT', '열흘 간격이요?'],
      ['USER', '응, 열흘.'],
      ['USER', '등은 훨씬 밝아졌어.'],
      ['ASSISTANT', '열흘 간격 급수로 적어 둘게요.'],
    ],
    ev: [0, 2, 3, 5], anchor: [0, '열흘에 한 번'],
  },

  // --- p1b6-sk-0767dc2f59b57601 | TRAIN/CLEAR | named exception subcategory covers target ---
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '우리 회사 expense 규정은 영수증이 없으면 처리가 안 돼.'],
      ['USER', '그리고 오늘 오후에 프린터 토너를 교체했어.'],
      ['USER', '다만 해외 출장 건은 예외로 카드 명세서만 있어도 된다고 적혀 있어.'],
      ['USER', '토너는 재생품이라 좀 싸게 샀고.'],
      ['USER', '내가 지금 올리려는 건 싱가포르 출장 택시비야.'],
      ['USER', '프린터 트레이도 한 번 털었어.'],
      ['ASSISTANT', '해외 출장 예외에 해당하니 카드 명세서로 올리시면 돼요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '싱가포르 출장 택시비'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '도서관은 대출 기간이 2주야.'],
      ['USER', '더 정확히는, 참고도서실 자료는 관내 열람만 되고 대출이 안 돼.'],
      ['USER', '아, 주차 등록도 해야 하는구나.'],
      ['USER', '내가 보려는 건 참고도서실에 있는 지역사 자료야.'],
    ],
    ev: [0, 1, 3], anchor: [3, '참고도서실에 있는 지역사 자료'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 재활용 얘기 하다 말았지.'],
      ['USER', '우리 아파트는 스티로폼을 일반 배출 못 하게 하는데 배달 아이스박스는 예외로 따로 받아 줘. 내가 버릴 건 밀키트 아이스박스야.'],
    ],
    ev: [1], anchor: [1, '밀키트 아이스박스'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'EN', dp: 'SELF_REVISION',
    turns: [
      ['USER', 'Our office prints everything in black and white by default.'],
      ['USER', 'The kitchen tap has been dripping all morning, I should call someone.'],
      ['USER', 'Let me put that better: the marketing folder is the exception and prints in colour.'],
      ['USER', 'I will ring the building manager after lunch.'],
      ['USER', 'The file I am sending sits in the marketing folder.'],
    ],
    ev: [0, 2, 4], anchor: [4, 'in the marketing folder'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '우리 동호회는 회비를 매달 1일에 걷어.'],
      ['USER', '어제 동호회 단톡방 알림을 꺼 뒀어.'],
      ['USER', '신입 회원은 첫 달 회비가 면제라는 예외 조항이 있어.'],
      ['USER', '알림은 공지만 받게 다시 켤까 싶어.'],
      ['USER', '나는 지난주에 가입한 신입이야.'],
    ],
    ev: [0, 2, 4], anchor: [4, '지난주에 가입한 신입'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 내 건은 무료 반품이야.'],
      ['USER', '아침에 택배 기사님이 부재중이라 경비실에 맡기고 가셨더라.'],
      ['USER', '이 shop은 반품 배송비를 고객이 내는 게 원칙인데 defect 건은 예외로 무료야.'],
      ['USER', '내가 보낸 건 박음질이 터진 defect 건이고.'],
    ],
    ev: [0, 2, 3], anchor: [0, '무료 반품'],
  },
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '우리 학교 도서 연체료는 하루 100원씩 붙어.'],
      ['USER', '오늘 자전거 체인에 기름을 쳤어.'],
      ['USER', '그런데 졸업 예정자는 연체료 면제라는 단서가 붙어 있어.'],
      ['USER', '체인이 좀 늘어난 것 같기도 하고.'],
      ['USER', '나는 이번 학기 졸업 예정이야.'],
      ['USER', '자전거는 주말에 정비소에 가져가려고.'],
      ['ASSISTANT', '졸업 예정자 면제에 해당하시네요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '이번 학기 졸업 예정'],
  },

  // --- p1b6-sk-084af1a6a0723538 | DEV/CLEAR | the loose baseline IS the stated boundary ---
  {
    sk: 'p1b6-sk-084af1a6a0723538', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 발표 자료는 대충 스무 장 안팎이면 충분하다고 했어.'],
      ['ASSISTANT', '기준이 그 정도면 되나요?'],
      ['USER', '응, 그 느낌이면 돼.'],
    ],
    ev: [0, 1, 2], anchor: [0, '대충 스무 장 안팎'],
  },
  {
    sk: 'p1b6-sk-084af1a6a0723538', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '팀장이 초안 길이는 한 페이지 남짓이면 된다고 했어.'],
      ['USER', '그리고 사무실 블라인드가 한쪽만 안 내려가.'],
      ['USER', '그 정도 분량이 우리가 맞출 기준이야.'],
      ['USER', '블라인드는 줄이 꼬인 것 같아.'],
      ['ASSISTANT', '느슨한 그 기준으로 맞추면 되겠네요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '한 페이지 남짓'],
  },

  // --- p1b6-sk-0ed5b52f4c5735e9 | TRAIN/CLEAR | later relation confirms the same status ---
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '창고 열쇠는 관리실에 맡겨 둔 것 같아.'],
      ['USER', '창고 안 선반은 나중에 정리하자.'],
      ['USER', '방금 확인해 보니 관리실에서 열쇠를 받아 뒀다고 문자가 와 있었어.'],
    ],
    ev: [0, 2], anchor: [0, '관리실에 맡겨 둔'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 server 재기동 말인데, 새벽 3시에 잡힌 걸로 알고 있어.'],
      ['USER', '점심 메뉴 투표가 올라와서 하나 골랐어.'],
      ['USER', '다시 재기동 얘기로 오면, ops calendar에도 같은 시각으로 적혀 있더라.'],
      ['USER', '투표는 결국 국밥으로 정해졌어.'],
      ['ASSISTANT', '새벽 3시로 기록해 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '새벽 3시'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이번 워크숍 장소는 본관 3층이라고 들었어.'],
      ['USER', '오는 길에 신발끈이 풀려서 한 번 멈췄어.'],
      ['USER', '아니다, 말을 정확히 할게. 본관 3층 세미나실이야.'],
      ['USER', '신발은 새로 산 거라 아직 뻣뻣해.'],
      ['USER', '방금 담당자한테도 거기가 맞다고 확인받았어.'],
      ['USER', '끈은 좀 짧게 잘라야 할 것 같아.'],
      ['ASSISTANT', '본관 3층 세미나실로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '본관 3층 세미나실'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 정기점검은 목요일에 한다고 공지에 떴어.'],
      ['USER', '관리사무소에서 온 문자에도 같은 요일로 돼 있고.'],
    ],
    ev: [0, 1], anchor: [0, '목요일'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'EN', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', 'The short version is that the venue is the riverside hall.'],
      ['USER', 'I still need to sort out parking though.'],
      ['USER', 'The invitation said riverside hall, and the organiser repeated it on the call today.'],
    ],
    ev: [0, 2], anchor: [0, 'the riverside hall'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번에 계약하는 집은 반려동물이 가능하다고 들었어.'],
      ['USER', '이삿짐 견적은 아직 안 받았어.'],
      ['USER', '계약서 초안에도 반려동물 가능이라고 적혀 있어.'],
      ['USER', '견적은 다음 주에 받기로 했어.'],
      ['USER', '집주인도 통화에서 다시 괜찮다고 했어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '반려동물이 가능하다'],
  },
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 release 날짜는 다음 달 12일로 알고 있어.'],
      ['USER', '오늘 아침에 키보드 배터리를 갈았어.'],
      ['USER', 'release note draft에도 같은 날짜로 적혀 있더라.'],
      ['USER', '키보드는 이제 조용해졌어.'],
      ['ASSISTANT', '12일 맞나요?'],
      ['USER', '응, 12일.'],
      ['USER', '마우스도 같이 갈아야 하나 싶어.'],
      ['USER', 'PM이 stand-up에서도 12일이라고 말했어.'],
      ['USER', '마우스는 아직 쓸 만해.'],
      ['ASSISTANT', '다음 달 12일로 기록해 둘게요.'],
    ],
    ev: [0, 2, 4, 5, 7, 9], anchor: [0, '다음 달 12일'],
  },

  // --- p1b6-sk-11a3e916ff9b8129 | HELD/CLEAR | abbreviation reused, never reassigned ---
  {
    sk: 'p1b6-sk-11a3e916ff9b8129', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '우리가 쓰는 회의록 템플릿을 앞으로 그냥 MT라고 부를게.'],
      ['USER', '사무실 공기청정기 필터를 주문했어.'],
      ['USER', '필터는 이번 주 안에 온대.'],
      ['USER', 'MT에 액션 아이템 칸을 하나 더 넣자.'],
      ['USER', '청정기는 거실 쪽으로 옮겼어.'],
      ['ASSISTANT', '회의록 템플릿 수정으로 적어 둘게요.'],
    ],
    ev: [0, 3, 5], anchor: [3, 'MT'],
  },
  {
    sk: 'p1b6-sk-11a3e916ff9b8129', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 분기 매출 대시보드를 줄여서 QD라고 부르자.'],
      ['USER', '더 정확히는 지역별 탭이 있는 그 버전을 QD라고 할게.'],
      ['USER', '점심은 먼저 먹고 와도 돼.'],
      ['USER', 'QD에서 지난달 수치만 다시 뽑아 줄래?'],
    ],
    ev: [0, 1, 3], anchor: [3, 'QD'],
  },
  // --- p1b6-sk-11a3e916ff9b8129 continued ---
  {
    sk: 'p1b6-sk-11a3e916ff9b8129', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 창고 정리 체크리스트를 앞으로 CL이라고 줄여 부를게.'],
      ['USER', '오는 길에 우산을 지하철에 두고 내렸어.'],
      ['USER', 'CL은 지금 네 항목짜리야.'],
      ['USER', '유실물 센터에 전화는 해 뒀어.'],
      ['USER', '다시 정리 얘기로 오면, 거기에 사다리 점검 항목이 빠져 있더라.'],
      ['USER', '우산은 찾으면 연락 준대.'],
      ['ASSISTANT', '체크리스트에 사다리 점검을 추가하는 걸로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, 'CL'],
  },
  {
    sk: 'p1b6-sk-11a3e916ff9b8129', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '신입 온보딩 문서를 줄여서 OB라고 하자.'],
      ['USER', '아니다, 더 분명히 할게. 3주차 과정까지 담긴 그 문서를 OB라고 부르는 거야.'],
      ['USER', 'OB 마지막 장에 연락처를 하나 더 넣어 줘.'],
    ],
    ev: [0, 1, 2], anchor: [2, 'OB'],
  },
  {
    sk: 'p1b6-sk-11a3e916ff9b8129', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '우리가 관리하는 배포 script를 그냥 DS라고 부를게.'],
      ['USER', '오늘 사무실 화분에 물을 줬어.'],
      ['USER', 'DS에서 rollback 단계가 빠진 것 같아.'],
      ['USER', '화분은 창가 쪽으로 옮겼고.'],
      ['ASSISTANT', '배포 script에 rollback 단계 누락으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, 'DS'],
  },

  // --- p1b6-sk-11e63b75bdf266dd | HELD/CLEAR | broad statement later narrowed to a subcase ---
  {
    sk: 'p1b6-sk-11e63b75bdf266dd', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 이번 점검 대상은 3층 사무실이야.'],
      ['USER', '처음엔 건물 전체를 점검한다고 했는데, 범위를 좁혀서 3층만 보기로 정리됐어.'],
      ['USER', '점검표는 어제 받아 뒀어.'],
      ['ASSISTANT', '3층 사무실로 적어 둘게요.'],
    ],
    ev: [0, 1, 3], anchor: [0, '3층 사무실'],
  },
  {
    sk: 'p1b6-sk-11e63b75bdf266dd', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '연초에 부서 전체가 보안 교육을 듣기로 했었어.'],
      ['USER', '오늘 사무실 시계 건전지를 갈았어.'],
      ['USER', '그 뒤에 범위가 좁혀져서 외부망을 쓰는 인원만 듣는 걸로 정리됐어.'],
      ['USER', '시계가 20분쯤 느리게 가고 있었더라.'],
      ['USER', '나는 외부망을 쓰니까 대상에 들어가.'],
      ['USER', '건전지는 여분을 하나 더 사 뒀어.'],
      ['ASSISTANT', '외부망 사용자 대상 교육으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '외부망을 쓰는 인원만'],
  },
  {
    sk: 'p1b6-sk-11e63b75bdf266dd', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'We said the whole archive would be digitised.'],
      ['USER', 'The scanner arrives on Monday.'],
      ['USER', 'That was narrowed down to the photographs only.'],
      ['USER', 'I still need to clear the table for it.'],
      ['ASSISTANT', 'Photographs only?'],
      ['USER', 'Yes, just those.'],
    ],
    ev: [0, 2, 4, 5], anchor: [2, 'the photographs only'],
  },
  {
    sk: 'p1b6-sk-11e63b75bdf266dd', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '처음엔 모든 회원에게 안내문을 보낸다고 했어.'],
      ['USER', '그런데 지금은 올해 가입한 회원에게만 보내는 걸로 좁혀졌어.'],
      ['USER', '그리고 사무국 복사기 토너가 떨어졌어.'],
      ['USER', '토너는 내일 온대.'],
    ],
    ev: [0, 1], anchor: [1, '올해 가입한 회원에게만'],
  },

  // --- p1b6-sk-135ab77919a554dc | HELD/ESCALATE | per-occurrence vs aggregated total ---
  {
    sk: 'p1b6-sk-135ab77919a554dc', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 출장에서 taxi를 세 번 탔는데 대략 3만 원쯤 나왔어.'],
      ['USER', '호텔 조식은 생각보다 괜찮았어.'],
      ['USER', '더 정확히 말하면 rough하게 3만 원 안팎이야.'],
    ],
    ev: [0, 2], anchor: [0, '대략 3만 원쯤'],
  },
  {
    sk: 'p1b6-sk-135ab77919a554dc', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 워크숍 인쇄물 말인데, 세 세션에 걸쳐 스무 장쯤 썼어.'],
      ['USER', '프린터 용지는 어제 새로 채워 놨어.'],
      ['USER', '다시 인쇄물 얘기로 오면, 스무 장 정도가 내가 기억하는 수치야.'],
      ['USER', '용지는 A4만 남아 있어.'],
      ['ASSISTANT', '스무 장 정도로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '스무 장쯤'],
  },
  {
    sk: 'p1b6-sk-135ab77919a554dc', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '지난달에 배달을 네 번 시켰는데 한 2만 원쯤 나갔어.'],
      ['USER', '냉장고 제빙기가 좀 시끄러워졌어.'],
      ['USER', '아, 표현을 다시 할게. 2만 원 언저리야.'],
      ['USER', '제빙기는 얼음 크기를 작게 바꿨어.'],
      ['USER', '카드 명세서를 정확히 본 건 아니고 감으로 말한 거야.'],
      ['USER', '얼음이 빨리 어는 것 같기도 하고.'],
      ['ASSISTANT', '2만 원 언저리로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '한 2만 원쯤'],
  },
  {
    sk: 'p1b6-sk-135ab77919a554dc', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 주에 회의를 다섯 번 했는데 대략 한 시간 반 정도였어.'],
      ['USER', '회의실은 계속 3층을 썼고.'],
      ['ASSISTANT', '한 시간 반 정도로 적어 둘게요.'],
    ],
    ev: [0, 2], anchor: [0, '대략 한 시간 반'],
  },
  {
    sk: 'p1b6-sk-135ab77919a554dc', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 이번 겨울 난방비는 대충 십오만 원 선이야.'],
      ['USER', '12월, 1월, 2월 고지서를 다 받아 놓고 하는 얘기야.'],
    ],
    ev: [0, 1], anchor: [0, '대충 십오만 원 선'],
  },

  // --- p1b6-sk-155420007d75f36f | HELD/CLEAR | plan kept as a conditional plan ---
  {
    sk: 'p1b6-sk-155420007d75f36f', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '팀 offsite 얘기가 나왔는데, 예산 승인이 나면 제주로 가기로 했어.'],
      ['USER', '오늘 사무실 정수기 필터를 갈았어.'],
      ['USER', '승인은 아직 안 났고, 그 조건 그대로 기억해 두면 돼.'],
      ['USER', '필터는 6개월마다 갈라고 적혀 있더라.'],
      ['ASSISTANT', '예산 승인 조건부 계획으로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '예산 승인이 나면 제주로 가기로'],
  },

  // --- p1b6-sk-16697b52f83abeba | DEV/ESCALATE | which baseline the change is measured from ---
  {
    sk: 'p1b6-sk-16697b52f83abeba', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이 모델은 출시가가 80만 원이었어.'],
      ['USER', '지난달에 매장에서 봤을 땐 92만 원이더라.'],
      ['USER', '진열대는 2층으로 옮겼대.'],
      ['USER', '오늘 다시 가 보니 대략 10% 정도 올랐어.'],
      ['USER', '매장 주차가 30분 무료인 건 처음 알았어.'],
      ['ASSISTANT', '10% 정도요?'],
      ['USER', '응, 그 정도.'],
    ],
    ev: [0, 1, 3, 5, 6], anchor: [3, '대략 10% 정도 올랐어'],
  },
  {
    sk: 'p1b6-sk-16697b52f83abeba', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '작년 이맘때 우리 팀은 여섯 명이었고, 올해 초엔 아홉 명이었어.'],
      ['USER', '그리고 사무실 의자를 새로 바꿨어.'],
      ['USER', '지금은 대충 절반쯤 늘었어.'],
      ['USER', '의자는 메쉬로 골랐고.'],
    ],
    ev: [0, 2], anchor: [2, '대충 절반쯤 늘었어'],
  },
  {
    sk: 'p1b6-sk-16697b52f83abeba', lang: 'EN', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', 'Our first draft ran to forty pages.'],
      ['USER', 'The printer in the annex is out of toner again.'],
      ['USER', 'The version we circulated in March was sixty pages.'],
      ['USER', 'I ordered a cartridge this morning.'],
      ['USER', 'The copy I have now is roughly a third shorter.'],
      ['USER', 'It should arrive tomorrow.'],
      ['ASSISTANT', 'Roughly a third shorter, noted.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, 'roughly a third shorter'],
  },
  {
    sk: 'p1b6-sk-16697b52f83abeba', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 전기요금 얘기 하다 말았지.'],
      ['USER', '재작년 여름엔 9만 원, 작년 여름엔 13만 원이었는데 올해는 대략 20% 정도 줄었어.'],
    ],
    ev: [1], anchor: [1, '대략 20% 정도 줄었어'],
  },

  // --- p1b6-sk-187292f8cbc0126c | TRAIN/CLEAR | single active antecedent ---
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '어제 새 noise cancelling 헤드폰을 샀어.'],
      ['USER', '점심은 회사 앞 국수집에서 먹었고.'],
      ['USER', '아, 정확히는 그저께 샀어.'],
      ['USER', '국수는 곱빼기로 시켰어.'],
      ['USER', '배터리가 생각보다 오래가더라.'],
      ['USER', '국수집은 현금만 받아서 좀 당황했어.'],
      ['USER', '그거 케이스는 따로 사야 하나 봐.'],
      ['USER', '현금은 마침 있었어.'],
      ['ASSISTANT', '헤드폰 케이스를 따로 알아보면 되겠네요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [6, '그거'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '어제 받은 계약서 초안을 검토했어.'],
      ['USER', '오후엔 비가 잠깐 왔어.'],
      ['USER', '거기에 위약금 조항이 빠져 있더라.'],
      ['USER', '우산은 안 가져갔었고.'],
      ['ASSISTANT', '계약서 초안에 위약금 조항 누락으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '거기에'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '지난주에 산 전기포트가 물이 새.'],
      ['USER', '주말엔 베란다 창틀을 닦았어.'],
      ['USER', '결론부터 말하면 그걸 반품하기로 했어.'],
    ],
    ev: [0, 2], anchor: [2, '그걸'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '올해 초에 중고로 자전거를 한 대 들였어.'],
      ['USER', '요즘 계단 오르내리기를 좀 하고 있어.'],
      ['USER', '그게 뒷바퀴 쪽에서 소리가 나기 시작했어.'],
      ['USER', '계단은 5층까지만 걸어.'],
      ['ASSISTANT', '자전거 뒷바퀴 소음으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '그게'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '지난달에 사무실에 공유 프린터를 한 대 놨어.'],
      ['USER', '그리고 탕비실 커피 머신 원두를 바꿨어.'],
      ['USER', '그게 요즘 자꾸 용지 걸림이 나.'],
      ['USER', '원두는 산미가 덜한 걸로 골랐어.'],
      ['ASSISTANT', '프린터요?'],
      ['USER', '응, 그거.'],
      ['USER', '머신 청소는 금요일에 하기로 했어.'],
      ['ASSISTANT', '프린터 용지 걸림으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [2, '그게'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '점심 도시락은 오늘도 싸 왔어.'],
      ['USER', '어제 팀 repo에 새 linter config를 올렸어.'],
      ['USER', '그게 CI에서 자꾸 warning을 뱉네.'],
      ['USER', '도시락 반찬은 좀 남겼고.'],
    ],
    ev: [1, 2], anchor: [2, '그게'],
  },
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '며칠 전에 거실 등을 새로 달았어.'],
      ['USER', '더 정확히는 전등만 갈고 스위치는 그대로 뒀어.'],
      ['USER', '창문 방충망도 손봐야 해.'],
      ['USER', '그게 가끔 깜빡거려.'],
    ],
    ev: [0, 1, 3], anchor: [3, '그게'],
  },

  // --- p1b6-sk-1e2014a2b5e70a20 | HELD/CLEAR | state relation plus its cause relation ---
  {
    sk: 'p1b6-sk-1e2014a2b5e70a20', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 현관문 얘기로 돌아가면, 문이 잘 안 닫혀.'],
      ['USER', '오늘 장을 좀 많이 봤어.'],
      ['USER', '경첩이 내려앉아서 그런 거래.'],
      ['USER', '장바구니가 무거워서 두 번에 나눠 들고 왔어.'],
      ['ASSISTANT', '경첩 문제로 문이 안 닫히는 걸로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '문이 잘 안 닫혀'],
  },
  {
    sk: 'p1b6-sk-1e2014a2b5e70a20', lang: 'EN', dp: 'SELF_REVISION',
    turns: [
      ['USER', 'The upstairs radiator is not heating.'],
      ['USER', 'Let me be exact: it is the one in the back bedroom.'],
      ['USER', 'I finally framed the photos from last summer.'],
      ['USER', 'The plumber said there is air trapped in it.'],
    ],
    ev: [0, 1, 3], anchor: [0, 'not heating'],
  },
  {
    sk: 'p1b6-sk-1e2014a2b5e70a20', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '노트북 팬이 계속 크게 돌아.'],
      ['USER', '책상 배치를 조금 바꿨어.'],
      ['USER', '통풍구에 먼지가 꽉 차서 그렇대.'],
      ['USER', '모니터는 왼쪽으로 옮겼고.'],
      ['ASSISTANT', '통풍구 먼지로 인한 팬 소음으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '팬이 계속 크게 돌아'],
  },
  {
    sk: 'p1b6-sk-1e2014a2b5e70a20', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 우리 build가 느려진 건 cache 때문이야.'],
      ['USER', '오늘 아침에 자전거 공기압을 채웠어.'],
      ['USER', 'build 시간이 평소의 두 배로 늘었거든.'],
      ['USER', '타이어가 좀 물렁했어.'],
      ['USER', 'CI cache가 매번 miss 나고 있어서 그래.'],
      ['USER', '펌프는 사무실에 두고 왔고.'],
      ['ASSISTANT', 'cache miss로 인한 build 지연으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, 'build 시간이 평소의 두 배로 늘었거든'],
  },

  // --- p1b6-sk-28736b74c85fcc93 | TRAIN/ESCALATE | relation between two approximations ---
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '다음 주 세미나를 준비 중인데, 참석 인원을 스무 명 정도, 서른 명 정도로 잡아 뒀어.'],
    ],
    ev: [0], anchor: [0, '스무 명 정도, 서른 명 정도'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 답사는 이틀 정도, 사흘 정도로 얘기가 됐어.'],
      ['USER', '숙소는 아직 안 잡았어.'],
      ['ASSISTANT', '이틀 정도, 사흘 정도요?'],
      ['USER', '응, 그렇게.'],
      ['USER', '차편은 기차로 갈 것 같아.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 3, 5], anchor: [0, '이틀 정도, 사흘 정도'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '화분 흙은 두 포대쯤, 세 포대쯤 사 두면 된다더라.'],
      ['USER', '그리고 베란다 청소는 주말에 하려고.'],
      ['ASSISTANT', '그 분량으로 적어 둘게요.'],
    ],
    ev: [0, 2], anchor: [0, '두 포대쯤, 세 포대쯤'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 행사 예산은 백만 원 정도로 얘기하고 있어.'],
      ['USER', '현수막 문구는 아직 안 정했어.'],
      ['USER', '더 좁히면 백이십만 원 정도라는 얘기도 있었고.'],
      ['USER', '현수막은 업체 두 곳에 견적을 넣었어.'],
      ['USER', '지금 내가 들고 있는 숫자는 그 둘이야.'],
      ['USER', '견적은 내일 온대.'],
      ['ASSISTANT', '두 수치 그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '백만 원 정도'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 hiring 얘기로 돌아가면, 이번 분기에 두 명 정도, 네 명 정도 뽑는 걸로 얘기됐어.'],
      ['USER', '오늘 회의실 예약 시스템이 잠깐 안 됐어.'],
      ['USER', '그 숫자는 아직 그대로야.'],
      ['USER', '시스템은 지금은 복구됐고.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '두 명 정도, 네 명 정도'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '배송은 사흘 정도 걸린다고 했다가 닷새 정도라고도 했어.'],
    ],
    ev: [0], anchor: [0, '사흘 정도'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 스터디는 여섯 명쯤, 여덟 명쯤으로 생각하고 있어.'],
      ['USER', '장소는 도서관 스터디룸이야.'],
      ['ASSISTANT', '인원은 그렇게 적어 둘게요.'],
    ],
    ev: [0, 2], anchor: [0, '여섯 명쯤, 여덟 명쯤'],
  },
  {
    sk: 'p1b6-sk-28736b74c85fcc93', lang: 'EN', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', 'The upshot is that the trip is about five days, about a week.'],
      ['USER', 'I have not booked anything yet.'],
      ['USER', 'Those are the two figures I was given.'],
      ['USER', 'The flights look fine either way.'],
      ['ASSISTANT', 'Noted as given.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'about five days, about a week'],
  },

  // --- p1b6-sk-2b6f4ac9e15d8307 | TRAIN/CLEAR | preference and decision kept distinct ---
  {
    sk: 'p1b6-sk-2b6f4ac9e15d8307', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '자취방 인터넷을 두 군데 놓고 보고 있어.'],
      ['USER', '오늘 분리수거를 했어.'],
      ['USER', 'A사가 B사보다 더 마음에 들긴 해.'],
      ['USER', '종이랑 플라스틱을 따로 묶었어.'],
      ['USER', '그런데 어디로 할지는 아직 안 정했어.'],
      ['USER', '캔은 다음 주에 내놓으려고.'],
      ['USER', '선호랑 결정은 별개로 두고 있어.'],
      ['USER', '분리수거장은 지하 1층이야.'],
      ['ASSISTANT', '선호는 A사, 결정은 미정으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [2, 'A사가 B사보다 더 마음에 들긴 해'],
  },
  {
    sk: 'p1b6-sk-2b6f4ac9e15d8307', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 framework 후보는 두 개인데 R 쪽이 더 끌려.'],
      ['USER', '오늘 모니터 arm을 달았어.'],
      ['USER', '그런데 뭘 쓸지는 아직 결정 안 했어.'],
      ['USER', 'arm은 생각보다 튼튼하더라.'],
      ['ASSISTANT', '선호만 정해진 거죠?'],
      ['USER', '응, 그것만.'],
      ['USER', '케이블 정리는 아직이야.'],
      ['ASSISTANT', '선호 R, 결정 미정으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [0, 'R 쪽이 더 끌려'],
  },
  {
    sk: 'p1b6-sk-2b6f4ac9e15d8307', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이사 업체는 두 곳 중에 앞쪽이 더 나아 보여.'],
      ['USER', '그리고 새 커튼은 아이보리로 골랐어.'],
      ['USER', '다만 어디랑 계약할지는 아직 안 정했어.'],
      ['USER', '커튼은 다음 주에 온대.'],
    ],
    ev: [0, 2], anchor: [0, '앞쪽이 더 나아 보여'],
  },
  {
    sk: 'p1b6-sk-2b6f4ac9e15d8307', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '대학원은 두 곳을 놓고 보는데 지금은 국내 쪽이 더 마음에 들어.'],
      ['USER', '더 정확히 말하면 마음이 기우는 것과 지원 여부를 정한 건 별개야.'],
    ],
    ev: [0, 1], anchor: [0, '국내 쪽이 더 마음에 들어'],
  },

  // --- p1b6-sk-2da4e54e6609e34b | TRAIN/ESCALATE | membership in the exception subcategory ---
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 주차 얘기로 돌아가면, 우리 건물은 방문 차량은 두 시간까지만 무료야.'],
      ['USER', '오늘 우편함을 비웠어.'],
      ['USER', '다만 협력업체 차량은 종일 무료라는 예외가 있어. 내일 오는 사람은 우리 쪽 일로 오는 설비 기사야.'],
      ['USER', '우편물은 대부분 광고였고.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '설비 기사'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '우리 아파트 헬스장은 입주민만 쓸 수 있어. 아, 정확히는 입주민 직계가족은 예외로 같이 쓸 수 있어.'],
      ['USER', '엘리베이터 점검은 내일이래.'],
      ['USER', '이번 주말에 우리 집에 오는 건 장모님이야.'],
    ],
    ev: [0, 2], anchor: [2, '장모님'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '이 license는 상업적 사용을 금지하고 있어.'],
      ['USER', '오늘 회사 노트북을 포맷했어.'],
      ['USER', '다만 non-profit 교육 목적은 예외로 허용돼.'],
      ['USER', '포맷하고 나니 훨씬 빠르네.'],
      ['USER', '내가 쓰려는 건 사내 신입 교육 자료야.'],
    ],
    ev: [0, 2, 4], anchor: [4, '사내 신입 교육 자료'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 아직 환불 신청을 넣을지 못 정했어.'],
      ['USER', '오늘 신발장을 정리했어.'],
      ['USER', '이 쇼핑몰은 개봉한 상품은 환불이 안 돼.'],
      ['USER', '안 신는 신발을 세 켤레 뺐어.'],
      ['USER', '다만 불량인 경우는 예외로 환불이 돼.'],
      ['USER', '신발은 기부함에 넣으려고.'],
      ['USER', '내가 받은 건 개봉했는데 박음질이 살짝 틀어져 있었어.'],
    ],
    ev: [0, 2, 4, 6], anchor: [6, '박음질이 살짝 틀어져'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '우리 학과는 계절학기 수강을 두 과목까지로 제한하는데, 졸업 예정자는 예외로 세 과목까지 들을 수 있어. 나는 이번 학기에 졸업 요건을 다 채우면 8월 졸업이야.'],
    ],
    ev: [0], anchor: [0, '8월 졸업'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'The gym charges a fee for guest passes.'],
      ['USER', 'Members who joined before the refurbishment are exempt.'],
      ['USER', 'I left my towel in the locker again.'],
      ['USER', 'I signed my paperwork the week the scaffolding went up.'],
      ['USER', 'The attendant put it aside for me.'],
      ['ASSISTANT', 'Before the refurbishment?'],
      ['USER', 'That is when I signed.'],
    ],
    ev: [0, 1, 3, 5, 6], anchor: [3, 'the week the scaffolding went up'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이 쿠폰은 신규 가입자만 쓸 수 있는데, 예전에 탈퇴한 적 있는 사람은 재가입자로 보고 제외한다는 단서가 붙어 있어.'],
      ['USER', '그리고 오늘 자전거 자물쇠를 새로 샀어.'],
      ['USER', '나는 작년에 쓰던 계정을 지우고 이번에 다른 이메일로 새로 가입했어.'],
      ['USER', '자물쇠는 번호식으로 골랐고.'],
    ],
    ev: [0, 2], anchor: [2, '다른 이메일로 새로 가입'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이 conference는 발표자에게 등록비를 면제해 줘.'],
      ['USER', '호텔은 근처로 잡았어.'],
      ['USER', '더 정확히는 oral 발표자만 면제고 poster는 반값이야.'],
      ['USER', '체크인은 하루 전날로 했어.'],
      ['USER', '나는 lightning talk 하나를 맡았어.'],
    ],
    ev: [0, 2, 4], anchor: [4, 'lightning talk'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 보험 얘기로 돌아가면, 이 특약은 입원 5일 이상부터 보장돼.'],
      ['USER', '오늘 우체국에 들렀어.'],
      ['USER', '다만 응급실을 거친 건은 예외로 일수와 무관하게 보장된대.'],
      ['USER', '등기 하나 부치고 왔어.'],
      ['USER', '나는 새벽에 응급실 거쳐서 하루 입원했다가 나왔어.'],
      ['USER', '등기는 사흘 걸린대.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '응급실 거쳐서 하루 입원'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이 할인은 학생만 받을 수 있어. 아, 정확히는 재학 증명이 되는 사람만이야.'],
      ['USER', '오늘 도서관 자리를 못 잡았어.'],
      ['USER', '나는 이번 학기 휴학 중이고 학생증은 아직 유효해.'],
    ],
    ev: [0, 2], anchor: [2, '휴학 중이고 학생증은 아직 유효해'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이 주차장은 경차만 할인이 되는데, 저공해차로 등록된 차는 예외로 같은 할인을 받아. 내 차는 하이브리드인데 저공해차 스티커는 아직 안 붙였어.'],
    ],
    ev: [0], anchor: [0, '하이브리드인데 저공해차 스티커는 아직 안 붙였어'],
  },
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 아직 결제 버튼을 못 눌렀어.'],
      ['USER', '오늘 택배 상자를 정리했어.'],
      ['USER', '이 쇼핑몰은 5만 원 이상이면 무료배송인데, 예약 상품은 예외로 금액과 상관없이 배송비가 붙어.'],
      ['USER', '상자는 접어서 내놨어.'],
      ['USER', '내가 담은 건 다음 달에 출고되는 한정판이야.'],
    ],
    ev: [0, 2, 4], anchor: [4, '다음 달에 출고되는 한정판'],
  },

  // --- p1b6-sk-2fa39ece4157b2b8 | HELD/ESCALATE | rule over a container, later entrant ---
  {
    sk: 'p1b6-sk-2fa39ece4157b2b8', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이 archive 폴더의 문서는 분기 말에 정리하기로 했어.'],
      ['USER', '오늘 slack 상태 메시지를 바꿨어.'],
      ['USER', '방금 회의록 하나를 그 폴더로 옮겼어.'],
    ],
    ev: [0, 2], anchor: [0, '분기 말에 정리하기로'],
  },
  {
    sk: 'p1b6-sk-2fa39ece4157b2b8', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '냉장고 위 칸에 있는 반찬은 주말에 다 비우기로 했어.'],
      ['USER', '오늘 장바구니를 새로 샀어.'],
      ['USER', '아까 엄마가 주신 김치를 위 칸에 넣어 뒀어.'],
      ['USER', '장바구니는 보냉 되는 걸로 골랐어.'],
      ['ASSISTANT', '위 칸 전부요?'],
      ['USER', '응, 위 칸.'],
      ['USER', '보냉백은 접어서 넣어 뒀어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [0, '주말에 다 비우기로'],
  },

  // --- p1b6-sk-32f27410e2beb10c | HELD/CLEAR | report bound to a past interval ---
  {
    sk: 'p1b6-sk-32f27410e2beb10c', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '대학 다닐 때는 매일 아침 수영을 했었어.'],
      ['USER', '요즘 사무실 자리를 창가로 옮겼어.'],
      ['USER', '그때는 새벽반을 끊어 놨었고.'],
      ['USER', '창가는 오후에 좀 덥더라.'],
      ['ASSISTANT', '대학 시절 얘기로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '매일 아침 수영을 했었어'],
  },
  {
    sk: 'p1b6-sk-32f27410e2beb10c', lang: 'EN', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', 'Back in my first job I commuted by ferry.'],
      ['USER', 'I repotted the basil this morning.'],
      ['USER', 'To be precise, that was the two years before I moved inland.'],
      ['USER', 'The old pot had cracked at the base.'],
      ['USER', 'The company had an office right by the pier then.'],
      ['USER', 'I used the last of the compost.'],
      ['USER', 'That whole arrangement ended when the route closed.'],
      ['USER', 'I should buy more compost.'],
      ['ASSISTANT', 'Noted as a past arrangement.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, 'I commuted by ferry'],
  },
  {
    sk: 'p1b6-sk-32f27410e2beb10c', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 자취 얘기로 돌아가면, 그 시절엔 라면만 먹고 살았어. 지금은 아니고 그때 얘기야.'],
    ],
    ev: [0], anchor: [0, '라면만 먹고 살았어'],
  },
  {
    sk: 'p1b6-sk-32f27410e2beb10c', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '예전 팀에선 daily stand-up을 아침 9시에 했었어.'],
      ['USER', '오늘 키보드 키캡을 바꿨어.'],
      ['USER', '아, 정확히는 내가 있던 2년 동안 그랬어.'],
      ['USER', '키캡은 무각으로 골랐어.'],
      ['ASSISTANT', '그 시절 기준으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '아침 9시에 했었어'],
  },

  // --- p1b6-sk-379bd3b3dd05d85e | HELD/CLEAR | category shorthand covering several members ---
  {
    sk: 'p1b6-sk-379bd3b3dd05d85e', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '책상 위에 노트북, 태블릿, 전자책 리더기가 올라와 있어.'],
      ['USER', '창문은 열어 뒀어.'],
      ['USER', '전자기기는 자기 전에 다 충전해 둬.'],
    ],
    ev: [0, 2], anchor: [2, '전자기기'],
  },
  {
    sk: 'p1b6-sk-379bd3b3dd05d85e', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 유제품은 이번 주에 다 비워야 해.'],
      ['USER', '오늘 분리수거 요일을 확인했어.'],
      ['USER', '냉장고에 우유, 요구르트, 치즈가 들어 있어.'],
      ['USER', '종이는 화요일이래.'],
      ['USER', '그것들 유통기한이 다 이번 주야.'],
      ['USER', '플라스틱은 목요일이고.'],
      ['ASSISTANT', '유제품 전체로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '유제품'],
  },
  {
    sk: 'p1b6-sk-379bd3b3dd05d85e', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 이사에서 옮길 건 침대, 책장, 식탁이야.'],
      ['USER', '사다리차는 예약했어.'],
      ['USER', '가구는 전부 분해해서 옮기기로 했어.'],
      ['USER', '사다리차는 오전 9시에 온대.'],
      ['ASSISTANT', '가구 전체 분해로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '가구'],
  },
  {
    sk: 'p1b6-sk-379bd3b3dd05d85e', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '서랍에 볼펜, 형광펜, 네임펜이 들어 있어.'],
      ['ASSISTANT', '필기구는 어떻게 할까요?'],
      ['USER', '다 새 걸로 바꿔 줘.'],
    ],
    ev: [0, 1, 2], anchor: [1, '필기구'],
  },

  // --- p1b6-sk-38c426bb2e0bff42 | TRAIN/ESCALATE | a qualifier is mentioned but not attached ---
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이번 sprint 회고는 금요일 오후에 하기로 했어.'],
      ['USER', '오늘 사내 카페 쿠폰이 만료됐어.'],
      ['USER', 'remote 참여를 허용한다는 얘기도 나왔어.'],
    ],
    ev: [0, 2], anchor: [0, '금요일 오후에 하기로 했어'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '다음 주 워크숍은 오전 10시에 시작해.'],
      ['USER', '오늘 명함을 새로 받았어.'],
      ['USER', '더 붙이자면, 사전 등록자만 입장 가능하다는 말도 있었어.'],
      ['USER', '명함은 로고가 바뀌었더라.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '오전 10시에 시작해'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 도서 반납 말인데, 반납은 3층 데스크에서 받아.'],
      ['USER', '오늘 버스를 놓쳐서 한 대 기다렸어.'],
      ['USER', '무인 반납기 얘기도 같이 나왔었고.'],
      ['USER', '버스는 배차가 10분이더라.'],
      ['USER', '다시 반납 얘기로 오면, 내일 가려고 해.'],
      ['USER', '다음엔 좀 일찍 나가야겠어.'],
      ['ASSISTANT', '3층 데스크 반납으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '3층 데스크에서 받아'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'EN', dp: 'SELF_REVISION',
    turns: [
      ['USER', 'The team lunch is booked for Thursday.'],
      ['USER', 'I finally replaced the desk lamp bulb.'],
      ['USER', 'Let me add: someone mentioned a vegetarian menu.'],
    ],
    ev: [0, 2], anchor: [0, 'booked for Thursday'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 정기 점검은 토요일에 진행돼. 야간 작업이 가능하다는 말도 있었어.'],
    ],
    ev: [0], anchor: [0, '토요일에 진행돼'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 배포는 수요일 새벽이야.'],
      ['USER', '오늘 헤드셋 마이크가 안 잡혔어.'],
      ['USER', 'rollback window를 따로 둔다는 얘기도 있었어.'],
      ['USER', '마이크는 케이블 문제였어.'],
      ['ASSISTANT', '수요일 새벽으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '수요일 새벽'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 분기 성과 면담은 팀장이 직접 진행해.'],
      ['USER', '오늘 사무실 온도가 좀 낮았어.'],
      ['USER', '자기평가서를 먼저 낸다는 얘기도 돌더라.'],
    ],
    ev: [0, 2], anchor: [0, '팀장이 직접 진행해'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 등록은 선착순으로 받는대.'],
      ['USER', '오늘 프린터 용지를 채웠어.'],
      ['USER', '대기자 명단도 운영한다는 말이 있었어.'],
      ['USER', '용지는 두 박스 남았어.'],
      ['ASSISTANT', '선착순으로요?'],
      ['USER', '응, 그렇게 들었어.'],
    ],
    ev: [0, 2, 4, 5], anchor: [0, '선착순으로 받는대'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이번 김장은 우리 집에서 하기로 했어.'],
      ['USER', '요즘 아침에 좀 쌀쌀해.'],
      ['USER', '절임 배추를 주문한다는 얘기도 나왔어.'],
      ['USER', '이불을 겨울 것으로 바꿨어.'],
      ['USER', '날짜는 다음 주 토요일이야.'],
      ['USER', '난방은 아직 안 켰어.'],
      ['ASSISTANT', '우리 집, 다음 주 토요일로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '우리 집에서 하기로 했어'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 촬영은 실내에서 해. 더 말하자면 조명 대여 얘기도 나왔어.'],
    ],
    ev: [0], anchor: [0, '실내에서 해'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 onboarding 얘기로 돌아가면, 첫 주는 buddy가 붙어.'],
      ['USER', '오늘 사원증 사진을 다시 찍었어.'],
      ['USER', '2주차 평가가 있다는 얘기도 같이 나왔어.'],
      ['USER', '사진은 이번엔 잘 나왔어.'],
      ['ASSISTANT', '첫 주 buddy로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '첫 주는 buddy가 붙어'],
  },
  {
    sk: 'p1b6-sk-38c426bb2e0bff42', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이번 모임 회비는 1인당 3만 원이야. 아, 정확히 말하면 현금만 받는대.'],
      ['USER', '오늘 우산을 새로 샀어.'],
      ['USER', '식사 외 비용은 따로라는 말도 있었어.'],
    ],
    ev: [0, 2], anchor: [0, '1인당 3만 원'],
  },

  // --- p1b6-sk-43016ef6da889a87 | TRAIN/CLEAR | quoted content, not adopted as own ---
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '동생이 다음 달에 이사한다고 하더라.'],
      ['USER', '오늘 화장실 전구를 갈았어.'],
      ['USER', '회사가 가까운 데로 옮긴다고 했어.'],
      ['USER', '전구는 LED로 바꿨어.'],
      ['USER', '보증금도 거의 맞춰 놨다고 하고.'],
      ['USER', '욕실 환풍기도 한번 봐야겠어.'],
      ['USER', '그렇게 말하는 걸 들었어.'],
      ['USER', '환풍기는 소리가 좀 커.'],
      ['ASSISTANT', '동생분 말씀으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '다음 달에 이사한다고 하더라'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 팀장이 이번 건은 다음 분기로 미룬다고 했어.'],
      ['USER', '오늘 사무실 블라인드를 청소했어.'],
      ['USER', '예산 배정이 늦어졌다고 하더라.'],
      ['USER', '블라인드는 먼지가 많았어.'],
      ['USER', '나는 그렇게 전달받았어.'],
      ['USER', '창틀도 닦았고.'],
      ['ASSISTANT', '팀장님 전달 내용으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '다음 분기로 미룬다고 했어'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'EN', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', 'My neighbour keeps chickens in the back garden.'],
      ['USER', 'I mowed the lawn yesterday.'],
      ['USER', 'She says the council allows up to six birds.'],
      ['USER', 'The mower needs a new blade.'],
      ['ASSISTANT', 'Noted as what your neighbour said.'],
    ],
    ev: [0, 2, 4], anchor: [2, 'the council allows up to six birds'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'PM이 이번 release는 feature freeze 없이 간다고 했어.'],
      ['USER', '오늘 회의실 프로젝터가 안 켜졌어.'],
      ['ASSISTANT', 'PM 말씀이요?'],
      ['USER', '응, 그 사람 말.'],
    ],
    ev: [0, 2, 3], anchor: [0, 'feature freeze 없이 간다고 했어'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 점심은 구내식당에서 먹었어.'],
      ['USER', '친구가 그 식당 밥이 예전보다 나아졌다고 하더라.'],
      ['USER', '나는 오후에 회의가 두 개 있어.'],
    ],
    ev: [1], anchor: [1, '예전보다 나아졌다고 하더라'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '부동산에서 그 집은 수리가 끝났다고 했어.'],
      ['USER', '오늘 자전거 공기압을 봤어.'],
      ['USER', '더 정확히는 도배랑 바닥까지 다 했다고 하더라.'],
      ['USER', '앞바퀴만 좀 빠져 있었어.'],
      ['ASSISTANT', '부동산 전달 내용으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '수리가 끝났다고 했어'],
  },
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 학원 얘기로 돌아가면, 선생님이 이번 반은 인원이 적다고 했어.'],
      ['USER', '오늘 우편물을 찾아왔어.'],
      ['USER', '나는 그렇게 들었어.'],
    ],
    ev: [0, 2], anchor: [0, '인원이 적다고 했어'],
  },

  // --- p1b6-sk-47c9b12e0a6f83d5 | DEV/CLEAR | new state added alongside, not replacing ---
  {
    sk: 'p1b6-sk-47c9b12e0a6f83d5', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '나는 매주 수요일에 요가 수업을 들어.'],
      ['USER', '오늘 현관 매트를 바꿨어.'],
      ['USER', '아, 정확히 말하면 저녁 7시 수업이야.'],
      ['USER', '매트는 극세사로 골랐어.'],
      ['USER', '이번 달부터 토요일 필라테스를 하나 더 추가했어. 수요일 수업은 그대로 두고.'],
      ['USER', '매트는 세탁기에 돌려도 된대.'],
      ['ASSISTANT', '수요일 요가 유지, 토요일 필라테스 추가로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '매주 수요일에 요가 수업을 들어'],
  },
  {
    sk: 'p1b6-sk-47c9b12e0a6f83d5', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '아침마다 English 뉴스 podcast를 듣고 있어.'],
      ['USER', '오늘 이어폰을 충전했어.'],
      ['USER', '이번 주부터 저녁에 단어 앱을 하나 더 시작했어. 아침 podcast는 계속 듣고.'],
      ['USER', '이어폰은 케이스가 좀 낡았어.'],
      ['ASSISTANT', '둘 다 유지로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'English 뉴스 podcast를 듣고 있어'],
  },

  // --- p1b6-sk-49e0f357eda8365c | TRAIN/ESCALATE | two incompatible statements, neither marked ---
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 모임 장소를 두 번 들었어. 처음엔 강남역이라고 했고, 나중엔 신촌이라고 했어.'],
    ],
    ev: [0], anchor: [0, '강남역'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 프로젝트 마감은 15일이라고 공지에 적혀 있었어.'],
      ['USER', '오늘 사무실 공유기를 재부팅했어.'],
      ['USER', '팀 채널에는 22일이라고 올라와 있어.'],
    ],
    ev: [0, 2], anchor: [0, '15일'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '아버지는 그 약을 하루 두 번 드신다고 했어.'],
      ['USER', '오늘 약국에 들렀어.'],
      ['USER', '처방전에는 하루 세 번으로 적혀 있어.'],
      ['USER', '약국은 한산했어.'],
      ['ASSISTANT', '두 번, 세 번 둘 다요?'],
      ['USER', '응, 그렇게 돼 있어.'],
    ],
    ev: [0, 2, 4, 5], anchor: [0, '하루 두 번'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'EN', dp: 'INTERLEAVED',
    turns: [
      ['USER', 'The invoice lists the delivery as completed on the ninth.'],
      ['USER', 'I moved the printer to the other desk.'],
      ['USER', 'The courier app shows it as still in transit.'],
      ['USER', 'The cable was too short so I bought an extension.'],
      ['USER', 'Both records are open in front of me.'],
      ['USER', 'The extension arrived this morning.'],
      ['ASSISTANT', 'Noted as it stands.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, 'completed on the ninth'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 workshop 정원은 20명이라고 안내문에 적혀 있어.'],
      ['USER', '오늘 노트북 가방을 바꿨어.'],
      ['USER', '더 보태면, 담당자는 email에서 30명이라고 썼어.'],
      ['USER', '가방은 어깨끈이 넓은 걸로 골랐어.'],
      ['ASSISTANT', '두 숫자 모두 남겨 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '20명'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 정산 얘기로 돌아가면, 영수증에는 4만 2천 원, 카드 문자에는 4만 8천 원으로 찍혀 있어.'],
    ],
    ev: [0], anchor: [0, '4만 2천 원'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '그 가게는 화요일 휴무라고 들었어. 간판에는 수요일 휴무라고 적혀 있더라.'],
      ['USER', '오늘 그 앞을 지나갔어.'],
      ['USER', '아, 정리하자면 둘 다 그대로 기억하고 있어.'],
    ],
    ev: [0, 2], anchor: [0, '화요일 휴무'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '관리비 고지서에는 이번 달이 12만 원으로 나와 있어.'],
      ['USER', '오늘 재활용을 내놨어.'],
      ['USER', '관리실 게시판에는 14만 원이라고 붙어 있어.'],
      ['USER', '종이만 따로 묶었어.'],
      ['ASSISTANT', '두 금액 그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '12만 원'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 그 강의 요일이 두 가지로 돼 있어.'],
      ['USER', '오늘 책상 정리를 했어.'],
      ['USER', '수강신청 화면에는 월요일로 떠 있어.'],
      ['USER', '서랍을 하나 비웠어.'],
      ['USER', '강의계획서에는 목요일로 적혀 있고.'],
      ['USER', '안 쓰는 케이블을 버렸어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '월요일'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 팀 outing 예산은 slack 공지에 1인당 3만 원으로 올라왔어.'],
      ['USER', '오늘 사무실 화분을 옮겼어.'],
      ['USER', '총무가 준 spreadsheet에는 5만 원으로 돼 있어.'],
    ],
    ev: [0, 2], anchor: [0, '1인당 3만 원'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 시험 범위는 교수님이 3장까지라고 말했어.'],
      ['USER', '오늘 도서관 사물함을 신청했어.'],
      ['USER', '공지사항에는 5장까지로 적혀 있어.'],
      ['USER', '사물함은 2층으로 배정받았어.'],
      ['USER', '아직 어느 쪽으로도 바뀐 건 없어.'],
      ['USER', '사물함 열쇠는 내일 받아.'],
      ['ASSISTANT', '3장, 5장 둘 다요?'],
      ['USER', '응, 둘 다.'],
      ['USER', '열쇠는 분실하면 벌금이래.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 7, 9], anchor: [0, '3장까지'],
  },
  {
    sk: 'p1b6-sk-49e0f357eda8365c', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 아침에 창문을 열어 뒀어.'],
      ['USER', '세탁소에서는 금요일에 찾으러 오라고 했는데, 접수증에는 목요일로 찍혀 있어.'],
      ['USER', '바람이 좀 들어와서 다시 닫았어.'],
    ],
    ev: [1], anchor: [1, '금요일'],
  },

  // --- p1b6-sk-4bbd555977190591 | TRAIN/CLEAR | elliptical confirmation of a single candidate ---
  {
    sk: 'p1b6-sk-4bbd555977190591', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['ASSISTANT', '다음 주 화요일 회의 말인데요, 더 정확히는 오후 3시로 옮길까요?'],
      ['USER', '오늘 프린터에 용지를 채웠어.'],
      ['USER', '응, 그렇게.'],
      ['USER', '용지는 A4로만 채웠어.'],
      ['ASSISTANT', '화요일 오후 3시로 옮겨 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '그렇게'],
  },
  {
    sk: 'p1b6-sk-4bbd555977190591', lang: 'EN', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', 'Back to the catering question.'],
      ['ASSISTANT', 'Should I put the order in for twenty people?'],
      ['USER', 'I need to find my badge before Friday.'],
      ['USER', 'Yes, do that.'],
    ],
    ev: [1, 3], anchor: [3, 'Yes, do that'],
  },
  {
    sk: 'p1b6-sk-4bbd555977190591', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['ASSISTANT', '지금 쓰는 template을 v2로 바꿀까요?'],
      ['USER', '오늘 마우스 패드를 새로 깔았어.'],
      ['USER', '어, 아니 잠깐. 응, 바꿔 줘.'],
      ['USER', '패드는 좀 넓은 걸로 샀어.'],
      ['ASSISTANT', 'v2로 바꿔 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '바꿔 줘'],
  },
  {
    sk: 'p1b6-sk-4bbd555977190591', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['ASSISTANT', '이번 주 장보기 목록에 쌀을 넣을까요?'],
      ['USER', '오늘 냉장고를 닦았어.'],
      ['USER', '응, 넣어 줘.'],
      ['USER', '야채칸이 제일 지저분했어.'],
      ['USER', '10kg짜리로.'],
      ['USER', '행주는 새로 꺼냈어.'],
      ['ASSISTANT', '쌀 10kg으로 넣어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '넣어 줘'],
  },

  // --- p1b6-sk-5229ea237196499d | TRAIN/ESCALATE | what the positive response targets ---
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '아까 회의에서 예산이 남았다는 얘기가 한참 오갔고, 그 끝에 회식을 목요일로 하자는 제안이 나왔어. 나는 좋다고 했고.'],
    ],
    ev: [0], anchor: [0, '좋다고 했고'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '오늘 회의에서 서버 비용이 계속 는다는 얘기를 한참 했어.'],
      ['USER', '점심은 도시락을 시켰어.'],
      ['USER', '그러다 누가 인스턴스를 줄이자고 제안했어. 나는 괜찮다고 했어.'],
      ['USER', '도시락은 좀 짰어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '괜찮다고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '장보기 동선이 비효율적이라는 얘기를 아내랑 한참 했어. 그러다 아내가 배송으로 바꾸자고 제안했어.'],
      ['USER', '오늘 현관 센서등이 깜빡였어.'],
      ['ASSISTANT', '어떻게 하셨어요?'],
      ['USER', '좋다고 했지.'],
    ],
    ev: [0, 2, 3], anchor: [3, '좋다고 했지'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 standup에서 test coverage가 낮다는 얘기가 오래 나왔어.'],
      ['USER', '사무실 의자 높이를 좀 낮췄어.'],
      ['USER', '그러다 동료가 CI에 coverage gate를 걸자고 제안했어.'],
      ['USER', '허리가 훨씬 편해졌어.'],
      ['USER', '나는 좋다고 답했어.'],
      ['USER', '모니터도 조금 내렸어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '좋다고 답했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '주말 일정 얘기를 하다가 날씨가 계속 흐리다는 말이 길게 나왔어.'],
      ['USER', '오늘 빨래를 돌렸어.'],
      ['USER', '더 말하자면, 그 끝에 친구가 실내 전시로 바꾸자고 제안했고 나는 그러자고 했어.'],
      ['USER', '빨래는 건조기에 돌렸어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '그러자고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 창고 정리 얘기로 돌아가면, 물건이 너무 많다는 말이 한참 오갔어.'],
      ['USER', '오늘 형광등을 갈았어.'],
      ['USER', '그러다 형이 다음 달에 한 번에 치우자고 제안했고, 나는 좋다고 했어.'],
    ],
    ev: [0, 2], anchor: [2, '좋다고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '동아리에서 회비를 올리자는 얘기가 길게 나왔어. 아, 정확히는 그 끝에 후배가 만 원 인상을 제안했고 나는 찬성한다고 했어.'],
    ],
    ev: [0], anchor: [0, '찬성한다고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'EN', dp: 'CANONICAL',
    turns: [
      ['USER', 'We spent most of the call on how slow the reporting has become.'],
      ['USER', 'I finally cleaned the whiteboard.'],
      ['USER', 'Then someone proposed moving the reports to a weekly cadence. I said that sounded good.'],
      ['USER', 'The markers were all dried out.'],
      ['ASSISTANT', 'Noted.'],
    ],
    ev: [0, 2, 4], anchor: [2, 'I said that sounded good'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 나는 긍정적으로 답했어.'],
      ['USER', '오늘 사무실 창문을 닦았어.'],
      ['USER', '회의에서 build 시간이 길다는 얘기가 계속 나왔고, 그러다 누가 cache를 새로 깔자고 제안했거든.'],
    ],
    ev: [0, 2], anchor: [0, '긍정적으로 답했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '어제 가족 단톡방에서 명절 이동이 힘들다는 얘기가 오래 나왔어.'],
      ['USER', '오늘 겨울옷을 꺼냈어.'],
      ['USER', '그러다 누나가 올해는 서울에서 모이자고 제안했어.'],
      ['USER', '패딩은 세탁소에 맡겼어.'],
      ['USER', '나는 그게 좋겠다고 했어.'],
      ['USER', '세탁은 사흘 걸린대.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '그게 좋겠다고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '스터디에서 진도가 너무 느리다는 얘기를 한참 했어.'],
      ['USER', '오늘 노트를 새로 샀어.'],
      ['USER', '그러다 한 분이 주 2회로 늘리자고 제안했어.'],
      ['USER', '노트는 줄 없는 걸로 골랐어.'],
      ['ASSISTANT', '그래서요?'],
      ['USER', '나는 좋다고 했어.'],
    ],
    ev: [0, 2, 4, 5], anchor: [5, '좋다고 했어'],
  },
  {
    sk: 'p1b6-sk-5229ea237196499d', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 아침에 우산을 챙겼어.'],
      ['USER', '관리비가 계속 오른다는 얘기를 이웃들과 한참 했고, 그러다 누가 관리사무소에 같이 항의하자고 제안했어. 나도 좋다고 했어.'],
      ['USER', '비는 결국 안 왔어.'],
    ],
    ev: [1], anchor: [1, '좋다고 했어'],
  },

  // --- p1b6-sk-5269c91fcfb6c2cd | DEV/ESCALATE | borderline category membership ---
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이 동호회 정기권은 정회원에게만 줘. 더 정확히는, 안내문에 정회원은 보통 연회비를 내고 정기 모임에 나온다고 적혀 있어.'],
      ['USER', '오늘 운동화를 빨았어.'],
      ['USER', '나는 연회비는 냈는데 정기 모임엔 거의 못 나가.'],
    ],
    ev: [0, 2], anchor: [2, '연회비는 냈는데 정기 모임엔 거의 못 나가'],
  },
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 lounge 이용 얘기로 돌아가면, 그 라운지는 frequent flyer만 쓸 수 있어.'],
      ['USER', '오늘 캐리어 바퀴를 교체했어.'],
      ['USER', '안내에는 frequent flyer는 보통 연 20회 이상 타고 멤버십 등급이 있다고 적혀 있어.'],
      ['USER', '바퀴는 생각보다 쉽게 갈리더라.'],
      ['USER', '나는 작년에 24번 탔어.'],
      ['USER', '캐리어는 기내용이야.'],
      ['USER', '멤버십 등급은 아직 없고.'],
      ['USER', '자물쇠도 하나 달았어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [4, '작년에 24번 탔어'],
  },
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이 장학금은 저소득층 학생에게 나가. 아, 정확히는 안내에 저소득층은 보통 소득 분위가 낮고 부양가족이 있다고 돼 있어.'],
      ['USER', '오늘 학생증을 재발급받았어.'],
      ['USER', '나는 소득 분위는 낮은데 부양가족은 없어.'],
      ['USER', '재발급은 사흘 걸린대.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '소득 분위는 낮은데 부양가족은 없어'],
  },
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이 병원 야간 진료는 소아 환자만 받아.'],
      ['USER', '오늘 약국 위치를 확인했어.'],
      ['USER', '안내문에는 소아 환자를 보통 초등학생 이하로 본다고 적혀 있어.'],
      ['USER', '약국은 병원 바로 옆이더라.'],
      ['USER', '우리 아이는 중학교 1학년인데 키가 작아서 소아과를 계속 다녀.'],
      ['USER', '약국은 밤 10시까지 해.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '중학교 1학년인데 키가 작아서 소아과를 계속 다녀'],
  },

  // --- p1b6-sk-59c8f51891ab4996 | DEV/ESCALATE | simulation frame or real observation ---
  {
    sk: 'p1b6-sk-59c8f51891ab4996', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 대기 시간이 12분으로 나왔어.'],
      ['USER', '오늘 사무실 의자를 바꿨어.'],
      ['USER', '아까 우리가 창구 두 개짜리 모의 상황을 돌려 봤거든.'],
      ['USER', '의자는 바퀴가 부드러워.'],
      ['ASSISTANT', '12분으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '12분으로 나왔어'],
  },
  {
    sk: 'p1b6-sk-59c8f51891ab4996', lang: 'EN', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', 'We set up a dry run of the evacuation last week.'],
      ['USER', 'The fire door hinge still squeaks.'],
      ['USER', 'The building cleared in four minutes.'],
    ],
    ev: [0, 2], anchor: [2, 'cleared in four minutes'],
  },
  {
    sk: 'p1b6-sk-59c8f51891ab4996', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '아까 load test 시나리오를 하나 돌려 봤는데, 응답이 800ms까지 올라갔어.'],
      ['ASSISTANT', '800ms요?'],
      ['USER', '응, 그 숫자.'],
    ],
    ev: [0, 1, 2], anchor: [0, '800ms까지 올라갔어'],
  },
  {
    sk: 'p1b6-sk-59c8f51891ab4996', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '아까 가계부 시뮬레이션을 한번 돌려 봤어.'],
      ['USER', '오늘 쌀을 주문했어.'],
      ['USER', '이번 달 잔액이 12만 원 남는 걸로 나왔어.'],
      ['USER', '쌀은 10kg으로 시켰어.'],
      ['ASSISTANT', '12만 원으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '12만 원 남는 걸로 나왔어'],
  },

  // --- p1b6-sk-5d2a9c70e4b18f63 | DEV/CLEAR | the second candidate is explicitly excluded ---
  {
    sk: 'p1b6-sk-5d2a9c70e4b18f63', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 주말 약속은 토요일 아니면 일요일이야.'],
      ['USER', '오늘 자전거를 닦았어.'],
      ['USER', '더 정확히 말하면, 일요일은 내가 당직이라 안 돼.'],
      ['USER', '체인도 기름칠했어.'],
      ['USER', '다른 날 얘기는 나온 적 없어.'],
      ['USER', '안장 높이도 맞췄어.'],
      ['ASSISTANT', '토요일로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '토요일 아니면 일요일'],
  },
  {
    sk: 'p1b6-sk-5d2a9c70e4b18f63', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 숙소 얘기로 돌아가면, 호텔이나 게스트하우스 둘 중 하나야.'],
      ['USER', '오늘 여권 사진을 찍었어.'],
      ['USER', '게스트하우스는 예약이 다 차서 안 된대. 다른 선택지는 없고.'],
    ],
    ev: [0, 2], anchor: [0, '호텔이나 게스트하우스 둘 중 하나'],
  },

  // --- p1b6-sk-5f335bdc1d9d630c | TRAIN/ESCALATE | scope of a trailing qualifier ---
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '아, 다시 말할게. 사 올 건 우유와 빵의 유기농 제품이야.'],
    ],
    ev: [0], anchor: [0, '유기농 제품'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 발주는 keyboard와 mouse의 무선 모델로 넣어 줘.'],
      ['USER', '오늘 사무실 전화기를 옮겼어.'],
      ['USER', '수량은 각각 다섯 개씩이야.'],
      ['USER', '전화기는 창가 쪽으로 뒀어.'],
      ['ASSISTANT', '그대로 넣어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '무선 모델'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 신청할 건 강의와 워크숍의 온라인 과정이야.'],
      ['USER', '오늘 프린터 잉크를 샀어.'],
      ['USER', '마감은 다음 주 금요일이고.'],
    ],
    ev: [0, 2], anchor: [0, '온라인 과정'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 정리 대상은 사무실 서랍과 사물함이야.'],
      ['USER', '오늘 커피를 두 잔 마셨어.'],
      ['USER', '구체적으로는 서랍과 사물함의 작년 서류야.'],
      ['USER', '오후엔 좀 졸리더라.'],
      ['USER', '파쇄는 금요일에 한 번에 하려고.'],
      ['USER', '내일은 한 잔만 마셔야겠어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '작년 서류'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '챙길 건 수건과 담요의 새것으로 부탁해.'],
      ['USER', '오늘 세탁기 필터를 비웠어.'],
      ['ASSISTANT', '새것으로요?'],
      ['USER', '응, 그렇게.'],
      ['USER', '필터는 생각보다 더러웠어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 3, 5], anchor: [0, '새것'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 점심은 샐러드로 때웠어.'],
      ['USER', '보고서에 넣을 건 chart와 table의 최신 버전이야.'],
      ['USER', '저녁엔 뭘 먹을지 고민이야.'],
    ],
    ev: [1], anchor: [1, '최신 버전'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'EN', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', 'Please pack the cups and plates from the top shelf.'],
      ['USER', 'The kettle needs descaling at some point.'],
      ['USER', 'To be specific, the cups and plates from the top shelf of the corner cabinet.'],
    ],
    ev: [0, 2], anchor: [0, 'from the top shelf'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 목록 얘기로 돌아가면, 넣을 건 사진과 영상의 원본 파일이야.'],
      ['USER', '오늘 외장 하드를 하나 꺼냈어.'],
      ['USER', '용량은 넉넉해.'],
      ['USER', '하드는 2테라짜리야.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '원본 파일'],
  },
  {
    sk: 'p1b6-sk-5f335bdc1d9d630c', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '정리할 건 책과 잡지야.'],
      ['USER', '오늘 택배 상자를 모아 뒀어.'],
      ['USER', '아, 표현을 고칠게. 책과 잡지의 오래된 것들.'],
      ['USER', '상자는 다섯 개쯤 돼.'],
      ['USER', '다음 주에 한 번에 내놓으려고.'],
      ['USER', '끈도 챙겨 뒀어.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '오래된 것들'],
  },

  // --- p1b6-sk-5fc872afb058b370 | DEV/ESCALATE | same instance or two similar instances ---
  {
    sk: 'p1b6-sk-5fc872afb058b370', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '지난주에 3층 복도에서 본 회색 캐리어는 손잡이에 노란 리본이 달려 있었고 바퀴가 하나 빠져 있었어.'],
      ['USER', '오늘 복도 등을 갈았어.'],
      ['USER', '오늘 로비에서도 노란 리본이 달린 회색 캐리어를 봤는데 바퀴는 멀쩡하더라.'],
      ['USER', '등은 두 개만 나갔었어.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '회색 캐리어'],
  },
  {
    sk: 'p1b6-sk-5fc872afb058b370', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 그 mug를 두 번 봤어.'],
      ['USER', '오늘 탕비실 정수기를 청소했어.'],
      ['USER', '지난달 회의실에 있던 파란 mug는 손잡이에 흠집이 있었어.'],
      ['USER', '정수기 필터도 확인했어.'],
      ['USER', '어제 휴게실에서도 흠집 있는 파란 mug를 봤어.'],
      ['USER', '필터는 다음 달에 갈면 돼.'],
      ['USER', '그런데 어제 것은 바닥에 이름이 적혀 있더라.'],
      ['USER', '컵 받침도 새로 뒀어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [2, '파란 mug'],
  },
  {
    sk: 'p1b6-sk-5fc872afb058b370', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '도서관 2층에서 본 갈색 가죽 노트는 모서리가 해져 있었어.'],
      ['USER', '오늘 책을 두 권 반납했어.'],
      ['USER', '오늘 카페에서도 모서리가 해진 갈색 가죽 노트를 봤는데 표지에 스티커가 붙어 있더라.'],
    ],
    ev: [0, 2], anchor: [0, '갈색 가죽 노트'],
  },
  {
    sk: 'p1b6-sk-5fc872afb058b370', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '지난주에 본 검은 자전거는 안장이 찢어져 있었는데, 오늘 본 것은 안장이 멀쩡했어.'],
      ['ASSISTANT', '같은 자전거였을까요?'],
      ['USER', '둘 다 우리 동 앞에 세워져 있었어.'],
    ],
    ev: [0, 1, 2], anchor: [0, '검은 자전거'],
  },

  // --- p1b6-sk-61cb1285dd1df651 | DEV/CLEAR | comparative with one prior alternative ---
  {
    sk: 'p1b6-sk-61cb1285dd1df651', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '새로 산 매트리스가 왔어.'],
      ['USER', '오늘 이불 커버를 갈았어.'],
      ['USER', '예전에 쓰던 스프링 매트리스보다 훨씬 단단해.'],
      ['USER', '커버는 겨울용으로 바꿨어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '훨씬 단단해'],
  },
  {
    sk: 'p1b6-sk-61cb1285dd1df651', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번에 옮긴 사무실을 다녀왔어.'],
      ['USER', '오늘 명함 지갑을 샀어.'],
      ['USER', '더 말하자면, 전에 있던 사무실보다 층고가 높아.'],
      ['USER', '지갑은 가죽으로 골랐어.'],
      ['USER', '창도 더 크고.'],
      ['USER', '명함은 아직 안 나왔어.'],
      ['ASSISTANT', '그렇게 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '층고가 높아'],
  },

  // --- p1b6-sk-66ecb02cbfc40c3c | DEV/ESCALATE | ordinal after an insertion ---
  {
    sk: 'p1b6-sk-66ecb02cbfc40c3c', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 얘기하던 발표 순서로 돌아가면, 원래는 민수, 지영, 현우 순이었어.'],
      ['USER', '오늘 마이크 배터리를 갈았어.'],
      ['USER', '어제 수아가 민수 앞으로 들어왔어. 두 번째 발표자한테 slide를 먼저 받아 줘.'],
    ],
    ev: [0, 2], anchor: [2, '두 번째 발표자'],
  },
  {
    sk: 'p1b6-sk-66ecb02cbfc40c3c', lang: 'EN', dp: 'SELF_REVISION',
    turns: [
      ['USER', 'The reading list went: Ellis, Park, Okonkwo.'],
      ['USER', 'I renewed my library card today.'],
      ['USER', 'Let me correct myself: we added Sorensen at the front last week.'],
      ['USER', 'The card lasts three years now.'],
      ['USER', 'Could you summarise the third one for me?'],
    ],
    ev: [0, 2, 4], anchor: [4, 'the third one'],
  },
  {
    sk: 'p1b6-sk-66ecb02cbfc40c3c', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '대기 순번은 원래 김 선생님, 박 선생님, 이 선생님 순이었는데 오늘 아침에 최 선생님이 맨 앞에 들어왔어. 세 번째 분께 연락드려 줘.'],
    ],
    ev: [0], anchor: [0, '세 번째 분'],
  },
  {
    sk: 'p1b6-sk-66ecb02cbfc40c3c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 두 번째 항목을 빼면 돼.'],
      ['USER', '오늘 회의실 의자를 정리했어.'],
      ['USER', '목록은 원래 서론, 배경, 방법 순이었는데 어제 요약을 맨 앞에 넣었어.'],
    ],
    ev: [0, 2], anchor: [0, '두 번째 항목'],
  },

  // --- p1b6-sk-6b74f6c163e7fa5d | HELD/CLEAR | confirmation targets the same action ---
  {
    sk: 'p1b6-sk-6b74f6c163e7fa5d', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '다음 달에 건강검진을 받자는 얘기가 나왔어.'],
      ['USER', '오늘 우편함을 열었어.'],
      ['USER', '어제 내가 그 검진 예약을 하겠다고 확실히 말했어.'],
      ['USER', '우편물은 고지서뿐이었어.'],
      ['ASSISTANT', '검진 예약으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '예약을 하겠다고 확실히 말했어'],
  },
  {
    sk: 'p1b6-sk-6b74f6c163e7fa5d', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '팀 retrospective를 monthly로 돌리자는 얘기가 있었어.'],
      ['USER', '오늘 화이트보드 마커를 샀어.'],
      ['USER', '아까 내가 그렇게 하겠다고 확정해서 말했어.'],
      ['USER', '마커는 네 가지 색으로 샀어.'],
      ['ASSISTANT', 'monthly로 확정이요?'],
      ['USER', '응, 확정.'],
      ['USER', '지우개도 하나 샀어.'],
      ['ASSISTANT', 'monthly retrospective로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [2, '확정해서 말했어'],
  },
  {
    sk: 'p1b6-sk-6b74f6c163e7fa5d', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '주말에 창고 문 경첩을 갈자는 얘기가 나왔어.'],
      ['USER', '오늘 드라이버 세트를 찾았어.'],
      ['USER', '내가 토요일에 갈겠다고 못을 박았어.'],
      ['USER', '드라이버는 공구함에 있었어.'],
    ],
    ev: [0, 2], anchor: [2, '토요일에 갈겠다고 못을 박았어'],
  },
  {
    sk: 'p1b6-sk-6b74f6c163e7fa5d', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '아이 학원을 한 곳 줄이자는 얘기가 있었어.'],
      ['USER', '오늘 가방을 세탁했어.'],
      ['USER', '더 정확히는, 어제 내가 미술 학원을 끊겠다고 확실히 정했어.'],
      ['USER', '가방은 하루면 마른대.'],
      ['ASSISTANT', '미술 학원 중단으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '끊겠다고 확실히 정했어'],
  },

  // --- p1b6-sk-6e493bbfafdb22de | TRAIN/CLEAR | explicit replacement ---
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 배송지 얘기로 돌아가면, 처음엔 집으로 해 뒀다가 회사로 바꿨어. 집 주소는 지웠고.'],
    ],
    ev: [0], anchor: [0, '회사로 바꿨어'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '처음엔 모임 시간을 7시로 잡았어.'],
      ['USER', '오늘 시계를 충전했어.'],
      ['USER', '아, 그건 바뀌었어. 8시로 옮겼어.'],
      ['USER', '시계 줄도 조였어.'],
      ['USER', '7시는 이제 아니야.'],
      ['USER', '화면 밝기도 낮췄어.'],
      ['ASSISTANT', '8시로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '8시로 옮겼어'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '처음엔 이 기능을 next sprint에 넣기로 했었어.'],
      ['USER', '오늘 사무실 화분 잎을 닦았어.'],
      ['USER', '지금은 이번 sprint로 당겨서 하기로 바뀌었어.'],
      ['USER', '화분은 창가로 옮겼어.'],
      ['ASSISTANT', '이번 sprint로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '이번 sprint로 당겨서'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'EN', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', 'The short answer is that the meeting is now on a video call.'],
      ['USER', 'I cleared out the fridge shelf.'],
      ['USER', 'We had booked the small room, but that booking was dropped in favour of the call.'],
    ],
    ev: [0, 2], anchor: [0, 'now on a video call'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '원래 이번 휴가는 강릉으로 잡았는데, 숙소가 취소돼서 속초로 바꿨어. 강릉 예약은 환불받았고.'],
    ],
    ev: [0], anchor: [0, '속초로 바꿨어'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '처음엔 색을 네이비로 정했었어.'],
      ['USER', '오늘 붓을 씻었어.'],
      ['USER', '지금은 짙은 회색으로 바꿨어.'],
      ['USER', '붓은 두 개만 남았어.'],
      ['ASSISTANT', '짙은 회색으로요?'],
      ['USER', '응, 그걸로.'],
    ],
    ev: [0, 2, 4, 5], anchor: [2, '짙은 회색으로 바꿨어'],
  },
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '처음엔 이사 날짜를 15일로 잡았어.'],
      ['USER', '오늘 박스를 스무 개 주문했어.'],
      ['USER', '그런데 그건 22일로 변경됐어.'],
      ['USER', '박스는 모레 온대.'],
      ['USER', '15일은 이제 아니야.'],
      ['USER', '테이프도 같이 시켰어.'],
      ['USER', '업체에도 22일로 다시 알렸어.'],
      ['USER', '완충재는 집에 있는 걸 쓰려고.'],
      ['ASSISTANT', '22일로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [2, '22일로 변경됐어'],
  },

  // --- p1b6-sk-714725eea477a631 | DEV/CLEAR | role-play frame stays active ---
  {
    sk: 'p1b6-sk-714725eea477a631', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '지금 면접 role-play 중이야. 내가 지원자 역할이고.'],
      ['USER', '오늘 넥타이를 다렸어.'],
      ['USER', '더 정확히 말하면, 지원자 역할로 말할게. 저는 3년 동안 백엔드를 맡았습니다.'],
    ],
    ev: [0, 2], anchor: [2, '3년 동안 백엔드를 맡았습니다'],
  },
  {
    sk: 'p1b6-sk-714725eea477a631', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 연극 대사 연습으로 돌아가자. 나는 계속 의사 역할이야.'],
      ['USER', '오늘 대본을 인쇄했어.'],
      ['USER', '역할 안에서 말할게. 환자분, 수술은 내일 아침으로 잡았습니다.'],
      ['USER', '인쇄는 양면으로 했어.'],
      ['USER', '아직 역할 유지 중이야.'],
      ['USER', '대본은 클립으로 묶었어.'],
      ['ASSISTANT', '역할극 대사로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '수술은 내일 아침으로 잡았습니다'],
  },

  // --- p1b6-sk-75fe9a38eb99ab90 | HELD/CLEAR | approximate open-ended lower bound ---
  {
    sk: 'p1b6-sk-75fe9a38eb99ab90', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '숙소는 최소 4성급 정도는 됐으면 해.'],
      ['USER', '오늘 캐리어를 꺼냈어.'],
      ['USER', '아, 정확히는 그 위로는 다 괜찮아.'],
      ['USER', '캐리어는 먼지가 많았어.'],
      ['ASSISTANT', '4성급 이상으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '최소 4성급 정도'],
  },
  {
    sk: 'p1b6-sk-75fe9a38eb99ab90', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '노트북은 램이 16기가쯤 이상이면 좋겠어.'],
      ['USER', '오늘 가방을 정리했어.'],
      ['ASSISTANT', '16기가 이상으로 적어 둘게요.'],
    ],
    ev: [0, 2], anchor: [0, '16기가쯤 이상'],
  },
  {
    sk: 'p1b6-sk-75fe9a38eb99ab90', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 방은 대략 스무 평 이상이면 만족해.'],
    ],
    ev: [0], anchor: [0, '대략 스무 평 이상'],
  },
  {
    sk: 'p1b6-sk-75fe9a38eb99ab90', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번에 고르는 monitor 조건을 정리해 볼게.'],
      ['USER', '오늘 책상 높이를 조절했어.'],
      ['USER', '해상도는 대략 QHD 이상이면 충분해.'],
      ['USER', '책상은 조금 낮췄어.'],
      ['ASSISTANT', 'QHD 이상으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '대략 QHD 이상'],
  },

  // --- p1b6-sk-82149f27c2f521ae | TRAIN/CLEAR | two updates on different dimensions ---
  {
    sk: 'p1b6-sk-82149f27c2f521ae', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'The workshop moved from Tuesday to Thursday.'],
      ['USER', 'I watered the office plants.'],
      ['USER', 'The room also changed from B2 to the annex.'],
      ['USER', 'The big one looked a bit dry.'],
      ['ASSISTANT', 'Both changes?'],
      ['USER', 'Yes, both.'],
      ['USER', 'I will check them again on Friday.'],
      ['ASSISTANT', 'Thursday, annex. Noted.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [0, 'from Tuesday to Thursday'],
  },
  {
    sk: 'p1b6-sk-82149f27c2f521ae', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '배송 주소를 집에서 회사로 바꿨어.'],
      ['USER', '오늘 우산을 말렸어.'],
      ['USER', '결제 수단도 체크카드에서 신용카드로 바꿨고.'],
      ['USER', '우산은 베란다에 뒀어.'],
      ['ASSISTANT', '두 가지 다 반영해 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '집에서 회사로 바꿨어'],
  },
  {
    sk: 'p1b6-sk-82149f27c2f521ae', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '수업 요일을 화요일에서 목요일로 옮겼어.'],
      ['USER', '오늘 필통을 정리했어.'],
      ['USER', '더 말하자면 강사도 김 선생님에서 박 선생님으로 바뀌었어.'],
    ],
    ev: [0, 2], anchor: [0, '화요일에서 목요일로 옮겼어'],
  },
  {
    sk: 'p1b6-sk-82149f27c2f521ae', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 예약 얘기로 돌아가면, 인원을 네 명에서 여섯 명으로 늘렸고 시간도 6시에서 7시로 미뤘어.'],
    ],
    ev: [0], anchor: [0, '네 명에서 여섯 명으로 늘렸고'],
  },

  // --- p1b6-sk-869c71279b6b8a33 | HELD/ESCALATE | preference or external constraint ---
  {
    sk: 'p1b6-sk-869c71279b6b8a33', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '내 계정은 dark mode로 떠 있어.'],
      ['USER', '오늘 모니터 각도를 바꿨어.'],
      ['USER', '아, 정확히 말하면 회사에서 지급한 노트북에서 그렇게 보여.'],
      ['USER', '각도는 조금 내렸어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'dark mode로 떠 있어'],
  },
  {
    sk: 'p1b6-sk-869c71279b6b8a33', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '내 휴대폰은 저녁 10시 이후엔 알림이 안 울려.'],
      ['USER', '오늘 충전 케이블을 새로 샀어.'],
      ['USER', '회사에서 지급한 기기야.'],
      ['USER', '케이블은 좀 긴 걸로 골랐어.'],
      ['USER', '그 시간대엔 화면도 흑백으로 바뀌고.'],
      ['USER', '케이블 정리 끈도 챙겼어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '저녁 10시 이후엔 알림이 안 울려'],
  },
  {
    sk: 'p1b6-sk-869c71279b6b8a33', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 내 자리 프린터는 흑백으로만 나와.'],
      ['USER', '오늘 책상 서랍을 잠갔어.'],
      ['USER', '층 전체가 같은 프린터를 쓰고 있어.'],
    ],
    ev: [0, 2], anchor: [0, '흑백으로만 나와'],
  },
  {
    sk: 'p1b6-sk-869c71279b6b8a33', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '요즘 내 메일함은 광고 메일이 하나도 안 들어와.'],
      ['USER', '오늘 키보드를 닦았어.'],
      ['USER', '회사 메일 서버를 지난달에 바꿨거든.'],
      ['USER', '키캡 사이에 먼지가 많더라.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '광고 메일이 하나도 안 들어와'],
  },

  // --- p1b6-sk-8a41f0d92c7e6b35 | TRAIN/CLEAR | the end condition was actually met ---
  {
    sk: 'p1b6-sk-8a41f0d92c7e6b35', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '공사가 끝날 때까지 뒷문으로 다니기로 했었는데, 공사는 지난주에 끝났어.'],
      ['ASSISTANT', '그럼 앞문으로요?'],
      ['USER', '응.'],
    ],
    ev: [0, 1, 2], anchor: [0, '공사가 끝날 때까지 뒷문으로 다니기로'],
  },
  {
    sk: 'p1b6-sk-8a41f0d92c7e6b35', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', 'project가 끝날 때까지 주말 근무를 하기로 했었어.'],
      ['USER', '오늘 사무실 스탠드를 옮겼어.'],
      ['USER', '그 project는 금요일에 끝났어.'],
      ['USER', '스탠드는 창가로 뒀어.'],
    ],
    ev: [0, 2], anchor: [0, '주말 근무를 하기로'],
  },
  {
    sk: 'p1b6-sk-8a41f0d92c7e6b35', lang: 'EN', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', 'I was taking the antibiotics until the course finished.'],
      ['USER', 'I repainted the bathroom shelf.'],
      ['USER', 'To be exact, the course ended on Sunday.'],
      ['USER', 'The paint needed two coats.'],
      ['ASSISTANT', 'Noted.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'taking the antibiotics until the course finished'],
  },
  {
    sk: 'p1b6-sk-8a41f0d92c7e6b35', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 통학 얘기로 돌아가면, 지하철 공사 동안은 버스를 타기로 했었어.'],
      ['USER', '오늘 교통카드를 충전했어.'],
      ['USER', '그 공사는 이번 주 월요일에 마무리됐어.'],
      ['USER', '카드는 3만 원 넣었어.'],
      ['USER', '안내 방송에서도 정상 운행이라고 하더라.'],
      ['USER', '카드 잔액은 문자로 와.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '버스를 타기로'],
  },

  // --- p1b6-sk-8dd28ec6b22a18ad | TRAIN/CLEAR | bounded interruption has ended ---
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '나는 평일 아침마다 조깅을 해.'],
      ['USER', '오늘 현관 도어락 건전지를 갈았어.'],
      ['USER', '아, 정확히는 6시 반쯤 나가.'],
      ['USER', '건전지는 네 개 들어가더라.'],
      ['USER', '발목을 삐어서 낫는 동안은 쉬었어.'],
      ['USER', '도어락은 이제 잘 열려.'],
      ['USER', '발목은 지난주에 다 나았고.'],
      ['USER', '여분 건전지도 사 뒀어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '평일 아침마다 조깅을 해'],
  },
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '매주 목요일 저녁엔 독서 모임에 나가. 이사 준비하는 동안은 못 나갔는데 이사는 지난달에 끝났어.'],
      ['USER', '오늘 책장을 조립했어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2], anchor: [0, '매주 목요일 저녁엔 독서 모임에 나가'],
  },
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 아침 stand-up은 원래대로야.'],
      ['USER', '오늘 헤드셋을 바꿨어.'],
      ['USER', '매일 아침에 하는 건데, 팀장 출장 동안만 건너뛰었고 출장은 어제 끝났어.'],
      ['USER', '헤드셋은 유선으로 골랐어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '아침 stand-up은 원래대로야'],
  },
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '나는 저녁마다 산책을 하는데, 장마 동안은 쉬었어. 장마는 지난주에 끝났고.'],
    ],
    ev: [0], anchor: [0, '저녁마다 산책을 하는데'],
  },

  // --- p1b6-sk-95b3c63acff8f020 | HELD/CLEAR | exception re-applies each recurrence ---
  {
    sk: 'p1b6-sk-95b3c63acff8f020', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '나는 보통 아침 7시에 집을 나서.'],
      ['USER', '오늘 신발을 새로 꺼냈어.'],
      ['USER', '비 오는 날마다는 30분 일찍 나가.'],
      ['USER', '신발은 방수되는 걸로 골랐어.'],
      ['ASSISTANT', '비 올 때마다요?'],
      ['USER', '응, 그때마다.'],
      ['USER', '우산도 하나 더 챙겼어.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [2, '비 오는 날마다는 30분 일찍 나가'],
  },
  {
    sk: 'p1b6-sk-95b3c63acff8f020', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '평소엔 점심을 구내식당에서 먹어.'],
      ['USER', '오늘 텀블러를 씻었어.'],
      ['USER', '회의가 있는 날마다는 샌드위치를 사 와.'],
      ['USER', '텀블러는 뚜껑이 좀 헐거워.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '회의가 있는 날마다는 샌드위치를 사 와'],
  },
  {
    sk: 'p1b6-sk-95b3c63acff8f020', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '아이는 평일엔 9시에 재워.'],
      ['USER', '오늘 이불을 널었어.'],
      ['USER', '더 정확히는, 다음 날 소풍이 있을 때마다는 8시에 재워.'],
    ],
    ev: [0, 2], anchor: [2, '소풍이 있을 때마다는 8시에 재워'],
  },
  {
    sk: 'p1b6-sk-95b3c63acff8f020', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 배포 얘기로 돌아가면, 평소엔 수요일에 배포해. 다만 hotfix가 있는 주마다는 금요일에 한 번 더 해.'],
    ],
    ev: [0], anchor: [0, 'hotfix가 있는 주마다는 금요일에 한 번 더 해'],
  },

  // --- p1b6-sk-9dc48f4b2f10775d | TRAIN/ESCALATE | which question the ellipsis answers ---
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['ASSISTANT', '금요일 회의를 취소할까요?'],
      ['USER', '오늘 창문을 닦았어.'],
      ['ASSISTANT', '아, 그리고 점심 예약도 취소할까요?'],
      ['USER', '유리 세정제를 다 썼어.'],
      ['USER', '응, 취소해 줘.'],
    ],
    ev: [0, 2, 4], anchor: [4, '취소해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'EN', dp: 'CANONICAL',
    turns: [
      ['ASSISTANT', 'Should I archive the old invoices?'],
      ['ASSISTANT', 'And should I archive the contract drafts?'],
      ['USER', 'I reorganised the desk drawer.'],
      ['USER', 'Yes, go ahead with that.'],
    ],
    ev: [0, 1, 3], anchor: [3, 'Yes, go ahead with that'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 나는 하라고 답했어.'],
      ['USER', '오늘 화분 받침을 샀어.'],
      ['ASSISTANT', '주말 청소를 업체에 맡길까요?'],
      ['USER', '받침은 세 개 샀어.'],
      ['ASSISTANT', '아니면 이불 세탁을 맡길까요?'],
      ['USER', '화분은 네 개인데 받침은 하나가 모자라.'],
      ['USER', '응, 그렇게 해 줘.'],
    ],
    ev: [0, 2, 4, 6], anchor: [6, '그렇게 해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '오늘 정리할 게 두 가지 있었어.'],
      ['ASSISTANT', '서재 책들을 기부할까요?'],
      ['USER', '오늘 커피 필터를 샀어.'],
      ['ASSISTANT', '옷장 옷들을 기부할까요?'],
      ['USER', '필터는 100매짜리야.'],
      ['USER', '응, 그렇게 해.'],
    ],
    ev: [1, 3, 5], anchor: [5, '그렇게 해'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['ASSISTANT', 'staging 환경을 내릴까요?'],
      ['ASSISTANT', '아니면 test 계정을 지울까요?'],
      ['USER', '오늘 사무실 의자를 닦았어.'],
      ['USER', '응, 그거 해 줘.'],
    ],
    ev: [0, 1, 3], anchor: [3, '그거 해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 점심은 김밥을 먹었어.'],
      ['ASSISTANT', '현관 전등을 교체할까요?'],
      ['ASSISTANT', '아니면 욕실 전등을 교체할까요?'],
      ['USER', '응, 바꿔 줘.'],
      ['USER', '김밥은 두 줄 샀어.'],
    ],
    ev: [1, 2, 3], anchor: [3, '바꿔 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['ASSISTANT', '다음 달 정기권을 연장할까요?'],
      ['USER', '오늘 지갑을 정리했어.'],
      ['ASSISTANT', '더 정확히는, 주차권도 같이 연장할까요?'],
      ['USER', '영수증을 한참 버렸어.'],
      ['USER', '응, 연장해 줘.'],
    ],
    ev: [0, 2, 4], anchor: [4, '연장해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 예약 얘기로 돌아가자.'],
      ['ASSISTANT', '숙소 예약을 취소할까요?'],
      ['USER', '오늘 캐리어를 닦았어.'],
      ['ASSISTANT', '렌터카 예약을 취소할까요?'],
      ['USER', '바퀴에 머리카락이 꼈더라.'],
      ['USER', '응, 취소해 줘.'],
      ['USER', '캐리어는 다시 넣어 뒀어.'],
      ['ASSISTANT', '그렇게 처리해 둘게요.'],
    ],
    ev: [1, 3, 5, 7], anchor: [5, '취소해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['ASSISTANT', '회의록을 팀 채널에 올릴까요? 아, 아니면 메일로 보낼까요?'],
      ['USER', '오늘 프린터를 껐어.'],
      ['USER', '응, 그렇게 해 줘.'],
    ],
    ev: [0, 2], anchor: [2, '그렇게 해 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['ASSISTANT', '오래된 log 파일을 지울까요?'],
      ['USER', '오늘 외장 SSD를 꽂아 봤어.'],
      ['ASSISTANT', '아니면 backup 파일을 지울까요?'],
      ['USER', 'SSD는 인식이 잘 되더라.'],
      ['USER', '응, 지워 줘.'],
    ],
    ev: [0, 2, 4], anchor: [4, '지워 줘'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 그렇게 하라고 답했어. 아까 이불을 새로 살지, 커튼을 새로 살지 둘 다 물어봤었거든.'],
    ],
    ev: [0], anchor: [0, '그렇게 하라고 답했어'],
  },
  {
    sk: 'p1b6-sk-9dc48f4b2f10775d', lang: 'EN', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', 'We had two loose ends from yesterday.'],
      ['USER', 'I finally labelled the storage boxes.'],
      ['ASSISTANT', 'Shall I cancel the printing order?'],
      ['USER', 'The labels came out crooked.'],
      ['ASSISTANT', 'Shall I cancel the courier booking?'],
      ['USER', 'I will redo them later.'],
      ['USER', 'Yes, cancel it.'],
      ['USER', 'The marker was running dry.'],
      ['ASSISTANT', 'Noted.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [6, 'Yes, cancel it'],
  },

  // --- p1b6-sk-a19bb9e94e9a416b | HELD/ESCALATE | rule after a category boundary change ---
  {
    sk: 'p1b6-sk-a19bb9e94e9a416b', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '우리 동호회는 정회원에게만 대회 참가비를 지원해 줘.'],
      ['USER', '오늘 운동복을 빨았어.'],
      ['USER', '지난달부터 정회원 기준을 가입 1년에서 6개월로 바꿨어. 나는 가입한 지 8개월 됐어.'],
      ['USER', '운동복은 두 벌 돌렸어.'],
      ['ASSISTANT', '8개월이요?'],
      ['USER', '응, 8개월.'],
    ],
    ev: [0, 2, 4, 5], anchor: [2, '가입한 지 8개월'],
  },
  {
    sk: 'p1b6-sk-a19bb9e94e9a416b', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이 도서관은 지역 주민에게 대출증을 발급해 줘.'],
      ['USER', '오늘 자전거 안장을 조금 올렸어.'],
      ['USER', '이번 달부터 지역 주민 범위를 인접 시까지로 넓혔어.'],
      ['USER', '앞바퀴만 조금 빠졌더라.'],
      ['USER', '나는 인접 시에 살고 대출 신청은 지난달에 넣어 뒀어.'],
      ['USER', '펌프는 집에 있어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '인접 시에 살고 대출 신청은 지난달에 넣어 뒀어'],
  },
  {
    sk: 'p1b6-sk-a19bb9e94e9a416b', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이 회사 shuttle은 본사 직원만 탈 수 있어. 더 정확히는, 이번 분기부터 본사 범위에 별관까지 포함됐어.'],
      ['USER', '오늘 사원증 줄을 바꿨어.'],
      ['USER', '나는 별관에서 일하고 shuttle 신청은 지난 분기에 했어.'],
    ],
    ev: [0, 2], anchor: [2, '별관에서 일하고 shuttle 신청은 지난 분기에 했어'],
  },
  {
    sk: 'p1b6-sk-a19bb9e94e9a416b', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 할인 얘기로 돌아가면, 이 극장은 청소년에게 할인을 줘.'],
      ['USER', '오늘 예매 앱을 지웠다가 다시 깔았어.'],
      ['USER', '올해부터 청소년 기준을 만 18세에서 만 19세로 올렸어. 우리 아이는 만 18세고 표는 작년에 미리 사 뒀어.'],
      ['USER', '앱은 로그인이 풀려 있었어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '만 18세고 표는 작년에 미리 사 뒀어'],
  },

  // --- p1b6-sk-aebbf047d6864a35 | DEV/ESCALATE | combine, compare, or keep the two apart ---
  {
    sk: 'p1b6-sk-aebbf047d6864a35', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '아, 다시 말할게. 이번 출장비는 본사 예산에 30만 원이 잡혀 있고, 팀 예산에도 30만 원이 잡혀 있어.'],
    ],
    ev: [0], anchor: [0, '본사 예산에 30만 원이 잡혀 있고'],
  },
  {
    sk: 'p1b6-sk-aebbf047d6864a35', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 프로젝트 인력은 개발팀 배정표에 두 명으로 적혀 있어.'],
      ['USER', '오늘 회의실 화이트보드를 지웠어.'],
      ['USER', '디자인팀 배정표에도 두 명으로 적혀 있고.'],
    ],
    ev: [0, 2], anchor: [0, '두 명으로 적혀 있어'],
  },
  {
    sk: 'p1b6-sk-aebbf047d6864a35', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 재고가 양쪽에 다 잡혀 있어.'],
      ['USER', '오늘 창고 문을 잠갔어.'],
      ['USER', '본점 재고표에는 이 상품이 열 개로 돼 있어.'],
      ['USER', '열쇠는 사무실에 뒀어.'],
      ['USER', '물류창고 재고표에도 열 개로 돼 있고.'],
      ['USER', '창고 조명은 꺼 놨어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '열 개로 돼 있어'],
  },
  {
    sk: 'p1b6-sk-aebbf047d6864a35', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 달 광고 예산 얘기인데.'],
      ['USER', '오늘 노트북 화면을 닦았어.'],
      ['USER', 'online 채널 계획서에 500만 원이 적혀 있고, offline 채널 계획서에도 500만 원이 적혀 있어.'],
      ['USER', '화면에 지문이 많더라.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '500만 원이 적혀 있고'],
  },
  {
    sk: 'p1b6-sk-aebbf047d6864a35', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '내 연차는 인사 시스템에 닷새 남은 걸로 나오고, 팀 엑셀에도 닷새 남은 걸로 돼 있어.'],
      ['USER', '오늘 달력을 넘겼어.'],
      ['ASSISTANT', '닷새요?'],
      ['USER', '응, 양쪽 다.'],
    ],
    ev: [0, 2, 3], anchor: [0, '닷새 남은 걸로 나오고'],
  },

  // --- p1b6-sk-b8e64a03d97f251c | TRAIN/ESCALATE | self-state inside an unanswered question ---
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'EN', dp: 'INTERLEAVED',
    turns: [
      ['USER', 'I moved the router to the hallway.'],
      ['USER', 'Am I still registered for the Thursday class?'],
      ['USER', 'The signal is better there now.'],
      ['USER', 'I cannot find the confirmation email.'],
      ['USER', 'I should tidy the cables too.'],
      ['USER', 'Could you check that for me?'],
    ],
    ev: [1, 3, 5], anchor: [1, 'Am I still registered for the Thursday class?'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '내가 아직 그 적립금 대상인가? 더 정확히는, 지난달 결제분까지 포함해서 대상인지 궁금해.'],
    ],
    ev: [0], anchor: [0, '아직 그 적립금 대상인가'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 보험 얘기로 돌아가면, 내가 지금도 실손 가입 상태인가?'],
      ['USER', '오늘 우편물을 뜯었어.'],
      ['USER', '갱신 안내를 못 받은 것 같아서.'],
      ['USER', '대부분 광고였어.'],
      ['USER', '확인해 줄 수 있어?'],
      ['USER', '나머지는 버렸어.'],
      ['ASSISTANT', '확인해 볼게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '지금도 실손 가입 상태인가'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '내가 아직 그 beta program에 들어 있나?'],
      ['USER', '오늘 앱을 업데이트했어.'],
      ['USER', '아, 정확히는 이번 build를 받을 수 있는 상태인지 묻는 거야.'],
      ['USER', '업데이트는 금방 끝났어.'],
      ['ASSISTANT', '확인해 볼게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'beta program에 들어 있나'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '내가 지금 도서관 대출 정지 상태야?'],
      ['USER', '오늘 책을 가방에 넣어 뒀어.'],
      ['USER', '연체된 게 있었던 것 같아서 물어보는 거야.'],
    ],
    ev: [0, 2], anchor: [0, '대출 정지 상태야'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 물어볼게. 내가 아직 그 스터디 멤버로 돼 있나? 명단을 못 봐서 확인이 안 돼.'],
    ],
    ev: [0], anchor: [0, '아직 그 스터디 멤버로 돼 있나'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '지난달에 회원 정보를 바꿨거든.'],
      ['USER', '오늘 카드 지갑을 샀어.'],
      ['USER', '그래서 내가 지금도 VIP 등급인지 궁금해.'],
      ['USER', '지갑은 얇은 걸로 골랐어.'],
      ['ASSISTANT', '확인해 볼게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '지금도 VIP 등급인지'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '내가 이번 달 구독이 아직 살아 있나?'],
      ['USER', '오늘 결제 알림을 껐어.'],
      ['ASSISTANT', '구독 상태요?'],
      ['USER', '응, 그거.'],
    ],
    ev: [0, 2, 3], anchor: [0, '구독이 아직 살아 있나'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '내가 아직 그 project의 reviewer로 지정돼 있나?'],
      ['USER', '오늘 사무실 블라인드를 올렸어.'],
      ['USER', '알림이 안 와서 물어보는 거야.'],
      ['USER', '햇빛이 잘 들어오더라.'],
      ['USER', '설정이 바뀐 건지도 모르겠고.'],
      ['USER', '블라인드 줄이 좀 꼬였어.'],
      ['ASSISTANT', '확인해 볼게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, 'reviewer로 지정돼 있나'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '내가 아직 그 병원 초진 대상인가?'],
      ['USER', '오늘 진료 예약 앱을 깔았어.'],
      ['USER', '더 정확히는, 3년 전에 한 번 간 게 기록에 남아 있는지 묻는 거야.'],
      ['USER', '앱은 본인 인증이 필요하더라.'],
      ['USER', '재진이면 비용이 달라져서 확인하려고.'],
      ['USER', '인증은 문자로 했어.'],
      ['USER', '기록을 직접 볼 방법은 모르겠어.'],
      ['USER', '앱에 알림 권한도 줬어.'],
      ['ASSISTANT', '확인해 볼게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '초진 대상인가'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'EN', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', 'Back to the membership question.'],
      ['USER', 'I put the recycling out.'],
      ['USER', 'Am I still on the family plan?'],
      ['USER', 'The bins were nearly full.'],
      ['USER', 'I have not had a bill in months.'],
    ],
    ev: [0, 2, 4], anchor: [2, 'Am I still on the family plan?'],
  },
  {
    sk: 'p1b6-sk-b8e64a03d97f251c', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '내가 아직 그 쿠폰을 쓸 수 있나? 아, 정확히는 만료 전인지 묻는 거야.'],
      ['USER', '오늘 영수증을 정리했어.'],
      ['USER', '앱에서는 안 보여서 확인이 안 돼.'],
    ],
    ev: [0, 2], anchor: [0, '아직 그 쿠폰을 쓸 수 있나'],
  },

  // --- p1b6-sk-be0efa305956d111 | TRAIN/ESCALATE | qualification modifies or coexists ---
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '우리 집 규칙은 저녁 9시 이후엔 TV를 끄는 거야. 주말엔 좀 늦게까지 봐도 된다는 얘기도 있어.'],
    ],
    ev: [0], anchor: [0, '저녁 9시 이후엔 TV를 끄는 거야'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 회의는 전부 영어로 진행해.'],
      ['USER', '오늘 이어폰을 새로 꽂았어.'],
      ['USER', '한국어 발표 자료도 허용한다는 안내가 따로 있어.'],
      ['USER', '이어폰은 소리가 한쪽만 작아.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '전부 영어로 진행해'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '우리 팀 문서는 다 사내 위키에 올리기로 했어.'],
      ['USER', '오늘 노트북 받침대를 샀어.'],
      ['USER', '초안은 개인 폴더에 둬도 된다는 메모가 따로 있어.'],
      ['USER', '받침대는 알루미늄이야.'],
      ['USER', '내가 지금 쓰는 건 아직 초안이야.'],
      ['USER', '높이는 두 단계로 조절돼.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '다 사내 위키에 올리기로 했어'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '아이 간식은 하루 한 번으로 정했어.'],
      ['USER', '오늘 장을 봤어.'],
      ['ASSISTANT', '하루 한 번이요?'],
      ['USER', '응. 할머니 댁에서는 더 줘도 된다고 적어 둔 것도 있고.'],
    ],
    ev: [0, 2, 3], anchor: [0, '하루 한 번으로 정했어'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '사무실 냉방은 26도로 맞추기로 했어.'],
      ['USER', '오늘 화분에 물을 줬어.'],
      ['USER', '서버실은 더 낮춰도 된다는 얘기가 따로 있어.'],
      ['USER', '화분 잎이 좀 누레졌어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '26도로 맞추기로 했어'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '택배는 경비실에 맡기기로 했어. 더 붙이자면 신선식품은 문 앞에 둬도 된다는 안내가 따로 있어.'],
    ],
    ev: [0], anchor: [0, '경비실에 맡기기로 했어'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 백업 얘기로 돌아가면, 모든 파일은 매일 cloud에 올리기로 했어.'],
      ['USER', '오늘 외장 하드를 정리했어.'],
      ['USER', '용량 큰 영상은 주 1회만 올려도 된다는 메모가 따로 있어.'],
      ['USER', '하드에 공간이 꽤 남더라.'],
      ['USER', '내가 지금 다루는 건 영상 파일이야.'],
      ['USER', '케이블도 같이 정리했어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '매일 cloud에 올리기로 했어'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '운동은 매일 하기로 했어. 아, 정확히는 매일 30분이야.'],
      ['USER', '오늘 운동화 끈을 갈았어.'],
      ['USER', '몸이 안 좋은 날은 걸어도 된다는 말도 적어 뒀어.'],
      ['USER', '끈은 좀 짧은 걸로 샀어.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '매일 30분'],
  },
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'EN', dp: 'CANONICAL',
    turns: [
      ['USER', 'The studio rule is that shoes come off at the door.'],
      ['USER', 'I finally fixed the wobbly stool.'],
      ['USER', 'There is also a note saying socks are fine on the mats.'],
    ],
    ev: [0, 2], anchor: [0, 'shoes come off at the door'],
  },

  // --- p1b6-sk-c3d0e91a74b6f258 | HELD/CLEAR | change applies forward, not retroactively ---
  {
    sk: 'p1b6-sk-c3d0e91a74b6f258', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 회비는 이번 달부터 3만 원이야.'],
      ['USER', '오늘 통장 정리를 했어.'],
      ['USER', '지난달까지는 2만 원이었고, 지난 기록은 그대로 둔대.'],
      ['USER', '통장은 한 권 다 썼어.'],
      ['ASSISTANT', '이번 달부터 3만 원으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '이번 달부터 3만 원'],
  },
  {
    sk: 'p1b6-sk-c3d0e91a74b6f258', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '우리 팀 문서 양식이 바뀌었어.'],
      ['USER', '오늘 복사기 용지를 채웠어.'],
      ['USER', '다음 주 작성분부터 새 양식을 쓰고, 그 전에 쓴 건 고치지 않기로 했어.'],
    ],
    ev: [0, 2], anchor: [2, '다음 주 작성분부터 새 양식을 쓰고'],
  },
  {
    sk: 'p1b6-sk-c3d0e91a74b6f258', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 분기부터 expense 한도가 20만 원으로 올라가. 지난 분기 처리분은 예전 한도 그대로 두고.'],
      ['ASSISTANT', '이번 분기부터요?'],
      ['USER', '응, 그때부터.'],
    ],
    ev: [0, 1, 2], anchor: [0, '이번 분기부터 expense 한도가 20만 원으로 올라가'],
  },
  {
    sk: 'p1b6-sk-c3d0e91a74b6f258', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '아이 용돈을 올리기로 했어.'],
      ['USER', '오늘 저금통을 비웠어.'],
      ['USER', '다음 달부터 만 원 올려 주기로 했어.'],
      ['USER', '동전이 꽤 많더라.'],
      ['USER', '이번 달까지 준 건 그대로 두고.'],
      ['USER', '동전은 은행에 가져가려고.'],
      ['ASSISTANT', '다음 달부터 인상으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '다음 달부터 만 원 올려 주기로'],
  },

  // --- p1b6-sk-cc054a4227cdafef | TRAIN/ESCALATE | was the reported state itself adopted ---
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '친구가 그 카페는 시끄럽고 커피는 맛있다고 했어.'],
      ['USER', '오늘 텀블러를 챙겼어.'],
      ['USER', '더 말하자면, 나도 그 말에 동의해.'],
      ['USER', '텀블러는 보온이 잘 돼.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '시끄럽고 커피는 맛있다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 학원 얘기로 돌아가면, 엄마가 거긴 숙제가 많고 선생님은 친절하다고 했어.'],
      ['USER', '오늘 필통을 샀어.'],
      ['USER', '나도 그렇게 생각해.'],
    ],
    ev: [0, 2], anchor: [0, '숙제가 많고 선생님은 친절하다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '동료가 그 도구는 설정이 복잡하고 속도는 빠르다고 했어.'],
      ['USER', '오늘 마우스를 바꿨어.'],
      ['USER', '아, 정확히 말하면 나도 같은 인상을 받았어.'],
      ['USER', '마우스는 무선으로 골랐어.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '설정이 복잡하고 속도는 빠르다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '팀원이 그 library는 문서가 부족하고 API는 깔끔하다고 했어.'],
      ['USER', '오늘 사무실 의자를 옮겼어.'],
      ['USER', '나도 같은 얘기를 하고 싶었어.'],
      ['USER', '의자는 창가 쪽으로 뒀어.'],
      ['USER', '쓰면서 느낀 게 비슷하더라.'],
      ['USER', '바퀴가 좀 뻑뻑해.'],
      ['USER', '그래서 그 평가에 고개를 끄덕였어.'],
      ['USER', '기름칠을 해 볼까 싶어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '문서가 부족하고 API는 깔끔하다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 나도 그 말에 공감했어. 선배가 그 동네는 조용하고 교통은 불편하다고 했거든.'],
    ],
    ev: [0], anchor: [0, '조용하고 교통은 불편하다고 했거든'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'EN', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', 'A colleague reviewed the venue last month.'],
      ['USER', 'I cleaned out my locker.'],
      ['USER', 'She said the room is cold and the acoustics are excellent.'],
      ['USER', 'There was an old umbrella in there.'],
      ['USER', 'I told her I felt the same way.'],
      ['USER', 'I left the umbrella at reception.'],
      ['ASSISTANT', 'Noted.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, 'the room is cold and the acoustics are excellent'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '형이 그 차는 연비가 나쁘고 승차감은 좋다고 했어.'],
      ['USER', '오늘 주차권을 끊었어.'],
      ['ASSISTANT', '어떻게 생각하세요?'],
      ['USER', '나도 같은 생각이야.'],
    ],
    ev: [0, 2, 3], anchor: [0, '연비가 나쁘고 승차감은 좋다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이웃이 그 병원은 대기가 길고 의사는 꼼꼼하다고 했어.'],
      ['USER', '오늘 우산을 말렸어.'],
      ['USER', '나도 그 말이 맞다고 했어.'],
      ['USER', '우산은 현관에 세워 뒀어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '대기가 길고 의사는 꼼꼼하다고 했어'],
  },
  {
    sk: 'p1b6-sk-cc054a4227cdafef', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '후배가 그 conference는 세션이 지루하고 networking은 좋다고 했어. 더 말하자면 나도 비슷하게 느꼈어.'],
    ],
    ev: [0], anchor: [0, '세션이 지루하고 networking은 좋다고 했어'],
  },

  // --- p1b6-sk-d8ca287837bcc32d | DEV/CLEAR | the target explicitly holds the required role ---
  {
    sk: 'p1b6-sk-d8ca287837bcc32d', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 열쇠 얘기로 돌아가면, 창고 열쇠는 총무만 받을 수 있어.'],
      ['USER', '오늘 명단을 출력했어.'],
      ['USER', '내가 이번 학기 총무야.'],
      ['USER', '명단은 두 장이더라.'],
      ['ASSISTANT', '열쇠 수령 대상으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '이번 학기 총무야'],
  },
  {
    sk: 'p1b6-sk-d8ca287837bcc32d', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이 시스템은 관리자 권한이 있어야 로그를 볼 수 있어. 아, 정확히는 관리자 계정만이야.'],
      ['USER', '오늘 비밀번호를 바꿨어.'],
      ['USER', '내 계정이 관리자 계정이야.'],
    ],
    ev: [0, 2], anchor: [2, '관리자 계정이야'],
  },

  // --- p1b6-sk-db0908294e6deb6f | DEV/CLEAR | an option explicitly taken off the table ---
  {
    sk: 'p1b6-sk-db0908294e6deb6f', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '여행지 후보는 제주, 부산, 강릉이었어.'],
      ['USER', '오늘 여행 가방을 꺼내 뒀어.'],
      ['USER', '부산은 이번엔 안 가기로 마음을 접었어.'],
      ['USER', '캐리어 지퍼가 뻑뻑해.'],
      ['USER', '다시 넣을 생각은 없어.'],
      ['USER', '지퍼에 기름을 발라 봤어.'],
      ['ASSISTANT', '부산 제외로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '부산은 이번엔 안 가기로 마음을 접었어'],
  },
  {
    sk: 'p1b6-sk-db0908294e6deb6f', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 야간 근무는 내 선택지에서 뺐어.'],
      ['USER', '오늘 근무표를 봤어.'],
      ['USER', '후보는 주간, 야간, 재택이었는데 야간은 이제 고려 안 해.'],
      ['USER', '근무표는 다음 주에 나온대.'],
      ['ASSISTANT', '야간 제외로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '야간 근무는 내 선택지에서 뺐어'],
  },

  // --- p1b6-sk-e7da7f4bbf645574 | DEV/CLEAR | the earlier claim is explicitly withdrawn ---
  {
    sk: 'p1b6-sk-e7da7f4bbf645574', lang: 'MIXED', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '지난주에 이 bug는 cache 때문이라고 말했었어.'],
      ['USER', '오늘 사무실 문을 고쳤어.'],
      ['USER', '그 말은 취소할게. 근거가 없었어.'],
    ],
    ev: [0, 2], anchor: [2, '그 말은 취소할게'],
  },
  {
    sk: 'p1b6-sk-e7da7f4bbf645574', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '아까 그 집이 역세권이라고 했는데, 그 말은 없던 걸로 해 줘.'],
      ['ASSISTANT', '철회하시는 거죠?'],
      ['USER', '응.'],
    ],
    ev: [0, 1, 2], anchor: [0, '그 말은 없던 걸로 해 줘'],
  },

  // --- p1b6-sk-e7fe317a78077d37 | DEV/ESCALATE | exploratory or settled preference ---
  {
    sk: 'p1b6-sk-e7fe317a78077d37', lang: 'EN', dp: 'INTERLEAVED',
    turns: [
      ['USER', 'Of the three flats, the one near the park appeals to me most.'],
      ['USER', 'I dropped my keys in the stairwell.'],
      ['USER', 'Could you still compare the other two on running costs?'],
      ['USER', 'They were behind the radiator.'],
      ['ASSISTANT', 'I will compare those two.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'the one near the park appeals to me most'],
  },
  {
    sk: 'p1b6-sk-e7fe317a78077d37', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '카메라 후보 중에 중간 모델이 제일 끌려.'],
      ['USER', '오늘 가방 지퍼를 고쳤어.'],
      ['USER', '더 말하자면 손에 쥐었을 때가 제일 좋았어.'],
      ['USER', '지퍼는 바꿔 달았어.'],
      ['USER', '그래도 나머지 둘의 렌즈 값을 좀 비교해 줘.'],
      ['USER', '가방은 이제 잘 열려.'],
      ['ASSISTANT', '나머지 둘을 비교해 볼게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '중간 모델이 제일 끌려'],
  },
  {
    sk: 'p1b6-sk-e7fe317a78077d37', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 요금제 얘기로 돌아가면, 나는 두 번째 요금제가 마음에 들어.'],
      ['USER', '오늘 유심을 새로 받았어.'],
      ['USER', '그래도 첫 번째랑 세 번째의 데이터 제공량은 더 비교해 줘.'],
    ],
    ev: [0, 2], anchor: [0, '두 번째 요금제가 마음에 들어'],
  },
  {
    sk: 'p1b6-sk-e7fe317a78077d37', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '후보 중엔 B안이 제일 좋아 보여.'],
      ['USER', '오늘 프린터 토너를 흔들었어.'],
      ['USER', '아, 정확히는 layout이 제일 마음에 들어. 그래도 A안과 C안의 제작비는 더 비교해 줘.'],
      ['USER', '토너는 며칠 더 버틸 것 같아.'],
      ['ASSISTANT', 'A안과 C안을 비교해 볼게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'B안이 제일 좋아 보여'],
  },

  // --- p1b6-sk-f03b5a7c91e2486d | TRAIN/CLEAR | suspended, then explicitly resumed ---
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '매주 토요일에 아버지 산소에 가는데, 수술받고 회복하는 동안은 못 갔어. 지난달부터 다시 다니고 있어.'],
    ],
    ev: [0], anchor: [0, '매주 토요일에 아버지 산소에 가는데'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 저녁 운동은 다시 하고 있어.'],
      ['USER', '오늘 운동 가방을 챙겼어.'],
      ['USER', '원래 주 3회 저녁에 헬스장에 갔었어.'],
      ['USER', '가방에 수건을 넣었어.'],
      ['USER', '이사하는 동안은 두 달 쉬었고, 이번 주부터 다시 나가기 시작했어.'],
      ['USER', '락커도 다시 신청했어.'],
      ['ASSISTANT', '재개로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '저녁 운동은 다시 하고 있어'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '아이는 원래 매일 일기를 썼어.'],
      ['USER', '오늘 연필을 깎았어.'],
      ['USER', '시험 기간엔 잠깐 멈췄다가, 지난주부터 다시 쓰기 시작했어.'],
    ],
    ev: [0, 2], anchor: [0, '매일 일기를 썼어'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '아침 회의는 원래 매일 있었어.'],
      ['USER', '오늘 회의실 시계를 맞췄어.'],
      ['USER', '리모델링 동안은 없었는데, 이번 주부터 다시 열려.'],
      ['USER', '시계가 5분 빨랐어.'],
      ['ASSISTANT', '다시 매일이요?'],
      ['USER', '응, 매일.'],
    ],
    ev: [0, 2, 4, 5], anchor: [0, '아침 회의는 원래 매일 있었어'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'MIXED', dp: 'INTERLEAVED',
    turns: [
      ['USER', '나는 매달 후원금을 보내고 있었어.'],
      ['USER', '오늘 은행 app을 업데이트했어.'],
      ['USER', '카드가 정지됐던 동안은 못 보냈어.'],
      ['USER', 'app은 로그인이 새로 필요하더라.'],
      ['USER', '카드는 지난달에 다시 살아났고.'],
      ['USER', '인증서도 다시 깔았어.'],
      ['USER', '이번 달부터 다시 보내고 있어.'],
      ['USER', 'app 알림도 다시 켰어.'],
      ['ASSISTANT', '재개로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '매달 후원금을 보내고 있었어'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '주말마다 텃밭에 나가던 걸 겨울 동안 쉬었어.'],
      ['USER', '오늘 장갑을 찾았어.'],
      ['USER', '더 정확히는, 3월부터 다시 나가고 있어.'],
      ['USER', '장갑은 한 짝만 있더라.'],
      ['ASSISTANT', '재개로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '주말마다 텃밭에 나가던 걸'],
  },
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'EN', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', 'Back to the swimming question.'],
      ['USER', 'I finally returned the library books.'],
      ['USER', 'I used to swim twice a week, paused while the pool was closed, and started again last Monday.'],
    ],
    ev: [0, 2], anchor: [2, 'started again last Monday'],
  },

  // --- p1b6-sk-f2fb3e894c37caac | DEV/CLEAR | current stop with no specified end ---
  {
    sk: 'p1b6-sk-f2fb3e894c37caac', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '커피를 끊었어. 아, 정확히는 당분간 안 마시기로 한 거야. 언제까지인지는 안 정했어.'],
    ],
    ev: [0], anchor: [0, '당분간 안 마시기로 한 거야'],
  },
  {
    sk: 'p1b6-sk-f2fb3e894c37caac', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '매일 저녁에 하던 게임을 멈췄어.'],
      ['USER', '오늘 책상 아래 선을 정리했어.'],
      ['USER', '지금은 아예 안 켜고 있어.'],
      ['USER', '멀티탭도 하나 뺐어.'],
      ['USER', '다시 할 시점은 안 정했어.'],
      ['USER', '선은 케이블 타이로 묶었어.'],
      ['ASSISTANT', '중지 상태로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '게임을 멈췄어'],
  },

  // --- p1b6-sk-f4d809ae085dbac9 | TRAIN/CLEAR | the range is the intended form ---
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'MIXED', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 예상 인원은 40에서 50명 사이야.'],
      ['USER', '오늘 name tag를 주문했어.'],
      ['USER', '그 범위로 잡고 준비하면 돼.'],
      ['USER', 'tag는 다음 주에 온대.'],
      ['ASSISTANT', '40에서 50명으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '40에서 50명 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 공사 기간을 물어봤어.'],
      ['USER', '오늘 마스크를 챙겼어.'],
      ['USER', '2주에서 3주 사이라고 하더라. 그 정도로 잡으면 된대.'],
    ],
    ev: [0, 2], anchor: [2, '2주에서 3주 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 달 전기 사용량은 200에서 220킬로와트시 사이야.'],
      ['USER', '오늘 멀티탭을 바꿨어.'],
      ['USER', '그 범위로 보면 돼.'],
      ['USER', '멀티탭은 개별 스위치가 있어.'],
      ['ASSISTANT', '그 범위로요?'],
      ['USER', '응, 그 정도.'],
    ],
    ev: [0, 2, 4, 5], anchor: [0, '200에서 220킬로와트시 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 화분을 옮겼어.'],
      ['USER', '이번 답사 거리는 8에서 10킬로미터 사이로 보면 돼.'],
      ['USER', '화분은 햇빛 드는 쪽으로 뒀어.'],
    ],
    ev: [1], anchor: [1, '8에서 10킬로미터 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 번역 분량을 가늠해 봤어.'],
      ['USER', '오늘 사전을 한 권 꺼냈어.'],
      ['USER', '더 정확히는 3만에서 3만 5천 자 사이야.'],
      ['USER', '사전은 오래돼서 색이 바랬어.'],
      ['USER', '그 범위가 우리가 잡은 값이야.'],
      ['USER', '책갈피도 하나 꽂았어.'],
      ['ASSISTANT', '그 범위로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [2, '3만에서 3만 5천 자 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 budget 얘기로 돌아가면, 이번 분기는 800에서 900만 원 사이야.'],
      ['USER', '오늘 계산기를 새로 샀어.'],
      ['USER', '그 범위로 계획을 잡아 뒀어.'],
    ],
    ev: [0, 2], anchor: [0, '800에서 900만 원 사이'],
  },
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이번 교육 시간은 여섯 시간에서 여덟 시간 사이야.'],
      ['USER', '오늘 노트를 한 권 다 썼어.'],
      ['USER', '아, 정확히 말하면 그 범위 그대로 공지에 나가.'],
      ['USER', '새 노트를 꺼냈어.'],
      ['ASSISTANT', '그 범위 그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '여섯 시간에서 여덟 시간 사이'],
  },

  // --- p1b6-sk-f58debd8f04f5c60 | TRAIN/ESCALATE | the range measures frequency or quantity ---
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'EN', dp: 'CANONICAL',
    turns: [
      ['USER', 'I order from that bakery three to four a week.'],
      ['USER', 'I finally fixed the doorbell.'],
      ['USER', 'That is what my note says.'],
      ['USER', 'The chime is much louder now.'],
      ['ASSISTANT', 'Noted.'],
    ],
    ev: [0, 2, 4], anchor: [0, 'three to four a week'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 이번 달 배달은 다섯에서 여섯이야.'],
    ],
    ev: [0], anchor: [0, '다섯에서 여섯'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '요즘 우유를 자주 사.'],
      ['USER', '오늘 장바구니를 챙겼어.'],
      ['USER', '한 주에 두셋 정도야.'],
    ],
    ev: [0, 2], anchor: [2, '두셋 정도'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'MIXED', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '이번 달 택배는 열에서 열둘 정도야.'],
      ['USER', '오늘 현관에 매트를 깔았어.'],
      ['USER', '기록에 그렇게 적어 뒀어.'],
      ['USER', '매트는 미끄럼 방지야.'],
      ['ASSISTANT', '열에서 열둘이요?'],
      ['USER', '응, 그 정도.'],
      ['USER', '매트는 세탁도 돼.'],
      ['ASSISTANT', '알겠어요, 그렇게요.'],
    ],
    ev: [0, 2, 4, 5, 7], anchor: [0, '열에서 열둘 정도'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '커피는 하루에 둘에서 셋이야.'],
      ['USER', '오늘 컵을 새로 샀어.'],
      ['USER', '그렇게 적어 두면 돼.'],
      ['USER', '컵은 손잡이가 큰 걸로 골랐어.'],
      ['ASSISTANT', '그대로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '하루에 둘에서 셋'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '이번 주 회의는 셋에서 넷이야.'],
      ['USER', '오늘 다이어리를 폈어.'],
      ['USER', '더 말하자면 그 범위로 잡아 두면 돼.'],
    ],
    ev: [0, 2], anchor: [0, '셋에서 넷'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 세탁 얘기로 돌아가면, 한 주에 둘에서 셋이야.'],
      ['USER', '오늘 세제를 주문했어.'],
      ['USER', '그 숫자로 적어 뒀어.'],
      ['USER', '세제는 대용량으로 샀어.'],
      ['USER', '다른 기준은 안 정했고.'],
      ['USER', '섬유유연제도 같이 시켰어.'],
      ['USER', '그대로 두면 돼.'],
      ['USER', '배송은 모레래.'],
      ['ASSISTANT', '그대로 남겨 둘게요.'],
    ],
    ev: [0, 2, 4, 6, 8], anchor: [0, '한 주에 둘에서 셋'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '아, 다시 말할게. 이번 달 외식은 넷에서 다섯이야.'],
    ],
    ev: [0], anchor: [0, '넷에서 다섯'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'MIXED', dp: 'CANONICAL',
    turns: [
      ['USER', '이번 sprint의 ticket은 여덟에서 열이야.'],
      ['USER', '오늘 모니터를 닦았어.'],
      ['USER', 'board에도 그렇게 적혀 있어.'],
      ['USER', '화면이 훨씬 밝아 보여.'],
      ['USER', '다른 기준은 안 붙었어.'],
      ['USER', '닦는 천도 새로 샀어.'],
      ['ASSISTANT', '네, 그렇게 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '여덟에서 열'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 이번 달 병원은 둘에서 셋이야.'],
      ['USER', '오늘 진료비 영수증을 모았어.'],
      ['USER', '그 범위로 기억하고 있어.'],
      ['USER', '영수증은 봉투에 넣었어.'],
      ['ASSISTANT', '그 내용 그대로요.'],
    ],
    ev: [0, 2, 4], anchor: [0, '둘에서 셋'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'EN', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', 'I have been tracking my reading this month.'],
      ['USER', 'I replaced the lamp in the hallway.'],
      ['USER', 'It comes to two or three a week.'],
    ],
    ev: [0, 2], anchor: [2, 'two or three a week'],
  },
  {
    sk: 'p1b6-sk-f58debd8f04f5c60', lang: 'KO', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', '주유는 한 달에 셋에서 넷이야.'],
      ['USER', '오늘 차 안을 청소했어.'],
      ['USER', '그 숫자로 남겨 두면 돼.'],
      ['USER', '매트도 털었어.'],
      ['ASSISTANT', '셋에서 넷이요?'],
      ['USER', '응, 그 정도.'],
    ],
    ev: [0, 2, 4, 5], anchor: [0, '셋에서 넷'],
  },

  // --- p1b6-sk-fa8ae6d4b81d50a8 | HELD/CLEAR | identification plus attitude, no rival target ---
  {
    sk: 'p1b6-sk-fa8ae6d4b81d50a8', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '오늘 창문을 닦았어.'],
      ['USER', '어제 본 그 소파 말인데, 나는 그게 마음에 들어.'],
      ['USER', '유리가 깨끗해졌어.'],
    ],
    ev: [1], anchor: [1, '그게 마음에 들어'],
  },
  {
    sk: 'p1b6-sk-fa8ae6d4b81d50a8', lang: 'MIXED', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '지난주에 본 그 office 공간 얘기야.'],
      ['USER', '오늘 명함을 정리했어.'],
      ['USER', '더 정확히는 3층에 있던 곳.'],
      ['USER', '명함첩이 다 찼어.'],
      ['USER', '나는 거기가 제일 마음에 들었어.'],
      ['USER', '새 명함첩을 주문했어.'],
      ['ASSISTANT', '그곳 선호로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [4, '거기가 제일 마음에 들었어'],
  },
  {
    sk: 'p1b6-sk-fa8ae6d4b81d50a8', lang: 'KO', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '아까 하던 의자 얘기로 돌아가면, 어제 매장에서 본 회색 의자 말이야.'],
      ['USER', '오늘 영수증을 버렸어.'],
      ['USER', '나는 그게 제일 편했어.'],
    ],
    ev: [0, 2], anchor: [2, '그게 제일 편했어'],
  },
  {
    sk: 'p1b6-sk-fa8ae6d4b81d50a8', lang: 'KO', dp: 'SELF_REVISION',
    turns: [
      ['USER', '지난달에 읽은 그 책 얘기야.'],
      ['USER', '오늘 책장을 닦았어.'],
      ['USER', '아, 정확히는 표지가 파란 그 책. 나는 그게 좋았어.'],
      ['USER', '먼지가 꽤 있더라.'],
      ['ASSISTANT', '그 책 선호로 적어 둘게요.'],
    ],
    ev: [0, 2, 4], anchor: [2, '그게 좋았어'],
  },
];
