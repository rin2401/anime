"""Crawl nguồn streaming m3u8 của AnimeVietsub qua nodriver (CDP async).

Từng dùng undetected-chromedriver (uc) để vượt CF, nhưng uc cần chromedriver
binaries khớp từng version Chrome (hay vỡ) và đã bị bỏ khỏi env. nodriver
(cùng tác giả, điều khiển Chrome qua CDP, không cần chromedriver) vượt CF
googleapiscdn ổn — avs_capture.py đã chạy pattern này.

Flow: sheet -> trang xem AVS -> POST /ajax/player 'api' -> player_url
googleapiscdn (host xoay: stream., storage., ...) -> tab player (qua CF,
inject SHIELD_HOOK trước khi load) -> jwplayer().getPlaylist() -> url m3u8
(path tương đối, resolve theo origin TRANG player kèm param fc=<base64 host>
— server check khớp host) -> lưu text m3u8 vào Firebase cho artplayer/.

Shield v3 (từ ~2026-08): manifest thật bị mã hoá 2 lớp, player tự giải mã
trong page rồi mới phát được — script bắt kết quả trung gian qua hook rồi
giải nốt bằng Python (xem SHIELD_HOOK + build_shield_m3u8):
  1. playlist.m3u8 (text) chứa segment /chunks/...&_t=<b64> — nối các _t,
     unscramble (LCG seed X-Cache-Node) -> AES-GCM decrypt (key từ header
     X-Edge-Tag) -> transform _0x27da8e (xorshift32 seed FNV-1a
     permKey|permSalt) -> m3u8 thật: /hls/<24hex>.ts?e=<b64url>&i=<idx>.
  2. Mỗi URL: e = AES-CTR của URL lh3.googleusercontent, key =
     HMAC-SHA256(ascii(sessionKey), "url-cipher|<24hex>"), counter = i,
     sessionKey = jti của JWT (ký tự index lẻ). lh3 CORS mở, fetch trực
     tiếp được (đầu file có 127 byte PNG prefix, hls.js tự scan sync).
Hook bắt: markKey (permKey/permSalt) + plaintext AES-GCM (trước transform).
Với stream KHÔNG mã hoá, resolve segment về lh3 như cũ (build_m3u8).

Chạy TRONG thư mục scripts/ (cần r3fire.json). Phụ thuộc: nodriver, certifi.

CLI:
  uv run python avs_m3u8.py probe <animeId>          # dump m3u8 1 tập (không ghi DB)
  uv run python avs_m3u8.py crawl <animeId> [numEps]  # crawl -> Firebase
"""

import os
import sys
import json
import base64
import hashlib
import hmac
import math
import re

sys.path.insert(0, ".")

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except ImportError:
    pass

import nodriver as uc
from nodriver import cdp

from avs_extract import (
    read_sheet_row, norm_ep, fb_key, ep_sort_key, DEFAULT_NUM_EPS,
)

# Profile Chrome cho nodriver. Chạy song song nhiều tiến trình: set
# AVS_M3U8_PROFILE khác nhau mỗi tiến trình (cùng profile thì kẹt lock).
PROFILE = os.environ.get("AVS_M3U8_PROFILE", "/tmp/nd-avs-m3u8")


async def start_browser():
    """nodriver Chrome: không cần chromedriver nên không lệch version Chrome.
    Profile riêng giữ cookie cf_clearance giữa các lần chạy (CF chỉ challenge
    lần đầu); headless=False vì CF hay chặn headless.
    Thử lại vài lần: chạy batch nhiều Chrome tuần tự cùng profile, lần sau
    hay start khi Chrome lần trước chưa thoát hẳn (còn giữ profile lock)."""
    import asyncio
    last = None
    for i in range(3):
        try:
            return await uc.start(
                user_data_dir=PROFILE, headless=False,
                browser_args=[
                    "--no-sandbox",
                    "--window-size=1280,900",
                    "--autoplay-policy=no-user-gesture-required",
                    "--mute-audio",
                ],
            )
        except Exception as e:
            last = e
            if i < 2:
                print(f"    ...Chrome chưa start ({e.__class__.__name__}), "
                      f"thử lại sau 3s...", flush=True)
                await asyncio.sleep(3)
    raise last


