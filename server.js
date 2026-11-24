const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_,res)=>res.json({ok:true, app:"Donkey Master"}));

const rooms = new Map();
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const rankValue = r => RANKS.indexOf(r);
const shuffle = a => { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const id = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const roomFor = socket => [...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
function deck(jokers=false){const d=[];for(const s of SUITS)for(const r of RANKS)d.push({rank:r,suit:s});if(jokers){d.push({rank:"JOKER",suit:"★",joker:true},{rank:"JOKER",suit:"★",joker:true});}return shuffle(d);}
function pub(room){
  return {code:room.code,host:room.host,game:room.game,started:room.started,
    players:room.players.map(p=>({id:p.id,name:p.name,host:p.id===room.host,connected:true,finished:p.finished||false,place:p.place||null,books:p.books||0,handCount:p.hand?.length||0,video:p.video||false})),
    state:room.state?{...room.state, pile:room.state.pile?.length||0, table:room.state.table?.map(x=>({playerId:x.playerId,card:x.card}))}:null};
}
function emitRoom(room){io.to(room.code).emit("room:update",pub(room));for(const p of room.players){io.to(p.id).emit("game:private",{hand:p.hand||[],myId:p.id,game:room.game,privateState:room.privateState?.[p.id]||null});}}
function notice(room,message){io.to(room.code).emit("notice",message);}
function nextAlive(room,fromIndex){for(let k=1;k<=room.players.length;k++){const i=(fromIndex+k)%room.players.length;if(!room.players[i].finished)return i;}return -1;}
function finishPlayer(room,p){if(p.finished)return;p.finished=true;p.place=room.players.filter(x=>x.finished).length;}
function donkeyEnd(room){const active=room.players.filter(p=>!p.finished);if(active.length<=1){if(active[0]){active[0].finished=true;active[0].place=room.players.length;}room.started=false;room.state.phase="finished";room.state.winner=room.players.filter(p=>p.place===1).map(p=>p.name);room.state.donkey=active[0]?.name||null;notice(room,`Game over! ${active[0]?.name||"The last player"} is the Donkey.`);}}
function startDonkey(room){
 const d=deck();room.players.forEach(p=>{p.hand=[];p.finished=false;p.place=null;});let i=0;while(d.length)room.players[i++%room.players.length].hand.push(d.pop());
 room.game="donkey";room.started=true;room.state={phase:"opening",leader:null,turn:null,table:[],leadSuit:null,highest:null,round:0,winner:null,donkey:null};
 const ace=room.players.findIndex(p=>p.hand.some(c=>c.rank==="A"&&c.suit==="♠"));
 room.state.leader=ace;room.state.turn=ace;room.state.openingIndex=ace;
 room.players.forEach(p=>{p.hand.sort((a,b)=>rankValue(b.rank)-rankValue(a.rank));});
 notice(room,`Donkey started. ${room.players[ace].name} has A♠ and opens the game.`);emitRoom(room);
}
function startBluff(room){
 const d=deck(true);room.players.forEach(p=>{p.hand=[];p.finished=false;p.place=null;});let i=0;while(d.length)room.players[i++%room.players.length].hand.push(d.pop());
 room.game="bluff";room.started=true;room.state={phase:"play",turn:0,rank:null,pile:[],lastPlay:null,passes:0,round:1};room.privateState={};
 notice(room,"Bluff started. Play cards face down and make your claim. Challenge a bluff when you dare.");emitRoom(room);
}
function startBook(room){
 const d=deck();room.players.forEach(p=>{p.hand=[];p.finished=false;p.place=null;p.books=0;});room.players.forEach(p=>{for(let i=0;i<4;i++)p.hand.push(d.pop());});
 room.game="book";room.started=true;room.state={phase:"ask",turn:0,deck:d,books:[],asker:null,target:null,rank:null,drawn:false};room.privateState={};
 notice(room,"Book started. Ask a player for a rank already in your hand.");emitRoom(room);
}
function startGame(room,game){
 if(room.players.length<2) return {error:"At least 2 players are required."};
 if(game==="donkey"&&room.players.length>6)return {error:"Donkey supports 3–6 players."};
 if(game==="donkey"&&room.players.length<3)return {error:"Real Donkey needs 3–6 players."};
 if(!["donkey","bluff","book"].includes(game))return {error:"Unknown game."};
 if(game==="donkey")startDonkey(room);if(game==="bluff")startBluff(room);if(game==="book")startBook(room);return {};
}
function player(room,sid){return room.players.find(p=>p.id===sid);}
function privateHand(room,p){io.to(p.id).emit("game:private",{hand:p.hand||[],myId:p.id,game:room.game,privateState:room.privateState?.[p.id]||null});}
function nextTurn(room){const s=room.state;s.turn=nextAlive(room,s.turn);if(s.turn<0){room.started=false;s.phase="finished";}}
function donkeyPlay(room,p,cardIndex){
 const s=room.state;if(s.phase==="finished"||s.turn!==room.players.indexOf(p))return;
 if(!Number.isInteger(cardIndex)||cardIndex<0||cardIndex>=p.hand.length)return;
 const card=p.hand[cardIndex];
 if(s.phase==="opening"){
   if(p.id!==room.players[s.openingIndex].id)return;
   if(card.rank!=="A"||card.suit!=="♠")return;
   p.hand.splice(cardIndex,1);s.table=[{playerId:p.id,card}];s.leadSuit="♠";s.highest={playerId:p.id,card};s.phase="opening-follow";s.openingPlayed=true;
   // Opening A♠ is discarded with all spades held by others.
   let removed=[card];for(const other of room.players){if(other===p)continue;const ix=other.hand.findIndex(c=>c.suit==="♠");if(ix>=0)removed.push(other.hand.splice(ix,1)[0]);}
   s.table=[];s.phase="normal";s.leader=room.players.indexOf(p);s.turn=s.leader;
   finishIfEmptyDonkey(room,p);notice(room,`A♠ opens the game. ${removed.length} spade card(s) discarded. ${p.name} leads next.`);emitRoom(room);return;
 }
 if(s.phase==="normal"){
   if(s.table.length===0){p.hand.splice(cardIndex,1);s.leadSuit=card.suit;s.table.push({playerId:p.id,card});s.highest={playerId:p.id,card};finishIfEmptyDonkey(room,p);s.turn=nextAlive(room,room.players.indexOf(p));s.phase="following";}
   else return;
 } else if(s.phase==="following"){
   if(card.suit!==s.leadSuit && p.hand.some(c=>c.suit===s.leadSuit))return;
   p.hand.splice(cardIndex,1);s.table.push({playerId:p.id,card});
   if(card.suit!==s.leadSuit){
     const hit=s.highest;const winner=player(room,hit.playerId);s.table.forEach(x=>winner.hand.push(x.card));s.table=[];s.phase="normal";s.leader=room.players.indexOf(winner);s.turn=s.leader;
     notice(room,`${p.name} hit with ${card.rank}${card.suit}! ${winner.name} picks up the pile and leads again.`);
     emitRoom(room);return;
   }
   if(rankValue(card.rank)>rankValue(s.highest.card.rank))s.highest={playerId:p.id,card};
   const active=room.players.filter(x=>!x.finished);
   const acted=new Set(s.table.map(x=>x.playerId));
   const pending=active.filter(x=>!acted.has(x.id));
   if(pending.length){s.turn=room.players.indexOf(pending[0]);}
   else{
     const winner=player(room,s.highest.playerId);s.table=[];s.phase="normal";s.leader=room.players.indexOf(winner);s.turn=s.leader;
     finishIfEmptyDonkey(room,p);notice(room,`${winner.name} wins the trick and leads the next round.`);
   }
 }
 emitRoom(room);
}
function finishIfEmptyDonkey(room,p){if(p.hand.length===0){finishPlayer(room,p);notice(room,`${p.name} is safe! Place ${p.place}.`);}}
function bluffAction(room,p,a){
 const s=room.state;if(s.phase!=="play"||s.turn!==room.players.indexOf(p))return;
 if(a.type==="play"){
   const indices=a.indices;if(!Array.isArray(indices)||!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=p.hand.length))return;
   if(s.rank&&a.rank!==s.rank)return;
   if(!RANKS.includes(a.rank))return;
   const unique=[...new Set(indices)];if(unique.length!==indices.length)return;
   const cards=unique.map(i=>p.hand[i]);if(cards.some(c=>!c.joker&&c.rank!==a.rank))return;
   unique.sort((x,y)=>y-x).forEach(i=>p.hand.splice(i,1));
   s.rank=s.rank||a.rank;s.pile.push(...cards);s.lastPlay={playerId:p.id,claimed:a.rank,count:cards.length,cards};s.passes=0;
   const nxt=nextAlive(room,room.players.indexOf(p));s.turn=nxt;
   if(p.hand.length===0){finishPlayer(room,p);notice(room,`${p.name} has played all cards. First place!`);}
   emitRoom(room);return;
 }
 if(a.type==="pass"){
   s.passes++;s.turn=nextAlive(room,room.players.indexOf(p));
   if(s.passes>=room.players.filter(x=>!x.finished).length){s.passes=0;s.rank=null;s.lastPlay=null;s.pile=[];s.round++;notice(room,"Everyone passed. The table is cleared; the next player starts a new claim.");}
   emitRoom(room);return;
 }
 if(a.type==="challenge"){
   if(!s.lastPlay||s.lastPlay.playerId===p.id)return;
   const truthful=s.lastPlay.cards.every(c=>c.joker||c.rank===s.lastPlay.claimed);
   const pickup=truthful?p:player(room,s.lastPlay.playerId);
   pickup.hand.push(...s.pile);const count=s.pile.length;s.pile=[];s.rank=null;s.lastPlay=null;s.passes=0;s.turn=room.players.indexOf(pickup);
   notice(room,truthful?`${p.name} called bluff, but the claim was TRUE. ${p.name} takes ${count} cards.`:`${p.name} caught a bluff! ${pickup.name} takes ${count} cards.`);
   emitRoom(room);return;
 }
}
function bookAsk(room,p,a){
 const s=room.state;if(s.phase!=="ask"||s.turn!==room.players.indexOf(p))return;
 if(a.type==="ask"){
   const target=player(room,a.targetId);if(!target||target===p||target.hand.length===0||!p.hand.some(c=>c.rank===a.rank))return;
   const matches=target.hand.filter(c=>c.rank===a.rank);
   if(matches.length){target.hand=target.hand.filter(c=>c.rank!==a.rank);p.hand.push(...matches);notice(room,`${p.name} received ${matches.length} ${a.rank}(s) from ${target.name}. Ask again.`);checkBooks(room,p);if(target.hand.length===0&&s.deck.length===0)target.finished=true;}
   else if(s.deck.length){p.hand.push(s.deck.pop());notice(room,`${target.name} had no ${a.rank}. ${p.name} draws a card.`);checkBooks(room,p);s.turn=nextAlive(room,room.players.indexOf(p));}
   else{s.turn=nextAlive(room,room.players.indexOf(p));notice(room,`${target.name} had no ${a.rank}. No cards remain to draw.`);}
 }else if(a.type==="end"){
   s.turn=nextAlive(room,room.players.indexOf(p));notice(room,`${p.name} ends their turn.`);
 }
 const live=room.players.filter(x=>x.hand.length>0);
 if(live.length<=1||room.players.every(x=>x.hand.length===0)||s.deck.length===0&&room.players.filter(x=>x.hand.length>0).length===0){
   room.started=false;s.phase="finished";const max=Math.max(...room.players.map(x=>x.books));s.winners=room.players.filter(x=>x.books===max).map(x=>x.name);notice(room,`Book game over! Most books: ${s.winners.join(", ")} (${max}).`);
 }
 emitRoom(room);
}
function checkBooks(room,p){
 for(const r of [...new Set(p.hand.map(c=>c.rank))]){const cards=p.hand.filter(c=>c.rank===r);if(cards.length===4){p.hand=p.hand.filter(c=>c.rank!==r);p.books++;room.state.books.push({player:p.name,rank:r});notice(room,`${p.name} completed a book of four ${r}s!`);}}
}
io.on("connection",socket=>{
 socket.on("room:create",({name},cb)=>{const code=id();const room={code,host:socket.id,players:[{id:socket.id,name:String(name||"Host").slice(0,20),hand:[],video:false}],game:null,started:false,state:null};rooms.set(code,room);socket.join(code);cb?.({ok:true,code});emitRoom(room);});
 socket.on("room:join",({code,name},cb)=>{const room=rooms.get(String(code||"").toUpperCase());if(!room)return cb?.({ok:false,error:"Room code not found."});if(room.started)return cb?.({ok:false,error:"A game is already in progress."});if(room.players.length>=6)return cb?.({ok:false,error:"This room is full (maximum 6 players)."});const p={id:socket.id,name:String(name||"Player").slice(0,20),hand:[],video:false};room.players.push(p);socket.join(room.code);cb?.({ok:true,code:room.code});notice(room,`${p.name} joined the room.`);emitRoom(room);});
 socket.on("game:start",({game},cb)=>{const room=roomFor(socket);if(!room||room.host!==socket.id)return cb?.({ok:false,error:"Only the host can start a game."});const result=startGame(room,game);cb?.({ok:!result.error,...result});});
 socket.on("game:donkey-play",({index})=>{const room=roomFor(socket);const p=room&&player(room,socket.id);if(room&&p&&room.game==="donkey")donkeyPlay(room,p,index);});
 socket.on("game:bluff",a=>{const room=roomFor(socket);const p=room&&player(room,socket.id);if(room&&p&&room.game==="bluff")bluffAction(room,p,a);});
 socket.on("game:book",a=>{const room=roomFor(socket);const p=room&&player(room,socket.id);if(room&&p&&room.game==="book")bookAsk(room,p,a);});
 socket.on("video:status",({enabled})=>{const room=roomFor(socket);const p=room&&player(room,socket.id);if(p){p.video=!!enabled;emitRoom(room);}});
 socket.on("webrtc:signal",({to,signal})=>io.to(to).emit("webrtc:signal",{from:socket.id,signal}));
 socket.on("disconnect",()=>{const room=roomFor(socket);if(!room)return;room.players=room.players.filter(p=>p.id!==socket.id);if(!room.players.length){rooms.delete(room.code);return;}if(room.host===socket.id)room.host=room.players[0].id;notice(room,"A player disconnected.");emitRoom(room);});
});
const PORT=process.env.PORT||3000;
server.listen(PORT,"0.0.0.0",()=>console.log(`Donkey Master running on http://localhost:${PORT}`));
