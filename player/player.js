var video = document.getElementById('video');

function playM3u8(url) {
    console.log("HLS:", Hls.isSupported())
    const hlsMimeType = "application/vnd.apple.mpegurl";

    if (Hls.isSupported()) {
        var hls = new Hls();
        var m3u8Url = decodeURIComponent(url)
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        console.log(hls)
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play();
        });
    }
    else if (video.canPlayType(hlsMimeType)) {
        video.type = hlsMimeType;
        video.src = url;
        video.addEventListener('canplay', function () {
            video.play();
        });
    }
}

function playM3u8Text(m3u8Text) {
    const hlsMimeType = "application/vnd.apple.mpegurl";
    console.log("HLS m3u8 text:", Hls.isSupported())
    if (Hls.isSupported()) {
        var hls = new Hls();
        var m3u8Url = createBlobUrl(m3u8Text)
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        console.log(hls)
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play();
        });
    }
    else if (video.canPlayType(hlsMimeType)) {
        video.type = hlsMimeType;
        video.src = `data:${hlsMimeType};base64,${btoa(m3u8Text)}`;
        video.addEventListener('canplay', function () {
            video.play();
        });
    }
}

function playPause() {
    video.paused ? video.play() : video.pause();
}

function volumeUp() {
    if (video.volume <= 0.9) video.volume += 0.1;
}

function volumeDown() {
    if (video.volume >= 0.1) video.volume -= 0.1;
}

function seekRight() {
    video.currentTime += 5;
}

function seekLeft() {
    video.currentTime -= 5;
}

function vidFullscreen() {
    if (video.requestFullscreen) {
        video.requestFullscreen();
    } else if (video.mozRequestFullScreen) {
        video.mozRequestFullScreen();
    } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
    }
}

function seekTime() {
    if (window.location.href.split("#").length >= 3) {
        video.currentTime = Number(window.location.href.split("#")[2])
    }
}

function createBlobUrl(data, mimeType = "application/vnd.apple.mpegurl") {
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
}

console.log(window.location.href.split("#"))

var url = window.location.href.split("#")[1]
if (url.endsWith(".json")) {
    fetch(url).then(response => response.json()).then(function (data) {
        playM3u8Text(data.m3u8)
    })
} else {
    playM3u8(url)
}
seekTime()


function setMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Anime Player',
            artwork: [
                { src: 'https://raw.githubusercontent.com/rin2401/anime/refs/heads/master/player/logog.png' },
            ]
        });
    }
}

$(window).on('load', function () {
    // Mousetrap.bind('space', playPause);
    Mousetrap.bind('up', volumeUp);
    Mousetrap.bind('down', volumeDown);
    Mousetrap.bind('right', seekRight);
    Mousetrap.bind('left', seekLeft);
    Mousetrap.bind('f', vidFullscreen);
    setMediaSession();
});