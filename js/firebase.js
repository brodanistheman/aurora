import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const FirebaseConfig = {
    apiKey: "AIzaSyArnOQVJSyA_AgWcMpSr8rmxxmt3yK4RfA",
    authDomain: "aurora-fc20f.firebaseapp.com",
    projectId: "aurora-fc20f",
    storageBucket: "aurora-fc20f.firebasestorage.app",
    messagingSenderId: "131512476027",
    appId: "1:131512476027:web:891e100564368b448d1dde"
};

const FirebaseApp = initializeApp(FirebaseConfig);

const Auth = getAuth(FirebaseApp);
const Db = getFirestore(FirebaseApp);

export { Auth, Db };