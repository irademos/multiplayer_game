const Peer = window.Peer;

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.peer = new Peer();
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;
    this.db = firebase.database();  // use compat global object

    // Step 1: Assign to a room
    this.peer.on('open', async id => {
      this.id = id;
    
      const roomsRef = this.db.ref('rooms');
      const snapshot = await roomsRef.get();
    
      let assignedRoom = null;
      let roomIndex = 0;
    
      if (snapshot.exists()) {
        const rooms = snapshot.val();
        for (const roomName in rooms) {
          const peersInRoom = Object.keys(rooms[roomName]);
          if (peersInRoom.length < 20) {
            assignedRoom = roomName;
            break;
          }
          roomIndex++;
        }
      }
    
      if (!assignedRoom) {
        assignedRoom = `room-${roomIndex}`;
      }
    
      // Step 2: Register peer in room and general list
      const roomRef = this.db.ref(`rooms/${assignedRoom}/${id}`);
      await roomRef.set(true);
    
      const peerRef = this.db.ref(`peers/${id}`);
      await peerRef.set({
        name: this.playerName,
        roomId: assignedRoom,
        timestamp: Date.now()
      });
    
      // Cleanup on exit
      window.addEventListener('beforeunload', () => {
        roomRef.remove();
        peerRef.remove();
      });
    
      // Step 3: Listen to peers in the same room
      this.db.ref(`rooms/${assignedRoom}`).on('value', snapshot => {
        const roomPeers = snapshot.val() || {};
        for (const peerId in roomPeers) {
          if (peerId !== this.id && !this.connections[peerId]) {
            this.connectToPeer(peerId);
          }
        }
      });
    });

    

    this.peer.on('connection', conn => {
      this.setupConnection(conn);
    });

    // List all peers in Firebase
    this.db.ref('peers').on('value', snapshot => {
      const peers = snapshot.val() || {};
      console.log("Available peers:", peers);
    });
  }

  connectToPeer(peerId) {
    const conn = this.peer.connect(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      conn.on('data', data => {
        this.onPeerData(conn.peer, data);
      });
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
    });

    conn.on('error', err => {
      console.error('Peer error:', err);
    });
  }

  send(data) {
    Object.values(this.connections).forEach(conn => conn.send(data));
  }

  getId() {
    return this.id;
  }
}