def stop_browser(browser):
    try:
        browser.stop()  # sync trong nodriver 0.50
    except Exception:
        pass


async def ev(tab, js, await_promise=False):
    """Chạy JS trong tab, trả giá trị JSON (return_by_value) hoặc None khi lỗi.

    Không dùng Tab.evaluate(): nó ép serialization 'deep' nên trả RemoteObject
    dạng cặp [key, {type,value}] khó dùng; gọi thẳng cdp.runtime.evaluate với
    return_by_value=True thì CDP trả JSON Python sẵn.
    """
    try:
        obj, err = await tab.send(cdp.runtime.evaluate(
            expression=js, await_promise=await_promise, return_by_value=True,
            user_gesture=True, allow_unsafe_eval_blocked_by_csp=True))
    except Exception:
        return None
    if err is not None or obj is None:
        return None
    return obj.value


async def wait_cf(tab, timeout=45):
    """Chờ Cloudflare challenge hết (title trang hết 'moment/verif/attention')."""
    for i in range(timeout):
        title = await ev(tab, "document.title") or ""
        t = title.lower()
        if t and "moment" not in t and "attention" not in t and "verif" not in t:
            return True
        if i % 8 == 0:
            print(f"    ...chờ CF t+{i}s title={title!r}", flush=True)
        await tab.sleep(1)
    return False


async def ensure_episode_list(tab):
    """Trang GIỚI THIỆU (/phim/) không có li.episode — chuyển sang trang xem
    (/tap-) cùng bộ; sidebar trang giới thiệu có link bộ khác, đừng lấy nhầm."""
    for _ in range(10):  # chờ DOM sẵn rồi mới kết luận trang thiếu episode
        if await ev(tab, "!!document.querySelector('li.episode')"):
            return
        await tab.sleep(1)
    link = await ev(tab, r"""(function(){
        var p = location.pathname.replace(/\/+$/, '');
        var cut = p.indexOf('/tap-');
        var base = cut > -1 ? p.slice(0, cut) : p;
        var as = document.querySelectorAll('a[href*="/tap-"]');
        for (var i = 0; i < as.length; i++) {
            if (as[i].hostname !== location.hostname) continue;
            if (as[i].pathname.indexOf(base + '/tap-') === 0) return as[i].href;
        }
        return null;
    })()""")
    if link:
        print(f"  (trang giới thiệu -> chuyển sang trang xem: {link})", flush=True)
        await tab.get(link)
        await wait_cf(tab)
    else:
        print("  (không thấy link tập nào của bộ này trên trang giới thiệu)", flush=True)


async def list_episodes(tab):
    """Trên trang xem: trả list {ep, hash, id} cho từng tập (ep lấy từ text nút)."""
    raw = None
    for _ in range(20):
        raw = await ev(tab, r"""(function(){
            var as = document.querySelectorAll('li.episode a[data-hash]');
            var out = [];
            for (var i = 0; i < as.length; i++) {
                out.push({hash: as[i].dataset.hash, id: as[i].dataset.id,
                          text: (as[i].textContent || '').trim()});
            }
            return {n: out.length, eps: out};
        })()""")
        if raw and raw.get("n"):
            break
        await tab.sleep(1)
    eps, seen = [], set()
    for x in (raw or {}).get("eps", []):
        if not x.get("hash"):
            continue
        ep = norm_ep(x.get("text"))
        if ep is None or ep in seen:
            continue
        seen.add(ep)
        eps.append({"ep": ep, "hash": x["hash"], "id": x["id"]})
    return eps


