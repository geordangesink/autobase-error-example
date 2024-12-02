import { html } from "htm/react";
import { createContext, useEffect, useState, useRef } from "react";
import { mapToJson, jsonToMap } from "../api/json-map-switch";
import { RoomManager } from "../api/RoomManager";
import Hyperbee from "hyperbee";
import Hypercore from "hypercore";
import b4a from "b4a";
import c from "compact-encoding";

const ScheduleContext = createContext();

const ScheduleProvider = ({ children }) => {
  const [currentSchedule, setCurrentSchedule] = useState(new Map());
  const [sharedDbObject, setSharedDbObject] = useState(new Object());
  const [inviteHexKey, setInviteHexKey] = useState("no invite key stored");
  const db = useRef();
  const roomManagerRef = useRef();
  const calendarNameRef = useRef("My Calendar");
  const roomIdRef = useRef("MyCalendar");

  Pear.teardown(async () => {
    await roomManagerRef.current.cleanup();
  });

  useEffect(() => {
    initPersonalDB().then(initRoomManager).then(loadSharedDbs);

    async function initRoomManager() {
      roomManagerRef.current = new RoomManager({ storageDir: "./calendarStorage/roomManager" });
    }
  }, []); // on start

  useEffect(() => {
    console.log(inviteHexKey);
  }, [inviteHexKey]);

  // load personal DB (Hyperbee)
  const initPersonalDB = async () => {
    try {
      const storagePath = "./calendarStorage/MyCalendar";
      const core = new Hypercore(storagePath);
      await core.ready();

      const bee = new Hyperbee(core, {
        keyEncoding: "utf-8",
        valueEncoding: c.any,
      });
      await bee.ready();

      // fetch or init personal schedule
      const result = await bee.get("schedule");
      if (result && result.value) {
        const scheduleMap = jsonToMap(result.value.toString());
        setCurrentSchedule(scheduleMap); // set displayed schedule
      } else {
        const newSchedule = new Map();
        setCurrentSchedule(newSchedule);
        await bee.put("schedule", Buffer.from(mapToJson(newSchedule)));
      }
      db.current = bee;
    } catch (error) {
      console.error("Error initializing Personal database:", error);
    }
  };

  // load selected shared DB
  const getCalendarRoom = async (newInvite = undefined, newRoom = false, roomId = undefined, topic = undefined) => {
    try {
      const { room, invite } = await roomManagerRef.current.initReadyRoom({ invite: newInvite, roomId, topic });
      roomIdRef.current = room.roomId;

      const bee = room.autobee;
      const scheduleObj = await bee.get("schedule");

      let scheduleMap;
      if (scheduleObj && scheduleObj.value) {
        scheduleMap = jsonToMap(scheduleObj.value.toString());
      } else {
        scheduleMap = new Map();
      }
      const roomName = "Unnamed Room";
      if (newRoom) addNewRoomToDb(room, roomName, invite);
      setCurrentSchedule(scheduleMap);

      return room;
    } catch (error) {
      console.error("Error initializing Shared database:", error);
    }
  };

  // load and mount all shared db on first load
  // they are saved as [folderKey][beeKey,name] Map...
  const loadSharedDbs = async () => {
    const data = await db.current.get("roomsDetails");

    if (data) {
      const dataMap = jsonToMap(data.value.toString());
      // mount every db onto state
      for (const [roomId, details] of dataMap) {
        const name = details.get("name");
        const topic = details.get("topic");
        const room = await getCalendarRoom(undefined, false, roomId, b4a.from(topic, "hex"));
        const beeKey = room.autobee.local.key;
        const dataObject = {
          name,
          topic,
          room,
          beeKey,
        };

        // add db to mounted shared DBs
        setSharedDbObject((sharedDbObject) => {
          const updatedDbObject = {
            ...sharedDbObject,
            [roomId]: dataObject,
          };

          return updatedDbObject; // Ensure state update returns the new object
        });
      }
    }
  };

  const addNewRoomToDb = async (room, name = "Unnamed Room", invite) => {
    calendarNameRef.current = name;
    const dataObject = {
      name,
      topic: b4a.toString(room.topic, "hex"),
      room,
      beeKey: room.autobee.local.key,
    };
    setInviteHexKey(invite);
    // add db to mounted shared DBs
    setSharedDbObject((sharedDbObject) => {
      const updatedDbObject = {
        ...sharedDbObject,
        [room.roomId]: dataObject,
      };

      return updatedDbObject; // Ensure state update returns the new object
    });

    // store folder key and room id in personal db
    let roomsDetailsDb = await db.current.get("roomsDetails");
    const roomsDetails =
      roomsDetailsDb && roomsDetailsDb.value ? jsonToMap(roomsDetailsDb.value.toString()) : new Map();

    if (!roomsDetails.has(roomIdRef.current)) {
      const details = new Map([
        ["name", name],
        ["topic", b4a.toString(room.topic, "hex")],
      ]);
      roomsDetails.set(room.roomId, details);
      db.current.put("roomsDetails", Buffer.from(mapToJson(roomsDetails)));
    }
  };

  const setSchedule = async (updated) => {
    setCurrentSchedule(updated);

    // update stored calendar (personal and/or shared)
    if (roomIdRef.current === "MyCalendar") {
      if (db.current && db.current.writable) {
        try {
          await db.current.put("schedule", Buffer.from(mapToJson(updated)));
        } catch (err) {
          console.error("Error updating schedule in personal database:", err);
        }
      }
    } else {
      //////// NEED TO EDIT
      if (sharedDbObject[roomIdRef.current] && sharedDbObject[roomIdRef.current].room.autobee.writable) {
        const bee = sharedDbObject[roomIdRef.current].room.autobee;

        try {
          await bee.put("schedule", Buffer.from(mapToJson(updated)));
        } catch (err) {
          console.error("Error updating schedule in shared database:", err);
        }
      } else {
        console.error("No room or not writable");
      }
    }
  };

  // provide both the state and the functions to change it
  return html`
    <${ScheduleContext.Provider}
      value=${{
        db,
        calendarNameRef,
        roomIdRef,
        currentSchedule,
        sharedDbObject,
        inviteHexKey,
        setInviteHexKey,
        setCurrentSchedule,
        setSchedule,
        getCalendarRoom,
        initPersonalDB,
      }}
    >
      ${children}
    </${ScheduleContext.Provider}>
  `;
};

export { ScheduleContext, ScheduleProvider };
