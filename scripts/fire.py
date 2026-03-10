import firebase_admin
from firebase_admin import credentials
from firebase_admin import db
from tqdm.auto import tqdm
from anilist import get_anilist_crunchyroll
from jikan import get_anime_video

DB_URL = "https://r3fire.firebaseio.com"

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {"databaseURL": DB_URL})


def update_ep(title, m3u8_data, fire_path):
    ref = db.reference(fire_path)
    ref.update({"title": title, "m3u8": m3u8_data})

    return f"{DB_URL}/{fire_path}.json"


def update_anime(anime_id, title, episodes):
    items = []
    episodes = sorted(episodes, key=lambda x: x["id"])

    # res = get_anilist_crunchyroll(anime_id)
    # M = {x["id"]: x["thumbnail"] for x in res}

    res = get_anime_video(anime_id)
    M = {str(x["mal_id"]): x["images"]["jpg"]["image_url"] for x in res}

    for d in tqdm(episodes):
        id = str(d["ep"])
        url = d["path"]

        item = {
            "id": id,
            "title": title + " - " + id,
            "file": url,
            "type": "hls",
        }

        image = M.get(id)
        if image:
            item["image"] = image

        items.append(item)

    print(len(items))

    ref = db.reference(f"anime/{anime_id}")
    ref.set(items)


if __name__ == "__main__":
    # import json
    # yeuphim_id = "naruto"
    # title = "Naruto"
    # anime_id = 20

    # title = "NARUTO: Shippuuden"
    # anime_id = 1735
    # yeuphim_id = "naruto-shippuden"

    # with open(f"yeuphim/{yeuphim_id}.jsonl") as f:
    #     data = [json.loads(l) for l in f]

    # update_anime(anime_id, title, data)

    # print(f"/anime/artplayer?id={anime_id}")

    data = [
        {
            "id": 1,
            "title": "The Amazing Spider-Man 2",
            "file": "https://sundaythekingplays.site/hls/Y7pW9HLfmuW0vmu3s87jhIJRJKyYbskEWcy+aA8eYGj1x-ZFW6w+GXwcsROIQbHUBH3EhCjcbnfEiusaCsHbug==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/1920-0/3260428270dfcbde3e2ddd35dc046f28.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/3/36390c48b370fa55b13756f4aeb195f4/vie-3.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/3/36390c48b370fa55b13756f4aeb195f4/eng-2.vtt",
                },
            ],
        }
    ]

    # ref = db.reference(f"anime/spiderman2")
    # ref.set(data)

    data = [
        {
            "id": 1,
            "title": "The Wind Rise",
            "file": "https://snowbreeze49.live/hls/0knMStSmTHvArQFEtw3VH8Pf02U7MT1EYU9ViigvrSOplOrzllOAa3IUIGIxaGHTgMyiy1OuyOmmoboIsICQAQ==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/1920-0/4df45749d682df65f17bd5269f32439d.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/1/081b643496582a370797ed7c269db405/vie-30.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/1/081b643496582a370797ed7c269db405/eng-8.vtt",
                },
            ],
        }
    ]

    ref = db.reference(f"anime/gionoi")
    ref.set(data)

    data = [
        {
            "id": 1,
            "title": "The Wind Rise",
            "file": "https://owakshina.store/hls/0knMStSmTHvArQFEtw3VH8Pf02U7MT1EYU9ViigvrSOplOrzllOAa3IUIGIxaGHTgMyiy1OuyOmmoboIsICQAQ==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/1920-0/4df45749d682df65f17bd5269f32439d.jpg",
            "type": "hls",
            "subtitles": [],
        },
        {
            "id": 2,
            "title": "Spirited Away",
            "file": "https://sundaythekingplays.xyz/hls/rYcX+tr9Cg89YiXLw4pfV0Y1DR-j7IF2YMB2HmYMwFNsnezZME9qF8qewVtz5p7zbMqXaKn1OK9+6vMrAHajxg==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/1920-0/ece27a79d58fef6732960697655d1beb.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/1/83f2028098feb677064c12767f7ba204/vie-30.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/1/83f2028098feb677064c12767f7ba204/eng-7.vtt",
                },
            ],
        },
        {
            "id": 3,
            "title": "Howl's Moving Castle",
            "file": "https://hitmefirstcdn.store/hls/XTc2gsI5MJE6Iz1JR7mtFEu-OzTsvihrznLlQnKSCckwOqowOTg80pJlxFV8-KlUwU9dfFV2yMhLfKp4-67W6Q==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/0-0/08571519d3936354d04972dc4b08066c.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/1/f671caf27fbf916df13eca96fb81ccaa/vie-6.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/1/f671caf27fbf916df13eca96fb81ccaa/eng-2.vtt",
                },
            ],
        },
        {
            "id": 4,
            "title": "Castle in the Sky",
            "file": "https://owakshina.store/hls/3IBaWpulQQSsG6rHlFuFiuWlXqmJP98f9v82ecWQ2KwbS0mjn5pEnfANstaKyHHWUqyeW5rsEFLXbFcmm2voZg==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/0-0/95ffeecfa932f9be6eec5c7e45448c53.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/1/44dede1a3ac80b316cfd0863d1e03854/vie-31.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/1/44dede1a3ac80b316cfd0863d1e03854/eng-7.vtt",
                },
            ],
        },
        {
            "id": 5,
            "title": "Princess Mononoke",
            "file": "https://sundaythekingplays.xyz/hls/YqmFWoKP6PTumxd6cH13mgWRo2K4LkiJZ9T7PWLj4W84Sch7-Dyumo6SoHXweLNc4zEk8HgPu1gvceCQB7gPbw==/aW5kZXgtZjEtdjEtYTEubTN1OA==.m3u8",
            "image": "https://static.nutscdn.com/vimg/0-0/cae962ba08e7052fb3d736f4d50b80f8.jpg",
            "type": "hls",
            "subtitles": [
                {
                    "name": "vietnamese",
                    "url": "https://static.nutscdn.com/vcc/1/4ce935cd3912dbb15aa6e101a1db97cf/vie-29.vtt",
                },
                {
                    "name": "english",
                    "url": "https://static.nutscdn.com/vcc/1/4ce935cd3912dbb15aa6e101a1db97cf/eng-7.vtt",
                },
            ],
        },
    ]

    # ref = db.reference(f"anime/ghibli")
    # ref.set(data)
