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

// Стіни лабіринту [x1, y1, x2, y2]
const MAZE_WALLS = [
  [0, 0, 800, 0], [0, 0, 0, 500], [800, 0, 800, 500], [0, 500, 800, 500],
  [150, 0, 150, 350], [300, 150, 300, 500], [450, 0, 450, 350], [600, 150, 600, 500]
];

// Проста перевірка зіткнення кола танка з відрізком стіни
function checkWallCollision(x, y, radius, walls) {
  for (const w of walls) {
    const x1 = w[0], y1 = w[1], x2 = w[2], y2 = w[3];
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1; yy = y1;
    } else if (param > 1) {
      xx = x2; yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    if (Math.sqrt(dx * dx + dy * dy) < radius) {
      return true;
    }
  }
  return false;
}

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
      x: 70 + Math.random() * 80,
      y: 70 + Math.random() * 80,
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
    if (input.forward) speed = 2.5;
    if (input.backward) speed = -1.5;

    if (speed !== 0) {
      const nextX = p.x + Math.cos(p.angle) * speed;
      const nextY = p.y + Math.sin(p.angle) * speed;
      
      // Перевіряємо зіткнення зі стінами перед переміщенням (радіус танка = 18)
      if (!checkWallCollision(nextX, nextY, 18, MAZE_WALLS)) {
        p.x = nextX;
        p.y = nextY;
      }
    }
  });

  socket.on('shoot', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const p = rooms[roomId].players[socket.id];
    if (!p.alive) return;

    const pBullets = rooms[roomId].bullets.filter(b => b.ownerId === socket.id);
    if (pBullets.length >= 4) return;

    rooms[roomId].bullets.push({
      id: Math.random().toString(),
      ownerId: socket.id,
      x: p.x + Math.cos(p.angle) * 22,
      y: p.y + Math.sin(p.angle) * 22,
      vx: Math.cos(p.angle) * 5,
      vy: Math.sin(p.angle) * 5,
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

      // Рикошети від меж екрана
      if (b.x <= 10 || b.x >= 790) { b.vx *= -1; b.bounces++; }
      if (b.y <= 10 || b.y >= 490) { b.vy *= -1; b.bounces++; }

      // Рикошети від внутрішніх стін лабіринту
      for (const w of MAZE_WALLS) {
        // Спрощена перевірка відскоку від вертикальних та горизонтальних стін
        const x1 = w[0], y1 = w[1], x2 = w[2], y2 = w[3];
        if (x1 === x2 && Math.abs(b.x - x1) < 6 && b.y >= y1 && b.y <= y2) {
          b.vx *= -1; b.bounces++;
        }
        if (y1 === y2 && Math.abs(b.y - y1) < 6 && b.x >= x1 && b.x <= x2) {
          b.vy *= -1; b.bounces++;
        }
      }

      // Влучання у гравців
      for (const pid in room.players) {
        const p = room.players[pid];
        if (!p.alive) continue;

        const dist = Math.hypot(p.x - b.x, p.y - b.y);
        if (dist < 18) {
          p.alive = false;
          if (b.ownerId !== pid && room.players[b.ownerId]) {
            room.players[b.ownerId].score += 1;
          }
          room.bullets.splice(i, 1);

          setTimeout(() => {
            if (room.players[pid]) {
              room.players[pid].x = 70 + Math.random() * 80;
              room.players[pid].y = 70 + Math.random() * 80;
              room.players[pid].alive = true;
            }
          }, 3000);
          break;
        }
      }

      if (b.bounces > 5) {
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
