"""Xoá field `file` của các tập có manifest seg-key (AES-128) mà node chưa lưu
`key` -> chạy lại `avs_m3u8.py crawl <id>` (bản mới tự fetch + lưu key) để
phục hồi phát trên artplayer.

Dùng khi: AVS thêm content key AES-128 (seg-key) mà node m3u8 crawl trước đó
thiếu field `key` — artplayer không thay được URI seg-key (token chỉ sống ~2h,
host googleapiscdn chặn CORS) nên hls.js không lấy được key, player đứng hình.

Chạy từ scripts/:
    uv run python fix_segkey.py <animeId> [animeId...]      # chỉ liệt kê
    uv run python fix_segkey.py <animeId> --apply           # xoá field file
Rồi crawl lại từng bộ:
    uv run python avs_m3u8.py crawl <animeId>
"""

import os
import sys
import re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fire import db  # noqa: E402
from avs_m3u8 import _SEG_KEY_RE  # noqa: E402


def fb_keys(data):
    """anime/{id} có thể là dict hoặc list (key số liên tiếp) — trả [(key, node)]."""
    if isinstance(data, list):
        return [(str(i), v) for i, v in enumerate(data) if v]
    return [(k, v) for k, v in (data or {}).items() if v]


def main(argv):
    apply = "--apply" in argv
    ids = [a for a in argv if not a.startswith("--")]

    for aid in ids:
        anime = db.reference(f"anime/{aid}").get() or {}
        print(f"== anime {aid}: {len(fb_keys(anime))} tập ==")
        n_del = 0
        for key, ep in fb_keys(anime):
            if not isinstance(ep, dict) or not ep.get("file"):
                continue
            ep_id = str(ep.get("file")).rsplit("/", 1)[-1].replace(".json", "")
            node = db.reference(f"animevietsub/{ep_id}").get()
            text = node.get("m3u8") if isinstance(node, dict) else node
            if not isinstance(text, str) or not _SEG_KEY_RE.search(text):
                continue
            if isinstance(node, dict) and node.get("key"):
                continue  # đã có key — artplayer tự thay URI
            print(f"  thiếu key: ep={ep.get('id')} (key node '{key}', file node "
                  f"animevietsub/{ep_id})")
            if apply:
                # xoá đúng field `file` (merge null = xoá 1 field, giữ drive_id)
                db.reference(f"anime/{aid}/{key}").update({"file": None})
                n_del += 1
        print(f"  -> xoá {n_del} field file" if apply else
              f"  -> (dry-run, chạy lại với --apply để xoá field file)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
