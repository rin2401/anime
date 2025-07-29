import os
import time
import json
import requests


def get_anime_video(anime_id):
    OUT = f"jikan/video_{anime_id}.json"
    if os.path.exists(OUT):
        with open(OUT, "r") as f:
            data = json.load(f)
            return data

    page = 1
    data = []
    while True:
        url = f"https://api.jikan.moe/v4/anime/{anime_id}/videos/episodes?page={page}"
        print(url)
        r = requests.get(url).json()

        data += r['data']   
        page += 1

        if not r['pagination']['has_next_page']:
            break

        time.sleep(1)

    with open(OUT, "w") as f:
        json.dump(data, f)

    return data

if __name__ == "__main__":
    import sys
    anime_id = sys.argv[1]
    data = get_anime_video(anime_id)
    # print(data)