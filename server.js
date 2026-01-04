const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PLAYER_SIZE = 32;
const SPEED = 4;
const CORE_X = 400;
const CORE_Y = 300;
const MOB_SPEED = 1.2;
const GOLD_REWARD = 10;
const KILLS_TO_LEVEL = 5;
const BASE_SPAWN_INTERVAL = 2000;
const BASE_DAMAGE = 10;
const UPGRADE_BASE_COST = 20;
const MAX_PLAYERS_PER_ROOM = 5;

const WAYPOINTS = [
  { x: 0, y: 300 },
  { x: 400, y: 300 },
];

const rooms = {};

function createRoom(roomName) {
  rooms[roomName] = {
    name: roomName,
    players: {},
    matchConfig: {
      state: "LOBBY",
      maxWaves: 3,
      currentWave: 0,
    },
    gameState: {
      coreHP: 100,
      wave: 1,
      mobs: {},
      gameOver: false,
      mobsSpawnedThisWave: 0,
      mobsPerWave: 5,
      playersAtWaveStart: 1,
      currentMobHP: 30,
    },
    spawnIntervalId: null,
    mobIdCounter: 0,
  };
  return rooms[roomName];
}

function getRoom(roomName) {
  return rooms[roomName] || null;
}

function deleteRoom(roomName) {
  const room = rooms[roomName];
  if (room) {
    if (room.spawnIntervalId) {
      clearInterval(room.spawnIntervalId);
    }
    delete rooms[roomName];
  }
}

function getWaveStats(wave, numPlayers) {
  const playerCount = Math.max(1, numPlayers);
  const mobHP = Math.floor(
    30 * (1 + wave * 0.5) * (1 + (playerCount - 1) * 0.7)
  );
  const mobsPerWave = (5 + wave * 2) * playerCount;
  return { mobHP, mobsPerWave };
}

function getSpawnInterval(room) {
  return Math.max(1000, BASE_SPAWN_INTERVAL - (room.gameState.wave - 1) * 300);
}

function spawnMob(roomName) {
  const room = getRoom(roomName);
  if (!room) return;
  if (room.matchConfig.state !== "PLAYING") return;
  if (room.gameState.gameOver) return;
  if (room.gameState.mobsSpawnedThisWave >= room.gameState.mobsPerWave) return;

  const id = `mob_${room.mobIdCounter++}`;
  const hp = room.gameState.currentMobHP;

  room.gameState.mobs[id] = {
    id,
    x: WAYPOINTS[0].x,
    y: WAYPOINTS[0].y + (Math.random() * 100 - 50),
    hp,
    maxHp: hp,
    waypointIndex: 0,
    lastHitBy: null,
  };

  room.gameState.mobsSpawnedThisWave++;
}

function startSpawner(roomName) {
  const room = getRoom(roomName);
  if (!room) return;
  if (room.spawnIntervalId) clearInterval(room.spawnIntervalId);
  room.spawnIntervalId = setInterval(
    () => spawnMob(roomName),
    getSpawnInterval(room)
  );
}

function updateMobs(roomName) {
  const room = getRoom(roomName);
  if (!room) return;
  if (room.gameState.gameOver) return;

  for (const id in room.gameState.mobs) {
    const mob = room.gameState.mobs[id];
    const targetWaypoint =
      WAYPOINTS[mob.waypointIndex + 1] || WAYPOINTS[WAYPOINTS.length - 1];

    const dx = targetWaypoint.x - mob.x;
    const dy = targetWaypoint.y - mob.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      if (mob.waypointIndex < WAYPOINTS.length - 2) {
        mob.waypointIndex++;
      } else {
        room.gameState.coreHP -= 10;
        delete room.gameState.mobs[id];

        if (room.gameState.coreHP <= 0) {
          room.gameState.coreHP = 0;
          room.gameState.gameOver = true;
          io.to(roomName).emit("gameOver", { wave: room.gameState.wave });
        }
        continue;
      }
    }

    mob.x += (dx / dist) * MOB_SPEED;
    mob.y += (dy / dist) * MOB_SPEED;
  }
}

