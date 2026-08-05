"""Capture pipeline cho AnimeVietsub (content mã hoá Shield v3).

Không giải mã thuật toán — để chính player của AVS giải mã trong browser, rồi
HOOK MediaSource/SourceBuffer.appendBuffer để hứng fMP4 ĐÃ GIẢI MÃ, ghép 2 track
(video+audio) và mux bằng ffmpeg -> mp4 phát được. Cũng lưu manifest m3u8.

Dùng nodriver (CDP async) để vượt Cloudflare của storage.googleapiscdn.com.
Chạy TRONG scripts/. Phụ thuộc: nodriver, certifi, static-ffmpeg.

CLI:
  uv run python avs_capture.py <watchUrl|animeId> [out.mp4] [maxSeconds]
  (maxSeconds=0 -> cả tập; mặc định 0)
"""

import sys, os, json, base64, time, subprocess
sys.path.insert(0, ".")
import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
import static_ffmpeg
static_ffmpeg.add_paths()  # đưa ffmpeg/ffprobe vào PATH
import shutil
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

import nodriver as uc
from nodriver import cdp
from avs_extract import read_sheet_row

SCR = os.environ.get("AVS_OUT_DIR", ".")

# Hook: gắn nhãn track theo thứ tự addSourceBuffer, hứng từng appendBuffer (base64).
HOOK = r"""(function(){
  if(window.__hooked) return; window.__hooked=1;
  window.__caps=[]; window.__tracks={}; window.__ti=0; window.__capErr=0;
  try{
    if(window.MediaSource && MediaSource.prototype.addSourceBuffer){
      var oa=MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer=function(mime){
        var sb=oa.apply(this,arguments);
        try{ sb.__tk=window.__ti++; window.__tracks[sb.__tk]=mime; }catch(e){}
        return sb;
      };
    }
    if(window.SourceBuffer && SourceBuffer.prototype.appendBuffer){
      var ob=SourceBuffer.prototype.appendBuffer;
      SourceBuffer.prototype.appendBuffer=function(d){
        try{
          var u8=d instanceof ArrayBuffer?new Uint8Array(d):(d&&d.buffer?new Uint8Array(d.buffer):null);
          if(u8){var s='',L=u8.length;for(var i=0;i<L;i++)s+=String.fromCharCode(u8[i]);
            window.__caps.push({t:(this.__tk!=null?this.__tk:-1),d:btoa(s)});}
        }catch(e){window.__capErr=''+e;}
        return ob.apply(this,arguments);
      };
    }
  }catch(e){window.__hookErr=''+e;}
})()"""

PULL = r"""(function(){
  var c=window.__caps||[]; window.__caps=[];
  var v=document.querySelector('video')||{};
  return JSON.stringify({n:c.length, caps:c, tracks:window.__tracks||{},
    ct:+(v.currentTime||0), dur:+(v.duration||0), ended:!!v.ended, err:window.__capErr||0});
})()"""


async def resolve_player_url(tab, watch_url):
    await tab.get(watch_url)
    await tab.sleep(5)
    src = await tab.evaluate("(document.querySelector('iframe')||{}).src||''")
    src = (src or "").split("?")[0]
    return src if src and "googleapiscdn" in src else None


