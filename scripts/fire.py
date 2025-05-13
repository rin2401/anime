import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

DB_URL = "https://r3fire.firebaseio.com"

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': DB_URL
})

def update_ep(title, m3u8_data, fire_path):
    users_ref = db.reference(fire_path)
    users_ref.update({
        "title": title,
        'm3u8': m3u8_data
    })

    return f"{DB_URL}/{fire_path}.json"