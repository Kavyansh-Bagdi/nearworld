import dotenv from "dotenv";
import fs from "fs";
import express, { Request, Response } from "express";
import { createServer } from "https";
// import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { initSocket } from "./socket";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

const options = {
  key: fs.readFileSync("ssl/key.pem", "utf-8"),
  cert: fs.readFileSync("ssl/cert.pem", "utf-8"),
};

const httpServer = createServer(options, app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

initSocket(io.of("/world"));

app.get("/", (req: Request, res: Response) => {
  res.status(200).json({ msg: "Hello! Express Server" });
});

httpServer.listen(PORT, () => {
  console.log(`listening on port : https://localhost:${PORT}`);
});
