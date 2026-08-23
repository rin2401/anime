---
name: crawl_anime
description: Crawl link Google Drive của 1 anime (theo AniList ID) từ animevietsub và push lên Firebase. Dùng khi user muốn "crawl anime <id>", "crawl bộ này <id>", cập nhật link Drive cho một anime, hoặc thêm anime mới vào player. Tự tìm trên animevietsub theo tên nếu Sheet chưa có URL.
---

# crawl_anime <anilist_id>

Crawl link Drive của một anime và đẩy lên Firebase `anime/{id}` để player phát được.
Bọc script `scripts/crawl_anime.py` (đã lo hết: tra Sheet → tự tạo dòng từ AniList nếu chưa
có → search → ghi Sheet → crawl → set cột `gdrive` = key sau khi crawl xong).

## Điều kiện
- Chạy trên **máy Mac** với **Chrome** (script mở Chrome qua Selenium để vượt Cloudflare;
  profile mặc định `/tmp/cf-chrome-profile`). Không chạy được trong sandbox không có Chrome/mạng.
- Chạy từ thư mục `scripts/` (script load `r3fire.json` / `fire` theo đường dẫn tương đối).
- **Phải tắt sandbox của Bash tool** (`dangerouslyDisableSandbox: true`). Trong sandbox,
  Chrome khởi động rồi chết ngay → `SessionNotCreatedException: Chrome instance exited`.
- **Chỉ chạy một lệnh crawl tại một thời điểm** — mọi script dùng chung profile
  `/tmp/cf-chrome-profile`. Từ 2026-08-18 `make_driver()` tự dọn Chrome mồ côi trên profile
  này trước khi mở, nên chạy song song thì lệnh sau **giết Chrome của lệnh đang chạy** (trước
  đây lệnh sau chỉ tự chết). Vẫn phải chạy tuần tự.

## Trước mỗi lần chạy: không cần `pkill` tay nữa
`make_driver()` trong `scripts/avs_extract.py` tự lo (sửa 2026-08-18):
- dọn Chrome mồ côi đang giữ `/tmp/cf-chrome-profile` trước khi mở, thử lại 1 lần nếu vẫn hỏng;
- tự `quit()` khi script thoát hoặc bị SIGTERM/SIGHUP (SIGINT thì `finally` lo sẵn).

Nguyên nhân gốc của `SessionNotCreatedException: Chrome instance exited`: khi tiến trình crawl
bị kill cứng (SIGKILL/timeout), chromedriver chết nhưng **Chrome nó mở vẫn sống** và giữ
SingletonLock của profile, nên mọi lần chạy sau đều chết cho tới khi có người kill tay.
(Lock trỏ tới PID đã chết thì Chrome tự xử lý được — không cần xoá file `Singleton*`.)

Chỉ khi lỗi vẫn còn (SIGKILL không chặn được, hoặc Chrome không chịu chết) mới dọn tay:
```bash
pkill -f 'cf-chrome-profile'; pkill -f chromedriver; sleep 2
```

## Quy trình

1. **Chạy orchestrator** (nền + monitor vì crawl mất thời gian & mở Chrome):
   ```bash
   cd anime/scripts && uv run python crawl_anime.py <anilist_id>
   ```
   Mặc định crawl 100 tập mới nhất. Thêm `--num 0` để crawl tất cả các tập.

2. **Đọc exit code / output:**
   - **Exit 0** — xong. Relay dòng `Tổng kết: crawl N | OK .. | miss ..` cho user.
     Sau khi crawl xong & có tập trên Firebase, script tự set cột `gdrive` = key
     (id/anilist_id của dòng) nếu chưa đúng, để card trang chủ `/anime/gdrive/?id=` trỏ đúng.
   - **Exit 2 (cần chọn)** — script in danh sách kết quả tìm kiếm `[i] tên / url`.
     → Trình danh sách cho user (ưu tiên `AskUserQuestion` với vài mục đầu, có "bộ khác"),
       rồi chạy lại: `uv run python crawl_anime.py <anilist_id> --pick <N>`.
     → Nếu user đưa thẳng URL animevietsub: `--url "<URL>"`.
     → Nếu **không mùa nào trong danh sách là bộ đúng**, xem "Search không ra bộ đúng" dưới.
   - **Exit 3** — AniList không trả tên cho id này nên **không tự tạo được dòng** (id sai,
     hoặc AniList lỗi mạng). Kiểm tra lại AniList ID hoặc thêm dòng thủ công rồi chạy lại.
     (Trường hợp Sheet chưa có dòng nhưng AniList có dữ liệu thì script **tự tạo dòng mới**
     — điền `id`/`name`/`image`/`category`/`year`/`status`/`gdrive` — rồi chạy tiếp.)
   - **Exit 4/5/6** — không có tên để search / search rỗng / `--pick` sai phạm vi. Báo lý do.

