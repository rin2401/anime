"""Crawl link Drive cho TẤT CẢ anime đang releasing (đang chiếu) trong năm nay.

Pipeline:
  1. Đọc Google Sheet -> các dòng có URL animevietsub + anilist_id.
  2. Hỏi AniList trạng thái từng anime, giữ lại status == RELEASING
     (mặc định) hoặc thêm cả anime startDate.year == năm nay (--this-year).
  3. Với mỗi anime, gọi avs_extract.crawl_drive() -> push drive_id mới lên Firebase.

CHẠY TRÊN MÁY MAC (cần Chrome thật để qua Cloudflare). Mở Chrome debug trước:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        --remote-debugging-port=9222 --user-data-dir=/tmp/avs-chrome
    # đăng nhập animevietsub trong cửa sổ Chrome đó (qua Cloudflare 1 lần)

Rồi:

    cd anime/scripts
    AVS_DEBUG_PORT=9222 uv run python crawl_releasing.py            # 100 tập mới nhất / anime
    AVS_DEBUG_PORT=9222 uv run python crawl_releasing.py --num 0    # tất cả các tập
    AVS_DEBUG_PORT=9222 uv run python crawl_releasing.py --this-year
    AVS_DEBUG_PORT=9222 uv run python crawl_releasing.py --dry-run  # chỉ liệt kê, không crawl

Ghi log ra: scripts/crawl_releasing_<YYYY-MM-DD>.log
"""

import os
import sys
import time
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests

from avs_extract import (
    crawl_drive,
    read_sheet_row,  # noqa: F401  (giữ để rõ nguồn gốc auth pattern)
    SHEET_KEY,
    WORKSHEET_ID,
    DEFAULT_NUM_EPS,
)

ANILIST_URL = "https://graphql.anilist.co"
THIS_YEAR = dt.date.today().year

_LOG_LINES = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    _LOG_LINES.append(msg)


# ───────────────────────────── Google Sheet ──────────────────────────────────
def read_all_rows():
    """Đọc toàn bộ dòng của worksheet (1 lần auth)."""
    import gspread

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    keyfile = "keys.json" if os.path.exists("keys.json") else "r3fire.json"

    # Ưu tiên oauth2client (đúng pattern repo); nếu môi trường lỗi pyOpenSSL thì
    # fallback sang google-auth.
    try:
        from oauth2client.service_account import ServiceAccountCredentials

        creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
    except Exception:
        from google.oauth2.service_account import Credentials

        creds = Credentials.from_service_account_file(keyfile, scopes=scope)

    client = gspread.authorize(creds)
    sheet = client.open_by_key(SHEET_KEY).get_worksheet_by_id(WORKSHEET_ID)
    return sheet.get_all_records()


# ───────────────────────────────── AniList ───────────────────────────────────
def anilist_statuses(anilist_ids):
    """Trả {anilist_id: {'status':..., 'year':...}} cho danh sách id (batch 50)."""
    out = {}
    q = """
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id
          status
          startDate { year }
        }
      }
    }
    """
    ids = sorted({int(i) for i in anilist_ids})
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        for attempt in range(4):
            r = requests.post(ANILIST_URL, json={"query": q, "variables": {"ids": chunk}})
            if r.status_code == 429:  # rate limit
                wait = int(r.headers.get("Retry-After", 5))
                log(f"  AniList 429, chờ {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            for m in r.json().get("data", {}).get("Page", {}).get("media", []):
                out[m["id"]] = {
                    "status": m.get("status"),
                    "year": (m.get("startDate") or {}).get("year"),
                }
            break
        time.sleep(1)  # lịch sự với AniList
    return out


# ─────────────────────────────── Lọc danh sách ───────────────────────────────
def pick_releasing(rows, include_this_year=False):
    """Trả list (sheet_id, name, anilist_id, status) các anime cần crawl."""
    candidates = []
    for row in rows:
        url = str(row.get("url") or "")
        if "animevietsub" not in url:
            continue
        aid = row.get("anilist_id") or row.get("id")
        if not str(aid).strip().isdigit():
            continue
        candidates.append((row, int(aid)))

    log(f"Ứng viên (có url animevietsub + anilist_id): {len(candidates)}")
    statuses = anilist_statuses([aid for _, aid in candidates])

    picked = []
    for row, aid in candidates:
        info = statuses.get(aid)
        if not info:
            continue
        status = info["status"]
        year = info["year"]
        keep = status == "RELEASING"
        if include_this_year and year == THIS_YEAR:
            keep = True
        if keep:
            picked.append(
                {
                    "sheet_id": str(row.get("id")),
                    "name": row.get("name"),
                    "anilist_id": aid,
                    "status": status,
                    "year": year,
                }
            )
    return picked


# ───────────────────────────────── Main ──────────────────────────────────────
def main(argv):
    num_eps = DEFAULT_NUM_EPS
    include_this_year = False
    dry_run = False

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--num":
            num_eps = int(argv[i + 1])
            i += 1
        elif a == "--this-year":
            include_this_year = True
        elif a == "--dry-run":
            dry_run = True
        else:
            log(f"Bỏ qua tham số không hiểu: {a}")
        i += 1

    if not os.environ.get("AVS_DEBUG_PORT") and not dry_run:
        log(
            "CẢNH BÁO: chưa set AVS_DEBUG_PORT — sẽ mở Chrome mới và rất dễ kẹt "
            "Cloudflare. Nên mở Chrome debug và set AVS_DEBUG_PORT=9222.\n"
        )

    log(f"== crawl_releasing | {dt.datetime.now():%Y-%m-%d %H:%M:%S} | "
        f"num_eps={num_eps} this_year={include_this_year} dry_run={dry_run} ==")

    rows = read_all_rows()
    log(f"Tổng dòng trong Sheet: {len(rows)}")

    picked = pick_releasing(rows, include_this_year=include_this_year)
    log(f"\n>>> {len(picked)} anime đang releasing{f' / năm {THIS_YEAR}' if include_this_year else ''}:")
    for p in picked:
        log(f"  - [{p['sheet_id']}] {p['name']}  (status={p['status']}, year={p['year']})")

    if dry_run:
        log("\n--dry-run: không crawl. Kết thúc.")
        _write_log()
        return

    log("")
    ok = err = 0
    for p in picked:
        log(f"\n===== CRAWL [{p['sheet_id']}] {p['name']} =====")
        try:
            crawl_drive(p["sheet_id"], num_eps)
            ok += 1
        except Exception as e:
            err += 1
            log(f"  !! LỖI {p['sheet_id']}: {e}")

    log(f"\n== XONG | anime OK={ok} lỗi={err} / tổng {len(picked)} ==")
    _write_log()


def _write_log():
    fn = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        f"crawl_releasing_{dt.date.today():%Y-%m-%d}.log",
    )
    try:
        with open(fn, "a") as f:
            f.write("\n".join(_LOG_LINES) + "\n")
        print(f"\n(log -> {fn})", flush=True)
    except Exception:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