async def ajax_player(tab, ep, play):
    """POST /ajax/player từ context trang xem (đem theo cookie CF của trang)."""
    form = json.dumps({"link": ep["hash"], "id": str(ep["id"]),
                       "play": play, "backuplinks": "1"})
    raw = await ev(tab, """(async function(){
        try {
            const r = await fetch('/ajax/player?v=2019a', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                          'X-Requested-With': 'XMLHttpRequest'},
                body: new URLSearchParams(%s).toString(),
                credentials: 'include'});
            return {r: await r.text()};
        } catch (e) { return {r: null, e: '' + e}; }
    })()""" % form, await_promise=True)
    text = (raw or {}).get("r")
    try:
        return json.loads(text)
    except Exception:
        return {"_raw": text}


async def wait_jwplayer(tab, timeout=90):
    """Chờ jwplayer + playlist sẵn trên trang player googleapiscdn (sau CF clear).
    Lần đầu profile chưa có cf_clearance, CF challenge có thể mất 10-40s."""
    for i in range(timeout):
        ok = await ev(tab, """(function(){
            try {
                return typeof jwplayer === 'function' &&
                       typeof jwplayer().getPlaylist === 'function' &&
                       (jwplayer().getPlaylist() || []).length > 0;
            } catch (e) { return false; }
        })()""")
        if ok:
            return True
        if i % 8 == 0:
            title = await ev(tab, "document.title") or ""
            print(f"    ...chờ CF/jwplayer t+{i}s title={title!r}", flush=True)
        await tab.sleep(1)
    return False


async def open_player_tab(browser, player_url, base):
    """Tab mới cho trang player googleapiscdn (tab xem giữ nguyên để gọi ajax).
    Inject SHIELD_HOOK trước khi load (hook sống qua các lần navigate sau của
    tab này). Điều hướng qua cdp.page.navigate kèm referrer như iframe từ trang xem."""
    tab = await browser.get("about:blank", new_tab=True)
    await tab.send(cdp.page.enable())
    await tab.send(cdp.page.add_script_to_evaluate_on_new_document(source=SHIELD_HOOK))
    await tab.send(cdp.page.navigate(url=player_url, referrer=base))
    return tab


async def get_m3u8_url(tab):
    """Trích url m3u8 từ jwplayer playlist. Path thường TƯƠNG ĐỐI (/playlist/...)
    và phải resolve theo origin TRANG PLAYER (host xoay: stream.googleapiscdn.com),
    KHÔNG phải theo host cứng — url kèm param fc=<base64 host player>, server
    check request đến đúng host đó (sai host -> 403 Invalid session)."""
    m = await ev(tab, """(function(){
        try {
            var p = jwplayer().getPlaylist()[0];
            var s = (p.allSources && p.allSources.length) ? p.allSources
                  : (p.sources || []);
            var u = null;
            for (var i = 0; i < s.length; i++) {
                if (s[i] && s[i].file) { u = s[i].file; break; }
            }
            if (!u && p.file) u = p.file;
            if (!u) return {u: null};
            return {u: new URL(u, location.href).href};
        } catch (e) { return {u: null, e: '' + e}; }
    })()""")
    return (m or {}).get("u")


async def fetch_text(tab, url):
    """fetch text trong page context player (same-origin googleapiscdn, qua CF)."""
    r = await ev(tab, """(async function(){
        try {
            const r = await fetch(%s, {credentials: 'include'});
            return {t: await r.text()};
        } catch (e) { return {t: null, e: '' + e}; }
    })()""" % json.dumps(url), await_promise=True)
    return (r or {}).get("t")


def _abs(url, base_url):
    """Rebase dòng url m3u8 về absolute theo base (origin của url m3u8)."""
    if url.startswith("http"):
        return url
    if url.startswith("/"):
        return "/".join(base_url.split("/")[:3]) + url  # scheme://host + path
    return base_url.rsplit("/", 1)[0] + "/" + url