async def capture(watch_url, out_mp4, max_seconds=0):
    base = "/".join(watch_url.split("/")[:3]) + "/"
    browser = await uc.start(
        user_data_dir="/tmp/nd-avs", headless=False,
        browser_args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"])
    tab = browser.main_tab

    # cài hook trước mọi document (chạy ngay từ đầu trang player -> bắt cả init segment)
    await tab.send(cdp.page.enable())
    await tab.send(cdp.page.add_script_to_evaluate_on_new_document(source=HOOK))

    player_url = await resolve_player_url(tab, watch_url)
    print("player_url:", (player_url or "")[:80], flush=True)
    if not player_url:
        await browser.stop(); raise RuntimeError("không thấy iframe googleapiscdn")

    await tab.send(cdp.page.navigate(url=player_url, referrer=base))

    # chờ CF clear + jwplayer + lấy m3u8 (lưu lại)
    m3u8_url = None
    for _ in range(40):
        await tab.sleep(2)
        m3u8_url = await tab.evaluate(
            "(function(){try{return jwplayer().getPlaylist()[0].allSources[0].file}catch(e){return null}})()")
        if m3u8_url:
            break
    print("m3u8:", bool(m3u8_url), flush=True)

    # hook đã chạy chưa? nếu chưa (addScript fail) -> inject live
    hooked = await tab.evaluate("window.__hooked||0")
    if not hooked:
        await tab.evaluate(HOOK)
        print("hook: inject live", flush=True)
    else:
        print("hook: on-new-document", flush=True)

    # ép phát từ đầu + tua nhanh để fetch tuần tự nhanh hơn realtime
    await tab.evaluate("""(function(){try{jwplayer().play(true)}catch(e){}
        var v=document.querySelector('video');
        if(v){v.muted=true;try{v.currentTime=0}catch(e){};v.playbackRate=16;v.play();}
        return 1})()""")

    # buffer per track
    tracks = {}          # ti -> list[bytes]
    track_mime = {}
    target = max_seconds if max_seconds else 0
    last_ct = -1; stall = 0
    for it in range(2000):
        await tab.sleep(1.2)
        raw = await tab.evaluate(PULL)
        try:
            d = json.loads(raw)
        except Exception:
            continue
        for c in d.get("caps", []):
            ti = c.get("t", -1)
            tracks.setdefault(ti, []).append(base64.b64decode(c["d"]))
        track_mime.update(d.get("tracks", {}))
        ct, dur, ended = d.get("ct", 0), d.get("dur", 0), d.get("ended")
        # giữ playbackRate cao (jwplayer hay reset)
        await tab.evaluate("(function(){var v=document.querySelector('video');if(v)v.playbackRate=16;})()")
        if it % 5 == 0:
            tot = sum(len(b) for bl in tracks.values() for b in bl)
            print(f"  cap it{it} ct={ct:.0f}/{dur:.0f} ended={ended} "
                  f"tracks={list(tracks)} bytes={tot//1024}KB", flush=True)
        # điều kiện dừng
        goal = target if target else (dur - 1.5 if dur else 0)
        if dur and ct >= goal > 0:
            print("  -> đạt mốc thời lượng", flush=True); break
        if ended:
            print("  -> video ended", flush=True); break
        if abs(ct - last_ct) < 0.01:
            stall += 1
        else:
            stall = 0; last_ct = ct
        if stall > 25:   # đứng yên quá lâu (buffer xong/đứng) -> dừng
            print("  -> stall, dừng", flush=True); break

    try: await browser.stop()
    except Exception: pass

    if not tracks:
        raise RuntimeError("không hứng được chunk nào")

    # phân loại video/audio theo mime, ghi file fMP4 từng track
    os.makedirs(os.path.dirname(out_mp4) or ".", exist_ok=True)
    parts = []
    for ti, blobs in sorted(tracks.items()):
        mime = track_mime.get(str(ti), track_mime.get(ti, "")) or ""
        kind = "video" if ("avc" in mime or "hvc" in mime or "hev" in mime or "video" in mime) else \
               ("audio" if ("mp4a" in mime or "audio" in mime or "ac-3" in mime) else f"t{ti}")
        path = out_mp4 + f".{kind}.m4s"
        with open(path, "wb") as f:
            f.write(b"".join(blobs))
        sz = os.path.getsize(path)
        print(f"  track {ti} [{kind}] mime={mime[:40]} -> {path} ({sz//1024}KB, {len(blobs)} chunk)", flush=True)
        parts.append(path)

    # mux bằng ffmpeg
    cmd = [FFMPEG, "-y", "-loglevel", "error"]
    for p in parts:
        cmd += ["-i", p]
    for i in range(len(parts)):
        cmd += ["-map", str(i)]
    cmd += ["-c", "copy", out_mp4]
    print("ffmpeg mux:", " ".join(cmd[-6:]), flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("ffmpeg err:", r.stderr[:400], flush=True)
    return out_mp4


def ffprobe(path):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height",
        "-of", "default=noprint_wrappers=1", path], capture_output=True, text=True)
    return r.stdout or r.stderr


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "172463"
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SCR, "capture.mp4")
    maxs = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    if arg.startswith("http"):
        watch = arg
    else:
        row = read_sheet_row(arg)
        if not row:
            print("không tìm thấy id trong sheet"); return
        watch = row["url"]
    print("watch:", watch, "| out:", out, "| maxSeconds:", maxs, flush=True)

    uc.loop().run_until_complete(capture(watch, out, maxs))
    print("\n=== ffprobe", out, "===", flush=True)
    print(ffprobe(out), flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
