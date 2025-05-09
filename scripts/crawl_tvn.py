import json
import re
import time

import requests
from bs4 import BeautifulSoup

HOST = "animetvn4.com"

def find_links(text):
    text = text.replace("\\", "")
    return sorted(set(re.findall("http[^ \"><']+", text)))


def get_animetvn_films():
    #     with open("dev/sitemap.xml") as f:
    #         text = "".join(f.readlines())
    text = requests.get(f"https://{HOST}/sitemap.xml", timeout=1).text
    urls = re.findall("<loc>(.*?)</loc>", text)
    urls = {url.split("/")[-1].split("-")[0][1:]: url for url in urls}
    return urls


def get_film_info(url):
    id = url.split("/")[-1].split("-")[0][1:]
    soup = BeautifulSoup(requests.get(url).text, "html.parser")
    name = soup.find(class_="name-vi")
    if not name:
        return None

    name = name.text
    img_info = soup.find(class_="img_info")
    avatar = img_info.find("img", class_="thumb").get("src")
    cover = img_info.find("img", class_="big_img").get("src")

    view_url = soup.find(class_="play-now")
    subs = []
    if view_url:
        view_url = view_url.get("href", None)
        view_soup = BeautifulSoup(requests.get(view_url).text, "html.parser")
        epsubs = view_soup.find_all(class_="svep")
        for epsub in epsubs:
            svname = epsub.find(class_="svname").text
            eps = [
                {"num": a.text, "id": a["id"].split("_")[-1]}
                for a in epsub.find_all("a")
            ]
            subs.append({"name": svname, "episodes": eps})
    data = {
        "id": id,
        "name": name,
        "avatar": avatar,
        "cover": cover,
        "url": url,
        "subs": subs,
    }

    return data


cookies, csrf, expire = None, None, None


def get_cookie():
    global cookies, csrf, expire
    r = requests.get(f"https://{HOST}", timeout=1)
    cookies = r.cookies
    soup = BeautifulSoup(r.text)
    csrf = (
        soup.find("head")
        .find("meta", attrs={"name": "csrf-token"})
        .get("content", None)
    )
    expire = cookies._cookies[HOST]["/"]["XSRF-TOKEN"].expires

    return cookies, csrf, expire


get_cookie()


def get_episode_link(id, link):
    if time.time() >= expire:
        get_cookie()
    headers = {"x-csrf-token": csrf}
    data = {"id": id, "link": link}
    r = requests.post(
        f"https://{HOST}/ajax/getExtraLink",
        data=data,
        headers=headers,
        cookies=cookies,
        timeout=5
    )
    return r.json()


def get_episode_info(epid):
    if time.time() >= expire:
        get_cookie()
    headers = {"x-csrf-token": csrf}
    data = {"epid": epid}
    r = requests.post(
        f"https://{HOST}/ajax/getExtraLinks",
        data=data,
        headers=headers,
        cookies=cookies,
        timeout=1
    )
    links = r.json()["links"]
    for link in links:
        link["name"] = link["name"].split("-")[1].lower().strip()
    return links


def get_schedule():
    r = requests.get(f"https://{HOST}/lich-chieu-phim.html", timeout=1)
    soup = BeautifulSoup(r.text, "html.parser")
    schedules = []
    for day in soup.find_all(class_="lcp-films"):
        schedule = {}
        for film in day.find_all(class_="lcp-film"):
            url = film.find("a").get("href")
            id = url.split("/")[-1].split("-")[0][1:]
            schedule[id] = url
        schedules.append(schedule)
    return schedules


def get_season(year, season):
    r = requests.get(f"https:/{HOST}/tim-kiem/q{season}_{year}.html", timeout=1)
    soup = BeautifulSoup(r.text, "html.parser")
    pages = sorted(
        set([a.get("href") for a in soup.find(class_="pagination").find_all("a")])
    )
    urls = []
    urls += [a.find("a").get("href") for a in soup.find_all(class_="film_item_inner")]
    for page in pages:
        r = requests.get(page)
        soup = BeautifulSoup(r.text, "html.parser")
        urls += [
            a.find("a").get("href") for a in soup.find_all(class_="film_item_inner")
        ]
    urls = {url.split("/")[-1].split("-")[0][1:]: url for url in urls}

    return urls


def update_data():
    data = {}
    with open("data.jsonl", encoding="utf8") as f:
        for l in f:
            d = json.loads(l)
            if d and "id" in d:
                data[d["id"]] = d

    # with open("data.jsonl", "w", encoding="utf8") as f:
    #     f.write("\n".join([json.dumps(d, ensure_ascii=False) for d in sorted(data.values(), key=lambda x:int(x["id"]), reverse=True)]))

    urls = get_animetvn_films()
    update_ids = set([id for id in urls if id not in data])
    schedule_ids = [id for d in get_schedule() for id in d]
    update_ids.update(schedule_ids)
    print("Schedule", len(schedule_ids))
    # season_ids = list(get_season(2020,4).keys())
    # update_ids.update(season_ids)
    # print("Season", len(season_ids))
    print(len(urls), len(data), len(update_ids), len(schedule_ids))

    new_data = {}
    index = 0
    for i, url in enumerate(list(urls.values())):
        id = url.split("/")[-1].split("-")[0][1:]
        if id in update_ids:
            index += 1
            info = get_film_info(url)
            if info:
                old_num = 0
                if id in data:
                    old_num = max([len(s["episodes"]) for s in data[id]["subs"]] + [0])

                new_num = max([len(s["episodes"]) for s in info["subs"]] + [0])

                print(
                    f"{index}/{len(update_ids)}",
                    info["id"],
                    old_num,
                    new_num,
                    info["name"],
                )
                new_data[info["id"]] = info
                data[info["id"]] = info
        else:
            new_data[id] = data[id]

    print("New", len(new_data), len(data))
    if len(new_data) >= len(data):
        with open("data.jsonl", "w", encoding="utf8") as f:
            f.write(
                "\n".join(
                    [json.dumps(d, ensure_ascii=False) for d in new_data.values()]
                )
            )


if __name__ == "__main__":
    # update_data()

    # get_film_info("https://animetvn4.com/thong-tin-phim/f7091-fairy-tail-100-years-quest.html")

    res = get_episode_info(188379)
    print(res)

    d = get_episode_link(res[0]["id"], res[0]["link"])
    print(d)

    print(requests.get(d["link"], timeout=5).text)