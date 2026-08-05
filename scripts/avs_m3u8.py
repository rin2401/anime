"""Crawl nguồn streaming m3u8 của AnimeVietsub qua undetected-chromedriver.

AVS đã dồn player streaming vào storage.googleapiscdn.com đứng sau Cloudflare
(Selenium thường bị chặn). undetected-chromedriver (uc) vượt được CF nên lấy được
m3u8 từ jwplayer().getPlaylist(); sau đó resolve segment googleapiscdn -> lh3
(CORS mở, không CF) và lưu text m3u8 vào Firebase để artplayer phát.

Chạy TRONG thư mục scripts/ (cần r3fire.json). Phụ thuộc:
  undetected-chromedriver, certifi, "setuptools<74" (uc 3.5.5 cần distutils).
ENV tuỳ chọn: AVS_CHROME_MAIN=<major Chrome> (mặc định 149).

CLI:
  uv run python avs_m3u8.py probe <animeId>          # dump m3u8 1 tập (không ghi DB)
  uv run python avs_m3u8.py crawl <animeId> [numEps]  # crawl -> Firebase
"""

import os
import sys
import time
import shutil

# uc tải chromedriver qua urllib -> Python framework macOS thiếu root cert.
try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except ImportError:
    pass

import undetected_chromedriver as uc

from avs_extract import (
    read_sheet_row, wait_cloudflare, ajax_player, list_episodes,
    fb_key, ep_sort_key, DEFAULT_NUM_EPS,
)

CHROME_MAIN = int(os.environ.get("AVS_CHROME_MAIN", "149"))
PROFILE = "/tmp/uc-avs-profile"
CDN = "https://storage.googleapiscdn.com"


def make_uc():
    """uc Chrome qua được CF googleapiscdn. GIỮ profile để cookie cf_clearance còn
    lại giữa các lần chạy (CF chỉ challenge lần đầu); chỉ xoá file lock để không treo
    SingletonLock. page_load 'none' + client-timeout để execute_* không treo vô hạn."""
    os.makedirs(PROFILE, exist_ok=True)
    for f in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            os.remove(os.path.join(PROFILE, f))
        except OSError:
            pass
    opts = uc.ChromeOptions()
    opts.add_argument("--no-sandbox")
    opts.add_argument("--window-size=1280,900")
    opts.page_load_strategy = "none"
    d = uc.Chrome(options=opts, user_data_dir=PROFILE, headless=False, version_main=CHROME_MAIN)
    d.set_page_load_timeout(30)
    d.set_script_timeout(25)
    for setter in (
        lambda: setattr(d.command_executor._client_config, "timeout", 45),
        lambda: d.command_executor.set_timeout(45),
    ):
        try:
            setter(); break
        except Exception:
            pass
    return d


def _wait_jwplayer(driver, timeout=90):
    """Chờ jwplayer xuất hiện trên trang googleapiscdn (sau khi CF clear). Lần đầu
    với profile chưa có cf_clearance, CF challenge có thể mất 10-40s mới qua."""
    for i in range(timeout):
        try:
            if driver.execute_script(
                "return typeof jwplayer==='function' && "
                "typeof jwplayer().getPlaylist==='function' && "
                "(jwplayer().getPlaylist()||[]).length>0;"
            ):
                return True
        except Exception:
            pass
        if i % 8 == 0:
            try:
                print(f"    ...chờ CF/jwplayer t+{i}s title={driver.title!r}", flush=True)
            except Exception:
                pass
        time.sleep(1)
    return False


def get_m3u8_url(driver, ep, base):
    """ep={hash,id}. play=api -> player_url googleapiscdn -> qua CF -> jwplayer m3u8.
    Trả (m3u8_url_absolute | None, api_response)."""
    api = ajax_player(driver, {"hash": ep["hash"], "id": ep["id"]}, "api")
    player_url = api.get("link", "") if isinstance(api, dict) else ""
    if not player_url or "googleapiscdn" not in player_url:
        return None, api

    driver.execute_cdp_cmd("Network.enable", {})
    driver.execute_cdp_cmd("Network.setExtraHTTPHeaders", {"headers": {
        "Referer": base,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
    }})
    driver.execute_script("window.location.href = arguments[0];", player_url)
    if not _wait_jwplayer(driver):
        return None, api
    try:
        pl = driver.execute_script("return jwplayer().getPlaylist();")
        m = pl[0]["allSources"][0]["file"]
    except Exception:
        return None, api
    if m and m.startswith("/"):
        m = CDN + m
    return m, api


