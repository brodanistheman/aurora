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

const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get('id');

async function loadProfile() {
    if (!userId) {
        document.title = "Profile Not Found - Aurora";
        return;
    }

    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("sequentialId", "==", Number(userId)));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const userData = querySnapshot.docs[0].data();
            const displayName = userData.displayName || 'User';
            document.title = `${displayName} - Aurora`;
        } else {
            document.title = "User Not Found - Aurora";
        }
    } catch (error) {
        document.title = "Error - Aurora";
    }
}

loadProfile();
