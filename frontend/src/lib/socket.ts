import { io } from "socket.io-client";

const socket = io("https://192.168.57.59:8000/world", {
  secure: true,
  rejectUnauthorized: false,
});

export default socket;
