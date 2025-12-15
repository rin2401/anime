import subprocess
import re
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from tqdm import tqdm
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

import gspread
from oauth2client.service_account import ServiceAccountCredentials

from sele import fetch, driver, crawl_m3u8
from fire import db, update_ep


def get_url(url):
    curl_command = f"""curl -I -L -v '{url}' \
--header 'accept: */*' \
--header 'accept-language: en-US,en;q=0.9,vi;q=0.8' \
--header 'origin: https://animevietsub.lol' \
--header 'priority: u=1, i' \
--header 'referer: https://animevietsub.lol/' \
--header 'sec-ch-ua: "Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"' \
--header 'sec-ch-ua-mobile: ?0' \
--header 'sec-ch-ua-platform: "macOS"' \
--header 'sec-fetch-dest: empty' \
--header 'sec-fetch-mode: cors' \
--header 'sec-fetch-site: cross-site' \
--header 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'"""

    result = subprocess.run(curl_command, shell=True, capture_output=True)

    # Use latin1 to avoid decode errors with binary data in headers
    output = (
        result.stderr.decode("latin1")
        if result.stderr
        else result.stdout.decode("latin1")
    )

    # Find all HTTP/HTTPS URLs in the output
    urls = re.findall(r'https?://.[^\s\'"<>]+', output)
    urls = set(urls)
    for url in urls:
        if "googleusercontent" in url:
            return url


def driver_get_url(url):
    script = """
var url = arguments[0];
var callback = arguments[1];
res = await fetch(url, {
  method: 'HEAD'
})
callback(res)
"""
    try:
        result = driver.execute_async_script(
            script,
            url,
        )
        print(result["url"])
        return result["url"]
    except Exception as e:
        pass

    return None


def process_line(line, retries=5, sleep_sec=5):
    if "googleapiscdn.com" in line:
        # print(line)
        for attempt in range(retries):
            new_url = driver_get_url(line)
            if new_url:
                # print(new_url)
                return new_url
            else:
                # print(f"Retry {attempt+1}/{retries} failed, sleeping {sleep_sec}s...")
                time.sleep(sleep_sec)
        print("Error:", line)
        return line
    else:
        return line


def update_m3u8(FILE, max_workers=4, sleep_sec=1, retries=1):
    with open(FILE) as f:
        lines = [line.strip() for line in f.readlines()]

    done = False
    while not done:
        print(">>> New turn")
        for i in range(0, len(lines), 100):
            batch = lines[i : i + 100]

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                batch = list(
                    tqdm(
                        executor.map(
                            partial(process_line, retries=retries, sleep_sec=sleep_sec),
                            batch,
                        ),
                        total=len(batch),
                    )
                )

            lines[i : i + 100] = batch

            with open(FILE, "w") as f:
                f.writelines(line + "\n" for line in lines)

        done = True
        for x in lines:
            if "https://stream.googleapiscdn.com" in x:
                done = False
                break


def update_animevietsub(url, fire_path, title=None):
    id = url.split("-")[-1].split(".")[0]
    path = f"animevietsub/{id}.m3u8"

    print(path)
    if not os.path.exists(path):
        file_url, title_url = crawl_m3u8(url)
        if not file_url:
            return None
        if not title:
            title = title_url

        bytes = fetch(file_url)

        with open(path, "wb") as f:
            f.write(bytes)

    update_m3u8(path, max_workers=2, sleep_sec=1, retries=1)

    m3u8_data = open(path).read()
    return update_ep(title, m3u8_data, fire_path)


def crawl_ep(url, title=None):
    ep, id = url.rsplit(".", 1)[0].split("-")[-2:]
    if not id.isnumeric():
        return None

    fire_path = f"animevietsub/{id}"
    path = update_animevietsub(url, fire_path, title=title)
    return path


def crawl_animevietsub(url, title=None, slug=None, last=0):
    ref = db.reference(f"anime/{slug}")
    fdata = ref.get()
    eps = set()

    if fdata:
        if type(fdata) == dict:
            fdata = list(fdata.values())
        for x in fdata:
            if not x or not x.get("id"):
                continue

            eps.add(x["id"])

    with open("animevietsub.txt", "a") as f:
        f.write(url + "\n")
    driver.get(url)

    print("Wait 15s")
    WebDriverWait(driver, 15).until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, "li.episode"))
    )
    links = driver.find_elements(By.CSS_SELECTOR, "li.episode a")

    urls = [link.get_attribute("href") for link in links]
    if last > 0:
        urls = urls[-last:]
    print(urls)

    lines = []
    for url in urls:
        ep, id = url.rsplit(".", 1)[0].split("-")[-2:]
        if ep.isnumeric():
            ep = int(ep)

        if str(ep) in eps:
            continue

        ep_title = None
        if title:
            ep_title = f"{title} - {ep}"

        path = crawl_ep(url, title=ep_title)
        if not path:
            path = url

        line = f"{ep}: {path}"
        print(line)
        with open("animevietsub.txt", "a") as f:
            f.write(line + "\n")

        lines.append({"id": id, "ep": ep, "path": path, "title": ep_title})

        item = {
            "file": path,
            "id": ep,
            "title": ep_title,
            "type": "hls",
        }

        updates = {}
        new_key = str(item["id"])
        updates[f"anime/{slug}/{new_key}"] = item

        db.reference().update(updates)

    return lines


def animevietsub_search(query):
    url = "https://animevietsub.lol/ajax/suggest"

    payload = {"ajaxSearch": "1", "keysearch": query}
    headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    }

    response = requests.post(url, headers=headers, data=payload)

    res = re.findall('<a href="(http.*?)"', response.text)

    return res


def crawl(anilist_id, last=0):
    # Google Sheets setup
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name("keys.json", scope)
    client = gspread.authorize(creds)

    # Change these to your sheet key and worksheet id
    SHEET_KEY = "12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA"
    WORKSHEET_ID = 1193967919

    db = client.open_by_key(SHEET_KEY)
    sheet = db.get_worksheet_by_id(WORKSHEET_ID)
    records = sheet.get_all_records()
    row = None
    for i, x in enumerate(records):
        if str(x["id"]) == anilist_id or str(x["playlist"]) == anilist_id:
            row = x
            break
    if not row:
        return None

    print(row)

    if not row["url"]:
        return None

    crawl_animevietsub(row["url"], title=row["name"], slug=anilist_id, last=last)


if __name__ == "__main__":
    crawl("dao-hai-tac", last=3)
    crawl("185660")
    crawl("189117")
    crawl("177937")
    crawl("182896")
    crawl("153800")