def fetch_text(driver, url):
    """fetch text trong page context googleapiscdn (đã qua CF)."""
    return driver.execute_async_script(
        "const u=arguments[0],cb=arguments[arguments.length-1];"
        "fetch(u,{credentials:'include'}).then(r=>r.text()).then(cb).catch(e=>cb('ERR:'+e));",
        url,
    )


def _abs(url, base_url):
    if url.startswith("http"):
        return url
    if url.startswith("/"):
        return CDN + url
    return base_url.rsplit("/", 1)[0] + "/" + url


def resolve_segments(driver, lines, base_url):
    """Trả mảng URL cuối cùng cho từng dòng segment: rebase tương đối -> absolute,
    rồi HEAD theo redirect (in-browser) để biến googleapiscdn -> lh3.googleusercontent.
    Resolve song song trong 1 lượt execute_async_script."""
    abs_lines = [_abs(l, base_url) for l in lines]
    resolved = driver.execute_async_script(
        """
        const lines=arguments[0], cb=arguments[arguments.length-1];
        Promise.all(lines.map(u =>
            (u.indexOf('googleapiscdn')>=0)
              ? fetch(u,{method:'HEAD',credentials:'include',redirect:'follow'})
                  .then(r=>r.url||u).catch(_=>u)
              : Promise.resolve(u)
        )).then(cb).catch(e=>cb('ERR:'+e));
        """,
        abs_lines,
    )
    return resolved if isinstance(resolved, list) else abs_lines


def build_m3u8(driver, m3u8_url):
    """Tải m3u8 (xử lý 1 lớp master nếu có), resolve segment -> lh3, trả text m3u8
    hoàn chỉnh (segment absolute lh3, sẵn sàng cho hls.js/artplayer)."""
    text = fetch_text(driver, m3u8_url)
    if not isinstance(text, str) or text.startswith("ERR:") or "#EXTM3U" not in text:
        raise RuntimeError(f"Không tải được m3u8: {str(text)[:120]}")

    # master playlist? -> lấy variant đầu, fetch media playlist
    if "#EXT-X-STREAM-INF" in text:
        variant = next((l.strip() for l in text.splitlines()
                        if l.strip() and not l.startswith("#")), None)
        if variant:
            m3u8_url = _abs(variant, m3u8_url)
            text = fetch_text(driver, m3u8_url)

    out_lines = text.splitlines()
    seg_idx = [i for i, l in enumerate(out_lines)
               if l.strip() and not l.strip().startswith("#")]
    segs = [out_lines[i].strip() for i in seg_idx]
    resolved = resolve_segments(driver, segs, m3u8_url)
    for i, r in zip(seg_idx, resolved):
        out_lines[i] = r
    return "\n".join(out_lines)


# ───────────────────────────────── probe ─────────────────────────────────────
def probe(anime_id):
    row = read_sheet_row(anime_id)
    print("SHEET:", row and row.get("name"), "|", row and row.get("url"), flush=True)
    if not row:
        return
    base = "/".join(row["url"].split("/")[:3]) + "/"

    driver = make_uc()
    try:
        driver.get(row["url"])
        wait_cloudflare(driver, 45)
        eps = list_episodes(driver)
        print("eps:", len(eps), flush=True)
        eps.sort(key=ep_sort_key, reverse=True)
        ep = eps[0]
        print("tập:", ep["ep"], flush=True)

        m3u8_url, api = get_m3u8_url(driver, ep, base)
        print("playTech:", isinstance(api, dict) and api.get("playTech"), flush=True)
        print("m3u8_url:", (m3u8_url or "")[:90], "...", flush=True)
        if not m3u8_url:
            print("=> KHÔNG lấy được m3u8 (uc/CF fail?).", flush=True)
            return

        raw = fetch_text(driver, m3u8_url)
        print("\n--- RAW m3u8 (first 1000) ---", flush=True)
        print(raw[:1000], flush=True)
        raw_hosts = set()
        for l in raw.splitlines():
            l = l.strip()
            if l and not l.startswith("#"):
                raw_hosts.add(l.split("/")[2] if l.startswith("http") else "(relative)")
        print("RAW segment hosts:", raw_hosts, "| master:", "#EXT-X-STREAM-INF" in raw, flush=True)

        final = build_m3u8(driver, m3u8_url)
        fin_hosts = set()
        nseg = 0
        for l in final.splitlines():
            l = l.strip()
            if l and not l.startswith("#"):
                nseg += 1
                fin_hosts.add(l.split("/")[2] if l.startswith("http") else "(relative)")
        print("\n--- FINAL m3u8 (first 800) ---", flush=True)
        print(final[:800], flush=True)
        print(f"\nFINAL: {nseg} segment | hosts: {fin_hosts}", flush=True)
        print("DONE", flush=True)
    finally:
        try:
            driver.quit()
        except Exception:
            pass