3. **Xác nhận trước khi ghi Sheet khi mơ hồ.** Nếu phải search (Sheet chưa có url) và có
   nhiều bộ na ná (vd nhiều mùa), hãy để user chọn thay vì tự đoán — dùng `--dry-run` để
   xem kế hoạch trước nếu cần: `uv run python crawl_anime.py <anilist_id> --dry-run`.

## Domain animevietsub chết (NXDOMAIN / ERR_NAME_NOT_RESOLVED)
Site xoay tên miền liên tục — domain cũ có thể chết bất cứ lúc nào (2026-08-23: `.vc` NXDOMAIN
hẳn, `.love` cũng hết hạn). Domain sống hiện tại: **`animevietsub.work`**, khai ở
`scripts/avs_extract.py:24` (`SITE = "..."`); `norm_host()` tự viết lại mọi URL
`animevietsub.<tld>` cũ trong Sheet về domain này khi crawl, nên **chỉ cần sửa một chỗ này**.

Nếu gặp lỗi `net::ERR_NAME_NOT_RESOLVED` khi crawl, đi tìm domain sống mới bằng Chrome thật
(curl không vượt được Cloudflare nên không dùng để xác minh):
```bash
cd anime/scripts && uv run python - <<'EOF'
import time
from avs_extract import make_driver, wait_cloudflare, kill_orphan_chrome
for dom in ["animevietsub.tv", "animevietsub.co", "animevietsub.show"]:  # thử vài TLD phổ biến
    kill_orphan_chrome()
    d = make_driver()
    try:
        d.get(f"https://{dom}/"); wait_cloudflare(d); time.sleep(2)
        print(dom, "->", d.title, "|", d.current_url)
    finally:
        d.quit()
EOF
```
Domain thật sẽ redirect sang trang có title kiểu "Anime Vietsub Online - AnimeVietSub.<tld>"
và có nội dung anime thật (thử mở 1 slug quen biết, vd `/phim/one-piece-dao-hai-tac-a1/`, xem
tập mới nhất có khớp số tập AniList báo đã chiếu không). Domain rác/parking sẽ redirect sang
site quảng cáo lạ (vd từng gặp `.lol` redirect sang `live.pushub.net`) hoặc trả title trống/
đúng tên domain (chưa qua được Cloudflare / chưa trỏ đúng). Xác nhận xong thì sửa `SITE` ở
`avs_extract.py` rồi chạy lại crawl bình thường.

(Lưu ý: `anilist.py`/`animevietsub.py`/`main.py`/`sheet.py` còn hardcode riêng
`animevietsub.lol/ajax/suggest` cho tính năng search khác — không nằm trong luồng
`crawl_anime.py`, đổi domain ở trên không tự sửa các chỗ này.)

## Xác minh AniList ID là mùa nào
Trước khi `--pick`, đối chiếu số tập + năm để chắc chắn chọn đúng mùa/part:
```bash
cd anime/scripts && uv run python anilist_cli.py get <anilist_id>
```
AniList tách từng cour thành entry riêng, animevietsub thì gộp/đặt tên khác
(vd: AniList 108465 = Mushoku Tensei S1, 11 tập; trên site là "Phần 1", còn slug
`...-2nd-season-a4158` lại là "Phần 1 Part 2"). **Khớp theo số tập, đừng khớp theo tên mùa.**

