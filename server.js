const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Простий лабіринт зі стінами [x1, y1, x2, y2]
const MAZE_WALLS = [
  [0, 0, 800, 0], [0, 0, 0, 500], [800, 0, 800, 500], [0, 500, 800, 500],
  [150, 0, 150, 350], [300, 150, 300, 500], [450, 0, 450, 350], [600, 150, 600, 500]
];

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName, skinData }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: {},
        bullets: []
      };
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName || 'Танкіст',
      skin: skinData,
      x: 50 + Math.random() * 700,
      y: 50 + Math.random() * 400,
      angle: 0,
      score: 0,
      alive: true
    };

    socket.roomId = roomId;
    io.to(roomId).emit('initRoom', { roomId, walls: MAZE_WALLS });
  });

  socket.on('playerInput', (input) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const p = rooms[roomId].players[socket.id];
    if (!p.alive) return;

    if (input.left) p.angle -= 0.06;
    if (input.right) p.angle += 0.06;
    
    let speed = 0;
    if (input.forward) speed = 3;
    if (input.backward) speed = -2;

    if (speed !== 0) {
      const nextX = p.x + Math.cos(p.angle) * speed;
      const nextY = p.y + Math.sin(p.angle) * speed;
      if (nextX > 20 && nextX < 780) p.x = nextX;
      if (nextY > 20 && nextY < 480) p.y = nextY;
    }
  });

  socket.on('shoot', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const p = rooms[roomId].players[socket.id];
    if (!p.alive) return;

    const pBullets = rooms[roomId].bullets.filter(b => b.ownerId === socket.id);
    if (pBullets.length >= 5) return;

    rooms[roomId].bullets.push({
      id: Math.random().toString(),
      ownerId: socket.id,
      x: p.x + Math.cos(p.angle) * 25,
      y: p.y + Math.sin(p.angle) * 25,
      vx: Math.cos(p.angle) * 6,
      vy: Math.sin(p.angle) * 6,
      bounces: 0
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      const b = room.bullets[i];
      b.x += b.vx;
      b.y += b.vy;

      if (b.x <= 10 || b.x >= 790) { b.vx *= -1; b.bounces++; }
      if (b.y <= 10 || b.y >= 490) { b.vy *= -1; b.bounces++; }

      for (const pid in room.players) {
        const p = room.players[pid];
        if (!p.alive) continue;

        const dist = Math.hypot(p.x - b.x, p.y - b.y);
        if (dist < 20) {
          p.alive = false;
          if (b.ownerId !== pid && room.players[b.ownerId]) {
            room.players[b.ownerId].score += 1;
          }
          room.bullets.splice(i, 1);

          setTimeout(() => {
            if (room.players[pid]) {
              room.players[pid].x = 50 + Math.random() * 700;
              room.players[pid].y = 50 + Math.random() * 400;
              room.players[pid].alive = true;
            }
          }, 3000);
          break;
        }
      }

      if (b.bounces > 4) {
        room.bullets.splice(i, 1);
      }
    }

    io.to(roomId).emit('tick', {
      players: room.players,
      bullets: room.bullets
    });
  }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
