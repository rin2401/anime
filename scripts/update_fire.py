import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://r3fire.firebaseio.com'
})


# ref = db.reference('/anime/78/5')
# data = ref.get()
# print(data)


def update_ep(id, title, m3u8_path):
    users_ref = db.reference(f'/anime/{id}/1')
    users_ref.update({
        "title": title,
        'm3u8': open(m3u8_path).read()
    })