async def resolve_segments(tab, lines, base_url):
    """Trả mảng URL cuối cùng cho từng dòng segment: rebase tương đối -> absolute,
    rồi GET theo redirect (in-browser, huỷ body) để biến googleapiscdn ->
    lh3.googleusercontent (CORS mở, không CF). Dùng GET vì HEAD bị 403; song song
    trong 1 lượt evaluate. Lỗi/403 thì giữ nguyên URL gốc."""
    abs_lines = [_abs(l, base_url) for l in lines]
    r = await ev(tab, """(async function(){
        const ls = %s;
        try {
            const out = await Promise.all(ls.map(u =>
                u.indexOf('googleapiscdn') >= 0
                  ? fetch(u, {credentials: 'include', redirect: 'follow'})
                      .then(r => {
                        try { if (r.body) r.body.cancel(); } catch (e) {}
                        return r.url || u;
                      }).catch(_ => u)
                  : u));
            return {a: out};
        } catch (e) { return {a: null}; }
    })()""" % json.dumps(abs_lines), await_promise=True)
    a = (r or {}).get("a")
    return a if isinstance(a, list) else abs_lines


async def build_m3u8(tab, m3u8_url):
    """Tải m3u8 (gỡ 1 lớp master nếu có), resolve segment -> lh3, trả text m3u8
    hoàn chỉnh. Với manifest có #EXT-X-KEY (Shield v3): segment cần header
    token do player tự tính, resolve không được -> giữ nguyên URL gốc."""
    text = await fetch_text(tab, m3u8_url)
    if not isinstance(text, str) or "#EXTM3U" not in text:
        raise RuntimeError(f"Không tải được m3u8: {str(text)[:120]}")

    # master playlist? -> lấy variant đầu, fetch media playlist
    if "#EXT-X-STREAM-INF" in text:
        variant = next((l.strip() for l in text.splitlines()
                        if l.strip() and not l.startswith("#")), None)
        if variant:
            m3u8_url = _abs(variant, m3u8_url)
            text = await fetch_text(tab, m3u8_url)

    out_lines = text.splitlines()
    seg_idx = [i for i, l in enumerate(out_lines)
               if l.strip() and not l.strip().startswith("#")]
    segs = [out_lines[i].strip() for i in seg_idx]
    if segs and "#EXT-X-KEY" not in text:
        resolved = await resolve_segments(tab, segs, m3u8_url)
        for i, r2 in zip(seg_idx, resolved):
            out_lines[i] = r2
    return "\n".join(out_lines)


def _shield_warn(text):
    """Trả dòng cảnh báo nếu manifest mã hoá Shield v3, ngược lại None."""
    keys = [l for l in text.splitlines() if l.startswith("#EXT-X-KEY")]
    if not keys:
        return None
    return ("manifest MÃ HOÁ Shield v3 (%s...) — sẽ giải mã qua caps hook "
            "(build_shield_m3u8)" % keys[0].split(",")[0].split(":", 1)[1].strip())


def _seg_hosts(text):
    hosts = set()
    for l in (text or "").splitlines():
        l = l.strip()
        if l and not l.startswith("#"):
            hosts.add(l.split("/")[2] if l.startswith("http") else "(relative)")
    return hosts


# ───────────────────────── Shield v3: giải mã playlist ─────────────────────────
# Reverse-engineered từ avs-loader.min.js (webcrack): _0x27da8e/_0xc8ecf2
# (transform), _0x54ee15 (sessionKey từ JWT jti), url-cipher (HMAC + AES-CTR).

_M32 = 0xFFFFFFFF


def _fnv1a(s):
    """FNV-1a 32-bit của chuỗi (seed cho PRNG transform)."""
    h = 2166136261
    for ch in s:
        h = (h ^ (ord(ch) & 255)) & _M32
        h = (h * 16777619) & _M32
    return h


