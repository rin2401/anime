import os
import re
import sys
import json
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)


def make_driver():
    """Attach vào Chrome thật nếu có AVS_DEBUG_PORT, ngược lại mở Chrome mới."""
    opts = Options()
    port = os.environ.get("AVS_DEBUG_PORT")
    if port:
        opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{port}")
        driver = webdriver.Chrome(options=opts)
    else:
        for a in [
            "--disable-gpu",
            "--no-sandbox",
            "--window-size=1280,900",
            "--autoplay-policy=no-user-gesture-required",
            "--user-data-dir=/tmp/cf-chrome-profile",
        ]:
            opts.add_argument(a)
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_argument(f"user-agent={UA}")
        driver = webdriver.Chrome(options=opts)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"},
    )
    return driver


def wait_cloudflare(driver, timeout=45):
    for _ in range(timeout):
        t = (driver.title or "").lower()
        if t and "moment" not in t and "attention" not in t and "verif" not in t:
            return True
        time.sleep(1)
    return False


def active_episode(driver):
    return driver.execute_script(
        "var el=document.querySelector('a.episode-link.active')"
        "||document.querySelector('a[data-hash]');"
        "return el?Object.assign({},el.dataset):null;"
    )


def ajax_player(driver, ep, play):
    """Gọi /ajax/player từ context trang (dùng cookie Cloudflare của trang)."""
    raw = driver.execute_async_script(
        r"""
        const ep=arguments[0], play=arguments[1], cb=arguments[arguments.length-1];
        fetch('/ajax/player?v=2019a',{method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
          body:new URLSearchParams({link:ep.hash,id:ep.id,play:play,backuplinks:'1'}).toString(),
          credentials:'include'}).then(r=>r.text()).then(cb).catch(e=>cb('ERR:'+e));
        """,
        ep,
        play,
    )
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw}


def get_drive_link(driver, watch_url):
    """Trả về (drive_url, drive_id, title, ep, player_url)."""
    driver.get(watch_url)
    if not wait_cloudflare(driver):
        raise RuntimeError("Không qua được Cloudflare của animevietsub (title=%r)" % driver.title)
    title = driver.title
    ep = active_episode(driver)
    if not ep:
        raise RuntimeError("Không tìm thấy episode (data-hash) trên trang")

    embed = ajax_player(driver, ep, "embed")
    api = ajax_player(driver, ep, "api")

    drive_url = embed.get("link", "") if isinstance(embed, dict) else ""
    m = re.search(r"/d/([A-Za-z0-9_-]+)", drive_url) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", drive_url)
    drive_id = m.group(1) if m else None
    player_url = api.get("link", "") if isinstance(api, dict) else ""

    return {
        "title": title,
        "ep": ep,
        "drive_url": drive_url,
        "drive_id": drive_id,
        "player_url": player_url,
    }


# ───────────────────────── Batch: sheet → drive links → Firebase ──────────────
# Đọc 1 dòng Google Sheet theo id → URL series animevietsub → crawl link Drive
# của tất cả các tập → push lên Firebase /anime/{id}/{ep}/drive_id.
# Chỉ cần animevietsub.pl (không đụng googleapiscdn) nên make_driver() mặc định
# là đủ, không cần attach Chrome thật.

SHEET_KEY = "12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA"
WORKSHEET_ID = 1193967919


def read_sheet_row(sheet_id):
    """Tìm dòng có id (hoặc playlist) khớp sheet_id; trả {url, name} hoặc None."""
    import gspread
    from oauth2client.service_account import ServiceAccountCredentials

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    # Dùng keys.json nếu có; nếu không, dùng chung service account r3fire.json
    # (sheet phải được share cho r3fire@appspot.gserviceaccount.com).
    keyfile = "keys.json" if os.path.exists("keys.json") else "r3fire.json"
    creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SHEET_KEY).get_worksheet_by_id(WORKSHEET_ID)

    sheet_id = str(sheet_id)
    for row in sheet.get_all_records():
        if str(row.get("id")) == sheet_id or str(row.get("playlist")) == sheet_id:
            if not row.get("url"):
                return None
            return {"url": row["url"], "name": row.get("name")}
    return None


def parse_ep(href):
    """tap-001-36.html -> (1, '36'); tap-special6-105606.html -> ('special6', '105606').

    Trả (None, None) nếu href không đúng dạng (tránh ValueError làm hỏng cả lần crawl).
    """
    parts = href.rsplit(".", 1)[0].split("-")
    if len(parts) < 2:
        return None, None
    ep, vid = parts[-2], parts[-1]
    if ep.isnumeric():
        ep = int(ep)
    return ep, vid


