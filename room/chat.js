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
// Widget tự quản stream riêng cho node chat: Firebase SDK (child_added từng
// tin, tự reconnect/resync) khi có; TV cũ không tải được SDK thì SSE + poll
// 4s. Trang room dùng chung file này cho cả host lẫn người xem.
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
.room-chat { display:flex; flex-direction:column; font:13px/1.45 "PingFang SC","Helvetica Neue","Microsoft YaHei",Roboto,Arial,sans-serif; color:#fff; }
.room-chat-list { flex:1; overflow-y:auto; padding:8px 10px; }
.room-chat-msg { margin:4px 0; word-wrap:break-word; }
.room-chat-msg b { color:#23ade5; margin-right:4px; }
.room-chat-msg.mine b { color:#7fd4ff; }
.room-chat-msg .t { color:rgba(255,255,255,.45); font-size:11px; margin-right:6px; }
.room-chat-msg.sys { color:rgba(255,255,255,.55); font-style:italic; }
.room-chat-input { display:flex; gap:6px; padding:8px; border-top:1px solid rgba(255,255,255,.15); }
.room-chat-input input { flex:1; min-width:0; background:#2b2f33; color:#fff; border:0; border-radius:8px; padding:8px 10px; outline:0; color-scheme:dark; font-family:inherit; font-size:13px; }
.room-chat-input button { display:flex; align-items:center; justify-content:center; background:#23ade5; color:#fff; border:0; border-radius:8px; padding:0 12px; font-weight:700; cursor:pointer; font-family:inherit; }
.room-chat-input button svg { width:16px; height:16px; display:block; }
.room-chat-empty { display:flex; align-items:center; gap:6px; color:rgba(255,255,255,.5); padding:8px 10px; }
.room-chat-empty svg { width:14px; height:14px; flex:0 0 auto; }
.room-chat-ico svg { width:12px; height:12px; display:inline-block; vertical-align:-1px; margin-right:2px; }
`;
        document.head.appendChild(st);
    }

    // Icon SVG dùng chung (KHÔNG dùng emoji: font emoji lệch tông với icon SVG
    // của player và render khác nhau theo OS). Tin hệ thống lưu KHOÁ icon
    // (entry.ico) chứ không nhét ký tự vào text; tin cũ trong DB vẫn còn emoji
    // thì render nguyên trạng, không viết lại lịch sử.
    var ICONS = {
        movie: '<path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>',
        join: '<path d="M11 7l-1.41 1.41L12.17 11H4v2h8.17l-2.58 2.59L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/>',
        room: '<path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>',
        chat: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
        send: '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>',
        play: '<path d="M8 5v14l11-7z"/>',
        pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>',
        seek: '<path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>',
        rate: '<path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.03 19a10 10 0 0 1 17.35-10.43z"/>',
        lock: '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/>',
        edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.9959.9959 0 0 0 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
        person: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
    };

    function icoSvg(key, cls) {
        var p = ICONS[key];
        if (!p) return '';
        return '<span class="' + (cls || 'room-chat-ico') + '">'
            + '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + p + '</svg></span>';
    }

    // ── Định danh (dùng chung: chat + presence roomview của player.js) ──
    // Nằm ở cấp IIFE (KHÔNG trong mount) để expose qua return được.
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

    function mount(el, getCode) {
        ensureStyle();
        el.classList.add('room-chat');
        el.innerHTML = '<div class="room-chat-list"><div class="room-chat-empty">'
            + icoSvg('chat') + '<span>Chat tạm — chỉ hiện tin nhắn mới của người đang trong phòng</span></div></div>' +
            '<div class="room-chat-input"><input type="text" maxlength="500" placeholder="Nhắn tin…" enterkeyhint="send">' +
            '<button type="button" aria-label="Gửi">' + icoSvg('send') + '</button></div>';
        var list = el.querySelector('.room-chat-list');
        var input = el.querySelector('input');
        var btn = el.querySelector('button');

        var msgs = {};      // id -> entry (chỉ tin mới sau khi vào phòng)
        var order = [];     // id theo ts tăng dần
        var curCode = null;
        var es = null;      // EventSource fallback (không có SDK)
        var sdkQuery = null; // query SDK đang mở (để .off khi đổi phòng)
        var usedSdk = false;
        var lastPoll = 0;
        var joinTs = 0;

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

        // Tin HỆ THỐNG (sys:1): trạng thái hành động trong phòng — host phát/
        // dừng/tua/đổi tập, người vào phòng — hiển thị xám nghiêng, không tính
        // là tin nhắn của ai nên không cản lastSend (được gọi từ player.js).
        // icoKey: khoá icon SVG ('movie' | 'join' | 'room'), không phải emoji.
        function action(verb, icoKey) {
            if (!curCode) return;
            var me = identity();
            var entry = {
                uid: me.uid, name: me.name,
                text: me.name + ' ' + verb,
                ts: Date.now(), sys: 1,
            };
            if (ICONS[icoKey]) entry.ico = icoKey;
            postChat(curCode, entry).catch(function () { });
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
                if (m.sys) {
                    // tin hệ thống (hành động phòng): xám nghiêng, tên nằm trong
                    // text; entry.ico (khoá SVG) có thì chèn icon thay vì emoji
                    d.className = 'room-chat-msg sys';
                    d.innerHTML = '<span class="t">' + esc(hhmm(m.ts)) + '</span>'
                        + icoSvg(m.ico) + esc(m.text);
                } else {
                    d.className = 'room-chat-msg' + (m.uid === me.uid ? ' mine' : '');
                    d.innerHTML = '<span class="t">' + esc(hhmm(m.ts)) + '</span><b>' + esc(m.name) + '</b>' + esc(m.text);
                }
                list.appendChild(d);
            });
            if (!order.length) {
                list.innerHTML = '<div class="room-chat-empty">' + icoSvg('chat')
                    + '<span>Chat tạm — chỉ hiện tin nhắn mới của người đang trong phòng</span></div>';
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
            if (sdkQuery) { try { sdkQuery.off(); } catch (e) { } sdkQuery = null; }
            curCode = code;
            usedSdk = false;
            if (!code) return;
            joinTs = Date.now() - GRACE_MS;
            msgs = {}; order = []; render(); // đổi phòng = bắt đầu lại từ tin mới
            trimOld(code);
            // Người vào phòng -> 1 tin hệ thống cho cả phòng thấy ai mới đến
            // (reload cũng tính là vào lại — chat tạm nên không sao)
            action('đã vào phòng', 'join');
            // Ưu tiên Firebase SDK: child_added chỉ đẩy TIN MỚI (query limit 10
            // + lọc joinTs trong add() nên không hiện lịch sử), child_removed
            // nghe tin bị dọn ở máy khác. Không SDK -> SSE như cũ.
            if (typeof firebase !== 'undefined' && firebase.database) {
                try {
                    var q = firebase.database().ref('chat/' + code)
                        .orderByChild('ts').limitToLast(10);
                    q.on('child_added', function (snap) {
                        add(snap.key, snap.val()); render();
                    });
                    q.on('child_removed', function (snap) {
                        add(snap.key, null); render();
                    });
                    sdkQuery = q;
                    usedSdk = true;
                } catch (e) { }
            }
            if (!usedSdk && typeof EventSource !== 'undefined') {
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

        // Poll fallback: SDK gánh realtime thì vòng này chỉ là heartbeat 30s
        // (phòng chat tạm, chết socket im lặng thì chậm nhất 30s vẫn đuổi kịp);
        // không SDK (TV cũ) -> poll 4s như cũ. Vòng 4s vẫn chạy để bắt mã phòng
        // mới xuất hiện (getCode() đổi) tức thì.
        setInterval(function () {
            var code = getCode();
            if (code !== curCode) { watch(code); return; }
            if (!code) return;
            if (Date.now() - lastPoll < (usedSdk ? 30000 : 4000)) return;
            lastPoll = Date.now();
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

        // instance đang hoạt động: player.js gọi RoomChat.action(...) để ghi
        // trạng thái hành động của host (phát/dừng/tua/đổi tập) vào chatbox
        activeAction = action;
    }

    // Ghi tin hệ thống vào phòng ĐANG mở (instance mount gần nhất). An toàn
    // khi chưa mount: bỏ qua im lặng.
    var activeAction = null;

    return {
        mount: mount,
        action: function (verb, icoKey) { if (activeAction) activeAction(verb, icoKey); },
        // Icon SVG của phòng (nguồn duy nhất) — lobby/player dùng chung để nút
        // và card không phải chép lại path, và không nơi nào nhét emoji
        ico: icoSvg,
        // Danh tính (uid + tên hiển thị, khách có uid/name giả) — player.js dùng
        // cho presence (roomview) để tên người xem nhất quán với chat
        identity: identity,
    };
})();
