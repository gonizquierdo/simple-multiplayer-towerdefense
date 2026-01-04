# 🏰 Guía de Replicación: Tower Defense Cooperativo Multiplayer

## Introducción

Este documento es una guía técnica paso a paso para reconstruir un **Tower Defense Cooperativo Multiplayer** desde cero. El juego permite que múltiples jugadores (hasta 5 por sala) colaboren para defender una torre central contra oleadas de enemigos, con mecánicas de progresión, tienda de mejoras y dificultad escalable.

### Características Principales
- Sistema de salas múltiples e independientes
- Movimiento autoritativo (servidor controla posiciones)
- Spawner de enemigos con pathfinding por waypoints
- Sistema de economía: oro, niveles, mejoras de daño
- Dificultad dinámica según número de jugadores
- Estados de partida: Lobby → Playing → Shop → Victory
- UI completa con Phaser 3

---

## Stack Tecnológico

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| **Node.js** | 18+ | Runtime del servidor |
| **Express** | 5.x | Servidor HTTP y archivos estáticos |
| **Socket.io** | 4.x | Comunicación bidireccional en tiempo real |
| **Phaser 3** | 3.60 | Motor de juegos para el cliente |
| **pnpm** | 10.x | Gestor de paquetes |

---

## Estructura del Proyecto

```
mi-juego-multiplayer/
├── package.json          # Dependencias y scripts
├── pnpm-lock.yaml        # Lockfile de dependencias
├── server.js             # Servidor autoritativo
└── public/
    ├── index.html        # Punto de entrada HTML
    ├── game.js           # Lógica del cliente (Phaser)
    └── assets/
        └── dude.png      # Spritesheet del jugador (32x48, 9 frames)
```

---

## Paso a Paso Detallado

### Fase 1: Configuración Inicial

#### 1.1 Inicializar el proyecto

```bash
mkdir mi-juego-multiplayer
cd mi-juego-multiplayer
pnpm init
```

#### 1.2 Instalar dependencias

```bash
pnpm add express socket.io
```

#### 1.3 Configurar `package.json`

```json
{
  "name": "mi-juego-multiplayer",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "packageManager": "pnpm@10.17.1",
  "dependencies": {
    "express": "^5.2.1",
    "socket.io": "^4.8.3"
  }
}
```

#### 1.4 Crear estructura de carpetas

```bash
mkdir -p public/assets
```

---

### Fase 2: Implementación del Servidor

El servidor es **autoritativo**: controla toda la lógica del juego, valida acciones y sincroniza el estado a todos los clientes.

#### 2.1 Arquitectura del servidor

```javascript
// server.js - Estructura base
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static("public"));
```

#### 2.2 Constantes del juego

```javascript
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
```

#### 2.3 Sistema de Salas (Rooms)

El sistema de salas permite partidas independientes:

```javascript
const rooms = {};

function createRoom(roomName) {
  rooms[roomName] = {
    name: roomName,
    players: {},
    matchConfig: {
      state: "LOBBY",    // LOBBY | PLAYING | SHOP | VICTORY
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
    if (room.spawnIntervalId) clearInterval(room.spawnIntervalId);
    delete rooms[roomName];
  }
}
```

#### 2.4 Game Loop Autoritativo

El servidor ejecuta dos loops principales:

```javascript
// Loop de física (60 FPS)
setInterval(() => {
  for (const roomName in rooms) {
    const room = rooms[roomName];
    if (room.matchConfig.state === "PLAYING") {
      updateMobs(roomName);
      checkWaveComplete(roomName);
    }
  }
}, 1000 / 60);

// Loop de sincronización (20 FPS)
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
```

#### 2.5 Manejo de conexiones

```javascript
io.on("connection", (socket) => {
  socket.roomName = null;

  socket.on("joinRoom", (data) => {
    const roomName = data.roomName || "default";
    let room = getRoom(roomName);
    
    if (!room) room = createRoom(roomName);
    
    // Verificar límite de jugadores
    if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("roomFull", { roomName, maxPlayers: MAX_PLAYERS_PER_ROOM });
      return;
    }

    socket.join(roomName);
    socket.roomName = roomName;

    // Crear jugador con stats iniciales
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

    // Notificar al cliente y a otros jugadores
    socket.emit("joinedRoom", { roomName });
    socket.emit("currentPlayers", {
      players: room.players,
      myId: socket.id,
      matchConfig: room.matchConfig,
      gameState: room.gameState,
    });
    socket.to(roomName).emit("newPlayer", room.players[socket.id]);
  });
});
```

