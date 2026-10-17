"""옛 5px 영상 회귀: 형식 2 도입 전(기준 커밋 c13b008)에 뜬 프레임·소리 해시와 지금 엔진의 결과가 같다.
프레임 해시 = md5(compose 출력 배열) + md5(캔버스)[:8]. 장면·엔딩 도장 흔들림 프레임·마지막 프레임과 BGM·타자음·효과음을 본다.
편마다 새 프로세스에서 돈다(편 폴더의 art.py 이름이 겹친다)."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {
    "ep08_c12_px": {
        "frames": {
            "0": "9b98b094444bfbeb6c6266502382f90a586e3f35",
            "2255": "5a3c6404d822e04f747dfbe538015a7ce5ef981a",
            "2660": "6a757f48546a5c9e70d02ce4f589461910bca8af",
            "2645": "ed1094c70efb2e8f9c6d05e25f49db8d7d3fe0e4",
            "2670": "6a757f48546a5c9e70d02ce4f589461910bca8af",
            "2671": "8a3aa33ea700636d302ddd50fd4b024361059632",
            "2672": "8a3aa33ea700636d302ddd50fd4b024361059632",
            "2715": "2c21704d1f8f5ec9ea43389f4bf03ad10069943b"
        },
        "audio": [
            "c5a9bfc43d941e523d926150f977fd5f",
            "9421e0632a51f9193836633a2ffd3617",
            "424e640108a7e93d0119539230d6b71c"
        ]
    },
    "ep05_c3_px": {
        "frames": {
            "0": "42f5e23b5b5717936ae5b1779b2a2e070716a719",
            "2132": "1408a7bc8c702ed87830aaa1737ba08d9ef3fcb2",
            "2199": "d06ddbdf540aa178f3cece3ead95fd510cb63d21",
            "2180": "ace33c75903739d19b59ad158f2784be008aac45",
            "2205": "d06ddbdf540aa178f3cece3ead95fd510cb63d21",
            "2206": "9025754733be15ede3c4bb5b99c4cb87267ca884",
            "2207": "9025754733be15ede3c4bb5b99c4cb87267ca884",
            "2250": "65ee5d2a97304eba020e345e1795dfa2ce867817"
        },
        "audio": [
            "9039093a2c26d851026f7949b2b9bc89",
            "6b5fdb988b0ede0e4e4707ed4babee24",
            "1c79b861e625c76b5c902541286ef054"
        ]
    }
}

SNIPPET = """
import hashlib, json, runpy, sys
g = runpy.run_path(sys.argv[1], run_name="legacy_hash")
ep = g["ep"]
out = {}
for i in map(int, sys.argv[2:]):
    canvases, arr = ep.compose(i)
    out[str(i)] = hashlib.md5(arr.tobytes()).hexdigest() + hashlib.md5(canvases[0].tobytes()).hexdigest()[:8]
b, ty, sf, _, _ = ep.sound()
print(json.dumps({"frames": out, "audio": [hashlib.md5(x.tobytes()).hexdigest() for x in (b, ty, sf)]}))
"""


class LegacyFramesTest(unittest.TestCase):
    def test_legacy_episodes_are_byte_identical(self):
        for name, want in EXPECTED.items():
            with self.subTest(episode=name):
                run = subprocess.run([sys.executable, "-c", SNIPPET, str(ROOT / "episodes" / name / "scene.py"), *want["frames"]],
                                     capture_output=True, text=True, cwd=ROOT)
                self.assertEqual(run.returncode, 0, run.stderr[-500:])
                got = json.loads(run.stdout.strip().splitlines()[-1])
                self.assertEqual(got["frames"], want["frames"])
                self.assertEqual(got["audio"], want["audio"])


if __name__ == "__main__":
    unittest.main()
