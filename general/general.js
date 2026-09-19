import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, getDocs, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const MODERATOR_UIDS = [
    "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
    "vmytwBIHywg7BoJWDnl1QOXXUh52",
    "IW24TCbQSkamV2LdxSFObbBg9u73",
    "FhWBbA6JlwXRPl39vvTjdFR6UaH2"
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
const SCROLL_NEAR_BOTTOM_PX = 80;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const userInfoElement = document.getElementById('user-info');
const logoutButton = document.getElementById('logout-button');
const settingsButton = document.getElementById('settings-button');
const profileButton = document.getElementById('profile-button');
const messageBox = document.getElementById('message-box');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const imageInput = document.getElementById('image-file-input');
const attachButton = document.getElementById('attach-button');
const onlineUsersList = document.getElementById('online-users-list');
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const imageModalClose = document.getElementById('image-modal-close');

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let currentDisplayName = 'Anonymous';
let currentProfilePic = '';
let presenceInterval = null;

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isSafeMediaSrc(src, kind) {
    if (!src) return false;
    if (src.startsWith('https://') || src.startsWith('http://')) return true;
    return src.startsWith(`data:${kind}/`);
}

function isSafeImageSrc(src) {
    return isSafeMediaSrc(src, 'image');
}

function isSafeVideoSrc(src) {
    return isSafeMediaSrc(src, 'video');
}

function formatMessageText(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlRegex, (url) => {
        const safeUrl = escapeHtml(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    });
}

function applyUserData(userData) {
    if (userData.displayName) {
        currentDisplayName = userData.displayName;
    }
    currentProfilePic = isSafeImageSrc(userData.profilePic) ? userData.profilePic : defaultAvatar;

    if (userInfoElement) {
        userInfoElement.innerHTML = `<p>Registration ID: #${escapeHtml(userData.sequentialId)}</p>`;
    }

    if (profileButton && userData.sequentialId) {
        profileButton.onclick = () => {
            window.location.href = `/aurora/users/${encodeURIComponent(userData.sequentialId)}/profile/`;
        };
    }
}

const cachedSequentialId = localStorage.getItem('aurora_quick_id');
if (cachedSequentialId && profileButton) {
    profileButton.onclick = () => {
        window.location.href = `/aurora/users/${encodeURIComponent(cachedSequentialId)}/profile/`;
    };
}

function setupPresence(user) {
    const userStatusRef = doc(db, "status", user.uid);

    const updateStatus = async (status) => {
        try {
            await setDoc(userStatusRef, {
                uid: user.uid,
                displayName: currentDisplayName,
                profilePic: currentProfilePic,
                status,
                lastChanged: serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.error("Error updating presence:", err);
        }
    };

    updateStatus('online');

    document.addEventListener("visibilitychange", () => {
        updateStatus(document.hidden ? 'away' : 'online');
    });
    window.addEventListener("blur", () => updateStatus('away'));
    window.addEventListener("focus", () => updateStatus('online'));
    window.addEventListener("beforeunload", () => {
        setDoc(userStatusRef, { status: 'offline', lastChanged: serverTimestamp() }, { merge: true });
    });

    presenceInterval = setInterval(() => {
        if (!document.hidden) updateStatus('online');
    }, 30000);
}

function initOnlineUsersList() {
    if (!onlineUsersList) return;
    const statusQuery = collection(db, "status");

    onSnapshot(statusQuery, (snapshot) => {
        onlineUsersList.innerHTML = '';
        let anyOnline = false;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status === 'offline') return;
            anyOnline = true;

            const statusClass = data.status === 'away' ? 'status-away' : 'status-online';
            const statusLabel = data.status === 'away' ? 'Away / Minimized' : 'Online';
            const avatar = isSafeImageSrc(data.profilePic) ? data.profilePic : defaultAvatar;
            const name = escapeHtml(data.displayName || 'Anonymous');

            const userDiv = document.createElement('div');
            userDiv.className = 'active-user-item';
            userDiv.innerHTML = `
                <div class="active-user-avatar-wrapper">
                    <img src="${avatar}" class="active-user-avatar" alt="" onerror="this.src='${defaultAvatar}'">
                    <span class="active-user-dot ${statusClass}" title="${statusLabel}"></span>
                </div>
                <span class="active-user-name" title="${name}" style="flex:1; overflow:hidden; text-overflow:ellipsis;">${name}</span>
            `;
            onlineUsersList.appendChild(userDiv);
        });

        if (!anyOnline) {
            onlineUsersList.innerHTML = `<p class="empty-state">No one else is online right now.</p>`;
        }
    });
}

