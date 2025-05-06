import { db } from './firebase-init.js';
import {
  ref,
  set,
  remove,
  onValue,
  get
} from 'firebase/database';

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;

    this.initPeer(); // Start async setup
  }

  async initPeer() {
    // Fetch TURN credentials
    const response = await fetch(`https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${import.meta.env.VITE_METERED_API_KEY}`);
    const dynamic = await response.json();

    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      ...dynamic
    ];

    this.peer = new Peer({
      config: { iceServers }
    });

    this.peer.on('open', async id => {
      this.id = id;

      const roomsRef = ref(db, 'rooms');
      const snapshot = await get(roomsRef);

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

      const roomRef = ref(db, `rooms/${assignedRoom}/${id}`);
      await set(roomRef, true);

      const peerRef = ref(db, `peers/${id}`);
      await set(peerRef, {
        name: this.playerName,
        roomId: assignedRoom,
        timestamp: Date.now()
      });

      window.addEventListener('beforeunload', () => {
        remove(roomRef);
        remove(peerRef);
      });

      onValue(ref(db, `rooms/${assignedRoom}`), snapshot => {
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

    onValue(ref(db, 'peers'), snapshot => {
      const peers = snapshot.val() || {};
    });
  }

  connectToPeer(peerId) {
    const conn = this.peer.connect(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      conn.on('data', data => this.onPeerData(conn.peer, data));
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
