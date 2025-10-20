import express from "express"
import dotenv from "dotenv"
import bodyParser from "body-parser"
import admin from "./fireBase.js"
import fetch from "node-fetch"
import cors from "cors"

dotenv.config({ path: "./config/.env" })

const app = express()

const allowedOrigins = [
  "http://localhost:5173",
]

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

app.use(bodyParser.json())

app.post("/register", async (req, res) => {
  const { email, password, username } = req.body
  try {
    const user = await admin.auth().createUser({
      email,
      password,
      displayName: username
    })
    await admin.firestore().collection("users").doc(user.uid).set({
      email,
      username,
      createdAt: new Date().toISOString()
    })
    res.json({ message: "User created", user })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post("/login", async (req, res) => {
  const { email, password } = req.body
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    )
    const data = await response.json()
    if (data.error) throw new Error(data.error.message)
    res.json({
      message: "Logged in successfully",
      idToken: data.idToken,
      refreshToken: data.refreshToken
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" })
  }
  const token = authHeader.split(" ")[1]
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" })
  }
}

app.post("/posts", verifyToken, async (req, res) => {
  const { title, content } = req.body
  try {
    if (!title || !content) throw new Error("Missing title or content")
    const user = await admin.auth().getUser(req.user.uid)
    const newPost = {
      title,
      content,
      userEmail: user.email,
      username: user.displayName || "Anonymous",
      createdAt: new Date().toISOString()
    }
    const docRef = await admin.firestore().collection("posts").add(newPost)
    res.json({ id: docRef.id, ...newPost })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.get("/posts", async (req, res) => {
  try {
    const snapshot = await admin.firestore().collection("posts").orderBy("createdAt", "desc").get()
    const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    res.json(posts)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/posts/:id", async (req, res) => {
  try {
    const postDoc = await admin.firestore().collection("posts").doc(req.params.id).get()
    if (!postDoc.exists) return res.status(404).json({ error: "Post not found" })
    res.json({ id: postDoc.id, ...postDoc.data() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 3333
app.listen(PORT, () => console.log(`Server Running on port ${PORT}`))