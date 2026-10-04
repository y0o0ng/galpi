# 포스트잇 손글씨 OCR 도구

연구 정본은 `docs/lecture-handwriting-ocr-study.md`. 스크립트는 여기, 데이터·가상환경·산출물은 `~/galpi-ocr/`(`OCR_HOME`)에 둔다. 커밋 대상은 이 폴더뿐이다.

## 설치
```
python3 -m venv ~/galpi-ocr/venv
~/galpi-ocr/venv/bin/pip install "torch==2.2.2" "torchvision==0.17.2" "numpy<2" easyocr pillow
```
이하 `PY=~/galpi-ocr/venv/bin/python`, 이 폴더에서 실행한다.

## 순서
1. `$PY export.py` — Pi DB(읽기 전용)에서 표본을 받아 `samples.json` 저장. id 순 처음 140행 = 시험지(평가 전용), 나머지 = 학습.
2. `$PY render.py --split test --out ~/galpi-ocr/test`
3. `$PY render.py --split train --augment 24 --out ~/galpi-ocr/train` (`--line-scale`, `--seed` 선택)
4. `nice -n 19 $PY train_easy.py --train-dir ~/galpi-ocr/train --test-dir ~/galpi-ocr/test --limit 0 --epochs 3 --name run1` — 결과는 `runs/<name>/`(`log.json`, `predictions.txt`, `model.pt`).
   - `--units syllable|jamo`(기본 syllable): jamo는 라벨을 NFD 자모로 바꿔 자모 단위 CTC로 학습하고 NFC로 합쳐 채점·저장한다.
   - `--lr`(기본 3e-4): 학습률.
   - 바탕 학습(선택): `$PY synth.py --count N`(OFL 손글씨 폰트로 합성, `~/galpi-ocr/fonts/<폴더>/`에 .ttf·OFL.txt 필요, 시험지와 8자 이상 겹치는 문장은 버림) 뒤 `train_easy.py ... --pretrain-dir ~/galpi-ocr/synth --pretrain-epochs K`. 합성 K에폭 후 사용자 표본 `--epochs`.
5. `$PY score.py ~/galpi-ocr/runs/run1/predictions.txt [--fold] [--exclude-leaked]`
6. `$PY luna_hint.py --hint <predictions.txt> --out luna.txt` — **OpenAI를 실제로 호출한다(저장소 `.env`의 키).** 검토자가 의도할 때만 실행.
