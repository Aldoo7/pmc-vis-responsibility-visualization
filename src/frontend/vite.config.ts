import vitePluginSocketIO from 'vite-plugin-socket-io';
import { defineConfig } from 'vite';

const socketEvents = (io, socket) => {
  socket.on('pane added', (data) => {
    io.emit('pane added', data);
  });

  socket.on('pane removed', (data) => {
    io.emit('pane removed', data);
  });

  socket.on('overview node clicked', (data) => {
    io.emit('overview node clicked', data);
  });

  socket.on('overview nodes selected', (data) => {
    io.emit('overview nodes selected', data);
  });

  socket.on('handle selection', (data) => {
    io.emit('handle selection', data);
  });

  socket.on('duplicate pane ids', (data) => {
    io.emit('duplicate pane ids', data);
  });

  socket.on('active pane', (data) => {
    io.emit('active pane', data);
  });

  socket.on('reset pane-node markings', (data) => {
    io.emit('reset pane-node markings', data);
  });

  socket.on('disconnect', () => {
    console.log('client disconnected');
    socket.disconnect();
  });
}

export default defineConfig({
  base: './',
  plugins: [vitePluginSocketIO({socketEvents})],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        overview: 'overview/index.html',
      },
      output: {
        manualChunks: {
          lodash: ['lodash'], 
          d3: ['d3'],
          cytoscape: ['cytoscape', 
            'cytoscape-undo-redo', 
            'cytoscape-context-menus', 
            'cytoscape-node-html-label', 
            'cytoscape-popper',
          ],
          cola: ['cytoscape-cola'], 
          dagre: ['cytoscape-dagre'], 
          klay: ['cytoscape-klay'],
          elk: ['cytoscape-elk'],
          utils: ['cytoscape-layout-utilities'],
        }
      }
    },
  },
})
