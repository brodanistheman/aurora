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

// People's computers often have clocks that are off by minutes. Call "freshness"
// checks compare timestamps written by different computers, so we estimate how far
// our clock is from the server's and correct for it.
let serverOffsetMs = 0;

function nowMs() {
    return Date.now() + serverOffsetMs;
}

async function syncServerClock(statusRef) {
    try {
        const snap = await getDoc(statusRef);
        const changed = snap.data() && snap.data().lastChanged;
        if (changed && changed.toMillis) serverOffsetMs = changed.toMillis() - Date.now();
    } catch (err) {
        console.warn('Could not sync clock with server:', err);
    }
}

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

    updateStatus('online').then(() => syncServerClock(userStatusRef));

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

/* ------------------------------------------------------------------ */
/* Reply feature                                                       */
/* ------------------------------------------------------------------ */

let replyTarget = null;

const replyBanner = document.getElementById('reply-banner');
const replyBannerName = document.getElementById('reply-banner-name');
const replyBannerSnippet = document.getElementById('reply-banner-snippet');
const replyCancelButton = document.getElementById('reply-cancel');

function makeSnippet(msg) {
    const text = (msg.text || '').trim();
    if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    if (msg.imageUrl) return 'Image';
    if (msg.videoUrl) return 'Video';
    return '';
}

function setReplyTarget(msg) {
    replyTarget = {
        id: msg.id,
        displayName: msg.displayName || 'Anonymous',
        snippet: makeSnippet(msg)
    };
    if (replyBannerName) replyBannerName.textContent = replyTarget.displayName;
    if (replyBannerSnippet) replyBannerSnippet.textContent = replyTarget.snippet;
    if (replyBanner) replyBanner.classList.remove('hidden');
    if (messageInput) messageInput.focus();
}

function clearReply() {
    replyTarget = null;
    if (replyBanner) replyBanner.classList.add('hidden');
}

function jumpToMessage(id) {
    if (!messageBox) return;
    const target = messageBox.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('is-highlighted');
    setTimeout(() => target.classList.remove('is-highlighted'), 1500);
}

if (replyCancelButton) replyCancelButton.addEventListener('click', clearReply);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyTarget && document.activeElement === messageInput) clearReply();
});

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

function initChat() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(30));

    onSnapshot(q, (snapshot) => {
        if (!messageBox) return;

        const shouldStickToBottom = isScrolledNearBottom(messageBox);
        messageBox.innerHTML = '';

        const docsToRender = [];
        snapshot.forEach((d) => docsToRender.push({ id: d.id, ...d.data() }));

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
            div.dataset.messageId = msg.id;

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

            let quoteHtml = '';
            if (msg.replyTo && msg.replyTo.id) {
                quoteHtml = `
                    <button type="button" class="chat-reply-quote">
                        <strong>${escapeHtml(msg.replyTo.displayName || 'Anonymous')}</strong>
                        <span>${escapeHtml(msg.replyTo.snippet || 'Original message')}</span>
                    </button>`;
            }

            div.innerHTML = `
                <img src="${senderPic}" alt="" class="chat-profile-pic" onerror="this.src='${defaultAvatar}'">
                <div class="chat-message-content">
                    ${quoteHtml}
                    <div class="chat-message-header">
                        <span class="chat-sender-name">${senderDisplay}</span>
                        <button type="button" class="chat-reply-btn" title="Reply" aria-label="Reply to ${senderDisplay}">
                            <i class="fa-solid fa-reply"></i>
                        </button>
                    </div>
                    <div class="chat-message-body">${contentHtml}</div>
                </div>
            `;

            div.querySelector('.chat-reply-btn').addEventListener('click', () => setReplyTarget(msg));
            const quote = div.querySelector('.chat-reply-quote');
            if (quote) quote.addEventListener('click', () => jumpToMessage(msg.replyTo.id));

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
            replyTo: replyTarget ? { ...replyTarget } : null,
            createdAt: serverTimestamp()
        });
        messageInput.value = '';
        clearReply();
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