function checkWaveComplete(roomName) {
  const room = getRoom(roomName);
  if (!room) return;
  if (room.matchConfig.state !== "PLAYING") return;
  if (room.gameState.gameOver) return;

  const allSpawned =
    room.gameState.mobsSpawnedThisWave >= room.gameState.mobsPerWave;
  const allKilled = Object.keys(room.gameState.mobs).length === 0;

  if (allSpawned && allKilled) {
    room.matchConfig.currentWave++;
    room.gameState.wave = room.matchConfig.currentWave;

    if (room.matchConfig.currentWave > room.matchConfig.maxWaves) {
      room.matchConfig.state = "VICTORY";
      if (room.spawnIntervalId) {
        clearInterval(room.spawnIntervalId);
        room.spawnIntervalId = null;
      }
      emitGameStateChange(roomName);
      return;
    }

    if (room.spawnIntervalId) {
      clearInterval(room.spawnIntervalId);
      room.spawnIntervalId = null;
    }

    room.matchConfig.state = "SHOP";
    for (const id in room.players) {
      room.players[id].shopReady = false;
    }

    io.to(roomName).emit("shopOpened", {
      wave: room.gameState.wave,
      nextWave: room.gameState.wave + 1,
    });
    emitGameStateChange(roomName);
  }
}

function emitGameStateChange(roomName) {
  const room = getRoom(roomName);
  if (!room) return;

  const totalGold = Object.values(room.players).reduce(
    (sum, p) => sum + p.gold,
    0
  );
  io.to(roomName).emit("gameStateChanged", {
    state: room.matchConfig.state,
    currentWave: room.matchConfig.currentWave,
    maxWaves: room.matchConfig.maxWaves,
    totalGold,
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      ready: p.ready,
      shopReady: p.shopReady,
      gold: p.gold,
      kills: p.kills,
      level: p.level,
      damage: p.damage,
    })),
  });
}

function startGame(roomName) {
  const room = getRoom(roomName);
  if (!room) return;

  room.matchConfig.state = "PLAYING";
  room.matchConfig.currentWave = 1;
  room.gameState.wave = 1;
  room.gameState.coreHP = 100;
  room.gameState.mobs = {};
  room.gameState.gameOver = false;
  room.gameState.mobsSpawnedThisWave = 0;
  room.mobIdCounter = 0;

  const numPlayers = Object.keys(room.players).length;
  const waveStats = getWaveStats(1, numPlayers);

  room.gameState.mobsPerWave = waveStats.mobsPerWave;
  room.gameState.currentMobHP = waveStats.mobHP;
  room.gameState.playersAtWaveStart = numPlayers;

  startSpawner(roomName);
  emitGameStateChange(roomName);

  io.to(roomName).emit("waveStats", {
    wave: 1,
    mobHP: waveStats.mobHP,
    totalMobs: waveStats.mobsPerWave,
    numPlayers: numPlayers,
  });
}

function startNextWave(roomName) {
  const room = getRoom(roomName);
  if (!room) return;

  room.matchConfig.state = "PLAYING";

  const numPlayers = Object.keys(room.players).length;
  const waveStats = getWaveStats(room.gameState.wave, numPlayers);

  room.gameState.mobsSpawnedThisWave = 0;
  room.gameState.mobsPerWave = waveStats.mobsPerWave;
  room.gameState.currentMobHP = waveStats.mobHP;
  room.gameState.playersAtWaveStart = numPlayers;

  startSpawner(roomName);
  io.to(roomName).emit("waveComplete", { wave: room.gameState.wave });
  io.to(roomName).emit("waveStats", {
    wave: room.gameState.wave,
    mobHP: waveStats.mobHP,
    totalMobs: waveStats.mobsPerWave,
    numPlayers: numPlayers,
  });
  emitGameStateChange(roomName);
}

