"""Pi DB(읽기 전용)에서 필체 표본을 받아 $OCR_HOME/samples.json 에 저장한다."""
import json
import subprocess

from common import OCR_HOME, TEST_ROWS

NODE = "/home/pi/.nvm/versions/node/v24.16.0/bin/node"
JS = ("const D=require('/home/pi/galpi/node_modules/better-sqlite3');"
      "const db=new D('/home/pi/galpi/galpi.db',{readonly:true});"
      "const r=db.prepare('SELECT id,prompt_id,label,strokes,aspect,created_at FROM lecture_handwriting_samples ORDER BY id').all();"
      "process.stdout.write(JSON.stringify(r.map(x=>({id:x.id,promptId:x.prompt_id,label:x.label,"
      "strokes:JSON.parse(x.strokes),aspect:x.aspect,createdAt:x.created_at}))))")

out = subprocess.run(["ssh", "pi@pi", NODE, "-"], input=JS, capture_output=True, text=True, check=True).stdout
rows = json.loads(out)
OCR_HOME.mkdir(parents=True, exist_ok=True)
(OCR_HOME / "samples.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
print(f"전체 {len(rows)} / 시험지 {min(TEST_ROWS, len(rows))} / 학습 {max(len(rows) - TEST_ROWS, 0)}")
