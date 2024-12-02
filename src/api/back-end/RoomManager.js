import { jsonToMap } from "../data-formats/json-map-switch";
import Autobee from "../holepunch/Autobee";
import BlindPairing from "blind-pairing";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import RAM from "random-access-memory";
import b4a from "b4a";
import z32 from "z32";
import c from "compact-encoding";
import sodium from "sodium-native";
import { EventEmitter } from "events";

/**
 * @typedef {Object} RoomManagerOptions
 * @property {Corestore} [corestore] - Optional preconfigured Corestore instance
 * @property {string} [storageDir] - Optional storage directory path
 * @property {Hyperswarm} [swarm] - Optional preconfigured Hyperswarm instance
 * @property {BlindPairing} [pairing] - Optional preconfigured BlindPairing instance
 */
/**
 * Manages multiple breakout rooms and their resources
 * @extends EventEmitter
 */
export class RoomManager extends EventEmitter {
  /**
   * Creates a new RoomManager instance
   * @param {RoomManagerOptions} [opts={}] - Configuration options
   */
  constructor(opts = {}) {
    super();
    this.internalManaged = { corestore: false, swarm: false, pairing: false };
    if (opts.corestore) this.corestore = opts.corestore;
    else {
      this.internalManaged.corestore = true;
      if (opts.storageDir) this.corestore = new Corestore(opts.storageDir);
      else this.corestore = new Corestore(RAM.reusable());
    }
    this.swarm = opts.swarm ? opts.swarm : ((this.internalManaged.swarm = true), new Hyperswarm());
    this.pairing = opts.pairing ? opts.pairing : ((this.internalManaged.pairing = true), new BlindPairing(this.swarm));
    this.rooms = {};
  }

  /**
   * Gets configuration options for a new room
   * @param {string} roomId - Unique room identifier
   * @returns {Object} Room configuration options
   */
  getRoomOptions(roomId) {
    const corestore = roomId ? this.corestore.namespace(roomId) : this.corestore;
    return { corestore, swarm: this.swarm, pairing: this.pairing };
  }

  /**
   * initializes a calendar room
   * (or creates if no roomId provided)
   * @param {Object} [opts={}] - Room configuration options
   * @param {string} [opts.invite] - Optional invite code
   * @param {Object} [opts.metadata] - Optional room metadata
   * @returns {CalendarRoom} New room instance
   */
  initRoom(opts = {}) {
    const roomId = opts.roomId || generateRoomId();
    const baseOpts = this.getRoomOptions(roomId);
    if (opts.invite) baseOpts.invite = opts.invite;
    baseOpts.topic = opts.topic || generateTopic();
    baseOpts.metadata = opts.metadata || {};
    baseOpts.roomId = roomId;
    const room = new CalendarRoom(baseOpts);
    this.rooms[roomId] = room;
    room.on("roomClosed", () => {
      delete this.rooms[roomId];
      if (this.closingDown) return;
      if (Object.keys(this.rooms).length > 0) return;
      process.nextTick(() => this.emit("lastRoomClosed"));
    });
    process.nextTick(() => this.emit("newRoom", room));
    return room;
  }

  async initReadyRoom(opts = {}) {
    const room = this.initRoom(opts);
    const invite = await room.ready();

    process.nextTick(() => this.emit("readyRoom", room));
    return { invite, room };
  }

  async cleanup() {
    const exitPromises = Object.values(this.rooms).map((room) => room.exit());
    await Promise.all(exitPromises);
    this.rooms = {};

    // Clean up other resources
    if (this.internalManaged.pairing) await this.pairing.close();
    if (this.internalManaged.swarm) await this.swarm.destroy();
    if (this.internalManaged.corestore) await this.corestore.close();
  }

  isClosingDown() {
    return this.closingDown;
  }
}

/**
 * @typedef {Object} CalendarRoomOptions
 * @property {string} [roomId] - Optional room identifier
 * @property {Corestore} [corestore] - Optional Corestore instance
 * @property {string} [storageDir] - Optional storage directory
 * @property {Hyperswarm} [swarm] - Optional Hyperswarm instance
 * @property {BlindPairing} [pairing] - Optional BlindPairing instance
 * @property {string} [invite] - Optional invite code
 * @property {Object} [metadata] - Optional room metadata
 */

/**
 * Represents a single breakout room for peer-to-peer communication
 * @extends EventEmitter
 */
export class CalendarRoom extends EventEmitter {
  /**
   * Creates a new CalendarRoom instance
   * @param {CalendarRoomOptions} [opts={}] - Room configuration options
   */
  constructor(opts = {}) {
    super();
    this.roomId = opts.roomId || generateRoomId();
    this.topic = opts.topic;
    this.internalManaged = { corestore: false, swarm: false, pairing: false };
    if (opts.corestore) this.corestore = opts.corestore;
    else {
      this.internalManaged.corestore = true;
      if (opts.storageDir) this.corestore = new Corestore(opts.storageDir);
      else this.corestore = new Corestore(RAM.reusable());
    }
    this.swarm = opts.swarm ? opts.swarm : ((this.internalManaged.swarm = true), new Hyperswarm());
    this.pairing = opts.pairing ? opts.pairing : ((this.internalManaged.pairing = true), new BlindPairing(this.swarm));
    this.autobee = new Autobee(this.corestore, null, { apply, valueEncoding: c.any }).on("error", (err) =>
      console.error("An error occurred in Autobee:", err)
    );
    if (opts.invite) this.invite = z32.decode(opts.invite);
    this.metadata = opts.metadata || {};
    this.initialized = false;
  }