/* ------------------------------------------------------------------ */
/* Group call                                                          */
/* ------------------------------------------------------------------ */

const CALL_ROOM_ID = 'main-room';
const HEARTBEAT_MS = 20000;
const STALE_AFTER_MS = 75000;

// TURN relays audio/video for people whose network blocks direct connections
// (school/work Wi-Fi, mobile data, strict routers). Without it, those people
// connect to the call but can't hear or see anyone.
//
// Sign up for a TURN provider (e.g. metered.ca has a free plan), generate
// credentials, and paste the entries they give you here. Use the exact hostnames
// and ports shown in your provider's dashboard.
const TURN_SERVERS = [
    // { urls: 'turn:standard.relay.metered.ca:80', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' },
    // { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' },
    // { urls: 'turn:standard.relay.metered.ca:443', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' },
    // { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' },
];

if (!TURN_SERVERS.length) {
    console.warn('[call] No TURN server configured. People on strict networks will not be able to connect.');
}

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
        ...TURN_SERVERS
    ]
};

const MAX_CALL_RETRIES = 2;

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
let camOn = false;
let camBusy = false;
let roomParticipants = [];
let roomWatchStarted = false;
const answeredCalls = new Set();
const remoteMedia = {};
const remoteAudio = {};

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
const audioUnlock = document.getElementById('audio-unlock');

// Some browsers block sound until the user clicks. If that happens we show a
// button instead of leaving people in a silent call.
function showAudioBlocked() {
    if (audioUnlock) audioUnlock.classList.remove('hidden');
}

function playRemoteAudio(audioEl) {
    const attempt = audioEl.play();
    if (attempt && attempt.catch) attempt.catch(showAudioBlocked);
}

function unlockAudio() {
    Object.values(remoteAudio).forEach((audioEl) => audioEl.play().catch(() => {}));
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (audioUnlock) audioUnlock.classList.add('hidden');
}

if (audioUnlock) audioUnlock.addEventListener('click', unlockAudio);

function setTileConnection(uid, state) {
    const tile = getTile(uid);
    if (!tile) return;
    tile.dataset.conn = state;
    const status = tile.querySelector('.tile-status');
    if (!status) return;
    status.textContent = state === 'connected' ? '' : state === 'failed' ? "Can't connect" : 'Connecting…';
}

function isFresh(participant) {
    return nowMs() - (participant.heartbeatMs || 0) < STALE_AFTER_MS;
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

    videoGrid.dataset.count = String(n);

    if (callCount) callCount.textContent = String(Math.max(n, 1));
    if (callStatus) {
        callStatus.textContent = n <= 1 ? 'Waiting for others to join' : `${n} people in the call`;
    }
}

function buildTile(id, name, isLocal) {
    const tile = document.createElement('div');
    tile.className = `video-tile${isLocal ? ' local' : ' remote'}`;
    tile.dataset.tileId = id;
    tile.dataset.name = name || 'Anonymous';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // remote sound plays through a separate <audio> element

    const avatar = document.createElement('div');
    avatar.className = 'tile-avatar';
    const avatarImg = document.createElement('img');
    avatarImg.alt = '';
    avatarImg.src = isLocal ? (currentProfilePic || defaultAvatar) : defaultAvatar;
    avatarImg.addEventListener('error', () => { avatarImg.src = defaultAvatar; }, { once: true });
    avatar.appendChild(avatarImg);

    const label = document.createElement('div');
    label.className = 'tile-label';
    const micIcon = document.createElement('i');
    micIcon.className = 'fa-solid fa-microphone-slash mic-icon';
    const deafenIcon = document.createElement('i');
    deafenIcon.className = 'fa-solid fa-volume-xmark deafen-icon';
    const nameEl = document.createElement('span');
    nameEl.textContent = isLocal ? 'You' : (name || 'Anonymous');
    label.append(micIcon, deafenIcon, nameEl);

    if (!isLocal) {
        tile.tabIndex = 0;
        tile.title = 'Click for voice settings';
        tile.setAttribute('role', 'button');
        tile.setAttribute('aria-haspopup', 'menu');
        tile.setAttribute('aria-label', `Voice settings for ${name || 'Anonymous'}`);
        tile.addEventListener('click', () => toggleTileMenu(id, tile));
        tile.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleTileMenu(id, tile);
            }
        });
    }

    const status = document.createElement('div');
    status.className = 'tile-status';

    tile.append(video, avatar, status, label);
    videoGrid.appendChild(tile);
    updateGrid();

    return { tile, video };
}

