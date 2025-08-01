from flask import Flask, Response, render_template, Blueprint

app = Flask(__name__,
            static_url_path='/anime', 
            static_folder='./',
            template_folder='')

bp = Blueprint('anime', __name__, url_prefix='/anime')

@bp.route('/')
def home():
    return render_template('index.html')

@bp.route('/player/')
def player():
    return render_template('player/index.html')

@bp.route('/frame/')
def frame():
    return render_template('frame/index.html')

@bp.route('/yt/')
def yt():
    return render_template('yt/index.html')

@bp.route('/fb/')
def fb():
    return render_template('fb/index.html')

@bp.route('/auth/')
def auth():
    return render_template('auth/index.html')

@bp.route('/room/')
def room():
    return render_template('room/index.html')

@bp.route('/socket/')
def socket():
    return render_template('socket/index.html')

@bp.route('/jwplayer/')
def jwplayer():
    return render_template('jwplayer/index.html')

@bp.route('/r3player/')
def r3player():
    return render_template('r3player/index.html')

@bp.route('/artplayer/')
def artplayer():
    return render_template('artplayer/index.html')

app.register_blueprint(bp)

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8000, debug=True)