import React, { useEffect } from "react";
import { Device } from "mediasoup-client";
import { io, Socket } from "socket.io-client";

function App() {
  useEffect(() => {
    const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
    const remoteVideo = document.getElementById("remoteVideo") as HTMLVideoElement;

    const socket: Socket = io("https://localhost:8000/world", {
      secure: true,
      rejectUnauthorized: false,
    });

    socket.on("connection-success", ({ socketId }: { socketId: string }) => {
      console.log("Connected with Socket ID:", socketId);
    });

    let rtpCapabilities: any;
    let device: Device;
    let producerTransport: any;
    let consumerTransport: any;
    let producer: any;
    let consumer: any;
    let localStream: MediaStream;

    const getLocalStream = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        navigator.mediaDevices
          .getUserMedia({
            audio: false,
            video: {
              width: { min: 640, max: 1920 },
              height: { min: 400, max: 1080 },
            },
          })
          .then((stream) => {
            localStream = stream;
            if (localVideo) localVideo.srcObject = stream;
            resolve();
          })
          .catch((error) => {
            console.error("Media error:", error.message);
            reject(error);
          });
      });
    };

    const getRtpCapabilities = (): Promise<any> =>
      new Promise((resolve) => {
        socket.emit("getRtpCapabilities", (data: any) => {
          rtpCapabilities = data.rtpCapabilities;
          resolve(rtpCapabilities);
        });
      });

    const createDevice = async () => {
      try {
        device = new Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        console.log("Device loaded");
      } catch (error: any) {
        console.error("Device load error:", error.message);
      }
    };

    const createSendTransport = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        socket.emit("createWebRtcTransport", { sender: true }, ({ params }: { params: any }) => {
          if (params.error) {
            console.error(params.error);
            reject(params.error);
            return;
          }

          // When creating transports, make sure iceServers is included in params
          producerTransport = device.createSendTransport({
            ...params, // params should include iceServers
          });

          producerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                await socket.emit("transport-connect", { dtlsParameters });
                callback();
              } catch (error) {
                errback(error);
              }
            }
          );

          producerTransport.on(
            "produce",
            async ({ kind, rtpParameters, appData }, callback, errback) => {
              try {
                socket.emit(
                  "transport-produce",
                  { kind, rtpParameters, appData },
                  ({ id }: { id: string }) => {
                    callback({ id });
                  }
                );
              } catch (error) {
                errback(error);
              }
            }
          );

          resolve();
        });
      });
    };

    const produceMedia = async () => {
      const videoTrack = localStream.getVideoTracks()[0];

      producer = await producerTransport.produce({
        track: videoTrack,
        encodings: [
          { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
          { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
          { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000,
        },
      });

      producer.on("trackended", () => {
        console.log("Track ended");
      });

      producer.on("transportclose", () => {
        console.log("Transport closed");
      });
    };

    const createRecvTransport = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        socket.emit("createWebRtcTransport", { sender: false }, ({ params }: { params: any }) => {
          if (params.error) {
            console.error(params.error);
            reject(params.error);
            return;
          }

          // When creating transports, make sure iceServers is included in params
          consumerTransport = device.createRecvTransport({
            ...params,
          });

          consumerTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                await socket.emit("transport-recv-connect", { dtlsParameters });
                callback();
              } catch (error) {
                errback(error);
              }
            }
          );

          consumerTransport.on("connectionstatechange", (state: string) => {
            console.log("Consumer transport state:", state);
          });

          resolve();
        });
      });
    };

    const consumeMedia = async () => {
      if (!consumerTransport) {
        console.warn("⛔ consumerTransport is not initialized. Creating it now...");
        await createRecvTransport(); // ensure it exists
      }

      socket.emit(
        "consume",
        { rtpCapabilities: device.rtpCapabilities },
        async ({ params }: { params: any }) => {
          if (params.error) {
            console.error("Cannot consume:", params.error);
            return;
          }

          consumer = await consumerTransport!.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });

          console.log("Consumer track:", consumer.track);
          const stream = new MediaStream();
          stream.addTrack(consumer.track);
          console.log("Remote stream:", stream);
          remoteVideo.srcObject = stream;
          console.log("remoteVideo.srcObject:", remoteVideo.srcObject);

          try {
            await remoteVideo.play();
          } catch (err) {
            console.error("Remote video play error:", err);
          }


          socket.emit("consumer-resume");
        }
      );
    };


    const start = async () => {
      await getLocalStream();
      await getRtpCapabilities();
      await createDevice();
      await createSendTransport();
      await produceMedia();
      await createRecvTransport();
    };

    const button = document.getElementById("join");
    const conbtn = document.getElementById("consume");

    button?.addEventListener("click", start);
    conbtn?.addEventListener("click", consumeMedia);

    return () => {
      button?.removeEventListener("click", start);
      conbtn?.removeEventListener("click", consumeMedia);
      socket.disconnect();
    };
  }, []);

  return (
    <div className="App">
      <h1>NearWorld</h1>
      <button id="join">Join</button>
      <video
        id="localVideo"
        autoPlay
        playsInline
        muted
        style={{ width: "640px", height: "360px", backgroundColor: "#000" }}
      />
      <button id="consume">Consume</button>
      <video
        id="remoteVideo"
        autoPlay
        playsInline
        muted
        style={{ width: "640px", height: "360px", backgroundColor: "#000", marginTop: "1rem" }}
      />
    </div>
  );
}

export default App;
