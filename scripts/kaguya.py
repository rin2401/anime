import requests

def ah_episodes(anime_id):
    url = "https://api.kaguya.app/anime/ah/episodes"

    payload = {
        "animeId": anime_id
    }

    response = requests.post(url, json=payload)

    return response.json()


def ah_servers(episode_id):
    url = "https://api.kaguya.app/anime/ah/servers"

    payload = {
        "episodeId": episode_id
    }

    response = requests.post(url, json=payload)

    return response.json()


def ah_video(data): 
    url = "https://api.kaguya.app/anime/ah/video"

    payload = {
       "videoServer": data
    }

    response = requests.post(url, json=payload)

    return response.json()


if __name__ == "__main__":
    id = "4315"

    res = ah_episodes(id)
    print(res)

    res = ah_servers(res["episodes"][0]["id"])
    print(res)

    res = ah_video(res["servers"][0])
    print(res)

    url = res["videos"][0]["file"]["url"]
    print(url)