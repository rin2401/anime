import subprocess
import re


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

from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor

FILE="wave.m3u"

with open(FILE) as f:
    lines = [line.strip() for line in f.readlines()]

import time
from functools import partial

def process_line(line, retries=3, sleep_sec=3):
    if "https://stream.googleapiscdn.com" in line:
        # print(line)
        for attempt in range(retries):
            new_url = get_url(line)
            if new_url:
                # print(new_url)
                return new_url
            else:
                print(f"Retry {attempt+1}/{retries} failed, sleeping {sleep_sec}s...")
                time.sleep(sleep_sec)
        print("Error:", line)
        return line
    else:
        return line

with ThreadPoolExecutor(max_workers=4) as executor:
    new_lines = list(tqdm(executor.map(partial(process_line, retries=3, sleep_sec=2), lines), total=len(lines)))

# Ensure each line ends with a newline
with open(FILE, "w") as f:
    f.writelines(line + "\n" for line in new_lines)
