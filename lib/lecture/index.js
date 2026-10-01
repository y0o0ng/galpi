'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerLibraryRoutes, isLectureAnnotationPut } = require('./library-routes');
const { registerSessionRoutes } = require('./session-routes');
const { registerTrashRoutes } = require('./trash-routes');
const { registerStreamRoutes } = require('./stream-routes');
const { registerHandwritingRoutes } = require('./handwriting-routes');
const { registerQaRoutes, isLectureQaPost } = require('./qa-routes');

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// 강의 노트 서버 진입점. 파일은 <dataDir>/lecture/ 아래에 둔다(자료·녹음·업로드 임시·Q&A 근거 사본).
// askModel은 포스트잇 Q&A가 부르는 채팅 모델이다(server.js가 채팅 모델 설정으로 만든다).
function registerLectureRoutes({ app, db, dataDir, askModel = null }) {
  const root = path.join(dataDir, 'lecture');
  const paths = { documentsDir: path.join(root, 'documents'), audioDir: path.join(root, 'audio'), tmpDir: path.join(root, 'tmp'), qaDir: path.join(root, 'qa') };
  Object.values(paths).forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  registerLibraryRoutes({ app, db, paths });
  registerSessionRoutes({ app, db, paths });
  registerStreamRoutes({ app, db });
  registerHandwritingRoutes({ app, db });
  const qa = registerQaRoutes({ app, db, paths, askModel });
  // `최근 삭제`는 30일 뒤 실제로 지운다. 기동 때 한 번, 그 뒤 6시간마다 확인한다.
  const { purgeExpired } = registerTrashRoutes({ app, db, paths, onPurgeDocument: qa.purgeDocument });
  const purge = () => { try { purgeExpired(); } catch (error) { console.error('[lecture] 휴지통 정리 실패:', error.message); } };
  purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
}

// 1MB 전역 JSON 파서를 건너뛰고 라우트에서 따로 파싱하는 큰 요청(필기 저장·Q&A 이미지).
const isLectureLargeJson = req => isLectureAnnotationPut(req) || isLectureQaPost(req);

module.exports = { registerLectureRoutes, isLectureAnnotationPut, isLectureLargeJson };
