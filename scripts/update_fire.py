import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

DB_URL = "https://r3fire.firebaseio.com"

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': DB_URL
})


# ref = db.reference('/anime/78/5')
# data = ref.get()
# print(data)


def update_ep(title, m3u8_path, fire_path):
    users_ref = db.reference(fire_path)
    users_ref.update({
        "title": title,
        'm3u8': open(m3u8_path).read()
    })

    return f"{DB_URL}/{fire_path}.json"