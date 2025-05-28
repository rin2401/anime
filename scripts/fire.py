import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
from tqdm.auto import tqdm
from anilist import get_anilist_crunchyroll
from jikan import get_anime_video

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
    items = []
    episodes = sorted(episodes, key=lambda x: x["id"])

    # res = get_anilist_crunchyroll(anime_id)
    # M = {x["id"]: x["thumbnail"] for x in res}

    res = get_anime_video(anime_id)
    M = {str(x["mal_id"]) : x["images"]["jpg"]["image_url"] for x in res}

    for d in tqdm(episodes):
        id = str(d["ep"])
        url = d["path"]

        item = {
            "id": id,
            "title": title + " - " + id,
            "file": url,
            "type": "hls",
        }

        image =  M.get(id)
        if image:
            item["image"] = image

        items.append(item)

    print(items)

    ref = db.reference(f"anime/{anime_id}")
    ref.set(items)

if __name__ == "__main__":
    import json
    name = "naruto"
    title = "Naruto"
    anime_id = 20

    with open(f"yeuphim/{name}.jsonl") as f:
        data = [json.loads(l) for l in f]

    update_anime(anime_id, title, data)

    print(f"/anime/artplayer?id={anime_id}")