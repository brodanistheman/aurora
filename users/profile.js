import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

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
const storage = getStorage(app);

const profileContent = document.getElementById('profile-content');
const uploadSection = document.getElementById('upload-section');
const profilePicInput = document.getElementById('profile-pic-input');
const uploadPicButton = document.getElementById('upload-pic-button');

const urlParams = new URLSearchParams(window.location.search);
const targetSequentialId = urlParams.get('id') || window.__AURORA_USER_ID__;

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

function validateName(value) {
    const regex = /^[a-zA-Z1-9][a-zA-Z0-9_]*$/;
    return regex.test(value);
}

function renderProfileData(userData, isOwner) {
    const fallbackName = `aurora_user_${targetSequentialId}`;
    const fallbackUsername = `@aurora_user_${targetSequentialId}`;
    
    const rawDisplayName = userData.displayName;
    const rawUsername = userData.username;
    const profilePic = userData.profilePic || defaultAvatar;

    const displayName = rawDisplayName && validateName(rawDisplayName) ? rawDisplayName : fallbackName;
    const username = rawUsername && validateName(rawUsername) ? rawUsername : fallbackUsername;

    document.title = `${displayName} - Aurora`;

    if (profileContent) {
        profileContent.innerHTML = `
            <div class="profile-header" style="text-align: center; margin-bottom: 20px;">
                <img src="${profilePic}" alt="${displayName}'s profile picture" class="profile-avatar" style="width: 100px; height: 100px; aspect-ratio: 1 / 1; border-radius: 50%; object-fit: cover; margin-bottom: 10px; display: inline-block;" onerror="this.src='${defaultAvatar}'">
            </div>
            <p>Display Name: ${displayName}</p>
            <p>Username: ${username.startsWith('@') ? username : '@' + username}</p>
            <p>Registration ID: #${userData.sequentialId}</p>
        `;
    }

    if (uploadSection) {
        uploadSection.style.display = isOwner ? 'block' : 'none';
    }
}

async function loadProfile() {
    if (!targetSequentialId) {
        if (profileContent) profileContent.textContent = "No user specified.";
        document.title = "User Not Found - Aurora";
        return;
    }

    const cacheKey = `aurora_profile_${targetSequentialId}`;
    const cachedData = localStorage.getItem(cacheKey);

    const currentUser = auth.currentUser;
    const currentUserUid = currentUser ? currentUser.uid : null;

    if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const isOwner = currentUserUid && parsed.uid === currentUserUid;
        renderProfileData(parsed, isOwner);
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
            
            const activeUser = auth.currentUser;
            const isOwner = activeUser && activeUser.uid === userDocSnap.id;
            renderProfileData(userData, isOwner);
        } else if (!cachedData) {
            if (profileContent) profileContent.textContent = "User not found.";
            document.title = "User Not Found - Aurora";
        }
    } catch (error) {
        if (!cachedData) {
            if (profileContent) profileContent.textContent = "Failed to load profile.";
            document.title = "Error - Aurora";
        }
    }
}

if (uploadPicButton && profilePicInput) {
    uploadPicButton.addEventListener('click', async () => {
        const user = auth.currentUser;
        const file = profilePicInput.files[0];
        if (!user || !file) {
            alert('Please select an image or gif file first.');
            return;
        }

        try {
            const fileRef = ref(storage, `profile_pictures/${user.uid}`);
            await uploadBytes(fileRef, file);
            const downloadUrl = await getDownloadURL(fileRef);

            const userRef = doc(db, "users", user.uid);
            await updateDoc(userRef, {
                profilePic: downloadUrl
            });

            const cacheKey = `aurora_profile_${targetSequentialId}`;
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
                const parsed = JSON.parse(cachedData);
                parsed.profilePic = downloadUrl;
                localStorage.setItem(cacheKey, JSON.stringify(parsed));
                renderProfileData(parsed, true);
            }

            const userCacheKey = `aurora_user_cache_${user.uid}`;
            const userCachedData = localStorage.getItem(userCacheKey);
            if (userCachedData) {
                const parsedUser = JSON.parse(userCachedData);
                parsedUser.profilePic = downloadUrl;
                localStorage.setItem(userCacheKey, JSON.stringify(parsedUser));
            }

            profilePicInput.value = '';
            alert('Profile picture updated successfully!');
            window.location.reload();
        } catch (error) {
            console.error("Upload error:", error);
            alert('Failed to upload image. Please check console.');
        }
    });
}

onAuthStateChanged(auth, (user) => {
    loadProfile();
});