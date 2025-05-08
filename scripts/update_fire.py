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

with open("gionoi_new.m3u") as f:
    m3u8 = f.read()



users_ref = db.reference('/anime/21/1')
users_ref.update({
    'm3u8': m3u8
})