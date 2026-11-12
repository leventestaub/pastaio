"""Turn a record-agent.js video into a README GIF.

Usage: uv run --no-project --with imageio-ffmpeg python make-gif.py <video.webm> <marks.json> <out.gif>

Real-time throughout, except the model waits ("wait:n" to "done:n" in
marks.json), which play WAIT_SPEED times faster, and the page load
before "home", which is cut.
"""
import json
import subprocess
import sys

import imageio_ffmpeg

WAIT_SPEED, FPS, WIDTH = 6, 10, 390

video, marks_path, out = sys.argv[1:4]
marks = json.load(open(marks_path))
t = dict(marks)
start = t["home"] - 1.0
cuts, waits = [start], set()
for label, sec in marks:
    if label.startswith("wait:"):
        waits.add(len(cuts))
        cuts.append(sec)
    elif label.startswith("done:"):
        cuts.append(sec)
cuts.append(t["end"])

parts = []
for i, (a, b) in enumerate(zip(cuts, cuts[1:])):
    speed = WAIT_SPEED if i in waits else 1
    parts.append(f"[0:v]trim={a:.2f}:{b:.2f},setpts=(PTS-STARTPTS)/{speed}[s{i}]")
graph = ";".join(parts) + ";" + "".join(f"[s{i}]" for i in range(len(parts)))
graph += (f"concat=n={len(parts)}:v=1:a=0,fps={FPS},scale={WIDTH}:-1:flags=lanczos,split[x][y];"
          "[x]palettegen=max_colors=128:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4")
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", video,
                "-filter_complex", graph, "-loop", "0", out], check=True)
