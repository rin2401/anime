// ── RoomChat — chat TẠM cho phòng xem chung ──
// Node chat/{code}: mỗi tin là một entry {uid, name, text, ts}, POST (PUSH)
// — rules cho phép MỌI NGƯỜI (kể cả khách không đăng nhập) ghi tin vào phòng
// ĐANG TỒN TẠI (root.child('room').child($roomId).exists() — không ai dùng
// được node chat làm kho lưu trữ chung), còn state phát (url/pos/playing ở
// room/{code}) vẫn chỉ host được ghi.
//
// KHÔNG LƯU LỊCH SỬ: người vào phòng chỉ thấy tin nhắn phát sinh SAU khi
// mình vào (tin mới hơn joinTs ~5s). Ai đang mở phòng mới chat với nhau —
// lịch sử không bao giờ hiển thị. Node tự dọn: máy nào mở phòng cũng xoá
// tin quá 2 giờ, nên DB không tích tụ. Poll fallback dùng
// orderBy ts + limitToLast=10 (cần .indexOn) — băng thông luôn biên giới
// nhỏ bất kể node đang có bao nhiêu tin cũ.
//
// Widget tự quản stream riêng cho node chat: EventSource (tin từng cái)
// + poll 4s luôn chạy (webview cũ hay chết stream im lặng). Cả trang room
// lẫn trang artplayer (host) dùng chung file này.
//
// RoomChat.mount(el, getCode) — el là thẻ chứa panel (trang tự hiện/ẩn),
// getCode() trả mã phòng hiện tại (có thể null/ra sau khi host tạo phòng).
var RoomChat = (function () {
    var RTDB = 'https://r3fire.firebaseio.com';
    var MAX_RENDER = 80;     // chỉ vẽ ~80 tin gần nhất mỗi lần render
    var GRACE_MS = 5000;     // tin mới hơn 5s trước lúc vào vẫn hiện (đồng bộ giờ máy)
    var TTL_MS = 2 * 60 * 60 * 1000; // tin quá 2h bị dọn khỏi DB

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
        el.innerHTML = '<div class="room-chat-list"><div class="room-chat-empty">Chat tạm — chỉ hiện tin nhắn mới của người đang trong phòng 💬</div></div>' +
            '<div class="room-chat-input"><input type="text" maxlength="500" placeholder="Nhắn tin…" enterkeyhint="send">' +
            '<button type="button" aria-label="Gửi">➤</button></div>';
        var list = el.querySelector('.room-chat-list');
        var input = el.querySelector('input');
        var btn = el.querySelector('button');

        var msgs = {};      // id -> entry (chỉ tin mới sau khi vào phòng)
        var order = [];     // id theo ts tăng dần
        var curCode = null;
        var es = null;
        var joinTs = 0;

        function user() {
            return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
        }

        // localStorage có thể bị chặn (private mode, TV cũ) -> bọc try
        function ls(key, val) {
            try {
                if (arguments.length > 1) localStorage.setItem(key, val);
                else return localStorage.getItem(key);
            } catch (e) { return arguments.length > 1 ? undefined : null; }
        }

        // Định danh chat: đã đăng nhập thì dùng account Firebase; khách (không
        // đăng nhập) dùng uid + tên "Khách NNNN" sinh một lần lưu localStorage —
        // giữ nguyên qua các lần mở lại để tin của mình vẫn tô màu đúng
        function identity() {
            var u = user();
            if (u) return { uid: u.uid, name: u.displayName || (u.email || '').split('@')[0] };
            var uid = ls('roomchat:guest');
            if (!uid) {
                uid = 'g-' + Math.random().toString(36).slice(2, 12);
                ls('roomchat:guest', uid);
            }
            var name = ls('roomchat:guestname');
            if (!name) {
                name = 'Khách ' + Math.floor(1000 + Math.random() * 9000);
                ls('roomchat:guestname', name);
            }
            return { uid: uid, name: name };
        }

        // Gửi: POST (PUSH) — id sinh phía server, thứ tự ts tự đúng.
        // Khách không đăng nhập gửi thẳng không token (rule chỉ đòi phòng tồn tại)
        var lastSend = 0;
        function send() {
            var text = (input.value || '').trim();
            if (!text) return;
            if (!curCode) return;
            var now = Date.now();
            // IME kiểu Unikey ở vài webview phóng 2 keydown Enter cho 1 lần bấm
            // (bắt tin trùng; lỗi gửi thật thì nhả lại cho gửi thử ngay)
            if (now - lastSend < 500) return;
            lastSend = now;
            var me = identity();
            var entry = { uid: me.uid, name: me.name, text: text, ts: Date.now() };
            input.value = '';
            postChat(curCode, entry).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
            }).catch(function (e) {
                lastSend = 0;
                systemMsg('Gửi tin lỗi: ' + e.message);
            });
        }

        // Mọi ghi chat đi qua đây: có user thì kèm idToken, không thì POST/DELETE
        // luôn — rule chat chỉ cần phòng tồn tại
        function postChat(code, entry) {
            var u = user();
            var opt = entry ? { method: 'POST', body: JSON.stringify(entry) } : { method: 'DELETE' };
            if (!u) return fetch(RTDB + '/chat/' + code + '.json', opt);
            return u.getIdToken().then(function (tok) {
                return fetch(RTDB + '/chat/' + code + '.json?auth=' + tok, opt);
            });
        }
        btn.addEventListener('click', send);
        // Enter khi IME (Unikey/EVKey/Telex...) đang ghép vần chỉ XÁC NHẬN chữ,
        // không gửi — webview không khai báo isComposing thì nhắm bằng keyCode
        // 229 (raw Enter trong phiên soạn thảo của IME)
        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.isComposing === true || e.keyCode === 229) return;
            e.preventDefault();
            send();
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
                var me = identity();
                var d = document.createElement('div');
                d.className = 'room-chat-msg' + (m.uid === me.uid ? ' mine' : '');
                d.innerHTML = '<span class="t">' + esc(hhmm(m.ts)) + '</span><b>' + esc(m.name) + '</b>' + esc(m.text);
                list.appendChild(d);
            });
            if (!order.length) {
                list.innerHTML = '<div class="room-chat-empty">Chat tạm — chỉ hiện tin nhắn mới của người đang trong phòng 💬</div>';
                return;
            }
            if (nearBottom) list.scrollTop = list.scrollHeight;
        }

        // Cập nhật từ data node chat: KHÔNG có khái niệm "toàn bộ lịch sử" —
        // mọi lối vào đều lọc theo joinTs, tin cũ bỏ qua (không render).
        function add(id, m) {
            if (m && (m.ts || 0) >= joinTs) {
                if (!msgs[id]) order.push(id);
                msgs[id] = m;
                order.sort(function (a, b) { return (msgs[a].ts || 0) - (msgs[b].ts || 0); });
            } else if (!m && msgs[id]) {
                // tin bị dọn (trim) ở máy khác -> gỡ khỏi panel đang mở
                delete msgs[id];
                order = order.filter(function (k) { return k !== id; });
            }
        }

        function apply(path, data) {
            try {
                if (path === '/' || path === '') {
                    Object.keys(data || {}).forEach(function (id) { add(id, data[id]); });
                } else {
                    add(path.replace(/^\//, ''), data);
                }
                render();
            } catch (e) { console.error('RoomChat apply', e); }
        }

        // Dọn tin quá TTL khi có người mở phòng — ai online cũng làm (kể cả
        // khách, rule chat cho ghi không cần đăng nhập) nên node không tích tụ
        function trimOld(code) {
            var cutoff = Date.now() - TTL_MS;
            var u = user();
            (u ? u.getIdToken() : Promise.resolve(null)).then(function (tok) {
                var q = '?orderBy=%22ts%22&endAt=' + cutoff + (tok ? '&auth=' + tok : '');
                return fetch(RTDB + '/chat/' + code + '.json' + q).then(r => r.json());
            }).then(function (old) {
                if (!old) return;
                var u2 = user();
                (u2 ? u2.getIdToken() : Promise.resolve(null)).then(function (tok) {
                    Object.keys(old).slice(0, 100).forEach(function (id) {
                        fetch(RTDB + '/chat/' + code + '/' + id + '.json' + (tok ? '?auth=' + tok : ''),
                            { method: 'DELETE' }).catch(function () { });
                    });
                });
            }).catch(function () { });
        }

        function watch(code) {
            if (es) { es.close(); es = null; }
            curCode = code;
            if (!code) return;
            joinTs = Date.now() - GRACE_MS;
            msgs = {}; order = []; render(); // đổi phòng = bắt đầu lại từ tin mới
            trimOld(code);
            if (typeof EventSource !== 'undefined') {
                es = new EventSource(RTDB + '/chat/' + code + '.json');
                ['put', 'patch'].forEach(function (ev) {
                    es.addEventListener(ev, function (e) {
                        try {
                            var d = JSON.parse(e.data);
                            if (d) apply(d.path || '/', d.data);
                        } catch (err) { }
                    });
                });
                es.onerror = function () { /* EventSource tự reconnect; poll gánh */ };
            }
        }

        // Poll 4s: fallback khi stream chết — chỉ tải 10 tin mới nhất
        // (limitToLast + indexOn ts), không bao giờ tải lịch sử. Mã phòng
        // mới xuất hiện (host bấm tạo phòng) -> bật stream.
        setInterval(function () {
            var code = getCode();
            if (code !== curCode) { watch(code); return; }
            if (!code) return;
            fetch(RTDB + '/chat/' + code + '.json?orderBy=%22ts%22&limitToLast=10')
                .then(r => r.json())
                .then(data => { if (data) apply('/', data); })
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
