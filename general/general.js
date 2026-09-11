window.clearMessagesCollection = async function() {
    const querySnapshot = await getDocs(collection(db, "messages"));
    const deletePromises = querySnapshot.docs.map((document) => 
        deleteDoc(doc(db, "messages", document.id))
    );
    await Promise.all(deletePromises);
    console.log("All messages deleted successfully!");
};