def _shield_rng(seed):
    """xorshift32 (13,17,5) seed bằng FNV-1a — PRNG của _0x27da8e."""
    state = _fnv1a(seed) or 1

    def rng():
        nonlocal state
        state = (state ^ ((state << 13) & _M32)) & _M32
        state = (state ^ (state >> 17)) & _M32
        state = (state ^ ((state << 5) & _M32)) & _M32
        return state

    return rng


def _shield_transform(data, perm_key, perm_salt):
    """_0x27da8e: Fisher-Yates (rng) + XOR mỗi 4 byte lấy 4 byte của rng.

    avs-loader áp cho plaintext AES-GCM của playlist (dùng cả 2 chiều —
    server bọc lại phía client giải). out[perm[i]] = src[i] ^ rng_byte(i).
    """
    n = len(data)
    out = bytearray(n)
    if n == 0:
        return bytes(out)
    rng = _shield_rng(f"{perm_key}|{perm_salt}")
    p = list(range(n))
    for j in range(n - 1, 0, -1):
        k = rng() % (j + 1)
        p[j], p[k] = p[k], p[j]
    r = 0
    for i in range(n):
        if (i & 3) == 0:  # !(3 & i) — precedence: & yếu hơn ==
            r = rng()
        out[p[i]] = data[i] ^ ((r >> (8 * (i & 3))) & 255)
    return bytes(out)


