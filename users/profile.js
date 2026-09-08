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

async function loadProfile() {
    if (!targetSequentialId) {
        if (profileContent) profileContent.textContent = "No user specified.";
        document.title = "User Not Found - Aurora";
        return;
    }

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("sequentialId", "==", Number(targetSequentialId)));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const userData = userDoc.data();

            const displayName = userData.displayName || 'Unnamed User';
            const username = userData.username || 'No username';

            document.title = `${displayName} - Aurora`;

            if (profileContent) {
                profileContent.innerHTML = `
                    <p><strong>Display Name:</strong> ${displayName}</p>
                    <p><strong>Username:</strong> @${username}</p>
                    <p><strong>Registration ID:</strong> #${userData.sequentialId}</p>
                `;
            }
        } else {
            if (profileContent) profileContent.textContent = "User not found.";
            document.title = "User Not Found - Aurora";
        }
    } catch (error) {
        if (profileContent) profileContent.textContent = "Failed to load profile.";
        document.title = "Error - Aurora";
    }
}

loadProfile();