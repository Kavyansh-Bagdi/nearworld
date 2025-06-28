import dotenv from "dotenv"
import Express, { Request, Response } from "express"
import { createServer } from "node:http";
import { Server } from "socket.io";

import { initSocket } from "./socket";

dotenv.config();

const app = Express();
const PORT = process.env.PORT;
const httpServer = createServer(app);
const io = new Server(httpServer);

initSocket(io.of("/world"));

app.get("/", (req: Request, res: Response) => {
    res.status(200).json({ msg : "Hello! Express Server"});
})

app.listen(PORT, () => {
    console.log(`listening on port : http://localhost:${PORT}`);
})