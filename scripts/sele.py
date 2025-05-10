import os
import base64
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from fetch_stream import update_m3u8
from update_fire import update_ep

# Connect to existing Chrome started with remote debugging
chrome_options = Options()
# chrome_options.add_argument('--headless')
chrome_options.add_argument('--disable-gpu')
chrome_options.add_argument('--no-sandbox')
# chrome_options.add_experimental_option("debuggerAddress", "127.0.0.1:9222")

driver = webdriver.Chrome(options=chrome_options)


def get_file_content_chrome(uri):
    result = driver.execute_async_script("""
var uri = arguments[0];
var callback = arguments[1];
var toBase64 = function(buffer){for(var r,n=new Uint8Array(buffer),t=n.length,a=new Uint8Array(4*Math.ceil(t/3)),i=new Uint8Array(64),o=0,c=0;64>c;++c)i[c]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(c);for(c=0;t-t%3>c;c+=3,o+=4)r=n[c]<<16|n[c+1]<<8|n[c+2],a[o]=i[r>>18],a[o+1]=i[r>>12&63],a[o+2]=i[r>>6&63],a[o+3]=i[63&r];return t%3===1?(r=n[t-1],a[o]=i[r>>2],a[o+1]=i[r<<4&63],a[o+2]=61,a[o+3]=61):t%3===2&&(r=(n[t-2]<<8)+n[t-1],a[o]=i[r>>10],a[o+1]=i[r>>4&63],a[o+2]=i[r<<2&63],a[o+3]=61),new TextDecoder("ascii").decode(a)};
var xhr = new XMLHttpRequest();
xhr.responseType = 'arraybuffer';
xhr.onload = function(){ callback(toBase64(xhr.response)) };
xhr.onerror = function(){ callback(xhr.status) };
xhr.open('GET', uri);
xhr.send();
""", uri)
    if type(result) == int :
        raise Exception("Request failed with status %s" % result)
    return base64.b64decode(result)

def crawl_m3u8(url):
    try:
        driver.get(url)
    except Exception as e:
        print("Error:", url)
        return None
    
    print(driver.title)

    if not driver.title:
        return None

    WebDriverWait(driver, 20).until(
        lambda d: d.execute_script("return typeof jwplayer === 'function' && typeof jwplayer().getPlaylist === 'function';")
    )

    js_code = "return jwplayer().getPlaylist();"
    res = driver.execute_script(js_code)

    file_url = res[0]["allSources"][0]["file"]
    print('File URL:', file_url)

    return file_url



def update_animevietsub(url, title, id):
    id = url.split("-")[-1].split(".")[0]
    path = f"{id}.m3u8"

    print(path)
    if os.path.exists(path):
        return path

    file_url = crawl_m3u8(url)
    if not file_url:
        return None

    bytes = get_file_content_chrome(file_url)

    with open(path, "wb") as f:
        f.write(bytes)

    update_m3u8(path)
    return update_ep(id, title, path)


def update_yeuphim(url, title, id):
    file_url = crawl_m3u8(url)
    if not file_url:
        return None

    bytes = get_file_content_chrome(file_url)
    m3u8 = bytes.decode("utf-8")

    for line in m3u8.split("\n"):
        if "/hls/" in line:
            file_url = file_url.rsplit("/", 1)[0] + "/" + line
            break

    return file_url