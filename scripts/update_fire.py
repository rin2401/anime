import firebase_admin
from firebase_admin import credentials
from firebase_admin import db

cred = credentials.Certificate("r3fire.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://r3fire.firebaseio.com'
})


ref = db.reference('/anime/78/5')
data = ref.get()
print(data)