import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
    getFirestore,
    collection,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    getDocs,
    onSnapshot,
    serverTimestamp,
    query,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";


const firebaseConfig = {
    // Keep your existing Firebase configuration here.
};


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


const CALL_ROOM_ID = "aurora-main-call";

const defaultAvatar =
    "https://ui-avatars.com/api/?name=User&background=24262d&color=fff";


let currentUser = null;
let currentDisplayName = "Anonymous";
let currentProfilePic = null;

let localStream = null;
let micOn = true;
let camOn = true;

let peerConnections = {};
let remoteMedia = {};
let participantUnsub = null;
let callUnsub = null;
let heartbeatInterval = null;

let audioContext = null;
let audioUnlocked = false;

const remoteAudio = {};
const remoteVideoElements = {};

const callModal = document.getElementById("call-modal");
const videoGrid = document.getElementById("video-grid");
const callCount = document.getElementById("call-count");
const callStatus = document.getElementById("call-status");
const callStatusModal = document.getElementById("call-status-modal");

const groupCallButton = document.getElementById("group-call-btn");
const hangupButton = document.getElementById("hangup-call");

const micButton = document.getElementById("toggle-mic");
const cameraButton = document.getElementById("toggle-camera");

const audioUnlockButton =
    document.getElementById("audio-unlock");

const callEmptyState =
    document.getElementById("call-empty-state");


function nowMs() {
    return Date.now();
}


function isSafeImageSrc(src) {
    if (!src || typeof src !== "string") {
        return false;
    }

    return (
        src.startsWith("https://") ||
        src.startsWith("http://") ||
        src.startsWith("data:image/")
    );
}


function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


async function getUserData(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const snapshot = await getDoc(userRef);

        if (!snapshot.exists()) {
            return null;
        }

        return snapshot.data();
    } catch (error) {
        console.error("Unable to load user:", error);
        return null;
    }
}


async function getProfilePic(uid) {
    try {
        const data = await getUserData(uid);

        if (
            data &&
            isSafeImageSrc(data.profilePic)
        ) {
            return data.profilePic;
        }
    } catch (error) {
        console.error("Unable to load profile picture:", error);
    }

    return null;
}


function setUserInfo() {
    const userInfo = document.getElementById("user-info");

    if (!userInfo || !currentUser) {
        return;
    }

    const avatar = isSafeImageSrc(currentProfilePic)
        ? currentProfilePic
        : defaultAvatar;

    userInfo.innerHTML = `
        <div class="sidebar-user">
            <img
                src="${escapeHtml(avatar)}"
                alt=""
                class="sidebar-user-avatar"
            >

            <div class="sidebar-user-details">
                <strong>${escapeHtml(currentDisplayName)}</strong>
                <span>Online</span>
            </div>
        </div>
    `;
}


async function setupPresence(user) {
    if (!user) {
        return;
    }

    const presenceRef = doc(
        db,
        "presence",
        user.uid
    );

    try {
        await setDoc(
            presenceRef,
            {
                uid: user.uid,
                displayName: currentDisplayName,
                profilePic: currentProfilePic || null,
                online: true,
                lastSeen: serverTimestamp()
            },
            {
                merge: true
            }
        );
    } catch (error) {
        console.error("Presence error:", error);
    }

    window.addEventListener("beforeunload", () => {
        updateDoc(
            presenceRef,
            {
                online: false,
                lastSeen: serverTimestamp()
            }
        ).catch(() => {});
    });
}


