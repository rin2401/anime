"""One-off: thêm cột `series` (group key gom mùa) vào Google Sheet catalog.

Quy tắc: series = id của dòng mùa ĐẦU TIÊN của bộ (sort theo year, name).
- Live-action/hoạt hình phương Tây: các mùa đã trùng sẵn IMDb id trong cột
  id -> series = chính IMDb id đó.
- Anime: mỗi mùa một AniList id riêng -> series = anilist id của mùa 1.
- Bộ 1 mùa / phim lẻ: bỏ trống -> trang chủ render như card thường.

Chạy từ scripts/: uv run python add_series_column.py [--dry-run]
"""

import os
import sys

import gspread
from gspread.cell import Cell
from oauth2client.service_account import ServiceAccountCredentials

SHEET_KEY = "12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA"
WORKSHEET_ID = 1193967919

# Live-action: mọi dòng có id == tt* này nhận series = id đó
TT_SERIES = [
    "tt0460649",  # How I Met Your Mother (9 mùa)
    "tt0903747",  # Breaking Bad (5 mùa)
    "tt10919420",  # Squid Game (3 mùa)
    "tt11126994",  # Arcane (2 mùa)
    "tt13443470",  # Wednesday (2 mùa)
    "tt2531336",  # Lupin (3 mùa)
    "tt4574334",  # Stranger Things (5 mùa)
    "tt6257970",  # The End of the F***ing World (2 mùa)
    "tt7767422",  # Sex Education (4 mùa)
]

# Anime: key = anilist id mùa 1, value = [id các dòng thuộc bộ]
ANIME_GROUPS = {
    "170942": ["170942", "189123"],  # Ao no Hako
    "2": ["2", "185660"],  # Dandadan
    "172019": ["172019", "189117", "199221"],  # Dr. STONE: SCIENCE FUTURE
    "20464": ["20464", "20992", "106625", "113538"],  # Haikyuu!! (S1..S4)
    "128893": ["128893", "166613"],  # Jigokuraku
    "61": ["61", "145064"],  # Jujutsu Kaisen
    "179344": ["179344", "199029"],  # Kanojo, Okarishimasu (S4, S5)
    "161645": ["161645", "176301", "195516"],  # Kusuriya no Hitorigoto
    "457": ["457", "20595", "20751"],  # Mushishi (S1 + Zoku Shou 1..2)
    "108465": ["108465", "127720"],  # Mushoku Tensei
    "16498": [  # Shingeki no Kyojin (S1..S3, Final Season + parts)
        "16498", "20958", "99147", "104578",
        "110277", "131681", "146984", "162314",
    ],
    "154587": ["154587", "182255"],  # Sousou no Frieren
    "56": ["56", "54", "177937"],  # SPY×FAMILY
}


def main():
    dry = "--dry-run" in sys.argv

    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    keyfile = "keys.json" if os.path.exists("keys.json") else "r3fire.json"
    creds = ServiceAccountCredentials.from_json_keyfile_name(keyfile, scope)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(SHEET_KEY).get_worksheet_by_id(WORKSHEET_ID)

    header = sheet.row_values(1)
    if "series" in header:
        col = header.index("series") + 1
        print(f"cột series đã có (col {col})")
    else:
        col = len(header) + 1
        print(f"thêm header 'series' ở col {col}")

    # id -> series value
    id2series = {}
    for tt in TT_SERIES:
        id2series[tt] = tt
    for key, members in ANIME_GROUPS.items():
        for m in members:
            if m in id2series and id2series[m] != key:
                sys.exit(f"TRÙNG id {m} giữa các nhóm!")
            id2series[m] = key

    rows = sheet.get_all_records()
    missing = [i for i in id2series if i not in {str(r.get("id")) for r in rows}]
    if missing:
        sys.exit(f"KHÔNG thấy id trong Sheet: {missing}")

    # Gom cả cột thành 1 lần ghi (update_cell từng ô sẽ ăn quota write
    # 60 req/phút của service account)
    cells = [Cell(row=1, col=col, value="series")]
    n = 0
    for i, row in enumerate(rows):
        rid = str(row.get("id"))
        if rid in id2series:
            n += 1
            print(f"row {i + 2}: {row.get('name')} -> series={id2series[rid]}")
            cells.append(Cell(row=i + 2, col=col, value=str(id2series[rid])))
    if not dry:
        sheet.update_cells(cells, value_input_option="RAW")
    print(f"xong: {n} dòng, dry-run={dry}")


if __name__ == "__main__":
    main()
