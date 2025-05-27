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
    for d in tqdm(episodes.split("\n")):
        if not d.strip():
            continue

        id, url = d.split(":", 1)
        id = id.strip()
        url = url.strip()

        item = {
            "id": id,
            "title": title + " - " + id,
            "file": url,
            "type": "hls"
        }

        data[id] = item

        # ref = db.reference(f"anime/{anime_id}/{id}")
        # ref.set(item)


    print(data)
    ref = db.reference(f"anime/{anime_id}")
    ref.set(list(data.values()))

if __name__ == "__main__":
    data = """S6: https://r3fire.firebaseio.com/animevietsub/105606.json
1128.5: https://r3fire.firebaseio.com/animevietsub/106297.json
1129: https://r3fire.firebaseio.com/animevietsub/106436.json
1130: https://r3fire.firebaseio.com/animevietsub/106564.json"""
    update_anime("21", "One Piece", data)