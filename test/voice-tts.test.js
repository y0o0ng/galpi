'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 정규화가 다루는 최소한의 유효한 16비트 PCM WAV를 만든다.
function silentWav(samples = 8, amplitude = 1000) {
  const buffer = Buffer.alloc(44 + (samples * 2));
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + (samples * 2), 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(amplitude, 44 + (i * 2));
  return buffer;
}

const {
  SPOKEN_CLOSING,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MAX_CHARS,
  DEFAULT_SPEED,
  createVoiceTtsService,
  selectSpokenText,
} = require('../lib/voice-tts');

test('a short answer is spoken whole and an empty one produces nothing', () => {
  assert.equal(selectSpokenText('오후 3시야.'), '오후 3시야.');
  assert.equal(selectSpokenText('   '), '');
  assert.equal(selectSpokenText(null), '');
});

test('a long answer is cut at a sentence boundary and points at the screen', () => {
  const long = '첫 문장이야. 두 번째 문장이야. 세 번째 문장이야. 네 번째는 읽히면 안 돼.';
  const spoken = selectSpokenText(long, { maxChars: 40 });

  assert.ok(spoken.startsWith('첫 문장이야.'));
  assert.doesNotMatch(spoken, /네 번째/);
  assert.ok(spoken.endsWith(SPOKEN_CLOSING));
});

test('the spoken cap is enforced in code rather than left to the prompt', () => {
  // 상한을 넘겨도 원문 길이가 그대로 흘러가지 않는다.
  const runaway = '가'.repeat(5000);
  const spoken = selectSpokenText(runaway);
  assert.ok(spoken.length < runaway.length);
  assert.ok(spoken.length <= DEFAULT_MAX_CHARS + 40);
});

test('the service fails closed while the flag is off and exposes no model', () => {
  const service = createVoiceTtsService({ enabled: false, apiKey: 'k' });

  assert.equal(service.available, false);
  assert.deepEqual(service.publicConfig(), {
    halfDuplexEnabled: false,
    ttsModel: null,
    ttsVoice: null,
    maxSpokenChars: DEFAULT_MAX_CHARS,
  });
  return assert.rejects(() => service.speak('안녕'), error => {
    assert.equal(error.code, 'VOICE_TTS_UNAVAILABLE');
    return true;
  });
});

test('the enabled service sends the trimmed text and never leaks the key downstream', async () => {
  const requests = [];
  const service = createVoiceTtsService({
    enabled: true,
    apiKey: 'server-only-key',
    baseUrl: 'http://provider.invalid/v1/',
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    maxChars: 30,
    async fetchImpl(url, options) {
      requests.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
      return { ok: true, async arrayBuffer() { return silentWav(); } };
    },
  });

  const long = '첫 문장이야. 두 번째 문장이야. 세 번째 문장은 잘려야 해.';
  const { spoken, audio } = await service.speak(long);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://provider.invalid/v1/audio/speech');
  assert.equal(requests[0].body.model, 'gpt-4o-mini-tts');
  assert.equal(requests[0].body.response_format, 'wav');
  // 전달 방식만 지시하고 답변 내용은 지시하지 않는다.
  assert.match(requests[0].body.instructions, /활기찬|반말/);
  // 잘라낸 문장만 provider로 간다. 전체 답변을 보내지 않는다.
  assert.equal(requests[0].body.input, spoken);
  assert.doesNotMatch(spoken, /세 번째/);
  assert.ok(spoken.length <= 30 + 40);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /server-only-key/);

  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
});

test('an upstream rejection surfaces a bounded code without the answer text', async () => {
  const service = createVoiceTtsService({
    enabled: true,
    apiKey: 'k',
    async fetchImpl() { return { ok: false, status: 429, async text() { return '비밀 본문'; } }; },
  });

  await assert.rejects(() => service.speak('사용자 발화가 섞이면 안 된다'), error => {
    assert.equal(error.code, 'VOICE_TTS_UPSTREAM_REJECTED');
    assert.doesNotMatch(error.message, /사용자 발화|비밀 본문/);
    return true;
  });
});

