"""Crawl m3u8 (giải mã Shield v3) cho TẤT CẢ các bộ chỉ mới có gdrive.

Quét Firebase: bộ nào có drive_id mà chưa có m3u8 (field 'file') thì crawl
toàn bộ số tập bằng `avs_m3u8.py crawl <id> 0` (merge field — giữ drive_id).
Chạy --workers tiến trình song song (mặc định 4) cho nhanh: mỗi lần crawl
là 1 tiến trình con với profile Chrome riêng (copy từ profile chính đang
ấm cf_clearance) qua biến AVS_M3U8_PROFILE — cùng một profile thì kẹt lock.

    cd anime/scripts
    uv run python crawl_m3u8_missing.py                # 4 tiến trình song song
    uv run python crawl_m3u8_missing.py --workers 6
    uv run python crawl_m3u8_missing.py --dry-run      # chỉ liệt kê, không crawl

Log chi tiết từng bộ: /tmp/crawl-m3u8/<id>.log
Tổng kết: scripts/crawl_m3u8_missing_<YYYY-MM-DD>.log
"""

import os
import queue
import shutil
import subprocess
import sys
import datetime as dt
import concurrent.futures

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

MASTER_PROFILE = "/tmp/nd-avs-m3u8"
LOG_DIR = "/tmp/crawl-m3u8"

_LOG_LINES = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    _LOG_LINES.append(msg)


def _write_log():
    fn = os.path.join(
        SCRIPT_DIR, f"crawl_m3u8_missing_{dt.date.today():%Y-%m-%d}.log")
    try:
        with open(fn, "a") as f:
            f.write("\n".join(_LOG_LINES) + "\n")
        print(f"\n(log -> {fn})", flush=True)
    except Exception:
        pass


def pick_missing():
    """[(anime_id, name, n_drive)] các bộ có drive_id, chưa có m3u8 nào."""
    from avs_extract import read_all_sheet_rows
    from fire import db

    names = {}
    for r in read_all_sheet_rows():
        if "animevietsub" in str(r.get("url") or ""):
            names[str(r.get("id"))] = r.get("name") or "?"
    root = db.reference("anime").get() or {}
    out = []
    for aid, node in root.items():
        if isinstance(node, list):
            node = {i: v for i, v in enumerate(node)}
        if not isinstance(node, dict):
            continue
        eps = [v for v in node.values() if isinstance(v, dict)]
        n_drive = sum(1 for v in eps if v.get("drive_id"))
        n_file = sum(1 for v in eps if v.get("file"))
        if n_drive and not n_file and str(aid) in names:
            out.append((str(aid), names[str(aid)], n_drive))
    out.sort(key=lambda x: x[2])  # ngắn trước
    return out


def make_profiles(workers):
    """Copy profile chính (đang ấm cf_clearance) ra profile riêng mỗi worker."""
    profiles = []
    for i in range(workers):
        p = f"/tmp/nd-avs-m3u8-w{i}"
        try:
            if os.path.isdir(MASTER_PROFILE):
                shutil.rmtree(p, ignore_errors=True)
                shutil.copytree(MASTER_PROFILE, p, symlinks=True)
        except Exception as e:
            log(f"  (copy profile {p} lỗi {e} — để Chrome tự tạo mới)")
        profiles.append(p)
    return profiles


def crawl_one(aid, profile):
    """Chạy 1 bộ = 1 tiến trình con avs_m3u8.py crawl; log ra /tmp."""
    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.path.join(LOG_DIR, f"{aid}.log")
    env = dict(os.environ, AVS_M3U8_PROFILE=profile)
    with open(log_path, "w") as f:
        return subprocess.run(
            [sys.executable, os.path.join(SCRIPT_DIR, "avs_m3u8.py"),
             "crawl", aid, "0"],
            cwd=SCRIPT_DIR, env=env, stdout=f, stderr=subprocess.STDOUT,
        ).returncode


def main(argv):
    workers = 4
    dry_run = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--workers":
            workers = int(argv[i + 1])
            i += 1
        elif a == "--dry-run":
            dry_run = True
        else:
            log(f"Bỏ qua tham số không hiểu: {a}")
        i += 1

    log(f"== crawl_m3u8_missing | {dt.datetime.now():%Y-%m-%d %H:%M:%S} | "
        f"workers={workers} dry_run={dry_run} ==")
    picked = pick_missing()
    log(f"\n{len(picked)} bộ chỉ có gdrive (chưa có m3u8):")
    for aid, name, nd in picked:
        log(f"  [{aid}] {name} ({nd} tập drive)")

    if dry_run:
        log("\n--dry-run: không crawl. Kết thúc.")
        _write_log()
        return

    profiles = make_profiles(workers)
    pool = queue.Queue()
    for p in profiles:
        pool.put(p)

    def task(args):
        aid, name, nd = args
        prof = pool.get()
        try:
            log(f"\n[{aid}] START {name} ({nd} tập)...")
            code = crawl_one(aid, prof)
            log(f"[{aid}] DONE exit={code}")
            return code
        finally:
            pool.put(prof)

    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        codes = list(ex.map(task, picked))
    ok = sum(1 for c in codes if c == 0)
    log(f"\n== XONG | OK {ok} / {len(codes)} ==")
    _write_log()


if __name__ == "__main__":
    main(sys.argv[1:])
