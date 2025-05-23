
import subprocess
from fire import update_ep
from sele import crawl_m3u8


def get_m3u8_content(url):
    curl_command = f"curl -sL '{url}'"
    result = subprocess.run(curl_command, shell=True, capture_output=True)
    output = result.stdout.decode('utf-8')
    return output


def update_stream(text):
    paths = []

    for x in text.split("\n"):
        print(x)
        ep, url = x.split(": ")
        m3u8 = get_m3u8_content(url)

        path = update_ep(f"Tiệm ăn của quỷ - {ep}", m3u8, f"anime/78/{ep}")
        paths.append(f"{ep}: {path}")


    print("\n".join(paths))


if __name__ == "__main__":
    text = """1: https://www.motchill84.com/pmm2/cf1646bc423de62e9a04de479b0bf850.m3u8
2: """
    # update_stream(text)

    print(crawl_m3u8("https://www.motchill84.com/phim/tiem-an-cua-quy/tap-2"))
