import { useRef } from "react";
import "./App.css";
import { useMediasoup } from "./lib/mediasoup";
import PhaserGame from "./components/game";

function App() {
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteContainerId = "audioContainer";

  const { join } = useMediasoup(
    "https://192.168.57.59:8000/world",
    localAudioRef,
    remoteContainerId
  );

  return (
    <div id="audio">
      <PhaserGame />
      <table className="mainTable">
        <tbody>
          <tr>
            <td className="localColumn">
              <audio
                id="localAudio"
                ref={localAudioRef}
                controls
                autoPlay
                muted
                className="audio"
              />
            </td>
            <td className="remoteColumn">
              <div id={remoteContainerId}></div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ✅ Join button triggers mediasoup setup */}
      <div style={{ marginTop: "10px" }}>
        <button id="join" onClick={join}>
          Join
        </button>
      </div>
    </div>
  );
}

export default App;
