from google_search import custom_search
from animevietsub import crawl_ep
from sheet import add_row
from anilist import crawl_anilist


def get_anilist_stream(id, url=None, search=False):
    d = crawl_anilist(id)
    print(d)

    title = d["title_romaji"]
    print(title)

    if not url and search==True:
        urls = []
        # urls = animevietsub_search(title)
        # print("animevietsub_search:", urls)
        if len(urls) != 1:
            query = f"{title} site:animevietsub.lol"
            print("Search:", query)
            res = custom_search(query)
            print(res)
            urls = [x["original_url"] for x in res]
            print("google_search:", urls)

        if urls:
            url = urls[0]

    category = ""
    if d.get("format") == "MOVIE":
        category = "Movie"
    elif d.get("format") == "TV":
        category = "TV Show"


    row = {
        "id": id,
        "name": title,
        "image": d["image"],
        "year": d["start_date"]["year"],
        "anilist_id": id,
        "category": category,
    }

    if url:
        row["url"] = url
        if row["category"] == "Movie":
            p = crawl_ep(url, title=title)
            row["episodes"] = f"1: {p}"

    print(row)
    add_row(row)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        get_anilist_stream(int(sys.argv[1]))
    elif len(sys.argv) > 2:
        get_anilist_stream(int(sys.argv[1]), sys.argv[2])
