'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerLibraryRoutes, isLectureAnnotationPut } = require('./library-routes');
const { registerSessionRoutes } = require('./session-routes');
const { registerTrashRoutes } = require('./trash-routes');
const { registerStreamRoutes } = require('./stream-routes');

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// 강의 노트 서버 진입점. 파일은 <dataDir>/lecture/ 아래에 둔다(자료·녹음·업로드 임시).
function registerLectureRoutes({ app, db, dataDir }) {
  const root = path.join(dataDir, 'lecture');
  const paths = { documentsDir: path.join(root, 'documents'), audioDir: path.join(root, 'audio'), tmpDir: path.join(root, 'tmp') };
  Object.values(paths).forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  registerLibraryRoutes({ app, db, paths });
  registerSessionRoutes({ app, db, paths });
  registerStreamRoutes({ app, db });
  // `최근 삭제`는 30일 뒤 실제로 지운다. 기동 때 한 번, 그 뒤 6시간마다 확인한다.
  const { purgeExpired } = registerTrashRoutes({ app, db, paths });
  const purge = () => { try { purgeExpired(); } catch (error) { console.error('[lecture] 휴지통 정리 실패:', error.message); } };
  purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
}

module.exports = { registerLectureRoutes, isLectureAnnotationPut };