function initOnlineUsersList() {
    const list = document.getElementById("online-users-list");

    if (!list) {
        return;
    }

    const presenceCollection =
        collection(db, "presence");

    onSnapshot(
        presenceCollection,
        async snapshot => {
            list.innerHTML = "";

            const users = [];

            snapshot.forEach(item => {
                const data = item.data();

                if (
                    data.online === true &&
                    data.uid !== currentUser?.uid
                ) {
                    users.push({
                        uid: data.uid,
                        displayName:
                            data.displayName ||
                            "Anonymous",
                        profilePic:
                            isSafeImageSrc(data.profilePic)
                                ? data.profilePic
                                : null
                    });
                }
            });

            if (!users.length) {
                list.innerHTML = `
                    <div class="empty-online">
                        No other users online
                    </div>
                `;

                return;
            }

            for (const user of users) {
                const avatar =
                    user.profilePic ||
                    defaultAvatar;

                const row =
                    document.createElement("div");

                row.className = "online-user";

                row.innerHTML = `
                    <img
                        src="${escapeHtml(avatar)}"
                        alt=""
                        class="online-user-avatar"
                    >

                    <div class="online-user-info">
                        <span class="online-dot"></span>
                        <span>
                            ${escapeHtml(user.displayName)}
                        </span>
                    </div>
                `;

                list.appendChild(row);
            }
        },
        error => {
            console.error(
                "Online users listener error:",
                error
            );
        }
    );
}


function createPeerConnection(uid) {
    if (peerConnections[uid]) {
        return peerConnections[uid];
    }

    const peer = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
        });
    }

    peer.ontrack = event => {
        const stream = event.streams[0];

        if (!stream) {
            return;
        }

        attachRemoteStream(uid, stream);
    };

    peer.onconnectionstatechange = () => {
        if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed" ||
            peer.connectionState === "disconnected"
        ) {
            removeRemotePeer(uid);
        }
    };

    peerConnections[uid] = peer;

    return peer;
}


function attachRemoteStream(uid, stream) {
    let tile = document.getElementById(
        `call-tile-${uid}`
    );

    if (!tile) {
        ensureRemoteTile(uid);
        tile = document.getElementById(
            `call-tile-${uid}`
        );
    }

    if (!tile) {
        return;
    }

    let video = tile.querySelector("video");

    if (!video) {
        video = document.createElement("video");

        video.autoplay = true;
        video.playsInline = true;

        tile.insertBefore(
            video,
            tile.querySelector(".call-tile-overlay")
        );
    }

    video.srcObject = stream;

    remoteVideoElements[uid] = video;

    const audio = new Audio();

    audio.autoplay = true;
    audio.srcObject = stream;

    remoteAudio[uid] = audio;

    if (audioUnlocked) {
        audio.play().catch(() => {});
    }
}


function buildTile(id, name, isLocal, profilePic = null) {
    const existing =
        document.getElementById(`call-tile-${id}`);

    if (existing) {
        const nameElement =
            existing.querySelector(".call-tile-name");

        if (nameElement) {
            nameElement.textContent =
                name || "Anonymous";
        }

        const avatar =
            existing.querySelector(".call-tile-avatar");

        if (avatar && profilePic) {
            avatar.src = profilePic;
        }

        return existing;
    }

    const tile =
        document.createElement("div");

    tile.className = "call-tile";
    tile.id = `call-tile-${id}`;

    const avatarSrc =
        isSafeImageSrc(profilePic)
            ? profilePic
            : defaultAvatar;

    tile.innerHTML = `
        <video
            ${isLocal ? "muted" : ""}
            autoplay
            playsinline
        ></video>

        <div class="call-tile-overlay">
            <div class="call-tile-user">
                <img
                    src="${escapeHtml(avatarSrc)}"
                    alt=""
                    class="call-tile-avatar"
                >

                <span class="call-tile-name">
                    ${escapeHtml(name || "Anonymous")}
                </span>
            </div>

            <div class="call-tile-indicators">
                <span class="mic-indicator">
                    Mic
                </span>

                <span class="cam-indicator">
                    Camera
                </span>
            </div>
        </div>
    `;

    videoGrid.appendChild(tile);

    const video =
        tile.querySelector("video");

    if (isLocal && localStream) {
        video.srcObject = localStream;
        video.muted = true;
    }

    return tile;
}


function updateTileState(uid) {
    const tile =
        document.getElementById(`call-tile-${uid}`);

    if (!tile) {
        return;
    }

    const media =
        uid === currentUser?.uid
            ? {
                micOn,
                camOn
            }
            : remoteMedia[uid];

    if (!media) {
        return;
    }

    const micIndicator =
        tile.querySelector(".mic-indicator");

    const camIndicator =
        tile.querySelector(".cam-indicator");

    if (micIndicator) {
        micIndicator.textContent =
            media.micOn ? "Mic" : "Muted";

        micIndicator.classList.toggle(
            "off",
            !media.micOn
        );
    }

    if (camIndicator) {
        camIndicator.textContent =
            media.camOn ? "Camera" : "Camera off";

        camIndicator.classList.toggle(
            "off",
            !media.camOn
        );
    }

    const video =
        tile.querySelector("video");

    if (video) {
        video.style.display =
            media.camOn ? "block" : "none";
    }
}