function openLightbox(imgSrc) {
    if (!imageModal || !imageModalImg) return;
    imageModalImg.src = imgSrc;
    imageModal.classList.remove('hidden');
}

function closeLightbox() {
    if (!imageModal) return;
    imageModal.classList.add('hidden');
    if (imageModalImg) imageModalImg.src = '';
}

if (imageModalClose) imageModalClose.addEventListener('click', closeLightbox);
if (imageModal) {
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal) closeLightbox();
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal && !imageModal.classList.contains('hidden')) {
        closeLightbox();
    }
});

function isScrolledNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_NEAR_BOTTOM_PX;
}

function initChat() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(30));

    onSnapshot(q, (snapshot) => {
        if (!messageBox) return;

        const shouldStickToBottom = isScrolledNearBottom(messageBox);
        messageBox.innerHTML = '';

        const docsToRender = [];
        snapshot.forEach((d) => docsToRender.push(d.data()));

        if (docsToRender.length === 0) {
            messageBox.innerHTML = `<p class="empty-state">No messages yet. Say hello!</p>`;
            return;
        }

        docsToRender.reverse().forEach((msg) => {
            const senderDisplay = escapeHtml(msg.displayName || 'Anonymous');

            if (msg.type === 'call') {
                const row = document.createElement('div');
                row.className = 'chat-event';
                row.innerHTML = `
                    <div class="call-card">
                        <div class="call-card-icon"><i class="fa-solid fa-video"></i></div>
                        <div class="call-card-info">
                            <span class="call-card-title">${senderDisplay} started a group call</span>
                            <span class="call-card-sub"></span>
                        </div>
                        <button type="button" class="call-card-join">Join</button>
                    </div>
                `;
                row.querySelector('.call-card-join').addEventListener('click', () => {
                    joinGroupCall(msg.roomId || CALL_ROOM_ID);
                });
                messageBox.appendChild(row);
                return;
            }

            const div = document.createElement('div');
            div.className = 'chat-message';

            const senderPic = isSafeImageSrc(msg.profilePic) ? msg.profilePic : defaultAvatar;

            let contentHtml = '';
            if (msg.text) {
                contentHtml += `<span>${formatMessageText(msg.text)}</span>`;
            }
            if (msg.imageUrl && isSafeImageSrc(msg.imageUrl)) {
                contentHtml += `<div style="margin-top: 6px;"><img src="${msg.imageUrl}" class="chat-message-image clickable-image" alt="Attached image" /></div>`;
            }
            if (msg.videoUrl && isSafeVideoSrc(msg.videoUrl)) {
                contentHtml += `<div style="margin-top: 6px;"><video src="${msg.videoUrl}" class="chat-message-video" controls preload="metadata"></video></div>`;
            }

            div.innerHTML = `
                <img src="${senderPic}" alt="" class="chat-profile-pic" onerror="this.src='${defaultAvatar}'">
                <div class="chat-message-content">
                    <div class="chat-message-header">
                        <span class="chat-sender-name">${senderDisplay}</span>
                    </div>
                    <div class="chat-message-body">${contentHtml}</div>
                </div>
            `;
            messageBox.appendChild(div);
        });

        messageBox.querySelectorAll('.clickable-image').forEach((img) => {
            img.addEventListener('click', () => openLightbox(img.src));
        });

        renderCallPresence();

        if (shouldStickToBottom) {
            messageBox.scrollTop = messageBox.scrollHeight;
        }
    });
}