function resetGame(roomName) {
  const room = getRoom(roomName);
  if (!room) return;

  room.matchConfig.state = "LOBBY";
  room.matchConfig.currentWave = 0;
  room.gameState.coreHP = 100;
  room.gameState.wave = 1;
  room.gameState.mobs = {};
  room.gameState.gameOver = false;
  room.gameState.mobsSpawnedThisWave = 0;
  room.gameState.mobsPerWave = 5;
  room.gameState.currentMobHP = 30;
  room.gameState.playersAtWaveStart = 1;
  room.mobIdCounter = 0;

  if (room.spawnIntervalId) {
    clearInterval(room.spawnIntervalId);
    room.spawnIntervalId = null;
  }

  for (const id in room.players) {
    room.players[id].gold = 0;
    room.players[id].kills = 0;
    room.players[id].level = 1;
    room.players[id].fireRate = 500;
    room.players[id].ready = false;
    room.players[id].shopReady = false;
    room.players[id].damage = BASE_DAMAGE;
    room.players[id].damageUpgrades = 0;

    const spawnRadius = 100;
    const angle = Math.random() * Math.PI * 2;
    room.players[id].x = CORE_X + Math.cos(angle) * spawnRadius;
    room.players[id].y = CORE_Y + Math.sin(angle) * spawnRadius;
  }

  emitGameStateChange(roomName);

  io.to(roomName).emit("gameReset", {
    players: room.players,
    gameState: {
      coreHP: room.gameState.coreHP,
      wave: room.gameState.wave,
      mobs: room.gameState.mobs,
    },
  });
}

function getUpgradeCost(upgradeCount) {
  return Math.floor(UPGRADE_BASE_COST * Math.pow(1.2, upgradeCount));
}

setInterval(() => {
  for (const roomName in rooms) {
    const room = rooms[roomName];
    if (room.matchConfig.state === "PLAYING") {
      updateMobs(roomName);
      checkWaveComplete(roomName);
    }
  }
}, 1000 / 60);

