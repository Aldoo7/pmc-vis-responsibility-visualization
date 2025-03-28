import express from 'express';
import sprightly from 'sprightly';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'module';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const require = createRequire(import.meta.url);
require('dotenv').config();
const upload = require('express-fileupload');

const MODE = process.env.MODE || 'demo';
const PORT = process.env.PORT || 3000;
console.log('Environment: ' + MODE);

const app = express();
const server = createServer(app);
const io = new Server(server);

app.engine('spy', sprightly);
app.set('views', './views');
app.set('view engine', 'spy');
app.use(express.static('./public')); // serve the 'public' directory
app.use('/libs', express.static('./node_modules'));
app.use(upload());

const title = 'pmc-vis';
const titleOverview = 'overview';

// pages
app.get('/', (req, res) => {
  // const id = req.query.id;
  renderMain(req, res);
});

app.get('/overview', (req, res) => {
  renderOverview(req, res);
});

function renderOverview(req, res) {
  res.render('overview/overview.spy', {
    titleOverview,
    uuid: uuidv4(),
  });
}

function renderMain(req, res) {
  res.render('main/main.spy', {
    title,
    uuid: uuidv4(),
  });
}

// 141.76.67.176
server.listen(PORT, () => {
  console.log(`Server is listening on port http://localhost:${PORT}`);
});

// listening on the connection event for incoming sockets
io.on('connection', (socket) => {
  // Handle data received from clients
  // socket.on('pane data updated', (data) => {
  //   io.emit('pane data updated', data);
  // });

  socket.on('pane added', (data) => {
    io.emit('handle pane added', data);
  });

  socket.on('pane removed', (data) => {
    io.emit('handle pane removed', data);
  });

  socket.on('overview node clicked', (data) => {
    io.emit('handle overview node clicked', data);
  });

  socket.on('overview nodes selected', (data) => {
    io.emit('handle overview nodes selected', data);
  });

  socket.on('handle selection', (data) => {
    io.emit('handle selection', data);
  });

  socket.on('duplicate pane ids', (data) => {
    io.emit('handle duplicate pane ids', data);
  });

  socket.on('active pane', (data) => {
    io.emit('handle active pane', data);
  });

  socket.on('reset pane-node markings', (data) => {
    io.emit('handle reset pane-node markings', data);
  });

  socket.on('disconnect', () => {
    console.log('client disconnected');
    socket.disconnect();
  });
});