async function clearAllMessages() {
    const querySnapshot = await getDocs(collection(db, "messages"));
    await Promise.all(querySnapshot.docs.map((d) => deleteDoc(doc(db, "messages", d.id))));
}

const MODERATOR_COMMANDS = {
    '/clear msgs': clearAllMessages
};

async function sendChatMessage(text, attachment = null) {
    const user = auth.currentUser;
    if (!user) return;

    const command = text ? MODERATOR_COMMANDS[text.trim().toLowerCase()] : null;
    if (command) {
        if (!MODERATOR_UIDS.includes(user.uid)) {
            alert('You do not have permission to use this command.');
            messageInput.value = '';
            return;
        }
        try {
            await command();
        } catch (error) {
            console.error("Error running command: ", error);
        } finally {
            messageInput.value = '';
        }
        return;
    }

    if (!text && !attachment) return;

    setSending(true);
    try {
        await addDoc(collection(db, "messages"), {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            text: text || '',
            imageUrl: attachment && attachment.type === 'image' ? attachment.url : null,
            videoUrl: attachment && attachment.type === 'video' ? attachment.url : null,
            createdAt: serverTimestamp()
        });
        messageInput.value = '';
        if (imageInput) imageInput.value = '';
    } catch (error) {
        console.error("Error sending message: ", error);
    } finally {
        setSending(false);
        messageInput.focus();
    }
}

function setSending(isSending) {
    if (sendButton) {
        sendButton.disabled = isSending;
        sendButton.textContent = isSending ? 'Sending…' : 'Send';
    }
}

function handleMediaFile(file) {
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
        alert('Please choose an image or video file.');
        return;
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
        const limitLabel = isVideo ? '4MB' : '5MB';
        alert(`${isVideo ? 'Video' : 'Image'} is too large. Please choose one under ${limitLabel}.`);
        return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
        const dataUrl = uploadEvent.target.result;
        const text = messageInput.value.trim();
        sendChatMessage(text, { type: isVideo ? 'video' : 'image', url: dataUrl });
    };
    reader.readAsDataURL(file);
}

if (attachButton && imageInput) {
    attachButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', (e) => handleMediaFile(e.target.files[0]));
}

if (messageInput) {
    messageInput.addEventListener('paste', (event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
                event.preventDefault();
                handleMediaFile(item.getAsFile());
                break;
            }
        }
    });
}

if (messageForm) {
    messageForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = messageInput.value.trim();
        if (text) sendChatMessage(text);
    });
} else if (sendButton) {
    sendButton.addEventListener('click', () => {
        const text = messageInput.value.trim();
        if (text) sendChatMessage(text);
    });
    if (messageInput) {
        messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const text = messageInput.value.trim();
                if (text) sendChatMessage(text);
            }
        });
    }
}

const CALL_ROOM_ID = 'main-room';
const HEARTBEAT_MS = 20000;
const STALE_AFTER_MS = 75000;

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let localStream = null;
let currentRoomId = null;
let peerConnections = {};
let callUnsubs = [];
let heartbeatTimer = null;
let myParticipantRef = null;
let myCallDocRefs = [];
let myJoinedMs = 0;
let inCall = false;
let micOn = true;
let camOn = true;
let roomParticipants = [];
let roomWatchStarted = false;
const answeredCalls = new Set();
const remoteMedia = {};

const callModal = document.getElementById('call-modal');
const videoGrid = document.getElementById('video-grid');
const hangupButton = document.getElementById('hangup-button');
const micButton = document.getElementById('mic-button');
const camButton = document.getElementById('cam-button');
const callStatus = document.getElementById('call-status');
const callCount = document.getElementById('call-count');
const groupCallButton = document.getElementById('group-call-btn');
const groupCallLabel = document.getElementById('group-call-label');
const callPanel = document.getElementById('call-panel');
const callPanelStatus = document.getElementById('call-panel-status');

function isFresh(participant) {
    return Date.now() - (participant.heartbeatMs || 0) < STALE_AFTER_MS;
}

function freshParticipants() {
    const myUid = auth.currentUser ? auth.currentUser.uid : null;
    return roomParticipants.filter((p) => isFresh(p) && (inCall || p.uid !== myUid));
}

