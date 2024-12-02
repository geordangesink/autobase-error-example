// PeersView.js
import { html } from "htm/react";
import { useEffect, useState, useRef } from "react";
import { mapToJson, jsonToMap } from "../api/json-map-switch";
import { RoomManager } from "../api/RoomManager";
import Hyperbee from "hyperbee";
import Hypercore from "hypercore";
import c from "compact-encoding";

export default () => {
  const localBeeRef = useRef();
  const roomIdRef = useRef("");
  const roomManagerRef = useRef(new RoomManager({ storageDir: "./calendarStorage/roomManager" }));
  const [searchInput, setSearchInput] = useState();

  Pear.teardown(async () => {
    await roomManagerRef.current.cleanup();
  });

  useEffect(() => {
    (async () => {
      localBeeRef.current = await initPersonalDB();
      await loadSharedDbs(localBeeRef.current); // returns an array of all saved rooms
    })();
  }, []);

  const handleNewRoom = async () => {
    await getCalendarRoom();
  };

  const handleJoinRoom = async () => {
    await getCalendarRoom({ invite: searchInput });
  };

  const getCalendarRoom = async (opts = {}) => {
    const { room, invite } = await roomManagerRef.current.initReadyRoom(opts);

    roomIdRef.current = room.roomId;
    console.log("invite key:", invite);

    addRoomNamespaceToDb(room, localBeeRef.current);

    return room;
  };

  const loadSharedDbs = async (localBee) => {
    const data = await localBee.get("roomsDetails");

    if (data) {
      const dataMap = jsonToMap(data.value.toString());
      const rooms = [];
      for (const [roomId] of dataMap) {
        const room = await getCalendarRoom({ roomId });
        rooms.push(room);
      }
      return rooms;
    }
  };

  return html`
    <section className="peers">
      <section className="join-or-create">
        <button className="button-square" onClick=${handleJoinRoom}>Join Calendar</button>

        <button className="button-square" onClick=${handleNewRoom}>Create Calendar</button>
      </section>

      <input type="text" placeholder="invite key (for join)" onChange=${(e) => setSearchInput(e.target.value)} />
    </section>
  `;
};

async function addRoomNamespaceToDb(room, localBee) {
  // store room id in personal db
  let roomsDetailsDb = await localBee.get("roomsDetails");
  const roomsDetails = roomsDetailsDb && roomsDetailsDb.value ? jsonToMap(roomsDetailsDb.value.toString()) : new Map();

  if (!roomsDetails.has(room.roomId)) {
    roomsDetails.set(room.roomId, "no value");
    localBee.put("roomsDetails", Buffer.from(mapToJson(roomsDetails)));
  }
}

// load personal DB (Hyperbee)
const initPersonalDB = async () => {
  try {
    const storagePath = "./calendarStorage/localBee";
    const core = new Hypercore(storagePath);
    await core.ready();

    const bee = new Hyperbee(core, {
      keyEncoding: "utf-8",
      valueEncoding: c.any,
    });
    await bee.ready();

    return bee;
  } catch (error) {
    console.error("Error initializing Personal database:", error);
  }
};
