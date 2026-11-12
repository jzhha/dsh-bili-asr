"""从（可部分下载的）fMP4 里抓一帧存成 JPEG。

用法: python frames.py <video.m4s> <out.jpg> [at_seconds] [--no-avoid-dark]
- at_seconds：期望的时间点（默认 1.0 秒）
- 默认会避开暗帧：从 at 开始往后找第一帧亮度足够的画面；找不到就取这一路里最亮的一帧
退出码: 0 成功 / 3 没有可解码的帧 / 4 依赖缺失
"""
import sys

try:
    import av
    from PIL import ImageStat
except Exception as exc:  # noqa: BLE001
    print('missing dependency: ' + str(exc))
    sys.exit(4)

src = sys.argv[1]
dst = sys.argv[2]
at = float(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith('--') else 1.0
avoid_dark = '--no-avoid-dark' not in sys.argv

MIN_LUM = 18.0       # 0~255，低于这个算“黑/近黑”
SCAN_WINDOW = 20.0   # 从 at 往后最多看 20 秒
MAX_FRAMES = 900     # 防止异常长视频把 CPU 吃满

try:
    with av.open(src) as container:
        stream = container.streams.video[0]
        chosen = None
        chosen_t = 0.0
        chosen_lum = -1.0
        best = None
        best_t = 0.0
        best_lum = -1.0

        for idx, frame in enumerate(container.decode(stream)):
            if idx > MAX_FRAMES:
                break
            t = float(frame.pts * stream.time_base) if frame.pts is not None else 0.0
            img = frame.to_image()
            lum = float(ImageStat.Stat(img.convert('L')).mean[0])

            if lum > best_lum:
                best, best_t, best_lum = img, t, lum

            if t >= at:
                if not avoid_dark:
                    chosen, chosen_t, chosen_lum = img, t, lum
                    break
                if lum >= MIN_LUM:
                    chosen, chosen_t, chosen_lum = img, t, lum
                    break

            if t > at + SCAN_WINDOW:
                break

        if chosen is None:
            if best is None:
                print('no frame decoded')
                sys.exit(3)
            chosen, chosen_t, chosen_lum = best, best_t, best_lum
            fallback = True
        else:
            fallback = False

        chosen.save(dst, 'JPEG', quality=82)
        print(f'ok {chosen.width}x{chosen.height} t={chosen_t:.2f} lum={chosen_lum:.1f} fallback={fallback}')
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001
    print('decode failed: ' + type(exc).__name__ + ': ' + str(exc)[:160])
    sys.exit(3)
