import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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
const db = getFirestore(app);

const profileContent = document.getElementById('profile-content');

const urlParams = new URLSearchParams(window.location.search);
const targetSequentialId = urlParams.get('id') || window.__AURORA_USER_ID__;

function validateName(value) {
    const regex = /^[1-9][0-9_]*$/;
    return regex.test(value);
}

function renderProfileData(userData) {
    const fallbackName = `aurora_user_${targetSequentialId}`;
    const fallbackUsername = `@aurora_user_${targetSequentialId}`;
    
    const rawDisplayName = userData.displayName;
    const rawUsername = userData.username;

    const displayName = rawDisplayName && validateName(rawDisplayName) ? rawDisplayName : fallbackName;
    const username = rawUsername && validateName(rawUsername) ? rawUsername : fallbackUsername;

    document.title = `${displayName} - Aurora`;

    if (profileContent) {
        profileContent.innerHTML = `
            <p>Display Name: ${displayName}</p>
            <p>Username: ${username.startsWith('@') ? username : '@' + username}</p>
            <p>Registration ID: #${userData.sequentialId}</p>
        `;
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

    if (cachedData) {
        renderProfileData(JSON.parse(cachedData));
    }

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("sequentialId", "==", Number(targetSequentialId)));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const userData = querySnapshot.docs[0].data();
            localStorage.setItem(cacheKey, JSON.stringify(userData));
            renderProfileData(userData);
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

loadProfile();