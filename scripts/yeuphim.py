import os
import json
from sele import driver, crawl_m3u8, fetch
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from tqdm.auto import tqdm

def update_yeuphim(url, timeout=10):
    file_url, title = crawl_m3u8(url, timeout=timeout)
    if not file_url:
        return None

    bytes = fetch(file_url)
    m3u8 = bytes.decode("utf-8")

    for line in m3u8.split("\n"):
        if "/hls/" in line:
            file_url = file_url.rsplit("/", 1)[0] + "/" + line
            break

    return file_url

def crawl_yeuphim(url):
    # with open("yeuphim.txt", "a") as f:
    #     f.write(url + "\n")

    driver.get(url)
    # Wait until the episode links are present
    WebDriverWait(driver, 15).until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a.episode"))
    )
    # Get all links on the page
    links = driver.find_elements(By.CSS_SELECTOR, "a.episode")

    # Extract href attributes
    urls = [link.get_attribute("href") for link in links]
    print(urls)    

    M = {}

    name = url.split("/")[-2]
    file_path = f"yeuphim/{name}.jsonl"
    if os.path.exists(file_path):
        with open(file_path) as f:
            for l in f:
                d = json.loads(l)
                M[d["id"]] = d["path"]

    lines = []
    for url in tqdm(urls):
        ep, id = url.split("/")[-1].split("-")[-2:]
        id = int(id)
        ep = int(ep)
        if id in M:
            path = M[id]
        else:
            path = update_yeuphim(url.replace(str(id), str(id-1)), timeout=5)
            if not path:
                path = update_yeuphim(url, timeout=5)
            if not path:
                continue
            with open(file_path, "a") as f:
                f.write(json.dumps({"id": id, "ep": ep, "path": path}) + "\n")
        
        line = f"{ep}: {path}"
        lines.append(line)
        # print(line)
        with open("yeuphim.txt", "a") as f:
            f.write(line + "\n")

    return "\n".join(lines)

if __name__ == "__main__":
    import sys
    url = sys.argv[1]
    print(crawl_yeuphim(url))