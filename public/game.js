const socket = io();

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
const GRID_SIZE = 50;
const PLAYER_SIZE = 32;

let myId = null;
const players = {};
let pendingPlayers = null;
let sceneReady = false;
let gameScene = null;

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.cursors = null;
    this.wasd = null;
    this.myPlayer = null;
    this.otherPlayers = null;
  }

  preload() {
    this.load.spritesheet("dude", "assets/dude.png", {
      frameWidth: 32,
      frameHeight: 48,
    });
  }

  create() {
    gameScene = this;

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawGrid();
    this.drawWorldBounds();

    this.otherPlayers = this.physics.add.group();

    this.createAnimations();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    this.createUI();

    sceneReady = true;

    if (pendingPlayers) {
      myId = pendingPlayers.myId;
      for (const id in pendingPlayers.players) {
        this.addPlayer(pendingPlayers.players[id]);
      }
      pendingPlayers = null;
    }
  }

  createAnimations() {
    this.anims.create({
      key: "left",
      frames: this.anims.generateFrameNumbers("dude", { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });

    this.anims.create({
      key: "right",
      frames: this.anims.generateFrameNumbers("dude", { start: 5, end: 8 }),
      frameRate: 10,
      repeat: -1,
    });

    this.anims.create({
      key: "idle",
      frames: [{ key: "dude", frame: 4 }],
      frameRate: 20,
    });

    this.anims.create({
      key: "up",
      frames: this.anims.generateFrameNumbers("dude", { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });

    this.anims.create({
      key: "down",
      frames: this.anims.generateFrameNumbers("dude", { start: 5, end: 8 }),
      frameRate: 10,
      repeat: -1,
    });
  }

  drawGrid() {
    const graphics = this.add.graphics();

    graphics.lineStyle(1, 0xe94560, 0.15);
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
      graphics.moveTo(0, y);
      graphics.lineTo(WORLD_WIDTH, y);
    }
    graphics.strokePath();

    const majorGrid = GRID_SIZE * 4;
    graphics.lineStyle(2, 0xe94560, 0.4);
    for (let x = 0; x <= WORLD_WIDTH; x += majorGrid) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += majorGrid) {
      graphics.moveTo(0, y);
      graphics.lineTo(WORLD_HEIGHT, y);
    }
    graphics.strokePath();
  }

  drawWorldBounds() {
    const graphics = this.add.graphics();
    graphics.lineStyle(4, 0xe94560, 1);
    graphics.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  addPlayer(playerInfo) {
    if (players[playerInfo.id]) return;

    const sprite = this.physics.add.sprite(playerInfo.x, playerInfo.y, "dude");
    sprite.setCollideWorldBounds(true);
    sprite.playerId = playerInfo.id;
    sprite.anims.play("idle", true);

    const isMe = playerInfo.id === myId;

    if (isMe) {
      this.myPlayer = sprite;
      this.cameras.main.startFollow(sprite, true, 0.1, 0.1);
    } else {
      this.otherPlayers.add(sprite);
    }

    players[playerInfo.id] = sprite;
  }

  createUI() {
    this.playerCountText = this.add
      .text(15, 15, "Jugadores: 0", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.posText = this.add
      .text(15, 35, "Pos: 0, 0", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.createMinimap();
  }

  createMinimap() {
    const mapSize = 120;
    const mapX = 800 - mapSize - 15;
    const mapY = 15;

    this.minimapBg = this.add.graphics();
    this.minimapBg.fillStyle(0x0a0a14, 0.8);
    this.minimapBg.fillRect(mapX, mapY, mapSize, mapSize);
    this.minimapBg.lineStyle(1, 0xe94560, 0.5);
    this.minimapBg.strokeRect(mapX, mapY, mapSize, mapSize);
    this.minimapBg.setScrollFactor(0).setDepth(100);

    this.minimapDots = this.add.graphics();
    this.minimapDots.setScrollFactor(0).setDepth(101);

    this.minimapView = this.add.graphics();
    this.minimapView.setScrollFactor(0).setDepth(101);
  }

  updateMinimap() {
    const mapSize = 120;
    const mapX = 800 - mapSize - 15;
    const mapY = 15;
    const scale = mapSize / WORLD_WIDTH;

    this.minimapDots.clear();
    for (const id in players) {
      const sprite = players[id];
      if (!sprite.active) continue;
      const px = mapX + sprite.x * scale;
      const py = mapY + sprite.y * scale;
      const color = id === myId ? 0xffffff : 0xe94560;
      this.minimapDots.fillStyle(color, 1);
      this.minimapDots.fillCircle(px, py, id === myId ? 3 : 2);
    }

    this.minimapView.clear();
    const cam = this.cameras.main;
    const viewX = mapX + cam.scrollX * scale;
    const viewY = mapY + cam.scrollY * scale;
    const viewW = cam.width * scale;
    const viewH = cam.height * scale;
    this.minimapView.lineStyle(1, 0xffffff, 0.5);
    this.minimapView.strokeRect(viewX, viewY, viewW, viewH);
  }

  update() {
    if (!this.myPlayer) return;

    const input = {
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
    };

    if (input.up || input.down || input.left || input.right) {
      socket.emit("input", input);
    }

    this.playerCountText.setText(`Jugadores: ${Object.keys(players).length}`);
    this.posText.setText(
      `Pos: ${Math.round(this.myPlayer.x)}, ${Math.round(this.myPlayer.y)}`
    );

    this.updateMinimap();
  }
}

socket.on("currentPlayers", (data) => {
  if (sceneReady && gameScene) {
    myId = data.myId;
    for (const id in data.players) {
      gameScene.addPlayer(data.players[id]);
    }
  } else {
    pendingPlayers = data;
  }
});

socket.on("newPlayer", (playerInfo) => {
  if (sceneReady && gameScene) {
    gameScene.addPlayer(playerInfo);
  }
});

socket.on("playerMoved", (playerInfo) => {
  const sprite = players[playerInfo.id];
  if (!sprite) return;

  const dx = playerInfo.x - sprite.x;
  const dy = playerInfo.y - sprite.y;

  sprite.setPosition(playerInfo.x, playerInfo.y);

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) {
      sprite.anims.play("left", true);
    } else if (dx > 0) {
      sprite.anims.play("right", true);
    }
  } else if (dy !== 0) {
    if (dy < 0) {
      sprite.anims.play("up", true);
    } else {
      sprite.anims.play("down", true);
    }
  }

  if (dx === 0 && dy === 0) {
    sprite.anims.play("idle", true);
  }
});

socket.on("playerDisconnected", (id) => {
  if (players[id]) {
    players[id].destroy();
    delete players[id];
  }
});

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#2d2d2d",
  parent: document.body,
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: MainScene,
};

new Phaser.Game(config);
