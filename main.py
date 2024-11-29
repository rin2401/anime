from flask import Flask, Response, render_template

app = Flask(__name__,
            static_url_path='/player', 
            static_folder='player',
            template_folder='')

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/player/')
def player():
    return render_template('player/index.html')

if __name__ == '__main__':
    app.run(host="localhost", port=5000)