# ───────────────────────────────── crawl ─────────────────────────────────────
def crawl_hls(anime_id, num_eps=DEFAULT_NUM_EPS):
    """Crawl m3u8 -> Firebase. Theo schema artplayer:
    animevietsub/{epId} = {title, m3u8}; anime/{anime_id}/{ep} = {id,title,file,type:hls}.
    Bỏ qua tập đã có m3u8 (field 'file'); crawl tập mới nhất trước."""
    from fire import db, update_ep

    anime_id = str(anime_id)
    num_eps = int(num_eps) if num_eps else 0

    row = read_sheet_row(anime_id)
    if not row or "animevietsub" not in (row.get("url") or ""):
        print("Không có URL animevietsub cho id", anime_id); return
    name = row.get("name")
    base = "/".join(row["url"].split("/")[:3]) + "/"

    existing = db.reference(f"anime/{anime_id}").get() or {}
    if isinstance(existing, list):
        existing = {i: v for i, v in enumerate(existing)}
    done = {str(k) for k, v in existing.items()
            if isinstance(v, dict) and v.get("file")}
    print(f"Anime {anime_id} | {name} | đã có file: {len(done)}", flush=True)

    driver = make_uc()
    try:
        driver.get(row["url"])
        if not wait_cloudflare(driver, 45):
            raise RuntimeError("Không qua CF animevietsub")
        eps = list_episodes(driver)
        eps.sort(key=ep_sort_key, reverse=True)
        if num_eps:
            eps = eps[:num_eps]
        todo = [x for x in eps if fb_key(x["ep"]) not in done]
        print(f"{len(eps)} tập xét | crawl {len(todo)} tập (mới nhất trước)\n", flush=True)

        ok = fail = 0
        for x in todo:
            ep = x["ep"]
            try:
                m3u8_url, api = get_m3u8_url(driver, x, base)
                if not m3u8_url:
                    raise RuntimeError("no m3u8 (playTech=%s)" %
                                       (isinstance(api, dict) and api.get("playTech")))
                m3u8_text = build_m3u8(driver, m3u8_url)
            except Exception as e:
                fail += 1
                print(f"  [MISS] tập {ep}: {e}", flush=True)
                continue

            ep_id = x["id"]
            fire_path = f"animevietsub/{ep_id}"
            title = f"{name} - {ep}" if name else f"Tập {ep}"
            file_url = update_ep(title, m3u8_text, fire_path)

            key = fb_key(ep)
            db.reference().update({
                f"anime/{anime_id}/{key}": {
                    "id": ep, "title": title, "file": file_url, "type": "hls",
                }
            })
            ok += 1
            nseg = sum(1 for l in m3u8_text.splitlines()
                       if l.strip() and not l.startswith("#"))
            print(f"  [OK]   tập {ep}: {nseg} segment -> {fire_path}", flush=True)

        print(f"\nTổng: crawl {len(todo)} | OK {ok} | miss {fail}", flush=True)
    finally:
        try:
            driver.quit()
        except Exception:
            pass


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "probe"
    if cmd == "probe":
        probe(sys.argv[2])
    elif cmd == "crawl":
        crawl_hls(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else DEFAULT_NUM_EPS)
    else:
        print(__doc__)
