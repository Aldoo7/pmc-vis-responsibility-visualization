import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_BACKEND_SOCKET);

socket.connected = false;

socket.on('connect', () => {
  socket.connected = true;
});

export { socket };