function applyCallCardState(card, live, count) {
    card.classList.toggle('is-live', live);

    const sub = card.querySelector('.call-card-sub');
    if (sub) sub.textContent = live ? `${count} in the call` : 'Call ended';

    const joinBtn = card.querySelector('.call-card-join');
    if (joinBtn) {
        joinBtn.classList.toggle('hidden', !live);
        joinBtn.disabled = inCall;
        joinBtn.textContent = inCall ? 'In call' : 'Join';
    }
}

function renderCallPresence() {
    const count = freshParticipants().length;
    const live = count > 0;

    if (callPanel) callPanel.classList.toggle('is-live', live);
    if (callPanelStatus) {
        callPanelStatus.textContent = live
            ? `${count} ${count === 1 ? 'person' : 'people'} in the call`
            : 'No one is in a call';
    }
    if (groupCallButton) {
        groupCallButton.disabled = inCall;
        if (groupCallLabel) {
            groupCallLabel.textContent = inCall ? 'In call' : live ? 'Join call' : 'Start group call';
        }
    }

    const cards = document.querySelectorAll('.call-card');
    cards.forEach((card, i) => applyCallCardState(card, live && i === cards.length - 1, count));
}

function watchCallRoom() {
    if (roomWatchStarted) return;
    roomWatchStarted = true;

    onSnapshot(collection(db, 'groupCalls', CALL_ROOM_ID, 'participants'), (snapshot) => {
        roomParticipants = snapshot.docs.map((d) => d.data());
        renderCallPresence();
    });

    setInterval(renderCallPresence, 15000);
}

async function postCallStartedMessage(roomId) {
    const user = auth.currentUser;
    if (!user) return;
    try {
        await addDoc(collection(db, 'messages'), {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            type: 'call',
            roomId,
            text: '',
            imageUrl: null,
            videoUrl: null,
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error('Error posting call message:', err);
    }
}

if (groupCallButton) {
    groupCallButton.addEventListener('click', () => joinGroupCall(CALL_ROOM_ID));
}

function showCallModal() {
    if (callModal) callModal.classList.remove('hidden');
}

function hideCallModal() {
    if (callModal) callModal.classList.add('hidden');
}

function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    const text = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
    return text.toUpperCase();
}

function getTile(id) {
    return videoGrid ? videoGrid.querySelector(`[data-tile-id="${CSS.escape(id)}"]`) : null;
}

function setTileState(id, state) {
    const tile = getTile(id);
    if (!tile) return;
    tile.classList.toggle('mic-off', state.micOn === false);
    tile.classList.toggle('cam-off', state.camOn === false);
}

function updateGrid() {
    if (!videoGrid) return;
    const n = videoGrid.querySelectorAll('.video-tile').length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

    videoGrid.dataset.count = String(n);
    videoGrid.style.setProperty('--cols', String(cols));

    if (callCount) callCount.textContent = String(Math.max(n, 1));
    if (callStatus) {
        callStatus.textContent = n <= 1 ? 'Waiting for others to join' : `${n} people in the call`;
    }
}

function buildTile(id, name, isLocal) {
    const tile = document.createElement('div');
    tile.className = `video-tile${isLocal ? ' local' : ''}`;
    tile.dataset.tileId = id;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const avatar = document.createElement('div');
    avatar.className = 'tile-avatar';
    const avatarInitials = document.createElement('span');
    avatarInitials.textContent = initials(name);
    avatar.appendChild(avatarInitials);

    const label = document.createElement('div');
    label.className = 'tile-label';
    const micIcon = document.createElement('i');
    micIcon.className = 'fa-solid fa-microphone-slash';
    const nameEl = document.createElement('span');
    nameEl.textContent = isLocal ? 'You' : (name || 'Anonymous');
    label.append(micIcon, nameEl);

    tile.append(video, avatar, label);
    videoGrid.appendChild(tile);
    updateGrid();

    return { tile, video };
}

function ensureRemoteTile(uid, name) {
    let tile = getTile(uid);
    if (!tile) {
        tile = buildTile(uid, name, false).tile;
        if (remoteMedia[uid]) setTileState(uid, remoteMedia[uid]);
    }
    return tile.querySelector('video');
}

function updateControls() {
    const hasAudio = !!localStream && localStream.getAudioTracks().length > 0;
    const hasVideo = !!localStream && localStream.getVideoTracks().length > 0;

    if (micButton) {
        micButton.disabled = !hasAudio;
        micButton.classList.toggle('is-off', !micOn);
        micButton.setAttribute('aria-pressed', String(!micOn));
        const label = micOn ? 'Mute microphone' : 'Unmute microphone';
        micButton.setAttribute('aria-label', label);
        micButton.title = label;
        micButton.querySelector('i').className = micOn ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
    }

    if (camButton) {
        camButton.disabled = !hasVideo;
        camButton.classList.toggle('is-off', !camOn);
        camButton.setAttribute('aria-pressed', String(!camOn));
        const label = camOn ? 'Turn off camera' : 'Turn on camera';
        camButton.setAttribute('aria-label', label);
        camButton.title = label;
        camButton.querySelector('i').className = camOn ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';
    }

    setTileState('local', { micOn, camOn });
}

function publishMediaState() {
    if (!myParticipantRef) return;
    updateDoc(myParticipantRef, { micOn, camOn }).catch((err) => console.error('Error sharing mic/camera state:', err));
}

function toggleMic() {
    if (!localStream) return;
    const tracks = localStream.getAudioTracks();
    if (!tracks.length) return;
    micOn = !micOn;
    tracks.forEach((t) => { t.enabled = micOn; });
    updateControls();
    publishMediaState();
}

function toggleCamera() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) return;
    camOn = !camOn;
    tracks.forEach((t) => { t.enabled = camOn; });
    updateControls();
    publishMediaState();
}

