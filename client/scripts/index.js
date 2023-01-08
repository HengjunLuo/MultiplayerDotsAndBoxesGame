const socket = io('http://localhost:3000');
socket.on('createRoom', handleCreateRoom);//need to init gameboard
socket.on('joinRoom', handleJoinRoom);//need to init gameboard
socket.on('roomFull', handleRoomFull);
socket.on('roomNotFound', handleRoomNotFound);
socket.on('roomClosed', handleRoomClosed);
socket.on('initState', handleInitState);
socket.on('gameState', handleGameState);//JSOn parse gameState, then draw game based on it(waiting on players, new scores, new boxes, currentTurn)
socket.on('gameOver', handleGameOver);
socket.on("leftRoom", back);
socket.on('cookie', function (cookie) {
    document.cookie = cookie;
});
//client side important variables, flags, and dimensions
let showCanvas = false;
let gameRunning;
let playerID;
let roomID;
let currentTurn;//1=player 1's turn, 2=player 2's turn, 3=player 3's turn
let alreadyHighlighted = false;// use this flag to avoid overlapping of transparent color
let p1Score, p2Score, p3Score, totalScore;// player scores
let boxes = [];//2d array for boxes displayed in canvas
let canvas, canvasContext;
let HEIGHT, WIDTH, BOX_SIZE, STROKE, DOT, TOP_MARGIN;
const GRID_SIZE = 4; //game board grid size fixed to 4

//Player colors
const P1_COLOR = "rgba(255, 0, 0, 1)";
const P1_COLOR_HOVER = "rgba(255, 0, 0, 0.4)";
const P2_COLOR = "rgba(0, 187, 0, 1)";
const P2_COLOR_HOVER = "rgba(0, 187, 0, 0.4)";
const P3_COLOR = "rgba(255, 155, 0, 1)";
const P3_COLOR_HOVER = "rgba(255, 155, 0, 0.4)";
let p1ScoreBoard = document.getElementById("p1score");
let p2ScoreBoard = document.getElementById("p2score");
let p3ScoreBoard = document.getElementById("p3score");
p1ScoreBoard.style.color = P1_COLOR;
p2ScoreBoard.style.color = P2_COLOR;
p3ScoreBoard.style.color = P3_COLOR;

let message = document.getElementById("message");
//add event listeners to the buttons and canvas
//check for touch screen or mouse screen, use different move listenners based on it
let myMove = "";
if ("ontouchstart" in document.documentElement) { myMove = "touchmove" }
else { myMove = "mousemove" };
document.getElementById("create").addEventListener("click", createRoom);//remove home page and display game board
document.getElementById("join").addEventListener("click", joinRoom);//clear game status
document.getElementById("copyid").addEventListener("click", () => {
    let roomIDContent = document.getElementById("current_room_id").innerText;
    navigator.clipboard.writeText(roomIDContent);
});
document.getElementById("back").addEventListener("click", leaveRoom);

window.addEventListener("resize", updateDimensions);//when window size changes, resize and redraw canvas to fit the window.
canvas = document.getElementsByTagName("canvas")[0];
canvas.addEventListener(myMove, function (e) {
    if (!gameRunning || playerID != currentTurn) {
        return;
    }
    let xInCanvas = e.clientX - canvas.getBoundingClientRect().left;
    let yInCanvas = e.clientY - canvas.getBoundingClientRect().top;
    highlightSideReq(xInCanvas, yInCanvas);
});
canvas.addEventListener("click", function (e) {
    if (!gameRunning || playerID != currentTurn) {
        return;
    }
    occupySideReq();
});
canvasContext = canvas.getContext("2d");


function initGame() {//init some game status and dimensions
    //canvas dimensions
    HEIGHT = window.innerHeight * 0.6;
    WIDTH = window.innerWidth * 0.6;
    if (HEIGHT >= WIDTH) {//make a squre game board that can fit into the window
        HEIGHT = WIDTH;
    } else {
        WIDTH = HEIGHT;
    }
    BOX_SIZE = WIDTH / (GRID_SIZE + 2);//the standard length of box sides
    STROKE = BOX_SIZE / 12;//the standard line width
    DOT = STROKE;//the standard dot radius
    TOP_MARGIN = HEIGHT - (GRID_SIZE + 1) * BOX_SIZE;

    canvas.height = HEIGHT;
    canvas.width = WIDTH;

    // set up the canvas context

    canvasContext.lineWidth = STROKE;
    //go tp room page
    start();
    drawBoard();
    drawBoxes();
    drawGrid();
}