function updateGrid() {
    if (!videoGrid) {
        return;
    }

    const tiles =
        videoGrid.querySelectorAll(
            ".call-tile"
        );

    const count = tiles.length;

    videoGrid.dataset.count =
        String(count);

    if (callCount) {
        callCount.textContent =
            String(count);
    }

    if (callEmptyState) {
        callEmptyState.classList.toggle(
            "hidden",
            count > 0
        );
    }
}


function ensureRemoteTile(uid) {
    const existing =
        document.getElementById(`call-tile-${uid}`);

    const media =
        remoteMedia[uid] || {};

    if (existing) {
        const nameElement =
            existing.querySelector(".call-tile-name");

        const avatar =
            existing.querySelector(".call-tile-avatar");

        if (nameElement) {
            nameElement.textContent =
                media.displayName ||
                "Anonymous";
        }

        if (
            avatar &&
            isSafeImageSrc(media.profilePic)
        ) {
            avatar.src =
                media.profilePic;
        }

        updateTileState(uid);

        return existing;
    }

    const tile = buildTile(
        uid,
        media.displayName || "Anonymous",
        false,
        media.profilePic || null
    );

    updateTileState(uid);

    if (!media.profilePic) {
        getProfilePic(uid).then(profilePic => {
            if (!profilePic) {
                return;
            }

            const avatar =
                tile.querySelector(
                    ".call-tile-avatar"
                );

            if (avatar) {
                avatar.src = profilePic;
            }

            if (remoteMedia[uid]) {
                remoteMedia[uid].profilePic =
                    profilePic;
            }
        });
    }

    updateGrid();

    return tile;
}


function removeRemotePeer(uid) {
    if (peerConnections[uid]) {
        try {
            peerConnections[uid].close();
        } catch {}
    }

    delete peerConnections[uid];
    delete remoteMedia[uid];

    if (remoteAudio[uid]) {
        try {
            remoteAudio[uid].pause();
        } catch {}

        delete remoteAudio[uid];
    }

    delete remoteVideoElements[uid];

    const tile =
        document.getElementById(`call-tile-${uid}`);

    if (tile) {
        tile.remove();
    }

    updateGrid();
}


async function getParticipants() {
    const participantsRef =
        collection(
            db,
            "groupCalls",
            CALL_ROOM_ID,
            "participants"
        );

    const snapshot =
        await getDocs(participantsRef);

    return snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
    }));
}


async function joinGroupCall() {
    if (!currentUser) {
        return;
    }

    if (localStream) {
        return;
    }

    try {
        localStream =
            await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
    } catch (error) {
        console.error(
            "Unable to access microphone/camera:",
            error
        );

        try {
            localStream =
                await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false
                });

            camOn = false;
        } catch (audioError) {
            console.error(
                "Unable to access microphone:",
                audioError
            );

            alert(
                "Microphone access is required to join the call."
            );

            return;
        }
    }

    buildTile(
        currentUser.uid,
        currentDisplayName,
        true,
        currentProfilePic
    );

    updateTileState(currentUser.uid);
    updateGrid();

    const participantRef = doc(
        db,
        "groupCalls",
        CALL_ROOM_ID,
        "participants",
        currentUser.uid
    );

    await setDoc(
        participantRef,
        {
            uid: currentUser.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            micOn,
            camOn,
            heartbeatMs: nowMs(),
            joinedAt: serverTimestamp()
        },
        {
            merge: true
        }
    );

    heartbeatInterval =
        setInterval(async () => {
            try {
                await updateDoc(
                    participantRef,
                    {
                        heartbeatMs: nowMs(),
                        micOn,
                        camOn,
                        displayName: currentDisplayName,
                        profilePic: currentProfilePic
                    }
                );
            } catch {}
        }, 10000);

    listenForParticipants();

    groupCallButton.textContent =
        "In group call";

    groupCallButton.disabled = true;

    if (callStatus) {
        callStatus.textContent =
            "You are in the call";
    }

    if (callStatusModal) {
        callStatusModal.textContent =
            "Connected";
    }
}


