import os
import requests 
from dotenv import load_dotenv
load_dotenv()


def get_fb(url):            
    RAPID_API_KEY = os.getenv("RAPID_API_KEY")
    if not RAPID_API_KEY:
        raise Exception("RAPID_API_KEY not found")

    api_url = "https://facebook-reel-and-video-downloader.p.rapidapi.com/app/main.php"

    params = {
        "url": url
    }
    headers = {
        'x-rapidapi-host': 'facebook-reel-and-video-downloader.p.rapidapi.com',
        'x-rapidapi-key': RAPID_API_KEY
    }

    response = requests.get(api_url, headers=headers, params=params)

    return response.json()

if __name__ == "__main__":
    print(get_fb("https://www.facebook.com/reel/1187362698778788"))
