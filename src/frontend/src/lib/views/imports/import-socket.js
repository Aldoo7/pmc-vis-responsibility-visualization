import { io } from 'socket.io-client';

const socket = io(import.meta.env.VITE_BACKEND_SOCKET);

socket.on('connect', () => {
  console.log('Connected to backend');
});

export { socket };
