import os
import requests
import random
from bs4 import BeautifulSoup
from urllib.parse import unquote
from dotenv import load_dotenv
load_dotenv()

def get_useragent():
    """
    Generates a random user agent string mimicking the format of various software versions.

    The user agent string is composed of:
    - Lynx version: Lynx/x.y.z where x is 2-3, y is 8-9, and z is 0-2
    - libwww version: libwww-FM/x.y where x is 2-3 and y is 13-15
    - SSL-MM version: SSL-MM/x.y where x is 1-2 and y is 3-5
    - OpenSSL version: OpenSSL/x.y.z where x is 1-3, y is 0-4, and z is 0-9

    Returns:
        str: A randomly generated user agent string.
    """
    lynx_version = (
        f"Lynx/{random.randint(2, 3)}.{random.randint(8, 9)}.{random.randint(0, 2)}"
    )
    libwww_version = f"libwww-FM/{random.randint(2, 3)}.{random.randint(13, 15)}"
    ssl_mm_version = f"SSL-MM/{random.randint(1, 2)}.{random.randint(3, 5)}"
    openssl_version = (
        f"OpenSSL/{random.randint(1, 3)}.{random.randint(0, 4)}.{random.randint(0, 9)}"
    )
    return f"{lynx_version} {libwww_version} {ssl_mm_version} {openssl_version}"


def _req(term, results, lang, start, timeout, safe, region):
    resp = requests.get(
        url="https://www.google.com/search",
        headers={"User-Agent": get_useragent(), "Accept": "*/*"},
        params={
            "q": term,
            "num": results + 2,
            "hl": lang,
            "start": start,
            "safe": safe,
            "gl": region,
        },
        timeout=timeout,
        cookies={
            "CONSENT": "PENDING+987",
            "SOCS": "CAESHAgBEhIaAB",
        },
    )

    return resp


def search(
    term,
    max_results=5,
    lang="vi",
    timeout=5,
    safe="active",
    region="vn",
):
    resp = _req(
        term,
        results=max_results,
        lang=lang,
        start=0,
        timeout=timeout,
        safe=safe,
        region=region,
    )

    if resp.status_code != 200:
        print(f"Googe status code: {resp.status_code}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    result_block = soup.find_all("div", class_="ezO2md")

    search_results = []
    for result in result_block:
        link_tag = result.find("a", href=True)
        title_tag = link_tag.find("span", class_="CVA68e") if link_tag else None
        description_tag = result.find("span", class_="FrIlee")

        if link_tag and title_tag and description_tag:
            link = (
                unquote(link_tag["href"].split("&")[0].replace("/url?q=", ""))
                if link_tag
                else ""
            )
        link = (
            unquote(link_tag["href"].split("&")[0].replace("/url?q=", ""))
            if link_tag
            else ""
        )

        title = title_tag.text if title_tag else ""
        description = description_tag.text if description_tag else ""

        if not link.startswith("http") or not title:
            continue

        doc = {
            "title": title.strip(),
            "original_url": link.strip(),
            "description": description.strip(),
        }
        search_results.append(doc)

    search_results = search_results[:max_results]

    return search_results


# https://programmablesearchengine.google.com
CUSTOM_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
CUSTOM_SEARCH_ID = "002936587990369337555:u8uwfn5fvhe"
CUSTOM_SEARCH_API_KEY = os.getenv("CUSTOM_SEARCH_API_KEY")


def custom_search(query, max_results=10):
    params = {
        "key": CUSTOM_SEARCH_API_KEY,
        "cx": CUSTOM_SEARCH_ID,
        "q": query,
        "start": 0,
        "num": max_results,
        "safe": "off",
        "filter": 1,
    }

    response = requests.get(CUSTOM_SEARCH_URL, params=params)
    response.raise_for_status()

    res = response.json()
    search_results = []


    for d in res.get("items", []):
        if d.get("mime") == "application/pdf":
            continue

        doc = {
            "title": d["title"],
            "original_url": d["link"],
            "description": d.get("snippet"),
        }
        search_results.append(doc)

    search_results = search_results[:max_results]

    return search_results
