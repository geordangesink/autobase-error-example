import { html } from "htm/react";
import PeersView from "./components/PeersView";

export default () => {
  return html`
    <div className="container">
      <${PeersView} />
    </div>
  `;
};
