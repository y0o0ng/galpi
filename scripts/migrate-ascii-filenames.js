'use strict';

// 일회성 마이그레이션: 노트 파일명에서 한글 슬러그 제거 → ASCII만(날짜-코드).
// 한글 NFC/NFD 불일치로 Obsidian 위키링크가 안 풀려 유령 노트가 생기는 문제 해결.
//   20260601-213115-a7km-첫-인사….md  →  20260601-213115-a7km.md
// 본문/아카이브/GRAPH_REPORT의 [[옛이름|제목]] 링크와 DB 5개 컬럼을 함께 갱신한다.
//
// ⚠️ 서비스를 정지한 상태에서 실행할 것 (DB 단독 점유). 실행 전 백업 필수.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'galpi.db');
const VAULT = process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : path.join(ROOT, 'galpi-vault');
const ARCHIVE = path.join(VAULT, '_archive');
const REPORT = path.join(VAULT, '_system', 'GRAPH_REPORT.md');

const FORMAT = /^(\d{8}-\d{6}-[a-z0-9]{4})(-.+)?\.md$/; // group1 = ASCII 식별자, group2 = 한글 슬러그(있으면)
const DRY = process.argv.includes('--dry');

// 1) 이름 매핑 만들기 (root + _archive)
function collectRenames(dir) {
  const out = [];
  let files;
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const m = f.match(FORMAT);
    if (!m || !m[2]) continue; // 형식 불일치 or 이미 ASCII만 → 건너뜀
    out.push({ dir, oldName: f, newName: `${m[1]}.md`, oldBase: f.replace(/\.md$/, ''), newBase: m[1] });
  }
  return out;
}

const renames = [...collectRenames(VAULT), ...collectRenames(ARCHIVE)];

// 충돌 검사 (새 이름 중복 / 새 이름이 이미 존재)
const newNames = new Set();
for (const r of renames) {
  const key = path.join(r.dir, r.newName);
  if (newNames.has(key)) { console.error(`❌ 새 이름 충돌: ${r.newName}`); process.exit(1); }
  newNames.add(key);
  if (fs.existsSync(key) && path.join(r.dir, r.oldName) !== key) {
    console.error(`❌ 새 이름이 이미 존재: ${r.newName}`); process.exit(1);
  }
}

console.log(`rename 대상: ${renames.length}개`);
renames.forEach(r => console.log(`  ${r.oldName}  →  ${r.newName}`));
if (renames.length === 0) { console.log('변경할 파일 없음. 종료.'); process.exit(0); }
if (!DRY && process.env.CONFIRM_ASCII_MIGRATION !== 'I_UNDERSTAND_ASCII_MIGRATION') {
  console.error('❌ 실제 마이그레이션은 CONFIRM_ASCII_MIGRATION=I_UNDERSTAND_ASCII_MIGRATION 설정 후 실행하세요.');
  console.error('   먼저 백업과 서비스 정지를 확인하고, --dry 결과를 검토해야 합니다.');
  process.exit(1);
}

// oldBase → newBase 맵 (링크 치환용)
const baseMap = new Map(renames.map(r => [r.oldBase, r.newBase]));

// 2) 모든 .md(root + archive + GRAPH_REPORT) 본문의 [[옛이름...]] 링크 치환
function rewriteLinksInFile(fp) {
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { return false; }
  let next = raw;
  for (const [oldBase, newBase] of baseMap) {
    if (next.includes(`[[${oldBase}`)) next = next.split(`[[${oldBase}`).join(`[[${newBase}`);
  }
  if (next === raw) return false;
  if (!DRY) fs.writeFileSync(fp, next);
  return true;
}

let linkFiles = 0;
for (const dir of [VAULT, ARCHIVE]) {
  let files; try { files = fs.readdirSync(dir); } catch { continue; }
  for (const f of files.filter(x => x.endsWith('.md'))) {
    if (rewriteLinksInFile(path.join(dir, f))) linkFiles++;
  }
}
if (rewriteLinksInFile(REPORT)) linkFiles++;
console.log(`링크 치환된 파일: ${linkFiles}개`);

// 3) 파일 rename
if (!DRY) {
  for (const r of renames) fs.renameSync(path.join(r.dir, r.oldName), path.join(r.dir, r.newName));
}
console.log(`파일 rename: ${renames.length}개 ${DRY ? '(dry)' : '완료'}`);

// 4) DB 갱신 (notes / note_chunks / auto_save_decisions / note_edges)
const db = new Database(DB_PATH);
const up = {
  notes: db.prepare('UPDATE notes SET filename = ? WHERE filename = ?'),
  chunks: db.prepare('UPDATE note_chunks SET note_filename = ? WHERE note_filename = ?'),
  decisions: db.prepare('UPDATE auto_save_decisions SET note_filename = ? WHERE note_filename = ?'),
  edgeSrc: db.prepare('UPDATE note_edges SET source_filename = ? WHERE source_filename = ?'),
  edgeTgt: db.prepare('UPDATE note_edges SET target_filename = ? WHERE target_filename = ?'),
};
const run = db.transaction(() => {
  let n = { notes: 0, chunks: 0, decisions: 0, edges: 0 };
  for (const r of renames) {
    const oldF = `${r.oldBase}.md`, newF = `${r.newBase}.md`;
    n.notes += up.notes.run(newF, oldF).changes;
    n.chunks += up.chunks.run(newF, oldF).changes;
    n.decisions += up.decisions.run(newF, oldF).changes;
    n.edges += up.edgeSrc.run(newF, oldF).changes + up.edgeTgt.run(newF, oldF).changes;
  }
  return n;
});
const counts = DRY ? { dry: true } : run();
console.log('DB 갱신:', JSON.stringify(counts));

// 5) 검증: notes.filename 전부 실제 파일과 매칭되나
if (!DRY) {
  const rows = db.prepare('SELECT filename FROM notes WHERE archived = 0').all();
  let missing = 0;
  for (const { filename } of rows) {
    if (!fs.existsSync(path.join(VAULT, filename))) { console.error(`  ❌ DB에 있으나 파일 없음: ${filename}`); missing++; }
  }
  console.log(missing === 0 ? '✅ 검증 통과: DB의 모든 활성 노트가 실제 파일과 매칭' : `❌ 불일치 ${missing}개`);
}
db.close();
console.log('완료.');
