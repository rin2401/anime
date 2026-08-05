"""Tìm anime trên animevietsub theo tiêu đề, in danh sách kết quả để chọn.

    cd anime/scripts
    uv run python avs_search.py "Re:Zero"
    AVS_DEBUG_PORT=9222 uv run python avs_search.py "Re:Zero"   # dùng Chrome debug

In ra: <index>  <tên>  ->  <url series>
Copy url của bộ đúng để điền vào Sheet / crawl.
"""

import os
import sys
import time
import urllib.parse

from avs_extract import make_driver, wait_cloudflare, BASE  # BASE = domain hiện hành


def search(query):
    url = f"{BASE}/tim-kiem/{urllib.parse.quote(query)}/"
    driver = make_driver()
    try:
        driver.get(url)
        if not wait_cloudflare(driver):
            raise RuntimeError("Không qua được Cloudflare (title=%r)" % driver.title)
        time.sleep(1)
        items = driver.execute_script(
            r"""
            const out = [], seen = new Set();
            // Kết quả tìm kiếm animevietsub: mỗi phim là 1 .TPostMv / .TPost
            document.querySelectorAll('a[href*="/phim/"]').forEach(a => {
                const href = a.href.split('#')[0];
                if (!href.includes('/phim/')) return;
                if (seen.has(href)) return;
                // ưu tiên tiêu đề trong .Title, fallback textContent / title attr
                let box = a.closest('li,article,.TPostMv,.TPost') || a;
                let t = (box.querySelector('.Title, h2, h3') || a).textContent || a.title || '';
                t = t.replace(/\s+/g, ' ').trim();
                if (!t) return;
                seen.add(href);
                out.push({title: t, url: href});
            });
            return out;
            """
        )
        return items
    finally:
        if not os.environ.get("AVS_DEBUG_PORT"):
            driver.quit()


def main(argv):
    if not argv:
        print('Cách dùng: uv run python avs_search.py "tiêu đề"')
        return
    query = " ".join(argv)
    print(f"Tìm: {query!r} trên {BASE}\n")
    results = search(query)
    if not results:
        print("Không có kết quả (hoặc bị Cloudflare chặn).")
        return
    for i, r in enumerate(results, 1):
        print(f"[{i:2}] {r['title']}\n     {r['url']}")
    print(f"\n-> {len(results)} kết quả.")


if __name__ == "__main__":
    main(sys.argv[1:])