---

### Fase 3: Implementación del Cliente

#### 3.1 HTML Base

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Tower Defense Multiplayer</title>
    <style>
      body {
        margin: 0;
        display: flex;
        justify-content: center;
        background: #333;
      }
      canvas { border: 2px solid #555; }
    </style>
  </head>
  <body>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="game.js"></script>
  </body>
</html>
```

#### 3.2 Configuración de Phaser

```javascript
const socket = io();

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
```

#### 3.3 Clase MainScene

```javascript
class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.cursors = null;
    this.myPlayer = null;
    this.activeArrows = [];
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
  }

  update(time) {
    if (!this.myPlayer || !this.gameplayEnabled) return;

    const input = {
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
    };

    if (input.up || input.down || input.left || input.right) {
      socket.emit("input", input);
    }

    // Auto-disparo
    if (time - lastShootTime > playerFireRate) {
      const target = this.findMobClosestToCore();
      if (target) {
        this.shootArrow(target);
        lastShootTime = time;
      }
    }

    this.updateArrows();
  }
}
```

---

## Sección de Prompts Maestros

Estos son los prompts clave utilizados durante el desarrollo:

### Prompt 1: Sistema de Movimiento y Sprites

> "Dentro de la estructura de Phaser, implementa la lógica multiplayer y las animaciones:
> - En `preload()`: Carga el spritesheet 'assets/dude.png' (32x48px por frame)
> - En `create()`: Crea animaciones para 'left', 'right', 'up', 'down', 'idle'
> - Cuando llegue `playerMoved`: Actualiza posición y reproduce la animación según la dirección del movimiento"

### Prompt 2: Spawner de Mobs y Pathfinding

> "Configura las mecánicas de Tower Defense:
> - Define waypoints: `[{x: 0, y: 300}, {x: 400, y: 300}]`
> - Crea `spawnMob()` que genere enemigos con 30 HP en el primer waypoint
> - Los mobs deben moverse hacia el siguiente waypoint a velocidad constante
> - Cuando lleguen al centro, restan 10 HP al core"

### Prompt 3: Economía y Progresión

> "Implementa el sistema de economía:
> - Cada jugador tiene: gold, kills, level, fireRate, damage
> - Al matar un mob: +10 oro, +1 kill
> - Cada 5 kills: sube de nivel, fireRate -= 30ms (mínimo 300ms)
> - En la tienda: mejora de daño (+4) cuesta 20 * 1.2^upgrades"

### Prompt 4: Sistema de Salas

> "Refactoriza para soportar múltiples salas independientes:
> - Usa `socket.join(roomName)` para agrupar jugadores
> - Todas las variables de juego deben estar dentro de `rooms[roomName]`
> - Cambia `io.emit()` por `io.to(roomName).emit()`
> - Limita a 5 jugadores por sala"

---

## Lógica de Balanceo Dinámico

### Fórmula de Escalado de Dificultad

La dificultad escala según el número de jugadores para mantener el desafío:

```javascript
function getWaveStats(wave, numPlayers) {
  const playerCount = Math.max(1, numPlayers);
  
  // Vida de los mobs escala con oleada y jugadores
  // Fórmula: 30 * (1 + wave*0.5) * (1 + (players-1)*0.7)
  const mobHP = Math.floor(
    30 * (1 + wave * 0.5) * (1 + (playerCount - 1) * 0.7)
  );
  
  // Cantidad de mobs escala linealmente con jugadores
  // Fórmula: (5 + wave*2) * numPlayers
  const mobsPerWave = (5 + wave * 2) * playerCount;
  
  return { mobHP, mobsPerWave };
}
```

### Tabla de Ejemplo

| Oleada | 1 Jugador | 2 Jugadores | 3 Jugadores |
|--------|-----------|-------------|-------------|
| 1 | 7 mobs, 45 HP | 14 mobs, 77 HP | 21 mobs, 108 HP |
| 2 | 9 mobs, 60 HP | 18 mobs, 102 HP | 27 mobs, 144 HP |
| 3 | 11 mobs, 75 HP | 22 mobs, 128 HP | 33 mobs, 180 HP |

### Validación contra abusos

- Si un jugador se desconecta **durante** una oleada, los mobs ya spawneados mantienen sus stats
- La siguiente oleada recalcula stats con el nuevo número de jugadores
- El oro por muerte se mantiene constante (10) para no desbalancear la economía

---

## Eventos Socket.io

### Servidor → Cliente

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `joinedRoom` | `{ roomName }` | Confirmación de unión a sala |
| `roomFull` | `{ roomName, maxPlayers }` | Sala llena |
| `currentPlayers` | `{ players, myId, matchConfig, gameState }` | Estado inicial |
| `newPlayer` | `{ id, x, y, ... }` | Nuevo jugador conectado |
| `playerMoved` | `{ id, x, y }` | Actualización de posición |
| `playerUpdate` | `{ id, gold, kills, level, ... }` | Stats actualizados |
| `gameStateChanged` | `{ state, currentWave, players }` | Cambio de estado |
| `gameStateUpdate` | `{ coreHP, wave, mobs }` | Sincronización 20 FPS |
| `waveStats` | `{ wave, mobHP, totalMobs, numPlayers }` | Inicio de oleada |
| `mobKilled` | `{ mobId, by, position }` | Mob eliminado |

### Cliente → Servidor

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `joinRoom` | `{ roomName }` | Solicitar unirse a sala |
| `toggleReady` | - | Cambiar estado listo en lobby |
| `input` | `{ up, down, left, right }` | Enviar input de movimiento |
| `shootArrow` | `{ targetX, targetY }` | Disparar flecha |
| `arrowHit` | `{ mobId }` | Flecha impactó mob |
| `buyUpgrade` | `{ type }` | Comprar mejora |
| `shopReady` | - | Listo para siguiente oleada |
| `resetGame` | - | Reiniciar partida |

---

## Desafíos Sugeridos: Próximos Pasos

### Nivel Principiante
1. **Nuevos tipos de enemigos**: Mobs rápidos con poca vida, tanques lentos con mucha vida
2. **Power-ups**: Items que aparecen al matar mobs (velocidad, daño temporal)
3. **Efectos de sonido**: Añadir audio con Phaser Sound Manager

### Nivel Intermedio
4. **Torres estáticas**: Jugadores pueden construir torretas defensivas
5. **Habilidades especiales**: Cada jugador elige una clase con habilidad única
6. **Sistema de oleadas especiales**: Cada 5 oleadas aparece un jefe

### Nivel Avanzado
7. **Persistencia con base de datos**: Guardar progreso de jugadores (MongoDB/PostgreSQL)
8. **Sistema de matchmaking**: Emparejar jugadores automáticamente
9. **Múltiples mapas**: Diferentes layouts con waypoints únicos
10. **Replays**: Grabar y reproducir partidas

### Mejoras de Infraestructura
11. **Rate limiting**: Prevenir spam de eventos
12. **Autenticación**: Sistema de cuentas con JWT
13. **Escalado horizontal**: Usar Redis Adapter para Socket.io

---

## Ejecutar el Proyecto

```bash
# Instalar dependencias
pnpm install

# Modo desarrollo (auto-reload)
pnpm dev

# Modo producción
pnpm start
```

Acceder a `http://localhost:3000` en múltiples navegadores para probar el multiplayer.

---

## Troubleshooting Común

| Problema | Causa | Solución |
|----------|-------|----------|
| Jugador no aparece | Race condition en inicialización | Usar `pendingPlayers` buffer |
| Flechas estáticas | Physics body no configurado | Usar movimiento manual en `updateArrows()` |
| Oleadas infinitas | Condición de wave complete incorrecta | Verificar `allSpawned && allKilled` |
| Proyectiles invisibles | Evento no propagado | Emitir `arrowFired` a otros clientes |

---

*Documento generado para el proyecto Tower Defense Cooperativo Multiplayer v1.0*
