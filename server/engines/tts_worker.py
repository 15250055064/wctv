"""Qwen3-TTS worker for WCcanvastv (runs inside the app's mlx-audio environment).

Reads one JSON request per line on stdin and answers one JSON line on stdout:
  {"id": "...", "text": "...", "voice": "Serena", "instruct": "温柔", "lang": "chinese", "out": "/path.wav"}
  -> {"id": "...", "ok": true, "seconds": 3.2} | {"id": "...", "ok": false, "error": "..."}
The model loads once, on the first request, and stays in memory.
"""

import json
import sys
import wave

import numpy as np

MODEL_ID = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
model = None


def say(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def synth(req):
    global model
    if model is None:
        from mlx_audio.tts.utils import load_model

        model = load_model(MODEL_ID)
    pieces = []
    rate = 24000
    for r in model.generate(
        text=req["text"],
        voice=req.get("voice") or "Serena",
        instruct=req.get("instruct") or None,
        lang_code=req.get("lang") or "auto",
    ):
        rate = r.sample_rate
        pieces.append(np.array(r.audio, dtype=np.float32).reshape(-1))
        # A short breath between lines.
        pieces.append(np.zeros(int(rate * 0.25), dtype=np.float32))
    if not pieces:
        raise RuntimeError("没有生成任何声音")
    audio = np.concatenate(pieces[:-1])
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(req["out"], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return len(pcm) / rate


say({"ready": True})
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = {}
    try:
        req = json.loads(line)
        say({"id": req.get("id"), "ok": True, "seconds": synth(req)})
    except Exception as err:  # noqa: BLE001 - report every failure to the app
        say({"id": req.get("id"), "ok": False, "error": str(err)[:500]})
