import gspread
from oauth2client.service_account import ServiceAccountCredentials
import sele

# Google Sheets setup
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]
creds = ServiceAccountCredentials.from_json_keyfile_name("keys.json", scope)
client = gspread.authorize(creds)

# Change these to your sheet key and worksheet id
SHEET_KEY = "12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA"
WORKSHEET_ID = 1193967919

db = client.open_by_key(SHEET_KEY)
sheet = db.get_worksheet_by_id(WORKSHEET_ID)
records = sheet.get_all_records()
columns = list(records[0].keys())
for i, x in enumerate(records):
    if x["category"] == "TV Show":
        continue

    if x["episodes"]:
        continue

    if "animevietsub" in x["url"] and "html" in x["url"]:
        print(x["id"], x["url"])

        fire_path = f"anime/{x['id']}/1"
        url = sele.update_animevietsub(url=x["url"], fire_path=fire_path, title=x["name"])
        if not url:
            continue
        x["episodes"] = f"1: {url}"

    if "yeuphim" in x["url"]:
        print(x["id"], x["url"])
        url = sele.update_yeuphim(x["url"])
        if not url:
            continue
        x["episodes"] = f"1: {url}"

    if x["episodes"]:
        row_num = i + 2
        col_num = columns.index("episodes") + 1
        sheet.update_cell(row_num, col_num, x["episodes"])
        print(x["episodes"])
