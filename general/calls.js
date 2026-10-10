import {
    doc, collection, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
    query, where, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/* ==========================================================================
   Aurora group calls

   Firestore:
   calls/{callId}
   calls/{callId}/participants/{uid}
   calls/{callId}/signals/{signalId}

   WebRTC uses a full mesh. The participant who joined later initiates
   the connection, preventing both participants from offering simultaneously.
   ========================================================================== */

const RTC_CONFIG = {
    iceServers: [
        {
            urls: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ]
        },
        ...(Array.isArray(window.AURORA_TURN_SERVERS)
            ? window.AURORA_TURN_SERVERS
            : [])
    ],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceCandidatePoolSize: 4
};

const MAX_PARTICIPANTS = 6;
const MAX_MEMBERS = 8;
const RING_TIMEOUT_MS = 40000;
const HEARTBEAT_MS = 20000;
const FRESH_MS = 60000;
const STALE_CALL_MS = 90000;
const NOTE_MS = 2500;
const MAX_PIC_CHARS = 200000;
const SPEAKING_THRESHOLD = 0.025;
const DISCONNECT_GRACE_MS = 7000;
const MAX_RECOVERY_ATTEMPTS = 3;

const els = {};

let ctx = null;
let session = null;
let incoming = null;
let incomingUnsub = null;
let noteTimer = null;
let ringTimer = null;
let audioCtx = null;
let initialized = false;
let authUnsubscribe = null;

const dismissed = new Set();
const originalTitle = document.title;

/* ---------- helpers ---------- */

const me = () => (
    ctx && ctx.auth.currentUser
        ? ctx.auth.currentUser.uid
        : null
);

function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");

    return `${minutes}:${seconds}`;
}

function safePic(pic) {
    return typeof pic === "string" && pic.length <= MAX_PIC_CHARS
        ? pic
        : "";
}

function serializeCandidate(candidate) {
    return {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        usernameFragment: candidate.usernameFragment ?? null
    };
}

function mediaErrorMessage(err) {
    switch (err && err.name) {
        case "NotAllowedError":
            return "Microphone or camera access was blocked. Allow access in your browser settings and try again.";
        case "NotFoundError":
            return "No microphone was found on this device.";
        case "NotReadableError":
            return "Your microphone or camera is being used by another app.";
        case "OverconstrainedError":
            return "Your microphone or camera does not support the requested settings.";
        default:
            return "Could not start the call. Check your microphone and try again.";
    }
}

function getAudioCtx() {
    if (!audioCtx) {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            throw new Error("Web Audio is not supported.");
        }

        audioCtx = new AudioContextClass();
    }

    return audioCtx;
}

function levelOf(analyser) {
    if (!analyser) return 0;

    const buffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buffer);

    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {
        const value = (buffer[i] - 128) / 128;
        sum += value * value;
    }

    return Math.sqrt(sum / buffer.length);
}

function timestampOf(value) {
    return value && typeof value.toMillis === "function"
        ? value.toMillis()
        : 0;
}

function isCurrentSession(s) {
    return session === s && !s.closing;
}

/* ---------- local media ---------- */

async function getMedia(video) {
    const audio = {
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    };

    if (!video) {
        return navigator.mediaDevices.getUserMedia({
            audio,
            video: false
        });
    }

    try {
        return await navigator.mediaDevices.getUserMedia({
            audio,
            video: {
                facingMode: "user"
            }
        });
    } catch (videoError) {
        // If the camera cannot start, try to preserve the voice call.
        try {
            return await navigator.mediaDevices.getUserMedia({
                audio,
                video: false
            });
        } catch {
            throw videoError;
        }
    }
}

async function buildLocalMedia(video) {
    const raw = await getMedia(video);

    const media = {
        raw,
        send: raw,
        nodes: [],
        analyser: null,
        silentGain: null
    };

    if (!raw.getAudioTracks().length) {
        throw new Error("No microphone audio track was created.");
    }

    try {
        const ac = getAudioCtx();

        if (ac.state !== "running") {
            await ac.resume();
        }

        if (ac.state === "running") {
            const audioStream = new MediaStream(raw.getAudioTracks());
            const source = ac.createMediaStreamSource(audioStream);
            const analyser = ac.createAnalyser();
            const silentGain = ac.createGain();

            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.65;

            // Analyze the microphone without altering the transmitted audio.
            // The zero-gain output keeps the analyser graph active silently.
            silentGain.gain.value = 0;

            source.connect(analyser);
            analyser.connect(silentGain);
            silentGain.connect(ac.destination);

            media.analyser = analyser;
            media.silentGain = silentGain;
            media.nodes = [source, analyser, silentGain];
        }
    } catch (err) {
        console.warn("Local microphone analysis is unavailable:", err);
    }

    // Send the original microphone and camera tracks.
    // No software gain, compressor, or extra audio processing is applied.
    return media;
}

function stopLocalMedia(media) {
    if (!media) return;

    media.raw.getTracks().forEach((track) => {
        try {
            track.stop();
        } catch {
            // Track may already be stopped.
        }
    });

    media.nodes.forEach((node) => {
        try {
            node.disconnect();
        } catch {
            // Node may already be disconnected.
        }
    });

    media.nodes = [];
    media.analyser = null;
    media.silentGain = null;
}