test('an empty instruction is omitted rather than sent as a blank field', async () => {
  const requests = [];
  const service = createVoiceTtsService({
    enabled: true,
    apiKey: 'k',
    instructions: '   ',
    async fetchImpl(url, options) {
      requests.push(JSON.parse(options.body));
      return { ok: true, async arrayBuffer() { return silentWav(); } };
    },
  });

  await service.speak('안녕');
  assert.equal('instructions' in requests[0], false);
  assert.equal(requests[0].voice, 'echo');
});

test('the speaking rate is sent and held inside the range the API accepts', async () => {
  const send = async speed => {
    const requests = [];
    const service = createVoiceTtsService({
      enabled: true,
      apiKey: 'k',
      ...(speed === undefined ? {} : { speed }),
      async fetchImpl(url, options) {
        requests.push(JSON.parse(options.body));
        return { ok: true, async arrayBuffer() { return silentWav(); } };
      },
    });
    await service.speak('안녕');
    return requests[0].speed;
  };

  // 기본은 조금 빠르게 읽는다.
  assert.equal(await send(undefined), DEFAULT_SPEED);
  assert.ok(DEFAULT_SPEED > 1);
  assert.equal(await send('1.3'), 1.3);
  // 범위를 벗어난 설정값은 매 턴 400을 부르므로 코드에서 가둔다.
  assert.equal(await send(9), 4);
  assert.equal(await send(0.01), 0.25);
  assert.equal(await send('빠르게'), DEFAULT_SPEED);
});

test('the delivery instruction no longer fights the speed setting', () => {
  // 지시문이 "너무 빠르지 않게"라고 하면 speed를 올려도 서로 상쇄된다.
  assert.doesNotMatch(DEFAULT_INSTRUCTIONS, /빠르지 않게|천천히/);
});

test('the spoken text is split at sentence ends and tiny pieces are merged', () => {
  const { splitSpokenSegments } = require('../lib/voice-tts');

  assert.deepEqual(
    splitSpokenSegments('내일 오전 9시에 일정 하나 있어. 할머니집 가기야. 알림도 걸어둘까?'),
    ['내일 오전 9시에 일정 하나 있어.', '할머니집 가기야. 알림도 걸어둘까?'],
  );
  // 조각 하나짜리 답변은 나누지 않는다.
  assert.deepEqual(splitSpokenSegments('응.'), ['응.']);
  assert.deepEqual(splitSpokenSegments('한 문장뿐이야'), ['한 문장뿐이야']);
  assert.deepEqual(splitSpokenSegments(''), []);
  // 소수점과 줄임표에서 끊으면 어색하게 읽힌다.
  assert.deepEqual(
    splitSpokenSegments('3.5초 정도 걸렸다고 나오네. 음... 그래도 예상보다는 훨씬 빠른 편이야.'),
    ['3.5초 정도 걸렸다고 나오네.', '음... 그래도 예상보다는 훨씬 빠른 편이야.'],
  );
  assert.deepEqual(
    splitSpokenSegments('버전 3.5를 쓰고 있어서 그런 것 같아. 업그레이드하면 나아질 거야.'),
    ['버전 3.5를 쓰고 있어서 그런 것 같아.', '업그레이드하면 나아질 거야.'],
  );
  // 짧은 답변은 나눠도 빨라지지 않으므로 한 조각으로 둔다.
  assert.deepEqual(
    splitSpokenSegments('3.5초 걸렸어. 음... 생각보다 빠르네.'),
    ['3.5초 걸렸어. 음... 생각보다 빠르네.'],
  );
});