def _session_key_from_token(token):
    """sessionKey url-cipher = jti của JWT, lấy ký tự index lẻ (jti[1::2])."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    jti = json.loads(base64.urlsafe_b64decode(payload))["jti"]
    return jti[1::2]


def _url_cipher_decrypt(e_b64, session_key, file_id, idx):
    """Giải e-param của URL /hls/<file_id>.ts -> URL lh3.googleusercontent.

    key = HMAC-SHA256(ascii(sessionKey), "url-cipher|<file_id>"); AES-CTR
    counter = 16-byte BE của idx (param i), length 64 như WebCrypto.
    """
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    key = hmac.new(session_key.encode(), f"url-cipher|{file_id}".encode(),
                   hashlib.sha256).digest()
    ct = base64.urlsafe_b64decode(e_b64 + "=" * (-len(e_b64) % 4))
    dec = Cipher(algorithms.AES(key), modes.CTR(idx.to_bytes(16, "big"))).decryptor()
    return (dec.update(ct) + dec.finalize()).decode("utf-8", "replace")


# Inject TRƯỚC khi trang player load (add_script_to_evaluate_on_new_document):
# - trap _avsMarkKey (avs-loader gán hàm thật vào setter, payload gọi qua getter)
#   -> bắt permKey/permSalt của transform;
# - bọc crypto.subtle.decrypt (chạy TRƯỚC avs-loader nên avs-loader bọc tiếp
#   lên trên) -> bắt plaintext AES-GCM của playlist (TRƯỚC transform).
SHIELD_HOOK = r"""(function(){
  if (window.__avsHook) return; window.__avsHook = 1;
  window.__caps = [];
  var realMarkKey = null;
  function markWrapper(key, meta) {
    try { window.__caps.push({t: 'markKey',
        permKey: meta && meta.permKey, permSalt: meta && meta.permSalt}); } catch (e) {}
    try { return realMarkKey && realMarkKey(key, meta); } catch (e) {}
  }
  Object.defineProperty(window, '_avsMarkKey', {
    configurable: true,
    get: function () { return markWrapper; },
    set: function (fn) { realMarkKey = fn; }
  });
  if (window.crypto && crypto.subtle) {
    var od = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = function (alg, key, data) {
      var name = alg && alg.name;
      var p = od(alg, key, data);
      p.then(function (out) {
        try {
          if (name === 'AES-GCM' && out) {
            var u8 = new Uint8Array(out);
            if (u8.length > 10000) {
              var s = '';
              for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
              for (var j = 0; j < s.length; j += 100000)
                window.__caps.push({t: 'gcmOut', i: j, src: s.slice(j, j + 100000)});
            }
          }
        } catch (e) {}
        return out;
      }, function () {});
      return p;
    };
  }
})()"""


async def wait_shield_caps(tab, timeout=30):
    """Bật play (mute) cho player tải manifest, poll caps tới khi có đủ
    markKey (permKey/permSalt) + gcmOut (plaintext GCM playlist)."""
    await ev(tab, """(function(){
        try { jwplayer().play(true); } catch (e) {}
        var v = document.querySelector('video');
        if (v) { v.muted = true; v.play(); }
        return 1;
    })()""")
    for i in range(timeout):
        caps = await ev(tab, "window.__caps || []") or []
        has_mark = any(c.get("t") == "markKey" and c.get("permKey") for c in caps)
        has_gcm = any(c.get("t") == "gcmOut" for c in caps)
        if has_mark and has_gcm:
            return caps
        if i % 5 == 0:
            print(f"    ...chờ shield caps t+{i}s ({len(caps)})", flush=True)
        await tab.sleep(1)
    return None


_SEG_URL_RE = re.compile(r"https://\S+/hls/([0-9a-f]{24})\.ts\?e=([^&\s]+)&i=(\d+)")


def build_shield_m3u8(caps):
    """Caps (markKey + gcmOut) -> text m3u8 với URL segment lh3 (CORS mở).

    Chain: gcmOut (plaintext AES-GCM, trước transform) -> _shield_transform
    (permKey|permSalt) -> m3u8 /hls/<24hex>.ts?e=...&i=...&token=<JWT> ->
    sessionKey từ JWT jti -> giải từng e (AES-CTR) -> URL lh3.
    """
    mark = next((c for c in caps if c.get("t") == "markKey"), None)
    gcm = "".join(c["src"] for c in caps if c.get("t") == "gcmOut")
    if not mark or not mark.get("permKey") or not mark.get("permSalt") or not gcm:
        raise RuntimeError("caps thiếu markKey/gcmOut")

    text = _shield_transform(gcm.encode("latin-1"),
                             mark["permKey"], mark["permSalt"]).decode("utf-8", "replace")

    # sessionKey từ token của URL segment đầu tiên
    m0 = _SEG_URL_RE.search(text)
    if not m0:
        raise RuntimeError("m3u8 giải mã không có URL /hls/ (Shield đổi?)")
    token = re.search(r"[?&]token=([^\s&]+)", text[m0.start():]).group(1)
    session_key = _session_key_from_token(token)

    out_lines, durs = [], []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#EXTINF:"):
            out_lines.append(s)
            try:
                durs.append(float(s.split(":", 1)[1].split(",")[0]))
            except ValueError:
                pass
        elif s.startswith("#"):
            out_lines.append(s)  # ENDLIST / DISCONTINUITY... giữ nguyên
        else:
            m = _SEG_URL_RE.search(s)
            if not m:
                raise RuntimeError(f"segment lạ: {s[:80]}")
            url = _url_cipher_decrypt(m.group(2), session_key, m.group(1), int(m.group(3)))
            if not url.startswith("http"):
                raise RuntimeError(f"giải e thất bại (i={m.group(3)}): {url[:60]}")
            out_lines.append(url)

    if not durs:
        raise RuntimeError("m3u8 giải mã không có EXTINF")
    header = ["#EXTM3U", "#EXT-X-VERSION:3",
              f"#EXT-X-TARGETDURATION:{max(1, math.ceil(max(durs)))}"]
    return "\n".join(header + out_lines) + "\n"


# ───────────────────────────────── probe ─────────────────────────────────────
async def probe(anime_id):
    row = read_sheet_row(anime_id)
    print("SHEET:", row and row.get("name"), "|", row and row.get("url"), flush=True)
    if not row:
        return
    base = "/".join(row["url"].split("/")[:3]) + "/"

    browser = await start_browser()
    try:
        tab = browser.main_tab
        await tab.get(row["url"])
        if not await wait_cf(tab):
            print("=> KHÔNG qua được CF trang xem", flush=True)
            return
        await ensure_episode_list(tab)
        eps = await list_episodes(tab)
        print("eps:", len(eps), flush=True)
        if not eps:
            print("=> không liệt kê được tập", flush=True)
            return
        eps.sort(key=ep_sort_key, reverse=True)
        ep = eps[0]
        print("tập:", ep["ep"], flush=True)

        api = await ajax_player(tab, ep, "api")
        player_url = api.get("link", "") if isinstance(api, dict) else ""
        print("playTech:", isinstance(api, dict) and api.get("playTech"), flush=True)
        print("player_url:", (player_url or "")[:90], "...", flush=True)
        if not player_url or "googleapiscdn" not in player_url:
            print("=> KHÔNG có player googleapiscdn trong api response.", flush=True)
            return

        tab_play = await open_player_tab(browser, player_url, base)
        if not await wait_cf(tab_play) or not await wait_jwplayer(tab_play):
            print("=> KHÔNG qua được CF/jwplayer trang player", flush=True)
            return
        m3u8_url = await get_m3u8_url(tab_play)
        print("m3u8_url:", (m3u8_url or "")[:90], "...", flush=True)
        if not m3u8_url:
            print("=> KHÔNG lấy được m3u8 từ jwplayer.", flush=True)
            return

        raw = await fetch_text(tab_play, m3u8_url)
        print("\n--- RAW m3u8 (first 1000) ---", flush=True)
        print((raw or "")[:1000], flush=True)
        print("RAW segment hosts:", _seg_hosts(raw),
              "| master:", "#EXT-X-STREAM-INF" in (raw or ""), flush=True)
        warn = _shield_warn(raw or "")
        if warn:
            print("[!]", warn, flush=True)

        # Shield v3: để player tự giải mã, bắt caps rồi giải nốt bằng Python
        final = None
        caps = await wait_shield_caps(tab_play)
        if caps:
            try:
                final = build_shield_m3u8(caps)
                print("[SHIELD v3] giải mã OK:", flush=True)
            except Exception as e:
                print(f"[!] giải mã Shield thất bại ({e}) — fallback cũ", flush=True)
        else:
            print("[!] không bắt được caps Shield — fallback cũ", flush=True)
        if final is None:
            final = await build_m3u8(tab_play, m3u8_url)

        nseg = sum(1 for l in final.splitlines()
                   if l.strip() and not l.startswith("#"))
        print("\n--- FINAL m3u8 (first 800) ---", flush=True)
        print(final[:800], flush=True)
        print(f"\nFINAL: {nseg} segment | hosts: {_seg_hosts(final)}", flush=True)
        print("DONE", flush=True)
    finally:
        stop_browser(browser)


# ───────────────────────────────── crawl ─────────────────────────────────────
async def crawl_hls(anime_id, num_eps=DEFAULT_NUM_EPS):
    """Crawl m3u8 -> Firebase. Theo schema artplayer:
    animevietsub/{epId} = {title, m3u8}; anime/{anime_id}/{ep} = {id,title,file,type:hls}
    (merge từng field — giữ drive_id crawler Drive đã đẩy, tập có cả 2 nguồn).
    Bỏ qua tập đã có m3u8 (field 'file'); crawl tập mới nhất trước."""
    from fire import db, update_ep

    anime_id = str(anime_id)
    num_eps = int(num_eps) if num_eps else 0

    row = read_sheet_row(anime_id)
    if not row or "animevietsub" not in (row.get("url") or ""):
        print("Không có URL animevietsub cho id", anime_id)
        return
    name = row.get("name")
    base = "/".join(row["url"].split("/")[:3]) + "/"

    existing = db.reference(f"anime/{anime_id}").get() or {}
    if isinstance(existing, list):
        existing = {i: v for i, v in enumerate(existing)}
    done = {str(k) for k, v in existing.items()
            if isinstance(v, dict) and v.get("file")}
    print(f"Anime {anime_id} | {name} | đã có file: {len(done)}", flush=True)

    browser = await start_browser()
    try:
        tab = browser.main_tab
        await tab.get(row["url"])
        if not await wait_cf(tab):
            raise RuntimeError("Không qua CF animevietsub")
        await ensure_episode_list(tab)
        eps = await list_episodes(tab)
        eps.sort(key=ep_sort_key, reverse=True)
        if num_eps:
            eps = eps[:num_eps]
        todo = [x for x in eps if fb_key(x["ep"]) not in done]
        print(f"{len(eps)} tập xét | crawl {len(todo)} tập (mới nhất trước)\n", flush=True)

        tab_play = None
        ok = fail = 0
        for x in todo:
            ep = x["ep"]
            m3u8_text = None
            last_err = None
            for attempt in range(1, 4):
                try:
                    api = await ajax_player(tab, x, "api")
                    player_url = api.get("link", "") if isinstance(api, dict) else ""
                    if not player_url or "googleapiscdn" not in player_url:
                        raise RuntimeError("no player googleapiscdn (playTech=%s)" %
                                           (isinstance(api, dict) and api.get("playTech")))
                    if tab_play is None:
                        tab_play = await open_player_tab(browser, player_url, base)
                    else:
                        await tab_play.send(cdp.page.navigate(url=player_url, referrer=base))
                    if not await wait_cf(tab_play) or not await wait_jwplayer(tab_play):
                        raise RuntimeError("không qua CF/jwplayer trang player")
                    m3u8_url = await get_m3u8_url(tab_play)
                    if not m3u8_url:
                        raise RuntimeError("no m3u8 trong jwplayer playlist")
                    # Shield v3: ưu tiên giải mã qua caps; fallback resolve như cũ
                    m3u8_text = None
                    caps = await wait_shield_caps(tab_play)
                    if caps:
                        try:
                            m3u8_text = build_shield_m3u8(caps)
                        except Exception as e:
                            print(f"  [!]    giải Shield thất bại ({e})", flush=True)
                    if m3u8_text is None:
                        m3u8_text = await build_m3u8(tab_play, m3u8_url)
                    if _shield_warn(m3u8_text):
                        # caps rỗng -> avs-loader chưa chạy trên lần load này,
                        # manifest vẫn mã hoá là dữ liệu hỏng — load lại thử lại
                        last_err = "manifest vẫn mã hoá Shield (caps rỗng)"
                        m3u8_text = None
                        continue
                    break
                except Exception as e:
                    last_err = str(e)
                    continue
            if m3u8_text is None:
                fail += 1
                print(f"  [MISS] tập {ep}: {last_err} (thử {attempt} lần)", flush=True)
                continue

            ep_id = x["id"]
            fire_path = f"animevietsub/{ep_id}"
            title = f"{name} - {ep}" if name else f"Tập {ep}"
            file_url = update_ep(title, m3u8_text, fire_path)

            key = fb_key(ep)
            # update trên node con (merge từng field) chứ KHÔNG update cha với
            # dict cả node — thế đó sẽ ghi đè xóa drive_id mà crawler Drive đã đẩy.
            db.reference(f"anime/{anime_id}/{key}").update({
                "id": ep, "title": title, "file": file_url, "type": "hls",
            })
            ok += 1
            nseg = sum(1 for l in m3u8_text.splitlines()
                       if l.strip() and not l.startswith("#"))
            print(f"  [OK]   tập {ep}: {nseg} segment -> {fire_path}", flush=True)

        print(f"\nTổng: crawl {len(todo)} | OK {ok} | miss {fail}", flush=True)
    finally:
        stop_browser(browser)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "probe"
    if cmd == "probe":
        uc.loop().run_until_complete(probe(sys.argv[2]))
    elif cmd == "crawl":
        num = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_NUM_EPS
        uc.loop().run_until_complete(crawl_hls(sys.argv[2], num))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