/* ---------- ring tone ---------- */

function startRing() {
    stopRing();

    const beep = () => {
        try {
            const ac = getAudioCtx();

            if (ac.state === "suspended") {
                ac.resume().catch(() => {});
            }

            const start = ac.currentTime;

            [440, 480].forEach((frequency, index) => {
                const oscillator = ac.createOscillator();
                const gain = ac.createGain();
                const offset = index * 0.22;

                oscillator.frequency.value = frequency;

                gain.gain.setValueAtTime(0.0001, start + offset);
                gain.gain.exponentialRampToValueAtTime(
                    0.045,
                    start + offset + 0.02
                );
                gain.gain.exponentialRampToValueAtTime(
                    0.0001,
                    start + offset + 0.2
                );

                oscillator.connect(gain);
                gain.connect(ac.destination);

                oscillator.start(start + offset);
                oscillator.stop(start + offset + 0.22);
            });
        } catch {
            // Audio playback may require a user interaction.
        }
    };

    beep();
    ringTimer = setInterval(beep, 2200);
    document.title = "Incoming call · Aurora";
}

function stopRing() {
    if (ringTimer) {
        clearInterval(ringTimer);
    }

    ringTimer = null;
    document.title = originalTitle;
}

/* ---------- inline call bar ---------- */

function cacheElements() {
    els.bar = document.getElementById("call-bar");
    els.grid = document.getElementById("call-grid");
    els.avatar = document.getElementById("call-avatar");
    els.name = document.getElementById("call-name");
    els.status = document.getElementById("call-status");
    els.accept = document.getElementById("call-accept");
    els.mute = document.getElementById("call-mute");
    els.camera = document.getElementById("call-camera");
    els.hangup = document.getElementById("call-hangup");
}

function setHidden(element, hidden) {
    if (element) {
        element.classList.toggle("hidden", hidden);
    }
}

function paint({ mode, name, text, pic = "", video = false }) {
    if (!els.bar) return;

    clearTimeout(noteTimer);
    noteTimer = null;

    els.bar.classList.remove("hidden");
    els.bar.dataset.mode = mode;
    els.bar.dataset.video = String(!!video);

    if (mode !== "call" && els.avatar) {
        ctx.setAvatar(els.avatar, pic);
    }

    if (els.name) els.name.textContent = name || "Call";
    if (els.status) els.status.textContent = text || "";

    const hasCamera = !!(
        session &&
        session.media &&
        session.media.send.getVideoTracks().length
    );

    setHidden(els.avatar, mode === "call");
    setHidden(els.grid, mode !== "call");
    setHidden(els.accept, mode !== "incoming");
    setHidden(els.mute, mode !== "call");
    setHidden(els.camera, !(mode === "call" && hasCamera));
    setHidden(els.hangup, mode === "note");

    if (els.hangup) {
        const label = mode === "incoming" ? "Decline" : "Leave call";
        els.hangup.title = label;
        els.hangup.setAttribute("aria-label", label);
    }
}

function updateHeader(s) {
    if (!isCurrentSession(s)) return;

    const peers = [...s.peers.values()];

    const name = peers.length
        ? peers.map((peer) => peer.info.displayName || "Anonymous").join(", ")
        : (s.label || "Call");

    let text;

    if (s.startedAt) {
        text = `${formatDuration(Date.now() - s.startedAt)} · ${peers.length + 1} in call`;
    } else if (peers.length) {
        text = "Connecting…";
    } else {
        text = s.hostUid === me() ? "Ringing…" : "Joining…";
    }

    paint({
        mode: "call",
        name,
        text,
        video: s.video
    });
}

function renderIncoming() {
    if (!incoming) return;

    const data = incoming.data;
    const group = (data.members || []).length > 2;
    const kind = data.video ? "video call" : "voice call";

    paint({
        mode: "incoming",
        name: data.hostName || "Anonymous",
        text: group
            ? `Group ${kind} · ${data.members.length} invited`
            : `Incoming ${kind}`,
        pic: data.hostPic,
        video: false
    });
}

function hideBar() {
    clearTimeout(noteTimer);
    noteTimer = null;

    if (els.bar) {
        els.bar.classList.add("hidden");
        els.bar.dataset.mode = "";
    }
}

function showNote(label, note) {
    paint({
        mode: "note",
        name: label || "Call",
        text: note
    });

    noteTimer = setTimeout(() => {
        noteTimer = null;

        if (!session && !incoming) {
            hideBar();
        }
    }, NOTE_MS);
}

/* ---------- participant tiles ---------- */

