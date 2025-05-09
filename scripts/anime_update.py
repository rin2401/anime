import re
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from anime_crawler import crawl_anilist
from time_utils import unix_to_str, date_dict_to_str
import sys

# Google Sheets setup
scope = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]
creds = ServiceAccountCredentials.from_json_keyfile_name("keys.json", scope)
client = gspread.authorize(creds)

# Change these to your sheet key and worksheet id
SHEET_KEY = "12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA"
WORKSHEET_ID = 33541967

db = client.open_by_key(SHEET_KEY)
sheet = db.get_worksheet_by_id(WORKSHEET_ID)

def update_anime_sheet(ids=[]):
    """
    Update the sheet with id and current_episodes for each anime id in ids.
    If id exists, update the row. Otherwise, append a new row.
    """
    # Get all existing records and build id->row mapping
    records = sheet.get_all_records()
    id_to_row = {row['id']: idx+2 for idx, row in enumerate(records) if 'id' in row}
    ids = [id for id in ids if id not in id_to_row]
    update_ids = [row["id"] for row in records]
    ids = set(ids + update_ids)
    print(ids)

    columns = list(records[0].keys())
    for anime_id in ids:
        info = crawl_anilist(int(anime_id))
        print(info)
        # Convert time fields to readable format
        if 'start_date' in info:
            info['start_date'] = date_dict_to_str(info['start_date'])
        if 'end_date' in info:
            info['end_date'] = date_dict_to_str(info['end_date'])
        if 'next_episode_time' in info:
            info['next_episode_time'] = unix_to_str(info['next_episode_time'])
        row_data = [info.get(col, '') for col in columns]
        if anime_id in id_to_row:
            # Update existing row
            row_num = id_to_row[anime_id]
            last_col_letter = chr(ord('A') + len(columns) - 1)
            sheet.update(range_name=f"A{row_num}:{last_col_letter}{row_num}", values=[row_data])
        else:
            # Append new row
            sheet.append_row(row_data)

if __name__ == "__main__":
    ID = 1193967919
    s = db.get_worksheet_by_id(ID)
    records = s.get_all_records()
    ids = [r['anilist_id'] for r in records if r.get('anilist_id')]
    update_anime_sheet(ids)
