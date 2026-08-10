# Technology Stack

## Frontend

### Technologies
- React
- TypeScript
- Vite
- Tailwind CSS

### Why?

- **React** → Build reusable UI components and create a modern, interactive web application.
- **TypeScript** → Improves code quality by detecting errors during development.
- **Vite** → Provides a fast development server and quick project builds.
- **Tailwind CSS** → Helps build responsive and clean user interfaces quickly.

---

## Backend

### Technologies
- Node.js
- Express.js

### Why?

- **Node.js** → Allows JavaScript to run on the server so both frontend and backend use the same language.
- **Express.js** → Makes it easy to build REST APIs and handle requests between the frontend and database.

---

## Database

### Technology
- MongoDB Atlas

### Why?

MongoDB stores application data such as user details, communication cards, categories, and image/audio URLs. It provides a flexible document-based database that is suitable for this project.

---

## Authentication

### Technologies
- JWT
- bcrypt

### Why?

- **JWT** → Securely authenticates users between the frontend and backend.
- **bcrypt** → Encrypts user passwords before storing them in the database.

---

## Media Storage

### Technology
- Cloudinary *(Future Integration)*

### Why?

Stores images and audio files efficiently. MongoDB stores only the URLs of these files instead of the files themselves.

---

## Version Control

### Technologies
- Git
- GitHub

### Why?

- **Git** → Tracks project history and manages different versions of the project.
- **GitHub** → Stores the project online for backup, collaboration, and deployment.

---

## Deployment

### Frontend
- Vercel

### Backend
- Render

### Database
- MongoDB Atlas

### Why?

These platforms provide simple and reliable deployment for modern full-stack web applications.

---

## Final Architecture

Child/User

↓

React Frontend

↓

Express.js Backend

↓

MongoDB Atlas

↓

Cloudinary (Images & Audio)

↓

Deployment (Vercel + Render)
