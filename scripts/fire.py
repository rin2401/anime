import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
from tqdm.auto import tqdm

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


def update_anime(anime_id, title, episodes):
    data = {}
    for d in tqdm(episodes):
        id = str(d["ep"])
        url = d["path"]

        item = {
            "id": id,
            "title": title + " - " + id,
            "file": url,
            "type": "hls"
        }

        data[id] = item

        # ref = db.reference(f"anime/{anime_id}/{id}")
        # ref.set(item)

    ref = db.reference(f"anime/{anime_id}")
    ref.set(list(data.values()))

if __name__ == "__main__":
    import json
    with open("yeuphim/dao-hai-tac.jsonl") as f:
        data = [json.loads(l) for l in f]

    update_anime("dao-hai-tac", "One Piece", data)