//The game logic box structure
class Box {
    constructor(x, y, w, h) {
        this.w = w;
        this.h = h;
        this.top = y;
        this.bot = y + h;
        this.left = x;
        this.right = x + w;
        this.highlight = null;
        this.sideSelected = 0;
        this.occupiedBy = null;
        this.sideBot = { sideOccupiedBy: null, occupied: false };
        this.sideLeft = { sideOccupiedBy: null, occupied: false };
        this.sideRight = { sideOccupiedBy: null, occupied: false };
        this.sideTop = { sideOccupiedBy: null, occupied: false };
        this.updateBox = function (newBox) {
            this.highlight = newBox.highlight;
            this.sideSelected = newBox.sideSelected;
            this.occupiedBy = newBox.occupiedBy;
            this.sideBot = newBox.sideBot;
            this.sideLeft = newBox.sideLeft;
            this.sideRight = newBox.sideRight;
            this.sideTop = newBox.sideTop;
        }
        this.resetDimensions = function (newX, newY, newW, newH) {//update box positions dimensions when called
            this.w = newW;
            this.h = newH;
            this.top = newY;
            this.bot = newY + newH;
            this.left = newX;
            this.right = newX + newW;
        }
        this.mouseInBox = function (x, y) {// is the mouse cursor is inside this box
            if (x >= this.right) {
                return false;
            } else if (x < this.left) {
                return false;
            } else if (y < this.top) {
                return false;
            } else if (y >= this.bot) {
                return false;
            }
            return true;
        };
        this.fill = function () {//if this box is occupied by a player, fill box with the player's hover color 
            if (this.occupiedBy == null) {
                return;
            }
            canvasContext.fillStyle = getPlayerColor(this.occupiedBy, 1);
            canvasContext.fillRect(this.left + STROKE / 2, this.top + STROKE / 2, this.w - STROKE / 2, this.h - STROKE / 2);
        };

        this.drawSide = function (side, color) {//draw one of the 4 sides of the box
            if (side == "t") {
                drawLine(this.left, this.top, this.right, this.top, color);
            } else if (side == "b") {
                drawLine(this.left, this.bot, this.right, this.bot, color);
            }
            else if (side == "l") {
                drawLine(this.left, this.top, this.left, this.bot, color);
            }
            else if (side == "r") {
                drawLine(this.right, this.top, this.right, this.bot, color);
            }
        };
        this.drawBoxSides = function () {//draw all the occupied or highlighted sides. No need to draw a empty side.
            //draw the highlighten side
            if (this.highlight != null && !alreadyHighlighted) {
                alreadyHighlighted = true; //don't over highlight the same line
                this.drawSide(this.highlight, getPlayerColor(currentTurn, 1));
            }

            //draw the occupied sides
            if (this.sideTop.occupied) {
                this.drawSide("t", getPlayerColor(this.sideTop.sideOccupiedBy, 0));
            }
            if (this.sideBot.occupied) {
                this.drawSide("b", getPlayerColor(this.sideBot.sideOccupiedBy, 0));
            }
            if (this.sideLeft.occupied) {
                this.drawSide("l", getPlayerColor(this.sideLeft.sideOccupiedBy, 0));
            }
            if (this.sideRight.occupied) {
                this.drawSide("r", getPlayerColor(this.sideRight.sideOccupiedBy, 0));
            }

        };
        this.highlightSide = function (x, y) {//highlight unoccupied side with the current player's hover color
            //find the closest side
            let toTop = y - this.top;
            let toBot = this.bot - y;
            let toLeft = x - this.left;
            let toRight = this.right - x;
            let closest = Math.min(toBot, toTop, toLeft, toRight);
            let toBehighlighted = null
            //Highlight side if not already occupied
            if (closest == toTop && this.sideTop.sideOccupiedBy == null) {
                toBehighlighted = "t";
            } else if (closest == toBot && this.sideBot.sideOccupiedBy == null) {
                toBehighlighted = "b";
            } else if (closest == toLeft && this.sideLeft.sideOccupiedBy == null) {
                toBehighlighted = "l";
            } else if (closest == toRight && this.sideRight.sideOccupiedBy == null) {
                toBehighlighted = "r";
            } else {
                toBehighlighted = null;
            }
            return toBehighlighted;
        };
    }
}

function drawBoard() {//draw the canvas board
    canvasContext.fillStyle = "white";
    canvasContext.strokeStyle = "purple";
    canvasContext.fillRect(0, 0, WIDTH, HEIGHT);
    canvasContext.strokeRect(STROKE / 2, STROKE / 2, WIDTH - STROKE, HEIGHT - STROKE);
}

