// lib/mediasoup.ts
import { useEffect, useRef } from "react";
import { Device } from "mediasoup-client";
import socket from "./socket";

export function useMediasoup(
  socketUrl: string,
  localAudioRef: React.RefObject<HTMLAudioElement | null>,
  remoteContainerId: string
): { join: () => void } {
  const rtpCapabilitiesRef = useRef<any>(null);
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const producerRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudios = useRef(new Map<string, HTMLAudioElement>());

  useEffect(() => {
    socket.connect(); // connect manually (if not already connected)

    socket.on("producer-closed", ({ remoteProducerId }) => {
      const audioEl = remoteAudios.current.get(remoteProducerId);
      if (audioEl) {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
        remoteAudios.current.delete(remoteProducerId);
      }
    });

    socket.on("consume-producers", async ({ producerIds }) => {
      for (const id of producerIds) {
        await consume(id);
      }
    });

    return () => {
      socket.disconnect();
      remoteAudios.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      });
      remoteAudios.current.clear();
    };
  }, []);

  const join = () => {
    socket.emit(
      "join-game",
      { userName: "Kavyansh" },
      async ({ rtpCapabilities }) => {
        rtpCapabilitiesRef.current = rtpCapabilities;
        await startMedia();
      }
    );
  };

  const startMedia = async () => {
    await getLocalStream();
    await createDevice();
    await createSendTransport();
    await produceMedia();
    await createRecvTransport();
  };

  const getLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    localStreamRef.current = stream;
    if (localAudioRef.current) localAudioRef.current.srcObject = stream;
  };

  const createDevice = async () => {
    const device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilitiesRef.current });
    deviceRef.current = device;
  };

  const createSendTransport = async () => {
    return new Promise<void>((resolve) => {
      socket.emit(
        "createWebRtcTransport",
        { consumer: false },
        async ({ params }) => {
          const device = deviceRef.current!;
          const transport = device.createSendTransport(params);
          producerTransportRef.current = transport;

          transport.on("connect", async ({ dtlsParameters }, callback) => {
            socket.emit("transport-connect", { dtlsParameters });
            callback();
          });

          transport.on("produce", async ({ kind, rtpParameters }, callback) => {
            socket.emit(
              "transport-produce",
              { kind, rtpParameters },
              ({ id }) => {
                callback({ id });
              }
            );
          });

          resolve();
        }
      );
    });
  };

  const produceMedia = async () => {
    const audioTrack = localStreamRef.current!.getAudioTracks()[0];
    producerRef.current = await producerTransportRef.current.produce({
      track: audioTrack,
    });
  };

  const createRecvTransport = async () => {
    return new Promise<void>((resolve) => {
      socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        async ({ params }) => {
          const device = deviceRef.current!;
          const transport = device.createRecvTransport(params);
          consumerTransportRef.current = transport;

          transport.on("connect", ({ dtlsParameters }, callback) => {
            socket.emit("transport-recv-connect", {
              dtlsParameters,
              serverConsumerTransportId: transport.id,
            });
            callback();
          });

          resolve();
        }
      );
    });
  };

  const consume = async (producerId: string) => {
    socket.emit(
      "server-consume",
      {
        rtpCapabilities: deviceRef.current!.rtpCapabilities,
        remoteProducerId: producerId,
        serverConsumerTransportId: consumerTransportRef.current.id,
      },
      async ({ params }) => {
        if (params?.error) {
          console.error("Consume error:", params.error);
          return;
        }

        const consumer = await consumerTransportRef.current.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        const audio = document.createElement("audio");
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.controls = true;
        audio.className = "audio remoteAudio";

        const container = document.getElementById(remoteContainerId);
        if (container) container.appendChild(audio);

        remoteAudios.current.set(params.producerId, audio);

        socket.emit("consumer-resume", { serverConsumerId: consumer.id });
      }
    );
  };

  return { join };
}
