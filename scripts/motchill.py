
import subprocess
from update_fire import update_ep

text = """1: https://www.motchill83.com/pmm2/0ff490a2b03ebf86bb40b109fedd461d.m3u8
2: https://www.motchill83.com/pmm2/9828e93e59a29f02d878ef74a14bc58d.m3u8
3: https://www.motchill83.com/pmm2/e0d2a9eae5f34abb26c73b11e32e40ce.m3u8
4: https://www.motchill83.com/pmm2/71eb70eb6d7f57d5254be4af09bd2829.m3u8
5: https://www.motchill83.com/pmm2/b207b69617b3de76711e9eddcc79c2ac.m3u8
6: https://www.motchill83.com/pmm2/8dd8ab30b4d99468639424bd9316f166.m3u8"""


def get_m3u8(url):
    curl_command = f"curl -sL '{url}'"
    result = subprocess.run(curl_command, shell=True, capture_output=True)
    output = result.stdout.decode('utf-8')
    return output


paths = []

for x in text.split("\n"):
    print(x)
    ep, url = x.split(": ")
    m3u8 = get_m3u8(url)

    path = update_ep(f"The Eternaut - {ep}", m3u8, f"anime/78/{ep}")
    paths.append(f"{ep}: {path}")


print("\n".join(paths))