function drawDot(x, y) {//draw a dot in canvas
    canvasContext.fillStyle = "purple";
    canvasContext.beginPath();
    canvasContext.arc(x, y, DOT, 0, Math.PI * 2)
    canvasContext.fill();
}

function drawGrid() {//draw the dot grid on canvas
    for (let i = 0; i <= GRID_SIZE; i++) {
        for (let j = 0; j <= GRID_SIZE; j++) {
            drawDot(BOX_SIZE * (j + 1), TOP_MARGIN + BOX_SIZE * (i))
        }
    }
}

function drawLine(xStart, yStart, xEnd, yEnd, color) {//draw a line in canvas
    canvasContext.beginPath();
    canvasContext.moveTo(xStart, yStart);
    canvasContext.lineTo(xEnd, yEnd);
    canvasContext.strokeStyle = color;
    canvasContext.stroke();
}

function drawBoxes() {//draw all the box sides and fill box with the owner's color
    for (let row of boxes) {
        for (let box of row) {
            box.fill();
            box.drawBoxSides();
        }
    }
    //2 overlapping line with the same color and low opacity will make a line with higher opacity.
    //We need this flag to avoid drawing a line twice.
    alreadyHighlighted = false;
}

function getPlayerColor(player, hover) {//get the player's color. hover =1 if want to get player's hover color
    if (player == 1) {
        if (hover == 1) {
            return P1_COLOR_HOVER;
        } else {
            return P1_COLOR;
        }
    } else if (player == 2) {
        if (hover == 1) {
            return P2_COLOR_HOVER;
        } else {
            return P2_COLOR;
        }
    } else if (player == 3) {
        if (hover == 1) {
            return P3_COLOR_HOVER;
        } else {
            return P3_COLOR;
        }
    }
}
function updateScoreBoard() {//update the score board with most recent scores
    p1ScoreBoard.innerText = p1Score;
    p2ScoreBoard.innerText = p2Score;
    p3ScoreBoard.innerText = p3Score;
}
function updateDimensions() {//update canvas dimensions to fit the cuurent window

    //update dimensions
    HEIGHT = window.innerHeight * 0.6;
    WIDTH = window.innerWidth * 0.6;
    if (HEIGHT >= WIDTH) {
        HEIGHT = WIDTH;
    } else {
        WIDTH = HEIGHT;
    }
    BOX_SIZE = WIDTH / (GRID_SIZE + 2);
    STROKE = BOX_SIZE / 12;
    DOT = STROKE;
    TOP_MARGIN = HEIGHT - (GRID_SIZE + 1) * BOX_SIZE;
    if (boxes.length == GRID_SIZE) {//if boxes is initialized
        for (let i = 0; i < GRID_SIZE; i++) {
            for (let j = 0; j < GRID_SIZE; j++) {
                boxes[i][j].resetDimensions(BOX_SIZE * (j + 1), TOP_MARGIN + BOX_SIZE * i, BOX_SIZE, BOX_SIZE);//update dimensions for boxes
            }
        }
    }
    let current_starting_page_status = document.getElementById("starting_page").style.display;
    if (current_starting_page_status == "none") {//only need to redraw when game board page is showing
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);//clear previous canvas with old dimensions
        canvas.height = HEIGHT;
        canvas.width = WIDTH;
        canvasContext.lineWidth = STROKE;
    }
    //redraw canvas with new dimensions
    let starting_page_status = document.getElementById("starting_page").style.display;
    if (starting_page_status == "none") {//only need to redraw when game board page is showing
        drawBoard();
        drawBoxes();
        drawGrid();
    }
}

function start() {//start the game from home page. 
    //Remove home page and display game board
    let home = document.getElementById("starting_page");
    home.style.display = "none";
    let gamePage = document.getElementById("game_page");
    gamePage.style.display = "flex";
    gamePage.style.flexDirection = "column"
    gamePage.style.alignItems = "center"
    gamePage.style.flexWrap = "wrap";
    canvas.style.display = "flex";//show canvas game board
    clear();//reset game status
}

