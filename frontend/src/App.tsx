import React, { useEffect } from "react";
import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";
import "./App.css";

function App() {
  useEffect(() => {
    const socket: Socket = io("https://192.168.57.59:8000/world", {
      secure: true,
      rejectUnauthorized: false,
    });

    let rtpCapabilities: any;
    let device: Device;
    let producerTransport: any;
    let consumerTransport: any;
    let producer: any;
    let consumer: any;
    let localStream: MediaStream;

    // Join game and get rtpCapabilities
    socket.emit(
      "join-game",
      { userName: "Player1" },
      ({ rtpCapabilities: caps }: any) => {
        rtpCapabilities = caps;
      }
    );

    // Get local video stream
    const getLocalStream = async () => {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { min: 640, max: 1280 }, height: { min: 400, max: 720 } },
      });
      const videoEl = document.getElementById("localVideo") as HTMLVideoElement;
      if (videoEl) videoEl.srcObject = localStream;
    };

    // Create mediasoup device
    const createDevice = async () => {
      device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
    };

    // Create send transport
    const createSendTransport = async () => {
      return new Promise<void>((resolve) => {
        socket.emit(
          "createWebRtcTransport",
          { consumer: false },
          async ({ params }: any) => {
            producerTransport = device.createSendTransport(params);

            producerTransport.on(
              "connect",
              async ({ dtlsParameters }: any, callback: any) => {
                socket.emit("transport-connect", { dtlsParameters });
                callback();
              }
            );

            producerTransport.on(
              "produce",
              async (
                { kind, rtpParameters }: any,
                callback: any
              ) => {
                socket.emit(
                  "transport-produce",
                  { kind, rtpParameters },
                  ({ id, producersExist }: any) => {
                    callback({ id });
                    if (producersExist) getProducers();
                  }
                );
              }
            );

            resolve();
          }
        );
      });
    };

    // Produce local video
    const produceMedia = async () => {
      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];

      if (videoTrack) {
        await producerTransport.produce({ track: videoTrack });
      }

      if (audioTrack) {
        await producerTransport.produce({ track: audioTrack });
      }
    };

    // Create receive transport
    const createRecvTransport = async () => {
      return new Promise<void>((resolve) => {
        socket.emit(
          "createWebRtcTransport",
          { consumer: true },
          ({ params }: any) => {
            consumerTransport = device.createRecvTransport(params);

            consumerTransport.on(
              "connect",
              ({ dtlsParameters }: any, callback: any) => {
                socket.emit("transport-recv-connect", {
                  dtlsParameters,
                  serverConsumerTransportId: consumerTransport.id,
                });
                callback();
              }
            );

            resolve();
          }
        );
      });
    };

    // Consume remote producer
    const consume = async (producerId: string) => {
      socket.emit(
        "consume",
        {
          rtpCapabilities: device.rtpCapabilities,
          remoteProducerId: producerId,
          serverConsumerTransportId: consumerTransport.id,
        },
        async ({ params }: any) => {
          if (params?.error) {
            console.error("Consume error:", params.error);
            return;
          }

          consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });

          const stream = new MediaStream();
          stream.addTrack(consumer.track);

          const video = document.createElement("video");
          video.className = "video remoteVideo";
          video.autoplay = true;
          video.playsInline = true;
          video.controls = true;
          video.volume = 1;
          video.muted = false;
          // Do not mute remote video
          // video.muted = false; // Not needed unless you explicitly set muted elsewhere

          video.srcObject = stream;

          const container = document.getElementById("videoContainer");
          if (container) container.appendChild(video);

          socket.emit("consumer-resume", { serverConsumerId: consumer.id });
        }
      );
    };

    // Get all producers except self
    const getProducers = () => {
      socket.emit("getProducers", (producerIds: string[]) => {
        for (const id of producerIds) consume(id);
      });
    };

    // Listen for new producers
    const onNewProducer = async ({ producerId }: any) => {
      await consume(producerId);
    };
    socket.on("new-producer", onNewProducer);

    // Main start function
    const start = async () => {
      await getLocalStream();
      await createDevice();
      await createSendTransport();
      await produceMedia();
      await createRecvTransport();
      getProducers();
    };

    // Button event
    const joinBtn = document.getElementById("join");
    joinBtn?.addEventListener("click", start);

    // Cleanup
    return () => {
      joinBtn?.removeEventListener("click", start);
      socket.off("new-producer", onNewProducer);
      socket.disconnect();
    };
  }, []);

  return (
    <div id="video">
      <table className="mainTable">
        <tbody>
          <tr>
            <td className="localColumn">
              <video id="localVideo" controls autoPlay muted className="video" />
            </td>
            <td className="remoteColumn">
              <div id="videoContainer"></div>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: "10px" }}>
        <button id="join">Join</button>
      </div>
    </div>
  );
}

export default App;
