import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

DB_URL = "https://r3fire.firebaseio.com"

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': DB_URL
})

def update_ep(title, m3u8_data, fire_path):
    ref = db.reference(fire_path)
    ref.update({
        "title": title,
        'm3u8': m3u8_data
    })

    return f"{DB_URL}/{fire_path}.json"


def update_anime(anime_id, data):
    for d in data:
        id = d["title"].split(" ")[1]
        ref = db.reference(f"anime/{anime_id}/{id}")
        ref.update(d)

if __name__ == "__main__":
    data = [
        { "title": "Tập 160", "file": "https://s5.phim1280.tv/20250108/RMahnuWi/2000kb/hls/index.m3u8", "type": "hls" },
    ]
    update_anime("2471", data)