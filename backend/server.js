require("dotenv").config();

const express = require("express");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");

const app = express();

app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
    family: 4
});

async function connectDB() {
    try {
        await client.connect();

        console.log("MongoDB connected successfully");

        const db = client.db("BuddyTalk");
        const users = db.collection("users");

        const hashedPassword = await bcrypt.hash("test123", 10);

        const result = await users.insertOne({
            name: "Afifa",
            email: "test@example.com",
            password: hashedPassword
        });

        console.log("User inserted:", result.insertedId);

    } catch (error) {
        console.log("MongoDB connection failed:", error);
    }
}

connectDB();