const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(express.static(__dirname)); 

let rooms = {}; // { roomId: { gameType, players: [], board: ..., currentPlayer: 0, chat: [] } }

io.on('connection', (socket) => {
  console.log('Nouvel utilisateur connecté');

  
  socket.emit('roomsList', Object.entries(rooms).map(([id, room]) => ({
    id, gameType: room.gameType, playerCount: room.players.length
  })));

  
  socket.on('createRoom', ({ username, gameType }) => {
    const roomId = Math.random().toString(36).substring(7); 
    rooms[roomId] = {
      gameType,
      players: [{ id: socket.id, username, symbol: gameType === 'morpion' ? 'X' : 'R' }],
      board: initBoard(gameType),
      currentPlayer: 0,
      chat: [],
      started: false
    };
    socket.join(roomId);
    socket.emit('joinedRoom', { roomId, username, symbol: rooms[roomId].players[0].symbol });
    io.emit('roomsList', Object.entries(rooms).map(([id, room]) => ({
      id, gameType: room.gameType, playerCount: room.players.length
    }))); // Update de lobby
  });

  
  socket.on('joinRoom', ({ roomId, username }) => {
    const room = rooms[roomId];
    if (room && room.players.length < 2) {
      const symbol = room.gameType === 'morpion' ? 'O' : 'Y';
      room.players.push({ id: socket.id, username, symbol });
      socket.join(roomId);
      socket.emit('joinedRoom', { roomId, username, symbol });
      io.to(roomId).emit('playerJoined', { players: room.players.map(p => ({ username: p.username, symbol: p.symbol })) });
      if (room.players.length === 2) {
        room.started = true;
        io.to(roomId).emit('startGame', { currentPlayer: room.players[0].symbol });
      }
    } else {
      socket.emit('error', 'Room pleine ou inexistante');
    }
  });

  
  socket.on('move', ({ roomId, index }) => {
    const room = rooms[roomId];
    if (room && room.started && room.players[room.currentPlayer].id === socket.id) {
      if (isValidMove(room, index)) {
        applyMove(room, index);
        io.to(roomId).emit('move', { index, symbol: room.players[room.currentPlayer].symbol });
        const winner = checkWin(room);
        if (winner) {
          io.to(roomId).emit('win', { winner });
          resetRoom(room);
        } else if (isDraw(room)) {
          io.to(roomId).emit('draw');
          resetRoom(room);
        } else {
          room.currentPlayer = 1 - room.currentPlayer;
          io.to(roomId).emit('turn', { currentPlayer: room.players[room.currentPlayer].symbol });
        }
      }
    }
  });

  // Chat
  socket.on('chat', ({ roomId, message }) => {
    const room = rooms[roomId];
    if (room) {
      const sender = room.players.find(p => p.id === socket.id)?.username || 'Anonyme';
      room.chat.push({ sender, message });
      io.to(roomId).emit('chat', { sender, message });
    }
  });

  
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length < 2) {
        io.to(roomId).emit('playerLeft');
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
    io.emit('roomsList', Object.entries(rooms).map(([id, room]) => ({
      id, gameType: room.gameType, playerCount: room.players.length
    })));
  });
});


function initBoard(gameType) {
  if (gameType === 'morpion') return Array(9).fill(null);
  if (gameType === 'puissance4') return Array.from({ length: 6 }, () => Array(7).fill(null)); 
}

function isValidMove(room, index) {
  if (room.gameType === 'morpion') return room.board[index] === null;
  if (room.gameType === 'puissance4') {
    const col = index; // index = colonne (0-6)
    return room.board.some(row => row[col] === null); 
  }
}

function applyMove(room, index) {
  const symbol = room.players[room.currentPlayer].symbol;
  if (room.gameType === 'morpion') {
    room.board[index] = symbol;
  } else if (room.gameType === 'puissance4') {
    const col = index;
    for (let row = 5; row >= 0; row--) {
      if (room.board[row][col] === null) {
        room.board[row][col] = symbol;
        break;
      }
    }
  }
}

function checkWin(room) {
  if (room.gameType === 'morpion') {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return wins.some(combo => room.board[combo[0]] && room.board[combo[0]] === room.board[combo[1]] && room.board[combo[1]] === room.board[combo[2]]);
  } else if (room.gameType === 'puissance4') {
    
    const board = room.board;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
      const s = board[r][c];
      if (!s) continue;
      if (c <= 3 && board[r][c+1] === s && board[r][c+2] === s && board[r][c+3] === s) return s; // Horz
      if (r <= 2 && board[r+1][c] === s && board[r+2][c] === s && board[r+3][c] === s) return s; // Vert
      if (r <= 2 && c <= 3 && board[r+1][c+1] === s && board[r+2][c+2] === s && board[r+3][c+3] === s) return s; // Diag /
      if (r <= 2 && c >= 3 && board[r+1][c-1] === s && board[r+2][c-2] === s && board[r+3][c-3] === s) return s; // Diag \
    }
    return null;
  }
}

function isDraw(room) {
  if (room.gameType === 'morpion') return room.board.every(cell => cell !== null);
  if (room.gameType === 'puissance4') return room.board.every(row => row.every(cell => cell !== null));
}

function resetRoom(room) {
  room.board = initBoard(room.gameType);
  room.currentPlayer = 0;
  room.started = false;
}

server.listen(3000, () => console.log('Serveur lancé sur http://localhost:3000'));