if (micButton) micButton.addEventListener('click', toggleMic);
if (camButton) camButton.addEventListener('click', toggleCamera);
if (hangupButton) hangupButton.addEventListener('click', hangUpGroupCall);

const AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1
};

const VIDEO_CONSTRAINTS = {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 24, max: 30 }
};

async function startLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: AUDIO_CONSTRAINTS });
    } catch (err) {
        console.error('Camera + mic unavailable, trying mic only.', err);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        } catch (err2) {
            console.error('Error accessing media devices.', err2);
            alert('Could not access your camera or microphone. Check your browser permissions and try again.');
            return false;
        }
    }

    micOn = localStream.getAudioTracks().length > 0;
    camOn = localStream.getVideoTracks().length > 0;
    return true;
}

function removePeer(uid) {
    const pc = peerConnections[uid];
    if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.close();
        delete peerConnections[uid];
    }
    const tile = getTile(uid);
    if (tile) {
        const video = tile.querySelector('video');
        if (video) video.srcObject = null;
        tile.remove();
    }
    updateGrid();
}

function createPeer(remoteUid, remoteName) {
    removePeer(remoteUid);

    const pc = new RTCPeerConnection(servers);
    peerConnections[remoteUid] = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    const remoteStream = new MediaStream();
    ensureRemoteTile(remoteUid, remoteName).srcObject = remoteStream;

    pc.ontrack = (event) => {
        if (!remoteStream.getTracks().includes(event.track)) {
            remoteStream.addTrack(event.track);
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') tuneSenders(pc);
    };

    return pc;
}

async function tuneSenders(pc) {
    for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];

        if (sender.track.kind === 'video') {
            params.encodings[0].maxBitrate = 600000;
            params.encodings[0].priority = 'low';
            params.encodings[0].networkPriority = 'low';
        } else {
            params.encodings[0].maxBitrate = 64000;
            params.encodings[0].priority = 'high';
            params.encodings[0].networkPriority = 'high';
        }

        try {
            await sender.setParameters(params);
        } catch (err) {
            console.warn('Could not tune sender:', err);
        }
    }
}

function addRemoteCandidate(pc, candidateData) {
    const candidate = new RTCIceCandidate(candidateData);
    if (pc.remoteDescription) {
        pc.addIceCandidate(candidate).catch(() => {});
    } else {
        (pc._pendingCandidates = pc._pendingCandidates || []).push(candidate);
    }
}

