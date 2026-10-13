import sys, subprocess, numpy as np
FF="/Users/chanyongs21/Desktop/galpi/reels/.venv/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-x86_64-v7.1"
path, y0, y1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])  # 그림 영역(세로 비율)
W,H=72,156
raw=subprocess.run([FF,"-v","error","-i",path,"-vf",f"fps=12,scale={W}:{H},format=gray","-f","rawvideo","-"],capture_output=True).stdout
f=np.frombuffer(raw,np.uint8).reshape(-1,H,W)[:,int(H*y0):int(H*y1)].astype(int)
d=(np.abs(np.diff(f,axis=0))>12).mean(axis=(1,2))   # 프레임 사이 바뀐 픽셀 비율
moving=d>0.002
# 0.5초(6프레임) 창마다 움직임이 있었는지
win=[moving[i:i+6].any() for i in range(0,len(moving)-5,6)]
runs=[];r=0
for m in moving:
    r=0 if m else r+1; runs.append(r)
print(f"{path.split('/')[-1][:28]:28s} 길이 {len(f)/12:5.1f}s  정지 0.5s창 {100*(1-np.mean(win)):4.1f}%  최장 정지 {max(runs)/12:4.1f}s  평균 변화량 {100*d.mean():.2f}%")