  /**
   * Initializes the room and sets up event handlers
   * @returns {Promise<string|void>} Returns invite code if room is host
   * TODO: connect to room topic on join (not just on restart)
   */
  async ready() {
    if (this.initialized) return this.invite;
    this.initialized = true;
    await this.autobee.ready();

    this.swarm.on("connection", async (conn) => {
      console.log("new peer connected!");
      await this.corestore.replicate(conn);
    });

    if (this.invite) {
      const candidate = this.pairing.addCandidate({
        invite: this.invite,
        userData: this.autobee.local.key,
        onadd: async (result) => this._onHostInvite(result),
      });
      await candidate.paring;
    } else {
      const baseOpts = {
        data: this.topic,
        sensitive: false,
        expires: 0,
      };
      const { invite, publicKey, discoveryKey, additional } = BlindPairing.createInvite(
        this.autobee.local.key,
        baseOpts
      );
      this.metadata.host = {
        publicKey: z32.encode(publicKey),
        discoveryKey: z32.encode(discoveryKey),
      };
      const member = this.pairing.addMember({
        discoveryKey,
        onadd: (candidate) => this._onAddMember(publicKey, candidate, additional),
      });
      await member.flushed();
      this.topic = this.topic || generateTopic();
      this.connectTopic();

      this.invite = invite;
      return z32.encode(invite);
    }
  }

  async connectTopic() {
    try {
      console.log("joining topic on", b4a.toString(this.topic, "hex"));
      const discovery = this.swarm.join(this.topic);
      await discovery.flushed();
    } catch (err) {
      console.error("Error joining swarm topic", err);
    }
  }

  getRoomInfo() {
    return {
      invite: z32.encode(this.invite),
      roomId: this.roomId,
      metadate: this.metadata,
    };
  }

  /**
   * adjusts the rooms calendar
   * @param {Map} data - Canlendar Map
   * @returns {Promise<void>}
   */
  async adjustCalendar(data) {
    await this.autobee.append({
      when: Date.now(),
      who: z32.encode(this.autobee.local.key),
      data,
    });
  }

  async _onHostInvite(result) {
    if (result.data) this.topic = result.data;
    if (result.key) {
      this._connectOtherCore(result.key);
      this.metadata.host = {
        publicKey: z32.encode(result.key),
      };
    }
    this.connectTopic();
  }

  async _onAddMember(publicKey, candidate, additional) {
    candidate.open(publicKey);
    candidate.confirm({ key: this.autobee.local.key, additional });
    this._connectOtherCore(candidate.userData);
  }

  async _connectOtherCore(key) {
    await this.autobee.append({ type: "addWriter", key });
    this.emit("peerEntered", z32.encode(key));
  }

  /**
   * Retrieves the complete room message history
   * @returns {Promise<Array>} Array of message entries
   */
  async getTranscript() {
    const transcript = [];
    await this.autobee.update();
    for (let i = 0; i < this.autobee.view.length; i++) {
      transcript.push(await this.autobee.view.get(i));
    }
    return transcript;
  }

  async exit() {
    await this.autobee.update();
    this.swarm.leave(this.autobee.local.discoveryKey);
    await this.autobee.close();
    if (this.internalManaged.pairing) await this.pairing.close();
    if (this.internalManaged.swarm) await this.swarm.destroy();
    if (this.internalManaged.corestore) await this.corestore.close();
    this.emit("roomClosed");
    this.removeAllListeners(); // clean up listeners
  }

  isClosingDown() {
    return this.closingDown;
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

    // handling "updateSchedule" operation: update requests and schedule between shared peers
    if (op.type === "updateSchedule") {
      const scheduleMap = jsonToMap(op.schedule);
      console.log("Schedule updated:", scheduleMap);
      // TODO: add api to request a new change
      // TODO: add api to calculate free time for both parties (store their sharing calendar in autobee)
    }

    // Handling "addWriter" operation: adding a writer to the database
    if (op.type === "addWriter") {
      console.log("\rAdding writer", b4a.toString(op.key, "hex"));
      await base.addWriter(op.key);
      continue;
    }
  }
  // Pass through to Autobee's default apply behavior
  await Autobee.apply(batch, view, base);
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

/**
 * Generates random 32byte topic
 * @returns {Object} - buffer
 */
function generateTopic() {
  const buffer = Buffer.alloc(32);
  sodium.randombytes_buf(buffer);
  console.log("created topic key", b4a.toString(buffer, "hex"));
  return buffer;
}
