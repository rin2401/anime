import os
import re
import json
import requests
from dotenv import load_dotenv

load_dotenv()


def get_fb_rapid(url):
    RAPID_API_KEY = os.getenv("RAPID_API_KEY")
    if not RAPID_API_KEY:
        raise Exception("RAPID_API_KEY not found")

    api_url = "https://facebook-reel-and-video-downloader.p.rapidapi.com/app/main.php"

    params = {"url": url}
    headers = {
        "x-rapidapi-host": "facebook-reel-and-video-downloader.p.rapidapi.com",
        "x-rapidapi-key": RAPID_API_KEY,
    }

    response = requests.get(api_url, headers=headers, params=params)

    return response.json()


def get_fb(url):
    api_url = "https://facebook-video-downloader.fly.dev/app/main.php"
    payload = {"url": url}

    response = requests.post(api_url, data=payload)

    return response.json()


def get_facebook_video_info(url):
    result = {"success": False, "message": "", "id": "", "title": "", "links": {}}

    try:
        if not url:
            raise Exception("Please provide the URL")

        headers = {
            "sec-fetch-user": "?1",
            "sec-ch-ua-mobile": "?0",
            "sec-fetch-site": "none",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "cache-control": "max-age=0",
            "authority": "www.facebook.com",
            "upgrade-insecure-requests": "1",
            "accept-language": "en-GB,en;q=0.9,tr-TR;q=0.8,tr;q=0.7,en-US;q=0.6",
            "sec-ch-ua": '"Google Chrome";v="89", "Chromium";v="89", ";Not A Brand";v="99"',
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        }

        response = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
        response.raise_for_status()
        content = response.text

        result["success"] = True
        result["id"] = generate_id(url)
        result["title"] = get_title(content)

        if sd_link := get_sd_link(content):
            result["links"]["Download Low Quality"] = sd_link + "&dl=1"

        if hd_link := get_hd_link(content):
            result["links"]["Download High Quality"] = hd_link + "&dl=1"

    except Exception as e:
        result["message"] = str(e)

    return result


def generate_id(url):
    if isinstance(url, int):
        return url
    match = re.search(r"(\d+)/?$", url)
    return match.group(1) if match else ""


def clean_str(text):
    return json.loads(f'{{"text": "{text}"}}')["text"]


def get_sd_link(content):
    match = re.search(r'browser_native_sd_url":"([^"]+)"', content)
    return clean_str(match.group(1)) if match else None


def get_hd_link(content):
    match = re.search(r'browser_native_hd_url":"([^"]+)"', content)
    return clean_str(match.group(1)) if match else None


def get_title(content):
    title = None
    if match := re.search(r"<title>(.*?)<\/title>", content):
        title = match.group(1)
    elif match := re.search(r'title id="pageTitle">(.+?)<\/title>', content):
        title = match.group(1)
    return clean_str(title) if title else None


def get_description(content):
    if match := re.search(r'span class="hasCaption">(.+?)<\/span>', content):
        return clean_str(match.group(1))
    return None


if __name__ == "__main__":
    print(get_facebook_video_info("https://www.facebook.com/watch/?v=1923630328376712"))
