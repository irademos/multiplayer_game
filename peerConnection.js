import { db } from './firebase-init.js';
import {
  ref,
  set,
  remove,
  onValue,
  get,
  child
} from 'firebase/database';

const Peer = window.Peer;

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.peer = new Peer();
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;

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

      // Register peer
      const roomRef = ref(db, `rooms/${assignedRoom}/${id}`);
      await set(roomRef, true);

      const peerRef = ref(db, `peers/${id}`);
      await set(peerRef, {
        name: this.playerName,
        roomId: assignedRoom,
        timestamp: Date.now()
      });

      // Cleanup on unload
      window.addEventListener('beforeunload', () => {
        remove(roomRef);
        remove(peerRef);
      });

      // Connect to peers in room
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
      // console.log('All peers:', peers);
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
