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
const ARROW_DAMAGE = 12;
const GOLD_REWARD = 10;
const KILLS_TO_LEVEL = 5;
const BASE_SPAWN_INTERVAL = 2000;

const WAYPOINTS = [
  { x: 0, y: 300 },
  { x: 400, y: 300 },
];

const players = {};
let mobIdCounter = 0;
let spawnIntervalId = null;

const matchConfig = {
  state: "LOBBY",
  maxWaves: 3,
  currentWave: 0,
};

const gameState = {
  coreHP: 100,
  wave: 1,
  mobs: {},
  gameOver: false,
  mobsSpawnedThisWave: 0,
  mobsKilledThisWave: 0,
  mobsPerWave: 5,
  playersAtWaveStart: 1,
  currentMobHP: 30,
};

function getWaveStats(wave, numPlayers) {
  const playerCount = Math.max(1, numPlayers);
  const mobHP = Math.floor(
    30 * (1 + wave * 0.5) * (1 + (playerCount - 1) * 0.7)
  );
  const mobsPerWave = (5 + wave * 2) * playerCount;
  return { mobHP, mobsPerWave };
}

function getSpawnInterval() {
  return Math.max(1000, BASE_SPAWN_INTERVAL - (gameState.wave - 1) * 300);
}

function spawnMob() {
  if (matchConfig.state !== "PLAYING") return;
  if (gameState.gameOver) return;
  if (gameState.mobsSpawnedThisWave >= gameState.mobsPerWave) return;

  const id = `mob_${mobIdCounter++}`;
  const hp = gameState.currentMobHP;

  gameState.mobs[id] = {
    id,
    x: WAYPOINTS[0].x,
    y: WAYPOINTS[0].y + (Math.random() * 100 - 50),
    hp,
    maxHp: hp,
    waypointIndex: 0,
    lastHitBy: null,
  };

  gameState.mobsSpawnedThisWave++;
}

function startSpawner() {
  if (spawnIntervalId) clearInterval(spawnIntervalId);
  spawnIntervalId = setInterval(spawnMob, getSpawnInterval());
}

function updateMobs() {
  if (gameState.gameOver) return;

  for (const id in gameState.mobs) {
    const mob = gameState.mobs[id];
    const targetWaypoint =
      WAYPOINTS[mob.waypointIndex + 1] || WAYPOINTS[WAYPOINTS.length - 1];

    const dx = targetWaypoint.x - mob.x;
    const dy = targetWaypoint.y - mob.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      if (mob.waypointIndex < WAYPOINTS.length - 2) {
        mob.waypointIndex++;
      } else {
        gameState.coreHP -= 10;
        delete gameState.mobs[id];

        if (gameState.coreHP <= 0) {
          gameState.coreHP = 0;
          gameState.gameOver = true;
          io.emit("gameOver", { wave: gameState.wave });
        }
        continue;
      }
    }

    mob.x += (dx / dist) * MOB_SPEED;
    mob.y += (dy / dist) * MOB_SPEED;
  }
}

function checkWaveComplete() {
  if (matchConfig.state !== "PLAYING") return;
  if (gameState.gameOver) return;

  const allSpawned = gameState.mobsSpawnedThisWave >= gameState.mobsPerWave;
  const allKilled = Object.keys(gameState.mobs).length === 0;

  if (allSpawned && allKilled) {
    matchConfig.currentWave++;
    gameState.wave = matchConfig.currentWave;

    if (matchConfig.currentWave > matchConfig.maxWaves) {
      matchConfig.state = "VICTORY";
      if (spawnIntervalId) {
        clearInterval(spawnIntervalId);
        spawnIntervalId = null;
      }
      emitGameStateChange();
      return;
    }

    const numPlayers = Object.keys(players).length;
    const waveStats = getWaveStats(gameState.wave, numPlayers);

    gameState.mobsSpawnedThisWave = 0;
    gameState.mobsPerWave = waveStats.mobsPerWave;
    gameState.currentMobHP = waveStats.mobHP;
    gameState.playersAtWaveStart = numPlayers;

    startSpawner();
    io.emit("waveComplete", { wave: gameState.wave });
    io.emit("waveStats", {
      wave: gameState.wave,
      mobHP: waveStats.mobHP,
      totalMobs: waveStats.mobsPerWave,
      numPlayers: numPlayers,
    });
    emitGameStateChange();
  }
}

function emitGameStateChange() {
  const totalGold = Object.values(players).reduce((sum, p) => sum + p.gold, 0);
  io.emit("gameStateChanged", {
    state: matchConfig.state,
    currentWave: matchConfig.currentWave,
    maxWaves: matchConfig.maxWaves,
    totalGold,
    players: Object.values(players).map((p) => ({
      id: p.id,
      ready: p.ready,
      gold: p.gold,
      kills: p.kills,
      level: p.level,
    })),
  });
}

