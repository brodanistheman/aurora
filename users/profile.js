import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const profileContent = document.getElementById('profile-content');
const uploadSection = document.getElementById('upload-section');
const profilePicInput = document.getElementById('profile-pic-input');
const uploadPicButton = document.getElementById('upload-pic-button');
const uploadPreview = document.getElementById('upload-preview');
const uploadPreviewImg = document.getElementById('upload-preview-img');
const uploadStatus = document.getElementById('upload-status');
const backButton = document.getElementById('back-button');

const urlParams = new URLSearchParams(window.location.search);
const targetSequentialId = urlParams.get('id') || window.__AURORA_USER_ID__;

const MAX_FILE_BYTES = 400 * 1024;
const BATCH_LIMIT = 500;

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

function validateName(value) {
    const regex = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/;
    return regex.test(value);
}

function setUploadStatus(message, isError = false) {
    if (!uploadStatus) return;
    uploadStatus.textContent = message;
    uploadStatus.classList.toggle('error', isError);
}

function renderProfileData(userData, isOwner) {
    const fallbackName = `aurora_user_${targetSequentialId}`;
    const fallbackUsername = `@aurora_user_${targetSequentialId}`;

    const rawDisplayName = userData.displayName;
    const rawUsername = userData.username;
    const profilePic = typeof userData.profilePic === 'string' ? userData.profilePic : defaultAvatar;

    const displayName = rawDisplayName && validateName(rawDisplayName) ? rawDisplayName : fallbackName;
    const username = rawUsername && validateName(rawUsername) ? rawUsername : fallbackUsername;
    const normalizedUsername = username.startsWith('@') ? username : '@' + username;

    // sequentialId must be a plain number before it's ever shown in the DOM
    const safeSequentialId = Number.isFinite(Number(userData.sequentialId))
        ? Number(userData.sequentialId)
        : targetSequentialId;

    document.title = `${displayName} - Aurora`;

    if (profileContent) {
        profileContent.innerHTML = ''; // clear

        const header = document.createElement('div');
        header.className = 'profile-header';

        const avatar = document.createElement('img');
        avatar.className = 'profile-avatar';
        avatar.alt = `${displayName}'s profile picture`;
        avatar.addEventListener('error', () => {
            avatar.src = defaultAvatar;
        });
        avatar.src = profilePic; // set as a property, not interpolated into markup — no attribute-breakout risk
        header.appendChild(avatar);
        profileContent.appendChild(header);

        const nameEl = document.createElement('p');
        nameEl.textContent = `Display Name: ${displayName}`;
        profileContent.appendChild(nameEl);

        const usernameEl = document.createElement('p');
        usernameEl.textContent = `Username: ${normalizedUsername}`;
        profileContent.appendChild(usernameEl);

        const idEl = document.createElement('p');
        idEl.textContent = `Registration ID: #${safeSequentialId}`;
        profileContent.appendChild(idEl);
    }

    if (uploadSection) {
        uploadSection.classList.toggle('hidden', !isOwner);
    }
}

async function loadProfile(currentUser) {
    if (!targetSequentialId) {
        if (profileContent) profileContent.textContent = "No user specified.";
        document.title = "User Not Found - Aurora";
        return;
    }

    const cacheKey = `aurora_profile_${targetSequentialId}`;
    const cachedData = localStorage.getItem(cacheKey);
    const currentUserUid = currentUser ? currentUser.uid : null;

    if (cachedData) {
        try {
            const parsed = JSON.parse(cachedData);
            const isOwner = currentUserUid && parsed.uid === currentUserUid;
            renderProfileData(parsed, isOwner);
        } catch {
            localStorage.removeItem(cacheKey); // corrupt cache entry, ignore it
        }
    }

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("sequentialId", "==", Number(targetSequentialId)));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const userDocSnap = querySnapshot.docs[0];
            const userData = userDocSnap.data();
            userData.uid = userDocSnap.id;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            const isOwner = currentUserUid && currentUserUid === userDocSnap.id;
            renderProfileData(userData, isOwner);
        } else if (!cachedData) {
            if (profileContent) profileContent.textContent = "User not found.";
            document.title = "User Not Found - Aurora";
        }
    } catch (error) {
        console.error("Profile load error:", error);
        if (!cachedData) {
            if (profileContent) profileContent.textContent = "Failed to load profile.";
            document.title = "Error - Aurora";
        }
    }
}

function resetUploadButton() {
    uploadPicButton.textContent = 'Upload Image';
    uploadPicButton.disabled = false;
}

async function commitInChunks(db, docRefs, data) {
    for (let i = 0; i < docRefs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        docRefs.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.update(ref, data));
        await batch.commit();
    }
}

if (profilePicInput) {
    profilePicInput.addEventListener('change', () => {
        const file = profilePicInput.files[0];
        setUploadStatus('');

        if (!file) {
            uploadPreview.classList.add('hidden');
            return;
        }

        const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
        const isAllowedType = ['image/png', 'image/jpeg'].includes(file.type);

        if (isGif || !isAllowedType) {
            setUploadStatus('Please choose a PNG or JPEG image.', true);
            uploadPreview.classList.add('hidden');
            profilePicInput.value = '';
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            setUploadStatus('Image file is too large! Please choose an image under 400KB.', true);
            uploadPreview.classList.add('hidden');
            profilePicInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            uploadPreviewImg.src = reader.result;
            uploadPreview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    });
}

if (uploadPicButton && profilePicInput) {
    uploadPicButton.addEventListener('click', () => {
        const user = auth.currentUser;
        if (!user) {
            setUploadStatus('You must be logged in to upload a picture.', true);
            return;
        }

        const file = profilePicInput.files[0];
        if (!file) {
            setUploadStatus('Please select an image file first.', true);
            return;
        }

        const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
        if (isGif || !['image/png', 'image/jpeg'].includes(file.type)) {
            setUploadStatus('GIFs are not allowed. Please choose a PNG or JPEG image.', true);
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            setUploadStatus('Image file is too large! Please choose an image under 400KB.', true);
            return;
        }

        uploadPicButton.textContent = 'Processing...';
        uploadPicButton.disabled = true;
        setUploadStatus('');

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64data = reader.result;

                const userRef = doc(db, "users", user.uid);
                await updateDoc(userRef, { profilePic: base64data });

                const messagesRef = collection(db, "messages");
                const qMessages = query(messagesRef, where("uid", "==", user.uid));
                const messageSnapshot = await getDocs(qMessages);
                const messageRefs = messageSnapshot.docs.map((d) => d.ref);

                await commitInChunks(db, messageRefs, { profilePic: base64data });

                localStorage.removeItem(`aurora_profile_${targetSequentialId}`);
                localStorage.removeItem(`aurora_user_cache_${user.uid}`);

                setUploadStatus('Profile picture updated successfully across all your messages!');
                window.location.reload();
            } catch (error) {
                console.error("Upload error details:", error);
                setUploadStatus('Failed to save image. See console for details.', true);
                resetUploadButton();
            }
        };
        reader.onerror = () => {
            console.error("File read error:", reader.error);
            setUploadStatus('Failed to read the selected file.', true);
            resetUploadButton();
        };
        reader.readAsDataURL(file);
    });
}

if (backButton) {
    backButton.addEventListener('click', () => window.history.back());
}

onAuthStateChanged(auth, (user) => {
    loadProfile(user);
});