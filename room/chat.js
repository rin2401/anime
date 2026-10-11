// ── RoomChat — chat cho phòng xem chung ──
// Node room/{code}/chat: mỗi tin là một entry {uid, name, text, ts}, POST
// (PUSH) với idToken — rules cho phép mọi user đăng nhập ghi tin nhắn con
// node chat, còn state phát (url/pos/playing) vẫn chỉ host được ghi.
// Widget tự quản stream riêng cho node chat: EventSource + poll 4s (poll
// luôn chạy — webview cũ hay chết stream im lặng). Cả trang room lẫn trang
// artplayer (host) dùng chung file này.
//
// RoomChat.mount(el, getCode) — el là thẻ chứa panel (trang tự hiện/ẩn),
// getCode() trả mã phòng hiện tại (có thể null/ra sau khi host tạo phòng).
var RoomChat = (function () {
    var RTDB = 'https://r3fire.firebaseio.com';
    var MAX_RENDER = 80; // chỉ vẽ tin mới nhất — node không bao giờ bị dọn

    function esc(s) {
        return String(s || '').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function hhmm(ts) {
        var d = new Date(ts || 0);
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function ensureStyle() {
        if (document.getElementById('room-chat-style')) return;
        var st = document.createElement('style');
        st.id = 'room-chat-style';
        st.textContent = `
.room-chat { display:flex; flex-direction:column; font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif; color:#fff; }
.room-chat-list { flex:1; overflow-y:auto; padding:8px 10px; }
.room-chat-msg { margin:4px 0; word-wrap:break-word; }
.room-chat-msg b { color:#23ade5; margin-right:4px; }
.room-chat-msg.mine b { color:#7fd4ff; }
.room-chat-msg .t { color:rgba(255,255,255,.45); font-size:11px; margin-right:6px; }
.room-chat-msg.sys { color:rgba(255,255,255,.55); font-style:italic; }
.room-chat-input { display:flex; gap:6px; padding:8px; border-top:1px solid rgba(255,255,255,.15); }
.room-chat-input input { flex:1; min-width:0; background:#2b2f33; color:#fff; border:0; border-radius:8px; padding:8px 10px; outline:0; color-scheme:dark; }
.room-chat-input button { background:#23ade5; color:#fff; border:0; border-radius:8px; padding:0 12px; font-weight:700; cursor:pointer; }
.room-chat-empty { color:rgba(255,255,255,.5); padding:8px 10px; }
`;
        document.head.appendChild(st);
    }

    function mount(el, getCode) {
        ensureStyle();
        el.classList.add('room-chat');
        el.innerHTML = '<div class="room-chat-list"><div class="room-chat-empty">Chưa có tin nhắn nào — chào cả phòng nào 💬</div></div>' +
            '<div class="room-chat-input"><input type="text" maxlength="500" placeholder="Nhắn tin…" enterkeyhint="send">' +
            '<button type="button" aria-label="Gửi">➤</button></div>';
        var list = el.querySelector('.room-chat-list');
        var input = el.querySelector('input');
        var btn = el.querySelector('button');

        var msgs = {};      // id -> entry
        var order = [];     // id theo ts tăng dần
        var curCode = null;
        var es = null;

        function user() {
            return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
        }

        // Gửi: POST (PUSH) — id sinh phía server, thứ tự ts tự đúng
        function send() {
            var text = (input.value || '').trim();
            var u = user();
            if (!text) return;
            if (!curCode) return;
            if (!u) {
                systemMsg('Đăng nhập để chat — trang /anime/auth/');
                return;
            }
            var entry = { uid: u.uid, name: u.displayName || (u.email || '').split('@')[0], text: text, ts: Date.now() };
            input.value = '';
            u.getIdToken().then(function (tok) {
                return fetch(RTDB + '/room/' + curCode + '/chat.json?auth=' + tok, {
                    method: 'POST',
                    body: JSON.stringify(entry),
                });
            }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
            }).catch(function (e) {
                systemMsg('Gửi tin lỗi: ' + e.message);
            });
        }
        btn.addEventListener('click', send);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); send(); }
        });

        function systemMsg(text) {
            var empty = el.querySelector('.room-chat-empty');
            if (empty) empty.remove();
            var d = document.createElement('div');
            d.className = 'room-chat-msg sys';
            d.textContent = text;
            list.appendChild(d);
            list.scrollTop = list.scrollHeight;
        }

        // Gần đáy thì auto-scroll xuống khi có tin mới (đang cuộn đọc tin cũ
        // thì không giật người xem)
        function render() {
            var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
            var empty = el.querySelector('.room-chat-empty');
            if (empty) empty.remove();
            list.innerHTML = '';
            order.slice(-MAX_RENDER).forEach(function (id) {
                var m = msgs[id];
                if (!m) return;
                var u = user();
                var d = document.createElement('div');
                d.className = 'room-chat-msg' + (u && m.uid === u.uid ? ' mine' : '');
                d.innerHTML = '<span class="t">' + esc(hhmm(m.ts)) + '</span><b>' + esc(m.name) + '</b>' + esc(m.text);
                list.appendChild(d);
            });
            if (!order.length) {
                list.innerHTML = '<div class="room-chat-empty">Chưa có tin nhắn nào — chào cả phòng nào 💬</div>';
                return;
            }
            if (nearBottom) list.scrollTop = list.scrollHeight;
        }

        // Cập nhật messages từ data node chat (toàn bộ hoặc 1 msg theo path)
        function apply(path, data) {
            try {
                var id;
                if (path === '/' || path === '') {
                    msgs = data || {};
                    order = Object.keys(msgs).sort(function (a, b) { return (msgs[a].ts || 0) - (msgs[b].ts || 0); });
                } else {
                    id = path.replace(/^\//, '');
                    if (!data) { delete msgs[id]; order = order.filter(k => k !== id); }
                    else if (!msgs[id]) { msgs[id] = data; order.push(id); order.sort(function (a, b) { return (msgs[a].ts || 0) - (msgs[b].ts || 0); }); }
                    else msgs[id] = data;
                }
                render();
            } catch (e) { console.error('RoomChat apply', e); }
        }

        function watch(code) {
            if (es) { es.close(); es = null; }
            curCode = code;
            if (!code) return;
            if (typeof EventSource !== 'undefined') {
                es = new EventSource(RTDB + '/room/' + code + '/chat.json');
                ['put', 'patch'].forEach(function (ev) {
                    es.addEventListener(ev, function (e) {
                        try {
                            var d = JSON.parse(e.data);
                            if (d && d.data) apply(d.path || '/', d.data);
                        } catch (err) { }
                    });
                });
                es.onerror = function () { /* EventSource tự reconnect; poll gánh */ };
            }
        }

        // Poll 4s: snapshot node chat của phòng hiện tại; mã phòng mới xuất
        // hiện (host bấm tạo phòng trên trang artplayer) -> bật stream
        setInterval(function () {
            var code = getCode();
            if (code !== curCode) { watch(code); return; }
            if (!code) return;
            fetch(RTDB + '/room/' + code + '/chat.json')
                .then(r => r.json())
                .then(data => {
                    var next = data || {};
                    if (JSON.stringify(next) === JSON.stringify(msgs)) return;
                    apply('/', next);
                })
                .catch(() => { });
        }, 4000);

        // Đổi trạng thái đăng nhập -> làm mới màu tin của mình
        if (typeof firebase !== 'undefined') {
            try {
                firebase.auth().onAuthStateChanged(function () { render(); });
            } catch (e) { }
        }
    }

    return { mount: mount };
})();
