import admin from "firebase-admin"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "fs"

const serviceAccount = JSON.parse(
  readFileSync("serviceAccountKey.json", "utf8")
)

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const db = getFirestore()

export { admin, db }
export default admin