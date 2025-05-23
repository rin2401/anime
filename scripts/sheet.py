import gspread
from oauth2client.service_account import ServiceAccountCredentials
from yeuphim import update_yeuphim
from animevietsub import crawl_animevietsub
from google_search import custom_search

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

def add_row(d):
    columns = list(sheet.row_values(1))
    row_data = [d.get(col, '') for col in columns]
    sheet.append_row(row_data)

def update_sheet():
    records = sheet.get_all_records()
    columns = list(records[0].keys())
    for i, x in enumerate(records):
        if x["episodes"]:
            continue

        if "animevietsub" in x["url"] and "html" in x["url"]:
            print(x["id"], x["url"])

            episodes = crawl_animevietsub(x["url"], title=x["name"])
            if not episodes:
                continue
            x["episodes"] = episodes

        if "yeuphim" in x["url"]:
            print(x["id"], x["url"])
            url = update_yeuphim(x["url"])
            if not url:
                continue
            x["episodes"] = f"1: {url}"

        if x["episodes"]:
            row_num = i + 2
            col_num = columns.index("episodes") + 1
            sheet.update_cell(row_num, col_num, x["episodes"])
            print(x["episodes"])

def update_url():
    records = sheet.get_all_records()
    columns = list(records[0].keys())
    for i, x in enumerate(records):
        if x["category"] not in ["TV Show"]:
            continue

        if x["url"]:
            continue

        query = f"{x['name']} site:animevietsub.lol"
        print("Search:", query)
        res = custom_search(query)
        print(res)
        urls = [x["original_url"] for x in res]
        print("google_search:", urls)

        if not urls:
            continue

        url = urls[0]
        x["url"] = url
        row_num = i + 2
        col_num = columns.index("url") + 1
        sheet.update_cell(row_num, col_num, x["url"])
        print(x["url"])


if __name__ == "__main__":
    # update_url()
    update_sheet()