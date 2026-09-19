import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getDocs, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
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

    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('group-call-btn')) {
        const groupBtn = document.createElement('button');
        groupBtn.id = 'group-call-btn';
        groupBtn.type = 'button';
        groupBtn.textContent = 'Start Group Call';
        groupBtn.style.marginTop = '10px';
        groupBtn.addEventListener('click', () => joinGroupCall("main-room"));
        sidebar.appendChild(groupBtn);
    }
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
        snapshot.forEach((doc) => docsToRender.push(doc.data()));

        if (docsToRender.length === 0) {
            messageBox.innerHTML = `<p class="empty-state">No messages yet. Say hello!</p>`;
            return;
        }

        docsToRender.reverse().forEach((msg) => {
            const div = document.createElement('div');
            div.className = 'chat-message';

            const senderDisplay = escapeHtml(msg.displayName || 'Anonymous');
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

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let localStream = null;
let currentRoomId = null;
let peerConnections = {};

const callModal = document.getElementById('call-modal');
const localVideo = document.getElementById('local-video');
const videoGrid = document.getElementById('video-grid');
const hangupButton = document.getElementById('hangup-button');
const callStatus = document.getElementById('call-status');

function showCallModal() {
    if (callModal) callModal.classList.remove('hidden');
}

function hideCallModal() {
    if (callModal) callModal.classList.add('hidden');
}

async function startLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (localVideo) localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Error accessing media devices.", err);
        alert("Could not access camera/microphone.");
    }
}

async function hangUpGroupCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};

    if (currentRoomId && auth.currentUser) {
        try {
            await deleteDoc(doc(db, "groupCalls", currentRoomId, "participants", auth.currentUser.uid));
        } catch (e) {
            console.error("Error leaving room:", e);
        }
        currentRoomId = null;
    }

    if (videoGrid) {
        const remotes = videoGrid.querySelectorAll('.remote-video-container');
        remotes.forEach(el => el.remove());
    }

    hideCallModal();
}

if (hangupButton) {
    hangupButton.addEventListener('click', hangUpGroupCall);
}

async function joinGroupCall(roomId) {
    await startLocalMedia();
    showCallModal();
    if (callStatus) callStatus.textContent = `Joined room: ${roomId}`;
    currentRoomId = roomId;

    const user = auth.currentUser;
    if (!user) return;

    const roomRef = doc(db, "groupCalls", roomId);
    const participantRef = doc(roomRef, "participants", user.uid);

    await setDoc(participantRef, { uid: user.uid, displayName: currentDisplayName, joinedAt: serverTimestamp() });

    const participantsCol = collection(roomRef, "participants");
    onSnapshot(participantsCol, async (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const remoteUser = change.doc.data();
            if (remoteUser.uid === user.uid) return;

            if (change.type === 'added') {
                const pc = new RTCPeerConnection(servers);
                peerConnections[remoteUser.uid] = pc;

                localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

                const remoteStream = new MediaStream();
                let remoteVideoEl = document.getElementById(`video-${remoteUser.uid}`);
                if (!remoteVideoEl) {
                    const container = document.createElement('div');
                    container.className = 'remote-video-container';
                    container.style.position = 'relative';
                    container.innerHTML = `
                        <video id="video-${remoteUser.uid}" autoplay playsinline style="width: 100%; height: 150px; background: #000; border-radius: 6px; object-fit: cover;"></video>
                        <span style="position: absolute; bottom: 5px; left: 5px; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 6px; font-size: 11px; border-radius: 4px;">${escapeHtml(remoteUser.displayName)}</span>
                    `;
                    videoGrid.appendChild(container);
                    remoteVideoEl = document.getElementById(`video-${remoteUser.uid}`);
                }
                remoteVideoEl.srcObject = remoteStream;

                pc.ontrack = (event) => {
                    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
                };

                const offerCandidatesCol = collection(roomRef, "participants", user.uid, "offers", remoteUser.uid, "candidates");
                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        addDoc(offerCandidatesCol, event.candidate.toJSON());
                    }
                };

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                const offerDocRef = doc(roomRef, "participants", user.uid, "offers", remoteUser.uid);
                await setDoc(offerDocRef, { offer: { type: offer.type, sdp: offer.sdp } });

                onSnapshot(offerDocRef, async (docSnap) => {
                    const data = docSnap.data();
                    if (data && data.answer && !pc.currentRemoteDescription) {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                });
            } else if (change.type === 'removed') {
                if (peerConnections[remoteUser.uid]) {
                    peerConnections[remoteUser.uid].close();
                    delete peerConnections[remoteUser.uid];
                }
                const container = document.getElementById(`video-${remoteUser.uid}`)?.parentElement;
                if (container) container.remove();
            }
        });
    });
}

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
    } else {
        localStorage.removeItem('aurora_quick_id');
        window.location.href = '../';
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        const user = auth.currentUser;
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