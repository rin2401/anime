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
   - **Exit 3** — AniList không trả tên cho id này nên **không tự tạo được dòng** (id sai,
     hoặc AniList lỗi mạng). Kiểm tra lại AniList ID hoặc thêm dòng thủ công rồi chạy lại.
     (Trường hợp Sheet chưa có dòng nhưng AniList có dữ liệu thì script **tự tạo dòng mới**
     — điền `id`/`name`/`image`/`category`/`year`/`status`/`gdrive` — rồi chạy tiếp.)
   - **Exit 4/5/6** — không có tên để search / search rỗng / `--pick` sai phạm vi. Báo lý do.

3. **Xác nhận trước khi ghi Sheet khi mơ hồ.** Nếu phải search (Sheet chưa có url) và có
   nhiều bộ na ná (vd nhiều mùa), hãy để user chọn thay vì tự đoán — dùng `--dry-run` để
   xem kế hoạch trước nếu cần: `uv run python crawl_anime.py <anilist_id> --dry-run`.

## Cách chạy nền + theo dõi (khuyến nghị)
Vì mở Chrome + crawl nhiều tập, chạy nền và monitor các dòng OK/MISS/Tổng kết/lỗi:
```bash
uv run python crawl_anime.py <anilist_id> 2>&1 | tee <scratch>/crawl_<id>.log
```
Monitor grep: `OK\]|MISS\]|Tổng kết|Cloudflare|Error|Traceback|Không|CHỌN|WARN|ERR`.

## Ghi chú
- URL trong Sheet có thể là trang giới thiệu (`/phim/<slug>-aXXXX/`) — `crawl_drive` tự
  chuyển sang trang xem (`.../tap-NN-<id>.html`) để lấy danh sách tập.
- Quy ước: Sheet `id` == AniList ID == Firebase key. Nếu lệch, script cảnh báo (`WARN`) và
  crawl theo `id` của dòng Sheet.
- Sheet được bảo vệ toàn bộ nhưng service account `r3fire@appspot.gserviceaccount.com` nằm
  trong danh sách editor nên **ghi được mọi cột, gồm cả `id`** → script tự append dòng mới
  được (ghi chú cũ "id bị khoá" đã lỗi thời từ 2026-07-02).
- Xem thêm memory `gdrive-crawl-workflow` cho chi tiết Sheet/domain/gotchas.