## Search không ra bộ đúng
Index tìm kiếm của animevietsub có lỗ: mùa cũ có thể **không xuất hiện** trong kết quả, nhất
là khi slug là tiếng Việt (`phim/that-nghiep-chuyen-sinh-a3940/` không chứa chữ "mushoku" nên
query theo tên AniList vô vọng). Cách lấy URL đúng: mở trang **một mùa bất kỳ đã tìm được**,
đọc danh sách phần của nó:
```bash
cd anime/scripts && uv run python - <<'EOF'
import time
from avs_extract import make_driver, wait_cloudflare
URL = "https://animevietsub.work/phim/<slug-mua-da-biet>-aXXXX/"  # domain sống, xem SITE ở avs_extract.py
d = make_driver()
try:
    d.get(URL); wait_cloudflare(d); time.sleep(2)
    for t, href in d.execute_script(
        "return [...document.querySelectorAll('a[href*=\"/phim/\"]')]"
        ".map(a => [(a.textContent||'').replace(/\\s+/g,' ').trim(), a.href])"
    ):
        if t.startswith(("Phần", "Mùa")):
            print(t, "||", href)
finally:
    d.quit()
EOF
```
In ra `Phần 1 || https://...`, `Phần 2 || ...`, `Phần Special || ...`. Lấy URL đúng rồi chạy
`crawl_anime.py <id> --url "<URL>"`. Lưu ý danh sách này **không đầy đủ như nhau ở mọi trang**
(trang a4627 thiếu cả "Phần 1", trang a4158 liệt kê đủ 5 phần) — thiếu mùa cần tìm thì mở tiếp
một mùa khác trong danh sách rồi đọc lại.

## Cách chạy nền + theo dõi (khuyến nghị)
Vì mở Chrome + crawl nhiều tập, chạy nền và monitor các dòng OK/MISS/Tổng kết/lỗi.
**Đừng dùng `| tee`** — exit code bị `tee` che (luôn 0), crawl chết vì Chrome vẫn trông như
thành công. Redirect thẳng rồi in `$?`:
```bash
uv run python crawl_anime.py <anilist_id> > <scratch>/crawl_<id>.log 2>&1; echo "EXIT=$?"
```
Monitor grep: `OK\]|MISS\]|Tổng kết|Cloudflare|Error|Traceback|Không|CHỌN|WARN|ERR|SessionNotCreated`.

## Kiểm tra sau khi crawl
Đừng chỉ tin dòng `Tổng kết` — đối chiếu số tập thật trên Firebase với số tập AniList:
```bash
curl -s 'https://r3fire.firebaseio.com/anime/<id>.json' | python3 -c '
import json, sys
d = json.load(sys.stdin)
# Firebase trả ARRAY (index 0 = null) khi key tập là số liên tiếp từ 1, trả OBJECT
# khi có key chữ (vd "11_END") -> phải xử lý cả hai, và bỏ phần tử null.
eps = ({str(i): v for i, v in enumerate(d) if v} if isinstance(d, list)
       else {k: v for k, v in (d or {}).items() if v})
print(len(eps), sorted(eps, key=lambda k: (len(k), k)))
'
```
Tập cuối thường có key dạng `11_END` — đó là lúc Firebase trả về object. Bộ đang phát mà
mới có tập 1..N thì trả về array, dùng `len(d)` thẳng sẽ đếm lố (tính cả `null` ở index 0).

## Ghi chú
- URL trong Sheet có thể là trang giới thiệu (`/phim/<slug>-aXXXX/`) — `crawl_drive` tự
  chuyển sang trang xem (`.../tap-NN-<id>.html`) để lấy danh sách tập.
- Quy ước: Sheet `id` == AniList ID == Firebase key. Nếu lệch, script cảnh báo (`WARN`) và
  crawl theo `id` của dòng Sheet.
- Sheet được bảo vệ toàn bộ nhưng service account `r3fire@appspot.gserviceaccount.com` nằm
  trong danh sách editor nên **ghi được mọi cột, gồm cả `id`** → script tự append dòng mới
  được (ghi chú cũ "id bị khoá" đã lỗi thời từ 2026-07-02).
- Kết quả search có lẫn feed bình luận của site (dòng kiểu "tên user … N phút trước … tên phim")
  — đó là rác của selector, không phải bộ trùng; bỏ qua.
- Xem thêm memory `gdrive-crawl-workflow` cho chi tiết Sheet/domain/gotchas.
