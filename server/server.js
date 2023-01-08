const { v4: uuidv4 } = require('uuid');//library for creating unique room id
const cookie = require('cookie');
const cookieMaxAge = 60 * 60;//cookies should expire in 1 hour
//create necessary express http server, and use socket io inside the server
let express = require('express'),
  app = express(),
  http = require('http'),
  socketIO = require('socket.io'),
  server, io,
  path = require("path");
app.get('/', function (req, res) {//sends client html file at connection
  res.sendFile(path.join(__dirname + '/../client/index.html'));
});

app.use(express.static(__dirname + '/../client'));//find other client side files here
server = http.Server(app);
server.listen(3000);//server listening to local host port 3000
io = socketIO(server);//build a scoket io server based on express http server

let mygames = {};//game states. Simulating the database
let gameIntervals = {};//stores the current running game loops
const GRID_SIZE = 4;//game board grid size fixed to 4
let FPS = 30;//game loop frequency

io.on('connection', async (socket) => {//when a client connects through scoket io
  socket.on('createRoom', handleCreateRoom);//when creating a new game room
  socket.on('joinRoom', handleJoinRoom);//when player joins a room, including reconnecting
  socket.on('highlight', handleHighlight);//when a player sends highlight side request
  socket.on('occupySide', handleOccupySide);//whena a player sends occupy side request
  socket.on('leaveRoom', handleLeaveRoom);//when the player leaves a room before game starts
  socket.on('clearPrevHighlight',(room)=>{
    for (let myI = 0; myI < GRID_SIZE; myI++) {//clear previous highlight
      for (let myJ = 0; myJ < GRID_SIZE; myJ++) {
        mygames[room].Boxes[myI][myJ].highlight = null;
      }
    }
  })
  // handle reconnecting with cookie
  let cookies;
  if(socket.request.headers.cookie){
    cookies = cookie.parse(socket.request.headers.cookie);//get cookie from client
    if (cookies.room) {//if there is a cookie and cookie.room != 0, trigger reconnecting process
      console.log(cookies.room, cookies.player, "cookie");
      if (cookies.room != 0) { handleJoinRoom(cookies.room, cookies.player); };
    }
  }


  function handleCreateRoom() {
    let roomID = newRoomID();//get a unique room id
    //myRooms[socket.id] = roomID;
    socket.join(roomID);
    socket.emit('createRoom', 0, roomID);
    mygames[roomID] = createGameState(); //init the game for this room
    //update client cookie to the current room, and reset player id
    socket.emit('cookie', 'room=' + roomID + ";max-age =" + cookieMaxAge);
    socket.emit('cookie', 'player=0;max-age =' + cookieMaxAge);
  }
  function newRoomID() {//returns a unique room id
    return uuidv4();
  }
  function handleJoinRoom(roomID, cookiePlayerID) {
    const room = io.sockets.adapter.rooms.has(roomID);//if the room exists
    let gameRunning = false;
    if (room) {
      gameRunning = mygames[roomID].gameRunning;//know if the room's game is running
    }
    let roomSize = 0;
    if (cookiePlayerID == 0) {//if new player joining
      if (room) {//if room exists
        roomSize = io.sockets.adapter.rooms.get(roomID).size;//get the number of players in the room
        if (roomSize == 0) {//empty room needs to be closed
          gameOver(roomID, '');
          socket.emit('roomClosed', roomID);
          socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);//reset client room cookie
          return;
        }
      } else {//if room doesn't exist
        socket.emit('roomNotFound', roomID);
        socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);//reset client room cookie
        return;
      }
      if (roomSize == 3 || gameRunning) {//if room full or game already started
        socket.emit('roomFull', roomID);
        socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);//reset client room cookie
        return;
      }
      //if room exist and not full and the game hasn't start yet, join room and assign playerID
      socket.join(roomID);
      roomSize = io.sockets.adapter.rooms.get(roomID).size;
      socket.emit('joinRoom', 0, roomID);
      //update client cookies to the current room
      socket.emit('cookie', 'room=' + roomID + ";max-age =" + cookieMaxAge);
      socket.emit('cookie', 'player=0;max-age =' + cookieMaxAge);
      if (roomSize == 3) {// when we have enough players
        //start game
        mygames[roomID].currentTurn = 1;
        mygames[roomID].gameRunning = true;
        startGame(roomID);
      }
      //when a cookie says playerID>0, then the game has already started
    } else if (cookiePlayerID > 0 && gameRunning &&room) {//if player reconnecting to a running game----------------------------------check game startted or not
      roomSize = io.sockets.adapter.rooms.get(roomID).size;
      if (roomSize == 0) {//empty room needs to be closed
        gameOver(roomID, '');
        socket.emit('roomClosed', roomID);//reset client room cookie
        socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);
        return;
      }
      //re-join the room with player id and room id stored in cookie
      console.log(cookiePlayerID, roomID, "reconnect running game");
      socket.join(roomID);
      socket.emit('joinRoom', cookiePlayerID, roomID);
    } else {//reconnecting but game already closed
      socket.emit('roomClosed',roomID);
      //reset cookies
      socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);
      socket.emit('cookie', 'player=-1;max-age =' + cookieMaxAge);
    }
  }

  function handleHighlight(req) {
    let room = req.room;
    const hasRoom = io.sockets.adapter.rooms.has(room);
    if(!hasRoom){//if room doesn't exist, return
      return
    };
    let i = req.boxI;
    let j = req.boxJ;
    let side = req.side;
    for (let myI = 0; myI < GRID_SIZE; myI++) {//clear previous highlight
      for (let myJ = 0; myJ < GRID_SIZE; myJ++) {
        mygames[room].Boxes[myI][myJ].highlight = null;
      }
    }
    mygames[room].Boxes[i][j].highlight = side;
    if (side == "t" && i > 0) {//for top adjacent box, we highlight bot
      mygames[room].Boxes[i - 1][j].highlight = "b";
    } else if (side == "b" && i < GRID_SIZE - 1) {//for bot adjacent box, we highlight top
      mygames[room].Boxes[i + 1][j].highlight = "t";
    } else if (side == "l" && j > 0) {//for left adjacent box, we highlight right
      mygames[room].Boxes[i][j - 1].highlight = "r";
    } else if (side == "r" && j < GRID_SIZE - 1) {//for right adjacent box, we highlight left
      mygames[room].Boxes[i][j + 1].highlight = "l";
    }
  }

  function handleOccupySide(roomID) {
    const hasRoom = io.sockets.adapter.rooms.has(roomID);
    if(!hasRoom){//if room doesn't exist, return
      return
    };
    let highlightedFlag = false;
    let scoreFlag = false;
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        if (mygames[roomID].Boxes[i][j].highlight != null) {// if a box's side is highlighted
          highlightedFlag = true;
          if (occupyBoxSide(mygames[roomID].Boxes[i][j], roomID)) {//if not scoring, go to next player's turn----------may need to pass boxes i and j
            scoreFlag = true;
          }
        }
      }
    }
    if (!scoreFlag && highlightedFlag) {//if not scoring and occupy success, go to next player's turn
      if (mygames[roomID].currentTurn == 1 || mygames[roomID].currentTurn == 2) {
        mygames[roomID].currentTurn++;
      } else if (mygames[roomID].currentTurn == 3) {
        mygames[roomID].currentTurn = 1;
      }
    }
    //check for game ending condition
    if (mygames[roomID].totalScore == GRID_SIZE * GRID_SIZE) {//if the game ends
      let gameResult;
      if (mygames[roomID].player1Score == mygames[roomID].player2Score && mygames[roomID].player1Score == mygames[roomID].player3Score) {
        gameResult = "Tie!";
      } else if (mygames[roomID].player1Score > mygames[roomID].player2Score && mygames[roomID].player1Score > mygames[roomID].player3Score) {
        gameResult = "Player 1 wins!";
      } else if (mygames[roomID].player2Score > mygames[roomID].player1Score && mygames[roomID].player2Score > mygames[roomID].player3Score) {
        gameResult = "Player 2 wins!";
      } else if (mygames[roomID].player3Score > mygames[roomID].player2Score && mygames[roomID].player3Score > mygames[roomID].player1Score) {
        gameResult = "Player 3 wins!";
      } else if (mygames[roomID].player1Score == mygames[roomID].player2Score && mygames[roomID].player1Score > mygames[roomID].player3Score) {
        gameResult = "Player 1 and Player 2 ties!";
      } else if (mygames[roomID].player2Score == mygames[roomID].player3Score && mygames[roomID].player2Score > mygames[roomID].player1Score) {
        gameResult = "Player 2 and Player 3 ties!";
      } else if (mygames[roomID].player1Score == mygames[roomID].player3Score && mygames[roomID].player1Score > mygames[roomID].player2Score) {
        gameResult = "Player 1 and Player 3 ties!";
      }
      //end the game
      mygames[roomID.gameRunning] = false;
      io.sockets.in(roomID).emit('gameState', JSON.stringify(mygames[roomID]));
      gameOver(roomID, gameResult);
    }
  }
  function handleLeaveRoom(room){//when a client leaves room beofre game starts or after game finishes
    socket.leave(room);//leave socket io room
    socket.emit('leftRoom');//tell client
    socket.emit('cookie', 'room=0;' + "max-age =" + cookieMaxAge);//reset cookie
  }
});
function occupyBoxSide(box, roomID) {//let the current player to occupy a highlighted and unoccupied side. Update score and fill the box if scoring. 
  if (box.highlight == null) {
    return;
  } else if (box.highlight == "t") {
    box.sideTop.sideOccupiedBy = mygames[roomID].currentTurn;
    box.sideTop.occupied = true;
  } else if (box.highlight == "b") {
    box.sideBot.sideOccupiedBy = mygames[roomID].currentTurn;
    box.sideBot.occupied = true;
  } else if (box.highlight == "l") {
    box.sideLeft.sideOccupiedBy = mygames[roomID].currentTurn;
    box.sideLeft.occupied = true;
  } else if (box.highlight == "r") {
    box.sideRight.sideOccupiedBy = mygames[roomID].currentTurn;
    box.sideRight.occupied = true;
  }
  box.highlight = null;

  //check for score condition
  box.sideSelected++;
  if (box.sideSelected == 4) {
    box.occupiedBy = mygames[roomID].currentTurn;
    if (mygames[roomID].currentTurn == 1) {
      mygames[roomID].player1Score++;
      mygames[roomID].totalScore++;
    } else if (mygames[roomID].currentTurn == 2) {
      mygames[roomID].player2Score++;
      mygames[roomID].totalScore++;
    } else if (mygames[roomID].currentTurn == 3) {
      mygames[roomID].player3Score++;
      mygames[roomID].totalScore++;
    }
    return true;
  }
  return false;
};
function startGame(roomID) {
  //Initialize player ids in room
  const clients = io.sockets.adapter.rooms.get(roomID);
  let i = 1;
  for (const clientID of clients) {//assign player id tp eevryone in the room
    const clientSocket = io.sockets.sockets.get(clientID);
    clientSocket.emit('initState',i);
    clientSocket.emit('cookie','player='+i+';max-age =' + cookieMaxAge);
    i++;
  }
  //Start game loop
  gameIntervals[roomID] = setInterval(() => {
    gameLoop(roomID, mygames[roomID])
  }, 1000 / FPS);
}
function gameLoop(roomID, state) {
  if(!io.sockets.adapter.rooms.has(roomID)){//if the room doesn't exists
    gameOver(roomID,"");
    return;
  }
  
  if(io.sockets.adapter.rooms.get(roomID).size<3){//check number of players in the room while game running to know if someone disconnects
    state.disconnected = true;
  }else{
    state.disconnected = false;
  }
  io.sockets.in(roomID).emit('gameState', JSON.stringify(state));//send the most recent game state to everyone in the room
}
function gameOver(roomID, gameResult) {
  clearInterval(gameIntervals[roomID]);//stop game loop
  io.sockets.in(roomID).emit('cookie', 'room=0;max-age =' + cookieMaxAge);//clear cookies
  io.sockets.in(roomID).emit('cookie', 'player=0;max-age =' + cookieMaxAge);
  io.sockets.in(roomID).emit('gameOver', gameResult);//tell client game is over and game result
  io.in(roomID).socketsLeave(roomID);//kick clients out of room
  delete mygames[roomID];//delete room
  console.log(roomID, "closed");//log room close message to server
}
//deatils of the gamestate being send to client
function createGameState() {
  return {
    gameRunning: false,
    disconnected: false,
    currentTurn: 0,
    totalScore: 0,
    player1Score: 0,
    player2Score: 0,
    player3Score: 0,
    Boxes: createBoxes(GRID_SIZE),
  }
}
function createBoxes(size) {
  let boxes = {}
  for (let i = 0; i < size; i++) {
    boxes[i] = [];
    for (let j = 0; j < size; j++) {
      boxes[i][j] = createBox(i, j);
    }
  }
  return boxes;
}
function createBox(i, j) {
  return {
    posI: i,
    posJ: j,
    highlight: null,
    sideSelected: 0,
    occupiedBy: null,
    sideBot: { sideOccupiedBy: null, occupied: false },
    sideLeft: { sideOccupiedBy: null, occupied: false },
    sideRight: { sideOccupiedBy: null, occupied: false },
    sideTop: { sideOccupiedBy: null, occupied: false }
  }
}