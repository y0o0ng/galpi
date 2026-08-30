'use strict';

const { WORKLOAD_TYPES } = require('./memory-inference-pilot');

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const COVERAGE_STATUSES = Object.freeze({
  COMPLETE: 'COMPLETE',
  INCOMPLETE: 'INCOMPLETE',
});

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function kstDate(epoch) {
  return new Date((epoch + KST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

function listKstDays(startEpoch, endEpoch) {
  if (!Number.isSafeInteger(startEpoch) || !Number.isSafeInteger(endEpoch)) {
    throw new TypeError('window epoch은 정수여야 합니다.');
  }
  if (endEpoch <= startEpoch || (endEpoch - startEpoch) % 86400 !== 0) {
    throw new TypeError('report window는 하나 이상의 완전한 KST calendar day여야 합니다.');
  }
  return Array.from(
    { length: (endEpoch - startEpoch) / 86400 },
    (unused, index) => kstDate(startEpoch + index * 86400),
  );
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function emptyCounts(day) {
  return {
    day,
    opportunities: 0,
    hardGated: 0,
    localEligible: 0,
    executed: 0,
  };
}

function buildWorkloadSummary(workloadType, rows, days) {
  const daily = new Map(days.map(day => [day, emptyCounts(day)]));
  for (const row of rows) {
    const item = daily.get(kstDate(row.occurredAt));
    if (!item) continue;
    item.opportunities += Number(row.opportunity) === 1 ? 1 : 0;
    item.hardGated += Number(row.hardGated) === 1 ? 1 : 0;
    item.localEligible += Number(row.localEligible) === 1 ? 1 : 0;
    item.executed += Number(row.executed) === 1 ? 1 : 0;
  }
  const byDay = [...daily.values()];
  const opportunityDistribution = byDay.map(item => item.opportunities);
  const totals = byDay.reduce((result, item) => ({
    opportunities: result.opportunities + item.opportunities,
    hardGated: result.hardGated + item.hardGated,
    localEligible: result.localEligible + item.localEligible,
    executed: result.executed + item.executed,
  }), { opportunities: 0, hardGated: 0, localEligible: 0, executed: 0 });
  return {
    workloadType,
    ledgerRows: rows.length,
    ...totals,
    byDay,
    observedDayDistribution: {
      selectedDays: days.length,
      daysWithOpportunities: opportunityDistribution.filter(count => count > 0).length,
      zeroOpportunityDays: opportunityDistribution.filter(count => count === 0).length,
      minimum: Math.min(...opportunityDistribution),
      p50: percentile(opportunityDistribution, 0.5),
      p95: percentile(opportunityDistribution, 0.95),
      maximum: Math.max(...opportunityDistribution),
    },
    normalizedPerDay: {
      opportunities: round(totals.opportunities / days.length),
      hardGated: round(totals.hardGated / days.length),
      localEligible: round(totals.localEligible / days.length),
      executed: round(totals.executed / days.length),
    },
  };
}

function loadRows(db, startEpoch, endEpoch) {
  const table = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'research_memory_inference_observations'
  `).get();
  if (!table) throw new Error('research_memory_inference_observations 테이블이 없습니다.');
  return db.prepare(`
    SELECT workload_type AS workloadType, occurred_at AS occurredAt,
           opportunity, hard_gated AS hardGated,
           local_eligible AS localEligible, executed
    FROM research_memory_inference_observations
    WHERE occurred_at >= ? AND occurred_at < ?
    ORDER BY occurred_at ASC, id ASC
  `).all(startEpoch, endEpoch);
}

function buildMemoryInferencePilotReport({
  db,
  startEpoch,
  endEpoch,
  coverageStatus = COVERAGE_STATUSES.INCOMPLETE,
  instrumentationFailureCount = null,
} = {}) {
  if (!db?.prepare) throw new TypeError('SQLite DB 연결이 필요합니다.');
  if (!Object.values(COVERAGE_STATUSES).includes(coverageStatus)) {
    throw new TypeError(`지원하지 않는 coverage status입니다: ${coverageStatus}`);
  }
  if (
    instrumentationFailureCount !== null
    && (!Number.isSafeInteger(instrumentationFailureCount) || instrumentationFailureCount < 0)
  ) {
    throw new TypeError('instrumentationFailureCount는 null 또는 0 이상의 정수여야 합니다.');
  }
  if (coverageStatus === COVERAGE_STATUSES.COMPLETE && instrumentationFailureCount === null) {
    throw new TypeError('COMPLETE coverage에는 외부 확인된 instrumentation failure count가 필요합니다.');
  }
  const days = listKstDays(startEpoch, endEpoch);
  const rows = loadRows(db, startEpoch, endEpoch);
  const workloads = Object.values(WORKLOAD_TYPES).map(workloadType => (
    buildWorkloadSummary(
      workloadType,
      rows.filter(row => row.workloadType === workloadType),
      days,
    )
  ));

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    frequencySource: 'observed_production',
    evaluationSetCompositionIncluded: false,
    selectedWindow: {
      startEpoch,
      endEpoch,
      startKst: days[0],
      endExclusiveKst: kstDate(endEpoch),
      calendarDays: days.length,
    },
    coverage: {
      status: coverageStatus,
      reason: coverageStatus === COVERAGE_STATUSES.COMPLETE
        ? 'EXTERNALLY_VERIFIED_WINDOW'
        : 'NOT_INFERABLE_FROM_LEDGER_ALONE',
      extrapolatedMissingIncidence: false,
    },
    instrumentationFailures: {
      available: instrumentationFailureCount !== null,
      count: instrumentationFailureCount,
      note: instrumentationFailureCount === null
        ? 'Failed ledger writes are fail-open compact logs and cannot be inferred from the ledger.'
        : 'Count supplied from an independently verified instrumentation log review.',
    },
    ledgerRows: rows.length,
    workloads,
  };
}

function formatMemoryInferencePilotReport(report) {
  const lines = [
    'XION local memory inference Pilot P0 workload-frequency report (read-only)',
    `Window: ${report.selectedWindow.startKst} <= KST date < ${report.selectedWindow.endExclusiveKst} (${report.selectedWindow.calendarDays} days)`,
    `Coverage: ${report.coverage.status} · ${report.coverage.reason} · missing incidence extrapolated: no`,
    'Frequency source: observed production ledger only; synthetic/private replay evaluation cases excluded.',
    `Instrumentation failures: ${report.instrumentationFailures.available ? report.instrumentationFailures.count : 'UNAVAILABLE'}`,
  ];
  for (const workload of report.workloads) {
    lines.push(
      '',
      `${workload.workloadType}: opportunities ${workload.opportunities} · hard-gated ${workload.hardGated} · local-eligible ${workload.localEligible} · executed ${workload.executed}`,
      `per day: opportunities ${workload.normalizedPerDay.opportunities} · hard-gated ${workload.normalizedPerDay.hardGated} · eligible ${workload.normalizedPerDay.localEligible} · executed ${workload.normalizedPerDay.executed}`,
      `day distribution: active ${workload.observedDayDistribution.daysWithOpportunities}/${workload.observedDayDistribution.selectedDays} · min/p50/p95/max ${workload.observedDayDistribution.minimum}/${workload.observedDayDistribution.p50}/${workload.observedDayDistribution.p95}/${workload.observedDayDistribution.maximum}`,
    );
    for (const day of workload.byDay) {
      lines.push(`- ${day.day}: total ${day.opportunities}, hard-gated ${day.hardGated}, eligible ${day.localEligible}, executed ${day.executed}`);
    }
  }
  if (report.coverage.status === COVERAGE_STATUSES.INCOMPLETE) {
    lines.push('', 'INCOMPLETE: 이 window의 누락 incidence를 추정하거나 다른 날로 보정하지 않았습니다.');
  }
  return lines.join('\n');
}

module.exports = {
  COVERAGE_STATUSES,
  buildMemoryInferencePilotReport,
  formatMemoryInferencePilotReport,
  listKstDays,
  percentile,
};
