import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

const userInfoElement = document.getElementById('user-info');
const logoutButton = document.getElementById('logout-button');
const updateInfoForm = document.getElementById('update-info-form');
const displayNameInput = document.getElementById('display-name-input');
const usernameInput = document.getElementById('username-input');

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const userSnapshot = await getDoc(userRef);

            if (userSnapshot.exists()) {
                const userData = userSnapshot.data();
                
                if (userInfoElement) {
                    userInfoElement.innerHTML = `
                        <p>Email: ${userData.email}</p>
                        <p>Registration ID: #${userData.sequentialId}</p>
                        <p>IP Address: ${userData.ipAddress}</p>
                    `;
                }

                if (displayNameInput && usernameInput) {
                    displayNameInput.value = userData.displayName || '';
                    usernameInput.value = userData.username || '';
                }
            } else {
                if (userInfoElement) userInfoElement.textContent = "User profile not found.";
            }
        } catch (error) {
            if (userInfoElement) userInfoElement.textContent = "Failed to load user data.";
        }
    } else {
        window.location.href = '/aurora/';
    }
});

if (updateInfoForm) {
    updateInfoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (user) {
            try {
                const userRef = doc(db, "users", user.uid);
                
                await updateDoc(userRef, {
                    displayName: displayNameInput.value.trim(),
                    username: usernameInput.value.trim()
                });

                alert("Account details updated successfully!");
            } catch (error) {
                alert("Failed to update details: " + error.message);
            }
        }
    });
}

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        await signOut(auth);
        localStorage.removeItem('aurora_user');
        window.location.href = '/aurora/';
    });
}