function listenForParticipants() {
    if (participantUnsub) {
        participantUnsub();
    }

    const participantsRef =
        collection(
            db,
            "groupCalls",
            CALL_ROOM_ID,
            "participants"
        );

    participantUnsub = onSnapshot(
        participantsRef,
        async snapshot => {
            const activeIds = new Set();

            for (const item of snapshot.docs) {
                const p = item.data();

                if (!p.uid) {
                    continue;
                }

                if (
                    p.uid !== currentUser?.uid &&
                    nowMs() - Number(p.heartbeatMs || 0) > 30000
                ) {
                    continue;
                }

                activeIds.add(p.uid);

                if (p.uid === currentUser?.uid) {
                    continue;
                }

                remoteMedia[p.uid] = {
                    micOn:
                        p.micOn !== false,

                    camOn:
                        p.camOn !== false,

                    displayName:
                        p.displayName ||
                        "Anonymous",

                    profilePic:
                        isSafeImageSrc(p.profilePic)
                            ? p.profilePic
                            : null
                };

                ensureRemoteTile(p.uid);

                updateTileState(p.uid);
            }

            Object.keys(remoteMedia).forEach(uid => {
                if (!activeIds.has(uid)) {
                    removeRemotePeer(uid);
                }
            });

            updateGrid();
        },
        error => {
            console.error(
                "Participant listener error:",
                error
            );
        }
    );
}


async function watchCallRoom() {
    if (callUnsub) {
        callUnsub();
    }

    const participantsRef =
        collection(
            db,
            "groupCalls",
            CALL_ROOM_ID,
            "participants"
        );

    callUnsub = onSnapshot(
        participantsRef,
        snapshot => {
            const count =
                snapshot.docs.filter(item => {
                    const data = item.data();

                    return (
                        data.uid &&
                        nowMs() -
                            Number(data.heartbeatMs || 0) <
                            30000
                    );
                }).length;

            if (count > 0) {
                if (callStatus) {
                    callStatus.textContent =
                        `${count} participant${count === 1 ? "" : "s"} in call`;
                }

                if (callStatusModal) {
                    callStatusModal.textContent =
                        `${count} participant${count === 1 ? "" : "s"} connected`;
                }

                if (
                    !localStream &&
                    groupCallButton
                ) {
                    groupCallButton.disabled = false;
                    groupCallButton.textContent =
                        "Join group call";
                }
            } else {
                if (callStatus) {
                    callStatus.textContent =
                        "No active call";
                }

                if (callStatusModal) {
                    callStatusModal.textContent =
                        "Waiting for participants";
                }

                if (
                    !localStream &&
                    groupCallButton
                ) {
                    groupCallButton.disabled = false;
                    groupCallButton.textContent =
                        "Start group call";
                }
            }
        }
    );
}


async function toggleMic() {
    if (!localStream || !currentUser) {
        return;
    }

    micOn = !micOn;

    localStream
        .getAudioTracks()
        .forEach(track => {
            track.enabled = micOn;
        });

    updateTileState(currentUser.uid);

    const participantRef = doc(
        db,
        "groupCalls",
        CALL_ROOM_ID,
        "participants",
        currentUser.uid
    );

    try {
        await updateDoc(
            participantRef,
            {
                micOn
            }
        );
    } catch {}
}


async function toggleCamera() {
    if (!localStream || !currentUser) {
        return;
    }

    const videoTracks =
        localStream.getVideoTracks();

    if (!videoTracks.length) {
        return;
    }

    camOn = !camOn;

    videoTracks.forEach(track => {
        track.enabled = camOn;
    });

    updateTileState(currentUser.uid);

    const participantRef = doc(
        db,
        "groupCalls",
        CALL_ROOM_ID,
        "participants",
        currentUser.uid
    );

    try {
        await updateDoc(
            participantRef,
            {
                camOn
            }
        );
    } catch {}
}


