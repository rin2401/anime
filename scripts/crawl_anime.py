"""Crawl link Drive cho 1 anime theo AniList ID — end-to-end.

    cd anime/scripts
    uv run python crawl_anime.py <anilist_id>              # crawl 100 tập mới nhất
    uv run python crawl_anime.py <anilist_id> --num 0      # tất cả các tập
    uv run python crawl_anime.py <anilist_id> --dry-run    # chỉ xem kế hoạch, không ghi/crawl
    uv run python crawl_anime.py <anilist_id> --url <URL>  # ép URL animevietsub (bỏ qua search)
    uv run python crawl_anime.py <anilist_id> --pick N     # chọn kết quả tìm kiếm thứ N
    uv run python crawl_anime.py <anilist_id> --search "…" # đổi từ khoá tìm kiếm

Luồng:
  1. Tìm dòng Sheet có cột `id` HOẶC `anilist_id` == <anilist_id>.
     Nếu CHƯA có dòng -> tra AniList lấy tên/ảnh/category/năm/status rồi TỰ TẠO dòng mới
     (id = anilist_id, gdrive = id). Chỉ báo lỗi (exit 3) nếu AniList không trả tên.
  2. Nếu dòng đã có url animevietsub  -> crawl luôn.
  3. Nếu chưa                          -> search animevietsub theo tên (row.name / AniList),
     tự khớp tên; nếu không rõ thì IN danh sách + thoát code 2 để chọn --pick.
     Chọn xong -> ghi url vào Sheet -> crawl.

crawl_drive dùng cột `id` làm KEY (Firebase + tra Sheet). Theo quy ước id == AniList ID;
nếu khác, script dùng đúng `id` của dòng và cảnh báo.

Cần Chrome thật để qua Cloudflare (make_driver mặc định dùng profile /tmp/cf-chrome-profile).

Exit codes: 0 ok | 2 cần chọn (--pick) | 3 AniList không trả tên (không tạo được dòng)
            | 4 không có tên để search | 5 search rỗng | 6 --pick ngoài phạm vi.
"""

import os
import re
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests

from avs_extract import (
    crawl_drive,
    SHEET_KEY,
    WORKSHEET_ID,
    DEFAULT_NUM_EPS,
)
from avs_search import search as avs_search

ANILIST_URL = "https://graphql.anilist.co"


def _open_ws():
    import gspread
    from oauth2client.service_account import ServiceAccountCredentials

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    keyfile = "keys.json" if os.path.exists("keys.json") else "r3fire.json"
    creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
    client = gspread.authorize(creds)
    return client.open_by_key(SHEET_KEY).get_worksheet_by_id(WORKSHEET_ID)


def find_row(ws, aid):
    """Trả (row_index_1based | None, dict_row | None, header, url_col_1based)."""
    vals = ws.get_all_values()
    header = vals[0]
    url_col = header.index("url") + 1 if "url" in header else None
    id_c = header.index("id") if "id" in header else -1
    al_c = header.index("anilist_id") if "anilist_id" in header else -1
    aid = str(aid).strip()
    for i, r in enumerate(vals[1:], start=2):  # dòng 1 là header (1-based)
        rid = r[id_c].strip() if id_c >= 0 and id_c < len(r) else ""
        ral = r[al_c].strip() if al_c >= 0 and al_c < len(r) else ""
        if rid == aid or ral == aid:
            return i, dict(zip(header, r)), header, url_col
    return None, None, header, url_col


# AniList format -> nhãn cột `category` trong Sheet (theo dòng sẵn có: "TV Show"/"Movie").
FORMAT_CATEGORY = {
    "TV": "TV Show", "TV_SHORT": "TV Show", "MOVIE": "Movie",
    "OVA": "OVA", "ONA": "ONA", "SPECIAL": "Special", "MUSIC": "Music",
}
# AniList status -> nhãn cột `status` (Sheet dùng "INCOMING" cho chưa phát sóng).
STATUS_LABEL = {
    "RELEASING": "RELEASING", "FINISHED": "FINISHED",
    "NOT_YET_RELEASED": "INCOMING", "CANCELLED": "CANCELLED", "HIATUS": "HIATUS",
}


def anilist_media(aid):
    """Trả dict Media của AniList (title/coverImage/format/status/startDate) hoặc None."""
    q = """query($id:Int){Media(id:$id,type:ANIME){
        title{romaji english}
        coverImage{extraLarge large}
        format status episodes
        startDate{year}
    }}"""
    try:
        r = requests.post(
            ANILIST_URL, json={"query": q, "variables": {"id": int(aid)}}, timeout=20
        )
        return r.json()["data"]["Media"]
    except Exception:
        return None


def _title_of(media):
    t = (media or {}).get("title") or {}
    return t.get("romaji") or t.get("english")


def anilist_title(aid):
    return _title_of(anilist_media(aid))


def build_row_dict(header, aid, media):
    """Dựng dict dòng Sheet mới từ AniList media (khớp thứ tự header)."""
    vals = {
        "id": aid,
        "anilist_id": aid,
        "name": _title_of(media) or "",
        "image": (media.get("coverImage") or {}).get("extraLarge")
        or (media.get("coverImage") or {}).get("large") or "",
        "category": FORMAT_CATEGORY.get(media.get("format") or "", media.get("format") or ""),
        "year": str((media.get("startDate") or {}).get("year") or ""),
        "status": STATUS_LABEL.get(media.get("status") or "", media.get("status") or ""),
        "gdrive": aid,  # để card trang chủ /anime/gdrive/?id= trỏ đúng
    }
    return {col: vals.get(col, "") for col in header}