async function flushCandidates(pc) {
    const pending = pc._pendingCandidates || [];
    pc._pendingCandidates = [];
    for (const candidate of pending) {
        await pc.addIceCandidate(candidate).catch(() => {});
    }
}

function listenForCandidates(pc, candidatesCol) {
    callUnsubs.push(onSnapshot(candidatesCol, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') addRemoteCandidate(pc, change.doc.data());
        });
    }));
}

async function callPeer(user, roomRef, remote) {
    const pc = createPeer(remote.uid, remote.displayName);

    const callRef = doc(roomRef, 'calls', `${user.uid}_${remote.uid}_${myJoinedMs}`);
    myCallDocRefs.push(callRef);
    const callerCandidates = collection(callRef, 'callerCandidates');
    const calleeCandidates = collection(callRef, 'calleeCandidates');

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(callerCandidates, event.candidate.toJSON()).catch((err) => console.error(err));
        }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(callRef, {
        from: user.uid,
        fromName: currentDisplayName,
        to: remote.uid,
        offer: { type: offer.type, sdp: offer.sdp },
        answer: null,
        createdAt: serverTimestamp()
    });

    callUnsubs.push(onSnapshot(callRef, async (snap) => {
        const data = snap.data();
        if (data && data.answer && !pc.currentRemoteDescription) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                await flushCandidates(pc);
            } catch (err) {
                console.error('Error applying answer:', err);
            }
        }
    }));

    listenForCandidates(pc, calleeCandidates);
}

async function answerCall(callRef, data) {
    const pc = createPeer(data.from, data.fromName);

    const callerCandidates = collection(callRef, 'callerCandidates');
    const calleeCandidates = collection(callRef, 'calleeCandidates');

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(calleeCandidates, event.candidate.toJSON()).catch((err) => console.error(err));
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(callRef, { answer: { type: answer.type, sdp: answer.sdp } });

    listenForCandidates(pc, callerCandidates);
}

function listenForCalls(user, roomRef) {
    const incoming = query(collection(roomRef, 'calls'), where('to', '==', user.uid));

    callUnsubs.push(onSnapshot(incoming, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'removed') return;

            const data = change.doc.data();
            if (!data.offer || data.answer || !data.createdAt) return;
            if (data.createdAt.toMillis() < myJoinedMs) return;
            if (answeredCalls.has(change.doc.id)) return;
            answeredCalls.add(change.doc.id);

            answerCall(change.doc.ref, data).catch((err) => console.error('Error answering call:', err));
        });
    }));
}

function listenForParticipants(user, roomRef) {
    callUnsubs.push(onSnapshot(collection(roomRef, 'participants'), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const p = change.doc.data();
            if (!p.uid || p.uid === user.uid) return;

            if (change.type === 'removed') {
                delete remoteMedia[p.uid];
                removePeer(p.uid);
                return;
            }

            remoteMedia[p.uid] = { micOn: p.micOn !== false, camOn: p.camOn !== false };
            setTileState(p.uid, remoteMedia[p.uid]);
        });
    }));
}

