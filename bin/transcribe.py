"""节点音频 → 文字（两遍：先 VAD，再对空结果关 VAD 重试）。
用法: python transcribe.py <model_dir> <audio_dir> <out_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import av

model_dir, audio_dir, out_dir = map(Path, sys.argv[1:4])
out_dir.mkdir(parents=True, exist_ok=True)

from faster_whisper import WhisperModel


def decode(path, sr=16000):
    """自己用 PyAV 解码：faster-whisper 内置路径在 av 19 上会因 metadata_errors 参数报错。"""
    container = av.open(str(path))
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="flt", layout="mono", rate=sr)
    chunks = []
    for frame in container.decode(stream):
        for f in resampler.resample(frame):
            chunks.append(f.to_ndarray().reshape(-1))
    for f in resampler.resample(None):
        chunks.append(f.to_ndarray().reshape(-1))
    container.close()
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, dtype=np.float32)


def run(model, audio, vad):
    segs, _ = model.transcribe(audio, language="zh", vad_filter=vad, beam_size=5,
                               no_speech_threshold=0.9, condition_on_previous_text=False,
                               initial_prompt="以下是普通话内容，请用简体中文转写。")
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
    return out, "".join(s["text"] for s in out).strip()


print(json.dumps({"stage": "loading_model"}), flush=True)
model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", local_files_only=True)

files = sorted(audio_dir.glob("*.m4s"))
print(json.dumps({"stage": "start", "files": len(files)}), flush=True)
summary = []
for i, f in enumerate(files, 1):
    out = out_dir / (f.stem + ".json")
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf8"))
            summary.append({"cid": f.stem, "state": "cached", "chars": len(old.get("text", ""))})
            continue
        except Exception:
            pass
    try:
        audio = decode(f)
        dur = round(len(audio) / 16000, 2)
        segs, text = run(model, audio, True)
        if not text:
            segs2, text2 = run(model, audio, False)
            if text2:
                segs, text, second = segs2, text2, True
            else:
                second = False
        else:
            second = False
        out.write_text(json.dumps({"cid": f.stem, "duration": dur, "segments": segs, "text": text,
                                   "pass2": second}, ensure_ascii=False, indent=1), encoding="utf8")
        summary.append({"cid": f.stem, "state": "ok", "duration": dur, "chars": len(text)})
        print(json.dumps({"stage": "done", "i": i, "n": len(files), "cid": f.stem, "dur": dur, "chars": len(text)},
                         ensure_ascii=False), flush=True)
    except Exception as exc:
        summary.append({"cid": f.stem, "state": "error", "error": type(exc).__name__ + ": " + str(exc)[:160]})
        print(json.dumps({"stage": "error", "cid": f.stem, "error": str(exc)[:160]}, ensure_ascii=False), flush=True)

(out_dir.parent / "transcripts-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf8")
ok = [s for s in summary if s["state"] in ("ok", "cached")]
print(json.dumps({"stage": "finished", "ok": len(ok), "total": len(summary),
                  "chars": sum(s.get("chars", 0) for s in ok),
                  "audio_seconds": round(sum(s.get("duration", 0) for s in ok), 1)}), flush=True)
