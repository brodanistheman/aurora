import { getApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { Room, RoomEvent, Track } from "https://cdn.jsdelivr.net/npm/livekit-client@2.5.7/+esm";

// Your Cloudflare Worker URL (see worker.js).
const TOKEN_URL = 'https://aurora-token.brodanistheman.workers.dev';
const ROOM_NAME = 'general';

const auth = getAuth(getApp());
const callButton = document.getElementById('call-button');

let room = null;
const tiles = new Map();

/* ---------- Build the call overlay once ---------- */
const overlay = document.createElement('div');
overlay.id = 'call-overlay';
overlay.className = 'call-overlay hidden';
overlay.setAttribute('role', 'dialog');
overlay.setAttribute('aria-label', 'Voice and video call');
overlay.innerHTML = `
    <div class="call-window">
        <header class="call-header">
            <h2 class="call-title">General call</h2>
            <span id="call-status" class="call-status">Connecting…</span>
        </header>
        <div id="call-grid" class="call-grid"></div>
        <div id="call-audio" class="hidden"></div>
        <footer class="call-controls">
            <button id="call-mic" class="call-ctrl" type="button" aria-pressed="false" title="Mute / unmute">
                <i class="fa-solid fa-microphone"></i>
            </button>
            <button id="call-cam" class="call-ctrl" type="button" aria-pressed="false" title="Camera on / off">
                <i class="fa-solid fa-video-slash"></i>
            </button>
            <button id="call-leave" class="call-ctrl call-leave" type="button" title="Leave call">
                <i class="fa-solid fa-phone-slash"></i>
            </button>
        </footer>
    </div>
`;
document.body.appendChild(overlay);

const grid = overlay.querySelector('#call-grid');
const audioBox = overlay.querySelector('#call-audio');
const statusEl = overlay.querySelector('#call-status');
const micBtn = overlay.querySelector('#call-mic');
const camBtn = overlay.querySelector('#call-cam');
const leaveBtn = overlay.querySelector('#call-leave');

/* ---------- Tiles ---------- */
function ensureTile(p) {
    let tile = tiles.get(p.identity);
    if (tile) return tile;

    tile = document.createElement('div');
    tile.className = 'call-tile';

    const media = document.createElement('div');
    media.className = 'call-tile-media';

    const label = document.createElement('span');
    label.className = 'call-tile-name';
    label.textContent = (p.name || 'Anonymous') + (p.isLocal ? ' (you)' : '');

    tile.append(media, label);
    grid.appendChild(tile);
    tiles.set(p.identity, tile);
    return tile;
}

function removeTile(p) {
    const tile = tiles.get(p.identity);
    if (tile) tile.remove();
    tiles.delete(p.identity);
}

function attachTrack(track, participant) {
    if (track.kind === Track.Kind.Video) {
        const media = ensureTile(participant).querySelector('.call-tile-media');
        media.querySelectorAll('video').forEach((v) => v.remove());
        const el = track.attach();
        el.className = 'call-video';
        media.appendChild(el);
    } else if (track.kind === Track.Kind.Audio && !participant.isLocal) {
        audioBox.appendChild(track.attach());
    }
}

function detachTrack(track) {
    track.detach().forEach((el) => el.remove());
}

/* ---------- Controls ---------- */
function syncControls() {
    if (!room) return;
    const lp = room.localParticipant;
    const micOn = lp.isMicrophoneEnabled;
    const camOn = lp.isCameraEnabled;

    micBtn.setAttribute('aria-pressed', String(!micOn));
    micBtn.querySelector('i').className = micOn ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
    camBtn.setAttribute('aria-pressed', String(camOn));
    camBtn.querySelector('i').className = camOn ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';
}

micBtn.addEventListener('click', async () => {
    if (!room) return;
    try {
        await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    } catch (err) {
        console.error('Microphone error:', err);
        alert('Could not access your microphone.');
    }
    syncControls();
});

camBtn.addEventListener('click', async () => {
    if (!room) return;
    try {
        await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled);
    } catch (err) {
        console.error('Camera error:', err);
        alert('Could not access your camera.');
    }
    syncControls();
});

leaveBtn.addEventListener('click', leaveCall);

/* ---------- Join / leave ---------- */
async function fetchToken() {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in');

    const idToken = await user.getIdToken();
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
            room: ROOM_NAME,
            name: window.currentDisplayName || user.displayName || 'Anonymous'
        })
    });

    if (!res.ok) throw new Error(`Token request failed (${res.status})`);
    return res.json(); // { token, url }
}

function updateStatus() {
    if (!room) return;
    const count = room.remoteParticipants.size + 1;
    statusEl.textContent = `${count} in call`;
}

async function joinCall() {
    if (room) return;
    overlay.classList.remove('hidden');
    statusEl.textContent = 'Connecting…';

    try {
        const { token, url } = await fetchToken();
        room = new Room({ adaptiveStream: true, dynacast: true });

        room
            .on(RoomEvent.ParticipantConnected, (p) => { ensureTile(p); updateStatus(); })
            .on(RoomEvent.ParticipantDisconnected, (p) => { removeTile(p); updateStatus(); })
            .on(RoomEvent.TrackSubscribed, (track, _pub, p) => attachTrack(track, p))
            .on(RoomEvent.TrackUnsubscribed, (track) => detachTrack(track))
            .on(RoomEvent.LocalTrackPublished, (pub, p) => {
                if (pub.track) attachTrack(pub.track, p);
                syncControls();
            })
            .on(RoomEvent.LocalTrackUnpublished, (pub) => {
                if (pub.track) detachTrack(pub.track);
                syncControls();
            })
            .on(RoomEvent.TrackMuted, syncControls)
            .on(RoomEvent.TrackUnmuted, syncControls)
            .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                const ids = new Set(speakers.map((s) => s.identity));
                tiles.forEach((tile, id) => tile.classList.toggle('speaking', ids.has(id)));
            })
            .on(RoomEvent.Disconnected, cleanup);

        await room.connect(url, token);

        ensureTile(room.localParticipant);
        room.remoteParticipants.forEach((p) => ensureTile(p));
        updateStatus();

        try {
            await room.localParticipant.setMicrophoneEnabled(true);
        } catch (err) {
            console.error('Microphone error:', err);
            alert('Could not access your microphone. You can still listen.');
        }
        syncControls();
    } catch (err) {
        console.error('Call error:', err);
        alert('Could not join the call.');
        leaveCall();
    }
}

function leaveCall() {
    if (room) room.disconnect();
    cleanup();
}

function cleanup() {
    room = null;
    tiles.clear();
    grid.innerHTML = '';
    audioBox.innerHTML = '';
    overlay.classList.add('hidden');
}

if (callButton) callButton.addEventListener('click', joinCall);
window.addEventListener('beforeunload', () => { if (room) room.disconnect(); });
