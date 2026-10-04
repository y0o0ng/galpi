'use strict';

// 새벽 제작(설계 v0.2 7장 "2단계 실행"): 04:00~07:00 KST 창에서만 편 하나를 잡아 같은 프로세스에서 끝까지 만든다.
// 창 밖에서는 새 편을 만들지 않는다(사람 의견 수정은 창과 무관하게 바로 돈다) — 저녁에 고른 주제를 낮에 바로 만들지 않는다. 한 번에 하나만 돌고(저장소가 막는다),
// 서버가 꺼지면 AbortController가 러너의 claude 프로세스 그룹을 끈다.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { nextEpisode, planPaths, produceEpisode: realProduceEpisode, reviseEpisode: realReviseEpisode } = require('./production');
const { kstDay } = require('./worker');
const { runNextUpload } = require('./youtube');
const { runNextInstagramUpload } = require('./instagram');

const KST_OFFSET_SECONDS = 9 * 60 * 60;
const WINDOW_START = 4 * 60 * 60;
const WINDOW_END = 7 * 60 * 60;

function inWindow(now) {
  const second = (now + KST_OFFSET_SECONDS) % 86400;
  return second >= WINDOW_START && second < WINDOW_END;
}

// 사실 확인 목록을 JSON으로(factcheck.py --json). 실패하면 null — 영상은 이미 factcheck를 통과했다.
function loadClaims({ py, factcheck, finalPath, cwd }) {
  return new Promise(resolve => {
    execFile(py, [factcheck, finalPath, '--json'], {
      cwd, timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
    }, (error, stdout) => {
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

function createReelsProductionWorker({
  episodes, uploads = null, uploader = null, instagramUploader = null, pushService = null, pushDispatcher = null, reelsDir, bin, spawn,
  produce = realProduceEpisode, revise = realReviseEpisode, claims = loadClaims, onError = () => {},
  intervalMs = 5 * 60 * 1000, now: clockOption,
}) {
  if (!episodes?.claimProduction) throw new TypeError('Reels 편 저장소가 필요합니다.');
  if (!reelsDir || !bin) throw new TypeError('reels 폴더와 claude 실행 경로가 필요합니다.');
  const clock = typeof clockOption === 'function' ? clockOption : () => Math.floor(Date.now() / 1000);
  let running = null;
  let uploading = null;
  let uploadingIg = null;
  let timer = null;
  let controller = null;

  // 새 편의 폴더 이름. 번호는 디스크의 앞 편과 DB에 이미 잡힌 편(아직 폴더가 없는 실패 편 포함) 중 큰 쪽 다음이다.
  function planDirs(card, usedDirs) {
    const used = usedDirs.map(dir => Number(/^ep(\d+)_/.exec(dir)?.[1] ?? 0));
    const num = Math.max(nextEpisode(reelsDir).num, ...used.map(n => n + 1));
    return {
      episodeDir: `ep${String(num).padStart(2, '0')}_c${card.id}_px`,
      workDir: path.join(reelsDir, 'work', `${kstDay(Math.floor(clock()))}-c${card.id}`),
    };
  }

  // 사람 의견 수정(검토 2). 창과 무관하게 바로 돈다. 성공이든 실패든 ready로 돌아오고 Push가 한 번 나간다.
  async function runRevision({ episode, card, n }) {
    controller = new AbortController();
    let record = null;
    let result = { outcome: 'failed' };
    try {
      record = await revise({
        card, reelsDir, workDir: episode.work_dir, episodeDir: episode.episode_dir, note: episode.revision_note, n,
        bin, spawn, signal: controller.signal,
      });
      if (record.outcome === 'ok') {
        const p = planPaths({ card, reelsDir, workDir: episode.work_dir, episodeDir: episode.episode_dir });
        result = {
          outcome: 'ok', record, videoPath: p.mp4, coverPath: p.cover,
          claims: await claims({ py: p.py, factcheck: path.join(reelsDir, 'factcheck.py'), finalPath: p.final, cwd: episode.work_dir }),
          caption: fs.readFileSync(p.caption, 'utf8'),
        };
      } else {
        const bad = [...record.stages].reverse().find(stage => stage.result === 'failed');
        result = { outcome: 'failed', code: bad?.code, detail: bad?.reason };
      }
    } catch (error) {
      result = { outcome: 'failed', code: error?.code || 'REELS_ERROR', detail: error?.detail ?? error?.message };
      onError(error);
    } finally {
      controller = null;
    }
    episodes.finishRevision(episode.id, result);
    pushService?.enqueueEpisode(episode.id, Math.floor(clock()), n);
    void pushDispatcher?.tick();
  }

  async function run() {
    const revision = episodes.claimRevision();
    if (revision) return runRevision(revision);
    const now = Math.floor(clock());
    if (!inWindow(now)) return;
    const claim = episodes.claimProduction(planDirs, now);
    if (!claim) return;
    const { episode, card, from } = claim;
    const workDir = episode.work_dir;
    controller = new AbortController();
    let record = null;
    try {
      record = await produce({ card, reelsDir, workDir, episodeDir: episode.episode_dir, bin, spawn, from, signal: controller.signal });
      if (record.outcome !== 'ok') {
        const failed = [...record.stages].reverse().find(stage => stage.result === 'failed');
        episodes.finishFailed(episode.id, failed?.code, failed?.reason, record);
        return;
      }
      const p = planPaths({ card, reelsDir, workDir, episodeDir: episode.episode_dir });
      episodes.finishOk(episode.id, {
        record,
        claims: await claims({ py: p.py, factcheck: path.join(reelsDir, 'factcheck.py'), finalPath: p.final, cwd: workDir }),
        caption: fs.readFileSync(p.caption, 'utf8'),
        videoPath: p.mp4,
        coverPath: p.cover,
      });
      pushService?.enqueueEpisode(episode.id, Math.floor(clock()));
      void pushDispatcher?.tick();
    } catch (error) {
      episodes.finishFailed(episode.id, error?.code || 'REELS_ERROR', error?.detail ?? error?.message, record);
      onError(error);
    } finally {
      controller = null;
    }
  }

  return {
    // 업로드는 네트워크 일이라 제작과 따로 돈다. 업로드끼리만 하나씩이다(저장소가 막는다).
    // 유튜브·인스타그램은 서로 독립이다. 인스타그램 tick은 토큰 갱신 확인도 한다.
    tickUpload() {
      if (!uploads) return Promise.resolve();
      if (uploader && !uploading) uploading = runNextUpload({ uploads, episodes, uploader, onError }).catch(onError).finally(() => { uploading = null; });
      if (instagramUploader && !uploadingIg) {
        uploadingIg = (async () => {
          await instagramUploader.refreshTokenIfDue().catch(onError);
          await runNextInstagramUpload({ uploads, episodes, uploader: instagramUploader, onError });
        })().catch(onError).finally(() => { uploadingIg = null; });
      }
      return Promise.all([uploading, uploadingIg]);
    },
    tick() {
      void this.tickUpload();
      if (!running) running = run().catch(onError).finally(() => { running = null; });
      return running;
    },
    start() {
      if (timer) return;
      // 서버가 꺼지며 끊긴 편은 이 시도를 쓴 채 failed로 둔다. 작업 폴더의 기록이 있으면 끊긴 단계부터 다시 돈다.
      episodes.markInterrupted(workDir => {
        try { return JSON.parse(fs.readFileSync(path.join(workDir, 'production.json'), 'utf8')); } catch { return null; }
      });
      uploads?.markInterrupted();
      void instagramUploader?.cleanup().catch(onError);
      void this.tick();
      timer = setInterval(() => { void this.tick(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      controller?.abort();
    },
  };
}

module.exports = { createReelsProductionWorker, inWindow, loadClaims };
