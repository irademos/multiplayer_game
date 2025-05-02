import Peer from 'peerjs';

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.peer = new Peer();
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;

    this.peer.on('open', id => {
      console.log('My peer ID is: ' + id);
    });

    this.peer.on('connection', conn => {
      this.setupConnection(conn);
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
    for (let peerId in this.connections) {
      this.connections[peerId].send(data);
    }
  }

  getId() {
    return this.peer.id;
  }
}