async function deleteCallDoc(callRef) {
    for (const name of ['callerCandidates', 'calleeCandidates']) {
        const snap = await getDocs(collection(callRef, name));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(callRef);
}

async function joinGroupCall(roomId = CALL_ROOM_ID) {
    const user = auth.currentUser;
    if (!user || inCall) return;

    inCall = true;
    renderCallPresence();

    if (!(await startLocalMedia())) {
        inCall = false;
        renderCallPresence();
        return;
    }

    const wasEmpty = freshParticipants().length === 0;
    currentRoomId = roomId;
    answeredCalls.clear();

    showCallModal();
    buildTile('local', currentDisplayName, true).video.srcObject = localStream;
    updateControls();

    try {
        const roomRef = doc(db, 'groupCalls', roomId);
        myParticipantRef = doc(roomRef, 'participants', user.uid);

        await setDoc(myParticipantRef, {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            micOn,
            camOn,
            heartbeatMs: Date.now(),
            joinedAt: serverTimestamp()
        });

        const joined = await getDoc(myParticipantRef);
        const joinedAt = joined.data() && joined.data().joinedAt;
        myJoinedMs = joinedAt && joinedAt.toMillis ? joinedAt.toMillis() : Date.now();

        heartbeatTimer = setInterval(() => {
            if (myParticipantRef) {
                updateDoc(myParticipantRef, { heartbeatMs: Date.now() }).catch(() => {});
            }
        }, HEARTBEAT_MS);

        if (wasEmpty) postCallStartedMessage(roomId);

        listenForParticipants(user, roomRef);
        listenForCalls(user, roomRef);

        const existing = await getDocs(collection(roomRef, 'participants'));
        for (const d of existing.docs) {
            const remote = d.data();
            if (remote.uid === user.uid || !isFresh(remote)) continue;

            const remoteJoined = remote.joinedAt && remote.joinedAt.toMillis ? remote.joinedAt.toMillis() : 0;
            const theyJoinedAfterMe = remoteJoined > myJoinedMs || (remoteJoined === myJoinedMs && remote.uid > user.uid);
            if (theyJoinedAfterMe) continue;

            remoteMedia[remote.uid] = { micOn: remote.micOn !== false, camOn: remote.camOn !== false };
            await callPeer(user, roomRef, remote);
        }
    } catch (err) {
        console.error('Error joining call:', err);
        alert('Could not join the call. Please try again.');
        await hangUpGroupCall();
    }
}

async function hangUpGroupCall() {
    if (!inCall) return;
    inCall = false;

    const participantRef = myParticipantRef;
    const callRefs = myCallDocRefs;
    myParticipantRef = null;
    myCallDocRefs = [];

    callUnsubs.forEach((unsub) => unsub());
    callUnsubs = [];

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    Object.keys(peerConnections).forEach(removePeer);

    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
    }

    Object.keys(remoteMedia).forEach((uid) => delete remoteMedia[uid]);
    if (videoGrid) videoGrid.innerHTML = '';
    updateGrid();
    hideCallModal();
    currentRoomId = null;
    renderCallPresence();

    try {
        if (participantRef) await deleteDoc(participantRef);
        await Promise.all(callRefs.map(deleteCallDoc));
    } catch (err) {
        console.error('Error leaving room:', err);
    }
}

window.addEventListener('beforeunload', () => {
    if (myParticipantRef) deleteDoc(myParticipantRef);
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const cacheKey = `aurora_user_cache_${user.uid}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                applyUserData(parsed);
                localStorage.setItem('aurora_quick_id', parsed.sequentialId);
            } catch {
                localStorage.removeItem(cacheKey);
            }
        }

        try {
            const userRef = doc(db, "users", user.uid);
            const userSnapshot = await getDoc(userRef);

            if (userSnapshot.exists()) {
                const userData = userSnapshot.data();
                localStorage.setItem(cacheKey, JSON.stringify(userData));
                localStorage.setItem('aurora_quick_id', userData.sequentialId);
                applyUserData(userData);
            } else if (!cachedData && userInfoElement) {
                userInfoElement.textContent = "User profile not found.";
            }
        } catch (error) {
            if (!cachedData && userInfoElement) {
                userInfoElement.textContent = "Failed to load user data.";
            }
        }

        setupPresence(user);
        initOnlineUsersList();
        initChat();
        watchCallRoom();
    } else {
        localStorage.removeItem('aurora_quick_id');
        window.location.href = '../';
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        const user = auth.currentUser;
        await hangUpGroupCall();
        if (user) {
            await setDoc(doc(db, "status", user.uid), { status: 'offline', lastChanged: serverTimestamp() }, { merge: true });
        }
        if (presenceInterval) clearInterval(presenceInterval);
        await signOut(auth);
        localStorage.clear();
        window.location.href = '../';
    });
}

if (settingsButton) {
    settingsButton.addEventListener('click', () => {
        window.location.href = '/aurora/settings/account/';
    });
}