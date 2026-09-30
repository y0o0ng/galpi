'use strict';

// Authored source episodes for the P1-B6 batch-004 top-up.
//
// One entry per slot of the preregistered batch-004 protocol, in slot order. `ev` selects whole
// evidence turns by index and `anchor` is `[turnIndex, 'text']`; the materializer computes every
// byte offset. `role` is the declared TARGET anchor role, required on the TARGET-boundary
// skeletons (2da4e54e, 5269c91f).
//
// Semantic contract v3: CLEAR when the visible evidence provides the TARGET's materially
// relevant status, including an approximate, tentative, conditional, attributed or explicitly
// undecided status. ESCALATE when the visible evidence does not provide the TARGET status, because
// materially different readings remain unresolved or a fact / relation necessary to state the
// TARGET status is absent. Missing premises are never invented.

module.exports = [
  // 001 | 0768ea20 | TRAIN/ESCALATE | KO | 1 fragment | CANONICAL
  {
    sk: 'p1b6-sk-0768ea2028f18511', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '책장 두 개를 놓고 어느 걸 살지 보는 중이야.'],
      ['USER', '왼쪽 책장은 폭 80cm에 높이 180cm래.'],
      ['USER', '오른쪽은 두 치수가 모두 왼쪽이랑 달라.'],
      ['USER', '줄자로 재 보니 오른쪽이 왼쪽이랑 10cm쯤 차이 나.'],
    ],
    ev: [0, 1, 2, 3], anchor: [3, '오른쪽이 왼쪽이랑 10cm쯤 차이 나'],
  },
  // 002 | 53ab6351 | TRAIN/ESCALATE | KO | 2 fragments | INTERLEAVED
  {
    sk: 'p1b6-sk-53ab63517113df16', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '이번 이사 짐은 상자 30개 분량이고 준비 기간은 열흘로 잡았어.'],
      ['USER', '어제 동네 빵집에서 식빵을 한 봉지 샀어.'],
      ['USER', '지금 보니까 한 3분의 1쯤 남았어.'],
    ],
    ev: [0, 2], anchor: [2, '3분의 1쯤 남았어'],
  },
  // 003 | 0768ea20 | TRAIN/ESCALATE | MIXED | 4 fragments | RETURN_TO_TOPIC
  {
    sk: 'p1b6-sk-0768ea2028f18511', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '새로 살 monitor 두 대를 비교하고 있어.'],
      ['USER', '첫 번째는 가로 60cm, 세로 36cm 정도야.'],
      ['USER', '참, 어제 키보드 keycap을 새로 바꿨어.'],
      ['USER', '두 번째 monitor는 가로도 세로도 첫 번째랑 달라.'],
      ['USER', 'keycap 색은 회색으로 골랐고.'],
      ['USER', '아까 monitor 얘기로 돌아가면, 두 번째가 4cm 정도 차이 나.'],
      ['USER', '책상 정리도 좀 해야겠어.'],
      ['ASSISTANT', '기억해 둘게요.'],
    ],
    ev: [0, 1, 3, 5, 7], anchor: [5, '두 번째가 4cm 정도 차이 나'],
  },
  // 004 | 2da4e54e | TRAIN/ESCALATE | KO | 2 fragments | CONTEXT_FIRST | TARGET boundary
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'CONTEXT_FIRST', role: 'RULE_RESULT',
    turns: [
      ['USER', '우리 구립 도서관 열람실은 한 번 예약하면 2시간까지 쓸 수 있어.'],
      ['USER', '수험생으로 등록한 회원만 예외로 4시간을 준대.'],
      ['USER', '오늘 아침엔 커피를 두 잔이나 마셨어.'],
      ['USER', '저녁엔 대학 동기랑 같이 가서 친구 좌석 이용 시간을 먼저 확인해야 해.'],
    ],
    ev: [0, 1, 3], anchor: [3, '친구 좌석 이용 시간'],
  },
  // 005 | 53ab6351 | TRAIN/ESCALATE | MIXED | 3 fragments | SELF_REVISION
  {
    sk: 'p1b6-sk-53ab63517113df16', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '이번 sprint에는 처리할 ticket이 24개 있고 기간은 2주야.'],
      ['USER', '점심은 회사 앞 국숫집에서 먹었어.'],
      ['USER', '아, 다시 말할게. ticket이 24개가 아니라 20개였어.'],
      ['USER', '국숫집은 줄이 좀 있었고.'],
      ['USER', '지금 기준으로 절반 정도 남았어.'],
    ],
    ev: [0, 2, 4], anchor: [4, '절반 정도 남았어'],
  },
  // 006 | 0768ea20 | TRAIN/ESCALATE | KO | 1 fragment | CANONICAL
  {
    sk: 'p1b6-sk-0768ea2028f18511', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '거실에 깔 러그를 두 장 비교하고 있어.'],
      ['USER', '하나는 가로 160cm, 세로 230cm짜리야.'],
      ['USER', '다른 하나는 가로도 세로도 이것보다 작아.'],
      ['USER', '두 번째가 20cm쯤 작더라.'],
    ],
    ev: [0, 1, 2, 3], anchor: [3, '두 번째가 20cm쯤 작더라'],
  },
  // 007 | 2da4e54e | TRAIN/ESCALATE | KO | 3 fragments | INTERLEAVED | TARGET boundary
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'INTERLEAVED', role: 'RULE_RESULT',
    turns: [
      ['USER', '우리 회사 우편실은 도착한 택배를 사흘 동안 보관해 줘.'],
      ['USER', '오늘 회의실 예약이 꼬여서 한참 헤맸어.'],
      ['USER', '냉장이 필요한 택배만 예외로 그날 안에 찾아가야 한대.'],
      ['USER', '회의는 결국 옆 방에서 했어.'],
      ['USER', '어제 온 내 택배 보관 기한을 모르겠어서 우편실에 들러야겠어.'],
    ],
    ev: [0, 2, 4], anchor: [4, '내 택배 보관 기한'],
  },
  // 008 | 53ab6351 | TRAIN/ESCALATE | EN | 4 fragments | ELLIPTICAL_REPLY
  {
    sk: 'p1b6-sk-53ab63517113df16', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'The community garden has 40 beds to plant, and we were given six weeks.'],
      ['USER', 'I repainted the shed door on Saturday.'],
      ['USER', 'The volunteers log beds and weeks on the same board.'],
      ['USER', 'The paint still needs a second coat.'],
      ['USER', 'Both counts go into the grant report.'],
      ['USER', 'Someone brought lemonade, which was nice.'],
      ['ASSISTANT', 'So how much is left?'],
      ['USER', 'About a quarter.'],
    ],
    ev: [0, 2, 4, 6, 7], anchor: [7, 'About a quarter'],
  },
  // 009 | 0768ea20 | TRAIN/ESCALATE | KO | 2 fragments | CONCLUSION_FIRST
  {
    sk: 'p1b6-sk-0768ea2028f18511', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 새 액자가 기존 액자보다 3cm 정도 커.'],
      ['USER', '오늘 벽에 난 못 자국을 메웠어.'],
      ['USER', '기존 액자는 가로 40cm, 세로 50cm인데 새 건 두 치수가 다 달라.'],
    ],
    ev: [0, 2], anchor: [0, '새 액자가 기존 액자보다 3cm 정도 커'],
  },
  // 010 | 2da4e54e | TRAIN/ESCALATE | MIXED | 3 fragments | SELF_REVISION | TARGET boundary
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'MIXED', dp: 'SELF_REVISION', role: 'RULE_RESULT',
    turns: [
      ['USER', '우리 팀 laptop 대여는 기본 기간이 5일이야.'],
      ['USER', '아, 다시 말할게. 기본은 5일이 아니라 7일이야.'],
      ['USER', '오늘 모니터 받침대를 새로 받았어.'],
      ['USER', '외부 contractor는 예외로 30일까지 빌릴 수 있고.'],
      ['USER', '받침대 높이가 딱 맞더라.'],
      ['USER', '다음 주에 오는 새 동료의 laptop 대여 기간을 정리해 둬야 해.'],
    ],
    ev: [0, 1, 3, 5], anchor: [5, 'laptop 대여 기간'],
  },
  // 011 | 53ab6351 | TRAIN/ESCALATE | KO | 2 fragments | CONTEXT_FIRST
  {
    sk: 'p1b6-sk-53ab63517113df16', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '이번 학기 과제는 읽어야 할 논문이 12편이고 제출까지 6주가 주어졌어.'],
      ['USER', '어제는 동아리 방을 청소했어.'],
      ['USER', '오늘 따져 보니까 한 3분의 2는 남았어.'],
    ],
    ev: [0, 2], anchor: [2, '한 3분의 2는 남았어'],
  },
  // 012 | 2da4e54e | TRAIN/ESCALATE | KO | 3 fragments | PROGRESSIVE_REFINEMENT | TARGET boundary
  {
    sk: 'p1b6-sk-2da4e54e6609e34b', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT', role: 'RULE_RESULT',
    turns: [
      ['USER', '이번 주말 전시 해설 투어는 참가비가 만 원이야.'],
      ['USER', '정확히는, 근처 대학 재학생이면 절반만 받는대.'],
      ['USER', '어제 우산을 지하철에 두고 내렸어.'],
      ['USER', '거기에 오래된 친구도 데려가기로 했어.'],
      ['USER', '우산은 분실물 센터에 문의해 뒀고.'],
      ['USER', '그래서 친구 참가비를 같이 계산해야 해.'],
    ],
    ev: [0, 1, 3, 5], anchor: [5, '친구 참가비'],
  },
  // 013 | 000035b8 | TRAIN/CLEAR | EN | 5 fragments | ELLIPTICAL_REPLY
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', "I'm thinking about switching to a standing desk."],
      ['USER', 'The printer jammed twice this morning.'],
      ['USER', 'I measured the corner where it would go.'],
      ['USER', 'I finally cleared the jam with a butter knife.'],
      ['USER', 'A coworker lent me hers for a day to try it out.'],
      ['USER', 'The printer seems fine now.'],
      ['USER', "I haven't decided anything yet."],
      ['USER', 'Lunch was leftover soup.'],
      ['ASSISTANT', 'Still weighing it, then?'],
      ['USER', 'Yeah, still weighing it.'],
    ],
    ev: [0, 2, 4, 6, 8, 9], anchor: [0, 'switching to a standing desk'],
  },
  // 014 | 000035b8 | TRAIN/CLEAR | KO | 2 fragments | INTERLEAVED
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '요즘 주말 요가 수업에 등록할지 생각하고 있어.'],
      ['USER', '오늘 세탁기 필터를 청소했어.'],
      ['USER', '시간표랑 가격은 봤는데 아직 신청은 안 했어. 계속 고민 중이야.'],
    ],
    ev: [0, 2], anchor: [0, '주말 요가 수업에 등록할지'],
  },
  // 015 | 43016ef6 | TRAIN/CLEAR | MIXED | 4 fragments | RETURN_TO_TOPIC
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '팀장님이 이번 release가 다음 주로 밀린다고 했어.'],
      ['USER', '참, 오늘 사무실 plant에 물을 줬어.'],
      ['USER', '그 얘기는 회의 끝나고 복도에서 들은 거야.'],
      ['USER', '잎이 좀 누렇게 변했더라.'],
      ['USER', '아까 release 얘기로 돌아가면, 나는 아직 공식 공지를 못 봤어.'],
      ['USER', '영양제를 하나 사야겠어.'],
      ['ASSISTANT', '팀장님 말씀으로 적어 둘게요.'],
    ],
    ev: [0, 2, 4, 6], anchor: [0, '이번 release가 다음 주로 밀린다고'],
  },
  // 016 | 000035b8 | TRAIN/CLEAR | KO | 2 fragments | CONTEXT_FIRST
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '작년부터 쓰던 가계부 앱이 유료로 바뀌었어.'],
      ['USER', '그래서 다른 앱으로 옮길지 따져 보는 중이야. 아직 결정은 안 했어.'],
      ['USER', '오늘은 퇴근길에 비가 그쳤더라.'],
      ['USER', '옮기면 기존 기록을 내보내야 해서 그것도 보고 있어.'],
    ],
    ev: [0, 1, 3], anchor: [1, '다른 앱으로 옮길지'],
  },
  // 017 | 0767dc2f | TRAIN/CLEAR | MIXED | 3 fragments | SELF_REVISION
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '우리 아파트 gym은 저녁 10시에 문을 닫아.'],
      ['USER', '오늘 택배 상자를 분리수거했어.'],
      ['USER', '아, 다시 말할게. 10시가 아니라 9시에 닫아.'],
      ['USER', '상자 테이프 떼는 게 제일 귀찮더라.'],
      ['USER', '다만 관리실에 night shift로 등록한 사람은 예외로 자정까지 쓸 수 있고, 나도 그렇게 등록돼 있어.'],
      ['USER', '오늘도 퇴근하고 11시쯤 gym에 갈 거야.'],
    ],
    ev: [0, 2, 4, 5], anchor: [5, '11시쯤 gym에 갈 거야'],
  },
  // 018 | 0ed5b52f | TRAIN/CLEAR | KO | 1 fragment | CANONICAL
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '다음 달 워크숍 장소는 제주도로 잡혔다고 들었어.'],
      ['USER', '방금 인사팀 메일로도 제주도로 확정됐다고 왔어.'],
    ],
    ev: [0, 1], anchor: [0, '다음 달 워크숍 장소'],
  },
  // 019 | 187292f8 | TRAIN/CLEAR | KO | 2 fragments | INTERLEAVED
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '어제 동생한테 빌린 전동 드릴을 아직 못 돌려줬어.'],
      ['USER', '오늘 점심은 김밥이었어.'],
      ['USER', '이번 주말에 그거 꼭 가져다줘야 해.'],
    ],
    ev: [0, 2], anchor: [2, '그거'],
  },
  // 020 | 43016ef6 | TRAIN/CLEAR | EN | 4 fragments | ELLIPTICAL_REPLY
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'My landlord said the rent is going up in March.'],
      ['USER', 'I bought new curtains yesterday.'],
      ['USER', 'He mentioned it in passing at the mailbox.'],
      ['USER', 'The curtains are a bit too long.'],
      ['USER', 'Nothing has come in writing yet.'],
      ['USER', 'I might hem them myself.'],
      ['ASSISTANT', "So that's what he told you?"],
      ['USER', 'Right, his words.'],
    ],
    ev: [0, 2, 4, 6, 7], anchor: [0, 'the rent is going up in March'],
  },
  // 021 | 6e493bbf | TRAIN/CLEAR | KO | 2 fragments | CONCLUSION_FIRST
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론만 말하면 치과 예약은 목요일로 바뀌었어.'],
      ['USER', '오늘 아침엔 버스가 조금 늦게 왔어.'],
      ['USER', '원래는 화요일이었는데 병원에서 전화가 와서 목요일로 옮겼어.'],
    ],
    ev: [0, 2], anchor: [0, '치과 예약'],
  },
  // 022 | 8dd28ec6 | TRAIN/CLEAR | MIXED | 3 fragments | SELF_REVISION
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '나는 아침마다 한강에서 running을 해.'],
      ['USER', '오늘 새 earphone을 샀어.'],
      ['USER', '아, 다시 말할게. 아침마다가 아니라 평일 아침마다야.'],
      ['USER', '노이즈 캔슬링이 생각보다 좋더라.'],
      ['USER', '지난주엔 발목 때문에 쉬었는데, 발목은 이제 다 나았어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '한강에서 running을 해'],
  },
  // 023 | be0efa30 | TRAIN/ESCALATE | KO | 2 fragments | CANONICAL
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '올해 운동은 일주일에 세 번 하기로 정했어.'],
      ['USER', '헬스장 개인 레슨은 일주일에 두 번으로 잡았어.'],
      ['USER', '오늘은 운동화 끈을 새로 갈았어.'],
      ['USER', '이번 주 운동 횟수를 달력에 적어 두려고.'],
    ],
    ev: [0, 1, 3], anchor: [3, '이번 주 운동 횟수'],
  },
  // 024 | f03b5a7c | TRAIN/CLEAR | KO | 3 fragments | PROGRESSIVE_REFINEMENT
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '나는 매주 토요일마다 부모님 댁에 반찬을 갖다드려.'],
      ['USER', '오늘 책상 서랍을 정리했어.'],
      ['USER', '정확히는, 부모님이 여행 가신 이번 달 초 2주 동안은 쉬었어.'],
      ['USER', '서랍에서 오래된 영수증이 잔뜩 나왔고.'],
      ['USER', '지난주부터 다시 토요일마다 갖다드리고 있어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '부모님 댁에 반찬을 갖다드려'],
  },
  // 025 | f4d809ae | TRAIN/CLEAR | EN | 5 fragments | ELLIPTICAL_REPLY
  {
    sk: 'p1b6-sk-f4d809ae085dbac9', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', "The drive to my aunt's place takes two to three hours."],
      ['USER', 'I cleaned out the glove box today.'],
      ['USER', "That's the usual range, depending on traffic."],
      ['USER', 'Found three old parking tickets in there.'],
      ['USER', 'I always plan around that window.'],
      ['USER', 'They were all paid, luckily.'],
      ['USER', 'Nobody has ever quoted me a different figure.'],
      ['USER', 'I also found a spare phone charger.'],
      ['ASSISTANT', 'Two to three hours, then?'],
      ['USER', "Yep, that's the range."],
    ],
    ev: [0, 2, 4, 6, 8, 9], anchor: [0, 'two to three hours'],
  },
  // 026 | 000035b8 | TRAIN/CLEAR | KO | 2 fragments | CONCLUSION_FIRST
  {
    sk: 'p1b6-sk-000035b8df850b3e', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 대학원에 지원할지는 아직 고민 중이야.'],
      ['USER', '어제 오랜만에 대청소를 했어.'],
      ['USER', '지원 요강은 다 읽어 봤는데 마음을 못 정했어.'],
    ],
    ev: [0, 2], anchor: [0, '대학원에 지원할지'],
  },
  // 027 | 0767dc2f | TRAIN/CLEAR | MIXED | 4 fragments | RETURN_TO_TOPIC
  {
    sk: 'p1b6-sk-0767dc2f59b57601', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['USER', '우리 회사 coffee machine은 오후 6시 이후엔 잠겨.'],
      ['USER', '참, 오늘 laptop 배터리가 금방 닳더라.'],
      ['USER', '다만 당직자로 지정된 사람은 예외로 밤새 쓸 수 있어.'],
      ['USER', '충전기를 집에 두고 왔어.'],
      ['USER', '아까 coffee machine 얘기로 돌아가면, 이번 주 당직자가 바로 나야.'],
      ['USER', '충전기는 옆자리에서 빌렸고.'],
      ['USER', '그래서 오늘 밤에 coffee machine 쓰는 건 문제없어.'],
    ],
    ev: [0, 2, 4, 6], anchor: [6, '오늘 밤에 coffee machine 쓰는 건'],
  },
  // 028 | 0ed5b52f | TRAIN/CLEAR | KO | 2 fragments | CONTEXT_FIRST
  {
    sk: 'p1b6-sk-0ed5b52f4c5735e9', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '동생 결혼식 날짜 얘기를 먼저 해야겠다.'],
      ['USER', '엄마 말로는 10월 셋째 주 토요일이래.'],
      ['USER', '오늘 회사 엘리베이터가 점검 중이었어.'],
      ['USER', '동생한테 직접 물어보니 똑같이 10월 셋째 주 토요일이라고 하더라.'],
    ],
    ev: [0, 1, 3], anchor: [0, '동생 결혼식 날짜'],
  },
  // 029 | 187292f8 | TRAIN/CLEAR | KO | 3 fragments | PROGRESSIVE_REFINEMENT
  {
    sk: 'p1b6-sk-187292f8cbc0126c', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '지난주에 산 겨울 코트 소매가 좀 길어.'],
      ['USER', '오늘 저녁엔 라면을 끓여 먹었어.'],
      ['USER', '정확히는 오른쪽 소매가 왼쪽보다 조금 더 길어.'],
      ['USER', '라면에 계란도 하나 넣었고.'],
      ['USER', '내일 수선집에 그걸 맡기려고.'],
    ],
    ev: [0, 2, 4], anchor: [4, '그걸'],
  },
  // 030 | 2b6f4ac9 | TRAIN/CLEAR | KO | 1 fragment | CANONICAL
  {
    sk: 'p1b6-sk-2b6f4ac9e15d8307', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '여름휴가는 부산보다 강릉이 더 끌려.'],
      ['USER', '그래도 실제로 어디로 갈지는 아직 안 정했어.'],
    ],
    ev: [0, 1], anchor: [0, '여름휴가'],
  },
  // 031 | 43016ef6 | TRAIN/CLEAR | KO | 2 fragments | INTERLEAVED
  {
    sk: 'p1b6-sk-43016ef6da889a87', lang: 'KO', dp: 'INTERLEAVED',
    turns: [
      ['USER', '옆집 아저씨가 이번 겨울에 우리 건물 보일러를 교체한다고 하더라.'],
      ['USER', '오늘 현관 매트를 새로 깔았어.'],
      ['USER', '관리사무소 공지는 아직 없고, 아저씨한테 들은 게 전부야.'],
    ],
    ev: [0, 2], anchor: [0, '우리 건물 보일러를 교체한다고'],
  },
  // 032 | 4bbd5559 | TRAIN/CLEAR | MIXED | 4 fragments | RETURN_TO_TOPIC
  {
    sk: 'p1b6-sk-4bbd555977190591', lang: 'MIXED', dp: 'RETURN_TO_TOPIC',
    turns: [
      ['ASSISTANT', '내일 오전 stand-up meeting을 30분 늦출까요?'],
      ['USER', '아, 창밖에 비가 오기 시작했어.'],
      ['USER', '참석자 중에 오전 외근이 있는 사람이 둘이야.'],
      ['USER', '우산은 사물함에 있을 거야.'],
      ['USER', '아까 meeting 얘기로 돌아가면, 그 두 사람은 10시 반에 들어와.'],
      ['USER', '사물함 열쇠는 책상 위에 있고.'],
      ['USER', '응, 그렇게 해줘.'],
    ],
    ev: [0, 2, 4, 6], anchor: [6, '그렇게 해줘'],
  },
  // 033 | 6e493bbf | TRAIN/CLEAR | KO | 2 fragments | CONCLUSION_FIRST
  {
    sk: 'p1b6-sk-6e493bbfafdb22de', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 동호회 모임 장소가 합정으로 바뀌었어.'],
      ['USER', '오늘 헬멧 끈이 끊어져서 새로 샀어.'],
      ['USER', '처음엔 신촌에서 하기로 했는데 회장님이 합정으로 옮긴다고 공지했어.'],
    ],
    ev: [0, 2], anchor: [0, '동호회 모임 장소'],
  },
  // 034 | 82149f27 | TRAIN/CLEAR | MIXED | 3 fragments | SELF_REVISION
  {
    sk: 'p1b6-sk-82149f27c2f521ae', lang: 'MIXED', dp: 'SELF_REVISION',
    turns: [
      ['USER', '다음 주 client 미팅은 화요일 오후 2시, 3층 회의실이야.'],
      ['USER', '오늘 printer 토너를 갈았어.'],
      ['USER', '아, 다시 말할게. 시간은 2시가 아니라 4시로 바뀌었어.'],
      ['USER', '토너 가루가 손에 좀 묻었고.'],
      ['USER', '장소도 3층이 아니라 5층 회의실로 옮겨졌대.'],
    ],
    ev: [0, 2, 4], anchor: [0, '다음 주 client 미팅'],
  },
  // 035 | 8a41f0d9 | TRAIN/CLEAR | KO | 1 fragment | CANONICAL
  {
    sk: 'p1b6-sk-8a41f0d92c7e6b35', lang: 'KO', dp: 'CANONICAL',
    turns: [
      ['USER', '이사 오고 나서 인터넷 설치 전까지는 휴대폰 핫스팟을 쓰기로 했어.'],
      ['USER', '오늘 오후에 기사님이 와서 인터넷 설치를 끝냈어.'],
    ],
    ev: [0, 1], anchor: [0, '휴대폰 핫스팟을 쓰기로'],
  },
  // 036 | 8dd28ec6 | TRAIN/CLEAR | KO | 3 fragments | PROGRESSIVE_REFINEMENT
  {
    sk: 'p1b6-sk-8dd28ec6b22a18ad', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT',
    turns: [
      ['USER', '나는 퇴근 후에 매일 강아지 산책을 시켜.'],
      ['USER', '오늘 회사 복도에 새 화분이 들어왔어.'],
      ['USER', '정확히는 장마 기간엔 비가 많이 와서 산책을 쉬었어.'],
      ['USER', '화분 이름표에 몬스테라라고 적혀 있더라.'],
      ['USER', '장마는 지난주에 끝났어.'],
    ],
    ev: [0, 2, 4], anchor: [0, '강아지 산책을 시켜'],
  },
  // 037 | be0efa30 | TRAIN/ESCALATE | EN | 4 fragments | ELLIPTICAL_REPLY
  {
    sk: 'p1b6-sk-be0efa305956d111', lang: 'EN', dp: 'ELLIPTICAL_REPLY',
    turns: [
      ['USER', 'Quiet hours in my building start at 10 p.m.'],
      ['USER', 'The hallway lights got replaced this morning.'],
      ['USER', 'The basement music room stays open until 11.'],
      ['USER', 'I left my umbrella at the gym again.'],
      ['USER', 'I want to get some drum practice in at 10:30 tonight.'],
      ['USER', 'Probably pizza for dinner.'],
      ['ASSISTANT', 'Down in the music room, you mean?'],
      ['USER', 'Yeah, that one.'],
    ],
    ev: [0, 2, 4, 6, 7], anchor: [4, 'drum practice in at 10:30 tonight'],
  },
  // 038 | f03b5a7c | TRAIN/CLEAR | KO | 2 fragments | CONCLUSION_FIRST
  {
    sk: 'p1b6-sk-f03b5a7c91e2486d', lang: 'KO', dp: 'CONCLUSION_FIRST',
    turns: [
      ['USER', '결론부터 말하면 영어 회화 스터디는 다시 매주 수요일에 나가.'],
      ['USER', '오늘 신발장 정리를 했어.'],
      ['USER', '시험 기간 한 달 동안은 쉬었다가 이번 주부터 다시 나가기 시작했어.'],
    ],
    ev: [0, 2], anchor: [0, '영어 회화 스터디'],
  },
  // 039 | 5269c91f | DEV/ESCALATE | MIXED | 3 fragments | RETURN_TO_TOPIC | TARGET boundary
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'MIXED', dp: 'RETURN_TO_TOPIC', role: 'CATEGORY_MEMBERSHIP',
    turns: [
      ['USER', '이 coworking space는 장기 이용자한테만 locker를 무료로 줘.'],
      ['USER', '참, 오늘 노트북에 스티커를 새로 붙였어.'],
      ['USER', '안내문을 보면 장기 이용자는 보통 6개월 넘게 다니고 월 정기권을 끊은 사람이래.'],
      ['USER', '스티커는 고양이 그림이야.'],
      ['USER', '아까 locker 얘기로 돌아가면, 나는 8개월째 다니는데 매번 일일권으로 결제했어. 내가 장기 이용자에 들어가는지 내일 물어봐야겠어.'],
    ],
    ev: [0, 2, 4], anchor: [4, '장기 이용자에 들어가는지'],
  },
  // 040 | 47c9b12e | DEV/CLEAR | KO | 2 fragments | CONTEXT_FIRST
  {
    sk: 'p1b6-sk-47c9b12e0a6f83d5', lang: 'KO', dp: 'CONTEXT_FIRST',
    turns: [
      ['USER', '나는 원래 매주 월요일에 분리수거 당번이야.'],
      ['USER', '이번 달부터는 금요일 음식물 쓰레기 당번도 같이 맡게 됐어. 월요일 당번은 그대로고.'],
      ['USER', '오늘 베란다 창문을 닦았어.'],
      ['USER', '반장님이 두 당번 모두 계속 맡아 달라고 했어.'],
    ],
    ev: [0, 1, 3], anchor: [0, '월요일에 분리수거 당번'],
  },
  // 041 | 5269c91f | DEV/ESCALATE | KO | 3 fragments | PROGRESSIVE_REFINEMENT | TARGET boundary
  {
    sk: 'p1b6-sk-5269c91fcfb6c2cd', lang: 'KO', dp: 'PROGRESSIVE_REFINEMENT', role: 'APPLICABILITY_STATUS',
    turns: [
      ['USER', '우리 동네 문화센터는 지역 주민에게만 강좌 할인을 해 줘.'],
      ['USER', '오늘 자전거 바퀴에 바람을 넣었어.'],
      ['USER', '정확히는, 안내문에 지역 주민은 보통 이 동네에 1년 넘게 살고 주민센터에 등록한 사람이라고 돼 있어.'],
      ['USER', '바퀴 바람이 생각보다 금방 빠지더라.'],
      ['USER', '나는 이 동네로 이사 온 지 두 달 됐고 주민센터 등록은 해 뒀어. 내가 지역 주민 할인 대상인지는 센터에 전화해 봐야겠어.'],
    ],
    ev: [0, 2, 4], anchor: [4, '지역 주민 할인 대상인지'],
  },
];
