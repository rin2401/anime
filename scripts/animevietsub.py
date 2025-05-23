import subprocess
import re
import os
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from tqdm import tqdm
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from sele import fetch, driver, crawl_m3u8
from fire import update_ep

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
    output = result.stderr.decode('latin1') if result.stderr else result.stdout.decode('latin1')

    # Find all HTTP/HTTPS URLs in the output
    urls = re.findall(r'https?://.[^\s\'"<>]+', output)
    urls = set(urls)
    for url in urls:
        if "googleusercontent" in url:
            return url


def process_line(line, retries=5, sleep_sec=5):
    if "https://stream.googleapiscdn.com" in line:
        # print(line)
        for attempt in range(retries):
            new_url = get_url(line)
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

def update_m3u8(FILE, max_workers=4, sleep_sec=5, retries=5):
    with open(FILE) as f:
        lines = [line.strip() for line in f.readlines()]

    done = False
    while not done:
        print(">>> New turn")
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            lines = list(tqdm(executor.map(partial(process_line, retries=retries, sleep_sec=sleep_sec), lines), total=len(lines)))
        
        done = True
        for x in lines:
            if "https://stream.googleapiscdn.com" in x:
                done = False
                break

    # Ensure each line ends with a newline
    with open(FILE, "w") as f:
        f.writelines(line + "\n" for line in lines)


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

    update_m3u8(path)

    m3u8_data = open(path).read()
    return update_ep(title, m3u8_data, fire_path)

def crawl_ep(url, title=None):
    ep, id = url.rsplit(".", 1)[0].split("-")[-2:]
    if not id.isnumeric():
        return None

    fire_path =  f"animevietsub/{id}"
    path = update_animevietsub(url, fire_path, title=title)
    return path

def crawl_animevietsub(url, title=None, last=False):
    with open("animevietsub.txt", "a") as f:
        f.write(url + "\n")
    driver.get(url)
    WebDriverWait(driver, 15).until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, "li.episode"))
    )
    links = driver.find_elements(By.CSS_SELECTOR, "li.episode a")

    urls = [link.get_attribute("href") for link in links]
    if last:
        urls = urls[-1:]
    print(urls)    

    lines = []
    for url in urls:
        ep, id = url.rsplit(".", 1)[0].split("-")[-2:]
        if ep.isnumeric():
            ep = int(ep)

        ep_title = None
        if title:
            ep_title = f"{title} - {ep}"

        path = crawl_ep(url, title=ep_title)
        if not path:
            path = url
        
        line = f"{ep}: {path}"
        lines.append(line)
        print(line)
        with open("animevietsub.txt", "a") as f:
            f.write(line + "\n")

    return "\n".join(lines)

if __name__ == "__main__":
    # url = "https://animevietsub.lol/phim/one-piece-vua-hai-tac-a1/tap-special6-105606.html"
    # path = crawl_animevietsub(url, title="One Piece", last=True)    

    url = "https://animevietsub.lol/phim/shin-samurai-den-yaiba-a5607/tap-01-105590.html"
    path = crawl_animevietsub(url, title="Shin Samurai-den YAIBA", last=True)    
    print(path)