function ensureRemoteTile(uid, name) {
    let tile = getTile(uid);
    if (!tile) {
        tile = buildTile(uid, name, false).tile;
        if (remoteMedia[uid]) setTileState(uid, remoteMedia[uid]);
        applyPrefs(uid);
        getProfilePic(uid).then((pic) => setTileAvatar(uid, pic));
    }
    return tile.querySelector('video');
}

const PREFS_KEY = 'aurora_call_prefs';
const peerPrefs = loadPrefs();
let tileMenuEl = null;
let openMenuUid = null;

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch {
        return {};
    }
}

function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(peerPrefs));
    } catch {}
}

function getPrefs(uid) {
    return { volume: 1, deafened: false, hideVideo: false, ...(peerPrefs[uid] || {}) };
}

function setPrefs(uid, patch) {
    peerPrefs[uid] = { ...getPrefs(uid), ...patch };
    savePrefs();
    applyPrefs(uid);
}

function applyPrefs(uid) {
    const prefs = getPrefs(uid);

    const audioEl = remoteAudio[uid];
    if (audioEl) {
        audioEl.volume = prefs.volume;
        audioEl.muted = prefs.deafened;
    }

    const tile = getTile(uid);
    if (!tile) return;
    tile.classList.toggle('deafened', prefs.deafened);
    tile.classList.toggle('video-hidden', prefs.hideVideo);
}

function closeTileMenu() {
    if (tileMenuEl) {
        tileMenuEl.remove();
        tileMenuEl = null;
    }
    openMenuUid = null;
}

function toggleTileMenu(uid, tile) {
    if (openMenuUid === uid) {
        closeTileMenu();
    } else {
        openTileMenu(uid, tile);
    }
}

