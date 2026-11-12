"""从（可部分下载的）fMP4 里抓一帧存成 JPEG。

用法: python frames.py <video.m4s> <out.jpg> [at_seconds]
退出码: 0 成功 / 3 没有可解码的帧 / 4 依赖缺失
"""
import sys

try:
    import av
except Exception as exc:  # noqa: BLE001
    print('missing av: ' + str(exc))
    sys.exit(4)

src = sys.argv[1]
dst = sys.argv[2]
at = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

try:
    with av.open(src) as container:
        stream = container.streams.video[0]
        best = None
        for frame in container.decode(stream):
            t = float(frame.pts * stream.time_base) if frame.pts is not None else 0.0
            best = frame
            if t >= at:
                break
        if best is None:
            print('no frame decoded')
            sys.exit(3)
        img = best.to_image()          # 需要 Pillow
        img.save(dst, 'JPEG', quality=82)
        print(f'ok {img.width}x{img.height} t={at}')
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001
    print('decode failed: ' + type(exc).__name__ + ': ' + str(exc)[:160])
    sys.exit(3)