test('splitting reuses the one cap so long answers still point at the screen', () => {
  const { splitSpokenSegments, DEFAULT_MAX_CHARS, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  const segments = splitSpokenSegments('가나다라마바사아자차. '.repeat(120));

  assert.ok(segments.length >= 1);
  assert.equal(segments.at(-1), closing);
  // 상한은 selectSpokenText 한 곳에서만 적용한다. 합쳐도 원문 길이가 되지 않는다.
  assert.ok(segments.join(' ').length < DEFAULT_MAX_CHARS + 60);
});

test('the number of TTS calls is bounded no matter how many sentences arrive', () => {
  const { splitSpokenSegments, MAX_SEGMENTS } = require('../lib/voice-tts');
  const many = Array.from({ length: 40 }, (_, i) => `${i}번 문장은 조금 길게 적어둔다.`).join(' ');

  assert.ok(splitSpokenSegments(many, { maxChars: 5000 }).length <= MAX_SEGMENTS);
});

test('the incremental segmenter matches the batch one as text arrives', () => {
  const { createSpokenSegmenter } = require('../lib/voice-tts');
  const feed = (chunks, options) => {
    const segmenter = createSpokenSegmenter(options);
    const out = [];
    for (const chunk of chunks) out.push(...segmenter.push(chunk));
    out.push(...segmenter.end());
    return out;
  };
  const text = '내일 오전 9시에 일정 하나 있어. 할머니집 가기야. 알림도 걸어둘까?';
  const expected = ['내일 오전 9시에 일정 하나 있어.', '할머니집 가기야. 알림도 걸어둘까?'];

  // 한 글자씩 와도 덩어리로 와도 같은 조각이 나와야 한다.
  assert.deepEqual(feed([...text]), expected);
  assert.deepEqual(feed(['내일 오전 9시에 일정 ', '하나 있어. 할머니집 ', '가기야. 알림도 걸어둘까?']), expected);
  assert.deepEqual(feed([text]), expected);
});

test('a decimal or ellipsis split across chunks is not mistaken for a sentence end', () => {
  const { createSpokenSegmenter } = require('../lib/voice-tts');
  const segmenter = createSpokenSegmenter();

  // "3." 까지만 왔을 때는 소수점인지 알 수 없으므로 내보내지 않는다.
  assert.deepEqual(segmenter.push('3.'), []);
  assert.deepEqual(segmenter.push('5초 정도 걸렸다고 나오네'), []);
  assert.deepEqual(segmenter.push('. 음'), ['3.5초 정도 걸렸다고 나오네.']);
  assert.deepEqual(segmenter.end(), ['음']);
});

test('the streamed cap stops reading and points at the screen', () => {
  const { createSpokenSegmenter, MAX_SPOKEN_SEGMENTS } = require('../lib/voice-tts');
  const feed = text => {
    const segmenter = createSpokenSegmenter();
    const out = [];
    for (const chunk of text) out.push(...segmenter.push(chunk));
    out.push(...segmenter.end());
    return out;
  };

  // 상한이 없으면 문서 개요를 한참 읽다가 글자 수에서 뚝 끊긴다. 상한을 넘으면
  // 읽기를 멈추고 화면을 가리킨다. 닫는 말도 TTS 호출 하나라 상한 안에 든다.
  const sentence = '이건 근거 문장인데 실제 답변과 비슷하게 충분히 길게 적는다. ';
  const long = feed(sentence.repeat(12).trim());
  assert.equal(long.length, MAX_SPOKEN_SEGMENTS + 1);
  assert.equal(long.at(-1), SPOKEN_CLOSING);

  // 음성 답변은 몇 문장짜리다. 그 길이는 끊지 않고 그대로 다 읽는다.
  const short = feed('첫 문장은 결론이야 이 정도 길이로. 둘째 문장도 결론의 일부야 충분히 길게. '
    + '셋째 문장으로 결론을 닫아 이렇게. 넷째 문장까지 읽혀야 정상이다 이렇게.');
  assert.ok(!short.join(' ').includes(SPOKEN_CLOSING), '짧은 답변에 되묻는 안내가 붙었다');
  assert.ok(short.join(' ').includes('넷째'), '짧은 답변이 잘렸다');

  // 아주 짧은 답변도 그대로다.
  assert.deepEqual(feed('응.'), ['응.']);
});

test('quiet and loud segments end up at the same loudness', () => {
  const { normalizeWavLoudness, TARGET_RMS } = require('../lib/voice-tts');
  const rmsOf = wav => {
    const samples = (wav.length - 44) / 2;
    let sum = 0;
    for (let i = 0; i < samples; i += 1) {
      const v = wav.readInt16LE(44 + (i * 2)) / 32768;
      sum += v * v;
    }
    return Math.sqrt(sum / samples);
  };

  // 조각마다 TTS를 따로 부르면 이렇게 음량이 갈린다. 사용자가 실기기에서 겪었다.
  const quiet = normalizeWavLoudness(silentWav(400, 3000));
  const loud = normalizeWavLoudness(silentWav(400, 9000));

  assert.ok(Math.abs(rmsOf(quiet) - TARGET_RMS) < 0.01);
  assert.ok(Math.abs(rmsOf(loud) - TARGET_RMS) < 0.01);
  // 두 조각이 같은 크기로 들려야 한 문장만 작게 들리지 않는다.
  assert.ok(Math.abs(rmsOf(quiet) - rmsOf(loud)) < 0.01);
});

test('normalizing never clips and leaves non-PCM bytes alone', () => {
  const { normalizeWavLoudness } = require('../lib/voice-tts');
  const peakOf = wav => {
    const samples = (wav.length - 44) / 2;
    let peak = 0;
    for (let i = 0; i < samples; i += 1) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + (i * 2))));
    }
    return peak / 32768;
  };

  // 거의 무음은 목표까지 끌어올리지 않는다. 이득 상한이 없으면 잡음만 커진다.
  const nearSilent = normalizeWavLoudness(silentWav(400, 30));
  assert.ok(peakOf(nearSilent) <= 0.98);
  assert.ok(peakOf(nearSilent) < 0.02);
  // 이미 큰 조각을 더 키우다 잘리면 안 된다.
  assert.ok(peakOf(normalizeWavLoudness(silentWav(400, 32000))) <= 0.98);

  // 16비트 PCM이 아니면 손대지 않는다.
  const mp3 = Buffer.from('ID3' + 'x'.repeat(80));
  assert.equal(normalizeWavLoudness(mp3), mp3);
  assert.equal(normalizeWavLoudness(Buffer.alloc(10)).length, 10);
});