function startGame() {
  matchConfig.state = "PLAYING";
  matchConfig.currentWave = 1;
  gameState.wave = 1;
  gameState.coreHP = 100;
  gameState.mobs = {};
  gameState.gameOver = false;
  gameState.mobsSpawnedThisWave = 0;
  mobIdCounter = 0;

  const numPlayers = Object.keys(players).length;
  const waveStats = getWaveStats(1, numPlayers);

  gameState.mobsPerWave = waveStats.mobsPerWave;
  gameState.currentMobHP = waveStats.mobHP;
  gameState.playersAtWaveStart = numPlayers;

  startSpawner();
  emitGameStateChange();

  io.emit("waveStats", {
    wave: 1,
    mobHP: waveStats.mobHP,
    totalMobs: waveStats.mobsPerWave,
    numPlayers: numPlayers,
  });
}

function resetGame() {
  matchConfig.state = "LOBBY";
  matchConfig.currentWave = 0;
  gameState.coreHP = 100;
  gameState.wave = 1;
  gameState.mobs = {};
  gameState.gameOver = false;
  gameState.mobsSpawnedThisWave = 0;
  gameState.mobsPerWave = 5;
  gameState.currentMobHP = 30;
  gameState.playersAtWaveStart = 1;
  mobIdCounter = 0;

  if (spawnIntervalId) {
    clearInterval(spawnIntervalId);
    spawnIntervalId = null;
  }

  for (const id in players) {
    players[id].gold = 0;
    players[id].kills = 0;
    players[id].level = 1;
    players[id].fireRate = 500;
    players[id].ready = false;

    const spawnRadius = 100;
    const angle = Math.random() * Math.PI * 2;
    players[id].x = CORE_X + Math.cos(angle) * spawnRadius;
    players[id].y = CORE_Y + Math.sin(angle) * spawnRadius;
  }

  emitGameStateChange();

  io.emit("gameReset", {
    players,
    gameState: {
      coreHP: gameState.coreHP,
      wave: gameState.wave,
      mobs: gameState.mobs,
    },
  });
}

setInterval(() => {
  if (matchConfig.state === "PLAYING") {
    updateMobs();
    checkWaveComplete();
  }
}, 1000 / 60);

setInterval(() => {
  io.emit("gameStateUpdate", {
    coreHP: gameState.coreHP,
    wave: gameState.wave,
    mobs: gameState.mobs,
    gameOver: gameState.gameOver,
    matchState: matchConfig.state,
    currentWave: matchConfig.currentWave,
    maxWaves: matchConfig.maxWaves,
  });
}, 50);

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnRadius = 100;
  const angle = Math.random() * Math.PI * 2;
  players[socket.id] = {
    id: socket.id,
    x: CORE_X + Math.cos(angle) * spawnRadius,
    y: CORE_Y + Math.sin(angle) * spawnRadius,
    gold: 0,
    kills: 0,
    level: 1,
    fireRate: 500,
    ready: false,
  };

  socket.emit("currentPlayers", {
    players,
    myId: socket.id,
    matchConfig: {
      state: matchConfig.state,
      currentWave: matchConfig.currentWave,
      maxWaves: matchConfig.maxWaves,
    },
    gameState: {
      coreHP: gameState.coreHP,
      wave: gameState.wave,
      mobs: gameState.mobs,
    },
  });
  socket.broadcast.emit("newPlayer", players[socket.id]);
  emitGameStateChange();

  socket.on("toggleReady", () => {
    const player = players[socket.id];
    if (!player) return;
    if (matchConfig.state !== "LOBBY") return;

    player.ready = !player.ready;
    emitGameStateChange();

    const allPlayers = Object.values(players);
    if (allPlayers.length > 0 && allPlayers.every((p) => p.ready)) {
      startGame();
    }
  });

  socket.on("input", (input) => {
    const player = players[socket.id];
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
      io.emit("playerMoved", player);
    }
  });

  socket.on("shootArrow", (data) => {
    const player = players[socket.id];
    if (!player) return;

    socket.broadcast.emit("arrowFired", {
      playerId: socket.id,
      startX: player.x,
      startY: player.y,
      targetX: data.targetX,
      targetY: data.targetY,
    });
  });

  socket.on("arrowHit", (data) => {
    const mob = gameState.mobs[data.mobId];
    if (!mob) return;

    mob.hp -= ARROW_DAMAGE;
    mob.lastHitBy = socket.id;

    if (mob.hp <= 0) {
      const mobPosition = { x: mob.x, y: mob.y };
      delete gameState.mobs[data.mobId];

      const killer = players[mob.lastHitBy];
      if (killer) {
        killer.gold += GOLD_REWARD;
        killer.kills += 1;

        if (killer.kills % KILLS_TO_LEVEL === 0) {
          killer.level += 1;
          killer.fireRate = Math.max(500, killer.fireRate - 50);
        }

        io.emit("playerUpdate", {
          id: killer.id,
          gold: killer.gold,
          kills: killer.kills,
          level: killer.level,
          fireRate: killer.fireRate,
        });
      }

      io.emit("mobKilled", {
        mobId: data.mobId,
        by: mob.lastHitBy,
        position: mobPosition,
      });
    }
  });

  socket.on("resetGame", () => {
    resetGame();
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Tower Defense running on http://localhost:${PORT}`);
});
