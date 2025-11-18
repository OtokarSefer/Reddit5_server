import express from "express"
import dotenv from "dotenv"
import bodyParser from "body-parser"
import admin from "./fireBase.js"
import fetch from "node-fetch"
import cors from "cors"

dotenv.config({ path: "./config/.env" })

const app = express()

const allowedOrigins = [
  "https://reddit5.vercel.app",
  "https://reddit5-server.onrender.com",
]

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true
}))

app.use(bodyParser.json())

async function getUserProfile(uid) {
  const doc = await admin.firestore().collection("users").doc(uid).get()
  return doc.exists ? doc.data() : null
}

async function verifyOptionalToken(req, _res, next) {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1]
    try {
      const decoded = await admin.auth().verifyIdToken(token)
      req.user = decoded
    } catch {
      // silently ignore invalid tokens
    }
  }
  next()
}

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

async function requireSubscriber(req, res, next) {
  if (!req.user?.uid) return res.status(401).json({ error: "Login required" })
  const profile = await getUserProfile(req.user.uid)
  if (!profile?.subscription?.active) {
    return res.status(402).json({
      error: "Subscription required",
      code: "PAYWALL_BLOCKED"
    })
  }
  next()
}

app.post("/dev/toggle-subscription", verifyToken, async (req, res) => {
  try {
    const userRef = admin.firestore().collection("users").doc(req.user.uid)
    const doc = await userRef.get()

    if (!doc.exists) {
      return res.status(404).json({ error: "User not found" })
    }

    const profile = doc.data()
    const currentStatus = profile.subscription?.active || false
    const newStatus = !currentStatus

    await userRef.update({
      subscription: {
        active: newStatus,
        updatedAt: new Date().toISOString()
      }
    })

    res.json({ active: newStatus })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/me", verifyToken, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.uid)
    res.json({
      uid: req.user.uid,
      email: req.user.email,
      subscription: profile?.subscription || { active: false }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

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
      createdAt: new Date().toISOString(),
      subscription: { active: false, updatedAt: new Date().toISOString() }
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

app.get("/posts", verifyOptionalToken, async (req, res) => {
  try {
    const snapshot = await admin.firestore()
      .collection("posts")
      .orderBy("createdAt", "desc")
      .get()

    const posts = snapshot.docs.map(doc => {
      const data = doc.data()
      const content = data.content || ""
      const preview = content.slice(0, 200)
      return {
        id: doc.id,
        title: data.title,
        preview,
        hasMore: content.length > preview.length,
        username: data.username,
        userEmail: data.userEmail,
        createdAt: data.createdAt
      }
    })

    res.json(posts)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/posts/:id", verifyOptionalToken, async (req, res) => {
  try {
    const postDoc = await admin.firestore()
      .collection("posts")
      .doc(req.params.id)
      .get()

    if (!postDoc.exists) {
      return res.status(404).json({ error: "Post not found" })
    }

    const data = postDoc.data()
    const content = data.content || ""
    const preview = content.slice(0, 200)

    let isSubscriber = false
    if (req.user?.uid) {
      const profile = await getUserProfile(req.user.uid)
      isSubscriber = !!profile?.subscription?.active
    }

    if (isSubscriber) {
      return res.json({
        id: postDoc.id,
        title: data.title,
        content,
        username: data.username,
        userEmail: data.userEmail,
        createdAt: data.createdAt
      })
    }

    return res.status(402).json({
      error: "Subscription required",
      code: "PAYWALL_BLOCKED",
      post: {
        id: postDoc.id,
        title: data.title,
        preview,
        hasMore: content.length > preview.length,
        username: data.username,
        userEmail: data.userEmail,
        createdAt: data.createdAt
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 3333
app.listen(PORT, () => console.log(`Server Running on port ${PORT}`))