function back() {//go back to the home page from game board. Remove game board and display home page
    clear();//clear game status
    playerID = 0;
    let playerMessage = document.getElementById("player");
    playerMessage.innerText = "Player ID Not Assigned";
    playerMessage.style.color = "black";
    message.innerText = "Waiting on more Players";
    message.style.color = "black";
    
    gameRunning = false;//set game running flag to false
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);//clear canvas
    //Remove game board and display home page
    let home = document.getElementById("starting_page");
    home.style.display = "flex";
    home.style.flexDirection = "column"
    home.style.alignItems = "center"
    let gamePage = document.getElementById("game_page");
    gamePage.style.display = "none";
}

function clear() {//reset the game status--------------------need to close socket connection
    p1Score = p2Score = p3Score = totalScore = 0;
    BOX_SIZE = WIDTH / (GRID_SIZE + 2);//the standard length of box sides
    STROKE = BOX_SIZE / 12;//the standard line width
    DOT = STROKE;//the standard dot radius
    TOP_MARGIN = HEIGHT - (GRID_SIZE + 1) * BOX_SIZE;
    canvasContext.lineWidth = STROKE;

    currentTurn = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
        boxes[i] = [];
        for (let j = 0; j < GRID_SIZE; j++) {
            boxes[i][j] = new Box(BOX_SIZE * (j + 1), TOP_MARGIN + BOX_SIZE * i, BOX_SIZE, BOX_SIZE);
        }
    }
}

function highlightSideReq(x, y) {//highlight the closest empty side.
    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            if (boxes[i][j].mouseInBox(x, y)) {
                let toBeHighlighted = boxes[i][j].highlightSide(x, y);//highlight the side that's closest to the mouse.
                if (toBeHighlighted) {// if there is a side to be highlighted
                    socket.emit('highlight', { boxI: i, boxJ: j, side: toBeHighlighted, room: roomID })
                    return;
                }else{
                    socket.emit('clearPrevHighlight',roomID);
                }
            }
        }

    }
}
function occupySideReq() {// allow the current player to occupy an unoccupied and highlighted side.
    socket.emit('occupySide', roomID);
}
//handling creating/joining/leaving a room
function createRoom() {
    socket.emit('createRoom')
}
function joinRoom() {
    const roomIDInput = document.getElementById("room_id").value;//---------------------------------------------------------
    socket.emit('joinRoom', roomIDInput, 0);
}
function leaveRoom(roomID) {
    socket.emit('leaveRoom', roomID);
}

function handleCreateRoom(player, room) {
    playerID = player;
    roomID = room;
    document.getElementById("current_room_id").innerText = roomID;
    initGame();
}

function handleJoinRoom(player, room) {
    playerID = player;
    roomID = room;
    document.getElementById("current_room_id").innerText = roomID;
    initGame();
    if (playerID > 0) {
        handleInitState(playerID);
    }
}

function handleRoomFull() {
    alert("This room is full, please create your own room or join another room.")
}
function handleRoomNotFound() {
    alert("Room Not Found!!!")
}
function handleRoomClosed(room) {
    alert('Room: ' + room + ' already closed');
}

//when the room is full and the game starts
function handleInitState(id) {//initializing player id and managing some page contents
    let backButton = document.getElementById("back");
    backButton.innerText = "Back to Homepage Diabled During Game";
    backButton.disabled = true;
    playerID = id;
    let playerMessage = document.getElementById("player");
    playerMessage.innerText = "You are player " + playerID;
    playerMessage.style.color = getPlayerColor(playerID, 0);
}
function handleGameState(state) {//receving new game state from server and update the client side game state
    let newState = JSON.parse(state);
    gameRunning = newState.gameRunning;
    currentTurn = newState.currentTurn;
    message.innerText = "Player " + currentTurn + "'s Turn";
    message.style.color = getPlayerColor(currentTurn, 0);
    if (newState.disconnected) {
        message.innerText = "A player disconnected, waiting on reconnection";
        message.style.color = "black";
    }
    p1Score = newState.player1Score;
    p2Score = newState.player2Score;
    p3Score = newState.player3Score;
    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            boxes[i][j].updateBox(newState.Boxes[i][j]);
        }
    }
    //draw the updated game status
    drawBoard();
    drawBoxes();
    drawGrid();
    updateScoreBoard();
}

function handleGameOver(gameResult) {//when the game finishes
    drawBoard();
    drawBoxes();
    drawGrid();
    updateScoreBoard();
    setTimeout(() => {
        alert(gameResult);
    }, 500);
    gameRunning = false;
    message.innerText = "Game Over! " + gameResult;
    message.style.color = "black";
    playerID = 0;
    roomID = 0;
    let backButton = document.getElementById("back");
    backButton.innerText = "Back to Homepage";
    backButton.disabled = false;
}


