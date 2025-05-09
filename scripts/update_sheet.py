import gspread
from oauth2client.service_account import ServiceAccountCredentials
from sele import update

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
    if "animevietsub" in x["url"] and x["category"] != "TV Show" and not x["episodes"]:
        print(x["id"], x["url"])
        update(x["url"], x["name"], x["id"])
        x["episodes"] = f"1: https://r3fire.firebaseio.com/anime/{x['id']}/1.json"
        row_num = i + 1
        col_num = columns.index("episodes") + 1
        sheet.update_cell(row_num, col_num, x["episodes"])
        print(x["episodes"])