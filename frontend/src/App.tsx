import { useRef, useState } from "react";
import "./App.css";
import { useMediasoup } from "./lib/mediasoup";
import PhaserGame from "./components/game";

function App() {
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteContainerId = "mediaContainer";
  const [joined, setJoined] = useState(false);

  const { join } = useMediasoup(
    "https://192.168.57.59:8000/world",
    localAudioRef,
    localVideoRef,
    remoteContainerId
  );

  const handleJoin = () => {
    join();
    setJoined(true);
  };

  return (
    <div id="media">
      <h1>Near World</h1>

      <div className="mainLayout">
        {/* Left: Phaser game */}
        <div className="gameContainer">
          <PhaserGame />
        </div>

        {/* Right: Videos in one column */}
        <div className="videoColumn">
          {/* Hidden local audio */}
          <audio
            hidden
            id="localAudio"
            ref={localAudioRef}
            autoPlay
            muted
            className="audio"
          />

          {/* Local video */}
          <video
            id="localVideo"
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video"
          />

          {/* Remote videos will be dynamically added here */}
          <div id={remoteContainerId} className="remoteContainer" />
        </div>
      </div>

      {/* Join button */}
      {!joined && (
        <div className="joinContainer">
          <button id="join" onClick={handleJoin}>
            Join
          </button>
        </div>
      )}
    </div>

  );
}

export default App;
