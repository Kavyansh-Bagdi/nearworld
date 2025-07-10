import { useRef } from "react";
import "./App.css";
import { useMediasoup } from "./lib/mediasoup";
import PhaserGame from "./components/game";

function App() {
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteContainerId = "mediaContainer";

  const { join } = useMediasoup(
    "https://192.168.57.59:8000/world",
    localAudioRef,
    localVideoRef,
    remoteContainerId
  );

  return (
    <div id="media">
      <PhaserGame />

      <table className="mainTable">
        <tbody>
          <tr>
            {/* Local media section */}
            <td className="localColumn">
              <div>
                <h3>Local Audio</h3>
                <audio
                  id="localAudio"
                  ref={localAudioRef}
                  controls
                  autoPlay
                  muted
                  className="audio"
                />
              </div>
              <div style={{ marginTop: "20px" }}>
                <h3>Local Video</h3>
                <video
                  id="localVideo"
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="video"
                  style={{
                    width: "200px",
                    height: "150px",
                    objectFit: "cover",
                    border: "1px solid gray",
                  }}
                />
              </div>
            </td>

            {/* Remote media section */}
            <td className="remoteColumn">
              <div id={remoteContainerId}>
                <h3>Remote Media</h3>
                {/* Remote audio and video elements will be added here dynamically */}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "10px", textAlign: "center" }}>
        <button id="join" onClick={join}>
          Join
        </button>
      </div>
    </div>
  );
}

export default App;