def list_episodes(driver):
    """Trên trang series: trả list {ep, hash, id, title} cho từng tập (dedup theo ep)."""
    WebDriverWait(driver, 20).until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, "li.episode"))
    )
    raw = driver.execute_script(
        r"""
        return [...document.querySelectorAll('li.episode a[data-hash]')].map(a => ({
            href: a.getAttribute('href'),
            hash: a.dataset.hash,
            id: a.dataset.id,
            title: (a.textContent || '').trim()
        }));
        """
    )
    eps, seen = [], set()
    for x in raw:
        if not x.get("href") or not x.get("hash"):
            continue
        ep, _ = parse_ep(x["href"])
        if ep is None or ep in seen:
            continue
        seen.add(ep)
        eps.append({"ep": ep, "hash": x["hash"], "id": x["id"], "title": x["title"]})
    return eps


def drive_id_from_link(link):
    if not link:
        return None
    m = re.search(r"/d/([A-Za-z0-9_-]+)", link) or re.search(r"[?&]id=([A-Za-z0-9_-]+)", link)
    return m.group(1) if m else None


def existing_drive_eps(db, anime_id):
    """Trả về set các ep (dạng str) đã có drive_id trên Firebase anime/{anime_id}."""
    data = db.reference(f"anime/{anime_id}").get() or {}
    if isinstance(data, list):
        data = {i: v for i, v in enumerate(data)}
    done = set()
    for k, v in (data.items() if isinstance(data, dict) else []):
        if isinstance(v, dict) and v.get("drive_id"):
            done.add(str(k))
    return done


def ep_sort_key(x):
    """Sort key cho 'tập mới nhất trước': số tập lớn nhất trước, special để cuối."""
    return (1, x["ep"]) if isinstance(x["ep"], int) else (0, 0)


def crawl_drive(anime_id):
    """Crawl link Drive cho 1 anime -> Firebase anime/{anime_id}/{ep}/{drive_id,title}.

    Chỉ truyền anime_id (id Google Sheet, cũng là key Firebase). Tự đọc Firebase để
    biết tập nào đã có drive_id rồi bỏ qua, crawl các tập còn lại theo thứ tự
    TẬP MỚI NHẤT TRƯỚC, push ngay sau mỗi tập (an toàn nếu gián đoạn).
    """
    from fire import db

    anime_id = str(anime_id)

    row = read_sheet_row(anime_id)
    if not row:
        print(f"Không tìm thấy dòng có url cho id={anime_id} trong sheet.")
        return
    if "animevietsub" not in (row["url"] or ""):
        print(f"URL không phải animevietsub: {row['url']}")
        return

    name = row.get("name")
    done = existing_drive_eps(db, anime_id)
    print("Anime id   :", anime_id)
    print("Name       :", name)
    print("Đã có sẵn  :", len(done), "tập có drive_id")

    driver = make_driver()
    try:
        driver.get(row["url"])
        if not wait_cloudflare(driver):
            raise RuntimeError("Không qua được Cloudflare (title=%r)" % driver.title)

        eps = list_episodes(driver)
        todo = [x for x in eps if str(x["ep"]) not in done]
        todo.sort(key=ep_sort_key, reverse=True)  # tập mới nhất trước
        print(f"\n{len(eps)} tập trên web | đã có {len(done)} | "
              f"crawl {len(todo)} tập (mới nhất trước)...\n")

        ok = fail = 0
        for x in todo:
            res = ajax_player(driver, {"hash": x["hash"], "id": x["id"]}, "embed")
            link = res.get("link", "") if isinstance(res, dict) else ""
            drive_id = drive_id_from_link(link)
            if drive_id:
                update = {f"anime/{anime_id}/{x['ep']}/drive_id": drive_id}
                if name:
                    title = f"{name} - {x['ep']}"
                    update[f"anime/{anime_id}/{x['ep']}/title"] = title
                db.reference().update(update)  # push ngay từng tập
                ok += 1
                print(f"  [OK]   tập {x['ep']}: {drive_id}" + (f"  | {title}" if name else ""))
            else:
                fail += 1
                tech = res.get("playTech") if isinstance(res, dict) else None
                print(f"  [MISS] tập {x['ep']}: không ra Drive (playTech={tech})")

        print(f"\nTổng kết: crawl {len(todo)} | OK {ok} | miss {fail} | đã có trước {len(done)}")
    finally:
        if not os.environ.get("AVS_DEBUG_PORT"):
            driver.quit()


if __name__ == "__main__":
    crawl_drive(sys.argv[1])
