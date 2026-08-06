"""CLI tra cứu AniList (metadata anime công khai — https://anilist.co).

    cd anime/scripts
    uv run python anilist_cli.py search "one piece"
    uv run python anilist_cli.py search "one piece" --limit 10
    uv run python anilist_cli.py get 21
    uv run python anilist_cli.py get 21 --json
"""

import argparse
import json
import sys

from anilist import search_anilist, api_anilist, extract_info


def _title(media):
    title = media.get("title", {})
    return title.get("english") or title.get("romaji") or title.get("native") or "?"


def cmd_search(args):
    results = search_anilist(args.query)
    if not results:
        print(f"Không tìm thấy kết quả cho: {args.query}")
        return 1
    for media in results[: args.limit]:
        year = (media.get("startDate") or {}).get("year") or "?"
        print(f"[{media['id']}] {_title(media)} ({year}) — {media.get('episodes') or '?'} tập")
    return 0


def cmd_get(args):
    anime = api_anilist(args.id)
    if not anime:
        return 3
    info = extract_info(anime)
    if args.json:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    print(f"[{info['id']}] {info['title_english'] or info['title_romaji']}")
    if info["title_native"]:
        print(f"  Tên gốc: {info['title_native']}")
    print(f"  Trạng thái: {info['status']} | Định dạng: {info['format']}")
    print(f"  Tập: {info['current_episodes']}/{info['episodes'] or '?'}")
    if info["next_episode_time"]:
        print(f"  Tập tiếp theo phát lúc (unix): {info['next_episode_time']}")
    print(f"  Điểm trung bình: {info['average_score']}")
    print(f"  Thể loại: {', '.join(info['genres'] or [])}")
    print(f"  URL: {info['url']}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_search = sub.add_parser("search", help="Tìm anime theo tên trên AniList")
    p_search.add_argument("query")
    p_search.add_argument("--limit", type=int, default=5)
    p_search.set_defaults(func=cmd_search)

    p_get = sub.add_parser("get", help="Lấy chi tiết anime theo AniList ID")
    p_get.add_argument("id", type=int)
    p_get.add_argument("--json", action="store_true")
    p_get.set_defaults(func=cmd_get)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