test('the streamed wav header is rewritten with its real length', () => {
  const { normalizeWavLoudness } = require('../lib/voice-tts');
  const wav = silentWav(400, 6000);
  // provider는 길이를 모른 채 만들어 0xFFFFFFFF를 적어 보낸다.
  wav.writeUInt32LE(0xFFFFFFFF, 4);
  wav.writeUInt32LE(0xFFFFFFFF, 40);

  const fixed = normalizeWavLoudness(wav);
  // 길이가 거짓이면 재생기가 데이터가 더 온다고 믿고 ended를 쏘지 않는다.
  assert.equal(fixed.readUInt32LE(4), fixed.length - 8);
  assert.equal(fixed.readUInt32LE(40), fixed.length - 44);
});

test('the header is fixed even when the loudness already matches', () => {
  const { normalizeWavLoudness, TARGET_RMS } = require('../lib/voice-tts');
  // 목표 음량과 같아 표본은 건드릴 필요가 없는 조각.
  const wav = silentWav(400, Math.round(TARGET_RMS * 32768));
  wav.writeUInt32LE(0xFFFFFFFF, 40);

  assert.equal(normalizeWavLoudness(wav).readUInt32LE(40), wav.length - 44);
});

test('the plan hands back what it did not read so it can be continued', () => {
  const { planSpokenSegments, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  const sentence = '이건 근거 문장인데 실제 답변과 비슷하게 충분히 길게 적는다. ';
  const long = `${sentence.repeat(11)}마지막 문장은 여기서 끝난다.`;

  const first = planSpokenSegments(long);
  assert.equal(first.segments.at(-1), closing);
  assert.ok(first.remaining.length > 0);
  // 핸즈프리로는 화면을 못 본다. 이어 들을 길을 함께 안내한다.
  assert.match(closing, /더 들으려면/);

  // 나머지를 그대로 다시 넣으면 이어진다. 서버는 아무것도 기억하지 않는다.
  const second = planSpokenSegments(first.remaining);
  assert.ok(!second.segments.includes(closing));
  assert.equal(second.remaining, '');
  assert.ok(second.segments.join(' ').endsWith('마지막 문장은 여기서 끝난다.'));

  // 짧은 답변은 나머지가 없으므로 안내도 붙지 않는다.
  assert.deepEqual(planSpokenSegments('응.'), { segments: ['응.'], remaining: '' });
});

test('the streamed answer hands back what it did not read, like the batch plan does', () => {
  const { createSpokenProgressStream, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  const sentence = '이건 근거 문장인데 실제 답변과 비슷하게 충분히 길게 적는다. ';
  const long = `${sentence.repeat(11)}마지막 문장은 여기서 끝난다.`;

  const spoken = [];
  const stream = createSpokenProgressStream(segment => spoken.push(segment));
  // 모델은 한 글자씩 흘려보낸다. 문장이 완성될 때마다 조각이 나가야 한다.
  for (const char of long) stream.delta(char);
  stream.flush();

  assert.equal(spoken.at(-1), closing);
  // 나머지를 읽는 시점이 end()보다 늦으면 버퍼가 이미 비어 이어 듣기가 통째로 죽는다.
  assert.ok(stream.remaining().endsWith('마지막 문장은 여기서 끝난다.'));
  // 이미 읽은 만큼은 나머지에 다시 들어가지 않는다.
  assert.ok(stream.remaining().length < long.length - spoken.join('').length + 100);
});

test('an answer that ends on its own leaves nothing to continue', () => {
  const { createSpokenProgressStream, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  const spoken = [];
  const stream = createSpokenProgressStream(segment => spoken.push(segment));
  for (const char of '이건 짧은 답변이야 이 정도로.') stream.delta(char);
  stream.flush();

  assert.equal(stream.remaining(), '');
  assert.ok(!spoken.includes(closing));
});

test('text dropped before a tool call leaves no stale continuation', () => {
  const { createSpokenProgressStream } = require('../lib/voice-tts');
  const spoken = [];
  const stream = createSpokenProgressStream(segment => spoken.push(segment));
  for (const char of '먼저 이렇게 말하다가 도구를 부른다 이렇게.') stream.delta(char);
  stream.discarded();
  for (const char of '진짜 답변은 이거야 이 정도 길이로.') stream.delta(char);
  stream.flush();

  assert.deepEqual(spoken, ['진짜 답변은 이거야 이 정도 길이로.']);
  assert.equal(stream.remaining(), '');
});

test('the continued read finishes the rest instead of asking again', () => {
  const { planContinuedSegments, planSpokenSegments, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  const rest = '남은 문장을 충분히 길게 적어서 실제 답변과 비슷하게 만든다. '.repeat(40).trim();

  // 기존 모드는 세 문장만 읽고 되묻는다.
  const capped = planSpokenSegments(rest);
  assert.ok(capped.remaining.length > 0);
  assert.equal(capped.segments.at(-1), closing);

  const all = planContinuedSegments(rest);
  assert.equal(all.remaining, '');
  assert.ok(!all.segments.includes(closing));
  // 되묻지 않으므로 한 글자도 빠지면 안 된다.
  assert.equal(
    all.segments.join(' ').replace(/\s+/g, ''),
    rest.replace(/\s+/g, ''),
  );
  // 조각마다 TTS를 부르므로 문장 수만큼 쪼개지면 안 된다.
  assert.ok(all.segments.length < 10, `조각이 너무 많다: ${all.segments.length}`);
});

test('a short spoken answer is read whole instead of being cut at three sentences', () => {
  const { planSpokenSegments, SPOKEN_CLOSING: closing } = require('../lib/voice-tts');
  // 음성 답변이 몇 문장으로 짧아진 뒤의 실제 길이대로. 예전 3문장 상한은 이런 답변도
  // 잘라 매번 되묻게 만들었다. 이제는 글자 수만으로 가둔다.
  const short = '응, 그 방식이 가장 현실적이야. 로봇팔 쪽에 허용된 툴만 열어두면 돼. '
    + '그러면 내가 그 툴의 이름과 값만 부르면 되고, 위험한 동작은 네 코드가 막는다. '
    + '펌웨어에 한계각과 속도 제한을 두는 게 좋아. 원점 복귀도 하나 있으면 충분해.';
  assert.ok(short.length < 600);

  const plan = planSpokenSegments(short);
  assert.equal(plan.remaining, '');
  assert.ok(!plan.segments.includes(closing), '짧은 답변에 되묻는 안내가 붙었다');
  assert.equal(plan.segments.join(' ').replace(/\s+/g, ''), short.replace(/\s+/g, ''));

  // 상한을 넘는 답변은 여전히 끊고 안내한다.
  const long = short.repeat(6);
  const capped = planSpokenSegments(long);
  assert.equal(capped.segments.at(-1), closing);
  assert.ok(capped.remaining.length > 0);
});

// ── 링크는 화면에만 남고 소리로는 읽히지 않는다 ──────────────────────────
//
// 음성 턴도 같은 텍스트가 화면에 저장되므로 모델에게 "링크를 쓰지 마라"라고 시키면
// 사용자가 원문으로 들어갈 길이 사라진다. 그래서 화면 텍스트는 그대로 두고
// **소리로 가는 텍스트에서만** 벗긴다.

const { planSpokenSegments, createSpokenSegmenter } = require('../lib/voice-tts');

test('말할 때는 링크가 표시 글자만 남는다', () => {
  const answer = '안전 문제로 개발을 멈췄대. [Axios 기사](https://www.axios.com/2026/08/19/openai-astra) 참고해.';
  const spoken = selectSpokenText(answer);
  assert.match(spoken, /Axios 기사/);
  assert.doesNotMatch(spoken, /https?:/);
  assert.doesNotMatch(spoken, /axios\.com/);
  assert.doesNotMatch(spoken, /[[\]()]/);
});

test('맨 URL도 읽지 않는다', () => {
  const spoken = selectSpokenText('여기 봐 https://www.cnet.com/tech/anthropic-claude 이렇게.');
  assert.doesNotMatch(spoken, /https?:|cnet\.com/);
  assert.match(spoken, /여기 봐/);
  assert.match(spoken, /이렇게/);
});

test('URL의 점 때문에 조각이 잘못 갈리지 않는다', () => {
  const { segments } = planSpokenSegments(
    'OpenAI가 개발을 멈췄어. [Axios](https://www.axios.com/a/b) 여기 있어. 끝.',
    { maxChars: 600 },
  );
  const joined = segments.join(' | ');
  assert.doesNotMatch(joined, /https?:|axios\.com/);
  // "www.axios.com"의 점들이 문장 끝으로 오인되면 조각이 여섯 개쯤 된다.
  assert.ok(segments.length <= 3, `조각이 너무 많다: ${segments.length} (${joined})`);
});

test('스트리밍 중 링크가 조각에 걸쳐 도착해도 새지 않는다', () => {
  const segmenter = createSpokenSegmenter();
  const out = [];
  // 링크가 여러 delta로 쪼개져 온다.
  for (const chunk of ['안전 문제로 멈췄대. ', '[Axios 기사](https://www.', 'axios.com/2026/08/19/x)', ' 이거 봐. ', '끝이야. ']) {
    out.push(...segmenter.push(chunk));
  }
  out.push(...segmenter.end());
  const joined = out.join(' | ');
  assert.doesNotMatch(joined, /https?:|axios\.com/);
  assert.match(joined, /Axios 기사/);
});

test('링크가 없는 답변은 글자 하나 바뀌지 않는다', () => {
  const plain = '오후 3시야. 우산 챙겨. 내일은 맑을 거래.';
  assert.equal(selectSpokenText(plain), plain);
  // 짧은 조각을 붙이는 기존 동작은 그대로다. 재는 것은 내용이 온전한가다.
  assert.equal(planSpokenSegments(plain).segments.join(' '), plain);
});
