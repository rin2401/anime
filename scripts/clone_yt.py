import requests
import json
from datetime import datetime
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from dotenv import load_dotenv
import os

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/youtube"]


def get_authenticated_service(client_secrets_file="client_secret.json"):
    flow = InstalledAppFlow.from_client_secrets_file(client_secrets_file, SCOPES)
    credentials = flow.run_local_server(port=0, prompt="consent", authorization_prompt_message="")
    return build("youtube", "v3", credentials=credentials)


def create_new_playlist(youtube, playlist_info):
    request = youtube.playlists().insert(
        part="snippet,status",
        body={
            "snippet": {
                "title": f"[CLONE] {playlist_info['title']}",
                "description": playlist_info["description"],
            },
            "status": {"privacyStatus": "private"},
        },
    )
    response = request.execute()
    return response["id"]


def add_videos_to_playlist(youtube, new_playlist_id, videos):
    for video in videos:
        youtube.playlistItems().insert(
            part="snippet",
            body={
                "snippet": {
                    "playlistId": new_playlist_id,
                    "resourceId": {
                        "kind": "youtube#video",
                        "videoId": video["video_id"],
                    },
                    "position": video["position"] - 1,
                }
            },
        ).execute()


class YouTubePlaylistClone:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://www.googleapis.com/youtube/v3"
    
    def extract_playlist_id(self, url):
        """Trích xuất playlist ID từ URL"""
        if "list=" in url:
            return url.split("list=")[1].split("&")[0]
        return url
    
    def get_playlist_info(self, playlist_id):
        """Lấy thông tin playlist"""
        url = f"{self.base_url}/playlists"
        params = {
            "part": "snippet,contentDetails",
            "id": playlist_id,
            "key": self.api_key
        }
        
        response = requests.get(url, params=params)
        if response.status_code != 200:
            raise Exception(f"Lỗi API: {response.json().get('error', {}).get('message', 'Unknown error')}")
        
        data = response.json()
        if not data.get("items"):
            raise Exception("Không tìm thấy playlist")
        
        item = data["items"][0]
        return {
            "id": playlist_id,
            "title": item["snippet"]["title"],
            "description": item["snippet"]["description"],
            "channel": item["snippet"]["channelTitle"],
            "video_count": item["contentDetails"]["itemCount"],
            "published_at": item["snippet"]["publishedAt"]
        }
    
    def get_playlist_videos(self, playlist_id, max_results=50):
        """Lấy danh sách video trong playlist"""
        videos = []
        next_page_token = None
        
        while True:
            url = f"{self.base_url}/playlistItems"
            params = {
                "part": "snippet,contentDetails",
                "playlistId": playlist_id,
                "maxResults": min(max_results, 50),
                "key": self.api_key
            }
            
            if next_page_token:
                params["pageToken"] = next_page_token
            
            response = requests.get(url, params=params)
            if response.status_code != 200:
                raise Exception(f"Lỗi API: {response.json().get('error', {}).get('message', 'Unknown error')}")
            
            data = response.json()
            
            for item in data.get("items", []):
                video = {
                    "position": item["snippet"]["position"] + 1,
                    "video_id": item["contentDetails"]["videoId"],
                    "title": item["snippet"]["title"],
                    "description": item["snippet"]["description"],
                    "channel": item["snippet"]["channelTitle"],
                    "published_at": item["snippet"]["publishedAt"],
                    "thumbnail": item["snippet"]["thumbnails"]["high"]["url"],
                    "url": f"https://www.youtube.com/watch?v={item['contentDetails']['videoId']}"
                }
                videos.append(video)
            
            next_page_token = data.get("nextPageToken")
            if not next_page_token or len(videos) >= max_results:
                break
        
        return videos[:max_results]
    
    def clone_playlist(self, playlist_url, max_results=50):
        """Clone toàn bộ playlist"""
        playlist_id = self.extract_playlist_id(playlist_url)
        
        print(f"🔍 Đang tải playlist: {playlist_id}")
        
        playlist_info = self.get_playlist_info(playlist_id)
        print(f"📌 Playlist: {playlist_info['title']}")
        print(f"👤 Kênh: {playlist_info['channel']}")
        print(f"📊 Số video: {playlist_info['video_count']}")
        print()
        
        videos = self.get_playlist_videos(playlist_id, max_results)
        print(f"✅ Đã tải {len(videos)} video")
        
        return {
            "playlist": playlist_info,
            "videos": videos,
            "cloned_at": datetime.now().isoformat()
        }
    
    def save_to_json(self, data, filename):
        """Lưu dữ liệu ra file JSON"""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"💾 Đã lưu vào file: {filename}")
    
    def save_to_txt(self, data, filename):
        """Lưu danh sách URL ra file TXT"""
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"Playlist: {data['playlist']['title']}\n")
            f.write(f"Kênh: {data['playlist']['channel']}\n")
            f.write(f"Tổng số video: {len(data['videos'])}\n")
            f.write("=" * 80 + "\n\n")
            
            for video in data['videos']:
                f.write(f"[{video['position']}] {video['title']}\n")
                f.write(f"    URL: {video['url']}\n")
                f.write(f"    Kênh: {video['channel']}\n\n")
        
        print(f"📝 Đã lưu vào file: {filename}")


def main():
    print("=" * 80)
    print("🎥 YOUTUBE PLAYLIST CLONE".center(80))
    print("=" * 80)
    print()
    
    # Nhập API key
    api_key = os.getenv("YOUTUBE_API_KEY")
    
    # Nhập URL playlist
    playlist_url = input("🔗 Nhập URL Playlist: ").strip()
    if not playlist_url:
        print("❌ URL không được để trống!")
        return
    
    # Nhập số lượng video tối đa
    try:
        max_results = int(input("📊 Số video tối đa cần tải (mặc định 50): ").strip() or "50")
    except ValueError:
        max_results = 50
    
    print()
    print("-" * 80)
    
    try:
        # Clone playlist (chỉ đọc dữ liệu bằng API key)
        cloner = YouTubePlaylistClone(api_key)
        data = cloner.clone_playlist(playlist_url, max_results)

        # Lưu JSON theo playlist_id gốc
        playlist_id = data["playlist"]["id"]
        json_filename = f"playlist_{playlist_id}.json"
        cloner.save_to_json(data, json_filename)

        # Xác thực OAuth và tạo playlist mới trên kênh người dùng
        print("\n🔐 Đang xác thực tài khoản YouTube (OAuth)...")
        youtube = get_authenticated_service()

        print("📁 Đang tạo playlist mới trên kênh của bạn...")
        new_playlist_id = create_new_playlist(youtube, data["playlist"])

        print("➕ Đang thêm video vào playlist mới...")
        add_videos_to_playlist(youtube, new_playlist_id, data["videos"])

        print()
        print("✨ Hoàn thành!")
        print(f"🎉 Playlist mới: https://www.youtube.com/playlist?list={new_playlist_id}")

    except Exception as e:
        print(f"\n❌ Lỗi: {str(e)}")


if __name__ == "__main__":
    main()