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

const MAZE_WALLS = [
  [0, 0, 800, 0], [0, 0, 0, 500], [800, 0, 800, 500], [0, 500, 800, 500],
  [150, 0, 150, 350], [300, 150, 300, 500], [450, 0, 450, 350], [600, 150, 600, 500]
];

function checkWallCollision(x, y, radius, walls) {
  for (const w of walls) {
    const x1 = w[0], y1 = w[1], x2 = w[2], y2 = w[3];
    const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    let xx = param < 0 ? x1 : param > 1 ? x2 : x1 + param * C;
    let yy = param < 0 ? y1 : param > 1 ? y2 : y1 + param * D;
    if (Math.hypot(x - xx, y - yy) < radius) return true;
  }
  return false;
}

// Генерація випадкової вільної позиції
function getRandomPos() {
  let x, y;
  do {
    x = 50 + Math.random() * 700;
    y = 50 + Math.random() * 400;
  } while (checkWallCollision(x, y, 30, MAZE_WALLS));
  return { x, y };
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName, skinData }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        players: {},
        bullets: [],
        powerups: [],
        miniTanks: []
      };
      
      // Спавн коробок з бонусами кожні 10 секунд
      setInterval(() => {
        const room = rooms[roomId];
        if (room && room.powerups.length < 3) {
          const pos = getRandomPos();
          const types = ['shield', 'homing', 'pierce', 'machinegun', 'rc'];
          const type = types[Math.floor(Math.random() * types.length)];
          room.powerups.push({ id: Math.random().toString(), x: pos.x, y: pos.y, type });
        }
      }, 10000);
    }

    const pos = getRandomPos();
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName || 'Танкіст',
      skin: skinData,
      x: pos.x,
      y: pos.y,
      angle: 0,
      score: 0,
      alive: true,
      shield: false,
      ability: null, // 'homing', 'pierce', 'machinegun', 'rc'
      lastShot: 0
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
      if (!checkWallCollision(nextX, nextY, 18, MAZE_WALLS)) {
        p.x = nextX;
        p.y = nextY;
      }
    }

    // Підбір бонусів
    const room = rooms[roomId];
    for (let i = room.powerups.length - 1; i >= 0; i--) {
      const pu = room.powerups[i];
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < 25) {
        if (pu.type === 'shield') {
          p.shield = true;
        } else {
          p.ability = pu.type;
        }
        room.powerups.splice(i, 1);
        break;
      }
    }
  });

  socket.on('shoot', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const p = rooms[roomId].players[socket.id];
    if (!p.alive) return;

    const now = Date.now();
    const cooldown = p.ability === 'machinegun' ? 150 : 400;
    if (now - p.lastShot < cooldown) return;
    p.lastShot = now;

    // Спеціальна здатність: Міні-танк
    if (p.ability === 'rc') {
      p.ability = null;
      rooms[roomId].miniTanks.push({
        ownerId: socket.id,
        x: p.x + Math.cos(p.angle) * 25,
        y: p.y + Math.sin(p.angle) * 25,
        angle: p.angle
      });
      return;
    }

    const isHoming = p.ability === 'homing';
    const isPierce = p.ability === 'pierce';
    if (p.ability && p.ability !== 'machinegun') p.ability = null;

    rooms[roomId].bullets.push({
      ownerId: socket.id,
      x: p.x + Math.cos(p.angle) * 22,
      y: p.y + Math.sin(p.angle) * 22,
      vx: Math.cos(p.angle) * 5,
      vy: Math.sin(p.angle) * 5,
      bounces: 0,
      homing: isHoming,
      pierce: isPierce
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) delete rooms[roomId];
    }
  });
});

