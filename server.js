const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));

const players = {};
const SPEED = 5;
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
const PLAYER_SIZE = 32;

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    x: Math.random() * (WORLD_WIDTH - PLAYER_SIZE) + PLAYER_SIZE / 2,
    y: Math.random() * (WORLD_HEIGHT - PLAYER_SIZE) + PLAYER_SIZE / 2,
  };

  socket.emit("currentPlayers", { players, myId: socket.id });
  socket.broadcast.emit("newPlayer", players[socket.id]);

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

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit("playerDisconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
