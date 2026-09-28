// 캡처 시간축 스파이크의 순수 분석 함수. 브라우저에서는 전역 CaptureAnalysis로,
// node 테스트에서는 require로 쓴다. 오디오 디코딩·DOM은 여기 두지 않는다.
(function (root) {
  // 짧은 창의 평균 제곱 에너지. 싱크 탭 소리의 시작점을 찾는 데만 쓴다.
  function energyEnvelope(samples, sampleRate, hopMs = 5, winMs = 10) {
    const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
    const win = Math.max(1, Math.round((sampleRate * winMs) / 1000));
    const times = [];
    const energy = [];
    for (let start = 0; start + win <= samples.length; start += hop) {
      let sum = 0;
      for (let i = start; i < start + win; i++) sum += samples[i] * samples[i];
      times.push(start / sampleRate);
      energy.push(sum / win);
    }
    return { times, energy, hopSec: hop / sampleRate };
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 예상 시각 주변 창에서 배경보다 뚜렷하게 커지는 첫 지점을 찾는다.
  // 창 안에 뚜렷한 소리가 없으면 null이다. 추측한 값을 내지 않는다.
  function findOnset(envelope, centerSec, windowSec = 1.5, ratio = 8) {
    const { times, energy } = envelope;
    const idx = [];
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= centerSec - windowSec && times[i] <= centerSec + windowSec) idx.push(i);
    }
    if (idx.length < 3) return null;
    const values = idx.map(i => energy[i]);
    const floor = median(values);
    const peak = Math.max(...values);
    if (peak <= 0 || peak < floor * ratio) return null;
    const threshold = Math.max(floor * ratio, peak * 0.3);
    for (const i of idx) if (energy[i] >= threshold) return times[i];
    return null;
  }

  function linearFit(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0 };
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) * (xs[i] - mx);
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    return { slope, intercept: my - slope * mx };
  }

  // taps: [{ sessionMs, offsetMs|null }]. offsetMs = 오디오에서 찾은 소리 시각 - 필기 기준 예상 시각.
  // gate는 §14.1의 기준점 오차 ±500ms다. drift는 수치로만 보고하고 판정은 사람이 한다.
  function summarize(taps, gateMs = 500) {
    const found = taps.filter(t => t.offsetMs !== null && Number.isFinite(t.offsetMs));
    const offsets = found.map(t => t.offsetMs);
    const fit = linearFit(found.map(t => t.sessionMs / 60000), offsets);
    const maxAbs = offsets.length ? Math.max(...offsets.map(Math.abs)) : null;
    return {
      taps: taps.length,
      found: found.length,
      missing: taps.length - found.length,
      maxAbsOffsetMs: maxAbs,
      medianOffsetMs: offsets.length ? median(offsets) : null,
      driftMsPerMin: offsets.length >= 2 ? fit.slope : null,
      gateMs,
      pass: offsets.length > 0 && found.length === taps.length && maxAbs <= gateMs,
    };
  }

  const api = { energyEnvelope, findOnset, linearFit, summarize, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CaptureAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
