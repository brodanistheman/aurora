const { beforeUserCreated } = require("firebase-functions/v2/identity");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.beforecreate = beforeUserCreated(async (event) => {
    const user = event.data;
    const ipAddress = event.ipAddress || "Unknown";

    const counterRef = db.collection("metadata").doc("userCounter");
    const userRef = db.collection("users").doc(user.uid);

    await db.runTransaction(async (transaction) => {
        const counterSnapshot = await transaction.get(counterRef);
        
        let nextOrder = 1;
        if (counterSnapshot.exists) {
            nextOrder = counterSnapshot.data().totalUsers + 1;
            transaction.update(counterRef, { totalUsers: nextOrder });
        } else {
            transaction.set(counterRef, { totalUsers: 1 });
        }

        transaction.set(userRef, {
            uid: user.uid,
            email: user.email,
            registrationOrder: nextOrder,
            registrationIp: ipAddress,
            createdAt: new Date().toISOString()
        });
    });
});