function positionTileMenu(menu, tile) {
    const margin = 12;
    const rect = tile.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - menuRect.width / 2;
    let top = rect.top + rect.height / 2 - menuRect.height / 2;

    left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function openTileMenu(uid, tile) {
    closeTileMenu();
    if (!callModal) return;

    const name = tile.dataset.name || 'Anonymous';
    const prefs = getPrefs(uid);
    const percent = Math.round(prefs.volume * 100);

    const menu = document.createElement('div');
    menu.className = `tile-menu${prefs.deafened ? ' is-deafened' : ''}`;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Voice settings for ${name}`);
    menu.innerHTML = `
        <div class="tile-menu-head">
            <img class="tile-menu-avatar" alt="">
            <span class="tile-menu-name">${escapeHtml(name)}</span>
        </div>
        <div class="tile-menu-volume">
            <label class="tile-menu-row" for="tile-menu-volume-input">
                <span>Volume</span>
                <span class="tile-menu-value">${percent}%</span>
            </label>
            <input id="tile-menu-volume-input" class="tile-menu-slider" type="range" min="0" max="100" step="1" value="${percent}">
        </div>
        <button type="button" class="tile-menu-item" role="menuitemcheckbox" data-action="deafen" aria-checked="${prefs.deafened}">
            <i class="fa-solid fa-volume-xmark"></i>
            <span class="tile-menu-text">Deafen<small>You won't hear them</small></span>
            <span class="tile-menu-switch"></span>
        </button>
        <button type="button" class="tile-menu-item" role="menuitemcheckbox" data-action="video" aria-checked="${prefs.hideVideo}">
            <i class="fa-solid fa-eye-slash"></i>
            <span class="tile-menu-text">Hide video<small>Show their picture instead</small></span>
            <span class="tile-menu-switch"></span>
        </button>
        <button type="button" class="tile-menu-item" role="menuitem" data-action="reset">
            <i class="fa-solid fa-rotate-left"></i>
            <span class="tile-menu-text">Reset settings</span>
        </button>
    `;

    const tileImg = tile.querySelector('.tile-avatar img');
    menu.querySelector('.tile-menu-avatar').src = tileImg ? tileImg.getAttribute('src') : defaultAvatar;

    const slider = menu.querySelector('.tile-menu-slider');
    const valueEl = menu.querySelector('.tile-menu-value');

    slider.addEventListener('input', () => {
        valueEl.textContent = `${slider.value}%`;
        setPrefs(uid, { volume: Number(slider.value) / 100 });
    });

    menu.addEventListener('click', (event) => {
        const item = event.target.closest('.tile-menu-item');
        if (!item) return;

        const action = item.dataset.action;
        if (action === 'deafen') {
            const next = !getPrefs(uid).deafened;
            setPrefs(uid, { deafened: next });
            item.setAttribute('aria-checked', String(next));
            menu.classList.toggle('is-deafened', next);
        } else if (action === 'video') {
            const next = !getPrefs(uid).hideVideo;
            setPrefs(uid, { hideVideo: next });
            item.setAttribute('aria-checked', String(next));
        } else if (action === 'reset') {
            delete peerPrefs[uid];
            savePrefs();
            applyPrefs(uid);
            openTileMenu(uid, tile);
        }
    });

    callModal.appendChild(menu);
    tileMenuEl = menu;
    openMenuUid = uid;
    positionTileMenu(menu, tile);
    slider.focus();
}

document.addEventListener('mousedown', (event) => {
    if (!tileMenuEl || tileMenuEl.contains(event.target)) return;
    const onTile = event.target.closest ? event.target.closest('.video-tile.remote') : null;
    if (onTile && onTile.dataset.tileId === openMenuUid) return;
    closeTileMenu();
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !tileMenuEl) return;
    const tile = openMenuUid ? getTile(openMenuUid) : null;
    closeTileMenu();
    if (tile) tile.focus();
});

window.addEventListener('resize', closeTileMenu);

const SPEAKING_THRESHOLD = 0.025;
const SPEAKING_HOLD_MS = 350;
const SPEAKING_POLL_MS = 80;
const profilePicCache = {};
const speakingMonitors = {};
let audioCtx = null;
let speakingTimer = null;

async function getProfilePic(uid) {
    if (profilePicCache[uid] !== undefined) return profilePicCache[uid];
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        const pic = snap.exists() ? snap.data().profilePic : '';
        profilePicCache[uid] = isSafeImageSrc(pic) ? pic : defaultAvatar;
    } catch (err) {
        profilePicCache[uid] = defaultAvatar;
    }
    return profilePicCache[uid];
}

function setTileAvatar(id, src) {
    const tile = getTile(id);
    const img = tile ? tile.querySelector('.tile-avatar img') : null;
    if (img) img.src = src || defaultAvatar;
}

function getAudioContext() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

function checkSpeaking() {
    const now = performance.now();
    Object.keys(speakingMonitors).forEach((id) => {
        const monitor = speakingMonitors[id];
        monitor.analyser.getByteTimeDomainData(monitor.data);

        let sum = 0;
        for (let i = 0; i < monitor.data.length; i++) {
            const v = (monitor.data[i] - 128) / 128;
            sum += v * v;
        }
        const level = Math.sqrt(sum / monitor.data.length);
        if (level > SPEAKING_THRESHOLD) monitor.lastLoud = now;

        const speaking = now - monitor.lastLoud < SPEAKING_HOLD_MS;
        if (speaking !== monitor.speaking) {
            monitor.speaking = speaking;
            const tile = getTile(id);
            if (tile) tile.classList.toggle('speaking', speaking);
        }
    });
}

function watchSpeaking(id, audioTrack) {
    stopWatchingSpeaking(id);
    const ctx = getAudioContext();
    if (!ctx || !audioTrack) return;

    try {
        const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        speakingMonitors[id] = {
            source,
            analyser,
            data: new Uint8Array(analyser.fftSize),
            speaking: false,
            lastLoud: 0
        };

        if (!speakingTimer) speakingTimer = setInterval(checkSpeaking, SPEAKING_POLL_MS);
    } catch (err) {
        console.warn('Could not monitor audio level:', err);
    }
}

function stopWatchingSpeaking(id) {
    const monitor = speakingMonitors[id];
    if (!monitor) return;

    try {
        monitor.source.disconnect();
    } catch (err) {}
    delete speakingMonitors[id];

    const tile = getTile(id);
    if (tile) tile.classList.remove('speaking');

    if (!Object.keys(speakingMonitors).length && speakingTimer) {
        clearInterval(speakingTimer);
        speakingTimer = null;
    }
}

function stopAllSpeaking() {
    Object.keys(speakingMonitors).forEach(stopWatchingSpeaking);
    if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
    }
}

function updateControls() {
    const hasAudio = !!localStream && localStream.getAudioTracks().length > 0;
    camOn = !!localStream && localStream.getVideoTracks().length > 0;

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
        camButton.disabled = !localStream || camBusy;
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

/* Camera is off by default. It is only requested when the user turns it on,
   and released completely (camera light off) when they turn it off. */

async function setOutgoingVideo(track) {
    await Promise.all(Object.values(peerConnections).map(async (pc) => {
        const transceiver = pc.getTransceivers().find(
            (t) => !t.stopped && t.receiver.track && t.receiver.track.kind === 'video'
        );
        if (!transceiver) return;
        try {
            await transceiver.sender.replaceTrack(track);
            if (track) tuneSenders(pc);
        } catch (err) {
            console.warn('Could not swap video track:', err);
        }
    }));
}

async function startCamera() {
    let camStream;
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
    } catch (err) {
        console.error('Camera unavailable.', err);
        alert('Could not access your camera. Check your browser permissions (the lock icon in the address bar) and try again.');
        return false;
    }
    const track = camStream.getVideoTracks()[0];
    localStream.addTrack(track);
    await setOutgoingVideo(track);
    return true;
}

async function stopCamera() {
    localStream.getVideoTracks().forEach((t) => {
        t.stop();
        localStream.removeTrack(t);
    });
    await setOutgoingVideo(null);
}

async function toggleCamera() {
    if (!localStream || camBusy) return;
    camBusy = true;
    updateControls();
    try {
        if (camOn) {
            await stopCamera();
        } else {
            await startCamera();
        }
    } finally {
        camBusy = false;
        updateControls();
        publishMediaState();
    }
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
        localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    } catch (err) {
        console.error('Error accessing microphone.', err);
        alert('Could not access your microphone. Check your browser permissions (the lock icon in the address bar) and try again.');
        return false;
    }

    micOn = true;
    camOn = false;
    return true;
}

function removePeer(uid) {
    if (openMenuUid === uid) closeTileMenu();
    stopWatchingSpeaking(uid);
    const audioEl = remoteAudio[uid];
    if (audioEl) {
        audioEl.pause();
        audioEl.srcObject = null;
        delete remoteAudio[uid];
    }
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

function createPeer(remoteUid, remoteName, isCaller = false, onFailed = null) {
    removePeer(remoteUid);

    const pc = new RTCPeerConnection(servers);
    peerConnections[remoteUid] = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // Reserve a video slot in the offer so the camera can be attached later
    // with replaceTrack() and no renegotiation.
    if (isCaller && !localStream.getVideoTracks().length) {
        pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    // Picture and sound are played separately. The tile's <video> only shows
    // the picture (always muted); sound comes from a dedicated <audio> element,
    // so hearing someone never depends on their camera sending frames.
    const remoteVideoStream = new MediaStream();
    ensureRemoteTile(remoteUid, remoteName).srcObject = remoteVideoStream;
    setTileConnection(remoteUid, 'connecting');

    const remoteAudioStream = new MediaStream();
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.srcObject = remoteAudioStream;
    remoteAudio[remoteUid] = audioEl;
    applyPrefs(remoteUid);

    pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            if (remoteAudioStream.getTracks().includes(event.track)) return;
            remoteAudioStream.addTrack(event.track);
            playRemoteAudio(audioEl);
            watchSpeaking(remoteUid, event.track);
        } else if (!remoteVideoStream.getTracks().includes(event.track)) {
            remoteVideoStream.addTrack(event.track);
        }
    };

    pc.onicecandidateerror = (event) => {
        console.warn('[call] ICE server error:', event.url, event.errorCode, event.errorText);
    };

    pc.onconnectionstatechange = () => {
        if (peerConnections[remoteUid] !== pc) return;

        const state = pc.connectionState;
        console.info(`[call] ${remoteName || remoteUid}: ${state}`);

        if (state === 'connected') {
            setTileConnection(remoteUid, 'connected');
            tuneSenders(pc);
        } else if (state === 'failed') {
            setTileConnection(remoteUid, 'failed');
            if (onFailed) onFailed();
        } else {
            setTileConnection(remoteUid, 'connecting');
        }
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

async function callPeer(user, roomRef, remote, attempt = 0) {
    const pc = createPeer(remote.uid, remote.displayName, true, () => {
        // Connection failed: try again with a new offer, a couple of times.
        if (!inCall || attempt >= MAX_CALL_RETRIES) return;
        setTimeout(() => {
            if (inCall && peerConnections[remote.uid] === pc) {
                callPeer(user, roomRef, remote, attempt + 1)
                    .catch((err) => console.error('Retry failed:', err));
            }
        }, 1500);
    });

    const callRef = doc(roomRef, 'calls', `${user.uid}_${remote.uid}_${myJoinedMs}_${attempt}`);
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
    const pc = createPeer(data.from, data.fromName, false);

    const callerCandidates = collection(callRef, 'callerCandidates');
    const calleeCandidates = collection(callRef, 'calleeCandidates');

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            addDoc(calleeCandidates, event.candidate.toJSON()).catch((err) => console.error(err));
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    // The video slot created from the caller's offer is receive-only by default.
    // Make it send/receive so our camera can be attached later without renegotiating.
    pc.getTransceivers().forEach((t) => {
        if (t.receiver.track && t.receiver.track.kind === 'video' && t.direction === 'recvonly') {
            t.direction = 'sendrecv';
        }
    });

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
    const localAudioTrack = localStream.getAudioTracks()[0];
    if (localAudioTrack) watchSpeaking('local', localAudioTrack);
    updateControls();

    try {
        const roomRef = doc(db, 'groupCalls', roomId);
        myParticipantRef = doc(roomRef, 'participants', user.uid);

        await setDoc(myParticipantRef, {
            uid: user.uid,
            displayName: currentDisplayName,
            micOn,
            camOn,
            heartbeatMs: nowMs(),
            joinedAt: serverTimestamp()
        });

        const joined = await getDoc(myParticipantRef);
        const joinedAt = joined.data() && joined.data().joinedAt;
        myJoinedMs = joinedAt && joinedAt.toMillis ? joinedAt.toMillis() : Date.now();

        heartbeatTimer = setInterval(() => {
            if (myParticipantRef) {
                updateDoc(myParticipantRef, { heartbeatMs: nowMs() }).catch(() => {});
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

    closeTileMenu();
    stopAllSpeaking();
    if (audioUnlock) audioUnlock.classList.add('hidden');

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

    camOn = false;
    camBusy = false;

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

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

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