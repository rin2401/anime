from sele import driver, crawl_m3u8, fetch
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def update_yeuphim(url):
    file_url, title = crawl_m3u8(url)
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

    lines = []
    for url in urls:
        ep, id = url.split("/")[-1].split("-")[-2:]
        ep = int(ep)
        path = update_yeuphim(url)
        line = f"{ep}: {path}"
        lines.append(line)
        print(line)

    return "\n".join(lines)

if __name__ == "__main__":
    url = "https://yeuphim.sbs/xem-phim/thang-cap-manh-nhat/tap-01-163994"
    print(crawl_yeuphim(url))