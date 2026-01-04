const socket = io();

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const PLAYER_SIZE = 32;
const CORE_X = 400;
const CORE_Y = 300;
const ARROW_RANGE = 250;
const ARROW_SPEED = 8;

let myId = null;
const players = {};
const mobSprites = {};
let pendingPlayers = null;
let sceneReady = false;
let gameScene = null;
let lastShootTime = 0;

let playerGold = 0;
let playerLevel = 1;
let playerKills = 0;
let playerFireRate = 500;
let playerDamage = 10;
let playerDamageUpgrades = 0;

let matchState = "ROOM_SELECT";
let maxWaves = 3;
let currentWave = 0;
let totalTeamGold = 0;
let lobbyPlayers = [];
let pendingNewPlayers = [];
let currentRoomName = null;
let joinedRoom = false;

const UPGRADE_BASE_COST = 20;

function getUpgradeCost(upgradeCount) {
  return Math.floor(UPGRADE_BASE_COST * Math.pow(1.2, upgradeCount));
}

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.cursors = null;
    this.wasd = null;
    this.myPlayer = null;
    this.otherPlayers = null;
    this.activeArrows = [];
    this.coreHP = 100;
    this.wave = 1;
    this.cooldownGraphics = null;
  }

  preload() {
    this.load.spritesheet("dude", "assets/dude.png", {
      frameWidth: 32,
      frameHeight: 48,
    });
  }

  create() {
    gameScene = this;

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawBackground();
    this.drawCore();

    this.otherPlayers = this.physics.add.group();
    this.mobGroup = this.add.group();

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
    this.gameplayEnabled = false;

    if (pendingPlayers) {
      myId = pendingPlayers.myId;
      for (const id in pendingPlayers.players) {
        this.addPlayer(pendingPlayers.players[id]);
        if (id === myId) {
          const p = pendingPlayers.players[id];
          playerGold = p.gold || 0;
          playerLevel = p.level || 1;
          playerKills = p.kills || 0;
          playerFireRate = p.fireRate || 500;
        }
      }
      if (pendingPlayers.matchConfig) {
        matchState = pendingPlayers.matchConfig.state;
        maxWaves = pendingPlayers.matchConfig.maxWaves;
        currentWave = pendingPlayers.matchConfig.currentWave;

        if (matchState === "LOBBY") {
          this.showLobby();
        } else if (matchState === "PLAYING") {
          this.showPlaying();
        } else if (matchState === "SHOP") {
          this.showShop();
        } else if (matchState === "VICTORY") {
          this.showVictory(maxWaves, totalTeamGold);
        }
      } else {
        this.showLobby();
      }
      if (pendingPlayers.gameState) {
        this.coreHP = pendingPlayers.gameState.coreHP;
        this.wave = pendingPlayers.gameState.wave;
        this.syncMobs(pendingPlayers.gameState.mobs);
      }
      pendingPlayers = null;
    } else {
      if (!joinedRoom) {
        this.showRoomSelect();
      } else {
        this.showLobby();
      }
    }

    if (pendingNewPlayers.length > 0) {
      for (const playerInfo of pendingNewPlayers) {
        this.addPlayer(playerInfo);
      }
      pendingNewPlayers = [];
    }
  }

  drawBackground() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x1a1a2e, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    graphics.lineStyle(1, 0x2a2a4e, 0.3);
    for (let x = 0; x <= WORLD_WIDTH; x += 40) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 40) {
      graphics.moveTo(0, y);
      graphics.lineTo(WORLD_WIDTH, y);
    }
    graphics.strokePath();
  }

  drawCore() {
    this.coreGraphics = this.add.graphics();
    this.coreGraphics.fillStyle(0x4ecdc4, 1);
    this.coreGraphics.fillCircle(CORE_X, CORE_Y, 40);
    this.coreGraphics.lineStyle(4, 0x45b7aa, 1);
    this.coreGraphics.strokeCircle(CORE_X, CORE_Y, 40);

    this.coreGraphics.fillStyle(0x96f2ee, 1);
    this.coreGraphics.fillCircle(CORE_X, CORE_Y, 20);

    this.add
      .text(CORE_X, CORE_Y - 60, "TORRE", {
        fontFamily: "Arial Black",
        fontSize: "16px",
        color: "#4ecdc4",
      })
      .setOrigin(0.5);
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

  addPlayer(playerInfo) {
    if (players[playerInfo.id]) return;

    const sprite = this.physics.add.sprite(playerInfo.x, playerInfo.y, "dude");
    sprite.setCollideWorldBounds(true);
    sprite.playerId = playerInfo.id;
    sprite.anims.play("idle", true);
    sprite.setDepth(10);

    const isMe = playerInfo.id === myId;

    if (isMe) {
      this.myPlayer = sprite;
    } else {
      this.otherPlayers.add(sprite);
    }

    players[playerInfo.id] = sprite;
  }

  createUI() {
    this.coreHPText = this.add
      .text(15, 15, "Torre HP: 100", {
        fontFamily: "Arial Black",
        fontSize: "18px",
        color: "#4ecdc4",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setDepth(100);

    this.waveText = this.add
      .text(15, 40, "Oleada: 1", {
        fontFamily: "Arial Black",
        fontSize: "18px",
        color: "#f39c12",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setDepth(100);

    this.statsText = this.add
      .text(WORLD_WIDTH - 15, 15, "Oro: 0 | Nivel: 1 | Kills: 0", {
        fontFamily: "Arial Black",
        fontSize: "16px",
        color: "#f1c40f",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setDepth(100);

    this.cooldownGraphics = this.add.graphics();
    this.cooldownGraphics.setDepth(100);

    this.playerCountText = this.add
      .text(15, 65, "Jugadores: 0", {
        fontFamily: "Arial",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setDepth(100);

    this.resetButton = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 30, "[ REINICIAR PARTIDA ]", {
        fontFamily: "Arial Black",
        fontSize: "16px",
        color: "#e74c3c",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.resetButton.setColor("#ff6b6b"))
      .on("pointerout", () => this.resetButton.setColor("#e74c3c"))
      .on("pointerdown", () => {
        socket.emit("resetGame");
      });

    this.gameOverText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "", {
        fontFamily: "Arial Black",
        fontSize: "48px",
        color: "#e74c3c",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(200)
      .setVisible(false);

    this.createRoomSelectUI();
    this.createLobbyUI();
    this.createShopUI();
    this.createVictoryUI();
  }

  createRoomSelectUI() {
    this.roomSelectContainer = this.add.container(0, 0).setDepth(600);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a15, 1);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.roomSelectContainer.add(bg);

    const titleText = this.add
      .text(WORLD_WIDTH / 2, 100, "TOWER DEFENSE", {
        fontFamily: "Arial Black",
        fontSize: "56px",
        color: "#4ecdc4",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.roomSelectContainer.add(titleText);

    const subtitleText = this.add
      .text(WORLD_WIDTH / 2, 160, "Cooperativo Multijugador", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#888",
      })
      .setOrigin(0.5);
    this.roomSelectContainer.add(subtitleText);

    const labelText = this.add
      .text(WORLD_WIDTH / 2, 260, "Nombre de la Sala:", {
        fontFamily: "Arial",
        fontSize: "18px",
        color: "#fff",
      })
      .setOrigin(0.5);
    this.roomSelectContainer.add(labelText);

    const inputBg = this.add.graphics();
    inputBg.fillStyle(0x1a1a2e, 1);
    inputBg.lineStyle(2, 0x4ecdc4, 1);
    inputBg.fillRoundedRect(WORLD_WIDTH / 2 - 150, 290, 300, 50, 8);
    inputBg.strokeRoundedRect(WORLD_WIDTH / 2 - 150, 290, 300, 50, 8);
    this.roomSelectContainer.add(inputBg);

    this.roomInputText = this.add
      .text(WORLD_WIDTH / 2, 315, "default", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#4ecdc4",
      })
      .setOrigin(0.5);
    this.roomSelectContainer.add(this.roomInputText);

    this.roomInputValue = "default";

    const inputZone = this.add
      .zone(WORLD_WIDTH / 2, 315, 300, 50)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        const newName = prompt(
          "Ingresa el nombre de la sala:",
          this.roomInputValue
        );
        if (newName && newName.trim()) {
          this.roomInputValue = newName.trim();
          this.roomInputText.setText(this.roomInputValue);
        }
      });
    this.roomSelectContainer.add(inputZone);

    const joinButtonBg = this.add.graphics();
    joinButtonBg.fillStyle(0x27ae60, 1);
    joinButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 100, 380, 200, 60, 10);
    this.roomSelectContainer.add(joinButtonBg);

    const joinButtonText = this.add
      .text(WORLD_WIDTH / 2, 410, "UNIRSE", {
        fontFamily: "Arial Black",
        fontSize: "24px",
        color: "#fff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        joinButtonBg.clear();
        joinButtonBg.fillStyle(0x2ecc71, 1);
        joinButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 100, 380, 200, 60, 10);
      })
      .on("pointerout", () => {
        joinButtonBg.clear();
        joinButtonBg.fillStyle(0x27ae60, 1);
        joinButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 100, 380, 200, 60, 10);
      })
      .on("pointerdown", () => {
        socket.emit("joinRoom", { roomName: this.roomInputValue });
      });
    this.roomSelectContainer.add(joinButtonText);

    const infoText = this.add
      .text(
        WORLD_WIDTH / 2,
        500,
        "Escribe el mismo nombre que tus amigos para jugar juntos",
        {
          fontFamily: "Arial",
          fontSize: "14px",
          color: "#666",
        }
      )
      .setOrigin(0.5);
    this.roomSelectContainer.add(infoText);
  }

  createLobbyUI() {
    this.lobbyContainer = this.add.container(0, 0).setDepth(500);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a15, 0.95);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.lobbyContainer.add(bg);

    const titleText = this.add
      .text(WORLD_WIDTH / 2, 80, "TOWER DEFENSE", {
        fontFamily: "Arial Black",
        fontSize: "48px",
        color: "#4ecdc4",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.lobbyContainer.add(titleText);

    const subtitleText = this.add
      .text(WORLD_WIDTH / 2, 130, "Lobby - Esperando jugadores...", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#888",
      })
      .setOrigin(0.5);
    this.lobbyContainer.add(subtitleText);

    this.lobbyPlayersText = this.add
      .text(WORLD_WIDTH / 2, 250, "", {
        fontFamily: "Arial",
        fontSize: "18px",
        color: "#fff",
        align: "center",
        lineSpacing: 10,
      })
      .setOrigin(0.5, 0);
    this.lobbyContainer.add(this.lobbyPlayersText);

    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x27ae60, 1);
    buttonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 450, 240, 60, 10);
    this.lobbyContainer.add(buttonBg);

    this.readyButtonText = this.add
      .text(WORLD_WIDTH / 2, 480, "ESTOY LISTO", {
        fontFamily: "Arial Black",
        fontSize: "24px",
        color: "#fff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        buttonBg.clear();
        buttonBg.fillStyle(0x2ecc71, 1);
        buttonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 450, 240, 60, 10);
      })
      .on("pointerout", () => {
        buttonBg.clear();
        buttonBg.fillStyle(0x27ae60, 1);
        buttonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 450, 240, 60, 10);
      })
      .on("pointerdown", () => {
        socket.emit("toggleReady");
      });
    this.lobbyContainer.add(this.readyButtonText);

    const infoText = this.add
      .text(WORLD_WIDTH / 2, 540, "Sobrevive a " + maxWaves + " oleadas", {
        fontFamily: "Arial",
        fontSize: "16px",
        color: "#666",
      })
      .setOrigin(0.5);
    this.lobbyContainer.add(infoText);
    this.lobbyInfoText = infoText;
  }

  createShopUI() {
    this.shopContainer = this.add
      .container(0, 0)
      .setDepth(500)
      .setVisible(false);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a15, 0.95);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.shopContainer.add(bg);

    const titleText = this.add
      .text(WORLD_WIDTH / 2, 60, "TIENDA ABIERTA", {
        fontFamily: "Arial Black",
        fontSize: "42px",
        color: "#f1c40f",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.shopContainer.add(titleText);

    const waveCompleteText = this.add
      .text(
        WORLD_WIDTH / 2,
        110,
        "Oleada completada - Prepárate para la siguiente",
        {
          fontFamily: "Arial",
          fontSize: "18px",
          color: "#888",
        }
      )
      .setOrigin(0.5);
    this.shopContainer.add(waveCompleteText);

    this.shopGoldText = this.add
      .text(WORLD_WIDTH / 2, 170, "Oro: 0", {
        fontFamily: "Arial Black",
        fontSize: "28px",
        color: "#f1c40f",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    this.shopContainer.add(this.shopGoldText);

    this.shopDamageText = this.add
      .text(WORLD_WIDTH / 2, 210, "Daño actual: 10", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#e74c3c",
      })
      .setOrigin(0.5);
    this.shopContainer.add(this.shopDamageText);

    this.damageButtonBg = this.add.graphics();
    this.damageButtonBg.fillStyle(0xe74c3c, 1);
    this.damageButtonBg.fillRoundedRect(
      WORLD_WIDTH / 2 - 180,
      270,
      360,
      70,
      10
    );
    this.shopContainer.add(this.damageButtonBg);

    this.damageButtonText = this.add
      .text(
        WORLD_WIDTH / 2,
        305,
        "Mejorar Daño (+4) - Costo: " +
          getUpgradeCost(playerDamageUpgrades) +
          " Oro",
        {
          fontFamily: "Arial Black",
          fontSize: "18px",
          color: "#fff",
        }
      )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        this.damageButtonBg.clear();
        this.damageButtonBg.fillStyle(0xc0392b, 1);
        this.damageButtonBg.fillRoundedRect(
          WORLD_WIDTH / 2 - 180,
          270,
          360,
          70,
          10
        );
      })
      .on("pointerout", () => {
        this.damageButtonBg.clear();
        this.damageButtonBg.fillStyle(0xe74c3c, 1);
        this.damageButtonBg.fillRoundedRect(
          WORLD_WIDTH / 2 - 180,
          270,
          360,
          70,
          10
        );
      })
      .on("pointerdown", () => {
        socket.emit("buyUpgrade", { type: "damage" });
      });
    this.shopContainer.add(this.damageButtonText);

    this.shopPlayersText = this.add
      .text(WORLD_WIDTH / 2, 400, "", {
        fontFamily: "Arial",
        fontSize: "16px",
        color: "#fff",
        align: "center",
      })
      .setOrigin(0.5);
    this.shopContainer.add(this.shopPlayersText);

    const readyButtonBg = this.add.graphics();
    readyButtonBg.fillStyle(0x27ae60, 1);
    readyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 160, 480, 320, 60, 10);
    this.shopContainer.add(readyButtonBg);

    const readyButtonText = this.add
      .text(WORLD_WIDTH / 2, 510, "LISTO PARA SIGUIENTE OLEADA", {
        fontFamily: "Arial Black",
        fontSize: "18px",
        color: "#fff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        readyButtonBg.clear();
        readyButtonBg.fillStyle(0x2ecc71, 1);
        readyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 160, 480, 320, 60, 10);
      })
      .on("pointerout", () => {
        readyButtonBg.clear();
        readyButtonBg.fillStyle(0x27ae60, 1);
        readyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 160, 480, 320, 60, 10);
      })
      .on("pointerdown", () => {
        socket.emit("shopReady");
      });
    this.shopContainer.add(readyButtonText);
  }

  createVictoryUI() {
    this.victoryContainer = this.add
      .container(0, 0)
      .setDepth(500)
      .setVisible(false);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a150a, 0.95);
    bg.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.victoryContainer.add(bg);

    const titleText = this.add
      .text(WORLD_WIDTH / 2, 120, "¡FELICIDADES!", {
        fontFamily: "Arial Black",
        fontSize: "56px",
        color: "#2ecc71",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.victoryContainer.add(titleText);

    this.victorySurviveText = this.add
      .text(WORLD_WIDTH / 2, 200, "", {
        fontFamily: "Arial",
        fontSize: "24px",
        color: "#fff",
      })
      .setOrigin(0.5);
    this.victoryContainer.add(this.victorySurviveText);

    this.victoryGoldText = this.add
      .text(WORLD_WIDTH / 2, 280, "", {
        fontFamily: "Arial Black",
        fontSize: "32px",
        color: "#f1c40f",
        stroke: "#000",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    this.victoryContainer.add(this.victoryGoldText);

    const lobbyButtonBg = this.add.graphics();
    lobbyButtonBg.fillStyle(0x3498db, 1);
    lobbyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 380, 240, 60, 10);
    this.victoryContainer.add(lobbyButtonBg);

    const lobbyButtonText = this.add
      .text(WORLD_WIDTH / 2, 410, "VOLVER AL LOBBY", {
        fontFamily: "Arial Black",
        fontSize: "20px",
        color: "#fff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        lobbyButtonBg.clear();
        lobbyButtonBg.fillStyle(0x5dade2, 1);
        lobbyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 380, 240, 60, 10);
      })
      .on("pointerout", () => {
        lobbyButtonBg.clear();
        lobbyButtonBg.fillStyle(0x3498db, 1);
        lobbyButtonBg.fillRoundedRect(WORLD_WIDTH / 2 - 120, 380, 240, 60, 10);
      })
      .on("pointerdown", () => {
        socket.emit("resetGame");
      });
    this.victoryContainer.add(lobbyButtonText);
  }

  updateLobbyPlayers() {
    let text = "";
    for (const p of lobbyPlayers) {
      const status = p.ready ? "✓ LISTO" : "Esperando...";
      const color = p.ready ? "#2ecc71" : "#888";
      const isMe = p.id === myId ? " (Tú)" : "";
      text += `Jugador ${p.id.substring(0, 6)}${isMe}\n${status}\n\n`;
    }
    this.lobbyPlayersText.setText(text);
  }

  setGameplayEnabled(enabled) {
    this.gameplayEnabled = enabled;

    if (this.coreHPText) this.coreHPText.setVisible(enabled);
    if (this.waveText) this.waveText.setVisible(enabled);
    if (this.statsText) this.statsText.setVisible(enabled);
    if (this.cooldownGraphics) this.cooldownGraphics.setVisible(enabled);
    if (this.playerCountText) this.playerCountText.setVisible(enabled);
    if (this.resetButton) this.resetButton.setVisible(enabled);
  }

  showRoomSelect() {
    matchState = "ROOM_SELECT";
    this.roomSelectContainer.setVisible(true);
    this.lobbyContainer.setVisible(false);
    this.shopContainer.setVisible(false);
    this.victoryContainer.setVisible(false);
    this.setGameplayEnabled(false);
  }

  showLobby() {
    matchState = "LOBBY";
    this.roomSelectContainer.setVisible(false);
    this.lobbyContainer.setVisible(true);
    this.shopContainer.setVisible(false);
    this.victoryContainer.setVisible(false);
    this.setGameplayEnabled(false);
  }

  showPlaying() {
    matchState = "PLAYING";
    this.roomSelectContainer.setVisible(false);
    this.lobbyContainer.setVisible(false);
    this.shopContainer.setVisible(false);
    this.victoryContainer.setVisible(false);
    this.setGameplayEnabled(true);
  }

  showShop() {
    matchState = "SHOP";
    this.roomSelectContainer.setVisible(false);
    this.lobbyContainer.setVisible(false);
    this.shopContainer.setVisible(true);
    this.victoryContainer.setVisible(false);
    this.setGameplayEnabled(false);
    this.updateShopUI();
  }

  showVictory(waves, gold) {
    matchState = "VICTORY";
    this.roomSelectContainer.setVisible(false);
    this.lobbyContainer.setVisible(false);
    this.shopContainer.setVisible(false);
    this.victoryContainer.setVisible(true);
    this.setGameplayEnabled(false);

    this.victorySurviveText.setText(`Sobrevivieron a ${waves} oleadas`);
    this.victoryGoldText.setText(`Oro total del equipo: ${gold}`);
  }

  updateShopUI() {
    const upgradeCost = Math.floor(100 * Math.pow(1.5, playerDamageUpgrades));
    this.shopGoldText.setText(`Oro: ${playerGold}`);
    this.shopDamageText.setText(`Daño actual: ${playerDamage}`);
    this.damageButtonText.setText(
      `Mejorar Daño (+4) - Costo: ${upgradeCost} Oro`
    );

    let playersText = "";
    for (const p of lobbyPlayers) {
      const status = p.shopReady ? "✓ LISTO" : "Comprando...";
      const isMe = p.id === myId ? " (Tú)" : "";
      playersText += `${p.id.substring(0, 6)}${isMe}: ${status}  `;
    }
    this.shopPlayersText.setText(playersText);
  }

  updateCooldownUI(time) {
    this.cooldownGraphics.clear();

    const elapsed = time - lastShootTime;
    const progress = Math.min(1, elapsed / playerFireRate);

    const barX = WORLD_WIDTH - 150;
    const barY = 45;
    const barWidth = 135;
    const barHeight = 8;

    this.cooldownGraphics.fillStyle(0x333333, 0.8);
    this.cooldownGraphics.fillRect(barX, barY, barWidth, barHeight);

    const color = progress >= 1 ? 0x2ecc71 : 0x3498db;
    this.cooldownGraphics.fillStyle(color, 1);
    this.cooldownGraphics.fillRect(barX, barY, barWidth * progress, barHeight);

    this.cooldownGraphics.lineStyle(1, 0xffffff, 0.5);
    this.cooldownGraphics.strokeRect(barX, barY, barWidth, barHeight);
  }

  showFloatingText(x, y, text, color = "#f1c40f") {
    const floatingText = this.add
      .text(x, y, text, {
        fontFamily: "Arial Black",
        fontSize: "18px",
        color: color,
        stroke: "#000",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(150);

    this.tweens.add({
      targets: floatingText,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      ease: "Power2",
      onComplete: () => floatingText.destroy(),
    });
  }

  showWaveAnnouncement(wave, mobHP, totalMobs, numPlayers) {
    const waveTitle = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 40, `OLEADA ${wave}`, {
        fontFamily: "Arial Black",
        fontSize: "48px",
        color: "#f39c12",
        stroke: "#000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(300)
      .setAlpha(0);

    const waveDetails = this.add
      .text(
        WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 + 20,
        `${totalMobs} enemigos | HP: ${mobHP} | ${numPlayers} jugadores`,
        {
          fontFamily: "Arial",
          fontSize: "18px",
          color: "#fff",
          stroke: "#000",
          strokeThickness: 2,
        }
      )
      .setOrigin(0.5)
      .setDepth(300)
      .setAlpha(0);

    this.tweens.add({
      targets: [waveTitle, waveDetails],
      alpha: 1,
      duration: 300,
      ease: "Power2",
      onComplete: () => {
        this.time.delayedCall(2000, () => {
          this.tweens.add({
            targets: [waveTitle, waveDetails],
            alpha: 0,
            y: "-=30",
            duration: 500,
            ease: "Power2",
            onComplete: () => {
              waveTitle.destroy();
              waveDetails.destroy();
            },
          });
        });
      },
    });
  }

  syncMobs(serverMobs) {
    for (const id in serverMobs) {
      const mobData = serverMobs[id];

      if (!mobSprites[id]) {
        const graphics = this.add.graphics();
        graphics.fillStyle(0xe74c3c, 1);
        graphics.fillCircle(0, 0, 15);
        graphics.lineStyle(2, 0xc0392b, 1);
        graphics.strokeCircle(0, 0, 15);

        const container = this.add.container(mobData.x, mobData.y, [graphics]);
        container.mobId = id;
        container.setDepth(5);

        const hpBar = this.add.graphics();
        hpBar.setPosition(-15, -25);
        container.add(hpBar);
        container.hpBar = hpBar;

        this.mobGroup.add(container);
        mobSprites[id] = container;
      }

      const sprite = mobSprites[id];
      sprite.x = mobData.x;
      sprite.y = mobData.y;

      sprite.hpBar.clear();
      sprite.hpBar.fillStyle(0x333333, 1);
      sprite.hpBar.fillRect(0, 0, 30, 4);

      const hpPercent = mobData.hp / mobData.maxHp;
      const hpColor = hpPercent < 0.3 ? 0xe74c3c : 0x2ecc71;
      sprite.hpBar.fillStyle(hpColor, 1);
      sprite.hpBar.fillRect(0, 0, 30 * hpPercent, 4);
    }

    for (const id in mobSprites) {
      if (!serverMobs[id]) {
        mobSprites[id].destroy();
        delete mobSprites[id];
      }
    }
  }

  findMobClosestToCore() {
    if (!this.myPlayer) return null;

    let bestMob = null;
    let minDistToCore = Infinity;

    for (const id in mobSprites) {
      const mob = mobSprites[id];

      const distToPlayer = Phaser.Math.Distance.Between(
        this.myPlayer.x,
        this.myPlayer.y,
        mob.x,
        mob.y
      );

      if (distToPlayer > ARROW_RANGE) continue;

      const distToCore = Phaser.Math.Distance.Between(
        mob.x,
        mob.y,
        CORE_X,
        CORE_Y
      );

      if (distToCore < minDistToCore) {
        minDistToCore = distToCore;
        bestMob = mob;
      }
    }

    return bestMob;
  }

  shootArrow(target, isLocal = true) {
    if (!this.myPlayer && isLocal) return;

    const startX = isLocal ? this.myPlayer.x : target.startX;
    const startY = isLocal ? this.myPlayer.y : target.startY;
    const targetX = target.x || target.targetX;
    const targetY = target.y || target.targetY;

    const angle = Phaser.Math.Angle.Between(startX, startY, targetX, targetY);

    const arrow = this.add.graphics();
    arrow.fillStyle(0xf1c40f, 1);
    arrow.fillRect(-10, -2, 20, 4);
    arrow.fillStyle(0xe67e22, 1);
    arrow.beginPath();
    arrow.moveTo(10, -4);
    arrow.lineTo(16, 0);
    arrow.lineTo(10, 4);
    arrow.closePath();
    arrow.fillPath();

    arrow.x = startX;
    arrow.y = startY;
    arrow.rotation = angle;
    arrow.setDepth(15);
    arrow.targetMobId = target.mobId;
    arrow.vx = Math.cos(angle) * ARROW_SPEED;
    arrow.vy = Math.sin(angle) * ARROW_SPEED;
    arrow.lifetime = 0;
    arrow.isLocal = isLocal;

    this.activeArrows.push(arrow);

    if (isLocal) {
      socket.emit("shootArrow", { targetX: targetX, targetY: targetY });
    }
  }

  updateArrows() {
    for (let i = this.activeArrows.length - 1; i >= 0; i--) {
      const arrow = this.activeArrows[i];

      arrow.x += arrow.vx;
      arrow.y += arrow.vy;
      arrow.lifetime++;

      if (arrow.lifetime > 180) {
        arrow.destroy();
        this.activeArrows.splice(i, 1);
        continue;
      }

      if (!arrow.isLocal) {
        for (const id in mobSprites) {
          const mob = mobSprites[id];
          const dist = Phaser.Math.Distance.Between(
            arrow.x,
            arrow.y,
            mob.x,
            mob.y
          );
          if (dist < 20) {
            arrow.destroy();
            this.activeArrows.splice(i, 1);
            break;
          }
        }
        continue;
      }

      if (
        arrow.x < 0 ||
        arrow.x > WORLD_WIDTH ||
        arrow.y < 0 ||
        arrow.y > WORLD_HEIGHT
      ) {
        arrow.destroy();
        this.activeArrows.splice(i, 1);
        continue;
      }

      for (const id in mobSprites) {
        const mob = mobSprites[id];
        const dist = Phaser.Math.Distance.Between(
          arrow.x,
          arrow.y,
          mob.x,
          mob.y
        );

        if (dist < 20) {
          socket.emit("arrowHit", { mobId: id });
          arrow.destroy();
          this.activeArrows.splice(i, 1);
          break;
        }
      }
    }
  }

  clearAllArrows() {
    for (const arrow of this.activeArrows) {
      arrow.destroy();
    }
    this.activeArrows = [];
  }

  resetLocalState() {
    for (const id in mobSprites) {
      mobSprites[id].destroy();
      delete mobSprites[id];
    }

    this.clearAllArrows();

    this.gameOverText.setVisible(false);
    lastShootTime = 0;
  }

  update(time) {
    if (!this.myPlayer) return;
    if (!this.gameplayEnabled) return;

    const input = {
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
    };

    if (input.up || input.down || input.left || input.right) {
      socket.emit("input", input);
    }

    if (time - lastShootTime > playerFireRate) {
      const target = this.findMobClosestToCore();
      if (target) {
        this.shootArrow(target);
        lastShootTime = time;
      }
    }

    this.updateArrows();

    this.coreHPText.setText(`Torre HP: ${this.coreHP}`);
    this.waveText.setText(`Oleada: ${this.wave}/${maxWaves}`);
    this.statsText.setText(
      `Oro: ${playerGold} | Daño: ${playerDamage} | Kills: ${playerKills}`
    );
    this.playerCountText.setText(`Jugadores: ${Object.keys(players).length}`);
    this.updateCooldownUI(time);

    if (this.coreHP <= 30) {
      this.coreHPText.setColor("#e74c3c");
    } else if (this.coreHP <= 60) {
      this.coreHPText.setColor("#f39c12");
    } else {
      this.coreHPText.setColor("#4ecdc4");
    }
  }
}

socket.on("joinedRoom", (data) => {
  currentRoomName = data.roomName;
  joinedRoom = true;
  console.log(`Joined room: ${data.roomName}`);
});

socket.on("currentPlayers", (data) => {
  if (sceneReady && gameScene) {
    myId = data.myId;
    for (const id in data.players) {
      gameScene.addPlayer(data.players[id]);
      if (id === myId) {
        const p = data.players[id];
        playerGold = p.gold || 0;
        playerLevel = p.level || 1;
        playerKills = p.kills || 0;
        playerFireRate = p.fireRate || 500;
        playerDamage = p.damage || 10;
        playerDamageUpgrades = p.damageUpgrades || 0;
      }
    }
    if (data.matchConfig) {
      matchState = data.matchConfig.state;
      maxWaves = data.matchConfig.maxWaves;
      currentWave = data.matchConfig.currentWave;

      if (matchState === "LOBBY") {
        gameScene.showLobby();
      } else if (matchState === "PLAYING") {
        gameScene.showPlaying();
      } else if (matchState === "SHOP") {
        gameScene.showShop();
      } else if (matchState === "VICTORY") {
        gameScene.showVictory(maxWaves, totalTeamGold);
      }
    }
    if (data.gameState) {
      gameScene.coreHP = data.gameState.coreHP;
      gameScene.wave = data.gameState.wave;
      gameScene.syncMobs(data.gameState.mobs);
    }
  } else {
    pendingPlayers = data;
  }
});

socket.on("gameStateChanged", (data) => {
  matchState = data.state;
  currentWave = data.currentWave;
  maxWaves = data.maxWaves;
  totalTeamGold = data.totalGold || 0;
  lobbyPlayers = data.players || [];

  if (!sceneReady || !gameScene) return;

  gameScene.updateLobbyPlayers();

  if (data.state === "LOBBY") {
    gameScene.showLobby();
  } else if (data.state === "PLAYING") {
    if (matchState !== "PLAYING") {
      gameScene.resetLocalState();
    }
    gameScene.showPlaying();
  } else if (data.state === "SHOP") {
    gameScene.showShop();
  } else if (data.state === "VICTORY") {
    gameScene.showVictory(maxWaves, totalTeamGold);
  }
});

socket.on("shopOpened", (data) => {
  if (!sceneReady || !gameScene) return;
  gameScene.showShop();
});

socket.on("newPlayer", (playerInfo) => {
  if (sceneReady && gameScene) {
    gameScene.addPlayer(playerInfo);
  } else {
    pendingNewPlayers.push(playerInfo);
  }
});

socket.on("playerMoved", (playerInfo) => {
  let sprite = players[playerInfo.id];

  if (!sprite && sceneReady && gameScene) {
    gameScene.addPlayer(playerInfo);
    sprite = players[playerInfo.id];
  }

  if (!sprite) return;

  const dx = playerInfo.x - sprite.x;
  const dy = playerInfo.y - sprite.y;

  sprite.setPosition(playerInfo.x, playerInfo.y);

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) sprite.anims.play("left", true);
    else if (dx > 0) sprite.anims.play("right", true);
  } else if (dy !== 0) {
    if (dy < 0) sprite.anims.play("up", true);
    else sprite.anims.play("down", true);
  }

  if (dx === 0 && dy === 0) {
    sprite.anims.play("idle", true);
  }
});

socket.on("playerUpdate", (data) => {
  if (data.id === myId) {
    playerGold = data.gold;
    playerLevel = data.level;
    playerKills = data.kills;
    playerFireRate = data.fireRate;
    playerDamage = data.damage || playerDamage;
    playerDamageUpgrades = data.damageUpgrades || playerDamageUpgrades;

    if (gameScene && matchState === "SHOP") {
      gameScene.updateShopUI();
    }
  }
});

socket.on("arrowFired", (data) => {
  if (!sceneReady || !gameScene) return;
  if (data.playerId === myId) return;

  gameScene.shootArrow(
    {
      startX: data.startX,
      startY: data.startY,
      targetX: data.targetX,
      targetY: data.targetY,
    },
    false
  );
});

socket.on("playerDisconnected", (id) => {
  if (players[id]) {
    players[id].destroy();
    delete players[id];
  }
});

socket.on("gameStateUpdate", (state) => {
  if (!sceneReady || !gameScene) return;

  gameScene.coreHP = state.coreHP;
  gameScene.wave = state.wave;
  gameScene.syncMobs(state.mobs);
});

socket.on("mobKilled", (data) => {
  if (mobSprites[data.mobId]) {
    mobSprites[data.mobId].destroy();
    delete mobSprites[data.mobId];
  }

  if (data.by === myId && data.position && gameScene) {
    gameScene.showFloatingText(data.position.x, data.position.y, "+10 Gold");
  }
});

socket.on("waveComplete", (data) => {
  if (gameScene) {
    gameScene.wave = data.wave;
  }
});

socket.on("waveStats", (data) => {
  if (gameScene && gameScene.gameplayEnabled) {
    gameScene.showWaveAnnouncement(
      data.wave,
      data.mobHP,
      data.totalMobs,
      data.numPlayers
    );
  }
});

socket.on("gameOver", (data) => {
  if (gameScene) {
    gameScene.gameOverText.setText(`GAME OVER\nOleada: ${data.wave}`);
    gameScene.gameOverText.setVisible(true);
  }
});

socket.on("gameReset", (data) => {
  if (!gameScene) return;

  gameScene.resetLocalState();

  for (const id in players) {
    if (data.players[id]) {
      players[id].setPosition(data.players[id].x, data.players[id].y);
    }
  }

  if (data.players[myId]) {
    const p = data.players[myId];
    playerGold = p.gold;
    playerLevel = p.level;
    playerKills = p.kills;
    playerFireRate = p.fireRate;
    playerDamage = p.damage || 10;
    playerDamageUpgrades = p.damageUpgrades || 0;
  }

  gameScene.coreHP = data.gameState.coreHP;
  gameScene.wave = data.gameState.wave;
  gameScene.showLobby();
});

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  parent: document.body,
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: MainScene,
};

new Phaser.Game(config);