def append_sheet_row(ws, header, row_dict):
    """Append dòng mới vào cuối bảng, trả row index (1-based) hoặc None."""
    row_values = [row_dict.get(col, "") for col in header]
    resp = ws.append_row(row_values, value_input_option="USER_ENTERED", table_range="A1")
    rng = (resp.get("updates") or {}).get("updatedRange", "")
    m = re.search(r"!\D+(\d+)", rng)
    return int(m.group(1)) if m else None


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def main():
    ap = argparse.ArgumentParser(description="Crawl Drive cho 1 anime theo AniList ID.")
    ap.add_argument("anilist_id")
    ap.add_argument("--num", type=int, default=DEFAULT_NUM_EPS,
                    help="số tập mới nhất crawl (0 = tất cả)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--url", help="ép URL animevietsub (series hoặc trang xem)")
    ap.add_argument("--pick", type=int, help="chọn kết quả tìm kiếm thứ N")
    ap.add_argument("--search", help="đổi từ khoá tìm kiếm")
    a = ap.parse_args()
    aid = str(a.anilist_id).strip()

    ws = _open_ws()
    row_i, row, header, url_col = find_row(ws, aid)
    if row_i is None:
        print(f"[SHEET] Chưa có dòng cho id/anilist_id == {aid}. Tra AniList để tạo dòng mới...")
        media = anilist_media(aid)
        if not _title_of(media):
            print(f"[ERR] AniList không trả tên cho id {aid} — không tạo được dòng tự động.")
            print("      -> Kiểm tra lại AniList ID, hoặc thêm dòng thủ công (điền id) rồi chạy lại.")
            sys.exit(3)
        row = build_row_dict(header, aid, media)
        print(f"[ANILIST] {row['name']!r} | category={row.get('category')} | "
              f"year={row.get('year')} | status={row.get('status')}")
        if a.dry_run:
            print("[DRY-RUN] sẽ tạo dòng mới với các giá trị trên (chưa ghi Sheet).")
        else:
            row_i = append_sheet_row(ws, header, row)
            print(f"[SHEET] đã tạo dòng {row_i} cho id={aid}.")

    name = row.get("name")
    sheet_id = str(row.get("id") or "").strip()
    if not sheet_id:
        print(f"[ERR] Dòng {row_i} khớp anilist_id nhưng cột `id` trống — cần điền `id`.")
        sys.exit(3)
    if sheet_id != aid:
        print(f"[WARN] AniList {aid} map sang Sheet id={sheet_id}; "
              f"sẽ crawl vào key Firebase '{sheet_id}'.")

    print(f"[SHEET] dòng {row_i} | id={sheet_id} | name={name!r}")
    print(f"[SHEET] url hiện tại: {row.get('url')!r}")

    # ── xác định URL animevietsub ────────────────────────────────────────────
    target_url = a.url
    if not target_url and "animevietsub" in (row.get("url") or ""):
        target_url = row["url"]
        print("[URL] dùng url sẵn có trong Sheet.")

    if not target_url:
        query = a.search or name or anilist_title(aid)
        if not query:
            print("[ERR] Không có tên để tìm kiếm (name trống, AniList không trả).")
            sys.exit(4)
        print(f"[SEARCH] animevietsub: {query!r}")
        results = avs_search(query)
        if not results:
            print("[ERR] Không có kết quả (hoặc Cloudflare chặn).")
            sys.exit(5)

        chosen = None
        if a.pick:
            if not (1 <= a.pick <= len(results)):
                print(f"[ERR] --pick {a.pick} ngoài phạm vi 1..{len(results)}.")
                sys.exit(6)
            chosen = results[a.pick - 1]
        else:
            nq = _norm(query)
            exact = [r for r in results if _norm(r["title"]) == nq]
            if len(exact) == 1:
                chosen = exact[0]
                print(f"[MATCH] tự khớp tên: {chosen['title']}")

        if not chosen:
            print("\n[CHỌN] Không tự khớp được — chạy lại với --pick N (hoặc --url):")
            for i, r in enumerate(results, 1):
                print(f"  [{i:2}] {r['title']}\n       {r['url']}")
            sys.exit(2)
        target_url = chosen["url"]

    print(f"[URL] chọn: {target_url}")

    if a.dry_run:
        print("[DRY-RUN] không ghi Sheet, không crawl. Kết thúc.")
        return

    # ── ghi url vào Sheet nếu khác ───────────────────────────────────────────
    if (row.get("url") or "") != target_url and url_col:
        ws.update_cell(row_i, url_col, target_url)
        print(f"[SHEET] đã ghi url vào dòng {row_i}, cột {url_col}.")

    # ── crawl (crawl_drive tự đọc lại Sheet + tự chuyển trang giới thiệu->xem) ─
    print(f"\n[CRAWL] key={sheet_id} num={a.num} ...\n")
    result = crawl_drive(sheet_id, a.num)

    # ── crawl xong & có tập trên Firebase -> set cột `gdrive` = key Firebase
    #    (chính là id/anilist_id của dòng) để card trang chủ /anime/gdrive/?id=
    #    trỏ đúng anime vừa crawl. ──────────────────────────────────────────────
    available = (result or {}).get("available", 0)
    gdrive_col = header.index("gdrive") + 1 if "gdrive" in header else None
    if available and gdrive_col and row_i:
        if (row.get("gdrive") or "").strip() != sheet_id:
            ws.update_cell(row_i, gdrive_col, sheet_id)
            print(f"[SHEET] đã set gdrive={sheet_id} ở dòng {row_i} "
                  f"(card trang chủ trỏ tới player).")
        else:
            print(f"[SHEET] gdrive đã đúng ({sheet_id}).")


if __name__ == "__main__":
    main()
