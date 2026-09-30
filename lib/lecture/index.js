'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerLibraryRoutes, isLectureAnnotationPut } = require('./library-routes');
const { registerSessionRoutes } = require('./session-routes');

// 강의 노트 서버 진입점. 파일은 <dataDir>/lecture/ 아래에 둔다(자료·녹음·업로드 임시).
function registerLectureRoutes({ app, db, dataDir }) {
  const root = path.join(dataDir, 'lecture');
  const paths = { documentsDir: path.join(root, 'documents'), audioDir: path.join(root, 'audio'), tmpDir: path.join(root, 'tmp') };
  Object.values(paths).forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  registerLibraryRoutes({ app, db, paths });
  registerSessionRoutes({ app, db, paths });
}

module.exports = { registerLectureRoutes, isLectureAnnotationPut };
