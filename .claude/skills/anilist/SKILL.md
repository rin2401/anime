---
name: anilist
description: Tra cứu metadata anime công khai từ AniList (https://anilist.co) — tìm anime theo tên, xem chi tiết theo AniList ID (tên, tập, điểm, thể loại, lịch chiếu). Dùng khi user muốn "tìm anime <tên>", "info anime <id>", "anilist <id>". Không liên quan tới crawl_anime — skill này chỉ đọc metadata công khai, không lấy link xem/video.
---

# anilist <search|get>

Bọc `scripts/anilist_cli.py`, dùng lại hàm có sẵn trong `scripts/anilist.py`
(`search_anilist`, `api_anilist`, `extract_info`).

## Lệnh

```bash
cd anime/scripts
uv run python anilist_cli.py search "<tên anime>"       # tìm, mặc định 5 kết quả
uv run python anilist_cli.py search "<tên anime>" --limit 10
uv run python anilist_cli.py get <anilist_id>            # chi tiết, in dạng người đọc
uv run python anilist_cli.py get <anilist_id> --json      # chi tiết, dạng JSON để xử lý tiếp
```

## Quy trình

1. User đưa tên mơ hồ hoặc nhiều mùa/phiên bản → chạy `search`, liệt kê `[id] tên (năm) — N tập`
   cho user chọn thay vì tự đoán ID.
2. Có ID rồi → chạy `get <id>` để lấy chi tiết relay cho user.
3. Đây chỉ là tra cứu metadata public từ AniList — **không** đụng tới AnimeVietsub hay bất kỳ
   nguồn crawl link xem nào. Nếu user muốn lấy link xem/tập phim, đó là việc của skill
   `crawl_anime`, không phải skill này.