function addTile(info, isLocal) {
    const tile = document.createElement("div");
    tile.className = `call-tile${isLocal ? " is-local" : ""}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const avatar = document.createElement("img");
    avatar.className = "call-tile-avatar";
    avatar.alt = "";

    ctx.setAvatar(avatar, info.profilePic);

    const name = document.createElement("span");
    name.className = "call-tile-name";
    name.textContent = isLocal
        ? "You"
        : (info.displayName || "Anonymous");

    const state = document.createElement("span");
    state.className = "call-tile-state";

    tile.append(video, avatar, name, state);
    els.grid.appendChild(tile);

    return {
        tile,
        video,
        avatar,
        name,
        state
    };
}

function setTileState(ui, text) {
    if (ui && ui.state) {
        ui.state.textContent = text || "";
    }
}

/* ---------- session ---------- */

function newSession(id, data, label) {
    return {
        id,
        callRef: doc(ctx.db, "calls", id),
        meRef: null,
        hostUid: data.hostUid,
        hostName: data.hostName,
        video: !!data.video,
        members: data.members || [],
        label: label || data.hostName || "Call",
        participants: new Map(),
        peers: new Map(),
        media: null,
        localUi: null,
        joined: false,
        created: false,
        joinedAt: 0,
        startedAt: 0,
        closing: false,
        unsubs: [],
        heartbeat: null,
        levelTimer: null,
        durationTimer: null,
        aloneTimeout: null,
        signalQueue: Promise.resolve(),
        processedSignals: new Set()
    };
}

async function runSession(s, createData) {
    const user = ctx.auth.currentUser;

    if (!user || session || incoming && createData) return;

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        !window.RTCPeerConnection
    ) {
        alert("Calling is not supported in this browser.");
        return;
    }

    session = s;
    document.body.classList.add("in-call");
    updateHeader(s);

    try {
        s.media = await buildLocalMedia(s.video);
    } catch (err) {
        if (session === s) {
            teardownSession(s, null);
            alert(mediaErrorMessage(err));
        }
        return;
    }

    if (!isCurrentSession(s)) {
        stopLocalMedia(s.media);
        s.media = null;
        return;
    }

    updateHeader(s);

    try {
        if (createData) {
            await setDoc(s.callRef, createData);
            s.created = true;

            if (!isCurrentSession(s)) {
                await updateDoc(s.callRef, {
                    status: "ended",
                    endedAt: serverTimestamp()
                }).catch(() => {});
                return;
            }
        }

        const partsRef = collection(s.callRef, "participants");
        const existing = await getDocs(partsRef);

        const present = existing.docs.filter((participant) => {
            if (participant.id === user.uid) return false;

            const seen = timestampOf(participant.data().lastSeen);
            return seen > 0 && Date.now() - seen < FRESH_MS * 2;
        });

        if (present.length >= MAX_PARTICIPANTS) {
            teardownSession(s, "Call is full");
            if (s.created) {
                await updateDoc(s.callRef, {
                    status: "ended",
                    endedAt: serverTimestamp()
                }).catch(() => {});
            }
            return;
        }

        s.meRef = doc(partsRef, user.uid);

        const profile = ctx.getProfile();

        await setDoc(s.meRef, {
            uid: user.uid,
            displayName: profile.displayName || "Anonymous",
            profilePic: safePic(profile.profilePic),
            joinedAt: serverTimestamp(),
            lastSeen: serverTimestamp()
        });

        s.joined = true;

        if (!isCurrentSession(s)) {
            await deleteDoc(s.meRef).catch(() => {});
            return;
        }

        const meSnap = await getDoc(s.meRef);
        const meData = meSnap.data({
            serverTimestamps: "estimate"
        });

        s.joinedAt = timestampOf(meData && meData.joinedAt);

        if (!s.joinedAt) {
            s.joinedAt = Date.now();
        }

        s.localUi = addTile({
            profilePic: profile.profilePic
        }, true);

        const cameraTracks = s.media.send.getVideoTracks();

        if (cameraTracks.length) {
            s.localUi.video.srcObject = new MediaStream(cameraTracks);
            s.localUi.tile.classList.add("has-video");
        }

        watchSignals(s);
        watchParticipants(s);
        watchCallDoc(s);

        s.heartbeat = setInterval(() => {
            if (!isCurrentSession(s) || !s.meRef) return;

            updateDoc(s.meRef, {
                lastSeen: serverTimestamp()
            }).catch(() => {});

            updateDoc(s.callRef, {
                lastActive: serverTimestamp()
            }).catch(() => {});
        }, HEARTBEAT_MS);

        s.levelTimer = setInterval(() => tickLevels(s), 150);

        if (s.hostUid === user.uid) {
            s.aloneTimeout = setTimeout(() => {
                if (isCurrentSession(s) && s.peers.size === 0) {
                    leaveCall("No answer");
                }
            }, RING_TIMEOUT_MS);
        }

        updateHeader(s);
    } catch (err) {
        console.error("Error joining call:", err);

        if (session === s) {
            const wasJoined = s.joined;
            const participantRef = s.meRef;
            const callWasCreated = s.created;

            teardownSession(s, "Could not join call");

            if (wasJoined && participantRef) {
                await deleteDoc(participantRef).catch(() => {});
            }

            if (callWasCreated) {
                await updateDoc(s.callRef, {
                    status: "ended",
                    endedAt: serverTimestamp()
                }).catch(() => {});
            }
        }
    }
}

function tickLevels(s) {
    if (!isCurrentSession(s)) return;

    if (s.media && s.media.analyser && s.localUi) {
        const tracks = s.media.send.getAudioTracks();
        const enabled = tracks.some((track) => track.enabled);

        s.localUi.tile.classList.toggle(
            "speaking",
            enabled && levelOf(s.media.analyser) > SPEAKING_THRESHOLD
        );
    }

    s.peers.forEach((peer) => {
        if (peer.analyser) {
            peer.ui.tile.classList.toggle(
                "speaking",
                levelOf(peer.analyser) > SPEAKING_THRESHOLD
            );
        }
    });
}

function teardownSession(s, note) {
    if (!s || s.closing) return;

    s.closing = true;

    if (session === s) {
        session = null;
    }

    clearInterval(s.heartbeat);
    clearInterval(s.levelTimer);
    clearInterval(s.durationTimer);
    clearTimeout(s.aloneTimeout);

    s.unsubs.forEach((unsubscribe) => {
        try {
            unsubscribe();
        } catch {
            // Listener may already be removed.
        }
    });

    s.unsubs = [];

    s.peers.forEach((peer) => closePeer(peer));
    s.peers.clear();

    if (s.media) {
        stopLocalMedia(s.media);
        s.media = null;
    }

    if (els.grid) els.grid.innerHTML = "";

    document.body.classList.remove("in-call");

    if (els.mute) {
        els.mute.setAttribute("aria-pressed", "false");

        if (els.mute.firstElementChild) {
            els.mute.firstElementChild.className = "fa-solid fa-microphone";
        }
    }

    if (els.camera) {
        els.camera.setAttribute("aria-pressed", "false");

        if (els.camera.firstElementChild) {
            els.camera.firstElementChild.className = "fa-solid fa-video";
        }
    }

    if (incoming) {
        renderIncoming();
        return;
    }

    if (note) {
        showNote(s.label, note);
    } else {
        hideBar();
    }
}

export async function leaveCall(note = "Call ended") {
    const s = session;

    if (!s || s.closing) return;

    const wasJoined = s.joined;
    const wasCreated = s.created;
    const participantRef = s.meRef;

    // Keep the participant document until we have checked whether the call
    // needs to be ended. The Firestore rules authorize this update while
    // the caller is still a participant.
    if (wasJoined && participantRef) {
        try {
            const snapshot = await getDocs(
                collection(s.callRef, "participants")
            );

            const others = snapshot.docs.filter(
                (participant) => participant.id !== me()
            );

            if (others.length === 0) {
                await updateDoc(s.callRef, {
                    status: "ended",
                    endedAt: serverTimestamp()
                });
            }
        } catch (err) {
            console.warn("Could not check remaining call participants:", err);
        }
    } else if (wasCreated) {
        await updateDoc(s.callRef, {
            status: "ended",
            endedAt: serverTimestamp()
        }).catch(() => {});
    }

    teardownSession(s, note);

    if (wasJoined && participantRef) {
        await deleteDoc(participantRef).catch(() => {});
    }
}

export function endActiveCall() {
    if (incoming) declineIncoming();
    return leaveCall("Call ended");
}

/* ---------- peer connections ---------- */

function ensurePeer(s, uid, info) {
    let peer = s.peers.get(uid);

    if (peer) {
        if (info) {
            peer.info = info;
            peer.ui.name.textContent = info.displayName || "Anonymous";
            ctx.setAvatar(peer.ui.avatar, info.profilePic);
        }

        return peer;
    }

    const safeInfo = info || s.participants.get(uid) || {
        displayName: "Participant",
        profilePic: ""
    };

    peer = {
        uid,
        info: safeInfo,
        pc: null,
        remoteStream: null,
        remoteSet: false,
        pendingIn: [],
        analyser: null,
        dropTimeout: null,
        recoveryTimer: null,
        recoveryAttempts: 0,
        isOfferer: false,
        ui: addTile(safeInfo, false),
        audio: document.createElement("audio")
    };

    peer.audio.autoplay = true;
    peer.audio.playsInline = true;
    peer.ui.tile.appendChild(peer.audio);

    setTileState(peer.ui, "Connecting…");

    s.peers.set(uid, peer);
    updateHeader(s);

    return peer;
}

function resetPeerConnection(peer, preserveCandidates = false) {
    clearTimeout(peer.dropTimeout);
    clearTimeout(peer.recoveryTimer);

    peer.dropTimeout = null;
    peer.recoveryTimer = null;

    const pending = preserveCandidates ? peer.pendingIn.slice() : [];

    if (peer.pc) {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.oniceconnectionstatechange = null;

        try {
            peer.pc.close();
        } catch {
            // Connection may already be closed.
        }
    }

    peer.pc = null;
    peer.remoteSet = false;
    peer.pendingIn = pending;
    peer.analyser = null;
    peer.remoteStream = null;
}

function closePeer(peer) {
    resetPeerConnection(peer);

    peer.audio.srcObject = null;
    peer.ui.video.srcObject = null;

    peer.ui.tile.remove();
}

function removePeer(s, uid) {
    const peer = s.peers.get(uid);

    if (!peer) return;

    closePeer(peer);
    s.peers.delete(uid);

    updateHeader(s);
}

function markConnected(s, peer) {
    clearTimeout(peer.dropTimeout);
    clearTimeout(peer.recoveryTimer);

    peer.dropTimeout = null;
    peer.recoveryTimer = null;
    peer.recoveryAttempts = 0;

    setTileState(peer.ui, "");

    if (!s.startedAt) {
        s.startedAt = Date.now();

        s.durationTimer = setInterval(() => {
            updateHeader(s);
        }, 1000);
    }

    updateHeader(s);
}

function buildPc(s, peer, preserveCandidates = false) {
    resetPeerConnection(peer, preserveCandidates);

    const pc = new RTCPeerConnection(RTC_CONFIG);

    peer.pc = pc;
    peer.remoteStream = new MediaStream();

    s.media.send.getTracks().forEach((track) => {
        pc.addTrack(track, s.media.send);
    });

    pc.ontrack = (event) => {
        if (!isCurrentSession(s) || peer.pc !== pc) return;

        const tracks = event.streams[0]
            ? event.streams[0].getTracks()
            : [event.track];

        tracks.forEach((track) => {
            const alreadyAdded = peer.remoteStream
                .getTracks()
                .some((existingTrack) => existingTrack.id === track.id);

            if (!alreadyAdded) {
                peer.remoteStream.addTrack(track);
            }
        });

        if (
            peer.remoteStream.getAudioTracks().length &&
            !peer.analyser
        ) {
            try {
                const ac = getAudioCtx();
                const source = ac.createMediaStreamSource(peer.remoteStream);
                const analyser = ac.createAnalyser();

                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.65;

                const silentGain = ac.createGain();
                silentGain.gain.value = 0;

                source.connect(analyser);
                analyser.connect(silentGain);
                silentGain.connect(ac.destination);

                peer.analyser = analyser;

                peer.audioAnalysisNodes = [source, analyser, silentGain];
            } catch {
                // Remote speaking detection is optional.
            }
        }

        if (peer.audio.srcObject !== peer.remoteStream) {
            peer.audio.srcObject = peer.remoteStream;
        }

        peer.audio.play().catch(() => {});

        if (peer.remoteStream.getVideoTracks().length) {
            peer.ui.video.srcObject = peer.remoteStream;
            peer.ui.video.play().catch(() => {});
            peer.ui.tile.classList.add("has-video");
        } else {
            peer.ui.video.srcObject = null;
            peer.ui.tile.classList.remove("has-video");
        }
    };

    pc.onicecandidate = (event) => {
        if (
            event.candidate &&
            isCurrentSession(s) &&
            peer.pc === pc
        ) {
            sendSignal(
                s,
                peer.uid,
                "candidate",
                serializeCandidate(event.candidate)
            );
        }
    };

    pc.onconnectionstatechange = () => {
        if (!isCurrentSession(s) || peer.pc !== pc) return;

        const state = pc.connectionState;

        if (state === "connected") {
            markConnected(s, peer);
        } else if (state === "connecting") {
            setTileState(peer.ui, "Connecting…");
        } else if (state === "disconnected") {
            setTileState(peer.ui, "Reconnecting…");

            clearTimeout(peer.dropTimeout);

            peer.dropTimeout = setTimeout(() => {
                if (
                    isCurrentSession(s) &&
                    peer.pc === pc &&
                    pc.connectionState !== "connected"
                ) {
                    if (peer.isOfferer) {
                        scheduleRecovery(s, peer, 0);
                    } else {
                        setTileState(peer.ui, "Waiting for connection…");
                    }
                }
            }, DISCONNECT_GRACE_MS);
        } else if (state === "failed") {
            if (peer.isOfferer) {
                setTileState(peer.ui, "Reconnecting…");
                scheduleRecovery(s, peer, 0);
            } else {
                setTileState(peer.ui, "Connection failed");
            }
        } else if (state === "closed") {
            setTileState(peer.ui, "Disconnected");
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (!isCurrentSession(s) || peer.pc !== pc) return;

        if (pc.iceConnectionState === "failed" && peer.isOfferer) {
            scheduleRecovery(s, peer, 0);
        }
    };

    return pc;
}

/* ---------- connection recovery ---------- */

function scheduleRecovery(s, peer, delay = 1000) {
    if (!isCurrentSession(s) || !peer.isOfferer) return;
    if (!peer.pc || peer.recoveryTimer) return;

    if (peer.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        setTileState(peer.ui, "Connection failed");
        return;
    }

    peer.recoveryTimer = setTimeout(() => {
        peer.recoveryTimer = null;

        restartPeerConnection(s, peer).catch((err) => {
            console.warn("Connection recovery failed:", err);

            if (isCurrentSession(s)) {
                scheduleRecovery(s, peer, 2000);
            }
        });
    }, delay);
}

async function restartPeerConnection(s, peer) {
    if (!isCurrentSession(s) || !peer.isOfferer) return;

    const pc = peer.pc;

    if (!pc || pc.connectionState === "connected") return;

    if (pc.signalingState !== "stable") {
        scheduleRecovery(s, peer, 1000);
        return;
    }

    peer.recoveryAttempts += 1;

    try {
        setTileState(peer.ui, "Reconnecting…");

        if (typeof pc.restartIce === "function") {
            pc.restartIce();
        }

        const offer = await pc.createOffer({
            iceRestart: true
        });

        if (!isCurrentSession(s) || peer.pc !== pc) return;

        await pc.setLocalDescription(offer);

        if (!isCurrentSession(s) || peer.pc !== pc) return;

        await sendSignal(s, peer.uid, "offer", {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
        });

        scheduleRecovery(s, peer, 8000);
    } catch (err) {
        console.warn("Could not restart the peer connection:", err);
        scheduleRecovery(s, peer, 2000);
    }
}

/* ---------- signaling ---------- */

async function sendSignal(s, to, kind, payload) {
    if (!isCurrentSession(s) || !to || to === me()) return;

    try {
        await addDoc(collection(s.callRef, "signals"), {
            from: me(),
            to,
            kind,
            payload,
            createdAt: serverTimestamp()
        });
    } catch (err) {
        console.error(`Error sending ${kind} signal:`, err);
    }
}

async function offerTo(s, peer, iceRestart = false) {
    if (!isCurrentSession(s)) return;

    // Only the participant who joined later initiates offers.
    if (!peer.isOfferer) return;

    let pc = peer.pc;

    if (!pc) {
        pc = buildPc(s, peer);
    }

    try {
        if (pc.signalingState !== "stable") {
            return;
        }

        const offer = await pc.createOffer(
            iceRestart ? { iceRestart: true } : undefined
        );

        await pc.setLocalDescription(offer);

        if (!isCurrentSession(s) || peer.pc !== pc) return;

        await sendSignal(s, peer.uid, "offer", {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
        });
    } catch (err) {
        console.error("Error creating offer:", err);
        setTileState(peer.ui, "Connection failed");
    }
}

function addRemoteCandidate(peer, data) {
    if (!data || typeof data.candidate !== "string") return;

    const candidate = {
        candidate: data.candidate,
        sdpMid: data.sdpMid ?? null,
        sdpMLineIndex: data.sdpMLineIndex ?? null,
        usernameFragment: data.usernameFragment ?? null
    };

    if (!peer.pc || !peer.remoteSet) {
        peer.pendingIn.push(candidate);
        return;
    }

    peer.pc.addIceCandidate(candidate).catch((err) => {
        console.warn("Could not apply an ICE candidate:", err);
    });
}

function flushCandidates(peer) {
    if (!peer.pc || !peer.remoteSet) return;

    const pc = peer.pc;
    const pending = peer.pendingIn.splice(0);

    pending.forEach((candidate) => {
        pc.addIceCandidate(candidate).catch((err) => {
            console.warn("Could not apply a queued ICE candidate:", err);
        });
    });
}

async function handleSignal(s, snapshot) {
    if (!isCurrentSession(s)) return;

    const signal = snapshot.data();

    // Ignore messages from an earlier session and signals addressed elsewhere.
    const createdAt = timestampOf(signal.createdAt);

    if (
        createdAt &&
        s.joinedAt &&
        createdAt < s.joinedAt - 1000
    ) {
        await deleteDoc(snapshot.ref).catch(() => {});
        return;
    }

    if (signal.from === me() || signal.to !== me()) {
        await deleteDoc(snapshot.ref).catch(() => {});
        return;
    }

    if (!["offer", "answer", "candidate"].includes(signal.kind)) {
        await deleteDoc(snapshot.ref).catch(() => {});
        return;
    }

    try {
        if (signal.kind === "offer") {
            const info = s.participants.get(signal.from);
            const peer = ensurePeer(s, signal.from, info);

            // An offer from the other side means this side must answer.
            peer.isOfferer = false;

            const pc = buildPc(s, peer, true);

            await pc.setRemoteDescription({
                type: signal.payload.type,
                sdp: signal.payload.sdp
            });

            if (!isCurrentSession(s) || peer.pc !== pc) return;

            peer.remoteSet = true;
            flushCandidates(peer);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (!isCurrentSession(s) || peer.pc !== pc) return;

            await sendSignal(s, signal.from, "answer", {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp
            });
        } else if (signal.kind === "answer") {
            const peer = s.peers.get(signal.from);
            const pc = peer && peer.pc;

            if (!peer || !pc) return;

            // Answers apply only to an outstanding local offer. This also
            // permits answers to ICE restart offers.
            if (pc.signalingState !== "have-local-offer") return;

            await pc.setRemoteDescription({
                type: signal.payload.type,
                sdp: signal.payload.sdp
            });

            if (!isCurrentSession(s) || peer.pc !== pc) return;

            peer.remoteSet = true;
            flushCandidates(peer);
        } else if (signal.kind === "candidate") {
            const peer = ensurePeer(
                s,
                signal.from,
                s.participants.get(signal.from)
            );

            addRemoteCandidate(peer, signal.payload);
        }
    } catch (err) {
        console.error(`Error handling ${signal.kind}:`, err);
    } finally {
        await deleteDoc(snapshot.ref).catch(() => {});
    }
}

function watchSignals(s) {
    const signalsQuery = query(
        collection(s.callRef, "signals"),
        where("to", "==", me())
    );

    s.unsubs.push(
        onSnapshot(
            signalsQuery,
            (snapshot) => {
                if (!isCurrentSession(s)) return;

                snapshot.docChanges().forEach((change) => {
                    if (change.type !== "added") return;

                    const signalId = change.doc.id;

                    if (s.processedSignals.has(signalId)) return;

                    s.processedSignals.add(signalId);

                    // Serialize signaling to prevent overlapping offers,
                    // answers, and candidate processing.
                    s.signalQueue = s.signalQueue
                        .then(() => handleSignal(s, change.doc))
                        .catch((err) => {
                            console.error("Signal queue error:", err);
                        });
                });
            },
            (err) => console.error("Signal listener error:", err)
        )
    );
}

function watchParticipants(s) {
    s.unsubs.push(
        onSnapshot(
            collection(s.callRef, "participants"),
            (snapshot) => {
                if (!isCurrentSession(s)) return;

                snapshot.docChanges().forEach((change) => {
                    const uid = change.doc.id;

                    if (uid === me()) return;

                    if (change.type === "removed") {
                        s.participants.delete(uid);
                        removePeer(s, uid);
                        return;
                    }

                    const data = change.doc.data({
                        serverTimestamps: "estimate"
                    });

                    s.participants.set(uid, data);

                    const joinedAt = timestampOf(data.joinedAt);

                    if (!joinedAt || !s.joinedAt) return;

                    // The later joiner offers. UID breaks timestamp ties.
                    const peerJoinedEarlier =
                        joinedAt < s.joinedAt ||
                        (joinedAt === s.joinedAt && uid < me());

                    let peer = s.peers.get(uid);

                    if (peer) {
                        peer.info = data;
                        peer.ui.name.textContent =
                            data.displayName || "Anonymous";

                        ctx.setAvatar(peer.ui.avatar, data.profilePic);
                    } else {
                        peer = ensurePeer(s, uid, data);
                    }

                    peer.isOfferer = peerJoinedEarlier;

                    if (change.type !== "added") return;

                    if (peerJoinedEarlier && !peer.pc) {
                        const lastSeen = timestampOf(data.lastSeen);

                        if (
                            lastSeen &&
                            Date.now() - lastSeen > FRESH_MS * 2
                        ) {
                            return;
                        }

                        offerTo(s, peer);
                    }
                });

                updateHeader(s);
            },
            (err) => console.error("Participant listener error:", err)
        )
    );
}

function watchCallDoc(s) {
    s.unsubs.push(
        onSnapshot(
            s.callRef,
            (snapshot) => {
                const data = snapshot.data();

                if (!data || !isCurrentSession(s)) return;

                s.members = data.members || s.members;

                if (data.status === "ended") {
                    leaveCall("Call ended");
                }
            },
            (err) => console.error("Call listener error:", err)
        )
    );
}

/* ---------- starting and inviting ---------- */

async function createCall(users, video, label) {
    const user = ctx && ctx.auth.currentUser;

    if (!user || session || incoming) return;

    const uniqueUids = [
        ...new Set(
            users
                .map((person) => person.uid)
                .filter((uid) => uid && uid !== user.uid)
        )
    ].slice(0, MAX_MEMBERS - 1);

    if (!uniqueUids.length) return;

    const profile = ctx.getProfile();
    const callRef = doc(collection(ctx.db, "calls"));

    const data = {
        hostUid: user.uid,
        hostName: profile.displayName || "Anonymous",
        hostPic: safePic(profile.profilePic),
        members: [user.uid, ...uniqueUids],
        video: !!video,
        status: "active",
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
    };

    const s = newSession(callRef.id, data, label);

    await runSession(s, data);
}

export function startCall(peer, video = false) {
    if (!peer || !peer.uid) return;

    return createCall(
        [peer],
        video,
        peer.displayName || "Call"
    );
}

export function startGroupCall(users, video = false) {
    return createCall(users, video, "Group call");
}

export async function inviteToCall(peer) {
    const s = session;

    if (!s || !s.joined || !peer || !peer.uid) return;
    if (s.members.includes(peer.uid)) return;

    if (s.members.length >= MAX_MEMBERS) {
        alert(`A call can have at most ${MAX_MEMBERS} people invited.`);
        return;
    }

    try {
        await updateDoc(s.callRef, {
            members: arrayUnion(peer.uid)
        });

        s.members = [...s.members, peer.uid];
    } catch (err) {
        console.error("Error inviting to call:", err);
    }
}

export function isInCall() {
    return !!session;
}

/* ---------- receiving ---------- */

function clearIncoming() {
    if (!incoming) return;

    incoming = null;
    stopRing();

    if (!session) hideBar();
}

function declineIncoming() {
    if (!incoming) return;

    dismissed.add(incoming.id);
    clearIncoming();
}

function acceptIncoming() {
    const call = incoming;

    if (!call || session) return;

    clearIncoming();

    runSession(
        newSession(call.id, call.data, call.data.hostName),
        null
    );
}

function isLive(data) {
    if (data.status !== "active") return false;

    const lastActive = timestampOf(data.lastActive);

    // A missing timestamp is not proof of a stale call.
    if (!lastActive) return true;

    return Date.now() - lastActive < STALE_CALL_MS;
}

function considerCall(id, data) {
    const live = isLive(data);

    if (incoming && incoming.id === id) {
        if (!live) {
            clearIncoming();
        } else {
            incoming.data = data;
        }

        return;
    }

    if (!live) {
        // Only attempt cleanup once a call is demonstrably stale.
        const lastActive = timestampOf(data.lastActive);

        if (
            data.status === "active" &&
            lastActive &&
            Date.now() - lastActive >= STALE_CALL_MS
        ) {
            updateDoc(doc(ctx.db, "calls", id), {
                status: "ended",
                endedAt: serverTimestamp()
            }).catch(() => {});
        }

        return;
    }

    if (
        data.hostUid === me() ||
        dismissed.has(id) ||
        session ||
        incoming
    ) {
        return;
    }

    incoming = {
        id,
        data
    };

    renderIncoming();
    startRing();
}

function listenForIncoming(uid) {
    if (incomingUnsub) {
        incomingUnsub();
        incomingUnsub = null;
    }

    const callsQuery = query(
        collection(ctx.db, "calls"),
        where("members", "array-contains", uid),
        where("status", "==", "active")
    );

    incomingUnsub = onSnapshot(
        callsQuery,
        (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const id = change.doc.id;

                if (change.type === "removed") {
                    if (incoming && incoming.id === id) {
                        clearIncoming();
                    }

                    return;
                }

                considerCall(id, change.doc.data());
            });
        },
        (err) => console.error("Incoming call listener error:", err)
    );
}

/* ---------- controls ---------- */

function toggleMute() {
    const s = session;

    if (!s || !s.media) return;

    const tracks = s.media.send.getAudioTracks();

    if (!tracks.length) return;

    const currentlyEnabled = tracks[0].enabled;
    const nextEnabled = !currentlyEnabled;

    tracks.forEach((track) => {
        track.enabled = nextEnabled;
    });

    els.mute.setAttribute("aria-pressed", String(!nextEnabled));
    els.mute.title = nextEnabled ? "Mute" : "Unmute";
    els.mute.setAttribute("aria-label", els.mute.title);

    if (els.mute.firstElementChild) {
        els.mute.firstElementChild.className = nextEnabled
            ? "fa-solid fa-microphone"
            : "fa-solid fa-microphone-slash";
    }

    if (s.localUi) {
        setTileState(s.localUi, nextEnabled ? "" : "Muted");
    }
}

function toggleCamera() {
    const s = session;

    if (!s || !s.media) return;

    const tracks = s.media.send.getVideoTracks();

    if (!tracks.length) return;

    const currentlyEnabled = tracks[0].enabled;
    const nextEnabled = !currentlyEnabled;

    tracks.forEach((track) => {
        track.enabled = nextEnabled;
    });

    els.camera.setAttribute("aria-pressed", String(!nextEnabled));
    els.camera.title = nextEnabled ? "Turn camera off" : "Turn camera on";
    els.camera.setAttribute("aria-label", els.camera.title);

    if (els.camera.firstElementChild) {
        els.camera.firstElementChild.className = nextEnabled
            ? "fa-solid fa-video"
            : "fa-solid fa-video-slash";
    }

    if (s.localUi) {
        s.localUi.tile.classList.toggle("camera-off", !nextEnabled);
    }
}

/* ---------- initialization ---------- */

export function initCalls(context) {
    ctx = context;

    if (initialized) {
        return;
    }

    cacheElements();

    if (!els.bar || !els.grid) {
        console.error("Aurora call UI elements could not be found.");
        return;
    }

    initialized = true;

    els.accept.addEventListener("click", acceptIncoming);

    els.hangup.addEventListener("click", () => {
        if (incoming && !session) {
            declineIncoming();
        } else {
            leaveCall("Call ended");
        }
    });

    els.mute.addEventListener("click", toggleMute);
    els.camera.addEventListener("click", toggleCamera);

    window.addEventListener("beforeunload", () => {
        const s = session;

        if (!s || !s.joined) return;

        // Best effort only. Browsers may terminate asynchronous work during
        // unload, so normal leaveCall() remains the reliable cleanup path.
        if (s.peers.size === 0) {
            updateDoc(s.callRef, {
                status: "ended",
                endedAt: serverTimestamp()
            }).catch(() => {});
        }

        if (s.meRef) {
            deleteDoc(s.meRef).catch(() => {});
        }
    });

    if (ctx.auth.onAuthStateChanged) {
        authUnsubscribe = ctx.auth.onAuthStateChanged((user) => {
            if (user) {
                listenForIncoming(user.uid);
            } else {
                if (incomingUnsub) {
                    incomingUnsub();
                    incomingUnsub = null;
                }

                if (incoming) {
                    clearIncoming();
                }

                if (session) {
                    leaveCall("Signed out");
                }
            }
        });
    } else {
        const user = ctx.auth.currentUser;

        if (user) {
            listenForIncoming(user.uid);
        }
    }
}
