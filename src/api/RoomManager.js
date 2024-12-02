import Autobase from "autobase";
import BlindPairing from "blind-pairing";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import z32 from "z32";
import c from "compact-encoding";

export class RoomManager {
  constructor(opts = {}) {
    this.corestore = new Corestore(opts.storageDir);
    this.swarm = new Hyperswarm();
    this.pairing = new BlindPairing(this.swarm);
    this.rooms = {};
  }

  getRoomOptions(roomId) {
    const corestore = roomId ? this.corestore.namespace(roomId) : this.corestore;
    return { corestore, swarm: this.swarm, pairing: this.pairing };
  }

  initRoom(opts = {}) {
    const roomId = opts.roomId || generateRoomId();
    const baseOpts = this.getRoomOptions(roomId);
    if (opts.invite) baseOpts.invite = opts.invite;
    baseOpts.metadata = opts.metadata || {};
    baseOpts.roomId = roomId;
    const room = new CalendarRoom(baseOpts);
    this.rooms[roomId] = room;

    return room;
  }

  async initReadyRoom(opts = {}) {
    const room = this.initRoom(opts);
    const invite = await room.ready();

    return { invite, room };
  }

  async cleanup() {
    const exitPromises = Object.values(this.rooms).map((room) => room.exit());
    await Promise.all(exitPromises);
    this.rooms = {};

    // Clean up other resources
    await this.pairing.close();
    await this.swarm.destroy();
    await this.corestore.close();
  }
}

export class CalendarRoom {
  constructor(opts = {}) {
    this.roomId = opts.roomId || generateRoomId();
    this.corestore = opts.corestore;
    this.swarm = opts.swarm;
    this.pairing = opts.pairing;
    this.autobase = new Autobase(this.corestore, null, { apply, valueEncoding: c.any }).on("error", (err) =>
      console.error("An error occurred in Autobase:", err)
    );
    if (opts.invite) this.invite = z32.decode(opts.invite);
  }

  async ready() {
    await this.autobase.ready();

    this.swarm.on("connection", async (conn) => {
      await this.autobase.replicate(conn);
    });

    if (this.invite) {
      const candidate = this.pairing.addCandidate({
        invite: this.invite,
        userData: this.autobase.local.key,
        onadd: async (result) => this._onHostInvite(result),
      });
      await candidate.paring;
    } else {
      const { invite, publicKey, discoveryKey } = BlindPairing.createInvite(this.autobase.local.key);
      const member = this.pairing.addMember({
        discoveryKey,
        onadd: (candidate) => this._onAddMember(publicKey, candidate),
      });
      await member.flushed();
      this.invite = invite;
      return z32.encode(invite);
    }
  }

  async _onHostInvite(result) {
    if (result.key) {
      this._connectOtherCore(result.key);
    }
  }

  async _onAddMember(publicKey, candidate) {
    candidate.open(publicKey);
    candidate.confirm({ key: this.autobase.local.key });
    this._connectOtherCore(candidate.userData);
  }

  async _connectOtherCore(key) {
    await this.autobase.append({ type: "addWriter", key });
  }

  async exit() {
    await this.autobase.update();
    this.swarm.leave(this.autobase.local.discoveryKey);
    await this.autobase.close();
  }
}

// use apply to handle updates
/**
 * Applies updates to autobee
 * @param {Array} batch - Array of nodes to process
 * @param {Object} view - View instance
 * @param {Object} base - Base instance
 * @returns {Promise<void>}
 */
async function apply(batch, view, base) {
  for (const node of batch) {
    console.log(node);
    const op = node.value;

    if (op.type === "test") {
      console.log("package received:", op.testStr);
      continue;
    }

    if (op.type === "addWriter") {
      await base.addWriter(op.key);
      continue;
    }
  }
}

/**
 * Generates a unique room identifier
 * @returns {string} Unique room ID combining timestamp and random string
 */
function generateRoomId() {
  const timestamp = Date.now().toString(36); // Base36 timestamp
  const random = Math.random().toString(36).slice(2, 5); // 5 random chars
  return `room-${timestamp}-${random}`;
}