// Ігровий цикл
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    
    // Рух міні-танків на керуванні (їдуть до найближчого ворога)
    for (let i = room.miniTanks.length - 1; i >= 0; i--) {
      const rc = room.miniTanks[i];
      let closestEnemy = null;
      let minDist = Infinity;
      for (const pid in room.players) {
        if (pid === rc.ownerId) continue;
        const enemy = room.players[pid];
        if (!enemy.alive) continue;
        const d = Math.hypot(enemy.x - rc.x, enemy.y - rc.y);
        if (d < minDist) { minDist = d; closestEnemy = enemy; }
      }

      if (closestEnemy) {
        rc.angle = Math.atan2(closestEnemy.y - rc.y, closestEnemy.x - rc.x);
        rc.x += Math.cos(rc.angle) * 2;
        rc.y += Math.sin(rc.angle) * 2;

        if (Math.hypot(closestEnemy.x - rc.x, closestEnemy.y - rc.y) < 20) {
          closestEnemy.alive = false;
          if (room.players[rc.ownerId]) room.players[rc.ownerId].score += 1;
          room.miniTanks.splice(i, 1);
          setTimeout(() => {
            if (room.players[pid]) {
              const pos = getRandomPos();
              closestEnemy.x = pos.x; closestEnemy.y = pos.y; closestEnemy.alive = true;
            }
          }, 3000);
          continue;
        }
      }
      if (checkWallCollision(rc.x, rc.y, 10, MAZE_WALLS)) {
        room.miniTanks.splice(i, 1);
      }
    }

    // Рух куль
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      const b = room.bullets[i];

      // Самонаведення ракетки
      if (b.homing) {
        let closestEnemy = null;
        let minDist = Infinity;
        for (const pid in room.players) {
          if (pid === b.ownerId) continue;
          const enemy = room.players[pid];
          if (!enemy.alive) continue;
          const d = Math.hypot(enemy.x - b.x, enemy.y - b.y);
          if (d < minDist) { minDist = d; closestEnemy = enemy; }
        }
        if (closestEnemy) {
          const targetAngle = Math.atan2(closestEnemy.y - b.y, closestEnemy.x - b.x);
          const currentAngle = Math.atan2(b.vy, b.vx);
          let angleDiff = targetAngle - currentAngle;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          const newAngle = currentAngle + Math.sign(angleDiff) * 0.08;
          const speed = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(newAngle) * speed;
          b.vy = Math.sin(newAngle) * speed;
        }
      }

      b.x += b.vx;
      b.y += b.vy;

      if (!b.pierce) {
        if (b.x <= 5 || b.x >= 795) { b.vx *= -1; b.bounces++; }
        if (b.y <= 5 || b.y >= 495) { b.vy *= -1; b.bounces++; }

        for (const w of MAZE_WALLS) {
          const x1 = w[0], y1 = w[1], x2 = w[2], y2 = w[3];
          if (x1 === x2 && Math.abs(b.x - x1) < 6 && b.y >= Math.min(y1, y2) && b.y <= Math.max(y1, y2)) {
            b.vx *= -1; b.x += b.vx * 2; b.bounces++; break;
          }
          if (y1 === y2 && Math.abs(b.y - y1) < 6 && b.x >= Math.min(x1, x2) && b.x <= Math.max(x1, x2)) {
            b.vy *= -1; b.y += b.vy * 2; b.bounces++; break;
          }
        }
      } else {
        if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 500) {
          room.bullets.splice(i, 1);
          continue;
        }
      }

      // Влучання у гравців
      for (const pid in room.players) {
        const p = room.players[pid];
        if (!p.alive || pid === b.ownerId) continue;

        if (Math.hypot(p.x - b.x, p.y - b.y) < 18) {
          if (p.shield) {
            p.shield = false; // Щит захищає від 1 пострілу
          } else {
            p.alive = false;
            if (room.players[b.ownerId]) room.players[b.ownerId].score += 1;
            setTimeout(() => {
              if (room.players[pid]) {
                const pos = getRandomPos();
                p.x = pos.x; p.y = pos.y; p.alive = true;
              }
            }, 3000);
          }
          room.bullets.splice(i, 1);
          break;
        }
      }

      if (b.bounces > 5) room.bullets.splice(i, 1);
