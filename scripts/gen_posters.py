"""Pre-generate same-origin square posters for MediaSession artwork.

Đọc Sheet published (gviz — cùng nguồn trang player đọc), tải cover từng
dòng, crop vuông 512x512 neo TRÊN (cùng toán học canvasSquare trong
artplayer/index.html) rồi ghi image/posters/<id>.jpg. Player ưu tiên
file same-origin này làm entry artwork đầu — media daemon iOS luôn fetch
được same-origin (Photon / CORS / data: URL đều từng gây ô xám lock
screen). Chạy lại khi thêm/sửa dòng Sheet (file có sẵn được bỏ qua,
--fresh để sinh lại toàn bộ).
"""

import io
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import requests
from PIL import Image

SHEET_ID = '12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA'
SHEET_GID = '1193967919'
GVIZ = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&tq&gid={SHEET_GID}'
# Repo-root relative, bất kể cwd: <repo>/image/posters
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'image', 'posters')
TARGET = 512
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
FRESH = '--fresh' in sys.argv


def safe_name(row):
    # Tên file theo DÒNG, không theo id: các mùa live-action cùng id IMDb
    # nhưng ảnh khác nhau — phân biệt bằng slug kkphim (mỗi mùa 1 dòng).
    # Frontend đặt tên y hệt: String(phimapi || id).replace(/[^A-Za-z0-9._-]/g, '_')
    return re.sub(r'[^A-Za-z0-9._-]', '_', str(row['phimapi'] or row['id']))


def fetch_rows():
    txt = requests.get(GVIZ, timeout=30).text
    data = json.loads(txt[txt.index('"table":') + 8:txt.rindex('});')])
    cols = [c['label'] for c in data['cols']]
    rows = []
    for r in data['rows']:
        row = {}
        for i, col in enumerate(cols):
            cel = r['c'][i] if r['c'] and i < len(r['c']) else None
            row[col] = (cel.get('f') or cel.get('v') or '') if cel else ''
        rows.append(row)
    return rows


def crop_square(src, dst):
    res = requests.get(src, headers=UA, timeout=30)
    res.raise_for_status()
    import io
    img = Image.open(io.BytesIO(res.content)).convert('RGB')
    w, h = img.size
    s = max(TARGET / w, TARGET / h) or 1
    nw = max(TARGET, round(w * s))
    nh = max(TARGET, round(h * s))
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - TARGET) // 2  # giữa ngang, neo TRÊN (dy=0) như canvasSquare
    img = img.crop((left, 0, left + TARGET, TARGET))
    img.save(dst, 'JPEG', quality=80, optimize=True)


def job(row):
    rid = safe_name(row)
    dst = f'{OUT_DIR}/{rid}.jpg'
    if not FRESH and __import__('os').path.exists(dst):
        return ('skip', rid, '')
    try:
        crop_square(row['image'], dst)
        return ('ok', rid, '')
    except Exception as e:
        return ('fail', rid, f"{row['image'][:60]} -> {e}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = [r for r in fetch_rows() if r['id'] and str(r['image']).startswith('http')]
    # Dedupe theo tên file, giữ dòng CUỐI — khớp seasonSelector (last match wins)
    by_name = {}
    for r in rows:
        by_name[safe_name(r)] = r
    rows = list(by_name.values())
    print(f'{len(rows)} rows co id + image')
    results = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(job, rows):
            results.append(res)
            if res[0] == 'fail':
                print('FAIL', res[1], res[2])
    ok = sum(1 for r in results if r[0] == 'ok')
    skip = sum(1 for r in results if r[0] == 'skip')
    fail = sum(1 for r in results if r[0] == 'fail')
    print(f'ok={ok} skip={skip} fail={fail}')
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
