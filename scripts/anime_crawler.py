import requests
import json
import sys

def search_anilist(query):
    url = "https://graphql.anilist.co"
    graphql_query = '''
    query ($search: String) {
      Page(perPage: 5) {
        media(search: $search, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          description(asHtml: false)
          episodes
          averageScore
          genres
          startDate { year month day }
          endDate { year month day }
          siteUrl
        }
      }
    }
    '''
    variables = {"search": query}
    response = requests.post(url, json={"query": graphql_query, "variables": variables})
    if response.status_code != 200:
        print(f"Error: Failed to fetch data from AniList ({response.status_code})")
        return []
    data = response.json()
    return data.get('data', {}).get('Page', {}).get('media', [])

def crawl_anilist(anime_id):
    """
    Fetch anime details from AniList by anime ID.
    Returns a dict with anime info, or None if not found.
    """
    url = "https://graphql.anilist.co"
    graphql_query = '''
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title {
          romaji
          english
          native
        }
        description(asHtml: false)
        episodes
        averageScore
        genres
        startDate { year month day }
        endDate { year month day }
        siteUrl
        nextAiringEpisode {
          airingAt
          episode
        }
        status
      }
    }
    '''
    variables = {"id": anime_id}
    response = requests.post(url, json={"query": graphql_query, "variables": variables})
    if response.status_code != 200:
        print(f"Error: Failed to fetch data from AniList ({response.status_code})")
        return None
    data = response.json()
    anime = data.get('data', {}).get('Media', None)
    if not anime:
        print("Anime not found for id:", anime_id)
        return None
    return extract_info(anime)

def extract_info(anime):
    # Determine current episodes and next episode time
    next_ep = anime.get('nextAiringEpisode')
    episodes = anime.get('episodes')
    if next_ep and next_ep.get('episode'):
        current_episodes = next_ep['episode'] - 1
        next_episode_time = next_ep.get('airingAt')  # Unix timestamp
    else:
        current_episodes = episodes
        next_episode_time = None
    return {
        'id': anime.get('id'),
        'title_romaji': anime['title'].get('romaji'),
        'title_english': anime['title'].get('english'),
        'title_native': anime['title'].get('native'),
        'description': anime.get('description'),
        'episodes': episodes,
        'current_episodes': current_episodes,
        'next_episode_time': next_episode_time,
        'average_score': anime.get('averageScore'),
        'genres': anime.get('genres'),
        'start_date': anime.get('startDate'),
        'end_date': anime.get('endDate'),
        'url': anime.get('siteUrl'),
        'status': anime.get('status'),
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python anime_crawler.py <anime title>")
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    print(f"Searching AniList for: {query}\n")
    # results = search_anilist(query)
    # if not results:
    #     print("No results found.")
    #     return
    # infos = [extract_info(a) for a in results]
    # print(json.dumps(infos, indent=2, ensure_ascii=False))


    results = crawl_anilist(query)
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