setInterval(() => {
  for (const roomName in rooms) {
    const room = rooms[roomName];
    io.to(roomName).emit("gameStateUpdate", {
      coreHP: room.gameState.coreHP,
      wave: room.gameState.wave,
      mobs: room.gameState.mobs,
      gameOver: room.gameState.gameOver,
      matchState: room.matchConfig.state,
      currentWave: room.matchConfig.currentWave,
      maxWaves: room.matchConfig.maxWaves,
    });
  }
}, 50);

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);
  socket.roomName = null;

  socket.on("joinRoom", (data) => {
    const roomName = data.roomName || "default";

    if (socket.roomName) {
      const oldRoom = getRoom(socket.roomName);
      if (oldRoom && oldRoom.players[socket.id]) {
        delete oldRoom.players[socket.id];
        socket.leave(socket.roomName);
        io.to(socket.roomName).emit("playerDisconnected", socket.id);
        emitGameStateChange(socket.roomName);

        if (Object.keys(oldRoom.players).length === 0) {
          deleteRoom(socket.roomName);
        }
      }
    }

    let room = getRoom(roomName);
    if (!room) {
      room = createRoom(roomName);
    }

    if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("roomFull", { roomName, maxPlayers: MAX_PLAYERS_PER_ROOM });
      return;
    }

    socket.join(roomName);
    socket.roomName = roomName;

    const spawnRadius = 100;
    const angle = Math.random() * Math.PI * 2;
    room.players[socket.id] = {
      id: socket.id,
      x: CORE_X + Math.cos(angle) * spawnRadius,
      y: CORE_Y + Math.sin(angle) * spawnRadius,
      gold: 0,
      kills: 0,
      level: 1,
      fireRate: 500,
      ready: false,
      shopReady: false,
      damage: BASE_DAMAGE,
      damageUpgrades: 0,
    };

    socket.emit("joinedRoom", { roomName });

    socket.emit("currentPlayers", {
      players: room.players,
      myId: socket.id,
      matchConfig: {
        state: room.matchConfig.state,
        currentWave: room.matchConfig.currentWave,
        maxWaves: room.matchConfig.maxWaves,
      },
      gameState: {
        coreHP: room.gameState.coreHP,
        wave: room.gameState.wave,
        mobs: room.gameState.mobs,
      },
    });

    socket.to(roomName).emit("newPlayer", room.players[socket.id]);
    emitGameStateChange(roomName);
  });

  socket.on("toggleReady", () => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    if (room.matchConfig.state !== "LOBBY") return;

    player.ready = !player.ready;
    emitGameStateChange(socket.roomName);

    const allPlayers = Object.values(room.players);
    if (allPlayers.length > 0 && allPlayers.every((p) => p.ready)) {
      startGame(socket.roomName);
    }
  });

  socket.on("shopReady", () => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    if (room.matchConfig.state !== "SHOP") return;

    player.shopReady = !player.shopReady;
    emitGameStateChange(socket.roomName);

    const allPlayers = Object.values(room.players);
    if (allPlayers.length > 0 && allPlayers.every((p) => p.shopReady)) {
      startNextWave(socket.roomName);
    }
  });

  socket.on("buyUpgrade", (data) => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    if (room.matchConfig.state !== "SHOP") return;

    const upgradeType = data.type || "damage";

    if (upgradeType === "damage") {
      const cost = getUpgradeCost(player.damageUpgrades);
      if (player.gold >= cost) {
        player.gold -= cost;
        player.damage += 4;
        player.damageUpgrades++;

        io.to(socket.roomName).emit("playerUpdate", {
          id: player.id,
          gold: player.gold,
          kills: player.kills,
          level: player.level,
          fireRate: player.fireRate,
          damage: player.damage,
          damageUpgrades: player.damageUpgrades,
        });
      }
    }
  });

  socket.on("input", (input) => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const prevX = player.x;
    const prevY = player.y;

    if (input.up) player.y -= SPEED;
    if (input.down) player.y += SPEED;
    if (input.left) player.x -= SPEED;
    if (input.right) player.x += SPEED;

    player.x = Math.max(
      PLAYER_SIZE / 2,
      Math.min(WORLD_WIDTH - PLAYER_SIZE / 2, player.x)
    );
    player.y = Math.max(
      PLAYER_SIZE / 2,
      Math.min(WORLD_HEIGHT - PLAYER_SIZE / 2, player.y)
    );

    if (player.x !== prevX || player.y !== prevY) {
      io.to(socket.roomName).emit("playerMoved", player);
    }
  });

  socket.on("shootArrow", (data) => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    socket.to(socket.roomName).emit("arrowFired", {
      playerId: socket.id,
      startX: player.x,
      startY: player.y,
      targetX: data.targetX,
      targetY: data.targetY,
    });
  });

  socket.on("arrowHit", (data) => {
    const room = getRoom(socket.roomName);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    const mob = room.gameState.mobs[data.mobId];
    if (!mob) return;

    mob.hp -= player.damage;
    mob.lastHitBy = socket.id;

    if (mob.hp <= 0) {
      const mobPosition = { x: mob.x, y: mob.y };
      delete room.gameState.mobs[data.mobId];

      const killer = room.players[mob.lastHitBy];
      if (killer) {
        killer.gold += GOLD_REWARD;
        killer.kills += 1;

        if (killer.kills % KILLS_TO_LEVEL === 0) {
          killer.level += 1;
          killer.fireRate = Math.max(300, killer.fireRate - 30);
        }

        io.to(socket.roomName).emit("playerUpdate", {
          id: killer.id,
          gold: killer.gold,
          kills: killer.kills,
          level: killer.level,
          fireRate: killer.fireRate,
          damage: killer.damage,
          damageUpgrades: killer.damageUpgrades,
        });
      }

      io.to(socket.roomName).emit("mobKilled", {
        mobId: data.mobId,
        by: mob.lastHitBy,
        position: mobPosition,
      });
    }
  });

  socket.on("resetGame", () => {
    if (socket.roomName) {
      resetGame(socket.roomName);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    if (socket.roomName) {
      const room = getRoom(socket.roomName);
      if (room) {
        delete room.players[socket.id];
        io.to(socket.roomName).emit("playerDisconnected", socket.id);
        emitGameStateChange(socket.roomName);

        if (Object.keys(room.players).length === 0) {
          deleteRoom(socket.roomName);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Tower Defense running on http://localhost:${PORT}`);
});
