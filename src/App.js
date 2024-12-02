import { html } from "htm/react";
import { ScheduleProvider } from "./context/ScheduleContext";
import PeersView from "./components/PeersView";

export default () => {
  return html`
      <div className="container">
        <${ScheduleProvider}>
          <${PeersView} />
        </${ScheduleProvider}>
      </div>
  `;
};
