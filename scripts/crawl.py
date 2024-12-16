import requests
import re
import gspread

gc = gspread.service_account("keys.json")
db = gc.open_by_key("12q04f4hwtVQjfVSUayDsgXLGGbqrl9urm8gp556nPQA")

wks0 = db.get_worksheet(0)
A = wks0.get_all_records()

for a in A:
    if "yeuphim" not in a["url"]:
        continue
    id = a["id"]
    url = a["url"]
    print("Anime:", id, url)

    res = requests.get(url).text

    ep_urls = re.findall(r'href="(https://yeuphim.cc/.*?tap-\d+.*?)"', res)
    # print(ep_urls)
    eps = {}
    for url in ep_urls:
        ep = int(re.findall(r"tap-(\d+)", url)[0])
        # print(eid)
        eps[ep] = url

    # print(eps)



    # Open a sheet from a spreadsheet in one go
    wks = db.get_worksheet(1)
    data = wks.get_all_records()
    done_eids = set([x["eid"] for x in data])

    # print(data)

    cols = wks.row_values(1)

    def add_row(item):
        wks.append_row([item.get(c, "") for c in cols])

    for ep, url in eps.items():
        eid = f"{id}_{ep}"
        if eid in done_eids:
            print("Done:", eid)
            continue
        item = {
            "eid": eid,
            "id": id,
            "ep": ep,
            "source": "yeuphim"
        }

        res = requests.get(url).text

        m3u8 = re.findall(r'data-link="(https://player.phimapi.com.*?)"', res)[0].split("?url=", 1)[1]
        item["m3u8"] = m3u8
        item["url"] = url

        print(item)
        add_row(item)

