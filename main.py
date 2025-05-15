from flask import Flask, Response, render_template

app = Flask(__name__,
            static_url_path='/', 
            static_folder='./',
            template_folder='')

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/player/')
def player():
    return render_template('player/index.html')

@app.route('/frame/')
def frame():
    return render_template('frame/index.html')

@app.route('/yt/')
def yt():
    return render_template('yt/index.html')

@app.route('/fb/')
def fb():
    return render_template('fb/index.html')

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8000, debug=True)