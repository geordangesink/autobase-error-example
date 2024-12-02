// PeersView.js
import { html } from "htm/react";
import { useState } from "react";
import { jsonToMap } from "../api/data-formats/json-map-switch";
import useSchedule from "../hooks/useSchedule";

export default () => {
  const { roomIdRef, setCurrentSchedule, getCalendarRoom, sharedDbObject, inviteHexKey } = useSchedule();
  const [searchInput, setSearchInput] = useState();

  const handleNewRoom = async () => {
    getCalendarRoom(undefined, true);
  };

  const handleJoinRoom = async () => {
    let bee = false;
    for (const roomId in sharedDbObject) {
      const roomDetails = sharedDbObject[roomId];
      if (roomDetails.room.invite === searchInput) {
        bee = roomDetails.room.autobee;
        roomIdRef.current = roomId;
        break;
      }
    }

    if (!bee) {
      await getCalendarRoom(searchInput, true);
    } else {
      const schedule = await bee.get("schedule");
      if (schedule && schedule.value && Object.keys(schedule.value).length !== 0) {
        setCurrentSchedule(jsonToMap(schedule.value.toString()));
        console.log(jsonToMap(schedule.value.toString()));
      } else {
        setCurrentSchedule(new Map());
      }
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