async function unlockAudio() {
    try {
        audioContext =
            audioContext ||
            new AudioContext();

        if (
            audioContext.state ===
            "suspended"
        ) {
            await audioContext.resume();
        }

        audioUnlocked = true;

        Object.values(remoteAudio)
            .forEach(audio => {
                audio.play().catch(() => {});
            });

        audioUnlockButton.textContent =
            "Audio enabled";

        audioUnlockButton.disabled =
            true;
    } catch (error) {
        console.error(
            "Audio unlock failed:",
            error
        );
    }
}


async function hangUpGroupCall() {
    if (!currentUser) {
        return;
    }

    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    if (participantUnsub) {
        participantUnsub();
        participantUnsub = null;
    }

    if (localStream) {
        localStream
            .getTracks()
            .forEach(track => {
                try {
                    track.stop();
                } catch {}
            });

        localStream = null;
    }

    Object.keys(peerConnections)
        .forEach(uid => {
            try {
                peerConnections[uid].close();
            } catch {}
        });

    peerConnections = {};

    Object.values(remoteAudio)
        .forEach(audio => {
            try {
                audio.pause();
            } catch {}
        });

    Object.keys(remoteAudio)
        .forEach(uid => {
            delete remoteAudio[uid];
        });

    Object.keys(remoteVideoElements)
        .forEach(uid => {
            delete remoteVideoElements[uid];
        });

    remoteMedia = {};

    const participantRef = doc(
        db,
        "groupCalls",
        CALL_ROOM_ID,
        "participants",
        currentUser.uid
    );

    try {
        await deleteDoc(participantRef);
    } catch {}

    if (videoGrid) {
        videoGrid
            .querySelectorAll(".call-tile")
            .forEach(tile => tile.remove());
    }

    micOn = true;
    camOn = true;

    groupCallButton.disabled = false;
    groupCallButton.textContent =
        "Start group call";

    if (callStatus) {
        callStatus.textContent =
            "No active call";
    }

    if (callStatusModal) {
        callStatusModal.textContent =
            "Waiting for participants";
    }

    updateGrid();
}


function hideCallModal() {
    if (callModal) {
        callModal.classList.remove("hidden");
    }
}


groupCallButton?.addEventListener(
    "click",
    async () => {
        await joinGroupCall();
    }
);


hangupButton?.addEventListener(
    "click",
    async () => {
        await hangUpGroupCall();
    }
);


micButton?.addEventListener(
    "click",
    async () => {
        await toggleMic();
    }
);


cameraButton?.addEventListener(
    "click",
    async () => {
        await toggleCamera();
    }
);


audioUnlockButton?.addEventListener(
    "click",
    async () => {
        await unlockAudio();
    }
);


document
    .getElementById("logout-button")
    ?.addEventListener(
        "click",
        async () => {
            await signOut(auth);
            window.location.href = "/";
        }
    );


document
    .getElementById("settings-button")
    ?.addEventListener(
        "click",
        () => {
            window.location.href =
                "/aurora/settings/account/";
        }
    );


document
    .getElementById("profile-button")
    ?.addEventListener(
        "click",
        () => {
            if (!currentUser) {
                return;
            }

            window.location.href =
                `/aurora/profile/?uid=${encodeURIComponent(
                    currentUser.uid
                )}`;
        }
    );


onAuthStateChanged(
    auth,
    async user => {
        if (!user) {
            window.location.href = "/";
            return;
        }

        currentUser = user;

        const userData =
            await getUserData(user.uid);

        if (userData) {
            currentDisplayName =
                userData.displayName ||
                userData.username ||
                user.displayName ||
                "Anonymous";

            currentProfilePic =
                isSafeImageSrc(
                    userData.profilePic
                )
                    ? userData.profilePic
                    : null;
        } else {
            currentDisplayName =
                user.displayName ||
                "Anonymous";

            currentProfilePic = null;
        }

        setUserInfo();

        await setupPresence(user);

        initOnlineUsersList();
        watchCallRoom();
        updateGrid();
    }
);